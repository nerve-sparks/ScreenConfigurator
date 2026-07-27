"""Standalone frontend export validation and packaging tests."""

from __future__ import annotations

import base64
import json
import re
from copy import deepcopy
from html.parser import HTMLParser
from io import BytesIO
from zipfile import ZipFile

import pytest
from fastapi import HTTPException

import frontend_export
import main
from frontend_export import FrontendExportError, build_frontend_archive

CONTENT_MANIFEST = {
    "blocks": [
        {
            "id": "welcome-heading",
            "type": "heading",
            "level": 2,
            "text": "Before you begin",
        },
        {
            "id": "privacy-note",
            "type": "callout",
            "tone": "information",
            "text": "Your information is handled securely.",
        },
    ]
}

FORM_MANIFEST = {
    "input_schema": {
        "type": "object",
        "properties": {
            "caller_name": {
                "type": "string",
                "title": "Caller name",
            }
        },
        "required": ["caller_name"],
    },
    "ui_hints": {
        "mode": "single",
        "field_order": ["caller_name"],
        "blocks": [
            {
                "id": "field-caller-name",
                "type": "field",
                "field": "caller_name",
            }
        ],
    },
}


def release_fixture(agent_id: str = "inbound-calling-agent", version: int = 2):
    return {
        "_id": "database-id-must-not-export",
        "agent_id": agent_id,
        "version": version,
        "name": "Inbound Calling Agent",
        "description": "Prepare and handle inbound calls.",
        "presentation": {
            "icon": "message",
            "accent_color": "#0e9384",
            "connection_ref": "must-not-export",
        },
        "screen_ids": ["welcome", "call-setup"],
        "start_screen_id": "welcome",
        "project_revision": "private-project-revision",
        "screens": [
            {
                "screen_id": "welcome",
                "screen_type": "content",
                "purpose": "information",
                "name": "Welcome",
                "description": "Prepare for the call.",
                "presentation": {},
                "manifest": deepcopy(CONTENT_MANIFEST),
                "source_revision": "private-screen-revision",
                "generation": {
                    "provider": "private-provider",
                    "model": "private-model",
                },
            },
            {
                "screen_id": "call-setup",
                "screen_type": "form",
                "purpose": "intake",
                "name": "Call setup",
                "description": "Collect caller details.",
                "presentation": {},
                "manifest": deepcopy(FORM_MANIFEST),
                "source_revision": "private-screen-revision-2",
            },
        ],
    }


def archive_files(data: bytes) -> tuple[list[str], dict[str, bytes]]:
    with ZipFile(BytesIO(data)) as archive:
        names = archive.namelist()
        return names, {name: archive.read(name) for name in names}


class _AssetParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.external_assets: list[tuple[str, str]] = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "script" and "src" in attributes:
            self.external_assets.append((tag, attributes["src"]))
        if tag == "link" and "href" in attributes:
            self.external_assets.append((tag, attributes["href"]))


def test_export_is_deterministic_isolated_and_uses_posix_paths(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    first, filename = build_frontend_archive(release_fixture())
    second, repeated_filename = build_frontend_archive(release_fixture())
    names, files = archive_files(first)

    assert first == second
    assert filename == repeated_filename == "inbound-calling-agent-frontend-v2.zip"
    assert names == sorted(names)
    assert all("\\" not in name for name in names)
    assert all(not name.startswith("/") and ".." not in name.split("/") for name in names)
    assert "src/AgentFlow.jsx" in names
    assert "src/styles.css" in names
    assert "preview.html" in names
    assert "node_modules" not in " ".join(names)
    assert not any(name.endswith("/.env") or name == ".env" for name in names)

    public_release = json.loads(files["src/agent-release.json"])
    assert public_release["agent_id"] == "inbound-calling-agent"
    assert public_release["screen_ids"] == ["welcome", "call-setup"]
    serialized = files["src/agent-release.json"].decode("utf-8")
    for private_value in (
        "database-id-must-not-export",
        "private-project-revision",
        "private-screen-revision",
        "private-provider",
        "private-model",
        "connection_ref",
    ):
        assert private_value not in serialized


def test_package_contract_lockfile_and_css_import_are_complete():
    archive, _ = build_frontend_archive(release_fixture())
    _, files = archive_files(archive)
    package = json.loads(files["package.json"])
    package_lock = json.loads(files["package-lock.json"])
    expected_dependencies = {
        "@rjsf/bootstrap-4",
        "@rjsf/core",
        "@rjsf/utils",
        "@rjsf/validator-ajv8",
        "bootstrap",
        "react",
        "react-bootstrap",
        "react-dom",
    }

    assert expected_dependencies == set(package["dependencies"])
    assert {"vite", "@vitejs/plugin-react"} == set(package["devDependencies"])
    assert package["name"] == "inbound-calling-agent-frontend"
    assert package_lock["name"] == package["name"]
    assert package_lock["packages"][""]["name"] == package["name"]
    assert package_lock["packages"][""]["dependencies"] == package["dependencies"]
    main_source = files["src/main.jsx"].decode("utf-8")
    assert main_source.index("bootstrap.min.css") < main_source.index("./styles.css")
    submit_source = files["src/submitAgent.js"].decode("utf-8")
    assert "fetch(" not in submit_source
    assert "status: 'local'" in submit_source


def test_ready_preview_has_one_embedded_release_and_no_external_assets():
    release = release_fixture()
    release["description"] = 'Quotes and </script><script>alert("unsafe")</script>'
    archive, _ = build_frontend_archive(release)
    _, files = archive_files(archive)
    preview = files["preview.html"].decode("utf-8")
    match = re.search(
        r'<script id="agent-release-data" type="application/octet-stream">'
        r"([A-Za-z0-9+/=]+)</script>",
        preview,
    )
    assert match
    assert frontend_export.PREVIEW_RELEASE_PLACEHOLDER not in preview
    embedded = json.loads(base64.b64decode(match.group(1)))
    assert embedded["agent_id"] == "inbound-calling-agent"
    assert embedded["description"] == release["description"]
    assert release["description"] not in preview
    parser = _AssetParser()
    parser.feed(preview)
    assert parser.external_assets == []
    assert "sourceMappingURL" not in preview


@pytest.mark.parametrize(
    "mutation",
    [
        lambda release: release.update(screen_ids=[]),
        lambda release: release.update(status="draft"),
        lambda release: release.update(screen_ids=["welcome", "welcome"]),
        lambda release: release.update(start_screen_id="missing"),
        lambda release: release["screens"].pop(),
        lambda release: release["screens"].append(
            {
                "screen_id": "unexpected",
                "screen_type": "content",
                "purpose": "information",
                "name": "Unexpected",
                "description": "",
                "manifest": CONTENT_MANIFEST,
            }
        ),
        lambda release: release["screens"][0]["manifest"]["blocks"].append(
            {
                "id": "unsafe",
                "type": "paragraph",
                "text": "<script>alert(1)</script>",
            }
        ),
    ],
)
def test_invalid_or_unsafe_stored_releases_are_not_exported(mutation):
    release = release_fixture()
    mutation(release)
    with pytest.raises(FrontendExportError):
        build_frontend_archive(release)


def test_legacy_form_layout_is_normalized_only_in_the_export_copy():
    release = release_fixture()
    legacy = release["screens"][1]["manifest"]
    legacy["ui_hints"].pop("blocks")
    stored_copy = deepcopy(release)

    archive, _ = build_frontend_archive(release)
    _, files = archive_files(archive)
    public_release = json.loads(files["src/agent-release.json"])

    assert "blocks" in public_release["screens"][1]["manifest"]["ui_hints"]
    assert "blocks" not in stored_copy["screens"][1]["manifest"]["ui_hints"]
    assert "blocks" not in release["screens"][1]["manifest"]["ui_hints"]


def test_missing_preview_template_fails_with_a_safe_export_error(monkeypatch, tmp_path):
    monkeypatch.setattr(
        frontend_export,
        "PREVIEW_TEMPLATE_PATH",
        tmp_path / "missing-preview.template.html",
    )
    with pytest.raises(FrontendExportError, match="unavailable"):
        build_frontend_archive(release_fixture())


def test_export_route_loads_only_the_requested_release(monkeypatch):
    release = release_fixture(version=4)
    lookup = []

    def fake_get_release(agent_id, version):
        lookup.append((agent_id, version))
        return release

    monkeypatch.setattr(main, "get_release", fake_get_release)
    response = main.export_agent_release_frontend("inbound-calling-agent", 4)

    assert lookup == [("inbound-calling-agent", 4)]
    assert response.media_type == "application/zip"
    assert response.headers["content-disposition"] == (
        'attachment; filename="inbound-calling-agent-frontend-v4.zip"'
    )
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_export_route_never_falls_back_when_release_is_missing(monkeypatch):
    monkeypatch.setattr(main, "get_release", lambda _agent_id, _version: None)
    with pytest.raises(HTTPException) as error:
        main.export_agent_release_frontend("inbound-calling-agent", 9)
    assert error.value.status_code == 404
