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
  let picker = { groupId: null, category: 'All', search: '', sort: 'points', dir: 1,
                 view: 'grid', filters: [], shapes: [] };

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
        <p class="dzc-army-meta"><span>${esc((FACTIONS.find(f => f.id === a.faction) || {}).name || a.faction)}</span>
          <span>${size ? esc(size.label) : 'Below minimum'}</span>
          <span>${a.groups.length} Group${a.groups.length === 1 ? '' : 's'}</span></p>
        <p class="dzc-army-pts"><b>${cost}</b> / ${a.pointsLimit}pts</p>
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

  /* New Army, built the way the Dropfleet New Fleet dialog was: pick a game
   * SIZE from cards that state what each one means, then adjust the exact
   * limit if you agreed something else.
   *
   * Both halves are needed. The size decides the Group cap (3.1). The exact
   * number decides the per-Group ceiling, because that is a quarter of the
   * AGREED limit and not a quarter of the top of the band (3.2) — so a
   * 1,200pt Clash and a 2,000pt Clash have very different Group caps. */
  // `name` stays null until the user types, so the suggested name follows the
  // faction they pick rather than sticking at whatever it opened with.
  let picked = { faction: 'ucm', size: 'clash', points: null, name: null };

  function sizeCardHtml(g) {
    const cap = Math.floor((g.max || g.min) * 0.25);
    const groups = g.groupsPerExtra
      ? `${g.maxGroups} Groups, +${g.groupsPerExtra.add} per ${g.groupsPerExtra.per} over ${g.groupsPerExtra.above}`
      : `${g.maxGroups} Groups max`;
    const band = g.max == null ? `${g.min}pts and up` : `${g.min}–${g.max}pts`;
    return `<div class="game-size-option${g.id === picked.size ? ' selected' : ''}"
                 data-size="${g.id}" role="radio" tabindex="0"
                 aria-checked="${g.id === picked.size}"
                 onclick="DZCBuilder.pickSize('${g.id}')"
                 onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();DZCBuilder.pickSize('${g.id}')}">
      <div class="game-size-info">
        <div class="game-size-name">${esc(g.label)}</div>
        <div class="game-size-details">${band}</div>
        <div class="game-size-details game-size-sub">${groups}, max ${cap}pts per Group</div>
      </div>
    </div>`;
  }

  function openNew() {
    const sizes = window.DZC.index.gameSizes;
    const def = sizes.find(s => s.id === picked.size) || sizes[1];
    picked.points = picked.points || def.max || def.min;

    document.getElementById('dzc-new-body').innerHTML = `
      <div class="flex flex-col gap-md">
        <div class="form-group float-field">
          <input class="form-input" id="dzc-new-name" type="text" placeholder=" " maxlength="60"
                 value="${esc(picked.name != null ? picked.name : defaultArmyName(picked.faction))}"
                 oninput="DZCBuilder.nameTyped(this.value)">
          <label class="float-label" for="dzc-new-name">Army name</label>
        </div>

        <div class="form-group">
          <label class="form-label">Faction</label>
          <div class="dzc-faction-grid" id="dzc-faction-picker" role="radiogroup" aria-label="Faction">
            ${FACTIONS.map(f => `<button type="button" class="dzc-faction-btn${f.id === picked.faction ? ' selected' : ''}"
              style="--acc:${f.accent}" role="radio" aria-checked="${f.id === picked.faction}"
              onclick="DZCBuilder.pickFaction('${f.id}')">
              <img class="dzc-faction-icon" src="assets/factions/${esc(f.id)}.webp" alt=""
                   loading="lazy" onerror="this.remove()">
              <span class="dzc-faction-dot"></span>${esc(f.name)}</button>`).join('')}
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Game size</label>
          <div class="size-grid" id="dzc-size-picker" role="radiogroup" aria-label="Game size">
            ${sizes.map(sizeCardHtml).join('')}
          </div>
          <div class="dzc-points-row float-field">
            <input class="form-input" id="dzc-new-points" type="number" min="501" step="50"
                   placeholder=" " value="${picked.points}" oninput="DZCBuilder.pointsChanged(this.value)">
            <label class="float-label" for="dzc-new-points">Points limit</label>
          </div>
          <p class="dzc-field-note" id="dzc-points-note"></p>
        </div>
      </div>`;
    updatePointsNote();
    document.getElementById('dzc-new').classList.add('active');
  }

  /* The size cards already state the Group count and the per-Group cap, so
   * this says nothing when the typed number agrees with the card that is
   * selected. It speaks only when the number is unusable, or when it has moved
   * you to a different size than the one you clicked. */
  function updatePointsNote() {
    const el = document.getElementById('dzc-points-note');
    if (!el) return;
    const n = picked.points;
    const size = window.DZC.gameSizeFor(n);
    if (!size) {
      el.innerHTML = `<b>${n}pts is below the 501pt minimum</b> for a game (3.1).`;
      return;
    }
    const moved = size.id !== picked.size;
    if (moved) picked.size = size.id;
    el.textContent = moved ? `${n}pts makes this a ${size.label}.` : '';
    document.querySelectorAll('.game-size-option').forEach(o => {
      const on = o.dataset.size === size.id;
      o.classList.toggle('selected', on);
      o.setAttribute('aria-checked', on);
    });
  }

  /* Straight into the new army, with nothing in between.
   *
   * This used to close the modal and THEN set the hash, so you watched the
   * armies list while renderBuilder waited on the faction JSON — a network
   * fetch the first time you use a faction. The list flashed up, then the
   * builder replaced it.
   *
   * Now the faction is fetched while the button is still showing its press,
   * so by the time the modal goes the builder is already there. */
  /* "UCM Army 3" — the faction, then how many of that faction you have. Counts
   * the highest number already used rather than the list length, so deleting
   * the second of three does not hand the next one a name you already have. */
  function defaultArmyName(factionId) {
    const f = FACTIONS.find(x => x.id === factionId);
    const label = (f && (f.shortName || f.name)) || factionId;
    const re = new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' Army (\\d+)$', 'i');
    const used = (window.DZCArmy.all() || [])
      .map(a => (a.name || '').match(re)).filter(Boolean).map(m => parseInt(m[1], 10));
    return `${label} Army ${used.length ? Math.max.apply(null, used) + 1 : 1}`;
  }

  async function createArmy() {
    const btn = document.getElementById('dzc-create-btn');
    const typed = (document.getElementById('dzc-new-name').value || '').trim();
    const name = typed || defaultArmyName(picked.faction);
    if (btn) { btn.classList.add('is-going'); btn.disabled = true; }
    try {
      await window.DZC.loadFaction(picked.faction);
    } catch (e) { /* offline or a bad fetch: fall through and let the view report it */ }
    const a = window.DZCArmy.create(picked.faction, name, picked.points);
    location.hash = '#army/' + a.id;
    await renderBuilder(a.id);
    document.getElementById('dzc-new').classList.remove('active');
    if (btn) { btn.classList.remove('is-going'); btn.disabled = false; }
    picked.name = null;   // next dialog suggests afresh
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
    const v = triage(window.DZCArmy.validate(a), a);
    const spend = window.DZCArmy.categorySpend(a);
    const std = spend.standard || 0;
    const playable = a.groups.some(g => g.squads.some(s => s.commander));

    const ratio = ['vanguard', 'heavy', 'support'].map(c => {
      const val = spend[c] || 0;
      const over = val > std;
      return `<div class="dzc-ratio${over ? ' is-over' : ''}">
        <span>${c[0].toUpperCase() + c.slice(1)}</span>
        <b>${val}</b><i>of ${std}</i></div>`;
    }).join('');

    const left = Math.max(0, a.pointsLimit - cost);
    const pct = a.pointsLimit ? Math.min(100, Math.round((cost / a.pointsLimit) * 100)) : 0;

    /* Desktop gets a rail and a column; the rail carries everything you need
     * while working — what you have left to spend, and what is outstanding —
     * so it stays put instead of shoving the Groups down the page every time
     * an alert appears or clears. Below 900px it stacks above the list.
     * HANDOFF §2.2: desktop keeps panes, mobile does not. */
    root.innerHTML = `<div class="dzc-wrap dzc-builder" style="--acc:${accentOf(a.faction)}">
      <header class="dzc-b-head">
        <h1 contenteditable="true" spellcheck="false" class="dzc-b-name"
            onblur="DZCBuilder.rename(this.textContent)">${esc(a.name)}</h1>
        <div class="dzc-b-right">
          <!-- Play needs a Commander: CP per Round, hand size and the Initiative
               modifier all come from Commander Level (4.1). Offering it on an
               army that has none would open a mode that cannot run. Share and
               Print stay live, because a half-built list is worth sending
               someone or taking to a table. -->
          <button class="btn btn-ghost btn-sm" type="button" onclick="DZCBuilder.play()"
                  ${playable ? '' : 'disabled'}
                  title="${playable ? 'Run a game with this army'
                    : 'Add a Commander first — CP, hand size and Initiative all come from Commander Level (4.1)'}"
                  >${window.DZCIcon('layers', { size: 15 })} Play</button>
          <button class="btn btn-ghost btn-sm" type="button" onclick="DZCBuilder.share()"
                  title="Copy a link to this army">${window.DZCIcon('share', { size: 15 })} Share</button>
          <button class="btn btn-ghost btn-sm" type="button" onclick="DZCBuilder.print()"
                  title="Print the deployment sheet">${window.DZCIcon('print', { size: 15 })} Print</button>
        </div>
      </header>

      <div class="dzc-b-body">
        <aside class="dzc-rail">
          <div class="dzc-rail-card">
            <p class="dzc-b-sub"><span>${esc((FACTIONS.find(f => f.id === a.faction) || {}).name)}</span>
              <span>${size ? esc(size.label) : 'Below the 501pt minimum'}</span></p>
            <div class="dzc-rail-pts ${cost > a.pointsLimit ? 'is-over' : ''}">
              <b>${left}</b><span>pts left</span>
            </div>
            <div class="dzc-rail-track"><i style="width:${pct}%"></i></div>
            <p class="dzc-rail-line">${cost} of ${a.pointsLimit}pts spent</p>
            <p class="dzc-rail-line">${a.groups.length} of ${maxG || '—'} Groups</p>
          </div>

          <div class="dzc-rail-card">
            <div class="dzc-rail-title">Category spend</div>
            <div class="dzc-ratios" title="Vanguard, Heavy and Support may each not exceed Standard spend (3.2)">
              <div class="dzc-ratio is-std"><span>Standard</span><b>${std}</b></div>${ratio}
            </div>
          </div>

          ${commanderRail(a)}
          ${alertList(v.errors, 'err', 'issue to fix', 'issues to fix')}
          ${alertList(v.warnings, 'warn', 'note', 'notes')}
          ${v.ok && a.groups.length ? `<p class="dzc-legal">${window.DZCIcon('check_circle', { size: 15 })}This army is legal.</p>` : ''}
          ${shortfallHtml(a)}
        </aside>

        <div class="dzc-b-main">
          ${a.groups.map(g => groupHtml(a, g)).join('')}
          <button class="btn btn-outline dzc-add-group" type="button" onclick="DZCBuilder.addGroup()">+ Add Group</button>
        </div>
      </div>
    </div>`;
  }

  /* What this list needs beyond what you own. Advisory only, and separate from
   * the rules issues above: owning too few models is not illegal, it is a
   * shopping list. */
  function shortfallHtml(a) {
    // Off until you opt in: reporting what you are short of only makes sense
    // once you have told the app what you own.
    if (!window.App || !App.collectionOn || !App.collectionOn()) return '';
    if (!window.DZCCollection) return '';
    window.DZCCollection.load();
    const short = window.DZCCollection.shortfall(a);
    if (!short.length) return '';
    return `<p class="dzc-short"><b>Not in your collection</b>${
      short.map(s => `${esc(s.name)} — using ${s.need}, own ${s.have}`).join('; ')}</p>`;
  }

  /* What a Group has spent, how big it is, and what its Transports have room
   * for. Every number is paired with its icon and spelled out, because "3/6"
   * on its own does not say 3 of what. */
  function groupMeters(a, g) {
    const cost = window.DZCArmy.groupCost(a, g);
    const cap = window.DZC.maxGroupCost(a.pointsLimit);
    const models = g.squads.reduce((t, s) => t + s.models.length, 0);
    const squads = g.squads.length;
    const U = window.DZCUnits;

    const space = window.DZCArmy.groupSpace(a, g).map(sp => {
      const free = sp.total - sp.used;
      const name = U.shapeName(sp.shape);
      return `<span class="dzc-meter${sp.used > sp.total ? ' is-over' : free === 0 ? ' is-full' : ''}"
        title="${esc(`${sp.used} of ${sp.total} ${name} capacity used${
          free > 0 ? `, room for ${free} more` : sp.used > sp.total ? ' — overloaded' : ' — full'}`)}">
        ${U.shape(sp.shape, 13, true)}<b>${sp.used}</b><i>of ${sp.total} ${esc(name)}</i></span>`;
    }).join('');

    return `<div class="dzc-g-meters">
      <span class="dzc-meter${cost > cap ? ' is-over' : ''}"
            title="${esc(`${cost} of the ${cap}pt ceiling one Group may spend (3.2)`)}">
        ${window.DZCIcon('calculate', { size: 13 })}<b>${cost}</b><i>of ${cap}pts</i></span>
      <span class="dzc-meter" title="${esc(`${squads} Squad${squads === 1 ? '' : 's'} in this Group`)}">
        ${window.DZCIcon('groups', { size: 13 })}<b>${squads}</b><i>Squad${squads === 1 ? '' : 's'}</i></span>
      <span class="dzc-meter" title="${esc(`${models} model${models === 1 ? '' : 's'} in this Group`)}">
        ${window.DZCIcon('deployed_code', { size: 13 })}<b>${models}</b><i>model${models === 1 ? '' : 's'}</i></span>
      ${space}
    </div>`;
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
        <button class="dzc-icon-btn" type="button" title="Remove Group"
                onclick="DZCBuilder.removeGroup('${g.id}')" aria-label="Remove ${esc(g.name)}">&times;</button>
      </header>
      ${groupMeters(a, g)}
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
        ${u.variants.map(vr => `<option value="${esc(vr.name)}"${vr.name === m.variant ? ' selected' : ''}>${esc(vr.name)} — ${vr.points}pts</option>`).join('')}
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
      ${unitFacts(u, a.faction)}
      ${upgradesHtml(a, s, u)}
      <div class="dzc-sq-opts">
        ${variantPicker}
        ${transportPicker}
      </div>
      ${riders.map(r => squadHtml(a, g, r, depth + 1)).join('')}
    </div>`;
  }

  /* Only the guns every variant carries. Listing all of them was misleading:
   * a variant-restricted weapon is not something the Squad necessarily has,
   * and an upgrade is something you have not bought. So:
   *   - no box        -> base weapon, every variant has it
   *   - box 'variant' -> only if its variant list covers ALL of them
   *   - box 'upgrade' -> never shared, it is a purchase
   * A unit with no variants has no restrictions to satisfy. */
  function sharedWeapons(u) {
    const names = (u.variants || []).map(v => v.name);
    return (u.weapons || []).filter(w => {
      if (w.box === 'upgrade') return false;
      if (w.box !== 'variant') return true;
      if (!names.length) return true;
      const on = w.variants || [];
      return names.every(n => on.indexOf(n) !== -1);
    });
  }

  /* Commanders live in the rail, as a card each with a button under them —
   * not as a "— none —" select stapled to the bottom of every Squad, where
   * five Squads meant five empty slots for a thing you take one of.
   *
   * DZC ranks run 4-7; the insignia helper draws 1-5 pips, so the level is
   * offset rather than clamped, which would have drawn L6 and L7 the same. */
  function commanderRail(a) {
    const list = window.DZCArmy.commanders(a);
    const cards = list.map(c => {
      const targets = window.DZCArmy.commanderTargets(a, c.id);
      const insignia = window.RankInsignia
        ? window.RankInsignia(a.faction, Math.max(1, c.level - 3), 26) : '';
      const assign = targets.length
        ? `<label class="dzc-cmdr-assign">Aboard
             <select onchange="DZCBuilder.assignCommander('${c.id}', this.value)">
               <option value="">Choose a Squad</option>
               ${targets.map(t => `<option value="${t.squad.id}"${t.squad.id === c.squadId ? ' selected' : ''}
                 >${esc(t.unit.name)}${t.group.name ? ' — ' + esc(t.group.name) : ''}</option>`).join('')}
             </select></label>`
        : '<p class="dzc-cmdr-hint">Add a squad that this Commander can join.</p>';
      return `<div class="dzc-rail-card dzc-cmdr-card${c.squadId ? '' : ' is-loose'}">
        <div class="dzc-cmdr-head">
          ${insignia}
          <div>
            <b>Level ${c.level} Commander</b>
            <span class="dzc-cmdr-pts">${window.DZCArmy.levelCost(c.level)}pts</span>
          </div>
        </div>
        ${assign}
        <button type="button" class="dzc-cmdr-remove" onclick="DZCBuilder.removeCommander('${c.id}')"
                >${window.DZCIcon('delete', { size: 13 })}Remove</button>
      </div>`;
    }).join('');
    return cards + `<button type="button" class="dzc-cmdr-add" onclick="DZCBuilder.openCommander()"
      >${window.DZCIcon('military_tech', { size: 18 })}${list.length ? 'Add another Commander' : 'Add Commander'}</button>`;
  }

  /* Every level the agreed game size allows, with what it costs and what it
   * brings to the table. Famous Commanders are not released, so this is the
   * generic ladder only — the schema slot is there for when they are. */
  function openCommander() {
    const a = current;
    if (!a) return;
    const size = window.DZC.gameSizeFor(a.pointsLimit);
    const levels = window.DZC.commanderLevels((size || {}).id || 'skirmish');
    const rows = levels.map(l => {
      const insignia = window.RankInsignia
        ? window.RankInsignia(a.faction, Math.max(1, l.level - 3), 30) : '';
      return `<div class="dzc-cmdr-opt">
        ${insignia}
        <!-- No CP or hand-size line: index.json carries level and points only,
             and those numbers are not going to be invented. -->
        <div class="dzc-cmdr-opt-body"><b>Level ${l.level}</b></div>
        <span class="dzc-cmdr-opt-pts">${l.points}pts</span>
        <button type="button" class="btn btn-primary btn-sm"
                onclick="DZCBuilder.addCommander(${l.level})">Add</button>
      </div>`;
    }).join('');
    document.getElementById('dzc-cmdr-body').innerHTML = rows
      || '<p class="dzc-empty">No Commander levels are available at this size.</p>';
    document.getElementById('dzc-cmdr').classList.add('active');
  }

  function closeCommander() { document.getElementById('dzc-cmdr').classList.remove('active'); }

  /* An army you are halfway through building is not a broken army.
   *
   * Some rules are about what you HAVE built — a Group over the quarter cap, a
   * Rare taken three times, a Transport that is not full. Those are wrong the
   * moment they happen and say so.
   *
   * Others are about what the finished list must CONTAIN. "You haven't added a
   * Commander" fired on your first Squad, before you had any chance to satisfy
   * it and with nothing actually wrong. Those say nothing at all until half
   * the points are spent — and then they are an ISSUE, not a note, because an
   * army without a Commander is illegal. Notes are for things that are true
   * but not wrong: Squads beginning Reserved, a Group of only Transports.
   *
   * validate() keeps reporting everything; this only decides when it shows. */
  const COMPLETENESS = /^3\.2\.5$/;

  function triage(v, army) {
    const cost = window.DZCArmy.armyCost(army);
    const limit = army.pointsLimit || 0;
    const halfway = limit ? cost >= limit / 2 : true;
    return {
      errors: halfway ? v.errors : v.errors.filter(e => !COMPLETENESS.test(e.rule)),
      warnings: v.warnings,
      // Legality is unchanged — a held requirement is still unmet, so the army
      // is not announced as legal just because the message is not shown yet.
      ok: !v.errors.length
    };
  }

  /* Two severities, and they are not the same thing: an "issue to fix" means
   * the list is illegal, a "note" means there is something worth knowing about
   * a list that is otherwise fine. Each is headed with its own count so you can
   * see at a glance how much is left, and each cites its rule at the END of the
   * sentence rather than wearing a rule number as a badge on the front. */
  function alertList(items, kind, one, many) {
    if (!items.length) return '';
    return `<div class="dzc-issues dzc-issues--${kind}">
      <p class="dzc-issues-head">${items.length} ${items.length === 1 ? one : many}</p>
      <ul>${items.map(e =>
        `<li>${esc(e.msg)} <span class="dzc-rulecite">(rule ${esc(e.rule)})</span></li>`).join('')}</ul>
    </div>`;
  }

  /* Stats, shared guns and rules for a unit. Shared by the picker card and the
   * squad row so a unit reads identically whether you are choosing it or
   * looking at what you already took. Built on the reference renderers rather
   * than a second copy of them. */
  function unitFacts(u, faction, opts) {
    const U = window.DZCUnits;
    const weapons = sharedWeapons(u).map(w =>
      `<span class="dzc-pick-wpn">${window.DZCIcon.arc(w.arc, { size: 12 })}${esc(w.name)}</span>`).join('');
    return `<div class="dzc-facts">
      <div class="dzc-pick-stats">${U.statsHtml(u, opts)}</div>
      ${weapons ? `<div class="dzc-pick-wpns">${weapons}</div>` : ''}
      ${u.special ? `<div class="dzc-pick-rules">${U.rulesHtml(u.special, faction)}</div>` : ''}
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
    /* Transports are IN the picker now. Hiding them and assigning them through
     * a dropdown made the one thing that grows a Group invisible — and 3.2.4
     * is explicit that choosing a Transport alongside a Squad is how a Group
     * forms. canAddUnit refuses the ones that make no sense here, and says
     * which rule refuses them. */
    const cats = ['All', 'Standard', 'Vanguard', 'Heavy', 'Support', 'Transport'];
    /* --acc is declared inline on .dzc-wrap, and this modal lives outside it,
     * so the active chip was painting white text on an undefined background —
     * the filters worked, you just could not see which one was on. */
    const U = window.DZCUnits;
    /* The bar is built ONCE and never rebuilt. Every control below only ever
     * redraws the list and re-flags the chips in place, because rewriting this
     * markup moved the caret, reset the scroll and made the whole modal jump
     * under your finger every time you touched a sort. */
    document.getElementById('dzc-picker-body').innerHTML = `
      <div class="dzc-pick-bar" id="dzc-pick-bar" style="--acc:${accentOf(a.faction)}">
        <div class="dzc-search-row">${window.DZCIcon('search')}
          <input class="dzc-search" id="dzc-pick-search" type="search"
                 placeholder="Search units, variants, weapons or rules"
                 value="${esc(picker.search)}"
                 oninput="DZCBuilder.pickerSearch(this.value)" aria-label="Search units">
          <button type="button" class="dzc-view-toggle" id="dzc-pick-view"
                  onclick="DZCBuilder.pickerView()"></button>
        </div>
        <div class="dzc-chips">${cats.map(c =>
          `<button type="button" class="dzc-chip" data-cat="${esc(c)}"
            onclick="DZCBuilder.pickerCat('${c}')">${esc(c)}</button>`).join('')}</div>
        <div class="dzc-pick-sorts">
          <span class="dzc-pick-sortlab">Sort</span>
          ${SORTS.map(s => `<button type="button" class="dzc-chip dzc-chip--sm" data-sort="${s.key}"
            onclick="DZCBuilder.pickerSort('${s.key}')"
            >${esc(s.label)}<i class="dzc-dir"></i></button>`).join('')}
          ${FILTERS.map(fl => `<button type="button" class="dzc-chip dzc-chip--sm" data-filter="${fl.key}"
            onclick="DZCBuilder.pickerFilter('${fl.key}')">${esc(fl.label)}</button>`).join('')}
        </div>
        <!-- The six transport symbols are the grammar of what fits with what
             (3.2.4.2), so they filter by the glyph itself rather than by a word
             for the glyph -- the chip is the thing printed on the card. -->
        <div class="dzc-pick-shapes">
          <span class="dzc-pick-sortlab">Fits</span>
          ${U.SHAPES.map(sh => `<button type="button" class="dzc-shape-chip" data-shape="${sh}"
            style="--sh:${U.shapeInk(sh)}" onclick="DZCBuilder.pickerShape('${sh}')"
            title="${esc('Only units that carry or fill a ' + U.shapeName(sh))}"
            aria-label="${esc('Filter to ' + U.shapeName(sh))}">${U.shape(sh, 15, true)}</button>`).join('')}
        </div>
        <div class="dzc-pick-results" id="dzc-pick-results"></div>
      </div>
      <div class="dzc-pick-list" id="dzc-pick-list"></div>`;
    renderPickList();
  }

  /* Re-flag the chips without rewriting them. The direction arrow lives in a
   * fixed-width slot that is always present, so a chip is exactly as wide
   * sorted as unsorted and nothing after it reflows. */
  function syncChips() {
    const bar = document.getElementById('dzc-pick-bar');
    if (!bar) return;
    bar.querySelectorAll('[data-cat]').forEach(b =>
      b.classList.toggle('is-active', b.dataset.cat === picker.category));
    bar.querySelectorAll('[data-sort]').forEach(b => {
      const on = b.dataset.sort === picker.sort;
      b.classList.toggle('is-active', on);
      const d = b.querySelector('.dzc-dir');
      if (d) d.textContent = on ? (picker.dir < 0 ? '↓' : '↑') : '';
    });
    bar.querySelectorAll('[data-filter]').forEach(b =>
      b.classList.toggle('is-active', picker.filters.indexOf(b.dataset.filter) !== -1));
    bar.querySelectorAll('[data-shape]').forEach(b =>
      b.classList.toggle('is-active', picker.shapes.indexOf(b.dataset.shape) !== -1));
    const v = document.getElementById('dzc-pick-view');
    if (v) {
      const grid = picker.view === 'grid';
      v.title = grid ? 'Show as a list' : 'Show as cards';
      v.innerHTML = window.DZCIcon(grid ? 'list_alt' : 'grid_view', { size: 16 });
    }
  }

  /* Sorting and filtering the adder. Dropfleet has Points / Name / Tonnage
   * plus seven filters and a results bar (renderShipSelectGrid, app.js:4409);
   * these are the DZC equivalents. Capacity is ours — it decides what a Group
   * can be built around, which Dropfleet has no analogue for. */
  const SORTS = [
    { key: 'points',   label: 'Price',    get: u => unitLowPoints(u) },
    { key: 'name',     label: 'Name',     get: u => u.name.toLowerCase() },
    { key: 'category', label: 'Category', get: u => CATEGORY_ORDER.indexOf(u.category) },
    { key: 'squad',    label: 'Squad',    get: u => (u.squadMax != null ? u.squadMax : -1) },
    { key: 'capacity', label: 'Capacity', get: u => totalCapacity(u) }
  ];
  const FILTERS = [
    { key: 'rare',     label: 'Rare',     test: u => !!u.rare },
    { key: 'unique',   label: 'Unique',   test: u => !!u.unique },
    { key: 'variants', label: 'Variants', test: u => (u.variants || []).length > 0 },
    { key: 'carries',  label: 'Carries',  test: u => totalCapacity(u) > 0 },
    { key: 'aux',      label: 'Auxiliary', test: u => !!u.auxiliaryTransport }
  ];
  const CATEGORY_ORDER = ['Standard', 'Vanguard', 'Heavy', 'Support', 'Transport', 'Generated'];

  function unitLowPoints(u) {
    if (u.points != null) return u.points;
    const ps = (u.variants || []).map(v => v.points).filter(p => p != null);
    return ps.length ? Math.min.apply(null, ps) : 0;
  }
  function totalCapacity(u) {
    return (((u.transport || {}).capacity) || []).reduce((t, c) => t + (c.n || 0), 0);
  }

  /* Only the list is redrawn on a keystroke. Re-rendering the whole body
   * replaced the <input>, which threw away focus and the caret — you got one
   * character and then nothing. */
  function renderPickList() {
    const a = current;
    const f = window.DZC.faction(a.faction);
    if (!f) return;
    const q = picker.search.trim().toLowerCase();

    let units = f.units.filter(u => u.selectable !== false);
    if (picker.category !== 'All') units = units.filter(u => u.category === picker.category);
    picker.filters.forEach(k => {
      const fl = FILTERS.find(x => x.key === k);
      if (fl) units = units.filter(fl.test);
    });
    // A shape matches whether the unit OFFERS it or FILLS it: picking "square"
    // asks "what has anything to do with squares", which is the question you
    // have when you are pairing cargo to a Transport. Several shapes are OR.
    if (picker.shapes.length) {
      units = units.filter(u => {
        const t = u.transport || {};
        return picker.shapes.some(sh =>
          (t.capacity || []).some(c => c.shape === sh) || (t.fills || []).some(c => c.shape === sh));
      });
    }
    if (q) units = units.filter(u => u.name.toLowerCase().includes(q)
      || (u.variants || []).some(v => v.name.toLowerCase().includes(q))
      || (u.weapons || []).some(w => (w.name || '').toLowerCase().includes(q))
      || (u.special || '').toLowerCase().includes(q));

    const s = SORTS.find(x => x.key === picker.sort) || SORTS[0];
    units = units.slice().sort((x, y) => {
      const ax = s.get(x), ay = s.get(y);
      return (ax < ay ? -1 : ax > ay ? 1 : x.name.localeCompare(y.name)) * picker.dir;
    });

    const list = document.getElementById('dzc-pick-list');
    if (list) {
      // Hold the scroll. Changing a sort should re-order what you are looking
      // at, not throw you back to the top of it.
      const scroller = list.parentElement;
      const y = scroller ? scroller.scrollTop : 0;
      list.className = 'dzc-pick-list' + (picker.view === 'list' ? ' is-list' : '');
      list.innerHTML = units.map(u => pickCard(u, a)).join('')
        || `<p class="dzc-empty">${q ? `Nothing matches “${esc(picker.search)}”.`
            : picker.shapes.length ? 'No unit carries or fills that shape.'
            : picker.filters.length ? 'Nothing matches those filters.'
            : 'Nothing in this category.'}</p>`;
      if (scroller) scroller.scrollTop = y;
    }
    // Always rendered, never empty: a line that appears and disappears takes
    // the whole grid with it every time you touch a filter.
    const bar = document.getElementById('dzc-pick-results');
    if (bar) {
      const filtered = q || picker.filters.length || picker.shapes.length || picker.category !== 'All';
      const blocked = units.filter(u => !window.DZCArmy.canAddUnit(a, picker.groupId, u.id).ok).length;
      bar.innerHTML = `<span>${units.length} unit${units.length === 1 ? '' : 's'}${
        blocked ? `, ${blocked} unavailable here` : ''}</span>${
        filtered ? '<button type="button" onclick="DZCBuilder.pickerClear()">Clear</button>' : ''}`;
    }
    syncChips();
  }

  /* A picker card carries what you need to decide without opening anything:
   * art, cost, every stat, the guns every variant shares, and the rules. The
   * card body opens the unit's stats, weapons and rules in full; adding is its
   * own button. */
  function pickCard(u, a) {
    const ps = (u.variants || []).map(v => v.points).filter(p => p != null);
    const price = u.points != null ? `${u.points}` : ps.length
      ? `${Math.min.apply(null, ps)}–${Math.max.apply(null, ps)}` : '—';
    const chk = window.DZCArmy.canAddUnit(a, picker.groupId, u.id);
    const U = window.DZCUnits;
    const meta = [esc(u.category), esc(u.type || ''),
      u.squadMin != null ? `Squad ${U.squadHtml(u)}` : '']
      .filter(Boolean).map(t => `<span>${t}</span>`).join('');
    return `<div class="dzc-pick${chk.ok ? '' : ' is-blocked'}">
      ${u.rare || u.unique ? `<span class="dzc-pick-flags">${u.rare
        ? '<span class="dzc-flag dzc-flag--rare">Rare</span>' : ''}${u.unique
        ? '<span class="dzc-flag dzc-flag--unique">Unique</span>' : ''}</span>` : ''}
      <div class="dzc-pick-open" role="button" tabindex="0"
           title="Stats, weapons and rules"
           onclick="DZCUnits.openDetail('${esc(u.id)}','${esc(a.faction)}')"
           onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();DZCUnits.openDetail('${esc(u.id)}','${esc(a.faction)}')}">
        ${u.art ? `<img class="dzc-pick-art" src="${esc(u.art)}" alt="" loading="lazy">`
                : '<span class="dzc-pick-noart"></span>'}
        <div class="dzc-pick-head">
          <span class="dzc-pick-name">${esc(u.name)}</span>
          <span class="dzc-pick-cost">${price}<small>pts</small></span>
        </div>
        <span class="dzc-pick-meta">${meta}</span>
        ${unitFacts(u, a.faction, { compact: true })}
        <!-- The variant IS the choice: a different gun, sometimes a different
             role. Burying it in a per-model select inside the Squad you already
             committed to means you pick blind. -->
        ${(u.variants || []).length ? `<div class="dzc-pick-variants">${u.variants.map(v =>
          `<span class="dzc-pick-vchip">${esc(v.name)}${v.points != null ? ` ${v.points}pts` : ''}</span>`
        ).join('')}</div>` : ''}
      </div>
      ${chk.ok
        ? `<button type="button" class="dzc-pick-add" onclick="DZCBuilder.pick('${esc(u.id)}')">
             ${window.DZCIcon('add', { size: 18 })}Add</button>`
        : `<span class="dzc-pick-blocked">${window.DZCIcon('lock', { size: 14 })}${esc(chk.reason)}</span>`}
    </div>`;
  }

  /* Adding does NOT close the picker. You are usually building a Group out of
   * several Squads, and bouncing back to the list after each one made that a
   * chore. The picker re-renders so Rare/Unique limits and squad-size blocks
   * update against what you just took. */
  async function pick(unitId) {
    const g = (current.groups || []).find(x => x.id === picker.groupId);
    const u = window.DZC.unit(current.faction, unitId);
    if (!g || !u) return;

    /* Picking a Transport does not make a loose Squad of Transports — it
     * carries something already here. assignTransport builds the Transport
     * Squad, links it and derives how many are needed to take it full, which
     * is the whole of 3.2.4 in one call. */
    /* Transport-first is a real way to build: buy the Albatross, then fill it.
     * So a Transport only routes through assignTransport when there is already
     * something here waiting for a ride; otherwise it is simply added, and
     * whatever comes next will go aboard it. */
    if (u.category === 'Transport') {
      const target = g.squads.find(s => {
        const su = window.DZCArmy.unitOf(current, s);
        return su && su.category !== 'Transport' && !s.carriedBy && window.DZC.canCarry(u, su);
      });
      if (target) {
        const r = window.DZCArmy.assignTransport(current, target.id, unitId);
        if (!r.ok) return say(r.reason);
        await renderBuilder(current.id);
        renderPickList();
        return say(r.warn || `${u.name} added, carrying ${
          window.DZCArmy.unitOf(current, target).name}.`, 'local_shipping');
      }
    }

    const s = window.DZCArmy.addSquad(current, picker.groupId, unitId);
    if (!s) return;                       // refused; the picker already said why

    /* Anything joining a Group that already has a Transport with room is here
     * BECAUSE of that room (3.2.4.1), so put it aboard rather than leaving it
     * standing next to the thing it is supposed to be riding in. */
    const carrier = g.squads.find(x => {
      const xu = window.DZCArmy.unitOf(current, x);
      if (x.id === s.id || x.carriedBy || !xu) return false;
      if (!(xu.category === 'Transport' || xu.auxiliaryTransport)) return false;
      if (!window.DZC.canCarry(xu, u)) return false;
      const aboard = g.squads.filter(y => y.carriedBy === x.id && y.id !== s.id)
        .map(y => ({ unit: window.DZCArmy.unitOf(current, y), count: y.models.length }))
        .filter(y => y.unit);
      aboard.push({ unit: u, count: s.models.length });
      return window.DZC.loadCheck(xu, aboard).ok;
    });
    if (carrier) s.carriedBy = carrier.id;

    await renderBuilder(current.id);
    renderPickList();
    say(`Added ${u.name}. Pick another, or close when done.`, 'add');
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
        .map(k => `${esc(window.DZC.statLabel(k))} <b>${esc(u.stats[k])}</b>`).join('  ');

      // Variants are per model, so a mixed Squad is listed by its actual mix.
      const mix = {};
      s.models.forEach(m => { const k = m.variant || u.name; mix[k] = (mix[k] || 0) + 1; });
      const mixStr = Object.keys(mix).length > 1 || (u.variants || []).length
        ? Object.keys(mix).map(k => `${mix[k]}× ${esc(k)}`).join(', ') : '';

      const cap = (u.transport && (u.transport.capacity || []).length)
        ? `carries ${(u.transport.capacity).map(c => `${c.n} ${c.shape}`)
            .join(u.transport.capacityMode === 'both' ? ' + ' : ' / ')}` : '';

      const wpns = (u.weapons || []).length ? `<table class="pr-wpn">
        <tr><th>Weapon</th><th>Arc</th><th>Move &amp; Attack</th><th>Range</th><th>Attacks</th><th>Accuracy</th><th>Energy</th><th>Special</th></tr>
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
        <div class="pr-stats">${stats}${u.special ? ` — ${esc(u.special)}` : ''}</div>
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
        <p class="pr-sub"><span>${esc((FACTIONS.find(f => f.id === a.faction) || {}).name || a.faction)}</span>
          <span>${size ? esc(size.label) : ''}</span>
          <span>${a.groups.length} Group${a.groups.length === 1 ? '' : 's'}</span>
          <span><b>${window.DZCArmy.armyCost(a)}</b> / ${a.pointsLimit}pts</span></p>
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
  /* The toast started life as a refusal, hence the padlock. It now also
   * confirms an add, so the icon is a parameter — a lock on "you can't" and
   * nothing else. */
  function say(msg, iconName) {
    if (!msg) return;
    let el = document.getElementById('dzc-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dzc-toast';
      el.className = 'dzc-toast';
      document.body.appendChild(el);
    }
    el.innerHTML = `${window.DZCIcon(iconName || 'lock', { size: 15 })}<span>${esc(msg)}</span>`;
    el.classList.add('is-on');
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => el.classList.remove('is-on'), 5200);
  }

  window.DZCBuilder = {
    renderList, renderBuilder, openNew, createArmy, del, open,
    /* Redraw whatever is on screen. Settings changes call this because a
     * toggle can change what the builder is allowed to show. */
    refresh: () => { if (current) renderBuilder(current.id); },
    // Only remember a name the user actually typed, so switching faction
    // re-suggests "Scourge Army 1" instead of leaving "UCM Army 1" behind.
    nameTyped: v => { picked.name = v; },
    pickFaction: id => { picked.faction = id; openNew(); },
    /* Clicking a size sets the limit to the TOP of that band, which is what
     * people mean by "a Clash game". Typing an exact number then wins, because
     * the agreed limit is what the rules actually key off — the per-Group cap
     * is a quarter of IT, not a quarter of the band (3.2). */
    pickSize: id => {
      const g = window.DZC.index.gameSizes.find(s => s.id === id);
      if (!g) return;
      picked.size = id;
      picked.points = g.max || g.min;
      openNew();
    },
    pointsChanged: v => {
      const n = parseInt(v, 10);
      picked.points = isNaN(n) ? 0 : n;
      updatePointsNote();
    },
    rename: t => { current.name = (t || '').trim() || 'Army'; window.DZCArmy.touch(current); },
    renameGroup: (id, t) => {
      const g = current.groups.find(x => x.id === id);
      if (g) { g.name = (t || '').trim() || 'Group'; window.DZCArmy.touch(current); }
    },
    // Just the empty Group. It used to open the picker straight away, which
    // took the decision "which Group am I filling" away from you and made
    // adding two Groups back to back a fight with a modal.
    addGroup: async () => {
      window.DZCArmy.addGroup(current);
      await renderBuilder(current.id);
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
    openCommander, closeCommander,
    addCommander: level => {
      const r = window.DZCArmy.addCommander(current, level);
      if (!r.ok) return say(r.reason);
      closeCommander();
      refresh();
      say(`Level ${level} Commander added. Choose the Squad it rides with.`, 'military_tech');
    },
    removeCommander: id => { window.DZCArmy.removeCommander(current, id); refresh(); },
    assignCommander: (id, squadId) => {
      const r = window.DZCArmy.assignCommander(current, id, squadId);
      if (!r.ok) return say(r.reason);
      refresh();
    },
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
    // Only the list is redrawn: re-rendering the body would replace the
    // <input> under the caret and swallow every character after the first.
    // None of these rebuild the bar. renderPickList redraws the list and
    // re-flags the chips where they stand, so the controls you are aiming at
    // never move out from under you.
    pickerSearch: v => { picker.search = v; renderPickList(); },
    pickerCat: c => { picker.category = c; renderPickList(); },
    pickerSort: k => {
      if (picker.sort === k) picker.dir = -picker.dir; else { picker.sort = k; picker.dir = 1; }
      renderPickList();
    },
    pickerFilter: k => {
      const i = picker.filters.indexOf(k);
      if (i === -1) picker.filters.push(k); else picker.filters.splice(i, 1);
      renderPickList();
    },
    pickerShape: sh => {
      const i = picker.shapes.indexOf(sh);
      if (i === -1) picker.shapes.push(sh); else picker.shapes.splice(i, 1);
      renderPickList();
    },
    pickerView: () => { picker.view = picker.view === 'grid' ? 'list' : 'grid'; renderPickList(); },
    pickerClear: () => {
      picker.search = ''; picker.filters = []; picker.shapes = []; picker.category = 'All';
      const box = document.getElementById('dzc-pick-search');
      if (box) box.value = '';
      renderPickList();
    },
    closePicker: () => document.getElementById('dzc-picker').classList.remove('active'),
    closeNew: () => document.getElementById('dzc-new').classList.remove('active')
  };
})();
