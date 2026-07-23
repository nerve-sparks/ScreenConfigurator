"""Unit tests for the validation gate (Step 4).

Run directly (no test framework needed):
    python test_validation.py
Or, if you prefer pytest:
    pytest test_validation.py
"""

import copy
import os
from unittest.mock import patch

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
        "blocks": [
            {"id": "intro", "type": "heading", "text": "Write an email", "level": 2},
            {
                "id": "intro-copy",
                "type": "paragraph",
                "text": "Provide the message details below.",
            },
            {"id": "field-to", "type": "field", "field": "to"},
            {"id": "field-subject", "type": "field", "field": "subject"},
            {"id": "field-body", "type": "field", "field": "body"},
        ],
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
                "blocks": [
                    {"id": "field-to", "type": "field", "field": "to"},
                ],
            },
            {
                "id": "message",
                "title": "Message",
                "description": "Write the subject and message body.",
                "fields": ["subject", "body"],
                "blocks": [
                    {"id": "field-subject", "type": "field", "field": "subject"},
                    {"id": "field-body", "type": "field", "field": "body"},
                ],
            },
        ],
    }
    return manifest


def test_good_manifest_passes():
    ok, errors = validate_manifest(GOOD_MANIFEST)
    assert ok, f"expected valid, got: {errors}"
    assert errors == []


def test_more_than_thirty_input_fields_are_rejected():
    manifest = copy.deepcopy(GOOD_MANIFEST)
    properties = {
        f"field_{index}": {"type": "string", "title": f"Field {index}"}
        for index in range(31)
    }
    manifest["input_schema"]["properties"] = properties
    manifest["input_schema"]["required"] = []
    manifest["ui_hints"]["field_order"] = list(properties)

    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("too long" in error or "too many" in error for error in errors)


def test_schema_references_are_rejected_before_rendering():
    for reference in (
        "https://untrusted.example/schema.json",
        "#/$defs/remote-field",
    ):
        manifest = copy.deepcopy(GOOD_MANIFEST)
        manifest["input_schema"]["properties"]["subject"] = {"$ref": reference}
        ok, errors = validate_manifest(manifest)
        assert not ok
        assert any("$ref" in error and "not supported" in error for error in errors)


def test_html_and_script_directives_are_rejected():
    unsafe_values = (
        "<img src=x onerror=alert(1)>",
        "javascript:alert(document.cookie)",
        "Click <script>alert(1)</script>",
    )
    for unsafe_value in unsafe_values:
        manifest = copy.deepcopy(GOOD_MANIFEST)
        manifest["input_schema"]["properties"]["subject"][
            "description"
        ] = unsafe_value
        ok, errors = validate_manifest(manifest)
        assert not ok
        assert any("safety" in error for error in errors)


def test_custom_widgets_and_unsupported_field_keywords_are_rejected():
    for key, value in (
        ("ui:widget", "password"),
        ("widget", "rich-text"),
        ("pattern", ".*"),
    ):
        manifest = copy.deepcopy(GOOD_MANIFEST)
        manifest["input_schema"]["properties"]["subject"][key] = value
        ok, errors = validate_manifest(manifest)
        assert not ok
        if "widget" in key:
            assert any("custom widgets" in error for error in errors)
        else:
            assert any("structural" in error for error in errors)


def test_llm_cannot_set_application_identifiers_or_permissions():
    for key, value in (
        ("agent_id", "admin-agent"),
        ("database_id", "system-record"),
        ("permissions", ["admin"]),
    ):
        manifest = copy.deepcopy(GOOD_MANIFEST)
        manifest[key] = value
        ok, errors = validate_manifest(manifest)
        assert not ok
        assert any(
            "application-controlled" in error and key in error for error in errors
        )


def test_only_renderer_supported_types_and_formats_are_accepted():
    invalid_definitions = (
        {"type": "array", "title": "Tags"},
        {"type": "string", "title": "Phone", "format": "phone"},
    )
    for definition in invalid_definitions:
        manifest = copy.deepcopy(GOOD_MANIFEST)
        manifest["input_schema"]["properties"]["subject"] = definition
        ok, errors = validate_manifest(manifest)
        assert not ok
        assert any("structural" in error for error in errors)


def test_field_constraints_must_match_the_declared_type():
    manifest = copy.deepcopy(GOOD_MANIFEST)
    manifest["input_schema"]["properties"]["subject"] = {
        "type": "integer",
        "title": "Priority",
        "enum": ["high", "low"],
    }
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("enum values" in error and "integer" in error for error in errors)


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


def test_all_supported_layout_blocks_pass():
    manifest = copy.deepcopy(GOOD_MANIFEST)
    manifest["ui_hints"]["blocks"] = [
        {
            "id": "message-heading",
            "type": "heading",
            "text": "Compose an email",
            "level": 2,
        },
        {
            "id": "message-copy",
            "type": "paragraph",
            "text": "Add the recipient and message details.",
        },
        {"id": "field-to", "type": "field", "field": "to"},
        {"id": "message-divider", "type": "divider"},
        {
            "id": "message-section",
            "type": "section",
            "title": "Message",
            "description": "Write the content to send.",
            "children": [
                {"id": "field-subject", "type": "field", "field": "subject"},
                {
                    "id": "message-callout",
                    "type": "callout",
                    "text": "Review sensitive details before submitting.",
                    "tone": "warning",
                },
                {"id": "field-body", "type": "field", "field": "body"},
            ],
        },
    ]

    ok, errors = validate_manifest(manifest)

    assert ok, f"expected valid, got: {errors}"


def test_unknown_or_nested_layout_blocks_are_rejected():
    for invalid_block in (
        {"id": "custom", "type": "html", "text": "Unsafe"},
        {
            "id": "outer",
            "type": "section",
            "title": "Outer",
            "children": [
                {
                    "id": "inner",
                    "type": "section",
                    "title": "Inner",
                    "children": [
                        {"id": "field-to", "type": "field", "field": "to"}
                    ],
                }
            ],
        },
    ):
        manifest = copy.deepcopy(GOOD_MANIFEST)
        manifest["ui_hints"]["blocks"] = [invalid_block]
        ok, errors = validate_manifest(manifest)
        assert not ok
        assert any("structural" in error for error in errors)


def test_layout_rejects_duplicate_ids_fields_and_unknown_references():
    cases = (
        (
            [
                {"id": "duplicate", "type": "field", "field": "to"},
                {"id": "duplicate", "type": "field", "field": "subject"},
                {"id": "field-body", "type": "field", "field": "body"},
            ],
            "block id 'duplicate'",
        ),
        (
            [
                {"id": "field-to", "type": "field", "field": "to"},
                {"id": "field-to-again", "type": "field", "field": "to"},
                {"id": "field-body", "type": "field", "field": "body"},
            ],
            "more than one field block",
        ),
        (
            [
                {"id": "field-to", "type": "field", "field": "to"},
                {"id": "field-subject", "type": "field", "field": "subject"},
                {"id": "field-unknown", "type": "field", "field": "unknown"},
            ],
            "references unknown input",
        ),
    )
    for blocks, expected in cases:
        manifest = copy.deepcopy(GOOD_MANIFEST)
        manifest["ui_hints"]["blocks"] = blocks
        ok, errors = validate_manifest(manifest)
        assert not ok
        assert any(expected in error for error in errors)


def test_layout_field_order_must_match_canonical_order():
    manifest = copy.deepcopy(GOOD_MANIFEST)
    manifest["ui_hints"]["blocks"] = [
        {"id": "field-subject", "type": "field", "field": "subject"},
        {"id": "field-to", "type": "field", "field": "to"},
        {"id": "field-body", "type": "field", "field": "body"},
    ]

    ok, errors = validate_manifest(manifest)

    assert not ok
    assert any("field-block order" in error for error in errors)


def test_layout_text_rejects_html_and_script_directives():
    for unsafe_text in ("<strong>Unsafe</strong>", "onclick=steal()"):
        manifest = copy.deepcopy(GOOD_MANIFEST)
        manifest["ui_hints"]["blocks"][0]["text"] = unsafe_text
        ok, errors = validate_manifest(manifest)
        assert not ok
        assert any("safety" in error for error in errors)


def test_layout_block_ids_and_properties_are_strict():
    invalid_blocks = (
        {"id": "Not Safe", "type": "divider"},
        {"id": f"a{'b' * 64}", "type": "divider"},
        {"id": "extra-setting", "type": "divider", "className": "wide"},
        {
            "id": "bad-level",
            "type": "heading",
            "text": "Heading",
            "level": 1,
        },
        {
            "id": "bad-tone",
            "type": "callout",
            "text": "Callout",
            "tone": "danger",
        },
    )

    for invalid_block in invalid_blocks:
        manifest = copy.deepcopy(GOOD_MANIFEST)
        manifest["ui_hints"]["blocks"].insert(0, invalid_block)
        ok, errors = validate_manifest(manifest)
        assert not ok
        assert any("structural" in error for error in errors)


def test_layout_text_limits_are_enforced():
    invalid_blocks = (
        {
            "id": "long-heading",
            "type": "heading",
            "text": "h" * 121,
            "level": 2,
        },
        {"id": "long-paragraph", "type": "paragraph", "text": "p" * 1_001},
        {
            "id": "long-callout",
            "type": "callout",
            "text": "c" * 1_001,
            "tone": "information",
        },
        {
            "id": "long-section-title",
            "type": "section",
            "title": "s" * 81,
            "children": [{"id": "section-copy", "type": "paragraph", "text": "Copy"}],
        },
        {
            "id": "long-section-description",
            "type": "section",
            "title": "Section",
            "description": "d" * 241,
            "children": [{"id": "section-note", "type": "paragraph", "text": "Note"}],
        },
    )

    for invalid_block in invalid_blocks:
        manifest = copy.deepcopy(GOOD_MANIFEST)
        manifest["ui_hints"]["blocks"].insert(0, invalid_block)
        ok, errors = validate_manifest(manifest)
        assert not ok
        assert any("structural" in error for error in errors)


def test_layout_rejects_more_than_one_hundred_blocks():
    manifest = copy.deepcopy(GOOD_MANIFEST)
    manifest["ui_hints"]["blocks"] = [
        {"id": f"divider-{index}", "type": "divider"} for index in range(98)
    ] + [
        {"id": "field-to", "type": "field", "field": "to"},
        {"id": "field-subject", "type": "field", "field": "subject"},
        {"id": "field-body", "type": "field", "field": "body"},
    ]

    ok, errors = validate_manifest(manifest)

    assert not ok
    assert any("too long" in error or "at most" in error for error in errors)


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


def test_wizard_requires_group_blocks_and_rejects_top_level_blocks():
    manifest = wizard_manifest()
    del manifest["ui_hints"]["groups"][0]["blocks"]
    manifest["ui_hints"]["blocks"] = [
        {"id": "field-to-top", "type": "field", "field": "to"}
    ]

    ok, errors = validate_manifest(manifest)

    assert not ok
    assert any("groups[0].blocks is required" in error for error in errors)
    assert any("ui_hints.blocks must be omitted" in error for error in errors)


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


def test_generate_route_sanitizes_llm_failures():
    cases = (
        (
            main.LLMConfigurationError("secret gateway configuration"),
            503,
            "not configured",
        ),
        (main.LLMTimeoutError("secret provider timeout"), 504, "timed out"),
        (
            main.LLMOutputError("secret malformed provider output"),
            502,
            "invalid screen definition",
        ),
        (main.LLMProviderError("secret api_key=abc123"), 502, "request failed"),
    )
    original = main.generate_schema
    try:
        for provider_error, status_code, expected_detail in cases:
            def raise_provider_error(_description, error=provider_error):
                raise error

            main.generate_schema = raise_provider_error
            raised = None
            try:
                main.generate(GenerateRequest(description="an email agent"))
            except HTTPException as exc:
                raised = exc
            assert raised is not None, "expected HTTPException to be raised"
            assert raised.status_code == status_code
            assert expected_detail in raised.detail
            assert "secret" not in raised.detail
            assert "abc123" not in raised.detail
    finally:
        main.generate_schema = original


def test_generation_metadata_records_model_and_prompt_version():
    with patch.dict(
        os.environ,
        {
            "LITE_LLM_ENABLE": "true",
            "LITE_LLM_MODEL_GEMINI": "gemini/gemini-3.5-flash",
        },
    ):
        metadata = main._generation_metadata()

    assert metadata == {
        "provider": "litellm_gateway",
        "model": "gemini/gemini-3.5-flash",
        "prompt_version": "3",
    }


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
