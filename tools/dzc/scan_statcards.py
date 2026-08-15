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
import glob
import io
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict
from typing import TypedDict

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
# A Behemoth is a Vehicle card with a Power column. Power is what it spends to
# activate and to run its Gear (Behemoth rules 1.2), so it belongs in stats.
STAT_HEADERS_BEHEMOTH = ["Type", "Mv", "A", "DP", "Power", "Special"]
WEAPON_HEADERS = ["Name", "Arc", "MA", "R", "Att", "Ac", "E", "Special"]


# The records this scanner emits, written down.
#
# They were plain dicts, which meant the only statement of what a unit IS lived
# in the JavaScript that reads them -- and a key renamed here went unnoticed
# until the builder drew a blank card. Pyright checks the two ends against each
# other now: an emitted key nothing declares is an error at the point it is
# written, not a bug reported by a player.


class Badge(TypedDict):
    """One transport symbol: the shape, and the digit printed inside it."""

    shape: str
    n: int


class Transport(TypedDict):
    """Room offered (hollow badges) and room taken (solid ones)."""

    capacity: list[Badge]
    capacityMode: str | None
    fills: list[Badge]


class Weapon(TypedDict):
    name: str
    arc: str | None
    ma: str | None
    r: str | None
    att: str | None
    ac: str | None
    e: str | None
    special: str
    box: str | None
    variants: list[str]
    upgradePoints: int | None
    exclusive: bool
    capacityDelta: list[Badge]
    boxUnresolved: bool


class Variant(TypedDict):
    name: str
    points: int | None


class SpecialVariant(TypedDict):
    """One special rule and the Variants it is restricted to (3.2.2)."""
    rule: str
    variants: list[str]


class Header(TypedDict):
    """The top banner: what the card calls this unit and what it costs."""

    name: str
    category: str | None
    squadMin: int | None
    squadMax: int | None
    points: int | None
    variantPoints: dict[str, int]
    rare: bool
    unique: bool
    pointsRaw: str | None
    groupEquivalent: int | None


class Gear(TypedDict):
    """A Behemoth's Power-priced equipment: "3PT: Redundancy".

    Priced in POWER, not points — it comes out of the same pool the Behemoth
    spends to activate, so it costs nothing at list-building time and
    everything during a game."""

    name: str
    power: str


class Swap(TypedDict):
    """A swap sentence printed under the table, as arithmetic.

    `note` is kept alongside because the card is the authority and this parse
    is not -- the reader sees the sentence whatever the structure says."""

    note: str
    grants: str | None
    grantsRules: list[str]
    variants: list[str]
    removes: list[dict[str, object]]
    removesCapacity: list[Badge]


class Unit(TypedDict):
    id: str
    name: str
    # Only the Behemoths carry this. A faction card's unit takes its faction
    # from the file it is in.
    faction: str | None
    category: str | None
    squadMin: int | None
    squadMax: int | None
    points: int | None
    pointsRaw: str | None
    rare: bool
    unique: bool
    type: str | None
    base: str | None
    stats: dict[str, str]
    special: str | None
    variants: list[Variant]
    # Rules the card restricts to named Variants (3.2.2): "Scanner (Greave)".
    specialVariants: list[SpecialVariant]
    transport: Transport
    weapons: list[Weapon]
    upgradeNote: str | None
    swaps: list[Swap]
    # Behemoths only: how many Groups this one Unit counts as (1.1), and the
    # Power-priced Gear it may run. Everything else leaves them null / empty.
    groupEquivalent: int | None
    gear: list[Gear]
    page: int
    auxiliaryTransport: bool
    selectable: bool
    art: str


class FactionFile(TypedDict):
    faction: str
    name: str
    sourcePdf: str
    version: str | None
    units: list[Unit]


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def pdf_stamp(name):
    """The YYMMDD TTCombat date-stamp a stat-card file carries, or ''."""
    m = re.search(r"_(\d{6})\.pdf$", name)
    return m.group(1) if m else ""


# Hyphen-like break glyphs only. A broad [^\w\s] also matches the comma in
# "(Surge 1, 2, and 3)" and welds it into "2and", losing a variant.
#
# The class deliberately holds the LOOK-ALIKES as well as the ASCII hyphen --
# U+2010 HYPHEN, the en and em dashes, the soft hyphen. That is the whole job:
# the PDF sets its line breaks with them and a scanner that only knew "-" would
# leave every wrapped weapon name broken. noqa RUF001 for exactly that reason.
HYPHENISH = r"(\w)[-­‐-―�]"  # noqa: RUF001


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


def special_variant_map(special, variants):
    """
    Which special rules belong to only some Variants.

    Rulebook 3.2.2: "Special rules which only apply to certain Variants will be
    indicated in brackets after the rule." So "Scanner (Greave)" is the Greave's
    rule and nobody else's, and a Sabre printing it is the card being read
    wrongly.

    The bracket alone does not decide it. A Special column is full of brackets
    that are not variants -- "Infiltrate 10" (All)" is a qualifier, "(+10pts)"
    is a cost, and a rule may simply carry a parenthetical. The test is whether
    EVERY name inside resolves to a Variant this unit actually has, which is
    the same test collect_variants applies when building the roster.

    Returns [{"rule": <text as printed, without the bracket>,
              "variants": [<canonical names>]}].
    """
    out = []
    if not special or not variants:
        return out
    canon = {norm_variant(v["name"]): v["name"] for v in variants}
    for m in re.finditer(r"\(([^)]+)\)", special):
        names = split_variant_list(m.group(1))
        if not names or not all(norm_variant(n) in canon for n in names):
            continue
        # The rule is everything back to the previous comma. Rules that span a
        # comma -- "Ineffective: Friendlies, Zones" -- keep only their tail
        # here, which is why the renderer matches on "ends with" rather than on
        # equality: the tail is unique within one card either way.
        head = special[: m.start()]
        cut = head.rfind(",")
        text = head[cut + 1:].strip()
        if not text:
            continue
        out.append({
            "rule": text,
            "variants": [canon[norm_variant(n)] for n in names],
        })
    return out


def colour_name(rgb):
    """Nearest semantic name for a weapon name-box fill."""
    if rgb is None:
        return None
    best, bestd = None, 1e9
    for name, ref in BOX_COLOURS.items():
        d = sum((a - b) ** 2 for a, b in zip(rgb, ref, strict=True))
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


def parse_header(page) -> Header | None:
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
    # "Heavy, Group Equivalent 4". A Behemoth has no Squad Size worth the name
    # -- it is always one model -- and counts as several Groups instead, which
    # is what the army's Group allowance is spent against (Behemoth rules 1.1).
    ge = re.search(r"Groups?\s*Equivalent\s*(\d+)", (ltxt or "") + " " + (rtxt or ""), re.I)
    m2 = re.search(r"(Standard|Vanguard|Heavy|Support|Transport|Generated)", cat or "", re.I)
    cat = m2.group(1).title() if m2 else cat

    flat, per, rare, unique = parse_points(ptxt or rtxt)
    header: Header = {
        "name": name,
        "category": cat,
        "squadMin": smin,
        "squadMax": smax,
        "points": flat,
        "variantPoints": per,
        "rare": rare,
        "unique": unique,
        "pointsRaw": ptxt,
        "groupEquivalent": int(ge.group(1)) if ge else None,
    }
    return header


# ------------------------------------------------------- transport symbols


def _hull(points):
    """Convex hull (monotone chain). Returns hull vertices in order."""
    pts = sorted({(round(p[0], 1), round(p[1], 1)) for p in points})
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
        d = sum((a - b) ** 2 for a, b in zip(rgb, ref, strict=True))
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
        # Upright and inverted triangles are the SAME convex hull, so this is
        # decided by which side the lone vertex sits on -- then checked against
        # the ink below.
        if shape == "triangle" and triangle_points_down(_corner_points(_hull(pts))):
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


def parse_transport(page) -> Transport:
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
        return {"capacity": [], "capacityMode": None, "fills": []}
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
    """The header row's index and words, or None. One value, not two: returning
    (None, None) left every caller holding an index the checker could not tell
    was safe even after it had tested the row."""
    for i, ln in enumerate(lines):
        got = {w[4] for w in ln}
        if sum(1 for h in headers if h in got) >= need:
            return i, ln
    return None


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


def column_bounds(cols, rules=None):
    """The x edge between each adjacent pair of columns."""
    if rules:
        # Keep only rules that actually separate two adjacent header centres.
        bounds = []
        for i in range(len(cols) - 1):
            lo, hi = cols[i][1], cols[i + 1][1]
            between = [x for x in rules if lo < x < hi]
            bounds.append(between[len(between) // 2] if between else (lo + hi) / 2)
        return bounds
    return [(cols[i][1] + cols[i + 1][1]) / 2 for i in range(len(cols) - 1)]


def split_row(line, cols, rules=None):
    """
    Assign each word to a column by boundary, not by nearest centre.

    Nearest-centre breaks on wide left columns: in "UM-105 Missile Launcher"
    the word "Launcher" sits right of the Name header's centre and gets pulled
    into Arc. Midpoint boundaries between adjacent headers keep it in Name.
    """
    if not cols:
        return {}
    bounds = column_bounds(cols, rules)
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


# The Type cell, which is the word and — since the 260805 release — the model's
# base size in brackets: "Aircraft (40mm)". Only Aircraft carry one, in 20, 30
# and 40mm.
#
# This is what a bare `row["Type"] in ("Vehicle", "Aircraft", "Infantry")` cost:
# every Aircraft card in the game stopped parsing the day TTCombat added it, so
# UCM came back with 20 units instead of 36 and no dropships at all. The audit
# caught it on the two the rulebook names, which is the only reason it was not
# shipped. Match the word, keep the bracket.
TYPE_RE = re.compile(r"^(Vehicle|Aircraft|Infantry|Behemoth)(?:\s*\(([^)]*)\))?$", re.I)


def parse_stat_table(page, lines) -> tuple[str, str | None, dict[str, str], str, float] | None:
    """Type, base size, stats, Special, and the y this table ends at — or None.

    One value rather than a tuple of Nones, for the same reason as
    find_header_row: a caller that tested only the first still held the rest,
    which the checker could not vouch for.

    The bottom is returned for the cards with no weapon table at all. The
    footnote reader needs a floor to start below, and on those cards the stat
    table is the only thing to measure from."""
    # Behemoth first: its header is the Vehicle one plus Power, so testing
    # Vehicle first would match four of its five names and lose the Power
    # column off the end.
    headers = STAT_HEADERS_BEHEMOTH
    hit = find_header_row(lines, headers, need=6)
    if hit is None:
        headers = STAT_HEADERS_INFANTRY
        hit = find_header_row(lines, headers, need=5)
    if hit is None:
        headers = STAT_HEADERS_VEHICLE
        hit = find_header_row(lines, headers, need=4)
    if hit is None:
        return None
    i, hdr = hit

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
    for k, ln in enumerate(lines[i + 1:i + 4], start=i + 1):
        row = split_row(ln, cols, rules)
        m = TYPE_RE.match((row.get("Type") or "").strip())
        if m:
            row.pop("Type")
            row.pop("Special", None)
            special, bottom = read_special_cell(lines, i, k, cols, rules)
            return (m.group(1), m.group(2) or None,
                    {k2: v for k2, v in row.items() if v},
                    join_broken_hyphen(special.strip(" -")),
                    max(float(max(w[3] for w in ln)), bottom))
    return None


def read_special_cell(lines, header_i, type_k, cols, rules):
    """The whole Special cell, however many lines it wraps to.

    The stat row is one line; the Special cell beside it is not. It is
    vertically centred against that row, so a two-line rule list straddles it —
    one line above the Type word, one below. Reading Special off the Type line
    alone dropped the Siren Corps' entire rule list on the floor: everything up
    to "Rapid Insertion" sits 4pt higher than "Infantry", and only the trailing
    "6”" shares its line group.

    So the cell is read as a cell: every word right of the last column edge,
    between the header and the last line the cell reaches, in reading order.
    Returns the text and the y it bottoms out at, which is the floor the
    footnote reader starts below on cards with no weapon table.
    """
    bounds = column_bounds(cols, rules)
    if not bounds:
        return "", 0.0
    edge = bounds[-1]
    row = lines[type_k]
    top, bot = min(w[1] for w in row), max(w[3] for w in row)
    lh = bot - top
    out, bottom = [], 0.0
    # One line either side, and only if it sits within a line height of the
    # stat row. Index alone is not enough: on a card WITH a weapon table the
    # next line is that table's header, whose own "Special" also falls right
    # of this edge.
    for ln in lines[max(header_i + 1, type_k - 1):type_k + 2]:
        if min(w[1] for w in ln) > bot + lh or max(w[3] for w in ln) < top - lh:
            continue
        words = [w for w in ln if (w[0] + w[2]) / 2 > edge]
        if not words:
            continue
        out.append(" ".join(w[4] for w in sorted(words, key=lambda w: w[0])))
        bottom = max(bottom, max(w[3] for w in words))
    return " ".join(out).strip(), bottom


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


def lore_top(page, below_y, left_edge=None):
    """
    Y where the tables stop and everything else begins, or None.

    Two things sit below a card's tables and must not be read as table data:

      - flavour text, set in an OBLIQUE face (nothing else on a card is italic)
      - an upgrade FOOTNOTE tied to a "(+15pts*)" marker, e.g.
        "*Only one of these upgrades may be taken."

    The last weapon's band otherwise runs to the bottom-most word on the page
    and swallows both. That gave the Bioficer Drones a weapon named "Decon
    Rifles Drones are standard Bioficer infantry...", and put "be taken." in
    the Arc column of eight upgrade weapons.

    A footnote is recognised by POSITION -- it begins at the card's left
    margin, outside the table's leftmost column. An asterisk is the usual
    marker but not a reliable one: the Harrier Gunship's reads "May remove one
    UM-117 Cannons and gain Scanner and Scout" with no asterisk at all. Its
    first word falls outside the table rect and is dropped, while "and gain"
    lands squarely in the Arc column -- which is exactly how a footnote ends up
    looking like a firing arc.
    """
    ys = []
    for blk in page.get_text("dict")["blocks"]:
        for ln in blk.get("lines", []):
            for sp in ln["spans"]:
                t = sp["text"].strip()
                if not t or sp["bbox"][1] <= below_y:
                    continue
                if ((sp["flags"] & ITALIC_FLAG) or t.startswith("*")
                        or (left_edge is not None and sp["bbox"][0] < left_edge)):
                    ys.append(sp["bbox"][1])
    return min(ys) if ys else None


def upgrade_note(page, below_y, left_edge=None):
    """
    The "*..." footnote printed under the tables, kept because it IS a rule.

    "Only one of these upgrades may be taken" constrains army construction, so
    dropping it along with the table boundary would lose real information.

    A footnote is a LINE, not a run of spans that happen to start with "*".
    Reading it span by span cost both ends of it:

      - the Strikehawk and Carryhawk footnote is three spans on one line --
        "*May replace transport capacity of", a transport symbol set in the
        display face, then "with MM-3 Missile Boxes or MC-30 Heavy Gatlings."
        Only the first survived a test for a leading "*", so both cards
        recorded "May replace transport capacity of" and stopped there.
      - a card with no footnote at all handed back its flavour text, because
        that starts at the same left margin. Drones and Hulks each carried a
        paragraph of lore in this field.

    So: a line whose FIRST span sits in the left margin below the tables, and
    is not italic. Italic is how lore_top already tells prose from data, and it
    is a property of the type rather than of whatever the foundry called the
    face. Every span on that line is then taken, symbol included -- a footnote
    reading "capacity of 2" is the count off the symbol without its shape,
    which is less than the card prints but is the whole sentence.
    """
    out = []
    for blk in page.get_text("dict")["blocks"]:
        for ln in blk.get("lines", []):
            spans = [sp for sp in ln["spans"] if sp["text"].strip()]
            if not spans:
                continue
            first = spans[0]
            if first["bbox"][1] <= below_y:
                continue
            if left_edge is not None and first["bbox"][0] >= left_edge:
                continue
            if first["flags"] & ITALIC_FLAG:
                continue
            line = " ".join(sp["text"].strip() for sp in spans)
            out.append(line.lstrip("*").strip())
    return " ".join(out).strip() or None


# The bracket on a weapon name that is a PRICE rather than a variant:
# "RM-7 Skyhammer Missiles (+15pts*)".
#
# THE ASTERISK IS CAPTURED, because it is the scope of the footnote under it
# and not decoration. Both Tritons print three upgrades and one note:
#
#     RM-1 Stealth Missile Battery (+10pts)
#     Twin RX-20 Miniguns (+5pts*)
#     RM-7 Skyhammer Missiles (+15pts*)
#     *Only one of these upgrades may be taken.
#
# "These" is the starred pair. The RM-1 carries no star, so it combines with
# either of them; what you may not do is take the Miniguns AND the Skyhammers.
# This pattern used to match the star and throw it away, which left the app
# applying "only one" to all three and refusing a legal loadout. Reported by
# Jet, 2026-08-10: "With the Triton you can take the RM-1 with the RX-20 or the
# RM-7. Just not the RX-20 with the RM-7."
COST_RE = re.compile(r"^\+?(\d+)\s*pts?(\*?)$", re.I)

# "*May replace transport capacity of 2 with MM-3 Missile Boxes or MC-30 Heavy
# Gatlings." Two cards in the game, both Resistance tilt-rotors.
CAPACITY_SWAP_RE = re.compile(
    r"replace\s+transport\s+capacity\s+of\s+(\d+)\s+with\s+(.+?)\s*\.?\s*$", re.I)


def apply_capacity_upgrades(unit: Unit) -> None:
    """
    Turn the capacity footnote into arithmetic on the weapons it names.

    This is the only sentence on any card where buying a weapon costs you room,
    and until it was parsed it was a note nobody read: the builder would load
    two circles into a Strikehawk that had already sold them for missiles, and
    call the army legal.

    The footnote loses its shape symbol on the way out of the PDF -- see
    upgrade_note, where the symbol is set in the display face and comes through
    as the count alone -- so "capacity of 2" is all there is to go on. That is
    enough when exactly ONE of the unit's capacity badges reads 2, which is the
    case on both cards: a circle 2 beside a square 4, and a circle 2 beside a
    triangle 3.

    When it is not enough, nothing is attached and audit_transport fails on the
    note with no arithmetic behind it. A guess here would be a wrong army the
    builder calls legal, which is the exact failure this exists to stop.
    """
    m = CAPACITY_SWAP_RE.search(unit.get("upgradeNote") or "")
    if not m:
        return
    n = int(m.group(1))
    hits = [c for c in unit["transport"].get("capacity") or [] if c["n"] == n]
    if len(hits) != 1:
        return
    names = {x.strip(" .") for x in re.split(r"\bor\b|,", m.group(2)) if x.strip(" .")}
    for w in unit["weapons"]:
        if w["box"] == "upgrade" and w["name"] in names:
            w["capacityDelta"] = [{"shape": hits[0]["shape"], "n": -n}]


# "May replace both its MC-20 Chainguns with MM-15 Sidearm Missiles."
# "Menchit and Styx may replace Twin RX-20 Miniguns with RM-4 Foeslayer Missiles."
# "May also replace one MM-3 Missile Pod and one MG-6 Twin Heavy Machineguns
#  with a MC-20 Chaingun Pair."
SWAP_RE = re.compile(
    r"^(?P<who>.*?)\bmay\s+(?:also\s+)?replace\b(?P<lose>.+?)\bwith\b(?P<gain>.+?)\.?\s*$",
    re.I)

# "May remove one UM-117 Cannons and gain Scanner and Scout." -- one card, and
# the only option that trades a weapon for rules rather than for another gun.
GIVE_UP_RE = re.compile(
    r"^(?P<who>.*?)\bmay\s+remove\b(?P<lose>.+?)\band\s+gain\b(?P<gain>.+?)\.?\s*$", re.I)

# "both its MC-20 Chainguns", "one MM-3 Missile Pod", "Twin RX-20 Miniguns"
LOSE_RE = re.compile(
    r"^\s*(?:(both|one|two|three|\d+)\s+)?(?:its\s+|the\s+|an?\s+)?(?P<name>.+?)\s*$", re.I)
COUNT_WORDS = {"one": 1, "two": 2, "three": 3}


def norm_weapon(name: str) -> str:
    """A weapon name as the sentence writes it, reduced to what the table says.

    A card's prose pluralises what its table lists singular -- "both its MC-20
    Chainguns" against two rows each reading "MC-20 Chaingun" -- and that is the
    only difference between the two spellings on any current card."""
    return re.sub(r"\s+", " ", name).strip().rstrip(".").lower().rstrip("s")


def reconcile_variant_names(unit: Unit) -> None:
    """Make a weapon's variant bracket name a variant the unit actually has.

    A card can print the same variant two different ways, and two do:

      ATVs         price line "25pts (Recon ATVs)", weapon "(Recon ATV)"
      Archangel    price line "(Archangel Fighter-Bomber)", weapon bracket
                   wrapped mid-word so it scans as "Archangel Fighter- Bomber"

    Neither is a scanner fault, both are on the card. But weaponLive matches a
    weapon's variant list against the models a Squad actually fields, by exact
    name, so a bracket naming "Recon ATV" against a variant called "Recon ATVs"
    matches nothing. The result was a Squad whose every gun was marked dead:
    BOTH ATV variants and the Archangel Fighter-Bomber rendered with no weapons
    at all, in the builder and on the printed sheet.

    Matched on a squashed key, so a trailing s and the space a line-wrap leaves
    after a hyphen both stop mattering. Rewritten only when exactly one variant
    matches: an ambiguous bracket is left alone and audit_data will say so,
    because a gun quietly assigned to the wrong loadout is worse than one
    flagged as unassigned.
    """
    variants = [v["name"] for v in unit.get("variants") or []]
    if not variants:
        return

    # A soft hyphen (U+00AD) is what the typesetter breaks a word on, and a
    # non-breaking hyphen (U+2011) is what it uses where it must NOT break, so
    # both turn up inside a name the PDF has wrapped. Written as escapes rather
    # than pasted, because neither is distinguishable from an ASCII hyphen in a
    # diff and both are why this function exists.
    nb_hyphen = "‑"    # noqa: RUF001 - U+2011, where a name must NOT wrap
    soft_hyphen = "­"  # U+00AD, the break the typesetter inserted when it did

    def key(s: str) -> str:
        s = (s or "").lower().replace(nb_hyphen, "-").replace(soft_hyphen, "")
        return re.sub(r"\s+", "", s).rstrip("s")

    by_key: dict[str, list[str]] = {}
    for v in variants:
        by_key.setdefault(key(v), []).append(v)

    for w in unit["weapons"]:
        fixed = []
        for got in w["variants"]:
            if got in variants:
                fixed.append(got)
                continue
            hit = by_key.get(key(got), [])
            fixed.append(hit[0] if len(hit) == 1 else got)
        w["variants"] = fixed


def parse_swaps(unit: Unit) -> None:
    """
    Read the swap sentence into what it removes and what it grants.

    Five cards print one. Three of them take a weapon AWAY, and until this
    existed the app granted the new gun and kept the old one -- so a Super Heavy
    Tank that had traded both its MC-20 Chainguns for Sidearm Missiles went to
    the table with all three printed on its sheet.

    Every weapon a sentence names is matched against the card's own weapon table
    first. A sentence this does not really understand yields nothing, because an
    invented removal is worse than a note the reader has to apply themselves --
    and the note is shown either way, since the card is the authority and this
    parse is not.
    """
    note = unit.get("upgradeNote") or ""
    rules_only = False
    m = SWAP_RE.match(note)
    if not m:
        m = GIVE_UP_RE.match(note)
        rules_only = True
    if not m:
        return
    by_norm: dict[str, list[str]] = {}
    for w in unit["weapons"]:
        by_norm.setdefault(norm_weapon(w["name"]), []).append(w["name"])

    # What it grants: one swap per gun offered, since "A or B" is a choice.
    # The article belongs to the sentence, not to the weapon -- "with A MC-20
    # Chaingun Pair" names the gun the table calls "MC-20 Chaingun Pair".
    rules: list[str] = []
    gains: list[str | None]
    if rules_only:
        rules = [g.strip(" .") for g in re.split(r",|\band\b", m.group("gain"))
                 if g.strip(" .")]
        if not rules:
            return
        gains = [None]
    else:
        gains = [re.sub(r"^(?:an?|the)\s+", "", g.strip(" ."), flags=re.I)
                 for g in re.split(r"\bor\b", m.group("gain")) if g.strip(" .")]
        gains = [g for g in gains
                 if any(w["box"] == "upgrade" and w["name"] == g for w in unit["weapons"])]
        if not gains:
            return

    # Which variants may take it, when the sentence names them.
    who = m.group("who") or ""
    known = {v["name"] for v in unit["variants"]}
    variants = [n for n in re.split(r",|\band\b", who) if n.strip() in known]
    variants = [n.strip() for n in variants]

    removes: list[dict[str, object]] = []
    capacity: list[Badge] = []
    for piece in re.split(r"\band\b", m.group("lose")):
        piece = piece.strip()
        if not piece:
            continue
        cap = re.match(r"^(?:transport\s+)?capacity\s+of\s+(\d+)$", piece, re.I)
        if cap:
            n = int(cap.group(1))
            hits = [c for c in unit["transport"].get("capacity") or [] if c["n"] == n]
            if len(hits) != 1:
                return                       # ambiguous shape; say nothing
            capacity.append({"shape": hits[0]["shape"], "n": n})
            continue
        lm = LOSE_RE.match(piece)
        if not lm:
            return
        hit = by_norm.get(norm_weapon(lm.group("name")))
        if not hit:
            return                           # a name the table does not carry
        word = (lm.group(1) or "").lower()
        # "both" means every copy the card prints; a bare name means the same,
        # since a sentence that meant one of two would have to say which.
        n_taken = COUNT_WORDS.get(word) or (int(word) if word.isdigit() else len(hit))
        removes.append({"weapon": hit[0], "count": n_taken})

    if not removes and not capacity:
        return
    unit["swaps"] = [
        {
            "note": note,
            "grants": g,
            "grantsRules": rules,
            "variants": variants,
            "removes": removes,
            "removesCapacity": capacity,
        }
        for g in gains
    ]

    # The restriction belongs on the GUN as well as on the swap.
    #
    # "Menchit and Styx may replace Twin RX-20 Miniguns with RM-4 Foeslayer
    # Missiles" was read into the swap and nowhere else, so the Foeslayer sat
    # in the weapon table with an empty variants list -- which the app reads as
    # "every variant". removedByUpgrades honoured the sentence and refused to
    # take an Ares' miniguns away, but upgradesFor scoped the purchase to ALL
    # and the buy button appeared under Ares and Phobos too: 5pts for a gun the
    # card does not offer them, with nothing given up for it. Reported by a
    # player, 2026-08-09: "The Foeslayer should be Menchit and Styx only."
    #
    # A swap that names nobody restricts nobody, and that is the common case --
    # 29 of the 30 upgrade weapons in the data are open to the whole Unit.
    if variants:
        for w in unit["weapons"]:
            if w["box"] == "upgrade" and w["name"] in gains and not w["variants"]:
                w["variants"] = list(variants)


# "3PT: Redundancy", "1+PT: Shield Booster", "0PT: Scrambler 2+". Only Behemoth
# cards carry these.
GEAR_RE = re.compile(r"^\s*(\d+\+?)\s*PT\s*:\s*(.+?)\s*$", re.I)


def gear_top(page, below_y):
    """Y of the "Gear" heading on a Behemoth card, or None.

    The weapon table otherwise runs straight into the Gear list underneath it,
    because lore_top only knows how to stop at italic flavour text and a
    footnote, and "Gear" is neither. The Type 6 Grand Walker came out with a
    weapon whose Special read "Demo 0 2PT: Director 2: 4 Venus Drones
    (Porphyrion)" -- one gun's rule welded to another card element entirely."""
    best = None
    for blk in page.get_text("dict")["blocks"]:
        for ln in blk.get("lines", []):
            text = " ".join(sp["text"] for sp in ln["spans"]).strip()
            y = ln["bbox"][1]
            if text.lower() == "gear" and y > below_y and (best is None or y < best):
                best = y
    return best


def parse_gear(page) -> list[Gear]:
    """A Behemoth's Power-priced Gear, off the card's Gear list.

    Read as whole LINES rather than by position: the list is set in one column
    on some cards and two on others, and the "NPT:" prefix is unambiguous
    enough that geometry buys nothing. A card with no Gear yields nothing,
    which is every card in the six faction PDFs."""
    out: list[Gear] = []
    for blk in page.get_text("dict")["blocks"]:
        for ln in blk.get("lines", []):
            text = " ".join(sp["text"] for sp in ln["spans"]).strip()
            m = GEAR_RE.match(text)
            if m:
                out.append({"power": m.group(1), "name": m.group(2)})
    return out


# A Special line that is WRONG ON THE CARD, keyed by Unit name, with what it
# should have said.
#
# Not a typo table -- fix_typos already handles a misspelt word. This is for a
# line TTCombat printed in an order that does not parse, where no amount of
# geometry helps because the geometry is faithfully reproducing a mistake.
#
# The bar for an entry: every token the card prints survives, nothing is
# invented, and the result is one legal reading. Anything short of that stays
# broken and stays visible, because a card defect quietly patched into
# something plausible is worse than one a player can see and argue about.
KNOWN_PRINTED_SPECIAL = {
    # Shaltari Totem Shieldspire, p.14, prints:
    #     "Friendly Vehicles and Aircraft 6” 5+, P5+, Shield: Zones"
    # The Shield rule is "Shield: X Y” Z+" (10.1.28) -- a target list, a radius
    # and a save. Every one of those is on the card; the "Shield:" prefix and
    # its target list have simply been split off the numbers and moved to the
    # end. The Support Warstrider two cards earlier prints the same rule whole:
    #     "Shield: Friendly Vehicles 6” 4+ (Dreamsnare)"
    # Reassembled, so X is "Zones, Friendly Vehicles and Aircraft", Y is 6 and
    # Z is 5. Nothing added, nothing dropped, one rule instead of two orphans.
    "Totem Shieldspire":
        "Shield: Zones, Friendly Vehicles and Aircraft 6” 5+, P5+",
}


def fix_printed_special(unit_name, special):
    return KNOWN_PRINTED_SPECIAL.get((unit_name or "").strip(), special)


def parse_weapons(page, lines) -> tuple[list[Weapon], float]:
    """The weapon rows, and the y the table ends at.

    The bottom is returned because it is where the FOOTNOTE begins, and
    upgrade_note had been given a fixed y=200 instead. That held only as
    long as nothing else on the card reached the left margin: the 260805
    release widened the Type cell from "Aircraft" to "Aircraft (40mm)",
    which is centred, so it now starts at x=16.6 -- inside the margin the
    footnote reader was watching. Fifty units came back with an
    upgradeNote reading "Aircraft (40mm)"."""
    hit = find_header_row(lines, WEAPON_HEADERS, need=5)
    if hit is None:
        # No weapon table at all, so there is nothing under it either. 200 is
        # the old fixed floor, kept for this one case: it is below the header
        # banner and above anything a card without weapons prints.
        return [], 200.0
    _, hdr = hit
    cols = columns_from_header(hdr, WEAPON_HEADERS)

    boxes = weapon_swatches(page)

    # Rows are anchored on the name-box swatches, one per weapon, NOT on text
    # lines. A weapon whose name wraps ("UM-100 Avenger Railgun" / "(Sabre)")
    # spans two lines while its stats sit on only one, so line-walking
    # mis-pairs names with the wrong stats.
    boxes.sort(key=lambda b: b[0].y0)
    # ONE BOX PER ROW. The same swatch image is placed several times across a
    # row -- the UCM Main Battle Tank's card returns seventeen rects for five
    # weapons, four of them stacked at each of four y positions. Nothing
    # downstream wants the copies: a row is a y, and the extras only ever made
    # the row list disagree with the weapon list.
    #
    # They used to be neutralised by accident. The old band ran from one box's
    # top to the NEXT box's top, so two boxes at the same y produced an empty
    # band that was skipped -- which held exactly as long as the band was
    # anchored on that edge, and the moment it was not, every duplicate became
    # a weapon with no name. Deduped here, where it is a fact about the source
    # rather than a side effect of arithmetic somewhere else.
    merged = []
    for rect, kind in boxes:
        if merged and abs(rect.y0 - merged[-1][0].y0) < 1.0:
            merged[-1][0].y1 = max(merged[-1][0].y1, rect.y1)
            continue
        merged.append([fitz.Rect(rect), kind])
    boxes = [(fitz.Rect(r), k) for r, k in merged]
    hdr_bottom = max(w[3] for w in hdr)
    xs = [c[1] for c in cols]
    tbl = fitz.Rect(min(xs) - 40, hdr_bottom, max(xs) + 60, page.rect.height)
    # Stop at the flavour text. Everything below it is prose, not table data.
    # Whichever comes first: the flavour text, the footnote, or a Behemoth's
    # Gear list. All three sit below the table and none of them is table data.
    stops = [y for y in (lore_top(page, hdr_bottom, tbl.x0), gear_top(page, hdr_bottom))
             if y is not None]
    lore_y = min(stops) if stops else None
    if lore_y is not None:
        tbl.y1 = min(tbl.y1, lore_y)
    below = [w for w in words_in(page, tbl) if w[1] > hdr_bottom
             and (lore_y is None or w[3] <= lore_y + 1)]
    if not boxes or not below:
        return [], float(hdr_bottom)
    last_y = max(w[3] for w in below) + 2
    rules = sorted(set(vertical_rules(page, hdr_bottom, last_y)) | set(doc_rules(page.parent)))

    weapons = []
    # Where one row ENDS and the next begins: the middle of the empty band
    # between two name swatches, not the next swatch's top edge.
    #
    # The name swatch is vertically CENTRED in its row, so its top edge is not
    # the row's top -- and the taller the Special cell, the further the two
    # drift apart. The old boundary was `next_swatch.y0 - 5`, which held while
    # every Special was about as tall as its name and broke the moment one was
    # not: the Behemoth Mining Engine prints a three-line Special against a
    # one-line name, and the Vent Repeater below it four. Measured on that
    # page, the boundary landed at y=325.6 with the Vent Repeater's first
    # Special line centred at y=324.2 -- so "Critical 1, Demo 2, Integral,"
    # was read onto the Mining Laser, which does not have any of them, and
    # taken off the Vent Repeater, which does.
    #
    # Between swatch N's BOTTOM and swatch N+1's TOP there is nothing but the
    # gap, whatever either cell's height. Its midpoint is the boundary. The
    # first row starts at the header rather than at its own swatch, for the
    # same reason: its Special can begin above it.
    for idx, (rect, kind) in enumerate(boxes):
        top = float(hdr_bottom) if idx == 0 else (boxes[idx - 1][0].y1 + rect.y0) / 2
        bot = (rect.y1 + boxes[idx + 1][0].y0) / 2 if idx + 1 < len(boxes) else last_y
        band = [w for w in below if top <= (w[1] + w[3]) / 2 < bot]
        if not band:
            continue
        cells = defaultdict(list)
        for ln in line_group(band):
            for k, v in split_row(ln, cols, rules).items():
                cells[k].append(v)
        joined = {k: " ".join(v).strip() for k, v in cells.items()}
        weapon: Weapon = {
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
            # Filled by the bracket pass below, and by apply_capacity_upgrades
            # once the unit's own capacity is known. Declared here so a weapon
            # is a whole record the moment it exists.
            "variants": [],
            "upgradePoints": None,
            "exclusive": False,
            "capacityDelta": [],
            "boxUnresolved": False,
        }
        weapons.append(weapon)

    # Pull the trailing brackets out of the name now that wraps are joined.
    #
    # A weapon can carry MORE THAN ONE, on separate lines of the Name cell, and
    # they do not mean the same thing:
    #
    #     UM-117 Cannons (Harrier B)      a VARIANT restriction (3.2.2)
    #     RM-7 Skyhammer Missiles (+15pts*)   the UPGRADE's cost (3.2.3)
    #
    # Taking only the last bracket and calling it a variant produced weapons
    # restricted to a variant named "+15pts*", and left upgradePoints null on
    # every upgrade in the game -- so a paid upgrade cost nothing. The audit
    # caught it as "variant '+5pts*' has no points".
    for w in weapons:
        while True:
            m = re.search(r"\(([^)]*)\)\s*$", w["name"])
            if not m:
                break
            inner = m.group(1).strip()
            w["name"] = w["name"][: m.start()].strip()
            cost = COST_RE.match(inner)
            if cost:
                w["upgradePoints"] = int(cost.group(1))
                # The star ties this upgrade to the card's footnote. See COST_RE.
                w["exclusive"] = bool(cost.group(2))
            elif inner:
                w["variants"] = [v.strip() for v in re.split(r"[,/]", inner) if v.strip()] \
                    + w["variants"]
        if w["upgradePoints"] is None:
            cost = re.search(r"\+?(\d+)\s*pts?", w["special"], re.I)
            if cost and w["box"] == "upgrade":
                w["upgradePoints"] = int(cost.group(1))
        # An orange box means "restricted to the Variant named in brackets"
        # (rulebook 3.2.2). A few cards print orange with NO bracket -- the
        # Bioficer Surge Gunship's Decon Pulse. That is a source-data quirk,
        # not a parse failure. Record it and fall back to all-variants, which
        # is what a player reading the card would do.
        w["boxUnresolved"] = bool(w["box"] == "variant" and not w["variants"])
    return weapons, float(last_y)


# ------------------------------------------------------------- variants


def collect_variants(header: Header, weapons: list[Weapon],
                     special: str | None) -> list[Variant]:
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
        Variant(name=n, points=by_norm.get(norm_variant(n), header["points"]))
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
            probe.thumbnail((64, 64), Image.Resampling.NEAREST)
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
                mask = mask.resize(img.size, Image.Resampling.LANCZOS)
            img.putalpha(mask)
            box = img.getbbox()          # trim fully transparent margins
            if box:
                img = img.crop(box)
        if max(img.size) > max_px:
            img.thumbnail((max_px, max_px), Image.Resampling.LANCZOS)
    except Exception:                                    # noqa: BLE001
        return None

    os.makedirs(dest, exist_ok=True)
    path = os.path.join(dest, slug(name) + ".webp")
    img.save(path, "WEBP", quality=quality, method=6)
    return path.replace("\\", "/")


# --------------------------------------------------------------- driver


def parse_page(page, doc, art_dir) -> Unit | None:
    header = parse_header(page)
    if not header or not header["name"]:
        return None

    body = fitz.Rect(0, 200, page.rect.width, page.rect.height - 20)
    lines = line_group(words_in(page, body))

    stat_table = parse_stat_table(page, lines)
    if stat_table is None:
        return None
    utype, base, stats, special, stats_bottom = stat_table
    special = fix_printed_special(header["name"], special)
    weapons, weapons_bottom = parse_weapons(page, lines)
    # Whichever table reaches further down is what the footnote sits below. A
    # card with no weapon table at all — the PHR Mercury Scout Drone — has only
    # the stat table, and measuring from a fixed y above it let its own Type
    # cell be read as the footnote.
    tables_bottom = max(weapons_bottom, stats_bottom)

    transport = parse_transport(page)
    category = header["category"]
    # Reference-only profiles: no squad size, or a rule that bars selection.
    # Transports are the exception -- 3.2.4 says they "do not have a minimum or
    # maximum Squad size", so a missing squad size is normal for them and must
    # not hide them from the picker. Excluding them removed all 39 Transports
    # and with them the entire nested-Group half of the game.
    selectable = not (
        (header["squadMin"] is None and (category or "") != "Transport")
        or (category or "") == "Generated"
        or re.search(r"\bRemote Drone\b", special or "", re.I)
    )

    variants = collect_variants(header, weapons, special)

    unit: Unit = {
        "id": slug(header["name"]),
        "faction": None,
        "name": header["name"],
        "category": header["category"],
        "squadMin": header["squadMin"],
        "squadMax": header["squadMax"],
        "points": header["points"],
        "pointsRaw": header.get("pointsRaw"),
        "rare": header["rare"],
        "unique": header["unique"],
        "type": utype,
        # The base a model stands on, from the Type cell: "Aircraft (40mm)".
        # New in the 260805 release, and only Aircraft print one.
        "base": base,
        "stats": stats,
        "special": special,
        "variants": variants,
        # Which of those rules are one Variant's and not the whole card's
        # (3.2.2). Parsed HERE rather than in the browser: 3f7b541 already
        # recorded that reading English at render time is the wrong answer.
        "specialVariants": special_variant_map(special, variants),
        "transport": transport,
        "weapons": weapons,
        # "*Only one of these upgrades may be taken." -- a real construction
        # constraint, so it is kept rather than discarded with the footnote.
        # Below the weapon TABLE, not below a fixed y=200 that the stat table
        # itself now reaches into.
        "upgradeNote": upgrade_note(page, tables_bottom, 20),
        "swaps": [],
        "groupEquivalent": header["groupEquivalent"],
        "gear": parse_gear(page),
        "page": (page.number or 0) + 1,
        "auxiliaryTransport": bool(transport["capacity"] and (category or "") != "Transport"),
        "selectable": selectable,
        # The art PATH is derived from the unit name, never conditional on
        # whether extraction ran this time. Making it conditional meant a
        # routine re-scan without --art silently stripped the image from all
        # 178 units, which is invisible in the JSON and only shows up as a
        # blank builder.
        "art": f"{ART_DIR}/{slug(header['name'])}.webp",
    }
    # Needs the weapons, the transport badges and the footnote all parsed, so
    # it runs on the assembled unit rather than inside any one of them.
    apply_capacity_upgrades(unit)
    reconcile_variant_names(unit)
    parse_swaps(unit)
    if art_dir:
        extract_art(page, doc, art_dir, header["name"])
    return unit


def scan(pdf_path, faction_id, faction_name,
         art_dir) -> tuple[FactionFile, list[tuple[int, str]]]:
    doc = fitz.open(pdf_path)
    units: list[Unit] = []
    skipped: list[tuple[int, str]] = []
    for page in doc:
        try:
            u = parse_page(page, doc, art_dir)
        except Exception as exc:                     # noqa: BLE001
            skipped.append(((page.number or 0) + 1, f"error: {exc}"))
            continue
        if u:
            units.append(u)
        elif "Squad Size" in page.get_text():
            skipped.append(((page.number or 0) + 1, "has Squad Size but did not parse"))
    ver = re.search(r"_(\d{6})\.pdf$", os.path.basename(pdf_path))
    data: FactionFile = {
        "faction": faction_id,
        "name": faction_name,
        "sourcePdf": os.path.basename(pdf_path),
        "version": ver.group(1) if ver else None,
        "units": units,
    }
    return data, skipped


def classify_faction(units: list[Unit], data_dir: str) -> dict[str, str]:
    """Whose Behemoth is whose, worked out from the guns rather than typed in.

    The cards do not print a faction. What they do print is weapon names, and
    a faction's weapons are written in its own vocabulary — PHR railguns and
    stealth missiles, Scourge plasma and hives, Shaltari particle and gauss,
    Resistance autocannons and mining lasers. Every one of those words is
    already in data/dzc/faction-*.json, so the six scans are the training set
    and no list of names is kept here to go stale.

    Add-one smoothed log likelihood over the words, best faction wins.

    Then the STRUCTURE is checked, and that is what makes it safe to trust:
    TTCombat ship exactly two Behemoths per faction for five factions, and the
    PDF orders them in those pairs. If the classifier ever returns anything but
    that shape, the scan fails and a person looks at it. A wrong faction files
    a 400pt model against the wrong army's allowance, so a quiet guess is worse
    than no answer -- which is what this had until now.
    """
    def words(text: str) -> list[str]:
        return [w.lower() for w in re.findall(r"[A-Za-z][A-Za-z'-]+", text or "")
                if len(w) > 2]

    corpus: dict[str, Counter[str]] = {}
    for path in sorted(glob.glob(os.path.join(data_dir, "faction-*.json"))):
        with open(path, encoding="utf-8") as fh:
            d = json.load(fh)
        bag: Counter[str] = Counter()
        for u in d["units"]:
            for w in u["weapons"]:
                bag.update(words(w["name"]))
            bag.update(words(u.get("special") or ""))
        corpus[d["faction"]] = bag
    if len(corpus) != 6:
        raise SystemExit(f"need all six faction scans to place the Behemoths, "
                         f"found {sorted(corpus)}")

    vocab = set().union(*(set(b) for b in corpus.values()))
    totals = {f: sum(b.values()) for f, b in corpus.items()}
    out: dict[str, str] = {}
    for u in units:
        doc = [w for w in
               [x for wp in u["weapons"] for x in words(wp["name"])]
               + words(u.get("special") or "")
               if w in vocab]
        best = max(corpus, key=lambda f: sum(
            math.log((corpus[f][w] + 1) / (totals[f] + len(vocab))) for w in doc))
        out[u["id"]] = best

    pairs = Counter(out[u["id"]] for u in units if u["type"] == "Behemoth")
    if sorted(pairs.values()) != [2, 2, 2, 2, 2]:
        raise SystemExit(
            f"the Behemoths did not come out two per faction: {dict(pairs)}. "
            f"Either TTCombat have changed the line-up or the classifier is "
            f"wrong; either way this needs a person, not a guess."
        )
    return out


def scan_behemoths(args) -> None:
    """The Behemoth PDF: ten Behemoths and the one Drone that comes with one.

    Same card template as the faction sets — a Power column and a Groups
    Equivalent instead of a Squad Size — so it goes through the same parser.
    The first ten pages are rules text and produce nothing, which is how the
    parser is meant to handle a page that is not a card.

    FACTION IS NOT ON THESE CARDS. Nine of the eleven never name one, and there
    is no logo, no colour and no heading to read it off. It is left null and
    audit_data says so rather than being inferred from weapon names, which
    would file the Explorator by vibe. Until it is known these are reference
    profiles: selectable is false, so they read in the Unit Reference and
    cannot be added to an army against the wrong faction's allowance.
    """
    matches = [f for f in os.listdir(args.pdf_dir)
               if f.startswith("Behemoth_Rules_Stats") and f.endswith(".pdf")]
    if not matches:
        print("  !! no Behemoth PDF")
        return
    path = os.path.join(args.pdf_dir, max(matches, key=pdf_stamp))
    doc = fitz.open(path)
    units: list[Unit] = []
    skipped: list[tuple[int, str]] = []
    for page in doc:
        try:
            u = parse_page(page, doc, args.art)
        except Exception as exc:                     # noqa: BLE001
            skipped.append(((page.number or 0) + 1, f"error: {exc}"))
            continue
        if u:
            units.append(u)
    placed = classify_faction(units, args.out)
    for u in units:
        u["faction"] = placed[u["id"]]
        # The Venus Drone is "included with its Behemoth" and never chosen
        # (2.1.1); everything else is a normal Heavy choice now that it knows
        # whose army it belongs in.
        if u["type"] != "Behemoth":
            u["selectable"] = False
    ver = re.search(r"_(\d{6})\.pdf$", os.path.basename(path))
    data: FactionFile = {
        "faction": "behemoth",
        "name": "Behemoths",
        "sourcePdf": os.path.basename(path),
        "version": ver.group(1) if ver else None,
        "units": units,
    }
    out = os.path.join(args.out, "behemoths.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
    print(f"  Behemoths   {len(units):3d} units -> {out}")
    for pg, why in skipped:
        print(f"      skipped p{pg}: {why}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf-dir", default=".")
    ap.add_argument("--out", default="data")
    ap.add_argument("--art", default=None, help="extract unit photos into this dir")
    ap.add_argument("--faction", default=None, help="limit to one faction")
    ap.add_argument("--behemoths", action="store_true",
                    help="scan the Behemoth PDF into behemoths.json instead")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    if args.behemoths:
        return scan_behemoths(args)
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
        # Newest by the DATE TTCombat stamp on it, not by sorting the whole
        # filename. They renamed the Bioficer file from "Stat_Sheets" to
        # "Stat_Cards" between July and August, and "Sheets_260730" sorts above
        # "Cards_260804" on the S -- so a plain sort would have pinned the scan
        # to the older release for as long as both were on disk, silently.
        path = os.path.join(args.pdf_dir, max(matches, key=pdf_stamp))
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
