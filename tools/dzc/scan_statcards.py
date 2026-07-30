#!/usr/bin/env python3
"""
Convert TTCombat Dropzone Commander stat-card PDFs into builder JSON.

Run:  python tools/scan_statcards.py [--pdf-dir .] [--out data] [--art assets/units]

Everything comes from PyMuPDF. Deliberately NOT pdftotext: it silently drops the
infinity glyph, so the Avenger Railgun's "inf/24" range would ship blank.

The card layout is fixed (A5, 420x595pt), so the parse is positional:
  top-left    Category, then "Squad Size: N-M"
  top-centre  Unit name
  top-right   Points, possibly per-variant, possibly ", Rare"/", Unique"
  upper-left  Transport symbol(s): a filled/hollow shape with a digit inside
  middle      Unit photo (embedded image)
  lower       Stat table, then weapon table

Weapon name-box colour is semantic and load-bearing:
  blue   -> the weapon is on every variant
  orange -> restricted to the variant(s) named in brackets after the weapon name
  green  -> a paid upgrade; the box carries the points cost
"""

import argparse
import io
import json
import os
import re
import sys
from collections import defaultdict

from PIL import Image

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit("PyMuPDF required:  python -m pip install pymupdf")


FACTIONS = {
    "UCM": "ucm",
    "PHR": "phr",
    "Scourge": "scourge",
    "Shaltari": "shaltari",
    "Resistance": "resistance",
    "Bioficer": "bioficer",
}

# Weapon name-box fill colours, sampled from the 260730 cards. Matched by
# nearest-distance in RGB so minor re-exports don't break the parse.
BOX_COLOURS = {
    "all": (0.36, 0.68, 0.89),      # blue
    "variant": (0.90, 0.36, 0.20),  # orange
    "upgrade": (0.30, 0.70, 0.35),  # green
}

# Transport symbol fills. Shape says which transports may carry the unit, so a
# merge here silently permits illegal armies.
SHAPE_BY_SIDES = {3: "triangle", 4: "square", 5: "pentagon", 6: "hexagon"}

# Symbol ink, sampled from the 260730 cards. Six symbols, each with ONE colour.
#
# This is load-bearing, not decoration. An upright triangle and an inverted one
# have identical convex hulls -- 3 corners either way -- so geometry alone
# cannot separate the red triangle from the purple inverted triangle, and the
# scanner merged them. That let a Condor (6 red) load a K9 Pack (1 purple) and
# a Harbinger (4 purple) load Sabres (2 red). Both illegal, both silent.
#
# Orientation is read geometrically and the colour must agree. If a re-export
# shifts the palette the two disagree and the scan FAILS rather than quietly
# collapsing the symbols again.
SYMBOL_INK = {
    "square":        (0.000, 0.553, 0.212),   # green
    "diamond":       (0.976, 0.698, 0.200),   # yellow
    "triangle":      (0.745, 0.086, 0.133),   # red, apex up
    "triangle-down": (0.400, 0.141, 0.514),   # purple, apex down
    "circle":        (0.233, 0.542, 0.791),   # blue
    "pentagon":      (0.914, 0.306, 0.106),   # orange
}

# Separator glyphs printed between badges (real text on the card, not inferred).
#   "+"  carry both shapes simultaneously
#   "/"  either shape, never mixed
#   ","  ends the capacity group; what follows is what this unit FILLS
SEP_BOTH, SEP_EITHER, SEP_FILLS = "+", "/", ","

ART_DIR = "assets/units"

STAT_HEADERS_VEHICLE = ["Type", "Mv", "A", "DP", "Special"]
STAT_HEADERS_INFANTRY = ["Type", "Mv", "OF", "DF", "B", "DP", "Special"]
WEAPON_HEADERS = ["Name", "Arc", "MA", "R", "Att", "Ac", "E", "Special"]


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


# Hyphen-like break glyphs only. A broad [^\w\s] also matches the comma in
# "(Surge 1, 2, and 3)" and welds it into "2and", losing a variant.
HYPHENISH = r"(\w)[-­‐-―�]"


def dehyphenate(s):
    """
    Repair words broken across a line break in the right-aligned points banner.

    A lowercase continuation is a soft hyphen and the hyphen goes ("Jack-" +
    "al" -> "Jackal"); an uppercase one is a real compound and it stays
    ("Fighter-" + "Bomber" -> "Fighter-Bomber").
    """
    s = re.sub(HYPHENISH + r"\s+([a-z])", r"\1\2", s)
    return re.sub(HYPHENISH + r"\s+([A-Z])", r"\1-\2", s)


def split_variant_list(raw):
    """
    Expand a variant bracket into full names.

    Cards abbreviate: "(Surge 1, 2, and 3)" names Surge 1, Surge 2 and Surge 3,
    with the prefix written only once. Separators are comma, slash and "and".
    """
    # Split commas/slashes first, then only a FREESTANDING "and". An unbounded
    # \s*and\s* cuts inside words -- "Alexander" would become "Alex" + "er".
    parts = []
    for chunk in re.split(r"\s*[,/]\s*", raw):
        chunk = re.sub(r"^\s*and\s+", "", chunk.strip(), flags=re.I)
        parts.extend(q.strip() for q in re.split(r"\s+and\s+", chunk) if q.strip())
    if not parts:
        return []
    prefix = None
    m = re.match(r"^(.*?)\s*\d+$", parts[0])
    if m and m.group(1):
        prefix = m.group(1).strip()
    out = []
    for p in parts:
        if prefix and re.fullmatch(r"\d+", p):
            out.append(f"{prefix} {p}")
        else:
            out.append(p)
    return out


def norm_variant(n):
    """'Osprey-A' and 'Osprey A' are the same variant; compare on this."""
    return re.sub(r"s$", "", re.sub(r"[^a-z0-9]+", "", n.lower()))


def colour_name(rgb):
    """Nearest semantic name for a weapon name-box fill."""
    if rgb is None:
        return None
    best, bestd = None, 1e9
    for name, ref in BOX_COLOURS.items():
        d = sum((a - b) ** 2 for a, b in zip(rgb, ref))
        if d < bestd:
            best, bestd = name, d
    return best if bestd < 0.12 else None


def words_in(page, rect):
    return [w for w in page.get_text("words") if fitz.Rect(w[:4]).intersects(rect)]


def line_group(words, tol=3.0):
    """Group words into visual lines by y, then sort each line by x."""
    rows = defaultdict(list)
    for w in sorted(words, key=lambda w: (w[1], w[0])):
        key = next((k for k in rows if abs(k - w[1]) <= tol), None)
        rows[key if key is not None else w[1]].append(w)
    return [sorted(v, key=lambda w: w[0]) for _, v in sorted(rows.items())]


def text_of(line):
    return " ".join(w[4] for w in line)


# ---------------------------------------------------------------- header

POINTS_RE = re.compile(r"(\d+)\s*pts?\s*(?:\(([^)]*)\))?", re.I)


def parse_points(s):
    """
    '35pts (Sabre, Greave), 40pts (Tachi, Rapier)' -> per-variant costs
    '155pts, Rare'                                 -> flat cost + Rare
    Returns (flat_points, {variant: points}, rare, unique)
    """
    rare = bool(re.search(r"\bRare\b", s, re.I))
    unique = bool(re.search(r"\bUnique\b", s, re.I))
    per, flat = {}, None
    for m in POINTS_RE.finditer(s):
        pts = int(m.group(1))
        names = m.group(2)
        if names:
            for n in split_variant_list(names):
                # guard against '(Rare)' or stray words landing in the bracket
                if n and not re.fullmatch(r"Rare|Unique|All", n, re.I):
                    per[n] = pts
        else:
            flat = pts
    return flat, per, rare, unique


def parse_header(page):
    """
    Category, squad size, name and points from the top banner.

    The title is found by font size, not by horizontal position: it is centred
    and wide, so a left/centre/right split truncates it ("UCM Main Battle Tank"
    loses both "UCM" and "Tank"). The band stops at y=55 to stay above the
    transport badge, whose digit is set larger than the title.
    """
    top = fitz.Rect(0, 0, page.rect.width, 55)
    spans = []
    for blk in page.get_text("dict", clip=top)["blocks"]:
        for ln in blk.get("lines", []):
            for sp in ln["spans"]:
                if sp["text"].strip():
                    spans.append(sp)
    if not spans:
        return None

    big = max(sp["size"] for sp in spans)
    title_spans = [sp for sp in spans if sp["size"] >= big - 0.6]
    rest_spans = [sp for sp in spans if sp["size"] < big - 0.6]

    title_spans.sort(key=lambda sp: (round(sp["bbox"][1]), sp["bbox"][0]))
    name = re.sub(r"\s+", " ", " ".join(sp["text"].strip() for sp in title_spans)).strip()

    # Read the two banner columns SEPARATELY. Category/Squad Size sit left and
    # the points sit right at the SAME y values, so a plain (y, x) sort splices
    # the left column into the middle of a wrapped points bracket:
    #   "55pts (Surge 1, 2, and Squad Size: 1-2 3), 60pts (Surge 4)"
    mid = page.rect.width * 0.5

    def column(spans_):
        spans_ = sorted(spans_, key=lambda sp: (round(sp["bbox"][1]), sp["bbox"][0]))
        return dehyphenate(
            re.sub(r"\s+", " ", " ".join(sp["text"].strip() for sp in spans_)).strip()
        )

    ltxt = column([sp for sp in rest_spans if sp["bbox"][0] < mid])
    ptxt = column([sp for sp in rest_spans if sp["bbox"][0] >= mid])
    rtxt = (ltxt + " " + ptxt).strip()

    # "Squad Size: N/A" marks a unit that exists only as a reference profile --
    # e.g. the Starsprite, whose Remote Drone rule says it "may not be taken in
    # your Army" but which a Drone Base launches, so players still need stats.
    m = re.search(r"Squad\s*Size:\s*(?:(\d+)\s*(?:-\s*(\d+))?|(N/?A))", ltxt or rtxt, re.I)
    if not m:
        return None
    if m.group(3):
        smin = smax = None
    else:
        smin = int(m.group(1))
        smax = int(m.group(2)) if m.group(2) else smin

    cat = re.split(r"Squad\s*Size", ltxt or rtxt, flags=re.I)[0].strip()
    cat = re.sub(r"\s*\d+\s*pts?.*$", "", cat, flags=re.I).strip(" ,") or None
    m2 = re.search(r"(Standard|Vanguard|Heavy|Support|Transport|Generated)", cat or "", re.I)
    cat = m2.group(1).title() if m2 else cat

    flat, per, rare, unique = parse_points(ptxt or rtxt)
    return {
        "name": name,
        "category": cat,
        "squadMin": smin,
        "squadMax": smax,
        "points": flat,
        "variantPoints": per,
        "rare": rare,
        "unique": unique,
        "pointsRaw": ptxt,
    }


# ------------------------------------------------------- transport symbols


def _hull(points):
    """Convex hull (monotone chain). Returns hull vertices in order."""
    pts = sorted(set((round(p[0], 1), round(p[1], 1)) for p in points))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def _corners(hull, tol=0.30):
    """Drop hull points that are nearly collinear with their neighbours."""
    n = len(hull)
    if n < 3:
        return n
    keep = 0
    for i in range(n):
        a, b, c = hull[i - 1], hull[i], hull[(i + 1) % n]
        v1 = (b[0] - a[0], b[1] - a[1])
        v2 = (c[0] - b[0], c[1] - b[1])
        m1 = (v1[0] ** 2 + v1[1] ** 2) ** 0.5
        m2 = (v2[0] ** 2 + v2[1] ** 2) ** 0.5
        if m1 < 0.5 or m2 < 0.5:
            continue
        cosang = (v1[0] * v2[0] + v1[1] * v2[1]) / (m1 * m2)
        if cosang < 1 - tol:          # a real change of direction
            keep += 1
    return keep


def _corner_points(hull, tol=0.30):
    """As _corners, but returns the surviving vertices rather than a count."""
    n = len(hull)
    if n < 3:
        return list(hull)
    keep = []
    for i in range(n):
        a, b, c = hull[i - 1], hull[i], hull[(i + 1) % n]
        v1 = (b[0] - a[0], b[1] - a[1])
        v2 = (c[0] - b[0], c[1] - b[1])
        m1 = (v1[0] ** 2 + v1[1] ** 2) ** 0.5
        m2 = (v2[0] ** 2 + v2[1] ** 2) ** 0.5
        if m1 < 0.5 or m2 < 0.5:
            continue
        cosang = (v1[0] * v2[0] + v1[1] * v2[1]) / (m1 * m2)
        if cosang < 1 - tol:
            keep.append(b)
    return keep


def triangle_points_down(corners):
    """
    True for an inverted triangle, from the lone vertex's side.

    Page y grows DOWNWARD. An upright triangle has one vertex alone at the top
    and two level along the bottom, so sorting the three y values leaves the big
    gap between the first and second. An inverted one puts two level at the top
    and the lone vertex at the bottom, moving the gap to the far end.
    """
    if len(corners) != 3:
        return None
    ys = sorted(p[1] for p in corners)
    gap_top, gap_bottom = ys[1] - ys[0], ys[2] - ys[1]
    if abs(gap_top - gap_bottom) < 0.5:      # too close to call
        return None
    return gap_bottom > gap_top


def nearest_symbol(rgb):
    """Nearest SYMBOL_INK entry, with its squared distance."""
    if rgb is None:
        return None, 1e9
    best, bestd = None, 1e9
    for name, ref in SYMBOL_INK.items():
        d = sum((a - b) ** 2 for a, b in zip(rgb, ref))
        if d < bestd:
            best, bestd = name, d
    return best, bestd


def classify_shape(drawing):
    """
    Return ('square'|'triangle'|'triangle-down'|'diamond'|'circle'|'pentagon'
    |None, solid: bool).

    Classified from the OUTER boundary, not the path-item count. A hollow badge
    is drawn as nested outlines, so a hollow triangle has 6 line items and a
    bordered one 12 -- counting items called the Condor's triangle a hexagon and
    left the Raven's 8-segment square unclassified, silently dropping it. 12 is
    divisible by both 3 and 4, so arithmetic on the count cannot work either.
    The convex hull of every point has 3 corners for any triangle however many
    times it is stroked.
    """
    items = [i[0] for i in drawing["items"]]
    curves = items.count("c")
    rects = items.count("re")

    pts = []
    for it in drawing["items"]:
        if it[0] == "l":
            pts.extend([(it[1].x, it[1].y), (it[2].x, it[2].y)])
        elif it[0] == "re":
            r = it[1]
            pts.extend([(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)])

    shape = None
    if curves >= 4 and not pts:
        shape = "circle"
    elif pts:
        c = _corners(_hull(pts))
        shape = {3: "triangle", 4: "square", 5: "pentagon", 6: "hexagon"}.get(c)
        if shape == "square":
            # A diamond is a square rotated 45 degrees, and the rulebook treats
            # symbol SHAPE as what a transport may carry -- so the Raven's
            # orange diamond is not the Legionnaires' green square and the two
            # must not collapse together. A diamond's corners sit at the
            # bounding box's edge midpoints, an upright square's at its corners.
            hull = _hull(pts)
            xs = [p[0] for p in hull]
            ys = [p[1] for p in hull]
            cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
            w2, h2 = (max(xs) - min(xs)) / 2, (max(ys) - min(ys)) / 2
            if w2 > 1 and h2 > 1:
                on_axis = sum(
                    1 for p in hull
                    if abs(p[0] - cx) < w2 * 0.25 or abs(p[1] - cy) < h2 * 0.25
                )
                if on_axis >= len(hull) * 0.6:
                    shape = "diamond"
        if shape == "triangle":
            # Upright and inverted triangles are the SAME convex hull, so this
            # is decided by which side the lone vertex sits on -- then checked
            # against the ink below.
            if triangle_points_down(_corner_points(_hull(pts))):
                shape = "triangle-down"
        if shape is None and rects:
            shape = "square"
    elif rects:
        shape = "square"

    fill = drawing.get("fill")
    # Hollow badges are drawn as a white/near-white body with a coloured stroke.
    solid = bool(fill) and not all(c > 0.9 for c in fill)

    # Cross-check geometry against ink. Only the badge's own coloured path
    # carries a usable colour -- white bodies and near-black plates are backing,
    # not the symbol -- so anything else is left to the geometry unchallenged.
    ink = fill if (fill and not all(c > 0.9 for c in fill)
                   and not all(c < 0.2 for c in fill)) else drawing.get("color")
    if shape and ink and not all(c > 0.9 for c in ink):
        by_ink, dist = nearest_symbol(ink)
        if dist < 0.05 and by_ink != shape:
            # Both readings are confident and they disagree. Refusing to guess
            # is the point: a wrong symbol permits an illegal army in silence,
            # which is far worse than a scan that stops and says so.
            raise ValueError(
                f"transport symbol mismatch: geometry says {shape!r}, ink "
                f"{tuple(round(c, 3) for c in ink)} says {by_ink!r}. The card "
                f"palette may have changed -- check SYMBOL_INK."
            )
    return shape, solid


def badge_is_hollow(page, rect):
    """
    Hollow (carrying capacity) vs solid (space filled), decided from pixels.

    The vector fill alone is not enough: the Raven's badge is an ORANGE outline
    around a WHITE interior, so the outer path's fill says "coloured" while the
    badge reads hollow. Conversely the Legionnaires' badge is a green fill
    sitting inside a white backing plate, which reads solid. Rendering the badge
    and comparing white area against saturated area gets both right.
    """
    try:
        pix = page.get_pixmap(clip=rect, dpi=150)
    except Exception:                                    # noqa: BLE001
        return False
    white = coloured = 0
    for y in range(0, pix.height, 2):
        for x in range(0, pix.width, 2):
            r, g, b = pix.pixel(x, y)[:3]
            hi, lo = max(r, g, b), min(r, g, b)
            if lo > 200:
                white += 1
            elif hi - lo > 55 and hi > 70:
                coloured += 1
    # Ratio, not a bare majority. A thick border makes a hollow badge close to
    # even -- the Raven's diamond measures 170 white to 172 coloured -- while
    # genuinely solid badges sit an order of magnitude apart (Legionnaires
    # 66:615, Main Battle Tank 48:251). 0.5 splits them with room to spare.
    return white > coloured * 0.5


def parse_transport(page):
    """
    Symbols sit in the upper-left of the art panel. A hollow symbol is carrying
    capacity; a solid one is the space this unit occupies aboard a transport.
    A unit may have both (the Bioficer Genitor Ark carries 12 and fills 4).
    """
    panel = fitz.Rect(0, 50, page.rect.width * 0.55, 215)

    # Digits WITH their font size. Each badge carries the number twice: a
    # leftover template glyph at ~19.9pt and the real value at ~14.2pt drawn
    # over it. Reading by position alone yields the template "1" on every card.
    digits = []
    seps = []
    for blk in page.get_text("dict", clip=panel)["blocks"]:
        for ln in blk.get("lines", []):
            for sp in ln["spans"]:
                t = sp["text"].strip()
                if re.fullmatch(r"\d{1,2}", t):
                    digits.append((int(t), fitz.Rect(sp["bbox"]), sp["size"]))
                elif t in (SEP_BOTH, SEP_EITHER, SEP_FILLS):
                    # Printed between badges; x-order is what links them.
                    seps.append((t, fitz.Rect(sp["bbox"])))
    if not digits:
        return {"capacity": [], "fills": []}
    seps.sort(key=lambda s: s[1].x0)

    badges = []
    for g in page.get_drawings():
        r = g["rect"]
        if not (14 < r.width < 45 and 14 < r.height < 45):
            continue
        if abs(r.width - r.height) > 14 or not panel.contains(r.tl):
            continue
        badges.append(g)

    capacity, fills, claimed, placed = [], [], [], []
    for g in sorted(badges, key=lambda g: g["rect"].x0):
        r = g["rect"]
        inside = [d for d in digits
                  if r.contains(fitz.Point((d[1].x0 + d[1].x1) / 2,
                                           (d[1].y0 + d[1].y1) / 2))]
        if not inside:
            continue
        # smallest glyph = the real value, not the template placeholder
        value, drect, _ = min(inside, key=lambda d: d[2])
        if any(drect.intersects(c) for c in claimed):
            continue
        claimed.append(drect)

        shape, _ = classify_shape(g)
        if not shape:
            continue
        entry = {"shape": shape, "n": value}
        (capacity if badge_is_hollow(page, r) else fills).append(entry)
        placed.append(r)

    # How the capacity symbols combine. "+" means both at once, "/" means either
    # but never mixed -- the difference between a legal load and an illegal one,
    # so it is read from the printed glyph rather than assumed. A separator
    # counts only when it sits BETWEEN two capacity badges; the "," before a
    # fills badge is a different statement and must not be mistaken for one.
    mode = None
    if len(capacity) > 1:
        spans = sorted(placed[:len(capacity)], key=lambda r: r.x0)
        between = [t for t, sr in seps
                   if spans[0].x1 <= sr.x0 and sr.x1 <= spans[len(capacity) - 1].x0
                   and t in (SEP_BOTH, SEP_EITHER)]
        if not between:
            raise ValueError(
                f"{len(capacity)} capacity symbols but no '+' or '/' between "
                f"them -- cannot tell 'carries both' from 'either, not mixed'."
            )
        if len(set(between)) > 1:
            raise ValueError(f"mixed capacity separators {between!r}")
        mode = "both" if between[0] == SEP_BOTH else "either"

    return {"capacity": capacity, "capacityMode": mode, "fills": fills}


# ------------------------------------------------------------- tables


def find_header_row(lines, headers, need=4):
    for i, ln in enumerate(lines):
        got = {w[4] for w in ln}
        if sum(1 for h in headers if h in got) >= need:
            return i, ln
    return None, None


def vertical_rules(page, y0, y1):
    """
    True column edges, taken from the table's drawn vertical rules.

    Inferring a boundary as the midpoint between two header word centres fails
    on wide cells: the Name column runs to x=355 but its header word "Name" is
    centred at x=197, so the midpoint lands at ~298 and the tail of a long
    weapon name ("...Railgun") spills into Arc.
    """
    xs = []
    for g in page.get_drawings():
        r = g["rect"]
        if r.width > 1.5 or r.height < 6:
            continue
        if r.y1 < y0 - 4 or r.y0 > y1 + 4:
            continue
        x = (r.x0 + r.x1) / 2
        if not any(abs(x - e) < 2.5 for e in xs):
            xs.append(x)
    return sorted(xs)


_DOC_RULES = {}


def doc_rules(doc):
    """
    Canonical column edges for the whole PDF.

    Every card shares one template -- the weapon-table header centres are
    identical page to page -- but not every page draws its vertical rules in
    the band we look at. The Resistance ATVs card draws none, so a page-local
    lookup falls back to the midpoint between header centres (107.8) which sits
    just left of "ATV)" at 111.8 and tears the closing bracket off the weapon
    name. Pooling rules across pages lets those cards inherit the real grid.
    """
    key = id(doc)
    if key in _DOC_RULES:
        return _DOC_RULES[key]
    seen = defaultdict(int)
    for page in doc:
        for x in vertical_rules(page, 235, 430):
            hit = next((k for k in seen if abs(k - x) < 2.5), None)
            seen[hit if hit is not None else x] += 1
    # Keep edges the template repeats; one-off page furniture is dropped.
    out = sorted(x for x, n in seen.items() if n >= 3)
    _DOC_RULES[key] = out
    return out


def columns_from_header(header_line, headers):
    """Map each header token to its x-centre, in page order."""
    cols = []
    for w in header_line:
        if w[4] in headers:
            cols.append((w[4], (w[0] + w[2]) / 2))
    # de-dupe repeated 'Special' etc., keeping page order
    seen, out = set(), []
    for name, cx in cols:
        key = (name, round(cx))
        if key in seen:
            continue
        seen.add(key)
        out.append((name, cx))
    return sorted(out, key=lambda c: c[1])


def split_row(line, cols, rules=None):
    """
    Assign each word to a column by boundary, not by nearest centre.

    Nearest-centre breaks on wide left columns: in "UM-105 Missile Launcher"
    the word "Launcher" sits right of the Name header's centre and gets pulled
    into Arc. Midpoint boundaries between adjacent headers keep it in Name.
    """
    if not cols:
        return {}
    if rules:
        # Keep only rules that actually separate two adjacent header centres.
        bounds = []
        for i in range(len(cols) - 1):
            lo, hi = cols[i][1], cols[i + 1][1]
            between = [x for x in rules if lo < x < hi]
            bounds.append(between[len(between) // 2] if between else (lo + hi) / 2)
    else:
        bounds = [(cols[i][1] + cols[i + 1][1]) / 2 for i in range(len(cols) - 1)]
    buckets = defaultdict(list)
    for w in line:
        cx = (w[0] + w[2]) / 2
        idx = 0
        while idx < len(bounds) and cx > bounds[idx]:
            idx += 1
        buckets[idx].append(w)
    out = {}
    for i, (name, _) in enumerate(cols):
        if buckets.get(i):
            out[name] = " ".join(x[4] for x in sorted(buckets[i], key=lambda w: w[0])).strip()
    return out


def parse_stat_table(page, lines):
    i, hdr = find_header_row(lines, STAT_HEADERS_INFANTRY, need=5)
    infantry = True
    if hdr is None:
        i, hdr = find_header_row(lines, STAT_HEADERS_VEHICLE, need=4)
        infantry = False
    if hdr is None:
        return None, None, None

    headers = STAT_HEADERS_INFANTRY if infantry else STAT_HEADERS_VEHICLE
    cols = columns_from_header(hdr, headers)
    # Column boundaries come from THIS table's own drawn dividers, taken from
    # the header row's tight y-band.
    #
    # The band used to be `top` to `top + 40`, which reaches past the header
    # into the weapon table below, and was then unioned with document-wide
    # rules. Both pull in dividers belonging to the OTHER table, whose columns
    # sit at different x. On the Totem Shieldspire that left six candidate
    # boundaries between DP and Special; split_row takes the middle one, which
    # landed at x=241.7 while the real divider is at x=206.4 -- so "Friendly"
    # (centred at 231.2) was filed under DP and the rule read
    # "Vehicles and Aircraft 6" 5+" instead of "Friendly Vehicles and ...".
    #
    # The tight band yields exactly one divider per column edge. Document-wide
    # rules stay only as a fallback for a card whose dividers are not drawn.
    top, bottom = min(w[1] for w in hdr), max(w[3] for w in hdr)
    rules = sorted(vertical_rules(page, top, bottom))
    if len(rules) < len(cols) - 1:
        rules = sorted(set(rules) | set(doc_rules(page.parent)))
    for ln in lines[i + 1:i + 4]:
        row = split_row(ln, cols, rules)
        if row.get("Type") in ("Vehicle", "Aircraft", "Infantry"):
            special = row.pop("Special", "") or ""
            utype = row.pop("Type")
            return (utype, {k: v for k, v in row.items() if v},
                    join_broken_hyphen(special.strip(" -")))
    return None, None, None


def weapon_swatches(page):
    """
    The weapon name-box swatch is an embedded IMAGE, not a vector fill, so
    get_drawings() never sees it. One xref is reused for every row of the same
    kind, so sample each xref's centre pixel once and reuse it per rect.

    Returns [(rect, 'all'|'variant'|'upgrade')].
    """
    doc = page.parent
    out, cache = [], {}
    for im in page.get_images(full=True):
        xref = im[0]
        rects = [r for r in page.get_image_rects(xref)
                 if 8 < r.width < 45 and 4 < r.height < 22]
        if not rects:
            continue
        if xref not in cache:
            try:
                pix = fitz.Pixmap(doc, xref)
                if pix.n - pix.alpha > 3:
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                px = pix.pixel(pix.width // 2, pix.height // 2)[:3]
                cache[xref] = colour_name(tuple(c / 255 for c in px))
            except Exception:                        # noqa: BLE001
                cache[xref] = None
        if cache[xref]:
            for r in rects:
                out.append((r, cache[xref]))
    return out


# Flavour text under a card's tables is the only italic thing on a card, so it
# marks where the data ends and the prose begins.
#
# Read from the span's ITALIC FLAG rather than by matching "Obl" or "Italic" in
# a font name: the flag is a property of the type, whereas the name is whatever
# the foundry chose and whatever TTCombat licenses next.
ITALIC_FLAG = 1 << 1


def join_broken_hyphen(s):
    """
    Rejoin a hyphenated rule name split across a cell's line wrap.

    "Self-Destruct" and "Drive-by" wrap inside the narrow Special column and
    come back as "Self- Destruct" and "Drive- by", which then match no rule in
    the glossary. Only a hyphen followed by whitespace is closed up, so a
    genuine spaced compound is left alone.
    """
    return re.sub(r"(\w)-\s+(\w)", r"\1-\2", s)


def lore_top(page, below_y):
    """
    Y of the first flavour-text line under the tables, or None.

    The last weapon's band runs to the bottom-most word on the page, so without
    this the lore paragraph is swallowed into that weapon's cells -- the
    Bioficer Drones ended up with a weapon named "Decon Rifles Drones are
    standard Bioficer infantry, and pure muscle, bone, and sinew...".
    """
    ys = []
    for blk in page.get_text("dict")["blocks"]:
        for ln in blk.get("lines", []):
            for sp in ln["spans"]:
                if (sp["text"].strip() and (sp["flags"] & ITALIC_FLAG)
                        and sp["bbox"][1] > below_y):
                    ys.append(sp["bbox"][1])
    return min(ys) if ys else None


def parse_weapons(page, lines):
    i, hdr = find_header_row(lines, WEAPON_HEADERS, need=5)
    if hdr is None:
        return []
    cols = columns_from_header(hdr, WEAPON_HEADERS)

    boxes = weapon_swatches(page)

    # Rows are anchored on the name-box swatches, one per weapon, NOT on text
    # lines. A weapon whose name wraps ("UM-100 Avenger Railgun" / "(Sabre)")
    # spans two lines while its stats sit on only one, so line-walking
    # mis-pairs names with the wrong stats.
    boxes.sort(key=lambda b: b[0].y0)
    hdr_bottom = max(w[3] for w in hdr)
    xs = [c[1] for c in cols]
    tbl = fitz.Rect(min(xs) - 40, hdr_bottom, max(xs) + 60, page.rect.height)
    # Stop at the flavour text. Everything below it is prose, not table data.
    lore_y = lore_top(page, hdr_bottom)
    if lore_y is not None:
        tbl.y1 = min(tbl.y1, lore_y)
    below = [w for w in words_in(page, tbl) if w[1] > hdr_bottom
             and (lore_y is None or w[3] <= lore_y + 1)]
    if not boxes or not below:
        return []
    last_y = max(w[3] for w in below) + 2
    rules = sorted(set(vertical_rules(page, hdr_bottom, last_y)) | set(doc_rules(page.parent)))

    weapons = []
    for idx, (rect, kind) in enumerate(boxes):
        top = rect.y0 - 5
        bot = boxes[idx + 1][0].y0 - 5 if idx + 1 < len(boxes) else last_y
        band = [w for w in below if top <= (w[1] + w[3]) / 2 < bot]
        if not band:
            continue
        cells = defaultdict(list)
        for ln in line_group(band):
            for k, v in split_row(ln, cols, rules).items():
                cells[k].append(v)
        joined = {k: " ".join(v).strip() for k, v in cells.items()}
        weapons.append({
            "name": re.sub(r"\s+", " ", joined.get("Name", "")).strip(),
            "arc": joined.get("Arc") or None,
            "ma": joined.get("MA") or None,
            "r": joined.get("R") or None,
            "att": joined.get("Att") or None,
            "ac": joined.get("Ac") or None,
            "e": joined.get("E") or None,
            "special": join_broken_hyphen(
                re.sub(r"\s+", " ", joined.get("Special", "")).strip(" -")),
            "box": kind,
        })

    # Pull the "(Sabre)" restriction out of the name now that wraps are joined.
    for w in weapons:
        m = re.search(r"\(([^)]+)\)\s*$", w["name"])
        if m:
            w["variants"] = [v.strip() for v in re.split(r"[,/]", m.group(1)) if v.strip()]
            w["name"] = w["name"][: m.start()].strip()
        else:
            w["variants"] = []
        cost = re.search(r"\+?(\d+)\s*pts?", w["special"], re.I)
        w["upgradePoints"] = int(cost.group(1)) if (cost and w["box"] == "upgrade") else None
        # An orange box means "restricted to the Variant named in brackets"
        # (rulebook 3.2.2). A few cards print orange with NO bracket -- the
        # Bioficer Surge Gunship's Decon Pulse. That is a source-data quirk,
        # not a parse failure. Record it and fall back to all-variants, which
        # is what a player reading the card would do.
        w["boxUnresolved"] = bool(w["box"] == "variant" and not w["variants"])
    return weapons


# ------------------------------------------------------------- variants


def collect_variants(header, weapons, special):
    """
    The variant roster is the UNION of names in the points line, in weapon
    brackets and in the Special column. No single source is complete: the
    Greave has no unique weapon and exists only in Special.
    """
    names = []

    def add(n):
        n = re.sub(r"\s+", " ", n).strip(" ,/")
        # Brackets on a card carry more than variant names: "(All)" is a
        # qualifier, "(+10pts)" is an upgrade cost, "(Rare)" is a restriction.
        if not n or n in names:
            return
        if re.fullmatch(r"Rare|Unique|All|Any|None", n, re.I):
            return
        if re.fullmatch(r"\+?\s*\d+\s*pts?", n, re.I):
            return
        names.append(n)

    # Points-line names win: they are the authoritative spelling and the only
    # source that carries a cost.
    for n in header["variantPoints"]:
        add(n)
    priced = {norm_variant(n) for n in header["variantPoints"]}
    for w in weapons:
        for n in w["variants"]:
            if norm_variant(n) not in priced:
                add(n)
    for m in re.finditer(r"\(([^)]+)\)", special or ""):
        for n in split_variant_list(m.group(1)):
            if norm_variant(n) not in priced:
                add(n)

    if not names:
        return []
    by_norm = {norm_variant(k): v for k, v in header["variantPoints"].items()}
    return [
        {"name": n, "points": by_norm.get(norm_variant(n), header["points"])}
        for n in names
    ]


# --------------------------------------------------------------- art


def extract_art(page, doc, dest, name, max_px=1400, quality=90):
    """
    Save the unit photo as a transparent WebP.

    The card art is stored as an RGB image plus a separate soft mask (smask)
    holding the alpha, so a plain Pixmap(doc, xref) yields the photo with its
    cutout flattened away. Recombining the two gives a true transparent PNG-
    equivalent, which WebP then carries at a fraction of the size: the UCM Main
    Battle Tank is 6.4 MB as full-res PNG and 74 KB as q90 WebP.
    """
    if not dest:
        return None
    # Pick the PHOTOGRAPH, by colour richness.
    #
    # Ranking by drawn area picks the faction-logo watermark instead: on the PHR
    # Angelos Jetskimmer the logo is drawn 299x299pt against the miniature's
    # 231x155pt. 139 of 178 cards carry such a second image, so area ranking gets
    # most of the roster wrong. A miniature photo has thousands of distinct
    # colours; a flat logo has a handful.
    page_area = page.rect.get_area()
    cands = []
    for im in page.get_images(full=True):
        xref, smask, w, h = im[0], im[1], im[2], im[3]
        if w < 200 or h < 150:
            continue
        rects = page.get_image_rects(xref)
        if not rects:
            continue
        r = rects[0]
        if r.width < 100 or r.get_area() > page_area * 0.8:
            continue                      # page background / full-bleed furniture
        cands.append((xref, smask, r))
    if not cands:
        return None

    best, best_score = None, None
    for xref, smask, r in cands:
        try:
            probe = Image.open(io.BytesIO(doc.extract_image(xref)["image"])).convert("RGB")
            probe.thumbnail((64, 64), Image.NEAREST)
            richness = len(probe.getcolors(maxcolors=4096) or [])
        except Exception:                                # noqa: BLE001
            richness = 0
        score = (richness, r.get_area())
        if best_score is None or score > best_score:
            best, best_score = (xref, smask), score
    if best is None:
        return None

    xref, smask = best
    try:
        info = doc.extract_image(xref)
        img = Image.open(io.BytesIO(info["image"])).convert("RGB")
        if smask:
            m = doc.extract_image(smask)
            mask = Image.open(io.BytesIO(m["image"])).convert("L")
            if mask.size != img.size:
                mask = mask.resize(img.size, Image.LANCZOS)
            img.putalpha(mask)
            box = img.getbbox()          # trim fully transparent margins
            if box:
                img = img.crop(box)
        if max(img.size) > max_px:
            img.thumbnail((max_px, max_px), Image.LANCZOS)
    except Exception:                                    # noqa: BLE001
        return None

    os.makedirs(dest, exist_ok=True)
    path = os.path.join(dest, slug(name) + ".webp")
    img.save(path, "WEBP", quality=quality, method=6)
    return path.replace("\\", "/")


# --------------------------------------------------------------- driver


def parse_page(page, doc, art_dir):
    header = parse_header(page)
    if not header or not header["name"]:
        return None

    body = fitz.Rect(0, 200, page.rect.width, page.rect.height - 20)
    lines = line_group(words_in(page, body))

    utype, stats, special = parse_stat_table(page, lines)
    if utype is None:
        return None
    weapons = parse_weapons(page, lines)

    unit = {
        "id": slug(header["name"]),
        "name": header["name"],
        "category": header["category"],
        "squadMin": header["squadMin"],
        "squadMax": header["squadMax"],
        "points": header["points"],
        "pointsRaw": header.get("pointsRaw"),
        "rare": header["rare"],
        "unique": header["unique"],
        "type": utype,
        "stats": stats,
        "special": special,
        "variants": collect_variants(header, weapons, special),
        "transport": parse_transport(page),
        "weapons": weapons,
        "page": page.number + 1,
    }
    unit["auxiliaryTransport"] = bool(
        unit["transport"]["capacity"] and (unit["category"] or "") != "Transport"
    )
    # Reference-only profiles: no squad size, or a rule that bars selection.
    # Transports are the exception -- 3.2.4 says they "do not have a minimum or
    # maximum Squad size", so a missing squad size is normal for them and must
    # not hide them from the picker. Excluding them removed all 39 Transports
    # and with them the entire nested-Group half of the game.
    unit["selectable"] = not (
        (unit["squadMin"] is None and (unit["category"] or "") != "Transport")
        or (unit["category"] or "") == "Generated"
        or re.search(r"\bRemote Drone\b", special or "", re.I)
    )
    # The art PATH is derived from the unit name, never conditional on whether
    # extraction ran this time. Making it conditional meant a routine re-scan
    # without --art silently stripped the image from all 178 units, which is
    # invisible in the JSON and only shows up as a blank builder.
    unit["art"] = f"{ART_DIR}/{slug(header['name'])}.webp"
    if art_dir:
        extract_art(page, doc, art_dir, header["name"])
    return unit


def scan(pdf_path, faction_id, faction_name, art_dir):
    doc = fitz.open(pdf_path)
    units, skipped = [], []
    for page in doc:
        try:
            u = parse_page(page, doc, art_dir)
        except Exception as exc:                     # noqa: BLE001
            skipped.append((page.number + 1, f"error: {exc}"))
            continue
        if u:
            units.append(u)
        elif "Squad Size" in page.get_text():
            skipped.append((page.number + 1, "has Squad Size but did not parse"))
    ver = re.search(r"_(\d{6})\.pdf$", os.path.basename(pdf_path))
    return {
        "faction": faction_id,
        "name": faction_name,
        "sourcePdf": os.path.basename(pdf_path),
        "version": ver.group(1) if ver else None,
        "units": units,
    }, skipped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf-dir", default=".")
    ap.add_argument("--out", default="data")
    ap.add_argument("--art", default=None, help="extract unit photos into this dir")
    ap.add_argument("--faction", default=None, help="limit to one faction")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    grand = 0
    for fname, fid in FACTIONS.items():
        if args.faction and args.faction.lower() != fid:
            continue
        matches = [
            f for f in os.listdir(args.pdf_dir)
            if f.startswith(f"DZC_{fname}_Stat") and f.endswith(".pdf")
        ]
        if not matches:
            print(f"  !! no PDF for {fname}")
            continue
        path = os.path.join(args.pdf_dir, sorted(matches)[-1])
        data, skipped = scan(path, fid, fname, args.art)
        out = os.path.join(args.out, f"faction-{fid}.json")
        with open(out, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
        grand += len(data["units"])
        print(f"  {fname:11s} {len(data['units']):3d} units -> {out}")
        for pg, why in skipped:
            print(f"      skipped p{pg}: {why}")
    print(f"\n  {grand} units total")


if __name__ == "__main__":
    main()
