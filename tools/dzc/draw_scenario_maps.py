#!/usr/bin/env python3
"""Redraw the Dropzone scenario maps as SVG from a spec in inches.

    python tools/dzc/draw_scenario_maps.py grid <id>      map with an inch grid, to read positions from
    python tools/dzc/draw_scenario_maps.py draw <id|all>  write assets/scenarios/<id>.svg + data/dzc/scenario-hotspots/<id>.json
    python tools/dzc/draw_scenario_maps.py compare <id>   the book's map beside the redraw, to check it

The book's maps are pictures (401px from the rulebook, 1201px from the Fauna
pack). Each is described in data/dzc/scenario-maps/<id>.json, in inches on the
48" table, x from the left edge and y from the top:

  territories  [{"colour": "blue"|"red", "shape": "rect", "x", "y", "w", "h"}
                | {"colour", "shape": "circle", "cx", "cy", "r"}]      circles are clipped to the table
  lines        [{"x1", "y1", "x2", "y2", "style": "dashed"|"solid", "colour"?}]   centre lines, diagonals
  zones        [{"legend": n, "x", "y", "w", "h", "features": ["railgun-turret", ...]}]
               x, y the Zone's centre; legend = index of its entry in scenarios.json, which gives
               its colour; features are token names from assets/tokens, drawn in the Zone's corners
               (top right, bottom left, top left, bottom right) as the book draws them
  objects      [{"x", "y"}]                                         Object tokens
  points       [{"x", "y", "colour": "magenta"|..., "legend"?: n}]  marked points
  tokens       [{"token", "x", "y", "size"?}]                       a token placed on its own
  arrows       [{"x1", "y1", "x2", "y2", "label", "lx"?, "ly"?}]     measurements; lx/ly place the label

Images and compares go to the system temp folder.
"""
import base64
import io
import json
import os
import sys
import tempfile

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SPECS = os.path.join(ROOT, 'data', 'dzc', 'scenario-maps')
SCEN = os.path.join(ROOT, 'data', 'dzc', 'scenarios.json')
TOKENS = os.path.join(ROOT, 'assets', 'tokens')
OUT_SVG = os.path.join(ROOT, 'assets', 'scenarios')
OUT_SPOTS = os.path.join(ROOT, 'data', 'dzc', 'scenario-hotspots')
TMP = os.path.join(tempfile.gettempdir(), 'dzc-maps')

U = 200 / 48          # SVG units per inch on a 200-unit table
TERRITORY = {'blue': '#6FB0E8', 'red': '#E06A6A', 'green': '#6CCB6C', 'yellow': '#E8D35A'}
POINT = {'magenta': '#E052C8', 'red': '#D83A3A', 'green': '#3E9E4E', 'yellow': '#D9B020', 'blue': '#2F7FD0'}
TOKEN_SIDE = 2.2      # inches, a Feature token in a Zone corner


def n(v):
    return ('%.2f' % v).rstrip('0').rstrip('.')


def load_scenarios():
    return {s['id']: s for s in json.load(io.open(SCEN, encoding='utf-8'))['scenarios']}


def legend_rgb(scen, i):
    L = scen['legend'][i]
    if not L.get('rgb'):
        raise SystemExit('%s: legend %d has no colour' % (scen['id'], i))
    return 'rgb(%s)' % ','.join(str(round(v * 255)) for v in L['rgb'])


_token_cache = {}


def token_uri(name):
    if name not in _token_cache:
        path = os.path.join(TOKENS, name + '.webp')
        if not os.path.exists(path):
            svg = os.path.join(TOKENS, name + '.svg')
            if not os.path.exists(svg):
                raise SystemExit('no token %s' % name)
            # a vector token (the Hive) goes in as a picture too, so every renderer shows it
            import fitz
            page = fitz.open(svg)[0]
            z = 96 / page.rect.width
            pix = page.get_pixmap(matrix=fitz.Matrix(z, z), alpha=True)
            im = Image.frombytes('RGBA', (pix.width, pix.height), pix.samples)
        else:
            im = Image.open(path).convert('RGBA')
        im = im.resize((96, 96), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, 'PNG', optimize=True)
        _token_cache[name] = 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()
    return _token_cache[name]


def draw(sid, scen):
    spec = json.load(io.open(os.path.join(SPECS, sid + '.json'), encoding='utf-8'))
    out, spots = [], []
    out.append('<rect width="200" height="200" fill="#f4efe8"/>')
    out.append('<clipPath id="tbl"><rect width="200" height="200"/></clipPath><g clip-path="url(#tbl)">')
    for t in spec.get('territories', []):
        fill = TERRITORY[t['colour']]
        style = 'fill="%s" fill-opacity=".55" stroke="#1C1A17" stroke-width=".8" stroke-dasharray="3,2"' % fill
        if t['shape'] == 'rect':
            out.append('<rect x="%s" y="%s" width="%s" height="%s" %s/>' % (n(t['x'] * U), n(t['y'] * U), n(t['w'] * U), n(t['h'] * U), style))
        elif t['shape'] == 'circle':
            out.append('<circle cx="%s" cy="%s" r="%s" %s/>' % (n(t['cx'] * U), n(t['cy'] * U), n(t['r'] * U), style))
        else:
            raise SystemExit('%s: unknown territory shape %s' % (sid, t['shape']))
    out.append('</g>')
    for ln in spec.get('lines', []):
        dash = ' stroke-dasharray="4,3"' if ln.get('style', 'dashed') == 'dashed' else ''
        col = ln.get('colour', '#6b6660')
        out.append('<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="%s" stroke-width="%s"%s/>' % (
            n(ln['x1'] * U), n(ln['y1'] * U), n(ln['x2'] * U), n(ln['y2'] * U), col, '.6' if dash else '.8', dash))
    for z in spec.get('zones', []):
        w, h = z['w'] * U, z['h'] * U
        x0, y0 = z['x'] * U - w / 2, z['y'] * U - h / 2
        out.append('<rect x="%s" y="%s" width="%s" height="%s" fill="%s" fill-opacity=".85" stroke="#1C1A17" stroke-width=".9" stroke-dasharray="2.4,1.6"/>' % (
            n(x0), n(y0), n(w), n(h), legend_rgb(scen, z['legend'])))
        spots.append({'t': 'zone', 'legend': z['legend'], 'x': round(z['x'] / 48 * 100, 1), 'y': round(z['y'] / 48 * 100, 1),
                      'w': round(z['w'] / 48 * 100, 1), 'h': round(z['h'] / 48 * 100, 1)})
        side = TOKEN_SIDE * U
        pad = .35 * U
        corners = [(x0 + w - side - pad, y0 + pad), (x0 + pad, y0 + h - side - pad), (x0 + pad, y0 + pad), (x0 + w - side - pad, y0 + h - side - pad)]
        for i, feat in enumerate(z.get('features', [])):
            fx, fy = corners[i % 4]
            out.append('<image href="%s" x="%s" y="%s" width="%s" height="%s"/>' % (token_uri(feat), n(fx), n(fy), n(side), n(side)))
            spots.append({'t': 'token', 'token': feat, 'x': round((fx + side / 2) / 2, 1), 'y': round((fy + side / 2) / 2, 1), 'r': round(side / 2 / 2, 1)})
    # Objects and marked points use the rulebook's own tokens (the 401px maps only show them as dots)
    for kind, tok in (('objects', 'object'), ('points', 'secure-point')):
        for o in spec.get(kind, []):
            side = TOKEN_SIDE * U
            fx, fy = o['x'] * U - side / 2, o['y'] * U - side / 2
            out.append('<image href="%s" x="%s" y="%s" width="%s" height="%s"/>' % (token_uri(tok), n(fx), n(fy), n(side), n(side)))
            spot = {'t': 'token', 'token': tok, 'x': round(o['x'] / 48 * 100, 1), 'y': round(o['y'] / 48 * 100, 1), 'r': round(side / 4, 1)}
            if 'legend' in o:
                spot['legend'] = o['legend']
            spots.append(spot)
    for t in spec.get('tokens', []):
        side = t.get('size', TOKEN_SIDE) * U
        fx, fy = t['x'] * U - side / 2, t['y'] * U - side / 2
        out.append('<image href="%s" x="%s" y="%s" width="%s" height="%s"/>' % (token_uri(t['token']), n(fx), n(fy), n(side), n(side)))
        spots.append({'t': 'token', 'token': t['token'], 'x': round(t['x'] / 48 * 100, 1), 'y': round(t['y'] / 48 * 100, 1), 'r': round(side / 4, 1)})
    for a in spec.get('arrows', []):
        x1, y1, x2, y2 = a['x1'] * U, a['y1'] * U, a['x2'] * U, a['y2'] * U
        out.append('<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="#1C1A17" stroke-width=".7" marker-start="url(#ah)" marker-end="url(#ah)"/>' % (n(x1), n(y1), n(x2), n(y2)))
        tx, ty = (x1 + x2) / 2, (y1 + y2) / 2
        dx, dy = (x2 - x1), (y2 - y1)
        horizontal = abs(dx) >= abs(dy)
        lx, ly = (tx, ty - 3) if horizontal else (tx + 3, ty + 2)
        anchor = 'middle' if horizontal else 'start'
        if 'lx' in a:   # the book often sets the label beside one end rather than mid-arrow
            lx, ly, anchor = a['lx'] * U, a['ly'] * U, 'middle'
        out.append('<text x="%s" y="%s" text-anchor="%s" font-size="6.5" font-weight="600" fill="#1C1A17" font-family="sans-serif">%s</text>' % (n(lx), n(ly), anchor, a['label'].replace('"', '&quot;')))
    defs = '<defs><marker id="ah" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6 Z" fill="#1C1A17"/></marker></defs>'
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="1000" height="1000">' + defs + ''.join(out) +
           '<rect x=".5" y=".5" width="199" height="199" fill="none" stroke="#B8952F" stroke-width="1.2"/></svg>\n')
    os.makedirs(OUT_SPOTS, exist_ok=True)
    io.open(os.path.join(OUT_SVG, sid + '.svg'), 'w', encoding='utf-8', newline='\n').write(svg)
    io.open(os.path.join(OUT_SPOTS, sid + '.json'), 'w', encoding='utf-8', newline='\n').write(json.dumps(spots, indent=1) + '\n')
    return svg, spots


def raster(scen, size):
    return Image.open(os.path.join(ROOT, scen['map'])).convert('RGB').resize((size, size), Image.LANCZOS)


def render_svg(svg, size):
    import fitz
    page = fitz.open(stream=svg.encode('utf-8'), filetype='svg')[0]
    z = size / page.rect.width
    pix = page.get_pixmap(matrix=fitz.Matrix(z, z))
    return Image.frombytes('RGB', (pix.width, pix.height), pix.samples).resize((size, size))


def grid(sid, scen):
    from PIL import ImageDraw
    im = raster(scen, 960)
    d = ImageDraw.Draw(im, 'RGBA')
    for inch in range(0, 49, 3):
        v = inch * 20
        strong = inch % 12 == 0
        c = (255, 0, 120, 160) if strong else ((255, 0, 120, 90) if inch % 6 == 0 else (255, 0, 120, 45))
        d.line([(v, 0), (v, 960)], fill=c, width=2 if strong else 1)
        d.line([(0, v), (960, v)], fill=c, width=2 if strong else 1)
        if inch % 6 == 0 and 0 < inch < 48:
            d.rectangle([v + 2, 2, v + 24, 18], fill=(255, 255, 255, 220)); d.text((v + 4, 4), str(inch), fill=(200, 0, 90))
            d.rectangle([2, v + 2, 24, v + 18], fill=(255, 255, 255, 220)); d.text((4, v + 4), str(inch), fill=(200, 0, 90))
    os.makedirs(TMP, exist_ok=True)
    out = os.path.join(TMP, 'grid-%s.png' % sid)
    im.save(out)
    print(out)


def compare(sid, scen):
    svg, spots = draw(sid, scen)
    size = 640
    a, b = raster(scen, size), render_svg(svg, size)
    blend = Image.blend(a, b, .5)
    sheet = Image.new('RGB', (size * 3 + 20, size), 'white')
    for i, im in enumerate((a, b, blend)):
        sheet.paste(im, (i * (size + 10), 0))
    os.makedirs(TMP, exist_ok=True)
    out = os.path.join(TMP, 'compare-%s.png' % sid)
    sheet.save(out)
    print(out, '(book | redraw | both at half strength)', len(spots), 'spots')


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    cmd, sid = sys.argv[1], sys.argv[2]
    scens = load_scenarios()
    if cmd == 'draw' and sid == 'all':
        bundle = {}
        for f in sorted(os.listdir(SPECS)):
            if f.endswith('.json'):
                _, spots = draw(f[:-5], scens[f[:-5]])
                bundle[f[:-5]] = spots
                print('%-24s %d spots' % (f[:-5], len(spots)))
        # the scenarios page reads every redrawn map's spots from one file
        js = ('// Generated by tools/dzc/draw_scenario_maps.py draw all. Do not edit by hand.\n'
              'const DZ_MAP_SPOTS=%s;\n' % json.dumps(bundle, separators=(',', ':')))
        io.open(os.path.join(ROOT, 'scenarios', 'dzc-scenario-hotspots.js'), 'w', encoding='utf-8', newline='\n').write(js)
        print('%d redrawn maps -> scenarios/dzc-scenario-hotspots.js' % len(bundle))
        return
    if sid not in scens:
        sys.exit('no scenario %s' % sid)
    {'grid': grid, 'draw': lambda s, sc: print(len(draw(s, sc)[1]), 'spots'), 'compare': compare}[cmd](sid, scens[sid])


if __name__ == '__main__':
    main()
