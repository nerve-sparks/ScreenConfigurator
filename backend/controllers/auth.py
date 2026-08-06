"""Auth routes — proxy login / refresh / logout to the NerveSparks Auth gateway.

These endpoints are public (see middleware PUBLIC_PATHS). The browser stores
the returned JWT and sends it as Authorization: Bearer on protected routes.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from utils.auth_gateway import gateway_login, gateway_logout, gateway_refresh

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str = Field(min_length=1, max_length=320)
    password: str = Field(min_length=1, max_length=512)
    tenant_id: Optional[str] = Field(default=None, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=4096)


class LogoutRequest(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=4096)
    access_token: Optional[str] = Field(default=None, max_length=8192)


@router.post("/login")
async def login(body: LoginRequest) -> dict[str, Any]:
    """Authenticate with the Auth gateway and return JWT tokens."""
    return await gateway_login(
        email=body.email.strip(),
        password=body.password,
        tenant_id=(body.tenant_id or "").strip() or None,
    )


@router.post("/refresh")
async def refresh(body: RefreshRequest) -> dict[str, Any]:
    """Exchange a refresh token for a new access token via the Auth gateway."""
    return await gateway_refresh(refresh_token=body.refresh_token)


@router.post("/logout")
async def logout(body: LogoutRequest) -> dict[str, str]:
    """Revoke the session at the Auth gateway (best-effort)."""
    try:
        await gateway_logout(
            refresh_token=body.refresh_token,
            access_token=body.access_token,
        )
    except HTTPException:
        # Always acknowledge logout so the client can clear local tokens.
        pass
    return {"status": "ok"}
