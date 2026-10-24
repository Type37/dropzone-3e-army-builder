#!/usr/bin/env python3
"""
Keep the app in step with what TTCombat currently publish.

    python tools/dzc/fetch_sources.py --check          # say what has moved, download nothing
    python tools/dzc/fetch_sources.py --check --json   # the same, as JSON for the workflow
    python tools/dzc/fetch_sources.py                  # download the sources into rules/
    python tools/dzc/fetch_sources.py --record         # after a good rebuild: remember what it read
    python tools/dzc/fetch_sources.py --recorded       # fetch exactly the recorded releases

Every number in this app comes out of these PDFs, so a release we have not
noticed is an army list priced against last month's rules. That went unnoticed
for a week: the cards on disk were dated 260730 while the resources page had
been serving 260804 and 260805, and nothing in the pipeline was looking.

What the app was built from is recorded in data/dzc/sources.json, one filename
per source. --check compares the page with that record, so the PDFs themselves
need not be kept: rules/ is a download folder (gitignored since 2026-10-24, when
it was 533 MB of committed PDF), filled when a rebuild needs it and safe to
delete. Lore, assembly guides and starter sheets are not downloaded at all;
nothing reads them.

The page is scraped rather than a list of URLs being kept here, because the URL
carries a Shopify version query that changes on every re-upload and a hardcoded
one would 404 or, worse, quietly serve a stale copy from cache. What is kept
here is the FILENAME PATTERN of each source we consume; the date suffix is
whatever the page is offering today.

Exit codes, so a scheduled job can act on them:
    0  the record matches the page (or, downloading, every source is on disk)
    1  a scanned source is newer than the record (with --check), or a download failed
    3  the resources page could not be read, so nothing was checked
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

PAGE = "https://ttcombat.com/pages/dropzone-commander-resources"
# Where TTCombat's files live. A file is served here by name alone, without the
# ?v= the page adds, which is how --recorded fetches a release it names.
CDN = "https://cdn.shopify.com/s/files/1/0965/1274/files/"
DEST = os.path.join("rules")
RECORD = os.path.join("data", "dzc", "sources.json")

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
    # Fourteen stat cards and the rules that run them. It sat in Extra-Rules
    # from 2026-10-05 until 10-24 as a PDF nobody read, because this list is
    # what decides "scanned" and it was not on it.
    ("fauna", r"^Fauna_Rules", "scan_fauna"),
    ("rulebook", r"^A5_Dropzone_[\d.]+_Rulebook", "scan_rulebook"),
    ("errata", r"^(?:DZC_Errata|Dropzone_Commander_[\d.]+_Errata)", "reference"),
    # New with 3.02, and the only document that says what the errata CHANGED
    # per faction rather than in the core rules.
    ("faction-errata", r"Faction_Errata", "reference"),
]

PDF_RE = re.compile(r"https://cdn\.shopify\.com/[^\"'>\s]+\.pdf(?:\?[^\"'>\s]*)?")
DATE_RE = re.compile(r"_(\d{6})(?:\.pdf)?$")
# A stamp of the wrong LENGTH is a typo in the link, not a date.
TYPO_STAMP_RE = re.compile(r"_(\d{7,8})(?=\.pdf$)")
# The edition point in a rulebook or errata name: "A5_Dropzone_3.02_Rulebook".
POINT_RE = re.compile(r"_(\d+(?:\.\d+)+)_")


def stamp(name: str) -> str:
    """The YYMMDD a file is dated, or '' — what makes one release newer.

    Sorting whole filenames instead of this is the trap: "Stat_Sheets_260730"
    sorts ABOVE "Stat_Cards_260804" on the S, so a rename would have pinned the
    scanner to the older file for as long as both were on disk.

    A stamp of the WRONG LENGTH is read as the date it was meant to be. The
    Scourge cards went up as "..._2608021.pdf" and the file behind that link is
    the 260821 release with a digit fat-fingered into the name; without this,
    the page's name never equals the name on disk, so --check reported "1 newer"
    on every run forever and the scheduled job re-downloaded the same file each
    week to prove it."""
    m = DATE_RE.search(os.path.splitext(name)[0] + "")
    if m:
        return m.group(1)
    m = TYPO_STAMP_RE.search(name)
    if m:
        d = m.group(1)
        return d[:4] + d[-2:]
    return ""


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


# Answers that mean "not now" rather than "no". On 2026-10-05 the page itself
# answered 429 Too Many Requests on the first request of the run; with no retry
# that was a traceback, and the workflow read the traceback's exit 1 as "a
# scanned source is newer" and went on to try a download as well.
TRANSIENT = {429, 500, 502, 503, 504}
# About seven and a half minutes in all, which outlasts a Shopify rate limit
# without holding a runner for long when the site is genuinely down.
WAITS = (30, 60, 120, 240)


def get(url: str) -> bytes:
    for wait in (*WAITS, None):
        req = urllib.request.Request(url, headers={"User-Agent": "dzc-builder/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read()
        except urllib.error.HTTPError as exc:
            if exc.code not in TRANSIENT or wait is None:
                raise
            # Shopify says how long it wants on a 429. Honoured, within reason.
            after = exc.headers.get("Retry-After", "")
            if after.isdigit():
                wait = min(max(wait, int(after)), 600)
            why = f"HTTP {exc.code}"
        except (urllib.error.URLError, TimeoutError) as exc:
            if wait is None:
                raise
            why = str(getattr(exc, "reason", exc))
        print(f"  .. {why}; trying again in {wait}s", flush=True)
        time.sleep(wait)
    raise AssertionError("unreachable")



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


def load_record() -> dict[str, str]:
    if not os.path.exists(RECORD):
        return {}
    with open(RECORD, encoding="utf-8") as fh:
        return json.load(fh)


def save_record(record: dict[str, str]) -> None:
    text = json.dumps(record, indent=1, ensure_ascii=False) + chr(10)
    with open(RECORD, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="compare the page with data/dzc/sources.json; download nothing")
    ap.add_argument("--json", action="store_true",
                    help="with --check: print what moved as JSON")
    ap.add_argument("--record", action="store_true",
                    help="write data/dzc/sources.json from the sources in rules/")
    ap.add_argument("--recorded", action="store_true",
                    help="download exactly the releases sources.json names, for the audits")
    args = ap.parse_args()

    if args.recorded:
        # For deploy.yml's audits, which compare the data with the cards it was
        # built from. Not the page's newest: a release the monthly update has not
        # taken in yet would fail them against data that is not wrong.
        os.makedirs(DEST, exist_ok=True)
        failed = 0
        for key, pattern, _ in SOURCES:
            name = load_record().get(key)
            if not name:
                continue
            if on_disk(key, pattern) == name:
                continue
            try:
                n, name = fetch(CDN + name, os.path.join(DEST, name))
                print(f"  got      {name}  ({n // 1024} KB)")
            except Exception as exc:                        # noqa: BLE001
                print(f"  FAILED   {name}: {exc}")
                failed += 1
                continue
            for old in os.listdir(DEST):
                if old.endswith(".pdf") and old != name and re.search(pattern, old):
                    os.remove(os.path.join(DEST, old))
        return 1 if failed else 0

    if args.record:
        # After a rebuild that passed every audit: what it read is now what the
        # app is built from. Taken from rules/, because that is what was scanned.
        record = load_record()
        for key, pattern, _ in SOURCES:
            have = on_disk(key, pattern)
            if have:
                record[key] = have
        save_record(record)
        print(f"  recorded {len(record)} sources in {RECORD}")
        return 0

    try:
        html = get(PAGE).decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"  !! could not read the resources page: {exc}")
        print("  Nothing was checked and nothing was downloaded.")
        return 3
    live = published(html)
    record = load_record()

    missing = [key for key, _, _ in SOURCES if key not in live]
    if not args.json:
        for stem in missing:
            # Every stem here is something the pipeline reads, so one the page
            # has stopped offering means either a rename we must follow or a
            # scrape that has broken -- and both need a person, not a retry.
            print(f"  !! the resources page no longer offers anything matching {stem!r}")

    if args.check:
        # Compared on VERSION, not on the filename. The Scourge cards were linked
        # as "..._2608021.pdf" and saved under the stamp that actually serves,
        # "..._260821.pdf", so a name-equality test called the same release
        # newer on every run.
        stale, fresh = [], []
        for key, _pattern, feeds in SOURCES:
            if key not in live:
                continue
            name, url = live[key]
            have = record.get(key)
            if have and version_of(have) == version_of(name):
                fresh.append(have)
            else:
                stale.append({"key": key, "have": have, "name": name, "url": url, "feeds": feeds})
        if args.json:
            print(json.dumps({"stale": stale, "missing": missing, "fresh": fresh}, indent=1))
        else:
            for name in fresh:
                print(f"  ok       {name}")
            for s in stale:
                print(f"  NEWER    {s['name']}   (built from {s['have'] or 'nothing'})"
                      f"  -> {s['feeds']}")
            if not stale and not missing:
                print("\n  the app is built from what the resources page serves"
                      f" ({len(fresh)} sources)")
            else:
                print(f"\n  {len(stale)} newer, {len(missing)} missing.")
        return 1 if (stale or missing) else 0

    # Download: make rules/ hold the page's current release of every source the
    # rebuild reads. Nothing else is fetched; nothing here is committed.
    os.makedirs(DEST, exist_ok=True)
    failed = 0
    for key, pattern, _feeds in SOURCES:
        if key not in live:
            continue
        name, url = live[key]
        have = on_disk(key, pattern)
        if have and version_of(have) == version_of(name):
            print(f"  have     {have}")
            continue
        try:
            n, name = fetch(url, os.path.join(DEST, name))
        except Exception as exc:                            # noqa: BLE001
            print(f"  FAILED   {name}: {exc}")
            failed += 1
            continue
        print(f"  got      {name}  ({n // 1024} KB)")
        # Only the newest release of a source stays, or the scanner could pick
        # the wrong one.
        for old in os.listdir(DEST):
            if old.endswith(".pdf") and old != name and re.search(pattern, old):
                os.remove(os.path.join(DEST, old))
                print(f"  dropped  {old}  (superseded)")
    print(f"\n  {failed} failed")
    return 1 if (failed or missing) else 0


if __name__ == "__main__":
    sys.exit(main())
