#!/usr/bin/env python3
"""
Prove every force-construction constant against the rulebook it claims to
come from.

    python tools/dzc/audit_construction.py

WHY THIS EXISTS
---------------
Everything else in data/ is scanned. data/dzc/index.json is not: game sizes,
Group maxima, the category ratio, the quarter cap, the Rare allowance and the
sharing rule are PROSE in chapter 3, transcribed by hand, and nothing ever
looked at them again. Six audits pass without reading a word of chapter 3.

That is fine while a human reads each release. It stopped being fine on
2026-08-29, when the pipeline learned to follow a new rulebook version on its
own: .github/workflows/sources.yml downloads whatever the resources page is
serving, re-scans, runs every audit, and COMMITS AND PUSHES if they pass. So
the day TTCombat change a construction rule in a point release, the cards and
the glossary update, every audit goes green because each only checks its own
internal consistency, and the builder goes on enforcing the previous edition's
rules at somebody's table with nothing on screen to say so.

3.02 did not change chapter 3 -- checked by hand, page by page, the day it
landed. The next one might, and by then nobody will be reading.

WHAT IT DOES
------------
Finds each constant's own words in the rulebook text. Not a diff of the whole
chapter, which would fail on a reflow or a capital letter: each assertion names
the number it is defending and the sentence that must still carry it. A failure
here does not mean the app is wrong -- it means a human has to read chapter 3
and decide, which is exactly the moment the automation must stop.

The faction army-building rules the builder enforces are checked the same way,
against the faction cards: the Shaltari 250pt Group rule, Gate and Subterranean
not counting against the Group allowance, and Cling's three conditions. Those
are scanned into rules.json, but the app acts on NUMBERS parsed out of them, so
the sentence disappearing is as bad as the number changing.
"""

from __future__ import annotations

import json
import os
import re
import sys

import fitz

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RULES_DIR = os.path.join(ROOT, "rules")
INDEX = os.path.join(ROOT, "data", "dzc", "index.json")


def newest_rulebook() -> str:
    def point(f: str) -> tuple[int, ...]:
        m = re.search(r"_(\d+(?:\.\d+)+)_", f)
        return tuple(int(x) for x in m.group(1).split(".")) if m else ()

    got = [f for f in os.listdir(RULES_DIR)
           if re.match(r"A5_Dropzone_[\d.]+_Rulebook", f) and f.endswith(".pdf")]
    if not got:
        raise SystemExit("no rulebook in rules/")
    return os.path.join(RULES_DIR, max(got, key=point))


def faction_cards() -> dict[str, str]:
    out = {}
    for fn in os.listdir(RULES_DIR):
        m = re.match(r"DZC_(\w+?)_Stat_(?:Cards|Sheets)_\d+\.pdf$", fn)
        if m:
            out[m.group(1).lower()] = os.path.join(RULES_DIR, fn)
    return out


def flat(path: str) -> str:
    """The document's text with whitespace normalised.

    Line breaks are where a PDF disagrees with itself between releases -- the
    same sentence wraps differently after a reflow -- so every check runs
    against one long line.
    """
    doc = fitz.open(path)
    text = " ".join(str(doc[i].get_text()) for i in range(doc.page_count))
    # The books set typographic quotes and dashes; the patterns below are
    # written with the plain ASCII ones. Named by CODE POINT rather than by
    # pasting the glyph, because the glyphs are ambiguous on sight -- which is
    # ruff's RUF001 complaint, and it is right: a reader cannot tell U+2011 from
    # a hyphen, and the only reason this line exists is that they differ.
    for fancy, plain in (("’", "'"),   # noqa: RUF001  right single quote
                         ("–", "-"),   # noqa: RUF001  en dash, "501-1000"
                         ("‑", "-"),   # noqa: RUF001  nb hyphen, "non-Gate"
                         ("”", '"')):  # right double quote, on inches
        text = text.replace(fancy, plain)
    return re.sub(r"\s+", " ", text)


FAILED: list[str] = []
_checked = 0


def must(where: str, haystack: str, needle: str, why: str) -> None:
    """`needle` is a regex the document must still contain."""
    global _checked
    _checked += 1
    if not re.search(needle, haystack, re.I):
        FAILED.append(f"{where}: {why}\n        looked for /{needle}/")


def main() -> int:
    book = newest_rulebook()
    text = flat(book)
    with open(INDEX, encoding="utf-8") as fh:
        index = json.load(fh)

    print(f"  rulebook   {os.path.basename(book)}")
    if index.get("rulebook") not in os.path.basename(book):
        FAILED.append(
            f"index.json says rulebook {index['rulebook']!r}, but rules/ holds "
            f"{os.path.basename(book)}. The constants below were transcribed "
            f"from a different printing than the one being scanned."
        )

    # 3.1 Game Size: each band's points range and its Group maximum.
    for band in index["gameSizes"]:
        label, lo, hi = band["label"], band["min"], band["max"]
        # flat() has already turned the book's en dash into a hyphen, so the
        # class only needs the plain one -- kept as a class because a future
        # printing could set either.
        rng = f"{lo}\\s*-\\s*{hi}" if hi else f"{lo}"
        must("3.1", text, rf"{label}\s*:?\s*{rng}\s*points",
             f"{label} is {lo}-{hi or 'up'} points")
        # The Group maximum sits in the SENTENCE AFTER the points range --
        # "Skirmish: 501-1000 points. 9 Groups Max." -- so the gap between them
        # spans a full stop. Bounded to a short run so it cannot reach into the
        # next band's numbers and pass on the wrong one.
        must("3.1", text,
             rf"{label}\s*:?[^:]{{0,40}}?{band['maxGroups']}\s*Groups?\s*Max",
             f"{label} allows {band['maxGroups']} Groups")

    extra = next((b.get("groupsPerExtra") for b in index["gameSizes"]
                  if b.get("groupsPerExtra")), None)
    if extra:
        must("3.1", text,
             rf"add\s*{extra['add']}\s*Groups?[^.]*?every\s*{extra['per']}\s*pts?"
             rf"[^.]*?above\s*{extra['above']}",
             f"Reconquest adds {extra['add']} Groups per {extra['per']}pts "
             f"above {extra['above']}")

    # 3.2 the category ratio and the quarter cap.
    for cat in index["armyRules"]["categoryCap"]["applies"]:
        must("3.2", text, rf"{cat}\s*Points\s*:?\s*no more than\s*Standard",
             f"{cat.title()} may not exceed Standard")
    must("3.2", text, r"no Group may cost more than 1/4 of your total allowed",
         "no Group may cost more than a quarter of the limit")

    # 3.2.1 Rare and Unique.
    # THE WORDS ARE BUILT FROM THE TRANSCRIBED NUMBERS, not typed alongside
    # them. Spelling "one ... two ... three" into the pattern only proves the
    # BOOK still says it; the number in index.json could drift to anything and
    # this would go on passing. Caught by mutating clash 2 -> 3 and watching
    # the audit stay green.
    lim = index["armyRules"]["rare"]["limits"]
    word = {1: "one", 2: "two", 3: "three", 4: "four"}
    words = [word.get(lim[k]) for k in ("skirmish", "clash", "battle")]
    if None in words:
        FAILED.append(f"3.2.1: Rare limits {lim} are outside the range this "
                      f"audit can spell; extend `word`.")
    else:
        must("3.2.1", text,
             rf"only take\s*{words[0]}\s*Rare Squad[^.]*?in a Skirmish,"
             rf"\s*{words[1]}\s*in a Clash,\s*and\s*{words[2]}\s*in a Battle",
             f"Rare is {lim['skirmish']}/{lim['clash']}/{lim['battle']} by size")
    must("3.2.1", text, r"only take one Unique Squad with the same name",
         "Unique is one per Army")

    # 3.2.2 / 3.2.3 the granularity the builder charges at.
    must("3.2.2", text, r"A Squad may contain any mixture of Variants",
         "Variants are per model")
    must("3.2.3", text,
         r"All Units of the same Variant within a Squad must be upgraded equally",
         "an upgrade is bought per Variant, not per model")

    # 3.2.4 / 3.2.4.1 the shape of a Group, which is the rule the builder
    # spends the most code on.
    must("3.2.4", text,
         r"Those Transport\(s\) form a Squad\.?\s*Those two Squads form one Group",
         "a Squad and its Transports are one Group")
    must("3.2.4", text, r"Transports must be taken full",
         "Transports must be taken full")
    must("3.2.4.1", text,
         r"Up to 4 Squads[^.]*?may all share ONE Transport",
         "up to 4 Squads may share one Transport")

    # The faction rules the builder enforces numbers out of.
    cards = faction_cards()
    if "shaltari" in cards:
        sh = flat(cards["shaltari"])
        must("Shaltari", sh,
             r"Two or more non-Gate, non-Aircraft Squads[^.]*?may form\s*Groups "
             r"if their combined points cost does not exceed\s*250\s*pts",
             "Shaltari form Groups under a 250pt cap")
        must("Shaltari", sh, r"Gates do not count against your number of allowed Groups",
             "Gates are free of the Group allowance")
        must("Shaltari", sh, r"A Gate is never part of another Group",
             "a Gate is never part of another Group")
    if "resistance" in cards:
        rs = flat(cards["resistance"])
        must("Resistance", rs,
             r"Unarmed Subterranean Units do not count against your number of allowed Groups",
             "unarmed Subterranean are free of the Group allowance")
    if "scourge" in cards:
        sc = flat(cards["scourge"])
        must("Scourge", sc,
             r"One Squad with Cling may be chosen Embarked aboard any Aircraft "
             r"without the Cling special rule",
             "Cling is one Squad, aboard an Aircraft without Cling")
        must("Scourge", sc,
             r"with the same or more initial DP than this Squad's combined DP",
             "Cling is gated on the Aircraft's initial DP")

    print(f"  {_checked} construction rules checked against the printed text")
    if FAILED:
        print(f"\n  {len(FAILED)} NO LONGER FOUND:\n", file=sys.stderr)
        for f in FAILED:
            print(f"    {f}\n", file=sys.stderr)
        print(
            "  These are hand-transcribed into data/dzc/index.json and enforced\n"
            "  by js/dzc-army.js. A rule that has moved needs a person to read\n"
            "  chapter 3 and decide -- not a re-scan.\n", file=sys.stderr)
        return 1
    print("  ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
