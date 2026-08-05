"""Legacy single-screen controllers."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError, PyMongoError

from utils.auth_deps import get_current_user
from utils.db import (
    duplicate_screen,
    get_draft,
    get_manifest,
    list_agents,
    list_versions,
    publish_draft,
    restore_version_as_draft,
    save_manifest,
    screen_exists,
    set_screen_archived,
    slugify,
)
from utils.manifest_migrations import upgrade_legacy_layout
from models.schemas import (
    ArchiveScreenRequest,
    DuplicateScreenRequest,
    PublishDraftRequest,
    SaveDraftRequest,
    SaveScreenRequest,
)
from services import common

router = APIRouter(
    tags=["screens"],
    dependencies=[Depends(get_current_user)],
)


@router.post("/screens")
def save_screen(request: SaveScreenRequest) -> dict:
    """Legacy direct-publish endpoint.

    Step 7 clients use the draft and publish endpoints below. This route is
    retained so older clients continue to work and still cannot store an
    invalid manifest.
    """
    manifest = upgrade_legacy_layout(request.manifest)
    common._ensure_valid_manifest(manifest, "Manifest failed validation.")

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

@router.post("/screens/{agent_id}/draft", status_code=201)
def create_screen_draft(agent_id: str, request: SaveDraftRequest) -> dict:
    """Create the first draft without overwriting an existing screen identity."""
    agent_id = common._validated_agent_id(agent_id)
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
    return common._persist_screen_draft(agent_id, request, create=True)

@router.put("/screens/{agent_id}/draft")
def put_screen_draft(agent_id: str, request: SaveDraftRequest) -> dict:
    """Autosave an existing mutable draft without creating a version."""
    agent_id = common._validated_agent_id(agent_id)
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
    return common._persist_screen_draft(agent_id, request)

@router.get("/screens/{agent_id}/draft")
def get_screen_draft(agent_id: str) -> dict:
    """Load the mutable editor state; no LLM call is involved."""
    agent_id = common._validated_agent_id(agent_id)
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

@router.post("/screens/{agent_id}/publish")
def publish_screen_draft(agent_id: str, request: PublishDraftRequest) -> dict:
    """Create one immutable version from the current validated draft."""
    agent_id = common._validated_agent_id(agent_id)
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
    common._ensure_valid_manifest(manifest, "Invalid drafts cannot be published.")

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

@router.get("/screens")
def list_screens() -> dict:
    """Return published and draft-only screens for the library."""
    try:
        screens = list_agents()
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    return {"screens": screens}

@router.get("/screens/{agent_id}/versions")
def get_screen_versions(agent_id: str) -> dict:
    """Return published-version history without loading full manifests."""
    agent_id = common._validated_agent_id(agent_id)
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

@router.post("/screens/{agent_id}/duplicate", status_code=201)
def duplicate_saved_screen(
    agent_id: str, request: DuplicateScreenRequest
) -> dict:
    """Create a new draft from the source's latest draft or published version."""
    agent_id = common._validated_agent_id(agent_id)
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

@router.post("/screens/{agent_id}/versions/{version}/restore")
def restore_screen_version(agent_id: str, version: int) -> dict:
    """Restore an immutable version by copying it into the working draft."""
    agent_id = common._validated_agent_id(agent_id)
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

@router.patch("/screens/{agent_id}/archive")
def archive_saved_screen(agent_id: str, request: ArchiveScreenRequest) -> dict:
    """Soft-archive or unarchive a screen without deleting any versions."""
    agent_id = common._validated_agent_id(agent_id)
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

@router.get("/screens/{agent_id}")
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
