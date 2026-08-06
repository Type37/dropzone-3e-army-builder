#!/usr/bin/env python3
"""
Keep rules/ in step with what TTCombat currently publish.

    python tools/dzc/fetch_sources.py --check     # say what has moved, download nothing
    python tools/dzc/fetch_sources.py             # download whatever is newer

Every number in this app comes out of these PDFs, so a release we have not
noticed is an army list priced against last month's rules. That went unnoticed
for a week: the cards on disk were dated 260730 while the resources page had
been serving 260804 and 260805, and nothing in the pipeline was looking.

The page is scraped rather than a list of URLs being kept here, because the URL
carries a Shopify version query that changes on every re-upload and a hardcoded
one would 404 or, worse, quietly serve a stale copy from cache. What is kept
here is the FILENAME STEM of each source we consume; the date suffix is
whatever the page is offering today.

Exit codes, so a scheduled job can act on them:
    0  everything on disk matches the page
    1  something is newer (with --check), or a download failed
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import urllib.request

PAGE = "https://ttcombat.com/pages/dropzone-commander-resources"
DEST = os.path.join("rules")

# What the pipeline actually reads. Each entry is (stem, what it feeds).
#
# Stems, not full names: TTCombat date-stamp the stat cards and rename them
# freely otherwise -- the Bioficer file was "Stat_Sheets" in July and
# "Stat_Cards" in August, which is exactly the sort of change a hardcoded name
# would have turned into a silent "no PDF for Bioficer".
SOURCES = [
    ("DZC_UCM_Stat", "scan_statcards"),
    ("DZC_Scourge_Stat", "scan_statcards"),
    ("DZC_PHR_Stat", "scan_statcards"),
    ("DZC_Shaltari_Stat", "scan_statcards"),
    ("DZC_Resistance_Stat", "scan_statcards"),
    ("DZC_Bioficer_Stat", "scan_statcards"),
    ("Behemoth_Rules_Stats", "scan_behemoths"),
    ("A5_Dropzone_3.01_Rulebook", "scan_rulebook"),
    ("DZC_Errata_3.01", "reference"),
]

PDF_RE = re.compile(r"https://cdn\.shopify\.com/[^\"'>\s]+\.pdf(?:\?[^\"'>\s]*)?")
DATE_RE = re.compile(r"_(\d{6})(?:\.pdf)?$")


def stamp(name: str) -> str:
    """The YYMMDD a file is dated, or '' — what makes one release newer.

    Sorting whole filenames instead of this is the trap: "Stat_Sheets_260730"
    sorts ABOVE "Stat_Cards_260804" on the S, so a rename would have pinned the
    scanner to the older file for as long as both were on disk."""
    m = DATE_RE.search(os.path.splitext(name)[0] + "")
    return m.group(1) if m else ""


def published(html: str) -> dict[str, tuple[str, str]]:
    """{stem: (filename, url)} for the newest file the page offers per stem."""
    out: dict[str, tuple[str, str]] = {}
    for url in sorted(set(PDF_RE.findall(html))):
        name = url.split("/")[-1].split("?")[0]
        for stem, _ in SOURCES:
            if not name.startswith(stem):
                continue
            have = out.get(stem)
            if have is None or stamp(name) > stamp(have[0]):
                out[stem] = (name, url)
    return out


def on_disk(stem: str) -> str | None:
    """The newest file we already hold for a stem."""
    if not os.path.isdir(DEST):
        return None
    got = [f for f in os.listdir(DEST) if f.startswith(stem) and f.endswith(".pdf")]
    return max(got, key=stamp) if got else None


def fetch(url: str, path: str) -> int:
    req = urllib.request.Request(url, headers={"User-Agent": "dzc-builder/1.0"})
    with urllib.request.urlopen(req, timeout=180) as r, open(path, "wb") as fh:
        data = r.read()
        fh.write(data)
    return len(data)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="report what has moved and exit 1; download nothing")
    args = ap.parse_args()

    req = urllib.request.Request(PAGE, headers={"User-Agent": "dzc-builder/1.0"})
    html = urllib.request.urlopen(req, timeout=120).read().decode("utf-8", "replace")
    live = published(html)

    missing = [stem for stem, _ in SOURCES if stem not in live]
    for stem in missing:
        # Not a warning. Every stem here is something the pipeline reads, so one
        # the page has stopped offering means either a rename we must follow or
        # a scrape that has broken -- and both need a human, not a retry.
        print(f"  !! the resources page no longer offers anything matching {stem!r}")

    stale, fresh = [], []
    for stem, feeds in SOURCES:
        if stem not in live:
            continue
        name, url = live[stem]
        have = on_disk(stem)
        if have == name:
            fresh.append(name)
        else:
            stale.append((have, name, url, feeds))

    for name in fresh:
        print(f"  ok       {name}")
    for have, name, _url, feeds in stale:
        print(f"  NEWER    {name}   (have {have or 'nothing'})  -> {feeds}")

    if not stale and not missing:
        print(f"\n  rules/ matches the resources page ({len(fresh)} files)")
        return 0
    if args.check:
        print(f"\n  {len(stale)} newer, {len(missing)} missing.")
        print("  Re-run without --check to download.")
        return 1

    os.makedirs(DEST, exist_ok=True)
    failed = 0
    for have, name, url, _feeds in stale:
        path = os.path.join(DEST, name)
        try:
            n = fetch(url, path)
        except Exception as exc:                            # noqa: BLE001
            print(f"  FAILED   {name}: {exc}")
            failed += 1
            continue
        print(f"  got      {name}  ({n // 1024} KB)")
        # The superseded file goes. rules/ is already 409 MB of committed PDF,
        # and keeping both releases of six faction card sets would add a
        # hundred more every month to hold a copy of something git history
        # holds already: `git show HEAD~1:rules/<old>.pdf` recovers one, and
        # `git checkout -- rules/` puts the whole directory back if a scan
        # against a new release turns out badly.
        if have and have != name:
            try:
                os.remove(os.path.join(DEST, have))
                print(f"  dropped  {have}  (superseded; git history keeps it)")
            except OSError as exc:
                print(f"  !! could not remove {have}: {exc}")

    print(f"\n  {len(stale) - failed} downloaded, {failed} failed")
    return 1 if (failed or missing) else 0


if __name__ == "__main__":
    sys.exit(main())
