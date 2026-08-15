#!/usr/bin/env python3
"""
Every word printed in a card's Special cell is in the data.

The Special cell is the unit's rules. It is also the only cell on a stat card
that is free text long enough to WRAP, and the cell is vertically centred
against a stat row one line tall -- so on a card with two lines of rules, one
of them sits ABOVE the row and the parser's own reading of "the Special column
of the stat row" saw neither the line above nor, reliably, the line below.

It cost seven units their entire rule list, silently, across four factions:
the Siren Corps, the Type-3 Strike Walker, the ATVs, the Evicerators, the
Assault Warsuits, and both the Heavy and Light Shaltari Grav-tanks. Reported by
a player, not by a test: "it looks like the sirens dont have any rules
attached" (2026-08-15).

Nothing else caught it because every other audit reads the JSON. A rule that
was never scanned is not a broken keyword, an unresolved glossary entry or a
missing weapon -- it is an empty string, and an empty string passes every check
that is not this one. So this audit does the one thing the others cannot: it
opens the PDF and compares what is PRINTED against what shipped.

Geometry rather than the parser's own window, deliberately. Reusing the reader
under test would agree with itself.
"""

import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import pymupdf as fitz
except ImportError:
    try:
        import fitz
    except ImportError:
        sys.exit("PyMuPDF required:  python -m pip install pymupdf")

import scan_statcards as cards


def words(s):
    """Rules text down to comparable tokens.

    Punctuation, quote marks and the inch mark all differ between what
    get_text() returns and what survives into JSON, and none of them is the
    thing being audited. A missing WORD is."""
    return re.sub(r"[^a-z0-9+]+", " ", (s or "").lower()).split()


def special_column(page, lines):
    """Every word printed right of the Special divider, in reading order.

    The band runs from the stat header down to the weapon table's header (or a
    little below the stat row on a card that has no weapon table), which is the
    whole cell however many lines it took."""
    headers = cards.STAT_HEADERS_BEHEMOTH
    hit = cards.find_header_row(lines, headers, need=6)
    if hit is None:
        headers = cards.STAT_HEADERS_INFANTRY
        hit = cards.find_header_row(lines, headers, need=5)
    if hit is None:
        headers = cards.STAT_HEADERS_VEHICLE
        hit = cards.find_header_row(lines, headers, need=4)
    if hit is None:
        return None
    i, hdr = hit
    cols = cards.columns_from_header(hdr, headers)
    if len(cols) < 2:
        return None
    top, hbot = min(w[1] for w in hdr), max(w[3] for w in hdr)
    rules = sorted(cards.vertical_rules(page, top, hbot))
    if len(rules) < len(cols) - 1:
        rules = sorted(set(rules) | set(cards.doc_rules(page.parent)))
    edge = cards.column_bounds(cols, rules)[-1]

    body = fitz.Rect(0, 200, page.rect.width, page.rect.height - 20)
    stat = cards.parse_stat_table(page, lines)
    floor = (stat[4] if stat else hbot + 20) + 12
    for ln in lines[i + 1:]:
        text = " ".join(w[4] for w in ln)
        if ln[0][1] > hbot + 2 and re.search(r"\bName\b|\bArc\b|\bAtt\b", text):
            floor = min(floor, min(w[1] for w in ln) - 2)
            break
    cell = [w for w in cards.words_in(page, body)
            if (w[0] + w[2]) / 2 > edge and w[1] > hbot and w[3] <= floor]
    return " ".join(w[4] for w in sorted(cell, key=lambda w: (w[1], w[0])))


def main():
    data = {}
    paths = [*sorted(glob.glob(os.path.join("data", "dzc", "faction-*.json"))),
             os.path.join("data", "dzc", "behemoths.json")]
    for path in paths:
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as fh:
            blob = json.load(fh)
        for u in blob["units"]:
            data[(blob["sourcePdf"], u["page"], u["name"])] = u

    problems, checked = [], 0
    pdfs = sorted(glob.glob(os.path.join("rules", "DZC_*_Stat_Cards_*.pdf")))
    pdfs += glob.glob(os.path.join("rules", "Behemoth_Rules_Stats_*.pdf"))
    for pdf in pdfs:
        doc = fitz.open(pdf)
        src = os.path.basename(pdf)
        for pno in range(len(doc)):
            page = doc[pno]
            header = cards.parse_header(page)
            if not header or not header["name"]:
                continue
            unit = data.get((src, pno + 1, header["name"]))
            if unit is None:
                problems.append(f"{src} p{pno + 1}: {header['name']!r} is on the card, "
                                "not in the data")
                continue
            lines = cards.line_group(cards.words_in(
                page, fitz.Rect(0, 200, page.rect.width, page.rect.height - 20)))
            printed = special_column(page, lines)
            if printed is None:
                problems.append(f"{src} p{pno + 1} {header['name']}: no stat table")
                continue
            checked += 1
            have = words(unit.get("special"))
            missing = [t for t in words(printed) if t not in have]
            if missing:
                problems.append(
                    f"{src} p{pno + 1} {header['name']}: Special is missing {' '.join(missing)}\n"
                    f"    printed: {printed}\n"
                    f"    data:    {unit.get('special')!r}")

    for p in problems:
        print("  " + p)
    print(f"\n  {checked} card(s) checked, {len(problems)} problem(s)")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
