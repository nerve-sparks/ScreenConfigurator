"""FastAPI application entrypoint (MVC wiring).

Models     -> models/
Views/API  -> controllers/
Services   -> services/
Persistence-> utils/db.py, utils/project_db.py
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from pymongo.errors import PyMongoError

from controllers.agents import router as agents_router
from controllers.auth import router as auth_router
from controllers.generation import router as generation_router
from controllers.screens import router as screens_router
from middleware.auth import AuthMiddleware
from utils.db import ensure_indexes
from utils.llm import LLMConfigurationError
from utils.project_db import ensure_project_indexes
from services import common

# Re-export models for existing tests: `from main import GenerateRequest`, etc.
from models.schemas import (  # noqa: F401
    ArchiveScreenRequest,
    CreateAgentProjectRequest,
    DuplicateScreenRequest,
    GenerateProjectScreenRequest,
    GenerateRequest,
    GenerateScreenPlanRequest,
    PublishAgentProjectRequest,
    PublishDraftRequest,
    SaveAgentProjectRequest,
    SaveDraftRequest,
    SaveProjectScreenRequest,
    SaveScreenRequest,
    ScreenPresentation,
    ValidateManifestRequest,
)

logger = logging.getLogger(__name__)

FRONTEND_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
]


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        ensure_indexes()
        ensure_project_indexes()
    except PyMongoError as exc:
        raise RuntimeError(
            f"Could not reach MongoDB at startup ({exc}). Check MONGODB_URI "
            "in backend/.env and make sure MongoDB is running."
        ) from exc
    try:
        target = common._generation_metadata()
        logger.info(
            "LLM generation configured route=%s provider=%s model=%s",
            target["route"],
            target["provider"],
            target["model"],
        )
    except LLMConfigurationError:
        logger.warning(
            "LLM generation configuration is invalid; generation requests "
            "will return a safe configuration error."
        )
    yield


app = FastAPI(title="Agent Screen Generator", lifespan=lifespan)

# Auth is innermost so CORS (added last) remains outermost and can answer
# preflight without a Bearer token. All non-public API routes require JWT.
app.add_middleware(AuthMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe — intentionally public (no JWT)."""
    return {"status": "ok"}


app.include_router(auth_router)
app.include_router(generation_router)
app.include_router(agents_router)
app.include_router(screens_router)


def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(
        title=app.title,
        version=app.version,
        routes=app.routes,
    )
    schema.setdefault("components", {}).setdefault("securitySchemes", {})[
        "BearerAuth"
    ] = {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
        "description": (
            "Access JWT from POST /auth/login or POST /auth/refresh "
            "(proxied through this API to the NerveSparks Auth gateway)."
        ),
    }
    schema["security"] = [{"BearerAuth": []}]
    app.openapi_schema = schema
    return app.openapi_schema


app.openapi = custom_openapi
