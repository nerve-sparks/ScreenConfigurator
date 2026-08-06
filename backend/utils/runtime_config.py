"""Project runtime auth + multi-endpoint catalog.

Splits transport/auth (runtime) from per-endpoint input contracts. Legacy
single-URL scorecards migrate automatically to runtime + endpoints[0].
"""

from __future__ import annotations

import re
from copy import deepcopy
from typing import Any, Optional
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from uuid import uuid4

from .scorecard import (
    _normalize_secret,
    build_run_payload,
    connection_config,
    looks_like_jwt,
    normalize_scorecard,
    scorecard_input_fields,
)

AUTH_TYPES = frozenset({"none", "bearer", "api_key_header", "api_key_query"})
BODY_FORMATS = frozenset({"auto", "json", "multipart"})
ALLOWED_METHODS = frozenset({"POST", "PUT", "PATCH", "GET", "DELETE"})
_ENDPOINT_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
MAX_ENDPOINTS = 20


def _bounded_str(value: Any, *, default: str = "", maximum: int = 500) -> str:
    if not isinstance(value, str):
        return default
    clean = value.strip()
    return clean[:maximum] if clean else default


def _slug_id(value: str, fallback: str = "endpoint") -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if not cleaned or not _ENDPOINT_ID_RE.fullmatch(cleaned):
        return fallback
    return cleaned[:80]


def default_runtime() -> dict:
    return {
        "auth": {
            "type": "bearer",
            "header_name": "Authorization",
            "scheme": "Bearer",
            "query_param": "api_key",
            "secret": "",
        },
        "defaults": {
            "base_url": "",
            "timeout_ms": 30000,
            "body_format": "auto",
        },
    }


def normalize_runtime(raw: Any, *, keep_secret: bool = True) -> dict:
    base = default_runtime()
    if not isinstance(raw, dict):
        return base
    auth_in = raw.get("auth") if isinstance(raw.get("auth"), dict) else {}
    defaults_in = raw.get("defaults") if isinstance(raw.get("defaults"), dict) else {}

    auth_type = _bounded_str(auth_in.get("type"), default="bearer").lower()
    if auth_type not in AUTH_TYPES:
        auth_type = "bearer"

    timeout = defaults_in.get("timeout_ms")
    if not isinstance(timeout, int) or isinstance(timeout, bool) or timeout < 1:
        timeout = 30000
    timeout = min(timeout, 120000)

    body_format = _bounded_str(defaults_in.get("body_format"), default="auto").lower()
    if body_format not in BODY_FORMATS:
        body_format = "auto"

    secret = ""
    if keep_secret:
        secret = _normalize_secret(auth_in.get("secret") or "")
        if not secret:
            # Accept legacy aliases when clients still send them on runtime.
            for key in ("api_key", "authorization", "token"):
                secret = _normalize_secret(auth_in.get(key) or "")
                if secret:
                    break

    return {
        "auth": {
            "type": auth_type,
            "header_name": _bounded_str(
                auth_in.get("header_name"), default="Authorization", maximum=80
            )
            or "Authorization",
            "scheme": _bounded_str(auth_in.get("scheme"), default="Bearer", maximum=40)
            or "Bearer",
            "query_param": _bounded_str(
                auth_in.get("query_param"), default="api_key", maximum=80
            )
            or "api_key",
            "secret": secret,
        },
        "defaults": {
            "base_url": _bounded_str(defaults_in.get("base_url"), maximum=2000),
            "timeout_ms": timeout,
            "body_format": body_format,
        },
    }


def _resolve_body_format(value: Any, url: str, default: str = "auto") -> str:
    raw = _bounded_str(value, default=default).lower()
    if raw in {"multipart/form-data", "multipart", "form-data", "form"}:
        return "multipart"
    if raw in {"application/json", "json"}:
        return "json"
    if raw == "auto" or not raw:
        if "agent-builder.nervesparks.com" in url and "/pipeline" in url:
            return "multipart"
        return "auto" if default == "auto" else default
    return "json"


def normalize_endpoint(raw: Any, *, index: int = 0) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("Each endpoint must be an object.")
    name = _bounded_str(raw.get("name"), default=f"Endpoint {index + 1}", maximum=80)
    endpoint_id = _bounded_str(raw.get("id"), maximum=80)
    if not endpoint_id or not _ENDPOINT_ID_RE.fullmatch(endpoint_id):
        endpoint_id = _slug_id(name, fallback=f"endpoint-{index + 1}")
    url = _bounded_str(raw.get("url"), maximum=2000)
    method = _bounded_str(raw.get("method"), default="POST").upper()
    if method not in ALLOWED_METHODS:
        method = "POST"
    input_schema = raw.get("input_schema")
    if input_schema is not None and not isinstance(input_schema, dict):
        raise ValueError(f"Endpoint '{endpoint_id}' input_schema must be an object.")
    output_schema = raw.get("output_schema")
    if output_schema is not None and not isinstance(output_schema, dict):
        raise ValueError(f"Endpoint '{endpoint_id}' output_schema must be an object.")
    enabled = raw.get("enabled")
    if not isinstance(enabled, bool):
        enabled = True
    body_format = _resolve_body_format(raw.get("body_format"), url, default="auto")
    return {
        "id": endpoint_id,
        "name": name or endpoint_id,
        "url": url,
        "method": method,
        "body_format": body_format,
        "input_schema": deepcopy(input_schema) if isinstance(input_schema, dict) else {},
        "output_schema": (
            deepcopy(output_schema) if isinstance(output_schema, dict) else {}
        ),
        "enabled": enabled,
    }


def normalize_endpoints(raw: Any) -> list[dict]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("endpoints must be a list.")
    if len(raw) > MAX_ENDPOINTS:
        raise ValueError(f"At most {MAX_ENDPOINTS} endpoints are allowed.")
    endpoints: list[dict] = []
    seen: set[str] = set()
    for index, item in enumerate(raw):
        endpoint = normalize_endpoint(item, index=index)
        base_id = endpoint["id"]
        candidate = base_id
        suffix = 2
        while candidate in seen:
            candidate = f"{base_id}-{suffix}"
            suffix += 1
        endpoint["id"] = candidate
        seen.add(candidate)
        endpoints.append(endpoint)
    return endpoints


def migrate_from_scorecard(scorecard: Any) -> tuple[dict, list[dict]]:
    """Derive runtime + endpoints from a legacy scorecard connection."""
    runtime = default_runtime()
    if not scorecard:
        return runtime, []
    try:
        cleaned = normalize_scorecard(scorecard)
    except ValueError:
        cleaned = dict(scorecard) if isinstance(scorecard, dict) else {}
    connection = connection_config(cleaned)
    secret = connection.get("api_key") or connection.get("authorization") or ""
    auth_header = connection.get("auth_header") or "Authorization"
    auth_scheme = connection.get("auth_scheme") or "Bearer"
    auth_mode = (connection.get("auth_mode") or "api_key").lower()

    auth_type = "bearer"
    if auth_mode == "session" and not secret:
        auth_type = "bearer"
    elif auth_header.lower() not in {"authorization", ""} and secret:
        auth_type = "api_key_header"
    elif auth_scheme.lower() in {"", "none", "raw"} and auth_header.lower() != "authorization":
        auth_type = "api_key_header"

    runtime = normalize_runtime(
        {
            "auth": {
                "type": auth_type if secret or auth_type != "none" else "none",
                "header_name": auth_header,
                "scheme": auth_scheme,
                "query_param": "api_key",
                "secret": secret,
            },
            "defaults": {
                "base_url": "",
                "timeout_ms": connection.get("timeout_ms") or 30000,
                "body_format": connection.get("body_format") or "auto",
            },
        }
    )
    if not secret and auth_type != "none":
        # Preserve bearer as default so Studio session JWT fallback still applies.
        runtime["auth"]["type"] = "bearer"

    endpoints: list[dict] = []
    url = connection.get("url") or ""
    if url or cleaned.get("input_schema"):
        name = cleaned.get("name") or cleaned.get("agent_id") or "Primary endpoint"
        endpoints.append(
            normalize_endpoint(
                {
                    "id": _slug_id(str(cleaned.get("agent_id") or "primary"), "primary"),
                    "name": name if isinstance(name, str) else "Primary endpoint",
                    "url": url,
                    "method": connection.get("method") or "POST",
                    "body_format": connection.get("body_format") or "auto",
                    "input_schema": cleaned.get("input_schema") or {},
                    "output_schema": cleaned.get("output_schema") or {},
                    "enabled": True,
                }
            )
        )
    return runtime, endpoints


def scorecard_mirror_from_primary(
    runtime: dict,
    endpoints: list[dict],
    *,
    existing: Optional[dict] = None,
) -> dict:
    """Keep a legacy scorecard for LLM planning prompts."""
    primary = next((item for item in endpoints if item.get("enabled")), None)
    if primary is None and endpoints:
        primary = endpoints[0]
    auth = (runtime or {}).get("auth") or {}
    defaults = (runtime or {}).get("defaults") or {}
    secret = _normalize_secret(auth.get("secret") or "")
    existing_clean: dict = {}
    if existing:
        try:
            existing_clean = normalize_scorecard(existing)
        except ValueError:
            existing_clean = dict(existing) if isinstance(existing, dict) else {}

    if primary is None:
        return existing_clean

    auth_type = auth.get("type") or "bearer"
    connection = {
        "url": primary.get("url") or "",
        "method": primary.get("method") or "POST",
        "protocol": "REST",
        "timeout_ms": defaults.get("timeout_ms") or 30000,
        "auth_header": auth.get("header_name") or "Authorization",
        "auth_scheme": auth.get("scheme") or "Bearer",
        "auth_mode": "api_key",
        "body_format": primary.get("body_format") or defaults.get("body_format") or "json",
    }
    if auth_type == "none":
        connection["auth_mode"] = "session"
    if secret:
        connection["api_key"] = secret
    mirrored = {
        "name": primary.get("name") or existing_clean.get("name") or "",
        "agent_id": existing_clean.get("agent_id") or primary.get("id") or "",
        "node_id": existing_clean.get("node_id") or "",
        "version": existing_clean.get("version") or "",
        "capabilities": existing_clean.get("capabilities") or [],
        "input_schema": deepcopy(primary.get("input_schema") or {}),
        "output_schema": deepcopy(primary.get("output_schema") or {}),
        "connection": connection,
    }
    # Preserve extra scorecard fields that still help planning.
    for key in ("intent", "sla", "metadata", "checkpoints", "error_schema"):
        if key in existing_clean:
            mirrored[key] = existing_clean[key]
    return mirrored


def hydrate_project_config(project: Optional[dict]) -> Optional[dict]:
    """Ensure project has runtime + endpoints (migrating from scorecard if needed)."""
    if not project:
        return project
    result = dict(project)
    scorecard = result.get("scorecard") or {}
    has_runtime = isinstance(result.get("runtime"), dict)
    has_endpoints = isinstance(result.get("endpoints"), list)

    if has_runtime:
        runtime = normalize_runtime(result.get("runtime"), keep_secret=True)
    else:
        runtime, _ = migrate_from_scorecard(scorecard)
    if has_endpoints:
        try:
            endpoints = normalize_endpoints(result.get("endpoints"))
        except ValueError:
            _, endpoints = migrate_from_scorecard(scorecard)
    else:
        _, endpoints = migrate_from_scorecard(scorecard)
        # If scorecard was empty but runtime existed without endpoints, keep [].
        if has_runtime and not endpoints and not (scorecard or {}).get("connection"):
            endpoints = []

    # If both missing and scorecard empty, still expose defaults.
    if not has_runtime and not has_endpoints and not scorecard:
        runtime = default_runtime()
        endpoints = []

    result["runtime"] = runtime
    result["endpoints"] = endpoints
    if not result.get("scorecard") and endpoints:
        result["scorecard"] = scorecard_mirror_from_primary(runtime, endpoints)
    return result


def public_runtime(runtime: Any) -> dict:
    normalized = normalize_runtime(runtime, keep_secret=True)
    secret = normalized["auth"].pop("secret", "")
    normalized["auth"]["has_secret"] = bool(secret)
    return normalized


def public_endpoints(endpoints: Any) -> list[dict]:
    try:
        items = normalize_endpoints(endpoints)
    except ValueError:
        return []
    return items


def resolve_endpoint_url(runtime: dict, endpoint: dict) -> str:
    url = _bounded_str(endpoint.get("url"), maximum=2000)
    if not url:
        return ""
    parsed = urlparse(url)
    if parsed.scheme and parsed.netloc:
        return url
    base = _bounded_str((runtime.get("defaults") or {}).get("base_url"), maximum=2000)
    if not base:
        return url
    return f"{base.rstrip('/')}/{url.lstrip('/')}"


def apply_runtime_auth(
    runtime: dict,
    url: str,
    *,
    caller_authorization: str = "",
) -> tuple[str, dict[str, str]]:
    """Return (url_maybe_with_query, headers) for a request."""
    auth = (runtime or {}).get("auth") or {}
    auth_type = (auth.get("type") or "bearer").lower()
    secret = _normalize_secret(auth.get("secret") or "")
    header_name = auth.get("header_name") or "Authorization"
    scheme = auth.get("scheme") if auth.get("scheme") is not None else "Bearer"
    query_param = auth.get("query_param") or "api_key"
    caller = _normalize_secret(caller_authorization)
    headers: dict[str, str] = {}

    def _bearer(value: str) -> str:
        if not value:
            return ""
        lowered = value.lower()
        if lowered.startswith(("bearer ", "token ")):
            return value
        if scheme:
            return f"{scheme} {value}"
        return value

    def _session() -> str:
        if not caller:
            return ""
        if caller.lower().startswith(("bearer ", "token ")):
            return caller
        return f"Bearer {caller}"

    if auth_type == "none":
        # Still allow Studio session fallback for protected agents.
        session = _session()
        if session:
            headers["Authorization"] = session
        return url, headers

    if auth_type == "api_key_query":
        token = secret or ""
        if not token and caller:
            # Prefer raw token without Bearer for query params.
            token = caller.split(" ", 1)[-1].strip() if " " in caller else caller
        if token:
            parsed = urlparse(url)
            query = dict(parse_qsl(parsed.query, keep_blank_values=True))
            query[query_param] = token
            url = urlunparse(parsed._replace(query=urlencode(query)))
        return url, headers

    if auth_type == "api_key_header":
        token = secret
        if not token:
            session = _session()
            if session:
                headers["Authorization"] = session
            return url, headers
        headers[header_name] = token
        return url, headers

    # bearer (default)
    api_value = _bearer(secret) if secret else ""
    session_value = _session()
    if looks_like_jwt(api_value):
        value = api_value
    elif session_value:
        value = session_value
    else:
        value = api_value
    if value:
        headers[header_name or "Authorization"] = value
    return url, headers


def endpoint_payload(endpoint: dict, values_by_screen: Any) -> dict:
    """Map journey values onto one endpoint's input_schema."""
    card = {"input_schema": endpoint.get("input_schema") or {}}
    return build_run_payload(card, values_by_screen)


def endpoints_input_fields(endpoints: Any) -> list[dict]:
    """Union of input fields across every enabled endpoint (for LLM planning)."""
    try:
        items = normalize_endpoints(endpoints)
    except ValueError:
        items = []
    seen: set[str] = set()
    fields: list[dict] = []
    for endpoint in items:
        if endpoint.get("enabled") is False:
            continue
        label = endpoint.get("name") or endpoint.get("id") or "endpoint"
        for field in scorecard_input_fields(
            {"input_schema": endpoint.get("input_schema") or {}}
        ):
            name = field["name"]
            if name in seen:
                continue
            seen.add(name)
            fields.append({**field, "endpoint": label})
    return fields


def build_endpoints_brief(endpoints: Any) -> str:
    """Compact multi-endpoint contract text for screen plan/generation prompts."""
    try:
        items = normalize_endpoints(endpoints)
    except ValueError:
        items = []
    enabled = [item for item in items if item.get("enabled") is not False]
    if not enabled:
        return ""

    lines = [
        "Project endpoints (map the published journey onto EVERY enabled "
        "endpoint contract below; collect the union of their input fields):",
    ]
    for index, endpoint in enumerate(enabled, start=1):
        name = endpoint.get("name") or endpoint.get("id") or f"Endpoint {index}"
        url = (endpoint.get("url") or "").strip()
        lines.append(f"{index}. {name}" + (f" -> {url}" if url else ""))
        fields = scorecard_input_fields(
            {"input_schema": endpoint.get("input_schema") or {}}
        )
        if not fields:
            lines.append("   - No input_schema fields yet.")
            continue
        lines.append("   - Input fields to collect:")
        for field in fields:
            req = "required" if field["required"] else "optional"
            detail = field["description"] or field["title"]
            lines.append(
                f"     • {field['name']} ({field['type']}, {req}): {detail}"
            )
    return "\n".join(lines)


def new_endpoint_id(name: str = "endpoint") -> str:
    return f"{_slug_id(name, 'endpoint')}-{uuid4().hex[:6]}"
