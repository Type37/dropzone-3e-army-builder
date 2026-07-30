#!/usr/bin/env python3
"""
Rebuild every piece of DZC data from the source PDFs, then prove it.

This is the whole pipeline. A new stat-card release from TTCombat should mean
running this and nothing else -- no code edits, no hand-patching JSON.

    python tools/dzc/rebuild.py

Stages run in order and the first failure stops the run, because each stage
consumes the one before it: a bad unit scan would be audited against itself and
a bad glossary would silently leave rule keywords dead on the page.

    scan_statcards   PDFs        -> data/dzc/faction-*.json  + assets/units/*
    scan_rulebook    PDFs        -> data/dzc/rules.json
    audit_data       shape, categories, weapon boxes
    audit_transport  symbol shapes and the carrier/passenger lineages
    audit_art        every unit has art and every art file has a unit
    audit_rules      every keyword a card prints resolves to glossary text

Pass --skip-scan to re-run only the audits against data already on disk, which
is what you want while working on an audit itself.
"""

import argparse
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))

SCANS = [
    ("scan unit cards", ["scan_statcards.py",
                         "--pdf-dir", "rules",
                         "--out", "data/dzc",
                         "--art", "assets/units"]),
    ("scan rulebook", ["scan_rulebook.py"]),
]

AUDITS = [
    ("audit: data", ["audit_data.py"]),
    ("audit: transport", ["audit_transport.py"]),
    ("audit: art", ["audit_art.py"]),
    ("audit: rules", ["audit_rules.py"]),
]


def run(label, argv):
    print(f"\n{'=' * 62}\n  {label}\n{'=' * 62}")
    t0 = time.time()
    rc = subprocess.call([sys.executable, os.path.join(HERE, argv[0])] + argv[1:])
    dt = time.time() - t0
    if rc != 0:
        print(f"\n  FAILED: {label} (exit {rc}, {dt:.0f}s)", file=sys.stderr)
        sys.exit(rc)
    print(f"  ok ({dt:.0f}s)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-scan", action="store_true",
                    help="audit the data already on disk without re-scanning")
    args = ap.parse_args()

    if not os.path.isdir("rules"):
        raise SystemExit("run this from the repository root (no rules/ here)")

    stages = (AUDITS if args.skip_scan else SCANS + AUDITS)
    t0 = time.time()
    for label, argv in stages:
        run(label, argv)
    print(f"\n{'=' * 62}\n  all stages passed in {time.time() - t0:.0f}s\n{'=' * 62}")


if __name__ == "__main__":
    main()
