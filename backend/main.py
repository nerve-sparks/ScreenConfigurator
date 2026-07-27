"""FastAPI app + routes: the one shared backend.

POST /generate -- plain-text description in, validated manifest out.
Validation is the gate (Step 4): nothing invalid is ever returned.
The backend knows only the manifest contract; it never branches on
any specific agent name or type.
"""

import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError, PyMongoError

from content_manifest import validate_screen_manifest
from frontend_export import FrontendExportError, build_frontend_archive
from db import (
    duplicate_screen,
    ensure_indexes,
    get_draft,
    get_manifest,
    insert_draft,
    list_agents,
    list_versions,
    publish_draft,
    restore_version_as_draft,
    save_draft,
    save_manifest,
    screen_exists,
    set_screen_archived,
    slugify,
)
from llm import (
    SCREEN_PLAN_PROMPT_VERSION,
    PROMPT_VERSION,
    LLMConfigurationError,
    LLMOutputError,
    LLMProviderError,
    LLMTimeoutError,
    gateway_generation_target,
    generate_content_schema,
    generate_schema,
    generate_screen_plan,
)
from manifest_migrations import upgrade_legacy_layout
from project_db import (
    MAX_PROJECT_SCREENS,
    add_screen_to_project,
    create_project,
    duplicate_agent_project,
    duplicate_project_screen,
    ensure_project_indexes,
    get_project,
    get_project_screen_draft,
    get_release,
    insert_project_screen_draft,
    list_project_screens,
    list_projects,
    list_releases,
    project_exists,
    project_screen_exists,
    publish_project_release,
    restore_release,
    save_project,
    save_project_screen_draft,
    set_project_archived,
    set_project_screen_archived,
)
from validation import validate_manifest

logger = logging.getLogger(__name__)

# Vite dev server origins allowed to call this API.
FRONTEND_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
]


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Step 5: ensure the registry's indexes exist before serving. The
    # unique {agent_id, version} index enforces "no duplicate versions",
    # so we fail fast (with a clear message) rather than run without it.
    try:
        ensure_indexes()
        ensure_project_indexes()
    except PyMongoError as exc:
        raise RuntimeError(
            f"Could not reach MongoDB at startup ({exc}). Check MONGODB_URI "
            "in backend/.env and make sure MongoDB is running."
        ) from exc
    try:
        target = _generation_metadata()
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


class GenerateRequest(BaseModel):
    description: str


class ValidateManifestRequest(BaseModel):
    manifest: dict


def _ensure_valid_manifest(manifest: dict, message: str) -> dict:
    """Return a valid manifest or raise the API's standard validation error."""
    ok, errors = validate_manifest(manifest)
    if not ok:
        raise HTTPException(
            status_code=422,
            detail={"message": message, "errors": errors},
        )
    return manifest


@app.post("/generate")
def generate(request: GenerateRequest) -> dict:
    """Turn a plain-text agent description into a manifest."""
    description = request.description.strip()
    if not description:
        raise HTTPException(status_code=422, detail="description must not be empty")

    try:
        manifest = generate_schema(description)
    except LLMConfigurationError as exc:
        logger.error("LLM generation is not configured (%s).", type(exc).__name__)
        raise HTTPException(
            status_code=503,
            detail=(
                "AI generation is not configured. Contact the application "
                "administrator."
            ),
        ) from exc
    except LLMTimeoutError as exc:
        raise HTTPException(
            status_code=504,
            detail="AI generation timed out. Please try again.",
        ) from exc
    except LLMOutputError as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "AI provider returned an invalid screen definition after one "
                "correction attempt. Please try again."
            ),
        ) from exc
    except LLMProviderError as exc:
        raise HTTPException(
            status_code=502,
            detail="AI provider request failed. Please try again.",
        ) from exc
    except Exception as exc:
        logger.error("Unexpected AI generation failure (%s).", type(exc).__name__)
        raise HTTPException(
            status_code=500,
            detail="AI generation failed unexpectedly. Please try again.",
        ) from exc

    # Defense in depth: llm.py already validates and retries once, but the
    # route still refuses an invalid value if generation is mocked or changed.
    return _ensure_valid_manifest(manifest, "Generated manifest failed validation.")


@app.post("/validate")
def validate_screen(request: ValidateManifestRequest) -> dict:
    """Validate a human-reviewed draft before it reaches preview or storage."""
    manifest = upgrade_legacy_layout(request.manifest)
    _ensure_valid_manifest(manifest, "Manifest failed validation.")
    return {"valid": True, "manifest": manifest}


class ScreenPresentation(BaseModel):
    """Human-controlled visual settings stored beside the validated manifest."""

    display_name: str = Field(default="", max_length=80)
    icon: Literal["sparkles", "bolt", "compass", "message"] = "sparkles"
    accent_color: str = Field(default="#635bff", pattern=r"^#[0-9a-fA-F]{6}$")
    welcome_title: str = Field(default="Let's get started", max_length=100)
    welcome_description: str = Field(
        default="Provide the details below so the agent can do its best work.",
        max_length=240,
    )
    submit_label: str = Field(default="Submit", min_length=1, max_length=40)
    show_summary: bool = True


class SaveScreenRequest(BaseModel):
    manifest: dict
    description: str = ""
    name: str = ""
    source: Literal["llm", "manual"] = "llm"
    presentation: ScreenPresentation = Field(default_factory=ScreenPresentation)


class SaveDraftRequest(BaseModel):
    """Editor state only; preview submissions are intentionally not accepted."""

    manifest: dict
    approved_manifest: Optional[dict] = None
    description: str = Field(default="", max_length=5000)
    name: str = Field(default="", max_length=80)
    source: Literal["llm", "manual"] = "llm"
    presentation: ScreenPresentation = Field(default_factory=ScreenPresentation)
    editor_state: dict = Field(default_factory=dict)


class PublishDraftRequest(BaseModel):
    draft_revision: str = Field(min_length=1, max_length=64)
    change_summary: str = Field(min_length=1, max_length=240)


class DuplicateScreenRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class ArchiveScreenRequest(BaseModel):
    archived: bool


class CreateAgentProjectRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=5000)
    presentation: ScreenPresentation = Field(default_factory=ScreenPresentation)


class SaveAgentProjectRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=5000)
    presentation: ScreenPresentation = Field(default_factory=ScreenPresentation)
    screen_ids: list[str] = Field(max_length=MAX_PROJECT_SCREENS)
    start_screen_id: Optional[str] = None
    revision: str = Field(min_length=1, max_length=64)


class GenerateScreenPlanRequest(BaseModel):
    description: str = Field(default="", max_length=5000)


class GenerateProjectScreenRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    screen_id: Optional[str] = None
    screen_type: Literal["form", "content"]
    purpose: Literal["intake", "settings", "information", "confirmation"]
    description: str = Field(min_length=1, max_length=5000)


class SaveProjectScreenRequest(BaseModel):
    screen_type: Literal["form", "content"]
    purpose: Literal["intake", "settings", "information", "confirmation"]
    manifest: dict
    approved_manifest: Optional[dict] = None
    description: str = Field(default="", max_length=5000)
    name: str = Field(min_length=1, max_length=80)
    source: Literal["llm", "manual"] = "llm"
    presentation: ScreenPresentation = Field(default_factory=ScreenPresentation)
    editor_state: dict = Field(default_factory=dict)
    generation: dict = Field(default_factory=dict)


class PublishAgentProjectRequest(BaseModel):
    project_revision: str = Field(min_length=1, max_length=64)
    screen_revisions: dict[str, str]
    change_summary: str = Field(min_length=1, max_length=240)


def _validated_agent_id(agent_id: str) -> str:
    normalized = slugify(agent_id)
    if not normalized or normalized != agent_id:
        raise HTTPException(
            status_code=422,
            detail="agent_id must be a lowercase kebab-case identifier.",
        )
    return normalized


def _generation_metadata() -> dict:
    """Return safe provenance only -- never gateway keys or model reasoning."""
    gateway_enabled = os.getenv("LITE_LLM_ENABLE", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if gateway_enabled:
        target = gateway_generation_target()
        provider = target["provider"]
        model = target["model"]
        route = target["route"]
    else:
        model = os.getenv("MODEL", "").strip()
        provider = model.split("/", 1)[0] if "/" in model else "litellm"
        route = "direct_provider"
    return {
        "route": route,
        "provider": provider,
        "model": model,
        "prompt_version": PROMPT_VERSION,
    }


def _validated_screen_id(screen_id: str) -> str:
    normalized = slugify(screen_id)
    if not normalized or normalized != screen_id:
        raise HTTPException(
            status_code=422,
            detail="screen_id must be a lowercase kebab-case identifier.",
        )
    return normalized


def _validate_screen_purpose(screen_type: str, purpose: str) -> None:
    allowed = (
        {"intake", "settings"}
        if screen_type == "form"
        else {"information", "confirmation"}
    )
    if purpose not in allowed:
        raise HTTPException(
            status_code=422,
            detail=f"purpose '{purpose}' is not valid for {screen_type} screens.",
        )


def _prepared_screen_manifest(screen_type: str, manifest: dict) -> dict:
    prepared = upgrade_legacy_layout(manifest) if screen_type == "form" else manifest
    valid, errors = validate_screen_manifest(screen_type, prepared)
    if not valid:
        raise HTTPException(
            status_code=422,
            detail={"message": "Screen manifest failed validation.", "errors": errors},
        )
    return prepared


def _raise_generation_http_error(exc: Exception) -> None:
    if isinstance(exc, LLMConfigurationError):
        raise HTTPException(
            status_code=503,
            detail=(
                "AI generation is not configured. Contact the application "
                "administrator."
            ),
        ) from exc
    if isinstance(exc, LLMTimeoutError):
        raise HTTPException(
            status_code=504,
            detail="AI generation timed out. Please try again.",
        ) from exc
    if isinstance(exc, LLMOutputError):
        raise HTTPException(
            status_code=502,
            detail=(
                "AI provider returned an invalid definition after one correction "
                "attempt. Please try again."
            ),
        ) from exc
    if isinstance(exc, LLMProviderError):
        raise HTTPException(
            status_code=502,
            detail="AI provider request failed. Please try again.",
        ) from exc
    raise HTTPException(
        status_code=500,
        detail="AI generation failed unexpectedly. Please try again.",
    ) from exc


def _project_payload(project: dict) -> dict:
    screens = list_project_screens(project["agent_id"], include_archived=True)
    summaries = []
    for screen in screens:
        summaries.append(
            {
                key: screen.get(key)
                for key in (
                    "agent_id",
                    "screen_id",
                    "screen_type",
                    "purpose",
                    "name",
                    "description",
                    "presentation",
                    "revision",
                    "validation_errors",
                    "is_archived",
                    "created_at",
                    "updated_at",
                )
            }
            | {"approved": screen.get("approved_manifest") is not None}
        )
    payload = dict(project)
    payload["screens"] = summaries
    payload["release_count"] = len(list_releases(project["agent_id"]))
    return payload


@app.post("/agents", status_code=201)
def create_agent_project(request: CreateAgentProjectRequest) -> dict:
    name = request.name.strip()
    agent_id = slugify(name)
    if not agent_id:
        raise HTTPException(status_code=422, detail="name must contain letters or digits")
    try:
        if project_exists(agent_id):
            raise HTTPException(
                status_code=409,
                detail=f"An agent project with ID '{agent_id}' already exists.",
            )
        project = create_project(
            agent_id,
            name,
            request.description.strip(),
            request.presentation.model_dump(),
        )
    except HTTPException:
        raise
    except DuplicateKeyError as exc:
        raise HTTPException(
            status_code=409,
            detail=f"An agent project with ID '{agent_id}' already exists.",
        ) from exc
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    return _project_payload(project)


@app.get("/agents")
def get_agent_projects() -> dict:
    try:
        return {"agents": list_projects()}
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc


@app.get("/agents/{agent_id}")
def get_agent_project(agent_id: str) -> dict:
    agent_id = _validated_agent_id(agent_id)
    try:
        project = get_project(agent_id)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    if project is None:
        raise HTTPException(
            status_code=404,
            detail=f"No agent project found for '{agent_id}'.",
        )
    return _project_payload(project)


@app.put("/agents/{agent_id}/draft")
def put_agent_project_draft(
    agent_id: str, request: SaveAgentProjectRequest
) -> dict:
    agent_id = _validated_agent_id(agent_id)
    screen_ids = [_validated_screen_id(value) for value in request.screen_ids]
    if len(screen_ids) != len(set(screen_ids)):
        raise HTTPException(status_code=422, detail="screen_ids must be unique.")
    if screen_ids and request.start_screen_id not in screen_ids:
        raise HTTPException(
            status_code=422,
            detail="start_screen_id must name one active screen.",
        )
    if not screen_ids and request.start_screen_id is not None:
        raise HTTPException(
            status_code=422,
            detail="start_screen_id must be null when the project has no screens.",
        )
    try:
        current = get_project(agent_id)
        if current is None:
            raise HTTPException(
                status_code=404,
                detail=f"No agent project found for '{agent_id}'.",
            )
        if set(screen_ids) != set(current.get("screen_ids", [])):
            raise HTTPException(
                status_code=422,
                detail=(
                    "screen_ids may reorder active screens but cannot add or remove "
                    "them. Use the screen create or archive APIs."
                ),
            )
        project = save_project(
            agent_id,
            name=request.name.strip(),
            description=request.description.strip(),
            presentation=request.presentation.model_dump(),
            screen_ids=screen_ids,
            start_screen_id=request.start_screen_id,
            expected_revision=request.revision,
        )
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    if project is None:
        raise HTTPException(
            status_code=409,
            detail="The agent project changed. Reload it before saving again.",
        )
    return _project_payload(project)


@app.post("/agents/{agent_id}/screen-plan/generate")
def generate_agent_screen_plan(
    agent_id: str, request: GenerateScreenPlanRequest
) -> dict:
    agent_id = _validated_agent_id(agent_id)
    try:
        project = get_project(agent_id)
        if project is None:
            raise HTTPException(
                status_code=404,
                detail=f"No agent project found for '{agent_id}'.",
            )
        description = request.description.strip() or project.get("description", "").strip()
        if not description:
            raise HTTPException(
                status_code=422,
                detail="An agent description is required to generate a screen plan.",
            )
        existing = list_project_screens(agent_id, include_archived=False)
        plan = generate_screen_plan(description, existing)
    except HTTPException:
        raise
    except (LLMConfigurationError, LLMTimeoutError, LLMOutputError, LLMProviderError) as exc:
        _raise_generation_http_error(exc)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    except Exception as exc:
        logger.error("Unexpected screen-plan failure (%s).", type(exc).__name__)
        _raise_generation_http_error(exc)
    return {
        **plan,
        "generation": _generation_metadata()
        | {"prompt_version": SCREEN_PLAN_PROMPT_VERSION},
    }


@app.post("/agents/{agent_id}/screens/generate")
def generate_agent_project_screen(
    agent_id: str, request: GenerateProjectScreenRequest
) -> dict:
    agent_id = _validated_agent_id(agent_id)
    _validate_screen_purpose(request.screen_type, request.purpose)
    screen_id = (
        _validated_screen_id(request.screen_id)
        if request.screen_id is not None
        else slugify(request.name.strip())
    )
    if not screen_id:
        raise HTTPException(status_code=422, detail="name must contain letters or digits")
    try:
        project = get_project(agent_id)
        if project is None:
            raise HTTPException(
                status_code=404,
                detail=f"No agent project found for '{agent_id}'.",
            )
        if request.screen_id is None and project_screen_exists(agent_id, screen_id):
            raise HTTPException(
                status_code=409,
                detail=f"A screen with ID '{screen_id}' already exists in this agent.",
            )
        existing = list_project_screens(agent_id, include_archived=False)
        existing_context = "; ".join(
            f"{item.get('name', item['screen_id'])}: {item.get('description', '')}"
            for item in existing
        )
        brief = (
            f"Agent: {project['name']}\n"
            f"Agent description: {project.get('description', '')}\n"
            f"Screen name: {request.name.strip()}\n"
            f"Screen purpose: {request.purpose}\n"
            f"Screen description: {request.description.strip()}\n"
            f"Existing screens to avoid duplicating: {existing_context or 'none'}"
        )
        manifest = (
            generate_schema(brief)
            if request.screen_type == "form"
            else generate_content_schema(brief)
        )
    except HTTPException:
        raise
    except (LLMConfigurationError, LLMTimeoutError, LLMOutputError, LLMProviderError) as exc:
        _raise_generation_http_error(exc)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    except Exception as exc:
        logger.error("Unexpected screen generation failure (%s).", type(exc).__name__)
        _raise_generation_http_error(exc)
    return {
        "screen_id": screen_id,
        "screen_type": request.screen_type,
        "purpose": request.purpose,
        "manifest": manifest,
        "generation": _generation_metadata(),
    }


def _persist_project_screen(
    agent_id: str,
    screen_id: str,
    request: SaveProjectScreenRequest,
    *,
    create: bool,
) -> dict:
    _validate_screen_purpose(request.screen_type, request.purpose)
    manifest = _prepared_screen_manifest(request.screen_type, request.manifest)
    approved = None
    if request.approved_manifest is not None:
        approved = _prepared_screen_manifest(
            request.screen_type, request.approved_manifest
        )
    kwargs = {
        "agent_id": agent_id,
        "screen_id": screen_id,
        "manifest": manifest,
        "approved_manifest": approved,
        "name": request.name.strip(),
        "description": request.description.strip(),
        "source": request.source,
        "presentation": request.presentation.model_dump(),
        "editor_state": request.editor_state,
        "generation": request.generation,
        "validation_errors": [],
    }
    if create:
        return insert_project_screen_draft(
            screen_type=request.screen_type,
            purpose=request.purpose,
            **kwargs,
        )
    current = get_project_screen_draft(agent_id, screen_id)
    if current is None:
        raise HTTPException(
            status_code=404,
            detail=f"No screen draft found for '{screen_id}'.",
        )
    if current.get("screen_type", "form") != request.screen_type:
        raise HTTPException(
            status_code=422,
            detail="screen_type cannot be changed after screen creation.",
        )
    if current.get("purpose", "intake") != request.purpose:
        raise HTTPException(
            status_code=422,
            detail="purpose cannot be changed after screen creation.",
        )
    return save_project_screen_draft(**kwargs) or {}


@app.post("/agents/{agent_id}/screens/{screen_id}/draft", status_code=201)
def create_agent_project_screen_draft(
    agent_id: str, screen_id: str, request: SaveProjectScreenRequest
) -> dict:
    agent_id = _validated_agent_id(agent_id)
    screen_id = _validated_screen_id(screen_id)
    if slugify(request.name.strip()) != screen_id:
        raise HTTPException(
            status_code=422,
            detail="screen_id must be derived from the supplied screen name.",
        )
    try:
        if not project_exists(agent_id):
            raise HTTPException(
                status_code=404,
                detail=f"No agent project found for '{agent_id}'.",
            )
        return _persist_project_screen(agent_id, screen_id, request, create=True)
    except HTTPException:
        raise
    except (DuplicateKeyError, ValueError) as exc:
        status = 409 if isinstance(exc, DuplicateKeyError) else 422
        raise HTTPException(status_code=status, detail=str(exc)) from exc
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc


@app.put("/agents/{agent_id}/screens/{screen_id}/draft")
def put_agent_project_screen_draft(
    agent_id: str, screen_id: str, request: SaveProjectScreenRequest
) -> dict:
    agent_id = _validated_agent_id(agent_id)
    screen_id = _validated_screen_id(screen_id)
    try:
        draft = _persist_project_screen(agent_id, screen_id, request, create=False)
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    return draft


@app.get("/agents/{agent_id}/screens/{screen_id}/draft")
def get_agent_project_screen_draft(agent_id: str, screen_id: str) -> dict:
    agent_id = _validated_agent_id(agent_id)
    screen_id = _validated_screen_id(screen_id)
    try:
        draft = get_project_screen_draft(agent_id, screen_id)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    if draft is None:
        raise HTTPException(
            status_code=404,
            detail=f"No screen draft found for '{screen_id}'.",
        )
    if draft.get("screen_type", "form") == "form":
        draft["draft_manifest"] = upgrade_legacy_layout(draft["draft_manifest"])
        if draft.get("approved_manifest"):
            draft["approved_manifest"] = upgrade_legacy_layout(
                draft["approved_manifest"]
            )
    return draft


@app.post(
    "/agents/{agent_id}/screens/{screen_id}/duplicate",
    status_code=201,
)
def duplicate_agent_project_screen(
    agent_id: str,
    screen_id: str,
    request: DuplicateScreenRequest,
) -> dict:
    agent_id = _validated_agent_id(agent_id)
    screen_id = _validated_screen_id(screen_id)
    name = request.name.strip()
    target_screen_id = slugify(name)
    if not target_screen_id:
        raise HTTPException(status_code=422, detail="name must contain letters or digits")
    try:
        if project_screen_exists(agent_id, target_screen_id):
            raise HTTPException(
                status_code=409,
                detail=f"A screen with ID '{target_screen_id}' already exists.",
            )
        draft = duplicate_project_screen(
            agent_id, screen_id, target_screen_id, name
        )
    except HTTPException:
        raise
    except (DuplicateKeyError, ValueError) as exc:
        status = 409 if isinstance(exc, DuplicateKeyError) else 422
        raise HTTPException(status_code=status, detail=str(exc)) from exc
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    if not draft:
        raise HTTPException(
            status_code=404,
            detail=f"No screen draft found for '{screen_id}'.",
        )
    return draft


@app.patch("/agents/{agent_id}/screens/{screen_id}/archive")
def archive_agent_project_screen(
    agent_id: str, screen_id: str, request: ArchiveScreenRequest
) -> dict:
    agent_id = _validated_agent_id(agent_id)
    screen_id = _validated_screen_id(screen_id)
    try:
        draft = set_project_screen_archived(agent_id, screen_id, request.archived)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    if draft is None:
        raise HTTPException(
            status_code=404,
            detail=f"No screen draft found for '{screen_id}'.",
        )
    return {
        "agent_id": agent_id,
        "screen_id": screen_id,
        "is_archived": bool(draft.get("is_archived")),
    }


@app.post("/agents/{agent_id}/publish")
def publish_agent_project(
    agent_id: str, request: PublishAgentProjectRequest
) -> dict:
    agent_id = _validated_agent_id(agent_id)
    summary = request.change_summary.strip()
    if not summary:
        raise HTTPException(status_code=422, detail="change_summary must not be empty")
    try:
        project = get_project(agent_id)
        if project is None:
            raise HTTPException(
                status_code=404,
                detail=f"No agent project found for '{agent_id}'.",
            )
        if project["revision"] != request.project_revision:
            raise HTTPException(
                status_code=409,
                detail="The agent project changed after preview. Reload and try again.",
            )
        screen_ids = list(project.get("screen_ids", []))
        if not screen_ids:
            raise HTTPException(
                status_code=422,
                detail="An agent release must contain at least one active screen.",
            )
        if len(screen_ids) != len(set(screen_ids)):
            raise HTTPException(
                status_code=422,
                detail="The project screen order contains duplicate screen IDs.",
            )
        if project.get("start_screen_id") not in screen_ids:
            raise HTTPException(
                status_code=422,
                detail="The project start screen is missing or inactive.",
            )
        if set(request.screen_revisions) != set(screen_ids):
            raise HTTPException(
                status_code=422,
                detail="screen_revisions must contain every active screen exactly once.",
            )
        screens = []
        for screen_id in screen_ids:
            screen = get_project_screen_draft(agent_id, screen_id)
            if screen is None or screen.get("is_archived"):
                raise HTTPException(
                    status_code=422,
                    detail=f"Active screen '{screen_id}' has no usable draft.",
                )
            if screen["revision"] != request.screen_revisions[screen_id]:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Screen '{screen_id}' changed after preview. Reload and "
                        "try again."
                    ),
                )
            approved = screen.get("approved_manifest")
            if approved is None:
                raise HTTPException(
                    status_code=422,
                    detail=f"Screen '{screen_id}' has not been approved.",
                )
            _prepared_screen_manifest(
                screen.get("screen_type", "form"), approved
            )
            screens.append(screen)
        release = publish_project_release(
            project=project,
            screens=screens,
            change_summary=summary,
        )
    except HTTPException:
        raise
    except (PyMongoError, RuntimeError) as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    return {
        "agent_id": agent_id,
        "version": release["version"],
        "status": "published",
    }


@app.get("/agents/{agent_id}/releases")
def get_agent_releases(agent_id: str) -> dict:
    agent_id = _validated_agent_id(agent_id)
    try:
        if not project_exists(agent_id):
            raise HTTPException(
                status_code=404,
                detail=f"No agent project found for '{agent_id}'.",
            )
        releases = list_releases(agent_id)
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    return {"agent_id": agent_id, "releases": releases}


@app.get("/agents/{agent_id}/releases/{version}")
def get_agent_release(agent_id: str, version: int) -> dict:
    agent_id = _validated_agent_id(agent_id)
    if version < 1:
        raise HTTPException(status_code=422, detail="version must be at least 1")
    try:
        release = get_release(agent_id, version)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    if release is None:
        raise HTTPException(
            status_code=404,
            detail=f"Release {version} was not found for '{agent_id}'.",
        )
    return release


@app.get("/agents/{agent_id}/releases/{version}/export")
def export_agent_release_frontend(agent_id: str, version: int) -> Response:
    """Download one exact immutable release as a standalone frontend."""
    agent_id = _validated_agent_id(agent_id)
    if version < 1:
        raise HTTPException(status_code=422, detail="version must be at least 1")

    try:
        release = get_release(agent_id, version)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    if release is None:
        raise HTTPException(
            status_code=404,
            detail=f"Release {version} was not found for '{agent_id}'.",
        )
    if release.get("agent_id") != agent_id or release.get("version") != version:
        logger.error(
            "Release lookup returned mismatched identity agent_id=%s version=%s",
            agent_id,
            version,
        )
        raise HTTPException(
            status_code=500,
            detail="Frontend export is unavailable for this release.",
        )

    started_at = time.monotonic()
    try:
        archive, filename = build_frontend_archive(release)
    except FrontendExportError as exc:
        logger.exception(
            "Frontend export failed agent_id=%s version=%s reason=%s",
            agent_id,
            version,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=500,
            detail="Frontend export is unavailable for this release.",
        ) from exc
    except Exception as exc:
        logger.exception(
            "Unexpected frontend export failure agent_id=%s version=%s",
            agent_id,
            version,
        )
        raise HTTPException(
            status_code=500,
            detail="Frontend export is unavailable for this release.",
        ) from exc

    logger.info(
        "Frontend export prepared agent_id=%s version=%s bytes=%s duration_ms=%s",
        agent_id,
        version,
        len(archive),
        round((time.monotonic() - started_at) * 1000),
    )
    return Response(
        content=archive,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@app.get("/agents/{agent_id}/published")
def get_published_agent_release(
    agent_id: str, version: Optional[int] = None
) -> dict:
    agent_id = _validated_agent_id(agent_id)
    try:
        release = get_release(agent_id, version)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    if release is None:
        raise HTTPException(
            status_code=404,
            detail=f"No published agent release found for '{agent_id}'.",
        )
    return release


@app.post("/agents/{agent_id}/releases/{version}/restore")
def restore_agent_release(agent_id: str, version: int) -> dict:
    agent_id = _validated_agent_id(agent_id)
    if version < 1:
        raise HTTPException(status_code=422, detail="version must be at least 1")
    try:
        project = restore_release(agent_id, version)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    if project is None:
        raise HTTPException(
            status_code=404,
            detail=f"Release {version} was not found for '{agent_id}'.",
        )
    return _project_payload(project)


@app.patch("/agents/{agent_id}/archive")
def archive_agent_project(
    agent_id: str, request: ArchiveScreenRequest
) -> dict:
    agent_id = _validated_agent_id(agent_id)
    try:
        project = set_project_archived(agent_id, request.archived)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    if project is None:
        raise HTTPException(
            status_code=404,
            detail=f"No agent project found for '{agent_id}'.",
        )
    return {
        "agent_id": agent_id,
        "is_archived": bool(project.get("is_archived")),
        "archived_at": project.get("archived_at"),
    }


@app.post("/agents/{agent_id}/duplicate", status_code=201)
def duplicate_saved_agent_project(
    agent_id: str, request: DuplicateScreenRequest
) -> dict:
    agent_id = _validated_agent_id(agent_id)
    name = request.name.strip()
    target_agent_id = slugify(name)
    if not target_agent_id:
        raise HTTPException(status_code=422, detail="name must contain letters or digits")
    try:
        project = duplicate_agent_project(agent_id, target_agent_id, name)
    except DuplicateKeyError as exc:
        raise HTTPException(
            status_code=409,
            detail=f"An agent project with ID '{target_agent_id}' already exists.",
        ) from exc
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    if not project:
        raise HTTPException(
            status_code=404,
            detail=f"No agent project found for '{agent_id}'.",
        )
    return _project_payload(project)


@app.post("/screens")
def save_screen(request: SaveScreenRequest) -> dict:
    """Legacy direct-publish endpoint.

    Step 7 clients use the draft and publish endpoints below. This route is
    retained so older clients continue to work and still cannot store an
    invalid manifest.
    """
    manifest = upgrade_legacy_layout(request.manifest)
    _ensure_valid_manifest(manifest, "Manifest failed validation.")

    agent_id = slugify(request.name) or slugify(request.description)
    if not agent_id:
        raise HTTPException(
            status_code=422,
            detail="Could not derive an agent_id: provide a short name or a description.",
        )

    try:
        version = save_manifest(
            agent_id,
            manifest,
            request.description,
            request.source,
            request.presentation.model_dump(),
        )
    except (PyMongoError, RuntimeError) as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc

    return {"agent_id": agent_id, "version": version}


def _persist_screen_draft(
    agent_id: str,
    request: SaveDraftRequest,
    *,
    create: bool = False,
) -> dict:
    """Validate and persist draft contents for both create and update routes."""
    manifest = upgrade_legacy_layout(request.manifest)
    valid, validation_errors = validate_manifest(manifest)

    approved_manifest = None
    if request.approved_manifest is not None:
        approved_manifest = upgrade_legacy_layout(request.approved_manifest)
        _ensure_valid_manifest(
            approved_manifest,
            "Approved manifest failed validation and cannot be published.",
        )

    try:
        persist = insert_draft if create else save_draft
        document = persist(
            agent_id=agent_id,
            draft_manifest=manifest,
            description=request.description.strip(),
            name=request.name.strip() or request.presentation.display_name or agent_id,
            source=request.source,
            presentation=request.presentation.model_dump(),
            editor_state=request.editor_state,
            validation_errors=[] if valid else validation_errors,
            approved_manifest=approved_manifest,
            generation=_generation_metadata(),
        )
    except DuplicateKeyError as exc:
        raise HTTPException(
            status_code=409,
            detail=(
                f"A screen with agent_id '{agent_id}' already exists. "
                "Choose a different agent name or open the existing screen."
            ),
        ) from exc
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc

    return document


@app.post("/screens/{agent_id}/draft", status_code=201)
def create_screen_draft(agent_id: str, request: SaveDraftRequest) -> dict:
    """Create the first draft without overwriting an existing screen identity."""
    agent_id = _validated_agent_id(agent_id)
    name = request.name.strip()
    if not name:
        raise HTTPException(
            status_code=422,
            detail="name is required when creating a screen draft.",
        )
    if slugify(name) != agent_id:
        raise HTTPException(
            status_code=422,
            detail="agent_id must be derived from the supplied screen name.",
        )
    try:
        already_exists = screen_exists(agent_id)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    if already_exists:
        raise HTTPException(
            status_code=409,
            detail=(
                f"A screen with agent_id '{agent_id}' already exists. "
                "Choose a different agent name or open the existing screen."
            ),
        )
    return _persist_screen_draft(agent_id, request, create=True)


@app.put("/screens/{agent_id}/draft")
def put_screen_draft(agent_id: str, request: SaveDraftRequest) -> dict:
    """Autosave an existing mutable draft without creating a version."""
    agent_id = _validated_agent_id(agent_id)
    try:
        already_exists = screen_exists(agent_id)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    if not already_exists:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No screen found for agent_id '{agent_id}'. "
                "Create its first draft with POST before updating it."
            ),
        )
    return _persist_screen_draft(agent_id, request)


@app.get("/screens/{agent_id}/draft")
def get_screen_draft(agent_id: str) -> dict:
    """Load the mutable editor state; no LLM call is involved."""
    agent_id = _validated_agent_id(agent_id)
    try:
        document = get_draft(agent_id)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc

    if document is None:
        raise HTTPException(
            status_code=404,
            detail=f"No working draft found for agent_id '{agent_id}'.",
        )
    document["draft_manifest"] = upgrade_legacy_layout(document["draft_manifest"])
    if document.get("approved_manifest"):
        document["approved_manifest"] = upgrade_legacy_layout(
            document["approved_manifest"]
        )
    return document


@app.post("/screens/{agent_id}/publish")
def publish_screen_draft(agent_id: str, request: PublishDraftRequest) -> dict:
    """Create one immutable version from the current validated draft."""
    agent_id = _validated_agent_id(agent_id)
    change_summary = request.change_summary.strip()
    if not change_summary:
        raise HTTPException(status_code=422, detail="change_summary must not be empty")
    try:
        draft = get_draft(agent_id)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc

    if draft is None:
        raise HTTPException(
            status_code=404,
            detail=f"No working draft found for agent_id '{agent_id}'.",
        )
    if draft.get("revision") != request.draft_revision:
        raise HTTPException(
            status_code=409,
            detail=(
                "This draft changed after preview was opened. Return to the builder, "
                "validate the latest draft, and try again."
            ),
        )

    manifest = draft.get("approved_manifest")
    if not manifest:
        raise HTTPException(
            status_code=422,
            detail=(
                "This draft has no approved manifest. Complete human review and "
                "validation before publishing."
            ),
        )
    manifest = upgrade_legacy_layout(manifest)
    _ensure_valid_manifest(manifest, "Invalid drafts cannot be published.")

    try:
        version = publish_draft(
            agent_id,
            draft,
            manifest,
            change_summary,
        )
    except (PyMongoError, RuntimeError) as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc

    return {
        "agent_id": agent_id,
        "version": version,
        "status": "published",
    }


@app.get("/screens")
def list_screens() -> dict:
    """Return published and draft-only screens for the library."""
    try:
        screens = list_agents()
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    return {"screens": screens}


@app.get("/screens/{agent_id}/versions")
def get_screen_versions(agent_id: str) -> dict:
    """Return published-version history without loading full manifests."""
    agent_id = _validated_agent_id(agent_id)
    try:
        exists = screen_exists(agent_id)
        versions = list_versions(agent_id) if exists else []
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    if not exists:
        raise HTTPException(
            status_code=404,
            detail=f"No screen found for agent_id '{agent_id}'.",
        )
    return {"agent_id": agent_id, "versions": versions}


@app.post("/screens/{agent_id}/duplicate", status_code=201)
def duplicate_saved_screen(
    agent_id: str, request: DuplicateScreenRequest
) -> dict:
    """Create a new draft from the source's latest draft or published version."""
    agent_id = _validated_agent_id(agent_id)
    name = request.name.strip()
    target_agent_id = slugify(name)
    if not target_agent_id:
        raise HTTPException(status_code=422, detail="name must contain letters or digits")
    try:
        if not screen_exists(agent_id):
            raise HTTPException(
                status_code=404,
                detail=f"No screen found for agent_id '{agent_id}'.",
            )
        if screen_exists(target_agent_id):
            raise HTTPException(
                status_code=409,
                detail=f"A screen with agent_id '{target_agent_id}' already exists.",
            )
        draft = duplicate_screen(agent_id, target_agent_id, name)
    except HTTPException:
        raise
    except DuplicateKeyError as exc:
        raise HTTPException(
            status_code=409,
            detail=f"A screen with agent_id '{target_agent_id}' already exists.",
        ) from exc
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc

    if not draft:
        raise HTTPException(
            status_code=404,
            detail=f"No screen found for agent_id '{agent_id}'.",
        )
    return {
        "agent_id": target_agent_id,
        "status": "draft",
        "revision": draft.get("revision"),
        "duplicated_from": agent_id,
    }


@app.post("/screens/{agent_id}/versions/{version}/restore")
def restore_screen_version(agent_id: str, version: int) -> dict:
    """Restore an immutable version by copying it into the working draft."""
    agent_id = _validated_agent_id(agent_id)
    if version < 1:
        raise HTTPException(status_code=422, detail="version must be at least 1")
    try:
        draft = restore_version_as_draft(agent_id, version)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    if draft is None:
        raise HTTPException(
            status_code=404,
            detail=f"Version {version} was not found for agent_id '{agent_id}'.",
        )
    return {
        "agent_id": agent_id,
        "status": "draft",
        "revision": draft.get("revision"),
        "restored_from_version": version,
    }


@app.patch("/screens/{agent_id}/archive")
def archive_saved_screen(agent_id: str, request: ArchiveScreenRequest) -> dict:
    """Soft-archive or unarchive a screen without deleting any versions."""
    agent_id = _validated_agent_id(agent_id)
    try:
        metadata = set_screen_archived(agent_id, request.archived)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    if metadata is None:
        raise HTTPException(
            status_code=404,
            detail=f"No screen found for agent_id '{agent_id}'.",
        )
    return {
        "agent_id": agent_id,
        "is_archived": bool(metadata.get("is_archived")),
        "archived_at": metadata.get("archived_at"),
    }


@app.get("/screens/{agent_id}")
def get_screen(agent_id: str, version: Optional[int] = None) -> dict:
    """Return a saved screen document -- the latest version unless one is
    given. No LLM involved: reloading a saved screen never calls it.
    """
    try:
        document = get_manifest(agent_id, version)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc

    if document is None:
        raise HTTPException(
            status_code=404,
            detail=f"No saved screen found for agent_id '{agent_id}'.",
        )
    document["manifest"] = upgrade_legacy_layout(document["manifest"])
    return document
