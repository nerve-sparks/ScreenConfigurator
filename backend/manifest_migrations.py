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


def upgrade_legacy_layout(manifest: dict) -> dict:
    """Return a copy upgraded from the pre-mode layout contract.

    Current manifests are returned as an independent copy but are otherwise
    untouched, so invalid current data is still rejected rather than silently
    repaired. Legacy manifests are identifiable by the absence of
    ``ui_hints.mode``.
    """
    upgraded = copy.deepcopy(manifest)
    if not isinstance(upgraded, dict):
        return upgraded

    ui_hints = upgraded.get("ui_hints")
    if not isinstance(ui_hints, dict) or "mode" in ui_hints:
        return upgraded

    groups = ui_hints.get("groups")
    is_wizard = isinstance(groups, list) and len(groups) > 0
    ui_hints["mode"] = "wizard" if is_wizard else "single"

    if not is_wizard:
        return upgraded

    used_ids: set[str] = set()
    for index, group in enumerate(groups):
        if not isinstance(group, dict):
            continue
        title = group.get("title")
        title_text = title.strip() if isinstance(title, str) else ""
        if not title_text:
            title_text = f"Step {index + 1}"
            group["title"] = title_text
        if not group.get("id"):
            group["id"] = _legacy_group_id(title_text, index, used_ids)
        else:
            used_ids.add(group["id"])
        if not group.get("description"):
            group["description"] = f"Provide the inputs for {title_text.lower()}."

    return upgraded
