#!/usr/bin/env python3
"""
Extract the rules glossary from the Dropzone Commander 3.01 rulebook.

Chapter 10 (Unit Special Rules) and chapter 11 (Weapon Special Rules) hold the
verbatim text for every keyword a stat card can print. The cards themselves
carry rule NAMES only -- "Surveyor", "Aegis 6", "AWACS 12 (Lynx)" -- so
without this the app can show a keyword but never what it does.

Structure is read from LAYOUT, never from font names. A rule runs from its
numbered heading to the next:

    a section number   at the column's left margin      "10.1.1"
    its rule name      beside it, to the right          "Aegis X"
    body              back at the margin, smaller

Nothing here asks what typeface TTCombat licensed, because that is not a fact
about the rules -- and it has already changed under us once, when a single
heading came back set in the body face.

Chapter 12 is deliberately NOT read: it is a token icon legend, not rules text
a card can reference.

Usage:
    python tools/dzc/scan_rulebook.py \
        --pdf rules/A5_Dropzone_3.01_Rulebook_Compressed.pdf \
        --out data/dzc/rules.json
"""

import argparse
import collections
import json
import os
import re
import sys
from typing import TypedDict

import fitz

# Typography of a rule entry.
#
# A PDF carries no structure -- no "this is a heading" tag -- so type is the
# only thing separating a rule name from its prose. What matters is the
# CONTRAST between faces, never which typeface TTCombat happened to license,
# so the faces are measured from each document rather than named here. A
# re-export in a different family then costs nothing.
#
# Within a chapter that contrast is size: the body face is whatever sets the
# most text, and the heading face is whatever the chapter title uses.
#
# Headings are not one size. A top-level rule is 12pt ("Aegis X"), a
# sub-section 10pt ("Flying High", "AA-R"), and at least one 11pt
# ("UC (Un-countered)") -- so the heading test is a RANGE. Pinning it to a
# single size dropped every sub-section in silence.
#
# The bracketed alias is its own span at body SIZE but in the heading FACE:
# "(Anti-Aircraft-Reactive)" against the rule's prose. Only the face separates
# them, which is why body is matched on face and not on size alone.
#
# Page numbers share a size with sub-headings, so a span of nothing but digits
# is never a name.
SIZE_TOL = 0.35

# A span that is nothing but a bracketed phrase, e.g. "(Anti-Aircraft-Reactive)".
PAREN_ONLY = re.compile(r"^\([^)]*\)$")


class Rule(TypedDict):
    """One glossary entry, as it is printed: a number, a name, its text, and
    the page the book falls open at."""

    section: str
    name: str
    text: str
    page: int


def max_size(doc, pages):
    """Largest type in the chapter -- the chapter title, which is not a rule."""
    return max((sp["size"]
                for pno in range(pages[0], pages[1] + 1)
                for sp in spans_in_order(doc[pno]) if sp["text"].strip()),
               default=0)


def overlaps_vertically(a, b):
    """Do two spans share a line? Compared by extent, not baseline."""
    return a["bbox"][1] < b["bbox"][3] and b["bbox"][1] < a["bbox"][3]

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
# These pages carry no section numbers, so the parse is again typographic --
# and again by contrast, not by typeface name:
#
#   a rule NAME is set BOLD                    "Gate"
#   the section TITLE is not bold, in a
#     different face from the body             "Shaltari Unit Special Rules"
#   everything else in the body face is body
#
# The bold FLAG is what identifies a heading, so a re-export in another family
# still parses. Front matter runs until the first page of actual cards, which
# is recognised by having none of the body face on it.
BOLD_FLAG = 1 << 4

# Headings TTCombat forgot to bold. "Remote Drone" on the UCM sheet is set in
# the body face, so it reads as a paragraph of the rule above it and its own
# text is lost -- leaving the Starsprite's printed keyword resolving to
# nothing.
#
# Listed explicitly rather than guessed at from line length or punctuation: a
# heuristic loose enough to catch this would also promote ordinary sentences,
# and a NEW unbolded heading should fail the coverage audit loudly rather than
# be silently absorbed.
FORCE_HEADING = {"Remote Drone"}


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


# Headings the rulebook's own body text contradicts, corrected for MATCHING
# only -- the name stays what the book calls it.
#
# 10.1 heads "Hardy X" and then reads "may use a save of X+", and every card in
# the game prints "Hardy 2+", "Hardy 3+" or "Hardy 4+". Built from the heading
# as printed, X ends at the end of the string and captures "4+", so the app
# substituted it into "a save of X+" and produced "a save of 4++". Saying the
# template is "Hardy X+" gives the value the same shape its siblings already
# have -- Pen X+, Destroyer X+, Demo Charges X+ all end their capture before
# the plus.
#
# Listed explicitly, like KNOWN_TYPOS: an entry here is a decision someone
# made about a specific heading, and a new one still has to be looked at.
KNOWN_HEADING_QUIRKS = {"Hardy X": "Hardy X+"}


def matcher_pattern(head):
    return matcher_for(KNOWN_HEADING_QUIRKS.get(head, head)).pattern


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

    The capture boundaries matter beyond resolution: the app substitutes these
    groups back into the glossary text, so a wildcard that takes one character
    too many turns a tooltip into nonsense.
    """
    parts = PLACEHOLDER_RE.split(name)
    out = []
    for i, part in enumerate(parts):
        if i:
            # A value that runs up to an inches mark or a "+" is one
            # measurement or one die target, and never contains a space.
            # Saying so is what keeps "Shield: X Y" Z+" apart: an
            # any-character wildcard lets X swallow the other two, and
            # "Shield: Friendly Vehicles 6" 4+" reads back as "as defined by f
            # within r" of this Unit".
            bare = bool(part) and part[0] in "”″\"+"
            out.append(r"([^\s]+?)" if bare else r"(.+?)")
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

    So a separator may be any of : / - or a space, and the inches mark may be
    the curly glyph, a straight quote, or absent.

    A separator must consume SOMETHING. Letting it match nothing is how
    "Repair D6: Medusa" captured X as "D" and Y as "6: Medusa" -- the wildcard
    stopped one character in because the separator was happy to be empty.

    A space in the heading may be a separator on the card: the rulebook heads
    "ALT X" and "Critical X" where cards print "Alt-1" and "Critical-1", and
    reading that hyphen as part of the value gives "inflicts -1 additional DP".
    """
    out = []
    for ch in part:
        if ch.isspace():
            out.append(r"[\s:/\-]*")
        elif ch in ":/-":
            out.append(r"[:/\-\s]+")
        elif ch in "”″\"":
            out.append(r"[”″\"]?")
        else:
            out.append(re.escape(ch))
    return "".join(out)


def parse(doc, pages):
    """
    Walk a chapter's spans, emitting one record per numbered rule.

    Structure comes from POSITION, not from type. The page states it plainly:
    a section number sits at the column's left margin and its heading sits to
    the RIGHT of that number, sharing the line. Body then returns to the
    margin. So a heading is "whatever is beside the number", which holds no
    matter what the text is set in.

    That matters because the alternatives are both fragile. Font names break on
    a re-export -- and one heading is already set in the wrong face. Absolute x
    breaks too: chapter 11 is laid out in TWO columns, so body sits at x=25 on
    one page and x=217 on another, and the heading indent shifts with the width
    of its own number (10.1.1 -> 66.5, but 10.1.12.1 -> 88.4). Only the
    relationship between the number and its heading is stable.

    Position finds where a heading STARTS. It cannot find where one ends,
    because a long heading wraps and the continuation returns to the margin --
    "FS X(First" is beside its number but "Strike)" sits at x=22.7, exactly
    where body sits. What separates them there is that the continuation is
    still set at the heading's size, 12pt against body's 9pt. So the run
    continues while the type stays as large as the heading did. That is the
    same kind of relative contrast as the indent, and equally indifferent to
    which typeface is used.

    One more thing neither can settle: the spelled-out alias. "AA-R" is
    followed by "(Anti-Aircraft-Reactive)" at the margin AND at body size.
    That one is decided on content -- a span which is nothing but a bracketed
    phrase, immediately after a heading, belongs to the heading.
    """
    title_size = max_size(doc, pages)
    rules: list[Rule] = []
    cur: Rule | None = None
    for pno in range(pages[0], pages[1] + 1):
        spans = spans_in_order(doc[pno])
        i = 0
        while i < len(spans):
            sp = spans[i]
            txt = sp["text"].strip()
            if not txt or sp["size"] >= title_size - SIZE_TOL:
                i += 1                       # chapter title, never a rule
                continue
            if SECTION_RE.match(txt):
                if cur:
                    rules.append(cur)
                cur = {"section": txt, "name": "", "text": "", "page": pno + 1}
                j = i + 1
                # Where the heading starts: beside the number, right of it.
                head_size = 0
                while (j < len(spans) and overlaps_vertically(spans[j], sp)
                       and spans[j]["bbox"][0] > sp["bbox"][0]):
                    head_size = max(head_size, spans[j]["size"])
                    cur["name"] = tidy(cur["name"] + " " + spans[j]["text"])
                    j += 1
                # Where it ends: a wrapped continuation drops back to the
                # margin but keeps the heading's size.
                while (j < len(spans) and head_size
                       and spans[j]["size"] >= head_size - SIZE_TOL
                       and spans[j]["size"] < title_size - SIZE_TOL
                       and not SECTION_RE.match(spans[j]["text"].strip())):
                    cur["name"] = tidy(cur["name"] + " " + spans[j]["text"])
                    j += 1
                if j < len(spans) and PAREN_ONLY.match(spans[j]["text"].strip()):
                    cur["name"] = tidy(cur["name"] + " " + spans[j]["text"])
                    j += 1
                i = j
                continue
            if cur is not None and not txt.isdigit():   # skip page numbers
                cur["text"] = (cur["text"] + " " + sp["text"]) if cur["text"] else sp["text"]
            i += 1
    if cur:
        rules.append(cur)
    return rules


def parse_front_matter(doc):
    """
    Read a faction stat-card PDF's leading rules pages.

    Yields (section_title, rule_name, body). Unlike the rulebook these entries
    have no numbers and no indent -- title, heading and body all sit flush at
    the same x -- so position tells you nothing here and WEIGHT is the only
    signal: a rule name is what is bold. Stops at the first page carrying
    neither the body face nor a bold span; that is the first card, and
    everything after it is unit data.
    """
    # The body face of the front matter: whatever sets the most text on page 1.
    weight = collections.Counter()
    for sp in spans_in_order(doc[0]):
        if sp["text"].strip():
            weight[sp["font"]] += len(sp["text"].strip())
    if not weight:
        return []
    body_font = weight.most_common(1)[0][0]

    out = []
    section = None
    cur = None
    for pno in range(doc.page_count):
        spans = spans_in_order(doc[pno])
        if not any(s["font"] == body_font or (s["flags"] & BOLD_FLAG) for s in spans):
            break
        for sp in spans:
            font, txt, bold = sp["font"], sp["text"], bool(sp["flags"] & BOLD_FLAG)
            if not bold and font != body_font and sp["size"] >= 12.5:
                if cur:
                    out.append((section, cur[0], cur[1]))
                    cur = None
                section = tidy(txt)
            elif bold or tidy(txt) in FORCE_HEADING:
                # Headings wrap here too, but a wrapped heading continues the
                # CURRENT rule rather than starting a new one -- only a heading
                # that follows body text is a new rule.
                if cur and not cur[1]:
                    cur = (tidy(cur[0] + " " + txt), "")
                else:
                    if cur:
                        out.append((section, cur[0], cur[1]))
                    cur = (tidy(txt), "")
            elif font == body_font and cur:
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
                "match": matcher_pattern(head),
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
                "match": matcher_pattern(head),
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
