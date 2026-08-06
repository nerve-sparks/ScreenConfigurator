"""Forward published journey payloads to the agent scorecard connection URL."""

from __future__ import annotations

import base64
import json
import logging
import re
from typing import Any, Optional
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

from utils.scorecard import (
    auth_headers_for_connection,
    build_run_payload,
    connection_config,
    looks_like_jwt,
    normalize_scorecard,
)

logger = logging.getLogger(__name__)

ALLOWED_METHODS = frozenset({"POST", "PUT", "PATCH"})
_DATA_URL_RE = re.compile(
    r"^data:(?P<mime>[\w/+.-]+)(?:;charset=[\w-]+)?;base64,(?P<data>.+)$",
    re.IGNORECASE | re.DOTALL,
)


def _validate_agent_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(
            status_code=422,
            detail="Scorecard connection.url must be an absolute http(s) URL.",
        )
    return url


def _scorecard_for_run(scorecard: Optional[dict]) -> dict:
    if not scorecard:
        return {}
    try:
        return normalize_scorecard(scorecard)
    except ValueError:
        return dict(scorecard) if isinstance(scorecard, dict) else {}


def _form_scalar(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=True)


def _split_multipart_payload(
    payload: dict[str, Any],
) -> tuple[dict[str, str], list[tuple[str, tuple[str, bytes, str]]]]:
    """Split payload into form fields and file parts (from data URLs)."""
    data: dict[str, str] = {}
    files: list[tuple[str, tuple[str, bytes, str]]] = []
    for key, value in payload.items():
        if not isinstance(key, str) or not key:
            continue
        if isinstance(value, str):
            match = _DATA_URL_RE.match(value.strip())
            if match:
                raw = base64.b64decode(match.group("data"))
                mime = match.group("mime") or "application/octet-stream"
                ext = mime.split("/")[-1] if "/" in mime else "bin"
                filename = f"{key}.{ext}"
                files.append((key, (filename, raw, mime)))
                continue
        if isinstance(value, list):
            # Multiple files / values: send repeated flat keys when possible.
            for index, item in enumerate(value):
                if isinstance(item, str):
                    match = _DATA_URL_RE.match(item.strip())
                    if match:
                        raw = base64.b64decode(match.group("data"))
                        mime = match.group("mime") or "application/octet-stream"
                        ext = mime.split("/")[-1] if "/" in mime else "bin"
                        files.append((key, (f"{key}-{index}.{ext}", raw, mime)))
                        continue
                data[f"{key}[{index}]" if not isinstance(item, str) else key] = (
                    _form_scalar(item)
                )
            continue
        data[key] = _form_scalar(value)
    return data, files


async def forward_agent_run(
    *,
    scorecard: Optional[dict],
    values_by_screen: dict,
    studio_agent_id: str,
    release_version: int,
    caller_authorization: str = "",
) -> dict[str, Any]:
    # Use the full stored scorecard so connection.api_key stays available server-side.
    card = _scorecard_for_run(scorecard)
    connection = connection_config(card)
    url = connection["url"]
    if not url:
        return {
            "status": "local",
            "message": (
                "No connection.url on the scorecard. Values were collected locally "
                "and were not sent to an agent."
            ),
            "payload": build_run_payload(card, values_by_screen),
            "agent_response": None,
        }

    url = _validate_agent_url(url)
    method = connection["method"]
    if method not in ALLOWED_METHODS:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported scorecard connection method '{method}'.",
        )

    try:
        payload = build_run_payload(card, values_by_screen)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # agent-builder accepts optional thread_id / human_input when present.
    flat_extras = {}
    if isinstance(values_by_screen, dict):
        for screen_values in values_by_screen.values():
            if isinstance(screen_values, dict):
                for key in ("thread_id", "human_input"):
                    if key in screen_values and key not in payload:
                        flat_extras[key] = screen_values[key]
    if flat_extras:
        payload = {**payload, **flat_extras}

    timeout = max(1.0, min(connection["timeout_ms"] / 1000.0, 120.0))
    body_format = connection.get("body_format") or "json"
    headers = {
        "Accept": "application/json",
        "X-Screen-Studio-Agent-Id": studio_agent_id,
        "X-Screen-Studio-Release": str(release_version),
    }
    auth_headers = auth_headers_for_connection(
        connection,
        caller_authorization=caller_authorization,
    )
    headers.update(auth_headers)
    runtime_id = card.get("agent_id") or card.get("node_id")
    if runtime_id:
        headers["X-Runtime-Agent-Id"] = str(runtime_id)

    auth_header_name = connection.get("auth_header") or "Authorization"
    auth_value = auth_headers.get(auth_header_name) or ""
    auth_applied = bool(auth_value)
    using_session = bool(
        caller_authorization
        and auth_value
        and auth_value == (
            caller_authorization
            if caller_authorization.lower().startswith(("bearer ", "token "))
            else f"Bearer {caller_authorization.strip()}"
        )
    )
    logger.info(
        "Forwarding published run studio_agent=%s release=%s -> %s %s auth=%s "
        "mode=%s jwt=%s session=%s body=%s",
        studio_agent_id,
        release_version,
        method,
        url,
        "yes" if auth_applied else "no",
        connection.get("auth_mode") or "api_key",
        "yes" if looks_like_jwt(auth_value) else "no",
        "yes" if using_session else "no",
        body_format,
    )

    request_kwargs: dict[str, Any] = {"headers": headers}
    if body_format == "multipart":
        # Let httpx set multipart Content-Type with boundary.
        headers.pop("Content-Type", None)
        form_data, form_files = _split_multipart_payload(payload)
        # httpx only emits multipart/form-data when `files` is provided.
        multipart_files: list[tuple[str, Any]] = [
            (key, (None, value)) for key, value in form_data.items()
        ]
        multipart_files.extend(form_files)
        if not multipart_files:
            multipart_files = [("_", (None, ""))]
        request_kwargs["files"] = multipart_files
    else:
        headers["Content-Type"] = "application/json"
        request_kwargs["json"] = payload

    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            response = await client.request(method, url, **request_kwargs)
    except httpx.TimeoutException as exc:
        logger.warning("Agent run timed out url=%s", url)
        raise HTTPException(
            status_code=504,
            detail="The agent request timed out. Check connection.timeout_ms and retry.",
        ) from exc
    except httpx.HTTPError as exc:
        logger.warning("Agent run failed url=%s error=%s", url, type(exc).__name__)
        raise HTTPException(
            status_code=502,
            detail=f"Could not reach the agent connection URL ({url}).",
        ) from exc

    body: Any
    content_type = response.headers.get("content-type", "")
    try:
        if "application/json" in content_type:
            body = response.json()
        else:
            body = response.text
    except Exception:
        body = response.text

    if response.status_code >= 400:
        detail: Any = {
            "message": "The agent returned an error response.",
            "agent_status": response.status_code,
            "agent_body": body,
            "body_format": body_format,
        }
        agent_output = ""
        if isinstance(body, dict):
            result = body.get("result")
            if isinstance(result, dict) and isinstance(result.get("output"), str):
                agent_output = result["output"]
            elif isinstance(body.get("detail"), str):
                agent_output = body["detail"]
        if (
            response.status_code == 401
            and "access token" in agent_output.lower()
            and not looks_like_jwt(auth_value)
        ):
            detail["hint"] = (
                "agent-builder expects Authorization: Bearer <JWT access token>. "
                "The stored API key is not a JWT. Stay logged into Studio and "
                "retry — Studio will forward your login access token."
            )
        if response.status_code == 415:
            detail["hint"] = (
                "Agent expects multipart/form-data with flat keys "
                "(optional thread_id, human_input). Studio now sends that "
                "format for agent-builder pipeline URLs."
            )
        raise HTTPException(status_code=502, detail=detail)

    return {
        "status": "submitted",
        "message": "Collected inputs were sent to the agent connection URL.",
        "request_url": url,
        "request_method": method,
        "auth_applied": auth_applied,
        "auth_mode": connection.get("auth_mode") or "api_key",
        "body_format": body_format,
        "payload": payload,
        "agent_status": response.status_code,
        "agent_response": body,
    }
