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
    "field_order": ["topic"],
    "blocks": [
      {
        "id": "request-heading",
        "type": "heading",
        "text": "Start your research",
        "level": 2
      },
      {
        "id": "request-copy",
        "type": "paragraph",
        "text": "Describe the topic you want the agent to investigate."
      },
      {
        "id": "field-topic",
        "type": "field",
        "field": "topic"
      }
    ]
  }
}
```

Single-screen manifests omit `ui_hints.groups`.

The renderer accepts at most 30 fields. Field types are limited to `string`,
`number`, `integer`, and `boolean`; supported string formats are `email`,
`uri`, `date`, `date-time`, `time`, and `data-url`. Definitions may include
`title`, `description`, `enum`, the applicable string/numeric limits, and
`contentMediaType` for a `data-url` file input. Every other field keyword is
rejected.

References (`$ref` and related forms), custom widgets, HTML, scripts, and
script-like directives are rejected before structural validation. The LLM is
also forbidden from supplying agent/screen/database identifiers, owners,
roles, or permissions. Those values are controlled by application code and
are never interpreted from a manifest.

Agent name, icon, color, and welcome copy are presentation settings stored
beside the manifest; they are not part of this validated input contract.

`ui_hints.blocks` controls safe visual content and field placement. Supported
types are `field`, `heading`, `paragraph`, `divider`, `callout`, and `section`.
Sections may contain non-section blocks, but sections cannot be nested. Block
IDs are unique lowercase kebab-case identifiers. Every input appears in exactly
one field block, and field-block order equals `field_order`. Text is plain text:
raw HTML, JavaScript, CSS, remote references, images, and custom widgets are
not accepted.

A manifest may contain at most 100 blocks including section children. Block
IDs are at most 64 characters; headings are at most 120 characters;
paragraphs and callouts are at most 1,000 characters; section titles are at
most 80 characters; and optional section descriptions are at most 240
characters. Heading levels are limited to 2–4 and callout tones to
`information`, `success`, or `warning`.

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
        "fields": ["recipient"],
        "blocks": [
          {
            "id": "field-recipient",
            "type": "field",
            "field": "recipient"
          }
        ]
      },
      {
        "id": "message",
        "title": "Message",
        "description": "Write the subject and message body.",
        "fields": ["subject", "body"],
        "blocks": [
          {
            "id": "message-heading",
            "type": "heading",
            "text": "Write the message",
            "level": 2
          },
          {
            "id": "field-subject",
            "type": "field",
            "field": "subject"
          },
          {
            "id": "field-body",
            "type": "field",
            "field": "body"
          }
        ]
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
- Each group owns its `blocks`; wizard manifests omit top-level `blocks`.
- Each group's field-block order exactly equals that group's `fields`.
- `field_order` itself contains every input property exactly once.

Manifests saved before the `mode` or safe-block contracts are upgraded in API
load/save paths by `manifest_migrations.py`. Missing block layouts become
field-only layouts in memory; immutable stored versions are not rewritten.
Newly generated manifests must satisfy the current contract without migration.
