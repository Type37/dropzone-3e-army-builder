#!/usr/bin/env python3
"""Lift chapters 1-12 of the rulebook, and both errata documents, as a browsable tree.

Run:  python tools/dzc/extract_rules_wiki.py
      python tools/dzc/extract_rules_wiki.py --dry

Why this exists
---------------
scan_rulebook.py already lifts chapters 10 and 11 -- as a flat glossary of
keywords, so a stat card can explain "Aegis 6". It deliberately reads nothing
else. The other ten chapters -- how a CQB resolves, what Sited means, how a
Zone is Contested, the whole Activation sequence -- have never been in the repo
at all. This lifts the book whole, as structure: chapter -> section ->
subsection, numbered as the book numbers them, so 8.3.1 in the app is 8.3.1 on
paper and the book's own cross-references can become links.

It also lifts the two errata PDFs into the same file, entry by entry, and says
for each one whether the rulebook on disk ALREADY carries the amended text. The
FAQ's first page says "The digital rules already incorporate these changes",
and that is a claim worth checking rather than trusting: where it holds, the
wiki must not apply an erratum twice; where it does not, the wiki must show it.

It writes data/dzc/rules-wiki.json. It does not touch data/dzc/rules.json,
which is scan_rulebook.py's and which the app already reads.

Verbatim, always
----------------
Every character emitted is a character the PDF prints. Nothing is paraphrased,
summarised or corrected. A typo in the book is a typo in the output, and the
report names the ones this run noticed so that nobody "fixes" them by hand.

What it reads, and how
----------------------
  rulebook      A5_Dropzone_<point>_Rulebook*.pdf           chapters 1-12
  errata        Dropzone_Commander_<point>_Errata_FAQ.pdf    errata + FAQ
  faction       Dropzone_Commander_<point>_Faction_Errata_Updates.pdf

Each is the newest on disk by EDITION POINT, never a pinned filename -- see
extract_tokens.py for how a pinned 3.01 path went on being read after 3.02.

The rulebook is A5 and two-column. Flattened page text interleaves the columns
line by line, so nothing is ever read flat: lines come out of get_text("dict")
with their boxes, and each page is cut into full-width bands (tables, chapter
banners) and two-column stretches (left column top to bottom, then right).

Headings are MorrisSans and body is RobotoSlab-Regular 9pt, and a heading's
DEPTH comes from its number: "10.1.12.1" is four deep whatever size it is set
at. In this book the number and the title are separate spans -- "10.1.1" at 8pt
beside " Aegis X”" at 12pt, "1.1" at 10pt beside "Dice" at 12pt -- and the
centred section titles are drawn twice, the second copy 2pt off the first, so
spans are de-duplicated by position with a tolerance before anything else.

Unlike Dropfleet, this book sets NO bold anywhere in chapters 1-12 (checked:
zero bold-flagged or Bold-face spans). The "b" flag on a run is kept in the
schema so both games share one renderer; here it is simply never set.

The three PDFs are tracked in rules/ (.gitignore re-includes rules/**), so this
can run anywhere the repo is checked out. Run it when any of them changes.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
from collections import Counter, defaultdict
from itertools import pairwise
from typing import Any, cast

import fitz

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT_DEFAULT = ROOT / "data" / "dzc" / "rules-wiki.json"


def _point(p: pathlib.Path) -> tuple[int, ...]:
    m = re.search(r"_(\d+(?:\.\d+)+)_", p.name)
    return tuple(int(x) for x in m.group(1).split(".")) if m else ()


def _newest(pattern: str) -> pathlib.Path:
    got = sorted((ROOT / "rules").glob(pattern), key=_point)
    if not got:
        raise SystemExit(f"no {pattern} in rules/")
    return got[-1]


# ---------------------------------------------------------------- typography
HEAD_FACE = "MorrisSans"
CHAPTER_MIN = 18.0          # "1. The Basics" 20pt, "7. Embarking & Disembarking" 19pt
STOP_CHAPTER = 13           # 13. Behemoths and the faction plates are not the core book
# An unnumbered MorrisSans line is a heading only at scenario-name size (14pt,
# "Battle Royale"). At 12pt and under it is a diagram label ("ZONE"), a figure
# caption ("Example Buildings / Areas") or a table column head, and it is kept
# as a caption -- in place, never dropped.
UNNUMBERED_HEAD_MIN = 13.5
FOLIO_Y = 570.0             # page numbers sit at y=576.5
HEAD_GAP = 24.0             # a wider gap than this on one heading line is two headings

NUMBERED_HEAD = re.compile(r"^(\d+(?:\.\d+)+)\s*([^\d.\s].*)$")
CHAPTER_HEAD = re.compile(r"^(\d+)\.\s*([^\d\s].*)$")
FOLIO = re.compile(r"^\d{1,3}$")
BULLET = re.compile(r"^\s*[•]\s*")
# "see 10.1.16" -- but never a measurement ("1.5”") or a version ("3.02").
XREF = re.compile(r"(?<![\d.])(\d+\.\d+(?:\.\d+)*)(?![\d”″\"])")

FFFD_INCH = re.compile(r"(?<=\d)�")


def repair(s: str) -> str:
    """U+FFFD after a digit is an inch mark, anywhere else an apostrophe.

    3.02 maps its quotes correctly and the report prints a count of 0. The
    repair stays because the stat-card PDFs beside it do lose them."""
    s = FFFD_INCH.sub("”", s)
    return s.replace("�", "\u2019").replace("\n", " ")


def tidy(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


# ---------------------------------------------------------------- spans
def page_blocks(page: fitz.Page) -> list[dict[str, Any]]:
    """Text blocks, spans de-duplicated by position, each span marked with
    whether it starts a printed line (only a line break implies a space)."""
    out: list[dict[str, Any]] = []
    seen: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for blk in cast(dict[str, Any], page.get_text("dict"))["blocks"]:
        if blk.get("type") == 1:
            continue
        lines = []
        for ln in blk.get("lines", []):
            spans = []
            for sp in ln["spans"]:
                txt = repair(sp["text"])
                if not txt.strip():
                    continue
                x0, y0, x1, y1 = sp["bbox"]
                key = txt.strip()
                # The centred section titles are printed twice, 2pt apart, and
                # not always in the same block. Exact-position matching kept
                # both copies of "6.2", left one without its title, and lost
                # section 6.2 Attacking entirely.
                if any(abs(x - x0) < 2.5 and abs(y - y0) < 3 for x, y in seen[key]):
                    continue
                seen[key].append((x0, y0))
                spans.append({
                    "text": txt, "font": sp["font"], "size": round(sp["size"], 1),
                    "bold": "Bold" in sp["font"] or bool(sp["flags"] & (1 << 4)),
                    "x0": x0, "y0": y0, "x1": x1, "y1": y1,
                })
            if spans:
                for i, s in enumerate(spans):
                    s["ls"] = i == 0
                lines.append({"spans": spans,
                              "y0": min(s["y0"] for s in spans),
                              "y1": max(s["y1"] for s in spans),
                              "x0": min(s["x0"] for s in spans),
                              "x1": max(s["x1"] for s in spans)})
        if lines:
            out.append({"lines": lines,
                        "x0": min(ln["x0"] for ln in lines), "x1": max(ln["x1"] for ln in lines),
                        "y0": min(ln["y0"] for ln in lines), "y1": max(ln["y1"] for ln in lines)})
    return out


def is_head_line(ln: dict[str, Any]) -> bool:
    return all(HEAD_FACE in sp["font"] for sp in ln["spans"])


def _yc(s: dict[str, Any]) -> float:
    return (s["y0"] + s["y1"]) / 2


LINE_END_COMPOUND = re.compile(r"\w[-/]\s+$")
SUSPENDED = re.compile(r"^\s*(?:and|or|to)\b")


def join_at_break(prev: str, nxt: str) -> tuple[str, str]:
    """(prev, separator) for a point where the book broke a LINE.

    A plain line break is owed a space. A compound broken at the end of a line
    -- "Embarking/ |Disembarking", "Bodyguards- |Commanders in Squads" -- keeps
    the line's trailing space inside the span; that space belongs to the line,
    not to the book, so it is stripped and the halves join. A suspended hyphen
    ("Energy- and Kinetic") keeps its space. Two spans that merely abut on ONE
    line never come through here at all: the book printed no space between
    them and none is invented."""
    if LINE_END_COMPOUND.search(prev) and not SUSPENDED.match(nxt):
        return prev.rstrip(), ""
    if prev.endswith((" ", "-", "\u2013", "—", "/")) or nxt.startswith(" "):
        return prev, ""
    return prev, " "


def head_text(spans: list[dict[str, Any]]) -> str:
    out = ""
    prev = None
    for s in spans:
        t = s["text"]
        if prev is not None and abs(_yc(s) - _yc(prev)) > 0.45 * max(s["size"], prev["size"]):
            out, sep = join_at_break(out, t)
            out += sep
        out += t
        prev = s
    return tidy(out)


def head_pieces(pool: list[dict[str, Any]], mid: float) -> list[dict[str, Any]]:
    """Consecutive heading-face lines -> one piece per heading.

    Spans are first regrouped into VISUAL lines by their vertical centre,
    because a section number (10pt) and its title (12pt) sit 2pt apart in y and
    PyMuPDF sometimes reports them as two lines in the wrong order. A visual
    line is then split where it crosses the gutter, and a heading that wrapped
    onto the next visual line is joined back unless that line opens a number of
    its own.
    """
    rows: list[dict[str, Any]] = []
    for s in sorted(pool, key=_yc):
        if rows and abs(_yc(s) - rows[-1]["yc"]) < 0.45 * max(s["size"], rows[-1]["size"]):
            rows[-1]["spans"].append(s)
            rows[-1]["size"] = max(rows[-1]["size"], s["size"])
        else:
            rows.append({"yc": _yc(s), "size": s["size"], "spans": [s]})
    cands: list[list[dict[str, Any]]] = []
    for r in rows:
        group: list[dict[str, Any]] = []
        for s in sorted(r["spans"], key=lambda s: s["x0"]):
            if group and ((group[-1]["x1"] <= mid < s["x0"])
                          or s["x0"] - group[-1]["x1"] > HEAD_GAP):
                cands.append(group)
                group = []
            group.append(s)
        if group:
            cands.append(group)
    out: list[list[dict[str, Any]]] = []
    for g in cands:
        text = head_text(g)
        starts_new = bool(NUMBERED_HEAD.match(text) or CHAPTER_HEAD.match(text))
        side = g[0]["x0"] >= mid
        if out:
            pg = out[-1]
            psize = max(s["size"] for s in pg)
            pyc = max(_yc(s) for s in pg)
            pside = pg[0]["x0"] >= mid
            if side == pside and 0 < _yc(g[0]) - pyc <= 1.4 * psize and not starts_new:
                pg.extend(g)
                continue
        out.append(list(g))
    return [{"kind": "head", "spans": g,
             "x0": min(s["x0"] for s in g), "x1": max(s["x1"] for s in g),
             "y0": min(s["y0"] for s in g), "y1": max(s["y1"] for s in g)} for g in out]


def split_block(b: dict[str, Any], mid: float) -> list[dict[str, Any]]:
    """A PyMuPDF block is not a paragraph: it will hold a heading AND the
    paragraph under it, or two paragraphs. Cut it back into headings and
    paragraphs. Lines of body stay one paragraph while each starts no more than
    1.35 line-heights below the last; the paragraph gap in this book is ~1.8."""
    pieces: list[dict[str, Any]] = []
    lines = b["lines"]
    i = 0
    while i < len(lines):
        if is_head_line(lines[i]):
            pool = []
            while i < len(lines) and is_head_line(lines[i]):
                pool += lines[i]["spans"]
                i += 1
            pieces += head_pieces(pool, mid)
            continue
        ln = lines[i]
        prev = pieces[-1] if pieces else None
        size = max(s["size"] for s in ln["spans"])
        if prev and prev["kind"] == "para" and 0 < ln["y0"] - prev["last_y0"] <= 1.35 * size:
            prev["spans"] += ln["spans"]
            prev["last_y0"] = ln["y0"]
            prev["x0"] = min(prev["x0"], ln["x0"])
            prev["x1"] = max(prev["x1"], ln["x1"])
            prev["y1"] = max(prev["y1"], ln["y1"])
        else:
            pieces.append({"kind": "para", "spans": list(ln["spans"]), "last_y0": ln["y0"],
                           "x0": ln["x0"], "x1": ln["x1"], "y0": ln["y0"], "y1": ln["y1"]})
        i += 1
    return pieces


def merge_wrapped_heads(pieces: list[dict[str, Any]], mid: float) -> list[dict[str, Any]]:
    """Join a title that wrapped across BLOCKS.

    head_pieces joins a wrapped title inside one block, but PyMuPDF does not
    keep a centred title's lines in one block. "7.4 Groups" / "and Embarking/"
    / "Disembarking" (p25) came back as a two-line section title plus a
    one-word caption, and the scenario card "Command and" / "Control" (p39) as
    two scenarios, the first holding one paragraph and the second the rest.

    A heading piece absorbs the next heading piece below it when both are the
    same size, in the same column, no more than 1.4 lines apart, centred on
    roughly the same axis (or sharing a left edge), and the lower one does not
    open a number of its own.
    """
    heads = sorted((p for p in pieces if p["kind"] == "head"), key=lambda p: p["y0"])
    gone: set[int] = set()
    for p in heads:
        if id(p) in gone:
            continue
        while True:
            size = max(s["size"] for s in p["spans"])
            bottom = max(_yc(s) for s in p["spans"])
            axis = (p["x0"] + p["x1"]) / 2
            nxt = None
            for q in heads:
                if q is p or id(q) in gone:
                    continue
                if (q["x0"] >= mid) != (p["x0"] >= mid):
                    continue
                if abs(max(s["size"] for s in q["spans"]) - size) > 0.6:
                    continue
                dy = min(_yc(s) for s in q["spans"]) - bottom
                if not 0 < dy <= 1.4 * size:
                    continue
                if abs((q["x0"] + q["x1"]) / 2 - axis) > 40 and abs(q["x0"] - p["x0"]) > 3:
                    continue
                text = head_text(q["spans"])
                if NUMBERED_HEAD.match(text) or CHAPTER_HEAD.match(text) or FOLIO.match(text):
                    continue
                nxt = q
                break
            if nxt is None:
                break
            p["spans"] = p["spans"] + nxt["spans"]
            p["x0"], p["x1"] = min(p["x0"], nxt["x0"]), max(p["x1"], nxt["x1"])
            p["y1"] = max(p["y1"], nxt["y1"])
            gone.add(id(nxt))
    return [p for p in pieces if id(p) not in gone]


def pieces_in_reading_order(page: fitz.Page, blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Left column then right, band by band between full-width content.

    Ordered as PIECES, not blocks: a block can hold two section titles that
    share a baseline across the gutter, and ordered whole both titles precede
    both columns of prose, filing the left column under the right-hand title.
    """
    mid = page.rect.width / 2
    # A table that crosses the gutter is one full-width band top to bottom,
    # even where no single row does: a short header row otherwise reads as two
    # columns of the page and opens the table a section early. (Found on the
    # Dropfleet book, page 18; the same layout exists here.)
    wide_tables = [r for r in table_regions(page, blocks)
                   if r["x0"] < mid - 20 and r["x1"] > mid + 20]
    pieces = merge_wrapped_heads([p for b in blocks for p in split_block(b, mid)], mid)
    if not pieces:
        return []

    def straddles(p):
        if any(_in_region(p, r) for r in wide_tables):
            return True
        return p["x0"] < mid - 20 and p["x1"] > mid + 20

    full = [p for p in pieces if straddles(p)]
    bands = [(p["y0"], p["y1"]) for p in full]
    changed = True
    while changed:
        changed = False
        for p in pieces:
            if any(p is f for f in full):
                continue
            for i, (t, bt) in enumerate(bands):
                if p["y0"] < bt and t < p["y1"]:
                    bands[i] = (min(t, p["y0"]), max(bt, p["y1"]))
                    full.append(p)
                    changed = True
                    break

    def in_band(p):
        return any(p["y0"] < bt and t < p["y1"] for t, bt in bands)

    cols = [p for p in pieces if not in_band(p)]
    segs: list[tuple[float, str, list[dict[str, Any]]]] = []
    for t, bt in bands:
        segs.append((t, "full", [p for p in full if p["y0"] < bt and t < p["y1"]]))
    cut = sorted({0.0, page.rect.height, *[t for t, _ in bands], *[bt for _, bt in bands]})
    for lo, hi in pairwise(cut):
        members = [p for p in cols if lo <= p["y0"] < hi]
        if members:
            segs.append((lo, "col", members))
    segs.sort(key=lambda s: s[0])

    order: list[dict[str, Any]] = []
    placed: set[int] = set()
    for _, kind, members in segs:
        members = [m for m in members if id(m) not in placed]
        placed.update(id(m) for m in members)
        if kind == "full":
            order += sorted(members, key=lambda p: (round(p["y0"], 1), p["x0"]))
            continue
        left = sorted((p for p in members if p["x0"] < mid), key=lambda p: p["y0"])
        right = sorted((p for p in members if p["x0"] >= mid), key=lambda p: p["y0"])
        # A column of nothing but titles is a column of card titles, and its
        # prose is beside it, not below it -- read across.
        if left and all(p["kind"] == "head" for p in left) \
                and right and any(p["kind"] == "para" for p in right):
            order += sorted(members, key=lambda p: (round(p["y0"] / 6), p["x0"]))
        else:
            order += left + right
    return order


# ---------------------------------------------------------------- tables
def _in_region(b: dict[str, Any], reg: dict[str, Any]) -> bool:
    return (b["y0"] >= reg["y0"] - 1 and b["y1"] <= reg["y1"] + 1
            and b["x0"] >= reg["x0"] - 2 and b["x1"] <= reg["x1"] + 2)


def table_regions(page: fitz.Page, blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """find_tables() for COLUMN boundaries only. Its row count is not trusted
    (on the Dropfleet book it dropped a whole Crippling Effect off the bottom of
    a table) and a region holding a real heading is not a table at all: the
    ruled box around a centred section title reads as a grid."""
    out: list[dict[str, Any]] = []
    try:
        finder = page.find_tables()
    except Exception:  # noqa: BLE001 -- a page find_tables cannot read has no tables to offer
        return out
    found = finder.tables if finder is not None else []
    for t in found:
        if len(t.rows) < 2 or t.col_count < 2:
            continue
        widest = max(t.rows, key=lambda r: sum(c is not None for c in r.cells))
        starts = sorted(c[0] for c in widest.cells if c)
        if len(starts) < 2:
            continue
        x0, y0, x1, y1 = t.bbox
        y1 = _extend_region(blocks, x0, y0, x1, y1)
        reg = {"x0": x0, "x1": x1, "y0": y0, "y1": y1, "cols": starts}
        if any(HEAD_FACE in sp["font"] and sp["size"] >= 10
               for b in blocks if _in_region(b, reg)
               for ln in b["lines"] for sp in ln["spans"]):
            continue
        out.append(reg)
    return out


def _extend_region(blocks, x0, y0, x1, y1):
    """Take back rows find_tables left off the bottom: a block below the table,
    inside its width and INDENTED past its left edge (prose starts hard on the
    column margin), is a row. A block that STARTS inside the table but runs past
    its bottom is one too -- skipping those is how a tall last row escaped."""
    grew = True
    while grew:
        grew = False
        for b in blocks:
            if b["y1"] <= y1 + 0.5 or b["y0"] < y0 - 1 or b["y0"] > y1 + 30:
                continue
            if b["x0"] < x0 + 5 or b["x1"] > x1 + 2:
                continue
            y1 = b["y1"]
            grew = True
    return y1


def build_table(blocks, reg) -> dict[str, Any] | None:
    members = [b for b in blocks if _in_region(b, reg)]
    if not members:
        return None
    rows, used = [], set()
    for b in sorted(members, key=lambda b: b["y0"]):
        if id(b) in used:
            continue
        group, lo, hi = [b], b["y0"], b["y1"]
        used.add(id(b))
        grew = True
        while grew:
            grew = False
            for o in members:
                if id(o) not in used and o["y0"] < hi and lo < o["y1"]:
                    group.append(o)
                    used.add(id(o))
                    lo, hi = min(lo, o["y0"]), max(hi, o["y1"])
                    grew = True
        rows.append((lo, group))
    rows.sort(key=lambda r: r[0])

    def col_of(x):
        idx = 0
        for i, cx in enumerate(reg["cols"]):
            if x >= cx - 3:
                idx = i
        return idx

    out_rows = []
    for _, group in rows:
        cells: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for b in sorted(group, key=lambda b: (b["y0"], b["x0"])):
            for ln in b["lines"]:
                for sp in ln["spans"]:
                    cells[col_of(sp["x0"])].append(sp)
        out_rows.append([runs_from_spans(cells.get(i, [])) for i in range(len(reg["cols"]))])
    header = None
    first = rows[0][1] if rows else []
    if first and all(HEAD_FACE in sp["font"]
                     for b in first for ln in b["lines"] for sp in ln["spans"]):
        header = ["".join(r["t"] for r in cell) for cell in out_rows[0]]
        out_rows = out_rows[1:]
    return {"kind": "table", "header": header, "rows": out_rows}


# ---------------------------------------------------------------- runs
def runs_from_spans(spans: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Spans -> runs split only where bold changes. A space is added only at a
    printed line break, never where two spans abut on one line."""
    runs: list[dict[str, Any]] = []
    for sp in spans:
        t = sp["text"]
        sep = ""
        if runs and sp.get("ls"):
            runs[-1]["t"], sep = join_at_break(runs[-1]["t"], t)
        if runs and runs[-1]["b"] == sp["bold"]:
            runs[-1]["t"] += sep + t
        else:
            if runs:
                runs[-1]["t"] += sep
            runs.append({"t": t, "b": sp["bold"]})
    out = []
    for r in runs:
        t = re.sub(r"\s+", " ", r["t"])
        if not t.strip():
            if out:
                out[-1]["t"] += " "
            continue
        run: dict[str, Any] = {"t": t}
        if r["b"]:
            run["b"] = True
        out.append(run)
    if out:
        out[0]["t"] = out[0]["t"].lstrip()
        out[-1]["t"] = out[-1]["t"].rstrip()
    return [r for r in out if r["t"]]


def para_of(spans, kind="p") -> dict[str, Any] | None:
    runs = runs_from_spans(spans)
    if not runs:
        return None
    if kind == "p" and BULLET.match(runs[0]["t"]):
        kind = "li"
        runs[0]["t"] = BULLET.sub("", runs[0]["t"])
        runs = [r for r in runs if r["t"]]
    return {"kind": kind, "runs": runs} if runs else None


def heading_of(spans) -> tuple[Any, ...] | None:
    """("folio",) | (number|None, title, depth|None, size) | None (= caption)."""
    if not spans or not all(HEAD_FACE in s["font"] for s in spans):
        return None
    text = head_text(spans)
    size = max(s["size"] for s in spans)
    if FOLIO.match(text) and min(s["y0"] for s in spans) > FOLIO_Y:
        return ("folio",)
    m = CHAPTER_HEAD.match(text)
    if m and size >= CHAPTER_MIN:
        return (m.group(1), tidy(m.group(2)), 1, size)
    m = NUMBERED_HEAD.match(text)
    if m:
        return (m.group(1), tidy(m.group(2)), m.group(1).count(".") + 1, size)
    if size >= UNNUMBERED_HEAD_MIN:
        return (None, text, None, size)
    return None


# ---------------------------------------------------------------- rulebook walk
TABLE_STOPWORDS = {"d", "result", "type", "special", "the", "of", "and", "a",
                   "to", "in", "be", "used", "cannot", "for", "or"}


def table_words(s: str) -> set[str]:
    """The words a table's column heads share with a section heading."""
    return {w.rstrip("s") for w in re.findall(r"[a-z]+", s.lower())} - TABLE_STOPWORDS


def extract_book(doc: fitz.Document, report: dict[str, Any]) -> list[dict[str, Any]]:
    root: list[dict[str, Any]] = []
    stack: list[tuple[int, dict[str, Any]]] = []
    started = stopped = False
    counts = Counter()

    for pno in range(doc.page_count):
        if stopped:
            break
        page = doc[pno]
        blocks = page_blocks(page)
        regions = table_regions(page, blocks)
        done: set[tuple[float, float]] = set()
        for piece in pieces_in_reading_order(page, blocks):
            reg = next((r for r in regions if _in_region(piece, r)), None)
            if reg is not None:
                if not started:
                    continue
                key = (round(reg["y0"], 1), round(reg["x0"], 1))
                if key in done:
                    continue
                done.add(key)
                tbl = build_table(blocks, reg)
                if tbl and stack:
                    # A full-width table sits under both columns, so reading
                    # order cannot say which column's section owns it (on the
                    # Dropfleet book the answer is the right column on one page
                    # and the left on another). Its own column heads can: it
                    # goes to the section opened on this page whose heading
                    # shares the most words with them, else to the section
                    # being read.
                    head_words = table_words(" ".join(tbl["header"] or []))
                    owner, best = stack[-1][1], 0
                    for _, cand in walk(root):
                        if cand["page"] == pno + 1:
                            score = len(head_words & table_words(cand["heading"]))
                            if score > best:
                                owner, best = cand, score
                    owner["body"].append(tbl)
                    counts["tables"] += 1
                continue

            spans = piece["spans"]
            head = heading_of(spans) if piece["kind"] == "head" else None
            if head == ("folio",):
                continue
            if head and head[2] == 1:
                if int(head[0]) >= STOP_CHAPTER:
                    stopped = True
                    break
                started = True
            if not started:
                continue

            if head:
                number, title, depth, _size = head
                if depth is None:
                    # An unnumbered heading here is a scenario card (14pt), and
                    # it belongs to its CHAPTER. The twelve cards follow
                    # 9.7.8.2 Remaining Intel on the page, and hanging them off
                    # the nearest numbered section filed "Battle Royale" five
                    # levels deep as a kind of Remaining Intel objective.
                    while stack and stack[-1][0] > 1:
                        stack.pop()
                    depth = 2
                node = {"id": None, "number": number, "heading": title,
                        "page": pno + 1, "body": [], "children": []}
                while stack and stack[-1][0] >= depth:
                    stack.pop()
                (stack[-1][1]["children"] if stack else root).append(node)
                stack.append((depth, node))
                continue

            kind = "caption" if piece["kind"] == "head" else "p"
            para = para_of(spans, kind)
            if para and stack:
                stack[-1][1]["body"].append(para)
                counts[para["kind"]] += 1

    report["counts"] = dict(counts)
    assign_ids(root)
    return root


def assign_ids(nodes, parent_id=None):
    """Every node gets a stable id: its number, or -- for the unnumbered
    scenario cards -- its parent's id plus a slug of its own name."""
    used = set()
    for n in nodes:
        base = n["number"] or f"{parent_id or 'book'}/{slug(n['heading'])}"
        nid, k = base, 2
        while nid in used:
            nid, k = f"{base}-{k}", k + 1
        used.add(nid)
        n["id"] = nid
        assign_ids(n["children"], nid)


def walk(nodes, depth=1):
    for n in nodes:
        yield depth, n
        yield from walk(n["children"], depth + 1)


def plain(node, deep=False) -> str:
    out = []
    for item in node["body"]:
        if item["kind"] == "table":
            if item["header"]:
                out.append(" | ".join(item["header"]))
            out += [" | ".join("".join(r["t"] for r in c) for c in row) for row in item["rows"]]
        else:
            out.append("".join(r["t"] for r in item["runs"]))
    if deep:
        out += [plain(c, True) for c in node["children"]]
    return "\n".join(out)


def _numkey(s: str) -> list[int]:
    return [int(p) for p in s.split(".")]


# ---------------------------------------------------------------- errata
BLUE, GREEN = 0x00AEEF, 0x40AD49
STATUS = {BLUE: "new", GREEN: "previous"}
ERRATA_FURNITURE = {"FAQ & Errata", "Faction Errata & Updates"}
OP = re.compile(r"^(Amend|Change|Add|Remove|Replace)\b", re.I)
TARGET_NUM = re.compile(r"^(\d+(?:\.\d+)*)\.?\s+(\S.*)$")
TARGET_SCENARIO = re.compile(r"^(.*?)\s+Scenario,\s*page\s+(\d+)$", re.I)
QUOTE_OPEN = ("“",)
QUOTE_CLOSE = ("”", "“")    # "“" as a closer is a typo the errata really prints


def _role(spans) -> str:
    f = max(spans, key=lambda s: len(s["text"].strip()))
    if HEAD_FACE in f["font"]:
        return "group" if f["size"] >= 20 else "subgroup"
    if "Bold" in f["font"]:
        return "entry"
    if "Medium" in f["font"]:
        return "question"
    return "body"


def errata_paragraphs(doc: fitz.Document):
    """Lines of an A4 two-column errata sheet -> paragraphs tagged by role.

    Page 1 is one wide column; every other page is two. A paragraph continues
    across a column or page break when its role is unchanged and the line
    before did not end a sentence."""
    paras: list[dict[str, Any]] = []
    for pno in range(doc.page_count):
        page = doc[pno]
        mid = page.rect.width / 2
        lines: list[dict[str, Any]] = []
        for blk in cast(dict[str, Any], page.get_text("dict"))["blocks"]:
            for ln in blk.get("lines", []):
                spans = [dict(s, text=repair(s["text"])) for s in ln["spans"] if s["text"].strip()]
                if not spans:
                    continue
                text = "".join(s["text"] for s in spans)
                if tidy(text) in ERRATA_FURNITURE:
                    continue
                lines.append({"text": text, "role": _role(spans),
                              "color": max(spans, key=lambda s: len(s["text"]))["color"],
                              "size": max(s["size"] for s in spans),
                              "x0": ln["bbox"][0], "x1": ln["bbox"][2], "y0": ln["bbox"][1],
                              "page": pno + 1})
        wide = any(ln["x0"] < mid - 20 and ln["x1"] > mid + 20 for ln in lines)
        order = sorted(lines, key=lambda ln: ln["y0"]) if wide else (
            sorted((ln for ln in lines if ln["x0"] < mid), key=lambda ln: ln["y0"])
            + sorted((ln for ln in lines if ln["x0"] >= mid), key=lambda ln: ln["y0"]))
        for ln in order:
            p = paras[-1] if paras else None
            if p is not None and p["role"] == ln["role"] and p["color"] == ln["color"]:
                near = (p["page"] == ln["page"]
                        and 0 < ln["y0"] - p["last_y0"] <= 1.35 * ln["size"])
                carried = not near and ln["y0"] < p["last_y0"] and \
                    not tidy(p["text"]).endswith((".", "?", "!", ":", "”", "\u201c"))
                if near or carried:
                    p["text"], sep = join_at_break(p["text"], ln["text"])
                    p["text"] += sep + ln["text"]
                    p["last_y0"] = ln["y0"]
                    if carried:
                        p["page_end"] = ln["page"]
                    continue
            paras.append(dict(ln, last_y0=ln["y0"]))
    for p in paras:
        p["text"] = tidy(p["text"])
    return paras


def parse_errata(path: pathlib.Path, short: str) -> dict[str, Any]:
    doc = fitz.open(path)
    paras = errata_paragraphs(doc)
    src: dict[str, Any] = {"file": path.name, "title": None, "preamble": [],
                           "legend": [], "editions": []}
    entries: list[dict[str, Any]] = []
    faq: list[dict[str, Any]] = []
    group = subgroup = None
    cur: dict[str, Any] | None = None
    in_editions = False
    ids: Counter[str] = Counter()

    def new_id(kind, label):
        base = f"{short}-{kind}-{slug(label)[:60]}"
        ids[base] += 1
        return base if ids[base] == 1 else f"{base}-{ids[base]}"

    for p in paras:
        if p["page"] == 1:
            if p["role"] == "group":
                in_editions = p["text"] == "Current Edition"
            elif p["role"] == "entry":
                src["legend"].append({"colour": f"#{p['color']:06x}",
                                      "status": STATUS.get(p["color"]), "text": p["text"]})
            elif in_editions:
                src["editions"].append(p["text"])
            else:
                src["preamble"].append(p["text"])
            continue
        role = p["role"]
        if role == "group":
            group, subgroup, cur = p["text"], None, None
        elif role == "subgroup":
            subgroup, cur = p["text"], None
        elif role == "entry":
            cur = {"id": new_id("erratum", p["text"]), "kind": "erratum",
                   "source": path.name, "page": p["page"], "group": group,
                   "subgroup": subgroup, "status": STATUS.get(p["color"]),
                   "colour": f"#{p['color']:06x}", "target": p["text"], "body": []}
            entries.append(cur)
        elif role == "question":
            if cur and cur["kind"] == "faq" and not cur["answer"]:
                cur["question"] += " " + p["text"]
                continue
            cur = {"id": new_id("faq", p["text"][:50]), "kind": "faq",
                   "source": path.name, "page": p["page"], "group": group,
                   "topic": subgroup, "status": STATUS.get(p["color"]),
                   "colour": f"#{p['color']:06x}", "question": p["text"], "answer": []}
            faq.append(cur)
        else:
            if cur is None:
                src.setdefault("orphans", []).append(p["text"])
            elif cur["kind"] == "faq":
                cur["answer"].append(p["text"])
            else:
                cur["body"].append(p["text"])
    for e in entries:
        e["steps"] = steps_of(e.pop("body"))
    return {"source": src, "entries": entries, "faq": faq}


def steps_of(body: list[str]) -> list[dict[str, Any]]:
    """An erratum is a run of instructions, each optionally followed by the
    quoted text it inserts: 'Change third paragraph to:' then '“When a
    Subterranean Squad enters ...”'. A quote may run over several paragraphs
    and is closed by its closing mark -- which the errata twice prints as an
    OPENING mark ('so. “', 'first.“'). Both are kept exactly as printed."""
    steps: list[dict[str, Any]] = []
    open_q = False
    for t in body:
        s = t.strip()
        if open_q:
            steps[-1]["quote"].append(t)
            open_q = not s.endswith(QUOTE_CLOSE)
            continue
        if s.startswith(QUOTE_OPEN):
            if not steps:
                steps.append({"instruction": None, "op": None, "quote": []})
            steps[-1]["quote"].append(t)
            open_q = not (len(s) > 1 and s.endswith(QUOTE_CLOSE))
            continue
        m = OP.match(s)
        steps.append({"instruction": t, "op": m.group(1).lower() if m else None, "quote": []})
    return steps


def _norm(s: str) -> str:
    return " " + re.sub(r"[^a-z0-9]+", " ", s.lower()).strip() + " "


def resolve_and_check(entries, tree, report):
    """Point each erratum at its section and ask whether the book already says it.

    book_check per step, from comparing the quote (letters and digits only, so
    curly-vs-straight quotes and the errata's own stray marks cannot cause a
    false miss) with the target section's text and everything beneath it:

        in-book           amend/add/change/replace text IS in the rulebook
        not-in-book       amend/add/change/replace text is NOT in the rulebook
        still-in-book     remove: the sentence to remove is STILL there
        gone-from-book    remove: the sentence is already gone
        unchecked         no quote to compare ("Flak Turret should have Att 6.")
                          or no section to compare it with (faction documents)

    This is evidence for a human, never an instruction to rewrite the book.
    """
    by_num = {n["number"]: n for _, n in walk(tree) if n["number"]}
    by_head = defaultdict(list)
    for _, n in walk(tree):
        by_head[n["heading"].lower()].append(n)
    tally = Counter()
    for e in entries:
        node = None
        # Only entries under the rulebook errata's own "Errata" heading point
        # into this book. The faction sheet's "1.2 Exceptions" is section 1.2
        # of the BEHEMOTHS PDF; matched on its number alone it filed a Behemoth
        # rule under 1.2 Ruler and "checked" it against the wrong text.
        if e["group"] == "Errata":
            m = TARGET_NUM.match(e["target"])
            if m and m.group(1) in by_num:
                node = by_num[m.group(1)]
            else:
                m = TARGET_SCENARIO.match(e["target"])
                if m and by_head.get(m.group(1).lower()):
                    node = by_head[m.group(1).lower()][0]
        e["resolves_to"] = node["id"] if node else None
        if node is not None:
            node.setdefault("errata", []).append(e["id"])
        hay = _norm(plain(node, deep=True)) if node else None
        change_to = re.compile(r"[Cc]hange\s+“([^”]+)”\s+to\s+“([^”]+)”")
        for st in e["steps"]:
            q = " ".join(st["quote"])
            swap = change_to.search(st["instruction"] or "")
            if hay is None:
                st["book_check"] = "unchecked"
            elif q:
                found = _norm(q).strip() in hay
                if st["op"] == "remove":
                    st["book_check"] = "still-in-book" if found else "gone-from-book"
                else:
                    st["book_check"] = "in-book" if found else "not-in-book"
            elif swap:
                # 'Change “if one or more Vehicles” to “If one or more friendly
                # Units”.' carries old and new wording inline. Only phrases of
                # three words or more are tested: "Vehicles" -> "Friendly
                # Units." is too common a string for its presence to prove
                # anything, so a swap that short stays unchecked.
                old, new = _norm(swap.group(1)).strip(), _norm(swap.group(2)).strip()
                if len(old.split()) < 3 or len(new.split()) < 3:
                    st["book_check"] = "unchecked"
                elif f" {new} " in hay and f" {old} " not in hay:
                    st["book_check"] = "in-book"
                elif f" {old} " in hay and f" {new} " not in hay:
                    st["book_check"] = "not-in-book"
                else:
                    st["book_check"] = "unchecked"
            else:
                st["book_check"] = "unchecked"
            tally[st["book_check"]] += 1
    report["errata_check"] = dict(tally)


# ---------------------------------------------------------------- main
def main() -> None:
    ap = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    ap.add_argument("--out", type=pathlib.Path, default=OUT_DEFAULT)
    ap.add_argument("--dry", action="store_true", help="write nothing")
    args = ap.parse_args()

    rulebook = _newest("A5_Dropzone_*_Rulebook*.pdf")
    errata_pdf = _newest("Dropzone_Commander_*_Errata_FAQ.pdf")
    faction_pdf = _newest("Dropzone_Commander_*_Faction_Errata_Updates.pdf")

    doc = fitz.open(rulebook)
    report: dict[str, Any] = {
        "fffd": sum(cast(str, doc[i].get_text()).count("�") for i in range(doc.page_count))}
    tree = extract_book(doc, report)

    index: dict[str, str] = {}
    by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    numbers = Counter()
    for _, n in walk(tree):
        if n["number"]:
            index.setdefault(n["number"], n["id"])
            numbers[n["number"]] += 1
        by_name[n["heading"].lower()].append(n)
    report["dupes"] = sorted((k for k, v in numbers.items() if v > 1), key=_numkey)

    # This book almost never cites a section by number. It cites by page and
    # quoted name -- "(see page 34 'Entry')", in curly quotes -- so those are resolved by NAME,
    # preferring a section on or before the cited page, and a name that
    # resolves to nothing is reported rather than guessed at.
    page_ref = re.compile("[Ss]ee page (\\d+) \u2018([^\u2019]+)\u2019")
    dangling: set[str] = set()
    report["page_refs"], report["page_refs_unresolved"] = 0, []
    for _, n in walk(tree):
        text = plain(n)
        refs: list[str] = []
        for t in XREF.findall(text):
            if t in index:
                refs.append(index[t])
            elif int(t.split(".")[0]) < STOP_CHAPTER:
                dangling.add(t)
        for pg, name in page_ref.findall(text):
            hits = sorted(by_name.get(name.lower(), []),
                          key=lambda h: (h["page"] > int(pg), abs(h["page"] - int(pg))))
            if hits:
                refs.append(hits[0]["id"])
                report["page_refs"] += 1
            else:
                report["page_refs_unresolved"].append(
                    f"p{n['page']} {n['id']}: see page {pg} \u2018{name}\u2019")
        refs = [r for r in dict.fromkeys(refs) if r != n["id"]]
        if refs:
            n["xrefs"] = refs

    general = parse_errata(errata_pdf, "faq")
    faction = parse_errata(faction_pdf, "faction")
    entries = general["entries"] + faction["entries"]
    resolve_and_check(entries, tree, report)

    out = {
        "game": "Dropzone Commander",
        "book": "A5 Dropzone Rulebook",
        "edition": ".".join(map(str, _point(rulebook))),
        "source": rulebook.name,
        "generator": "tools/dzc/extract_rules_wiki.py",
        "verbatim": True,
        "chapters": tree,
        "errata": {
            "sources": [general["source"], faction["source"]],
            "entries": entries,
            "faq": general["faq"] + faction["faq"],
        },
    }

    depth = Counter(d for d, _ in walk(tree))
    print(f"read     {rulebook.name}  ({doc.page_count} pages, chapters 1-{STOP_CHAPTER - 1})")
    print(f"chapters {depth[1]}")
    for d in sorted(k for k in depth if k > 1):
        print(f"  depth {d}  {depth[d]}")
    c = report["counts"]
    print(f"total    {sum(depth.values())} nodes, {c.get('p', 0) + c.get('li', 0)} paragraphs, "
          f"{c.get('tables', 0)} tables, {c.get('caption', 0)} captions, "
          f"{sum(len(n.get('xrefs', [])) for _, n in walk(tree))} cross-references")
    print(f"U+FFFD in source: {report['fffd']}")
    print(f"xrefs    {report['page_refs']} 'see page N \u2018Name\u2019' "
          "reference(s) resolved by name")
    for u in report["page_refs_unresolved"]:
        print(f"xref     UNRESOLVED {u}")
    if dangling:
        print(f"xrefs with no target section: {sorted(dangling, key=_numkey)}")
    for num in report["dupes"]:
        heads = [n["heading"] for _, n in walk(tree) if n["number"] == num]
        print(f"typo     section number {num} printed {len(heads)} times: {heads} "
              f"(kept as printed; ids disambiguate)")
    print(f"read     {errata_pdf.name}: "
          f"{len(general['entries'])} errata, {len(general['faq'])} FAQ")
    print(f"read     {faction_pdf.name}: "
          f"{len(faction['entries'])} errata, {len(faction['faq'])} FAQ")
    unresolved = [e["target"] for e in entries if e["resolves_to"] is None]
    print(f"errata   {len(entries) - len(unresolved)} resolved to a rulebook section, "
          f"{len(unresolved)} target another document")
    print(f"book     {report['errata_check']}")
    for e in entries:
        for st in e["steps"]:
            if st["quote"] and st["quote"][-1].rstrip().endswith("“"):
                print(f"typo     errata closes a quote with an opening mark: "
                      f"{e['target']!r} p{e['page']} ...{st['quote'][-1][-24:]!r}")
    for key in ("orphans",):
        for s in (general["source"], faction["source"]):
            if s.get(key):
                print(f"orphan   {s['file']}: {len(s[key])} paragraph(s) before any entry")

    if args.dry:
        print("dry run -- nothing written")
        return
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    try:
        shown = args.out.resolve().relative_to(ROOT)
    except ValueError:
        shown = args.out
    print(f"wrote    {shown} ({args.out.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
