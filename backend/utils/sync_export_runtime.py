"""Synchronize the audited standalone renderer copies used by frontend export.

This developer command is never called by an export request.

Usage:
    python -m utils.sync_export_runtime --check
    python -m utils.sync_export_runtime --sync
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
REPOSITORY_ROOT = BACKEND_ROOT.parent
FRONTEND_SOURCE = REPOSITORY_ROOT / "frontend" / "src"
EXPORT_SOURCE = BACKEND_ROOT / "export_templates" / "source" / "src"

# Canonical path under frontend/src -> flat export basename
RUNTIME_FILES = (
    ("components/AgentFlow.jsx", "AgentFlow.jsx"),
    ("components/ContentExperience.jsx", "ContentExperience.jsx"),
    ("components/FormRenderer.jsx", "FormRenderer.jsx"),
    ("components/LayoutRenderer.jsx", "LayoutRenderer.jsx"),
    ("components/RuntimePrimitives.jsx", "RuntimePrimitives.jsx"),
    ("components/ScreenExperience.jsx", "ScreenExperience.jsx"),
    ("components/Wizard.jsx", "Wizard.jsx"),
    ("lib/layoutBlocks.js", "layoutBlocks.js"),
    ("lib/manifestLayout.js", "manifestLayout.js"),
    ("lib/presentation.js", "presentation.js"),
    ("styles.css", "styles.css"),
)

_IMPORT_REWRITE = (
    (re.compile(r"""((?:from|import)\s*\(?\s*['"])\.\./(?:lib|components)/([^'"]+)(['"])"""), r"\1./\2\3"),
)


def flatten_runtime_source(text: str) -> str:
    """Map studio folder imports onto the flat export_templates/src layout."""
    for pattern, replacement in _IMPORT_REWRITE:
        text = pattern.sub(replacement, text)
    return text


def canonical_bytes(source_rel: str) -> bytes:
    raw = (FRONTEND_SOURCE / source_rel).read_text(encoding="utf-8")
    if source_rel.endswith((".js", ".jsx")):
        raw = flatten_runtime_source(raw)
    return raw.encode("utf-8")


def drifted_files() -> list[str]:
    drifted: list[str] = []
    for source_rel, export_name in RUNTIME_FILES:
        canonical = FRONTEND_SOURCE / source_rel
        exported = EXPORT_SOURCE / export_name
        if not canonical.is_file() or not exported.is_file():
            drifted.append(export_name)
            continue
        if canonical_bytes(source_rel) != exported.read_bytes():
            drifted.append(export_name)
    return drifted


def synchronize() -> None:
    EXPORT_SOURCE.mkdir(parents=True, exist_ok=True)
    for source_rel, export_name in RUNTIME_FILES:
        canonical = FRONTEND_SOURCE / source_rel
        if not canonical.is_file():
            raise FileNotFoundError(f"Canonical runtime file is missing: {canonical}")
        (EXPORT_SOURCE / export_name).write_bytes(canonical_bytes(source_rel))


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--sync", action="store_true")
    arguments = parser.parse_args()

    if arguments.sync:
        synchronize()

    drifted = drifted_files()
    if drifted:
        print(
            "Export runtime copies are out of sync: " + ", ".join(drifted),
            file=sys.stderr,
        )
        print(
            "Run `python -m utils.sync_export_runtime --sync`, rebuild "
            "preview.template.html, and commit the results.",
            file=sys.stderr,
        )
        return 1
    print("Export runtime copies match the canonical frontend runtime.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
