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
    if (u.squadMin == null && u.squadMax == null) {
      // Transports have no squad size: you take as many as the squad needs.
      return u.category === 'Transport' ? 'as needed' : '—';
    }
    if (u.squadMin === u.squadMax) return String(u.squadMin);
    return `${u.squadMin}–${u.squadMax}`;
  }

  function statsHtml(u) {
    // Vehicles/Aircraft print Mv/A/DP; Infantry print Mv/OF/DF/B/DP. Render
    // whatever the card actually had rather than assuming a shape.
    return Object.keys(u.stats || {}).map(k =>
      `<span class="dzc-stat"><span class="dzc-stat-k">${esc(k)}</span><span class="dzc-stat-v">${esc(u.stats[k])}</span></span>`
    ).join('');
  }

  /* Rule keywords, each resolved to its glossary text and tappable. */
  function rulesHtml(special, faction) {
    if (!special) return '';
    return window.DZC.splitSpecial(special, faction).map(tok => {
      const r = window.DZC.rule(tok, faction);
      return `<button type="button" class="dzc-rule${r ? '' : ' dzc-rule--unknown'}"
        onclick="DZCUnits.showRule(this,'${esc(tok).replace(/'/g, '&#39;')}')"
        ${r ? '' : 'title="No glossary entry — see the card"'}>${esc(tok)}</button>`;
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
    if (q) {
      units = units.filter(u =>
        u.name.toLowerCase().includes(q) ||
        (u.special || '').toLowerCase().includes(q) ||
        (u.weapons || []).some(w => (w.name || '').toLowerCase().includes(q)) ||
        (u.variants || []).some(v => (v.name || '').toLowerCase().includes(q)));
    }
    if (state.category !== 'All') units = units.filter(u => u.category === state.category);

    const tabs = FACTIONS.map(x =>
      `<button type="button" class="dzc-tab${x.id === state.faction ? ' is-active' : ''}"
        style="--acc:${x.accent}" onclick="DZCUnits.setFaction('${x.id}')">${esc(x.name)}</button>`).join('');

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
          <input class="dzc-search" type="search" placeholder="Search units, weapons, variants or rules"
                 value="${esc(state.search)}" oninput="DZCUnits.setSearch(this.value)" aria-label="Search units">
          <div class="dzc-chips">${cats}</div>
        </div>
        <p class="dzc-count">${units.length} of ${f.units.length} units${q ? ` matching “${esc(state.search)}”` : ''}</p>
        ${groups || '<p class="dzc-empty">Nothing matches that search.</p>'}
      </div>`;
  }

  /* `faction` is optional: the reference browses one at a time, but the army
   * builder opens a unit from whatever faction that army is. */
  function openDetail(unitId, faction) {
    if (faction) state.faction = faction;
    const f = window.DZC.faction(state.faction);
    const u = f && f.byId[unitId];
    if (!u) return;
    const weapons = (u.weapons || []).length ? `
      <table class="dzc-wpn">
        <thead><tr><th>Weapon</th><th>Arc</th><th>MA</th><th>R</th><th>Att</th><th>Ac</th><th>E</th><th>Special</th></tr></thead>
        <tbody>${u.weapons.map(w => `<tr${w.box === 'upgrade' ? ' class="is-upgrade"' : w.box === 'variant' ? ' class="is-variant"' : ''}>
          <td class="dzc-wpn-name">${esc(w.name)}
            ${(w.variants || []).length ? `<span class="dzc-wpn-only">${esc(w.variants.join(', '))} only</span>` : ''}
            ${w.upgradePoints != null ? `<span class="dzc-wpn-up">+${w.upgradePoints}pts</span>` : ''}</td>
          <td>${esc(w.arc || '')}</td><td>${esc(w.ma || '')}</td><td>${esc(w.r || '')}</td>
          <td>${esc(w.att || '')}</td><td>${esc(w.ac || '')}</td><td>${esc(w.e || '')}</td>
          <td>${rulesHtml(w.special, state.faction)}</td></tr>`).join('')}</tbody>
      </table>` : '<p class="dzc-none">No weapons.</p>';

    const variants = (u.variants || []).length ? `
      <div class="dzc-variants">
        <h4>Variants <span class="dzc-hint">chosen per model — a Squad may mix them (3.2.2)</span></h4>
        <ul>${u.variants.map(v => `<li><span>${esc(v.name)}</span><b>${v.points != null ? v.points + 'pts' : '—'}</b></li>`).join('')}</ul>
      </div>` : '';

    document.getElementById('dzc-detail-body').innerHTML = `
      <div class="dzc-detail-head">
        ${u.art ? `<img class="dzc-detail-art" src="${esc(u.art)}" alt="">` : ''}
        <div>
          <h3>${esc(u.name)}</h3>
          <p class="dzc-detail-meta">${esc(u.category)} · ${esc(u.type || '')} · ${pointsHtml(u)} · Squad ${squadHtml(u)}
            ${u.rare ? ' · Rare' : ''}${u.unique ? ' · Unique' : ''}</p>
          <div class="dzc-card-stats">${statsHtml(u)}</div>
          ${transportHtml(u)}
        </div>
      </div>
      ${u.special ? `<div class="dzc-detail-rules"><h4>Special</h4>${rulesHtml(u.special, state.faction)}</div>` : ''}
      ${variants}
      <h4>Weapons</h4>${weapons}
      <p class="dzc-source">Stat card page ${u.page}</p>`;
    document.querySelector('#dzc-detail .modal-title').textContent = u.name;
    document.getElementById('dzc-detail').classList.add('active');
  }

  function closeDetail() { document.getElementById('dzc-detail').classList.remove('active'); }

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
         <p>${esc(r.text)}</p>
         <span class="dzc-pop-src">${esc(r.faction ? r.faction.toUpperCase() + ' rules' : 'Rulebook ' + r.section)}</span>`
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
    openDetail, closeDetail, showRule, hideRule
  };
})();
