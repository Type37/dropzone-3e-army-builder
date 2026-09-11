#!/usr/bin/env python3
"""Redraw the Dropzone scenario maps as SVG from a spec in inches.

    python tools/dzc/draw_scenario_maps.py grid <id>
        the book's map with an inch grid, to read positions from
    python tools/dzc/draw_scenario_maps.py draw <id|all>
        write assets/scenarios/<id>.svg and data/dzc/scenario-hotspots/<id>.json
    python tools/dzc/draw_scenario_maps.py compare <id>
        the book's map beside the redraw, to check it

The book's maps are pictures (401px from the rulebook, 1201px from the Fauna
pack). Each is described in data/dzc/scenario-maps/<id>.json, in inches on the
48" table, x from the left edge and y from the top:

  territories  [{"colour": "blue"|"red", "shape": "rect", "x", "y", "w", "h"}
               | {"colour", "shape": "circle", "cx", "cy", "r"}]
               circles are clipped to the table
  lines        [{"x1", "y1", "x2", "y2", "style": "dashed"|"solid", "colour"?,
                 "weight"?: "faint"}]
               centre lines, quarter lines (faint), diagonals
  zones        [{"legend": n, "x", "y", "w", "h", "features": ["railgun-turret", ...],
                 "border"?: "solid", "outline"?: colour}]
               x, y the Zone's centre; legend = index of its entry in scenarios.json,
               which gives its colour; features are token names from assets/tokens:
               one is centred, two or more go in the corners (top right, bottom left,
               top left, bottom right) as the book draws them
  objects      [{"x", "y"}]
               Object tokens
  points       [{"x", "y", "colour": "magenta"|"orange"|"yellow"|"red"|"pink",
                 "d"?: 2, "dashed"?, "legend"?: n}]
               marked points, drawn as coloured discs d inches across
  tokens       [{"token", "x", "y", "size"?}]
               a token placed on its own
  arrows       [{"x1", "y1", "x2", "y2", "label", "lx"?, "ly"?}]
               measurements; lx/ly place the label
  variants     {"1": {"zone_features": [{"legend": [n], "add"|"remove": token}],
                      "zones": [...], "tokens": [...], "hide": ["objects", "points:n"],
                      "strike": ["Extract"], "objective"?: true}}
               what turning a Variant on does: map changes, drawn as layers the page
               shows or hides, and the Scenario Objectives it strikes or adds to

A legend entry printed "Only use in Clash, Battle & Reconquest" tags its Zones,
points, and anything inside them with the smallest game size they are used in,
so the page can take them off the map for a Skirmish.

Images and compares go to the system temp folder.
"""

import base64
import io
import json
import os
import re
import sys
import tempfile

from PIL import Image, ImageChops, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SPECS = os.path.join(ROOT, "data", "dzc", "scenario-maps")
SCEN = os.path.join(ROOT, "data", "dzc", "scenarios.json")
TOKENS = os.path.join(ROOT, "assets", "tokens")
OUT_SVG = os.path.join(ROOT, "assets", "scenarios")
OUT_SPOTS = os.path.join(ROOT, "data", "dzc", "scenario-hotspots")
TMP = os.path.join(tempfile.gettempdir(), "dzc-maps")

U = 200 / 48  # SVG units per inch on a 200-unit table
TERRITORY = {"blue": "#6FB0E8", "red": "#E06A6A", "green": "#6CCB6C", "yellow": "#E8D35A"}
POINT = {
    "magenta": "#D6348F",
    "red": "#D83A3A",
    "green": "#3E9E4E",
    "yellow": "#F2E23A",
    "blue": "#2F7FD0",
    "orange": "#E8765C",
    "pink": "#D98A96",
}
TOKEN_SIDE = 2.2  # inches, a Feature token in a Zone corner


def n(v):
    return (f"{v:.2f}").rstrip("0").rstrip(".")


def load_scenarios():
    return {s["id"]: s for s in json.load(open(SCEN, encoding="utf-8"))["scenarios"]}


def legend_rgb(scen, i):
    """A Zone's fill is its legend colour, which is the colour the book prints the Zone in."""
    entry = scen["legend"][i]
    if not entry.get("rgb"):
        raise SystemExit(f"{scen['id']}: legend {i} has no colour")
    return "rgb({})".format(",".join(str(round(v * 255)) for v in entry["rgb"]))


def legend_size(scen, i):
    """The smallest game size a legend entry is used in, from "Only use in Clash, Battle & ..."."""
    text = " ".join(scen["legend"][i]["lines"])
    m = re.search(r"Only use in ([^.]*)", text)
    if not m:
        return None
    return "clash" if "Clash" in m.group(1) else "battle"


def attrs(size=None, v=None, hide=None):
    """SVG attributes for a layer: its game size, the Variant that adds it, the ones that hide it.
    A Variant's layer is display="none" in the file, so the map as a picture is the book's map."""
    out = ""
    if size:
        out += f' data-size="{size}"'
    if v:
        out += f' data-v="{v}" display="none"'
    if hide:
        out += ' data-hide-v="{}"'.format(" ".join(hide))
    return out


def tag(spot, size=None, v=None, hide=None):
    if size:
        spot["size"] = size
    if v:
        spot["v"] = v
    if hide:
        spot["hideV"] = " ".join(hide)
    return spot


def feature_slots(z, count, centre_taken):
    """Where a Zone's tokens go: a lone token is centred unless an Object sits there; two or more
    go in the corners (top right, bottom left, top left, bottom right) as the book draws them."""
    w, h = z["w"] * U, z["h"] * U
    x0, y0 = z["x"] * U - w / 2, z["y"] * U - h / 2
    side, pad = TOKEN_SIDE * U, 0.35 * U
    if count == 1 and not centre_taken:
        return [(z["x"] * U - side / 2, z["y"] * U - side / 2)]
    corners = [
        (x0 + w - side - pad, y0 + pad),
        (x0 + pad, y0 + h - side - pad),
        (x0 + pad, y0 + pad),
        (x0 + w - side - pad, y0 + h - side - pad),
    ]
    return [corners[i % len(corners)] for i in range(count)]


_token_cache = {}


def token_uri(name):
    if name not in _token_cache:
        path = os.path.join(TOKENS, name + ".webp")
        if not os.path.exists(path):
            svg = os.path.join(TOKENS, name + ".svg")
            if not os.path.exists(svg):
                raise SystemExit(f"no token {name}")
            # a vector token (the Hive) goes in as a picture too, so every renderer shows it
            import fitz

            page = fitz.open(svg)[0]
            z = 96 / page.rect.width
            pix = page.get_pixmap(matrix=fitz.Matrix(z, z), alpha=True)
            im = Image.frombytes("RGBA", (pix.width, pix.height), pix.samples)
        else:
            im = Image.open(path).convert("RGBA")
        im = im.resize((96, 96), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "PNG", optimize=True)
        _token_cache[name] = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    return _token_cache[name]


def draw(sid, scen):
    with open(os.path.join(SPECS, sid + ".json"), encoding="utf-8") as fh:
        spec = json.load(fh)
    out, spots = [], []
    out.append('<rect width="200" height="200" fill="#f4efe8"/>')
    # lines first: the book's Territories sit over them
    for ln in spec.get("lines", []):
        dash = ' stroke-dasharray="4,3"' if ln.get("style", "dashed") == "dashed" else ""
        col = ln.get("colour", "#6b6660")
        width = ".35" if ln.get("weight") == "faint" else (".6" if dash else ".8")
        opacity = ' stroke-opacity=".6"' if ln.get("weight") == "faint" else ""
        out.append(
            '<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="{}" stroke-width="{}"{}{}/>'.format(
                n(ln["x1"] * U),
                n(ln["y1"] * U),
                n(ln["x2"] * U),
                n(ln["y2"] * U),
                col,
                width,
                dash,
                opacity,
            )
        )
    out.append(
        '<clipPath id="tbl"><rect width="200" height="200"/></clipPath><g clip-path="url(#tbl)">'
    )
    for t in spec.get("territories", []):
        fill = TERRITORY[t["colour"]]
        style = (
            f'fill="{fill}" fill-opacity=".55" stroke="#1C1A17" stroke-width=".8" '
            'stroke-dasharray="3,2"'
        )
        if t["shape"] == "rect":
            out.append(
                '<rect x="{}" y="{}" width="{}" height="{}" {}/>'.format(
                    n(t["x"] * U), n(t["y"] * U), n(t["w"] * U), n(t["h"] * U), style
                )
            )
        elif t["shape"] == "circle":
            out.append(
                '<circle cx="{}" cy="{}" r="{}" {}/>'.format(
                    n(t["cx"] * U), n(t["cy"] * U), n(t["r"] * U), style
                )
            )
        else:
            raise SystemExit("{}: unknown territory shape {}".format(sid, t["shape"]))
    out.append("</g>")
    variants = spec.get("variants", {})
    zones = spec.get("zones", [])
    objects = spec.get("objects", [])
    side = TOKEN_SIDE * U

    def size_at(x, y):
        """Anything inside a Zone is on the table only when that Zone is."""
        for z in zones:
            if abs(x - z["x"]) <= z["w"] / 2 + 0.01 and abs(y - z["y"]) <= z["h"] / 2 + 0.01:
                return legend_size(scen, z["legend"])
        return None

    def hidden_by(what):
        return [vn for vn, var in variants.items() if what in var.get("hide", [])]

    def image(name, fx, fy, s):
        return (
            f'<image href="{token_uri(name)}" x="{n(fx)}" y="{n(fy)}" '
            f'width="{n(s)}" height="{n(s)}"/>'
        )

    def zone_svg(z, v=None):
        size = legend_size(scen, z["legend"])
        w, h = z["w"] * U, z["h"] * U
        x0, y0 = z["x"] * U - w / 2, z["y"] * U - h / 2
        border = (
            'stroke-width="1.4"'
            if z.get("border") == "solid"
            else 'stroke-width=".9" stroke-dasharray="2.4,1.6"'
        )
        parts = [
            (
                '<rect x="{}" y="{}" width="{}" height="{}" fill="{}" fill-opacity=".85" '
                'stroke="#1C1A17" {}/>'
            ).format(n(x0), n(y0), n(w), n(h), legend_rgb(scen, z["legend"]), border)
        ]
        # a Zone the scenario also marks, e.g. "Secure these Zones", is ringed in that colour
        if z.get("outline"):
            parts.append(
                (
                    '<rect x="{}" y="{}" width="{}" height="{}" fill="none" stroke="{}" '
                    'stroke-width="2.2"/>'
                ).format(n(x0 - 1), n(y0 - 1), n(w + 2), n(h + 2), POINT[z["outline"]])
            )
        spots.append(
            tag(
                {
                    "t": "zone",
                    "legend": z["legend"],
                    "x": round(z["x"] / 48 * 100, 1),
                    "y": round(z["y"] / 48 * 100, 1),
                    "w": round(z["w"] / 48 * 100, 1),
                    "h": round(z["h"] / 48 * 100, 1),
                },
                size,
                v,
            )
        )
        base = z.get("features", [])
        centre_taken = any(
            abs(o["x"] - z["x"]) < 0.5 and abs(o["y"] - z["y"]) < 0.5 for o in objects
        )
        base_placed = list(zip(base, feature_slots(z, len(base), centre_taken), strict=True))
        # the Variants that change what this Zone holds, and what it holds under each
        changed = {}
        for vn, var in variants.items() if v is None else []:
            feats = list(base)
            for zf in var.get("zone_features", []):
                if z["legend"] in zf["legend"]:
                    if "add" in zf:
                        feats.append(zf["add"])
                    if "remove" in zf:
                        feats = [f for f in feats if f != zf["remove"]]
            if feats != base:
                changed[vn] = feats

        def feats_svg(placed, vv=None, hide=None):
            out_ = []
            for feat, (fx, fy) in placed:
                out_.append(image(feat, fx, fy, side))
                spots.append(
                    tag(
                        {
                            "t": "token",
                            "token": feat,
                            "x": round((fx + side / 2) / 2, 1),
                            "y": round((fy + side / 2) / 2, 1),
                            "r": round(side / 2 / 2, 1),
                        },
                        size,
                        vv,
                        hide,
                    )
                )
            return "".join(out_)

        hide = list(changed)
        base_svg = feats_svg(base_placed, v, hide)
        parts.append(f"<g{attrs(hide=hide)}>{base_svg}</g>" if hide and base_svg else base_svg)
        for vn, feats in changed.items():
            if all(f in base for f in feats):
                # only removals: what is left stays where it was
                placed = [(f, at) for f, at in base_placed if f in feats]
            else:
                placed = list(zip(feats, feature_slots(z, len(feats), centre_taken), strict=True))
            parts.append(f"<g{attrs(v=vn)}>{feats_svg(placed, vn)}</g>")
        inner = "".join(parts)
        return f"<g{attrs(size=size)}>{inner}</g>" if size else inner

    for z in zones:
        out.append(zone_svg(z))
    for vn, var in variants.items():
        if var.get("zones"):
            out.append(
                f"<g{attrs(v=vn)}>" + "".join(zone_svg(z, vn) for z in var["zones"]) + "</g>"
            )

    # Objects use the rulebook's Object token (the 401px maps only show them as dots)
    hide_objects = hidden_by("objects")
    objs = []
    for o in objects:
        size = size_at(o["x"], o["y"])
        img = image("object", o["x"] * U - side / 2, o["y"] * U - side / 2, side)
        objs.append(f"<g{attrs(size=size)}>{img}</g>" if size else img)
        spots.append(
            tag(
                {
                    "t": "token",
                    "token": "object",
                    "x": round(o["x"] / 48 * 100, 1),
                    "y": round(o["y"] / 48 * 100, 1),
                    "r": round(side / 4, 1),
                },
                size,
                None,
                hide_objects,
            )
        )
    if objs:
        out.append(
            f"<g{attrs(hide=hide_objects)}>{''.join(objs)}</g>" if hide_objects else "".join(objs)
        )

    # marked points are coloured discs, as the book prints them
    for p in spec.get("points", []):
        r = p.get("d", 2.0) / 2 * U
        dash = ' stroke-dasharray="1.6,1"' if p.get("dashed") else ""
        size = legend_size(scen, p["legend"]) if "legend" in p else size_at(p["x"], p["y"])
        hide = hidden_by("points:{}".format(p["legend"])) if "legend" in p else []
        disc = (
            '<circle cx="{}" cy="{}" r="{}" fill="{}" stroke="#1C1A17" stroke-width=".7"{}/>'
        ).format(n(p["x"] * U), n(p["y"] * U), n(r), POINT[p.get("colour", "magenta")], dash)
        out.append(f"<g{attrs(size=size, hide=hide)}>{disc}</g>" if size or hide else disc)
        spot = {
            "t": "point",
            "x": round(p["x"] / 48 * 100, 1),
            "y": round(p["y"] / 48 * 100, 1),
            "r": round(r / 2 + 0.6, 1),
        }
        if "legend" in p:
            spot["legend"] = p["legend"]
        spots.append(tag(spot, size, None, hide))

    def token_svg(t, v=None):
        s = t.get("size", TOKEN_SIDE) * U
        size = size_at(t["x"], t["y"])
        img = image(t["token"], t["x"] * U - s / 2, t["y"] * U - s / 2, s)
        spots.append(
            tag(
                {
                    "t": "token",
                    "token": t["token"],
                    "x": round(t["x"] / 48 * 100, 1),
                    "y": round(t["y"] / 48 * 100, 1),
                    "r": round(s / 4, 1),
                },
                size,
                v,
            )
        )
        return f"<g{attrs(size=size)}>{img}</g>" if size else img

    for t in spec.get("tokens", []):
        out.append(token_svg(t))
    for vn, var in variants.items():
        if var.get("tokens"):
            out.append(
                f"<g{attrs(v=vn)}>" + "".join(token_svg(t, vn) for t in var["tokens"]) + "</g>"
            )
    for a in spec.get("arrows", []):
        x1, y1, x2, y2 = a["x1"] * U, a["y1"] * U, a["x2"] * U, a["y2"] * U
        out.append(
            f'<line x1="{n(x1)}" y1="{n(y1)}" x2="{n(x2)}" y2="{n(y2)}" stroke="#1C1A17" '
            'stroke-width=".7" marker-start="url(#ah)" marker-end="url(#ah)"/>'
        )
        tx, ty = (x1 + x2) / 2, (y1 + y2) / 2
        dx, dy = (x2 - x1), (y2 - y1)
        horizontal = abs(dx) >= abs(dy)
        lx, ly = (tx, ty - 3) if horizontal else (tx + 3, ty + 2)
        anchor = "middle" if horizontal else "start"
        if "lx" in a:  # the book often sets the label beside one end rather than mid-arrow
            lx, ly, anchor = a["lx"] * U, a["ly"] * U, "middle"
        out.append(
            (
                '<text x="{}" y="{}" text-anchor="{}" font-size="6.5" font-weight="600" '
                'fill="#1C1A17" font-family="sans-serif">{}</text>'
            ).format(n(lx), n(ly), anchor, a["label"].replace('"', "&quot;"))
        )
    defs = (
        '<defs><marker id="ah" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="4" '
        'markerHeight="4" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6 Z" '
        'fill="#1C1A17"/></marker></defs>'
    )
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" '
        'width="1000" height="1000">'
        + defs
        + "".join(out)
        + '<rect x=".5" y=".5" width="199" height="199" fill="none" stroke="#B8952F" '
        'stroke-width="1.2"/></svg>\n'
    )
    os.makedirs(OUT_SPOTS, exist_ok=True)
    svg_path = os.path.join(OUT_SVG, sid + ".svg")
    with open(svg_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(svg)
    spots_path = os.path.join(OUT_SPOTS, sid + ".json")
    with open(spots_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(spots, indent=1) + "\n")
    return svg, spots


PDFS = {
    "rulebook": os.path.join(ROOT, "rules", "A5_Dropzone_3.02_Rulebook.pdf"),
    "fauna": os.path.join(ROOT, "rules", "Extra-Rules", "Fauna_Rules_Scenarios_260901.pdf"),
}


def printed(scen):
    """The map as the book prints it: its picture plus the vector Zones, tokens and points
    drawn over it. The extracted picture alone (assets/scenarios/<id>.webp) lacks those,
    so checks run against this."""
    path = os.path.join(TMP, "book-{}.png".format(scen["id"]))
    if os.path.exists(path):
        return path
    import fitz

    want = Image.open(os.path.join(ROOT, scen["map"])).convert("RGB").resize((48, 48))
    best = None
    doc = fitz.open(PDFS[scen["source"]])
    for page in doc:
        for info in page.get_image_info(xrefs=True):
            r = fitz.Rect(info["bbox"])
            if abs(r.width - r.height) >= 3 or not 150 < r.width < 400:
                continue
            pic = fitz.Pixmap(doc, info["xref"])
            if pic.alpha or pic.n > 3:
                pic = fitz.Pixmap(fitz.csRGB, pic)
            got = Image.frombytes("RGB", (pic.width, pic.height), pic.samples).resize((48, 48))
            err = sum(v * v for v in ImageStat.Stat(ImageChops.difference(got, want)).rms)
            if best is None or err < best[0]:
                best = (err, page, r)
    if best is None:
        raise SystemExit(f"no printed map found for {scen['id']}")
    _, page, r = best
    pix = page.get_pixmap(clip=r, matrix=fitz.Matrix(1000 / r.width, 1000 / r.width))
    os.makedirs(TMP, exist_ok=True)
    Image.frombytes("RGB", (pix.width, pix.height), pix.samples).resize((1000, 1000)).save(path)
    return path


def raster(scen, size):
    return Image.open(printed(scen)).convert("RGB").resize((size, size), Image.Resampling.LANCZOS)


def render_svg(svg, size):
    import fitz

    page = fitz.open(stream=svg.encode("utf-8"), filetype="svg")[0]
    z = size / page.rect.width
    pix = page.get_pixmap(matrix=fitz.Matrix(z, z))
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples).resize((size, size))


def grid(sid, scen):
    from PIL import ImageDraw

    im = raster(scen, 960)
    d = ImageDraw.Draw(im, "RGBA")
    for inch in range(0, 49, 3):
        v = inch * 20
        strong = inch % 12 == 0
        c = (
            (255, 0, 120, 160)
            if strong
            else ((255, 0, 120, 90) if inch % 6 == 0 else (255, 0, 120, 45))
        )
        d.line([(v, 0), (v, 960)], fill=c, width=2 if strong else 1)
        d.line([(0, v), (960, v)], fill=c, width=2 if strong else 1)
        if inch % 6 == 0 and 0 < inch < 48:
            d.rectangle([v + 2, 2, v + 24, 18], fill=(255, 255, 255, 220))
            d.text((v + 4, 4), str(inch), fill=(200, 0, 90))
            d.rectangle([2, v + 2, 24, v + 18], fill=(255, 255, 255, 220))
            d.text((4, v + 4), str(inch), fill=(200, 0, 90))
    os.makedirs(TMP, exist_ok=True)
    out = os.path.join(TMP, f"grid-{sid}.png")
    im.save(out)
    print(out)


def compare(sid, scen):
    svg, spots = draw(sid, scen)
    size = 640
    a, b = raster(scen, size), render_svg(svg, size)
    blend = Image.blend(a, b, 0.5)
    sheet = Image.new("RGB", (size * 3 + 20, size), "white")
    for i, im in enumerate((a, b, blend)):
        sheet.paste(im, (i * (size + 10), 0))
    os.makedirs(TMP, exist_ok=True)
    out = os.path.join(TMP, f"compare-{sid}.png")
    sheet.save(out)
    print(out, "(book | redraw | both at half strength)", len(spots), "spots")


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    cmd, sid = sys.argv[1], sys.argv[2]
    scens = load_scenarios()
    if cmd == "draw" and sid == "all":
        bundle, effects = {}, {}
        for f in sorted(os.listdir(SPECS)):
            if f.endswith(".json"):
                _, spots = draw(f[:-5], scens[f[:-5]])
                bundle[f[:-5]] = spots
                with open(os.path.join(SPECS, f), encoding="utf-8") as fh:
                    variants = json.load(fh).get("variants", {})
                effects[f[:-5]] = {
                    vn: {k: var[k] for k in ("strike", "objective") if k in var}
                    for vn, var in variants.items()
                }
                print(f"{f[:-5]:<24} {len(spots)} spots")
        # the scenarios page reads every redrawn map's spots from one file
        js = (
            "// Generated by tools/dzc/draw_scenario_maps.py draw all. Do not edit by hand.\n"
            "const DZ_MAP_SPOTS={};\n".format(json.dumps(bundle, separators=(",", ":")))
            + "const DZ_MAP_VARIANTS={};\n".format(json.dumps(effects, separators=(",", ":")))
        )
        bundle_path = os.path.join(ROOT, "scenarios", "dzc-scenario-hotspots.js")
        with open(bundle_path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(js)
        print(f"{len(bundle)} redrawn maps -> scenarios/dzc-scenario-hotspots.js")
        return
    if sid not in scens:
        sys.exit(f"no scenario {sid}")
    {"grid": grid, "draw": lambda s, sc: print(len(draw(s, sc)[1]), "spots"), "compare": compare}[
        cmd
    ](sid, scens[sid])


if __name__ == "__main__":
    main()
