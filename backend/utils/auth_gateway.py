"""HTTP client that proxies login / refresh / logout to the Auth gateway."""

from __future__ import annotations

from typing import Any, Optional

import httpx
from fastapi import HTTPException

from utils.auth_config import AUTH_GATEWAY_BASE_URL, AUTH_GATEWAY_PREFIX

_TIMEOUT = httpx.Timeout(20.0, connect=5.0)


def _gateway_root() -> str:
    prefix = AUTH_GATEWAY_PREFIX.strip("/")
    return f"{AUTH_GATEWAY_BASE_URL}/{prefix}"


def _unwrap(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    data = payload.get("data")
    if isinstance(data, dict):
        return data
    return payload


def _error_detail(payload: Any, status_code: int) -> str:
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict) and isinstance(error.get("message"), str):
            return error["message"]
        detail = payload.get("detail")
        if isinstance(detail, str) and detail:
            return detail
        message = payload.get("message")
        if isinstance(message, str) and message:
            return message
    return f"Auth gateway request failed with status {status_code}"


def _normalize_auth_payload(payload: Any) -> dict[str, Any]:
    data = _unwrap(payload)
    access_token = data.get("access_token") or data.get("accessToken")
    refresh_token = data.get("refresh_token") or data.get("refreshToken")
    user = data.get("user")
    if user is None and (
        data.get("email") or data.get("uid") or data.get("sub")
    ):
        user = {
            "email": data.get("email"),
            "uid": data.get("uid") or data.get("sub"),
            "display_name": data.get("display_name") or data.get("displayName"),
            "tenant_id": data.get("tenant_id") or data.get("tenantId"),
            "role": data.get("role"),
        }
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "user": user,
        "raw": data,
    }


async def _gateway_post(
    path: str,
    body: dict[str, Any],
    *,
    access_token: Optional[str] = None,
) -> Any:
    headers = {"Content-Type": "application/json"}
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"

    url = f"{_gateway_root()}{path}"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.post(url, json=body, headers=headers)
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not reach auth gateway: {exc}",
        ) from exc

    payload: Any = None
    content_type = response.headers.get("content-type", "")
    if "application/json" in content_type:
        try:
            payload = response.json()
        except ValueError:
            payload = None

    if response.status_code >= 400:
        status = response.status_code
        # Map gateway auth failures to the same status for the browser.
        if status not in (400, 401, 403, 404, 422):
            status = 502 if status >= 500 else status
        raise HTTPException(
            status_code=status,
            detail=_error_detail(payload, response.status_code),
        )

    if response.status_code == 204:
        return None
    return payload


async def gateway_login(
    *,
    email: str,
    password: str,
    tenant_id: Optional[str] = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {"email": email, "password": password}
    if tenant_id:
        body["tenant_id"] = tenant_id

    payload = await _gateway_post("/login", body)
    tokens = _normalize_auth_payload(payload)
    if not tokens.get("access_token"):
        raise HTTPException(
            status_code=502,
            detail="Auth gateway did not return an access token.",
        )
    return {
        "access_token": tokens["access_token"],
        "refresh_token": tokens.get("refresh_token"),
        "user": tokens.get("user") or {"email": email},
    }


async def gateway_refresh(*, refresh_token: str) -> dict[str, Any]:
    payload = await _gateway_post(
        "/refresh",
        {"refresh_token": refresh_token},
    )
    tokens = _normalize_auth_payload(payload)
    if not tokens.get("access_token"):
        raise HTTPException(
            status_code=502,
            detail="Auth gateway did not return an access token.",
        )
    return {
        "access_token": tokens["access_token"],
        "refresh_token": tokens.get("refresh_token") or refresh_token,
        "user": tokens.get("user"),
    }


async def gateway_logout(
    *,
    refresh_token: str,
    access_token: Optional[str] = None,
) -> None:
    body: dict[str, Any] = {"refresh_token": refresh_token}
    if access_token:
        body["access_token"] = access_token
    await _gateway_post("/logout", body, access_token=access_token)
