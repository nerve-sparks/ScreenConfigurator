"""Global JWT auth middleware — all routes protected by default.

Public exceptions (docs/OpenAPI, health, CORS preflight) are listed in
PUBLIC_PATHS below. New API routes inherit protection automatically.
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.status import HTTP_401_UNAUTHORIZED

from utils.jwt_auth import normalize_user_claims, verify_auth_gateway_token

# Intentionally public. Everything else requires a valid Bearer access token.
PUBLIC_PATHS = frozenset(
    {
        "/health",
        "/docs",
        "/redoc",
        "/openapi.json",
        # Auth gateway proxies — return JWTs; must work without a Bearer token.
        "/auth/login",
        "/auth/refresh",
        "/auth/logout",
    }
)

PUBLIC_PREFIXES = (
    "/docs",
    "/redoc",
)


def _is_public_path(path: str) -> bool:
    if path in PUBLIC_PATHS:
        return True
    return any(path.startswith(prefix) for prefix in PUBLIC_PREFIXES)


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        # CORS preflight must not require credentials.
        if request.method == "OPTIONS":
            return await call_next(request)

        if _is_public_path(request.url.path):
            return await call_next(request)

        auth_header = request.headers.get("Authorization")
        if not auth_header:
            return _unauthorized("Authentication required")

        try:
            scheme, token = auth_header.split(" ", 1)
        except ValueError:
            return _unauthorized("Invalid authorization header format")

        if scheme.lower() != "bearer" or not token.strip():
            return _unauthorized("Invalid authentication scheme")

        claims = verify_auth_gateway_token(token.strip())
        if not claims:
            return _unauthorized("Invalid or expired token")

        request.state.user = normalize_user_claims(claims)
        return await call_next(request)


def _unauthorized(detail: str) -> JSONResponse:
    return JSONResponse(
        status_code=HTTP_401_UNAUTHORIZED,
        content={"detail": detail},
        headers={"WWW-Authenticate": "Bearer"},
    )
