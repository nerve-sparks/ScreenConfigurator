"""Normalize and summarize agent scorecard JSON for planning and generation.

Scorecards describe an existing agent runtime (input/output schemas, connection,
capabilities). Screen Studio stores them beside the project so generation can
map user-facing screens onto the agent's real input contract.
"""

from __future__ import annotations

import json

from typing import Any, Optional


SCORECARD_MAX_BYTES = 200_000
ALLOWED_TOP_LEVEL = {
    "sla",
    "name",
    "intent",
    "status",
    "node_id",
    "version",
    "agent_id",
    "metadata",
    "node_type",
    "connection",
    "checkpoints",
    "capabilities",
    "error_schema",
    "input_schema",
    "output_schema",
    "owner_orchestrator",
}


def normalize_scorecard(raw: Any) -> dict:
    """Return a sanitized scorecard or raise ValueError."""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValueError("Scorecard must be a JSON object.")
    if len(str(raw)) > SCORECARD_MAX_BYTES:
        raise ValueError("Scorecard is too large.")

    cleaned: dict[str, Any] = {}
    for key, value in raw.items():
        if key in ALLOWED_TOP_LEVEL:
            cleaned[key] = value

    if not cleaned:
        raise ValueError(
            "Scorecard is empty or unrecognized. Include fields such as name, "
            "agent_id, input_schema, and connection."
        )

    name = cleaned.get("name")
    if name is not None and (not isinstance(name, str) or not name.strip()):
        raise ValueError("Scorecard name must be a non-empty string when present.")

    input_schema = cleaned.get("input_schema")
    if input_schema is not None and not isinstance(input_schema, dict):
        raise ValueError("Scorecard input_schema must be an object.")

    connection = cleaned.get("connection")
    if connection is not None and not isinstance(connection, dict):
        raise ValueError("Scorecard connection must be an object.")

    return cleaned


def scorecard_display_name(scorecard: Optional[dict]) -> str:
    if not scorecard:
        return ""
    name = scorecard.get("name")
    return name.strip() if isinstance(name, str) else ""


def scorecard_runtime_id(scorecard: Optional[dict]) -> str:
    if not scorecard:
        return ""
    for key in ("agent_id", "node_id"):
        value = scorecard.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def scorecard_input_fields(scorecard: Optional[dict]) -> list[dict]:
    """Flatten scorecard input_schema properties for prompts and UI."""
    if not scorecard:
        return []
    schema = scorecard.get("input_schema")
    if not isinstance(schema, dict):
        return []
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        return []
    required = schema.get("required")
    required_set = set(required) if isinstance(required, list) else set()
    fields = []
    for name, definition in properties.items():
        if not isinstance(name, str) or not isinstance(definition, dict):
            continue
        fields.append(
            {
                "name": name,
                "type": definition.get("type", "string"),
                "title": definition.get("title") or name,
                "description": definition.get("description") or "",
                "required": name in required_set,
                "enum": definition.get("enum"),
            }
        )
    return fields


def _normalize_secret(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    cleaned = value.strip()
    if len(cleaned) >= 2 and cleaned[0] == cleaned[-1] and cleaned[0] in {'"', "'"}:
        cleaned = cleaned[1:-1].strip()
    return cleaned


def looks_like_jwt(token: str) -> bool:
    """Return True when value looks like a JWT (optionally Bearer-prefixed)."""
    cleaned = _normalize_secret(token)
    if cleaned.lower().startswith(("bearer ", "token ")):
        cleaned = cleaned.split(" ", 1)[1].strip()
    parts = cleaned.split(".")
    return len(parts) == 3 and all(parts)


def _clean_header_map(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    headers: dict[str, str] = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not key.strip():
            continue
        if not isinstance(value, str) or not value.strip():
            continue
        headers[key.strip()] = value.strip()
    return headers


def connection_config(scorecard: Optional[dict]) -> dict:
    """Return connection settings for forwarding a published run.

    Includes secrets (api_key / authorization). Callers that return scorecards
    to browsers must use ``public_scorecard`` instead.
    """
    empty = {
        "url": "",
        "method": "POST",
        "protocol": "REST",
        "timeout_ms": 30000,
        "api_key": "",
        "authorization": "",
        "auth_header": "Authorization",
        "auth_scheme": "Bearer",
        "auth_mode": "api_key",
        "body_format": "json",
        "headers": {},
        "has_api_key": False,
    }
    if not scorecard or not isinstance(scorecard.get("connection"), dict):
        return empty
    connection = scorecard["connection"]
    url = connection.get("url")
    method = connection.get("method")
    timeout = connection.get("timeout_ms")
    api_key = connection.get("api_key")
    if not isinstance(api_key, str) or not api_key.strip():
        # Common aliases from agent platform scorecards.
        for alias in ("token", "access_token", "bearer_token"):
            candidate = connection.get(alias)
            if isinstance(candidate, str) and candidate.strip():
                api_key = candidate
                break
        else:
            api_key = ""
    authorization = connection.get("authorization")
    auth_header = connection.get("auth_header")
    auth_scheme = connection.get("auth_scheme")
    if auth_scheme is None:
        auth_scheme = "Bearer"
    elif not isinstance(auth_scheme, str):
        auth_scheme = "Bearer"
    auth_mode = connection.get("auth_mode")
    if not isinstance(auth_mode, str) or not auth_mode.strip():
        auth_mode = "api_key"
    else:
        auth_mode = auth_mode.strip().lower()
        if auth_mode not in {"api_key", "session", "api_key_or_session"}:
            auth_mode = "api_key"
    body_format = connection.get("body_format") or connection.get("content_type")
    if isinstance(body_format, str):
        body_format = body_format.strip().lower()
        if body_format in {"multipart/form-data", "multipart", "form-data", "form"}:
            body_format = "multipart"
        elif body_format in {"application/json", "json"}:
            body_format = "json"
        else:
            body_format = ""
    else:
        body_format = ""
    url_value = url.strip() if isinstance(url, str) else ""
    if not body_format:
        # agent-builder pipeline endpoints require multipart/form-data.
        if "agent-builder.nervesparks.com" in url_value and "/pipeline" in url_value:
            body_format = "multipart"
        else:
            body_format = "json"
    return {
        "url": url_value,
        "method": (
            method.strip().upper()
            if isinstance(method, str) and method.strip()
            else "POST"
        ),
        "protocol": connection.get("protocol") or "REST",
        "timeout_ms": (
            int(timeout)
            if isinstance(timeout, int) and not isinstance(timeout, bool) and timeout > 0
            else 30000
        ),
        "api_key": _normalize_secret(api_key),
        "authorization": _normalize_secret(authorization),
        "auth_header": (
            auth_header.strip()
            if isinstance(auth_header, str) and auth_header.strip()
            else "Authorization"
        ),
        "auth_scheme": auth_scheme.strip(),
        "auth_mode": auth_mode,
        "body_format": body_format,
        "headers": _clean_header_map(connection.get("headers")),
        "has_api_key": bool(
            _normalize_secret(api_key)
            or _normalize_secret(authorization)
            or _clean_header_map(connection.get("headers"))
            or auth_mode in {"session", "api_key_or_session"}
        ),
    }


def auth_headers_for_connection(
    connection: dict,
    *,
    caller_authorization: str = "",
) -> dict[str, str]:
    """Build HTTP auth headers from a ``connection_config`` result.

    ``auth_mode``:
      - ``api_key`` (default): use connection.api_key / authorization
      - ``session``: forward the caller's Studio Authorization header
      - ``api_key_or_session``: api key if set, otherwise the caller session

    Agent-builder endpoints expect a JWT access token. Short API-key strings
    produce \"Invalid access token header\"; when that happens we fall back to
    the caller's Studio JWT when available.
    """
    headers = dict(connection.get("headers") or {})
    auth_header = connection.get("auth_header") or "Authorization"
    auth_mode = (connection.get("auth_mode") or "api_key").strip().lower()
    authorization = _normalize_secret(connection.get("authorization") or "")
    api_key = _normalize_secret(connection.get("api_key") or "")
    auth_scheme = connection.get("auth_scheme")
    if auth_scheme is None:
        auth_scheme = "Bearer"
    caller = _normalize_secret(caller_authorization)

    def _from_api_key() -> str:
        if authorization:
            if authorization.lower().startswith(("bearer ", "token ")):
                return authorization
            if auth_scheme:
                return f"{auth_scheme} {authorization}"
            return authorization
        if not api_key:
            return ""
        lowered = api_key.lower()
        if lowered.startswith(("bearer ", "token ")):
            return api_key
        if auth_scheme:
            return f"{auth_scheme} {api_key}"
        return api_key

    def _from_session() -> str:
        if not caller:
            return ""
        if caller.lower().startswith(("bearer ", "token ")):
            return caller
        return f"Bearer {caller}"

    def _usable_bearer(value: str) -> bool:
        if not value:
            return False
        # Agent-builder validates JWT shape after the Bearer scheme.
        return looks_like_jwt(value)

    api_value = _from_api_key()
    session_value = _from_session()

    if auth_mode == "session":
        value = session_value
    elif auth_mode == "api_key_or_session":
        value = api_value if _usable_bearer(api_value) else session_value
        if not value:
            value = api_value or session_value
    else:
        # api_key mode: still fall back to session JWT when the stored key is
        # not a JWT (common mis-paste of a platform api_key string).
        if _usable_bearer(api_value):
            value = api_value
        elif session_value:
            value = session_value
        else:
            value = api_value

    if value:
        headers.setdefault(auth_header, value)
    return headers


def flatten_values_by_screen(values_by_screen: Any) -> dict:
    flat: dict[str, Any] = {}
    if not isinstance(values_by_screen, dict):
        return flat
    for value in values_by_screen.values():
        if isinstance(value, dict):
            for key, item in value.items():
                if isinstance(key, str):
                    flat[key] = item
    return flat


def build_run_payload(
    scorecard: Optional[dict],
    values_by_screen: Any,
) -> dict:
    """Map collected screen values onto the scorecard input_schema."""
    flat = flatten_values_by_screen(values_by_screen)
    fields = scorecard_input_fields(scorecard)
    if not fields:
        return {"values_by_screen": values_by_screen, "flat_values": flat}

    payload: dict[str, Any] = {}
    field_names = {field["name"] for field in fields}
    for name in field_names:
        if name in flat:
            payload[name] = flat[name]

    # Common agent contract: a single string "input" field.
    if "input" in field_names and "input" not in payload:
        if len(flat) == 1:
            payload["input"] = next(iter(flat.values()))
        elif flat:
            payload["input"] = json.dumps(flat, ensure_ascii=True)

    for field in fields:
        if field["required"] and field["name"] not in payload:
            raise ValueError(
                f"Required agent input '{field['name']}' was not collected "
                "from the published screens."
            )
    return payload


def public_scorecard(scorecard: Optional[dict]) -> dict:
    """Scorecard fields safe to expose on published releases / exports."""
    if not scorecard:
        return {}
    try:
        cleaned = normalize_scorecard(scorecard)
    except ValueError:
        return {}
    connection = connection_config(cleaned)
    return {
        "name": cleaned.get("name") or "",
        "agent_id": cleaned.get("agent_id") or "",
        "node_id": cleaned.get("node_id") or "",
        "version": cleaned.get("version") or "",
        "capabilities": cleaned.get("capabilities") or [],
        "input_schema": cleaned.get("input_schema") or {},
        "output_schema": cleaned.get("output_schema") or {},
        "connection": {
            "url": connection["url"],
            "method": connection["method"],
            "protocol": connection["protocol"],
            "timeout_ms": connection["timeout_ms"],
            "auth_header": connection["auth_header"],
            "auth_scheme": connection["auth_scheme"],
            "auth_mode": connection["auth_mode"],
            "body_format": connection["body_format"],
            "has_api_key": connection["has_api_key"],
        },
    }


def build_scorecard_brief(scorecard: Optional[dict]) -> str:
    """Compact text block injected into LLM planning/generation prompts."""
    if not scorecard:
        return ""
    lines = ["Agent scorecard (map screens to this contract):"]
    name = scorecard_display_name(scorecard)
    if name:
        lines.append(f"- Name: {name}")
    runtime_id = scorecard_runtime_id(scorecard)
    if runtime_id:
        lines.append(f"- Runtime agent id: {runtime_id}")
    version = scorecard.get("version")
    if isinstance(version, str) and version.strip():
        lines.append(f"- Version: {version.strip()}")
    capabilities = scorecard.get("capabilities")
    if isinstance(capabilities, list) and capabilities:
        lines.append(
            "- Capabilities: "
            + ", ".join(str(item) for item in capabilities if item is not None)
        )
    intent = scorecard.get("intent")
    if isinstance(intent, dict):
        desc = intent.get("intent_desc")
        if isinstance(desc, str) and desc.strip():
            lines.append(f"- Intent: {desc.strip()}")
        does_not = intent.get("does_not_handle")
        if isinstance(does_not, list) and does_not:
            lines.append(
                "- Does not handle: "
                + "; ".join(str(item) for item in does_not if item)
            )
    fields = scorecard_input_fields(scorecard)
    if fields:
        lines.append("- Required input fields the published UI should collect:")
        for field in fields:
            req = "required" if field["required"] else "optional"
            detail = field["description"] or field["title"]
            lines.append(
                f"  • {field['name']} ({field['type']}, {req}): {detail}"
            )
    connection = scorecard.get("connection")
    if isinstance(connection, dict):
        protocol = connection.get("protocol") or ""
        method = connection.get("method") or ""
        url = connection.get("url") or ""
        has_key = bool(
            connection.get("api_key")
            or connection.get("authorization")
            or connection.get("token")
        )
        lines.append(
            "- Connection (for later runtime submit only; do not invent credentials UI): "
            f"{protocol} {method} {url}".strip()
            + (" · api_key present" if has_key else "")
        )
    output_schema = scorecard.get("output_schema")
    if isinstance(output_schema, dict):
        lines.append(
            "- Agent returns an output_schema after run; do not generate result dashboards."
        )
    return "\n".join(lines)
