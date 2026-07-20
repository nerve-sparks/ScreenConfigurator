"""Structural + semantic validation: the gate every manifest must pass.

Nothing is stored or rendered unless validate_manifest says it is OK.
Generic by design -- this module knows the manifest contract, never any
specific agent.
"""

from jsonschema import Draft202012Validator

from meta_schema import META_SCHEMA

# Fail loudly at import time if the meta-schema itself is ever broken.
Draft202012Validator.check_schema(META_SCHEMA)

_VALIDATOR = Draft202012Validator(META_SCHEMA)


def _structural_errors(manifest) -> list[str]:
    """Layer 1: validate the manifest against the meta-schema."""
    return [
        f"structural: {error.json_path}: {error.message}"
        for error in sorted(_VALIDATOR.iter_errors(manifest), key=lambda e: e.json_path)
    ]


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
    if mode == "single":
        if groups:
            errors.append(
                "semantic: ui_hints.groups must be omitted when "
                "ui_hints.mode is 'single'"
            )
        return errors

    # Structural validation restricts mode to single/wizard, so reaching
    # this point means mode == "wizard".
    if not groups:
        errors.append(
            "semantic: ui_hints.groups is required when ui_hints.mode is 'wizard'"
        )
        return errors

    if len(groups) < 2:
        errors.append("semantic: wizard mode requires at least two groups")
    if len(groups) > 5:
        errors.append("semantic: wizard mode supports at most five groups")

    seen_group_ids = set()
    field_owner = {}
    flattened_fields = []
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

    return errors


def validate_manifest(manifest) -> tuple[bool, list[str]]:
    """Validate a manifest. Returns (ok, errors) with readable error strings.

    Structural errors are returned on their own: if the shape is wrong,
    the semantic layer cannot safely (or meaningfully) run.
    """
    errors = _structural_errors(manifest)
    if errors:
        return False, errors

    errors = _semantic_errors(manifest)
    return len(errors) == 0, errors
