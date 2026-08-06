"""JWKS-based verification for NerveSparks Auth gateway JWTs.

Fetches and caches public keys from AUTH_JWKS_URL (or the gateway discovery
path), verifies RS256 signatures, and validates standard access-token claims.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Optional

import httpx
import jwt
from jwt import PyJWK

from utils.auth_config import (
    AUTH_JWT_AUDIENCE,
    AUTH_JWT_ISSUER,
    AUTH_JWKS_CACHE_TTL_SECONDS,
    resolve_jwks_url,
)

logger = logging.getLogger(__name__)

_JWKS_CACHE: dict[str, Any] = {"keys": [], "expires_at": 0.0}
_ACCESS_TOKEN_TYPE = "access"


def _unwrap_jwks_keys(payload: Any) -> list[dict[str, Any]]:
    """Accept plain JWKS or the auth-gateway success envelope."""
    if not isinstance(payload, dict):
        return []
    keys = payload.get("keys")
    if isinstance(keys, list):
        return [key for key in keys if isinstance(key, dict)]
    data = payload.get("data")
    if isinstance(data, dict) and isinstance(data.get("keys"), list):
        return [key for key in data["keys"] if isinstance(key, dict)]
    return []


def _fetch_jwks(*, force_refresh: bool = False) -> list[dict[str, Any]]:
    now = time.time()
    if (
        not force_refresh
        and _JWKS_CACHE["keys"]
        and _JWKS_CACHE["expires_at"] > now
    ):
        return _JWKS_CACHE["keys"]

    url = resolve_jwks_url()
    with httpx.Client(timeout=10.0) as client:
        response = client.get(url)
        response.raise_for_status()
        payload = response.json()

    keys = _unwrap_jwks_keys(payload)
    _JWKS_CACHE["keys"] = keys
    _JWKS_CACHE["expires_at"] = now + AUTH_JWKS_CACHE_TTL_SECONDS
    return keys


def _signing_key_for_kid(kid: str | None) -> Any:
    if not kid:
        return None
    keys = _fetch_jwks()
    jwk = next((key for key in keys if key.get("kid") == kid), None)
    if jwk is None:
        # Key rotation: refresh once on kid miss.
        keys = _fetch_jwks(force_refresh=True)
        jwk = next((key for key in keys if key.get("kid") == kid), None)
    if jwk is None:
        return None
    return PyJWK.from_dict(jwk).key


def verify_auth_gateway_token(token: str) -> Optional[dict[str, Any]]:
    """Validate a gateway access JWT. Returns claims or None on failure."""
    if not token or not isinstance(token, str) or not token.strip():
        return None

    try:
        header = jwt.get_unverified_header(token)
        if header.get("alg") != "RS256":
            return None
        signing_key = _signing_key_for_kid(header.get("kid"))
        if signing_key is None:
            return None

        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            audience=AUTH_JWT_AUDIENCE,
            issuer=AUTH_JWT_ISSUER,
            options={
                "require": ["exp", "iat", "sub", "iss", "aud"],
            },
        )
        if claims.get("type") != _ACCESS_TOKEN_TYPE:
            return None
        return claims
    except (jwt.PyJWTError, httpx.HTTPError, ValueError, TypeError) as exc:
        logger.warning("Auth gateway token verification failed: %s", exc)
        return None


def normalize_user_claims(claims: dict[str, Any]) -> dict[str, Any]:
    """Normalize gateway claims for route handlers."""
    uid = claims.get("sub") or claims.get("uid")
    if uid is not None:
        uid = str(uid)
    return {
        **claims,
        "uid": uid,
        "email": claims.get("email"),
        "display_name": claims.get("display_name"),
        "tenant_id": claims.get("tenant_id"),
        "role": claims.get("role", "user"),
        "agent_admin_list": list(claims.get("agent_admin_list") or []),
    }
