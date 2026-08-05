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
from pymongo.errors import PyMongoError

from controllers.agents import router as agents_router
from controllers.generation import router as generation_router
from controllers.screens import router as screens_router
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
app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(generation_router)
app.include_router(agents_router)
app.include_router(screens_router)
