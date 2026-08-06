"""MongoDB persistence for mutable drafts and immutable published screens.

Step 7 deliberately stores two document shapes in the existing collection:

* one mutable ``status=draft`` document per agent; and
* append-only ``status=published`` documents with integer versions.

Legacy version documents whose status is ``active`` remain readable as
published screens. Preview form values are never accepted by this module and
therefore cannot be persisted accidentally.
"""

import os
import re
from datetime import datetime, timezone
from pathlib import Path
from copy import deepcopy
from typing import Optional
from uuid import uuid4

from dotenv import load_dotenv
from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.errors import DuplicateKeyError

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")

# The client connects lazily -- nothing touches the network at import time.
_client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
_database = _client["agent_screens"]
_collection = _database["manifests"]
_metadata_collection = _database["screen_metadata"]

_MAX_SAVE_ATTEMPTS = 3


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace(
        "+00:00", "Z"
    )


def _published_query(agent_id: str) -> dict:
    """Match current and legacy immutable versions, never the working draft."""
    return {
        "agent_id": agent_id,
        "status": {"$ne": "draft"},
        "version": {"$type": "number"},
    }


def ensure_indexes() -> None:
    """Create indexes that support legacy and project-owned screens."""
    _collection.create_index(
        [
            ("agent_id", ASCENDING),
            ("screen_id", ASCENDING),
            ("version", ASCENDING),
        ],
        unique=True,
        partialFilterExpression={"version": {"$type": "number"}},
    )
    _collection.create_index(
        [
            ("agent_id", ASCENDING),
            ("screen_id", ASCENDING),
            ("status", ASCENDING),
        ],
        unique=True,
        partialFilterExpression={"status": "draft"},
    )
    _collection.create_index(
        [
            ("agent_id", ASCENDING),
            ("screen_id", ASCENDING),
            ("draft_revision", ASCENDING),
        ],
        unique=True,
        partialFilterExpression={
            "status": "published",
            "draft_revision": {"$type": "string"},
        },
    )
    _metadata_collection.create_index([("agent_id", ASCENDING)], unique=True)


def slugify(text: str) -> str:
    """Derive an agent_id: ``Email Agent!`` -> ``email-agent``."""
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:64].rstrip("-")


def _next_version(agent_id: str) -> int:
    latest = _collection.find_one(
        _published_query(agent_id),
        projection={"version": True},
        sort=[("version", DESCENDING)],
    )
    return latest["version"] + 1 if latest else 1


def save_manifest(
    agent_id: str,
    manifest: dict,
    description: str,
    source: str,
    presentation: Optional[dict] = None,
) -> int:
    """Legacy direct-publish helper kept for API compatibility.

    New editor code uses ``save_draft`` followed by ``publish_draft``. This
    helper still writes a correctly shaped immutable published version for
    older API clients.
    """
    for _ in range(_MAX_SAVE_ATTEMPTS):
        now = _utc_now()
        document = {
            "agent_id": agent_id,
            "screen_id": agent_id,
            "version": _next_version(agent_id),
            "manifest": manifest,
            "description": description,
            "source": source,
            "presentation": presentation or {},
            "created_at": now,
            "published_at": now,
            "change_summary": "Published through the legacy save endpoint",
            "status": "published",
        }
        try:
            _collection.insert_one(document)
            return document["version"]
        except DuplicateKeyError:
            continue
    raise RuntimeError(
        f"Could not allocate a new version for '{agent_id}' after "
        f"{_MAX_SAVE_ATTEMPTS} attempts."
    )


def save_draft(
    agent_id: str,
    draft_manifest: dict,
    description: str,
    name: str,
    source: str,
    presentation: Optional[dict],
    editor_state: Optional[dict],
    validation_errors: list[str],
    approved_manifest: Optional[dict] = None,
    generation: Optional[dict] = None,
) -> dict:
    """Create or update the agent's single mutable working draft.

    ``approved_manifest`` is the human-reviewed candidate that may be
    published. A normal editor autosave omits it, which clears an older
    candidate so stale validated content can never be published after edits.
    """
    now = _utc_now()
    revision = uuid4().hex
    latest = get_manifest(agent_id)
    published_version = latest["version"] if latest else None
    update: dict = {
        "$set": {
            "agent_id": agent_id,
            "screen_id": agent_id,
            "name": name,
            "description": description,
            "status": "draft",
            "draft_manifest": draft_manifest,
            "source": source,
            "presentation": presentation or {},
            "editor_state": editor_state or {},
            "generation": generation or {},
            "validation_errors": validation_errors,
            "published_version": published_version,
            "revision": revision,
            "updated_at": now,
        },
        "$setOnInsert": {"created_at": now},
    }
    if approved_manifest is None:
        update["$unset"] = {"approved_manifest": ""}
    else:
        update["$set"]["approved_manifest"] = approved_manifest

    _collection.update_one(
        {"agent_id": agent_id, "status": "draft"}, update, upsert=True
    )
    return get_draft(agent_id) or {}


def insert_draft(
    agent_id: str,
    draft_manifest: dict,
    description: str,
    name: str,
    source: str,
    presentation: Optional[dict],
    editor_state: Optional[dict],
    validation_errors: list[str],
    approved_manifest: Optional[dict] = None,
    generation: Optional[dict] = None,
) -> dict:
    """Atomically create a screen's first draft.

    Unlike ``save_draft``, this function never upserts or replaces an existing
    identity. The unique ``(agent_id, version)`` index treats the missing draft
    version as one value, so concurrent creates for the same ID result in one
    successful insert and one ``DuplicateKeyError``.
    """
    now = _utc_now()
    latest = get_manifest(agent_id)
    document = {
        "agent_id": agent_id,
        "screen_id": agent_id,
        "name": name,
        "description": description,
        "status": "draft",
        "draft_manifest": draft_manifest,
        "source": source,
        "presentation": presentation or {},
        "editor_state": editor_state or {},
        "generation": generation or {},
        "validation_errors": validation_errors,
        "published_version": latest["version"] if latest else None,
        "revision": uuid4().hex,
        "created_at": now,
        "updated_at": now,
    }
    if approved_manifest is not None:
        document["approved_manifest"] = approved_manifest

    _collection.insert_one(document)
    return get_draft(agent_id) or {}


def get_draft(agent_id: str) -> Optional[dict]:
    document = _collection.find_one(
        {"agent_id": agent_id, "screen_id": agent_id, "status": "draft"},
        projection={"_id": False},
    )
    if document is not None:
        return document
    # Read compatibility for pre-screen_id documents before startup migration.
    return _collection.find_one(
        {
            "agent_id": agent_id,
            "screen_id": {"$exists": False},
            "status": "draft",
        },
        projection={"_id": False},
    )


def screen_exists(agent_id: str) -> bool:
    """Return whether the ID has a working draft or a published version."""
    if get_draft(agent_id) is not None:
        return True
    return get_manifest(agent_id) is not None


def publish_draft(
    agent_id: str,
    draft: dict,
    manifest: dict,
    change_summary: str,
) -> int:
    """Publish one immutable version from a validated draft revision.

    The unique ``(agent_id, draft_revision)`` index makes retries idempotent:
    replaying the same publish request returns the existing version instead of
    creating a duplicate.
    """
    revision = draft["revision"]
    existing = _collection.find_one(
        {
            "agent_id": agent_id,
            "status": "published",
            "draft_revision": revision,
        },
        projection={"version": True},
    )
    if existing:
        return existing["version"]

    for _ in range(_MAX_SAVE_ATTEMPTS):
        now = _utc_now()
        document = {
            "agent_id": agent_id,
            "screen_id": agent_id,
            "version": _next_version(agent_id),
            "status": "published",
            "manifest": manifest,
            "name": draft.get("name", ""),
            "description": draft.get("description", ""),
            "source": draft.get("source", "llm"),
            "presentation": draft.get("presentation", {}),
            "generation": draft.get("generation", {}),
            "change_summary": change_summary,
            "draft_revision": revision,
            "created_at": now,
            "published_at": now,
        }
        try:
            _collection.insert_one(document)
        except DuplicateKeyError:
            existing = _collection.find_one(
                {
                    "agent_id": agent_id,
                    "status": "published",
                    "draft_revision": revision,
                },
                projection={"version": True},
            )
            if existing:
                return existing["version"]
            continue

        _collection.update_one(
            {
                "agent_id": agent_id,
                "status": "draft",
                "revision": revision,
            },
            {
                "$set": {
                    "published_version": document["version"],
                    "published_revision": revision,
                    "last_published_at": now,
                }
            },
        )
        return document["version"]

    raise RuntimeError(
        f"Could not publish a new version for '{agent_id}' after "
        f"{_MAX_SAVE_ATTEMPTS} attempts."
    )


def get_manifest(agent_id: str, version: Optional[int] = None) -> Optional[dict]:
    query = _published_query(agent_id)
    if version is not None:
        query["version"] = version
        return _collection.find_one(query, projection={"_id": False})
    return _collection.find_one(
        query, projection={"_id": False}, sort=[("version", DESCENDING)]
    )


def list_versions(agent_id: str) -> list[dict]:
    """Return immutable version summaries, newest first, without manifests."""
    projection = {
        "_id": False,
        "agent_id": True,
        "version": True,
        "status": True,
        "name": True,
        "change_summary": True,
        "published_at": True,
        "created_at": True,
    }
    return list(
        _collection.find(
            _published_query(agent_id),
            projection=projection,
            sort=[("version", DESCENDING)],
        )
    )


def duplicate_screen(source_agent_id: str, target_agent_id: str, name: str) -> dict:
    """Copy the latest working state into a brand-new, unpublished draft."""
    if screen_exists(target_agent_id):
        raise DuplicateKeyError(f"Screen '{target_agent_id}' already exists.")

    source_draft = get_draft(source_agent_id)
    source_version = None if source_draft else get_manifest(source_agent_id)
    source = source_draft or source_version
    if source is None:
        return {}

    manifest = deepcopy(
        source.get("draft_manifest") if source_draft else source.get("manifest")
    )
    presentation = deepcopy(source.get("presentation", {}))
    presentation["display_name"] = name
    now = _utc_now()
    document = {
        "agent_id": target_agent_id,
        "screen_id": target_agent_id,
        "name": name,
        "description": source.get("description", ""),
        "status": "draft",
        "draft_manifest": manifest,
        "source": source.get("source", "manual"),
        "presentation": presentation,
        "editor_state": deepcopy(source.get("editor_state", {})),
        "generation": deepcopy(source.get("generation", {})),
        "validation_errors": deepcopy(source.get("validation_errors", [])),
        "revision": uuid4().hex,
        "duplicated_from": source_agent_id,
        "created_at": now,
        "updated_at": now,
    }
    _collection.insert_one(document)
    return get_draft(target_agent_id) or {}


def restore_version_as_draft(agent_id: str, version: int) -> Optional[dict]:
    """Replace the mutable draft with a copy of an immutable version."""
    published = get_manifest(agent_id, version)
    if published is None:
        return None

    presentation = deepcopy(published.get("presentation", {}))
    restored = save_draft(
        agent_id=agent_id,
        draft_manifest=deepcopy(published["manifest"]),
        description=published.get("description", ""),
        name=(
            published.get("name")
            or presentation.get("display_name")
            or agent_id
        ),
        source=published.get("source", "manual"),
        presentation=presentation,
        editor_state={},
        validation_errors=[],
        approved_manifest=None,
        generation=deepcopy(published.get("generation", {})),
    )
    _collection.update_one(
        {"agent_id": agent_id, "status": "draft"},
        {
            "$set": {"restored_from_version": version},
            "$unset": {"duplicated_from": ""},
        },
    )
    return get_draft(agent_id) or restored


def set_screen_archived(agent_id: str, archived: bool) -> Optional[dict]:
    """Soft-archive or unarchive a screen without modifying its versions."""
    if not screen_exists(agent_id):
        return None
    now = _utc_now()
    update: dict = {
        "$set": {
            "agent_id": agent_id,
            "is_archived": archived,
            "updated_at": now,
        },
        "$setOnInsert": {"created_at": now},
    }
    if archived:
        update["$set"]["archived_at"] = now
    else:
        update["$unset"] = {"archived_at": ""}
    _metadata_collection.update_one({"agent_id": agent_id}, update, upsert=True)
    return _metadata_collection.find_one(
        {"agent_id": agent_id}, projection={"_id": False}
    )


def list_agents() -> list[dict]:
    """Return one library summary per agent, including draft-only screens."""
    published_pipeline = [
        {
            "$match": {
                "status": {"$ne": "draft"},
                "version": {"$type": "number"},
            }
        },
        {"$sort": {"agent_id": ASCENDING, "version": DESCENDING}},
        {
            "$group": {
                "_id": "$agent_id",
                "latest_version": {"$first": "$version"},
                "name": {"$first": "$name"},
                "published_at": {"$first": "$published_at"},
                "version_count": {"$sum": 1},
            }
        },
    ]
    summaries = {
        item["_id"]: {
            "agent_id": item["_id"],
            "latest_version": item.get("latest_version"),
            "name": item.get("name") or "",
            "published_at": item.get("published_at"),
            "version_count": item.get("version_count", 0),
            "has_draft": False,
            "is_archived": False,
        }
        for item in _collection.aggregate(published_pipeline)
    }

    drafts = _collection.find(
        {"status": "draft"},
        projection={
            "_id": False,
            "agent_id": True,
            "name": True,
            "updated_at": True,
            "published_version": True,
            "revision": True,
            "published_revision": True,
        },
    )
    for draft in drafts:
        agent_id = draft["agent_id"]
        summary = summaries.setdefault(
            agent_id,
            {
                "agent_id": agent_id,
                "latest_version": draft.get("published_version"),
                "published_at": None,
                "version_count": 0,
                "has_draft": False,
                "is_archived": False,
            },
        )
        summary.update(
            has_draft=True,
            has_unpublished_changes=(
                draft.get("revision") != draft.get("published_revision")
            ),
            draft_updated_at=draft.get("updated_at"),
            name=draft.get("name", ""),
        )

    metadata = _metadata_collection.find(
        {},
        projection={
            "_id": False,
            "agent_id": True,
            "is_archived": True,
            "archived_at": True,
        },
    )
    for item in metadata:
        summary = summaries.get(item.get("agent_id"))
        if summary is not None:
            summary.update(
                is_archived=bool(item.get("is_archived")),
                archived_at=item.get("archived_at"),
            )

    return [summaries[key] for key in sorted(summaries)]
