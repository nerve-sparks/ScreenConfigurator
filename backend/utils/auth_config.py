"""Auth-gateway settings loaded from environment variables."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

AUTH_GATEWAY_BASE_URL = os.getenv(
    "AUTH_GATEWAY_BASE_URL", "https://auth.nervesparks.com"
).rstrip("/")
AUTH_GATEWAY_PREFIX = os.getenv("AUTH_GATEWAY_PREFIX", "/api/v1/auth")
AUTH_JWKS_URL = os.getenv("AUTH_JWKS_URL", "").strip()

# Match NerveSparks Auth gateway access-token claims (TokenService defaults).
AUTH_JWT_ISSUER = os.getenv("AUTH_JWT_ISSUER", "auth-gateway")
AUTH_JWT_AUDIENCE = os.getenv("AUTH_JWT_AUDIENCE", "auth-gateway-access")
AUTH_JWKS_CACHE_TTL_SECONDS = int(os.getenv("AUTH_JWKS_CACHE_TTL_SECONDS", "300"))


def resolve_jwks_url() -> str:
    if AUTH_JWKS_URL:
        return AUTH_JWKS_URL
    prefix = AUTH_GATEWAY_PREFIX.strip("/")
    return f"{AUTH_GATEWAY_BASE_URL}/{prefix}/.well-known/jwks.json"
