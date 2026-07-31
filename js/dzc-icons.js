/* Material Symbols, inlined.
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
    print: 'M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z',
    share: 'M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z',
    settings: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z',

    // — status —
    error: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z',
    warning: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
    check_circle: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
    info: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
    lock: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z',

    // — domain —
    // Group / activation unit. "layers" reads as a stack of things acting together.
    layers: 'M11.99 18.54 4.62 12.81 3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z',
    // Transport. Material "local_shipping".
    local_shipping: 'M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9 1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
    // Commander. Material "military_tech".
    military_tech: 'M12 2c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3zm0 8-3.5 2.5V22l3.5-2 3.5 2v-9.5L12 10z',
    // Army / roster list.
    list_alt: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 11h2v2H7zm0-4h2v2H7zm0 8h2v2H7zm4-8h6v2h-6zm0 4h6v2h-6zm0 4h6v2h-6z',
    // Points / cost.
    calculate: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM7 7h4v2H7V7zm10 10h-4v-2h4v2zm0-4h-4v-2h4v2zm-6 4H7v-2h4v2zm0-4H7v-2h4v2z'
  };

  function icon(name, opts) {
    const o = opts || {};
    const d = P[name];
    if (!d) return '';
    const s = o.size || 20;
    return `<svg class="dzc-i${o.className ? ' ' + o.className : ''}" width="${s}" height="${s}"`
      + ` viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
  }

  /* Firing arcs, drawn rather than spelled out.
   *
   * Dropzone arcs are 90-degree WEDGES (6.1.2) and split the sides into Left
   * and Right, so Dropfleet's arc icons carry over neither in shape nor in
   * vocabulary. Four quadrants of a circle, front at the top, with the covered
   * ones filled — "F/Sl" is instantly a different picture from "F/Sr", which
   * is the whole reason to draw it.
   *
   * The wedge endpoints are the circle's diagonals: cos/sin of 45 degrees on
   * r=10 is 7.07, hence 12±7.07.
   */
  const WEDGE = {
    F: 'M12 12 L4.93 4.93 A10 10 0 0 1 19.07 4.93 Z',
    Sr: 'M12 12 L19.07 4.93 A10 10 0 0 1 19.07 19.07 Z',
    R: 'M12 12 L19.07 19.07 A10 10 0 0 1 4.93 19.07 Z',
    Sl: 'M12 12 L4.93 19.07 A10 10 0 0 1 4.93 4.93 Z'
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
    const wedges = Object.keys(WEDGE).map(k =>
      `<path d="${WEDGE[k]}" fill="${parts.indexOf(k) !== -1 ? 'currentColor' : 'none'}"` +
      ` opacity="${parts.indexOf(k) !== -1 ? '1' : '.18'}"/>`).join('');
    return `<span class="dzc-arc" title="${title}" aria-label="Arc: ${title}">`
      + `<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true">`
      + `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>`
      + wedges
      + `</svg></span>`;
  }

  icon.has = n => Object.prototype.hasOwnProperty.call(P, n);
  icon.names = () => Object.keys(P);
  icon.arc = arc;
  icon.arcLabel = spec => (ARC_PARTS[String(spec || '').trim()] || [])
    .map(p => ARC_LABEL[p]).join(', ');
  window.DZCIcon = icon;
})();
