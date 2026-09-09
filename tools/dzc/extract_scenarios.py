"""Cut the scenario maps out of the rulebook and the Fauna pack.

The twelve core maps were already in assets/scenarios/ when this was written --
cropped by hand in Build 462, committed without a generator, and 191x191, which
is a thumbnail of a thing you are meant to set a table up from.

Every scenario map in both PDFs turns out to be an embedded raster with an exact
bounding box, so there is nothing to detect: ask the page for its images, keep
the square one in the left column, and pull it at its native size. The rulebook
ships them at 401x401 and the Fauna pack at 1201x1202 -- that is the ceiling,
and re-rendering the page region at 5x only invents pixels that were never
there. Rulebook pages carry two scenarios, top and bottom, and page 42 hands
them back bottom-first, so they are sorted by y rather than trusted in order.

The legend beside each map is colour-keyed: a filled square, then the text it
keys. Reading the fill out of the page's vector data is what lets a scenario
page say "the two red Medium Zones" in words instead of printing a colour chip
and leaving the reader to match it up.
"""

import io
import json
import re
import sys
from pathlib import Path

import fitz
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
RULEBOOK = ROOT / "rules" / "A5_Dropzone_3.02_Rulebook.pdf"
FAUNA = ROOT / "rules" / "Extra-Rules" / "Fauna_Rules_Scenarios_260901.pdf"
OUT_ART = ROOT / "assets" / "scenarios"
OUT_DATA = ROOT / "data" / "dzc" / "scenarios.json"

# Page (1-based) -> the two scenarios on it, top of the page first.
CORE_PAGES = {
    38: ["Battle Royale", "Bunker Complex"],
    39: ["Castles", "Command and Control"],
    40: ["Crucible", "Demolish"],
    41: ["Domination", "Encroach"],
    42: ["Ground Control", "Kill Box"],
    43: ["Strategic Points", "Targets of Opportunity"],
}

# One scenario per page in the Fauna pack, and the source titles collide: pages
# 11 and 12 are both printed "Hunting Grounds". Disambiguated by their fauna,
# because two identical rows in a list is not a list.
FAUNA_PAGES = {
    9: "Pest Control",
    10: "Death From Below",
    11: "Hunting Grounds (Nest)",
    12: "Hunting Grounds (Typhon)",
}

# The rulebook's muted palette and the Fauna pack's brighter one, resolved to
# the words the rules themselves use -- "the red and green Zones", "non-green
# Zones", "the yellow and green Zones".
PALETTE = {
    "green": [(0.50, 0.70, 0.55), (0.35, 0.75, 0.40)],
    "red": [(0.60, 0.11, 0.14), (0.90, 0.30, 0.24)],
    "yellow": [(0.91, 0.91, 0.34), (0.98, 0.90, 0.55)],
    "orange": [(0.97, 0.61, 0.11)],
    "brown": [(0.69, 0.40, 0.06)],
    "blue": [(0.45, 0.62, 0.80)],
    "cyan": [(0.15, 0.77, 0.92)],
}


# The nine Scenario Objectives of 9.6, plus the two lines every scenario ends
# on. Each opens its own entry in the legend.
OBJECTIVE_RE = re.compile(
    r"^(Attrition|Extract|Displace|Dominate|Explore|Occupy|Protect|Raze|Secure"
    r"|Entry|Variant|Zone Placement)\b",
    re.I,
)


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def colour_name(fill):
    if max(fill) - min(fill) < 0.15:
        return "white" if min(fill) > 0.85 else "grey"
    best, dist = None, None
    for name, refs in PALETTE.items():
        for ref in refs:
            d = sum((a - b) ** 2 for a, b in zip(ref, fill))
            if dist is None or d < dist:
                best, dist = name, d
    return best


def maps_on(page, max_x):
    """Square rasters in the left column, top of the page first."""
    found = []
    for info in page.get_image_info(xrefs=True):
        x0, y0, x1, y1 = info["bbox"]
        w, h = x1 - x0, y1 - y0
        if w < 80 or x1 > max_x or abs(w - h) > 4:
            continue
        found.append((y0, info))
    found.sort()
    return [info for _, info in found]


def save_map(doc, info, dest):
    raw = doc.extract_image(info["xref"])
    img = Image.open(io.BytesIO(raw["image"])).convert("RGB")
    img.save(dest, "WEBP", quality=92, method=6)
    return img.size


def legend(page, x_min, y_range):
    """Legend and objective entries in the right column, each with its key.

    Read line by line, not block by block. The PDF merges a scenario's title
    into the same block as its first legend line on some pages -- page 42 hands
    back "Kill Box / 2 Large Zones / Each contains 1 Object" as one object
    anchored at the title's x, so a block-level x filter drops the green Zones
    that both of that scenario's Variants then talk about. Lines carry their own
    boxes and split cleanly.

    A swatch opens an entry and the lines under it belong to that entry until
    the next swatch, which is how "2 Medium Zones / Each contains 1 Object /
    Only use in Clash, Battle & Reconquest" stays one thing.
    """
    lo, hi = y_range
    swatches = []
    for dr in page.get_drawings():
        fill, r = dr.get("fill"), dr["rect"]
        if not fill or r.x0 < x_min or not (lo <= r.y0 < hi):
            continue
        # Legend keys are chunky squares. The glyphs inside a marker icon are a
        # few points across and would drown this in noise.
        if not (14 <= r.width <= 30 and abs(r.width - r.height) <= 3):
            continue
        name = colour_name(fill)
        # Objective rows are keyed by a printed token, not a colour -- the
        # Extract star, the Secure ring. Those read as grey or white here and
        # are not a colour the rules ever name.
        if name in ("grey", "white"):
            continue
        swatches.append((r.y0, name, fill))
    swatches.sort()

    lines = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = " ".join(
                "".join(s["text"] for s in line["spans"]).split()
            )
            x0, y0, _, y1 = line["bbox"]
            if text and x0 >= x_min and lo <= y0 < hi:
                lines.append((y0, y1, text))
    lines.sort()

    entries, current, unused = [], None, list(swatches)
    for y0, y1, text in lines:
        # Legend text is set top-aligned against its swatch, so a swatch is
        # matched on its TOP edge rather than its centre -- a swatch is taller
        # than a line, and centre-matching lands it a line late, which is how
        # Kill Box's yellow key ended up owning the green Zones' last line.
        # Spend the swatch once matched; left in the pool it opens a fresh
        # entry on every line it happens to overlap.
        key = None
        near = [s for s in unused if y0 - 5 <= s[0] <= y1 + 2]
        if near:
            key = min(near, key=lambda s: abs(s[0] - y0))
            unused.remove(key)
        # Objectives are keyed by a printed token rather than a colour, so
        # nothing opens an entry for them and they would otherwise pile up under
        # whichever Zone colour was keyed last.
        starts_objective = OBJECTIVE_RE.match(text)
        if key or starts_objective or current is None:
            current = {
                "colour": key[1] if key else None,
                "rgb": [round(v, 3) for v in key[2]] if key else None,
                "lines": [],
            }
            entries.append(current)
        current["lines"].append(text)
    return entries


def notes(page, x_max, y_min):
    """Fauna pages run Entry and the special rules under the map, not beside."""
    out = []
    for b in sorted(page.get_text("blocks"), key=lambda b: b[1]):
        text = " ".join(b[4].split())
        if text and b[0] < x_max and b[1] >= y_min:
            out.append(text)
    return out


def main():
    for pdf in (RULEBOOK, FAUNA):
        if not pdf.exists():
            sys.exit(f"missing {pdf}")
    OUT_ART.mkdir(parents=True, exist_ok=True)

    scenarios = []
    problems = []

    book = fitz.open(RULEBOOK)
    for pageno, names in CORE_PAGES.items():
        page = book[pageno - 1]
        found = maps_on(page, max_x=260)
        if len(found) != 2:
            problems.append(f"p{pageno}: {len(found)} maps, expected 2")
            continue
        for info, name in zip(found, names):
            key = slug(name)
            size = save_map(book, info, OUT_ART / f"{key}.webp")
            mid = page.rect.height / 2
            band = (0, mid) if info["bbox"][1] < mid else (mid, page.rect.height)
            scenarios.append(
                {
                    "id": key,
                    "name": name,
                    "source": "rulebook",
                    "page": pageno,
                    "map": f"assets/scenarios/{key}.webp",
                    "legend": legend(page, 216, band),
                }
            )
            print(f"{name:24} p{pageno} {size[0]}x{size[1]}")

    pack = fitz.open(FAUNA)
    for pageno, name in FAUNA_PAGES.items():
        page = pack[pageno - 1]
        found = maps_on(page, max_x=300)
        if len(found) != 1:
            problems.append(f"Fauna p{pageno}: {len(found)} maps, expected 1")
            continue
        key = slug(name)
        size = save_map(pack, found[0], OUT_ART / f"{key}.webp")
        scenarios.append(
            {
                "id": key,
                "name": name,
                "source": "fauna",
                "page": pageno,
                "map": f"assets/scenarios/{key}.webp",
                "legend": legend(page, 220, (0, page.rect.height)),
                "notes": notes(page, x_max=235, y_min=found[0]["bbox"][3]),
            }
        )
        print(f"{name:24} F{pageno} {size[0]}x{size[1]}")

    OUT_DATA.write_text(
        json.dumps(
            {
                "source": "Dropzone Commander 3.02 rulebook pp.34-43; "
                "Fauna Rules & Scenarios 260901 pp.9-12",
                "scenarios": scenarios,
            },
            indent=1,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"\n{len(scenarios)} scenarios -> {OUT_DATA.relative_to(ROOT)}")
    for p in problems:
        print("  !", p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
