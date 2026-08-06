"""Request/response models (MVC Models)."""

from typing import Literal, Optional

from pydantic import BaseModel, Field

from utils.project_db import MAX_PROJECT_SCREENS


class GenerateRequest(BaseModel):
    description: str


class ValidateManifestRequest(BaseModel):
    manifest: dict


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
    scorecard: Optional[dict] = None
    runtime: Optional[dict] = None
    endpoints: Optional[list[dict]] = None


class SaveAgentProjectRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=5000)
    presentation: ScreenPresentation = Field(default_factory=ScreenPresentation)
    screen_ids: list[str] = Field(max_length=MAX_PROJECT_SCREENS)
    start_screen_id: Optional[str] = None
    revision: str = Field(min_length=1, max_length=64)


class UpdateAgentScorecardRequest(BaseModel):
    scorecard: dict


class UpdateAgentRuntimeRequest(BaseModel):
    runtime: dict


class UpdateAgentEndpointsRequest(BaseModel):
    endpoints: list[dict] = Field(default_factory=list)


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


class RunPublishedAgentRequest(BaseModel):
    values_by_screen: dict = Field(default_factory=dict)
    version: Optional[int] = None
