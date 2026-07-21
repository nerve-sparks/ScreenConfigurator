"""MongoDB registry: save and load versioned manifests (Step 5).

Documents in agent_screens.manifests are immutable and versioned:
a change is always a NEW document with version + 1, never an update.
"""

import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.errors import DuplicateKeyError

load_dotenv(Path(__file__).resolve().parent / ".env")

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")

# The client connects lazily -- nothing touches the network at import time.
_client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
_collection = _client["agent_screens"]["manifests"]

# How many times save_manifest retries when a concurrent save wins the
# race for a version number (the unique index rejects the loser's insert).
_MAX_SAVE_ATTEMPTS = 3


def ensure_indexes() -> None:
    """Create the registry's indexes (idempotent). Called on app startup.

    The unique compound index is the enforcement of "no duplicate
    versions"; the plain agent_id index speeds up lookups.
    """
    _collection.create_index(
        [("agent_id", ASCENDING), ("version", ASCENDING)], unique=True
    )
    _collection.create_index([("agent_id", ASCENDING)])


def slugify(text: str) -> str:
    """Derive an agent_id: 'Email Agent!' -> 'email-agent'.

    Lowercase; runs of non-alphanumerics become single hyphens; capped
    at 64 chars. Can return '' if the text has no usable characters.
    """
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:64].rstrip("-")


def _next_version(agent_id: str) -> int:
    """(highest existing version for agent_id) + 1, or 1 if none."""
    latest = _collection.find_one(
        {"agent_id": agent_id},
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
    """Insert a new immutable document and return its version.

    Never updates an existing document: every save is an insert with the
    next version number. If a concurrent save claims the same version,
    the unique index rejects this insert and we recompute and retry.
    """
    for _ in range(_MAX_SAVE_ATTEMPTS):
        document = {
            "agent_id": agent_id,
            "version": _next_version(agent_id),
            "manifest": manifest,
            "description": description,
            "source": source,
            "presentation": presentation or {},
            "created_at": datetime.now(timezone.utc)
            .isoformat(timespec="seconds")
            .replace("+00:00", "Z"),
            "status": "active",
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


def get_manifest(agent_id: str, version: Optional[int] = None) -> Optional[dict]:
    """Return the stored document for agent_id, without Mongo's _id.

    A specific version if given, otherwise the highest one.
    Returns None if nothing matches.
    """
    query = {"agent_id": agent_id}
    if version is not None:
        query["version"] = version
        return _collection.find_one(query, projection={"_id": False})
    return _collection.find_one(
        query, projection={"_id": False}, sort=[("version", DESCENDING)]
    )


def list_agents() -> list:
    """Every agent_id with its latest version (handy for a picker later)."""
    pipeline = [
        {"$group": {"_id": "$agent_id", "latest_version": {"$max": "$version"}}},
        {"$sort": {"_id": ASCENDING}},
        {"$project": {"_id": False, "agent_id": "$_id", "latest_version": True}},
    ]
    return list(_collection.aggregate(pipeline))
