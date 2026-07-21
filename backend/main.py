"""FastAPI app + routes: the one shared backend.

POST /generate -- plain-text description in, validated manifest out.
Validation is the gate (Step 4): nothing invalid is ever returned.
The backend knows only the manifest contract; it never branches on
any specific agent name or type.
"""

from contextlib import asynccontextmanager
import os
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError, PyMongoError

from db import (
    duplicate_screen,
    ensure_indexes,
    get_draft,
    get_manifest,
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
from llm import PROMPT_VERSION, generate_schema
from manifest_migrations import upgrade_legacy_layout
from validation import validate_manifest

# Vite dev server origins allowed to call this API.
FRONTEND_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Step 5: ensure the registry's indexes exist before serving. The
    # unique {agent_id, version} index enforces "no duplicate versions",
    # so we fail fast (with a clear message) rather than run without it.
    try:
        ensure_indexes()
    except PyMongoError as exc:
        raise RuntimeError(
            f"Could not reach MongoDB at startup ({exc}). Check MONGODB_URI "
            "in backend/.env and make sure MongoDB is running."
        ) from exc
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
    except Exception as exc:
        # llm.py raises clear, descriptive errors (missing config, LLM/network
        # failure, unparseable response). Surface the message instead of an
        # opaque 500 so the frontend can show what actually went wrong.
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    # Validation is the gate: return the error list instead of a form.
    # (Auto-retrying the LLM with these errors is deliberately deferred.)
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
    model = (
        os.getenv("LITE_LLM_MODEL_GEMINI", "")
        if gateway_enabled
        else os.getenv("MODEL", "")
    ).strip()
    provider = "litellm_gateway" if gateway_enabled else (
        model.split("/", 1)[0] if "/" in model else "litellm"
    )
    return {
        "provider": provider,
        "model": model,
        "prompt_version": PROMPT_VERSION,
    }


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


@app.put("/screens/{agent_id}/draft")
def put_screen_draft(agent_id: str, request: SaveDraftRequest) -> dict:
    """Autosave one mutable working draft without creating a version."""
    agent_id = _validated_agent_id(agent_id)
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
        document = save_draft(
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
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc

    return document


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
