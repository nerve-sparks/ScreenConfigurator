"""Unit tests for the validation gate (Step 4).

Run directly (no test framework needed):
    python test_validation.py
Or, if you prefer pytest:
    pytest test_validation.py
"""

import copy

from fastapi import HTTPException
from pymongo.errors import PyMongoError

import main
from main import GenerateRequest, ScreenPresentation, ValidateManifestRequest
from validation import validate_manifest

GOOD_MANIFEST = {
    "input_schema": {
        "type": "object",
        "properties": {
            "to": {"type": "string", "format": "email", "title": "Recipient"},
            "subject": {"type": "string", "title": "Subject"},
            "body": {"type": "string", "title": "Message"},
        },
        "required": ["to", "subject", "body"],
    },
    "ui_hints": {
        "mode": "single",
        "field_order": ["to", "subject", "body"],
    },
}


def wizard_manifest() -> dict:
    manifest = copy.deepcopy(GOOD_MANIFEST)
    manifest["ui_hints"] = {
        "mode": "wizard",
        "field_order": ["to", "subject", "body"],
        "groups": [
            {
                "id": "recipient",
                "title": "Recipient",
                "description": "Choose who should receive the email.",
                "fields": ["to"],
            },
            {
                "id": "message",
                "title": "Message",
                "description": "Write the subject and message body.",
                "fields": ["subject", "body"],
            },
        ],
    }
    return manifest


def test_good_manifest_passes():
    ok, errors = validate_manifest(GOOD_MANIFEST)
    assert ok, f"expected valid, got: {errors}"
    assert errors == []


def test_missing_input_schema_is_rejected():
    ok, errors = validate_manifest({"ui_hints": {"field_order": []}})
    assert not ok
    assert any("input_schema" in error for error in errors)


def test_non_object_input_schema_type_is_rejected():
    manifest = copy.deepcopy(GOOD_MANIFEST)
    manifest["input_schema"]["type"] = "array"
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("structural" in error for error in errors)


def test_missing_field_order_is_rejected():
    manifest = copy.deepcopy(GOOD_MANIFEST)
    del manifest["ui_hints"]["field_order"]
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("field_order" in error for error in errors)


def test_missing_mode_is_rejected():
    manifest = copy.deepcopy(GOOD_MANIFEST)
    del manifest["ui_hints"]["mode"]
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("mode" in error for error in errors)


def test_unknown_mode_is_rejected():
    manifest = copy.deepcopy(GOOD_MANIFEST)
    manifest["ui_hints"]["mode"] = "tabs"
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("single" in error and "wizard" in error for error in errors)


def test_duplicate_name_in_field_order_is_rejected():
    manifest = copy.deepcopy(GOOD_MANIFEST)
    manifest["ui_hints"]["field_order"] = ["to", "to", "subject", "body"]
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("more than once" in error for error in errors)


def test_field_order_naming_missing_field_is_rejected():
    manifest = copy.deepcopy(GOOD_MANIFEST)
    manifest["ui_hints"]["field_order"] = ["to", "subject", "body", "attachment"]
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("attachment" in error for error in errors)


def test_property_missing_from_field_order_is_rejected():
    manifest = copy.deepcopy(GOOD_MANIFEST)
    manifest["ui_hints"]["field_order"] = ["to", "subject"]
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("body" in error and "missing" in error for error in errors)


def test_required_naming_missing_field_is_rejected():
    manifest = copy.deepcopy(GOOD_MANIFEST)
    manifest["input_schema"]["required"] = ["to", "cc"]
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("cc" in error for error in errors)


def test_duplicate_required_field_is_rejected():
    manifest = copy.deepcopy(GOOD_MANIFEST)
    manifest["input_schema"]["required"] = ["to", "to"]
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("required" in error and "more than once" in error for error in errors)


def test_valid_groups_pass():
    manifest = wizard_manifest()
    ok, errors = validate_manifest(manifest)
    assert ok, f"expected valid, got: {errors}"


def test_single_mode_rejects_groups():
    manifest = copy.deepcopy(GOOD_MANIFEST)
    manifest["ui_hints"]["groups"] = wizard_manifest()["ui_hints"]["groups"]
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("must be omitted" in error for error in errors)


def test_wizard_mode_requires_groups():
    manifest = copy.deepcopy(GOOD_MANIFEST)
    manifest["ui_hints"]["mode"] = "wizard"
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("groups is required" in error for error in errors)


def test_wizard_mode_requires_at_least_two_groups():
    manifest = wizard_manifest()
    manifest["ui_hints"]["groups"] = [
        {
            "id": "all-inputs",
            "title": "All inputs",
            "description": "Provide all required email inputs.",
            "fields": ["to", "subject", "body"],
        }
    ]
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("at least two groups" in error for error in errors)


def test_wizard_mode_rejects_more_than_five_groups():
    manifest = wizard_manifest()
    manifest["ui_hints"]["groups"] = [
        {
            "id": f"group-{index}",
            "title": f"Group {index}",
            "description": f"Collect the inputs for group {index}.",
            "fields": ["to"],
        }
        for index in range(1, 7)
    ]
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("at most five groups" in error for error in errors)


def test_group_naming_missing_field_is_rejected():
    manifest = wizard_manifest()
    manifest["ui_hints"]["groups"][0]["fields"].append("cc")
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("cc" in error and "Recipient" in error for error in errors)


def test_group_without_fields_key_is_rejected_structurally():
    manifest = wizard_manifest()
    del manifest["ui_hints"]["groups"][0]["fields"]
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("structural" in error for error in errors)


def test_group_without_description_is_rejected_structurally():
    manifest = wizard_manifest()
    del manifest["ui_hints"]["groups"][0]["description"]
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("description" in error for error in errors)


def test_empty_group_is_rejected_structurally():
    manifest = wizard_manifest()
    manifest["ui_hints"]["groups"][0]["fields"] = []
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("non-empty" in error for error in errors)


def test_invalid_group_id_is_rejected_structurally():
    manifest = wizard_manifest()
    manifest["ui_hints"]["groups"][0]["id"] = "Recipient Details"
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("does not match" in error for error in errors)


def test_duplicate_group_id_is_rejected():
    manifest = wizard_manifest()
    manifest["ui_hints"]["groups"][1]["id"] = "recipient"
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("id 'recipient' more than once" in error for error in errors)


def test_field_repeated_within_group_is_rejected():
    manifest = wizard_manifest()
    manifest["ui_hints"]["groups"][1]["fields"] = ["subject", "subject", "body"]
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("Message" in error and "more than once" in error for error in errors)


def test_field_assigned_to_multiple_groups_is_rejected():
    manifest = wizard_manifest()
    manifest["ui_hints"]["groups"][0]["fields"].append("subject")
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("subject" in error and "both group" in error for error in errors)


def test_unassigned_wizard_field_is_rejected():
    manifest = wizard_manifest()
    manifest["ui_hints"]["groups"][1]["fields"] = ["subject"]
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("body" in error and "not assigned" in error for error in errors)


def test_group_order_must_match_global_field_order():
    manifest = wizard_manifest()
    manifest["ui_hints"]["field_order"] = ["subject", "to", "body"]
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("exactly equal" in error for error in errors)


def test_generate_route_returns_manifest_when_valid():
    original = main.generate_schema
    main.generate_schema = lambda description: copy.deepcopy(GOOD_MANIFEST)
    try:
        result = main.generate(GenerateRequest(description="an email agent"))
        assert result == GOOD_MANIFEST
    finally:
        main.generate_schema = original


def test_generate_route_returns_422_on_bad_llm_output():
    broken = copy.deepcopy(GOOD_MANIFEST)
    broken["ui_hints"]["field_order"] = ["to", "nope"]

    original = main.generate_schema
    main.generate_schema = lambda description: broken
    try:
        raised = None
        try:
            main.generate(GenerateRequest(description="an email agent"))
        except HTTPException as exc:
            raised = exc
        assert raised is not None, "expected HTTPException to be raised"
        assert raised.status_code == 422
        assert raised.detail["errors"], "expected a non-empty error list"
    finally:
        main.generate_schema = original


def test_validate_route_returns_validated_manifest():
    result = main.validate_screen(
        ValidateManifestRequest(manifest=copy.deepcopy(GOOD_MANIFEST))
    )

    assert result == {"valid": True, "manifest": GOOD_MANIFEST}


def test_validate_route_returns_422_for_invalid_reviewed_manifest():
    broken = copy.deepcopy(GOOD_MANIFEST)
    broken["ui_hints"]["field_order"] = ["to", "unknown"]

    raised = None
    try:
        main.validate_screen(ValidateManifestRequest(manifest=broken))
    except HTTPException as exc:
        raised = exc

    assert raised is not None, "expected HTTPException to be raised"
    assert raised.status_code == 422
    assert raised.detail["message"] == "Manifest failed validation."
    assert raised.detail["errors"]


def test_presentation_rejects_invalid_accent_and_icon():
    for values in (
        {"accent_color": "purple"},
        {"icon": "robot"},
        {"submit_label": ""},
    ):
        raised = None
        try:
            ScreenPresentation(**values)
        except ValueError as exc:
            raised = exc
        assert raised is not None


def test_presentation_accepts_human_controlled_branding():
    presentation = ScreenPresentation(
        display_name="Research Copilot",
        icon="compass",
        accent_color="#0e9384",
        welcome_title="Plan your research",
        welcome_description="Tell us what you need to investigate.",
        submit_label="Create brief",
        show_summary=False,
    )

    assert presentation.model_dump()["display_name"] == "Research Copilot"
    assert presentation.model_dump()["show_summary"] is False


def test_list_screens_returns_latest_registry_entries():
    original = main.list_agents
    main.list_agents = lambda: [
        {"agent_id": "email-agent", "latest_version": 3},
        {"agent_id": "research-agent", "latest_version": 1},
    ]
    try:
        assert main.list_screens() == {
            "screens": [
                {"agent_id": "email-agent", "latest_version": 3},
                {"agent_id": "research-agent", "latest_version": 1},
            ]
        }
    finally:
        main.list_agents = original


def test_list_screens_reports_database_failures():
    original = main.list_agents
    main.list_agents = lambda: (_ for _ in ()).throw(PyMongoError("offline"))
    try:
        raised = None
        try:
            main.list_screens()
        except HTTPException as exc:
            raised = exc
        assert raised is not None
        assert raised.status_code == 503
        assert "Database error" in raised.detail
    finally:
        main.list_agents = original


if __name__ == "__main__":
    tests = [
        value
        for name, value in sorted(globals().items())
        if name.startswith("test_") and callable(value)
    ]
    for test in tests:
        test()
        print(f"PASS {test.__name__}")
    print(f"\nAll {len(tests)} tests passed.")
