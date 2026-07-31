/* DZC army builder — the views over js/dzc-army.js.
 *
 * The screen is organised the way the game is: an Army is a list of Groups,
 * and a Group is what activates. Nesting is shown by indentation, because a
 * Condor carrying two Bear APCs carrying six Legionnaires IS the deployment
 * plan and a flat list hides it.
 */
(function () {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const FACTIONS = [
    { id: 'ucm', name: 'UCM', accent: '#30903c' },
    { id: 'phr', name: 'PHR', accent: '#c9a92c' },
    { id: 'scourge', name: 'Scourge', accent: '#60489c' },
    { id: 'shaltari', name: 'Shaltari', accent: '#e46024' },
    { id: 'resistance', name: 'Resistance', accent: '#3c84c0' },
    { id: 'bioficer', name: 'Bioficers', accent: '#9c1818' }
  ];
  const accentOf = f => (FACTIONS.find(x => x.id === f) || {}).accent || '#1b3a5c';

  let current = null;                 // the army being edited
  let picker = { groupId: null, category: 'All', search: '' };

  // ------------------------------------------------------------- army list

  async function renderList() {
    const root = document.getElementById('view-armies');
    if (!root) return;
    await window.DZC.loadIndex();
    const list = window.DZCArmy.load();

    const cards = list.map(a => {
      const cost = window.DZCArmy.armyCost(a);
      const size = window.DZC.gameSizeFor(a.pointsLimit);
      const v = a.groups.length ? window.DZCArmy.validate(a) : { errors: [], warnings: [] };
      return `<article class="dzc-army-card" style="--acc:${accentOf(a.faction)}"
                onclick="DZCBuilder.open('${a.id}')" tabindex="0"
                onkeydown="if(event.key==='Enter')DZCBuilder.open('${a.id}')">
        <div class="dzc-army-top">
          <h3>${esc(a.name)}</h3>
          <span class="dzc-army-btns">
            <button class="dzc-icon-btn" type="button" title="Duplicate army"
                    onclick="event.stopPropagation();DZCBuilder.duplicate('${a.id}')"
                    aria-label="Duplicate ${esc(a.name)}">${window.DZCIcon('content_copy', { size: 15 })}</button>
            <button class="dzc-icon-btn" type="button" title="Delete army"
                    onclick="event.stopPropagation();DZCBuilder.del('${a.id}')"
                    aria-label="Delete ${esc(a.name)}">${window.DZCIcon('delete', { size: 15 })}</button>
          </span>
        </div>
        <p class="dzc-army-meta">${esc((FACTIONS.find(f => f.id === a.faction) || {}).name || a.faction)}
          · ${size ? esc(size.label) : 'Below minimum'}
          · ${a.groups.length} Group${a.groups.length === 1 ? '' : 's'}</p>
        <p class="dzc-army-pts"><b>${cost}</b> / ${a.pointsLimit}pts</p>
        ${v.errors.length ? `<p class="dzc-army-bad">${v.errors.length} problem${v.errors.length === 1 ? '' : 's'}</p>`
          : a.groups.length ? '<p class="dzc-army-ok">Legal</p>' : '<p class="dzc-army-meta">Empty</p>'}
      </article>`;
    }).join('');

    root.innerHTML = `<div class="dzc-wrap">
      <div class="dzc-list-head">
        <h1>Your Armies</h1>
        <span class="dzc-list-btns">
          <button class="btn btn-ghost" type="button" onclick="DZCBuilder.importLink()">Import a link</button>
          <button class="btn btn-primary" type="button" onclick="DZCBuilder.openNew()">New Army</button>
        </span>
      </div>
      ${list.length ? `<div class="dzc-army-grid">${cards}</div>`
        : `<p class="dzc-empty">No armies yet. Start one and it saves in this browser.</p>`}
    </div>`;
  }

  function openNew() {
    const body = document.getElementById('dzc-new-body');
    body.innerHTML = `
      <label class="dzc-field"><span>Army name</span>
        <input id="dzc-new-name" type="text" value="New Army" maxlength="60"></label>
      <label class="dzc-field"><span>Faction</span>
        <select id="dzc-new-faction">${FACTIONS.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select></label>
      <label class="dzc-field"><span>Points limit</span>
        <input id="dzc-new-points" type="number" min="501" step="50" value="1500"></label>
      <p class="dzc-field-note">The limit is the number you agreed with your opponent. It sets the game
        size, the Group cap, and the quarter-of-the-limit ceiling on any one Group (3.1, 3.2).</p>`;
    document.getElementById('dzc-new').classList.add('active');
  }

  function createArmy() {
    const name = (document.getElementById('dzc-new-name').value || 'New Army').trim();
    const faction = document.getElementById('dzc-new-faction').value;
    const pts = parseInt(document.getElementById('dzc-new-points').value, 10) || 1500;
    const a = window.DZCArmy.create(faction, name, pts);
    document.getElementById('dzc-new').classList.remove('active');
    location.hash = '#army/' + a.id;
  }

  function del(id) {
    if (!confirm('Delete this army? This cannot be undone.')) return;
    window.DZCArmy.remove(id);
    renderList();
  }

  // ---------------------------------------------------------------- builder

  async function open(id) { location.hash = '#army/' + id; }

  async function renderBuilder(id) {
    const root = document.getElementById('view-army');
    if (!root) return;
    await window.DZC.loadIndex();
    window.DZCArmy.load();
    const a = window.DZCArmy.get(id);
    if (!a) { location.hash = '#armies'; return; }
    current = a;
    await window.DZC.loadFaction(a.faction);

    const cost = window.DZCArmy.armyCost(a);
    const size = window.DZC.gameSizeFor(a.pointsLimit);
    const maxG = size ? window.DZC.maxGroups(size, a.pointsLimit) : 0;
    const cap = window.DZC.maxGroupCost(a.pointsLimit);
    const v = window.DZCArmy.validate(a);
    const spend = window.DZCArmy.categorySpend(a);
    const std = spend.standard || 0;

    const ratio = ['vanguard', 'heavy', 'support'].map(c => {
      const val = spend[c] || 0;
      const over = val > std;
      return `<div class="dzc-ratio${over ? ' is-over' : ''}">
        <span>${c[0].toUpperCase() + c.slice(1)}</span>
        <b>${val}</b><i>/ ${std}</i></div>`;
    }).join('');

    root.innerHTML = `<div class="dzc-wrap dzc-builder" style="--acc:${accentOf(a.faction)}">
      <header class="dzc-b-head">
        <div>
          <h1 contenteditable="true" spellcheck="false" class="dzc-b-name"
              onblur="DZCBuilder.rename(this.textContent)">${esc(a.name)}</h1>
          <p class="dzc-b-sub">${esc((FACTIONS.find(f => f.id === a.faction) || {}).name)}
            · ${size ? esc(size.label) : 'Below the 501pt minimum'}
            · Groups ${a.groups.length}/${maxG || '—'}
            · Max per Group ${cap}pts</p>
        </div>
        <div class="dzc-b-right">
          <div class="dzc-b-pts ${cost > a.pointsLimit ? 'is-over' : ''}">
            <b>${cost}</b><span>/ ${a.pointsLimit}pts</span>
          </div>
          <button class="btn btn-ghost btn-sm" type="button" onclick="DZCBuilder.play()"
                  title="Run a game with this army">${window.DZCIcon('layers', { size: 15 })} Play</button>
          <button class="btn btn-ghost btn-sm" type="button" onclick="DZCBuilder.share()"
                  title="Copy a link to this army">${window.DZCIcon('share', { size: 15 })} Share</button>
          <button class="btn btn-ghost btn-sm" type="button" onclick="DZCBuilder.print()"
                  title="Print the deployment sheet">${window.DZCIcon('print', { size: 15 })} Print</button>
        </div>
      </header>

      <div class="dzc-ratios" title="Vanguard, Heavy and Support may each not exceed Standard spend (3.2)">
        <div class="dzc-ratio is-std"><span>Standard</span><b>${std}</b></div>${ratio}
      </div>

      ${v.errors.length ? `<ul class="dzc-issues dzc-issues--err">${v.errors.map(e =>
        `<li><span class="dzc-rulenum">${esc(e.rule)}</span>${esc(e.msg)}</li>`).join('')}</ul>` : ''}
      ${v.warnings.length ? `<ul class="dzc-issues dzc-issues--warn">${v.warnings.map(e =>
        `<li><span class="dzc-rulenum">${esc(e.rule)}</span>${esc(e.msg)}</li>`).join('')}</ul>` : ''}
      ${!v.errors.length && a.groups.length ? '<p class="dzc-legal">This army is legal.</p>' : ''}
      ${shortfallHtml(a)}

      ${a.groups.map(g => groupHtml(a, g)).join('')}

      <button class="btn btn-outline dzc-add-group" type="button" onclick="DZCBuilder.addGroup()">+ Add Group</button>
    </div>`;
  }

  /* What this list needs beyond what you own. Advisory only, and separate from
   * the rules issues above: owning too few models is not illegal, it is a
   * shopping list. */
  function shortfallHtml(a) {
    if (!window.DZCCollection) return '';
    window.DZCCollection.load();
    const short = window.DZCCollection.shortfall(a);
    if (!short.length) return '';
    return `<p class="dzc-short"><b>Not in your collection</b>${
      short.map(s => `${esc(s.name)} — using ${s.need}, own ${s.have}`).join('; ')}</p>`;
  }

  function groupHtml(a, g) {
    const cost = window.DZCArmy.groupCost(a, g);
    const cap = window.DZC.maxGroupCost(a.pointsLimit);
    // Carriers first, then whatever they carry, indented beneath them. The
    // nesting IS the deployment plan, so it is drawn rather than described.
    const top = g.squads.filter(s => !s.carriedBy);
    const rows = top.map(s => squadHtml(a, g, s, 0)).join('');
    return `<section class="dzc-group-card${cost > cap ? ' is-over' : ''}">
      <header class="dzc-g-head">
        <h2 contenteditable="true" spellcheck="false"
            onblur="DZCBuilder.renameGroup('${g.id}', this.textContent)">${esc(g.name)}</h2>
        <span class="dzc-g-cost">${cost}<i>/${cap}pts</i></span>
        <button class="dzc-icon-btn" type="button" title="Remove Group"
                onclick="DZCBuilder.removeGroup('${g.id}')" aria-label="Remove ${esc(g.name)}">&times;</button>
      </header>
      ${rows || '<p class="dzc-g-empty">No Squads yet.</p>'}
      <button class="btn btn-ghost btn-sm" type="button" onclick="DZCBuilder.openPicker('${g.id}')">+ Add Squad</button>
    </section>`;
  }

  /* Weapon upgrades (3.2.3). Chosen per VARIANT, because "All Units of the
   * same Variant within a Squad must be upgraded equally" -- so the price shown
   * is for every model of that variant, not for one. */
  function upgradesHtml(a, s, u) {
    const opts = window.DZCArmy.upgradesFor(a, s);
    if (!opts.length) return '';
    const rows = opts.map(o => {
      const on = window.DZCArmy.hasUpgrade(s, o.scope, o.weapon.name);
      const total = o.points * o.count;
      return `<label class="dzc-upg${on ? ' is-on' : ''}">
        <input type="checkbox" ${on ? 'checked' : ''}
               onchange="DZCBuilder.toggleUpgrade('${s.id}','${esc(o.scope)}','${esc(o.weapon.name)}')">
        <span class="dzc-upg-name">${esc(o.weapon.name)}${o.scope !== '*' ? ` <i>(${esc(o.scope)})</i>` : ''}</span>
        <span class="dzc-upg-cost">+${total}pts${o.count > 1 ? ` <i>${o.points}×${o.count}</i>` : ''}</span>
      </label>`;
    }).join('');
    return `<div class="dzc-upgrades">
      <span class="dzc-upg-head">Upgrades${u.upgradeNote ? ` — <i>${esc(u.upgradeNote)}</i>` : ''}</span>
      ${rows}</div>`;
  }

  function squadHtml(a, g, s, depth) {
    const u = window.DZCArmy.unitOf(a, s);
    if (!u) return '';
    const cost = window.DZCArmy.squadCost(a, s);
    const riders = g.squads.filter(x => x.carriedBy === s.id);
    const isTransport = u.category === 'Transport';

    // A Transport's count is DERIVED from its cargo -- "as many as needed"
    // (3.2.4) -- so it gets no stepper at all. Making it uneditable is the
    // enforcement; a stepper you then argue with is not.
    const stepper = isTransport
      ? `<span class="dzc-stepper is-derived" title="A Transport’s count follows its cargo (3.2.4)">
           ${window.DZCIcon('lock', { size: 12 })}<b>${s.models.length}</b></span>`
      : `<span class="dzc-stepper">
          <button type="button" ${window.DZCArmy.canSetCount(a, s.id, s.models.length - 1).ok || s.models.length === 1 ? '' : 'disabled'}
                  onclick="DZCBuilder.count('${s.id}',-1)" aria-label="Remove one model">${window.DZCIcon('remove', { size: 14 })}</button>
          <b>${s.models.length}</b>
          <button type="button" ${window.DZCArmy.canSetCount(a, s.id, s.models.length + 1).ok ? '' : 'disabled'}
                  onclick="DZCBuilder.count('${s.id}',1)" aria-label="Add one model">${window.DZCIcon('add', { size: 14 })}</button>
        </span>`;

    const variantPicker = (u.variants || []).length ? s.models.map((m, i) =>
      `<select class="dzc-variant" onchange="DZCBuilder.setVariant('${s.id}',${i},this.value)"
               aria-label="Model ${i + 1} variant">
        ${u.variants.map(vr => `<option value="${esc(vr.name)}"${vr.name === m.variant ? ' selected' : ''}>${esc(vr.name)} · ${vr.points}pts</option>`).join('')}
      </select>`).join('') : '';

    // Transport assignment. Only options that would be legal are offered, and
    // one that cannot be taken FULL is offered disabled with the arithmetic,
    // because "5 Legionnaires cannot fill two Bear APCs" is not obvious.
    const carrier = s.carriedBy ? window.DZCArmy.findSquad(a, s.carriedBy) : null;
    const carrierUnitId = carrier ? carrier.unitId : '';
    const opts = isTransport ? [] : window.DZCArmy.transportOptions(a, s.id);
    const transportPicker = opts.length ? `<label class="dzc-carry">${window.DZCIcon('local_shipping', { size: 13 })} Transport
      <select onchange="DZCBuilder.assignTransport('${s.id}',this.value)">
        <option value="">— none, walks on —</option>
        ${opts.map(o => `<option value="${esc(o.unit.id)}"${o.unit.id === carrierUnitId ? ' selected' : ''}${o.exact ? '' : ' disabled'}>${esc(o.unit.name)} × ${o.need}${o.exact ? '' : ` — cannot be full (carries ${o.per}, needs ${o.fill})`}</option>`).join('')}
      </select></label>` : '';

    const cmdLevels = window.DZC.commanderLevels(
      (window.DZC.gameSizeFor(a.pointsLimit) || {}).id || 'skirmish');

    return `<div class="dzc-squad${isTransport ? ' is-transport' : ''}" style="--depth:${depth}">
      <div class="dzc-sq-main">
        <span class="dzc-sq-cat" data-cat="${esc(u.category)}">${isTransport ? window.DZCIcon('local_shipping', { size: 12 }) : ''}${esc(u.category)}</span>
        <button type="button" class="dzc-sq-name" title="Stats, weapons and rules"
                onclick="DZCUnits.openDetail('${esc(u.id)}','${esc(a.faction)}')">${esc(u.name)}${s.commander ? `<span class="dzc-cmdr-tag">${window.DZCIcon('military_tech', { size: 12 })}L${s.commander.level}</span>` : ''}</button>
        ${stepper}
        <span class="dzc-sq-cost">${cost}pts</span>
        <button class="dzc-icon-btn" type="button" title="Remove Squad"
                onclick="DZCBuilder.removeSquad('${s.id}')" aria-label="Remove ${esc(u.name)}">${window.DZCIcon('close', { size: 16 })}</button>
      </div>
      ${upgradesHtml(a, s, u)}
      <div class="dzc-sq-opts">
        ${variantPicker}
        ${transportPicker}
        ${isTransport ? '' : `<label class="dzc-cmdr">${window.DZCIcon('military_tech', { size: 13 })} Commander
          <select onchange="DZCBuilder.setCommander('${s.id}',this.value)">
            <option value="">— none —</option>
            ${cmdLevels.map(l =>
              `<option value="${l.level}"${s.commander && s.commander.level === l.level ? ' selected' : ''}>L${l.level} · ${l.points}pts</option>`).join('')}
          </select></label>`}
      </div>
      ${isTransport ? `<p class="dzc-capacity">${window.DZCIcon('info', { size: 12 })} Count follows its cargo — Transports must be taken full (3.2.4)</p>` : ''}
      ${riders.map(r => squadHtml(a, g, r, depth + 1)).join('')}
    </div>`;
  }

  // ------------------------------------------------------------- unit picker

  async function openPicker(groupId) {
    picker.groupId = groupId;
    picker.search = '';
    await renderPicker();
    document.getElementById('dzc-picker').classList.add('active');
  }

  /* The picker ENFORCES rather than reports. A unit you may not take is shown
   * disabled with the rule that forbids it, so the reason is visible at the
   * moment of choosing instead of appearing in a list afterwards.
   *
   * Transports are absent by design: "Units with the category Transport may
   * only be chosen along with a Squad they may transport" (3.2.4). You assign
   * one to a Squad, which is also what fixes how many you get. */
  async function renderPicker() {
    const a = current;
    if (!a) return;
    const f = await window.DZC.loadFaction(a.faction);
    const q = picker.search.trim().toLowerCase();
    let units = f.units.filter(u => u.selectable !== false && u.category !== 'Transport');
    if (picker.category !== 'All') units = units.filter(u => u.category === picker.category);
    if (q) units = units.filter(u => u.name.toLowerCase().includes(q)
      || (u.variants || []).some(v => v.name.toLowerCase().includes(q)));

    const cats = ['All', 'Standard', 'Vanguard', 'Heavy', 'Support'];
    document.getElementById('dzc-picker-body').innerHTML = `
      <div class="dzc-search-row">${window.DZCIcon('search')}
        <input class="dzc-search" type="search" placeholder="Search units" value="${esc(picker.search)}"
               oninput="DZCBuilder.pickerSearch(this.value)" aria-label="Search units"></div>
      <div class="dzc-chips">${cats.map(c =>
        `<button type="button" class="dzc-chip${c === picker.category ? ' is-active' : ''}"
          onclick="DZCBuilder.pickerCat('${c}')">${esc(c)}</button>`).join('')}</div>
      <p class="dzc-pick-note">${window.DZCIcon('info', { size: 14 })} Transports are not listed here — add the Squad first, then choose what carries it (3.2.4).</p>
      <div class="dzc-pick-list">${units.map(u => {
        const ps = (u.variants || []).map(v => v.points).filter(p => p != null);
        const price = u.points != null ? `${u.points}pts`
          : ps.length ? `${Math.min.apply(null, ps)}–${Math.max.apply(null, ps)}pts` : '—';
        const chk = window.DZCArmy.canAddUnit(a, picker.groupId, u.id);
        return `<button type="button" class="dzc-pick${chk.ok ? '' : ' is-blocked'}"
            ${chk.ok ? `onclick="DZCBuilder.pick('${esc(u.id)}')"` : 'disabled'}>
          ${u.art ? `<img src="${esc(u.art)}" alt="" loading="lazy">` : '<span class="dzc-pick-noart"></span>'}
          <span class="dzc-pick-body">
            <span class="dzc-pick-name">${esc(u.name)}</span>
            <span class="dzc-pick-meta">${esc(u.category)} · ${esc(u.type || '')} · ${price}
              ${u.squadMin != null ? ` · Squad ${u.squadMin}${u.squadMax !== u.squadMin ? '–' + u.squadMax : ''}` : ''}
              ${u.rare ? ' · Rare' : ''}${u.unique ? ' · Unique' : ''}</span>
            ${chk.ok ? '' : `<span class="dzc-pick-blocked">${window.DZCIcon('lock', { size: 13 })}${esc(chk.reason)}</span>`}
          </span></button>`;
      }).join('') || '<p class="dzc-empty">Nothing matches.</p>'}</div>`;
  }

  function pick(unitId) {
    const s = window.DZCArmy.addSquad(current, picker.groupId, unitId);
    if (!s) return;                       // refused; the picker already said why
    document.getElementById('dzc-picker').classList.remove('active');
    renderBuilder(current.id);
  }

  // -------------------------------------------------------------- print sheet

  /* The printed sheet is the deployment plan, so it keeps the nesting tree and
   * states capacity at each level. Everything else -- chrome, art, colour --
   * is dropped, because none of it helps at a table. */
  function printSheet() {
    const a = current;
    if (!a) return;
    const size = window.DZC.gameSizeFor(a.pointsLimit);
    const v = window.DZCArmy.validate(a);
    const used = new Map();          // rule name -> record, for the appendix

    function collectRules(u) {
      [u.special || ''].concat((u.weapons || []).map(w => w.special || '')).forEach(sp => {
        window.DZC.splitSpecial(sp, a.faction).forEach(tok => {
          const r = window.DZC.rule(tok, a.faction);
          if (r && !used.has(r.id)) used.set(r.id, r);
        });
      });
    }

    function squad(g, s, depth) {
      const u = window.DZCArmy.unitOf(a, s);
      if (!u) return '';
      collectRules(u);
      const riders = g.squads.filter(x => x.carriedBy === s.id);
      const cost = window.DZCArmy.squadCost(a, s);
      const stats = Object.keys(u.stats || {})
        .map(k => `${k} <b>${esc(u.stats[k])}</b>`).join(' · ');

      // Variants are per model, so a mixed Squad is listed by its actual mix.
      const mix = {};
      s.models.forEach(m => { const k = m.variant || u.name; mix[k] = (mix[k] || 0) + 1; });
      const mixStr = Object.keys(mix).length > 1 || (u.variants || []).length
        ? Object.keys(mix).map(k => `${mix[k]}× ${esc(k)}`).join(', ') : '';

      const cap = (u.transport && (u.transport.capacity || []).length)
        ? `carries ${(u.transport.capacity).map(c => `${c.n} ${c.shape}`)
            .join(u.transport.capacityMode === 'both' ? ' + ' : ' / ')}` : '';

      const wpns = (u.weapons || []).length ? `<table class="pr-wpn">
        <tr><th>Weapon</th><th>Arc</th><th>MA</th><th>R</th><th>Att</th><th>Ac</th><th>E</th><th>Special</th></tr>
        ${u.weapons.map(w => `<tr><td>${esc(w.name)}${(w.variants || []).length ? ` <i>(${esc(w.variants.join(', '))})</i>` : ''}</td>
          <td>${esc(w.arc || '')}</td><td>${esc(w.ma || '')}</td><td>${esc(w.r || '')}</td>
          <td>${esc(w.att || '')}</td><td>${esc(w.ac || '')}</td><td>${esc(w.e || '')}</td>
          <td>${esc(w.special || '')}</td></tr>`).join('')}</table>` : '';

      return `<div class="pr-squad${depth ? ' pr-squad--nested' : ''}" style="--depth:${depth}">
        <div class="pr-sq-line">
          <span class="pr-sq-n">${s.models.length}×</span>
          <span class="pr-sq-name">${esc(u.name)}</span>
          <span class="pr-sq-cat">${esc(u.category)}</span>
          ${s.commander ? `<span class="pr-cmdr">Commander L${s.commander.level}</span>` : ''}
          <span class="pr-sq-cost">${cost}pts</span>
        </div>
        ${mixStr ? `<div class="pr-variants">${mixStr}</div>` : ''}
        <div class="pr-stats">${stats}${u.special ? ` · ${esc(u.special)}` : ''}</div>
        ${cap ? `<div class="pr-cap">${cap}</div>` : ''}
        ${wpns}
        ${riders.map(r => squad(g, r, depth + 1)).join('')}
      </div>`;
    }

    const groups = a.groups.map(g => `<section class="pr-group">
      <div class="pr-g-head">
        <h2 class="pr-g-name">${esc(g.name)}</h2>
        <span class="pr-g-cost">${window.DZCArmy.groupCost(a, g)}pts</span>
      </div>
      ${g.squads.filter(s => !s.carriedBy).map(s => squad(g, s, 0)).join('')}
    </section>`).join('');

    const rules = [...used.values()].sort((x, y) => x.name.localeCompare(y.name))
      .map(r => `<div class="pr-rule"><h3>${esc(r.name)}${r.alias ? ` (${esc(r.alias)})` : ''}</h3>
        <p>${esc(r.text)} <span class="pr-src">${esc(r.faction ? r.faction.toUpperCase() : r.section)}</span></p></div>`).join('');

    let el = document.getElementById('dzc-print');
    if (!el) { el = document.createElement('div'); el.id = 'dzc-print'; document.body.appendChild(el); }
    el.innerHTML = `
      <div class="pr-head">
        <h1 class="pr-title">${esc(a.name)}</h1>
        <p class="pr-sub">${esc((FACTIONS.find(f => f.id === a.faction) || {}).name || a.faction)}
          · ${size ? esc(size.label) : ''} · ${a.groups.length} Group${a.groups.length === 1 ? '' : 's'}
          · <b>${window.DZCArmy.armyCost(a)}</b> / ${a.pointsLimit}pts</p>
      </div>
      ${v.errors.length ? `<p class="pr-warn"><b>Not legal:</b> ${v.errors.map(e => esc(e.msg)).join(' ')}</p>` : ''}
      ${v.warnings.map(w => `<p class="pr-warn">${esc(w.msg)}</p>`).join('')}
      ${groups}
      <p class="pr-foot">Indentation shows what is carried aboard what. Transports are taken full (3.2.4);
        Squads not aboard an Aircraft begin Reserved (9.4).</p>
      ${rules ? `<section class="pr-rules"><h2>Rules used</h2>${rules}</section>` : ''}`;
    window.print();
  }

  // ------------------------------------------------------------------ actions

  const refresh = () => renderBuilder(current.id);

  /* Why an action was refused. Shown as a transient bar rather than an alert,
   * because a rule explanation should not be a thing you have to dismiss. */
  let sayTimer = null;
  function say(msg) {
    if (!msg) return;
    let el = document.getElementById('dzc-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dzc-toast';
      el.className = 'dzc-toast';
      document.body.appendChild(el);
    }
    el.innerHTML = `${window.DZCIcon('lock', { size: 15 })}<span>${esc(msg)}</span>`;
    el.classList.add('is-on');
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => el.classList.remove('is-on'), 5200);
  }

  window.DZCBuilder = {
    renderList, renderBuilder, openNew, createArmy, del, open,
    rename: t => { current.name = (t || '').trim() || 'Army'; window.DZCArmy.touch(current); },
    renameGroup: (id, t) => {
      const g = current.groups.find(x => x.id === id);
      if (g) { g.name = (t || '').trim() || 'Group'; window.DZCArmy.touch(current); }
    },
    // A Group exists to hold Squads, so making one goes straight to choosing
    // the first — "new Group, then pick" rather than leaving an empty shell.
    addGroup: async () => {
      const g = window.DZCArmy.addGroup(current);
      await renderBuilder(current.id);
      openPicker(g.id);
    },
    removeGroup: id => { window.DZCArmy.removeGroup(current, id); refresh(); },
    removeSquad: id => { window.DZCArmy.removeSquad(current, id); refresh(); },
    count: (id, d) => {
      const s = window.DZCArmy.findSquad(current, id);
      if (!s) return;
      const r = window.DZCArmy.setModelCount(current, id, s.models.length + d);
      if (r && !r.ok) return say(r.reason);
      refresh();
    },
    setVariant: (id, i, v) => { window.DZCArmy.setModelVariant(current, id, i, v); refresh(); },
    toggleUpgrade: (id, scope, name) => {
      const r = window.DZCArmy.toggleUpgrade(current, id, scope, name);
      if (!r.ok) say(r.reason);
      refresh();
    },
    setCarrier: (id, c) => { window.DZCArmy.setCarrier(current, id, c); refresh(); },
    assignTransport: (id, unitId) => {
      const r = window.DZCArmy.assignTransport(current, id, unitId || null);
      if (!r.ok) { say(r.reason); }
      refresh();
    },
    setCommander: (id, lv) => {
      const r = window.DZCArmy.setCommander(current, id, lv ? parseInt(lv, 10) : null);
      if (r && !r.ok) return say(r.reason);
      refresh();
    },
    openPicker, pick, print: printSheet,
    /* Copying a list to try a variant is the commonest thing you do to one, so
     * it gets a button rather than a share-then-reimport round trip. */
    duplicate: async id => {
      const src = window.DZCArmy.get(id);
      if (!src) return;
      const url = await window.DZCShare.link(src);
      const copy = await window.DZCShare.importFrom(url.split('#share/')[1]);
      copy.name = src.name + ' (copy)';
      window.DZCArmy.touch(copy);
      renderList();
    },
    /* Paste a link someone sent you. The hash route handles a link you OPEN;
     * this is for one that arrives as text in a message. */
    importLink: async () => {
      const v = window.prompt('Paste a share link or its payload:');
      if (!v) return;
      const payload = v.includes('#share/') ? v.split('#share/')[1] : v.trim();
      try {
        const a = await window.DZCShare.importFrom(payload);
        location.hash = '#army/' + a.id;
      } catch (e) {
        say('That link could not be read: ' + e.message);
      }
    },
    play: () => { location.hash = '#play/' + current.id; },
    /* The link carries the whole army, so it works with no server and cannot
     * rot. Copied straight to the clipboard; if that is blocked the link is
     * shown so it can still be copied by hand. */
    share: async () => {
      try {
        const url = await window.DZCShare.link(current);
        try {
          await navigator.clipboard.writeText(url);
          say('Link copied — it carries the whole army, no account needed.');
        } catch (e) {
          window.prompt('Copy this link:', url);
        }
      } catch (e) {
        say('Could not build a share link: ' + e.message);
      }
    },
    pickerSearch: v => { picker.search = v; renderPicker(); },
    pickerCat: c => { picker.category = c; renderPicker(); },
    closePicker: () => document.getElementById('dzc-picker').classList.remove('active'),
    closeNew: () => document.getElementById('dzc-new').classList.remove('active')
  };
})();
