"""Reusable FastAPI auth dependencies."""

from __future__ import annotations

from typing import Any

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from utils.jwt_auth import normalize_user_claims, verify_auth_gateway_token

bearer_scheme = HTTPBearer(
    auto_error=False,
    scheme_name="BearerAuth",
    description=(
        "Paste the access_token from the NerveSparks Auth gateway "
        "(POST /api/v1/auth/login or /refresh). Do not use the refresh_token."
    ),
)


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict[str, Any]:
    """Return normalized claims for the authenticated caller.

    Prefers ``request.state.user`` set by AuthMiddleware so verification is
    not repeated. Falls back to validating the Authorization header when
    middleware has not run (e.g. unit tests).
    """
    user = getattr(request.state, "user", None)
    if isinstance(user, dict) and user.get("uid"):
        return user

    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    claims = verify_auth_gateway_token(credentials.credentials)
    if not claims:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = normalize_user_claims(claims)
    request.state.user = user
    return user
