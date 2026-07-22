"""Strict structural contract for generated agent input manifests.

The renderer intentionally supports a small, audited JSON Schema subset. A
generated manifest cannot opt into references, executable markup, custom
widgets, permissions, identifiers, or any other provider-controlled extension.
Cross-field and security checks that are clearer in Python live in
``validation.py``.
"""

MAX_INPUT_FIELDS = 30

FIELD_NAME_PATTERN = r"^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$"
SUPPORTED_FIELD_TYPES = ["string", "number", "integer", "boolean"]
SUPPORTED_STRING_FORMATS = [
    "email",
    "uri",
    "date",
    "date-time",
    "time",
    "data-url",
]

_SCALAR_VALUE = {"type": ["string", "number", "integer", "boolean"]}

FIELD_SCHEMA = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": SUPPORTED_FIELD_TYPES},
        "title": {"type": "string", "minLength": 1, "maxLength": 80},
        "description": {"type": "string", "minLength": 1, "maxLength": 240},
        "format": {"type": "string", "enum": SUPPORTED_STRING_FORMATS},
        "enum": {
            "type": "array",
            "minItems": 1,
            "maxItems": 50,
            "uniqueItems": True,
            "items": _SCALAR_VALUE,
        },
        "minLength": {"type": "integer", "minimum": 0, "maximum": 10_000},
        "maxLength": {"type": "integer", "minimum": 1, "maximum": 10_000},
        "minimum": {"type": "number"},
        "maximum": {"type": "number"},
        "multipleOf": {"type": "number", "exclusiveMinimum": 0},
        # Used only by the built-in data-url file input. The tight pattern
        # prevents this value from becoming an arbitrary browser directive.
        "contentMediaType": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100,
            "pattern": r"^[a-zA-Z0-9][a-zA-Z0-9.+-]*/[a-zA-Z0-9][a-zA-Z0-9.+*-]*$",
        },
    },
    "required": ["type", "title"],
    "additionalProperties": False,
}

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
                    "minProperties": 1,
                    "maxProperties": MAX_INPUT_FIELDS,
                    "propertyNames": {
                        "maxLength": 64,
                        "pattern": FIELD_NAME_PATTERN,
                    },
                    "additionalProperties": FIELD_SCHEMA,
                },
                "required": {
                    "type": "array",
                    "maxItems": MAX_INPUT_FIELDS,
                    "items": {"type": "string"},
                },
            },
            "required": ["type", "properties"],
            "additionalProperties": False,
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
                    "minItems": 1,
                    "maxItems": MAX_INPUT_FIELDS,
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
                                "maxItems": MAX_INPUT_FIELDS,
                            },
                        },
                        "required": ["id", "title", "description", "fields"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["mode", "field_order"],
            "additionalProperties": False,
        },
    },
    "required": ["input_schema", "ui_hints"],
    "additionalProperties": False,
}
