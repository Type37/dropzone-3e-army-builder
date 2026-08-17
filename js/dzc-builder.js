/* DZC army builder, the views over js/dzc-army.js.
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

  // `full` matches the reference's list. UCM and PHR are initials, and an army
  // card has room to say what they stand for.
  const FACTIONS = [
    { id: 'ucm', name: 'UCM', full: 'United Colonies of Mankind', accent: '#30903c' },
    { id: 'phr', name: 'PHR', full: 'Post-Human Republic', accent: '#c9a92c' },
    { id: 'scourge', name: 'Scourge', full: 'Scourge', accent: '#60489c' },
    { id: 'shaltari', name: 'Shaltari', full: 'Shaltari', accent: '#e46024' },
    { id: 'resistance', name: 'Resistance', full: 'Resistance', accent: '#3c84c0' },
    { id: 'bioficer', name: 'Bioficers', full: 'Bioficers', accent: '#9c1818' }
  ];
  const accentOf = f => (FACTIONS.find(x => x.id === f) || {}).accent || '#1b3a5c';

  let current = null;                 // the army being edited
  let picker = { groupId: null, kind: 'unit', category: 'All', search: '', sort: 'points', dir: 1,
                 view: 'grid', filters: [], shapes: [], more: false };
  /* THINGS TURNING ON AND OFF, SAID ONCE, EVERYWHERE. Jet, 2026-08-07: "I want
   * ANIMATIONS FOR THINGS TURNING ON OR OFF across da board."
   *
   * The builder redraws the WHOLE army on every press, so the control you just
   * pressed is not the control that comes back -- it is a fresh element that
   * happens to be in the on state, and a CSS transition on an element that has
   * only ever had one state never runs. Every toggle therefore has to be TOLD
   * that it changed, and the only thing that knows is the previous draw.
   *
   * One map, one call. flip(key, on) returns the class to put on the element
   * and remembers the state for next time; a key it has never seen returns
   * nothing, because opening an army you built yesterday must not light up
   * every upgrade in it. See .is-turn-on / .is-turn-off in dzc.css.
   *
   * The two earlier versions of this idea -- the weapon cards' `wasLive` and
   * the Variant blocks' `tookVariant` -- stay where they are: each keys on
   * something this does not have, and one map keyed three ways is worse than
   * three maps keyed once. */
  const turned = new Map();

  function flip(key, on) {
    const was = turned.get(key);
    turned.set(key, !!on);
    if (was === undefined || was === !!on) return '';
    return on ? ' is-turn-on' : ' is-turn-off';
  }

  /* THINGS ARRIVE AND THINGS LEAVE. Jet, 2026-08-10: "when stuff appears on
   * screen, have animations in. when stuff gets deleted, have animations out."
   *
   * Both halves fight the same fact: every action here redraws the whole
   * builder by replacing innerHTML. So on the way IN, everything is new every
   * time -- a plain CSS entry animation would deal the entire army out again
   * on each press of a stepper, which is not an animation, it is a flicker.
   * And on the way OUT there is nothing left to animate: removeSquad mutates
   * the model and the element is gone in the same frame.
   *
   * enter() is flip()'s trick keyed on identity instead of on state. A Squad
   * id it has never drawn gets the class once and never again. `ready` is the
   * guard: on the first render of a screen every id is new, and opening a list
   * you built last week must not deal itself out card by card, so that pass
   * only fills the set. Everything after it animates.
   *
   * leave() runs BEFORE the mutation and hands back a promise, so the action
   * waits for the card to go rather than racing it.
   *
   * The timeout is not belt-and-braces, and this is not a guess: in a tab with
   * document.hidden the animation reports playState "running" and a
   * currentTime frozen at 0 forever, because a hidden document is not
   * rendered and the animation clock does not tick. animationend never fires.
   * Switch away mid-delete without this and the Squad never goes. Same for a
   * display:none ancestor and for anything the browser declines to animate. A
   * delete that silently stops working is far worse than one that skips its
   * animation, so the race is always won by the timeout. */
  const seen = new Set();
  let armySeen = null;      // the army id whose ids are already in `seen`
  let listSeen = false;     // the armies list has been drawn once

  function enter(key, ready) {
    if (seen.has(key)) return '';
    seen.add(key);
    return ready ? ' is-in' : '';
  }

  const REDUCED = () => window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function leave(sel) {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    /* document.hidden short-circuits, and it is the case the timeout below was
     * written for. A hidden document is not rendered, so nothing plays: the
     * animation sits at playState "running" with currentTime frozen at 0 and
     * animationend never arrives. Worse, setTimeout in a hidden tab is
     * throttled to about a second, so falling through to the guard made a
     * delete take 1005ms instead of 160. Measured both. Nobody is watching a
     * hidden tab, so there is nothing to animate for: go straight through. */
    if (!el || REDUCED() || document.hidden) return Promise.resolve();
    return new Promise(done => {
      let over = false;
      const fin = () => { if (!over) { over = true; done(); } };
      el.addEventListener('animationend', fin, { once: true });
      el.classList.add('is-out');
      setTimeout(fin, 260);
    });
  }

  // Which Group the detail pane is showing. Null falls back to the first, so
  // opening an army always lands on something rather than an empty pane.
  let selectedGroup = null;
  // Phone only. A Group is a screen you drill into (CLAUDE.md §4), so the list
  // and the detail take turns rather than stacking into one long scroll. That
  // stack is the thing the three panes replaced.
  let drilled = false;
  // How the army list is ordered. Not stored: it is a way of looking at the
  // list for a moment, not a preference about it.
  let listSort = 'recent';
  // Phone only, and not stored: whether the rail is showing is a thing you do
  // for a moment, not a preference about the app. Closed to start, because the
  // peek line above it carries the two numbers you keep glancing at.
  let railOpen = false;

  // ------------------------------------------------------------- army list

  async function renderList() {
    const root = document.getElementById('view-armies');
    if (!root) return;
    await window.DZC.loadIndex();
    window.DZCArmy.load();
    /* Sorted, and only offered once there is something to sort. Dropfleet
     * hides its sort bar below two fleets (app.js:1627) and that is right: a
     * control that cannot change anything is noise on the screen you see
     * first. Recent is the default because the list you were last in is
     * almost always the one you came back for. */
    const list = window.DZCArmy.load().slice().sort(
      listSort === 'name' ? (a, b) => a.name.localeCompare(b.name)
      : listSort === 'faction' ? (a, b) => a.faction.localeCompare(b.faction) || a.name.localeCompare(b.name)
      : listSort === 'points' ? (a, b) => window.DZCArmy.armyCost(b) - window.DZCArmy.armyCost(a)
      : (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    /* Built to the Dropfleet fleet card (app.js:1660), because it already
     * solved this: the faction crest and its FULL name in a chip along the
     * top, the list's own name below, the points big with the limit small
     * beside them, the game size and Group count on the same line, a fill bar,
     * a strip of what is actually in it, and when it was last touched. */
    const cards = list.map(a => {
      const cost = window.DZCArmy.armyCost(a);
      const size = window.DZC.gameSizeFor(a.pointsLimit);
      const fac = FACTIONS.find(f => f.id === a.faction) || {};
      const pct = Math.min((cost / (a.pointsLimit || 1)) * 100, 100);
      const models = a.groups.reduce((n, g) => n + g.squads.reduce((m, s) => m + s.models.length, 0), 0);
      return `<article class="dzc-army-card${enter('a:' + a.id, listSeen)}"
                data-aid="${a.id}" style="${window.DZC.accentStyle(accentOf(a.faction))}"
                onclick="DZCBuilder.open('${a.id}')" tabindex="0"
                onkeydown="if(event.key==='Enter')DZCBuilder.open('${a.id}')">
        <div class="dzc-army-top">
          <span class="dzc-army-fac">
            <img src="assets/factions/${esc(a.faction)}.webp" alt="" loading="lazy" onerror="this.remove()">
            <b>${esc(fac.full || fac.name || a.faction)}</b>
          </span>
          <!-- One menu rather than two loose icons. Two was already a row of
               small targets beside the faction name on a card whose whole job
               is to be tapped, and every card that grows an action grows the
               row. Dropfleet uses the same overflow menu (gap 100). -->
          <span class="dzc-army-btns">
            <button class="dzc-icon-btn" type="button" title="More"
                    onclick="event.stopPropagation();DZCBuilder.armyMenu(event, '${a.id}')"
                    aria-label="More for ${esc(a.name)}"
                    aria-haspopup="menu">${window.DZCIcon('more_vert', { size: 16 })}</button>
          </span>
        </div>
        <h3 class="dzc-army-name">${esc(a.name)}</h3>
        ${a.description ? `<p class="dzc-army-desc">${esc(a.description)}</p>` : ''}
        <p class="dzc-army-pts"><b>${cost}</b><i>/ ${a.pointsLimit} pts</i>
          <span>${size ? esc(size.label) : 'Below minimum'}, ${a.groups.length} group${
            a.groups.length === 1 ? '' : 's'}${models ? `, ${models} model${models === 1 ? '' : 's'}` : ''}</span></p>
        <div class="dzc-army-bar"><i class="${cost > a.pointsLimit ? 'is-over' : pct > 85 ? 'is-near' : ''}"
          style="width:${pct}%"></i></div>
        ${armyStrip(a)}
        ${a.updatedAt ? `<p class="dzc-army-time">${esc(timeAgo(a.updatedAt))}</p>` : ''}
      </article>`;
    }).join('');

    root.innerHTML = `<div class="dzc-wrap">
      <div class="dzc-list-head">
        <h1>Your Armies</h1>
        <span class="dzc-list-btns">
          <!-- Quick play: a starter box list, built on the spot. It sits with
               the other two ways an army arrives -- typed out, imported, or
               taken ready-made -- because that is the choice being made here. -->
          <button class="btn btn-ghost" type="button" onclick="DZCBuilder.openQuick()">Quick play</button>
          <button class="btn btn-ghost" type="button" onclick="DZCBuilder.importLink()">Import a link</button>
          <button class="btn btn-primary" type="button" onclick="DZCBuilder.openNew()">New Army</button>
        </span>
      </div>
      ${list.length > 1 ? `<div class="dzc-chips dzc-list-sort">${
        [['recent', 'Recent'], ['name', 'Name'], ['faction', 'Faction'], ['points', 'Points']]
          .map(([k, label]) => `<button type="button" class="dzc-chip${
            listSort === k ? ' is-active' : ''}" onclick="DZCBuilder.sortList('${k}')"
            aria-pressed="${listSort === k}">${label}</button>`).join('')}</div>` : ''}
      <!-- An empty list is the grid with one tile in it, not a different
           screen with a sentence on it. "No armies yet." told you what you
           could already see; the tile is the thing to press. It appears ONLY
           when the list is empty. Once there are armies the button in the
           header is the same action, and a third way to do it is clutter. -->
      <div class="dzc-army-grid">${cards}${list.length ? '' : `
        <button type="button" class="dzc-army-new" onclick="DZCBuilder.openNew()">
          ${window.DZCIcon('add', { size: 26 })}<b>New Army</b></button>`}</div>
    </div>`;

    // After the draw, so the first visit to this screen fills `seen` quietly
    // and only an army made from here animates on.
    listSeen = true;
  }

  /* QUICK PLAY. Jet, 2026-08-08: "let's have the quickplays instead of the
   * pre-loaded actually."
   *
   * A card per starter-box list, drawn from the same spec that builds it --
   * name, faction, what it costs and what is in it -- so the chooser cannot
   * describe something the builder does not make. Pressing one builds it and
   * opens it, because there is nothing to confirm: you asked for that list. */
  async function openQuick() {
    const S = window.DZCStarters;
    const body = document.getElementById('dzc-quick-body');
    if (!S || !body) return;
    body.innerHTML = `<div class="dzc-quick-grid">${S.list().map(q => {
      const fac = FACTIONS.find(f => f.id === q.faction) || {};
      return `<button type="button" class="dzc-quick-card" style="${window.DZC.accentStyle(accentOf(q.faction))}"
        onclick="DZCBuilder.startQuick(${q.i})">
        <span class="dzc-quick-fac">
          <img src="assets/factions/${esc(q.faction)}.webp" alt="" loading="lazy" onerror="this.remove()">
          <b>${esc(fac.full || fac.name || q.faction)}</b>
        </span>
        <span class="dzc-quick-name">${esc(q.name)}</span>
        <!-- Commas, not interpuncts: the app's whole budget for that glyph is
             two and the footer spends both (CLAUDE.md 3). The army card beside
             this one already reads "Clash, 9 groups, 30 models". -->
        <span class="dzc-quick-meta">${q.pointsLimit}pts, ${q.groups} groups, ${q.models} models</span>
      </button>`;
    }).join('')}</div>`;
    document.getElementById('dzc-quick').classList.add('active');
  }

  function closeQuick() {
    const el = document.getElementById('dzc-quick');
    if (el) el.classList.remove('active');
  }

  async function startQuick(i) {
    const S = window.DZCStarters;
    const spec = S && S.STARTERS[i];
    if (!spec) return;
    // The faction's units have to be loaded before a Squad can be added.
    await window.DZC.loadFaction(spec.faction);
    const a = S.quickPlay(i);
    closeQuick();
    if (a) location.hash = '#army/' + a.id;
  }

  /* New Army, built the way the Dropfleet New Fleet dialog was: pick a game
   * SIZE from cards that state what each one means, then adjust the exact
   * limit if you agreed something else.
   *
   * Both halves are needed. The size decides the Group cap (3.1). The exact
   * number decides the per-Group ceiling, because that is a quarter of the
   * AGREED limit and not a quarter of the top of the band (3.2). So a
   * 1,200pt Clash and a 2,000pt Clash have very different Group caps. */
  // `name` stays null until the user types, so the suggested name follows the
  // faction they pick rather than sticking at whatever it opened with.
  let picked = { faction: 'ucm', size: 'clash', points: null, name: null, description: '' };

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

        <!-- Dropfleet's New Fleet dialog has name AND description, in that
             order (new-fleet-desc, app.js:1456). Optional, and it shows
             nothing anywhere when it is empty. -->
        <div class="form-group float-field">
          <input class="form-input" id="dzc-new-desc" type="text" placeholder=" " maxlength="120"
                 value="${esc(picked.description || '')}"
                 oninput="DZCBuilder.descTyped(this.value)">
          <label class="float-label" for="dzc-new-desc">Notes</label>
        </div>

        <div class="form-group">
          <label class="form-label">Faction</label>
          <div class="dzc-faction-grid" id="dzc-faction-picker" role="radiogroup" aria-label="Faction">
            ${FACTIONS.map(f => `<button type="button" class="dzc-faction-btn${f.id === picked.faction ? ' selected' : ''}"
              style="${window.DZC.accentStyle(f.accent)}" role="radio" aria-checked="${f.id === picked.faction}"
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
   * armies list while renderBuilder waited on the faction JSON. A network
   * fetch the first time you use a faction. The list flashed up, then the
   * builder replaced it.
   *
   * Now the faction is fetched while the button is still showing its press,
   * so by the time the modal goes the builder is already there. */
  /* "UCM Army 3". The faction, then how many of that faction you have. Counts
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

  /* The button is disabled while this runs, so whatever happens it has to be
   * put back. A throw between create() and the render left Create dead with
   * its pressed look on, and every click after it did nothing, for the rest of
   * the session. Silent, too: the rejection went nowhere an onclick could see.
   * Now the failure says what it was and the button comes back. */
  async function createArmy() {
    const btn = document.getElementById('dzc-create-btn');
    const typed = (document.getElementById('dzc-new-name').value || '').trim();
    if (btn) { btn.classList.add('is-going'); btn.disabled = true; }
    try {
      const name = typed || defaultArmyName(picked.faction);
      try {
        await window.DZC.loadFaction(picked.faction);
      } catch (e) { /* offline or a bad fetch: fall through and let the view report it */ }
      const a = window.DZCArmy.create(picked.faction, name, picked.points, picked.description);
      location.hash = '#army/' + a.id;
      await renderBuilder(a.id);
      document.getElementById('dzc-new').classList.remove('active');
      picked.name = null;   // next dialog suggests afresh
      picked.description = '';
    } catch (e) {
      say(`The army was not created. ${e.message}`);
      throw e;
    } finally {
      if (btn) { btn.classList.remove('is-going'); btn.disabled = false; }
    }
  }

  /* Create, but filled. Same faction, size and limit already chosen in the
   * dialog, so it is the same act with the blank part done for you. Which is
   * why it lives beside Create rather than on the list, where it would have to
   * ask those three questions again. */
  async function surpriseMe() {
    const btn = document.getElementById('dzc-create-btn');
    if (btn) { btn.classList.add('is-going'); btn.disabled = true; }
    try {
      try { await window.DZC.loadFaction(picked.faction); } catch (e) { /* the view will report it */ }
      const r = window.DZCArmy.generate(picked.faction, picked.points);
      if (!r.ok) { say(r.reason); return; }
      const typed = (document.getElementById('dzc-new-name').value || '').trim();
      if (typed) { r.army.name = typed; window.DZCArmy.touch(r.army); }
      location.hash = '#army/' + r.army.id;
      await renderBuilder(r.army.id);
      document.getElementById('dzc-new').classList.remove('active');
      picked.name = null;
    } catch (e) {
      say(`The army was not created. ${e.message}`);
      throw e;
    } finally {
      if (btn) { btn.classList.remove('is-going'); btn.disabled = false; }
    }
  }

  async function del(id) {
    closeArmyMenu();
    if (!confirm('Delete this army? This cannot be undone.')) return;
    await leave(`.dzc-army-card[data-aid="${id}"]`);
    window.DZCArmy.remove(id);
    await renderList();
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
    // Switching armies starts the enter-animation bookkeeping over: the ids in
    // `seen` belong to the army that was open, and a Squad in the next one has
    // not arrived just because this one is gone. armySeen is set at the END of
    // this function, so the first pass over a new army only fills the set.
    if (armySeen !== a.id) seen.clear();
    if (armySeen !== a.id) rodeOn.clear();
    // Which carry lines are new since the last draw. Before any markup, and
    // once -- see markLinks.
    markLinks(a);
    // Fresh every draw -- see groupAlerts.
    groupIssues = null;
    await window.DZC.loadFaction(a.faction);

    const cost = window.DZCArmy.armyCost(a);
    const size = window.DZC.gameSizeFor(a.pointsLimit);
    const maxG = size ? window.DZC.maxGroups(size, a.pointsLimit) : 0;
    // No per-Group cap here on purpose. It is a constant, and every Group card
    // already meters itself against it, printing it once more at the top was
    // the header telling you something the thing below it was showing you.
    const v = triage(window.DZCArmy.validate(a), a);
    const spend = window.DZCArmy.categorySpend(a);
    const std = spend.standard || 0;
    const playable = a.groups.some(g => g.squads.some(s => s.commander));
    /* The meter has to be in the same unit as the cap it is measured against.
     * maxGroups is an allowance of GROUPS and a Behemoth spends several of
     * them (Behemoth rules 1.1), so counting the cards on screen meant the one
     * number you watch to decide whether there is room for another Group read
     * 3 of 16 on a list already using 15. validate has counted it correctly
     * the whole time, which made the rail and the error disagree. */
    const gUsed = window.DZCArmy.groupsUsed(a);
    const gCards = a.groups.length;
    const gTitle = gUsed === gCards ? ''
      : ` title="${esc(`${gCards} Group card${gCards === 1 ? '' : 's'}, and a Behemoth counts as several (1.1)`)}"`;

    /* HOW MANY MODELS THE WHOLE ARMY IS. Jet, 2026-08-17: "on the groups can
     * you show how many minis we actually have in totality?"
     *
     * Every Group card already says its own -- "2 Squads, 5 models" -- and the
     * army card in the list says the army's, but the screen you are standing
     * in while you build had the sum of them nowhere. It is what you count out
     * of the case, and it does not follow from the points.
     *
     * Beside the Group count rather than on a line of its own: both are "how
     * big is this", and the rail is already four cards deep on a phone. */
    const models = a.groups.reduce((n, g) =>
      n + g.squads.reduce((m, s) => m + s.models.length, 0), 0);
    const modelLine = `${models} model${models === 1 ? '' : 's'}`;

    /* The ratio rule, drawn.
     *
     * Dropfleet has a composition bar (renderCompositionBar, app.js:2359) that
     * segments the whole list by category. That is the wrong picture here,
     * because DZC's rule is not about shares of the total: Vanguard, Heavy and
     * Support may EACH not exceed Standard (3.2). So Standard is the track and
     * the other three are measured against it. Full means level with
     * Standard, and past full is the breach. The number that would be over is
     * the number you are already reading beside it.
     *
     * Spend with no Standard at all is a full red track rather than an empty
     * one: it is the most broken this can be, and an empty bar reads as fine. */
    const ratio = ['vanguard', 'heavy', 'support'].map(c => {
      const val = spend[c] || 0;
      const over = val > std;
      const pct = std ? Math.min(100, Math.round((val / std) * 100)) : (val ? 100 : 0);
      return `<div class="dzc-ratio${over ? ' is-over' : ''}" style="--cat:${CAT_INK[c[0].toUpperCase() + c.slice(1)]}">
        <span>${c[0].toUpperCase() + c.slice(1)}</span>
        <!-- "110/495", not "110 of 495". Jet, 2026-08-17. Four of these stack
             in a 250px rail beside a meter, and the word was two thirds of the
             cell it had to fit in -- which is why it was running under the
             track to its right. It is a ratio, and a slash is what a ratio is
             written with. -->
        <span class="dzc-ratio-n"><b>${val}</b><i>/${std}</i></span>
        <span class="dzc-ratio-track"><i style="width:${pct}%"></i></span></div>`;
    }).join('');

    const pct = a.pointsLimit ? Math.min(100, Math.round((cost / a.pointsLimit) * 100)) : 0;

    /* Desktop gets a rail and a column; the rail carries everything you need
     * while working. What you have left to spend, and what is outstanding.
     * So it stays put instead of shoving the Groups down the page every time
     * an alert appears or clears. Below 900px it stacks above the list.
     * HANDOFF §2.2: desktop keeps panes, mobile does not. */
    // Fall back to the first Group, and drop a selection whose Group has been
    // removed, so the detail pane can never point at something deleted.
    if (selectedGroup && !a.groups.some(g => g.id === selectedGroup)) selectedGroup = null;
    const sel = a.groups.find(g => g.id === selectedGroup) || a.groups[0] || null;
    if (sel) selectedGroup = sel.id;

    /* Play, Share and Print live in the topbar, where Dropfleet puts them
     * (app.js:900) and where gap 53 asks for them. Three reasons, and the
     * third is the one that decided it:
     *
     *   - they act on the whole army, and the topbar is the only strip that
     *     belongs to the whole army rather than to a Group;
     *   - the bar is already there, with a back link on the left and an empty
     *     actions slot on the right that had never been filled;
     *   - on a phone they cost nothing. The label hides below 768px and the
     *     button becomes its icon, so the row above the list -- which was
     *     three buttons wide -- is simply gone.
     *
     * Written on every render rather than once on route, because Play's
     * disabled state depends on the army having a Commander and that changes
     * while you are on the screen. App.showView clears the slot on the way out.
     */
    const actions = document.getElementById('topbar-actions');
    if (actions) {
      // Play needs a Commander: CP per Round, hand size and the Initiative
      // modifier all come from Commander Level (4.1), so offering it on an
      // army with none would open a mode that cannot run. Share and Print stay
      // live -- a half-built list is worth sending someone or taking to a table.
      actions.innerHTML = `
        <button class="btn btn-ghost btn-sm topbar-action-btn" type="button" onclick="DZCBuilder.play()"
                ${playable ? '' : 'disabled'} aria-label="Play"
                title="${playable ? 'Run a game with this army'
                  : 'Add a Commander first: CP, hand size and Initiative all come from Commander Level (4.1)'}"
          >${window.DZCIcon('play_circle', { size: 15 })}<span class="topbar-action-label">Play</span></button>
        <button class="btn btn-ghost btn-sm topbar-action-btn" type="button" onclick="DZCBuilder.share()"
                aria-label="Share" title="Copy a link to this army"
          >${window.DZCIcon('share', { size: 15 })}<span class="topbar-action-label">Share</span></button>
        <button class="btn btn-ghost btn-sm topbar-action-btn" type="button" onclick="DZCBuilder.print()"
                aria-label="Print" title="Print the deployment sheet"
          >${window.DZCIcon('print', { size: 15 })}<span class="topbar-action-label">Print</span></button>`;
    }

    root.innerHTML = `<div class="dzc-wrap dzc-builder" style="${window.DZC.accentStyle(accentOf(a.faction))}">
      <header class="dzc-b-head">
        <!-- Editable in place, and it has to SAY so. A contenteditable heading
             with no affordance is a trap in both directions: nobody discovers
             it, and anyone who does discover it by accident has already typed
             into their army title. Dropfleet makes the same two things
             renameable and marks both (editFleetName, "Click to rename
             fleet"). -->
        <!-- Small, because the topbar carries this name as the last crumb
             now. It stays editable here: the crumb is where you READ which
             army you are in, this is where you rename it, and a contenteditable
             heading in a navy bar is not a control anyone would find. -->
        <h1 contenteditable="true" spellcheck="false" class="dzc-b-name is-quiet"
            role="textbox" aria-label="Army name" title="Click to rename"
            data-orig="${esc(a.name)}" onkeydown="DZCBuilder.nameKey(event)"
            onblur="DZCBuilder.rename(this)">${esc(a.name)}</h1>
      </header>

      <div class="dzc-b-body${drilled && sel ? ' is-drilled' : ''}">
        <aside class="dzc-rail">
          <!-- A peek line, and it only exists on a phone (CSS hides it above
               900px, where the whole rail is beside the list anyway).
               Everything under it collapses behind this summary, because on a
               phone the rail was four cards of preamble between you and your
               army, and the two numbers you actually keep glancing at are the
               points left and how many issues there are. Those are here.
               Gap 47 asks for a drag handle over a bottom sheet; this is the
               same outcome without a gesture. -->
          <button type="button" class="dzc-rail-peek" aria-expanded="${railOpen}"
                  aria-controls="dzc-rail-body" onclick="DZCBuilder.toggleRail()">
            <b>${cost}</b><span>/ ${a.pointsLimit}pts</span>
            <i${gTitle}>${gUsed}/${maxG || '—'} Groups</i>
            <span class="dzc-rail-models">${modelLine}</span>
            ${(() => {
              // The SAME count the list under it prints. A peek line saying
              // "4 to fix" over a list of two is the peek line lying.
              const e = dedupeAlerts(v.errors).length, w = dedupeAlerts(v.warnings).length;
              return e ? `<em class="is-err">${e} to fix</em>`
                : w ? `<em>${w} note${w === 1 ? '' : 's'}</em>`
                : '<em class="is-ok">legal</em>';
            })()}
            ${window.DZCIcon(railOpen ? 'remove' : 'add', { size: 16 })}
          </button>
          <div class="dzc-rail-body${railOpen ? ' is-open' : ''}" id="dzc-rail-body">
          <div class="dzc-rail-card">
            <!-- The size is the control that changes the agreed limit. It is
                 the only place the band is named, so it is where you would go
                 looking, and Dropfleet hangs the same popover off the same
                 badge (openGameSizeChanger, app.js:1369). -->
            <p class="dzc-b-sub"><span>${esc((FACTIONS.find(f => f.id === a.faction) || {}).name)}</span>
              <button type="button" class="dzc-b-size" title="Change the agreed points limit"
                      onclick="DZCBuilder.sizeChanger(event)"
                >${size ? esc(size.label) : 'Below the 501pt minimum'}</button></p>
            <!-- Jet, 2026-08-09: "there's a bar that shows how much you've
                 spent, and then a smaller number showing how much remains
                 somewhere. but it's a more obvious like 900/2000 or
                 something." Then: "remove the points left." Spent-over-limit
                 plus the bar is the whole picture; a second number saying the
                 same fact the other way was the redundant one. -->
            <div class="dzc-rail-pts ${cost > a.pointsLimit ? 'is-over' : ''}">
              <b>${cost}</b><span>/ ${a.pointsLimit}pts</span>
            </div>
            <div class="dzc-rail-track"><i style="width:${pct}%"></i></div>
            <p class="dzc-rail-line"${gTitle}>${gUsed}/${maxG || '—'} Groups<span
               class="dzc-rail-models">${modelLine}</span></p>
          </div>

          <div class="dzc-rail-card">
            <div class="dzc-rail-title">Category spend</div>
            <div class="dzc-ratios" title="Vanguard, Heavy and Support may each not exceed Standard spend (3.2)">
              <div class="dzc-ratio is-std" style="--cat:${CAT_INK.Standard}"><span>Standard</span>
                <span class="dzc-ratio-n"><b>${std}</b></span>
                <span class="dzc-ratio-track"><i style="width:100%"></i></span></div>${ratio}
            </div>
          </div>

          ${commanderRail(a)}
          <!-- ARMY-WIDE ONLY. Jet, 2026-08-07: "new rule: alerts live on the
               group card." Anything validate() could pin to a Group is drawn
               on that Group instead, where the thing that is wrong is; what is
               left here is the points limit, the Commander, the category
               ratio and the Group count -- facts about the army, with no
               Group to sit on. -->
          ${alertList(v.errors.filter(e => !e.group), 'err', 'issue to fix', 'issues to fix')}
          ${alertList(v.warnings.filter(e => !e.group), 'warn', 'note', 'notes')}
          ${v.ok && a.groups.length ? `<p class="dzc-legal">${window.DZCIcon('check_circle', { size: 15 })}This army is legal.</p>` : ''}
          ${shortfallHtml(a)}
          </div>
        </aside>

        <!-- Three panes on a desktop, one column on a phone. Dropfleet splits
             the builder into sidebar / overview / detail, each scrolling on its
             own (app.css:507), and that is exactly what this needed once a
             Squad grew a full weapon table: the overview stays scannable and
             the reading happens in the detail pane.

             On a phone there is no detail pane. A Group is a screen you drill
             into, so the list IS the screen and opening one replaces it. -->
        <div class="dzc-b-list">
          ${a.groups.map(g => groupBrief(a, g)).join('')
            || '<p class="dzc-b-none">No Groups yet.</p>'}
          <button class="btn btn-outline dzc-add-group" type="button" onclick="DZCBuilder.addGroup()">+ Add Group</button>
        </div>

        <div class="dzc-b-detail">
          <button type="button" class="dzc-b-back" onclick="DZCBuilder.backToGroups()">
            ${window.DZCIcon('arrow_back', { size: 16 })}All Groups</button>
          ${sel ? groupHtml(a, sel) : `<p class="dzc-b-none">${
            a.groups.length ? 'Pick a Group to work on it.' : 'Add a Group to start.'}</p>`}
        </div>
      </div>

      <!-- Notes, at the bottom. It sat under the army name, which is where you
           look while you are building and not where you write about what you
           built. Empty until you type something: an empty box labelled "notes"
           on every army is the caption-under-a-control pattern, and this one
           says nothing until it has something to say. -->
      <p class="dzc-b-desc" contenteditable="true" spellcheck="true"
         role="textbox" aria-label="Notes" title="Click to write notes"
         data-empty="Notes"
         onblur="DZCBuilder.setDescription(this.textContent)">${esc(a.description || '')}</p>
    </div>`;

    // Last, and only now: every enter() above has filled `seen` without
    // animating, so from the next draw onward a new id is genuinely new.
    armySeen = a.id;
  }

  /* Changing the agreed limit after the fact.
   *
   * It lives at <body> level and is position:fixed for the same reason the FAB
   * does: .screen carries will-change:transform, so a popover nested inside it
   * is positioned against the screen and not the viewport. Fixed-and-detached
   * also means opening it moves nothing on the page (CLAUDE.md §4).
   *
   * Shape taken from Dropfleet rather than invented. A row per band, then a
   * number for the exact figure, because the band is the shorthand and the
   * number is what the rules key off. */
  /* Drag to reorder Groups.
   *
   * The array order is the order on screen and on the printed sheet, and that
   * order is the deployment plan. Which Group goes down first is a decision,
   * and it used to be whatever order you happened to add them in.
   *
   * Pointer Events, NOT native HTML5 drag-and-drop, and that is not a
   * preference: native drag never fires on touch at all in iOS Safari and is
   * inconsistent on Android. Dropfleet rewrote this for exactly that reason
   * (app.js:2686, after an "unusably bad on touch" report) and this is that
   * code with the weight-class constraint taken out. A DZC Group has no
   * category to be constrained to.
   *
   * setPointerCapture keeps the events coming to the grip even when the finger
   * leaves it, which is what makes a drag survive a fast flick. */
  let groupDrag = null;

  function gripDown(ev, gid) {
    if (!current || ev.button === 2) return;
    ev.preventDefault();
    ev.stopPropagation();
    const grip = ev.currentTarget;
    const row = grip.closest('.dzc-bb');
    if (!row) return;
    const peers = [...document.querySelectorAll('.dzc-bb')].map(r => {
      const rc = r.getBoundingClientRect();
      return { gid: r.dataset.gid, el: r, top: rc.top, height: rc.height };
    });
    if (peers.length < 2) return;
    const rect = row.getBoundingClientRect();
    groupDrag = { gid, rowEl: row, startY: ev.clientY, rowTop: rect.top,
                  rowH: rect.height, peers, targetGid: null, after: false };
    row.classList.add('is-dragging');
    try { grip.setPointerCapture(ev.pointerId); } catch (e) { /* no capture, still works */ }
    grip.addEventListener('pointermove', gripMove);
    grip.addEventListener('pointerup', gripUp);
    grip.addEventListener('pointercancel', gripCancel);
  }

  function gripMove(ev) {
    if (!groupDrag) return;
    ev.preventDefault();
    const dy = ev.clientY - groupDrag.startY;
    groupDrag.rowEl.style.transform = `translateY(${dy}px)`;
    const centre = groupDrag.rowTop + groupDrag.rowH / 2 + dy;
    groupDrag.peers.forEach(p => p.el.classList.remove('is-before', 'is-after'));
    let best = null, bestDist = Infinity;
    groupDrag.peers.forEach(p => {
      if (p.gid === groupDrag.gid) return;
      const d = Math.abs(centre - (p.top + p.height / 2));
      if (d < bestDist) { bestDist = d; best = p; }
    });
    if (!best) { groupDrag.targetGid = null; return; }
    const after = centre > (best.top + best.height / 2);
    best.el.classList.add(after ? 'is-after' : 'is-before');
    groupDrag.targetGid = best.gid;
    groupDrag.after = after;
  }

  function endGrip(grip, commit) {
    grip.removeEventListener('pointermove', gripMove);
    grip.removeEventListener('pointerup', gripUp);
    grip.removeEventListener('pointercancel', gripCancel);
    if (!groupDrag) return;
    const { gid, targetGid, after, rowEl, peers } = groupDrag;
    rowEl.style.transform = '';
    rowEl.classList.remove('is-dragging');
    peers.forEach(p => p.el.classList.remove('is-before', 'is-after'));
    groupDrag = null;
    if (commit && targetGid && window.DZCArmy.moveGroup(current, gid, targetGid, after)) refresh();
  }

  function gripUp(ev) { endGrip(ev.currentTarget, true); }
  function gripCancel(ev) { endGrip(ev.currentTarget, false); }

  /* THE SAME MOVE WITHOUT A DRAG.
   *
   * Reordering Groups was a pointer gesture and nothing else, which is a
   * dead end for anyone on a keyboard, and it was the second thing the
   * 2026-08-09 thread asked for: "I would like the ability to move Groups
   * around." It existed; it was reachable one way only.
   *
   * The grip is a focusable button now and the arrows move the Group one
   * place. Left and Right as well as Up and Down, because the Group cards
   * lay out in a horizontal grid on a wide screen and a vertical list on a
   * narrow one -- the arrow that matches what you are looking at should be
   * the one that works, and guessing which is which from JS would be a
   * media query written twice.
   *
   * Focus follows the GROUP, by id, and refresh()'s own restore cannot do it.
   * That one matches on aria-label, and an unnamed Group's name is its
   * position -- so "Move Group 4" after the move names whatever card landed in
   * slot 4, which is the card you just displaced. Holding ArrowLeft then
   * swapped the same pair back and forth forever. Measured, not guessed: the
   * first press moved the Group and the second put it back. */
  function gripKey(ev, gid) {
    const back = ev.key === 'ArrowUp' || ev.key === 'ArrowLeft';
    const fwd = ev.key === 'ArrowDown' || ev.key === 'ArrowRight';
    if (!current || (!back && !fwd)) return;
    ev.preventDefault();
    const gs = current.groups;
    const i = gs.findIndex(g => g.id === gid);
    const j = back ? i - 1 : i + 1;
    if (i === -1 || j < 0 || j >= gs.length) return;
    if (!window.DZCArmy.moveGroup(current, gid, gs[j].id, fwd)) return;
    Promise.resolve(refresh()).then(() => {
      const el = document.querySelector(`.dzc-bb[data-gid="${gid}"] .dzc-bb-grip`);
      if (el) el.focus({ preventScroll: true });
    });
  }

  /* Dragging a Squad into a Transport.
   *
   * "Units with the category Transport may only be chosen along with a Squad
   * they may transport... Those two Squads form one Group" (3.2.4). So what
   * rides in what is the shape of the Group, and the only way to set it was a
   * modal that asks the question in words. This is the same decision made by
   * moving the thing, which is what everyone is picturing when they think
   * about it.
   *
   * The chooser stays. It is the keyboard route and it is where a Transport
   * you do not own yet gets bought; this only rearranges what is already in
   * the Group. Pointer events, not HTML5 drag-and-drop, because the case that
   * has to work is a finger on a phone.
   *
   * The legal targets are asked for ONCE, at the start, from boardOptions,
   * the same function the chooser lists. Nothing legal is computed while the
   * finger is moving, so a drop can never land somewhere the rules refuse. */
  let sqDrag = null;

  function sqGrip(ev, sid) {
    if (!current || ev.button === 2) return;
    ev.preventDefault();
    ev.stopPropagation();
    const grip = ev.currentTarget;
    const row = grip.closest('.dzc-squad');
    const card = grip.closest('.dzc-group-card');
    if (!row || !card) return;
    const squad = window.DZCArmy.findSquad(current, sid);
    const unit = squad && window.DZCArmy.unitOf(current, squad);
    if (!unit) return;

    const targets = (window.DZCArmy.boardOptions(current, sid) || []).map(o => {
      const el = card.querySelector(`.dzc-squad[data-sid="${o.squad.id}"]`);
      return el ? { sid: o.squad.id, el: el } : null;
    }).filter(Boolean);
    // Dropping on the Group's own background takes a Squad back off its
    // Transport, which is the other half of the gesture and the only way to
    // undo it without going through the chooser.
    const canWalk = !!squad.carriedBy;
    /* AND EVERY OTHER GROUP. Jet, 2026-08-07: "you should be able to drag
     * units between groups."
     *
     * The Group briefs in the list beside the card are the targets, which is
     * the only place every Group is on screen at once -- the detail pane shows
     * one. Dropping on one moves the Squad and everything riding on it
     * (DZCArmy.moveSquad); its own Group is excluded, because dropping a Squad
     * where it already is should do nothing rather than look like a move. */
    const home = window.DZCArmy.groupOf(current, sid);
    const groups = [...document.querySelectorAll('.dzc-bb[data-gid]')]
      .filter(el => !home || el.dataset.gid !== home.id)
      .map(el => ({ gid: el.dataset.gid, el: el }));
    if (!targets.length && !canWalk && !groups.length) return;

    sqDrag = { sid: sid, row: row, card: card, targets: targets, groups: groups,
               canWalk: canWalk, on: null };
    row.classList.add('is-sq-dragging');
    card.classList.add('is-dropping');
    targets.forEach(t => t.el.classList.add('is-drop'));
    groups.forEach(t => t.el.classList.add('is-drop'));
    if (canWalk) card.classList.add('can-walk');

    const ghost = document.createElement('div');
    ghost.className = 'dzc-drag-ghost';
    ghost.textContent = unit.name;
    document.body.appendChild(ghost);
    sqDrag.ghost = ghost;
    moveGhost(ev);

    try { grip.setPointerCapture(ev.pointerId); } catch (e) { /* still works */ }
    grip.addEventListener('pointermove', sqMove);
    grip.addEventListener('pointerup', sqUp);
    grip.addEventListener('pointercancel', sqCancel);
  }

  function moveGhost(ev) {
    if (!sqDrag || !sqDrag.ghost) return;
    sqDrag.ghost.style.left = ev.clientX + 'px';
    sqDrag.ghost.style.top = ev.clientY + 'px';
  }

  function sqMove(ev) {
    if (!sqDrag) return;
    ev.preventDefault();
    moveGhost(ev);
    /* Which target the finger is over, measured now rather than cached: the
     * pane scrolls under a drag, and a rectangle read at pointerdown is the
     * wrong rectangle by the time you get there. */
    let hit = null;
    sqDrag.targets.forEach(t => {
      const r = t.el.getBoundingClientRect();
      if (ev.clientX >= r.left && ev.clientX <= r.right
        && ev.clientY >= r.top && ev.clientY <= r.bottom) hit = t;
    });
    sqDrag.targets.forEach(t => t.el.classList.toggle('is-drop-on', t === hit));
    /* A Group brief beats the Group card behind it: the briefs sit in their
     * own pane, so a finger over one is over a Group, not over the background
     * of the card it came from. */
    let onGroup = null;
    if (!hit) {
      sqDrag.groups.forEach(t => {
        const r = t.el.getBoundingClientRect();
        if (ev.clientX >= r.left && ev.clientX <= r.right
          && ev.clientY >= r.top && ev.clientY <= r.bottom) onGroup = t;
      });
    }
    sqDrag.groups.forEach(t => t.el.classList.toggle('is-drop-on', t === onGroup));
    let walk = false;
    if (!hit && !onGroup && sqDrag.canWalk) {
      const r = sqDrag.card.getBoundingClientRect();
      walk = ev.clientX >= r.left && ev.clientX <= r.right
        && ev.clientY >= r.top && ev.clientY <= r.bottom;
    }
    sqDrag.card.classList.toggle('is-walk-on', walk);
    sqDrag.on = hit ? { kind: 'board', sid: hit.sid }
      : onGroup ? { kind: 'group', gid: onGroup.gid }
      : walk ? { kind: 'walk' } : null;
  }

  function endSqDrag(grip, commit) {
    grip.removeEventListener('pointermove', sqMove);
    grip.removeEventListener('pointerup', sqUp);
    grip.removeEventListener('pointercancel', sqCancel);
    if (!sqDrag) return;
    const d = sqDrag;
    sqDrag = null;
    if (d.ghost) d.ghost.remove();
    d.row.classList.remove('is-sq-dragging');
    d.card.classList.remove('is-dropping', 'can-walk', 'is-walk-on');
    d.targets.forEach(t => t.el.classList.remove('is-drop', 'is-drop-on'));
    (d.groups || []).forEach(t => t.el.classList.remove('is-drop', 'is-drop-on'));
    if (!commit || !d.on) return;
    const r = d.on.kind === 'board'
      ? window.DZCArmy.boardTransport(current, d.sid, d.on.sid)
      : d.on.kind === 'group'
        ? window.DZCArmy.moveSquad(current, d.sid, d.on.gid)
        : window.DZCArmy.assignTransport(current, d.sid, null);
    if (!r.ok) return say(r.reason);
    if (r.warn) say(r.warn, 'warning');
    refresh();
  }

  function sqUp(ev) { endSqDrag(ev.currentTarget, true); }
  function sqCancel(ev) { endSqDrag(ev.currentTarget, false); }

  /* The Squad grip, from a keyboard.
   *
   * This drag does two things: it puts a Squad aboard a Transport, and it
   * moves a Squad to another Group. The first now has a button with a word on
   * it, so the arrows are given to the second, which has no other route at
   * all -- one Group earlier, one Group later.
   *
   * Refusals go through say() exactly as the drop does, because moveSquad has
   * rules of its own and a keypress that silently does nothing is worse than
   * one that tells you why.
   *
   * The view follows the Squad. Only one Group is open at a time, so leaving
   * the selection where it was would move the Squad out from under you and
   * leave focus on nothing -- which for a keyboard is the end of the road, not
   * a small annoyance. Dragging has the same gap, but a finger at least ends
   * up pointing at the Group it dropped into. */
  function sqGripKey(ev, sid) {
    const back = ev.key === 'ArrowUp' || ev.key === 'ArrowLeft';
    const fwd = ev.key === 'ArrowDown' || ev.key === 'ArrowRight';
    if (!current || (!back && !fwd)) return;
    ev.preventDefault();
    const home = window.DZCArmy.groupOf(current, sid);
    if (!home) return;
    const gs = current.groups;
    const j = gs.findIndex(g => g.id === home.id) + (back ? -1 : 1);
    if (j < 0 || j >= gs.length) return;
    const r = window.DZCArmy.moveSquad(current, sid, gs[j].id);
    if (!r.ok) return say(r.reason);
    if (r.warn) say(r.warn, 'warning');
    selectedGroup = gs[j].id;
    Promise.resolve(refresh()).then(() => {
      const el = document.querySelector(`[data-sid="${sid}"] .dzc-sq-grip`);
      if (el) el.focus({ preventScroll: true });
    });
  }

  /* The per-army menu.
   *
   * At <body> level and position:fixed, for the reason the size popover is:
   * .screen carries will-change:transform, so a popover nested inside it is
   * positioned against the screen and not the viewport. Detached also means
   * opening it moves nothing on the page, which is the rule (CLAUDE.md §4).
   *
   * Flipped above the button when there is no room below, because the card
   * this hangs off is usually near the bottom of a grid. */
  function closeArmyMenu() {
    const el = document.getElementById('dzc-army-pop');
    if (el) el.remove();
    document.removeEventListener('click', outsideArmyMenu, true);
    document.removeEventListener('keydown', escArmyMenu, true);
  }
  function outsideArmyMenu(e) {
    const el = document.getElementById('dzc-army-pop');
    if (el && !el.contains(e.target)) closeArmyMenu();
  }
  function escArmyMenu(e) { if (e.key === 'Escape') closeArmyMenu(); }

  function armyMenu(ev, id) {
    ev.stopPropagation();
    if (document.getElementById('dzc-army-pop')) { closeArmyMenu(); return; }
    const pop = document.createElement('div');
    pop.id = 'dzc-army-pop';
    pop.className = 'dzc-pop-menu';
    pop.setAttribute('role', 'menu');
    pop.innerHTML = `
      <button type="button" role="menuitem" onclick="DZCBuilder.duplicate('${id}')"
        >${window.DZCIcon('content_copy', { size: 15 })}Duplicate</button>
      <button type="button" role="menuitem" class="is-danger" onclick="DZCBuilder.del('${id}')"
        >${window.DZCIcon('delete', { size: 15 })}Delete</button>`;
    const at = ev.currentTarget.getBoundingClientRect();
    pop.style.position = 'fixed';
    document.body.appendChild(pop);
    const h = pop.offsetHeight || 84;
    const below = window.innerHeight - at.bottom;
    pop.style.top = (below < h + 8 ? at.top - h - 4 : at.bottom + 4) + 'px';
    pop.style.left = Math.max(8, at.right - pop.offsetWidth) + 'px';
    setTimeout(() => {
      document.addEventListener('click', outsideArmyMenu, true);
      document.addEventListener('keydown', escArmyMenu, true);
    }, 0);
  }

  function closeSizePop() {
    const el = document.getElementById('dzc-size-pop');
    if (el) el.remove();
    document.removeEventListener('click', outsideSizePop, true);
    document.removeEventListener('keydown', escSizePop, true);
  }
  function outsideSizePop(e) {
    const el = document.getElementById('dzc-size-pop');
    if (el && !el.contains(e.target)) closeSizePop();
  }
  function escSizePop(e) { if (e.key === 'Escape') closeSizePop(); }

  function sizeChanger(ev) {
    ev.stopPropagation();
    if (document.getElementById('dzc-size-pop')) { closeSizePop(); return; }
    const a = current;
    if (!a) return;
    const cur = window.DZC.gameSizeFor(a.pointsLimit);
    const pop = document.createElement('div');
    pop.id = 'dzc-size-pop';
    pop.className = 'game-size-popover';
    pop.innerHTML = window.DZC.index.gameSizes.map(g => {
      const band = g.max == null ? `${g.min}pts and up` : `${g.min}–${g.max}pts`;
      return `<button type="button" class="game-size-popover-item${
        cur && cur.id === g.id ? ' active' : ''}" onclick="DZCBuilder.applySize('${g.id}')">
        <span><span class="game-size-popover-name">${esc(g.label)}</span>
          <span class="game-size-popover-desc">${band}</span></span></button>`;
    }).join('') + `
      <div class="game-size-custom">
        <label class="game-size-custom-label" for="dzc-size-pts">Points limit</label>
        <div class="game-size-custom-row">
          <input id="dzc-size-pts" class="game-size-custom-input" type="number"
                 min="501" step="50" inputmode="numeric" value="${a.pointsLimit}"
                 onclick="event.stopPropagation()"
                 onchange="DZCBuilder.setLimit(this.value)">
          <span class="game-size-custom-unit">pts</span>
        </div>
      </div>`;
    const badge = ev.currentTarget.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.top = (badge.bottom + 4) + 'px';
    pop.style.left = badge.left + 'px';
    document.body.appendChild(pop);
    // The click that opened this is still travelling; listen from the next tick
    // or it closes itself immediately.
    setTimeout(() => {
      document.addEventListener('click', outsideSizePop, true);
      document.addEventListener('keydown', escSizePop, true);
    }, 0);
  }

  /* The band sets the limit to the top of it, the number sets it exactly.
   * The same two-halves split the New Army dialog already uses. */
  function applyLimit(pts) {
    const a = current;
    if (!a) return;
    const n = window.DZCArmy.setPointsLimit(a, pts);
    closeSizePop();
    renderBuilder(a.id);
    const size = window.DZC.gameSizeFor(n);
    say(`${n}pts, ${size ? size.label : 'below the 501pt minimum'}`);
  }

  /* The overview entry: enough to choose between Groups, and nothing you have
   * to read. Name, what it costs, how big it is, and the transport space,
   * which is the fact that decides where the next Unit can go. */
  function groupBrief(a, g) {
    // Measured against the quarter cap, so it is the COMPOSITION cost: a
    // Commander's points are ignored by that rule (3.2.5), and a meter
    // reading 580 of 500 beside no error would be the app arguing with
    // itself. The Group's true cost, Commander included, is what the
    // share export and the printed sheet carry.
    const cost = window.DZCArmy.groupCompositionCost(a, g);
    const cap = window.DZC.maxGroupCost(a.pointsLimit);
    const models = g.squads.reduce((n, s) => n + s.models.length, 0);
    const U = window.DZCUnits;
    const space = window.DZCArmy.groupSpace(a, g).map(sp =>
      `<span class="dzc-bb-sp${sp.used > sp.total ? ' is-over' : sp.used === sp.total ? ' is-full' : ''}"
        >${U.shape(sp.shape, 13, true)}<b>${sp.used}</b><i>/${sp.total}</i></span>`).join('');
    const art = g.squads.map(s => window.DZCArmy.unitOf(a, s)).filter(u => u && u.art)
      .slice(0, 4).map(u => `<img src="${esc(u.art)}" alt="" loading="lazy" title="${esc(u.name)}"
        onerror="this.remove()">`).join('');
    /* WHAT IS CARRYING THIS GROUP, by name. Jet, 2026-08-13: "can we show
     * transports on the group cards?" They were on it already -- a Transport
     * is a Squad and its photograph leads the thumbnail strip -- but a
     * photograph 26px wide is not a name, and the card's own text said "2
     * Squads, 5 models" without once saying Condor. A Group is chosen between
     * on what carries it, which is why the space meters are here at all.
     *
     * Counted by unit, not by Squad, so two Ravens read "2 Raven Light
     * Dropships" rather than the same name printed twice. */
    const carry = new Map();
    g.squads.forEach(s => {
      const u = window.DZCArmy.unitOf(a, s);
      if (u && u.category === 'Transport') carry.set(u.name, (carry.get(u.name) || 0) + 1);
    });
    const carriers = [...carry].map(([nm, n]) =>
      `<span>${window.DZCIcon('local_shipping', { size: 13 })}${n > 1 ? `${n} ` : ''}${
        esc(n > 1 ? nm + 's' : nm)}</span>`).join('');
    const name = esc(window.DZCArmy.groupName(a, g));
    return `<div class="dzc-bb${g.id === selectedGroup ? ' is-on' : ''}${
      cost > cap ? ' is-over' : ''}${enter('g:' + g.id, armySeen === a.id)}" data-gid="${g.id}">
      <!-- The grip, and it has to be a separate target: dragging anywhere on
           the card would fight the tap that opens it, which is the commonest
           thing you do to one.

           drag_dots, the SAME glyph the Squad grip uses, because it is the
           same gesture and there is no reason for two. drag_rows drew its six
           dots at radius .75 in a 24 viewBox and laid them out 3 across, so
           at 16px each dot was half a pixel wide and the whole thing was
           wider than the strip it sits in. Grotwurks, 2026-08-09: "OHHHHH
           there they are.... at 200% zoom I can see them." At 200% they were
           one pixel. drag_dots is radius 1.5 in a 2x3 portrait grid, which is
           three times the ink and the right shape for a vertical handle. -->
      <span class="dzc-bb-grip" role="button" tabindex="0"
            aria-label="Move ${name}"
            title="Drag to reorder, or focus it and use the arrow keys"
            onkeydown="DZCBuilder.gripKey(event, '${g.id}')"
            onpointerdown="DZCBuilder.gripDown(event, '${g.id}')"
            >${window.DZCIcon('drag_dots', { size: 18 })}</span>
      <button type="button" class="dzc-bb-select" onclick="DZCBuilder.selectGroup('${g.id}')">
        <span class="dzc-bb-head"><b>${name}</b>
          <i>${cost}<s>/${cap}</s></i></span>
        <span class="dzc-bb-meta">${g.squads.length} Squad${g.squads.length === 1 ? '' : 's'}${
          models ? `, ${models} model${models === 1 ? '' : 's'}` : ''}</span>
        ${carriers ? `<span class="dzc-bb-carriers">${carriers}</span>` : ''}
        ${space ? `<span class="dzc-bb-spaces">${space}</span>` : ''}
        ${art ? `<span class="dzc-bb-art">${art}</span>` : ''}
      </button>
      <!-- Baxter, 2026-08-09: "Cannot duplicate or delete from the full list
           of groups" -- both only ever lived in the drilled-in header, so
           doing either meant opening the Group first. Same two actions, same
           icons, on the card itself. stopPropagation because these sit
           beside a button whose own click opens the Group -- without it,
           duplicating would open the ORIGINAL Group right after. -->
      <span class="dzc-bb-actions">
        <button type="button" class="dzc-icon-btn" title="Duplicate Group"
                onclick="event.stopPropagation();DZCBuilder.duplicateGroup('${g.id}')"
                aria-label="Duplicate ${name}">${window.DZCIcon('content_copy', { size: 14 })}</button>
        <button type="button" class="dzc-icon-btn" title="Remove Group"
                onclick="event.stopPropagation();DZCBuilder.removeGroup('${g.id}')"
                aria-label="Remove ${name}">${window.DZCIcon('delete', { size: 14 })}</button>
      </span>
    </div>`;
  }

  /* One thumbnail per distinct Unit, first from each Group, bordered in its
   * category colour. Dropfleet's renderFleetCardComp (app.js:1809). It is the
   * fastest way to tell two lists apart at a glance, which is the whole job of
   * a card in a grid. */
  /* One neutral ink. The per-category colours were removed on 2026-08-07 --
   * they competed with the transport symbols, whose hue is their meaning, and
   * with the faction accent. The map stays as one value so the thumbnails and
   * the ratio bars keep a border rather than losing one. */
  const CAT_INK = {
    Standard: '#9a9184', Vanguard: '#9a9184', Heavy: '#9a9184',
    Support: '#9a9184', Transport: '#9a9184'
  };
  function armyStrip(a) {
    const seen = {}, out = [];
    a.groups.forEach(g => g.squads.forEach(s => {
      const u = window.DZCArmy.unitOf(a, s);
      if (!u || !u.art || seen[u.id]) return;
      seen[u.id] = 1;
      out.push(`<img src="${esc(u.art)}" alt="" loading="lazy" title="${esc(u.name)}"
        onerror="this.remove()"
        style="--cat:${CAT_INK[u.category] || '#9a9184'}">`);
    }));
    if (!out.length) return '';
    return `<div class="dzc-army-strip">${out.slice(0, 6).join('')}${
      out.length > 6 ? `<span class="dzc-army-more">+${out.length - 6}</span>` : ''}</div>`;
  }

  /* Dropfleet's formatTimeAgo (app.js:9007), same thresholds and same words. */
  function timeAgo(ts) {
    const mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
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
      short.map(s => `${esc(s.name)}: using ${s.need}, own ${s.have}`).join('; ')}</p>`;
  }

  /* What a Group has spent, how big it is, and what its Transports have room
   * for. Every number is paired with its icon and spelled out, because "3/6"
   * on its own does not say 3 of what. */
  function groupMeters(a, g) {
    // Measured against the quarter cap, so it is the COMPOSITION cost: a
    // Commander's points are ignored by that rule (3.2.5), and a meter
    // reading 580 of 500 beside no error would be the app arguing with
    // itself. The Group's true cost, Commander included, is what the
    // share export and the printed sheet carry.
    const cost = window.DZCArmy.groupCompositionCost(a, g);
    const cap = window.DZC.maxGroupCost(a.pointsLimit);
    const models = g.squads.reduce((t, s) => t + s.models.length, 0);
    const squads = g.squads.length;

    /* On the Group's own title line, small and unemphasised. These are facts
     * you glance at, not the heading -- set at 11px with no bold, they sit
     * beside the name instead of taking a band of their own under it. */
    return `<span class="dzc-g-meters">
      <span class="dzc-meter${cost > cap ? ' is-over' : ''}">
        ${window.DZCIcon('calculate', { size: 12 })}<b>${cost}</b><i>of ${cap}pts</i></span>
      <span class="dzc-meter">
        ${window.DZCIcon('groups', { size: 12 })}<b>${squads}</b><i>Squad${squads === 1 ? '' : 's'}</i></span>
      <span class="dzc-meter">
        ${window.DZCIcon('deployed_code', { size: 12 })}<b>${models}</b><i>model${models === 1 ? '' : 's'}</i></span>
    </span>`;
  }

  /* Capacity stays where it was, under the header and drawn large: it is the
   * rule that decides whether the next thing you pick can join this Group at
   * all (3.2.4.2), which is a different job from the three facts above. */
  function groupSpace(a, g) {
    const U = window.DZCUnits;
    const space = window.DZCArmy.groupSpace(a, g).map(sp => {
      const free = sp.total - sp.used;
      const name = U.shapeName(sp.shape);
      const status = free > 0 ? `room for ${free}` : sp.used > sp.total ? 'overloaded' : 'full';
      return `<span class="dzc-space${sp.used > sp.total ? ' is-over' : free === 0 ? ' is-full' : ''}"
        style="--sh:${U.shapeInk(sp.shape)}" aria-label="${esc(name)}, ${sp.used} of ${sp.total}, ${status}">
        ${U.shape(sp.shape, 30, true)}
        <span class="dzc-space-n"><b>${sp.used}</b><s>/</s><em>${sp.total}</em></span></span>`;
    }).join('');
    return space ? `<div class="dzc-g-space">${space}</div>` : '';
  }

  /* WHAT IS WRONG WITH THIS GROUP, ON THIS GROUP. Jet, 2026-08-07: "new rule:
   * alerts live on the group card."
   *
   * They were all in the rail, which is the wrong end of the screen from the
   * Condor that is not full -- you read "Condor Dropship is not full", then
   * went looking for which of your nine Groups had a Condor in it. Every
   * message validate() can pin to a Group is drawn here instead, above the
   * Squads it is about. The rail keeps what is genuinely about the army.
   *
   * Cached per render: validate() walks the whole army, and calling it once
   * per Group card would walk it once per Group. */
  let groupIssues = null;

  function groupAlerts(a, g) {
    if (!groupIssues) {
      const v = window.DZCArmy.validate(a);
      groupIssues = { err: {}, warn: {} };
      v.errors.forEach(e => { if (e.group) (groupIssues.err[e.group] = groupIssues.err[e.group] || []).push(e); });
      v.warnings.forEach(e => { if (e.group) (groupIssues.warn[e.group] = groupIssues.warn[e.group] || []).push(e); });
    }
    /* NOT THE ONES A SQUAD IS ALREADY WEARING. squadAlerts puts a message on
     * the Unit it names, and this would put the same sentence at the top of
     * the same card -- which is the repetition that started all this. So the
     * two split the work rather than sharing it: a message that opens with the
     * name of a Unit in this Group belongs to that Unit and is drawn on it;
     * what is left is about the GROUP -- its cost, its Squads not being one
     * Group -- and that is what this draws. */
    const names = g.squads.map(s => (window.DZCArmy.unitOf(a, s) || {}).name).filter(Boolean);
    const onGroup = list => (list || []).filter(m => !names.some(n => m.msg.indexOf(n) === 0));
    return alertList(onGroup(groupIssues.err[g.id]), 'err', 'issue to fix', 'issues to fix')
      + alertList(onGroup(groupIssues.warn[g.id]), 'warn', 'note', 'notes');
  }

  function groupHtml(a, g) {
    // Measured against the quarter cap, so it is the COMPOSITION cost: a
    // Commander's points are ignored by that rule (3.2.5), and a meter
    // reading 580 of 500 beside no error would be the app arguing with
    // itself. The Group's true cost, Commander included, is what the
    // share export and the printed sheet carry.
    const cost = window.DZCArmy.groupCompositionCost(a, g);
    const cap = window.DZC.maxGroupCost(a.pointsLimit);
    // Carriers first, then whatever they carry, indented beneath them. The
    // nesting IS the deployment plan, so it is drawn rather than described.
    const top = carryOrder(a, g.squads.filter(s => !s.carriedBy));
    const rows = top.map(s => squadHtml(a, g, s, 0)).join('');
    return `<section class="dzc-group-card${cost > cap ? ' is-over' : ''}">
      <header class="dzc-g-head">
        <h2 contenteditable="true" spellcheck="false"
            role="textbox" aria-label="Group name"
            title="Rename this Group, or clear it to go back to its number"
            data-orig="${esc(window.DZCArmy.groupName(a, g))}"
            onkeydown="DZCBuilder.nameKey(event)"
            onblur="DZCBuilder.renameGroup('${g.id}', this.textContent)">${esc(window.DZCArmy.groupName(a, g))}</h2>
        ${groupMeters(a, g)}
        <!-- Two Groups of the same thing is a normal army, not an edge case:
             three Legionnaire Squads each in their own Bear is six clicks and
             a Transport chooser, repeated. -->
        <button class="dzc-icon-btn" type="button" title="Duplicate Group"
                onclick="DZCBuilder.duplicateGroup('${g.id}')"
                aria-label="Duplicate ${esc(window.DZCArmy.groupName(a, g))}"
                >${window.DZCIcon('content_copy', { size: 14 })}</button>
        <button class="dzc-icon-btn" type="button" title="Remove Group"
                onclick="DZCBuilder.removeGroup('${g.id}')" aria-label="Remove ${esc(window.DZCArmy.groupName(a, g))}">&times;</button>
      </header>
      ${groupSpace(a, g)}
      ${groupAlerts(a, g)}
      ${rows || '<p class="dzc-g-empty">No Squads yet.</p>'}
      ${addButtons(a, g)}
    </section>`;
  }

  /* TWO BUTTONS, NOT ONE. Jet, 2026-08-07: "instead of just 'add squad' it's
   * gonna be 2 instead. Add Units... not including the generic transports.
   * Add Transports... add just the transports."
   *
   * The split is exactly `category === 'Transport'`, and it is clean: across
   * all 178 Units plus the Behemoths, every Unit with capacity is either
   * category Transport (39 of them) or carries auxiliaryTransport (20). Not
   * one is both, and not one Transport lacks capacity. So the two lists are a
   * partition with no unit falling between them.
   *
   * The twenty auxiliaries are under Add Units, which is the right side of the
   * line: a Harrier Gunship, a Grievance Genitor Ark, a Splitting Drill are
   * Units you take to fight with that happen to have room in the back. You do
   * not go looking for one under "Transports" -- 3.2.4 does not even treat
   * them as Transports, which is why they need not be full (3.2.4.3).
   *
   * WHAT BREAKS, and it is the same thing on both buttons: 3.2.4 decides what
   * a Group may hold, not the button. An empty Group takes a fighting Unit and
   * nothing else, so Add Transports has nothing to offer until something is in
   * there to carry. A Group that already holds a Squad takes only a Transport
   * for it, or a Squad that fits in a Transport already present -- so on a
   * Group of tanks with a full Condor, Add Units has nothing to offer either.
   * Both cases are counted here and the button says so on its face rather than
   * opening a picker where everything is greyed out. */
  /* Can this Unit be added FROM here -- which is not the same question as
   * whether it may join this Group.
   *
   * They differ on exactly one Unit type, and it is every Transport a Shaltari
   * player owns. A Gate is never part of another Group, so canAddUnit refuses
   * it into any Group with a Squad in it, and it is right to: that army would
   * be illegal. But the Gate is not going into this Group. It goes to the
   * Gates Group, which gateHome finds or makes, and the only question worth
   * asking here is whether it may go THERE.
   *
   * Asked with no Group at all when there is no Gates Group yet: canAddUnit
   * takes a null groupId and checks what is true of the army rather than of a
   * Group -- Rare and Unique -- which is exactly the set that could still
   * refuse a Gate. */
  function canOffer(a, groupId, u) {
    if (window.DZCArmy.isGate(u)) {
      const home = window.DZCArmy.gateHome(a, false);
      return window.DZCArmy.canAddUnit(a, home ? home.id : null, u.id);
    }
    return window.DZCArmy.canAddUnit(a, groupId, u.id);
  }

  function addButtons(a, g) {
    const f = window.DZC.faction(a.faction);
    const pool = ((f && f.units) || []).filter(u => u.selectable !== false);
    const open = kind => pool.filter(u =>
      (kind === 'transport') === (u.category === 'Transport')
      && canOffer(a, g.id, u).ok).length;
    /* Add Transports is the QUIETER of the two. Jet, 2026-08-13: "let's make
     * the add transports button a bit less attractive." Two solid accent bars
     * side by side gave a Transport the same weight as the Squad it exists to
     * carry, and the button that ties a Squad to one -- the commoner move by
     * far -- was a 12px ghost chip up in the row. The pair have swapped
     * emphasis rather than gained any: Add Units keeps the fill, this one
     * outlines. */
    const btn = (kind, label) => {
      const n = open(kind);
      return `<button class="dzc-add-squad${kind === 'transport' ? ' dzc-add-squad--quiet' : ''}${
        n ? '' : ' is-empty'}" type="button"
        ${n ? `onclick="DZCBuilder.openPicker('${g.id}','${kind}')"` : 'disabled'}
        title="${esc(n ? `${n} to choose from`
          : kind === 'transport'
            ? 'A Transport may only be taken alongside a Squad it can carry (3.2.4).'
            : 'This Group is full: a Squad may only join it if a Transport already here can carry it (3.2.4).')}">
        <span class="dzc-add-squad-i">${window.DZCIcon('add', { size: 20 })}</span>
        <span class="dzc-add-squad-t">${esc(label)}</span>
        <i class="dzc-add-squad-n">${n}</i></button>`;
    };
    return `<div class="dzc-add-row">${btn('unit', 'Add Units')}${btn('transport', 'Add Transports')}</div>`;
  }

  /* Weapon upgrades are bought on the gun itself -- the price IS the button
   * (f7b3d47). The table that used to live here printed every weapon a second
   * time just to have somewhere to put a price, and went with it. */
  const squadGuns = s => Object.assign(window.DZCArmy.squadGuns(s), { key: s.id });

  /* A stepper that stops working says why it stopped.
   *
   * canSetCount has always returned the sentence, "Legionnaires has a
   * maximum Squad size of 3", and both buttons threw it away, so the control
   * just went dead under your finger with nothing on screen. The rule that
   * refuses an action is the one thing worth saying (3.2), and everywhere
   * else in this builder already says it. */
  function stepperHtml(army, sq) {
    const n = sq.models.length;
    // canSetCount no longer refuses below squadMin (Jet, 2026-08-09: "let
    // squads drop to 0") -- a Squad under minimum is unfinished, not
    // forbidden, and validate() is what says so now. Only the maximum still
    // stops the down button, and only a Transport ever can (it has no down
    // button of its own to press).
    const down = window.DZCArmy.canSetCount(army, sq.id, n - 1);
    const up = window.DZCArmy.canSetCount(army, sq.id, n + 1);
    /* The reason goes on a WRAPPER, not on the button.
     *
     * A disabled form control does not reliably fire hover, and browsers
     * disagree about whether title= still shows on one, so a tooltip put
     * there is a coin flip. A span is never disabled and always gets the
     * pointer. The button keeps aria-label either way, because that is read
     * out rather than hovered. */
    const btn = (dir, ok, why, label, icon) => {
      const b = `<button type="button" ${ok ? '' : 'disabled'}
               onclick="DZCBuilder.count('${sq.id}',${dir})"
               aria-label="${label}">${window.DZCIcon(icon, { size: 14 })}</button>`;
      return ok || !why ? b : `<span class="dzc-step-why" title="${esc(why)}">${b}</span>`;
    };
    return `<span class="dzc-stepper">
      ${btn(-1, down.ok, down.reason, 'Remove one model', 'remove')}
      <b>${n}</b>
      ${btn(1, up.ok, up.reason, 'Add one model', 'add')}
    </span>`;
  }

  /* How big the Squad is.
   *
   * A Squad of exactly one shows NOTHING (Jet: "don't bother showing ANYTHING
   * like 1x or 1 or squad size 1") and a Squad with one legal size shows "×3"
   * and no other word. Everything else is the stepper.
   *
   * A small range used to become a row of tab buttons, 1 2 3, the size you
   * had lit up. Jet, 2026-08-07: "remove the switcher for 1/2/3 we'll worry
   * about it later." It is gone rather than hidden behind a condition: two
   * controls doing the same job, chosen between by how wide the range
   * happened to be, is the thing that made it worth removing. */
  function sizeControl(army, sq, u) {
    const lo = u.squadMin, hi = u.squadMax;
    /* A Unit whose Variants are blocks gets NO stepper on the row. Jet,
     * 2026-08-08, circling the -- 2 + on a Troop Buggy sitting above Badger A
     * 1, Badger B 1 and Ferret 0: "remove that +/- stepper."
     *
     * It was the sum of the three controls underneath it, and pressing + had
     * to guess which Variant you meant. The block is where the count belongs
     * -- that is what a Variant being a block is FOR ("nice and big, to +/-
     * the number of units we have in that variant", d4cb126) -- and this is
     * the same duplicate the upgrade table was (f7b3d47).
     *
     * It stays on a Unit with no Variants: 93 of the 178 have none, and
     * Berserkers 2-4 or a Mech Loader 1-6 have no block to carry the control,
     * so removing it there would leave a Squad whose size cannot be changed at
     * all. Compact view passes the same test -- it drops the blocks but keeps
     * the Variant list, and variantsHtml puts the same stepper on every row.
     *
     * The ×3 chip is not a stepper and is not what was circled, so a
     * fixed-size Squad still states its size. */
    const noStepper = !!(u.variants || []).length;
    if (lo == null || hi == null) return noStepper ? '' : stepperHtml(army, sq);
    if (lo === hi) return hi === 1 ? '' : `<span class="dzc-sq-fixed">×${hi}</span>`;
    return noStepper ? '' : stepperHtml(army, sq);
  }

  /* How many models in this Squad are this variant.
   *
   * It replaces one <select> per model. The dropdowns hid the choice twice
   * over: you could not see what a variant was without opening one, and you
   * could not see the mix without reading every one of them in turn. The
   * blocks were already on the page saying what each variant is and costs.
   * Putting the count on the block makes the thing you read the thing you
   * press, and a Squad of eight stops being eight dropdowns.
   *
   * Addressed by INDEX, not by name: a name goes into an inline handler as a
   * quoted string, and one apostrophe in a variant name would break it.
   *
   * Same disabled-reason wrapper as the Squad stepper, for the same reason.
   * A disabled control does not reliably fire hover, so the title goes on a
   * span that is never disabled. */
  /* RAW MATERIALS, on the only Squads that may hold any.
   *
   * "RM tokens cost 5pts each and are assigned to those Genitor Units"
   * (Genitor X). It is a purchase, so it reads like the other purchase in this
   * app: press the price. What it costs is on the control, and the cap is the
   * number the symbol beside the Unit's name already shows.
   *
   * Its own block rather than a chip on the header row. The header carries how
   * many MODELS are in the Squad and what they cost, and RM is neither -- it
   * is cargo, bought by the token, capped by the Transport Symbol. Putting a
   * second stepper up there next to the model count is the confusion Jet had
   * just removed from Variant Units.
   *
   * Nothing is drawn on a Unit that cannot hold RM, which is every Unit in
   * five factions and all but two in Bioficer. genitorCap answers that. */
  function rmControl(a, s) {
    const cap = window.DZCArmy.genitorCap(a, s);
    if (!cap) return '';
    const n = window.DZCArmy.rmOf(s);
    const A = window.DZCArmy;
    const btn = (dir, ok, why, label, icon) => {
      const b = `<button type="button" ${ok ? '' : 'disabled'}
                 onclick="DZCBuilder.rm('${s.id}',${dir})"
                 aria-label="${label}">${window.DZCIcon(icon, { size: 14 })}</button>`;
      return ok || !why ? b : `<span class="dzc-step-why" title="${esc(why)}">${b}</span>`;
    };
    /* A COUNT, NOT A QUOTA. This read "3 of 12", which is the shape of a
     * ration you are drawing down, and RM is not that: "RM tokens cost 5pts
     * each and are assigned to those Genitor Units". You buy them one at a
     * time and each one adds 5pts to the army, the same as buying a model.
     *
     * The 12 has not gone anywhere, it is just not the frame any more. It is
     * still the rule the + button enforces, and the button says it: "It may
     * never have more than 12 RM tokens aboard", on the same disabled-with-a-
     * reason wrapper every other refusal in the builder uses. */
    return `<div class="dzc-rm">
      <span class="dzc-rm-head">${window.DZCIcon('rm', { size: 15 })}<b>Raw materials</b>
        <i>${A.RM_POINTS}pts each</i></span>
      <span class="dzc-stepper">
        ${btn(-1, n > 0, 'A Genitor may begin empty, but not below zero.', 'One fewer RM token', 'remove')}
        <b>${n}</b>
        ${btn(1, n < cap, `It may never have more than ${cap} RM tokens aboard.`, 'One more RM token', 'add')}
      </span>
      <span class="dzc-rm-pts">${n * A.RM_POINTS}<small>pts</small></span>
    </div>`;
  }

  /* A VARIANT IS A BLOCK: its name, how many of them you have, and the guns
   * THAT variant fires.
   *
   * Jet, 2026-08-07: "on any unit, we show all the variants... Bus: show the
   * weapon cards for bus, with the option, nice and big, to +/- the number of
   * units we have in that variant."
   *
   * The one shared weapon list it replaces printed every gun on the card with
   * the ones you do not have greyed, which asks you to work out which loadout
   * a gun belongs to by reading the "Rocket Bus only" note on each. Here the
   * question is answered by where the card is: the guns under Rocket Bus are
   * the guns a Rocket Bus fires. `lens` is the existing filter that does this,
   * and the variant switcher over the reference table already used it.
   *
   * A Unit with no Variants keeps the plain list; there is nothing to split. */
  /* The price, as the control that buys it. "The upgrade can be represented
   * by a nice visible button you can tap/click that says +10pts" -- Jet,
   * 2026-08-07, on a Condor printing its Missile Pod twice: once as a weapon
   * card and again as a row of the upgrade table underneath, same eight
   * fields both times.
   *
   * Addressed by index into upgradesFor, which is what toggleUpgrade takes,
   * and looked up by weapon name because that is what the card has. A weapon
   * this Squad cannot buy at all gets the plain price back rather than a
   * button that would refuse. */
  function buyButton(a, s) {
    const list = window.DZCArmy.upgradesFor(a, s) || [];
    /* A card option that buys no gun goes on the row of the gun it DROPS,
     * which is where the choice is: "May remove one UM-117 Cannons and gain
     * Scanner and Scout" (UCM Harrier Gunship, and the only one). Same toggle,
     * same place, no price on it because it costs nothing. */
    const opts = window.DZCArmy.optionsFor(a, s) || [];
    /* ONE BUTTON, on the first row it could drop. "May remove ONE UM-117
     * Cannons" and a Harrier A carries two of them, so a button on both rows
     * says the option is two options and, once taken, marks a row that is
     * still being fired. Which row is struck through is decided by
     * removedByUpgrades and it takes the first, so this follows it.
     *
     * Per closure, and buyButton is called once per Variant block, so the
     * Harrier B block gets its own button rather than none. */
    const shown = new Set();
    return w => {
      const oi = opts.findIndex(o => (o.swap.removes || []).some(r => r.weapon === w.name));
      if (oi !== -1 && !shown.has(opts[oi].key)) {
        shown.add(opts[oi].key);
        const o = opts[oi];
        const on = window.DZCArmy.hasOption(s, o.swap);
        return `<button type="button" class="dzc-buy dzc-buy--drop${on ? ' is-on' : ''}${
          flip('opt|' + s.id + '|' + o.key, on)}"
          aria-pressed="${on}"
          aria-label="${on ? 'Put back' : 'Remove'} one ${esc(w.name)}, gaining ${
            esc((o.swap.grantsRules || []).join(' and '))}"
          title="${esc(o.swap.note || '')}"
          onclick="DZCBuilder.toggleOption('${s.id}',${oi})"
          >${on ? 'Removed' : 'Remove'}</button>`;
      }
      const i = list.findIndex(o => o.weapon.name === w.name);
      // Nothing to buy and nothing to drop: the row keeps its printed price,
      // or nothing at all if it never had one.
      if (i === -1) {
        return w.upgradePoints == null ? ''
          : `<span class="dzc-wpn-up">+${w.upgradePoints}pts</span>`;
      }
      const on = window.DZCArmy.hasUpgrade(s, list[i].scope, w.name);
      return `<button type="button" class="dzc-buy${on ? ' is-on' : ''}${
        flip('buy|' + s.id + '|' + list[i].scope + '|' + w.name, on)}"
        aria-pressed="${on}"
        aria-label="${on ? 'Remove' : 'Buy'} ${esc(w.name)}, ${w.upgradePoints} points"
        onclick="DZCBuilder.toggleUpgrade('${s.id}',${i})"
        >${on ? 'Bought' : '+' + w.upgradePoints + 'pts'}</button>`;
    };
  }

  /* Which variants this Squad had last time we drew it, keyed by Squad and
   * variant name. Read and written in variantGuns. */
  const tookVariant = new Map();

  /* And what was carrying each Squad last time, so the carry line can draw on
   * the moment the link is made. Same shape as tookVariant and for the same
   * reason: choosing a Transport rebuilds the whole Group, so the row you were
   * looking at is replaced by an identical one that happens to be aboard
   * something. Only the FLIP is an arrival. A Squad this map has never seen is
   * not one -- opening yesterday's army would otherwise draw every line in it.
   *
   * Both ends are marked. The drop belongs to the carrier and the arm to the
   * cargo, so a link that draws only on the row that changed would animate a
   * horizontal tick appearing out of a vertical that was already there. */
  const rodeOn = new Map();
  /* Squad ids whose line should draw on THIS pass. Settled in one sweep before
   * anything is drawn, because squadHtml recurses -- a carrier renders its
   * riders, so a flip consulted from inside the rider would find a map the
   * carrier had already updated and report nothing. */
  let drawLink = new Set();

  function markLinks(a) {
    const now = new Set();
    (a.groups || []).forEach(g => (g.squads || []).forEach(s => {
      const was = rodeOn.get(s.id);
      const car = s.carriedBy || null;
      if (was !== undefined && was !== car && car) { now.add(s.id); now.add(car); }
      rodeOn.set(s.id, car);
    }));
    drawLink = now;
  }

  function variantGuns(a, s, u) {
    const U = window.DZCUnits;
    const vs = u.variants || [];
    if (!vs.length) {
      return U.weaponCardsHtml(u, a.faction,
        Object.assign({}, squadGuns(s), { buy: buyButton(a, s) }));
    }
    return vs.map((v, i) => {
      const n = s.models.filter(m => m.variant === v.name).length;
      const opts = Object.assign({}, squadGuns(s), {
        lens: v.name, key: s.id + '|' + v.name, buy: buyButton(a, s)
      });
      /* The line draws on the moment the variant becomes yours. Jet,
       * 2026-08-07: "when you click on, the line should like, draw on."
       *
       * Pressing + rebuilds the whole Squad, so the block you were looking at
       * is replaced by an identical one that happens to be taken -- the same
       * problem the weapon cards' `is-gained` solves, and solved the same way:
       * remember whether this variant was taken last draw, and mark the flip.
       * A key it has never seen is not a flip, or opening an army you built
       * yesterday would draw every line it already has. */
      const key = s.id + '|' + v.name;
      const had = tookVariant.get(key);
      const drawn = n > 0 && had === false ? ' is-drawn' : '';
      tookVariant.set(key, n > 0);
      /* AND THE RULES THIS VARIANT ALONE HAS. Jet: "sort special abilities
       * that are only on one loadout, into that loadout. IE Scanner (Greave)
       * means this goes only on the greave variant."
       *
       * Under the block's own header, above its guns -- the same place the
       * Squad prints its rules relative to its stats, so the block reads as a
       * small card of its own rather than as a list of weapons with a stray
       * chip on top. */
      const vRules = U.rulesHtml(u.special, a.faction, U.variantRuleFilter(u, v.name), true);
      return `<section class="dzc-vblock${n ? ' is-taken' : ''}${drawn}">
        <header class="dzc-vblock-head">
          <!-- THE MODEL, where you choose how many of it.
               A Sabre and a Rapier are a tracked tank with a chainsaw gun and
               a hover tank with a long AA barrel, and until now this block
               showed the same photograph for both, because art was per unit
               and a unit holds up to four variants. 155 of the 199 variants
               have their own picture now; the rest have none printed anywhere,
               so they draw nothing here rather than repeat the unit's. -->
          ${v.art ? `<img class="dzc-vblock-art" src="${esc(v.art)}" alt=""
             loading="lazy" onerror="this.remove()">` : ''}
          <b>${esc(v.name)}</b>
          ${v.points != null ? `<i>${v.points}pts</i>` : ''}
          <span class="dzc-vblock-n">${variantStepper(a, s, u, i)}</span>
        </header>
        ${vRules ? `<div class="dzc-vblock-rules">${vRules}</div>` : ''}
        ${U.weaponCardsHtml(u, a.faction, opts)}
      </section>`;
    }).join('');
  }

  /* WHAT CARRIES WHAT, TOP TO BOTTOM. Jet, 2026-08-07: "at the top of all
   * groups are transports... then apcs and shit - stuff that can have guys
   * inside, but also are transported. Then the guys."
   *
   * Three tiers, read straight off the transport symbols (3.2.4.2), which
   * already say exactly this: a hollow symbol is room offered, a solid one is
   * room taken.
   *
   *   0  hollow only:      a Condor, an Albatross. Carries, is not carried.
   *   1  hollow AND solid: a Bear APC. Carries, and rides in something.
   *   2  solid only, or neither: the guys.
   *
   * Order was whatever you happened to add things in, so a Group could open
   * with its infantry and end with the dropship that brings them, which is
   * upside down from how it goes on the table. Ties keep the order you built
   * them in. This sorts the tiers, it does not reshuffle inside one. */
  function carryTier(a, sq) {
    const u = window.DZCArmy.unitOf(a, sq);
    const t = (u && u.transport) || {};
    const carries = ((t.capacity || []).length > 0);
    const rides = ((t.fills || []).length > 0);
    return carries && !rides ? 0 : carries ? 1 : 2;
  }
  function carryOrder(a, list) {
    return list
      .map((sq, i) => [sq, i])
      .sort((x, y) => (carryTier(a, x[0]) - carryTier(a, y[0])) || (x[1] - y[1]))
      .map(pair => pair[0]);
  }

  function variantStepper(a, s, u, idx) {
    const v = (u.variants || [])[idx];
    if (!v) return '';
    const A = window.DZCArmy;
    const have = s.models.filter(m => m.variant === v.name).length;

    /* A one-model Squad SWITCHES, it does not count.
     *
     * Jet, 2026-08-07: "there's no way to change a unit's guns/variants." On a
     * Battle Bus -- squadMin and squadMax both 1 -- the steppers were a
     * deadlock by construction. Taking Rocket Bus from 0 to 1 asks for a
     * second model and canSetCount refuses it; taking Bus from 1 to 0 asks for
     * an empty Squad and is refused too. So the only Units in the game whose
     * Variant is their whole identity were the ones whose Variant could never
     * be changed, and every gun on the card sat greyed out for a Variant you
     * could not select.
     *
     * "A Squad may contain any mixture of Variants" (3.2.2) is about a Squad
     * with more than one model in it. With one, the mixture is the choice, so
     * it is a radio rather than a pair of steppers.
     *
     * AND ZERO IS A DOT WITH NOTHING LIT. Squads no longer delete themselves
     * at zero (Jet, 2026-08-09: "leave it at 0 units if it's selected... make
     * the entire card greyed out with 0 models but not deleted"), so a
     * one-of-these Unit can sit empty the same as any other -- and the same
     * dots that switch a taken model to a different Variant are how you take
     * one at all: pickVariant adds when the Squad is empty, same as it always
     * switched when it wasn't (Jet: "you probably should just set them all to
     * the ability to be reduced to zero... that lets the user then pick a
     * different variant if they wish"). */
    if ((s.models.length === 1 || s.models.length === 0)
        && (u.squadMax === 1 || (u.variants || []).length > 1)
        && u.squadMin === u.squadMax) {
      const on = !!s.models[0] && s.models[0].variant === v.name;
      // A dot. The Variant's name is beside it and the aria-label carries the
      // whole sentence; the word inside the button was the third place it said
      // the same thing, and "Take"/"Taken" changed the control's width.
      return `<button type="button" class="dzc-v-pick${on ? ' is-on' : ''}"
        aria-pressed="${on}" aria-label="${esc(u.name)}: ${esc(v.name)}"
        title="${esc(v.name)}"
        onclick="DZCBuilder.pickVariant('${s.id}',${idx})"></button>`;
    }
    /* A Squad with a fixed size (squadMin === squadMax, more than one model)
     * has no room to grow into, so its Variant control is A DELTA, NOT A
     * TARGET COUNT: it moves one model between this Variant and the largest
     * other one, never changing how many miniatures the Squad has. Jet,
     * 2026-08-07: "click shouldn't increase the miniatures." That is the
     * Squad stepper's job and only its job -- on a Unit that HAS a Squad
     * stepper.
     *
     * A ranged Squad (squadMin !== squadMax -- Resistance Main Battle Tank,
     * Bioficer Grievance/Thorn/Tusk/Tangent, Scourge Interceptor) has no
     * Squad stepper at all (sizeControl hides it for every Variant Unit), so
     * a delta with nothing to shift from left it stuck at whatever size the
     * Squad started with -- reported 2026-08-09 across four factions. There
     * the Variant control has to be the Squad stepper, scoped to one
     * Variant: it adds or removes an actual model, bounded by squadMin and
     * squadMax the same way the (absent) top stepper would be. */
    const ranged = u.squadMin !== u.squadMax;
    const step = (delta, icon, label) => {
      const chk = ranged ? A.canAdjustVariantCount(a, s.id, v.name, delta)
                          : A.canShiftVariant(a, s.id, v.name, delta);
      const b = `<button type="button" ${chk.ok ? '' : 'disabled'}
              onclick="DZCBuilder.${ranged ? 'variantAdjust' : 'variantShift'}('${s.id}',${idx},${delta})"
              aria-label="${esc(label)} ${esc(v.name)}">${window.DZCIcon(icon, { size: 14 })}</button>`;
      return chk.ok || !chk.reason ? b : `<span class="dzc-step-why" title="${esc(chk.reason)}">${b}</span>`;
    };
    return `<span class="dzc-stepper dzc-v-step${have ? ' is-on' : ''}">
      ${step(-1, 'remove', 'One fewer')}
      <b>${have}</b>
      ${step(1, 'add', 'One more')}
    </span>`;
  }

  /* The Commander riding with a Squad, named. A Commander mirrored onto a
   * Squad carries only its id and level, so the name comes from the army's own
   * record; falling back to the Level keeps the chip meaningful when it has no
   * name of its own. */
  /* Looked up by SQUAD, not by the id on the Squad's copy of the Commander.
   * There is no id on that copy: syncCommanders writes `{ level }` and nothing
   * else, so matching on it found nobody every time and the tag fell back to
   * "Level 5" on a Commander you had named. squadId is the real link between
   * the two, and it is the one the assignment is stored as. */
  function commanderTagName(a, squad) {
    const c = window.DZCArmy.commanders(a).find(x => x.squadId === squad.id);
    return c ? window.DZCArmy.commanderName(a, c)
      : `Level ${(squad.commander || {}).level}`;
  }

  /* THE PROBLEM, ON THE THING WITH THE PROBLEM. Jet, 2026-08-07: "this should
   * live on the unit causing the issue."
   *
   * "Bear APC: not full. Transports must be taken full (3.2.4)" was in the
   * rail and only there, which means reading a sentence at the top of the
   * screen, finding the Bear it names somewhere in the army, and holding the
   * two together. The rail keeps the count, because how many problems the list
   * has is a fact about the list. WHICH problem is a fact about a Squad, and
   * it belongs on it.
   *
   * Matched by the Unit's name, which is how every one of these messages
   * already opens, validate writes them as "<name> ...". A message naming a
   * Unit you have two of appears on both, which is right: both are that Unit
   * and the rule is about the Unit. */
  /* A SPAN, not a <p>, and it matters: this goes inside the meta line, which
   * lives inside the Squad's <h3>. A <p> is block-level and may not sit in a
   * heading, so the parser broke the <h3> open, re-parented what followed and
   * emitted the alert FOUR TIMES in three different places -- Jet, 2026-08-07:
   * "why is it on there 4x and they're aLL IN THE WRONG SPOT". The rule was
   * generated once; the markup was invalid and the browser repaired it. */
  /* An alert ON a Squad does not name the Squad.
   *
   * These messages lead with the Unit's name because validate writes them for
   * the rail too, where nothing else says which Squad is meant. Here the name
   * is the heading directly above -- "UCM Troop Buggy", then twenty pixels
   * lower "UCM Troop Buggy: 1 model, minimum is 2." CLAUDE.md §3: no phrase
   * appears more than twice on one screen, and on a Group of five Squads that
   * was five names printed twice each.
   *
   * Only the "Name: sentence" form is trimmed, and only because what is left
   * is a whole sentence. A predicate cannot be: cut the name off "Raven Light
   * Dropship is not full" and "is not full" hangs on its own, which is worse
   * than the repeat. So the two that were written that way are written the
   * other way now -- "Raven Light Dropship: not full" -- which reads on the
   * rail, where the name is the only thing saying which Squad is meant, AND
   * reads here with it gone. */
  function squadAlerts(v, u) {
    const mine = m => m.msg.indexOf(u.name) === 0;
    const trim = msg => msg.startsWith(u.name + ': ')
      ? msg.slice(u.name.length + 2) : msg;
    return [].concat(
      (v.errors || []).filter(mine).map(m => ['is-err', m]),
      (v.warnings || []).filter(mine).map(m => ['', m])
    ).map(([cls, m]) => `<span class="dzc-sq-alert ${cls}">${
      window.DZCIcon(cls ? 'error' : 'warning', { size: 13 })
    }<i>${esc(trim(m.msg))}</i></span>`).join('');
  }

  function squadHtml(a, g, s, depth) {
    const u = window.DZCArmy.unitOf(a, s);
    if (!u) return '';
    /* Declared HERE, at the top, and it has to stay here. It used to sit
     * beside the meta line two hundred lines down, while the Transport chip
     * above it already called U.transportHtml. A const is in its temporal
     * dead zone until its own line runs, so reading it earlier is a thrown
     * ReferenceError, not an undefined.
     *
     * That only fired when a Squad actually HAD a Transport, which is the
     * commonest thing in the app, and it took the whole builder view down with
     * it: renderBuilder threw, so nothing was written to the pane at all. */
    const U = window.DZCUnits;
    const cost = window.DZCArmy.squadCost(a, s);
    const riders = carryOrder(a, g.squads.filter(x => x.carriedBy === s.id));
    const isTransport = u.category === 'Transport';

    // A Transport's count is DERIVED from its cargo -- "as many as needed"
    // (3.2.4) -- so it gets no stepper at all. Making it uneditable is the
    // enforcement; a stepper you then argue with is not.
    /* A Transport's count is derived and a count of one says nothing, so one
     * Transport gets no chip at all rather than a padlock over a 1. */
    /* AND A UNIT WITH VARIANTS GETS NO ROW STEPPER EITHER. Jet, 2026-08-08,
     * circling the -- 2 + on a Troop Buggy sitting above Badger A 1, Badger B
     * 1 and Ferret 0: "remove that +/- stepper."
     *
     * It was the sum of the three controls underneath it, and pressing it had
     * to guess which variant you meant. The blocks are where the count belongs
     * -- that is the whole point of a Variant being a block ("nice and big, to
     * +/- the number of units we have in that variant", d4cb126) -- and this
     * is the same duplicate the upgrade table was (f7b3d47).
     *
     * It STAYS on a Unit with no variants. 93 of the 178 have none, and
     * Berserkers 2-4 or a Mech Loader 1-6 have no block to carry the control;
     * removing it there would leave a Squad whose size cannot be changed at
     * all. Compact view is the same test -- it drops the blocks but keeps the
     * variant list, and variantsHtml puts the same stepper on each row. */
    const stepper = isTransport
      ? (s.models.length > 1
        ? `<span class="dzc-stepper is-derived" title="A Transport’s count follows its cargo (3.2.4)">
             ${window.DZCIcon('lock', { size: 12 })}<b>${s.models.length}</b></span>`
        : '')
      : sizeControl(a, s, u);


    /* Transport assignment. A select could show a name and a number and
     * nothing else -- not the shapes, not whether the fit is exact, not what
     * it costs -- so it is a + that opens the same kind of visual chooser
     * everything else here uses. What is already chosen is shown, not folded
     * back into a collapsed control you have to open to read. */
    const carrier = s.carriedBy ? window.DZCArmy.findSquad(a, s.carriedBy) : null;
    // carrierOf, not unitOf: the chip prints capacity symbols, and a Transport
    // that sold its room for guns must print the room it has left.
    const carrierUnit = carrier ? window.DZCArmy.carrierOf(a, carrier) : null;
    /* A Transport Squad is a Squad, so it gets this control too. 3.2.4.1 says
     * "up to 4 Squads, PLUS THEIR OWN TRANSPORT SQUADS, may share one larger
     * Transport", and that is the only way an Albatross is ever bought: you
     * never add one, you give one to a Bear APC exactly as you gave the Bear to
     * the Legionnaires. Withholding it here made the whole 18-capacity tier
     * unreachable through the UI while the model happily built it.
     *
     * Nothing needs a depth limit. The data limits itself: transportOptions
     * only returns carriers whose capacity matches what this Unit FILLS, and a
     * Transport that prints no solid symbol, an Albatross, a Condor, fills
     * nothing and so is offered nothing. */
    const opts = window.DZCArmy.transportOptions(a, s.id);
    // A Transport already in the Group may have room even when the faction
    // offers none to buy, so the control has to appear for that case too.
    const board = window.DZCArmy.boardOptions(a, s.id);
    /* NO BAR. Jet, 2026-08-07: "sell me on this card. I think we can remove
     * it." It could not be sold. A full-width strip on every Squad in the army
     * carrying the word TRANSPORT and, on most of them, "Walks on" -- which is
     * the default, so it was a label announcing that nothing had happened. The
     * one thing on it that no other element does is the control, so the
     * control moved up to the row that already holds this Squad's size, its
     * cost and its remove button, and the strip went.
     *
     * Nothing is lost with the words. Which Transport a Squad is in is the
     * bracket it sits inside; that a Squad walks on is what the empty space
     * where a bracket would be says; and the consequence of walking on --
     * "Squads not aboard an Aircraft begin Reserved" (9.4) -- is already a
     * warning on the army, where it belongs, because it is a fact about the
     * list rather than about one Squad.
     *
     * THE BUTTON HAS A NAME. Not the strip -- that stays gone, and for the
     * reason above. It was a 15px lorry glyph beside a bin, and in the
     * 2026-08-09 thread two players spent twenty messages on how to put a
     * Medusa inside a Triton X without either of them finding it. Grotwurks
     * asked for exactly what this opens -- "if I want my Triton X listed as
     * Transporting the Medusa, it should be a selectable transport" -- and it
     * already was: openCarry lists the Triton X under "Already in this Group",
     * marked "Fills it". Baxter, who knows the app, still answered "drag your
     * unit underneath it", because the drag is the route he could see. Then:
     * "My point is that isnt intuitive. I have to go through extra steps
     * for.... why?"
     *
     * There were no extra steps. There was one step with no name on it.
     *
     * "LINKED TRANSPORT", NOT "TRANSPORT". The name it got first was the noun,
     * and the noun is the collision. Jet, 2026-08-12: "it's confusing that
     * there's two add transport buttons... one of them obviously add to
     * transport to the unit you're looking at it's like carry this unit! But
     * then the other button just lets you add more generic transports."
     *
     * Both were true of the word Transport, and on a phone both were on screen
     * at once, in the same accent, a Squad row apart. So the difference goes
     * where it is read: this one is a LINK between this Squad and a Transport,
     * and it says so and carries a chain rather than a second lorry. The
     * Group's own button keeps the plus and the plain word -- it adds a
     * Transport to the Group and links it to nothing, which is exactly what
     * "Add Transports" has always said.
     *
     * NOT "add linked transport", which was Jet's phrasing, because the button
     * is also how a Squad already aboard something rides a different one, and
     * on that press nothing is added. The noun covers both; the verb lies on
     * half of them. */
    const transportPicker = (opts.length || board.length) ? `${carrierUnit
      ? `<button type="button" class="dzc-sq-btn" title="Walks on instead"
                 onclick="DZCBuilder.assignTransport('${s.id}','')"
                 aria-label="Take ${esc(u.name)} out of its Transport"
                 >${window.DZCIcon('stat_mv_infantry', { size: 15 })}Take out</button>` : ''}
      <button type="button" class="dzc-sq-btn dzc-carry-btn"
              onclick="DZCBuilder.openCarry('${s.id}')"
              aria-label="${carrierUnit ? 'Ride something else' : 'Choose a Transport'} for ${esc(u.name)}"
              title="${carrierUnit ? 'Ride something else' : 'Choose a Transport'}"
              >${window.DZCIcon('link', { size: 15 })}Linked transport</button>` : '';

    /* A Squad in your army reads exactly as the unit does when you open it:
     * art, the capacity symbol at size beside the name, the meta line, every
     * stat, the rules, a block per variant and the whole weapon table. There
     * is no "enough for a roster" version of a Unit -- the numbers you argue
     * over across a table are the ones in that weapon table, and having to
     * open a modal mid-game to see them is the app failing at its job.
     *
     * Compact view is the way out of that when you are scanning rather than
     * deciding, and it is what makes showing everything by default safe --
     * Dropfleet's own comment on the same toggle says as much. It takes away
     * the weapon table and the stat grid repeated under every variant, which
     * is the bulk. It takes away no CONTROL: every stepper, every upgrade and
     * the Transport chooser are all still there, because a denser overview
     * that also refuses you a purchase is a different feature. */
    const compact = !!(window.App && App.compactView && App.compactView());

    const meta = [
      `<span class="dzc-cat" data-cat="${esc(u.category)}">${esc(u.category)}</span>`,
      `<span>${esc(u.type || '')}</span>`,
      U.sizeHtml(u) ? `<span>${U.sizeHtml(u)}</span>` : '',
      squadAlerts(window.DZCArmy.validate(a), u)
    ].filter(Boolean).join('');

    return `<div class="dzc-squad${isTransport ? ' is-transport' : ''}${s.models.length ? '' : ' is-empty'}${
      riders.length ? ' is-carrier' : ''}${drawLink.has(s.id) ? ' is-linked' : ''}${
      enter('s:' + s.id, armySeen === a.id)}" style="--depth:${depth}" data-sid="${s.id}">
      <div class="dzc-sq-main">
        <!-- The handle comes FIRST. It sat between the thumbnail and the
             name, which is the one place a handle should never be: neither the
             start of the row nor the end of it, interrupting the middle of the
             thing it moves. Material, Notion, Jira and Figma all put it at the
             leading edge, because it grabs the WHOLE row and a row is read
             from where reading starts. (iOS puts it right, but only inside an
             edit mode where reordering is all the list does; here it is one
             action among six.) -->
        <span class="dzc-sq-grip" role="button" tabindex="0"
              aria-label="Move ${esc(u.name)}"
              title="Drag onto a Transport to put this Squad aboard, or focus it and use the arrow keys to move it to another Group"
              onkeydown="DZCBuilder.sqGripKey(event,'${s.id}')"
              onpointerdown="DZCBuilder.sqGrip(event,'${s.id}')"
              >${window.DZCIcon('drag_dots', { size: 20 })}</span>
        <!-- ONE PICTURE. Jet, 2026-08-07: "I no longer wish for like, adding
             more units to actually increase the # of minis visible. That's a
             bit silly."
             It used to draw one thumbnail per model, in a ceil(sqrt(n)) grid,
             so a Squad of nine was nine postage stamps of the same photograph
             at a third of the size. It never said anything the number beside
             it did not say better, and it made the one thing you are meant to
             recognise -- what the model looks like -- smaller the more of them
             you took. The count is a number; this is the picture. -->
        ${u.art ? `<span class="dzc-sq-minis" aria-label="${esc(u.name)}">${
          `<img class="dzc-sq-art" src="${esc(u.art)}" alt=""
            loading="lazy" onerror="this.closest('.dzc-sq-minis').remove()">`
        }</span>` : ''}
        <div class="dzc-sq-id">
          <h3 class="dzc-sq-title">
            <button type="button" class="dzc-sq-name" title="Stats, weapons and rules"
                    onclick="DZCUnits.openDetail('${esc(u.id)}','${esc(a.faction)}')">${esc(u.name)}</button>
            ${s.commander ? `<span class="dzc-cmdr-tag" title="Level ${s.commander.level} Commander"
              >${window.DZCIcon('military_tech', { size: 13 })}${esc(commanderTagName(a, s))}</span>` : ''}
            <span class="dzc-sq-cap">${U.transportHtml(window.DZCArmy.carrierOf(a, s) || u)}</span>
            <!-- Category, type and Squad size ON the name's line. They are what
                 the name is, not a second heading under it, and a line of their
                 own cost a row of vertical space on every Squad in the army. -->
            <span class="dzc-sq-meta">${meta}</span>
          </h3>
        </div>
        <div class="dzc-sq-ctl">
          ${transportPicker}
          ${stepper}
          <!-- THE COST AND THE BIN ARE ONE ITEM, so the row is told what to
               break off when it runs out. Naming the Transport button cost it
               38px, which took the four controls to 343px of a 314px row at
               360, and what wrapped was the last thing in the row: the bin, on
               a line of its own, on the left, under 270px of nothing. That is
               the empty line Build 442 took off the Group header turning up on
               every Squad in the army instead. As a pair they wrap as a pair,
               the cost at one end and its Squad's bin at the other, and a row
               with no stepper in it -- a Transport's -- still fits on one line
               at 320. -->
          <span class="dzc-sq-tail">
            <span class="dzc-sq-cost">${cost}pts</span>
            <!-- The only control that actually deletes the Squad -- a trash
                 icon rather than the × the stepper's neighbours use, so it
                 reads as the one destructive action here and not one more
                 close button (Jet, 2026-08-09: "maybe trash icon for
                 consistency" -- 'delete' is what the army list's own Delete
                 already uses). Reducing to zero no longer does this itself. -->
            <button class="dzc-icon-btn" type="button" title="Remove Squad"
                    onclick="DZCBuilder.removeSquad('${s.id}')" aria-label="Remove ${esc(u.name)}">${window.DZCIcon('delete', { size: 16 })}</button>
          </span>
        </div>
      </div>
      <!-- Stats LEFT, guns RIGHT, on one row. The stat table is only as wide
           as its longest label and the weapon cards were sitting under it, so
           every Squad in the army spent a band of empty paper beside five
           short lines before you reached the guns. Below the two-pane
           breakpoint they stack, stats first. -->
      <div class="dzc-sq-body">
        <div class="dzc-sq-side">
          <div class="dzc-sq-stats">${U.statsHtml(u)}</div>
          <!-- The keywords go UNDER the stats, in the same column: they are
               what the Unit is, read beside its numbers rather than after the
               whole weapon block. -->
          <!-- The card's OWN rules. A rule the card restricts to one Variant
               (3.2.2) is that Variant's, so it is drawn on its block below
               rather than here, where it read as something every model in the
               Squad had. -->
          ${u.special ? (r => r ? `<div class="dzc-sq-rules">${r}</div>` : '')(
            U.rulesHtml(u.special, u.faction || a.faction, U.variantRuleFilter(u, null))) : ''}
        </div>
        ${compact ? '' : `<div class="dzc-sq-wpn">${variantGuns(a, s, u)}</div>`}
      </div>
      <!-- The Variant list that used to sit here is the blocks above now:
           name, count and the guns that Variant fires, in one place instead of
           a list of names here and a greyed weapon table there. Compact view
           has no blocks, so it keeps the list. -->
      ${compact ? U.variantsHtml(u, (v, i) => variantStepper(a, s, u, i), { stats: false }) : ''}
      <!-- Above the riders, because RM tokens ARE cargo: they sit aboard the
           Genitor exactly as a Squad does, and they are what the Squads below
           get Spawned from. Compact view keeps it -- it takes away the stat
           grid and the weapon table, never a control. -->
      ${rmControl(a, s)}
      <!-- What is riding in this thing, drawn as a bracket rather than left to
           an indent. A carried Squad was one 2px rule and 22px of margin from
           an uncarried one, which is a difference you have to already know to
           look for -- and what rides in what IS the Group (3.2.4). The spine
           runs the height of the cargo and an arm reaches into each Squad, so
           the shape on screen is the shape on the table. -->
      ${riders.length ? `<div class="dzc-riders">
        <!-- No label at all. Jet, 2026-08-07: "we don't need a whole element
             to indicate ABOARD when we have the lines." The spine comes out of
             the carrier and reaches into each rider; a word saying so is the
             picture explained back to you. -->
        ${riders.map(r => squadHtml(a, g, r, depth + 1)).join('')}
      </div>` : ''}
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

  /* Commanders live in the rail, as a card each with a button under them.
   * Not as a "— none —" select stapled to the bottom of every Squad, where
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
      /* Every option names its Group, and names it through groupName. Reading
       * t.group.name raw meant an unnamed Group contributed nothing, so two
       * Squads of Legionnaires in two unnamed Groups were two options both
       * reading "Legionnaires". The collision the derived name exists to
       * prevent, in the one control where picking the wrong one is silent. */
      const assign = targets.length
        ? `<label class="dzc-cmdr-assign">Aboard
             <select onchange="DZCBuilder.assignCommander('${c.id}', this.value)">
               <option value="">Choose a Squad</option>
               ${targets.map(t => `<option value="${t.squad.id}"${t.squad.id === c.squadId ? ' selected' : ''}
                 >${esc(t.unit.name)}, ${esc(window.DZCArmy.groupName(a, t.group))}</option>`).join('')}
             </select></label>`
        : '<p class="dzc-cmdr-hint">Add a squad that this Commander can join.</p>';
      return `<div class="dzc-rail-card dzc-cmdr-card${c.squadId ? '' : ' is-loose'}">
        <div class="dzc-cmdr-head">
          ${insignia}
          <div>
            <b contenteditable="true" spellcheck="false" class="dzc-cmdr-name"
               role="textbox" aria-label="Commander name"
               title="Click to rename, or clear it to go back to the Level"
               onblur="DZCBuilder.renameCommander('${c.id}', this.textContent)"
               >${esc(window.DZCArmy.commanderName(a, c))}</b>
            <!-- The Level only prints here when you have NAMED this Commander.
                 Unnamed, the name above IS the Level ("Level 4 Commander"),
                 and repeating it under itself was the derived name and this
                 line disagreeing about whose job it is (CLAUDE.md §3). -->
            <span class="dzc-cmdr-pts">${c.name ? `Level ${c.level}, ` : ''}${
              window.DZCArmy.levelCost(c.level)}pts</span>
          </div>
        </div>
        ${assign}
        <button type="button" class="dzc-cmdr-remove" onclick="DZCBuilder.removeCommander('${c.id}')"
                >${window.DZCIcon('delete', { size: 13 })}Remove</button>
      </div>`;
    }).join('');
    /* All three numbers come off the HIGHEST Level on the table (4.1.1, 4.1.4,
     * 4.1.5), so with two Commanders they are one line about the army rather
     * than a repeat on each card. And a second Commander that changes nothing
     * about them should visibly change nothing about them. */
    const best = list.reduce((n, c) => Math.max(n, c.level), 0);
    const perRound = best ? `<div class="dzc-rail-card dzc-cmdr-buys dzc-cmdr-buys--rail"
      title="From your highest Commander Level, and Round 1 counts every Commander as Level 0 (4.1)"
      >${levelBuys(best).map(b => `<span><b>${b.n}</b><i>${b.k}</i></span>`).join('')}</div>` : '';
    return cards + perRound + `<button type="button" class="dzc-cmdr-add" onclick="DZCBuilder.openCommander()"
      >${window.DZCIcon('military_tech', { size: 18 })}${list.length ? 'Add another Commander' : 'Add Commander'}</button>`;
  }

  /* What a Level buys, in the three numbers chapter 4 derives from it: CP
   * replenishes up to your highest Level (4.1.1), hand size IS that Level
   * (4.1.4), and Initiative is D6 plus it (4.1.5). Play Mode has run on that
   * arithmetic since it was built.
   *
   * It used to say here that those numbers would not be invented, because
   * index.json carries level and points only. That was the wrong file to look
   * in. They are rulebook chapter 4, not a points table, and leaving them out
   * meant the ladder read as four prices with nothing to weigh them against. */
  function levelBuys(level) {
    return [{ n: level, k: 'CP' },
      { n: level, k: level === 1 ? 'card' : 'cards' },
      { n: '+' + level, k: 'Initiative' }];
  }

  /* The whole ladder, with what each level costs and what it brings to the
   * table. Famous Commanders are not released, so this is the generic ladder
   * only. The schema slot is there for when they are.
   *
   * Every level, including the ones this game size does not allow. Filtering
   * them out enforced 3.2.5 by making them not exist, which is the one form of
   * enforcement this app does not use anywhere else: a Rare Squad at its limit
   * is disabled quoting the limit, an option that cannot be taken full is
   * disabled with the arithmetic. An absent option teaches nothing. At
   * Skirmish there was no way to learn that Levels 6 and 7 exist, or that a
   * bigger game is what unlocks them. addCommander refuses them either way. */
  function openCommander() {
    const a = current;
    if (!a) return;
    const size = window.DZC.gameSizeFor(a.pointsLimit);
    const sizes = (window.DZC.index || {}).gameSizes || [];
    const all = (((window.DZC.index || {}).armyRules || {}).commanders || {}).levels || [];
    const allowed = window.DZC.commanderLevels((size || {}).id || 'skirmish').map(l => l.level);
    const rows = all.map(l => {
      const ok = allowed.indexOf(l.level) !== -1;
      // The size that DOES allow it, named the way the printable reference
      // names it: the first entry in allowedIn is the smallest game it fits.
      const from = sizes.find(s => s.id === (l.allowedIn || [])[0]);
      const insignia = window.RankInsignia
        ? window.RankInsignia(a.faction, Math.max(1, l.level - 3), 30) : '';
      return `<div class="dzc-cmdr-opt${ok ? '' : ' is-blocked'}">
        ${insignia}
        <div class="dzc-cmdr-opt-body"><b>Level ${l.level}</b></div>
        <div class="dzc-cmdr-buys"
             title="Round 1 counts every Commander as Level 0 (4.1.1)">${
          levelBuys(l.level).map(b =>
            `<span><b>${b.n}</b><i>${b.k}</i></span>`).join('')}</div>
        <span class="dzc-cmdr-opt-pts">${l.points}pts</span>
        ${ok
          ? `<button type="button" class="btn btn-primary btn-sm"
                onclick="DZCBuilder.addCommander(${l.level})">Add</button>`
          : `<span class="dzc-pick-blocked">${window.DZCIcon('lock', { size: 14 })}${
              esc(from ? from.label + ' and up' : 'A larger game')}</span>`}
      </div>`;
    }).join('');
    document.getElementById('dzc-cmdr-body').innerHTML = rows
      || '<p class="dzc-empty">No Commander levels are available at this size.</p>';
    document.getElementById('dzc-cmdr').classList.add('active');
  }

  function closeCommander() { document.getElementById('dzc-cmdr').classList.remove('active'); }

  /* An army you are halfway through building is not a broken army.
   *
   * Some rules are about what you HAVE built. A Group over the quarter cap, a
   * Rare taken three times, a Transport that is not full. Those are wrong the
   * moment they happen and say so.
   *
   * Others are about what the finished list must CONTAIN. "You haven't added a
   * Commander" fired on your first Squad, before you had any chance to satisfy
   * it and with nothing actually wrong. Those say nothing at all until half
   * the points are spent. And then they are an ISSUE, not a note, because an
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
      // Legality is unchanged. A held requirement is still unmet, so the army
      // is not announced as legal just because the message is not shown yet.
      ok: !v.errors.length
    };
  }

  /* Two severities, and they are not the same thing: an "issue to fix" means
   * the list is illegal, a "note" means there is something worth knowing about
   * a list that is otherwise fine. Each is headed with its own count so you can
   * see at a glance how much is left, and each cites its rule at the END of the
   * sentence rather than wearing a rule number as a badge on the front. */
  /* SAID ONCE, WITH A COUNT. Jet, 2026-08-07: "SHUT THE FUCK UP WHY IS IT
   * SAYING IT SO MANY TIMES".
   *
   * validate() walks Squads, and its Transport messages name the UNIT rather
   * than the Squad -- so a Group with two Condor Squads, neither of them full,
   * produced the identical sentence twice, and three produced it three times.
   * There is nothing in the repeat to read: the second copy is the same words
   * about the same model.
   *
   * Collapsed on rule + message, and the count goes in front where it says
   * something -- "2 x Condor Dropship is not full" is a different fact from
   * one, and it is the fact you need to fix two of them. */
  function dedupeAlerts(items) {
    const out = [];
    const at = new Map();
    items.forEach(e => {
      const k = e.rule + '|' + e.msg;
      if (at.has(k)) { out[at.get(k)].n++; return; }
      at.set(k, out.length);
      out.push(Object.assign({}, e, { n: 1 }));
    });
    return out;
  }

  function alertList(items, kind, one, many) {
    const list = dedupeAlerts(items);
    if (!list.length) return '';
    return `<div class="dzc-issues dzc-issues--${kind}">
      <p class="dzc-issues-head">${list.length} ${list.length === 1 ? one : many}</p>
      <ul>${list.map(e =>
        `<li>${e.n > 1 ? `<b class="dzc-issue-n">${e.n} ×</b> ` : ''}${esc(e.msg)
          } <span class="dzc-rulecite">(rule ${esc(e.rule)})</span></li>`).join('')}</ul>
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
      ${u.special ? `<div class="dzc-pick-rules">${U.rulesHtml(u.special, u.faction || faction)}</div>` : ''}
    </div>`;
  }

  // ------------------------------------------------------------- unit picker

  async function openPicker(groupId, kind) {
    picker.groupId = groupId;
    picker.search = '';
    // 'unit' | 'transport'. Which button opened it, and the only thing the two
    // lists differ by.
    picker.kind = kind === 'transport' ? 'transport' : 'unit';
    // The category tabs are the wrong control for a list that is already one
    // category, so a fresh open always starts on All within its own side.
    picker.category = 'All';
    // Shut, every time. An open fold on a phone is the whole viewport again,
    // and the sort it holds survives the close, so nothing is lost by folding.
    picker.more = false;
    await renderPicker();
    // The panel says which of the two you opened, in the button's own words.
    const t = document.querySelector('#dzc-picker .modal-title');
    if (t) t.textContent = picker.kind === 'transport' ? 'Add Transports' : 'Add Units';
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
     * a dropdown made the one thing that grows a Group invisible. And 3.2.4
     * is explicit that choosing a Transport alongside a Squad is how a Group
     * forms. canAddUnit refuses the ones that make no sense here, and says
     * which rule refuses them. */
    /* Category tabs, built from what this faction actually has and carrying
     * how many. Dropfleet does both in renderCategoryTabs (app.js:4283): it
     * walks CATEGORY_ORDER, skips any category with nothing in it, and puts
     * the count in the label.
     *
     * Hardcoding the six meant a faction with no Support units still offered a
     * Support tab that led to an empty list, and every tab was a guess about
     * how much was behind it. Generated is absent by construction rather than
     * by being listed: those Units are never selectable, so they never reach
     * the count.
     *
     * The number is what EXISTS in the category, not what survives the current
     * search. It is fixed at open, which is what lets the bar be built once and
     * never rebuilt. The thing that stopped the modal jumping under your
     * finger every time you touched a sort. */
    /* One side of the split or the other -- never both. Which side is the
     * button you pressed, and it is the only difference between the two
     * lists: same search, same sorts, same filters, same cards. */
    const pickable = f.units.filter(u => u.selectable !== false
      && (picker.kind === 'transport') === (u.category === 'Transport'));
    const catCounts = CATEGORY_ORDER
      .map(c => ({ name: c, n: pickable.filter(u => u.category === c).length }))
      .filter(c => c.n > 0);
    // Transports are one category, so tabs over them say nothing.
    const cats = catCounts.length > 1
      ? [{ name: 'All', n: pickable.length }].concat(catCounts) : [];

    /* Same rule for the filters: a chip that cannot match anything is a
     * control that does nothing, and this faction is the only scope that
     * matters because an army has exactly one.
     *
     * It removes Unique from every faction. There is not a single Unique Unit
     * in the game as published. The rule is still enforced in canAddUnit for
     * when TTCombat print one; the chip was just an empty promise. Upgrades
     * goes on Scourge, Shaltari and Bioficer for the same reason. */
    const filters = FILTERS.filter(fl => (!fl.when || fl.when()) && pickable.some(fl.test));
    // An active filter that is no longer on offer would go on quietly cutting
    // the list with nothing on screen to say so.
    picker.filters = picker.filters.filter(k => filters.some(fl => fl.key === k));
    /* --acc is declared inline on .dzc-wrap, and this modal lives outside it,
     * so the active chip was painting white text on an undefined background.
     * The filters worked, you just could not see which one was on. */
    const U = window.DZCUnits;
    /* The bar is built ONCE and never rebuilt. Every control below only ever
     * redraws the list and re-flags the chips in place, because rewriting this
     * markup moved the caret, reset the scroll and made the whole modal jump
     * under your finger every time you touched a sort. */
    document.getElementById('dzc-picker-body').innerHTML = `
      <div class="dzc-pick-bar" id="dzc-pick-bar" style="${window.DZC.accentStyle(accentOf(a.faction))}">
        <!-- The search, the two lens buttons and the category tabs are ONE
             wrapping flex row, not two stacked ones, because which line each
             lands on differs by width and CSS order is the only way to say that
             without building the toolbar twice. A desktop puts the field and
             both buttons on line 1 and the tabs on line 2; a phone gives the
             field the whole of line 1 -- the placeholder is Jet's copy and it
             has to fit -- and puts the tabs on line 2 with the buttons pinned
             to the right of them. -->
        <div class="dzc-search-row dzc-pick-top">${window.DZCIcon('search')}
          <input class="dzc-search" id="dzc-pick-search" type="search"
                 placeholder="Search units, variants, weapons or rules"
                 value="${esc(picker.search)}"
                 oninput="DZCBuilder.pickerSearch(this.value)" aria-label="Search units">
          <div class="dzc-chips">${cats.map(c =>
            `<button type="button" class="dzc-chip" data-cat="${esc(c.name)}"
              onclick="DZCBuilder.pickerCat('${c.name}')"
              >${esc(c.name)}<i class="dzc-chip-n">${c.n}</i></button>`).join('')}</div>
          <!-- Phone only. Sort, the filters and Fits are three rows of chips at
               44px each, and at 390 they came to 324px of controls above the
               first card -- the picker opened on nothing but its own toolbar.
               They fold behind this; the count on it is what says a fold is
               hiding something, so a filter can never be on with nothing on
               screen to say so. Desktop never sees the button. -->
          <button type="button" class="dzc-view-toggle dzc-pick-more-btn" id="dzc-pick-more-btn"
                  aria-expanded="false" aria-controls="dzc-pick-more"
                  aria-label="Sort and filter" onclick="DZCBuilder.pickerMore()"
            >${window.DZCIcon('tune', { size: 17 })}<i class="dzc-more-n"></i></button>
          <button type="button" class="dzc-view-toggle" id="dzc-pick-view"
                  aria-label="Show as a list" onclick="DZCBuilder.pickerView()"></button>
        </div>
        <div class="dzc-pick-more" id="dzc-pick-more"><div class="dzc-pick-more-in">
          <div class="dzc-pick-sorts">
            <span class="dzc-pick-sortlab">Sort</span>
            ${SORTS.map(s => `<button type="button" class="dzc-chip dzc-chip--sm" data-sort="${s.key}"
              onclick="DZCBuilder.pickerSort('${s.key}')"
              >${esc(s.label)}<i class="dzc-dir"></i></button>`).join('')}
            ${filters.map(fl => `<button type="button" class="dzc-chip dzc-chip--sm" data-filter="${fl.key}"
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
        </div></div>
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
      // Its only content is an icon, so the name has to be the label. title
      // alone is a hover affordance and reaches neither a screen reader
      // reliably nor a touch device at all.
      const lab = grid ? 'Show as a list' : 'Show as cards';
      v.title = lab;
      v.setAttribute('aria-label', lab);
      v.innerHTML = window.DZCIcon(grid ? 'list_alt' : 'grid_view', { size: 16 });
    }
    /* The fold is only honest if it says what it is holding. A count on the
     * button, and the button lit, so a Fits shape left on from the last time
     * cannot quietly empty the list from behind a closed row. */
    const more = document.getElementById('dzc-pick-more');
    const mb = document.getElementById('dzc-pick-more-btn');
    if (more && mb) {
      const n = picker.filters.length + picker.shapes.length;
      more.classList.toggle('is-open', !!picker.more);
      mb.classList.toggle('is-open', !!picker.more);
      mb.classList.toggle('is-active', n > 0);
      mb.setAttribute('aria-expanded', picker.more ? 'true' : 'false');
      const i = mb.querySelector('.dzc-more-n');
      if (i) i.textContent = n || '';
    }
  }

  /* Sorting and filtering the adder. Dropfleet has Points / Name / Tonnage
   * plus seven filters and a results bar (renderShipSelectGrid, app.js:4409);
   * these are the DZC equivalents. Capacity is ours. It decides what a Group
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
    { key: 'aux',      label: 'Auxiliary', test: u => !!u.auxiliaryTransport },
    // The sixth gap 24 asked for. A paid weapon upgrade is a green name box
    // with a points cost (3.2.3), and only 18 Units in the game have one, so
    // "what can I spend the last 40 points on" is a real question this answers.
    { key: 'upgrades', label: 'Upgrades',
      test: u => (u.weapons || []).some(w => w.box === 'upgrade' && w.upgradePoints != null) },
    /* Gap 32. Only when the Collection is switched on: the builder does not
     * mention what you own unless you have said you want it to, which is the
     * same gate applyCollectionSetting puts on the landing tile.
     *
     * It hides itself the rest of the time by the same rule every other filter
     * follows -- nothing owned in this faction, no chip -- so it never sits
     * there as a control that empties the list and does not say why. */
    { key: 'owned', label: 'Owned',
      when: () => !!(window.App && window.App.collectionOn && window.App.collectionOn()),
      test: u => !!(window.DZCCollection
        && window.DZCCollection.count(current.faction, u.id) > 0) }
  ];
  const CATEGORY_ORDER = ['Standard', 'Vanguard', 'Heavy', 'Support', 'Transport', 'Generated'];

  const squadPrice = u => window.DZC.squadPrice(u);
  const span = (lo, hi) => (lo === hi ? `${lo}` : `${lo}–${hi}`);

  // Sorting by Price sorts by the number on the card, which is now the Squad's.
  function unitLowPoints(u) {
    const p = squadPrice(u);
    return p ? p.lo : 0;
  }
  function totalCapacity(u) {
    return (((u.transport || {}).capacity) || []).reduce((t, c) => t + (c.n || 0), 0);
  }

  /* What is in this Group and still wants a ride: the Squads that are not
   * aboard anything, and are not Transports themselves. A Group where every
   * Squad is already carried has nothing to answer for, and returns nothing --
   * which leaves the list in exactly the order the sort put it. */
  function needsCarrying(a, groupId) {
    const g = (a.groups || []).find(x => x.id === groupId);
    if (!g) return [];
    return g.squads.filter(s => !s.carriedBy)
      .map(s => window.DZCArmy.unitOf(a, s))
      .filter(u => u && u.category !== 'Transport');
  }

  /* Only the list is redrawn on a keystroke. Re-rendering the whole body
   * replaced the <input>, which threw away focus and the caret, you got one
   * character and then nothing. */
  function renderPickList() {
    const a = current;
    const f = window.DZC.faction(a.faction);
    if (!f) return;
    const q = picker.search.trim().toLowerCase();

    let units = f.units.filter(u => u.selectable !== false
      && (picker.kind === 'transport') === (u.category === 'Transport'));
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
    if (q) units = units.filter(u => window.DZC.matches(u, q, a.faction));

    // Checked once per unit and reused for the sort, the count and the card
    // itself, rather than three separate calls landing on three separate
    // answers if the Group changes mid-render.
    const checks = new Map(units.map(u => [u.id, canOffer(a, picker.groupId, u)]));

    /* ADD TRANSPORTS OPENS ON THE ONES THAT FIT. Jet, 2026-08-12: "if you have
     * a unit and you click or press add transport then it should default to
     * having transports that fit that unit first."
     *
     * These are not refusals, so canAddUnit does not sink them: 3.2.4 lets a
     * Transport into a Group for a Squad that is not there yet. With
     * Legionnaires in the Group all eight UCM Transports were offered in price
     * order, which put the Condor and the Crow above the Bear APC, and neither
     * of those can take a square.
     *
     * ORDERING, NOT FILTERING. The rest are still in the list, underneath,
     * because the Squad they would be for is a Squad you have not added yet. */
    const riders = picker.kind === 'transport' ? needsCarrying(a, picker.groupId) : [];
    const fits = new Map(riders.length
      ? units.map(u => [u.id, riders.some(p => window.DZC.canCarry(u, p))]) : []);

    const s = SORTS.find(x => x.key === picker.sort) || SORTS[0];
    units = units.slice().sort((x, y) => {
      // What cannot join this Group sinks to the bottom regardless of sort or
      // direction -- it is not a result, it is a "not here" -- so a Group
      // under construction stops surfacing things that would refuse it.
      const bx = !checks.get(x.id).ok, by = !checks.get(y.id).ok;
      if (bx !== by) return bx ? 1 : -1;
      if (fits.size) {
        const fx = !fits.get(x.id), fy = !fits.get(y.id);
        if (fx !== fy) return fx ? 1 : -1;
      }
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
      list.innerHTML = units.map(u => pickCard(u, a, checks.get(u.id))).join('')
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
      const blocked = units.filter(u => !checks.get(u.id).ok).length;
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
  function pickCard(u, a, chk) {
    // The total for the smallest legal Squad, with the arithmetic under it when
    // that is more than one model, so "70pts" never has to be read as 35.
    const sp = squadPrice(u);
    const price = sp ? span(sp.lo, sp.hi) : '—';
    const each = sp && sp.n > 1 ? `${sp.n} × ${span(sp.perLo, sp.perHi)}` : '';
    if (!chk) chk = canOffer(a, picker.groupId, u);
    const U = window.DZCUnits;
    const meta = [
      `<span class="dzc-cat" data-cat="${esc(u.category)}">${esc(u.category)}</span>`,
      `<span>${esc(u.type || '')}</span>`,
      U.sizeHtml(u) ? `<span>${U.sizeHtml(u)}</span>` : ''
    ].filter(Boolean).join('');
    return `<div class="dzc-pick${chk.ok ? '' : ' is-blocked'}">
      ${u.rare || u.unique ? `<span class="dzc-pick-flags">${u.rare
        ? '<span class="dzc-flag dzc-flag--rare">Rare</span>' : ''}${u.unique
        ? '<span class="dzc-flag dzc-flag--unique">Unique</span>' : ''}</span>` : ''}
      <div class="dzc-pick-open" role="button" tabindex="0"
           title="Stats, weapons and rules"
           onclick="DZCUnits.openDetail('${esc(u.id)}','${esc(a.faction)}')"
           onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();DZCUnits.openDetail('${esc(u.id)}','${esc(a.faction)}')}">
        ${u.art ? `<img class="dzc-pick-art" src="${esc(u.art)}" alt="" loading="lazy" onerror="this.remove()">`
                : '<span class="dzc-pick-noart"></span>'}
        <div class="dzc-pick-head">
          <span class="dzc-pick-name">${esc(u.name)}</span>
          <span class="dzc-pick-cost">${price}<small>pts</small>${
            each ? `<i class="dzc-pick-each">${each}</i>` : ''}</span>
        </div>
        <span class="dzc-pick-meta">${meta}</span>
        <!-- The symbols, on the card you choose from. Which shape a unit fills
             and which it offers is what decides whether two things can share a
             Group at all (3.2.4.2), so needing to open the unit to find out
             made the one deciding fact the one hidden fact. -->
        ${U.transportHtml(u)}
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

  /* Adding closes the picker and puts you back on the army. Keeping it open to
   * "pick another" is what the Dropfleet builder does, but there a Group is a
   * shopping list; here a Group is a Transport and its cargo, and every add
   * changes what the next legal one is. You want to see what you just made. */
  async function pick(unitId) {
    const g = (current.groups || []).find(x => x.id === picker.groupId);
    const u = window.DZC.unit(current.faction, unitId);
    if (!g || !u) return;

    /* A Gate lands in the Gates Group, whichever Group you were looking at.
     * "A Gate is never part of another Group" and it costs none of the
     * allowance, so putting it where you pressed the button would build an
     * illegal army out of a legal press. It carries nothing and it is not
     * carried, so nothing below this applies to it either.
     *
     * The Group you are on wins when it can take one, so pressing Add
     * Transports on a Group you just made puts the Gate in THAT Group rather
     * than in one somewhere else on the screen. */
    if (window.DZCArmy.isGate(u)) {
      const here = !g.squads.length
        || g.squads.every(s => window.DZCArmy.gateSquad(current, s));
      const home = here ? g : window.DZCArmy.gateHome(current, true);
      const gs = window.DZCArmy.addSquad(current, home.id, unitId);
      if (!gs) return;
      closePicker();
      await renderBuilder(current.id);
      return say(`${u.name} added to ${window.DZCArmy.groupName(current, home)}.`, 'add');
    }

    /* Picking a Transport does not make a loose Squad of Transports, it
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
        closePicker();
        await renderBuilder(current.id);
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
      const xu = window.DZCArmy.carrierOf(current, x);
      if (x.id === s.id || x.carriedBy || !xu) return false;
      if (!(xu.category === 'Transport' || xu.auxiliaryTransport)) return false;
      if (!window.DZC.canCarry(xu, u)) return false;
      const aboard = g.squads.filter(y => y.carriedBy === x.id && y.id !== s.id)
        .map(y => ({ unit: window.DZCArmy.unitOf(current, y), count: y.models.length }))
        .filter(y => y.unit);
      aboard.push({ unit: u, count: s.models.length });
      return window.DZC.loadCheck(xu, aboard, x.models.length).ok;
    });
    if (carrier) s.carriedBy = carrier.id;

    closePicker();
    await renderBuilder(current.id);
    say(`Added ${u.name}.`, 'add');
  }

  /* Share, three ways.
   *
   * They are three different asks and one of them cannot serve the other two.
   * The LINK carries the whole army in the URL, so it needs no server and
   * cannot rot. But it is unreadable, and a forum post wants words. The TEXT
   * is those words, and it is also what this app's own Import reads back. The
   * JSON is the same file the backup button writes, so a shared army arrives
   * exactly the way a restored one does.
   *
   * Dropfleet offers the same three (app.js showShareModal). Each is a copy,
   * not a preview: the thing you came here to do is paste it somewhere else. */
  const SHARE_TARGETS = [
    ['link', 'Link', 'Opens the army in this app'],
    ['text', 'Plain text', 'For a message or a forum post'],
    ['json', 'JSON', 'The file Import reads']
  ];

  function openShare() {
    if (!current) return;
    document.getElementById('dzc-share-body').innerHTML = SHARE_TARGETS.map(([k, label, hint]) =>
      `<button type="button" class="dzc-share-opt" onclick="DZCBuilder.copyShare('${k}')">
        <b>${esc(label)}</b><span>${esc(hint)}</span>
        ${window.DZCIcon('content_copy', { size: 16 })}</button>`).join('');
    document.getElementById('dzc-share').classList.add('active');
  }

  async function copyShare(kind) {
    if (!current) return;
    let out;
    try {
      out = kind === 'link' ? await window.DZCShare.link(current)
        : kind === 'text' ? window.DZCShare.text(current)
        : window.DZCShare.json(current);
    } catch (e) {
      return say('Could not build that: ' + e.message);
    }
    try {
      await navigator.clipboard.writeText(out);
      // Dropfleet's words for this exact event (showToast, app.js:6776).
      say(kind === 'link' ? 'Share link copied!' : 'Copied!');
    } catch (e) {
      // Blocked clipboard, usually an insecure origin. The prompt is still a
      // way to get the text out; JSON is too long for one, so it downloads.
      if (kind === 'json') download(current.name + '.json', out);
      else window.prompt('Copy this:', out);
    }
  }

  function download(name, body) {
    const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name.replace(/[^\w.\- ]+/g, '_');
    a.click();
    URL.revokeObjectURL(url);
  }

  function closePicker() {
    const m = document.getElementById('dzc-picker');
    if (m) m.classList.remove('active');
  }

  /* Choosing a Transport, visually. Every option shows the shapes it offers,
   * how many of it the cargo needs, what that costs and whether it comes out
   * exactly full -- 3.2.4 wants Transports taken full, and "5 Legionnaires
   * cannot fill two Bear APCs" is arithmetic you should not have to do. A
   * part-empty fit is offered anyway, marked, because buying one more model
   * fixes it and refusing the choice made that unreachable. */
  function openCarry(squadId) {
    const s = window.DZCArmy.findSquad(current, squadId);
    const u = s && window.DZCArmy.unitOf(current, s);
    if (!u) return;
    const U = window.DZCUnits;
    const opts = window.DZCArmy.transportOptions(current, squadId);
    const nowId = s.carriedBy
      ? (window.DZCArmy.findSquad(current, s.carriedBy) || {}).unitId : '';

    const card = o => {
      const total = (o.unit.points != null ? o.unit.points : 0) * o.need;
      return `<button type="button" class="dzc-carry-card${o.unit.id === nowId ? ' is-on' : ''}${
        o.exact ? '' : ' is-partial'}" onclick="DZCBuilder.assignTransport('${s.id}','${esc(o.unit.id)}')">
        ${o.unit.art ? `<img src="${esc(o.unit.art)}" alt="" loading="lazy" onerror="this.remove()">`
                     : '<span class="dzc-carry-noart"></span>'}
        <span class="dzc-carry-name">${esc(o.unit.name)}</span>
        <span class="dzc-carry-caps">${U.transportHtml(o.unit)}</span>
        <span class="dzc-carry-sum"><b>${o.need > 1 ? `× ${o.need}` : ''}</b>${
          total ? `<i>${total}pts</i>` : ''}</span>
        <span class="dzc-carry-fit">${o.exact
          ? `${window.DZCIcon('check_circle', { size: 14 })}Exactly full`
          : `${window.DZCIcon('warning', { size: 14 })}Carries ${o.per}, this Squad fills ${o.fill}`}</span>
      </button>`;
    };

    /* Transports already in this Group come FIRST, and they cost nothing.
     * Without this, a Vulture Troopship can never be filled: it carries 4
     * squares and every UCM infantry Squad is 2-3 models at 1 square each, so
     * buying one per Squad leaves it permanently short and the stepper refuses
     * to grow past squadMax. Sharing one is what 3.2.4.1 is for. */
    const board = window.DZCArmy.boardOptions(current, squadId);
    const boardCard = o => `<button type="button" class="dzc-carry-card dzc-carry-here${
      o.squad.id === s.carriedBy ? ' is-on' : ''}${o.full ? '' : ' is-partial'}"
      onclick="DZCBuilder.boardTransport('${s.id}','${o.squad.id}')">
      ${o.unit.art ? `<img src="${esc(o.unit.art)}" alt="" loading="lazy" onerror="this.remove()">`
                   : '<span class="dzc-carry-noart"></span>'}
      <span class="dzc-carry-name">${esc(o.unit.name)}</span>
      <span class="dzc-carry-caps">${U.transportHtml(o.unit)}</span>
      <span class="dzc-carry-sum"><b>${o.after}</b><i>of ${o.room} aboard</i></span>
      <span class="dzc-carry-fit">${o.full
        ? `${window.DZCIcon('check_circle', { size: 14 })}Fills it`
        : `${window.DZCIcon('warning', { size: 14 })}${o.room - o.after} still spare`}</span>
    </button>`;

    document.getElementById('dzc-carry-body').innerHTML = `
      <p class="dzc-carry-for">${esc(u.name)} <span>fills</span> ${U.transportHtml(u)}</p>
      ${board.length ? `<p class="dzc-carry-head">Already in this Group</p>
        <div class="dzc-carry-grid">${board.map(boardCard).join('')}</div>
        <p class="dzc-carry-head">Or take another</p>` : ''}
      <div class="dzc-carry-grid">
        <button type="button" class="dzc-carry-card dzc-carry-walk${nowId ? '' : ' is-on'}"
                onclick="DZCBuilder.assignTransport('${s.id}','')">
          <span class="dzc-carry-noart">${window.DZCIcon('stat_mv_infantry', { size: 34 })}</span>
          <span class="dzc-carry-name">Walks on</span>
          <span class="dzc-carry-fit">No Transport</span>
        </button>
        ${opts.map(card).join('')}
      </div>`;
    document.querySelector('#dzc-carry .modal-title').textContent = `Transport for ${u.name}`;
    document.getElementById('dzc-carry').classList.add('active');
  }

  function closeCarry() {
    const m = document.getElementById('dzc-carry');
    if (m) m.classList.remove('active');
  }

  // -------------------------------------------------------------- print sheet

  /* The printed sheet is the deployment plan, so it keeps the nesting tree and
   * states capacity at each level. Everything else -- chrome, art, colour --
   * is dropped, because none of it helps at a table. */
  /* The sheet's Group line, in the unit the allowance is in. A Behemoth is
   * several Groups (1.1), so a sheet reading "2 Groups" for a list spending
   * six of a Clash's twelve was telling the table the wrong number. Both are
   * printed when they differ, because the cards in front of you are two. */
  function sheetGroups(a) {
    const used = window.DZCArmy.groupsUsed(a);
    const cards = a.groups.length;
    const g = n => `${n} Group${n === 1 ? '' : 's'}`;
    return used === cards ? g(used) : `${g(used)} on ${cards} cards`;
  }

  function sheetHtml() {
    const a = current;
    if (!a) return '';
    const size = window.DZC.gameSizeFor(a.pointsLimit);
    const v = window.DZCArmy.validate(a);
    // Keyed by the PRINTED keyword, not the rule id: Aegis 3" and Aegis 6" are
    // one glossary entry but two different sentences once the value is folded
    // in, and the sheet has to carry the one the model actually has.
    const used = new Map();          // printed keyword -> { token, rule, text }

    function collectRules(u, guns) {
      [u.special || ''].concat((guns || []).map(w => w.special || '')).forEach(sp => {
        window.DZC.splitSpecial(sp, a.faction).forEach(tok => {
          const r = window.DZC.rule(tok, a.faction);
          if (r && !used.has(tok)) {
            used.set(tok, { token: tok, rule: r, text: window.DZC.ruleText(tok, a.faction) });
          }
        });
      });
    }

    function squad(g, s, depth) {
      const u = window.DZCArmy.unitOf(a, s);
      if (!u) return '';
      const guns = window.DZCUnits.unitWeapons(u, squadGuns(s));
      collectRules(u, guns);
      const riders = g.squads.filter(x => x.carriedBy === s.id);
      const cost = window.DZCArmy.squadCost(a, s);
      /* THE SAME STATS THE SCREEN DRAWS. Jet, 2026-08-13: "I'd like if print
       * mode could resemble all the nice work (with icons and shit) we put
       * into builder mode."
       *
       * It was a run-on string -- "Move 18” Armour 2 Damage Points 3" -- with
       * every value the same weight as its label and no way to read one Squad
       * against the next. statsHtml is the builder's own renderer: a fixed
       * grid, the icon over the number, the label under it, and only the
       * stats the card actually prints (a tank has no Bravery). Compact,
       * because paper is the one place a column really is scarce. */
      const stats = window.DZCUnits.statsHtml(u, { compact: true });

      // Variants are per model, so a mixed Squad is listed by its actual mix.
      const mix = {};
      s.models.forEach(m => { const k = m.variant || u.name; mix[k] = (mix[k] || 0) + 1; });
      /* AND THE RULES THAT BELONG TO A VARIANT GO ON THAT VARIANT (3.2.2).
       * On paper this matters more than on screen: the sheet is what you argue
       * from, and "Scanner" printed once against the whole Squad reads as
       * every tank in it having one when only the Greave does. Each Variant on
       * the mix line names its own, and the stat line below prints only what
       * the card gives every model. */
      const vRule = name => ((u.specialVariants || [])
        .filter(x => x.variants.indexOf(name) !== -1)
        .map(x => x.rule));
      /* A VARIANT'S OWN PHOTOGRAPH, when art is on. 155 of the 199 variants
       * have one and the sheet only ever printed the unit's, so a page of
       * Wolverines showed the same buggy four times over -- which is the exact
       * complaint that got the variants their pictures in the first place.
       * The Squad's own photo drops when every line here carries one, rather
       * than printing the general picture above four specific ones. */
      const vArt = name => (u.variants || []).find(v => v.name === name);
      const mixStr = Object.keys(mix).length > 1 || (u.variants || []).length
        ? Object.keys(mix).map(k => {
          const rs = vRule(k);
          const v = vArt(k);
          return `<span class="pr-mix">${printOpts.art && v && v.art
            ? `<img class="pr-vart" src="${esc(v.art)}" alt="" onerror="this.remove()">` : ''
            }${mix[k]}× ${esc(k)}${rs.length ? ` <i>(${esc(rs.join(', '))})</i>` : ''}</span>`;
        }).join('') : '';
      const allVartd = printOpts.art && Object.keys(mix).length
        && Object.keys(mix).every(k => { const v = vArt(k); return v && v.art; });
      // Everything the card restricts, so the stat line can print the rest.
      const ownSpecial = (u.specialVariants || []).length
        ? window.DZC.splitSpecial(u.special || '', a.faction)
          .filter(tok => !(u.specialVariants || []).some(x =>
            String(tok).replace(/\s*\([^)]*\)\s*$/, '').trim().endsWith(x.rule)))
          .join(', ')
        : (u.special || '');

      /* A Behemoth's Gear, priced in Power. This is the sheet you take to a
       * table, and Gear is the one thing on a Behemoth card you consult every
       * activation and cannot work out from anything else. What it may spend
       * its Power on and what each costs. On paper it is a price list, so it
       * prints as one. */
      const gear = (u.gear || []).length
        ? `<div class="pr-gear"><b>Gear</b> ${u.gear
            .map(x => `${esc(x.power)}PT ${esc(x.name)}`).join(', ')}</div>`
        : '';

      /* The transport symbols, drawn, not spelled. The shape IS the
       * vocabulary (3.2.4.2), and the sheet printed the shape's NAME instead:
       * "carries 2 square", which is both ungrammatical and a second way of
       * saying what the app says with a glyph. Same renderer as the screen, so
       * cargo comes with it: what a Transport takes up aboard something else
       * is half the question at a table and the sheet never printed it. */
      const cap = window.DZCUnits.transportHtml(u);

      // The sheet is the deployment plan, and on paper you cannot expand a row
      // to find out that the gun above it belongs to a Variant you did not
      // take. Same guns as the Squad row, from the same definition.
      const wpns = guns.length ? `<table class="pr-wpn">
        <tr><th>Weapon</th><th>Arc</th><th>Move &amp; Attack</th><th>Range</th><th>Attacks</th><th>Accuracy</th><th>Energy</th><th>Special</th></tr>
        ${guns.map(w => `<tr><td>${esc(w.name)}${(w.variants || []).length ? ` <i>(${esc(w.variants.join(', '))})</i>` : ''}</td>
          <!-- The arc DRAWN, then named, exactly as the weapon table on screen
               does it. "F/S" is a code you have to already know; the glyph is
               the thing printed on the stat card. -->
          <td class="dzc-arc-cell">${window.DZCIcon.arc(w.arc)}<span>${esc(w.arc || '')}</span></td>
          <td>${esc(w.ma || '')}</td><td>${esc(w.r || '')}</td>
          <td>${esc(w.att || '')}</td><td>${esc(w.ac || '')}</td><td>${esc(w.e || '')}</td>
          <!-- Rule chips, not a comma list. Same renderer, so a keyword reads
               the same on paper as it does in the app, and the glossary at the
               back is printing the text behind each one. -->
          <td>${w.special ? window.DZCUnits.rulesHtml(w.special, a.faction, null, true) : ''}</td></tr>`).join('')}</table>` : '';

      return `<div class="pr-squad${depth ? ' pr-squad--nested' : ''}" style="--depth:${depth}">
        ${printOpts.art && u.art && !allVartd
          ? `<img class="pr-art" src="${esc(u.art)}" alt="" onerror="this.remove()">` : ''}
        <!-- ONE LINE, NOT FOUR. Jet, 2026-08-13: "less lines. for example put
             the unit transport icons on the same line as other shit."
             The name, what it is, what it carries, what it is carrying in RM,
             and what it cost all belong to the same fact and were stacked
             four deep. Capacity and RM move up here; the stats row that
             follows carries the Squad's rules on its right rather than
             opening a line of its own. -->
        <div class="pr-sq-line">
          ${s.models.length > 1 ? `<span class="pr-sq-n">${s.models.length}×</span>` : ''}
          <!-- NO CATEGORY. Jet, 2026-08-13: "we don't really need to be
               reminding people if a unit is standard/heavy/etc during play."
               Standard/Vanguard/Heavy/Support decide whether a list is LEGAL
               (3.2), which is a question answered before the sheet is printed
               and never again. It rode on every Squad line, on the one
               document you read with a model in your hand. -->
          <span class="pr-sq-name">${esc(u.name)}</span>
          ${cap ? `<span class="pr-cap">${cap}</span>` : ''}
          ${window.DZCArmy.rmOf(s) ? `<span class="pr-rm">${window.DZCArmy.rmOf(s)} RM</span>` : ''}
          ${s.commander ? `<span class="pr-cmdr">${esc(commanderTagName(a, s))}</span>` : ''}
          <span class="pr-sq-cost">${cost}pts</span>
        </div>
        ${mixStr ? `<div class="pr-variants">${mixStr}</div>` : ''}
        <div class="pr-statline">
          <div class="pr-stats">${stats}</div>
          ${ownSpecial ? `<div class="pr-rules-row">${
            window.DZCUnits.rulesHtml(ownSpecial, a.faction, null, true) || esc(ownSpecial)}</div>` : ''}
        </div>
        ${wpns}
        ${gear}
        ${riders.map(r => squad(g, r, depth + 1)).join('')}
      </div>`;
    }

    /* The Commander block.
     *
     * A Commander was on the sheet only as a tag beside the Squad they ride
     * with, so one you had not assigned yet did not print at all. And the
     * numbers that come off Commander Level did not print anywhere. Those are
     * the ones you reach for every Round: CP replenishes up to your highest
     * Level and so does your Command Card hand (4.1.1, 4.1.4), and Initiative
     * is D6 + Level (4.1).
     *
     * The activation count goes here too, because it is not the Group count. A
     * Group of nothing but non-auxiliary Transports cannot be picked for a
     * normal activation (4.1.2, 4.2.1), it goes in the Orphaned Transport
     * step, so counting Groups and counting activations give different
     * answers, and the one you want at the table is this one.
     *
     * The Level cell is empty on a Commander you have not named, because then
     * the name already IS the Level: the row read "Level 4 Commander  Level 4
     * not assigned". */
    const cmdrs = window.DZCArmy.commanders(a);
    const top = cmdrs.reduce((n, c) => Math.max(n, c.level || 0), 0);
    const activations = a.groups.filter(g => g.squads.some(s => {
      const cu = window.DZCArmy.unitOf(a, s);
      return cu && cu.category !== 'Transport';
    })).length;
    const commanderBlock = cmdrs.length ? `<section class="pr-cmdrs">
      <h2 class="pr-cmdrs-head">Commanders</h2>
      ${cmdrs.map(c => {
        const sq = c.squadId ? window.DZCArmy.findSquad(a, c.squadId) : null;
        const cu = sq ? window.DZCArmy.unitOf(a, sq) : null;
        return `<div class="pr-cmdr-row">
          <span class="pr-cmdr-name">${esc(window.DZCArmy.commanderName(a, c))}</span>
          <span>${c.name ? `Level ${c.level}` : ''}</span>
          <span>${cu ? 'with ' + esc(cu.name) : 'not assigned'}</span>
          <span class="pr-cmdr-pts">${window.DZCArmy.levelCost(c.level)}pts</span>
        </div>`;
      }).join('')}
      <!-- FOUR NUMBERS, NOT ONE SENTENCE OF THEM. Jet, 2026-08-13: "CP per
           Round 5, hand 5 cards, Initiative D6 + 5 (4.1). 5 activations
           (4.2.1). this is too truncated slop."
           He is right: four unrelated figures run together with commas, three
           of them the same digit, and a rulebook citation wedged in the middle.
           These are looked up mid-game, one at a time -- so each gets its own
           cell, its number set large, and its name spelled out underneath. The
           same shape as a stat block, because that is what it is. -->
      <div class="pr-cmdr-play">
        <div><b>${top}</b><span>Command Points<i>per Round (4.1.1)</i></span></div>
        <div><b>${top}</b><span>Command Card${top === 1 ? '' : 's'}<i>in hand (4.1.4)</i></span></div>
        <div><b>D6 + ${top}</b><span>Initiative<i>each Round (4.1)</i></span></div>
        <div><b>${activations}</b><span>Activation${activations === 1 ? '' : 's'}<i>per Round (4.2.1)</i></span></div>
      </div>
    </section>` : '';

    const groups = a.groups.map(g => `<section class="pr-group" style="${
      window.DZC.accentStyle(accentOf(a.faction))}">
      <div class="pr-g-head">
        <h2 class="pr-g-name">${esc(window.DZCArmy.groupName(a, g))}</h2>
        <!-- What carries the Group, named, the same as its card in the app. -->
        ${(() => {
          const c = new Map();
          g.squads.forEach(s => {
            const cu = window.DZCArmy.unitOf(a, s);
            if (cu && cu.category === 'Transport') c.set(cu.name, (c.get(cu.name) || 0) + 1);
          });
          return c.size ? `<span class="pr-g-carry">${[...c].map(([nm, n]) =>
            esc((n > 1 ? n + ' ' : '') + (n > 1 ? nm + 's' : nm))).join(', ')}</span>` : '';
        })()}
        <span class="pr-g-cost">${window.DZCArmy.groupCost(a, g)}pts</span>
      </div>
      ${g.squads.filter(s => !s.carriedBy).map(s => squad(g, s, 0)).join('')}
    </section>`).join('');

    // Headed and sorted on the written-out name, the same as the screen. The
    // printed abbreviation follows in brackets, because the sheet is read
    // beside the stat cards and that is what they say.
    const rules = [...used.values()]
      .map(e => Object.assign({}, e, { label: window.DZC.ruleLabel(e.token, a.faction) }))
      .sort((x, y) => x.label.localeCompare(y.label))
      .map(e => `<div class="pr-rule"><h3>${esc(e.label)}${
        e.label.toLowerCase() !== String(e.token).trim().toLowerCase()
          ? ` (${esc(e.token)})` : ''}</h3>
        <!-- One running paragraph, joined on a space. The sheet sets .pr-rule p
             to display:inline on purpose -- a line per rule name was a third of
             the appendix -- so two <p> elements here butt together with no gap
             and read "...into or from this Unit.If your Army contains...". A
             rule that now arrives in two paragraphs (a qualifier plus the rule
             it qualifies) is spliced here rather than on screen, where the
             break is drawn. -->
        <p>${esc(String(e.text || '').split(/\n{2,}/)
          .map(t => t.trim()).filter(Boolean).join(' '))} <span class="pr-src">${esc(e.rule.faction
          ? e.rule.faction.toUpperCase()
          : e.rule.section + (e.rule.page ? `, p.${e.rule.page}` : ''))}</span></p></div>`).join('');

    /* The faction's own colour, on the sheet, the way every other screen in
     * the app is drawn in it. Set as a variable on the root so headings, the
     * carry line and the category chips all take it from one place -- and so
     * the ink-saver option can override it in one place too. */
    return `
      <div class="pr-head" style="${window.DZC.accentStyle(accentOf(a.faction))}">
        <h1 class="pr-title">${esc(a.name)}</h1>
        <p class="pr-sub"><span>${esc((FACTIONS.find(f => f.id === a.faction) || {}).name || a.faction)}</span>
          <span>${size ? esc(size.label) : ''}</span>
          <span>${sheetGroups(a)}</span>
          <span><b>${window.DZCArmy.armyCost(a)}</b> / ${a.pointsLimit}pts</span></p>
        <!-- The notes you wrote on the army. They print because this is the
             sheet you hand across the table, and "the UCM half of the starter
             set" is the sort of thing you write there to say what the list IS. -->
        ${a.description ? `<p class="pr-desc">${esc(a.description)}</p>` : ''}
      </div>
      ${commanderBlock}
      ${v.errors.length ? `<p class="pr-warn"><b>Not legal:</b> ${
        dedupeAlerts(v.errors).map(e => (e.n > 1 ? e.n + ' × ' : '') + esc(e.msg)).join(' ')}</p>` : ''}
      ${dedupeAlerts(v.warnings).map(w =>
        `<p class="pr-warn">${w.n > 1 ? w.n + ' × ' : ''}${esc(w.msg)}</p>`).join('')}
      ${groups}
      ${rules ? `<section class="pr-rules"><h2>Rules used</h2>${rules}</section>` : ''}`;
  }

  /* Print goes through a preview, and the preview is the sheet at A4 with the
   * page boundaries drawn on it.
   *
   * It exists because the one thing you cannot tell from the app is how many
   * sheets of paper this is about to be, and the one thing that ruins a
   * deployment sheet is a Group cut in half. Both are answered here, and
   * answered by measuring. The breaks are drawn from the same numbers that
   * produce the page count, so the two cannot disagree with each other.
   *
   * Ported from Dropfleet's openPrintPreview (app.js:6361) rather than
   * invented. The one part worth keeping verbatim is its pagination: a naive
   * "cut every 273mm" draws breaks through the middle of cards the printer
   * will not cut, because `break-inside: avoid` moves them whole. So a block
   * that would straddle a boundary gets a spacer pushing it to the next page,
   * which is what print itself does, and the preview then agrees with the
   * paper. The spacers are preview-only; printing renders the sheet clean. */
  const PP = { onKey: null, onPop: null, ro: null, armed: false };

  /* What the sheet is printed like, kept between prints.
   *
   * They live in the preview and not in Settings, because they are decisions
   * about THIS printout, which is Dropfleet's own reasoning, written at
   * app.js:8029, and a print option in Settings is a setting you have to go
   * somewhere else to change and then come back to see.
   *
   * Art is off by default and always has been. It is the first thing a printer
   * makes a mess of, the sheet is a deployment plan rather than a display
   * piece, and it is the single biggest thing between a two-page list and a
   * four-page one. Off by default, available when you want it. */
  /* PRINT FRIENDLY BY DEFAULT. Jet, 2026-08-13: "print mode should be more
   * print friendly by default."
   *
   * Ink saver and compact are both ON out of the box now, and art stays off.
   * The sheet just gained the app's colour -- accent headings, an accent carry
   * line, outlined rule chips -- and a default that spends colour on a
   * document whose job is to be printed has the trade backwards: the person
   * who wants the pretty one is choosing to want it, and the toggles are right
   * there on the preview. Whatever you pick is remembered, so this is the
   * first print only. */
  const PRINT_KEY = 'dzc_print';
  let printOpts = { compact: true, ink: true, art: false };
  try { Object.assign(printOpts, JSON.parse(localStorage.getItem(PRINT_KEY) || '{}')); }
  catch (e) { /* nothing saved, or a browser refusing storage */ }

  function printClass() {
    return (printOpts.compact ? ' is-compact' : '') + (printOpts.ink ? ' is-ink' : '')
      + (printOpts.art ? ' is-art' : '');
  }

  function closePreview(fromBack) {
    const ov = document.getElementById('dzc-pp');
    if (ov) ov.remove();
    if (PP.onKey) document.removeEventListener('keydown', PP.onKey, true);
    if (PP.onPop) window.removeEventListener('popstate', PP.onPop);
    if (PP.ro) PP.ro.disconnect();
    PP.onKey = PP.onPop = PP.ro = null;
    // The parked history entry has to be spent, or Back leaves the app one
    // press early ever after. Not when Back is what closed us, it is gone.
    const armed = PP.armed;
    PP.armed = false;
    if (armed && !fromBack) history.back();
  }

  function openPreview() {
    if (!current) return;
    closePreview();
    const ov = document.createElement('div');
    ov.id = 'dzc-pp';
    ov.className = 'pp-overlay';
    ov.innerHTML = `
      <div class="pp-bar">
        <span class="pp-title">Print preview</span>
        <span class="pp-count" id="dzc-pp-count"></span>
        <span class="pp-spacer"></span>
        ${[['compact', 'Compact'], ['ink', 'Ink-saver'], ['art', 'Art']].map(([k, label]) =>
          `<label class="pp-opt"><input type="checkbox" ${printOpts[k] ? 'checked' : ''}
             onchange="DZCBuilder.printOpt('${k}', this.checked)">${label}</label>`).join('')}
        <button class="btn btn-ghost btn-sm" type="button" onclick="DZCBuilder.closePreview()">Close</button>
        <button class="btn btn-primary btn-sm" type="button" onclick="DZCBuilder.printNow()">Print</button>
      </div>
      <div class="pp-scroll" id="dzc-pp-scroll">
        <div class="pp-paper${printClass()}" id="dzc-pp-paper">${sheetHtml()}</div>
      </div>`;
    document.body.appendChild(ov);

    /* Escape and Back both close it. Back matters more: on a phone it IS the
     * close gesture, and without a parked entry it walks out of the app. Same
     * trick the shell plays for its modals (syncBackGuard, dzc-shell.js). */
    PP.onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); closePreview(); } };
    document.addEventListener('keydown', PP.onKey, true);
    PP.onPop = () => closePreview(true);
    window.addEventListener('popstate', PP.onPop);
    history.pushState({ dzcPreview: 1 }, '');
    PP.armed = true;

    fitPreview();
    paginate();
    // Art and webfonts land after the first measurement and change every
    // height below them, so measure again when they do.
    ov.querySelectorAll('img').forEach(img => {
      img.addEventListener('load', paginate);
      img.addEventListener('error', paginate);
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(paginate);
    if (window.ResizeObserver) {
      PP.ro = new ResizeObserver(() => { fitPreview(); paginate(); });
      PP.ro.observe(document.getElementById('dzc-pp-scroll'));
    }
  }

  /* A4 is 210mm and a phone is not. Shrink the whole sheet to fit rather than
   * letting it reflow: a preview that reflows is showing a page you will not
   * get. Everything below reads mm off the RENDERED width, so it follows. */
  function fitPreview() {
    const scroll = document.getElementById('dzc-pp-scroll');
    const paper = document.getElementById('dzc-pp-paper');
    if (!scroll || !paper) return;
    const cs = getComputedStyle(scroll);
    const avail = scroll.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    // 210mm in this browser's px, asked for rather than assumed to be 793.7.
    const mm = document.createElement('div');
    mm.style.cssText = 'position:absolute;visibility:hidden;width:210mm';
    document.body.appendChild(mm);
    const full = mm.getBoundingClientRect().width;
    mm.remove();
    paper.style.setProperty('--pp-zoom', full > 0 ? Math.min(1, avail / full) : 1);
  }

  function paginate() {
    const paper = document.getElementById('dzc-pp-paper');
    const label = document.getElementById('dzc-pp-count');
    if (!paper) return;
    paper.querySelectorAll('.pp-break, .pp-spacer-gap').forEach(el => el.remove());

    const cs = getComputedStyle(paper);
    const padTop = parseFloat(cs.paddingTop) || 0;
    const padBot = parseFloat(cs.paddingBottom) || 0;
    /* Everything here is measured in the paper's OWN pixels, before its zoom.
     *
     * The sheet shrinks to fit the screen with `zoom`, and that splits the
     * measurements into two coordinate spaces that agree only at zoom 1, which
     * is every desktop. getBoundingClientRect reports what you can see, so it
     * follows the zoom down; scrollHeight, the padding off getComputedStyle,
     * and any `top`/`height` written back as a style are the element's own
     * pixels, which do not. Mixing them made a phone read the same one-page
     * army as three pages, with a break drawn through the middle of a Squad.
     * On the one screen whose entire promise is that it agrees with the paper.
     *
     * So the rect measurements are divided back out, and the page height comes
     * out in the same space as everything written back. */
    const zoom = parseFloat(cs.zoom) || 1;
    const paperRect = paper.getBoundingClientRect();
    const perMm = (paperRect.width / zoom) / 210;
    const page = 273 * perMm;          // A4 minus the 12mm top and bottom margins
    if (!(page > 0)) return;

    /* The blocks print will not cut. A Group is one atom by design (a Group
     * torn across a page is the failure this whole sheet exists to avoid), and
     * so are the Commander block and a rule entry. This list has to stay in
     * step with the break-inside: avoid rules in css/dzc-print.css. A block
     * the stylesheet keeps whole and this does not is a break drawn where the
     * printer will not make one. */
    const atoms = [...paper.querySelectorAll('.pr-group, .pr-cmdrs, .pr-rule, .pr-rules > h2, .pr-head')]
      .map(el => {
        const r = el.getBoundingClientRect();
        // Distance from the paper's own top edge, unzoomed, then past the
        // padding. So it is measured from where the content starts.
        return { el, top: (r.top - paperRect.top) / zoom - padTop, h: r.height / zoom };
      })
      .filter(b => b.h > 0)
      .sort((x, y) => x.top - y.top);

    let offset = 0, limit = page;
    const pushes = [];
    atoms.forEach(b => {
      const top = b.top + offset, bottom = top + b.h;
      // Taller than a page: nothing can keep it whole, so print splits it and
      // the boundary simply advances past it.
      if (b.h >= page) { while (limit < bottom) limit += page; return; }
      if (bottom > limit) {
        const gap = limit - top;
        if (gap > 1) pushes.push({ el: b.el, gap });
        offset += gap;
        limit += page;
      }
    });
    pushes.forEach(({ el, gap }) => {
      const sp = document.createElement('div');
      sp.className = 'pp-spacer-gap';
      sp.style.height = gap + 'px';
      el.parentNode.insertBefore(sp, el);
    });

    const content = paper.scrollHeight - padTop - padBot;
    const pages = Math.max(1, Math.ceil((content - 1) / page));
    if (label) label.textContent = pages === 1 ? '1 page' : `${pages} pages`;
    for (let k = 1; k < pages; k++) {
      const brk = document.createElement('div');
      brk.className = 'pp-break';
      brk.style.top = (padTop + k * page) + 'px';
      brk.innerHTML = `<span class="pp-break-n">Page ${k + 1}</span>`;
      paper.appendChild(brk);
    }
  }

  /* The sheet is rebuilt clean into the hidden print container: the preview's
   * spacers and break lines are scaffolding for the screen and must not reach
   * the paper. */
  function fillPrintEl() {
    let el = document.getElementById('dzc-print');
    if (!el) { el = document.createElement('div'); el.id = 'dzc-print'; document.body.appendChild(el); }
    el.className = printClass().trim();
    el.innerHTML = sheetHtml();
    return el;
  }

  /* The app's own Print button sets the body up ITSELF rather than trusting
   * beforeprint to do it. Safari on iOS does not fire beforeprint, and a phone
   * is where this button gets pressed, so the one browser most likely to use
   * it was the one browser where the class that reveals the sheet never
   * arrived. Setting it here is idempotent -- beforeprint sets the same class
   * where it does fire.
   *
   * afterprint is not fired there either, so the class is also cleared on a
   * timer. It costs nothing to leave on: it means nothing outside @media
   * print. */
  function printNow() {
    document.body.classList.add('is-sheet');
    fillPrintEl();
    window.print();
    setTimeout(() => document.body.classList.remove('is-sheet'), 1000);
  }

  /* CTRL+P PRINTS THE SHEET TOO. Jet, 2026-08-13: "I CLICK PRINT, i get
   * blank."
   *
   * @media print hides the entire app -- `body > *:not(#dzc-print)` -- and
   * hands the printer #dzc-print instead. That container was only ever filled
   * by the app's own Print button. So every other route to the printer
   * (Ctrl+P, the browser menu, File > Print, a print-to-PDF extension) hid the
   * whole page and printed an empty div: one blank sheet, which is exactly
   * what the dialog reported.
   *
   * beforeprint fires for all of them, the app's button included -- filling it
   * twice costs one render of a document we were about to render anyway, and
   * a guard that tried to skip the second would be a cache to keep in step
   * with printOpts.
   *
   * The body class is the other half, and without it this trades one blank
   * page for another: the rule that hides the app is unconditional, so Ctrl+P
   * on the Armies list or the Unit Reference hid that page and printed the
   * empty container just the same. Now the app is only hidden when there is a
   * sheet to put in its place, and everywhere else the browser prints the page
   * you are looking at, which is what Ctrl+P is for. */
  window.addEventListener('beforeprint', () => {
    const sheet = !!current && String(location.hash || '').indexOf('#army/') === 0;
    document.body.classList.toggle('is-sheet', sheet);
    if (sheet) fillPrintEl();
  });
  window.addEventListener('afterprint', () => document.body.classList.remove('is-sheet'));

  /* Toggling redraws the sheet and measures again, because every one of these
   * changes how much paper it is. Which is the number the preview exists to
   * tell you. */
  function printOpt(key, on) {
    printOpts[key] = !!on;
    try { localStorage.setItem(PRINT_KEY, JSON.stringify(printOpts)); } catch (e) { /* quota */ }
    const paper = document.getElementById('dzc-pp-paper');
    if (!paper) return;
    paper.className = 'pp-paper' + printClass();
    paper.innerHTML = sheetHtml();
    paper.querySelectorAll('img').forEach(img => {
      img.addEventListener('load', paginate);
      img.addEventListener('error', paginate);
    });
    paginate();
  }

  function printSheet() {
    if (current) openPreview();
  }

  // ------------------------------------------------------------------ actions

  /* A REFRESH MUST NOT MOVE THE PAGE.
   *
   * Jet, 2026-08-07: "anytime you click a button to add one unit the UI
   * shouldn't jump around, jumping around is bad."
   *
   * Every action here redraws the whole builder by replacing innerHTML. For
   * one frame the view is empty, the document is a few pixels tall, the
   * browser clamps the scroll position to fit it. And then the content comes
   * back underneath a page that is now scrolled somewhere else. Press + on a
   * Squad four Groups down and you are looking at the top of the army.
   *
   * So the scroll is taken before and put back after, and the control you
   * pressed is found again and re-focused: the button is a different element
   * after the redraw, so without this the focus ring lands on <body> and the
   * next keypress goes nowhere. Identified by the Squad it belongs to plus its
   * accessible name, which is what makes it the same control rather than the
   * same position. */
  function refresh() {
    const y = window.scrollY;
    /* Hold the page's height across the swap. innerHTML = ... empties the view
     * for a frame; the document shrinks to a few hundred pixels, the browser
     * clamps the scroll position to what is left, and the content returns
     * under a page that has moved. Pinning min-height to what it already was
     * means there is nothing to clamp to. Released on the next frame, so the
     * view can then be whatever height it actually needs. */
    const root = document.getElementById('view-army');
    if (root) root.style.minHeight = root.getBoundingClientRect().height + 'px';
    /* AND THE PANES. Jet, 2026-08-07: "shit needs to STOP MOVING AND JUMPING
     * AROUND WHEN I CLICK ON OR OFF."
     *
     * The window's scroll has been held across a refresh for a while, but on a
     * desktop the builder is three panes that scroll on their OWN -- the rail,
     * the Group list and the detail. innerHTML replaces all three, every one of
     * them comes back at scrollTop 0, and pressing + on the fourth Variant of a
     * Squad threw you to the top of the pane you were reading. Keyed by class,
     * because that is what survives the swap; the elements themselves do not. */
    const panes = ['.dzc-rail-body', '.dzc-b-list', '.dzc-b-detail'].map(sel => {
      const p = root && root.querySelector(sel);
      return p ? { sel: sel, top: p.scrollTop, left: p.scrollLeft } : null;
    }).filter(Boolean);
    const el = document.activeElement;
    const mark = el && el !== document.body
      ? { sid: (el.closest('[data-sid]') || {}).dataset
            ? (el.closest('[data-sid]') || { dataset: {} }).dataset.sid : null,
          label: el.getAttribute && el.getAttribute('aria-label') }
      : null;
    return Promise.resolve(renderBuilder(current.id)).then(() => {
      if (window.scrollY !== y) window.scrollTo(0, y);
      const r2 = document.getElementById('view-army');
      if (r2) panes.forEach(p => {
        const el2 = r2.querySelector(p.sel);
        if (el2) { el2.scrollTop = p.top; el2.scrollLeft = p.left; }
      });
      requestAnimationFrame(() => {
        const r = document.getElementById('view-army');
        if (r) r.style.minHeight = '';
      });
      if (!mark || !mark.label) return;
      const scope = mark.sid
        ? document.querySelector(`[data-sid="${mark.sid}"]`) : document.getElementById('view-army');
      const again = scope && scope.querySelector(`[aria-label="${CSS.escape
        ? mark.label.replace(/"/g, '\\"') : mark.label}"]`);
      if (again && !again.disabled) again.focus({ preventScroll: true });
    });
  }

  /* Why an action was refused. Shown as a transient bar rather than an alert,
   * because a rule explanation should not be a thing you have to dismiss. */
  let sayTimer = null;
  /* The toast started life as a refusal, hence the padlock. It now also
   * confirms an add, so the icon is a parameter, a lock on "you can't" and
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
    renderList, renderBuilder, openNew, createArmy, surpriseMe, del, open,
    // Play Mode draws itself in the army's faction colour too, and the list of
    // them lives here. Exported rather than copied into a fourth module.
    accentOf,
    sortList: k => { listSort = k; renderList(); },
    // The app's toast. Exported because the shell has things worth saying too
    // (a backup written, a sync finished) and a second toast implementation
    // would be a second thing to keep in step.
    say,
    /* Redraw whatever is on screen. Settings changes call this because a
     * toggle can change what the builder is allowed to show. */
    refresh: () => { if (current) renderBuilder(current.id); },
    // Only remember a name the user actually typed, so switching faction
    // re-suggests "Scourge Army 1" instead of leaving "UCM Army 1" behind.
    nameTyped: v => { picked.name = v; },
    pickFaction: id => { picked.faction = id; openNew(); },
    /* Clicking a size sets the limit to the TOP of that band, which is what
     * people mean by "a Clash game". Typing an exact number then wins, because
     * the agreed limit is what the rules actually key off. The per-Group cap
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
    sizeChanger,
    applySize: id => {
      const g = window.DZC.index.gameSizes.find(s => s.id === id);
      if (g) applyLimit(g.max || g.min);
    },
    setLimit: v => applyLimit(parseInt(v, 10)),
    /* Enter commits, Escape abandons, the two keys everyone already tries. A
     * contenteditable does neither on its own: Enter inserts a newline into
     * your army name, and Escape does nothing, so the only way out was to
     * click away, which SAVES. There was no way to change your mind.
     *
     * Escape restores from data-orig and lets blur run as normal. */
    nameKey: e => {
      if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.target.textContent = e.target.dataset.orig || '';
        e.target.blur();
      }
    },
    /* Falling back to "Army" when the field is cleared is right, but it left
     * the heading blank on screen while storage said otherwise. The element is
     * corrected in place rather than by redrawing: replacing the markup inside
     * a blur handler destroys the element the click is still travelling to, so
     * renaming and then reaching for another control would do nothing. A Group
     * can redraw because clearing it has to show the number coming back. */
    rename: el => {
      current.name = (el.textContent || '').trim() || 'Army';
      el.textContent = current.name;
      el.dataset.orig = current.name;
      window.DZCArmy.touch(current);
    },
    renameGroup: (id, t) => { window.DZCArmy.renameGroup(current, id, t); refresh(); },
    // Just the empty Group. It used to open the picker straight away, which
    // took the decision "which Group am I filling" away from you and made
    // adding two Groups back to back a fight with a modal.
    addGroup: async () => {
      const g = window.DZCArmy.addGroup(current);
      selectedGroup = g.id;
      drilled = true;
      await renderBuilder(current.id);
    },
    // Baxter, 2026-08-09: "Deleting a group takes me to group 1 not all
    // groups." Nothing here used to touch selectedGroup or drilled, so
    // removing the Group you had open fell through to renderBuilder's own
    // fallback -- "no Group selected? show the first one" -- and left you
    // drilled into whatever Group happened to land in that slot. Back to the
    // list is the actual right answer: you just removed one, look at what's
    // left, not at an arbitrary survivor.
    removeGroup: async id => {
      // The card, if the list is what you are looking at. From the drilled-in
      // header there is no card on screen and leave() resolves at once, which
      // is the honest answer: the thing you are removing is the whole screen,
      // and animating a screen out from under a Back navigation is a different
      // idea from a card leaving a list.
      await leave(`.dzc-bb[data-gid="${id}"]`);
      window.DZCArmy.removeGroup(current, id);
      selectedGroup = null;
      drilled = false;
      await refresh();
    },
    // Baxter: "Duplicating a group does not take me to the duplicated group
    // instead leaving me on the original." Same shape as addGroup -- a new
    // Group is worth looking at, not confirming from a toast over the one you
    // already had open.
    duplicateGroup: id => {
      const r = window.DZCArmy.duplicateGroup(current, id);
      if (!r.ok) return say(r.reason);
      selectedGroup = r.group.id;
      drilled = true;
      refresh();
      say('Group duplicated.', 'add');
    },
    removeSquad: async id => {
      await leave(`[data-sid="${id}"]`);
      window.DZCArmy.removeSquad(current, id);
      // Awaited, so the promise this hands back means "gone and redrawn"
      // rather than "gone". Callers that want to look at the result -- a test,
      // a follow-on action -- would otherwise read the DOM a frame too early.
      await refresh();
    },
    setCount: (id, n) => {
      const r = window.DZCArmy.setModelCount(current, id, n);
      if (r && !r.ok) return say(r.reason);
      refresh();
    },
    count: (id, d) => {
      const s = window.DZCArmy.findSquad(current, id);
      if (!s) return;
      const r = window.DZCArmy.setModelCount(current, id, s.models.length + d);
      if (r && !r.ok) return say(r.reason);
      refresh();
    },
    /* Raw Materials. Same shape as count: setRm owns the rule, this speaks
     * whatever it refuses -- the button is disabled only while the reason sits
     * on its wrapper, and a keyboard reaching it another way still hears why. */
    rm: (id, d) => {
      const s = window.DZCArmy.findSquad(current, id);
      if (!s) return;
      const r = window.DZCArmy.setRm(current, id, window.DZCArmy.rmOf(s) + d);
      if (r && !r.ok) return say(r.reason);
      refresh();
    },
    /* By index, so a variant name never has to survive a trip through an
     * inline handler. The refusal is spoken because the button is disabled
     * only while the reason is on its wrapper. A keyboard reaching it another
     * way should still hear why. */
    /* The one-model case: set the model's Variant outright rather than trying
     * to add one of a kind and remove one of another, which cannot be done in
     * either order without passing through an illegal Squad size.
     *
     * Empty and taken are the other two presses this dot has to make sense
     * of. Empty: there is nothing to switch, so pressing any dot ADDS the
     * model as that Variant -- adjustVariantCount, same call the ranged
     * Squads use to grow. Taken, pressed on the dot that is already on: there
     * is nowhere left to switch TO, so it reads as "take this one away"
     * instead, back to empty. */
    pickVariant: (id, idx) => {
      const s = window.DZCArmy.findSquad(current, id);
      const u = s && window.DZCArmy.unitOf(current, s);
      const v = u && (u.variants || [])[idx];
      if (!v) return;
      if (!s.models.length) {
        window.DZCArmy.adjustVariantCount(current, id, v.name, 1);
      } else if (s.models[0].variant === v.name) {
        window.DZCArmy.adjustVariantCount(current, id, v.name, -1);
      } else {
        window.DZCArmy.setModelVariant(current, id, 0, v.name);
      }
      refresh();
    },
    variantShift: (id, idx, delta) => {
      const s = window.DZCArmy.findSquad(current, id);
      const u = s && window.DZCArmy.unitOf(current, s);
      const v = u && (u.variants || [])[idx];
      if (!v) return;
      const r = window.DZCArmy.shiftVariant(current, id, v.name, delta);
      if (!r.ok && r.reason) say(r.reason);
      refresh();
    },
    // The ranged-Squad counterpart to variantShift -- see canAdjustVariantCount.
    variantAdjust: (id, idx, delta) => {
      const s = window.DZCArmy.findSquad(current, id);
      const u = s && window.DZCArmy.unitOf(current, s);
      const v = u && (u.variants || [])[idx];
      if (!v) return;
      const r = window.DZCArmy.adjustVariantCount(current, id, v.name, delta);
      if (!r.ok && r.reason) say(r.reason);
      refresh();
    },
    // By index into upgradesFor, for the same reason as variantShift: a scope
    // and a weapon name are two more strings to get through an inline handler.
    // Same shape as toggleUpgrade, by index into optionsFor.
    toggleOption: (id, idx) => {
      const s = window.DZCArmy.findSquad(current, id);
      const o = s && window.DZCArmy.optionsFor(current, s)[idx];
      if (!o) return;
      const r = window.DZCArmy.toggleOption(current, s, o.scope, o.key);
      if (r && !r.ok) say(r.reason);
      refresh();
    },
    toggleUpgrade: (id, idx) => {
      const s = window.DZCArmy.findSquad(current, id);
      const o = s && window.DZCArmy.upgradesFor(current, s)[idx];
      if (!o) return;
      const r = window.DZCArmy.toggleUpgrade(current, id, o.scope, o.weapon.name);
      if (!r.ok) say(r.reason);
      refresh();
    },
    setCarrier: (id, c) => { window.DZCArmy.setCarrier(current, id, c); refresh(); },
    descTyped: v => { picked.description = v; },
    setDescription: t => {
      const was = current.description || '';
      const now = window.DZCArmy.setDescription(current, t);
      // Only redraw when it actually changed: a blur that changed nothing
      // should not rebuild the screen under the cursor.
      if (now !== was) refresh();
    },
    renameCommander: (id, t) => { window.DZCArmy.renameCommander(current, id, t); refresh(); },
    gripDown, sqGrip, gripKey, sqGripKey,
    toggleRail: () => { railOpen = !railOpen; refresh(); },
    selectGroup: id => { selectedGroup = id; drilled = true; refresh(); },
    backToGroups: () => { drilled = false; refresh(); },
    openCarry, closeCarry,
    boardTransport: (id, carrierId) => {
      const r = window.DZCArmy.boardTransport(current, id, carrierId);
      closeCarry();
      if (!r.ok) return say(r.reason);
      if (r.warn) say(r.warn, 'warning');
      refresh();
    },
    assignTransport: (id, unitId) => {
      const r = window.DZCArmy.assignTransport(current, id, unitId || null);
      closeCarry();
      if (!r.ok) return say(r.reason);
      if (r.warn) say(r.warn, 'warning');
      refresh();
    },
    setCommander: (id, lv) => {
      const r = window.DZCArmy.setCommander(current, id, lv ? parseInt(lv, 10) : null);
      if (r && !r.ok) return say(r.reason);
      refresh();
    },
    openPicker, pick, openQuick, closeQuick, startQuick,
    print: printSheet, closePreview, printNow, printOpt,
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
    armyMenu,
    duplicate: async id => {
      closeArmyMenu();
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
    share: () => openShare(),
    closeShare: () => document.getElementById('dzc-share').classList.remove('active'),
    copyShare: kind => copyShare(kind),
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
    // The fold. syncChips owns the classes, so this only flips the flag and
    // does not touch the list -- nothing about opening a row changes what is
    // in it, and redrawing 29 cards to show a row of chips is a stutter.
    pickerMore: () => { picker.more = !picker.more; syncChips(); },
    pickerClear: () => {
      picker.search = ''; picker.filters = []; picker.shapes = []; picker.category = 'All';
      const box = document.getElementById('dzc-pick-search');
      if (box) box.value = '';
      renderPickList();
    },
    closePicker,
    closeNew: () => document.getElementById('dzc-new').classList.remove('active')
  };
})();
