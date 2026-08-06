/* Material Symbols, inlined.
 *
 * Copyright Google LLC. Used under the Apache License, Version 2.0:
 * https://www.apache.org/licenses/LICENSE-2.0
 * Attribution also appears in the app, under Settings -> About.
 *
 * The six stat_* paths are NOT Material — they are drawn for this app.
 *
 * INLINED ON PURPOSE. Loading an icon font or SVG sprite from a CDN would
 * break the app at a table with no signal, which is the one place it has to
 * work. Same reasoning as the mobile app's existing ICON_PATHS map.
 *
 * All paths are Material Symbols / Material Icons on a 24x24 viewBox, Apache
 * 2.0. See ICONS.md for the review list, what each one is used for, and which
 * ones are placeholders awaiting a better pick.
 *
 *   DZCIcon('add')                  -> <svg>…</svg>
 *   DZCIcon('delete', { size: 18 }) -> sized
 */
(function () {
  'use strict';

  const P = {
    // — actions —
    add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
    remove: 'M19 13H5v-2h14v2z',
    close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
    delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    search: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
    arrow_back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
    content_copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
    more_vert: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
    print: 'M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z',
    share: 'M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z',
    // Supplied by Jet. A cog with a real aperture rather than Material's
    // filled-in one, and its own 26-unit box.
    settings: {
      box: '0 0 26 26',
      d: 'm11.469.969l-.563 3.562A8.7 8.7 0 0 0 8.5 5.5L5.562 3.406L3.438 5.531L5.5 8.47a8.8 8.8 0 0 0-1 2.406l-3.531.594v3l3.531.625a8.7 8.7 0 0 0 1 2.406l-2.094 2.938l2.125 2.125L8.47 20.5a8.7 8.7 0 0 0 2.406.969l.594 3.562h3l.656-3.562a8.6 8.6 0 0 0 2.375-1l2.969 2.093l2.125-2.125L20.47 17.5c.438-.73.79-1.526 1-2.375l3.562-.656v-3l-3.562-.594a8.8 8.8 0 0 0-1-2.375l2.093-2.969l-2.125-2.125L17.5 5.531a8.8 8.8 0 0 0-2.406-1L14.469.97zM13 6.469A6.535 6.535 0 0 1 19.531 13A6.535 6.535 0 0 1 13 19.531A6.536 6.536 0 0 1 6.469 13A6.536 6.536 0 0 1 13 6.469m0 1.593A4.95 4.95 0 0 0 8.062 13A4.95 4.95 0 0 0 13 17.938A4.95 4.95 0 0 0 17.938 13A4.95 4.95 0 0 0 13 8.062m-.031 2.876c1.146 0 2.094.915 2.094 2.062s-.948 2.063-2.094 2.063A2.054 2.054 0 0 1 10.906 13c0-1.147.917-2.063 2.063-2.063z'
    },

    // — status —
    error: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z',
    warning: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
    check_circle: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
    info: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
    lock: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z',

    // — stats —
    // Geometric, not pictorial, and deliberately echoing the Dropfleet stat
    // language: an arrow for movement, a hexagon for the damage track. Armour
    // and Defence are a solid vs an outline shield so the pair reads as one
    // idea with two weights.
    // Move — a route between two nodes. Supplied by Jet.
    stat_mv: {
      box: '0 0 512 512',
      d: 'M426.667 96c0 5.891-4.777 10.667-10.667 10.667S405.333 101.891 405.333 96S410.11 85.333 416 85.333S426.667 90.11 426.667 96m42.666 0c0 29.455-23.878 53.333-53.333 53.333S362.667 125.455 362.667 96S386.545 42.667 416 42.667S469.333 66.545 469.333 96M106.667 416c0 5.89-4.776 10.667-10.667 10.667c-5.89 0-10.667-4.777-10.667-10.667S90.11 405.333 96 405.333s10.667 4.777 10.667 10.667m42.666 0c0 29.455-23.878 53.333-53.333 53.333S42.667 445.455 42.667 416S66.545 362.667 96 362.667s53.333 23.878 53.333 53.333M320 222.17L164.418 377.751l-30.17-30.169L289.83 192h-55.163v-42.667h128v128H320z'
    },
    // Infantry move on foot, so they get a shoe rather than a route.
    // Phosphor sneaker-move-fill, MIT, inlined at author time.
    stat_mv_infantry: {
      box: '0 0 256 256',
      d: 'M70.8 184H32a8 8 0 0 1 0-16h38.8a8 8 0 1 1 0 16m32 16H48a8 8 0 0 0 0 16h54.8a8 8 0 1 0 0-16m128.36-33.37l-28.63-14.31A47.74 47.74 0 0 1 176 109.39V80a8 8 0 0 0-7.93-8A48.05 48.05 0 0 1 120 24.07a8 8 0 0 0-12.83-6.44L45.11 64.68a4 4 0 0 0-.41 6l51.44 51.44a8.19 8.19 0 0 1 .6 11.09a8 8 0 0 1-11.71.43l-53-53a4 4 0 0 0-6.44 1.09a16 16 0 0 0 3.12 18.22L142.4 213.66a8 8 0 0 0 5.66 2.34H224a16 16 0 0 0 16-16v-19.06a15.92 15.92 0 0 0-8.84-14.31'
    },
    stat_a: 'M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z',
    stat_dp: 'M12 2 21 7v10l-9 5-9-5V7l9-5z',
    // Power — a Behemoth's activation currency (Behemoth rules 1.2). A bolt,
    // because it is spent and replenished rather than compared: the other five
    // stats say what a Unit IS, this one says what it has left.
    stat_power: 'M13 2 4 14h6l-1 8 9-12h-6l1-8z',
    // Offence — a soldier firing. Supplied by Jet; carries its own 640 box.
    stat_of: {
      box: '0 0 640 640',
      d: 'M480 64h-32c-8.8 0-16 7.2-16 16s7.2 16 16 16v100.3c-9.6 5.5-16 15.9-16 27.7v32c-17.7 0-32 14.3-32 32v144c0 17.7 14.3 32 32 32h16v96c0 8.8 7.2 16 16 16h59.5c10.4 0 18-9.8 15.5-19.9L516 464h44c8.8 0 16-7.2 16-16v-16c0-8.8-7.2-16-16-16h-48v-26.7l53.1-17.7c6.5-2.2 10.9-8.3 10.9-15.2v-84.5c0-8.8-7.2-16-16-16h-16c-8.8 0-16 7.2-16 16v56l-16 5.3V223.9c0-11.8-6.4-22.2-16-27.7V80c0-8.8-7.2-16-16-16M288 272c-106 0-192 86-192 192v48c0 17.7 14.3 32 32 32s32-14.3 32-32v-48c0-32.5 12.1-62.1 32-84.7V576h160V282.9c-20-7.1-41.6-10.9-64-10.9m56-120c0-39.8-32.2-72-72-72s-72 32.2-72 72s32.2 72 72 72s72-32.2 72-72'
    },
    stat_df: 'M12 2 4 5.5v5.9c0 4.9 3.4 9.5 8 10.6 4.6-1.1 8-5.7 8-10.6V5.5L12 2zm0 2.2 6 2.6v4.6c0 3.8-2.5 7.4-6 8.5-3.5-1.1-6-4.7-6-8.5V6.8l6-2.6z',
    // Bravery — a banner. Phosphor flag-banner-fold-fill, MIT, inlined from
    // the Iconify API at author time. Never fetched at runtime: a CDN icon is
    // a blank square at a table with no signal.
    stat_b: {
      box: '0 0 256 256',
      d: 'm131.79 69.65l-43.63 96a4 4 0 0 1-3.64 2.35H28.23a8.2 8.2 0 0 1-6.58-3.13a8 8 0 0 1 .43-10.25L57.19 116L22.08 77.38a8 8 0 0 1-.43-10.26A8.22 8.22 0 0 1 28.23 64h99.92a4 4 0 0 1 3.64 5.65m105.77-27.41a8.3 8.3 0 0 0-5.79-2.24H168a8 8 0 0 0-7.28 4.69l-42.57 93.65a4 4 0 0 0 3.64 5.66h57.79l-34.86 76.69a8 8 0 1 0 14.56 6.62l80-176a8 8 0 0 0-1.72-9.07'
    },

    // — domain —
    // Group / activation unit. "layers" reads as a stack of things acting together.
    layers: 'M11.99 18.54 4.62 12.81 3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z',
    // Transport. Material "local_shipping".
    local_shipping: 'M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9 1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
    // Commander. Material "military_tech".
    military_tech: 'M12 2c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3zm0 8-3.5 2.5V22l3.5-2 3.5 2v-9.5L12 10z',
    // Army / roster list.
    list_alt: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 11h2v2H7zm0-4h2v2H7zm0 8h2v2H7zm4-8h6v2h-6zm0 4h6v2h-6zm0 4h6v2h-6z',
    grid_view: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    // Points / cost.
    calculate: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM7 7h4v2H7V7zm10 10h-4v-2h4v2zm0-4h-4v-2h4v2zm-6 4H7v-2h4v2zm0-4H7v-2h4v2z',
    // Squads. Material "groups".
    groups: 'M4 13c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm1.13 1.1c-.37-.06-.74-.1-1.13-.1-.99 0-1.93.21-2.78.58C.48 14.9 0 15.62 0 16.43V18h4.5v-1.61c0-.83.23-1.61.63-2.29zM20 13c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm4 3.43c0-.81-.48-1.53-1.22-1.85-.85-.37-1.79-.58-2.78-.58-.39 0-.76.04-1.13.1.4.68.63 1.46.63 2.29V18H24v-1.57zM16.24 12.65c-1.17-.52-2.61-.9-4.24-.9-1.63 0-3.07.39-4.24.9C6.68 13.13 6 14.21 6 15.39V18h12v-2.61c0-1.18-.68-2.26-1.76-2.74zM12 10c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3z',
    // Models on the table. Material "deployed_code" — a single miniature reads
    // as one box you actually own and have to carry to the game.
    deployed_code: 'M12 2 3 7v10l9 5 9-5V7l-9-5zm0 2.3 6.5 3.61L12 11.52 5.5 7.91 12 4.3zM5 9.6l6 3.33v6.47l-6-3.33V9.6zm8 9.8v-6.47l6-3.33v6.47l-6 3.33z'
  };

  /* Most paths are Material on a 24x24 grid. A few come from elsewhere and
   * carry their own box, so an entry may be either a path string or
   * { d, box }. */
  const BOX = '0 0 24 24';

  function icon(name, opts) {
    const o = opts || {};
    const e = P[name];
    if (!e) return '';
    const d = typeof e === 'string' ? e : e.d;
    const box = typeof e === 'string' ? BOX : (e.box || BOX);
    const s = o.size || 20;
    return `<svg class="dzc-i${o.className ? ' ' + o.className : ''}" width="${s}" height="${s}"`
      + ` viewBox="${box}" fill="currentColor" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
  }

  /* Firing arcs, drawn rather than spelled out.
   *
   * Dropzone arcs are 90-degree WEDGES (6.1.2) and split the sides into Left
   * and Right, so Dropfleet's arc icons carry over neither in shape nor in
   * vocabulary. Four quadrants of a circle, front at the top, with the covered
   * ones filled — "F/Sl" is instantly a different picture from "F/Sr", which
   * is the whole reason to draw it.
   *
   * Each wedge is inset 3 degrees from the diagonals it shares, so 84 degrees
   * of ink with 6 degrees of paper between. They used to meet exactly on the
   * diagonal, which meant two lit wedges fused into one shape with no boundary
   * at all — "F/S" read as a single 270-degree blob and told you nothing that
   * "F/S/R" did not. Uily spotted it: the separators were not visible enough.
   *
   * Cut into the geometry rather than drawn over it with a background-coloured
   * stroke, because the background is not one colour — paper, the tinted band
   * on a live row, the dark theme — and a gap is a gap on all of them.
   *
   * Endpoints are cos/sin on r=10 about (12,12), y inverted: 48 degrees gives
   * 12±6.69 and 12∓7.43, 42 degrees the same pair the other way round.
   */
  const WEDGE = {
    F: 'M12 12 L5.31 4.57 A10 10 0 0 1 18.69 4.57 Z',
    Sr: 'M12 12 L19.43 5.31 A10 10 0 0 1 19.43 18.69 Z',
    R: 'M12 12 L18.69 19.43 A10 10 0 0 1 5.31 19.43 Z',
    Sl: 'M12 12 L4.57 18.69 A10 10 0 0 1 4.57 5.31 Z'
  };

  const ARC_PARTS = {
    'F': ['F'],
    'F/S': ['F', 'Sl', 'Sr'],
    'F/S/R': ['F', 'Sl', 'Sr', 'R'],
    'F/Sl': ['F', 'Sl'],
    'F/Sr': ['F', 'Sr'],
    'F/R': ['F', 'R'],
    'S': ['Sl', 'Sr'],
    'R': ['R']
  };

  const ARC_LABEL = {
    F: 'Front', Sl: 'Side Left', Sr: 'Side Right', R: 'Rear'
  };

  function arc(spec, opts) {
    const key = String(spec || '').trim();
    const parts = ARC_PARTS[key];
    if (!parts) return '';
    const s = (opts && opts.size) || 20;
    const title = parts.map(p => ARC_LABEL[p]).join(', ');
    // An unlit wedge is drawn, not omitted: "which quarters" is only readable
    // against the ones it is not. At .18 it was close enough to nothing that
    // the icon read as a shape floating on its own.
    const wedges = Object.keys(WEDGE).map(k =>
      `<path d="${WEDGE[k]}" fill="currentColor"` +
      ` opacity="${parts.indexOf(k) !== -1 ? '1' : '.22'}"/>`).join('');
    return `<span class="dzc-arc" title="${title}" aria-label="Arc: ${title}">`
      + `<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true">`
      + `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>`
      + wedges
      + `</svg></span>`;
  }

  /* A stat's icon, by the key the stat cards print (Mv, A, DP, OF, DF, B).
   * Pass the unit type so Infantry get the shoe rather than the route. */
  icon.stat = (key, opts) => {
    const k = String(key || '').toLowerCase();
    const type = String((opts && opts.type) || '');
    const name = (k === 'mv' && /infantry/i.test(type)) ? 'stat_mv_infantry' : 'stat_' + k;
    return icon(name, opts);
  };

  /* Move & Attack: the lance over the route, turned a quarter so the two do
   * not read as the same mark twice. Two source drawings on different grids,
   * so the route is scaled and rotated into the lance's 24-unit box. */
  const MA_ROUTE = P.stat_mv.d;
  const MA_LANCE = 'M22.732.012h-5.174l-.366.366L5.195 12.374L4.14 11.318l-1.768 1.768l1.97 1.97l-3.81 3.812l-.367.366v4.596H4.76l.366-.366l3.812-3.812l1.97 1.97l1.768-1.767l-1.056-1.056L23.616 6.802l.366-.366V.012zM9.852 17.03l-2.889-2.889l11.63-11.63h2.89V5.4z';
  icon.moveAttack = (opts) => {
    const s = (opts && opts.size) || 20;
    return `<svg class="dzc-i" width="${s}" height="${s}" viewBox="0 0 24 24"`
      + ` fill="currentColor" aria-hidden="true" focusable="false">`
      + `<g transform="translate(12 12) rotate(90) scale(0.046875) translate(-256 -256)" opacity=".45">`
      + `<path d="${MA_ROUTE}"/></g>`
      + `<path d="${MA_LANCE}"/></svg>`;
  };

  icon.has = n => Object.prototype.hasOwnProperty.call(P, n);
  icon.names = () => Object.keys(P);
  icon.arc = arc;
  icon.arcLabel = spec => (ARC_PARTS[String(spec || '').trim()] || [])
    .map(p => ARC_LABEL[p]).join(', ');
  window.DZCIcon = icon;
})();
