#!/usr/bin/env python3
"""
Every word printed on a card reached the data.

audit_special asks this of one cell. This asks it of the whole card, and it is
the general form of the same bug: a cell read on one line loses whatever
wrapped onto the next, and what wraps is the END of a thing -- the tail of a
rule list, the tail of a Gear name, the variant bracket after either. Nothing
about that is visible downstream. The data is well-formed, every keyword still
resolves, every audit passes, and a Type 6 Grand Walker quietly offers its
Alcyoneus the Porphyrion's Gear.

Found exactly that, on top of the seven rule lists audit_special found:
"2PT: Director 2: 4 Venus Drones (Porphyrion)" had come back as "Director 2: 4
Venus", and three of the Type 6's four pieces of Gear plus two of the Type 7's
four had lost the Variant they belong to.

WHAT THIS PROVES, AND WHAT IT DOES NOT. It proves no word was dropped. It does
NOT prove a word landed in the right field: the tokens are pooled per card, so
the Variant brackets the Gear reader was losing -- "(Alcyoneus)", "(Tethys)" --
went on passing, because those words are the unit's Variant names and were in
the record anyway. This caught that bug by its other half, the truncated
"Drones". Per-field would be stronger and is a much larger audit; where a field
is worth proving on its own, it gets its own one, which is what audit_special
is.

What is deliberately NOT compared:

  the transport symbols   Their shapes are glyphs, and get_text maps a glyph to
                          whatever character it happens to be -- a hollow
                          triangle comes back as "1". The numbers inside them
                          are read from the drawings, not the text, and
                          audit_transport is what proves them.
  the flavour text        Prose under the tables, dropped on purpose. Whether
                          any of it is really a rule is a question of its own;
                          the footnote above it is data and IS compared.
  card furniture          Column headings and the words "Squad Size".
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

# The symbol block sits in the top-left corner above every table on every card.
SYMBOLS_BOTTOM = 130.0

# Column headings, and the two labels that are not data.
FURNITURE = {
    "squad", "size", "type", "mv", "of", "df", "b", "dp", "a", "power", "name",
    "arc", "ma", "r", "att", "ac", "e", "special", "gear", "group", "groups",
    "equivalent", "pt", "pts", "rare", "unique", "n",
}


def words(s):
    return re.sub(r"[^a-z0-9+]+", " ", (s or "").lower()).split()


def in_data(u):
    """Every token the record holds, in any field."""
    out = []
    out += words(u["name"]) + words(u.get("pointsRaw")) + words(u.get("category"))
    out += words(u.get("type")) + words(u.get("base")) + words(u.get("special"))
    out += words(u.get("upgradeNote"))
    for k, v in (u.get("stats") or {}).items():
        out += words(k) + words(v)
    for v in u.get("variants") or []:
        out += words(v["name"]) + words(str(v.get("points")))
    for g in u.get("gear") or []:
        out += words(g.get("name")) + words(g.get("power"))
        out += words(" ".join(g.get("variants") or []))
    for w in u.get("weapons") or []:
        for k in ("name", "arc", "ma", "r", "att", "ac", "e", "special"):
            out += words(w.get(k))
        out += words(str(w.get("upgradePoints")))
        out += words(" ".join(w.get("variants") or []))
    out += words(json.dumps(u.get("swaps") or [], ensure_ascii=False))
    for k in ("squadMin", "squadMax", "groupEquivalent"):
        if u.get(k) is not None:
            out.append(str(u[k]))
    t = u.get("transport") or {}
    for b in (t.get("capacity") or []) + (t.get("fills") or []):
        out.append(str(b.get("n")))

    have = set(out)
    # "1PT" on a Gear line is power 1; "(+5pts)" on a weapon is upgradePoints 5.
    for x in list(have):
        if x.isdigit() or x.endswith("+"):
            have |= {x + "pt", x + "pts", "+" + x + "pts", x + "+pt"}
    # The cards print a weapon's variant bracket in the singular where the
    # variant itself is plural -- "(Recon ATV)" against "Recon ATVs". The
    # scanner resolves it; this has to know that it did.
    have |= {x[:-1] for x in have if x.endswith("s") and len(x) > 2}
    return have


def printed(page):
    """Every word on the card that is meant to be read as data."""
    lore = cards.lore_top(page, 200, 0)
    body = fitz.Rect(0, SYMBOLS_BOTTOM, page.rect.width, page.rect.height)
    out = []
    for line in cards.line_group(cards.words_in(page, body)):
        if lore is not None and min(w[1] for w in line) >= lore - 1:
            continue
        # Joined per LINE, because a name broken over a line end ("Sala-" /
        # "din") is only rejoinable against the line it broke from.
        out += words(cards.join_broken_hyphen(" ".join(w[4] for w in line)))
    return out


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
            data[(blob["sourcePdf"], u["page"])] = u

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
            unit = data.get((src, pno + 1))
            if unit is None:
                continue
            checked += 1
            have = in_data(unit) | FURNITURE
            missing = sorted({t for t in printed(page) if t not in have})
            if missing:
                problems.append(f"{src} p{pno + 1} {unit['name']}: "
                                f"on the card, in no field: {' '.join(missing)}")

    for p in problems:
        print("  " + p)
    print(f"\n  {checked} card(s) checked, {len(problems)} problem(s)")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
