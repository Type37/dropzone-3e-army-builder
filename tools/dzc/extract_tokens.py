#!/usr/bin/env python3
"""Cut the printed tokens, Zone Feature icons and Scenario maps out of the rulebook.

Run:  python tools/dzc/extract_tokens.py

Why this exists
---------------
Play Mode drew a Squad's Status Tokens as letters -- C, S, J, O -- because the
app had no picture of them. The rulebook has had one all along: page 51 is a
plate of all 28 tokens, printed at the size they are punched out at, each one
captioned. Concussed is a spiral, Suppressed is a burst of ricochets, Jammed is
a crossed-out signal, Obscured is a struck-through eye. Those are the shapes
sitting on the table in front of you, so those are the shapes the app draws.

Nothing on these pages is vector. Each of the eight pages is a single flattened
DCTDecode raster covering the whole trim, so there is no drawing to lift and no
alpha to inherit: the icons have to be re-cut out of a rendered page and their
background removed rather than simply kept.

What it takes, and from where
-----------------------------
  page 51     28 tokens        -> assets/tokens/<slug>.webp
  page 33     16 Zone Features -> the same slugs; the larger crop wins
  pages 38-43 12 Scenario maps -> assets/scenarios/<slug>.webp

Page 33 prints the same icons as page 51 beside the rules they trigger, at
roughly two thirds the size, so in practice page 51 wins every one of them.
It is scanned anyway rather than assumed: the day a token appears on 33 and not
on 51, this notices instead of silently shipping 27.

How a crop is found
-------------------
Not by hard-coded rectangles, which would survive exactly one reflow. The text
layer gives every caption's bounding box, and every icon sits in a fixed column
to the left of its caption. So: render the page, mark every pixel that is not
paper, find the contiguous ink bands inside the icon column, and match each band
to the caption nearest it. A band matching no caption -- a rule, a page number,
a stray -- is dropped.

Removing the paper
------------------
Flood filled inwards from the border, never thresholded globally. Most of these
icons are white line art inside a coloured or black tile: Shield Generator is a
white hex-shield on dark green, Obscured a white eye on black. A global "drop
everything pale" would take the paper AND the entire drawing. A fill from the
outside can only reach the paper, so the whites that matter survive by being
enclosed.

The rulebook PDF lives in rules/ and is gitignored, so CI cannot run this and
does not try. Run it by hand when the rulebook version changes; what it writes
is committed.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys
from collections import deque
from typing import Any

import fitz
from PIL import Image, ImageChops

ROOT = pathlib.Path(__file__).resolve().parents[2]
RULEBOOK = ROOT / "rules" / "A5_Dropzone_3.01_Rulebook_Compressed.pdf"

# 600dpi against a 419x595pt A5 page puts a 36pt token at ~300px: four times the
# largest size the app ever draws one, with room to crop in.
DPI = 600
PT = DPI / 72.0

TOKEN_PAGE = 51  # printed page numbers throughout, not indices
FEATURE_PAGE = 33
SCENARIO_PAGES = range(38, 44)

# Each icon column as (left, right) in points, stopping short of the captions
# that start at its right edge. Wide enough for the token with slack, narrow
# enough that no caption can leak in.
TOKEN_COLUMNS = ((18.0, 75.0), (218.0, 275.0))
FEATURE_COLUMNS = ((20.0, 58.0), (210.0, 249.0))

# The plate spells one of them wrong -- 11.1.34 spells the rule Suppressed --
# and the two pages disagree about two more, page 33 shortening the tower and
# calling the tunnel a monorail. Files are named after page 51, which is the
# plate of the physical tokens, except where the rule itself overrules it.
RESPELL = {
    "Supressed": "Suppressed",
    "Underground Monorail": "Underground Tunnel",
    "Comms Uplink": "Comms Uplink Tower",
}

# Where the icons start, below the chapter banner across the top of the plate.
TOP_MARGIN = 39.0

# The dash that runs a Feature's name into its rule on page 33. The PDF's text
# layer hands it back as U+FFFD as often as an en dash, so both are matched --
# and written by codepoint, because a literal en dash beside a hyphen inside a
# character class is unreadable and ruff says so (RUF001).
EM_DASH = re.compile("\\s*[\u2013\u2014\ufffd-]\\s*")


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def render(page) -> Image.Image:
    pm = page.get_pixmap(dpi=DPI)
    return Image.frombytes("RGB", (pm.width, pm.height), pm.samples)


def token_captions(page, x: float) -> list[tuple[str, float, float]]:
    """Page 51's captions, as (name, top, bottom) in points.

    Two lines of a caption stack with no gap and consecutive captions are a
    clear line apart, so a run of words broken wherever the vertical gap exceeds
    half a line is exactly one caption. Grouping by PyMuPDF's own blocks does
    not work here: the page is one text layer over one image, so it hands back
    the whole column as a single block.
    """
    # From the column's right edge to just past the longest caption. A caption
    # of two words on ONE line -- "Flak Turret" is the only one -- puts its
    # second word 28pt further right, so a narrow window loses half the name.
    # The far edge is not slack either: the folio sits level with the last
    # caption in the right column, and a wider window names it "Obscured 51".
    words = sorted(
        (w for w in page.get_text("words") if x <= w[0] < x + 95),
        key=lambda w: (w[1], w[0]),
    )
    out: list[tuple[list[str], float, float]] = []
    for x0, y0, _x1, y1, word, *_ in words:
        del x0
        if out and y0 - out[-1][2] < 5:
            out[-1] = (out[-1][0] + [word], out[-1][1], max(out[-1][2], y1))
        else:
            out.append(([word], y0, y1))
    return [(RESPELL.get(" ".join(w), " ".join(w)), a, b) for w, a, b in out]


def feature_captions(page, x: float) -> list[tuple[str, float, float]]:
    """Page 33's names, as (name, top, bottom) of the FIRST line of each entry.

    Here the name is not a caption but the opening words of a paragraph, run on
    from an em dash: "ACM Package - Weapons with two R values...". The icon is
    top-aligned with that first line rather than centred on the paragraph, so
    the band is matched on its top edge.
    """
    lines = sorted(
        (
            (s["text"].strip(), s["bbox"][1], s["bbox"][3])
            for blk in page.get_text("dict")["blocks"]
            for ln in blk.get("lines", [])
            for s in ln["spans"]
            if abs(s["bbox"][0] - x) < 3 and s["text"].strip()
        ),
        key=lambda s: s[1],
    )
    out: list[tuple[str, float, float]] = []
    for text, top, bot in lines:
        # A new entry is a line carrying the dash, after a paragraph break.
        if not EM_DASH.search(text[1:]):
            continue
        name = EM_DASH.split(text, 1)[0].strip()
        if name and name[0].isupper():
            out.append((RESPELL.get(name, name), top, bot))
    return out


def ink_profile(img: Image.Image, x0: float, x1: float) -> list[int]:
    """Rows of one icon column, scored 0-255 by how much of the row is ink.

    Ink is what is not paper: saturated, or dark. The paper is a pale warm stock
    with a watermark pattern printed into it, so brightness alone reads the
    watermark as an icon. Done with whole-image operations rather than a pixel
    loop -- this is a 3500x5000 render and the loop version takes half a minute.
    """
    col = img.crop((int(x0 * PT), 0, int(x1 * PT), img.height))
    hsv = col.convert("HSV")
    # Lookup tables rather than lambdas: point() takes 256 values directly, it
    # is the faster of the two, and a lambda here is the one call in this file
    # pyright cannot type.
    saturated = [255 if v > 55 else 0 for v in range(256)]
    is_dark = [255 if v < 110 else 0 for v in range(256)]
    mask = ImageChops.lighter(
        hsv.getchannel("S").point(saturated), hsv.getchannel("V").point(is_dark)
    )
    # One pixel wide, so each row's byte IS the share of that row carrying ink.
    return list(mask.resize((1, mask.height), Image.Resampling.BOX).tobytes())


def ink_bands(img: Image.Image, x0: float, x1: float, top: float) -> list[tuple[int, int]]:
    """Contiguous runs of inked rows: one per icon, in render pixels."""
    prof = ink_profile(img, x0, x1)
    # A white-tiled icon (Basement, Secret Entrance) is only its outline in most
    # rows, which is about 1% of the column, so the floor has to be low.
    on = [v > 2 and y >= top * PT for y, v in enumerate(prof)]
    bands: list[tuple[int, int]] = []
    start: int | None = None
    gap = 0
    for y, v in enumerate(on):
        if v:
            start = y if start is None else start
            gap = 0
        elif start is not None:
            gap += 1
            # Icons are pitched about 4pt apart, so the gap that ends one has to
            # be smaller than that. Nothing inside a token is blank for 2pt.
            if gap > int(2.0 * PT):
                bands.append((start, y - gap))
                start = None
    if start is not None:
        bands.append((start, len(on) - 1))
    return [(a, b) for a, b in bands if b - a > int(8 * PT)]


def cut_out(img: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    """Crop, then flood the paper away from the border inwards."""
    crop = img.crop(box).convert("RGBA")
    w, h = crop.size
    # Pillow's PixelAccess is not describable to pyright -- it types a subscript
    # into an RGBA image as a float rather than a 4-tuple -- so the access is
    # deliberately untyped rather than the file being littered with ignores.
    px: Any = crop.load()
    assert px is not None

    def paper(x: int, y: int) -> bool:
        r, g, b, _ = px[x, y]
        return max(r, g, b) - min(r, g, b) < 42 and (r + g + b) > 534

    seen = bytearray(w * h)
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or seen[y * w + x] or not paper(x, y):
            continue
        seen[y * w + x] = 1
        px[x, y] = (0, 0, 0, 0)
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))

    return crop.crop(crop.getbbox() or (0, 0, w, h))


def square(img: Image.Image, size: int = 256) -> Image.Image:
    """Pad to square and scale, so every token draws at one size without CSS."""
    side = max(img.size)
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    out.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
    return out.resize((size, size), Image.Resampling.LANCZOS)


def icons_from(doc, printed: int) -> dict[str, Image.Image]:
    page = doc[printed - 1]
    img = render(page)
    tokens = printed == TOKEN_PAGE
    columns = TOKEN_COLUMNS if tokens else FEATURE_COLUMNS
    found: dict[str, Image.Image] = {}

    for x0, x1 in columns:
        caps = token_captions(page, x1) if tokens else feature_captions(page, x1 + 1.5)
        if not caps:
            continue
        # A caption sits level with its token; a paragraph starts level with
        # its icon's top edge.
        def anchor(cap: tuple[str, float, float], mid: bool = tokens) -> float:
            return (cap[1] + cap[2]) / 2 if mid else cap[1]

        for top, bot in ink_bands(img, x0, x1, TOP_MARGIN if tokens else 0.0):
            here = (top + bot) / 2 / PT if tokens else top / PT
            near = min(caps, key=lambda c: abs(anchor(c) - here))
            if abs(anchor(near) - here) > 16:
                continue
            cut = cut_out(img, (int(x0 * PT), top, int(x1 * PT), bot))
            if cut.width < 60 or cut.height < 60:
                continue
            found[near[0]] = cut
    return found


def scenario_maps(doc, out_dir: pathlib.Path) -> list[str]:
    """The Scenario deployment maps, which ARE embedded images and lift whole."""
    names: list[str] = []
    for printed in SCENARIO_PAGES:
        page = doc[printed - 1]
        # Scenario titles are the only 14pt text on the page, one per map.
        # Sorted down the page BEFORE merging: the text layer hands back the
        # lower Scenario first on half these pages, and merging in that order
        # welds two Scenarios into "Kill Box Ground Control".
        heads = sorted(
            (
                (s["text"].strip(), s["bbox"][1])
                for blk in page.get_text("dict")["blocks"]
                for ln in blk.get("lines", [])
                for s in ln["spans"]
                if s["size"] > 13 and s["text"].strip()
            ),
            key=lambda t: t[1],
        )
        titles: list[tuple[str, float]] = []
        for text, top in heads:
            # "Targets of Opportunity" is set over two lines.
            if titles and top - titles[-1][1] < 22:
                titles[-1] = (f"{titles[-1][0]} {text}".replace("  ", " "), titles[-1][1])
            else:
                titles.append((text, top))
        maps = [
            (xref, rect)
            for xref, *_ in page.get_images(full=True)
            for rect in page.get_image_rects(xref)
            if rect.width < 250  # the page background is the whole trim
        ]
        for xref, rect in sorted(maps, key=lambda m: m[1].y0):
            near = min(titles, key=lambda t: abs(t[1] - rect.y0), default=None)
            if near is None:
                continue
            raw = doc.extract_image(xref)
            tmp = out_dir / "_extract.bin"
            tmp.write_bytes(raw["image"])
            path = out_dir / f"{slug(near[0])}.webp"
            with Image.open(tmp) as im:
                im.convert("RGB").save(path, "WEBP", quality=90, method=6)
            tmp.unlink()
            names.append(near[0])
            print(f"  p{printed}  {near[0]:<26} {path.relative_to(ROOT)}")
    return names


def main() -> int:
    ap = argparse.ArgumentParser(description="Extract rulebook tokens and Scenario maps")
    ap.add_argument("--pdf", type=pathlib.Path, default=RULEBOOK)
    args = ap.parse_args()

    if not args.pdf.exists():
        print(f"No rulebook at {args.pdf}", file=sys.stderr)
        return 1

    tokens_dir = ROOT / "assets" / "tokens"
    scen_dir = ROOT / "assets" / "scenarios"
    tokens_dir.mkdir(parents=True, exist_ok=True)
    scen_dir.mkdir(parents=True, exist_ok=True)

    doc = fitz.open(args.pdf)

    icons = icons_from(doc, TOKEN_PAGE)
    print(f"page {TOKEN_PAGE}: {len(icons)} tokens")
    extra = 0
    for name, img in icons_from(doc, FEATURE_PAGE).items():
        have = icons.get(name)
        if have is None or have.width * have.height < img.width * img.height:
            icons[name] = img
            extra += 1
    print(f"page {FEATURE_PAGE}: {extra} better than the plate")

    for name, img in sorted(icons.items()):
        path = tokens_dir / f"{slug(name)}.webp"
        square(img).save(path, "WEBP", quality=94, method=6)
        print(f"  {name:<26} {path.relative_to(ROOT)}")

    print(f"Scenario maps, pages {SCENARIO_PAGES.start}-{SCENARIO_PAGES.stop - 1}")
    maps = scenario_maps(doc, scen_dir)
    print(f"\n{len(icons)} tokens, {len(maps)} maps")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
