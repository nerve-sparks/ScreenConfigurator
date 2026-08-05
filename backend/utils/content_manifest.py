"""Safe, non-interactive content-screen manifest validation.

Content screens deliberately reuse the audited layout block vocabulary while
excluding field blocks. They contain plain text only and never carry HTML,
scripts, custom CSS, identifiers, permissions, or remote references.
"""

from jsonschema import Draft202012Validator

from .meta_schema import (
    CALLOUT_BLOCK_SCHEMA,
    DIVIDER_BLOCK_SCHEMA,
    HEADING_BLOCK_SCHEMA,
    MAX_LAYOUT_BLOCKS,
    PARAGRAPH_BLOCK_SCHEMA,
)
from .validation import _safety_errors


CONTENT_NON_SECTION_BLOCK_SCHEMA = {
    "oneOf": [
        HEADING_BLOCK_SCHEMA,
        PARAGRAPH_BLOCK_SCHEMA,
        DIVIDER_BLOCK_SCHEMA,
        CALLOUT_BLOCK_SCHEMA,
    ]
}

CONTENT_SECTION_BLOCK_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64,
            "pattern": r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
        },
        "type": {"const": "section"},
        "title": {"type": "string", "minLength": 1, "maxLength": 80},
        "description": {"type": "string", "minLength": 1, "maxLength": 240},
        "children": {
            "type": "array",
            "minItems": 1,
            "maxItems": MAX_LAYOUT_BLOCKS,
            "items": CONTENT_NON_SECTION_BLOCK_SCHEMA,
        },
    },
    "required": ["id", "type", "title", "children"],
    "additionalProperties": False,
}

CONTENT_BLOCK_SCHEMA = {
    "oneOf": [
        HEADING_BLOCK_SCHEMA,
        PARAGRAPH_BLOCK_SCHEMA,
        DIVIDER_BLOCK_SCHEMA,
        CALLOUT_BLOCK_SCHEMA,
        CONTENT_SECTION_BLOCK_SCHEMA,
    ]
}

CONTENT_META_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "blocks": {
            "type": "array",
            "minItems": 1,
            "maxItems": MAX_LAYOUT_BLOCKS,
            "items": CONTENT_BLOCK_SCHEMA,
        }
    },
    "required": ["blocks"],
    "additionalProperties": False,
}

Draft202012Validator.check_schema(CONTENT_META_SCHEMA)
_CONTENT_VALIDATOR = Draft202012Validator(CONTENT_META_SCHEMA)


def _flatten_blocks(blocks: list[dict]) -> list[dict]:
    flattened: list[dict] = []
    for block in blocks:
        flattened.append(block)
        if block.get("type") == "section":
            flattened.extend(block.get("children", []))
    return flattened


def validate_content_manifest(manifest) -> tuple[bool, list[str]]:
    """Return readable structural, semantic, and security errors."""
    safety_errors = _safety_errors(manifest)
    if safety_errors:
        return False, safety_errors

    structural_errors = [
        f"structural: {error.json_path}: {error.message}"
        for error in sorted(
            _CONTENT_VALIDATOR.iter_errors(manifest), key=lambda error: error.json_path
        )
    ]
    if structural_errors:
        return False, structural_errors

    flattened = _flatten_blocks(manifest["blocks"])
    if len(flattened) > MAX_LAYOUT_BLOCKS:
        return (
            False,
            [
                "semantic: content manifest supports at most "
                f"{MAX_LAYOUT_BLOCKS} blocks including section children"
            ],
        )

    seen_ids: set[str] = set()
    errors: list[str] = []
    for block in flattened:
        block_id = block["id"]
        if block_id in seen_ids:
            errors.append(
                f"semantic: content block id '{block_id}' appears more than once"
            )
        seen_ids.add(block_id)
        if block.get("type") == "field":
            errors.append("semantic: content screens cannot contain field blocks")

    return len(errors) == 0, errors


def validate_screen_manifest(
    screen_type: str, manifest
) -> tuple[bool, list[str]]:
    """Dispatch to the strict validator for a supported screen type."""
    if screen_type == "content":
        return validate_content_manifest(manifest)
    if screen_type == "form":
        from .validation import validate_manifest

        return validate_manifest(manifest)
    return False, [f"screen_type '{screen_type}' is not supported"]
