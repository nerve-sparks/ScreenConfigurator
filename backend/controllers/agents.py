"""Agent project controllers."""

from __future__ import annotations

import logging
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pymongo.errors import DuplicateKeyError, PyMongoError

from utils.auth_deps import get_current_user
from utils.db import slugify
from utils.frontend_export import FrontendExportError, build_frontend_archive
from utils.llm import (
    SCREEN_PLAN_PROMPT_VERSION,
    LLMConfigurationError,
    LLMOutputError,
    LLMProviderError,
    LLMTimeoutError,
    generate_content_schema,
    generate_schema,
    generate_screen_plan,
)
from utils.manifest_migrations import upgrade_legacy_layout
from models.schemas import (
    ArchiveScreenRequest,
    CreateAgentProjectRequest,
    DuplicateScreenRequest,
    GenerateProjectScreenRequest,
    GenerateScreenPlanRequest,
    PublishAgentProjectRequest,
    RunPublishedAgentRequest,
    SaveAgentProjectRequest,
    SaveProjectScreenRequest,
    UpdateAgentScorecardRequest,
)
from utils.scorecard import build_scorecard_brief, normalize_scorecard, public_scorecard
from services.agent_run import forward_agent_run
from utils.project_db import (
    create_project,
    duplicate_agent_project,
    duplicate_project_screen,
    get_project,
    get_project_screen_draft,
    get_release,
    list_project_screens,
    list_projects,
    list_releases,
    project_exists,
    project_screen_exists,
    publish_project_release,
    restore_release,
    save_project,
    save_project_scorecard,
    set_project_archived,
    set_project_screen_archived,
)
from services import common

logger = logging.getLogger(__name__)
router = APIRouter(
    tags=["agents"],
    dependencies=[Depends(get_current_user)],
)


@router.post("/agents", status_code=201)
def create_agent_project(request: CreateAgentProjectRequest) -> dict:
    name = request.name.strip()
    agent_id = slugify(name)
    if not agent_id:
        raise HTTPException(status_code=422, detail="name must contain letters or digits")
    try:
        scorecard = (
            normalize_scorecard(request.scorecard)
            if request.scorecard is not None
            else {}
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
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
            scorecard=scorecard,
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
    return common._project_payload(project)

@router.get("/agents")
def get_agent_projects() -> dict:
    try:
        return {"agents": list_projects()}
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc

@router.get("/agents/{agent_id}")
def get_agent_project(agent_id: str) -> dict:
    agent_id = common._validated_agent_id(agent_id)
    try:
        project = get_project(agent_id)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    if project is None:
        raise HTTPException(
            status_code=404,
            detail=f"No agent project found for '{agent_id}'.",
        )
    return common._project_payload(project)

@router.put("/agents/{agent_id}/scorecard")
def put_agent_project_scorecard(
    agent_id: str, request: UpdateAgentScorecardRequest
) -> dict:
    """Attach or replace the agent scorecard (connection.url / api_key, schemas)."""
    agent_id = common._validated_agent_id(agent_id)
    try:
        scorecard = normalize_scorecard(request.scorecard)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        if not project_exists(agent_id):
            raise HTTPException(
                status_code=404,
                detail=f"No agent project found for '{agent_id}'.",
            )
        project = save_project_scorecard(agent_id, scorecard)
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    if project is None:
        raise HTTPException(
            status_code=409,
            detail="The agent project changed. Reload it before saving again.",
        )
    return common._project_payload(project)

@router.put("/agents/{agent_id}/draft")
def put_agent_project_draft(
    agent_id: str, request: SaveAgentProjectRequest
) -> dict:
    agent_id = common._validated_agent_id(agent_id)
    screen_ids = [common._validated_screen_id(value) for value in request.screen_ids]
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
    return common._project_payload(project)

@router.post("/agents/{agent_id}/screen-plan/generate")
def generate_agent_screen_plan(
    agent_id: str, request: GenerateScreenPlanRequest
) -> dict:
    agent_id = common._validated_agent_id(agent_id)
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
        plan = generate_screen_plan(
            description,
            existing,
            scorecard=project.get("scorecard") or {},
        )
    except HTTPException:
        raise
    except (LLMConfigurationError, LLMTimeoutError, LLMOutputError, LLMProviderError) as exc:
        common._raise_generation_http_error(exc)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    except Exception as exc:
        logger.error("Unexpected screen-plan failure (%s).", type(exc).__name__)
        common._raise_generation_http_error(exc)
    return {
        **plan,
        "generation": common._generation_metadata()
        | {"prompt_version": SCREEN_PLAN_PROMPT_VERSION},
    }

@router.post("/agents/{agent_id}/screens/generate")
def generate_agent_project_screen(
    agent_id: str, request: GenerateProjectScreenRequest
) -> dict:
    agent_id = common._validated_agent_id(agent_id)
    common._validate_screen_purpose(request.screen_type, request.purpose)
    screen_id = (
        common._validated_screen_id(request.screen_id)
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
        scorecard_brief = build_scorecard_brief(project.get("scorecard") or {})
        brief = (
            f"Agent: {project['name']}\n"
            f"Agent description: {project.get('description', '')}\n"
            f"Screen name: {request.name.strip()}\n"
            f"Screen purpose: {request.purpose}\n"
            f"Screen description: {request.description.strip()}\n"
            f"Existing screens to avoid duplicating: {existing_context or 'none'}\n"
            f"{scorecard_brief}"
        )
        manifest = (
            generate_schema(brief)
            if request.screen_type == "form"
            else generate_content_schema(brief)
        )
    except HTTPException:
        raise
    except (LLMConfigurationError, LLMTimeoutError, LLMOutputError, LLMProviderError) as exc:
        common._raise_generation_http_error(exc)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    except Exception as exc:
        logger.error("Unexpected screen generation failure (%s).", type(exc).__name__)
        common._raise_generation_http_error(exc)
    return {
        "screen_id": screen_id,
        "screen_type": request.screen_type,
        "purpose": request.purpose,
        "manifest": manifest,
        "generation": common._generation_metadata(),
    }

@router.post("/agents/{agent_id}/screens/{screen_id}/draft", status_code=201)
def create_agent_project_screen_draft(
    agent_id: str, screen_id: str, request: SaveProjectScreenRequest
) -> dict:
    agent_id = common._validated_agent_id(agent_id)
    screen_id = common._validated_screen_id(screen_id)
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
        return common._persist_project_screen(agent_id, screen_id, request, create=True)
    except HTTPException:
        raise
    except (DuplicateKeyError, ValueError) as exc:
        status = 409 if isinstance(exc, DuplicateKeyError) else 422
        raise HTTPException(status_code=status, detail=str(exc)) from exc
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc

@router.put("/agents/{agent_id}/screens/{screen_id}/draft")
def put_agent_project_screen_draft(
    agent_id: str, screen_id: str, request: SaveProjectScreenRequest
) -> dict:
    agent_id = common._validated_agent_id(agent_id)
    screen_id = common._validated_screen_id(screen_id)
    try:
        draft = common._persist_project_screen(agent_id, screen_id, request, create=False)
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    return draft

@router.get("/agents/{agent_id}/screens/{screen_id}/draft")
def get_agent_project_screen_draft(agent_id: str, screen_id: str) -> dict:
    agent_id = common._validated_agent_id(agent_id)
    screen_id = common._validated_screen_id(screen_id)
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

@router.post(
    "/agents/{agent_id}/screens/{screen_id}/duplicate",
    status_code=201,
)
def duplicate_agent_project_screen(
    agent_id: str,
    screen_id: str,
    request: DuplicateScreenRequest,
) -> dict:
    agent_id = common._validated_agent_id(agent_id)
    screen_id = common._validated_screen_id(screen_id)
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

@router.patch("/agents/{agent_id}/screens/{screen_id}/archive")
def archive_agent_project_screen(
    agent_id: str, screen_id: str, request: ArchiveScreenRequest
) -> dict:
    agent_id = common._validated_agent_id(agent_id)
    screen_id = common._validated_screen_id(screen_id)
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

@router.post("/agents/{agent_id}/publish")
def publish_agent_project(
    agent_id: str, request: PublishAgentProjectRequest
) -> dict:
    agent_id = common._validated_agent_id(agent_id)
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
            common._prepared_screen_manifest(
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

@router.get("/agents/{agent_id}/releases")
def get_agent_releases(agent_id: str) -> dict:
    agent_id = common._validated_agent_id(agent_id)
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

@router.get("/agents/{agent_id}/releases/{version}")
def get_agent_release(agent_id: str, version: int) -> dict:
    agent_id = common._validated_agent_id(agent_id)
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

@router.get("/agents/{agent_id}/releases/{version}/export")
def export_agent_release_frontend(agent_id: str, version: int) -> Response:
    """Download one exact immutable release as a standalone frontend."""
    agent_id = common._validated_agent_id(agent_id)
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

@router.get("/agents/{agent_id}/published")
def get_published_agent_release(
    agent_id: str, version: Optional[int] = None
) -> dict:
    agent_id = common._validated_agent_id(agent_id)
    try:
        release = get_release(agent_id, version)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    if release is None:
        raise HTTPException(
            status_code=404,
            detail=f"No published agent release found for '{agent_id}'.",
        )
    release = dict(release)
    release["scorecard"] = public_scorecard(release.get("scorecard") or {})
    return release


@router.post("/agents/{agent_id}/published/run")
async def run_published_agent(
    agent_id: str,
    request: RunPublishedAgentRequest,
    http_request: Request,
) -> dict:
    """Map completed screen values onto the scorecard and call connection.url."""
    agent_id = common._validated_agent_id(agent_id)
    try:
        release = get_release(agent_id, request.version)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc
    if release is None:
        raise HTTPException(
            status_code=404,
            detail=f"No published agent release found for '{agent_id}'.",
        )
    return await forward_agent_run(
        scorecard=release.get("scorecard") or {},
        values_by_screen=request.values_by_screen or {},
        studio_agent_id=agent_id,
        release_version=int(release.get("version") or 1),
        caller_authorization=http_request.headers.get("Authorization") or "",
    )


@router.post("/agents/{agent_id}/releases/{version}/restore")
def restore_agent_release(agent_id: str, version: int) -> dict:
    agent_id = common._validated_agent_id(agent_id)
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
    return common._project_payload(project)

@router.patch("/agents/{agent_id}/archive")
def archive_agent_project(
    agent_id: str, request: ArchiveScreenRequest
) -> dict:
    agent_id = common._validated_agent_id(agent_id)
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

@router.post("/agents/{agent_id}/duplicate", status_code=201)
def duplicate_saved_agent_project(
    agent_id: str, request: DuplicateScreenRequest
) -> dict:
    agent_id = common._validated_agent_id(agent_id)
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
    return common._project_payload(project)
