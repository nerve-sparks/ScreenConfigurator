"""Step 7 regression tests for mutable drafts and immutable publishing."""

from copy import deepcopy

import pytest
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

import db
import main
from main import PublishDraftRequest, SaveDraftRequest


def valid_manifest(title="Topic"):
    return {
        "input_schema": {
            "type": "object",
            "properties": {"topic": {"type": "string", "title": title}},
            "required": ["topic"],
        },
        "ui_hints": {"mode": "single", "field_order": ["topic"]},
    }


class MemoryCollection:
    """Small Mongo-shaped fake for testing the persistence invariants."""

    def __init__(self):
        self.documents = []

    @staticmethod
    def _matches(document, query):
        for key, expected in query.items():
            actual = document.get(key)
            if isinstance(expected, dict):
                if "$ne" in expected and actual == expected["$ne"]:
                    return False
                if "$type" in expected:
                    type_name = expected["$type"]
                    if type_name == "number" and (
                        not isinstance(actual, (int, float)) or isinstance(actual, bool)
                    ):
                        return False
                    if type_name == "string" and not isinstance(actual, str):
                        return False
            elif actual != expected:
                return False
        return True

    @staticmethod
    def _project(document, projection):
        copied = deepcopy(document)
        if not projection:
            return copied
        included = [key for key, include in projection.items() if include and key != "_id"]
        if included:
            return {key: copied[key] for key in included if key in copied}
        if projection.get("_id") is False:
            copied.pop("_id", None)
        return copied

    def find_one(self, query, projection=None, sort=None):
        matches = [item for item in self.documents if self._matches(item, query)]
        if sort:
            key, direction = sort[0]
            matches.sort(key=lambda item: item.get(key, -1), reverse=direction < 0)
        if not matches:
            return None
        return self._project(matches[0], projection)

    def update_one(self, query, update, upsert=False):
        document = next(
            (item for item in self.documents if self._matches(item, query)), None
        )
        inserted = document is None
        if inserted:
            if not upsert:
                return None
            document = {
                key: value
                for key, value in query.items()
                if not isinstance(value, dict)
            }
            self.documents.append(document)
        if inserted:
            document.update(deepcopy(update.get("$setOnInsert", {})))
        document.update(deepcopy(update.get("$set", {})))
        for key in update.get("$unset", {}):
            document.pop(key, None)
        return None

    def insert_one(self, document):
        for existing in self.documents:
            duplicate_version = (
                existing.get("agent_id") == document.get("agent_id")
                and existing.get("version") == document.get("version")
            )
            duplicate_revision = (
                document.get("status") == "published"
                and existing.get("status") == "published"
                and existing.get("agent_id") == document.get("agent_id")
                and existing.get("draft_revision") == document.get("draft_revision")
            )
            if duplicate_version or duplicate_revision:
                raise DuplicateKeyError("duplicate")
        self.documents.append(deepcopy(document))
        return None


def save_working_draft(manifest, approved_manifest=None):
    return db.save_draft(
        agent_id="research-agent",
        draft_manifest=manifest,
        description="Research assistant",
        name="Research Agent",
        source="llm",
        presentation={"display_name": "Research Agent"},
        editor_state={"manifest": manifest},
        validation_errors=[],
        approved_manifest=approved_manifest,
        generation={"provider": "litellm_gateway", "model": "gemini"},
    )


def test_autosave_updates_one_mutable_document(monkeypatch):
    collection = MemoryCollection()
    monkeypatch.setattr(db, "_collection", collection)

    first = save_working_draft(valid_manifest("First"), valid_manifest("First"))
    second = save_working_draft(valid_manifest("Edited"))

    drafts = [item for item in collection.documents if item["status"] == "draft"]
    assert len(drafts) == 1
    assert drafts[0]["draft_manifest"] == valid_manifest("Edited")
    assert "approved_manifest" not in drafts[0]
    assert first["revision"] != second["revision"]
    assert db.get_manifest("research-agent") is None


def test_publish_is_idempotent_and_older_versions_remain_loadable(monkeypatch):
    collection = MemoryCollection()
    monkeypatch.setattr(db, "_collection", collection)

    first_draft = save_working_draft(valid_manifest("First"), valid_manifest("First"))
    first_version = db.publish_draft(
        "research-agent", first_draft, first_draft["approved_manifest"], "Initial"
    )
    replayed_version = db.publish_draft(
        "research-agent", first_draft, first_draft["approved_manifest"], "Initial"
    )
    second_draft = save_working_draft(valid_manifest("Second"), valid_manifest("Second"))
    second_version = db.publish_draft(
        "research-agent", second_draft, second_draft["approved_manifest"], "Edited"
    )

    published = [item for item in collection.documents if item["status"] == "published"]
    assert (first_version, replayed_version, second_version) == (1, 1, 2)
    assert len(published) == 2
    assert db.get_manifest("research-agent", 1)["manifest"] == valid_manifest("First")
    assert db.get_manifest("research-agent", 2)["manifest"] == valid_manifest("Second")


def test_invalid_editor_draft_can_autosave(monkeypatch):
    captured = {}

    def fake_save_draft(**kwargs):
        captured.update(kwargs)
        return {
            "agent_id": "broken-agent",
            "status": "draft",
            "revision": "revision-1",
            "draft_manifest": kwargs["draft_manifest"],
        }

    monkeypatch.setattr(main, "save_draft", fake_save_draft)
    result = main.put_screen_draft(
        "broken-agent",
        SaveDraftRequest(manifest={}, description="Incomplete draft"),
    )

    assert result["status"] == "draft"
    assert captured["validation_errors"]


def test_invalid_draft_cannot_be_published(monkeypatch):
    monkeypatch.setattr(
        main,
        "get_draft",
        lambda agent_id: {
            "agent_id": agent_id,
            "status": "draft",
            "revision": "revision-1",
            "approved_manifest": {},
        },
    )

    with pytest.raises(HTTPException) as raised:
        main.publish_screen_draft(
            "broken-agent",
            PublishDraftRequest(
                draft_revision="revision-1", change_summary="Try publish"
            ),
        )

    assert raised.value.status_code == 422
    assert "approved manifest" in raised.value.detail.lower()


def test_publish_rejects_a_stale_preview_revision(monkeypatch):
    monkeypatch.setattr(
        main,
        "get_draft",
        lambda agent_id: {
            "agent_id": agent_id,
            "status": "draft",
            "revision": "newer-revision",
            "approved_manifest": valid_manifest(),
        },
    )

    with pytest.raises(HTTPException) as raised:
        main.publish_screen_draft(
            "research-agent",
            PublishDraftRequest(
                draft_revision="older-revision", change_summary="Publish"
            ),
        )

    assert raised.value.status_code == 409
