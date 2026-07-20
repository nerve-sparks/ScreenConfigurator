"""Unit tests for the validation gate (Step 4).

Run directly (no test framework needed):
    python test_validation.py
Or, if you prefer pytest:
    pytest test_validation.py
"""

import copy

from fastapi import HTTPException

import main
from main import GenerateRequest
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
    "ui_hints": {"field_order": ["to", "subject", "body"]},
}


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
    manifest["ui_hints"] = {}
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("field_order" in error for error in errors)


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


def test_required_naming_missing_field_is_rejected():
    manifest = copy.deepcopy(GOOD_MANIFEST)
    manifest["input_schema"]["required"] = ["to", "cc"]
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("cc" in error for error in errors)


def test_valid_groups_pass():
    manifest = copy.deepcopy(GOOD_MANIFEST)
    manifest["ui_hints"]["groups"] = [
        {"title": "Recipient", "fields": ["to"]},
        {"title": "Message", "fields": ["subject", "body"]},
    ]
    ok, errors = validate_manifest(manifest)
    assert ok, f"expected valid, got: {errors}"


def test_group_naming_missing_field_is_rejected():
    manifest = copy.deepcopy(GOOD_MANIFEST)
    manifest["ui_hints"]["groups"] = [
        {"title": "Recipient", "fields": ["to", "cc"]},
    ]
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("cc" in error and "Recipient" in error for error in errors)


def test_group_without_fields_key_is_rejected_structurally():
    manifest = copy.deepcopy(GOOD_MANIFEST)
    manifest["ui_hints"]["groups"] = [{"title": "Recipient"}]
    ok, errors = validate_manifest(manifest)
    assert not ok
    assert any("structural" in error for error in errors)


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
