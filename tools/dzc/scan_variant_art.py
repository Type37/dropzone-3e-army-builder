#!/usr/bin/env python3
"""Give every VARIANT its own photograph, from the previous edition's cards.

Run:  python tools/dzc/scan_variant_art.py --pdf-dir <dir of 250912 cards>

Why this exists
---------------
178 units carry 218 variants between them, and until now all 218 shared one
picture. A UCM Main Battle Tank showed the same photo whether you had taken a
Sabre, a Tachi, a Rapier or a Greave, which are four visibly different models.

The 3E stat cards cannot fix that: every one of the 189 pages carries exactly
one image, checked. But the PREVIOUS edition's cards open with a contents
gallery -- nine cut-out miniatures a page, captioned individually -- and 3E
collapsed what that edition printed as separate units into variants. So:

    Ares Walker                            -> Type-1 Battle Walker / Ares
    Menchit Walker (Flamer & Missiles)     -> Type-1 Battle Walker / Menchit
    Taranis Artillery Tank (Thor Bombard)  -> PHR Artillery Tank / Thor

Three routes from a variant to a photo, tried in order:

  1. The variant name inside the old UNIT name. The commonest by far.
  2. The variant name inside the old LOADOUT bracket, for the ones the new
     edition named after a gun.
  3. The bracket matched against the variant's EXCLUSIVE weapons. Our Angelos
     A1 and A2 carry no descriptive name at all, but the weapon table says A1
     is the one with the smoothbore and the gallery captions its photo
     "(Smoothbore)". The data can identify the picture where the name cannot.

What it does NOT do
-------------------
It does not touch a unit's own art, and it does not invent one. A variant with
no match keeps showing the unit photo, which is what every variant did before.
The previous edition simply has no picture of a model 3E introduced -- Styx,
Greave, Tachi, Falcon-A/B and about thirty others -- and a wrong photo is worse
than a general one.

These are PREVIOUS-EDITION sculpts. That is the trade, and it is deliberate:
a specific old photo tells you which loadout you are looking at, a general new
one does not.
"""

import argparse
import io
import json
import os
import re
import sys

import fitz
from PIL import Image

FACTIONS = ("ucm", "phr", "scourge", "shaltari", "resistance")
ART_DIR = "assets/units/variants"
# Words too generic to identify a loadout by. "Gun" and "Walker" appear in
# dozens of captions and would match anything.
STOP = {"a", "the", "and", "of", "gun", "guns", "walker", "tank", "twin",
        "heavy", "light", "with", "battery"}


def norm(s: str) -> str:
    s = s.lower().replace("’", "'")  # noqa: RUF001 - the PDF's own apostrophe
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()


def keywords(s: str) -> set[str]:
    return {w for w in norm(s).split() if w not in STOP and len(w) > 2}


def slug(s: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s.lower())).strip("-")


# ------------------------------------------------------------------- gallery


def photo_rects(page):
    """Miniature images on a gallery page, with the page background dropped.

    Every gallery page places one full-bleed image at (-10,-8) 439x315 on a
    420x298 page. It is furniture and it is not a miniature.
    """
    page_area = page.rect.get_area()
    out = []
    for im in page.get_images(full=True):
        rects = page.get_image_rects(im[0])
        if not rects:
            continue
        r = rects[0]
        if r.get_area() > page_area * 0.6 or r.width < 30 or r.height < 18:
            continue
        out.append((im[0], im[1], r))
    return out


def caption(page, rect, words, floor):
    """The text printed under `rect`, in its own column of the grid.

    Constrained horizontally to the image's own column, because the gallery is
    a 3x3 grid and the captions of the cells either side sit at the same
    height. Constrained vertically to the top of the next row rather than a
    fixed offset, because the miniatures vary in height and a short one sits
    high in its cell with its caption further below than any fixed window.
    """
    picked = [w for w in words
              if rect.x0 - 2 < (w[0] + w[2]) / 2 < rect.x1 + 2
              and rect.y1 - 6 <= w[1] < floor]
    if not picked:
        return ""
    picked.sort(key=lambda w: (round(w[1], 1), w[0]))
    lines, cur, y = [], [], None
    for w in picked:
        if y is None or abs(w[1] - y) < 3:
            cur.append(w)
            y = w[1] if y is None else y
        else:
            lines.append(cur)
            cur, y = [w], w[1]
    if cur:
        lines.append(cur)
    text = " ".join(" ".join(w[4] for w in ln) for ln in lines[:3])
    return re.sub(r"\s+", " ", text).strip()


def read_gallery(pdf_dir):
    rows = []
    for fn in sorted(os.listdir(pdf_dir)):
        if not fn.lower().endswith(".pdf"):
            continue
        fac = norm(fn.split("_")[0])
        if fac not in FACTIONS:
            continue
        doc = fitz.open(os.path.join(pdf_dir, fn))
        for i in range(doc.page_count):
            page = doc[i]
            shots = photo_rects(page)
            if len(shots) < 5:
                continue                       # not a gallery page
            words = page.get_text("words")
            tops = sorted({round(r.y0) for _, _, r in shots})
            for xref, smask, r in shots:
                nxt = next((t for t in tops if t > r.y1 + 4), None)
                cap = caption(page, r, words, (nxt - 2) if nxt else page.rect.y1)
                if not cap:
                    continue
                m = re.match(r"^(.*?)\s*\((.*)\)\s*$", cap)
                stem, load = (m.group(1), m.group(2)) if m else (cap, "")
                rows.append({"faction": fac, "pdf": fn, "page": i + 1,
                             "xref": xref, "smask": smask, "caption": cap,
                             "stem": norm(stem), "load": norm(load)})
        doc.close()
    return rows


# ------------------------------------------------------------------ matching


def resolve_unit(unit, pool):
    """Photos for one unit's variants, assigned so no two share one.

    Done per unit rather than per variant because the collisions are between
    SIBLINGS: "Taranis Artillery Tank (Thor Bombard)" matches our Taranis on
    the unit name and our Thor on the loadout, and only one of them can have
    it. Resolving a variant at a time cannot see that, and the first version
    gave the Thor photo to Taranis.

    Two passes. The unit name is stronger evidence than the loadout bracket, so
    every stem match is settled first and takes its photo out of the pool; the
    bracket then picks over what is left.
    """
    variants = unit.get("variants") or []
    out, taken = {}, set()

    for v in variants:
        row, how = match(unit, v, [c for c in pool if id(c) not in taken])
        if row:
            out[v["name"]] = (row, how)
            taken.add(id(row))

    # The bracket, for variants the unit name never named. "Odin Heavy Walker
    # (Hyperion Laser)" is the Hyperion's photo and nothing else claims it.
    for v in variants:
        if v["name"] in out:
            continue
        nv = norm(v["name"])
        word = re.compile(rf"\b{re.escape(nv)}\b")
        left = [c for c in pool if id(c) not in taken and word.search(c["load"])]
        if len(left) == 1:
            out[v["name"]] = (left[0], "loadout-name")
            taken.add(id(left[0]))
    return out


def match(unit, variant, pool):
    """The gallery row for this variant, and how it was found.

    THE NAME HAS TO APPEAR. There is no route here that finds a photo by
    weapon keywords alone, and there was: the first version of this scored
    every caption in the FACTION against the variant's guns and took the best,
    with nothing requiring the photo to be of the same vehicle. It handed one
    "Wolverine Scout Buggy (Missile)" to a UCM Howitzer, an Eagle Heavy
    Gunship, a Harrier Gunship, a Troop Buggy and a Wolverine, because all five
    have a gun with "missile" in its name. 58 of 163 matches came through that
    route and they were not near-misses, they were a different vehicle. Jet,
    2026-08-10: "so many of these are wrong or nonsensical." Correct, and the
    fault was that a keyword score was allowed to stand in for identity.

    So the variant's name must appear in the old unit name, and the loadout is
    used ONLY to choose between several photos of that same old unit.
    """
    nv = norm(variant["name"])
    word = re.compile(rf"\b{re.escape(nv)}\b")
    hits = [c for c in pool if word.search(c["stem"])]

    # A sibling's name in the caption means the photo is the SIBLING'S.
    # "Taranis Artillery Tank (Thor Bombard)" matches our Taranis on the stem,
    # but Thor is a variant in its own right and that is Thor's photo. The same
    # trap sits on Odin/Hyperion and on Bus/Gun Bus, where the shorter name is
    # a word inside the longer one.
    sibs = [norm(v["name"]) for v in (unit.get("variants") or [])
            if norm(v["name"]) and norm(v["name"]) != nv]

    def sibling_owns(c):
        for s in sibs:
            named = re.compile(rf"\b{re.escape(s)}\b")
            # In the bracket: the photo is captioned as that sibling's loadout.
            if named.search(c["load"]):
                return True
            # In the unit name, and a longer name than mine, so it is the more
            # specific of the two. "Gun Bus" beats "Bus" for the same caption.
            if len(s) > len(nv) and named.search(c["stem"]):
                return True
        return False

    mine = [c for c in hits if not sibling_owns(c)] or hits

    if len(mine) == 1:
        return mine[0], "name"
    if not mine:
        return None, None

    # Several photos of the same old unit, one per loadout. Now the guns are a
    # fair way to choose, because every candidate is already the right vehicle.
    own = [w["name"] for w in (unit.get("weapons") or [])
           if w.get("box") == "variant" and w.get("variants") == [variant["name"]]]
    keys = {k for g in own for k in keywords(g)}
    if keys:
        scored = sorted(((len(keys & keywords(c["load"])), c) for c in mine),
                        key=lambda s: -s[0])
        if scored[0][0] > 0 and (len(scored) == 1 or scored[0][0] > scored[1][0]):
            return scored[0][1], "name+loadout"

    # Still ambiguous. No photo beats a coin-flip between two loadouts.
    return None, "ambiguous"


# ------------------------------------------------------------------- writing


def save(doc, row, dest, max_px=800, quality=90):
    """The photo as a transparent WebP, trimmed to the miniature.

    Same shape as extract_art in scan_statcards: the card stores an RGB image
    and a separate soft mask holding the alpha, so the two have to be put back
    together or the cutout is flattened onto black.
    """
    info = doc.extract_image(row["xref"])
    img = Image.open(io.BytesIO(info["image"])).convert("RGB")
    if row["smask"]:
        m = doc.extract_image(row["smask"])
        mask = Image.open(io.BytesIO(m["image"])).convert("L")
        if mask.size != img.size:
            mask = mask.resize(img.size, Image.Resampling.LANCZOS)
        img.putalpha(mask)
        box = img.getbbox()
        if box:
            img = img.crop(box)
    if max(img.size) > max_px:
        img.thumbnail((max_px, max_px), Image.Resampling.LANCZOS)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    img.save(dest, "WEBP", quality=quality, method=6)
    return img.size


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pdf-dir", required=True,
                    help="directory of the previous edition's stat cards")
    ap.add_argument("--data", default="data/dzc")
    ap.add_argument("--art", default=ART_DIR)
    ap.add_argument("--dry-run", action="store_true", help="report the match, write nothing")
    args = ap.parse_args()

    gallery = read_gallery(args.pdf_dir)
    print(f"gallery miniatures: {len(gallery)}")
    if not gallery:
        print("no gallery pages found -- is --pdf-dir the previous edition?", file=sys.stderr)
        return 1

    docs, routes, wrote, total = {}, {}, 0, 0
    for fac in FACTIONS:
        path = os.path.join(args.data, f"faction-{fac}.json")
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as fh:
            raw = fh.read()
        data = json.loads(raw)
        pool = [c for c in gallery if c["faction"] == fac]
        arts = {}
        for u in data["units"]:
            picked = resolve_unit(u, pool)
            for v in (u.get("variants") or []):
                total += 1
                row, how = picked.get(v["name"], (None, None))
                routes[how] = routes.get(how, 0) + 1
                if not row:
                    continue
                rel = f'{args.art}/{u["id"]}--{slug(v["name"])}.webp'
                if not args.dry_run:
                    doc = docs.setdefault(
                        row["pdf"], fitz.open(os.path.join(args.pdf_dir, row["pdf"])))
                    save(doc, row, rel)
                arts[(u["id"], v["name"])] = rel
                wrote += 1
        if not args.dry_run:
            write_art_paths(path, raw, arts)
        print(f"  {fac:<11s} {len(arts):3d} variants with art")

    pct = round(100 * wrote / total) if total else 0
    print(f"\nvariants: {total} | with a photo: {wrote} ({pct}%)")
    for k, n in sorted(routes.items(), key=lambda x: -x[1]):
        print(f"  {k or '(no match)':<18s} {n:3d}")
    return 0


UNIT_ID = re.compile(r'^      "id": "([^"]+)",$')
VAR_OPEN = re.compile(r'^      "variants": \[$')
VAR_CLOSE = re.compile(r'^      \],?$')
VAR_NAME = re.compile(r'^          "name": "([^"]*)",$')
VAR_POINTS = re.compile(r'^(          )"points": .*[^,]$')


def write_art_paths(path, raw, arts):
    """Add "art" to each matched variant, in place, without reformatting.

    json.dump would rewrite the whole file: LF where the repo has CRLF, plus a
    trailing newline, turning a few hundred added values into a diff nobody can
    read. So this walks lines and inserts one after the variant's "points".

    The indents are matched exactly, which is what keeps it off the OTHER two
    things in this file called variants: a weapon's variant restriction is a
    list of bare strings four levels deeper, and specialVariants is a different
    key. Only a unit-level "variants": [ opens the block this writes into.
    """
    nl = "\r\n" if "\r\n" in raw else "\n"
    out, unit, vname, inside = [], None, None, False
    for line in raw.split(nl):
        m = UNIT_ID.match(line)
        if m:
            unit, inside = m.group(1), False
        elif VAR_OPEN.match(line):
            inside = True
        elif inside and VAR_CLOSE.match(line):
            inside = False
        elif inside:
            m = VAR_NAME.match(line)
            if m:
                vname = m.group(1)
        out.append(line)
        if not inside:
            continue
        m = VAR_POINTS.match(line)
        if m and (unit, vname) in arts:
            # "points" is the last key in a variant object, so it carries no
            # trailing comma and one has to be added before the new line.
            out[-1] = line + ","
            out.append(f'{m.group(1)}"art": "{arts[(unit, vname)]}"')
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(nl.join(out))


if __name__ == "__main__":
    sys.exit(main())
