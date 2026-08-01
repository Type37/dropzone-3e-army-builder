/* App shell — routing, modals, settings, theme, offline and sync.
 *
 * Everything here is game-agnostic: it knows about views and dialogs, never
 * about units or Groups. It replaces the shell that was buried inside app.js
 * alongside 9,000 lines of Dropfleet domain logic, which is why that file
 * could not simply be deleted.
 *
 * The pieces it drives are unchanged and were always game-agnostic:
 *   js/offline-sync.js  downloads the app for use with no signal
 *   js/fleet-sync.js    opt-in cross-device sync of an opaque list
 */
const App = (() => {
  'use strict';

  const SETTINGS_KEY = 'dfc_settings';   // kept: renaming it would lose themes
  let settings = { theme: 'light' };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const $ = id => document.getElementById(id);

  // ------------------------------------------------------------------ modals

  function openModal(id) {
    const el = $(id);
    if (el) { el.classList.add('active'); syncBackGuard(); }
  }
  function closeModal(id) {
    const el = $(id);
    if (el) { el.classList.remove('active'); syncBackGuard(); }
  }
  function topModal() {
    const open = [...document.querySelectorAll('.modal-overlay.active')];
    return open.length ? open[open.length - 1] : null;
  }

  /* Browser Back closes the top layer instead of leaving the app.
   * Carried over from the Dropfleet build, where it was worth the trouble: on
   * a phone, Back is the natural "close this", and without a guard entry it
   * exits the site instead. One parked history entry, re-armed whenever
   * anything dismissible is showing. */
  let guardArmed = false, selfPop = false;
  function syncBackGuard() {
    const needed = !!topModal();
    if (needed && !guardArmed) {
      window.history.pushState({ dzcGuard: 1 }, '');
      guardArmed = true;
    } else if (!needed && guardArmed) {
      selfPop = true;
      window.history.back();
    }
  }
  window.addEventListener('popstate', () => {
    if (selfPop) { selfPop = false; guardArmed = false; return; }
    const top = topModal();
    if (top) {
      guardArmed = false;
      top.classList.remove('active');
      syncBackGuard();
    }
  });
  // Dialogs opened by ad-hoc handlers do not have to wire the guard themselves.
  document.addEventListener('click', () => queueMicrotask(syncBackGuard));
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const top = topModal();
    if (top) { top.classList.remove('active'); syncBackGuard(); }
  });

  // ------------------------------------------------------------------ theme

  function applyTheme(theme) {
    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
  }
  function setTheme(theme) {
    settings.theme = theme;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* quota */ }
    applyTheme(theme);
    if ($('modal-settings').classList.contains('active')) openSettings();
  }
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      if (s && typeof s === 'object') settings = Object.assign(settings, s);
    } catch (e) { /* defaults */ }
  }

  // ---------------------------------------------------------------- routing

  const VIEWS = ['view-landing', 'view-armies', 'view-army', 'view-units', 'view-play', 'view-collection'];

  function show(id) {
    VIEWS.forEach(v => { const el = $(v); if (el) el.classList.add('hidden'); });
    const el = $(id);
    if (el) el.classList.remove('hidden');
  }

  function navigate(view, param) {
    location.hash = '#' + view + (param ? '/' + param : '');
  }

  function showView(view, param) {
    // Privacy-friendly analytics: the SPA never reloads, so each view is
    // counted as a virtual pageview or the app would register one visit ever.
    if (window.goatcounter && window.goatcounter.count) {
      window.goatcounter.count({ path: '/' + (view || 'landing'), title: view || 'landing', event: false });
    }
    document.body.dataset.view = view || 'landing';
    const ctx = $('topbar-context');
    const back = (to, label) =>
      `<a href="#${to}" class="topbar-back" onclick="App.navigate('${to}'); return false;" aria-label="Back">`
      + `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2L4 8l6 6"/></svg></a> ${label}`;

    switch (view) {
      case 'armies':
        show('view-armies');
        ctx.innerHTML = back('landing', 'Your Armies');
        if (window.DZCBuilder) DZCBuilder.renderList();
        break;
      case 'army':
        show('view-army');
        ctx.innerHTML = back('armies', 'Army Builder');
        if (window.DZCBuilder) DZCBuilder.renderBuilder(param);
        break;
      case 'play':
        show('view-play');
        ctx.innerHTML = back('army/' + param, 'Play Mode')
          + ` <button class="btn btn-ghost btn-sm" type="button" onclick="DZCPlay.reset()">Reset game</button>`;
        if (window.DZCPlay) DZCPlay.open(param);
        break;
      case 'collection':
        show('view-collection');
        ctx.innerHTML = back('landing', 'Collection');
        if (window.DZCCollection) DZCCollection.open();
        break;
      case 'units':
        show('view-units');
        ctx.innerHTML = back('landing', 'Unit Reference');
        if (window.DZCUnits) DZCUnits.open();
        break;
      // A shared army arrives whole in the URL: import it, then land on it.
      case 'share':
        show('view-armies');
        ctx.innerHTML = back('landing', 'Shared Army');
        if (window.DZCShare && param) {
          DZCShare.importFrom(param)
            .then(a => navigate('army', a.id))
            .catch(e => {
              $('view-armies').innerHTML =
                `<div class="dzc-wrap"><p class="dzc-empty">That share link could not be read.<br>${esc(e.message)}</p></div>`;
            });
        }
        break;
      default:
        show('view-landing');
        ctx.textContent = 'Army Builder';
    }
  }

  function route() {
    const hash = location.hash.slice(1) || 'landing';
    const i = hash.indexOf('/');
    showView(i === -1 ? hash : hash.slice(0, i), i === -1 ? null : hash.slice(i + 1));
  }

  // --------------------------------------------------------------- settings

  /* A setting is a name and a switch. The explanation lives in the tooltip,
   * not in a sentence under the control — same as the Dropfleet builder, where
   * no toggle carries a caption. */
  function tog(key, name, desc) {
    return `<label class="dzc-set-toggle" title="${esc(desc)}">
      <span>${esc(name)}</span>
      <input type="checkbox" ${settings[key] ? 'checked' : ''}
             onchange="App.toggleSetting('${key}', this.checked)">
    </label>`;
  }

  function toggleSetting(key, on) {
    settings[key] = !!on;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* quota */ }
    applyCollectionSetting();
    // Collection changes what the builder shows, so redraw it if it is open.
    if (window.DZCBuilder && DZCBuilder.refresh) DZCBuilder.refresh();
  }

  /* Collection is off until asked for, so its landing card stays hidden and
   * the builder does not report a shortfall against a collection you never
   * said you had. */
  function collectionOn() { return !!settings.showCollection; }

  function applyCollectionSetting() {
    const card = $('landing-collection');
    if (card) card.classList.toggle('hidden', !collectionOn());
  }

  function openSettings() {
    const dark = settings.theme === 'dark';
    $('settings-body').innerHTML = `
      <div class="dzc-set-group">
        <div class="dzc-set-title">Appearance</div>
        <div class="dzc-set-row">
          <span>Theme</span>
          <div class="dzc-seg">
            <button type="button" class="${dark ? '' : 'is-on'}" onclick="App.setTheme('light')">Light</button>
            <button type="button" class="${dark ? 'is-on' : ''}" onclick="App.setTheme('dark')">Dark</button>
          </div>
        </div>
      </div>
      <div class="dzc-set-group">
        <div class="dzc-set-title">Builder</div>
        ${tog('showCollection', 'Collection',
          'Show what a list still needs, using counts from the Collection page')}
      </div>
      <div class="dzc-set-group">
        <div class="dzc-set-title">Offline use</div>
        <div id="offline-panel"></div>
      </div>
      <div class="dzc-set-group">
        <div class="dzc-set-title">Sync</div>
        <p class="dzc-set-note">${window.FleetSync && FleetSync.enabled()
          ? 'Syncing is on for this device.'
          : 'Keep the same armies on your phone and your computer.'}</p>
        <button class="btn btn-outline btn-sm" type="button" onclick="App.openSyncModal()">Sync armies online</button>
      </div>
      <div class="dzc-set-group">
        <div class="dzc-set-actions">
          <button class="btn btn-ghost btn-sm" type="button" onclick="App.exportArmies()"
                  title="Download every army as one JSON file">Export a backup</button>
          <button class="btn btn-ghost btn-sm" type="button" onclick="App.openImport()"
                  title="Read a backup, an army or a share link back in">Import</button>
          <button class="btn btn-ghost btn-sm" type="button" onclick="App.openChangelog()">What's New</button>
          <a class="btn btn-ghost btn-sm" href="mailto:warlore1@outlook.com?subject=Dropzone%20builder%20feedback">Send feedback</a>
        </div>
        <p class="dzc-set-note">A WarLore project. Game data and art belong to TTCombat.
          Interface icons from <a href="https://fonts.google.com/icons" target="_blank" rel="noopener">Material Symbols</a>,
          used under the Apache License 2.0.</p>
      </div>`;
    openModal('modal-settings');
    renderOfflinePanel();
  }

  /* Every army, as one JSON file you keep.
   *
   * Armies live in localStorage, which a browser is free to clear and a
   * "clear site data" click will. Sync copies them between your own devices
   * but is still not a backup — it propagates a deletion just as happily.
   * This is the copy that survives both.
   *
   * The exact stored shape, unmodified, so it can be pasted straight back. No
   * schema of its own: a backup format that is not the storage format is a
   * second thing to keep in step. */
  function exportArmies() {
    const armies = (window.DZCArmy && DZCArmy.all()) || [];
    if (!armies.length) return { ok: false, reason: 'No armies to export.' };
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `dropzone-armies-${stamp}.json`;
    const blob = new Blob([JSON.stringify(armies, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { ok: true, count: armies.length, name: name };
  }

  /* The other half of Export.
   *
   * A backup you cannot restore is not a backup, and armies live in
   * localStorage, which a browser is free to clear. Everything the app can
   * hand you goes back in through one door: a whole backup, one army, or a
   * share link — because having to know which kind of thing you are holding is
   * a question the app can answer for you.
   *
   * Nothing is overwritten. Every id is reissued on the way in (DZCArmy.
   * importArmies), so importing the same file twice adds it twice rather than
   * quietly replacing what you have. An import may never cost you an army. */
  function openImport() {
    $('import-body').innerHTML = `
      <div class="form-group float-field">
        <textarea class="form-input dzc-import-text" id="dzc-import-text" rows="6"
                  placeholder=" " spellcheck="false"></textarea>
        <label class="float-label" for="dzc-import-text">Backup, army or share link</label>
      </div>
      <div class="dzc-set-actions">
        <label class="btn btn-outline btn-sm">Choose a file
          <input type="file" accept=".json,application/json,text/plain" hidden
                 onchange="App.importFile(this)"></label>
        <button class="btn btn-primary btn-sm" type="button" onclick="App.runImport()">Import</button>
      </div>
      <div id="dzc-import-report"></div>`;
    openModal('modal-import');
  }

  function importFile(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      const box = $('dzc-import-text');
      if (box) box.value = String(r.result || '');
      runImport();
    };
    r.readAsText(file);
    input.value = '';        // so choosing the same file twice fires again
  }

  /* What resolved and what did not, in the modal rather than a toast: a toast
   * that says "2 armies, 1 skipped" is gone before you can read which. */
  function report(html) {
    const el = $('dzc-import-report');
    if (el) el.innerHTML = html;
  }

  async function runImport() {
    const text = (($('dzc-import-text') || {}).value || '').trim();
    if (!text) return;

    // A share link is the same army by a different road, so it is accepted
    // here rather than being a thing you have to know to paste in the URL bar.
    const share = text.match(/#share\/([A-Za-z0-9_-]+)/) || (/^[zu][A-Za-z0-9_-]{20,}$/.test(text) ? [null, text] : null);
    if (share) {
      try {
        const army = await window.DZCShare.importFrom(share[1]);
        report(`<p class="dzc-set-note">Imported <b>${esc(army.name)}</b>.</p>`);
        if (window.DZCBuilder) DZCBuilder.renderList();
        return;
      } catch (e) {
        report('<p class="dzc-set-note">That share link will not open.</p>');
        return;
      }
    }

    // Load whatever factions the file names first, or nothing can tell a unit
    // id the data no longer has from one it simply has not fetched yet.
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) { /* importArmies says so */ }
    const facs = [...new Set((Array.isArray(parsed) ? parsed : [parsed])
      .map(a => a && a.faction).filter(f => typeof f === 'string'))];
    for (const f of facs) {
      try { await window.DZC.loadFaction(f); } catch (e) { /* offline: the check is skipped, not the import */ }
    }

    const r = window.DZCArmy.importArmies(text);
    if (!r.ok && r.reason) { report(`<p class="dzc-set-note">${esc(r.reason)}</p>`); return; }

    const lines = r.added.map(a => `<li>${esc(a.name)}${a.unknown.length
      ? ` — ${a.unknown.length} unit${a.unknown.length === 1 ? '' : 's'} this data does not have: ${esc(a.unknown.join(', '))}`
      : ''}</li>`)
      .concat(r.skipped.map(s => `<li>Entry ${s.at} skipped — ${esc(s.reason)}</li>`));
    report(`<p class="dzc-set-note"><b>${r.added.length}</b> ${r.added.length === 1 ? 'army' : 'armies'} imported.</p>
      ${lines.length ? `<ul class="dzc-import-list">${lines.join('')}</ul>` : ''}`);
    if (window.DZCBuilder) DZCBuilder.renderList();
  }

  // ----------------------------------------------------------------- offline

  async function renderOfflinePanel() {
    const el = $('offline-panel');
    if (!el || !window.OfflineSync) return;
    if (!OfflineSync.supported) {
      el.innerHTML = '<p class="dzc-set-note">This browser cannot store an offline copy.</p>';
      return;
    }
    const st = await OfflineSync.status();
    if (OfflineSync.isRunning()) {
      el.innerHTML = '<p class="dzc-set-note">Downloading…</p>';
      return;
    }
    el.innerHTML = st && st.files
      ? `<p class="dzc-set-note">Downloaded ${st.files} files (${OfflineSync.formatBytes(st.bytes)})
           ${st.when ? ', ' + OfflineSync.formatWhen(st.when) : ''}.</p>
         <div class="dzc-set-actions">
           <button class="btn btn-outline btn-sm" type="button" onclick="App.runOfflineSync()">Update</button>
           <button class="btn btn-ghost btn-sm" type="button" onclick="App.deleteOfflineData()">Remove</button>
         </div>`
      : `<div class="dzc-set-actions">
           <button class="btn btn-outline btn-sm" type="button" onclick="App.runOfflineSync()">Download for offline use</button>
         </div>`;
  }

  async function runOfflineSync() {
    const el = $('offline-panel');
    if (el) el.innerHTML = '<p class="dzc-set-note">Downloading…</p>';
    try { await OfflineSync.sync(); } catch (e) { /* reported below */ }
    renderOfflinePanel();
  }

  async function deleteOfflineData() {
    try { await OfflineSync.remove(); } catch (e) { /* nothing to remove */ }
    renderOfflinePanel();
  }

  // -------------------------------------------------------------------- sync

  function openSyncModal() {
    const body = $('sync-body');
    if (!window.FleetSync || !FleetSync.supported()) {
      body.innerHTML = '<p>This browser cannot sync.</p>';
      openModal('modal-sync');
      return;
    }
    const on = FleetSync.enabled();
    body.innerHTML = on
      ? `<p>Syncing is on. Your Sync Token is the whole credential — anyone with it
           can read and edit your armies, so share it only with your own devices.</p>
         <p class="dzc-token">${esc(FleetSync.token())}</p>
         <div class="dzc-set-actions">
           <button class="btn btn-outline btn-sm" type="button" onclick="App.syncNow()">Sync now</button>
           <button class="btn btn-ghost btn-sm" type="button" onclick="App.syncStop()">Turn off</button>
         </div>`
      : `<p>Opting in mints a six-word Sync Token. Enter it on another device to
           combine both army lists. There is no account and no password: the token
           IS the credential.</p>
         <div class="dzc-set-actions">
           <button class="btn btn-primary btn-sm" type="button" onclick="App.syncStart()">Turn on sync</button>
         </div>
         <label class="dzc-field" style="margin-top:14px"><span>Or enter an existing token</span>
           <input id="sync-token-input" type="text" placeholder="six words"></label>
         <button class="btn btn-outline btn-sm" type="button" onclick="App.syncJoin()">Join</button>`;
    openModal('modal-sync');
  }

  async function syncStart() { await FleetSync.start(); openSyncModal(); }
  async function syncStop() { FleetSync.stop(); openSyncModal(); }
  async function syncNow() {
    await FleetSync.sync();
    openSyncModal();
    if (window.DZCBuilder && document.body.dataset.view === 'armies') DZCBuilder.renderList();
  }
  async function syncJoin() {
    const v = ($('sync-token-input') || {}).value || '';
    if (!FleetSync.looksLikeToken(v)) { alert('That does not look like a six-word token.'); return; }
    await FleetSync.join(FleetSync.normaliseToken(v));
    openSyncModal();
  }

  // ------------------------------------------------------------- changelog

  /* What's New. Same shape as the Dropfleet builder's log — {date, title,
   * items}, newest first, written for someone using the app rather than
   * reading the commits. No interpunct between date and title: the footer
   * already spends the app's budget for that glyph. */
  const CHANGELOG = [
    { date: '2026-08-01', title: 'Rules say what they mean, and the Albatross is reachable', items: [
      'A rule reads back the number your card printed. "Aegis 6”" says "within 6” of this Unit" instead of "within X”", and it works for words as well as numbers, so "Ineffective: Zones" names Zones. Substituting the value also exposed three keywords the app had been reading wrongly — "Pen 6+" was resolving to Passive Countermeasures, which meant every weapon with Penetrator showed the wrong rule.',
      'Every rule now says which page of the rulebook it is on, in the tooltip and on the printed sheet, so the book falls open in the right place mid-game.',
      'You can build an Albatross. A Transport Squad is a Squad, so it can be carried too — you give an Albatross to a Bear APC exactly as you gave the Bear to the Legionnaires. The rules always allowed it and the builder was refusing.',
      'The picker prices the Squad rather than one model: 70pts over "2 × 35". A third of the list has a minimum above one model, so a third of the list had been quietly halving its own price.',
      'Category tabs say how many units are behind them, and a tab or a filter only appears if it can match something. That adds a filter for units with a paid weapon upgrade — 18 in the whole game — and removes Unique, which could never match anything, because no Unique Unit has been published.',
      'Search reaches further: category and type, the rules on a weapon rather than only on the Unit, and glossary aliases — so "evasion" finds a Unit whose card only ever prints "Ev1".',
      'A control that refuses you says why. The model stepper used to go dead under your finger with nothing on screen; it now quotes the squad size that stopped it. An empty list names which of your choices emptied it.',
      'Renaming an army or a Group looks renameable, and Enter commits while Escape puts it back. Escape used to do nothing, so once you started typing there was no way to change your mind.',
    ]},
    { date: '2026-07-31', title: 'A Squad reads like the Unit it is', items: [
      'A Squad in your army now shows what the unit page shows: the art, the capacity symbol beside the name, every stat, the rules, a block per variant with its own price, and the whole weapon table with arcs and Move & Attack. The numbers you argue over across a table are on the page instead of behind a modal.',
      'Choosing a Transport is a chooser, not a dropdown. Every option shows what it offers, how many the cargo needs, what it costs, and whether the fit comes out exact. A part-empty fit is offered and marked rather than refused, because one more model fixes it.',
      'The weapon table scrolls inside its own box, so a phone gets every column rather than a squeezed version, and the nesting indent tightens as the screen narrows instead of the tree being flattened.',
    ]},
    { date: '2026-07-31', title: 'Add Squad, and the transport symbols', items: [
      'Add Squad is the widest thing in a Group card now, in your faction\'s colour, and adding closes the picker and puts you back on your army.',
      'The transport symbols are on the picker card. Which shape a unit fills and which it offers is what decides whether two things can share a Group (3.2.4.2), so it should not be the fact you have to open the unit to find.',
      'Capacity has its own band in the Group header, the shape drawn large with the count beside it, instead of one more small grey pill in a row of them.',
    ]},
    { date: '2026-07-31', title: 'The picker holds still', items: [
      'Sorting or filtering used to rebuild the whole bar and throw you back to the top of the list. Nothing moves now, and the list keeps its place across a re-sort.',
      'Filter by transport symbol. The six shapes are the whole grammar of what fits with what, drawn as the stat cards print them, and a shape matches whether a unit offers it or fills it.',
      'The Group header meters itself: points against the quarter-army ceiling, Squads, models, and for every Transport how much of each shape it has used against what it offers. Green when full, red when overloaded.',
      'Add Group leaves you an empty Group rather than opening the picker on you.',
    ]},
    { date: '2026-07-31', title: 'Sort, filter and search the picker', items: [
      'Sort by Price, Name, Category, Squad or Capacity, each reversible. Filters for Rare, Unique, Variants, Carries and Auxiliary. Search covers names, variants, weapons and rules. A list view sits beside the card grid for scanning rather than comparing.',
      'A Group that does not yet make sense is reported when you stop building, not blocked while you build. A lone Transport is unfinished, not illegal — you are probably about to fill it. A second Rare Squad is still refused, because nothing you add later puts it right.',
      'The active filter pill was painting white on white, and typing in the search box replaced the box under your caret. Both fixed.',
    ]},
    { date: '2026-07-31', title: 'Groups form by transport', items: [
      'Rulebook 3.2.4: a Transport may only be chosen alongside a Squad it can carry, and those two form one Group, and up to four Squads plus their own Transport Squads may share one larger Transport. Nothing else puts a second Squad in a Group, so Add Squad no longer offers all 178 units. An empty Group takes any fighting Unit; after that, only a Transport for something already there, or a Squad that fits inside a Transport already there. Everything else greys out quoting the rule that refuses it.',
      'Transports are in the picker rather than hidden behind a dropdown. Picking one builds the Transport Squad, links it, and works out how many models it takes to fill.',
      'With Infantry in the Group the picker offers Troopships and refuses Dropships, because a Transport may only carry matching shapes (3.2.4.2).',
    ]},
    { date: '2026-07-31', title: 'Play Mode, Collection and share links', items: [
      'Play Mode tracks a Round the way chapter 4 defines it: CP replenishing up to your highest Commander Level, Pass tokens from having fewer Groups than your opponent, Initiative as D6 + Level, and damage per model.',
      'Collection counts models, not Squads, and stays advisory. Owning too few is a shopping list, not a rules violation, so it never blocks a legal choice.',
      'Share links carry the whole army in the URL. There is no server, so a shared list cannot rot.',
      'Two data faults found by chasing an odd firing arc: every paid weapon upgrade was costing nothing, and eight weapons had arcs made out of footnote text.',
    ]},
    { date: '2026-07-30', title: 'The army builder', items: [
      'Groups, Squads and per-model variants, with transport nesting drawn as a tree — a Bear APC with its Legionnaires indented beneath it, because that is the deployment plan.',
      'Illegal choices are unreachable rather than flagged after you have made them.',
      'The print sheet keeps the nesting and appends the verbatim text of every rule your list uses. Groups never split across a page and no rule breaks mid-sentence.',
      'All 178 units are readable on their own, with a 106-rule glossary taken from the rulebook and the faction front matter.',
    ]},
  ];

  function openChangelog() {
    $('changelog-body').innerHTML = CHANGELOG.map(e => `
      <div class="changelog-entry">
        <div class="changelog-date">${esc(e.date)} &mdash; <span class="changelog-title">${esc(e.title)}</span></div>
        <ul class="changelog-list">${e.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
      </div>`).join('');
    openModal('modal-changelog');
  }

  // ------------------------------------------------------------------- init

  function init() {
    loadSettings();
    applyTheme(settings.theme);
    applyCollectionSetting();
    if (window.OfflineSync) OfflineSync.init(() => renderOfflinePanel());
    if (window.FleetSync) {
      FleetSync.onChange = () => {
        if (window.DZCBuilder && document.body.dataset.view === 'armies') DZCBuilder.renderList();
      };
      // Sync on the events that actually happen rather than on a timer: coming
      // back to the app, refocusing the tab, and signal returning. A poll would
      // spend the free tier's quota doing nothing and keep a phone's radio
      // awake at a table.
      ['visibilitychange', 'focus', 'online'].forEach(ev =>
        window.addEventListener(ev, () => FleetSync.maybeAutoSync()));
    }
    window.addEventListener('hashchange', route);
    route();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return {
    navigate, showView, openModal, closeModal,
    openSettings, setTheme, toggleSetting, collectionOn, applyCollectionSetting,
    renderOfflinePanel, runOfflineSync, deleteOfflineData,
    openSyncModal, syncStart, syncStop, syncNow, syncJoin,
    openChangelog, openImport, importFile, runImport,
    /* Says how many it wrote. A download that produces no visible file and no
       message is indistinguishable from a button that does nothing. */
    exportArmies: () => {
      const r = exportArmies();
      if (window.DZCBuilder && DZCBuilder.say) {
        DZCBuilder.say(r.ok ? `${r.count} ${r.count === 1 ? 'army' : 'armies'} saved to ${r.name}`
                            : r.reason);
      }
      return r;
    }
  };
})();
window.App = App;
