"""Synchronize the audited standalone renderer copies used by frontend export.

This developer command is never called by an export request.

Usage:
    python -m utils.sync_export_runtime --check
    python -m utils.sync_export_runtime --sync
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
REPOSITORY_ROOT = BACKEND_ROOT.parent
FRONTEND_SOURCE = REPOSITORY_ROOT / "frontend" / "src"
EXPORT_SOURCE = BACKEND_ROOT / "export_templates" / "source" / "src"

# Canonical path under frontend/src -> matching path under export src/
RUNTIME_FILES = (
    ("components/AgentFlow.jsx", "components/AgentFlow.jsx"),
    ("components/ContentExperience.jsx", "components/ContentExperience.jsx"),
    ("components/FormRenderer.jsx", "components/FormRenderer.jsx"),
    ("components/LayoutRenderer.jsx", "components/LayoutRenderer.jsx"),
    ("components/RuntimePrimitives.jsx", "components/RuntimePrimitives.jsx"),
    ("components/ScreenExperience.jsx", "components/ScreenExperience.jsx"),
    ("components/Wizard.jsx", "components/Wizard.jsx"),
    ("lib/layoutBlocks.js", "lib/layoutBlocks.js"),
    ("lib/manifestLayout.js", "lib/manifestLayout.js"),
    ("lib/presentation.js", "lib/presentation.js"),
    ("styles.css", "styles.css"),
)


def drifted_files() -> list[str]:
    drifted: list[str] = []
    for source_rel, export_rel in RUNTIME_FILES:
        canonical = FRONTEND_SOURCE / source_rel
        exported = EXPORT_SOURCE / export_rel
        if not canonical.is_file() or not exported.is_file():
            drifted.append(export_rel)
            continue
        if canonical.read_bytes() != exported.read_bytes():
            drifted.append(export_rel)
    return drifted


def synchronize() -> None:
    for source_rel, export_rel in RUNTIME_FILES:
        canonical = FRONTEND_SOURCE / source_rel
        if not canonical.is_file():
            raise FileNotFoundError(f"Canonical runtime file is missing: {canonical}")
        destination = EXPORT_SOURCE / export_rel
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(canonical.read_bytes())


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
