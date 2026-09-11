#!/usr/bin/env python3
"""Copy the shared scenario shell in from the Dropfleet builder.

    python tools/dzc/sync_scenario_shell.py

The Dropfleet and Dropzone scenario pages share one shell: the header with the
game switch, the index, the tracker, share and print, and the hover tooltip. It
lives in the Dropfleet repo at scenarios/shared/. This copies it into
scenarios/shared/ here, so the Dropzone page has no cross-repo dependency and
the service worker can keep it offline. Edit the shell there, then run this.
"""

import filecmp
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(os.path.dirname(ROOT), "Dropfleet-Builder", "scenarios", "shared")
DEST = os.path.join(ROOT, "scenarios", "shared")
FILES = ["shell.css", "shell.js", "tooltip.js"]


def main():
    if not os.path.isdir(SRC):
        sys.exit(f"Dropfleet builder not found at {SRC}")
    os.makedirs(DEST, exist_ok=True)
    for name in FILES:
        src, dest = os.path.join(SRC, name), os.path.join(DEST, name)
        same = os.path.exists(dest) and filecmp.cmp(src, dest, shallow=False)
        if not same:
            shutil.copyfile(src, dest)
        print(f"{name:<12} {'unchanged' if same else 'copied'}")


if __name__ == "__main__":
    main()
