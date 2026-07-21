# Input-screen manifest contract

The backend accepts and stores only manifests that pass both structural
validation (`meta_schema.py`) and cross-reference validation (`validation.py`).
The manifest describes agent inputs only; it never describes agent output or
execution behavior.

## Single screen

```json
{
  "input_schema": {
    "type": "object",
    "properties": {
      "topic": { "type": "string", "title": "Topic" }
    },
    "required": ["topic"]
  },
  "ui_hints": {
    "mode": "single",
    "field_order": ["topic"]
  }
}
```

Single-screen manifests omit `ui_hints.groups`.

Field definitions can include normal JSON Schema descriptions, enums, and
formats. The `data-url` string format represents a file input and is rendered
as a file drop area. Agent name, icon, color, and welcome copy are presentation
settings stored beside the manifest; they are not part of this validated
input contract.

## Wizard

```json
{
  "input_schema": {
    "type": "object",
    "properties": {
      "recipient": { "type": "string", "title": "Recipient" },
      "subject": { "type": "string", "title": "Subject" },
      "body": { "type": "string", "title": "Message" }
    },
    "required": ["recipient", "subject", "body"]
  },
  "ui_hints": {
    "mode": "wizard",
    "field_order": ["recipient", "subject", "body"],
    "groups": [
      {
        "id": "recipient",
        "title": "Recipient",
        "description": "Choose who should receive the message.",
        "fields": ["recipient"]
      },
      {
        "id": "message",
        "title": "Message",
        "description": "Write the subject and message body.",
        "fields": ["subject", "body"]
      }
    ]
  }
}
```

Wizard invariants:

- There are two to five non-empty groups.
- Group IDs are unique lowercase kebab-case identifiers.
- Every input field occurs in exactly one group.
- Groups cannot reference unknown fields.
- Concatenating every group's `fields` array exactly equals `field_order`.
- `field_order` itself contains every input property exactly once.

Manifests saved before the `mode` contract are upgraded in API load/save paths
by `manifest_migrations.py`. Newly generated manifests must satisfy the current
contract without migration.
