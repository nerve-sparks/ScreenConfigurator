"""Step 7 regression tests for mutable drafts and immutable publishing."""

from copy import deepcopy

import pytest
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

import db
import main
from main import (
    ArchiveScreenRequest,
    DuplicateScreenRequest,
    PublishDraftRequest,
    SaveDraftRequest,
)


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

    def find(self, query, projection=None, sort=None):
        matches = [item for item in self.documents if self._matches(item, query)]
        if sort:
            key, direction = sort[0]
            matches.sort(key=lambda item: item.get(key, -1), reverse=direction < 0)
        return [self._project(item, projection) for item in matches]

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


def test_first_draft_insert_is_atomic_and_never_overwrites(monkeypatch):
    collection = MemoryCollection()
    monkeypatch.setattr(db, "_collection", collection)
    values = {
        "agent_id": "research-agent",
        "draft_manifest": valid_manifest(),
        "description": "Research assistant",
        "name": "Research Agent",
        "source": "llm",
        "presentation": {"display_name": "Research Agent"},
        "editor_state": {},
        "validation_errors": [],
    }

    first = db.insert_draft(**values)
    with pytest.raises(DuplicateKeyError):
        db.insert_draft(**{**values, "name": "Replacement Agent"})

    assert first["name"] == "Research Agent"
    assert db.get_draft("research-agent")["name"] == "Research Agent"


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
    monkeypatch.setattr(main, "screen_exists", lambda _agent_id: True)

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


def test_draft_update_cannot_create_a_missing_identity(monkeypatch):
    monkeypatch.setattr(main, "screen_exists", lambda _agent_id: False)
    monkeypatch.setattr(
        main,
        "save_draft",
        lambda **_kwargs: pytest.fail("PUT must not create a missing screen"),
    )

    with pytest.raises(HTTPException) as raised:
        main.put_screen_draft(
            "missing-agent",
            SaveDraftRequest(manifest=valid_manifest(), name="Missing Agent"),
        )

    assert raised.value.status_code == 404
    assert "first draft with POST" in raised.value.detail


def test_first_draft_creation_requires_name_to_match_agent_id(monkeypatch):
    request = SaveDraftRequest(
        manifest=valid_manifest(),
        name="Research Agent",
    )
    monkeypatch.setattr(main, "screen_exists", lambda _agent_id: False)

    with pytest.raises(HTTPException) as raised:
        main.create_screen_draft("different-agent", request)

    assert raised.value.status_code == 422
    assert "derived from the supplied screen name" in raised.value.detail


def test_first_draft_creation_rejects_an_existing_identity(monkeypatch):
    request = SaveDraftRequest(
        manifest=valid_manifest(),
        name="Research Agent",
    )
    monkeypatch.setattr(main, "screen_exists", lambda agent_id: agent_id == "research-agent")
    monkeypatch.setattr(
        main,
        "insert_draft",
        lambda **_kwargs: pytest.fail("existing draft must not be overwritten"),
    )

    with pytest.raises(HTTPException) as raised:
        main.create_screen_draft("research-agent", request)

    assert raised.value.status_code == 409
    assert "already exists" in raised.value.detail


def test_first_draft_creation_uses_the_shared_draft_validation_path(monkeypatch):
    captured = {}
    request = SaveDraftRequest(
        manifest=valid_manifest(),
        description="Research assistant",
        name="Research Agent",
        presentation={"display_name": "Research Agent"},
    )
    monkeypatch.setattr(main, "screen_exists", lambda _agent_id: False)

    def fake_save_draft(**kwargs):
        captured.update(kwargs)
        return {
            "agent_id": kwargs["agent_id"],
            "status": "draft",
            "revision": "created-revision",
        }

    monkeypatch.setattr(main, "insert_draft", fake_save_draft)

    result = main.create_screen_draft("research-agent", request)

    assert result["revision"] == "created-revision"
    assert captured["agent_id"] == "research-agent"
    assert captured["name"] == "Research Agent"
    assert captured["validation_errors"] == []


def test_concurrent_first_draft_collision_returns_conflict(monkeypatch):
    request = SaveDraftRequest(
        manifest=valid_manifest(),
        name="Research Agent",
    )
    monkeypatch.setattr(main, "screen_exists", lambda _agent_id: False)
    monkeypatch.setattr(
        main,
        "insert_draft",
        lambda **_kwargs: (_ for _ in ()).throw(DuplicateKeyError("duplicate")),
    )

    with pytest.raises(HTTPException) as raised:
        main.create_screen_draft("research-agent", request)

    assert raised.value.status_code == 409
    assert "already exists" in raised.value.detail


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


def test_duplicate_creates_an_independent_unpublished_draft(monkeypatch):
    collection = MemoryCollection()
    monkeypatch.setattr(db, "_collection", collection)
    save_working_draft(valid_manifest("Original"), valid_manifest("Original"))

    duplicate = db.duplicate_screen(
        "research-agent", "research-agent-copy", "Research Agent Copy"
    )

    assert duplicate["agent_id"] == "research-agent-copy"
    assert duplicate["status"] == "draft"
    assert duplicate["duplicated_from"] == "research-agent"
    assert duplicate["name"] == "Research Agent Copy"
    assert duplicate["presentation"]["display_name"] == "Research Agent Copy"
    assert duplicate["draft_manifest"] == valid_manifest("Original")
    assert db.get_manifest("research-agent-copy") is None

    with pytest.raises(DuplicateKeyError):
        db.duplicate_screen(
            "research-agent", "research-agent-copy", "Research Agent Copy"
        )


def test_restore_copies_an_old_version_without_mutating_history(monkeypatch):
    collection = MemoryCollection()
    monkeypatch.setattr(db, "_collection", collection)
    first_draft = save_working_draft(valid_manifest("First"), valid_manifest("First"))
    db.publish_draft("research-agent", first_draft, valid_manifest("First"), "Initial")
    second_draft = save_working_draft(valid_manifest("Second"), valid_manifest("Second"))
    db.publish_draft("research-agent", second_draft, valid_manifest("Second"), "Edited")

    restored = db.restore_version_as_draft("research-agent", 1)

    assert restored["draft_manifest"] == valid_manifest("First")
    assert restored["restored_from_version"] == 1
    assert "approved_manifest" not in restored
    assert db.get_manifest("research-agent", 1)["manifest"] == valid_manifest("First")
    assert db.get_manifest("research-agent", 2)["manifest"] == valid_manifest("Second")


def test_version_history_is_newest_first_and_omits_manifests(monkeypatch):
    collection = MemoryCollection()
    monkeypatch.setattr(db, "_collection", collection)
    first_draft = save_working_draft(valid_manifest("First"), valid_manifest("First"))
    db.publish_draft("research-agent", first_draft, valid_manifest("First"), "Initial")
    second_draft = save_working_draft(valid_manifest("Second"), valid_manifest("Second"))
    db.publish_draft("research-agent", second_draft, valid_manifest("Second"), "Edited")

    history = db.list_versions("research-agent")

    assert [item["version"] for item in history] == [2, 1]
    assert [item["change_summary"] for item in history] == ["Edited", "Initial"]
    assert all("manifest" not in item for item in history)


def test_archive_metadata_is_reversible_and_preserves_screen_data(monkeypatch):
    collection = MemoryCollection()
    metadata = MemoryCollection()
    monkeypatch.setattr(db, "_collection", collection)
    monkeypatch.setattr(db, "_metadata_collection", metadata)
    draft = save_working_draft(valid_manifest(), valid_manifest())
    db.publish_draft("research-agent", draft, valid_manifest(), "Initial")
    documents_before_archive = deepcopy(collection.documents)

    archived = db.set_screen_archived("research-agent", True)
    unarchived = db.set_screen_archived("research-agent", False)

    assert archived["is_archived"] is True
    assert archived["archived_at"]
    assert unarchived["is_archived"] is False
    assert "archived_at" not in unarchived
    assert collection.documents == documents_before_archive
    assert db.set_screen_archived("missing-agent", True) is None


def test_library_management_routes_return_stable_response_contracts(monkeypatch):
    monkeypatch.setattr(main, "screen_exists", lambda agent_id: agent_id == "research-agent")
    monkeypatch.setattr(
        main,
        "list_versions",
        lambda agent_id: [{"agent_id": agent_id, "version": 2}],
    )
    monkeypatch.setattr(
        main,
        "duplicate_screen",
        lambda source_id, target_id, name: {
            "agent_id": target_id,
            "revision": "copy-revision",
        },
    )
    monkeypatch.setattr(
        main,
        "restore_version_as_draft",
        lambda agent_id, version: {"revision": f"restored-{version}"},
    )
    monkeypatch.setattr(
        main,
        "set_screen_archived",
        lambda agent_id, archived: {
            "agent_id": agent_id,
            "is_archived": archived,
            "archived_at": "2026-07-21T00:00:00Z" if archived else None,
        },
    )

    assert main.get_screen_versions("research-agent")["versions"][0]["version"] == 2
    assert main.duplicate_saved_screen(
        "research-agent", DuplicateScreenRequest(name="Research Copy")
    ) == {
        "agent_id": "research-copy",
        "status": "draft",
        "revision": "copy-revision",
        "duplicated_from": "research-agent",
    }
    assert main.restore_screen_version("research-agent", 2)["restored_from_version"] == 2
    assert main.archive_saved_screen(
        "research-agent", ArchiveScreenRequest(archived=True)
    )["is_archived"] is True


def test_library_management_routes_report_missing_resources(monkeypatch):
    monkeypatch.setattr(main, "screen_exists", lambda agent_id: False)
    monkeypatch.setattr(main, "restore_version_as_draft", lambda agent_id, version: None)
    monkeypatch.setattr(main, "set_screen_archived", lambda agent_id, archived: None)

    with pytest.raises(HTTPException) as versions_error:
        main.get_screen_versions("missing-agent")
    with pytest.raises(HTTPException) as duplicate_error:
        main.duplicate_saved_screen(
            "missing-agent", DuplicateScreenRequest(name="Missing Copy")
        )
    with pytest.raises(HTTPException) as restore_error:
        main.restore_screen_version("missing-agent", 1)
    with pytest.raises(HTTPException) as archive_error:
        main.archive_saved_screen(
            "missing-agent", ArchiveScreenRequest(archived=True)
        )

    assert versions_error.value.status_code == 404
    assert duplicate_error.value.status_code == 404
    assert restore_error.value.status_code == 404
    assert archive_error.value.status_code == 404
