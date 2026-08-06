"""Build deterministic, frontend-only archives from immutable agent releases.

Export requests are deliberately read-only.  All runtime assets are tracked
beside this module so production deployments never depend on the repository's
frontend source tree or on the current working directory.
"""

from __future__ import annotations

import base64
import json
import re
from copy import deepcopy
from io import BytesIO
from pathlib import Path, PurePosixPath
from typing import Any
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from .content_manifest import validate_screen_manifest
from .manifest_migrations import upgrade_legacy_layout
from .scorecard import public_scorecard

EXPORT_TEMPLATE_ROOT = Path(__file__).resolve().parent.parent / "export_templates"
SOURCE_TEMPLATE_ROOT = EXPORT_TEMPLATE_ROOT / "source"
PREVIEW_TEMPLATE_PATH = EXPORT_TEMPLATE_ROOT / "preview.template.html"
PREVIEW_RELEASE_PLACEHOLDER = "__AGENT_RELEASE_BASE64__"

MAX_EXPORT_BYTES = 8 * 1024 * 1024
MAX_SCREENS = 20
ZIP_TIMESTAMP = (2020, 1, 1, 0, 0, 0)
_AGENT_PURPOSES = {
    "form": {"intake", "settings"},
    "content": {"information", "confirmation"},
}
_PUBLIC_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_PRESENTATION_KEYS = {
    "display_name",
    "icon",
    "accent_color",
    "welcome_title",
    "welcome_description",
    "submit_label",
    "show_summary",
}

SOURCE_ARCHIVE_FILES = (
    ".env.example",
    ".gitignore",
    "index.html",
    "package-lock.json",
    "package.json",
    "vite.config.js",
    "src/AgentFlow.jsx",
    "src/App.jsx",
    "src/ContentExperience.jsx",
    "src/FormRenderer.jsx",
    "src/LayoutRenderer.jsx",
    "src/RuntimePrimitives.jsx",
    "src/ScreenExperience.jsx",
    "src/Wizard.jsx",
    "src/layoutBlocks.js",
    "src/main.jsx",
    "src/manifestLayout.js",
    "src/presentation.js",
    "src/releaseLoader.js",
    "src/styles.css",
    "src/submitAgent.js",
)
REQUIRED_TEMPLATE_FILES = SOURCE_ARCHIVE_FILES + (
    "README.template.md",
    "src/agent-release.json",
)


class FrontendExportError(RuntimeError):
    """A safe-to-handle export validation or packaging failure."""


def _json_bytes(value: Any, *, pretty: bool = True) -> bytes:
    try:
        text = json.dumps(
            value,
            ensure_ascii=False,
            indent=2 if pretty else None,
            separators=None if pretty else (",", ":"),
            sort_keys=True,
        )
    except (TypeError, ValueError, OverflowError) as exc:
        raise FrontendExportError("Release data could not be serialized.") from exc
    return f"{text}\n".encode("utf-8")


def _bounded_text(value: Any, field: str, maximum: int, *, required: bool) -> str:
    if not isinstance(value, str):
        raise FrontendExportError(f"Stored release has an invalid {field}.")
    clean = value.strip()
    if required and not clean:
        raise FrontendExportError(f"Stored release has an empty {field}.")
    if len(clean) > maximum:
        raise FrontendExportError(f"Stored release {field} is too long.")
    return clean


def _public_presentation(value: Any) -> dict:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise FrontendExportError("Stored release presentation is invalid.")
    # Only the audited appearance contract is exported. Unknown values such as
    # connector references or future editor metadata are intentionally dropped.
    return {
        key: deepcopy(value[key])
        for key in sorted(_PRESENTATION_KEYS)
        if key in value
        and isinstance(value[key], (str, bool))
        and not isinstance(value[key], (dict, list))
    }


def _validated_manifest(screen_type: str, manifest: Any) -> dict:
    if not isinstance(manifest, dict):
        raise FrontendExportError("Stored release contains an invalid manifest.")
    prepared = (
        upgrade_legacy_layout(deepcopy(manifest))
        if screen_type == "form"
        else deepcopy(manifest)
    )
    valid, errors = validate_screen_manifest(screen_type, prepared)
    if not valid:
        raise FrontendExportError(
            "Stored release contains a screen that no longer passes validation."
        )
    return prepared


def sanitize_release(release: Any) -> dict:
    """Return the exact public release contract used by exported renderers."""
    if not isinstance(release, dict):
        raise FrontendExportError("Stored release is invalid.")

    agent_id = _bounded_text(
        release.get("agent_id"), "agent ID", 80, required=True
    )
    if not _PUBLIC_ID_PATTERN.fullmatch(agent_id):
        raise FrontendExportError("Stored release agent ID is invalid.")
    version = release.get("version")
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        raise FrontendExportError("Stored release version is invalid.")
    if release.get("status", "published") != "published":
        raise FrontendExportError("Only immutable published releases can be exported.")

    screen_ids = release.get("screen_ids")
    screens = release.get("screens")
    if not isinstance(screen_ids, list) or not 1 <= len(screen_ids) <= MAX_SCREENS:
        raise FrontendExportError(
            "Stored release must contain between 1 and 20 ordered screens."
        )
    if (
        any(
            not isinstance(screen_id, str)
            or not _PUBLIC_ID_PATTERN.fullmatch(screen_id)
            for screen_id in screen_ids
        )
        or len(screen_ids) != len(set(screen_ids))
    ):
        raise FrontendExportError(
            "Stored release contains invalid or duplicate ordered screen IDs."
        )
    start_screen_id = release.get("start_screen_id")
    if start_screen_id not in screen_ids:
        raise FrontendExportError("Stored release start screen is invalid.")
    if not isinstance(screens, list):
        raise FrontendExportError("Stored release screen snapshots are invalid.")

    snapshots: dict[str, dict] = {}
    for snapshot in screens:
        if not isinstance(snapshot, dict):
            raise FrontendExportError("Stored release screen snapshot is invalid.")
        screen_id = snapshot.get("screen_id")
        if not isinstance(screen_id, str) or not screen_id:
            raise FrontendExportError("Stored release screen ID is invalid.")
        if screen_id in snapshots:
            raise FrontendExportError(
                f"Stored release contains duplicate screen '{screen_id}'."
            )
        snapshots[screen_id] = snapshot

    if set(snapshots) != set(screen_ids):
        raise FrontendExportError(
            "Stored release snapshots do not match its ordered screen list."
        )

    sanitized_screens: list[dict] = []
    for screen_id in screen_ids:
        snapshot = snapshots[screen_id]
        screen_type = snapshot.get("screen_type", "form")
        if screen_type not in _AGENT_PURPOSES:
            raise FrontendExportError(
                f"Stored release screen '{screen_id}' has an unsupported type."
            )
        purpose = snapshot.get(
            "purpose", "intake" if screen_type == "form" else "information"
        )
        if purpose not in _AGENT_PURPOSES[screen_type]:
            raise FrontendExportError(
                f"Stored release screen '{screen_id}' has an invalid purpose."
            )
        sanitized_screens.append(
            {
                "screen_id": screen_id,
                "screen_type": screen_type,
                "purpose": purpose,
                "name": _bounded_text(
                    snapshot.get("name", screen_id),
                    f"screen '{screen_id}' name",
                    80,
                    required=True,
                ),
                "description": _bounded_text(
                    snapshot.get("description", ""),
                    f"screen '{screen_id}' description",
                    5000,
                    required=False,
                ),
                "presentation": _public_presentation(
                    snapshot.get("presentation", {})
                ),
                "manifest": _validated_manifest(
                    screen_type, snapshot.get("manifest")
                ),
            }
        )

    return {
        "agent_id": agent_id,
        "version": version,
        "name": _bounded_text(
            release.get("name", agent_id), "agent name", 80, required=True
        ),
        "description": _bounded_text(
            release.get("description", ""),
            "agent description",
            5000,
            required=False,
        ),
        "presentation": _public_presentation(release.get("presentation", {})),
        "scorecard": public_scorecard(release.get("scorecard") or {}),
        "screen_ids": list(screen_ids),
        "start_screen_id": start_screen_id,
        "screens": sanitized_screens,
    }


def check_export_templates() -> None:
    missing = [
        path
        for path in REQUIRED_TEMPLATE_FILES
        if not (SOURCE_TEMPLATE_ROOT / Path(path)).is_file()
    ]
    if not PREVIEW_TEMPLATE_PATH.is_file():
        missing.append("preview.template.html")
    if missing:
        raise FrontendExportError("Frontend export templates are unavailable.")

    try:
        package = json.loads(
            (SOURCE_TEMPLATE_ROOT / "package.json").read_text(encoding="utf-8")
        )
        package_lock = json.loads(
            (SOURCE_TEMPLATE_ROOT / "package-lock.json").read_text(encoding="utf-8")
        )
        preview = PREVIEW_TEMPLATE_PATH.read_text(encoding="utf-8")
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise FrontendExportError("Frontend export templates are invalid.") from exc

    if (
        not isinstance(package.get("dependencies"), dict)
        or not isinstance(package.get("devDependencies"), dict)
        or package_lock.get("lockfileVersion") != 3
        or not isinstance(package_lock.get("packages", {}).get(""), dict)
        or preview.count(PREVIEW_RELEASE_PLACEHOLDER) != 1
    ):
        raise FrontendExportError("Frontend export templates are invalid.")


def _custom_package_files(agent_id: str) -> tuple[bytes, bytes]:
    package = json.loads(
        (SOURCE_TEMPLATE_ROOT / "package.json").read_text(encoding="utf-8")
    )
    package_lock = json.loads(
        (SOURCE_TEMPLATE_ROOT / "package-lock.json").read_text(encoding="utf-8")
    )
    package_name = f"{agent_id}-frontend"
    package["name"] = package_name
    package_lock["name"] = package_name
    package_lock["packages"][""]["name"] = package_name
    return _json_bytes(package), _json_bytes(package_lock)


def _zip_info(name: str) -> ZipInfo:
    archive_name = PurePosixPath(name).as_posix()
    if (
        "\\" in archive_name
        or archive_name.startswith("/")
        or ".." in PurePosixPath(archive_name).parts
    ):
        raise FrontendExportError("An export template path is unsafe.")
    info = ZipInfo(archive_name, ZIP_TIMESTAMP)
    info.compress_type = ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = 0o100644 << 16
    return info


def build_frontend_archive(release: dict) -> tuple[bytes, str]:
    """Build a deterministic ZIP and return its bytes and trusted filename."""
    check_export_templates()
    public_release = sanitize_release(release)
    agent_id = public_release["agent_id"]
    version = public_release["version"]
    release_bytes = _json_bytes(public_release)
    package_bytes, lock_bytes = _custom_package_files(agent_id)

    readme = (
        (SOURCE_TEMPLATE_ROOT / "README.template.md")
        .read_text(encoding="utf-8")
        .replace("__AGENT_NAME__", public_release["name"])
        .replace("__AGENT_ID__", agent_id)
        .replace("__RELEASE_VERSION__", str(version))
        .encode("utf-8")
    )
    preview_template = PREVIEW_TEMPLATE_PATH.read_text(encoding="utf-8")
    embedded_release = base64.b64encode(release_bytes).decode("ascii")
    preview = preview_template.replace(
        PREVIEW_RELEASE_PLACEHOLDER, embedded_release
    ).encode("utf-8")

    entries: dict[str, bytes] = {
        path: (SOURCE_TEMPLATE_ROOT / Path(path)).read_bytes()
        for path in SOURCE_ARCHIVE_FILES
    }
    entries.update(
        {
            "README.md": readme,
            "package.json": package_bytes,
            "package-lock.json": lock_bytes,
            "preview.html": preview,
            "src/agent-release.json": release_bytes,
        }
    )

    output = BytesIO()
    try:
        with ZipFile(output, mode="w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
            for name in sorted(entries):
                archive.writestr(_zip_info(name), entries[name])
                if output.tell() > MAX_EXPORT_BYTES:
                    raise FrontendExportError(
                        "Generated frontend archive exceeds the size limit."
                    )
    except FrontendExportError:
        raise
    except (OSError, ValueError) as exc:
        raise FrontendExportError(
            "Frontend archive could not be generated."
        ) from exc

    result = output.getvalue()
    if len(result) > MAX_EXPORT_BYTES:
        raise FrontendExportError(
            "Generated frontend archive exceeds the size limit."
        )
    return result, f"{agent_id}-frontend-v{version}.zip"
