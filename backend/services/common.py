"""Shared service helpers (MVC Services)."""

from __future__ import annotations

import logging
import os

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError, PyMongoError

from utils.content_manifest import validate_screen_manifest
from utils.db import insert_draft, save_draft, slugify
from utils.llm import (
    PROMPT_VERSION,
    LLMConfigurationError,
    LLMOutputError,
    LLMProviderError,
    LLMTimeoutError,
    gateway_generation_target,
)
from utils.manifest_migrations import upgrade_legacy_layout
from models.schemas import SaveDraftRequest, SaveProjectScreenRequest
from utils.project_db import (
    get_project_screen_draft,
    insert_project_screen_draft,
    list_project_screens,
    list_releases,
    save_project_screen_draft,
)
from utils.validation import validate_manifest

logger = logging.getLogger(__name__)


def _ensure_valid_manifest(manifest: dict, message: str) -> dict:
    """Return a valid manifest or raise the API's standard validation error."""
    ok, errors = validate_manifest(manifest)
    if not ok:
        raise HTTPException(
            status_code=422,
            detail={"message": message, "errors": errors},
        )
    return manifest

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

