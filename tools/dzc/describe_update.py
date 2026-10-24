#!/usr/bin/env python3
"""After an automatic rebuild: say what changed, in the app.

    python tools/dzc/describe_update.py <sources-check.json>

<sources-check.json> is what `fetch_sources.py --check --json` printed before the
download: its "stale" list names the releases this rebuild took in. This script

  - compares data/dzc/*.json in the working tree with the last commit and writes
    one What's New entry (CHANGELOG in js/dzc-shell.js) in plain words: new
    units, units gone, points changes, other card changes, rules re-read;
  - sets "updated" in data/dzc/index.json, which Settings shows as
    "Updated <month> with <file>".

It writes nothing when the rebuild changed no data. Prints the entry's lines, so
the workflow can reuse them for the commit message.
"""

from __future__ import annotations

import datetime
import json
import os
import re
import subprocess
import sys
from typing import Any

Json = dict[str, Any]

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, "data", "dzc")
SHELL = os.path.join(ROOT, "js", "dzc-shell.js")
INDEX = os.path.join(DATA, "index.json")
LF, CRLF = chr(10), chr(13) + chr(10)
CURLY = chr(0x2019)  # the app's apostrophe; a straight one would end the JS string
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]
SETS = [("faction-ucm.json", "UCM"), ("faction-scourge.json", "Scourge"),
        ("faction-phr.json", "PHR"), ("faction-shaltari.json", "Shaltari"),
        ("faction-resistance.json", "Resistance"), ("faction-bioficer.json", "Bioficer"),
        ("behemoths.json", "Behemoths"), ("fauna.json", "Fauna")]


def read(path: str) -> str:
    with open(path, encoding="utf-8", newline="") as fh:
        return fh.read()


def write(path: str, text: str) -> None:
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)


def committed(name: str) -> Json | None:
    r = subprocess.run(["git", "show", f"HEAD:data/dzc/{name}"], cwd=ROOT,
                       capture_output=True, check=False)
    return json.loads(r.stdout.decode("utf-8")) if r.returncode == 0 else None


def current(name: str) -> Json:
    return json.loads(read(os.path.join(DATA, name)))


def units(d: Json | None) -> dict[str, Json]:
    return {u["id"]: u for u in (d or {}).get("units", [])}


def without_page(u: Json) -> Json:
    return {k: v for k, v in u.items() if k != "page"}


def describe() -> list[str]:
    lines = []
    for name, label in SETS:
        old, new = units(committed(name)), units(current(name))
        for k, u in new.items():
            if k not in old:
                lines.append(f"{label}: new unit, {u['name']} ({u.get('points')} pts).")
        for k, u in old.items():
            if k not in new:
                lines.append(f"{label}: {u['name']} is no longer on the stat cards.")
        other = []
        for k, u in new.items():
            if k not in old:
                continue
            a, b = old[k].get("points"), u.get("points")
            if a != b:
                lines.append(f"{label}: {u['name']}, {a} to {b} pts.")
            elif without_page(old[k]) != without_page(u):
                other.append(u["name"])
        if other:
            names = ", ".join(other[:6]) + (" and others" if len(other) > 6 else "")
            lines.append(f"{label}: stats, weapons or rules changed for {names}.")
    for name, what in (("rules.json", "Rules"), ("rules-book.json", "Interactive Rules")):
        before = committed(name)
        if before is not None and before != current(name):
            lines.append(f"{what} re-read from the new rulebook text.")
    return lines


def month_of(files: list[str]) -> str:
    stamps = [m.group(1) for f in files if (m := re.search(r"_(\d{6})\.pdf$", f))]
    if stamps:
        s = max(stamps)
        return f"{MONTHS[int(s[2:4]) - 1]} 20{s[:2]}"
    t = datetime.date.today()
    return f"{MONTHS[t.month - 1]} {t.year}"


def add_changelog(lines: list[str]) -> None:
    s = read(SHELL)
    nl = CRLF if CRLF in s[:3000] else LF
    anchor = "  const CHANGELOG = [" + nl
    i = s.index(anchor) + len(anchor)
    items = "".join(f"      '{t.replace(chr(92), '').replace(chr(39), CURLY)}',{nl}" for t in lines)
    today = datetime.date.today().isoformat()
    entry = f"    {{ date: '{today}', title: 'TTCombat update', items: [{nl}{items}    ] }},{nl}"
    write(SHELL, s[:i] + entry + s[i:])


def set_updated(month: str, files: list[str]) -> None:
    s = read(INDEX)
    nl = CRLF if CRLF in s[:300] else LF
    label = ", ".join(os.path.splitext(f)[0] for f in files)
    line = '"updated": ' + json.dumps({"month": month, "file": label}, ensure_ascii=False) + ","
    if '"updated":' in s:
        s = re.sub(r'"updated": \{[^}]*\},', lambda _m: line, s, count=1)
    else:
        first = s.index(nl) + len(nl)  # just after the opening brace
        pad = re.match(r"\s*", s[first:])
        s = s[:first] + (pad.group(0) if pad else "  ") + line + nl + s[first:]
    json.loads(s)
    write(INDEX, s)


def main() -> int:
    with open(sys.argv[1], encoding="utf-8") as fh:
        check = json.load(fh)
    files = [x["name"] for x in check.get("stale", [])]
    lines = describe()
    if not lines:
        print("The rebuild changed no data.")
        return 0
    add_changelog(lines)
    set_updated(month_of(files), files)
    for t in lines:
        print("- " + t)
    return 0


if __name__ == "__main__":
    sys.exit(main())
