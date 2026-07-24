"""Multi-screen project, content contract, and publication regression tests."""

from copy import deepcopy
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

import llm
import main
import project_db
from content_manifest import validate_content_manifest
from main import GenerateProjectScreenRequest, PublishAgentProjectRequest


CONTENT_MANIFEST = {
    "blocks": [
        {
            "id": "welcome-heading",
            "type": "heading",
            "level": 2,
            "text": "Before you begin",
        },
        {
            "id": "privacy-copy",
            "type": "paragraph",
            "text": "Review the information before continuing.",
        },
        {"id": "content-break", "type": "divider"},
        {
            "id": "privacy-note",
            "type": "callout",
            "tone": "information",
            "text": "Your information is handled securely.",
        },
        {
            "id": "next-steps",
            "type": "section",
            "title": "Next steps",
            "description": "What happens after this screen.",
            "children": [
                {
                    "id": "next-steps-copy",
                    "type": "paragraph",
                    "text": "Continue to the validated form.",
                }
            ],
        },
    ]
}


FORM_MANIFEST = {
    "input_schema": {
        "type": "object",
        "properties": {"topic": {"type": "string", "title": "Topic"}},
        "required": ["topic"],
    },
    "ui_hints": {
        "mode": "single",
        "field_order": ["topic"],
        "blocks": [{"id": "field-topic", "type": "field", "field": "topic"}],
    },
}


def test_content_manifest_accepts_all_safe_content_blocks():
    valid, errors = validate_content_manifest(CONTENT_MANIFEST)
    assert valid
    assert errors == []


@pytest.mark.parametrize(
    "mutation, expected",
    [
        (
            lambda manifest: manifest["blocks"].append(
                {"id": "field-topic", "type": "field", "field": "topic"}
            ),
            "not valid",
        ),
        (
            lambda manifest: manifest["blocks"].append(
                {
                    "id": "unsafe-copy",
                    "type": "paragraph",
                    "text": "<script>alert(1)</script>",
                }
            ),
            "html",
        ),
        (
            lambda manifest: manifest["blocks"].append(
                {
                    "id": "nested",
                    "type": "section",
                    "title": "Nested",
                    "children": [
                        {
                            "id": "nested-child",
                            "type": "section",
                            "title": "Too deep",
                            "children": [],
                        }
                    ],
                }
            ),
            "not valid",
        ),
        (
            lambda manifest: manifest["blocks"].append(
                {
                    "id": "privacy-copy",
                    "type": "paragraph",
                    "text": "Duplicate identifier",
                }
            ),
            "appears more than once",
        ),
    ],
)
def test_content_manifest_rejects_fields_unsafe_text_nesting_and_duplicate_ids(
    mutation, expected
):
    manifest = deepcopy(CONTENT_MANIFEST)
    mutation(manifest)
    valid, errors = validate_content_manifest(manifest)
    assert not valid
    assert expected.lower() in " ".join(errors).lower()


def test_screen_plan_validation_rejects_duplicate_names_and_invalid_purposes():
    duplicate = {
        "screens": [
            {
                "name": "Call setup",
                "screen_type": "form",
                "purpose": "intake",
                "description": "Collect call settings.",
            },
            {
                "name": "Call setup",
                "screen_type": "content",
                "purpose": "information",
                "description": "Explain call settings.",
            },
        ]
    }
    assert any("duplicate" in error for error in llm._screen_plan_errors(duplicate))

    invalid = deepcopy(duplicate)
    invalid["screens"] = [invalid["screens"][0] | {"purpose": "confirmation"}]
    assert any("not valid" in error for error in llm._screen_plan_errors(invalid))


def test_content_generation_uses_backend_id_and_content_pipeline(monkeypatch):
    monkeypatch.setattr(
        main,
        "get_project",
        lambda _: {
            "agent_id": "calling-agent",
            "name": "Calling Agent",
            "description": "Handle inbound calls.",
        },
    )
    monkeypatch.setattr(main, "project_screen_exists", lambda *_: False)
    monkeypatch.setattr(main, "list_project_screens", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(
        main, "generate_content_schema", lambda _brief: deepcopy(CONTENT_MANIFEST)
    )
    monkeypatch.setattr(
        main,
        "_generation_metadata",
        lambda: {"provider": "gemini", "model": "gemini-test"},
    )

    result = main.generate_agent_project_screen(
        "calling-agent",
        GenerateProjectScreenRequest(
            name="Before You Call",
            screen_type="content",
            purpose="information",
            description="Explain what callers should prepare.",
        ),
    )

    assert result["screen_id"] == "before-you-call"
    assert result["manifest"] == CONTENT_MANIFEST
    assert result["generation"]["model"] == "gemini-test"


def test_publish_rejects_stale_project_and_screen_revisions(monkeypatch):
    project = {
        "agent_id": "calling-agent",
        "name": "Calling Agent",
        "description": "",
        "presentation": {},
        "screen_ids": ["call-setup"],
        "start_screen_id": "call-setup",
        "revision": "project-current",
    }
    monkeypatch.setattr(main, "get_project", lambda _: project)

    with pytest.raises(HTTPException) as project_error:
        main.publish_agent_project(
            "calling-agent",
            PublishAgentProjectRequest(
                project_revision="project-stale",
                screen_revisions={"call-setup": "screen-current"},
                change_summary="Initial release",
            ),
        )
    assert project_error.value.status_code == 409

    monkeypatch.setattr(
        main,
        "get_project_screen_draft",
        lambda *_: {
            "agent_id": "calling-agent",
            "screen_id": "call-setup",
            "screen_type": "form",
            "purpose": "intake",
            "revision": "screen-current",
            "approved_manifest": FORM_MANIFEST,
            "is_archived": False,
        },
    )
    with pytest.raises(HTTPException) as screen_error:
        main.publish_agent_project(
            "calling-agent",
            PublishAgentProjectRequest(
                project_revision="project-current",
                screen_revisions={"call-setup": "screen-stale"},
                change_summary="Initial release",
            ),
        )
    assert screen_error.value.status_code == 409


def test_restore_release_archives_screens_outside_restored_navigation(monkeypatch):
    release = {
        "agent_id": "calling-agent",
        "version": 2,
        "name": "Calling Agent",
        "description": "Handle calls.",
        "presentation": {},
        "screen_ids": ["welcome", "call-setup"],
        "start_screen_id": "welcome",
        "screens": [
            {
                "screen_id": "welcome",
                "screen_type": "content",
                "purpose": "information",
                "name": "Welcome",
                "manifest": CONTENT_MANIFEST,
            },
            {
                "screen_id": "call-setup",
                "screen_type": "form",
                "purpose": "intake",
                "name": "Call setup",
                "manifest": FORM_MANIFEST,
            },
        ],
    }
    project = {"agent_id": "calling-agent", "revision": "project-current"}
    screen_drafts = {
        "welcome": {"screen_id": "welcome", "is_archived": False},
        "old-screen": {"screen_id": "old-screen", "is_archived": False},
    }
    saved_ids = []
    inserted_ids = []
    manifests = MagicMock()
    projects = MagicMock()

    monkeypatch.setattr(project_db, "_releases", MagicMock())
    monkeypatch.setattr(project_db, "_projects", projects)
    monkeypatch.setattr(project_db.db, "_collection", manifests)
    monkeypatch.setattr(project_db, "get_release", lambda *_: release)
    monkeypatch.setattr(project_db, "get_project", lambda *_: project)
    monkeypatch.setattr(
        project_db,
        "get_project_screen_draft",
        lambda _agent_id, screen_id: screen_drafts.get(screen_id),
    )
    monkeypatch.setattr(
        project_db,
        "save_project_screen_draft",
        lambda **payload: saved_ids.append(payload["screen_id"]),
    )
    monkeypatch.setattr(
        project_db,
        "insert_project_screen_draft",
        lambda **payload: inserted_ids.append(payload["screen_id"]),
    )

    restored = project_db.restore_release("calling-agent", 2)

    assert restored == project
    manifests.update_many.assert_called_once()
    assert saved_ids == ["welcome"]
    assert inserted_ids == ["call-setup"]
    unarchive_query = manifests.update_one.call_args.args[0]
    unarchive_update = manifests.update_one.call_args.args[1]
    assert unarchive_query["screen_id"] == "welcome"
    assert unarchive_update["$set"]["is_archived"] is False
    assert unarchive_update["$unset"] == {"archived_at": ""}
