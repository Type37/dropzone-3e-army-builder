#!/usr/bin/env python3
"""Build data/dzc/rules-book.json and assets/rules/, the rulebook as Interactive Rules reads it.

    PYTHONUTF8=1 python tools/dzc/build_rules_book.py            # data + figures
    PYTHONUTF8=1 python tools/dzc/build_rules_book.py --dump x   # also a text dump to review

Why a second file and not rules-wiki.json
-----------------------------------------
extract_rules_wiki.py writes rules-wiki.json, and build_scenario_terms.py reads
that file into the scenario pages. This script reuses the extractor's reading
of the book (columns, headings, nesting) and changes what the screen needs
without moving anything underneath the scenario pages:

  BOLD.  The book DOES set bold ("Name", "Skirmish", "Field Promotion"). Every
         span reports RobotoSlab-Regular with no bold flag, because the bold is
         a second embedded Roboto Slab that was never renamed. The two differ
         in their own space width: bold 0.2451 x size (0.2485 on the scenario
         cards), regular 0.2437, light 0.2417. get_texttrace() splits spans at
         every font change and carries that width, so each character is
         classed by the font that drew it.

  LAYOUT.  Tables drawn as graphics, diagrams whose labels read as prose, the
         inline transport symbols, and the scenario cards are cut out of the
         general reading (EXCLUDE) and rebuilt from their own boxes on the
         page. Every word still comes out of the PDF; nothing here types rules
         text. Figures are rendered from the page with the page's background
         art removed.

  ERRATA.  Each rulebook erratum's quoted text (lifted from the errata PDF into
         rules-wiki.json) is checked against the section it targets. Where the
         3.02 printing already says it, nothing changes. Where it does not, the
         quote replaces the paragraph or sentence the erratum names.

Text is never read flat: lines come from get_text("rawdict") with their boxes.
"""

from __future__ import annotations

import argparse
import difflib
import io
import json
import pathlib
import re
import sys
from collections import defaultdict
from typing import Any, cast

import fitz

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import extract_rules_wiki as wiki  # noqa: E402

ROOT = HERE.parents[1]
PDF = ROOT / "rules" / "A5_Dropzone_3.02_Rulebook.pdf"
WIKI = ROOT / "data" / "dzc" / "rules-wiki.json"
OUT = ROOT / "data" / "dzc" / "rules-book.json"
FIG_DIR = ROOT / "assets" / "rules"
TOKEN_DIR = ROOT / "assets" / "tokens"

BOLD_MIN = 0.2445

# Inline transport symbols (3.2.4.2) travel through the text as private-use
# characters and are drawn by the screen.
SYM = {"square-hollow": "", "square-solid": "", "triangle-hollow": "", "triangle-solid": ""}

Rect = tuple[float, float, float, float]

# Regions left out of the general reading, by page. Each is rebuilt below.
EXCLUDE: dict[int, list[Rect]] = {
    6: [(24, 455, 208, 568)],
    7: [(40, 166, 378, 222), (40, 408, 378, 464)],
    8: [(20, 54, 400, 97)],
    9: [(20, 310, 206, 436)],
    10: [(24, 198, 398, 576)],
    11: [(20, 40, 206, 580), (210, 14, 398, 192)],
    12: [(24, 88, 208, 210)],
    15: [(20, 97, 395, 330)],
    16: [(33, 55, 199, 318), (214, 333, 399, 566)],
    18: [(30, 476, 392, 580)],
    19: [(212, 410, 397, 503)],
    20: [(24, 52, 208, 123)],
    21: [(48, 360, 370, 575)],
    24: [(22, 370, 400, 576)],
    26: [(24, 108, 398, 252), (24, 270, 398, 522)],
    28: [(0, 0, 420, 590)],
    30: [(214, 12, 400, 583)],
    32: [(30, 252, 393, 394)],
    **{p: [(0, 0, 420, 590)] for p in range(38, 44)},
}

# id, page, clip, alt (None = the words printed inside the clip)
FIGURES: list[tuple[str, int, Rect, str | Rect | None]] = [
    ("fig-centre", 6, (24, 455, 208, 568), "A tank with its centre marked by a red dot."),
    ("fig-groups", 10, (24, 198, 398, 576), None),
    ("fig-sabres", 11, (21, 393, 205, 576), None),
    ("fig-condor-bears", 11, (210, 14, 398, 192), None),
    ("fig-command-card", 16, (35, 57, 197, 316), "An example Command Card: HQ Directive."),
    ("fig-ground", 18, (30, 476, 392, 574), None),
    ("fig-los-drones", 19, (212, 410, 397, 503), None),
    ("fig-los-polecats", 20, (24, 52, 208, 123), None),
    ("fig-embark", 24, (22, 370, 400, 576), None),
    # Three columns of captions under each: read as one run they interleave, so
    # the alt is the diagram's own title (the third has none; its first caption).
    ("fig-disembark-zone", 28, (24, 14, 399, 200), "Disembarking directly into zones"),
    ("fig-disembark-open", 28, (24, 210, 399, 406), "Disembarking infantry in Open Ground"),
    (
        "fig-disembark-vulture",
        28,
        (24, 412, 322, 572),
        "Legionnaires Disembark from Vulture in open ground.",
    ),
    # Unlabelled diagrams: the alt is the caption box printed under each.
    ("fig-area-los", 30, (215, 15, 399, 156), (216, 157, 399, 359)),
    ("fig-building-los", 30, (215, 361, 399, 529), (216, 530, 399, 581)),
]
PLAY_ICONS: list[tuple[str, Rect]] = [
    ("play-initiation", (219, 390, 253, 430)),
    ("play-activation", (214, 437, 253, 466)),
    ("play-end", (219, 474, 248, 513)),
    ("play-cqb", (218, 516, 249, 555)),
]


# ---------------------------------------------------------------- reading
def inside(s: dict[str, Any], r: Rect, pad: float = 0.5) -> bool:
    cx, cy = (s["x0"] + s["x1"]) / 2, (s["y0"] + s["y1"]) / 2
    return r[0] - pad <= cx <= r[2] + pad and r[1] - pad <= cy <= r[3] + pad


def bold_chars(page: fitz.Page) -> dict[tuple[int, int], bool]:
    out: dict[tuple[int, int], bool] = {}
    for s in page.get_texttrace():
        size = s.get("size") or 0
        if not size:
            continue
        b = s["font"].startswith("Roboto") and (s.get("spacewidth") or 0) / size >= BOLD_MIN
        for c in s["chars"]:
            ox, oy = c[2]
            out[(round(ox * 10), round(oy * 10))] = b
    return out


_RAW: dict[int, list[dict[str, Any]]] = {}


def raw_blocks(page: fitz.Page) -> list[dict[str, Any]]:
    """extract_rules_wiki.page_blocks, with each span cut where bold changes."""
    if page.number in _RAW:
        return _RAW[page.number]
    marks = bold_chars(page)
    out: list[dict[str, Any]] = []
    seen: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for blk in cast(dict[str, Any], page.get_text("rawdict"))["blocks"]:
        if blk.get("type") == 1:
            continue
        lines = []
        for ln in blk.get("lines", []):
            spans = []
            for sp in ln["spans"]:
                chars = sp.get("chars", [])
                whole = wiki.repair("".join(c["c"] for c in chars))
                if not whole.strip():
                    continue
                x0, y0, _x1, y1 = sp["bbox"]
                key = whole.strip()
                if any(abs(x - x0) < 2.5 and abs(y - y0) < 3 for x, y in seen[key]):
                    continue
                seen[key].append((x0, y0))
                pieces: list[list[dict[str, Any]]] = []
                flags: list[bool] = []
                for c in chars:
                    ox, oy = c["origin"]
                    b = marks.get((round(ox * 10), round(oy * 10)), "Bold" in sp["font"])
                    if pieces and (flags[-1] == b or not c["c"].strip()):
                        pieces[-1].append(c)
                    else:
                        pieces.append([c])
                        flags.append(b)
                for cs, b in zip(pieces, flags, strict=True):
                    t = wiki.repair("".join(c["c"] for c in cs))
                    if t:
                        spans.append(
                            {
                                "text": t,
                                "font": sp["font"],
                                "size": round(sp["size"], 1),
                                "bold": b,
                                "x0": cs[0]["bbox"][0],
                                "y0": y0,
                                "x1": cs[-1]["bbox"][2],
                                "y1": y1,
                            }
                        )
            if spans:
                for i, s in enumerate(spans):
                    s["ls"] = i == 0
                lines.append(line_of(spans))
        if lines:
            out.append(block_of(lines))
    _RAW[int(page.number or 0)] = out
    return out


def line_of(spans):
    return {
        "spans": spans,
        "y0": min(s["y0"] for s in spans),
        "y1": max(s["y1"] for s in spans),
        "x0": min(s["x0"] for s in spans),
        "x1": max(s["x1"] for s in spans),
    }


def block_of(lines):
    return {
        "lines": lines,
        "x0": min(ln["x0"] for ln in lines),
        "x1": max(ln["x1"] for ln in lines),
        "y0": min(ln["y0"] for ln in lines),
        "y1": max(ln["y1"] for ln in lines),
    }


def page_blocks(page: fitz.Page) -> list[dict[str, Any]]:
    """What the extractor reads: everything outside this page's EXCLUDE regions."""
    rects = EXCLUDE.get(int(page.number or 0) + 1)
    if not rects:
        return raw_blocks(page)
    out = []
    for b in raw_blocks(page):
        lines = []
        for ln in b["lines"]:
            spans = [dict(s) for s in ln["spans"] if not any(inside(s, r) for r in rects)]
            if spans:
                for i, s in enumerate(spans):
                    s["ls"] = i == 0
                lines.append(line_of(spans))
        if lines:
            out.append(block_of(lines))
    return out


def symbols_on(page: fitz.Page, r: Rect) -> list[dict[str, Any]]:
    """The small drawn transport symbols inside r, as one-character spans."""
    out = []
    for d in page.get_drawings():
        q = d["rect"]
        if not (r[0] <= q.x0 and q.x1 <= r[2] and r[1] <= q.y0 and q.y1 <= r[3]):
            continue
        if not (3 < q.width < 15 and 3 < q.height < 15):
            continue
        square = (
            any(it[0] in ("re", "qu") for it in d["items"])
            or sum(1 for it in d["items"] if it[0] == "l") == 4
        )
        kind = ("square" if square else "triangle") + ("-solid" if d.get("fill") else "-hollow")
        out.append(
            {
                "text": SYM[kind],
                "font": "symbol",
                "size": 9.0,
                "bold": False,
                "x0": q.x0,
                "y0": q.y0,
                "x1": q.x1,
                "y1": q.y1,
                "sym": kind,
            }
        )
    return out


def region_paras(
    page: fitz.Page, r: Rect, extra: list[dict[str, Any]] | None = None, gap: float = 1.5
) -> list[dict[str, Any]]:
    """Paragraphs inside one single-column box, read line by line."""
    spans = [
        dict(s)
        for b in raw_blocks(page)
        for ln in b["lines"]
        for s in ln["spans"]
        if inside(s, r) and not (s["y0"] > wiki.FOLIO_Y and wiki.FOLIO.match(s["text"].strip()))
    ]
    spans += [dict(e) for e in (extra or [])]
    spans.sort(key=lambda s: ((s["y0"] + s["y1"]) / 2, s["x0"]))
    lines: list[dict[str, Any]] = []
    for s in spans:
        yc = (s["y0"] + s["y1"]) / 2
        if lines and abs(yc - lines[-1]["yc"]) < 0.45 * max(s["size"], lines[-1]["size"]):
            lines[-1]["spans"].append(s)
            if s.get("font") != "symbol":
                lines[-1]["size"] = max(lines[-1]["size"], s["size"])
        else:
            lines.append({"yc": yc, "size": s["size"], "spans": [s]})
    paras: list[list[dict[str, Any]]] = []
    prev_y = None
    for ln in lines:
        ss = sorted(ln["spans"], key=lambda s: s["x0"])
        for i, s in enumerate(ss):
            s["ls"] = i == 0
            if i:
                p = ss[i - 1]
                if (
                    "sym" not in s
                    and "sym" not in p
                    and s["x0"] - p["x1"] > 1.2
                    and not p["text"].endswith(" ")
                    and not s["text"].startswith(" ")
                ):
                    p["text"] += " "
        y = (
            min(s["y0"] for s in ss if "sym" not in s)
            if any("sym" not in s for s in ss)
            else ss[0]["y0"]
        )
        if prev_y is None or y - prev_y > gap * ln["size"]:
            paras.append([])
        paras[-1].extend(ss)
        prev_y = y
    out = []
    for ps in paras:
        runs = wiki.runs_from_spans(ps)
        if runs:
            out.append(
                {
                    "runs": runs,
                    "head": all(wiki.HEAD_FACE in s["font"] for s in ps if "sym" not in s),
                    "y0": min(s["y0"] for s in ps),
                    "x0": min(s["x0"] for s in ps),
                }
            )
    return out


def cell(page: fitz.Page, r: Rect) -> list[dict[str, Any]]:
    """A table cell's words, paragraphs kept apart by a blank line."""
    runs: list[dict[str, Any]] = []
    for p in region_paras(page, r):
        if runs:
            runs.append({"t": "\n\n"})
        runs += p["runs"]
    return runs


def plain(runs: list[dict[str, Any]]) -> str:
    return "".join(r["t"] for r in runs)


# ---------------------------------------------------------------- tables
def td(runs, **kw):
    return {"r": runs, **kw}


def grid(page, xs, ys, head=1, th_first=False):
    rows = []
    for yi in range(len(ys) - 1):
        row = []
        for i in range(len(xs) - 1):
            extra = {"th": True} if th_first and i == 0 and yi >= head else {}
            row.append(td(cell(page, (xs[i], ys[yi], xs[i + 1], ys[yi + 1])), **extra))
        rows.append(row)
    return {"kind": "table", "head": rows[:head], "rows": rows[head:]}


def statbar(page, ys, xs, name_to, cost_from):
    """A unit stats bar: name, squad size/category and points, then the stats."""
    n = len(xs) - 1
    head = [
        [td(cell(page, (xs[0], ys[0], xs[-1], ys[1])), cs=n)],
        [
            td([]),
            td(cell(page, (xs[1], ys[1], name_to, ys[2])), cs=n - 2),
            td(cell(page, (cost_from, ys[1], xs[-1], ys[2]))),
        ],
        [td(cell(page, (xs[i], ys[2], xs[i + 1], ys[3]))) for i in range(n)],
    ]
    rows = [[td(cell(page, (xs[i], ys[3], xs[i + 1], ys[4]))) for i in range(n)]]
    return {"kind": "table", "variant": "statbar", "head": head, "rows": rows}


def energy_table(page):
    xs = [51, 68, 95, 122, 149, 176, 204, 231, 258, 285, 312, 340, 367]
    ys = [363, 377, 392, 409, 425, 442, 458, 475, 492, 508, 523, 539, 556, 572]
    head = [
        [td([], cs=2, rs=2), td(cell(page, (95, 363, 367, 377)), cs=10)],
        [td(cell(page, (xs[i], ys[1], xs[i + 1], ys[2]))) for i in range(2, 12)],
    ]
    rows = []
    for r in range(11):
        y0, y1 = ys[2 + r], ys[3 + r]
        row = []
        if r == 0:
            row.append(td(cell(page, (51, 392, 68, 572)), rs=11, th=True, vertical=True))
        row.append(td(cell(page, (68, y0, 95, y1)), th=True))
        for i in range(2, 12):
            runs = cell(page, (xs[i], y0, xs[i + 1], y1))
            row.append(td(runs) if runs else td([], none=True))
        rows.append(row)
    return {"kind": "table", "variant": "energy", "head": head, "rows": rows}


def build_tables(doc) -> dict[str, dict[str, Any]]:
    p = lambda n: doc[n - 1]  # noqa: E731
    return {
        "statbar-vehicle": statbar(
            p(7), [170, 181, 192, 205, 218], [44, 115, 153, 190, 228, 373], 280, 280
        ),
        "statbar-infantry": statbar(
            p(7), [412, 423, 434, 447, 460], [44, 122, 153, 185, 216, 247, 280, 373], 315, 315
        ),
        "weapon-profile": grid(p(8), [26, 118, 153, 188, 223, 259, 294, 329, 397], [58, 73, 93]),
        "army-restrictions": grid(
            p(9), [23, 83, 203], [314, 337, 355, 381, 407, 433], th_first=True
        ),
        "commanders": grid(p(12), [26, 92, 134, 206], [90, 113, 137, 161, 184, 208]),
        "abilities": grid(p(15), [23, 83, 392], [99, 122, 178, 283, 327], th_first=True),
        "energy-armour": energy_table(p(21)),
        "zones": grid(
            p(26),
            [26, 113, 164, 234, 316, 395],
            [112, 139, 159, 180, 197, 214, 232, 249],
            th_first=True,
        ),
        "weapon-features": grid(
            p(32), [35, 137, 172, 204, 236, 268, 300, 390], [255, 274, 294, 313, 333, 353, 372, 391]
        ),
    }


# ---------------------------------------------------------------- figures
def render_figures(doc_path: pathlib.Path) -> dict[str, dict[str, Any]]:
    """Every figure and play symbol, cut at 3x with the page art taken away."""
    from PIL import Image

    doc = fitz.open(doc_path)
    cleared: set[int] = set()

    def clear(page):
        if page.number in cleared:
            return
        area = page.rect.width * page.rect.height
        for im in page.get_images(full=True):
            for box in page.get_image_rects(im[0]):
                if box.width * box.height > 0.8 * area:
                    page.delete_image(im[0])
                    break
        cleared.add(page.number)

    FIG_DIR.mkdir(parents=True, exist_ok=True)
    info: dict[str, dict[str, Any]] = {}
    for name, pno, r, _alt in FIGURES + [(n, 16, r, "") for n, r in PLAY_ICONS]:
        page = doc[pno - 1]
        clear(page)
        pix = page.get_pixmap(matrix=fitz.Matrix(3, 3), clip=fitz.Rect(*r), alpha=True)
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        path = FIG_DIR / f"{name}.webp"
        img.save(path, "WEBP", quality=82, method=6)
        info[name] = {"w": img.width, "h": img.height}
        print(
            f"  figure {name:24s} p{pno:<3d} {img.width}x{img.height} "
            f"{path.stat().st_size // 1024} KB"
        )
    return info


def fig(doc, name, sizes):
    _n, pno, r, alt = next(f for f in FIGURES if f[0] == name)
    if alt is None or isinstance(alt, tuple):
        alt = " ".join(plain(p["runs"]) for p in region_paras(doc[pno - 1], alt or r))
        alt = re.sub(r"\s+", " ", alt).strip()
    out = {"kind": "fig", "src": f"assets/rules/{name}.webp", "alt": alt}
    out.update(sizes.get(name, {}))
    return out


# ---------------------------------------------------------------- tree edits
def walk(nodes):
    for n in nodes:
        yield n
        yield from walk(n["children"])


def para_text(b) -> str:
    if b["kind"] == "ol":
        return " ".join(plain(p) for it in b["items"] for p in it)
    return plain(b.get("runs", []))


def find_para(node, prefix) -> int:
    for i, b in enumerate(node["body"]):
        if b["kind"] in ("p", "note") and para_text(b).startswith(prefix):
            return i
    raise SystemExit(f"{node['id']}: no paragraph starting {prefix!r}")


def insert_after(node, prefix, *blocks):
    i = find_para(node, prefix)
    node["body"][i + 1 : i + 1] = list(blocks)


MARK = re.compile(r"^\d+\.$")


def to_lists(node):
    body, out, i = node["body"], [], 0
    is_mark = lambda b: b["kind"] == "p" and MARK.match(para_text(b).strip())  # noqa: E731
    while i < len(body):
        if not is_mark(body[i]):
            out.append(body[i])
            i += 1
            continue
        items = []
        while i < len(body) and is_mark(body[i]):
            item = [body[i + 1]["runs"]]
            i += 2
            j = i
            while j < len(body) and not is_mark(body[j]) and body[j]["kind"] == "p":
                j += 1
            if j < len(body) and is_mark(body[j]):
                item += [body[k]["runs"] for k in range(i, j)]
                i = j
            items.append(item)
        out.append({"kind": "ol", "items": items})
    node["body"] = out


# Closing punctuation; the curly quotes by code point (a quote closes, and the book
# twice closes one with an opening mark).
SENT_END = (".", ":", "!", "?", ")", *map(chr, (0x201D, 0x2019, 0x201C)))


def merge_breaks(node, log):
    """A paragraph the page cut at a column or page break: no closing
    punctuation, and the next one opens lower case."""
    body, out = node["body"], []
    for b in body:
        if out and b["kind"] == "p" and out[-1]["kind"] == "p":
            prev = plain(out[-1]["runs"]).rstrip()
            nxt = plain(b["runs"])
            if prev and not prev.endswith(SENT_END) and nxt[:1].islower():
                last = out[-1]["runs"][-1]
                last["t"], sep = wiki.join_at_break(last["t"], nxt)
                runs = [dict(r) for r in b["runs"]]
                runs[0]["t"] = sep + runs[0]["t"]
                out[-1]["runs"] = out[-1]["runs"] + runs
                log.append(f"merged in {node['id']}: …{prev[-30:]!r} + {nxt[:30]!r}…")
                continue
        out.append(b)
    node["body"] = out


def tidy_runs(runs):
    """Spaces belong outside bold ("Offence (OF)" then " stat"), and equal
    neighbours merge. The characters do not change."""
    out: list[dict[str, Any]] = []

    def push(t, b):
        if not t:
            return
        if out and bool(out[-1].get("b")) == b and "\n" not in t and "\n" not in out[-1]["t"]:
            out[-1]["t"] += t
        else:
            out.append({"t": t, "b": True} if b else {"t": t})

    for r in runs:
        t, b = r["t"], bool(r.get("b"))
        if b and t.strip():
            lead = t[: len(t) - len(t.lstrip())]
            trail = t[len(t.rstrip()) :]
            push(lead, False)
            push(t.strip(), True)
            push(trail, False)
        else:
            push(t, False if not t.strip() else b)
    return out


def tidy_all(tree):
    for n in walk(tree):
        for b in n["body"]:
            if "runs" in b:
                b["runs"] = tidy_runs(b["runs"])
            if b["kind"] == "ol":
                b["items"] = [[tidy_runs(p) for p in it] for it in b["items"]]
            if b["kind"] == "table":
                for row in b["head"] + b["rows"]:
                    for c in row:
                        c["r"] = tidy_runs(c["r"])


# ---------------------------------------------------------------- scenarios
OBJECTIVE = re.compile(
    r"^(Attrition|Extract|Displace|Dominate|Explore|Occupy|Protect|Raze|Secure)\b"
)


def scenario_cards(doc, log) -> list[dict[str, Any]]:
    cards = []
    for pno in range(38, 44):
        page = doc[pno - 1]
        mid = next(
            (
                d["rect"].y0
                for d in page.get_drawings()
                if d["rect"].width > 300 and d["rect"].height < 3 and 250 < d["rect"].y0 < 340
            ),
            297.0,
        )
        for top, bot in ((0.0, mid), (mid, 590.0)):
            left = region_paras(page, (0, top, 212, bot))
            title = next(
                p
                for p in left
                if p["head"]
                and len(plain(p["runs"])) > 3
                and not re.match(r"^\d", plain(p["runs"]))
            )
            name = plain(title["runs"]).strip()
            right = region_paras(page, (212, top, 420, bot))
            rows = []
            for p in right + [q for q in left if not q["head"]]:
                runs = p["runs"]
                first = runs[0]["t"].strip() if runs and runs[0].get("b") else ""
                if first and (OBJECTIVE.match(first) or first.endswith(":")):
                    rows.append({"kind": "p", "runs": runs})
            cards.append(
                {
                    "id": "9/" + wiki.slug(name),
                    "number": None,
                    "heading": name,
                    "page": pno,
                    "body": rows,
                    "children": [],
                    "scenario": wiki.slug(name),
                }
            )
            log.append(f"scenario {name} p{pno}: " + " || ".join(plain(r["runs"]) for r in rows))
    return cards


# ---------------------------------------------------------------- errata
def strip_quotes(q: str) -> str:
    return q.strip().strip("“”").strip()


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def apply_errata(by_id, log):
    wiki = json.loads(WIKI.read_text(encoding="utf-8"))
    for e in wiki["errata"]["entries"]:
        if e.get("group") != "Errata" or not e.get("resolves_to"):
            continue
        node = by_id.get(e["resolves_to"])
        if node is None:
            log.append(f"ERRATA no section {e['resolves_to']} for {e['target']}")
            continue
        for st in e["steps"]:
            instr = st.get("instruction") or ""
            q = strip_quotes(" ".join(st.get("quote") or []))
            text = norm(
                " ".join(para_text(b) for b in node["body"] if b["kind"] in ("p", "ol", "note"))
            )
            if not q:
                log.append(f"errata  CHECK BY HAND {e['target']}: {instr}")
                continue
            # "it targets." is inside "it targets.." -- a match that runs straight
            # into another full stop is the misprint the erratum corrects.
            if norm(q) in text and not (q.endswith(".") and norm(q) + "." in text):
                log.append(f"errata  in book     {e['target']}: {q[:60]}…")
                continue
            paras = [b for b in node["body"] if b["kind"] == "p"]
            done = False
            m = re.search(r"(first|second|third|fourth) paragraph", instr)
            if "sentence" in instr and "first sentence to" in instr and not m:
                p0 = paras[0]
                t = plain(p0["runs"])
                stem = q.rstrip(".")
                if t.startswith(stem):
                    rest = t[len(stem) :].lstrip(".")
                    p0["runs"] = [{"t": q + rest}]
                    done = True
            elif m and "sentence" not in instr:
                idx = ["first", "second", "third", "fourth"].index(m.group(1))
                old = plain(paras[idx]["runs"])
                if difflib.SequenceMatcher(None, old, q).ratio() > 0.9:
                    paras[idx]["runs"] = [{"t": q}]
                    done = True
            elif re.search(r"Amend rule to", instr) and len(paras) == 1:
                if difflib.SequenceMatcher(None, plain(paras[0]["runs"]), q).ratio() > 0.9:
                    paras[0]["runs"] = [{"t": q}]
                    done = True
            if done:
                node.setdefault("errata", []).append(e["id"])
                log.append(f"errata  APPLIED     {e['target']}: {instr} {q}")
            else:
                log.append(f"errata  NOT APPLIED {e['target']}: {instr} {q}")


# ---------------------------------------------------------------- tokens
TOKEN_FILE = {"Underground Monorail": "underground-tunnel", "Supressed": "suppressed"}


def tokens_block(node, log):
    items = []
    for b in node["body"]:
        if b["kind"] != "caption":
            continue
        name = plain(b["runs"]).strip()
        stem = TOKEN_FILE.get(name, wiki.slug(name))
        if not (TOKEN_DIR / f"{stem}.webp").exists():
            log.append(f"TOKEN missing art for {name} ({stem}.webp)")
            continue
        items.append({"name": name, "src": f"assets/tokens/{stem}.webp"})
    node["body"] = [{"kind": "tokens", "items": items}]


# ---------------------------------------------------------------- repair
def repair(tree, doc, sizes, log):
    by_id = {n["id"]: n for n in walk(tree)}
    need = lambda i: by_id[i]  # noqa: E731
    tables = build_tables(doc)

    for n in walk(tree):
        merge_breaks(n, log)

    need("2.1")["body"].append(fig(doc, "fig-centre", sizes))
    insert_after(need("2.5"), "Each Unit has a stats bar", tables["statbar-vehicle"])
    insert_after(need("2.6"), "Infantry have an", tables["statbar-infantry"])
    insert_after(need("2.7"), "Most Units have Weapons", tables["weapon-profile"])
    insert_after(need("3.2"), "Building your Army is as simple", tables["army-restrictions"])
    need("3.2.4.1")["body"].append(fig(doc, "fig-groups", sizes))

    p11 = doc[10]
    box = (20, 40, 206, 392)
    need("3.2.4.2")["body"] = [
        {"kind": "p", "runs": p["runs"]} for p in region_paras(p11, box, symbols_on(p11, box))
    ] + [fig(doc, "fig-sabres", sizes), fig(doc, "fig-condor-bears", sizes)]

    insert_after(need("3.2.5"), "You must take at least one Commander", tables["commanders"])
    insert_after(need("5.1"), "Players can use Abilities", tables["abilities"])

    # The card anatomy is 5.2's, set in the column beside 5.2.1.
    anatomy = re.compile(r"^(Name|Cost|Radius|Play|Target|Effect|BOOST):")
    s521 = need("5.2.1")
    moved = [b for b in s521["body"] if b["kind"] == "p" and anatomy.match(para_text(b))]
    s521["body"] = [b for b in s521["body"] if b not in moved]
    insert_after(
        need("5.2"),
        "Command Cards are set out as follows",
        fig(doc, "fig-command-card", sizes),
        *moved,
    )

    p16 = doc[15]
    sym_box = region_paras(p16, (214, 333, 399, 566))
    title = next(p for p in sym_box if p["head"])
    intro = next(p for p in sym_box if not p["head"])
    labels = [p for p in sym_box if p is not title and p is not intro]
    items = []
    for (name, _r), lab in zip(PLAY_ICONS, sorted(labels, key=lambda p: p["y0"]), strict=True):
        items.append(
            {"name": plain(lab["runs"]), "src": f"assets/rules/{name}.webp", **sizes.get(name, {})}
        )
    s521["body"].append(
        {"kind": "symbols", "title": plain(title["runs"]), "runs": intro["runs"], "items": items}
    )

    need("6.1")["body"].append(fig(doc, "fig-ground", sizes))
    s6211 = need("6.2.1.1")
    for prefix, name in (
        ("The Sabre has Obscured", "fig-los-drones"),
        ("The Tusk is Obscured", "fig-los-polecats"),
    ):
        i = find_para(s6211, prefix)
        s6211["body"][i]["kind"] = "note"
        s6211["body"].insert(i, fig(doc, name, sizes))
    need("6.2.4")["body"].append(tables["energy-armour"])

    need("7")["body"].append(fig(doc, "fig-embark", sizes))
    insert_after(need("8"), "Scenarios will specify which to use", tables["zones"])
    need("8.3.1.1")["body"] += [
        fig(doc, n, sizes)
        for n in ("fig-disembark-zone", "fig-disembark-open", "fig-disembark-vulture")
    ]
    p30 = doc[29]
    need("8.5.1")["body"] += (
        [fig(doc, "fig-area-los", sizes)]
        + [{"kind": "note", "runs": p["runs"]} for p in region_paras(p30, (216, 157, 399, 359))]
        + [fig(doc, "fig-building-los", sizes)]
        + [{"kind": "note", "runs": p["runs"]} for p in region_paras(p30, (216, 530, 399, 581))]
    )
    insert_after(need("8.8.1"), "Each Weapon in the following table", tables["weapon-features"])

    ch9 = need("9")
    ch9["children"] = [c for c in ch9["children"] if c["number"]] + scenario_cards(doc, log)
    tokens_block(need("12"), log)

    for n in walk(tree):
        if any(b["kind"] == "p" and MARK.match(para_text(b).strip()) for b in n["body"]):
            to_lists(n)
    tidy_all(tree)
    by_id = {n["id"]: n for n in walk(tree)}
    apply_errata(by_id, log)

    for n in walk(tree):
        caps = [plain(b["runs"]) for b in n["body"] if b["kind"] == "caption"]
        if caps and n["id"] != "12":
            log.append(f"caption left in {n['id']}: {caps}")
        n["body"] = [b for b in n["body"] if b["kind"] != "caption"]
    return tree


# ---------------------------------------------------------------- dump
def runs_dump(runs):
    return "".join(f"**{r['t']}**" if r.get("b") else r["t"] for r in runs)


def dump(tree, path):
    lines: list[str] = []

    def cells(row):
        return " | ".join(
            ("<" + str(c.get("cs", "")) + ">" if c.get("cs") else "")
            + runs_dump(c["r"]).replace("\n", "¶")
            for c in row
        )

    def rec(ns, dep):
        for n in ns:
            lines.append("")
            lines.append("#" * dep + f" [{n['id']}] {n['number']} {n['heading']} (p{n['page']})")
            for b in n["body"]:
                k = b["kind"]
                if k == "table":
                    lines.append(f"  TABLE {b.get('variant', '')}")
                    for row in b["head"]:
                        lines.append("   H| " + cells(row))
                    for row in b["rows"]:
                        lines.append("    | " + cells(row))
                elif k == "fig":
                    lines.append(f"  FIG {b['src']} alt={b['alt'][:120]!r}")
                elif k == "ol":
                    for i, it in enumerate(b["items"], 1):
                        lines.append(f"  {i}. " + " ¶ ".join(runs_dump(p) for p in it))
                elif k == "tokens":
                    lines.append("  TOKENS " + ", ".join(t["name"] for t in b["items"]))
                elif k == "symbols":
                    lines.append(
                        f"  SYMBOLS {b['title']}: {runs_dump(b['runs'])} "
                        + ", ".join(t["name"] for t in b["items"])
                    )
                else:
                    lines.append(f"  {k}: {runs_dump(b['runs'])}")
            rec(n["children"], dep + 1)

    rec(tree, 1)
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    ap.add_argument("--dump", type=pathlib.Path)
    ap.add_argument("--no-figures", action="store_true")
    args = ap.parse_args()

    sizes: dict[str, dict[str, Any]] = {}
    if not args.no_figures:
        sizes = render_figures(PDF)
    elif OUT.exists():
        for b in (
            b
            for n in walk(json.loads(OUT.read_text(encoding="utf-8"))["chapters"])
            for b in n["body"]
        ):
            if b["kind"] == "fig":
                sizes[pathlib.Path(b["src"]).stem] = {"w": b.get("w"), "h": b.get("h")}

    wiki.page_blocks = page_blocks
    doc = fitz.open(PDF)
    tree = wiki.extract_book(doc, {})
    log: list[str] = []
    tree = repair(tree, doc, sizes, log)
    for line in log:
        print(line)
    if args.dump:
        dump(tree, args.dump)
        print(f"dumped {args.dump}")
    out = {
        "game": "Dropzone Commander",
        "edition": "3.02",
        "source": PDF.name,
        "generator": "tools/dzc/build_rules_book.py",
        "chapters": tree,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(
        f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB), "
        f"{sum(1 for _ in walk(tree))} sections"
    )


if __name__ == "__main__":
    main()
