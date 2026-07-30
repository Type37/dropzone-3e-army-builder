#!/usr/bin/env python3
"""
Flag unit art that is probably not a photograph.

The stat cards carry the faction logo as a large watermark alongside the
miniature photo, and on most cards the watermark is DRAWN BIGGER than the photo.
Selecting by size silently ships 139 faction logos as unit art, and the failure
is invisible unless you open the files. Colour richness separates them: a
photographed miniature has hundreds of distinct colours, a flat logo a handful.
"""

import glob
import os
import sys

from PIL import Image

FLAT = 40          # distinct colours in a 64x64 thumbnail
NEAR_SQUARE = 0.02  # logos are drawn as exact squares

# Every unit must reference art, and that file must exist. The art path used to
# be written only when --art ran, so a routine re-scan stripped the image from
# all 178 units -- invisible in the JSON, and only visible as a blank builder.
import json

missing_ref, missing_file = [], []
for dp in sorted(glob.glob(os.path.join("data", "faction-*.json"))):
    data = json.load(open(dp, encoding="utf-8"))
    for u in data["units"]:
        if not u.get("art"):
            missing_ref.append(f"{data['faction']}/{u['name']}")
        elif not os.path.exists(u["art"]):
            missing_file.append(f"{data['faction']}/{u['name']} -> {u['art']}")

rows = []
for path in sorted(glob.glob(os.path.join("assets", "units", "**", "*.webp"), recursive=True)):
    im = Image.open(path)
    w, h = im.size
    thumb = im.convert("RGB").resize((64, 64), Image.NEAREST)
    colours = len(thumb.getcolors(maxcolors=4096) or [])
    square = abs(w - h) / max(w, h) < NEAR_SQUARE
    rows.append((path, w, h, colours, im.mode, square))

flat = [r for r in rows if r[3] < FLAT]
sus = [r for r in rows if r[3] >= FLAT and r[5] and r[3] < 300]
no_alpha = [r for r in rows if r[4] != "RGBA"]

print(f"{len(rows)} art files")
print(f"  with alpha         {len(rows) - len(no_alpha)}")
print(f"  flat (< {FLAT} colours) {len(flat)}   <- probably a logo, not a miniature")
print(f"  square + low colour {len(sus)}   <- worth eyeballing")
print(f"  units missing an art reference  {len(missing_ref)}")
print(f"  references with no file on disk {len(missing_file)}")

for label, group in (("NO ART REFERENCE", missing_ref), ("FILE MISSING", missing_file)):
    if group:
        print(f"\n{label}:")
        for g in group[:15]:
            print("  " + g)
        if len(group) > 15:
            print(f"  ... and {len(group) - 15} more")

for label, group in (("FLAT", flat), ("SUSPECT", sus), ("NO ALPHA", no_alpha)):
    if group:
        print(f"\n{label}:")
        for p, w, h, c, mode, _ in group[:20]:
            print(f"  {c:5d} colours  {w}x{h:<5} {mode:5s} {p}")
        if len(group) > 20:
            print(f"  ... and {len(group) - 20} more")

sys.exit(1 if (flat or missing_ref or missing_file) else 0)
