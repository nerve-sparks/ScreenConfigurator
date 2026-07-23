"""Tests for compatibility with manifests saved before layout modes existed."""

import main
from main import SaveScreenRequest
from manifest_migrations import upgrade_legacy_layout


def legacy_manifest(groups=None):
    ui_hints = {"field_order": ["to", "subject"]}
    if groups is not None:
        ui_hints["groups"] = groups
    return {
        "input_schema": {
            "type": "object",
            "properties": {
                "to": {"type": "string", "title": "Recipient"},
                "subject": {"type": "string", "title": "Subject"},
            },
            "required": ["to", "subject"],
        },
        "ui_hints": ui_hints,
    }


def test_legacy_single_manifest_gets_single_mode_without_mutating_source():
    source = legacy_manifest()

    upgraded = upgrade_legacy_layout(source)

    assert upgraded["ui_hints"]["mode"] == "single"
    assert upgraded["ui_hints"]["blocks"] == [
        {"id": "field-to", "type": "field", "field": "to"},
        {"id": "field-subject", "type": "field", "field": "subject"},
    ]
    assert "mode" not in source["ui_hints"]
    assert "blocks" not in source["ui_hints"]


def test_legacy_wizard_gets_mode_ids_and_descriptions():
    source = legacy_manifest(
        [
            {"title": "Recipient Details", "fields": ["to"]},
            {"title": "Message", "fields": ["subject"]},
        ]
    )

    upgraded = upgrade_legacy_layout(source)

    assert upgraded["ui_hints"]["mode"] == "wizard"
    assert upgraded["ui_hints"]["groups"] == [
        {
            "id": "recipient-details",
            "title": "Recipient Details",
            "description": "Provide the inputs for recipient details.",
            "fields": ["to"],
            "blocks": [{"id": "field-to", "type": "field", "field": "to"}],
        },
        {
            "id": "message",
            "title": "Message",
            "description": "Provide the inputs for message.",
            "fields": ["subject"],
            "blocks": [
                {"id": "field-subject", "type": "field", "field": "subject"}
            ],
        },
    ]


def test_duplicate_legacy_titles_get_unique_group_ids():
    source = legacy_manifest(
        [
            {"title": "Details", "fields": ["to"]},
            {"title": "Details", "fields": ["subject"]},
        ]
    )

    upgraded = upgrade_legacy_layout(source)

    assert [group["id"] for group in upgraded["ui_hints"]["groups"]] == [
        "details",
        "details-2",
    ]


def test_current_contract_is_not_silently_repaired():
    source = legacy_manifest()
    source["ui_hints"]["mode"] = "wizard"

    upgraded = upgrade_legacy_layout(source)

    assert upgraded == source
    assert "groups" not in upgraded["ui_hints"]


def test_pre_block_current_manifest_gets_field_only_blocks():
    source = legacy_manifest()
    source["ui_hints"]["mode"] = "single"

    upgraded = upgrade_legacy_layout(source)

    assert upgraded["ui_hints"]["blocks"] == [
        {"id": "field-to", "type": "field", "field": "to"},
        {"id": "field-subject", "type": "field", "field": "subject"},
    ]
    assert "blocks" not in source["ui_hints"]


def test_save_route_upgrades_legacy_manifest_before_persisting(monkeypatch):
    captured = {}

    def fake_save(agent_id, manifest, description, source, presentation):
        captured.update(
            agent_id=agent_id,
            manifest=manifest,
            description=description,
            source=source,
            presentation=presentation,
        )
        return 1

    monkeypatch.setattr(main, "save_manifest", fake_save)

    result = main.save_screen(
        SaveScreenRequest(
            manifest=legacy_manifest(),
            description="A legacy email agent",
            name="Legacy Email Agent",
        )
    )

    assert result == {"agent_id": "legacy-email-agent", "version": 1}
    assert captured["manifest"]["ui_hints"]["mode"] == "single"
    assert captured["presentation"]["accent_color"] == "#635bff"


def test_load_route_upgrades_legacy_manifest_in_response(monkeypatch):
    stored = {
        "agent_id": "legacy-email-agent",
        "version": 1,
        "manifest": legacy_manifest(),
    }
    monkeypatch.setattr(main, "get_manifest", lambda agent_id, version: stored)

    result = main.get_screen("legacy-email-agent")

    assert result["manifest"]["ui_hints"]["mode"] == "single"
