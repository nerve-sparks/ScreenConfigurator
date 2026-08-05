"""Normalize and summarize agent scorecard JSON for planning and generation.

Scorecards describe an existing agent runtime (input/output schemas, connection,
capabilities). Screen Studio stores them beside the project so generation can
map user-facing screens onto the agent's real input contract.
"""

from __future__ import annotations

from typing import Any, Optional


SCORECARD_MAX_BYTES = 200_000
ALLOWED_TOP_LEVEL = {
    "sla",
    "name",
    "intent",
    "status",
    "node_id",
    "version",
    "agent_id",
    "metadata",
    "node_type",
    "connection",
    "checkpoints",
    "capabilities",
    "error_schema",
    "input_schema",
    "output_schema",
    "owner_orchestrator",
}


def normalize_scorecard(raw: Any) -> dict:
    """Return a sanitized scorecard or raise ValueError."""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValueError("Scorecard must be a JSON object.")
    if len(str(raw)) > SCORECARD_MAX_BYTES:
        raise ValueError("Scorecard is too large.")

    cleaned: dict[str, Any] = {}
    for key, value in raw.items():
        if key in ALLOWED_TOP_LEVEL:
            cleaned[key] = value

    if not cleaned:
        raise ValueError(
            "Scorecard is empty or unrecognized. Include fields such as name, "
            "agent_id, input_schema, and connection."
        )

    name = cleaned.get("name")
    if name is not None and (not isinstance(name, str) or not name.strip()):
        raise ValueError("Scorecard name must be a non-empty string when present.")

    input_schema = cleaned.get("input_schema")
    if input_schema is not None and not isinstance(input_schema, dict):
        raise ValueError("Scorecard input_schema must be an object.")

    connection = cleaned.get("connection")
    if connection is not None and not isinstance(connection, dict):
        raise ValueError("Scorecard connection must be an object.")

    return cleaned


def scorecard_display_name(scorecard: Optional[dict]) -> str:
    if not scorecard:
        return ""
    name = scorecard.get("name")
    return name.strip() if isinstance(name, str) else ""


def scorecard_runtime_id(scorecard: Optional[dict]) -> str:
    if not scorecard:
        return ""
    for key in ("agent_id", "node_id"):
        value = scorecard.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def scorecard_input_fields(scorecard: Optional[dict]) -> list[dict]:
    """Flatten scorecard input_schema properties for prompts and UI."""
    if not scorecard:
        return []
    schema = scorecard.get("input_schema")
    if not isinstance(schema, dict):
        return []
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        return []
    required = schema.get("required")
    required_set = set(required) if isinstance(required, list) else set()
    fields = []
    for name, definition in properties.items():
        if not isinstance(name, str) or not isinstance(definition, dict):
            continue
        fields.append(
            {
                "name": name,
                "type": definition.get("type", "string"),
                "title": definition.get("title") or name,
                "description": definition.get("description") or "",
                "required": name in required_set,
                "enum": definition.get("enum"),
            }
        )
    return fields


def build_scorecard_brief(scorecard: Optional[dict]) -> str:
    """Compact text block injected into LLM planning/generation prompts."""
    if not scorecard:
        return ""
    lines = ["Agent scorecard (map screens to this contract):"]
    name = scorecard_display_name(scorecard)
    if name:
        lines.append(f"- Name: {name}")
    runtime_id = scorecard_runtime_id(scorecard)
    if runtime_id:
        lines.append(f"- Runtime agent id: {runtime_id}")
    version = scorecard.get("version")
    if isinstance(version, str) and version.strip():
        lines.append(f"- Version: {version.strip()}")
    capabilities = scorecard.get("capabilities")
    if isinstance(capabilities, list) and capabilities:
        lines.append(
            "- Capabilities: "
            + ", ".join(str(item) for item in capabilities if item is not None)
        )
    intent = scorecard.get("intent")
    if isinstance(intent, dict):
        desc = intent.get("intent_desc")
        if isinstance(desc, str) and desc.strip():
            lines.append(f"- Intent: {desc.strip()}")
        does_not = intent.get("does_not_handle")
        if isinstance(does_not, list) and does_not:
            lines.append(
                "- Does not handle: "
                + "; ".join(str(item) for item in does_not if item)
            )
    fields = scorecard_input_fields(scorecard)
    if fields:
        lines.append("- Required input fields the published UI should collect:")
        for field in fields:
            req = "required" if field["required"] else "optional"
            detail = field["description"] or field["title"]
            lines.append(
                f"  • {field['name']} ({field['type']}, {req}): {detail}"
            )
    connection = scorecard.get("connection")
    if isinstance(connection, dict):
        protocol = connection.get("protocol") or ""
        method = connection.get("method") or ""
        url = connection.get("url") or ""
        lines.append(
            "- Connection (for later runtime submit only; do not invent credentials UI): "
            f"{protocol} {method} {url}".strip()
        )
    output_schema = scorecard.get("output_schema")
    if isinstance(output_schema, dict):
        lines.append(
            "- Agent returns an output_schema after run; do not generate result dashboards."
        )
    return "\n".join(lines)
