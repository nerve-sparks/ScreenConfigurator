"""Meta-schema: what a valid manifest looks like (Step 4).

This is the structural half of the contract. Semantic rules that JSON
Schema cannot express (cross-references between properties, required and
field_order) live in validation.py.

Strict but minimal: it pins down what MUST be present without forbidding
extra keys, so contract-compatible additions (e.g. the optional
ui_hints.groups) are not rejected.
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
                "field_order": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                # Optional (Step 6): when present, the frontend renders one
                # wizard step per group. Absent means a single screen.
                "groups": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "fields": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                        },
                        "required": ["title", "fields"],
                    },
                },
            },
            "required": ["field_order"],
        },
    },
    "required": ["input_schema", "ui_hints"],
}
