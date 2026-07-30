#!/usr/bin/env python3
"""
Extract the rules glossary from the Dropzone Commander 3.01 rulebook.

Chapter 10 (Unit Special Rules) and chapter 11 (Weapon Special Rules) hold the
verbatim text for every keyword a stat card can print. The cards themselves
carry rule NAMES only -- "Surveyor", "Aegis 6", "AWACS 12 (Lynx)" -- so
without this the app can show a keyword but never what it does.

Structure, which the cards' own typography makes unambiguous:

    MorrisSansW01-Medium   8pt   section number    "10.1.1"
    MorrisSansW01-Medium  12pt   rule name         "Aegis X"
    RobotoSlab-Regular     9pt   body text

so a rule runs from its number to the next number. Chapter 12 is deliberately
NOT read: it is a token icon legend, not rules text a card can reference.

Usage:
    python tools/dzc/scan_rulebook.py \
        --pdf rules/A5_Dropzone_3.01_Rulebook_Compressed.pdf \
        --out data/dzc/rules.json
"""

import argparse
import json
import os
import re
import sys

import fitz

# Typography of a rule entry.
#
# Headings are not one size. A top-level rule is 12pt ("Aegis X"), a
# sub-section is 10pt ("Flying High", "AA-R") and at least one is 11pt
# ("UC (Un-countered)"), so the heading test is a RANGE, not an equality --
# pinning it to 12 dropped every sub-section silently.
#
# The bracketed alias is its own span at 9pt in the HEADING face, exactly the
# size of body text. Font, not size, is what separates them: MorrisSans 9pt is
# "(Anti-Aircraft-Reactive)", RobotoSlab 9pt is the rule's prose.
#
# Page numbers are also MorrisSans 10pt, which collides with sub-headings, so a
# span that is nothing but digits is never a name.
NUM_FONT, NUM_SIZE = "MorrisSans", 8.0
NAME_FONT, NAME_MIN, NAME_MAX = "MorrisSans", 8.5, 12.5
BODY_FONT, BODY_SIZE = "RobotoSlab", 9.0
SIZE_TOL = 0.35

# Chapters worth reading, by their >=19pt title. Anything outside these page
# ranges is prose, scenarios or the token legend.
WANTED_CHAPTERS = ("10. Unit Special Rules", "11. Weapon Special Rules")

SECTION_RE = re.compile(r"^\d+(?:\.\d+)+$")

# ---------------------------------------------------------------- faction rules
#
# The core rulebook is NOT the whole glossary. Every faction prints its own
# special rules in the FRONT MATTER of its stat-card PDF -- Shaltari "Gate" and
# "Aircharge", PHR "Nanomachines" and "Supercruise", Scourge "Cling", Bioficer
# "Decon", Resistance "Bikes X". None of those appear in chapters 10 or 11, so
# reading the rulebook alone left 57 keywords with no text.
#
# These pages carry no section numbers, so the parse is purely typographic:
#
#   MorrisSansW01-Medium  13pt   section title  "Shaltari Unit Special Rules"
#   FuturaPT-Bold         11-14  rule name      "Gate"
#   FuturaPT-Medium       12pt   body
#
# Front matter runs until the first page of actual cards, which is recognised
# by having no Futura at all.
CARD_TITLE_FONT = "MorrisSans"
CARD_NAME_FONT = "FuturaPT-Bold"
CARD_BODY_FONT = "FuturaPT-Medium"


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def faction_pdfs(cards_dir):
    """Map faction id -> its stat-card PDF. Bioficers ship 'Stat_Sheets'."""
    out = {}
    for fn in os.listdir(cards_dir):
        m = re.match(r"DZC_(\w+?)_Stat_(?:Cards|Sheets)_\d+\.pdf$", fn)
        if m:
            out[m.group(1).lower()] = os.path.join(cards_dir, fn)
    if len(out) != 6:
        raise SystemExit(f"expected 6 faction stat-card PDFs in {cards_dir}, "
                         f"found {sorted(out)}")
    return out


def chapter_pages(doc):
    """Map each wanted chapter title to its page range (inclusive, 0-based)."""
    starts = []
    for pno in range(doc.page_count):
        for blk in doc[pno].get_text("dict")["blocks"]:
            for ln in blk.get("lines", []):
                for sp in ln["spans"]:
                    if sp["size"] >= 19 and sp["text"].strip():
                        starts.append((pno, sp["text"].strip()))
    out = {}
    for i, (pno, title) in enumerate(starts):
        if title in WANTED_CHAPTERS:
            end = starts[i + 1][0] - 1 if i + 1 < len(starts) else doc.page_count - 1
            out[title] = (pno, end)
    missing = [c for c in WANTED_CHAPTERS if c not in out]
    if missing:
        raise SystemExit(f"chapter title(s) not found in the PDF: {missing}. "
                         f"Has the rulebook been re-laid-out?")
    return out


def spans_in_order(page):
    """
    Every non-empty span, in PyMuPDF's own block order.

    Deliberately NOT re-sorted by (y, x). The section number sits in the left
    margin at a different baseline from the heading it labels, so a positional
    sort interleaves them and emits rules out of order -- 10.1.9 arrived before
    10.1.8, and headings were stranded from their numbers. The extractor's
    reading order is already correct for this single-column layout.
    """
    out = []
    for blk in page.get_text("dict")["blocks"]:
        for ln in blk.get("lines", []):
            for sp in ln["spans"]:
                if sp["text"].strip():
                    out.append(sp)
    return out


def kind(sp):
    """Classify a span as 'num', 'name', 'body' or None by font and size."""
    font, size, txt = sp["font"], sp["size"], sp["text"].strip()
    if NUM_FONT in font and abs(size - NUM_SIZE) < SIZE_TOL and SECTION_RE.match(txt):
        return "num"
    if NAME_FONT in font and NAME_MIN <= size <= NAME_MAX and not txt.isdigit():
        return "name"
    if BODY_FONT in font and abs(size - BODY_SIZE) < SIZE_TOL:
        return "body"
    return None


def tidy(s):
    """
    Collapse the whitespace a PDF line break leaves behind.

    Also repairs a hyphen orphaned by that break: the rulebook sets
    "(Anti-Aircraft-Reactive)" across two lines and the extractor returns
    "Anti-Aircraft- Reactive". Only a hyphen followed by space is joined, so
    genuine spaced compounds are untouched.
    """
    return re.sub(r"(\w)-\s+(\w)", r"\1-\2", re.sub(r"\s+", " ", s)).strip()


# A rule name may carry a spelled-out alias in brackets, because the cards print
# the abbreviation and the rulebook prints both: "Ev X (Evasion)" is referenced
# on a card as "Ev". Note "FS X(First Strike)" has no space before the bracket.
ALIAS_RE = re.compile(r"^(?P<head>.*?)\s*\((?P<alias>[^)]+)\)\s*$")


def split_alias(name):
    m = ALIAS_RE.match(name)
    if not m:
        return name, None
    return tidy(m.group("head")), tidy(m.group("alias"))


# Placeholder letters in a rule heading. X is the common one; Repair X/Y and
# Shield: X Y Z+ take two and three.
PLACEHOLDER_RE = re.compile(r"[XYZ]")


def matcher_for(name):
    """
    Build a regex that recognises a printed instance of this rule.

    Rule names are TEMPLATES: the rulebook prints "Aegis X" and a card prints
    "Aegis 6". Three things make a naive split wrong:

      - X is not always a separate word. "LX", "PX+" and "TX" have no boundary
        to split on, so a \\bX\\b split left them un-parameterised and they
        matched nothing at all.
      - The card often closes up the space. The rulebook heads "Ev X"; every
        card prints "Ev1". So whitespace in the template is optional.
      - X is not always a number. "Ineffective: X" takes a target type and
        "Repair X/Y" takes a die expression, so the wildcard is non-greedy and
        stops at the next literal rather than assuming digits.
    """
    out = []
    for i, part in enumerate(PLACEHOLDER_RE.split(name)):
        if i:
            out.append(r"(.+?)")
        out.append(_literal(part))
    return re.compile(r"^\s*" + "".join(out) + r"\s*$", re.I)


def _literal(part):
    """
    Turn a literal fragment of a heading into a forgiving pattern.

    Letters and digits stay strict -- they are what identifies the rule. Only
    the punctuation between them is loosened, because the heading and the card
    routinely disagree about it:

        Repair X/Y      heading    ->  "Repair 1: Vehicles"     card
        Dissipate -X    heading    ->  "Dissipate 1"            card
        Shield: X Y Z+  heading    ->  "Shield friendly ..."    card

    So a separator may be any of : / - or nothing, and the inches mark may be
    the curly glyph, a straight quote, or absent.
    """
    out = []
    for ch in part:
        if ch.isspace():
            out.append(r"\s*")
        elif ch in ":/-":
            out.append(r"[:/\-\s]*")
        elif ch in "”″\"":
            out.append(r"[”″\"]?")
        else:
            out.append(re.escape(ch))
    return "".join(out)


def parse(doc, pages):
    """Walk a chapter's spans, emitting one record per numbered rule."""
    rules = []
    cur = None
    mode = None
    for pno in range(pages[0], pages[1] + 1):
        for sp in spans_in_order(doc[pno]):
            k = kind(sp)
            txt = sp["text"]
            if k == "num":
                if cur:
                    rules.append(cur)
                cur = {"section": txt.strip(), "name": "", "text": "", "page": pno + 1}
                mode = "num"
            elif k == "name" and cur is not None:
                # Headings wrap: "FS X(First" then "Strike)". Consecutive name
                # spans belong to the same heading and are joined with a space.
                cur["name"] = tidy(cur["name"] + " " + txt)
                mode = "name"
            elif k == "body" and cur is not None:
                cur["text"] = (cur["text"] + " " + txt) if cur["text"] else txt
                mode = "body"
            # Anything else (page numbers, chapter titles, the odd caption) is
            # not part of a rule and is skipped without disturbing `cur`.
    if cur:
        rules.append(cur)
    return rules


def parse_front_matter(doc):
    """
    Read a faction stat-card PDF's leading rules pages.

    Yields (section_title, rule_name, body). Unlike the rulebook these entries
    have no numbers, so a rule simply runs from one FuturaPT-Bold heading to
    the next. Stops at the first page with no Futura on it -- that is the first
    card, and everything after is unit data.
    """
    out = []
    section = None
    cur = None
    for pno in range(doc.page_count):
        spans = spans_in_order(doc[pno])
        if not any(CARD_BODY_FONT in s["font"] or CARD_NAME_FONT in s["font"]
                   for s in spans):
            break
        for sp in spans:
            font, txt = sp["font"], sp["text"]
            if CARD_TITLE_FONT in font and sp["size"] >= 12.5:
                if cur:
                    out.append((section, cur[0], cur[1]))
                    cur = None
                section = tidy(txt)
            elif CARD_NAME_FONT in font:
                # Headings wrap here too, but a wrapped heading continues the
                # CURRENT rule rather than starting a new one -- only a heading
                # that follows body text is a new rule.
                if cur and not cur[1]:
                    cur = (tidy(cur[0] + " " + txt), "")
                else:
                    if cur:
                        out.append((section, cur[0], cur[1]))
                    cur = (tidy(txt), "")
            elif CARD_BODY_FONT in font and cur:
                cur = (cur[0], (cur[1] + " " + txt) if cur[1] else txt)
    if cur:
        out.append((section, cur[0], cur[1]))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", default="rules/A5_Dropzone_3.01_Rulebook_Compressed.pdf")
    ap.add_argument("--cards-dir", default="rules",
                    help="directory holding the six faction stat-card PDFs")
    ap.add_argument("--out", default="data/dzc/rules.json")
    args = ap.parse_args()

    if not os.path.exists(args.pdf):
        raise SystemExit(f"rulebook not found: {args.pdf}")

    doc = fitz.open(args.pdf)
    chapters = chapter_pages(doc)

    out = []
    seen = {}
    for title, pages in chapters.items():
        for r in parse(doc, pages):
            name = tidy(r["name"])
            if not name:
                # A numbered section with no heading is a continuation marker,
                # not a rule. Dropping it silently would hide a parse failure,
                # so it is reported.
                print(f"  ! {r['section']} on p{r['page']} has no name -- skipped",
                      file=sys.stderr)
                continue
            head, alias = split_alias(name)
            rid = slug(head)
            if rid in seen:
                raise SystemExit(
                    f"duplicate rule id {rid!r}: {seen[rid]} and {r['section']}. "
                    f"Two rules cannot share a lookup key."
                )
            seen[rid] = r["section"]
            out.append({
                "id": rid,
                "faction": None,
                "section": r["section"],
                "chapter": title,
                "name": head,
                "alias": alias,
                # A template rule ("Aegis X") is matched with a wildcard; a
                # plain one ("Climber") is matched literally.
                "parameterised": bool(PLACEHOLDER_RE.search(head)),
                "match": matcher_for(head).pattern,
                "text": tidy(r["text"]),
                "page": r["page"],
            })

    core_count = len(out)

    # Faction front matter. Ids are namespaced by faction: a faction rule may
    # legitimately share a name with a core one, and lookup resolves a unit's
    # own faction first so the specific rule wins over the general.
    for fac, pdf in sorted(faction_pdfs(args.cards_dir).items()):
        fdoc = fitz.open(pdf)
        found = 0
        for section, name, text in parse_front_matter(fdoc):
            name = tidy(name)
            if not name or not tidy(text):
                continue
            head, alias = split_alias(name)
            out.append({
                "id": f"{fac}-{slug(head)}",
                "faction": fac,
                "section": tidy(section or ""),
                "chapter": section or f"{fac} special rules",
                "name": head,
                "alias": alias,
                "parameterised": bool(PLACEHOLDER_RE.search(head)),
                "match": matcher_for(head).pattern,
                "text": tidy(text),
                "page": 1,
            })
            found += 1
        print(f"  {fac:<12} {found:>3} faction rules  ({os.path.basename(pdf)})")

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump({
            "source": os.path.basename(args.pdf),
            "chapters": {t: [p + 1 for p in pg] for t, pg in chapters.items()},
            "rules": out,
        }, fh, indent=1, ensure_ascii=False)

    par = sum(1 for r in out if r["parameterised"])
    ali = sum(1 for r in out if r["alias"])
    empty = [r["name"] for r in out if not r["text"]]
    for t, pg in chapters.items():
        print(f"  {t:<28} pages {pg[0] + 1}-{pg[1] + 1}")
    print(f"\n  {len(out)} rules  ({core_count} core, {len(out) - core_count} "
          f"faction; {par} parameterised, {ali} with an alias) -> {args.out}")
    if empty:
        print(f"  ! {len(empty)} rules have no text: {empty}", file=sys.stderr)


if __name__ == "__main__":
    main()
