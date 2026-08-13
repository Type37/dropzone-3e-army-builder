/* App shell. Routing, modals, settings, theme, offline and sync.
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
  /* Dropzone's OWN toggles live under their own key, never the shared one.
   * Dropfleet keeps a field called showCollection in dfc_settings too, a
   * different setting entirely, its own ships against its own Collection tab,
   * and merging the whole shared object (Object.assign(settings, s), as
   * this used to) pulled Dropfleet's value straight into Dropzone's builder.
   * Turning Collection on in one app silently turned it on in the other.
   * Jet, 2026-08-09: "the collection should be off by default" -- it was, in
   * Dropzone's own code; it was Dropfleet's flag showing through. */
  const DZC_KEY = 'dzc_builder_settings';
  let settings = { theme: 'light' };

  /* WHICH BUILD THIS IS.
   *
   * The same number sw.js names its cache with, which is bumped on every
   * deploy. Kept in step by a test rather than by remembering, because two
   * numbers that must match and are edited in different files will not.
   *
   * It exists because of the 2026-08-09 thread. Mitch Novem: "can anyone else
   * not create squads of multiple units in the army builder? almost all my
   * squads are locked to units of 1... like I cant make units of 2 ares in the
   * app." Baxter tried it, it worked, screenshotted it. Then Mitch: "alright,
   * that didnt work on my end before", "okay now i feel crazy cause it works".
   * Baxter's guess: "Might have needed a refresh with jet updating stuff."
   *
   * Probably right, and unprovable either way, which is the problem. A live
   * tab is already running current code -- the worker fetches html, js, css
   * and json with cache:'no-store' while online -- so this is not a prompt to
   * reload. It is the build NUMBER, so a report can say which one it came from
   * and "that was fixed in 419" becomes an answer instead of a guess.
   *
   * It used to say the tab "self-updates within the minute (index.html polls
   * and reloads on controllerchange)". That reload is gone as of 2026-08-13:
   * on Firefox for iOS it fired every poll and threw the user out of the army
   * they were building, once a minute. See the note in index.html. */
  const BUILD = 451;

  /* Feedback goes to the maker's inbox through the reader's own mail app. The
   * body is prefilled with the four questions, because a bare mailto returns
   * "looks cool" and a guided one returns something you can act on.
   *
   * The questions are Dropfleet's, word for word (FEEDBACK_HREF, git show
   * 43773fa:js/app.js:16) with the game swapped -- this is exactly the copy
   * CLAUDE.md §2 says not to rewrite. The build number on the end is not
   * Dropfleet's and is not copy: it is the one answer nobody can give. */
  const FEEDBACK_HREF = 'mailto:warlore1@outlook.com?subject='
    + encodeURIComponent('Dropzone Builder feedback') + '&body='
    + encodeURIComponent(
      'Thanks for helping improve the Dropzone Commander 3E Army Builder.\n\n'
      + '1. What were you trying to do, and could you finish it?\n\n'
      + '2. Did anything look wrong (a points cost, a stat, a rule)?\n\n'
      + '3. What would make you use it for your next game?\n\n'
      + '4. How long have you played DZC?\n\n'
      // Last, and already filled in: it is the one answer nobody can give and
      // the first one needed to reproduce anything.
      + `Build ${BUILD}\n`
    );

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
    // Theme alone goes in the shared key -- that sharing is the point of it.
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme })); } catch (e) { /* quota */ }
    applyTheme(theme);
    if ($('modal-settings').classList.contains('active')) openSettings();
  }
  function loadSettings() {
    try {
      const shared = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      if (shared && typeof shared === 'object' && shared.theme) settings.theme = shared.theme;
    } catch (e) { /* defaults */ }
    try {
      const own = JSON.parse(localStorage.getItem(DZC_KEY) || '{}');
      if (own && typeof own === 'object') settings = Object.assign(settings, own);
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
    /* Cleared on every route. The builder fills it with Play, Share and Print
     * on each render, so leaving it alone would carry an army's buttons onto
     * the screen after it -- and they would still be wired to that army. */
    const actions = $('topbar-actions');
    if (actions) actions.innerHTML = '';
    const back = (to, label) =>
      `<a href="#${to}" class="topbar-back" onclick="App.navigate('${to}'); return false;" aria-label="Back">`
      + `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2L4 8l6 6"/></svg></a>`
      // The label is its own element so a phone can drop it and keep the
      // chevron. The chevron is the only way back from a view; the label is
      // the name of the screen you would be going to.
      + ` <span class="topbar-back-label">${label}</span>`;

    switch (view) {
      case 'armies':
        show('view-armies');
        ctx.innerHTML = back('landing', 'Armies');
        if (window.DZCBuilder) DZCBuilder.renderList();
        break;
      case 'army': {
        show('view-army');
        /* The army's name goes in the topbar as the last crumb. Jet,
         * 2026-08-07: "the army title should go in the header. Like a
         * breadcrumb." It was an h1 at the top of the page, which is a whole
         * line of chrome saying what you already know you are looking at --
         * and the topbar was carrying "Armies list" with nothing after it, so
         * the trail stopped one step short of where you actually were. */
        const named = window.DZCArmy && (window.DZCArmy.get(param) || {}).name;
        ctx.innerHTML = back('armies', 'Armies list')
          + (named ? ` <span class="topbar-crumb" aria-current="page">${
              String(named).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;',
                '>': '&gt;', '"': '&quot;' }[c]))}</span>` : '');
        if (window.DZCBuilder) DZCBuilder.renderBuilder(param);
        break;
      }
      case 'play':
        show('view-play');
        ctx.innerHTML = back('army/' + param, 'Play Mode')
          // btn-ghost-light, not btn-ghost: this sits on the navy topbar, and
          // btn-ghost's grey is picked for the paper background. It came out
          // washed out enough to read as a control you cannot press.
          + ` <button class="btn btn-ghost-light btn-sm" type="button" onclick="DZCPlay.reset()">Reset game</button>`;
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
        /* Blank on the landing screen. Dropfleet writes "Fleet Builder" here
         * and it is the third "Army Builder" on ours. The tile below says it
         * and the footer says it again, which is the rule about no phrase more
         * than twice. The wordmark is directly to the left; naming the app
         * beside its own logo was never telling anyone anything. */
        ctx.textContent = '';
    }
  }

  function route() {
    const hash = location.hash.slice(1) || 'landing';
    const i = hash.indexOf('/');
    showView(i === -1 ? hash : hash.slice(0, i), i === -1 ? null : hash.slice(i + 1));
  }

  // --------------------------------------------------------------- settings

  /* A setting is a name and a switch. The explanation lives in the tooltip,
   * not in a sentence under the control. Same as the Dropfleet builder, where
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
    // Every toggle in this panel is Dropzone's own (theme is the only field
    // Dropfleet shares, and it goes through setTheme instead) -- so this
    // writes DZC_KEY only, never the key Dropfleet also reads.
    const { theme, ...own } = settings;
    try { localStorage.setItem(DZC_KEY, JSON.stringify(own)); } catch (e) { /* quota */ }
    applyCollectionSetting();
    // Collection changes what the builder shows, so redraw it if it is open.
    if (window.DZCBuilder && DZCBuilder.refresh) DZCBuilder.refresh();
  }

  /* Collection is off until asked for, so its landing card stays hidden and
   * the builder does not report a shortfall against a collection you never
   * said you had. */
  function collectionOn() { return !!settings.showCollection; }

  // Off unless asked for, like every other builder setting: the default is the
  // whole Unit, and this is the way out of it for someone scanning a long list.
  function compactView() { return !!settings.compactView; }

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
        <!-- Dropfleet's compactView, with the noun that has no DZC analogue
             dropped: "Hide weapon tables and launch assets in the fleet
             builder for a denser overview" (app.js:8043). It is what makes
             showing the whole Unit by default safe -- a Squad in the builder
             reads as its stat card, which is right when you are deciding and
             long when you are scanning ten of them. -->
        ${tog('compactView', 'Compact view',
          'Hide weapon tables in the builder for a denser overview')}
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
          <button class="btn btn-ghost btn-sm" type="button" onclick="App.openChangelog()">What's new</button>
          <a class="btn btn-ghost btn-sm" href="${FEEDBACK_HREF}">Send feedback</a>
        </div>
        <p class="dzc-set-note">Build ${BUILD}. A WarLore project. Game data and art belong to TTCombat.
          Interface icons from <a href="https://fonts.google.com/icons" target="_blank" rel="noopener">Material Symbols</a>
          under the Apache License 2.0, and from
          <a href="https://phosphoricons.com" target="_blank" rel="noopener">Phosphor</a>
          under the MIT licence.</p>
      </div>`;
    openModal('modal-settings');
    renderOfflinePanel();
  }

  /* Every army, as one JSON file you keep.
   *
   * Armies live in localStorage, which a browser is free to clear and a
   * "clear site data" click will. Sync copies them between your own devices
   * but is still not a backup. It propagates a deletion just as happily.
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
   * share link. Because having to know which kind of thing you are holding is
   * a question the app can answer for you.
   *
   * Nothing is overwritten. Every id is reissued on the way in (DZCArmy.
   * importArmies), so importing the same file twice adds it twice rather than
   * quietly replacing what you have. An import may never cost you an army. */
  function openImport() {
    $('import-body').innerHTML = `
      <div class="form-group float-field float-field--area">
        <textarea class="form-input dzc-import-text" id="dzc-import-text" rows="6"
                  placeholder=" " spellcheck="false"></textarea>
        <label class="float-label" for="dzc-import-text">Backup, army, share link or a pasted list</label>
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

    // Not JSON at all: a pasted army list. Every faction has to be on hand
    // first, because which one the list belongs to is decided by which roster
    // its unit names are in. A header can say one thing over another
    // faction's units.
    if (parsed == null) {
      for (const f of ['ucm', 'phr', 'scourge', 'shaltari', 'resistance', 'bioficer']) {
        try { await window.DZC.loadFaction(f); } catch (e) { /* what loaded still votes */ }
      }
      const l = window.DZCArmy.importList(text);
      if (!l.ok) { report(`<p class="dzc-set-note">${esc(l.reason)}</p>`); return; }
      report(`<p class="dzc-set-note"><b>${esc(l.army.name)}</b>: ${l.matched.length}
          Squad${l.matched.length === 1 ? '' : 's'}, each in a Group of its own.
          A list does not say what rode in what, so the nesting is yours to rebuild (3.2.4).</p>
        ${l.unmatched.length ? `<ul class="dzc-import-list">${
          l.unmatched.map(u => `<li>Not matched: ${esc(u)}</li>`).join('')}</ul>` : ''}`);
      if (window.DZCBuilder) DZCBuilder.renderList();
      return;
    }

    const r = window.DZCArmy.importArmies(text);
    if (!r.ok && r.reason) { report(`<p class="dzc-set-note">${esc(r.reason)}</p>`); return; }

    const lines = r.added.map(a => `<li>${esc(a.name)}${a.unknown.length
      ? `, ${a.unknown.length} unit${a.unknown.length === 1 ? '' : 's'} this data does not have: ${esc(a.unknown.join(', '))}`
      : ''}</li>`)
      .concat(r.skipped.map(s => `<li>Entry ${s.at} skipped: ${esc(s.reason)}</li>`));
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
    /* Copy, twice over.
     *
     * Off: nothing. The Settings row that opens this already says what it is
     * for -- "Keep the same armies on your phone and your computer" -- and
     * three sentences explaining that a token is a credential is the explainer
     * pattern in its purest form, on a screen where the two controls are
     * "Turn on sync" and a box marked "Or enter an existing token".
     *
     * On: the state, and the one warning that earns its place. The token IS
     * the credential, it is on screen, and what someone else can do with it is
     * not deducible from looking at six words. */
    const on = FleetSync.enabled();
    const last = FleetSync.lastSync();
    const n = (window.DZCArmy && DZCArmy.all() || []).length;
    body.innerHTML = on
      ? `<p><b>Syncing is on for this device.</b>
           ${n} arm${n === 1 ? 'y' : 'ies'}, last synced ${
             last ? esc(new Date(last).toLocaleString()) : 'not yet'}.</p>
         <p class="dzc-token">${esc(FleetSync.token())}</p>
         <p class="dzc-set-note">Anyone with this phrase can read and change your armies.</p>
         <div class="dzc-set-actions">
           <button class="btn btn-outline btn-sm" type="button" onclick="App.syncNow()">Sync now</button>
           <button class="btn btn-ghost btn-sm" type="button" onclick="App.syncStop()">Turn off</button>
         </div>`
      : `<div class="dzc-set-actions">
           <button class="btn btn-primary btn-sm" type="button" onclick="App.syncStart()">Turn on sync</button>
         </div>
         <label class="dzc-field" style="margin-top:14px"><span>Or enter an existing token</span>
           <input id="sync-token-input" type="text" placeholder="six words"
                  autocapitalize="none" autocorrect="off" spellcheck="false"></label>
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

  /* What's New. Same shape as the Dropfleet builder's log: {date, title,
   * items}, newest first, written for someone using the app rather than
   * reading the commits. No interpunct between date and title: the footer
   * already spends the app's budget for that glyph. */
  const CHANGELOG = [
    { date: '2026-08-13', title: 'The app threw you out of your army once a minute on Firefox for iOS', items: [
      'Reported by a reader on an iPhone: "every 1-2 minutes it will almost refresh the whole thing, taking me out of the list, clearing and reloading to the list page." It was a loop the app built for itself. Every 60 seconds it asked whether a new version had been published; the answer arrived as a new worker that took over the page immediately, and taking over triggered a reload. On browsers that decide the file has not changed, nothing happened and nobody noticed. On Firefox for iOS the answer came back "new" nearly every time, so it reloaded once a minute, forever, out of whatever you were building.',
      'Nothing reloads the page any more. It was never needed to stay current — the app already fetches its own code and data fresh whenever you are online, so an open tab is running the live version regardless. The reload bought nothing and cost the army you were in the middle of.',
      'The version check itself stays, because it is what keeps the offline copy current, but every half hour instead of every minute. On a phone that check is a radio wake-up.'
    ] },
    { date: '2026-08-13', title: 'A three-page army list prints on two', items: [
      'The rules appendix is two columns, packed tight, and starts wherever the army finished instead of forcing a fresh sheet. That break bought the appendix a clean start and cost most of a page of white paper every time. Each keyword now runs into its own text as one paragraph rather than sitting on a line of its own — at this size a line per name was a third of the appendix spent on names.',
      'The army itself is still one column and that is not going to change: the Group nesting tree is tall and narrow, and splitting it puts a Condor at the foot of one column and the cargo it carries at the head of the next, which loses the one thing the sheet is for. A hundred short independent rules are the opposite shape, which is what columns are for.',
      'No box round a Group. The heading and the rule under it already say where one starts; a full border round each of nine Groups was nine rectangles of toner drawing what the whitespace draws for free. A Group still never splits across a page — that was never the border’s job.',
      'No line under every weapon. That was most of the 247 borders on a three-page sheet, drawing a grid the columns already line up without. The header keeps its rule, because that one separates two different kinds of row.',
      'Fifteen different type sizes became four. Nothing about the hierarchy changed; there were simply four or five sizes doing one job each and ten more that were an accident.',
      'Measured end to end on a nine-Group army: 4.02 A4 pages down to 2.80, and 16% of the paper under a filled background down to none.'
    ] },
    { date: '2026-08-13', title: 'Ctrl+P printed a blank page', items: [
      'Printing from anywhere except the app’s own Print button gave you one blank sheet. The rule that hands the printer the deployment sheet hides the entire app and prints a container the Print button is what fills — so Ctrl+P, the browser menu, File then Print, and every print-to-PDF extension hid the page and printed an empty box. It fills on any route to the printer now.',
      'And the app is only hidden when there is a sheet to put in its place. Ctrl+P on the Armies list or the Unit Reference used to hide that page too and print the same empty box; those print the page you are looking at.',
      'The four numbers a Commander’s Level buys were one run-on line — "CP per Round 5, hand 5 cards, Initiative D6 + 5 (4.1). 5 activations (4.2.1)" — four unrelated figures, three of them the same digit, with a rulebook citation wedged in the middle. Each has its own cell now: the number set large, what it is under it, when you use it under that. They are looked up one at a time in the middle of a Round.',
      'A measured sheet of a nine-Group army went from 4.0 pages to 3.3, and from 16% of the paper covered in a filled background to none. The stat cells were carrying the app’s own panel fill into print, which is a screen surface and on paper is just toner. Ink saver now takes the stat values black as well as their labels; the only colour it leaves is the digit on a cargo symbol, because that colour is which shape it is.'
    ] },
    { date: '2026-08-13', title: 'Fewer lines on the sheet, and it saves ink unless you say otherwise', items: [
      'Print opens with ink saver and compact both on. The sheet had just gained the app’s colour — accent headings, an accent carry line, outlined keyword chips — and defaulting a document whose whole job is to be printed to the expensive version has the trade backwards. Both toggles are on the preview and whatever you pick is remembered, so this is the first print only.',
      'A Squad was four lines: the name, then its capacity symbols, then how much RM it carried, then its stats. It is two. Capacity and RM sit on the name line where they belong, and the Squad’s own rules share the stat line rather than opening one.',
      'Stats print vertically — icon, number, what it is. Five stats laid on their side are five label-value pairs to read left to right; stacked they are five numbers on one baseline you take in at a glance. Each stack is narrow, so the block is still one line.',
      'A Squad no longer says whether it is Standard, Vanguard, Heavy or Support. That decides whether a list is legal, which is settled before the sheet is printed and never asked again, and it was riding on every Squad on the one document you read with a model in your hand.',
      'And nothing warns that Squads will begin Reserved. True of most Squads in most armies, and it is deployment restated rather than a fault in the list — the warning panel was opening with a line that reads the same every game.'
    ] },
    { date: '2026-08-13', title: 'The printed sheet looks like the app now', items: [
      'The sheet had every fact right and drew none of them the way the builder does. Stats printed as a run-on line — "Move 18” Armour 2 Damage Points 3" — with each value the same weight as its label and no way to read one Squad against the next down the page. They print in the builder’s own grid now: the icon over the number, the label under it, and only the stats the card actually carries, because a tank has no Bravery.',
      'A weapon’s arc was the letters "F/S", which is a code you have to already know. It is the glyph off the stat card, with the letters beside it. A weapon’s keywords were a comma list; they are the same chips the app draws, outlined rather than filled so a page of them is not a page of toner.',
      'Variants print their own photograph. 155 of them have one and the sheet only ever printed the unit’s, so a page of Wolverines showed the same buggy four times — which is the complaint that got variants their pictures to begin with. When every line in a Squad has its own, the general photo above them goes.',
      'The faction’s colour is on the sheet: the Group heading, and the line down the left of a carried Squad, which is the one rule on the page that means something rather than divides something. Ink saver takes all of it back to black — it means one ink, not one ink except where the pretty parts are.',
      'A Group says what carries it, and the army prints the notes you wrote on it. Both were on screen and neither was on the paper you hand across the table.',
      'None of this is a second set of markup for print. Every renderer is the screen’s. The sheet spent months printing "carries 2 square" in words because it had its own idea of what a capacity looked like, and that is what having two of them costs.'
    ] },
    { date: '2026-08-13', title: 'The carry line stops at the picture, and one toolbar has one left edge', items: [
      'The Add Units toolbar had five rows and four different left edges: the search field at 25px behind its magnifier, the category tabs at 0, the sort chips at 34 behind the word Sort, the shape chips at 28 behind the shorter word Fits, and the count back at 0. Nothing was wrong with any one row — each simply started wherever its own first child happened to end. There is one gutter now and everything that reads as content starts on it, with the two labels and the magnifier hanging in it. The bar is no wider; the gutter is carved out of the row rather than added to the edge.',
      'The carry line stopped 22px inside the picture it points at, drawn across the model. It ends at the edge of the box now. And it draws on: the drop grows down out of the carrier’s photograph, the arm follows it sideways into the cargo’s, so the link reads as one stroke turning a corner. Only a link you just made animates — opening an army you built yesterday draws nothing.',
      'Linked transport and Add Transports have swapped weight. Tying a Squad to what carries it is the commonest move in a Group and it was the quietest control on the row, a small grey chip in the same ink as Take out; meanwhile two solid accent bars sat side by side giving a Transport the same standing as the Squad it exists to carry. Linked transport takes the accent fill and the icon tile, one size down. Add Transports outlines. Neither gained emphasis — they traded it.',
      'A Group card in the list says what is carrying it, by name. The Transports were on the card already, leading the row of thumbnails, but a picture 26px wide is not a name and the text underneath said "2 Squads, 5 models" without once saying Condor. Which Transports a Group holds is what decides where the next Unit can go, which is why the space meters are on the card at all.',
      'The pictures are bigger, on the Squad and on every variant block — a fifth up on the desktop and proportionally on a phone. Two of them were wrong rather than small: at 640px and below the photograph carried its own fixed size instead of filling its box, and at 420px that was 96px of picture in a 46px box. It stood twice the height of the thing meant to bound it, hung 50px into the row underneath, and the carry line — which is measured off the box — pointed at 23px into a 96px image. Every Squad, on the narrowest phone, which is the device this app is for.'
    ] },
    { date: '2026-08-13', title: '57 more variants have their own photograph', items: [
      'A variant with its own miniature shows it; the rest fall back to the unit’s. That went from 98 of the 199 to 155. Nothing new was found in the previous edition’s cards — the same 275 photographs were there all along, and 177 of them were being read, captioned and thrown away because the matcher could not tell what it was holding.',
      'Half the variants in this edition are not named, they are lettered. Polecat A, Eagle B, Wolverine D, Juno A1. The previous edition never printed a letter, so a rule that the variant’s name must appear on the old card ruled out 94 of them before their weapons were ever looked at. The letter comes off first now, and the model name is what has to match, which is what the old card is captioned with.',
      'The weapons decide which photograph, and a plural was stopping them. “UM-88 Cannons” sits under a picture captioned “(Twin Cannon)”, and comparing whole words called that no evidence at all — so the Katana, the Slayer, the Jaguar, the Menchit and the Pizzaro all had a photograph naming them and got none. TTCombat’s own captions carry typos too, “Attila Trackwalkers” one line under “Atilla Trackwalkers”, and each one cost a picture.',
      'A variant this edition renamed can be found through its siblings. Our Tormentor is the acid-streamer Scourge Heavy Skimmer and the word Tormentor appears nowhere on the old cards; what does appear is “Slayer Heavy Tank (Acid Streamer)”, alongside the Slayer photograph its sibling claimed. The vehicle is identified by the sibling and the guns pick which of its photographs is which, so a keyword is never on its own — that was the fault behind the wrong pictures before, where a Wolverine buggy’s missile shot ended up on a Howitzer, an Eagle and a Harrier.',
      'Two photographs one variant’s guns cannot separate is still no photograph. The unit’s own picture beats a coin-flip, which is why 44 variants show nothing: the previous edition has no picture of a Styx, a Greave, a Tachi or a Falcon-A, and a wrong photograph is worse than a general one.'
    ] },
    { date: '2026-08-12', title: 'Two buttons about Transports, one word between them', items: [
      'A Squad’s own button said Transport and the Group’s said Add Transports, and on a phone both were on screen at once, in the same green, a row apart. Jet: “it’s confusing that there’s two add transport buttons.” They do different things — one ties this Squad to something that carries it, the other puts a Transport in the Group and links it to nothing — and the word they shared said neither.',
      'The Squad’s one is Linked transport now, and it carries a chain instead of a second lorry. The lorry is what a Transport is; this button is not a Transport, it is the tie between a Squad and one. The Group’s button is untouched: Add Transports has always said exactly what it does.',
      'The name is 38px wider than the word it replaced, which took the Squad’s four controls to 343px of a 314px row at 360 — and what wrapped was the last thing in it, the bin, alone on a line under 270px of nothing. That is the empty line the last build took off the Group header turning up on every Squad in the army instead. The cost and the bin travel as a pair now, so what breaks off is a pair, and a Transport’s own row — no stepper in it — still fits on one line at 320.'
    ] },
    { date: '2026-08-12', title: 'Add Transports opened on the ones that do not fit', items: [
      'With Legionnaires in a Group, all eight UCM Transports were offered in price order. That put the Condor second and the Crow third, and neither of them can take a square — the three that can, the Bear APC, the Raven Light Troopship and the Vulture Troopship, were first, sixth and eighth. They are the first three now, and the same holds for a Group of tanks, which gets the triangles.',
      'Ordering, not filtering. 3.2.4 lets a Transport into a Group for a Squad that is not in it yet, so nothing has been taken out of the list — the rest are underneath, in whatever the sort says. A Group whose every Squad is already aboard something has nothing to sort for and is left exactly as it was.'
    ] },
    { date: '2026-08-12', title: 'The picker’s toolbar was seven rows of chips', items: [
      'Measured at 390 by 844 with Sort and filter open: 369px of toolbar over seven rows, and the first unit card 383px down. It is 234px over five now, and 118px over two the way it opens. Every chip went from 44px tall to 36 — a category tab, a sort, a filter and a Fits shape are a strip you read across, not the thing you press to do something, and Add, Clear and the two toolbar buttons are all still 44.',
      'Two of the rows were nobody’s. Sort, the filters and Fits had a line each, which left the Fits line two thirds empty; they are one wrapping flow now, so seventeen chips and their two labels pack onto three rows instead of four. And the two buttons on the tab line moved up beside the search field, which gives the tabs a line of their own — all five of a faction’s fit it, 332px of chips against 348 of column.',
      'Below 390 the old layout is kept, because the sum stops working: at 360 those two buttons would leave the search field 238px to set a 242px placeholder in, and the tabs want 348px of a 320px column anyway, so the top of the toolbar is three lines there whatever happens on the first one. Measured at 320, 360, 375, 390, 412 and 430 — every one of them is shorter than it was, 417 down to 314 at the narrowest and 369 down to 234 at 390.'
    ] },
    { date: '2026-08-12', title: 'A Group’s buttons had a whole empty line to themselves', items: [
      'On a phone the duplicate and remove buttons sat alone on a second line, thrown to the far right with 246px of nothing beside them. The name and the three numbers came to 307px of the 344 available, which left 37px for two 44px squares, so the pair wrapped — and being pinned right is what turned a wrap into a band of dead space.',
      'Self-inflicted and recent: those buttons were 24px until the touch-target pass took every icon button to 44, which is the size they should be and is also more than the line had spare. So the numbers take the second line now and the buttons stay up with the name they act on — title on the left, actions on the right, which is where the bin already sits on every Squad row underneath. Desktop has room for all of it on one line and is untouched, to the pixel.'
    ] },
    { date: '2026-08-12', title: 'One big vehicle was being carried by three small ones', items: [
      'A Ferrum Drone Base fills 18 and a Condor carries 6, and the Transport chooser was offering three Condors — one vehicle cut into three pieces. Nine Crows too. The number on a solid symbol is what ONE Unit fills, and a Transport “may not carry more than their number indicates” (3.2.4.2), so a Unit bigger than a Transport’s whole capacity cannot ride in it: not in two of them, not in nine. Only the Albatross, which carries 18, can take a Ferrum.',
      'It was not one card. Fifteen pairs across five factions were on offer that the rules forbid: a Type-4 Battle Scorpion at 6 was offered three Neptunes at 2 and two Njords at 4, a Grievance Genitor Ark at 4 was offered two Digits at 2, a Resistance Super Heavy Tank at 6 was offered two Carryhawks at 3, and every UCM tank at 3 was offered two Crows at 2. The check was on the symbol’s SHAPE and never on its number; the count was then the Squad’s total divided by the Transport’s capacity, which is the arithmetic that let a model be halved.',
      'Nothing legal moved. Every unit at every Squad size against every Transport it is offered — 740 pairings — was measured either side of the change: 27 disappear, all of them a model being split, and not one that remains changed its count or whether it is full. Three Sabres still exactly fill one Condor and six still fill two, which are the rulebook’s own worked examples. An army already saved with one of the forbidden pairings still opens and is now named illegal on the Group it is on, rather than being quietly repaired or quietly allowed.'
    ] },
    { date: '2026-08-12', title: 'The last two controls under 44px, found by measuring instead of reading', items: [
      'Buying a weapon upgrade was a 62 by 32 button pinned to a corner of the weapon card, and it is the only control on that card. And the opponent’s Group count in Play Mode was 56 by 25, typed into while standing at a table, on the one screen where everything else had already been taken to 44. Both clear it now.',
      'These were found by walking every route and every modal at 390 and measuring every button, link and field on each, rather than by reading the rules and judging what looked covered. What is left under 44 is under it on purpose and says so where it is set: a rule chip, which would be a wall of them, the footer links, and the Energy number on a weapon card, which is a number in a line of numbers that happens to be pressable.'
    ] },
    { date: '2026-08-12', title: 'Category spend ran its own labels out of their column', items: [
      'Two of the four words in Category spend did not fit their own column. The numbers are lined up under each other on purpose, so the column holding Standard, Vanguard, Heavy and Support is a fixed 60px, and Standard wanted 62 of it and Vanguard 64. It is 68 now. It only bites when the webfont has not arrived, which is a phone at a table with no signal.'
    ] },
    { date: '2026-08-12', title: 'Add Units opened on a screenful of its own controls', items: [
      'On a phone the picker showed no units. Measured at 390 by 844: the toolbar was 363px tall and the first unit card began 467px down, so more than half the screen was search, tabs, sorts, filters and Fits before a single thing you could add. The tabs had wrapped to two rows and the sorts and filters to three, because every chip is 44px tall now so a finger can hit it. Sort, the filters and Fits fold behind one button on the tab line, and the first card starts 275px down. The button carries a count and lights up when a filter is on, so nothing can be cutting the list from behind a closed row without saying so. Nothing changed on a desktop: every control in that toolbar lands on the same pixel it did.',
      'A modal on a phone was giving up a sixth of the screen to its own margins. 12px of overlay padding and 20px of panel padding each side left a unit card 324px of a 390px phone, and a unit card carries a three-column stat grid. 348 now, and the search field holds its full placeholder again at every width down to 320.',
      'Search boxes are in the app’s own typeface. An input inherits no font, so all three of them had been drawing their placeholder in the browser’s Arial while everything around them was Jost.'
    ] },
    { date: '2026-08-11', title: 'Your Dropfleet fleets were turning up in your army list', items: [
      'Both builders are pages on type37.github.io, so a browser treats them as one site and hands them one pile of storage, and both were syncing to the same place under the same name. Turning sync on in either app turned it on in the other, on the same token, and the two games were merged into a single list: fleets appeared here as armies with no Groups, and armies appeared over there as fleets with no ships. Sync carries your lists without ever looking inside them, which is exactly why it could not tell one game from the other. The two are separated now at both ends. This app keeps its own record of whether sync is on, and the same six words name a different list in each game, so nothing has to change about the token you already have. Any fleets that had already landed in your army list are removed the first time this app opens.',
      'Every edit is timestamped again. Sync settles a disagreement between two devices by keeping whichever copy was edited last, and the call that stamps the time was being handed nothing, so no army here carried one. Two devices holding the same army both looked equally undated, and which one won was down to the order they happened to sync in. An edit on a phone now also pushes itself up rather than waiting for you to leave the app and come back.'
    ] },
    { date: '2026-08-11', title: 'Two Squads were showing no weapons at all', items: [
      'Resistance ATVs and the UCM Archangel Fighter-Bomber rendered with an empty weapon table, in the builder and on the printed sheet. A gun that belongs to one loadout names it in brackets, and on those two cards the bracket does not match the name in the price line: the ATV card says “25pts (Recon ATVs)” but labels the gun “(Recon ATV)”, and the Archangel’s bracket wraps mid-word across a line. Neither is a scan error, both are on the card, and nothing reconciled the two. All four loadouts show their guns now.'
    ] },
    { date: '2026-08-11', title: 'A Commander no longer pushes its Group over the quarter cap', items: [
      'No Group may cost more than a quarter of your points, and a Commander’s points were being counted against that. 3.2.5 says they are “ignored during Army composition besides counting towards your total allowed points”, so 430pts of tanks with a Level 6 Commander read 580 against a 500 cap and a legal list was refused. The category ratios already left Commanders out; the Group cap does now too. The Group meter shows the same figure the rule uses, and your army total still counts every point.'
    ] },
    { date: '2026-08-11', title: 'Nothing sends you to the PDF any more', items: [
      'A keyword with no glossary entry used to answer “No glossary entry for this keyword. Read it from the stat card.” Five did: Nanomachines on the Type 7 Grand Walker, Particle on the Dragon, Razorworm Pod on the Terror Mech, and Scrambler on the UCM Light Battle Mech twice over. A Behemoth’s card never says whose faction it is, so its faction rules were out of reach, and the Light Battle Mech’s card prints “Scrambler 2+” where the rulebook heads the rule “Scrambler +X”. All 2,062 keywords the app can print now resolve, and a test walks every one of them so it stays that way.',
      'A Unit no longer tells you which page of the stat card PDF it came from. A rule’s page number is worth printing because the app shows a summary and the book has more; a Unit’s was a pointer to a card whose every field is already on the screen in front of you.'
    ] },
    { date: '2026-08-11', title: 'Raw Materials are bought one at a time', items: [
      'The Raw Materials stepper said "3 of 12", which is the shape of a ration you are drawing down. RM is not that. "RM tokens cost 5pts each and are assigned to those Genitor Units": you buy them one at a time and each adds 5pts to the army, the same as buying a model. So it is a count with its price beside it now. The 12 has not gone anywhere, it is the rule the plus button enforces and it still says itself when it refuses, but it is no longer the frame.',
      'The Raw Materials control is in the screenshot walk. It is drawn on two Units in one faction, so a walk through UCM had never once seen it and it had been changed twice with nobody looking at it.'
    ] },
    { date: '2026-08-11', title: 'Measured in a real browser: 30 controls too small to press, and four faction colours nobody could read', items: [
      'Every screen was walked in a real Chrome at 390 by 844 and every control on it measured. Thirty came back under 44px. Play Mode had almost all of them, which is the screen used entirely with a finger while standing at a table: the damage stepper at 26px square, the four Status Tokens at 22, Victory Points at 28, and Command Points, Pass tokens, Initiative and the Round counter around 32. So did the variant stepper in the builder, which is how a Squad gets its models, and the Add button in the picker, which is the thing the picker is for. All of them clear 44 now, and the two Victory Point counters still share one row, which they stopped doing until the padding gave way instead of the buttons.',
      'An unset Status Token was a letter drawn at 40% opacity, about 1.9:1 against the card. Not faint, unreadable, on one of the four controls that screen exists to press.',
      'Four of the six faction colours failed as text. Measured on the white card: Scourge purple 7.2:1 and Bioficer red 8.2:1 are fine, UCM green is 4.05:1, Resistance blue 4.00, Shaltari orange 3.50, and PHR gold is 2.28:1, which is gold on white. The colours themselves do not move, because they are the faction and they sit on fills, borders and rules where the bar is 3:1 and all six clear it. What changed is the ink they imply: where the accent was set as small type it is now a darkened cut of the same hue, and where small type sits ON a fill of it, the ink is black or white depending on which one reads. A PHR chip is still gold; its label went from 1.9:1 to 8:1.',
      'Play Mode is drawn in the army’s colour. Every other view has taken the faction accent since it was written and this one never did, so a Scourge game and a PHR game were the same navy.',
      'Four more inks that were below the line: the changelog headings you are reading at 2.90:1, the variant chip on a weapon card at 3.30, "just now" on an army card at 3.11, and the Rare and Aux Transport flags at 3.81, which were painted on a border colour rather than on a background.'
    ] },
    { date: '2026-08-11', title: 'Tokens that never came off, and Pass tokens you could not spend', items: [
      'Status Tokens come off at the end of a Squad’s activation (6.4.5), and nothing was taking them off. A Squad Concussed in Round 1 was still carrying -2Ac in Round 6, and Suppressed and Jammed did the same. Ticking a Group activated clears them now, which is the end of the activation; a token you place after ticking was placed that activation and stays, which is the exception in the same rule. Un-ticking hands them back, because that box is also how you undo a mis-tap.',
      'Obscured is a Status Token on the Squad, not a note on one model. It was put on the model on the strength of Obscurer X”, which really does Obscure individual Units by where they are standing. But that places no token and this app does not know where anything is standing. The two rules that hand out the token, Smoke and Stealth, both say “on that Squad”, and Large turns on the distinction: a Large Vehicle cannot be Obscured except by the token. A Stealth Squad had nowhere to record what Stealth had just given it.',
      'Pass tokens are spent. The card showed how many you were dealt and had no way to use one, so from your second pass onward the number on screen was a token you had already handed over. It now reads what is left over what you were given, the way the Command Point card does, and the count starts again every Round because the leftovers are discarded rather than banked.'
    ] },
    { date: '2026-08-11', title: 'Five icons that were shapes typed into a file, replaced with real ones', items: [
      'Damage Points, Power, Defence and the grid/list toggle were not icons. They were geometry written straight into the source: a seven-point hexagon, a lightning bolt in eight integer moves, a shield whose curves were picked by eye, and four bare rectangles. Not one of them contained a single curve command, which is what gave them away. All four come from Phosphor now, and the list half of that toggle moved with the grid half so the two states are from one set rather than two.',
      'The Damage Points hexagon is an outline rather than a solid. Both filled hexagons on offer came out as a black blob at the size the stat block actually draws them, close enough to a house shape to be misread; only the outline still says hexagon at 17px.',
      'The icon file said "the six stat_* paths are NOT Material, they are drawn for this app". That was wrong in both directions and covered for exactly the three that were the problem. Every path states its own source now.'
    ] },
    { date: '2026-08-10', title: 'A photo per variant, the Triton’s real upgrade rule, and Behemoths that were never banned', items: [
      'Every variant that has a picture now shows its own. A Sabre and a Rapier are a tracked tank with a chainsaw gun and a hover tank with a long AA barrel, and the app showed the same photograph for both, because art was per unit and a unit holds up to four variants. 98 of the 199 variants have their own miniature now, on the block where you choose how many of them to take. They come from the previous edition’s cards, which printed as separate units what this edition lists as variants, so they are older sculpts; a variant whose model that edition never pictured shows nothing rather than something that is not it.',
      'The Triton’s upgrades. Its card offers three and stars two of them, and the star is what the footnote means: you may take the RM-1 Stealth Missile Battery alongside either the Twin RX-20 Miniguns or the RM-7 Skyhammer Missiles, just not the Miniguns and the Skyhammers together. The app was reading the footnote and refusing any second upgrade at all, which made the Triton’s commonest loadout unbuildable. It is the only card in the game with that note, and it is on both Tritons.',
      'Behemoths are not banned below 3000pts. They were being refused in any smaller game, on the strength of a line in the Behemoth introduction saying some of them are that big. It is not a rule, it says some, and nothing anywhere says which. What actually limits a Behemoth is the one rule 1.1 points at: it counts as a single Group against the quarter-of-your-points cap. So a 410pt Light Battle Mech in a 1750pt game, where a Group may cost 437, is legal, and it was being called illegal.'
    ] },
    { date: '2026-08-10', title: 'Things arrive and leave, refusals that name the move, and a lot fewer dashes', items: [
      'Squads, Groups and armies animate on when you add them and off when you delete them. Only the thing that actually arrived moves: adding a Squad does not re-deal the rest of the army, and pressing a stepper animates nothing at all. It is built out of transform and opacity alone so a phone can hand it to the compositor instead of re-running the layout of a dozen Squads every frame, and it does nothing at all if your system asks for reduced motion.',
      'A refusal tells you what to do about it. Two Squads in a Group with nothing carrying either of them used to quote rule 3.2.4 and stop, which reads as the app breaking rather than the list being half finished. It now names which Squad goes aboard which, worked out from the same list the Transport button offers, so it can only ever suggest something that will work.',
      'The M&A Max icon is gone from the weapon table and the weapon card. It was three fixed colours at 13px in a 57px column, so it read as a smudge and could not follow the dark theme. The words stayed.',
      'The writing lost most of its dashes. Several hundred of them across every message, tooltip and note in the app, rewritten into full stops, colons and commas rather than swapped for a shorter dash.'
    ] },
    { date: '2026-08-10', title: 'A handle you can see, a button with a word on it, and the Foeslayer put back where the card has it', items: [
      'The drag handle was invisible. Two players decided the app had no drag and drop at all, and one of them only found the six dots at 200% zoom. Three things were wrong: the dots drew at about a seventh of the contrast a control needs, the Group card used a glyph whose dots came out half a pixel wide, and the two handles for the same gesture sat at opposite ends of the screen. There is now one handle, one glyph, at the leading edge of both a Group card and a Squad row, dark enough to see in either theme without hovering, and the Group card gets back the space it was holding for a grip that is no longer in its corner.',
      'A Squad’s Transport chooser says “Transport”. It was a small lorry beside a bin, and nobody found it. The panel it opens has always done the thing people were dragging to achieve: a Medusa put aboard a Triton X Gunship in one tap, with the capacity drawn and “Fills it” underneath. Its partner says “Take out”.',
      'The refusal for two Squads with nothing carrying them now names the move. It used to quote rule 3.2.4 and stop, which reads as the app breaking rather than the list being half built. It says which Squad goes aboard which, worked out from the same list the Transport button opens, so it can only suggest something that will work. Where nothing in the Group fits anything else, it offers a Transport or a second Group instead of inventing a pairing.',
      'RM-4 Foeslayer Missiles are a Menchit and Styx upgrade, and the app was selling them to an Ares for 5pts with nothing traded in. The card’s sentence had been read into the swap and not onto the gun itself. It is on the gun now, and a re-scan of the stat cards will keep it there. If you had already bought one, it stays bought and reprices to the models that may actually carry it.',
      'Groups and Squads move without a drag. Focus a handle and the arrow keys shift a Group one place, or send a Squad to the Group before or after it. Left and right as well as up and down, because the cards sit in a row on a computer and a column on a phone.',
      'Settings shows the build number, and a feedback mail arrives with it filled in. A live tab already updates itself within the minute, so this is not a prompt to reload; it is so a report can say which build it came from.'
    ] },
    { date: '2026-08-08', title: 'Raw Materials, rules on the loadout that has them, and a phone that stopped scrolling sideways', items: [
      'Shaltari Gates are not part of your Group structure, because the rulebook says so three times: they are not taken with any Units aboard, they do not count against your allowed Groups, and a Gate is never part of another Group. The builder was breaking all three. It offered a Gate as a Squad’s Transport, spent a Group on every Gate you took, and printed “carries nothing” on a Gate that was correctly empty. A Group of Gates is now called Gates, is numbered apart from your Groups, and costs you none of them. And a Squad with no Transport in a list with Gates starts in Holding, which is the whole point of the faction, rather than being warned that it begins Reserved.',
      'Raw Materials. A Genitor Unit, anything with a hollow green square, may begin the game with RM tokens aboard, 5pts each up to the number in its symbol, and now you can buy them: 12 on a Grievance Genitor Ark, 8 on a Gyro Aero-Genitor. Their points count toward the army and toward their Group, and toward no category at all, which is what the rule says and the only place in this app where that is true. They travel in a share link, in a backup and on the printed sheet, where they print as tokens rather than as the points they cost: points are what you paid, tokens are what you put on the table before Round 1.',
      'A rule that belongs to one loadout is written on that loadout. “Scanner (Greave)” printed against the whole Squad, so a Sabre, a Tachi and a Rapier all looked like they had a Scanner only the Greave has. Nineteen rules across the game move onto their own Variant (in the builder, in the Unit Reference and on the printed sheet), and the Squad keeps only what every model in it has. Inside the Greave’s own block the chip just reads “Scanner”, because the block is already called Greave.',
      'The builder scrolled sideways on a phone. Three faults stacked: a grid whose columns had a hard 232px floor in a 170px space, every level of carry spending 96px on indent before a single stat was drawn, and a row of controls that could neither shrink nor wrap. A 320px screen measured 455px of page; it measures 312 now, and nothing runs off the edge at any width. The photograph on a Squad also shrinks properly on a phone at last. It had been sitting in the corner of a box a third bigger than itself, with 37px of blank paper beside it, on every Squad.',
      'An alert on a Squad stops repeating the Squad’s name. “UCM Troop Buggy”, and twenty pixels below it, “UCM Troop Buggy: 1 model, minimum is 2.”',
      'Play Mode counts your RM. A Genitor walks into the game holding what you bought and the count moves both ways from there: down 4 for Drones and 6 for Hulks as you Spawn them, up 2 or 4 every time a Decon weapon finishes something off. It stops at the number in the symbol, because any above that are discarded.',
      'The +/- on a Squad with Variants is gone. It was the sum of the ones on the blocks underneath it, and pressing it had to guess which Variant you meant. A Unit with no Variants keeps its own. 93 of the 178 have none.'
    ] },
    { date: '2026-08-07', title: 'A theme that hid the app, and a download with no app in it', items: [
      'Dark mode was white text on white cards. Six of the tokens the builder is written against (its surfaces, its lines, its second ink) were never defined anywhere, so that whole layer stayed hardcoded to paper while the ink dutifully flipped to near-white. The builder, the picker, the reference and Play Mode all went unreadable the moment you touched a switch that has sat in Settings since the beginning. The printed sheet and its preview went with them. Every screenshot is taken in both themes now, which is how this survived as long as it did.',
      'A phone had no rail at all. Points left, Groups used and issues outstanding were switched on by one stylesheet rule and off by a later one, so no phone ever saw them, and with nothing drawn there, nobody saw the fault underneath: the army was sitting in a grid column that no longer existed, pushed off a dead gutter down the left.',
      '“Download for offline use” fetched 26 MB of art and no app. The list it works from named files belonging to a different game, and none of the twelve modules this one is made of, so the group labelled for the rules and the app contained neither. It reads the list the service worker actually caches now, because two lists that have to agree is one list too many. A re-scan would have left that same download describing photos that were gone, and one missing file takes the whole offline copy down rather than one picture, so regenerating it is part of the scan.',
      'The printable faction references were unreachable. Six sheets and an index, already cached for a table with no signal, and nothing anywhere linked to any of them.',
      'Every variant printed the unit’s stats back at you, three and four times over. A Polecat Buggy gave you Move 9”, Armour 4, Damage Points 1 four times in one card. Not one of the 218 variants in the game changes a stat, so that copy had never once said anything.',
      'Import’s one line of instruction was cut to “…or a pas” on a phone, and it is the only line that tells you a pasted list will do. It wraps now. Its label also rested three rows down the middle of an empty box instead of on the line where you type.',
      'A new Round capped your Command Points and never handed you any. Replenishing up to your highest Commander Level is half of 4.1.1, and the losing half was the half that worked, so a Level 5 Commander started Round 2 on nothing. The Initiative roll prints its total on a six as well, and that is the one roll with a case that needs it.',
      'Behemoths reached Play Mode a week after they reached the builder, and four of their rules had not travelled with them. One counted as a single Group when Pass tokens are worked out off Group counts and a Dragon is worth five, so every token in the game came out wrong for anyone fielding one. You could Concuss one, and Obscure one, neither of which the game allows. And the biggest model on the table was marked finished for the Round after one activation, when a Behemoth goes once per Power token, four to ten times, and that track was nowhere in the app. Every Behemoth Squad carries it now, refilled at the start of each Round.',
      'Every Behemoth also said “Squad 1”, which is a number its printed card does not carry: they have a Groups Equivalent instead, and that is the one that decides how much of your Group allowance one eats. It is on the reference card, the picker, the Collection and the unit’s own page now, and the rail counts your Groups in it. That meter was counting cards against an allowance counted in Groups, so it read 3 of 16 on a list already spending fifteen.',
    ]},
    { date: '2026-08-06', title: 'Behemoths, and a weapon table you can read on a phone', items: [
      'Ten Behemoths and the Venus Drone are scanned and read in the Unit Reference, under a seventh tab that is deliberately not a faction: the cards do not say whose they are. Their 39 rules are in the glossary, and their Gear is on the card and on the printed sheet.',
      'They can be built with, and they cost the Groups they are worth. A Behemoth counts as several Groups when you build, and without that a Battle list could field three Dragons and a Siegestrider on four cards, inside an allowance they alone are worth eighteen of.',
      'Play Mode gave a Dragon 9 damage points instead of 18. A Behemoth prints several values and the last one is the real one; the first was being taken, so every Behemoth walked in with half its life or less and would have been called destroyed at a fraction of what it takes to kill one. Degraded and Crippled are read off the same line and said outright, because they change what the model may do rather than only how close it is to dying.',
      'A weapon is a card. Eight columns wanted 620px and got them by scrolling sideways inside their own box, so on a phone the column carrying the rules was the one you never saw without dragging. Nothing is dropped; the same eight fields are laid out to be read instead of to line up.',
      'An upgrade that sells transport capacity now spends it. Two cards in the game trade room for guns, and the builder would load two circles into a Strikehawk that had already sold them and call the army legal.',
      'The four categories have a colour, and it can be read. The whole of 3.2 turns on which category a Unit is in, and it was the same grey word on every card, tile, row and sheet. The swatch and the word carry different inks: the vivid colour on the square, the word darkened until it clears on paper.',
      'No Commander on a Fast Mover or a Living Weapon. A swap takes the weapon it replaces off the sheet. The top bar says what this is, and Play Mode stopped running off the side of a phone.',
    ]},
    { date: '2026-08-02', title: 'Nothing on a phone was big enough to press', items: [
      'Measured at 390 by 844, every control the app draws: the way back was 18px square, the card menu 24, Settings and the modal close 32, the filter and sort chips 28 high, the search field 36. A finger pad is about 45px across, so all of those were aimed at rather than pressed. Everything clears 44 now, and the model stepper (the most-pressed control here, and two of them sat 2px apart) got the gap as well as the size.',
      'One failed Create killed Create for the rest of the session. The button disabled itself for the length of the work and re-enabled after a render that a throw could step straight over, so it stayed pressed and silent and no click after it built anything until you reloaded.',
      'The number inside a transport symbol sits on the shape’s real centre of mass rather than the middle of its box, which is not the same place on a triangle.',
    ]},
    { date: '2026-08-01', title: 'A run spent looking at it', items: [
      'The print preview was telling a phone that a one-page army was three pages, and drawing a page break through the middle of a Squad, through a Group, which is the one thing the whole sheet is built to keep whole. The sheet was being stretched to the height of your window and then measured, and the measuring itself was mixing what you can see with what the paper actually is. Both fixed; a phone and a desktop now agree, and they agree with the paper.',
      'On a phone there was no way back. The back arrow lives in a strip that had been hidden below 768px since the days of a separate mobile build, so the only way out of an army was the wordmark, which goes to the front page rather than back, and Play Mode’s Reset game could not be reached at all.',
      'Status Tokens go on the Squad, which is what the rulebook says three separate times. Concussed, Suppressed and Jammed were on every model, so a Squad of five had five of each and you could record a state the game cannot produce. Obscured stays on the model, because that one is about where a model is standing. A status you have set now says its whole name instead of its first letter.',
      'Every Group card was printing its cost with the last digits under the drag grip: 100/50, with the rest of the ceiling hidden. That number is how you tell whether a Group is legal.',
      'Category spend drew the Standard line in the same green as the card it sits on, so the one row that explains what the other three mean was a smudge beside a number.',
      'The Unit Reference was cutting the ends off its own stats, 5+ DEFENC, 5+ BRAVE, on nearly every card in the grid.',
      'A Commander you have not named reports its Level as its name, and then both the rail and the printed sheet said the Level again beside it. The unit page did the same with the unit’s name.',
      'A Group with nothing in it was tagged “orphaned transports” in Play Mode and told a rule about transports it did not contain.',
      'The search box on the Collection was cutting off the line that tells you what you can type. On a phone the magnifying glass beside it gives way instead of the words.',
    ]},
    { date: '2026-08-01', title: 'What a Level buys, and guns nobody was firing', items: [
      'A Commander Level says what it is worth. CP replenishes up to your highest Level, your Command Card hand is that many cards, and Initiative is D6 plus it (4.1). Play Mode has run on those three numbers since it was written; the screen where you choose a Level had never been told. They are on every option in the chooser, once in the rail for the army, and on the printable reference.',
      'A Level a smaller game cannot reach says which game reaches it, instead of not being there. At Skirmish there was no way to learn that Levels 6 and 7 exist.',
      'A Squad’s weapon table is the guns that Squad fires. It was printing the whole card: the gun only a Rapier carries, on a Squad with no Rapier in it, and every paid upgrade whether or not you had bought one. The printed sheet does the same now, where it matters more, and its rules appendix stops printing rules for guns nobody in the army can fire.',
      'Compact view, in Settings. A Squad reads as its whole stat card by default; this drops the weapon table and the stat grid repeated under every Variant, and takes away no control.',
      'Every Unit says which stat card page it came off, with the release named beside it. Every rule already cited its rulebook page; the Unit, whose printed card is the one thing this cannot replace, cited nothing.',
      'The sentence that qualifies an upgrade reads on the unit page as well as over the buttons, and four cards had it wrong in the data. Two stopped mid-clause at “May replace transport capacity of” and two held a paragraph of lore.',
      '“A save of 4++”, on every Infantry Unit with Hardy. The rulebook heads the rule “Hardy X” and then reads “a save of X+”, while every card prints “Hardy 4+”, so the value took the plus with it.',
    ]},
    { date: '2026-08-01', title: 'A blank builder, and everything that was never pressed', items: [
      'The builder was drawing nothing at all for any Squad with a Transport, and had been for a day. A helper was used two hundred lines above the line that declares it, which throws rather than coming back empty, so the whole pane stayed blank. Nothing caught it because nothing had ever drawn the builder in a test, only the pieces it is made of.',
      'Every screen is driven by the tests now, and so is every control on them: the army list, the builder, the picker, both choosers, Share, the print preview, the unit reference, Collection and Play, about seventy controls pressed in turn.',
      'Drag a Group to reorder it. The order is the order on your printed sheet, and that is the deployment plan, and until now it was whatever order you happened to add them in.',
      'An army can say what it is for. Set it when you make one, edit it in the builder, and it travels in the link, the JSON and the text.',
      'Play, Share and Print moved into the topbar, which on a phone costs no vertical space at all. On a phone the rail also collapses behind the two numbers you keep glancing at.',
      'One menu on an army card instead of two loose icons crowding the thing you are trying to tap. The picker can show only what you own. Missing art removes itself rather than leaving a broken icon and a hole.',
    ]},
    { date: '2026-08-01', title: 'A sheet for the table, and corners that were never sharp', items: [
      'A printable quick reference for each faction: every game size with its Group cap and Rare limit, the Commander ladder, the category and Group-cost rules, the transport symbols, the whole roster as one table, and the special rules those units actually print. It reads the same data the app reads, so a re-scanned points value cannot leave it lying. Linked from the landing page and the footer.',
      'Sharp cards, actually. The rule was written into the stylesheet above the rules that round the picker cards, the rail and the Commander chooser, so those had been rounded the whole time. Nine more surfaces are square now, including the landing tiles and both grids in the New Army dialog.',
      'Share is three things: a link for someone who will open it, plain text for a message or a forum, and JSON for this app’s own Import. The text keeps the Group nesting indented, and pastes back in as an army.',
      'Feedback asks the four questions instead of opening a blank message.',
    ]},
    { date: '2026-08-01', title: 'Surprise me, and a bug that called legal armies illegal', items: [
      'A Squad that needed more than one Transport was being reported illegal. Six Legionnaires in two Bear APCs is a Group the rulebook itself illustrates, and the app measured them against ONE vehicle\'s capacity, so it said "needs 6, has 3" and there was nothing you could do about it. Fixed, and pinned by six tests.',
      '"Surprise me" builds a whole army to the faction, size and points you have chosen, legal when it stops. It spends the Commander first, Standard before the categories Standard has to pay for, and takes a Transport only where it comes out exactly full.',
      'A rule links to the rules it names. Grav says it ignores Resilient; Resilient is now one tap away, where before you had to know it existed and go looking. Twenty-three of those cross-references were dead ends.',
      'Every rule a Unit uses prints in full under its weapon table, not only behind a hover, because on a phone there is no hover, so a tooltip-only rule was simply missing.',
      'A list pasted out of New Recruit imports. It cannot give you back the Group nesting (a flat list does not record what rode in what) and it says so rather than pretending.',
      'Sort your armies by Recent, Name, Faction or Points, and an empty list is a grid with a tile in it instead of a sentence saying it is empty.',
    ]},
    { date: '2026-08-01', title: 'Print what you can see first, and get your armies back', items: [
      'Print opens a preview: your sheet at A4 with the page breaks drawn on it and the page count in the bar. The breaks are measured rather than spaced every 273mm: a Group is kept whole by the stylesheet, so the preview pushes one that would straddle a boundary onto the next page exactly as the printer will, and then it agrees with the paper.',
      'Compact, ink-saver and art, decided in the preview where you can see what each costs you in pages. Art on the sheet is new; it stays off unless you ask, because it is the biggest thing between a two-page list and a four-page one.',
      'Import. There was an Export button and nothing to put it into, which made the backup a file rather than a backup. A whole backup, one army, a share link or a list pasted from New Recruit all go in through the same box, and the report says what came in and what it could not match. Nothing is overwritten: importing twice adds twice.',
      'A pasted list will not give you back the Group nesting, and says so: a flat list does not record what rode in what.',
      'The agreed points limit can be changed after you make the army. The size in the rail opens it. This mattered more than it sounds: the per-Group ceiling is a quarter of the AGREED number, so agreeing 1500 on the day instead of the 2000 you built at moves what is legal, and there was no way to tell the app.',
      'The per-model variant dropdowns are gone. A Squad of eight was eight dropdowns, and you could not see the mix without opening every one. The variant blocks, which already said what each variant is, which gun makes it that and what it costs, now carry the count, so the thing you read is the thing you press.',
      'An upgrade reads as the weapon it is: the same columns as the table above it, arc, range, attacks, accuracy, energy and every special, with the price as the button. The question an upgrade asks is whether the new gun beats the old one, and a name cannot answer it.',
    ]},
    { date: '2026-08-01', title: 'Commanders, Groups you can copy, and tests that read the markup', items: [
      'Commanders have names, the same way Groups do. An unnamed one reports its Level, so deleting one from the middle can never leave two things called the same thing.',
      'Duplicate a Group, with every Squad, its models and their variants, the upgrades and the nesting, with every id reissued so the copy rides its own Transports rather than the original\'s.',
      'Every army as one JSON file you keep. Armies live in your browser, which is free to clear them; sync moves them between your devices but propagates a deletion just as happily.',
      'On a phone a Group is a screen you drill into rather than another slab in a long column; on a desktop the builder keeps its three panes.',
      'A test suite that reads the rendered markup. Three regressions in one night were caught by looking at a screenshot and none by the tests, which was an argument that nothing was testing the markup rather than an argument for screenshots.',
    ]},
    { date: '2026-08-01', title: 'Rules say what they mean, and the Albatross is reachable', items: [
      'A rule reads back the number your card printed. "Aegis 6”" says "within 6” of this Unit" instead of "within X”", and it works for words as well as numbers, so "Ineffective: Zones" names Zones. Substituting the value also exposed three keywords the app had been reading wrongly. "Pen 6+" was resolving to Passive Countermeasures, which meant every weapon with Penetrator showed the wrong rule.',
      'Every rule now says which page of the rulebook it is on, in the tooltip and on the printed sheet, so the book falls open in the right place mid-game.',
      'You can build an Albatross. A Transport Squad is a Squad, so it can be carried too: you give an Albatross to a Bear APC exactly as you gave the Bear to the Legionnaires. The rules always allowed it and the builder was refusing.',
      'The picker prices the Squad rather than one model: 70pts over "2 × 35". A third of the list has a minimum above one model, so a third of the list had been quietly halving its own price.',
      'Category tabs say how many units are behind them, and a tab or a filter only appears if it can match something. That adds a filter for units with a paid weapon upgrade (18 in the whole game) and removes Unique, which could never match anything, because no Unique Unit has been published.',
      'Search reaches further: category and type, the rules on a weapon rather than only on the Unit, and glossary aliases, so "evasion" finds a Unit whose card only ever prints "Ev1".',
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
      'A Group that does not yet make sense is reported when you stop building, not blocked while you build. A lone Transport is unfinished, not illegal: you are probably about to fill it. A second Rare Squad is still refused, because nothing you add later puts it right.',
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
      'Groups, Squads and per-model variants, with transport nesting drawn as a tree, a Bear APC with its Legionnaires indented beneath it, because that is the deployment plan.',
      'Illegal choices are unreachable rather than flagged after you have made them.',
      'The print sheet keeps the nesting and appends the verbatim text of every rule your list uses. Groups never split across a page and no rule breaks mid-sentence.',
      'All 178 units are readable on their own, with a 106-rule glossary taken from the rulebook and the faction front matter.',
    ]},
  ];

  function openChangelog() {
    $('changelog-body').innerHTML = CHANGELOG.map(e => `
      <div class="changelog-entry">
        <!-- A colon between the date and the title. It was an mdash, chosen
             because an interpunct would have blown the app's budget of two for
             that glyph (CLAUDE.md 3) -- but one separator per entry meant this
             single line was 23 of the em-dashes left in the app. A colon costs
             nothing and says the same thing. -->
        <div class="changelog-date">${esc(e.date)}: <span class="changelog-title">${esc(e.title)}</span></div>
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
    // The footer ships a plain mailto so the link works before any script
    // runs; this upgrades it to the guided one. Same move as Dropfleet's
    // app.js:298, and for the same reason.
    const fb = $('footer-feedback');
    if (fb) fb.href = FEEDBACK_HREF;
    window.addEventListener('hashchange', route);
    route();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return {
    navigate, showView, openModal, closeModal,
    openSettings, setTheme, toggleSetting, collectionOn, compactView, applyCollectionSetting,
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
