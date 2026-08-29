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
import urllib.error
import urllib.request

PAGE = "https://ttcombat.com/pages/dropzone-commander-resources"
DEST = os.path.join("rules")

# What the pipeline actually reads. Each entry is (stem, what it feeds).
#
# Stems, not full names: TTCombat date-stamp the stat cards and rename them
# freely otherwise -- the Bioficer file was "Stat_Sheets" in July and
# "Stat_Cards" in August, which is exactly the sort of change a hardcoded name
# would have turned into a silent "no PDF for Bioficer".
# A PATTERN per source, not a prefix, because the EDITION POINT moves and it
# sits in the MIDDLE of the name. 3.01 became 3.02 on 2026-08-21: the rulebook
# and the errata were both renamed and a third document appeared beside them.
# A stem of "A5_Dropzone_3.01_Rulebook" then matched nothing, and --check
# reported "the resources page no longer offers anything matching" -- which
# reads as a page that has dropped a file, not as the one release you least
# want to miss. The version is a wildcard now, so whichever point release the
# page is serving is the one taken.
#
# `key` is what identifies the file on disk: two documents that differ only by
# version are the same source at different ages, and only the newest is kept.
SOURCES = [
    ("ucm-cards", r"^DZC_UCM_Stat", "scan_statcards"),
    ("scourge-cards", r"^DZC_Scourge_Stat", "scan_statcards"),
    ("phr-cards", r"^DZC_PHR_Stat", "scan_statcards"),
    ("shaltari-cards", r"^DZC_Shaltari_Stat", "scan_statcards"),
    ("resistance-cards", r"^DZC_Resistance_Stat", "scan_statcards"),
    ("bioficer-cards", r"^DZC_Bioficer_Stat", "scan_statcards"),
    ("behemoths", r"^Behemoth_Rules_Stats", "scan_behemoths"),
    ("rulebook", r"^A5_Dropzone_[\d.]+_Rulebook", "scan_rulebook"),
    ("errata", r"^(?:DZC_Errata|Dropzone_Commander_[\d.]+_Errata)", "reference"),
    # New with 3.02, and the only document that says what the errata CHANGED
    # per faction rather than in the core rules.
    ("faction-errata", r"Faction_Errata", "reference"),
]

PDF_RE = re.compile(r"https://cdn\.shopify\.com/[^\"'>\s]+\.pdf(?:\?[^\"'>\s]*)?")
DATE_RE = re.compile(r"_(\d{6})(?:\.pdf)?$")
# The edition point in a rulebook or errata name: "A5_Dropzone_3.02_Rulebook".
POINT_RE = re.compile(r"_(\d+(?:\.\d+)+)_")


def stamp(name: str) -> str:
    """The YYMMDD a file is dated, or '' — what makes one release newer.

    Sorting whole filenames instead of this is the trap: "Stat_Sheets_260730"
    sorts ABOVE "Stat_Cards_260804" on the S, so a rename would have pinned the
    scanner to the older file for as long as both were on disk."""
    m = DATE_RE.search(os.path.splitext(name)[0] + "")
    return m.group(1) if m else ""


def published(html: str) -> dict[str, tuple[str, str]]:
    """{key: (filename, url)} for the newest file the page offers per source."""
    out: dict[str, tuple[str, str]] = {}
    for url in sorted(set(PDF_RE.findall(html))):
        name = url.split("/")[-1].split("?")[0]
        for key, pattern, _ in SOURCES:
            if not re.search(pattern, name):
                continue
            have = out.get(key)
            if have is None or version_of(name) > version_of(have[0]):
                out[key] = (name, url)
    return out


def version_of(name: str) -> tuple[str, str]:
    """What makes one release of a source newer than another.

    Two numbers can move and they are not the same number: the stat cards carry
    a YYMMDD stamp, and the rulebook carries an edition point (3.01 -> 3.02)
    with no date at all. Sorted on the pair, so a document with only one of them
    still orders correctly against its own older self.

    Sorting whole filenames instead is the trap: "Stat_Sheets_260730" sorts
    ABOVE "Stat_Cards_260804" on the S, which would pin the scanner to the older
    file for as long as both were on disk."""
    stem = os.path.splitext(name)[0]
    m = POINT_RE.search(stem)
    point = m.group(1) if m else ""
    # Zero-padded so "3.10" sorts above "3.9" rather than below it.
    if point:
        point = ".".join(p.zfill(3) for p in point.split("."))
    return (point, stamp(name))


def on_disk(key: str, pattern: str) -> str | None:
    """The newest file we already hold for a source."""
    if not os.path.isdir(DEST):
        return None
    got = [f for f in os.listdir(DEST)
           if f.endswith(".pdf") and re.search(pattern, f)]
    return max(got, key=version_of) if got else None


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "dzc-builder/1.0"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


# A stamp of the wrong LENGTH is a typo in the link, not a date.
TYPO_STAMP_RE = re.compile(r"_(\d{7,8})(?=\.pdf$)")


def fetch(url: str, path: str) -> tuple[int, str]:
    """Download one source. Returns (bytes, the name it actually arrived as).

    THE PAGE CAN LINK A FILE THAT IS NOT THERE. On 2026-08-21 the Scourge cards
    went up as "DZC_Scourge_Stat_Cards_2608021.pdf" -- seven digits where the
    stamp is six -- and that URL 404s, while the same file with the stamp typed
    correctly serves fine. Every other faction updated that day, so taking the
    404 at face value would have left one faction a release behind with nothing
    but a line in a log to say so.

    So a 404 is retried ONCE against the corrected stamp, and the file is saved
    under the name that worked. Anything else, or a second failure, is raised:
    this is a workaround for one malformed link, not a URL guesser."""
    try:
        data = get(url)
        with open(path, "wb") as fh:
            fh.write(data)
        return len(data), os.path.basename(path)
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            raise
        name = os.path.basename(path)
        m = TYPO_STAMP_RE.search(name)
        if not m:
            raise
        # 2608021 -> 260821: the digit that does not belong is the one that
        # makes it seven, and it is not the year.
        digits = m.group(1)
        fixed_name = name.replace(digits, digits[:4] + digits[-2:], 1)
        fixed_url = url.replace(name, fixed_name, 1)
        print(f"  !! {name} is a broken link on the page; trying {fixed_name}")
        data = get(fixed_url)
        path = os.path.join(os.path.dirname(path), fixed_name)
        with open(path, "wb") as fh:
            fh.write(data)
        return len(data), fixed_name


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="report what has moved and exit 1; download nothing")
    args = ap.parse_args()

    req = urllib.request.Request(PAGE, headers={"User-Agent": "dzc-builder/1.0"})
    html = urllib.request.urlopen(req, timeout=120).read().decode("utf-8", "replace")
    live = published(html)

    missing = [key for key, _, _ in SOURCES if key not in live]
    for stem in missing:
        # Not a warning. Every stem here is something the pipeline reads, so one
        # the page has stopped offering means either a rename we must follow or
        # a scrape that has broken -- and both need a human, not a retry.
        print(f"  !! the resources page no longer offers anything matching {stem!r}")

    stale, fresh = [], []
    for key, pattern, feeds in SOURCES:
        if key not in live:
            continue
        name, url = live[key]
        have = on_disk(key, pattern)
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
            n, name = fetch(url, path)
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
