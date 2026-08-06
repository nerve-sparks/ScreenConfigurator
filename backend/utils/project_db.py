"""MongoDB persistence for multi-screen agent projects and releases.

The original ``manifests`` collection remains the source for screen drafts and
legacy screen versions. Project records add ownership and ordered navigation;
immutable release documents contain complete, atomically inserted snapshots.
"""

from copy import deepcopy
from typing import Optional
from uuid import uuid4

from pymongo import ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError

from . import db

MAX_PROJECT_SCREENS = 20

_projects = db._database["agent_projects"]
_releases = db._database["agent_releases"]


def _screen_key(agent_id: str, screen_id: str) -> dict:
    return {"agent_id": agent_id, "screen_id": screen_id}


def ensure_project_indexes() -> None:
    """Create project/release indexes and safely prepare legacy documents."""
    # Existing writers already set screen_id, but older documents may predate it.
    for document in db._collection.find(
        {},
        projection={
            "_id": True,
            "agent_id": True,
            "screen_id": True,
            "screen_type": True,
            "purpose": True,
        },
    ):
        defaults = {}
        if "screen_id" not in document:
            defaults["screen_id"] = document["agent_id"]
        if "screen_type" not in document:
            defaults["screen_type"] = "form"
        if "purpose" not in document:
            defaults["purpose"] = "intake"
        if not defaults:
            continue
        db._collection.update_one(
            {"_id": document["_id"]},
            {"$set": defaults},
        )

    _projects.create_index([("agent_id", ASCENDING)], unique=True)
    _projects.create_index([("is_archived", ASCENDING), ("updated_at", DESCENDING)])
    _releases.create_index(
        [("agent_id", ASCENDING), ("version", ASCENDING)], unique=True
    )
    _releases.create_index(
        [("agent_id", ASCENDING), ("project_revision", ASCENDING)], unique=True
    )

    # Project screen lookups are additive. The legacy unique indexes remain
    # usable for existing one-screen agents; the migration helper below
    # replaces them only when their exact key pattern is present.
    index_info = db._collection.index_information()
    for name, info in list(index_info.items()):
        keys = info.get("key", [])
        if info.get("unique") and keys in (
            [("agent_id", 1), ("version", 1)],
            [("agent_id", 1), ("draft_revision", 1)],
        ):
            db._collection.drop_index(name)

    db._collection.create_index(
        [("agent_id", ASCENDING), ("screen_id", ASCENDING), ("version", ASCENDING)],
        unique=True,
        partialFilterExpression={"version": {"$type": "number"}},
    )
    db._collection.create_index(
        [("agent_id", ASCENDING), ("screen_id", ASCENDING), ("status", ASCENDING)],
        unique=True,
        partialFilterExpression={"status": "draft"},
    )
    db._collection.create_index(
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
    ensure_legacy_projects()
    ensure_legacy_releases()


def ensure_legacy_projects() -> None:
    """Idempotently expose every existing single screen as an agent project."""
    for summary in db.list_agents():
        agent_id = summary["agent_id"]
        if _projects.find_one({"agent_id": agent_id}, {"_id": True}):
            continue
        draft = db.get_draft(agent_id)
        published = db.get_manifest(agent_id)
        source = draft or published or {}
        name = source.get("name") or summary.get("name") or agent_id
        description = source.get("description", "")
        presentation = deepcopy(source.get("presentation", {}))
        now = db._utc_now()
        project = {
            "agent_id": agent_id,
            "name": name,
            "description": description,
            "presentation": presentation,
            "screen_ids": [agent_id],
            "start_screen_id": agent_id,
            "revision": uuid4().hex,
            "latest_release": None,
            "is_archived": bool(summary.get("is_archived")),
            "created_at": source.get("created_at", now),
            "updated_at": source.get("updated_at", now),
            "legacy_screen": True,
        }
        try:
            _projects.insert_one(project)
        except DuplicateKeyError:
            continue


def ensure_legacy_releases() -> None:
    """Snapshot legacy published screen versions as one-screen agent releases."""
    for project in _projects.find(
        {"legacy_screen": True},
        projection={"_id": False},
    ):
        agent_id = project["agent_id"]
        existing_release = _releases.find_one(
            {"agent_id": agent_id},
            projection={"version": True},
            sort=[("version", DESCENDING)],
        )
        if existing_release:
            baseline = {
                "latest_release": existing_release["version"],
                "published_revision": project["revision"],
            }
            _projects.update_one(
                {
                    "agent_id": agent_id,
                    "published_revision": {"$exists": False},
                },
                {"$set": baseline},
            )
            continue
        latest_version = None
        for summary in reversed(db.list_versions(agent_id)):
            published = db.get_manifest(agent_id, summary["version"])
            if not published:
                continue
            published_at = (
                published.get("published_at")
                or published.get("created_at")
                or db._utc_now()
            )
            version = published["version"]
            release = {
                "agent_id": agent_id,
                "version": version,
                "status": "published",
                "name": published.get("name") or project["name"],
                "description": published.get(
                    "description", project.get("description", "")
                ),
                "presentation": deepcopy(
                    published.get("presentation", project.get("presentation", {}))
                ),
                "screen_ids": [agent_id],
                "start_screen_id": agent_id,
                "screens": [
                    {
                        "screen_id": agent_id,
                        "screen_type": "form",
                        "purpose": "intake",
                        "name": published.get("name") or project["name"],
                        "description": published.get("description", ""),
                        "manifest": deepcopy(published["manifest"]),
                        "presentation": deepcopy(
                            published.get("presentation", {})
                        ),
                        "source_revision": published.get(
                            "draft_revision", f"legacy-version-{version}"
                        ),
                        "generation": deepcopy(published.get("generation", {})),
                    }
                ],
                "project_revision": f"legacy-version-{version}",
                "screen_revisions": {
                    agent_id: published.get(
                        "draft_revision", f"legacy-version-{version}"
                    )
                },
                "change_summary": published.get(
                    "change_summary", "Imported legacy screen version"
                ),
                "published_at": published_at,
                "created_at": published_at,
                "legacy_release": True,
            }
            try:
                _releases.insert_one(release)
            except DuplicateKeyError:
                continue
            latest_version = version
        if latest_version is not None:
            _projects.update_one(
                {"agent_id": agent_id},
                {
                    "$set": {
                        "latest_release": latest_version,
                        "published_revision": project["revision"],
                    }
                },
            )


def create_project(
    agent_id: str,
    name: str,
    description: str,
    presentation: Optional[dict] = None,
    scorecard: Optional[dict] = None,
) -> dict:
    now = db._utc_now()
    project = {
        "agent_id": agent_id,
        "name": name,
        "description": description,
        "presentation": presentation or {},
        "scorecard": scorecard or {},
        "screen_ids": [],
        "start_screen_id": None,
        "revision": uuid4().hex,
        "latest_release": None,
        "is_archived": False,
        "created_at": now,
        "updated_at": now,
    }
    _projects.insert_one(project)
    return get_project(agent_id) or {}


def get_project(agent_id: str) -> Optional[dict]:
    return _projects.find_one({"agent_id": agent_id}, projection={"_id": False})


def project_exists(agent_id: str) -> bool:
    return get_project(agent_id) is not None


def set_project_archived(agent_id: str, archived: bool) -> Optional[dict]:
    project = get_project(agent_id)
    if project is None:
        return None
    now = db._utc_now()
    update: dict = {
        "$set": {
            "is_archived": archived,
            "revision": uuid4().hex,
            "updated_at": now,
        }
    }
    if archived:
        update["$set"]["archived_at"] = now
    else:
        update["$unset"] = {"archived_at": ""}
    _projects.update_one({"agent_id": agent_id}, update)
    return get_project(agent_id)


def list_project_screens(agent_id: str, include_archived: bool = True) -> list[dict]:
    query: dict = {"agent_id": agent_id, "status": "draft"}
    if not include_archived:
        query["is_archived"] = {"$ne": True}
    projection = {
        "_id": False,
        "agent_id": True,
        "screen_id": True,
        "screen_type": True,
        "purpose": True,
        "name": True,
        "description": True,
        "presentation": True,
        "revision": True,
        "approved_manifest": True,
        "validation_errors": True,
        "is_archived": True,
        "updated_at": True,
        "created_at": True,
    }
    return list(db._collection.find(query, projection=projection))


def get_project_screen_draft(agent_id: str, screen_id: str) -> Optional[dict]:
    return db._collection.find_one(
        {**_screen_key(agent_id, screen_id), "status": "draft"},
        projection={"_id": False},
    )


def project_screen_exists(agent_id: str, screen_id: str) -> bool:
    return (
        db._collection.find_one(
            _screen_key(agent_id, screen_id), projection={"_id": True}
        )
        is not None
    )


def save_project(
    agent_id: str,
    *,
    name: str,
    description: str,
    presentation: dict,
    screen_ids: list[str],
    start_screen_id: Optional[str],
    expected_revision: str,
) -> Optional[dict]:
    now = db._utc_now()
    result = _projects.update_one(
        {"agent_id": agent_id, "revision": expected_revision},
        {
            "$set": {
                "name": name,
                "description": description,
                "presentation": presentation,
                "screen_ids": screen_ids,
                "start_screen_id": start_screen_id,
                "revision": uuid4().hex,
                "updated_at": now,
            }
        },
    )
    if result.matched_count == 0:
        return None
    return get_project(agent_id)


def save_project_scorecard(agent_id: str, scorecard: dict) -> Optional[dict]:
    """Replace the project's attached agent scorecard (including connection secrets)."""
    project = get_project(agent_id)
    if project is None:
        return None
    now = db._utc_now()
    result = _projects.update_one(
        {"agent_id": agent_id, "revision": project["revision"]},
        {
            "$set": {
                "scorecard": scorecard or {},
                "revision": uuid4().hex,
                "updated_at": now,
            }
        },
    )
    if result.matched_count == 0:
        return None
    return get_project(agent_id)


def add_screen_to_project(agent_id: str, screen_id: str) -> dict:
    project = get_project(agent_id)
    if project is None:
        return {}
    screen_ids = list(project.get("screen_ids", []))
    if screen_id in screen_ids:
        return project
    if len(screen_ids) >= MAX_PROJECT_SCREENS:
        raise ValueError(
            f"An agent project supports at most {MAX_PROJECT_SCREENS} active screens."
        )
    screen_ids.append(screen_id)
    start_screen_id = project.get("start_screen_id") or screen_id
    _projects.update_one(
        {"agent_id": agent_id, "revision": project["revision"]},
        {
            "$set": {
                "screen_ids": screen_ids,
                "start_screen_id": start_screen_id,
                "revision": uuid4().hex,
                "updated_at": db._utc_now(),
            }
        },
    )
    return get_project(agent_id) or {}


def insert_project_screen_draft(
    *,
    agent_id: str,
    screen_id: str,
    screen_type: str,
    purpose: str,
    manifest: dict,
    approved_manifest: Optional[dict],
    name: str,
    description: str,
    source: str,
    presentation: dict,
    editor_state: dict,
    generation: dict,
    validation_errors: list[str],
) -> dict:
    if get_project_screen_draft(agent_id, screen_id) is not None:
        raise DuplicateKeyError(f"Screen '{screen_id}' already exists.")
    now = db._utc_now()
    document = {
        "agent_id": agent_id,
        "screen_id": screen_id,
        "screen_type": screen_type,
        "purpose": purpose,
        "name": name,
        "description": description,
        "status": "draft",
        "draft_manifest": deepcopy(manifest),
        "source": source,
        "presentation": deepcopy(presentation),
        "editor_state": deepcopy(editor_state),
        "generation": deepcopy(generation),
        "validation_errors": deepcopy(validation_errors),
        "revision": uuid4().hex,
        "is_archived": False,
        "created_at": now,
        "updated_at": now,
    }
    if approved_manifest is not None:
        document["approved_manifest"] = deepcopy(approved_manifest)
    db._collection.insert_one(document)
    try:
        add_screen_to_project(agent_id, screen_id)
    except Exception:
        db._collection.delete_one(
            {**_screen_key(agent_id, screen_id), "status": "draft"}
        )
        raise
    return get_project_screen_draft(agent_id, screen_id) or {}


def save_project_screen_draft(
    *,
    agent_id: str,
    screen_id: str,
    manifest: dict,
    approved_manifest: Optional[dict],
    name: str,
    description: str,
    source: str,
    presentation: dict,
    editor_state: dict,
    generation: dict,
    validation_errors: list[str],
) -> Optional[dict]:
    current = get_project_screen_draft(agent_id, screen_id)
    if current is None:
        return None
    revision = uuid4().hex
    update: dict = {
        "$set": {
            "name": name,
            "description": description,
            "draft_manifest": deepcopy(manifest),
            "source": source,
            "presentation": deepcopy(presentation),
            "editor_state": deepcopy(editor_state),
            "generation": deepcopy(generation),
            "validation_errors": deepcopy(validation_errors),
            "revision": revision,
            "updated_at": db._utc_now(),
        }
    }
    if approved_manifest is None:
        update["$unset"] = {"approved_manifest": ""}
    else:
        update["$set"]["approved_manifest"] = deepcopy(approved_manifest)
    db._collection.update_one(
        {**_screen_key(agent_id, screen_id), "status": "draft"},
        update,
    )
    return get_project_screen_draft(agent_id, screen_id)


def duplicate_project_screen(
    agent_id: str, source_screen_id: str, target_screen_id: str, name: str
) -> dict:
    source = get_project_screen_draft(agent_id, source_screen_id)
    if source is None:
        return {}
    presentation = deepcopy(source.get("presentation", {}))
    presentation["display_name"] = name
    editor_state = deepcopy(source.get("editor_state", {}))
    if editor_state:
        editor_state["layoutApproved"] = False
    return insert_project_screen_draft(
        agent_id=agent_id,
        screen_id=target_screen_id,
        screen_type=source.get("screen_type", "form"),
        purpose=source.get("purpose", "intake"),
        manifest=source["draft_manifest"],
        approved_manifest=None,
        name=name,
        description=source.get("description", ""),
        source="manual",
        presentation=presentation,
        editor_state=editor_state,
        generation=deepcopy(source.get("generation", {})),
        validation_errors=deepcopy(source.get("validation_errors", [])),
    )


def duplicate_agent_project(
    source_agent_id: str, target_agent_id: str, name: str
) -> dict:
    """Copy active drafts into a new unpublished project."""
    source_project = get_project(source_agent_id)
    if source_project is None:
        return {}
    if project_exists(target_agent_id):
        raise DuplicateKeyError(f"Agent project '{target_agent_id}' already exists.")

    presentation = deepcopy(source_project.get("presentation", {}))
    presentation["display_name"] = name
    created = create_project(
        target_agent_id,
        name,
        source_project.get("description", ""),
        presentation,
        scorecard=deepcopy(source_project.get("scorecard") or {}),
    )
    id_mapping: dict[str, str] = {}
    try:
        for source_screen_id in source_project.get("screen_ids", []):
            source = get_project_screen_draft(source_agent_id, source_screen_id)
            if source is None and source_screen_id == source_agent_id:
                legacy = db.get_draft(source_agent_id) or db.get_manifest(source_agent_id)
                if legacy:
                    source = {
                        **legacy,
                        "draft_manifest": deepcopy(
                            legacy.get("draft_manifest") or legacy.get("manifest")
                        ),
                        "screen_type": "form",
                        "purpose": "intake",
                    }
            if source is None:
                continue
            target_screen_id = (
                target_agent_id
                if len(source_project.get("screen_ids", [])) == 1
                and source_screen_id == source_agent_id
                else source_screen_id
            )
            id_mapping[source_screen_id] = target_screen_id
            screen_presentation = deepcopy(source.get("presentation", {}))
            if target_screen_id == target_agent_id:
                screen_presentation["display_name"] = name
            editor_state = deepcopy(source.get("editor_state", {}))
            if editor_state:
                editor_state["layoutApproved"] = False
            insert_project_screen_draft(
                agent_id=target_agent_id,
                screen_id=target_screen_id,
                screen_type=source.get("screen_type", "form"),
                purpose=source.get("purpose", "intake"),
                manifest=deepcopy(source["draft_manifest"]),
                approved_manifest=None,
                name=(
                    name
                    if target_screen_id == target_agent_id
                    else source.get("name", target_screen_id)
                ),
                description=source.get("description", ""),
                source="manual",
                presentation=screen_presentation,
                editor_state=editor_state,
                generation=deepcopy(source.get("generation", {})),
                validation_errors=deepcopy(source.get("validation_errors", [])),
            )
        ordered = [
            id_mapping[screen_id]
            for screen_id in source_project.get("screen_ids", [])
            if screen_id in id_mapping
        ]
        start = id_mapping.get(source_project.get("start_screen_id"))
        _projects.update_one(
            {"agent_id": target_agent_id},
            {
                "$set": {
                    "screen_ids": ordered,
                    "start_screen_id": start or (ordered[0] if ordered else None),
                    "revision": uuid4().hex,
                    "updated_at": db._utc_now(),
                    "duplicated_from": source_agent_id,
                }
            },
        )
        return get_project(target_agent_id) or created
    except Exception:
        db._collection.delete_many({"agent_id": target_agent_id})
        _projects.delete_one({"agent_id": target_agent_id})
        raise


def set_project_screen_archived(
    agent_id: str, screen_id: str, archived: bool
) -> Optional[dict]:
    project = get_project(agent_id)
    screen = get_project_screen_draft(agent_id, screen_id)
    if project is None or screen is None:
        return None
    active_ids = list(project.get("screen_ids", []))
    if archived:
        active_ids = [candidate for candidate in active_ids if candidate != screen_id]
    elif screen_id not in active_ids:
        if len(active_ids) >= MAX_PROJECT_SCREENS:
            raise ValueError(
                f"An agent project supports at most {MAX_PROJECT_SCREENS} active screens."
            )
        active_ids.append(screen_id)
    start = project.get("start_screen_id")
    if start not in active_ids:
        start = active_ids[0] if active_ids else None
    now = db._utc_now()
    db._collection.update_one(
        {**_screen_key(agent_id, screen_id), "status": "draft"},
        {
            "$set": {
                "is_archived": archived,
                "updated_at": now,
                **({"archived_at": now} if archived else {}),
            },
            **({"$unset": {"archived_at": ""}} if not archived else {}),
        },
    )
    _projects.update_one(
        {"agent_id": agent_id},
        {
            "$set": {
                "screen_ids": active_ids,
                "start_screen_id": start,
                "revision": uuid4().hex,
                "updated_at": now,
            }
        },
    )
    return get_project_screen_draft(agent_id, screen_id)


def list_projects() -> list[dict]:
    projects = list(_projects.find({}, projection={"_id": False}))
    for project in projects:
        screen_ids = list(project.get("screen_ids", []))
        drafts = list_project_screens(project["agent_id"], include_archived=False)
        project["screen_count"] = len(screen_ids)
        project["approved_screen_count"] = sum(
            1 for screen in drafts if screen.get("approved_manifest") is not None
        )
        project["has_draft"] = bool(drafts)
        if not drafts:
            project["has_unpublished_changes"] = project.get("latest_release") is None
        else:
            project["has_unpublished_changes"] = (
                project.get("published_revision") != project.get("revision")
                or any(
                    screen.get("published_revision") != screen.get("revision")
                    for screen in drafts
                )
            )
    return sorted(projects, key=lambda item: item.get("name", "").lower())


def _next_release_version(agent_id: str) -> int:
    latest = _releases.find_one(
        {"agent_id": agent_id},
        projection={"version": True},
        sort=[("version", DESCENDING)],
    )
    return latest["version"] + 1 if latest else 1


def publish_project_release(
    *,
    project: dict,
    screens: list[dict],
    change_summary: str,
) -> dict:
    existing = _releases.find_one(
        {
            "agent_id": project["agent_id"],
            "project_revision": project["revision"],
        },
        projection={"_id": False},
    )
    if existing:
        return existing

    snapshots = []
    for screen_id in project["screen_ids"]:
        screen = next(item for item in screens if item["screen_id"] == screen_id)
        snapshots.append(
            {
                "screen_id": screen_id,
                "screen_type": screen.get("screen_type", "form"),
                "purpose": screen.get("purpose", "intake"),
                "name": screen.get("name", screen_id),
                "description": screen.get("description", ""),
                "manifest": deepcopy(screen["approved_manifest"]),
                "presentation": deepcopy(screen.get("presentation", {})),
                "source_revision": screen["revision"],
                "generation": deepcopy(screen.get("generation", {})),
            }
        )

    for _ in range(3):
        now = db._utc_now()
        document = {
            "agent_id": project["agent_id"],
            "version": _next_release_version(project["agent_id"]),
            "status": "published",
            "name": project["name"],
            "description": project.get("description", ""),
            "presentation": deepcopy(project.get("presentation", {})),
            "scorecard": deepcopy(project.get("scorecard") or {}),
            "screen_ids": list(project["screen_ids"]),
            "start_screen_id": project["start_screen_id"],
            "screens": snapshots,
            "project_revision": project["revision"],
            "screen_revisions": {
                screen["screen_id"]: screen["revision"] for screen in screens
            },
            "change_summary": change_summary,
            "published_at": now,
            "created_at": now,
        }
        try:
            _releases.insert_one(document)
        except DuplicateKeyError:
            replay = _releases.find_one(
                {
                    "agent_id": project["agent_id"],
                    "project_revision": project["revision"],
                },
                projection={"_id": False},
            )
            if replay:
                return replay
            continue

        _projects.update_one(
            {
                "agent_id": project["agent_id"],
                "revision": project["revision"],
            },
            {
                "$set": {
                    "latest_release": document["version"],
                    "published_revision": project["revision"],
                    "last_published_at": now,
                }
            },
        )
        for screen in screens:
            db._collection.update_one(
                {
                    **_screen_key(project["agent_id"], screen["screen_id"]),
                    "status": "draft",
                    "revision": screen["revision"],
                },
                {
                    "$set": {
                        "published_revision": screen["revision"],
                        "last_published_at": now,
                    }
                },
            )
        document.pop("_id", None)
        return document
    raise RuntimeError("Could not allocate a new agent release version.")


def list_releases(agent_id: str) -> list[dict]:
    projection = {
        "_id": False,
        "agent_id": True,
        "version": True,
        "name": True,
        "change_summary": True,
        "published_at": True,
        "screen_ids": True,
        "start_screen_id": True,
    }
    return list(
        _releases.find(
            {"agent_id": agent_id},
            projection=projection,
            sort=[("version", DESCENDING)],
        )
    )


def get_release(agent_id: str, version: Optional[int] = None) -> Optional[dict]:
    query: dict = {"agent_id": agent_id}
    if version is not None:
        query["version"] = version
        return _releases.find_one(query, projection={"_id": False})
    return _releases.find_one(
        query, projection={"_id": False}, sort=[("version", DESCENDING)]
    )


def restore_release(agent_id: str, version: int) -> Optional[dict]:
    release = get_release(agent_id, version)
    project = get_project(agent_id)
    if release is None or project is None:
        return None

    release_ids = list(release["screen_ids"])
    now = db._utc_now()
    # Screens outside the restored navigation remain recoverable, but become
    # archived instead of silently disappearing from both active and archived
    # workspace lists.
    db._collection.update_many(
        {"agent_id": agent_id, "status": "draft"},
        {"$set": {"is_archived": True, "archived_at": now}},
    )
    for snapshot in release["screens"]:
        screen_id = snapshot["screen_id"]
        existing = get_project_screen_draft(agent_id, screen_id)
        payload = {
            "agent_id": agent_id,
            "screen_id": screen_id,
            "manifest": deepcopy(snapshot["manifest"]),
            "approved_manifest": None,
            "name": snapshot.get("name", screen_id),
            "description": snapshot.get("description", ""),
            "source": "manual",
            "presentation": deepcopy(snapshot.get("presentation", {})),
            "editor_state": {},
            "generation": deepcopy(snapshot.get("generation", {})),
            "validation_errors": [],
        }
        if existing:
            save_project_screen_draft(**payload)
            db._collection.update_one(
                {**_screen_key(agent_id, screen_id), "status": "draft"},
                {
                    "$set": {"is_archived": False},
                    "$unset": {"archived_at": ""},
                },
            )
        else:
            insert_project_screen_draft(
                screen_type=snapshot.get("screen_type", "form"),
                purpose=snapshot.get("purpose", "intake"),
                **payload,
            )

    _projects.update_one(
        {"agent_id": agent_id},
        {
            "$set": {
                "name": release["name"],
                "description": release.get("description", ""),
                "presentation": deepcopy(release.get("presentation", {})),
                "screen_ids": release_ids,
                "start_screen_id": release["start_screen_id"],
                "revision": uuid4().hex,
                "restored_from_release": version,
                "updated_at": now,
            }
        },
    )
    return get_project(agent_id)
