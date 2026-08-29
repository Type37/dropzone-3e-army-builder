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

When to run it
--------------
By hand, after a re-scan brings in NEW units -- rebuild.py deliberately does
not call this, and neither does CI. It reads the five
*_Stat_Cards_250912.pdf files in Pics/, which are gitignored and exist only on
Jet's machine, so GitHub Actions can never do this and a fresh clone cannot
either. That is not a fault to fix; it is why this is the one step still done
locally.

A re-scan no longer LOSES what is already here, which is a different thing and
was the actual hazard. scan_statcards rewrites a faction file from the card,
and a variant photo is not on the card, so every scan used to delete all 155 of
them -- three times in one working session on 2026-08-29, each time silently.
carry_variant_art in that scanner now moves them across a rewrite, matched on
(unit id, variant name). So this script is needed when a release ADDS a variant
that the old gallery has a photo of, not merely because a scan ran.

    python tools/dzc/scan_variant_art.py --pdf-dir Pics

The number to watch is the match count: 155 of 199 at Build 445. It should
climb or hold. A fall means the matcher stopped recognising captions it used
to, which is a bug in here rather than in the source.
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


def fold(w: str) -> str:
    """Singular. The card and the weapon table disagree on number constantly.

    "UM-88 Cannons" is printed under a photo captioned "(Twin Cannon)", and an
    exact-word score calls that no evidence at all. Katana, Slayer, Jaguar,
    Menchit and Pizzaro were all left without a photo by that one letter.
    """
    return w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w


def words(s: str) -> list[str]:
    return [fold(w) for w in norm(s).split() if w]


def keywords(s: str) -> set[str]:
    return {w for w in words(s) if w not in STOP and len(w) > 2}


def same(a: str, b: str) -> bool:
    """One word, allowing a single typo in a long one.

    TTCombat's own captions carry them -- "Attila Trackwalkers" one line above
    "Atilla Trackwalkers", "Atttack ATV's", "Twin Pasma Cannon" -- and each one
    costs a photo. Held to six characters and one edit so it cannot start
    joining short names that merely rhyme.
    """
    if a == b:
        return True
    if len(a) < 6 or len(b) < 6 or abs(len(a) - len(b)) > 1:
        return False
    if len(a) > len(b):
        a, b = b, a
    for i in range(len(a) + 1):                     # b with one char removed
        if len(a) != len(b) and a == b[:i] + b[i + 1:]:
            return True
    if len(a) == len(b):                            # one substitution
        return sum(x != y for x, y in zip(a, b, strict=True)) == 1
    return False


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
#
# THE PHOTO HAS TO BE OF THE SAME VEHICLE. There was a version of this that
# scored every caption in the FACTION against a variant's guns and took the
# best, with nothing requiring the two to be the same model. It handed one
# "Wolverine Scout Buggy (Missile)" to a UCM Howitzer, an Eagle Heavy Gunship,
# a Harrier Gunship, a Troop Buggy and a Wolverine, because all five carry a
# gun with "missile" in its name. 58 of 163 matches came through that route and
# they were not near-misses, they were a different vehicle. Jet, 2026-08-10:
# "so many of these are wrong or nonsensical."
#
# So identity comes first and guns only ever choose BETWEEN photos of a vehicle
# already identified. Four routes, strongest first, each run across the whole
# faction before the next begins:
#
#   name        the variant names the old unit, and only one photo answers
#   name+gun    it names several, and its own weapons pick one outright
#   cluster     a SIBLING named the old unit, and this variant's weapons pick
#               one of that unit's other photos -- how a renamed variant is
#               found. Our Tormentor is the acid-streamer Scourge Heavy
#               Skimmer; the old edition printed it as "Slayer Heavy Tank
#               (Acid Streamer)" and the name Tormentor appears nowhere.
#   elimination one photo of that old unit left, one variant left wanting one


DESIGNATOR = re.compile(r"[ ](?:[a-d]|[a-d]?[0-9])$")


def base(name: str) -> str:
    """The variant name with a trailing A / B / C / A1 designator dropped.

    Half of 3E's variants are not named at all -- Polecat A, Eagle B, Wolverine
    D, Juno A1, Falcon-A -- and a designator is a thing the previous edition
    never printed, so requiring the whole name to appear in a caption ruled out
    94 variants before the guns ever got a look. The MODEL name is what the old
    card is captioned with, and that is what is kept.
    """
    n = norm(name)
    return DESIGNATOR.sub("", n).strip() or n


def names_it(variant_name: str, cap):
    """How tightly this caption names this variant, or None for not at all.

    Every word of the name has to appear -- our Flak Team is "Flak AA Team" on
    the old card, but it is not any old Team. A word may land in the bracket
    instead of the unit name, because 3E names some variants gun-first: our
    Rocket Leviathan is "Leviathan Heavy Hovercraft (Rockets)". At least one
    word must still land in the UNIT name, which is what keeps the photo a
    photo of the same vehicle.

    Returned as (words in the unit name, every word exact) so that the tighter
    claim wins a contested caption:

      more words   "Gun Bus (Flak-G88 Cannon)" is claimed by our Bus on one
                   word and our Gun Bus on two. The longer name is the more
                   specific and it takes it.
      exact first  Scourge has a Ravager and a Savager, one letter apart, so
                   each one's caption is a typo-match for the other. Without
                   exactness ranking first the two claims tie, the tie is
                   refused, and BOTH lose a photo they plainly own.
    """
    nt = words(base(variant_name))
    st, ld = words(cap["stem"]), words(cap["load"])
    if not nt:
        return None
    exact, in_stem = True, 0
    for t in nt:
        if t in st:
            in_stem += 1
        elif t in ld:
            pass
        elif any(same(t, s) for s in st):
            in_stem += 1
            exact = False
        elif any(same(t, s) for s in ld):
            exact = False
        else:
            return None
    return (in_stem, exact) if in_stem else None


def guns(unit, variant_name: str) -> set[str]:
    """Words from every weapon this variant carries.

    Not only the ones it carries EXCLUSIVELY, which is what the first version
    asked for: the Shaltari Warstrider shares its Gauss Cannons between Jaguar,
    Lynx and Puma, so Jaguar had no exclusive weapon at all and could not be
    told from Oncilla even though one caption says "Gauss Cannons" and the
    other says "Bio-Atomisers". Sharing is safe here because the candidates are
    already photos of the same vehicle; the guns are only breaking a tie.
    """
    return {k for w in (unit.get("weapons") or [])
            if w.get("box") == "variant" and variant_name in (w.get("variants") or [])
            for k in keywords(w["name"])}


def by_gun(unit, variant_name, cands):
    """The one candidate this variant's weapons single out, and by how much.

    A strict win, not a best score. Two photos a variant's guns cannot separate
    is a coin-flip, and the unit's own photo beats a coin-flip. The score comes
    back with it so that two variants wanting the same photo can be settled on
    which one the guns actually point at.
    """
    keys = guns(unit, variant_name)
    if not keys or not cands:
        return None, 0
    scored = sorted(((len(keys & keywords(c["load"])), c) for c in cands),
                    key=lambda s: -s[0])
    if scored[0][0] == 0:
        return None, 0
    if len(scored) > 1 and scored[1][0] == scored[0][0]:
        return None, 0
    return scored[0][1], scored[0][0]


def award(claims, taken, out, route):
    """Settle one round's claims, refusing every genuine ambiguity.

    A claim is (variant key, caption, strength). A caption two variants both
    want goes to the tighter name match, and to NEITHER if they are equally
    tight -- which is the whole rule this file is built on. A variant that
    claimed nothing this round waits for the next.
    """
    wanted = {}
    for key, cap, strength in claims:
        wanted.setdefault(id(cap), []).append((strength, key, cap))
    for bids in wanted.values():
        bids.sort(key=lambda b: b[0], reverse=True)
        if len(bids) > 1 and bids[1][0] == bids[0][0]:
            continue
        _, key, cap = bids[0]
        if key in out or id(cap) in taken:
            continue
        out[key] = (cap, route)
        taken.add(id(cap))


def resolve_faction(units, pool):
    """Photos for every variant in one faction, no two sharing one.

    Faction-wide rather than unit at a time because the collisions cross units:
    the Battle Bus and the Ordnance Bus are both captioned "Gun Bus" on the old
    cards, and a resolver that sees one unit at a time hands the same photo to
    both.
    """
    out, taken = {}, set()
    variants = [(u, v["name"]) for u in units for v in (u.get("variants") or [])]

    def free():
        return [(u, vn) for u, vn in variants if (u["id"], vn) not in out]

    # ---------------------------------------------------------------- name
    # Only a variant's BEST-strength captions are candidates. Ravager's own
    # caption and Savager's are both hits for Ravager, one exactly and one on a
    # typo; keeping the weaker one would make its own caption ambiguous.
    hits = {}
    for u, vn in variants:
        scored = [(names_it(vn, c), c) for c in pool]
        best = max((n for n, _ in scored if n), default=None)
        hits[(u["id"], vn)] = [(n, c) for n, c in scored if n == best] if best else []

    award([((u["id"], vn), c, n) for u, vn in variants
           for n, c in hits[(u["id"], vn)] if len(hits[(u["id"], vn)]) == 1],
          taken, out, "name")

    # ----------------------------------------------------------------- gun
    # Every photo of an old unit that one of this unit's variants has named.
    # This is the identity constraint doing its work for a variant 3E renamed:
    # the vehicle is pinned by a sibling, not by a keyword.
    def cluster(unit):
        stems = {c["stem"] for c in pool
                 if any(names_it(v["name"], c)
                        for v in (unit.get("variants") or []))}
        return [c for c in pool if c["stem"] in stems]

    # Every unresolved variant bids on the WHOLE cluster, not only on the
    # photos its own name reached, and the best gun evidence takes each one.
    # Running the name-matchers first instead put the Menchit Walker's flamer
    # photo on our Styx: the old card is captioned "Menchit Walker (Autocannon
    # & Miniguns)", which is our Styx and its Styx Autocannons, but Menchit
    # reached it first on the strength of its name and the walker 3E named
    # after that gun never got to bid.
    # Run until it stops settling anything. Every photo taken shortens the next
    # round's shortlist, and a variant whose guns could not separate two photos
    # often can once one of them is gone: the Grizzly's "UM-92 Heavy Mortar"
    # scores the same on "(Heavy Mortar)" and "(Plasma Mortar)", and only stops
    # being a coin-flip after the plasma one goes to the Grizzly that has it.
    while True:
        claims = []
        for u, vn in free():
            cands = [c for c in cluster(u) if id(c) not in taken]
            pick, score = by_gun(u, vn, cands)
            if pick:
                claims.append(((u["id"], vn), pick, (score, True)))
        before = len(out)
        award(claims, taken, out, "gun")
        if len(out) == before:
            break

    # --------------------------------------------------------- elimination
    for u in units:
        left = [c for c in cluster(u) if id(c) not in taken]
        want = [vn for uu, vn in free() if uu["id"] == u["id"]]
        if len(left) == 1 and len(want) == 1:
            out[(u["id"], want[0])] = (left[0], "elimination")
            taken.add(id(left[0]))
    return out


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
        picked = resolve_faction(data["units"], pool)
        arts = {}
        for u in data["units"]:
            for v in (u.get("variants") or []):
                total += 1
                row, how = picked.get((u["id"], v["name"]), (None, None))
                routes[how] = routes.get(how, 0) + 1
                if args.dry_run:
                    got = f'<- {row["caption"]}  [{how}]' if row else "--"
                    print(f'  {u["name"]} :: {v["name"]}  {got}')
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
VAR_ART = re.compile(r'^          "art": "[^"]*"$')


def write_art_paths(path, raw, arts):
    """Set "art" on each matched variant, in place, without reformatting.

    json.dump would rewrite the whole file: LF where the repo has CRLF, plus a
    trailing newline, turning a few hundred added values into a diff nobody can
    read. So this walks lines and inserts one after the variant's "points".

    The indents are matched exactly, which is what keeps it off the OTHER two
    things in this file called variants: a weapon's variant restriction is a
    list of bare strings four levels deeper, and specialVariants is a different
    key. Only a unit-level "variants": [ opens the block this writes into.

    Every existing variant "art" comes out first. Without that the pass was
    write-once and silently so: "points" ends a variant object and so carries
    no comma, the first run puts one there to hang "art" off, and on the second
    run the line no longer matches, nothing is written, and whatever the
    previous matcher decided stays in the file looking like this run's work.
    """
    nl = "\r\n" if "\r\n" in raw else "\n"
    raw = strip_art(raw, nl)
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


def strip_art(raw, nl):
    """Every variant-level "art" line removed, and the comma it hangs on."""
    out, inside = [], False
    for line in raw.split(nl):
        if UNIT_ID.match(line):
            inside = False
        elif VAR_OPEN.match(line):
            inside = True
        elif inside and VAR_CLOSE.match(line):
            inside = False
        if inside and VAR_ART.match(line):
            out[-1] = out[-1].rstrip(",")
            continue
        out.append(line)
    return nl.join(out)


if __name__ == "__main__":
    sys.exit(main())
