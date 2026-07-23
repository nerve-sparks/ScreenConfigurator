"""Structural, semantic, and safety validation for every manifest.

Nothing is stored or rendered unless validate_manifest says it is OK.
Generic by design -- this module knows the manifest contract, never any
specific agent.
"""

import re

from jsonschema import Draft202012Validator

from meta_schema import MAX_INPUT_FIELDS, MAX_LAYOUT_BLOCKS, META_SCHEMA

# Fail loudly at import time if the meta-schema itself is ever broken.
Draft202012Validator.check_schema(META_SCHEMA)

_VALIDATOR = Draft202012Validator(META_SCHEMA)

_REFERENCE_KEYS = {"$ref", "$dynamicRef", "$recursiveRef"}
_UNSUPPORTED_WIDGET_KEYS = {
    "ui:widget",
    "widget",
    "widgets",
    "ui_schema",
    "uischema",
}
_APPLICATION_OWNED_KEYS = {
    "agent_id",
    "screen_id",
    "database_id",
    "owner_id",
    "permissions",
    "roles",
    "access_control",
}
_RESERVED_FIELD_NAMES = {"__proto__", "constructor", "prototype"}
_HTML_TAG = re.compile(r"<\s*/?\s*[a-zA-Z][^>]*>")
_SCRIPT_DIRECTIVE = re.compile(r"(?:javascript\s*:|\bon[a-z]+\s*=)", re.IGNORECASE)


def _value_matches_type(value, field_type: str) -> bool:
    """Match JSON scalar types without treating booleans as integers."""
    if field_type == "string":
        return isinstance(value, str)
    if field_type == "boolean":
        return isinstance(value, bool)
    if field_type == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _safety_errors(value, path: str = "$") -> list[str]:
    """Reject executable or externally resolved content before rendering.

    JSON Schema references and custom widgets make the renderer interpret
    provider-controlled behavior instead of plain data. HTML and script-like
    strings are also rejected even though React normally escapes text; this
    keeps the stored contract safe for future renderers and exports.
    """
    errors: list[str] = []
    if isinstance(value, dict):
        for key, nested in value.items():
            key_text = str(key)
            nested_path = f"{path}.{key_text}"
            if key_text in _REFERENCE_KEYS:
                errors.append(
                    f"safety: {nested_path}: schema references are not supported"
                )
            if key_text.lower() in _UNSUPPORTED_WIDGET_KEYS:
                errors.append(
                    f"safety: {nested_path}: custom widgets are not supported"
                )
            if path == "$" and key_text.lower() in _APPLICATION_OWNED_KEYS:
                errors.append(
                    f"safety: {nested_path}: identifiers and permissions are "
                    "application-controlled"
                )
            errors.extend(_safety_errors(nested, nested_path))
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            errors.extend(_safety_errors(nested, f"{path}[{index}]"))
    elif isinstance(value, str):
        if _HTML_TAG.search(value):
            errors.append(f"safety: {path}: HTML markup is not allowed")
        if _SCRIPT_DIRECTIVE.search(value):
            errors.append(f"safety: {path}: script directives are not allowed")
    return errors


def _structural_errors(manifest) -> list[str]:
    """Layer 1: validate the manifest against the meta-schema."""
    return [
        f"structural: {error.json_path}: {error.message}"
        for error in sorted(_VALIDATOR.iter_errors(manifest), key=lambda e: e.json_path)
    ]


def _flatten_blocks(blocks: list[dict]) -> list[dict]:
    """Return blocks in visual order, including section children."""
    flattened = []
    for block in blocks:
        flattened.append(block)
        if block["type"] == "section":
            flattened.extend(block["children"])
    return flattened


def _validate_layout_blocks(
    blocks: list[dict],
    *,
    properties: dict,
    expected_fields: list[str],
    path: str,
    seen_block_ids: set[str],
) -> tuple[list[str], list[str], int]:
    """Validate one screen/step layout and return field order + block count."""
    errors: list[str] = []
    field_references: list[str] = []
    flattened = _flatten_blocks(blocks)

    for block in flattened:
        block_id = block["id"]
        if block_id in seen_block_ids:
            errors.append(
                f"semantic: layout block id '{block_id}' appears more than once"
            )
        seen_block_ids.add(block_id)

        if block["type"] != "field":
            continue
        field_name = block["field"]
        field_references.append(field_name)
        if field_name not in properties:
            errors.append(
                f"semantic: {path} field block '{block_id}' references unknown "
                f"input '{field_name}'"
            )

    seen_fields: set[str] = set()
    for field_name in field_references:
        if field_name in seen_fields:
            errors.append(
                f"semantic: {path} contains more than one field block for "
                f"'{field_name}'"
            )
        seen_fields.add(field_name)

    if field_references != expected_fields:
        errors.append(
            f"semantic: {path} field-block order must exactly equal its field order"
        )

    return errors, field_references, len(flattened)


def _semantic_errors(manifest: dict) -> list[str]:
    """Layer 2: cross-reference rules the meta-schema cannot express.

    Only called on a structurally valid manifest, so the shape accessed
    here is guaranteed to exist.

    Note on duplicates: JSON parsing collapses duplicate keys inside
    input_schema.properties (the last one silently wins), so a duplicated
    field name is only observable as a duplicate entry in field_order --
    which is exactly where we check for it.
    """
    errors = []
    properties = manifest["input_schema"]["properties"]
    required = manifest["input_schema"].get("required", [])
    ui_hints = manifest["ui_hints"]
    field_order = ui_hints["field_order"]
    mode = ui_hints["mode"]

    if len(properties) > MAX_INPUT_FIELDS:
        errors.append(
            f"semantic: input_schema.properties supports at most "
            f"{MAX_INPUT_FIELDS} fields"
        )

    for name, definition in properties.items():
        field_type = definition["type"]
        field_format = definition.get("format")
        if name in _RESERVED_FIELD_NAMES:
            errors.append(
                f"semantic: input field name '{name}' is reserved and cannot be used"
            )
        if field_format is not None and field_type != "string":
            errors.append(
                f"semantic: input field '{name}' uses format '{field_format}' "
                "but is not a string"
            )
        if "contentMediaType" in definition and field_format != "data-url":
            errors.append(
                f"semantic: input field '{name}' may use contentMediaType only "
                "with the data-url format"
            )
        if any(key in definition for key in ("minLength", "maxLength")):
            if field_type != "string":
                errors.append(
                    f"semantic: input field '{name}' uses string length limits "
                    "but is not a string"
                )
            elif definition.get("minLength", 0) > definition.get(
                "maxLength", 10_000
            ):
                errors.append(
                    f"semantic: input field '{name}' has minLength greater "
                    "than maxLength"
                )
        if any(key in definition for key in ("minimum", "maximum", "multipleOf")):
            if field_type not in {"number", "integer"}:
                errors.append(
                    f"semantic: input field '{name}' uses numeric limits but "
                    "is not numeric"
                )
            elif definition.get("minimum", float("-inf")) > definition.get(
                "maximum", float("inf")
            ):
                errors.append(
                    f"semantic: input field '{name}' has minimum greater than maximum"
                )

        enum_values = definition.get("enum")
        if enum_values:
            if not all(
                _value_matches_type(item, field_type) for item in enum_values
            ):
                errors.append(
                    f"semantic: input field '{name}' has enum values that do not "
                    f"match type '{field_type}'"
                )

    seen = set()
    for name in field_order:
        if name in seen:
            errors.append(
                f"semantic: ui_hints.field_order lists '{name}' more than once"
            )
        seen.add(name)

    for name in field_order:
        if name not in properties:
            errors.append(
                f"semantic: ui_hints.field_order names '{name}', "
                "which is not in input_schema.properties"
            )

    for name in properties:
        if name not in seen:
            errors.append(
                f"semantic: input_schema.properties defines '{name}', "
                "which is missing from ui_hints.field_order"
            )

    seen_required = set()
    for name in required:
        if name in seen_required:
            errors.append(
                f"semantic: input_schema.required lists '{name}' more than once"
            )
        seen_required.add(name)
        if name not in properties:
            errors.append(
                f"semantic: input_schema.required names '{name}', "
                "which is not in input_schema.properties"
            )

    groups = ui_hints.get("groups")
    top_level_blocks = ui_hints.get("blocks")
    seen_block_ids: set[str] = set()
    if mode == "single":
        if groups:
            errors.append(
                "semantic: ui_hints.groups must be omitted when "
                "ui_hints.mode is 'single'"
            )
        if not top_level_blocks:
            errors.append(
                "semantic: ui_hints.blocks is required when ui_hints.mode is 'single'"
            )
            return errors
        block_errors, block_fields, block_count = _validate_layout_blocks(
            top_level_blocks,
            properties=properties,
            expected_fields=field_order,
            path="ui_hints.blocks",
            seen_block_ids=seen_block_ids,
        )
        errors.extend(block_errors)
        if block_count > MAX_LAYOUT_BLOCKS:
            errors.append(
                f"semantic: layout supports at most {MAX_LAYOUT_BLOCKS} blocks"
            )
        if set(block_fields) != set(properties):
            errors.append(
                "semantic: every input property must appear in exactly one field block"
            )
        return errors

    # Structural validation restricts mode to single/wizard, so reaching
    # this point means mode == "wizard".
    if not groups:
        errors.append(
            "semantic: ui_hints.groups is required when ui_hints.mode is 'wizard'"
        )
        return errors
    if top_level_blocks:
        errors.append(
            "semantic: ui_hints.blocks must be omitted when ui_hints.mode is 'wizard'"
        )

    if len(groups) < 2:
        errors.append("semantic: wizard mode requires at least two groups")
    if len(groups) > 5:
        errors.append("semantic: wizard mode supports at most five groups")

    seen_group_ids = set()
    field_owner = {}
    flattened_fields = []
    flattened_block_fields = []
    total_block_count = 0
    has_group_reference_error = False

    for index, group in enumerate(groups):
        group_id = group["id"]
        group_title = group["title"]
        if group_id in seen_group_ids:
            errors.append(
                f"semantic: ui_hints.groups uses id '{group_id}' more than once"
            )
        seen_group_ids.add(group_id)

        seen_in_group = set()
        for name in group["fields"]:
            flattened_fields.append(name)
            if name in seen_in_group:
                errors.append(
                    f"semantic: ui_hints.groups[{index}] ('{group_title}') "
                    f"lists '{name}' more than once"
                )
                has_group_reference_error = True
                continue
            seen_in_group.add(name)

            if name not in properties:
                errors.append(
                    f"semantic: ui_hints.groups[{index}] ('{group_title}') "
                    f"names '{name}', which is not in input_schema.properties"
                )
                has_group_reference_error = True

            if name in field_owner:
                errors.append(
                    f"semantic: field '{name}' appears in both group "
                    f"'{field_owner[name]}' and group '{group_id}'"
                )
                has_group_reference_error = True
            else:
                field_owner[name] = group_id

        group_blocks = group.get("blocks")
        if not group_blocks:
            errors.append(
                f"semantic: ui_hints.groups[{index}].blocks is required"
            )
        else:
            block_errors, block_fields, block_count = _validate_layout_blocks(
                group_blocks,
                properties=properties,
                expected_fields=group["fields"],
                path=f"ui_hints.groups[{index}].blocks",
                seen_block_ids=seen_block_ids,
            )
            errors.extend(block_errors)
            flattened_block_fields.extend(block_fields)
            total_block_count += block_count

    for name in properties:
        if name not in field_owner:
            errors.append(
                f"semantic: input field '{name}' is not assigned to any wizard group"
            )
            has_group_reference_error = True

    # A single ordering invariant avoids two competing sources of truth in
    # the renderer: group order + group field order must be the global order.
    if not has_group_reference_error and flattened_fields != field_order:
        errors.append(
            "semantic: concatenating wizard group fields must exactly equal "
            "ui_hints.field_order"
        )
    if flattened_block_fields != field_order:
        errors.append(
            "semantic: concatenating wizard field blocks must exactly equal "
            "ui_hints.field_order"
        )
    if total_block_count > MAX_LAYOUT_BLOCKS:
        errors.append(
            f"semantic: layout supports at most {MAX_LAYOUT_BLOCKS} blocks"
        )

    return errors


def validate_manifest(manifest) -> tuple[bool, list[str]]:
    """Validate a manifest. Returns (ok, errors) with readable error strings.

    Structural errors are returned on their own: if the shape is wrong,
    the semantic layer cannot safely (or meaningfully) run.
    """
    errors = _safety_errors(manifest)
    if errors:
        return False, errors

    errors = _structural_errors(manifest)
    if errors:
        return False, errors

    errors = _semantic_errors(manifest)
    return len(errors) == 0, errors
