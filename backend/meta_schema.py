"""Meta-schema: what a valid manifest looks like (Step 4).

This is the structural half of the contract. Semantic rules that JSON
Schema cannot express (cross-references between properties, required and
field_order) live in validation.py.

Strict but extensible: it pins down the layout contract while allowing
future, contract-compatible additions to the manifest.
"""

META_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "input_schema": {
            "type": "object",
            "properties": {
                "type": {"const": "object"},
                "properties": {
                    "type": "object",
                    "additionalProperties": {"type": "object"},
                },
                "required": {
                    "type": "array",
                    "items": {"type": "string"},
                },
            },
            "required": ["type", "properties"],
        },
        "ui_hints": {
            "type": "object",
            "properties": {
                "mode": {
                    "type": "string",
                    "enum": ["single", "wizard"],
                },
                "field_order": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                # Required semantically when mode == "wizard". It remains
                # optional structurally because single-screen manifests omit it.
                "groups": {
                    "type": "array",
                    "minItems": 1,
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 64,
                                "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
                            },
                            "title": {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 80,
                            },
                            "description": {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 240,
                            },
                            "fields": {
                                "type": "array",
                                "items": {"type": "string"},
                                "minItems": 1,
                            },
                        },
                        "required": ["id", "title", "description", "fields"],
                    },
                },
            },
            "required": ["mode", "field_order"],
        },
    },
    "required": ["input_schema", "ui_hints"],
}
