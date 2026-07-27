"""Synchronize the audited standalone renderer copies used by frontend export.

This developer command is never called by an export request.

Usage:
    python backend/sync_export_runtime.py --check
    python backend/sync_export_runtime.py --sync
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent
REPOSITORY_ROOT = BACKEND_ROOT.parent
FRONTEND_SOURCE = REPOSITORY_ROOT / "frontend" / "src"
EXPORT_SOURCE = BACKEND_ROOT / "export_templates" / "source" / "src"

RUNTIME_FILES = (
    "AgentFlow.jsx",
    "ContentExperience.jsx",
    "FormRenderer.jsx",
    "LayoutRenderer.jsx",
    "RuntimePrimitives.jsx",
    "ScreenExperience.jsx",
    "Wizard.jsx",
    "layoutBlocks.js",
    "manifestLayout.js",
    "presentation.js",
    "styles.css",
)


def drifted_files() -> list[str]:
    drifted: list[str] = []
    for filename in RUNTIME_FILES:
        canonical = FRONTEND_SOURCE / filename
        exported = EXPORT_SOURCE / filename
        if not canonical.is_file() or not exported.is_file():
            drifted.append(filename)
            continue
        if canonical.read_bytes() != exported.read_bytes():
            drifted.append(filename)
    return drifted


def synchronize() -> None:
    EXPORT_SOURCE.mkdir(parents=True, exist_ok=True)
    for filename in RUNTIME_FILES:
        canonical = FRONTEND_SOURCE / filename
        if not canonical.is_file():
            raise FileNotFoundError(f"Canonical runtime file is missing: {canonical}")
        (EXPORT_SOURCE / filename).write_bytes(canonical.read_bytes())


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
            "Run `python backend/sync_export_runtime.py --sync`, rebuild "
            "preview.template.html, and commit the results.",
            file=sys.stderr,
        )
        return 1
    print("Export runtime copies match the canonical frontend runtime.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
