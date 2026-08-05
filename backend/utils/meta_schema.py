"""Strict structural contract for generated agent input manifests.

The renderer intentionally supports a small, audited JSON Schema subset. A
generated manifest cannot opt into references, executable markup, custom
widgets, permissions, identifiers, or any other provider-controlled extension.
Cross-field and security checks that are clearer in Python live in
``validation.py``.
"""

MAX_INPUT_FIELDS = 30
MAX_LAYOUT_BLOCKS = 100

FIELD_NAME_PATTERN = r"^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$"
BLOCK_ID_PATTERN = r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$"
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

_BLOCK_ID = {
    "type": "string",
    "minLength": 1,
    "maxLength": 64,
    "pattern": BLOCK_ID_PATTERN,
}

FIELD_BLOCK_SCHEMA = {
    "type": "object",
    "properties": {
        "id": _BLOCK_ID,
        "type": {"const": "field"},
        "field": {
            "type": "string",
            "maxLength": 64,
            "pattern": FIELD_NAME_PATTERN,
        },
    },
    "required": ["id", "type", "field"],
    "additionalProperties": False,
}

HEADING_BLOCK_SCHEMA = {
    "type": "object",
    "properties": {
        "id": _BLOCK_ID,
        "type": {"const": "heading"},
        "text": {"type": "string", "minLength": 1, "maxLength": 120},
        "level": {"type": "integer", "enum": [2, 3, 4]},
    },
    "required": ["id", "type", "text", "level"],
    "additionalProperties": False,
}

PARAGRAPH_BLOCK_SCHEMA = {
    "type": "object",
    "properties": {
        "id": _BLOCK_ID,
        "type": {"const": "paragraph"},
        "text": {"type": "string", "minLength": 1, "maxLength": 1_000},
    },
    "required": ["id", "type", "text"],
    "additionalProperties": False,
}

DIVIDER_BLOCK_SCHEMA = {
    "type": "object",
    "properties": {
        "id": _BLOCK_ID,
        "type": {"const": "divider"},
    },
    "required": ["id", "type"],
    "additionalProperties": False,
}

CALLOUT_BLOCK_SCHEMA = {
    "type": "object",
    "properties": {
        "id": _BLOCK_ID,
        "type": {"const": "callout"},
        "text": {"type": "string", "minLength": 1, "maxLength": 1_000},
        "tone": {
            "type": "string",
            "enum": ["information", "success", "warning"],
        },
    },
    "required": ["id", "type", "text", "tone"],
    "additionalProperties": False,
}

NON_SECTION_BLOCK_SCHEMA = {
    "oneOf": [
        FIELD_BLOCK_SCHEMA,
        HEADING_BLOCK_SCHEMA,
        PARAGRAPH_BLOCK_SCHEMA,
        DIVIDER_BLOCK_SCHEMA,
        CALLOUT_BLOCK_SCHEMA,
    ]
}

SECTION_BLOCK_SCHEMA = {
    "type": "object",
    "properties": {
        "id": _BLOCK_ID,
        "type": {"const": "section"},
        "title": {"type": "string", "minLength": 1, "maxLength": 80},
        "description": {"type": "string", "minLength": 1, "maxLength": 240},
        "children": {
            "type": "array",
            "minItems": 1,
            "maxItems": MAX_LAYOUT_BLOCKS,
            "items": NON_SECTION_BLOCK_SCHEMA,
        },
    },
    "required": ["id", "type", "title", "children"],
    "additionalProperties": False,
}

LAYOUT_BLOCK_SCHEMA = {
    "oneOf": [
        FIELD_BLOCK_SCHEMA,
        HEADING_BLOCK_SCHEMA,
        PARAGRAPH_BLOCK_SCHEMA,
        DIVIDER_BLOCK_SCHEMA,
        CALLOUT_BLOCK_SCHEMA,
        SECTION_BLOCK_SCHEMA,
    ]
}

LAYOUT_BLOCKS_SCHEMA = {
    "type": "array",
    "minItems": 1,
    "maxItems": MAX_LAYOUT_BLOCKS,
    "items": LAYOUT_BLOCK_SCHEMA,
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
                # Required semantically for single-screen manifests.
                "blocks": LAYOUT_BLOCKS_SCHEMA,
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
                            "blocks": LAYOUT_BLOCKS_SCHEMA,
                        },
                        "required": [
                            "id",
                            "title",
                            "description",
                            "fields",
                        ],
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
