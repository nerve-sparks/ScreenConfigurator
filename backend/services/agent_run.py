"""Forward published journey payloads to project endpoints with shared runtime auth."""

from __future__ import annotations

import base64
import json
import logging
import re
from typing import Any, Optional
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

from utils.runtime_config import (
    apply_runtime_auth,
    endpoint_payload,
    hydrate_project_config,
    migrate_from_scorecard,
    normalize_endpoints,
    normalize_runtime,
    resolve_endpoint_url,
)
from utils.scorecard import looks_like_jwt, normalize_scorecard

logger = logging.getLogger(__name__)

ALLOWED_METHODS = frozenset({"POST", "PUT", "PATCH", "GET", "DELETE"})
_DATA_URL_RE = re.compile(
    r"^data:(?P<mime>[\w/+.-]+)(?:;charset=[\w-]+)?;base64,(?P<data>.+)$",
    re.IGNORECASE | re.DOTALL,
)


def _validate_agent_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(
            status_code=422,
            detail="Endpoint URL must be an absolute http(s) URL.",
        )
    return url


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
                files.append((key, (f"{key}.{ext}", raw, mime)))
                continue
        if isinstance(value, list):
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


def _resolve_body_format(endpoint: dict, url: str, runtime: dict) -> str:
    body_format = (endpoint.get("body_format") or "").lower()
    if body_format in {"multipart", "json"}:
        return body_format
    default = ((runtime.get("defaults") or {}).get("body_format") or "auto").lower()
    if default in {"multipart", "json"}:
        return default
    if "agent-builder.nervesparks.com" in url and "/pipeline" in url:
        return "multipart"
    return "json"


def _release_config(
    *,
    scorecard: Optional[dict],
    runtime: Optional[dict],
    endpoints: Optional[list],
) -> tuple[dict, list[dict]]:
    project = hydrate_project_config(
        {
            "scorecard": scorecard or {},
            "runtime": runtime,
            "endpoints": endpoints,
        }
    ) or {}
    runtime_value = normalize_runtime(project.get("runtime"), keep_secret=True)
    try:
        endpoints_value = normalize_endpoints(project.get("endpoints"))
    except ValueError:
        endpoints_value = []
    if not endpoints_value and scorecard:
        migrated_runtime, migrated_endpoints = migrate_from_scorecard(scorecard)
        if not runtime:
            runtime_value = migrated_runtime
        endpoints_value = migrated_endpoints
    return runtime_value, endpoints_value


async def _call_endpoint(
    *,
    runtime: dict,
    endpoint: dict,
    values_by_screen: dict,
    studio_agent_id: str,
    release_version: int,
    caller_authorization: str,
) -> dict[str, Any]:
    url = resolve_endpoint_url(runtime, endpoint)
    if not url:
        raise HTTPException(
            status_code=422,
            detail=f"Endpoint '{endpoint.get('id')}' has no URL configured.",
        )
    url = _validate_agent_url(url)
    method = (endpoint.get("method") or "POST").upper()
    if method not in ALLOWED_METHODS:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported method '{method}' for endpoint '{endpoint.get('id')}'.",
        )

    try:
        payload = endpoint_payload(endpoint, values_by_screen)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Optional agent-builder extras.
    if isinstance(values_by_screen, dict):
        for screen_values in values_by_screen.values():
            if isinstance(screen_values, dict):
                for key in ("thread_id", "human_input"):
                    if key in screen_values and key not in payload:
                        payload[key] = screen_values[key]

    timeout_ms = ((runtime.get("defaults") or {}).get("timeout_ms") or 30000)
    timeout = max(1.0, min(float(timeout_ms) / 1000.0, 120.0))
    body_format = _resolve_body_format(endpoint, url, runtime)
    url, auth_headers = apply_runtime_auth(
        runtime,
        url,
        caller_authorization=caller_authorization,
    )
    headers = {
        "Accept": "application/json",
        "X-Screen-Studio-Agent-Id": studio_agent_id,
        "X-Screen-Studio-Release": str(release_version),
        "X-Screen-Studio-Endpoint": str(endpoint.get("id") or ""),
    }
    headers.update(auth_headers)

    auth_applied = bool(auth_headers) or (
        "?" in url and ((runtime.get("auth") or {}).get("type") == "api_key_query")
    )
    logger.info(
        "Forwarding endpoint studio_agent=%s release=%s endpoint=%s -> %s %s auth=%s body=%s",
        studio_agent_id,
        release_version,
        endpoint.get("id"),
        method,
        url,
        "yes" if auth_applied else "no",
        body_format,
    )

    request_kwargs: dict[str, Any] = {"headers": headers}
    if method == "GET":
        request_kwargs["params"] = {
            key: _form_scalar(value) for key, value in payload.items()
        }
    elif body_format == "multipart":
        headers.pop("Content-Type", None)
        form_data, form_files = _split_multipart_payload(payload)
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
        raise HTTPException(
            status_code=504,
            detail=f"Endpoint '{endpoint.get('id')}' timed out.",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not reach endpoint '{endpoint.get('id')}' ({url}).",
        ) from exc

    content_type = response.headers.get("content-type", "")
    try:
        body = response.json() if "application/json" in content_type else response.text
    except Exception:
        body = response.text

    if response.status_code >= 400:
        detail: Any = {
            "message": f"Endpoint '{endpoint.get('id')}' returned an error.",
            "endpoint_id": endpoint.get("id"),
            "endpoint_name": endpoint.get("name"),
            "agent_status": response.status_code,
            "agent_body": body,
            "body_format": body_format,
        }
        auth_value = next(iter(auth_headers.values()), "") if auth_headers else ""
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
                "Agent expects Authorization: Bearer <JWT>. Set a JWT in project "
                "runtime auth, or stay logged into Studio so your session token "
                "can be forwarded."
            )
        raise HTTPException(status_code=502, detail=detail)

    return {
        "endpoint_id": endpoint.get("id"),
        "endpoint_name": endpoint.get("name"),
        "request_url": url,
        "request_method": method,
        "body_format": body_format,
        "auth_applied": auth_applied,
        "payload": payload,
        "agent_status": response.status_code,
        "agent_response": body,
    }


async def forward_agent_run(
    *,
    scorecard: Optional[dict],
    values_by_screen: dict,
    studio_agent_id: str,
    release_version: int,
    caller_authorization: str = "",
    runtime: Optional[dict] = None,
    endpoints: Optional[list] = None,
) -> dict[str, Any]:
    runtime_value, endpoints_value = _release_config(
        scorecard=scorecard,
        runtime=runtime,
        endpoints=endpoints,
    )
    enabled = [item for item in endpoints_value if item.get("enabled", True)]
    enabled = [item for item in enabled if (item.get("url") or "").strip()]

    if not enabled:
        # Legacy local-only completion when nothing is configured to call.
        try:
            card = normalize_scorecard(scorecard) if scorecard else {}
        except ValueError:
            card = scorecard or {}
        from utils.scorecard import build_run_payload

        return {
            "status": "local",
            "message": (
                "No enabled endpoints with URLs. Values were collected locally "
                "and were not sent to an agent."
            ),
            "payload": build_run_payload(card, values_by_screen),
            "results": [],
            "agent_response": None,
        }

    results: list[dict[str, Any]] = []
    for endpoint in enabled:
        result = await _call_endpoint(
            runtime=runtime_value,
            endpoint=endpoint,
            values_by_screen=values_by_screen,
            studio_agent_id=studio_agent_id,
            release_version=release_version,
            caller_authorization=caller_authorization,
        )
        results.append(result)

    return {
        "status": "submitted",
        "message": f"Collected inputs were sent to {len(results)} endpoint(s).",
        "auth_type": (runtime_value.get("auth") or {}).get("type") or "bearer",
        "results": results,
        # Convenience for single-endpoint UIs.
        "request_url": results[-1]["request_url"] if results else None,
        "request_method": results[-1]["request_method"] if results else None,
        "payload": results[-1]["payload"] if results else None,
        "agent_status": results[-1]["agent_status"] if results else None,
        "agent_response": results[-1]["agent_response"] if results else None,
    }
