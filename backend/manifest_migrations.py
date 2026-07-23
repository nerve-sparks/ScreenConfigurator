"""Compatibility upgrades for manifests saved under older contracts."""

import copy
import re


def _legacy_group_id(title: str, index: int, used_ids: set[str]) -> str:
    """Create a stable, contract-valid and unique ID for a legacy group."""
    base = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    if not base or not base[0].isalpha():
        base = f"group-{index + 1}"
    base = base[:64].rstrip("-")

    candidate = base
    suffix = 2
    while candidate in used_ids:
        suffix_text = f"-{suffix}"
        candidate = f"{base[: 64 - len(suffix_text)].rstrip('-')}{suffix_text}"
        suffix += 1
    used_ids.add(candidate)
    return candidate


def _existing_block_ids(blocks) -> set[str]:
    ids: set[str] = set()
    if not isinstance(blocks, list):
        return ids
    for block in blocks:
        if not isinstance(block, dict):
            continue
        block_id = block.get("id")
        if isinstance(block_id, str):
            ids.add(block_id)
        ids.update(_existing_block_ids(block.get("children")))
    return ids


def _field_block_id(field_name: str, used_ids: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", field_name.lower()).strip("-")
    base = f"field-{base or 'input'}"[:64].rstrip("-")
    candidate = base
    suffix = 2
    while candidate in used_ids:
        suffix_text = f"-{suffix}"
        candidate = f"{base[: 64 - len(suffix_text)].rstrip('-')}{suffix_text}"
        suffix += 1
    used_ids.add(candidate)
    return candidate


def _field_blocks(fields, used_ids: set[str]) -> list[dict]:
    if not isinstance(fields, list):
        return []
    return [
        {
            "id": _field_block_id(field_name, used_ids),
            "type": "field",
            "field": field_name,
        }
        for field_name in fields
        if isinstance(field_name, str)
    ]


def upgrade_legacy_layout(manifest: dict) -> dict:
    """Return a copy upgraded from earlier layout contracts.

    Pre-mode manifests receive a declared single/wizard mode. Manifests saved
    before safe content blocks receive field-only blocks derived from their
    existing canonical field order. Stored documents are never mutated.
    """
    upgraded = copy.deepcopy(manifest)
    if not isinstance(upgraded, dict):
        return upgraded

    ui_hints = upgraded.get("ui_hints")
    if not isinstance(ui_hints, dict):
        return upgraded

    groups = ui_hints.get("groups")
    if "mode" not in ui_hints:
        is_wizard = isinstance(groups, list) and len(groups) > 0
        ui_hints["mode"] = "wizard" if is_wizard else "single"

        if is_wizard:
            used_group_ids: set[str] = set()
            for index, group in enumerate(groups):
                if not isinstance(group, dict):
                    continue
                title = group.get("title")
                title_text = title.strip() if isinstance(title, str) else ""
                if not title_text:
                    title_text = f"Step {index + 1}"
                    group["title"] = title_text
                if not group.get("id"):
                    group["id"] = _legacy_group_id(
                        title_text, index, used_group_ids
                    )
                else:
                    used_group_ids.add(group["id"])
                if not group.get("description"):
                    group["description"] = (
                        f"Provide the inputs for {title_text.lower()}."
                    )

    used_block_ids = _existing_block_ids(ui_hints.get("blocks"))
    if isinstance(groups, list):
        for group in groups:
            if isinstance(group, dict):
                used_block_ids.update(_existing_block_ids(group.get("blocks")))

    if ui_hints.get("mode") == "single" and "blocks" not in ui_hints:
        ui_hints["blocks"] = _field_blocks(
            ui_hints.get("field_order"), used_block_ids
        )
    elif ui_hints.get("mode") == "wizard" and isinstance(groups, list):
        for group in groups:
            if isinstance(group, dict) and "blocks" not in group:
                group["blocks"] = _field_blocks(
                    group.get("fields"), used_block_ids
                )

    return upgraded
