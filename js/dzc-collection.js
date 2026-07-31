/* Collection — what you actually own, and what that lets you field.
 *
 * Counts MODELS, not Squads, because that is the question a builder can answer:
 * "I own four Sabres" decides whether a Squad of six is buildable tonight.
 *
 * Deliberately advisory, never enforcing. Owning too few models is not against
 * the rules — it is a shopping list, or a proxy, or a friend's box — so it
 * never blocks a choice the rulebook allows. That line matters: the builder
 * enforces the RULES and reports everything else.
 */
(function () {
  'use strict';

  const KEY = 'dzc_collection';
  let owned = {};          // { faction: { unitId: count } }
  let state = { faction: 'ucm', search: '', ownedOnly: false };

  const FACTIONS = [
    { id: 'ucm', name: 'UCM', accent: '#30903c' },
    { id: 'phr', name: 'PHR', accent: '#c9a92c' },
    { id: 'scourge', name: 'Scourge', accent: '#60489c' },
    { id: 'shaltari', name: 'Shaltari', accent: '#e46024' },
    { id: 'resistance', name: 'Resistance', accent: '#3c84c0' },
    { id: 'bioficer', name: 'Bioficers', accent: '#9c1818' }
  ];

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function load() {
    try { owned = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { owned = {}; }
    return owned;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(owned)); } catch (e) { /* quota */ }
  }

  function count(faction, unitId) {
    return (owned[faction] && owned[faction][unitId]) || 0;
  }
  function set(faction, unitId, n) {
    owned[faction] = owned[faction] || {};
    n = Math.max(0, n | 0);
    if (n) owned[faction][unitId] = n; else delete owned[faction][unitId];
    save();
  }

  /* How many models of each unit an army fields, so the builder can say what a
   * list would need beyond what is owned. */
  function needed(army) {
    const out = {};
    army.groups.forEach(g => g.squads.forEach(s => {
      out[s.unitId] = (out[s.unitId] || 0) + s.models.length;
    }));
    return out;
  }

  /* Units an army uses more of than you own. Advisory only. */
  function shortfall(army) {
    const need = needed(army);
    const out = [];
    Object.keys(need).forEach(id => {
      const have = count(army.faction, id);
      if (have < need[id]) {
        const u = window.DZC.unit(army.faction, id);
        out.push({ unitId: id, name: u ? u.name : id, need: need[id], have: have });
      }
    });
    return out;
  }

  // ------------------------------------------------------------------- view

  async function open() {
    const root = document.getElementById('view-collection');
    if (!root) return;
    await window.DZC.loadIndex();
    load();
    render();
  }

  async function render() {
    const root = document.getElementById('view-collection');
    const f = await window.DZC.loadFaction(state.faction);
    const acc = (FACTIONS.find(x => x.id === state.faction) || {}).accent;
    const q = state.search.trim().toLowerCase();

    let units = f.units.filter(u => u.selectable !== false);
    if (q) units = units.filter(u => u.name.toLowerCase().includes(q));
    if (state.ownedOnly) units = units.filter(u => count(state.faction, u.id) > 0);

    const totals = f.units.reduce((n, u) => n + count(state.faction, u.id), 0);
    const kinds = f.units.filter(u => count(state.faction, u.id) > 0).length;

    root.innerHTML = `<div class="dzc-wrap" style="--acc:${acc}">
      <div class="dzc-tabs">${FACTIONS.map(x =>
        `<button type="button" class="dzc-tab${x.id === state.faction ? ' is-active' : ''}"
          style="--acc:${x.accent}" onclick="DZCCollection.setFaction('${x.id}')">${esc(x.name)}</button>`).join('')}</div>

      <div class="dzc-toolbar">
        <div class="dzc-search-row">${window.DZCIcon('search')}
          <input class="dzc-search" type="search" placeholder="Search units" value="${esc(state.search)}"
                 oninput="DZCCollection.setSearch(this.value)" aria-label="Search units"></div>
        <button type="button" class="dzc-chip${state.ownedOnly ? ' is-active' : ''}"
                onclick="DZCCollection.toggleOwned()">Owned only</button>
      </div>
      <p class="dzc-count">${totals} model${totals === 1 ? '' : 's'} across ${kinds} unit type${kinds === 1 ? '' : 's'}.</p>

      <div class="dzc-coll-list">${units.map(u => {
        const n = count(state.faction, u.id);
        return `<div class="dzc-coll-row${n ? ' is-owned' : ''}">
          ${u.art ? `<img src="${esc(u.art)}" alt="" loading="lazy">` : '<span class="dzc-pick-noart"></span>'}
          <span class="dzc-coll-body">
            <span class="dzc-coll-name">${esc(u.name)}</span>
            <span class="dzc-coll-meta"><span>${esc(u.category)}</span> <span>${esc(u.type || '')}</span>${
              u.squadMin != null ? ` <span>Squad ${u.squadMin}${u.squadMax !== u.squadMin ? '–' + u.squadMax : ''}</span>` : ''}</span>
          </span>
          <span class="dzc-stepper">
            <button type="button" onclick="DZCCollection.adjust('${esc(u.id)}',-1)" aria-label="One fewer">${window.DZCIcon('remove', { size: 14 })}</button>
            <b>${n}</b>
            <button type="button" onclick="DZCCollection.adjust('${esc(u.id)}',1)" aria-label="One more">${window.DZCIcon('add', { size: 14 })}</button>
          </span>
        </div>`;
      }).join('') || '<p class="dzc-empty">Nothing matches.</p>'}</div>
    </div>`;
  }

  window.DZCCollection = {
    open, load, count, set, needed, shortfall,
    setFaction: id => { state.faction = id; render(); },
    setSearch: v => { state.search = v; render(); },
    toggleOwned: () => { state.ownedOnly = !state.ownedOnly; render(); },
    adjust: (id, d) => { set(state.faction, id, count(state.faction, id) + d); render(); }
  };
})();
