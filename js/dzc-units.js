/* DZC unit reference — the first screen rendered from data/dzc/.
 *
 * Deliberately its own file rather than more of app.js: app.js is 9,600 lines
 * of Dropfleet domain logic that is being retired, and nothing here should
 * inherit from it. This is the seed of the Dropzone app.
 *
 * Reads the canonical scanner output through js/dzc-data.js. No translation
 * layer, no Dropfleet field names.
 */
(function () {
  'use strict';

  const FACTIONS = [
    { id: 'ucm', name: 'UCM', full: 'United Colonies of Mankind', accent: '#30903c' },
    { id: 'phr', name: 'PHR', full: 'Post-Human Republic', accent: '#c9a92c' },
    { id: 'scourge', name: 'Scourge', full: 'Scourge', accent: '#60489c' },
    { id: 'shaltari', name: 'Shaltari', full: 'Shaltari', accent: '#e46024' },
    { id: 'resistance', name: 'Resistance', full: 'Resistance', accent: '#3c84c0' },
    { id: 'bioficer', name: 'Bioficers', full: 'Bioficers', accent: '#9c1818' }
  ];

  // Force-organisation order (rulebook 3.2). Generated units are produced in
  // play and can never be chosen, so they sort last and say so.
  const CATEGORIES = ['Standard', 'Vanguard', 'Heavy', 'Support', 'Transport', 'Generated'];

  // The six transport symbols. Colour is 1:1 with shape on the cards; it is
  // reproduced here because it is how a player recognises them at a glance.
  const SYMBOL = {
    square:          { ink: '#00a04d', path: 'M3 3h18v18H3z' },
    diamond:         { ink: '#e8b233', path: 'M12 2l10 10-10 10L2 12z' },
    triangle:        { ink: '#be1622', path: 'M12 2l11 19H1z' },
    'triangle-down': { ink: '#662483', path: 'M12 22L1 3h22z' },
    circle:          { ink: '#3b8ac9', path: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z' },
    pentagon:        { ink: '#e94e1b', path: 'M12 2l10 7.3-3.8 11.7H5.8L2 9.3z' }
  };

  let state = { faction: 'ucm', search: '', category: 'All' };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* The bare glyph, no count. The Group header and the picker's shape chips
   * both draw the symbols on their own, and both must use the same path and
   * the same ink as the badges -- the shape IS the vocabulary (3.2.4.2), so a
   * second set drawn slightly differently would read as a different symbol. */
  function shapeSvg(shape, size, hollow) {
    const s = SYMBOL[shape];
    if (!s) return '';
    const px = size || 14;
    return `<svg viewBox="0 0 24 24" width="${px}" height="${px}" aria-hidden="true"><path d="${s.path}"
      fill="${hollow ? 'none' : s.ink}" stroke="${s.ink}" stroke-width="3" stroke-linejoin="round"/></svg>`;
  }

  /* A transport badge. Hollow = capacity this unit OFFERS, solid = space it
   * FILLS aboard something else. A unit can print both. */
  function badge(shape, n, hollow) {
    const s = SYMBOL[shape];
    if (!s) return '';
    const label = `${hollow ? 'Carries' : 'Takes up'} ${n} ${shape.replace('-', ' ')}`;
    return `<span class="dzc-badge" title="${esc(label)}" aria-label="${esc(label)}">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path d="${s.path}" fill="${hollow ? 'none' : s.ink}" stroke="${s.ink}" stroke-width="2.5" stroke-linejoin="round"/>
      </svg><span class="dzc-badge-n" style="color:${hollow ? s.ink : '#fff'}">${esc(n)}</span></span>`;
  }

  function transportHtml(u) {
    const t = u.transport || {};
    const cap = (t.capacity || []).map(c => badge(c.shape, c.n, true));
    const fills = (t.fills || []).map(c => badge(c.shape, c.n, false));
    if (!cap.length && !fills.length) return '';
    // "+" carries both shapes at once; "/" is either but never a mixture.
    const joiner = t.capacityMode === 'both' ? '+' : t.capacityMode === 'either' ? '/' : '';
    const capStr = cap.join(joiner ? `<span class="dzc-sep" title="${
      t.capacityMode === 'both' ? 'Carries both at once' : 'Either, never mixed'}">${joiner}</span>` : '');
    return `<span class="dzc-transport">${capStr}${
      cap.length && fills.length ? '<span class="dzc-sep">,</span>' : ''}${fills.join('')}</span>`;
  }

  /* Points. 49 of 178 units are priced PER VARIANT ("35pts (Sabre, Greave),
   * 40pts (Tachi, Rapier)"), so there is no single unit price -- showing one
   * would be a lie. Those show a range and the variants carry the real cost. */
  function pointsHtml(u) {
    if (u.points != null) return `${u.points}<span class="dzc-pts">pts</span>`;
    const ps = (u.variants || []).map(v => v.points).filter(p => p != null);
    if (!ps.length) return '<span class="dzc-pts">—</span>';
    const lo = Math.min.apply(null, ps), hi = Math.max.apply(null, ps);
    return (lo === hi ? `${lo}` : `${lo}–${hi}`) + '<span class="dzc-pts">pts</span>';
  }

  function squadHtml(u) {
    if (u.squadMin == null && u.squadMax == null) return '—';
    if (u.squadMin === u.squadMax) return String(u.squadMin);
    return `${u.squadMin}–${u.squadMax}`;
  }

  /* Two columns, three rows. Each row pairs stats that mean something
   * together: how it moves and what stops shots, then the fight, then nerve
   * and how much it takes to kill. Copied from the Dropfleet builder's
   * renderStatGrid (app.js:3472), which is a 2-column grid of
   * icon + value + label cells. */
  const STAT_ORDER = ['Mv', 'A', 'OF', 'DF', 'B', 'DP'];

  /* Two views of the same block.
   *
   *   compact  — the "Add a Squad" picker. Icon plus the short code the stat
   *              card itself prints. Four cards across cannot carry six
   *              spelled-out words.
   *   detailed — the default once a unit is on your list, and whenever you tap
   *              one to see everything. Icon plus the word.
   *
   * The codes are the game's own (Mv, A, DP, OF, DF, B) rather than one letter
   * each, because Defence and Damage Points would both be "D". */
  function statsHtml(u, opts) {
    // Vehicles/Aircraft print Mv/A/DP; Infantry print Mv/OF/DF/B/DP. Render
    // whatever the card actually had rather than assuming a shape.
    //
    // A table, not a wrap of chips: values sit under their heading in fixed
    // columns, so two units can be read against each other. Labels are spelled
    // out (2.5-2.7) rather than left as bare letters, and each carries its
    // icon.
    // Only what the unit's card actually prints. Vehicles and Aircraft have
    // Mv/A/DP; Infantry have Mv/OF/DF/B/DP. Armour is meaningless on Infantry
    // and Bravery on a tank, so an empty cell for it is noise — showing three
    // greyed dashes made every Vehicle look half broken.
    const stats = u.stats || {};
    const keys = STAT_ORDER.filter(k => stats[k] != null);
    if (!keys.length) return '';
    const compact = !!(opts && opts.compact);
    const cells = keys.map(k => {
      const label = window.DZC.statLabel(k);
      return `<div class="dzc-stat" title="${esc(label)}">
        <span class="dzc-stat-i">${window.DZCIcon.stat(k, { size: 14, type: u.type })}</span>
        <span class="dzc-stat-v">${esc(stats[k])}</span>
        <span class="dzc-stat-k">${esc(compact ? k : label)}</span>
      </div>`;
    }).join('');
    return `<div class="dzc-stats${compact ? ' is-compact' : ''} n-${keys.length}">${cells}</div>`;
  }

  /* Rule keywords, each resolved to its glossary text and tappable. */
  /* Every rule carries its text on hover, so you can read it without
   * committing to a click. Clicking still opens the fuller popup with the
   * rule's name and where it comes from. */
  function rulesHtml(special, faction) {
    if (!special) return '';
    return window.DZC.splitSpecial(special, faction).map(tok => {
      const r = window.DZC.rule(tok, faction);
      // The page goes on the hover too, not only in the popover: someone
      // reading the tooltip with the rulebook open wants to turn to it without
      // a second click to find out where.
      const tip = (window.DZC.ruleText(tok, faction) || 'No glossary entry — read it from the stat card.')
        + (r && r.page ? ` (p.${r.page})` : '');
      return `<button type="button" class="dzc-rule${r ? '' : ' dzc-rule--unknown'}"
        onclick="DZCUnits.showRule(this,'${esc(tok).replace(/'/g, '&#39;')}')"
        title="${esc(tip)}">${esc(tok)}</button>`;
    }).join('');
  }

  function unitCard(u, faction) {
    const flags = [
      u.rare ? '<span class="dzc-flag dzc-flag--rare">Rare</span>' : '',
      u.unique ? '<span class="dzc-flag dzc-flag--unique">Unique</span>' : '',
      u.auxiliaryTransport ? '<span class="dzc-flag">Aux Transport</span>' : '',
      u.selectable === false ? '<span class="dzc-flag">Not selectable</span>' : ''
    ].join('');
    return `<article class="dzc-card" onclick="DZCUnits.openDetail('${esc(u.id)}')" tabindex="0"
      onkeydown="if(event.key==='Enter'){DZCUnits.openDetail('${esc(u.id)}')}">
      <div class="dzc-card-art">${u.art ? `<img src="${esc(u.art)}" alt="" loading="lazy">` : ''}</div>
      <div class="dzc-card-body">
        <h3 class="dzc-card-name">${esc(u.name)}</h3>
        <div class="dzc-card-meta">
          <span class="dzc-type">${esc(u.type || '')}</span>
          <span class="dzc-points">${pointsHtml(u)}</span>
          <span class="dzc-squad">Squad ${squadHtml(u)}</span>
          ${flags}
        </div>
        <div class="dzc-card-stats">${statsHtml(u)}</div>
        ${transportHtml(u)}
      </div>
    </article>`;
  }

  async function render() {
    const root = document.getElementById('view-units');
    if (!root) return;
    await window.DZC.loadIndex();
    const f = await window.DZC.loadFaction(state.faction);
    const acc = (FACTIONS.find(x => x.id === state.faction) || {}).accent || '#1b3a5c';

    const q = state.search.trim().toLowerCase();
    let units = f.units.slice();
    if (q) units = units.filter(u => window.DZC.matches(u, q, state.faction));
    if (state.category !== 'All') units = units.filter(u => u.category === state.category);

    const tabs = FACTIONS.map(x =>
      `<button type="button" class="dzc-tab${x.id === state.faction ? ' is-active' : ''}"
        style="--acc:${x.accent}" onclick="DZCUnits.setFaction('${x.id}')" title="${esc(x.full)}"
        >${esc(x.name)}</button>`).join('');

    const cats = ['All'].concat(CATEGORIES).map(c =>
      `<button type="button" class="dzc-chip${c === state.category ? ' is-active' : ''}"
        onclick="DZCUnits.setCategory('${c}')">${esc(c)}</button>`).join('');

    const groups = CATEGORIES.map(cat => {
      const inCat = units.filter(u => u.category === cat);
      if (!inCat.length) return '';
      const pts = inCat.map(u => u.points).filter(p => p != null);
      return `<section class="dzc-group">
        <h2 class="dzc-group-head">${esc(cat)}
          <span class="dzc-group-count">${inCat.length} unit${inCat.length === 1 ? '' : 's'}</span>
          ${cat === 'Generated' ? '<span class="dzc-group-note">produced in play — cannot be chosen</span>' : ''}
        </h2>
        <div class="dzc-grid">${inCat.map(u => unitCard(u, state.faction)).join('')}</div>
      </section>`;
    }).join('');

    root.innerHTML = `
      <div class="dzc-wrap" style="--acc:${acc}">
        <div class="dzc-tabs">${tabs}</div>
        <div class="dzc-toolbar">
          <input class="dzc-search" type="search" placeholder="Search units, variants, weapons or rules"
                 value="${esc(state.search)}" oninput="DZCUnits.setSearch(this.value)" aria-label="Search units">
          <div class="dzc-chips">${cats}</div>
        </div>
        <p class="dzc-count">${units.length} of ${f.units.length} units${q ? ` matching “${esc(state.search)}”` : ''}</p>
        <!-- Named by cause, and worded exactly as the picker words it. "Nothing
             matches that search" over an empty category is the app blaming a
             search box you never touched. -->
        ${groups || `<p class="dzc-empty">${q ? `Nothing matches “${esc(state.search)}”.`
          : 'Nothing in this category.'}</p>`}
      </div>`;
  }

  /* `faction` is optional: the reference browses one at a time, but the army
   * builder opens a unit from whatever faction that army is. */
  /* The weapon table, whole. Shared with the builder so a Unit sitting in your
   * army reads exactly as it does when you open it -- there is no version of
   * this that is "enough for the roster", because the numbers you argue over
   * at the table are the ones in this table. */
  function weaponsHtml(u, faction) {
    const fac = faction || state.faction;
    if (!(u.weapons || []).length) return '<p class="dzc-none">No weapons.</p>';
    return `
      <table class="dzc-wpn">
        <thead><tr><th>Weapon</th><th>Arc</th>
          <th class="dzc-wpn-ma">${window.DZCIcon.moveAttack({ size: 15 })}Move &amp; Attack</th>
          <th>Range</th><th>Attacks</th><th>Accuracy</th><th>Energy</th><th>Special</th></tr></thead>
        <tbody>${u.weapons.map(w => `<tr${w.box === 'upgrade' ? ' class="is-upgrade"' : w.box === 'variant' ? ' class="is-variant"' : ''}>
          <td class="dzc-wpn-name">${esc(w.name)}
            ${(w.variants || []).length ? `<span class="dzc-wpn-only">${esc(w.variants.join(', '))} only</span>` : ''}
            ${w.upgradePoints != null ? `<span class="dzc-wpn-up">+${w.upgradePoints}pts</span>` : ''}</td>
          <td class="dzc-arc-cell">${window.DZCIcon.arc(w.arc)}<span>${esc(w.arc || '')}</span></td>
          <td>${esc(w.ma || '')}</td><td>${esc(w.r || '')}</td>
          <td>${esc(w.att || '')}</td><td>${esc(w.ac || '')}</td><td>${esc(w.e || '')}</td>
          <td>${rulesHtml(w.special, fac)}</td></tr>`).join('')}</tbody>
      </table>`;
  }

  /* A variant is a different model, so it gets its own block rather than a
   * line in a price list: what it is called, the gun that makes it that
   * variant, what it costs, and the stats it fights with. A weapon marked
   * "all" is on every variant, so only the variant-restricted ones name it. */
  function variantsHtml(u) {
    if (!(u.variants || []).length) return '';
    return `<div class="dzc-variants">
      ${u.variants.map(v => {
        const own = (u.weapons || []).filter(w =>
          w.box === 'variant' && (w.variants || []).indexOf(v.name) !== -1);
        const head = [esc(v.name)]
          .concat(own.length ? [own.map(w => esc(w.name)).join(', ')] : [])
          .concat([v.points != null ? v.points + 'pts' : '—'])
          .join(' — ');
        return `<div class="dzc-variant">
          <div class="dzc-variant-head">${head}</div>
          ${statsHtml(u)}
        </div>`;
      }).join('')}
    </div>`;
  }

  function openDetail(unitId, faction) {
    if (faction) state.faction = faction;
    const f = window.DZC.faction(state.faction);
    const u = f && f.byId[unitId];
    if (!u) return;
    const weapons = weaponsHtml(u, state.faction);
    const variants = variantsHtml(u);

    document.getElementById('dzc-detail-body').innerHTML = `
      <div class="dzc-detail-head">
        ${u.art ? `<img class="dzc-detail-art" src="${esc(u.art)}" alt="">` : ''}
        <div>
          <!-- Capacity sits beside the name at size, not buried under the meta
               line: what a Transport can carry is the first thing you look for
               on one, and the shapes are the whole grammar (3.2.4.2). -->
          <h3 class="dzc-detail-name">${esc(u.name)}
            <span class="dzc-detail-cap">${transportHtml(u)}</span></h3>
          <p class="dzc-detail-meta"><span>${esc(u.category)}</span> <span>${esc(u.type || '')}</span>
            <span>${pointsHtml(u)}</span> <span>Squad ${squadHtml(u)}</span>
            ${u.rare ? '<span class="dzc-flag dzc-flag--rare">Rare</span>' : ''}${u.unique ? '<span class="dzc-flag dzc-flag--unique">Unique</span>' : ''}</p>
          <div class="dzc-card-stats">${statsHtml(u)}</div>
        </div>
      </div>
      ${u.special ? `<div class="dzc-detail-rules">${rulesHtml(u.special, state.faction)}</div>` : ''}
      ${variants}
      ${weapons}`;
    document.querySelector('#dzc-detail .modal-title').textContent = u.name;
    document.getElementById('dzc-detail').classList.add('active');
  }

  function closeDetail() { document.getElementById('dzc-detail').classList.remove('active'); }

  /* Where a rule comes from, close enough to go and read it. The section
   * number says which rule; the page number says where the book falls open,
   * which is the one you want mid-game with the rulebook on the table. */
  function ruleSource(r) {
    if (r.faction) return r.faction.toUpperCase() + ' rules';
    return 'Rulebook ' + r.section + (r.page ? `, p.${r.page}` : '');
  }

  /* Rule popover. Positioned absolutely against the page so opening one never
   * displaces the content behind it. */
  function showRule(el, token) {
    hideRule();
    const r = window.DZC.rule(token, state.faction);
    const pop = document.createElement('div');
    pop.className = 'dzc-pop';
    pop.id = 'dzc-pop';
    pop.innerHTML = r
      ? `<h5>${esc(r.name)}${r.alias ? ` <span class="dzc-pop-alias">(${esc(r.alias)})</span>` : ''}</h5>
         <p>${esc(window.DZC.ruleText(token, state.faction))}</p>
         <span class="dzc-pop-src">${esc(ruleSource(r))}</span>`
      : `<h5>${esc(token)}</h5><p>No glossary entry for this keyword — read it from the stat card.</p>`;
    document.body.appendChild(pop);
    const b = el.getBoundingClientRect();
    pop.style.top = (window.scrollY + b.bottom + 6) + 'px';
    pop.style.left = Math.max(8, Math.min(window.scrollX + b.left,
      window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 8)) + 'px';
    setTimeout(() => document.addEventListener('click', onDocClick), 0);
  }
  function onDocClick(e) { if (!e.target.closest('#dzc-pop')) hideRule(); }
  function hideRule() {
    const p = document.getElementById('dzc-pop');
    if (p) p.remove();
    document.removeEventListener('click', onDocClick);
  }

  window.DZCUnits = {
    render,
    open: () => render(),
    setFaction: id => { state.faction = id; state.search = ''; render(); },
    setCategory: c => { state.category = c; render(); },
    setSearch: v => { state.search = v; render(); },
    openDetail, closeDetail, showRule, hideRule,
    // Shared with the builder's picker so a unit reads the same in both places.
    statsHtml, rulesHtml, squadHtml, transportHtml, weaponsHtml, variantsHtml,
    pointsHtml, shape: shapeSvg,
    SHAPES: Object.keys(SYMBOL),
    shapeInk: s => (SYMBOL[s] || {}).ink || 'currentColor',
    shapeName: s => String(s).replace('-', ' ')
  };
})();
