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
    field_order = manifest["ui_hints"]["field_order"]

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

    for name in required:
        if name not in properties:
            errors.append(
                f"semantic: input_schema.required names '{name}', "
                "which is not in input_schema.properties"
            )

    # groups is optional (Step 6); when present, every field named in
    # every group must exist in properties.
    groups = manifest["ui_hints"].get("groups", [])
    for index, group in enumerate(groups):
        for name in group["fields"]:
            if name not in properties:
                errors.append(
                    f"semantic: ui_hints.groups[{index}] ('{group['title']}') "
                    f"names '{name}', which is not in input_schema.properties"
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
