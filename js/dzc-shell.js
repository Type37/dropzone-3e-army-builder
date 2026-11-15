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
  const BUILD = 530;

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

  const VIEWS = ['view-landing', 'view-armies', 'view-army', 'view-units', 'view-play', 'view-collection', 'view-rules'];

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
      // The rulebook. A deep link is #rules/<section id>, and an id can carry
      // dots and a slash ("9/kill-box"), so the whole rest of the hash is it.
      case 'rules':
        show('view-rules');
        ctx.innerHTML = back('landing', 'Interactive Rules');
        if (window.DZCRules) DZCRules.open(param);
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
        showRulesTip();
    }
  }

  /* The Interactive Rules pointer (index.html #dfc-rules-tip). Shown on the
   * landing screen until closed or followed, once per device; CSS hides it on
   * every other view. Storage can throw (private mode, blocked site data), in
   * which case it simply shows again next visit. */
  const RULES_TIP_KEY = 'dzc_rules_tip_dismissed';
  function showRulesTip() {
    const el = $('dfc-rules-tip');
    if (!el) return;
    let dismissed = false;
    try { dismissed = localStorage.getItem(RULES_TIP_KEY) === '1'; } catch (e) { /* show it */ }
    if (dismissed) { el.hidden = true; return; }
    if (!el.dataset.wired) {
      el.dataset.wired = '1';
      const dismiss = () => {
        el.hidden = true;
        try { localStorage.setItem(RULES_TIP_KEY, '1'); } catch (e) { /* session only */ }
      };
      el.querySelector('.dfc-rules-tip-close').addEventListener('click', dismiss);
      el.querySelector('a').addEventListener('click', dismiss);
      el.addEventListener('keydown', e => { if (e.key === 'Escape') dismiss(); });
    }
    el.hidden = false;
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
  // `on` is for the one setting that starts switched on: its key holds false
  // only once someone turns it off, so a stored list from before it existed
  // keeps the behaviour it had.
  function tog(key, name, desc, on = false) {
    const checked = settings[key] === undefined ? on : !!settings[key];
    return `<label class="dzc-set-toggle" title="${esc(desc)}">
      <span>${esc(name)}</span>
      <input type="checkbox" ${checked ? 'checked' : ''}
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

  // The Apex: Fauna an army may take under Intelligent, "in casual games"
  // (Fauna rules 7.1.7). Off unless asked for, so a list for a tournament
  // is never offered one.
  function faunaOn() { return !!settings.faunaInArmies; }

  /* Transports in other Groups, offered in the Linked transport panel. On
   * unless turned off. A player asked for the switch, 2026-11-15: "there's now
   * a 'link to transport in another group' option in the builder which has
   * been causing problems for me. Any chance we can get a toggle option to
   * turn that off?" Off takes the "In another Group" cards out of the panel.
   * Drag is not affected: it only ever boards a Transport in the Squad's own
   * Group, and dropping on another Group's brief is a plain move. */
  function otherGroupTransportsOn() { return settings.otherGroupTransports !== false; }

  function applyCollectionSetting() {
    const card = $('landing-collection');
    if (card) card.classList.toggle('hidden', !collectionOn());
  }

  function openSettings() {
    const dark = settings.theme === 'dark';
    // "Updated October 2026 with Fauna_Rules_Scenarios_261001": the newest TTCombat file
    // the data was built from, written into index.json by the monthly update. The
    // button says What's new until the index is in.
    const upd = window.DZC && DZC.indexNow && DZC.indexNow() && DZC.indexNow().updated;
    const newsLabel = upd ? `Updated ${upd.month} with ${upd.file}` : "What's new";
    // Not every screen loads the index (the landing page does not), so load it
    // here and draw Settings again once it is in, if Settings is still open.
    if (window.DZC && DZC.indexNow && !DZC.indexNow()) {
      DZC.loadIndex().then(() => {
        if ($('modal-settings').classList.contains('active')) openSettings();
      }).catch(() => {});
    }
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
        ${tog('faunaInArmies', 'Apex in armies',
          'Offer the three Apex in every army. Fauna rules 7.1.7, casual games only')}
        ${tog('otherGroupTransports', 'Transports in other Groups',
          'Show Transports from other Groups under Linked transport', true)}
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
          <button class="btn btn-ghost btn-sm dzc-news" type="button" onclick="App.openChangelog()">${esc(newsLabel)}</button>
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
    /* Discord, as the Dropfleet builder has it (app.js syncAccountHTML): the
     * same Worker and the same Discord application, a document of this app's
     * own. Signed in, the panel shows who rather than a key, and the only
     * phrase on screen is a Sync Token this device still keeps linked. */
    const d = on && FleetSync.discordUser && FleetSync.discordUser();
    const phrase = d ? FleetSync.linkedToken() : FleetSync.token();
    const discordBtn = FleetSync.discordConfigured && FleetSync.discordConfigured()
      ? `<button class="sync-discord-btn" type="button" onclick="App.syncDiscordSignIn()">${DISCORD_ICON} Sign in with Discord</button>
         <div class="sync-or"><span>or</span></div>` : '';
    body.innerHTML = on
      ? `${d ? `<div class="sync-account-row">
           ${d.avatar ? `<img class="sync-avatar" src="${esc(d.avatar)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
           <div class="sync-account-who">
             <div class="sync-account-name">${esc(d.name)}</div>
             <div class="sync-account-mail">Discord</div>
           </div>
           <button class="btn btn-outline btn-sm" type="button" onclick="App.syncDiscordSignOut()">Sign out</button>
         </div>` : ''}
         <p><b>Syncing is on for this device.</b>
           ${n} arm${n === 1 ? 'y' : 'ies'}, last synced ${
             last ? esc(new Date(last).toLocaleString()) : 'not yet'}.</p>
         ${phrase ? `<p class="dzc-token">${esc(phrase)}</p>
         <p class="dzc-set-note">Anyone with this phrase can read and change your armies.</p>` : ''}
         <div class="dzc-set-actions">
           <button class="btn btn-outline btn-sm" type="button" onclick="App.syncNow()">Sync now</button>
           ${d ? '' : '<button class="btn btn-ghost btn-sm" type="button" onclick="App.syncStop()">Turn off</button>'}
         </div>`
      : `${discordBtn}<div class="dzc-set-actions">
           <button class="btn btn-primary btn-sm" type="button" onclick="App.syncStart()">Turn on sync</button>
         </div>
         <label class="dzc-field" style="margin-top:14px"><span>Or enter an existing token</span>
           <input id="sync-token-input" type="text" placeholder="six words"
                  autocapitalize="none" autocorrect="off" spellcheck="false"></label>
         <button class="btn btn-outline btn-sm" type="button" onclick="App.syncJoin()">Join</button>`;
    openModal('modal-sync');
  }

  // Discord's mark, Dropfleet's copy of it (app.js).
  const DISCORD_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>';

  function syncDiscordSignIn() { FleetSync.discordSignIn(); }
  function syncDiscordSignOut() {
    FleetSync.discordSignOut();
    openSyncModal();
    if (window.DZCBuilder) DZCBuilder.say('Signed out', 'check_circle');
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
    { date: '2026-11-15', title: 'Transports in other Groups', items: [
      'Full Transports in other Groups are no longer offered. Picking one bought a second Transport and deleted the Squad’s own.',
      'Moving a Squad into another Group now says what was removed.',
      'Settings has a switch to hide Transports in other Groups.',
      'Transport cards show the points and the empty spaces. A card that buys another Transport says so.',
      'Lifthawk Troopship weapons show again, and long upgrade notes no longer squash weapon cards on iPad.',
      'Warnings and refusals are shorter and plainer, and so is this list.',
    ] },
    { date: '2026-11-09', title: 'Shared Transports keep every Squad whole', items: [
      'Two Squads of three Legionnaires can share a Squad of two Bear APCs, one Squad in each. Three Squads of two cannot, because one would be split.',
      'A Battle Bus carrying two or more Squads can ride a Leviathan or a Kraken. The same goes for any Transport full of whole Squads.',
      'Boarding a second Squad into a full Transport adds another Transport to its Squad when that keeps everyone whole.',
      'Two Squads in one Group, each in its own Transport, are told how to share one Transport Squad.',
    ] },
    { date: '2026-11-07', title: 'Generated Units tab and print fixes', items: [
      'Bioficer Generated Units have their own tab in the unit picker. They are Spawned in play, so they’re locked, but every stat card opens.',
      'The number inside a solid transport symbol stays readable on a black and white printout. Printers had turned it solid black.',
      'Rules text is a print option. Untick it to leave off the Rules used section.',
      'A Genitor’s RM print on their own line with their own points. Group and army totals are unchanged.',
    ] },
    { date: '2026-11-05', title: 'Ride a Transport from another Group', items: [
      'Linked transport offers Transports in other Groups. Choosing one moves the Squad and its cargo into that Group, and a Group left empty is removed.',
      'A Transport carrying two Squads keeps its button and explains why nothing is offered. Only the top Transport is shared (3.2.4.1).',
      'A fifth Squad refused a Transport names the four Squad limit.',
    ] },
    { date: '2026-11-04', title: 'Plain text lists paste into Discord', items: [
      'Copied text has one heading for the army, one per Group and one for the Commanders, with a • on every Unit, upgrade and Commander. Discord no longer turns each line into a heading.',
      'A copied list pasted back in keeps every Group, named ones included, even from before this change.',
    ] },
    { date: '2026-10-24', title: 'Fauna', items: [
      'TTCombat’s 1 October supplement is in. All 14 Fauna, Daggers to the Typhon, have pictures and their own tab in Unit Reference.',
      'Interactive Rules has a chapter for their rules, and each one on a card opens it.',
      'Turn on Apex in armies in Settings to add the three Apex to any army. In casual games Intelligent allows one Group of them, a single Squad that doesn’t count toward your Groups or Pass tokens.',
    ] },
    { date: '2026-10-02', title: 'Text only Groups', items: [
      'Print and Play can show each Group as plain text, listing its units and how many.',
    ] },
    { date: '2026-09-29', title: 'FAQ answers under their rules', items: [
      'Each FAQ answer also appears under the rule it covers.',
      'Rules changed by errata show the errata version.',
    ] },
    { date: '2026-09-29', title: 'Four rules calls', items: [
      'A Commander can go on a Transport Squad. A Transport is a Unit, and 3.2.5 puts Commanders on Units.',
      'Aux Gates and the Siegestrider Lion’s Integrated Gate can’t be taken with Units aboard, like any Gate. Their passengers start in Holding.',
      'Cling is one Squad per Aircraft, so a Squad of two Gunships takes two clinging Squads.',
      'The Porphyrion’s hold is full of its Venus Drones (Director), so nothing else boards it.',
    ] },
    { date: '2026-09-29', title: 'The FAQ in Interactive Rules', items: [
      'TTCombat’s 43 FAQ answers are a searchable chapter of Interactive Rules.',
    ] },
    { date: '2026-09-29', title: 'Sign in with Discord', items: [
      'Sync can use your Discord account in place of a six-word token, like the Dropfleet builder. Sign in on each device and your armies follow.',
      'Dropfleet fleets and Dropzone armies stay separate.',
      'A device on a token stays linked when it signs in, so your other devices keep in step.',
    ] },
    { date: '2026-09-29', title: 'Behemoth and faction chapters in Interactive Rules', items: [
      'Behemoth rules and Faction rules are new searchable chapters after the rulebook. Faction rules has a section per faction.',
      'The source line in a rule’s popover opens that rule in the book.',
    ] },
    { date: '2026-09-29', title: 'Interactive Rules on phones and offline', items: [
      'On a phone the chapter list stays under the top bar and scrolls sideways. You no longer scroll back up to change chapter.',
      'Pictures in Chapter 12, the Feature tokens and the turret tables show offline.',
      'The rulebook shows a loading message, and an error if it fails, in place of a blank screen.',
    ] },
    { date: '2026-09-29', title: 'Inch marks and Command Points', items: [
      'Inch marks all use one style. Behemoth cards print a straight one and other cards a curly one.',
      'In Play, Command Points opens Abilities (5.1) in Interactive Rules.',
    ] },
    { date: '2026-09-29', title: 'Play mode counts Behemoth cargo and Collector RM', items: [
      'Pass tokens count a Behemoth’s cargo as its own Group, as the builder does.',
      'Collector Units (Silence, Data Strike, Device) get an RM counter in Play, up to their Collector number.',
      'Aux Transport is flagged on the unit page and in the unit picker as well as the reference grid.',
    ] },
    { date: '2026-09-29', title: 'Each Variant chooses its own upgrades', items: [
      'A Squad with several Variants is offered upgrades per Variant (3.2.3). An Archangel Interceptor can take a missile its Fighter-Bomber does not.',
      'Two Terrors of different Variants each pick their own starred gun, and each must take one.',
    ] },
    { date: '2026-09-29', title: 'Behemoth Power and Systems Damage tables', items: [
      'Power & Activating Behemoths (1.3) is its own rule, with every action’s PT cost.',
      'The Systems Damage table shows its result numbers again, one result per line.',
      'Move On Entry, Drop Harness Entry and Aiming for Systems Damage are separate rules.',
    ] },
    { date: '2026-09-29', title: 'Rules named in refusals open', items: [
      'The rule named in a refusal opens. A rulebook section goes to Interactive Rules, and a faction rule like Genitor X, Gate or Cling shows its text.',
      'Behemoth Gear appears in the unit page’s rules list and on both printed sheets.',
      'The printed sheet lists only what the Squad’s own Variants have.',
      'Misspelt rules on cards read correctly on their chips.',
      'Faction rules name their faction in sentence case. A Behemoth rule’s page says it belongs to the Behemoth rules.',
    ] },
    { date: '2026-09-29', title: 'Squads match across every view', items: [
      'The printed army sheet shows what a Squad carries and its Variant’s Gear, matching the builder. An Alcyoneus had printed the Porphyrion’s.',
      'Behemoth Gear shows on the Squad card and in Play mode.',
      'A card’s upgrade footnote sits beside the buttons on the Squad card.',
      'Starred choices show their star. The Type 7’s two guns have the card’s “or” between them.',
      'A Transport that carries one shape or another counts only the one in use.',
      'The Transport chooser prices Battle Buses, Leviathans and Junos.',
      'Play mode stops pricing upgrades you already bought.',
      'The unit picker shows only rules every Variant has.',
    ] },
    { date: '2026-09-29', title: 'Rules open the right text', items: [
      'LT and Linked on Behemoth weapons open Limited Traverse and Linked. They had opened Limited.',
      'The Mining Engine’s Vent Repeater lists its self-damage under Capacitors in place of Tracking.',
      'First Strike no longer links the word Strike in its own text.',
      'Guard, Drone Base and Remote Drone carry the 3.02 UCM errata.',
      'Behemoth rules no longer split words like “Sys tems” and “Behe moth”.',
    ] },
    { date: '2026-09-29', title: 'Transport FAQ and faction card rules', items: [
      'An Auxiliary Transport counts as a Squad in a shared Transport, and so do its passengers. Two Buggy Squads carrying Legionnaires and Hazard Suits fill a Vulture’s four.',
      'Buggies carrying other Squads go in one Vulture, never split across two Ravens.',
      'Only the top Transport is shared. An Atlas carrying two Squads stays at the top of its Group.',
      'Commanders can’t join Pungari (Subservient).',
      'A Group of Gates isn’t held to the quarter-of-the-limit cap. A Behemoth and the Squads aboard it are capped as two Groups.',
      'Empty Groups no longer count toward the Group limit. A second Rare Crow Dropship is refused.',
      'A Bioficer non-Infantry Unit with a Commander gains Puppeteer 9”.',
      'The Shaltari Support Grav-tank takes 3 to 9, as the errata says.',
    ] },
    { date: '2026-09-29', title: 'Every stat card rechecked', items: [
      'The Type 7 Grand Walker takes its Rotary Cannons or its Incinerators, as the card’s OR says. The Incinerators’ range had read “OR 9””.',
      'The Type 6 Grand Walker carries only as a Porphyrion, and the Siegestrider only as a Lion.',
      'The Explorator carries 12 squares, and 6 triangles or 8 diamonds.',
      'Advanced Genitors and Generated Units show their gold border. That covers the Gauntlet Genitor Circle, Beta, Drake, Gamma, Hand and Gun Hand.',
      'The Totem Shieldspire’s Shield is Zones 6” 5+, as reprinted. It no longer adds Friendly Vehicles and Aircraft.',
    ] },
    { date: '2026-09-28', title: '13 new Bioficer Units and the reissued rulebook', items: [
      'The 25 September Bioficer cards are in. They add the Calculi and Cortex Command Skimmers, Tenor Scout Skimmer, Terror Heavy Battle Skimmer, Tremor Destroyer Skimmer, Fury Interceptor, Gauntlet Genitor Circle, and the Generated Beta, Drake, Gamma, Hand, Gun Hand and Spitters.',
      'The Terror must take exactly one of its six starred guns, as its card says.',
      'Epsilon loses Hardy 3+, and the Hulk Blades’ Decon Blades are Ac 2+, as reprinted.',
      'Rules follow the 23 September reissue. Field gains “This Weapon’s Ac and R values cannot be modified.”',
    ] },
    { date: '2026-09-14', title: 'Squad stats in Play mode', items: [
      'Each Squad in Play shows the stats opponents ask about. Vehicles show Move and Armour, and Infantry show Move, Offence, Defence and Bravery. Reported by reddeth_38.',
      'Damage Points and Power stay in their live trackers below.',
    ] },
    { date: '2026-09-13', title: 'Landing tip opens this app’s Interactive Rules', items: [
      'The landing screen’s Interactive Rules tip opens Dropzone’s own rules. It had opened the Dropfleet builder’s.',
    ] },
    { date: '2026-09-13', title: 'The whole 3.02 book in Interactive Rules', items: [
      'Interactive Rules on the home screen holds the Dropzone Commander 3.02 rulebook word for word, bold included, as one linked page.',
      'Rule names, section names and “see page” references are links. Back returns you to where you were.',
      'The contents list nests each chapter’s sections, so 4 Game Rounds holds the Initiation, Activation and End Phases.',
      'Every table is a real table, Energy vs Armour and both stats bars included. Diagrams come from the PDF, tokens sit beside their rules, and each of the twelve scenarios opens in the Scenario Reference.',
      'Errata are in. AWACS reads “with a +1Ac bonus”, Strafe loses its doubled full stop, and 7.1 ends its sentence.',
    ] },
    { date: '2026-09-13', title: 'Fauna scenarios name Living Weapons and Bloodthirsty', items: [
      'The Fauna scenarios name Living Weapons and Bloodthirsty without writing out their rules.',
    ] },
    { date: '2026-09-13', title: 'Scenario pages match Dropfleet’s', items: [
      'Each scenario shows Entry, Objectives, Variants and Special Rules on the left. The game size switch, map and Map Key sit on the right.',
      'Every objective has its own heading with the rulebook’s rule and an explanation of each term it names.',
      'The Map Key shows what the book prints beside each line, such as turret and Feature tokens, Object tokens, Secure discs and the Centre line. Strategic Points, Demolish, Death From Below and both Hunting Grounds list each keyed item separately.',
      'All sixteen scenarios have score sheets that follow game size and Variant. Crucible’s Hold Variant scores only carried Objects, and Skirmish drops its Raze line.',
      'Targets of Opportunity’s Data Download has its own counter. Death From Below’s first Variant stops marking Round 4, and Protect counts a Zone once.',
      'Ground Control lists its Zone Placement rule. The Source link above each scenario opens TTCombat’s Dropzone resources page.',
      'The Random button is gone, since players choose a Scenario (3.3).',
    ] },
    { date: '2026-09-13', title: 'Landing screen changes', items: [
      'The landing screen points once to the Dropfleet builder’s Interactive Rules. Close it and it stays closed on that device.',
      'The landing screen fills the window, with the WarLore footer below the fold.',
    ] },
    { date: '2026-09-13', title: 'Nothing scrolls sideways', items: [
      'On a 320px phone, New Army shows the six factions two across.',
      'On a phone, Scenarios shows each turret weapon as its name over a grid of Arc, Range, Attacks, Accuracy, Energy and Special.',
    ] },
    { date: '2026-09-13', title: 'WarLore footer', items: [
      'The shared WarLore footer sits at the bottom of the landing screen, the armies list, the Unit Reference and the Scenarios page. It links to every tool.',
    ] },
    { date: '2026-09-13', title: 'Score sheet title line', items: [
      'A folded score sheet keeps its rounds and players on the title line.',
      'The VP scored line is gone. Each player’s total is on their button.',
    ] },
    { date: '2026-09-12', title: 'Epsilon, Grubs and Hulk Blades', items: [
      'TTCombat’s 260911 Bioficer stat cards add three Generated Units.',
      'The Epsilon costs 30pts. It is a floating bio-printer with Delayed, Grubsinger, Hardy 3+ and Puppeteer 1”.',
      'Grubs are 5pts and come in Squads of 1 to 3 with Living Weapons.',
      'Hulk Blades are 30pt Hulks with Decon Blades in place of Winnow Carbines.',
      'Nothing else on the Bioficer cards changed.',
    ] },
    { date: '2026-09-12', title: 'Skirmish halves points and KP', items: [
      'In Skirmish every points or KP requirement shows halved, on the card, in hover text and on the score sheet (rulebook 9.5).',
      'Attrition every 200 KP shows 200 struck through with 100 beside it. Displace, Dominate and Secure work the same way.',
    ] },
    { date: '2026-09-12', title: 'd66 chart removed', items: [
      'The d66 chart and the Scenario Generator are gone. The rulebook has no such chart, since players choose the Scenario, game size and Variant (3.3).',
      'The Scenario Reference is the one Dropzone scenario page.',
    ] },
    { date: '2026-09-11', title: 'Scenario pages with live maps', items: [
      'Every scenario from the rulebook and the Fauna pack has its own page, with a redrawn map and every rule it names, word for word.',
      'Pick Skirmish, Clash, Battle or Reconquest and the map drops Zones only used in bigger games. Skirmish also shows halved points and KP requirements.',
      'Turning on a Variant updates the map. Turrets and Features appear, removed Objects and points go, and struck objectives are crossed out beside the Variant’s own.',
      'Fauna scenarios show their Entry, special rules and Variant.',
      'There is a d66 chart for the twelve rulebook scenarios.',
      'Scenario headings and the index lose their gold diamonds.',
      'A score sheet has counters for each objective’s VP, following game size and Variant, with rounds, players and a running total.',
    ] },
    { date: '2026-08-31', title: 'Upgrades in compact view', items: [
      'Compact view shows upgrades as a strip with the name, Variant and buy button. It had hidden them along with the weapon cards.',
      'Upgrade buttons appear only under the Variant they belong to. A block for a model you don’t field shows the printed price.',
      'Taking the Harrier Gunship’s free option no longer flags a data error.',
      'A bracket on a stat card covers every rule since the last bracket. The Wolf, Jackal and Dingo lose the AWACS 12” and Command Centre meant for the UCM Heavy Buggy.',
      'Ten Units are fixed this way, including a PHR Type-2 and a Shaltari Warstrider that had both P5+ and P3+.',
    ] },
    { date: '2026-08-29', title: 'Rulebook 3.02 and the reissued stat cards', items: [
      'The app uses the 3.02 rulebook and the 21 August cards. List building is unchanged.',
      'Assault, AWACS, Field, Infiltrate, Strafe, Strong, Surveyor, Subterranean and seven more rules have their 3.02 wording.',
      'Scourge lose the Support Beetle and gain the Ravager AA Beetle at 40pts. The Battle Skimmer loses Killer and Bringer, and the Battle Beetle loses Slasher.',
      'Shaltari Battlestrider and Scoutstrider Squads are 2 to 6, and Main and Support Grav-tanks 3 to 9. The Gunstrider’s Demo drops to 2 and the Heavy Grav-tank’s Particle Cannon goes to E10.',
      'PHR’s Type-3 EM Walker and one Behemoth gun changed too.',
      'An army holding a withdrawn Unit, Variant or upgrade shows an error naming what is missing.',
      'UCM cards weren’t reissued, so their four changes come from the errata document. Large goes on the Ferrum Drone Base, the Dominion Heavy Bomber and the Super Gunship, and the Osprey Gunship gains its Twin UM-5 Gatling.',
    ] },
    { date: '2026-08-23', title: 'Shaltari Groups by cost', items: [
      'Two or more non-Gate, non-Aircraft Shaltari Squads can form a Group if they cost 250pts or less together. Over the cap, the cost is named.',
      'A Shaltari Group holding an Aircraft follows 3.2.4 like any other.',
      'The glossary has this rule, plus a Bioficer rule on Generated Squads embarking into Genitor Units.',
    ] },
    { date: '2026-08-22', title: 'Exported lists import intact', items: [
      'Import reads the Share text list with its Group headings and indented cargo, three levels deep, clinging Squads included. Lists from elsewhere are still read flat.',
      'The Commander imports too, with its level, the Squad it rides with and its name.',
      'A Vampire Squad always shows its Cling control, even with no Aircraft in the Army.',
      'A Group with two tops offers the cling that makes it one Group. A Scourge Gunship beside a Squad of Vampires is told the Vampires can cling to it.',
    ] },
    { date: '2026-08-22', title: 'Cling to an Aircraft', items: [
      'A Vampire Squad has a Cling to button listing every Aircraft in the Army with at least as much initial DP as the Squad.',
      '2 Vampires need 2 DP, so a Scourge Gunship works. 4 need a Harbinger, and a Marauder won’t do.',
      'Picking one moves the Squad into that Aircraft’s Group.',
      'Clinging Squads ignore Transport Symbols. A Harbinger with three Battle Beetles inside still reads as full with four on the outside.',
      'An Aircraft takes one clinging Squad, and none is ever offered another Vampire Squad.',
      'A clinging Squad grown past its Aircraft’s DP says so, with both numbers.',
    ] },
    { date: '2026-08-22', title: 'One top Squad per Group', items: [
      'Two Squads in one Group, each in its own dropship, are flagged as two Groups.',
      'The suggested fix is one your faction can use. Shaltari are told to give each Squad its own Group, since a Gate never carries anything in.',
      'Suggestions no longer mention a Transport where none can carry either Squad, or putting one Squad aboard another where the game forbids it.',
      'Duplicate gives a copy its own Group when it needs its own Transport. A copy that fits the existing Transport stays put.',
    ] },
    { date: '2026-08-21', title: 'The Unit Reference prints', items: [
      'A Print button on the Unit Reference prints a whole faction. Each Unit appears under its category with Variants, prices, stats, every weapon including unbought upgrades, and the glossary at the back.',
      'It prints what is on screen, so a filter or search narrows the sheet. The head line says which, and the preview shows the page count.',
      'The preview has the same Compact, Ink-saver and Art switches as the army sheet. Ctrl+P prints the sheet.',
    ] },
    { date: '2026-08-21', title: 'Duplicate a Squad, and the Mini Arc Caster', items: [
      'Every Squad has a Duplicate button beside its bin. It copies models, Variants, weapon upgrades and any Raw Materials aboard a Genitor.',
      'The Transport is copied too. A copy that won’t fit the existing one buys its own (3.2.4.1).',
      'Duplicating a Transport brings its cargo along. Commanders aren’t copied (3.2.5).',
      'Rare and Unique Squads won’t duplicate past their limit, and say which rule stopped them.',
      'The Harbinger Dropship’s Mini Arc Caster can be bought for +5pts.',
    ] },
    { date: '2026-08-17', title: 'Steppers explain their limits', items: [
      'Command Points + is often at its limit. CP refills only to your highest Commander Level, and every Commander is Level 0 in Round 1 (4.1.1).',
      'Steppers dim when they can’t go further. Pressed anyway, they give the reason, such as “At your Commander Level” or “No CP to spend”.',
      'Command Points and Pass Tokens fit on one row each. Your own Group count shows as plain text.',
      'Category spend reads “110/495”, and the Group count reads “10/16 Groups”.',
      'The Groups screen shows the army’s total model count.',
      'In Play Mode the unit picture behind a Squad is in full colour, without the sideways fade.',
      'The Play button has a play triangle icon.',
    ] },
    { date: '2026-08-17', title: 'Play Mode feedback and a steady layout', items: [
      'Status Tokens use the rulebook’s icons from page 51 and keep one size set or unset, so nothing shifts.',
      'Each press shows a label, such as “+1 damage”, “−1 damage” or “Destroyed”. A press that changes nothing says so.',
      'Numbers update in place. The screen no longer redraws under your finger or closes an open rule.',
      'Each Squad carries its own tappable rule chips. Rules for one Variant show under the Variants the Squad fields.',
      'The model picture sits faded behind its numbers.',
      'The Initiative roller is gone. Your highest Commander Level is on the Command Points card.',
      'Rule chips open their own faction’s glossary on every screen.',
      'The top bar wordmark keeps its shape, and is hidden below the phone breakpoint.',
    ] },
    { date: '2026-08-13', title: 'No more reloads on Firefox for iOS', items: [
      'On Firefox for iOS the app reloaded about once a minute and threw you out of your list. It no longer reloads itself.',
      'You still get the live version whenever you’re online.',
      'The offline copy checks for updates every half hour.',
    ] },
    { date: '2026-08-13', title: 'Shorter printed lists', items: [
      'The rules appendix is two tight columns and starts right after the army. Each keyword runs into its text as one paragraph.',
      'The army stays in one column, so a Transport and its cargo stay together.',
      'Groups lose their box and weapons lose the line under each row. A Group still never splits across a page.',
      'Type sizes are cut from fifteen to four.',
      'A nine-Group army went from 4.02 A4 pages to 2.80, with no filled backgrounds.',
    ] },
    { date: '2026-08-13', title: 'Ctrl+P prints the sheet', items: [
      'Ctrl+P, the browser menu and print to PDF extensions print the deployment sheet. They had printed a blank page.',
      'On the Armies list or the Unit Reference, Ctrl+P prints the page you’re looking at.',
      'The four numbers a Commander’s Level buys each have their own cell. The number is large, with what it is and when you use it underneath.',
      'Stat cells print with no background fill. A nine-Group sheet went from 4.0 pages to 3.3.',
      'Ink saver prints stat values black as well as labels. Only cargo symbol digits keep their colour, because it shows the shape.',
    ] },
    { date: '2026-08-13', title: 'Ink saver and compact on by default', items: [
      'Print opens with ink saver and compact on. Your choice is remembered after the first print.',
      'A Squad prints on two lines. Capacity and RM sit on the name line, and the Squad’s rules share the stat line.',
      'Stats print stacked as icon, number and label, all in one narrow line.',
      'The sheet no longer shows whether a Squad is Standard, Vanguard, Heavy or Support.',
      'The warning that Squads will begin Reserved is gone from the sheet.',
    ] },
    { date: '2026-08-13', title: 'Printed sheet matches the builder', items: [
      'Stats print in the builder’s grid, icon over number with the label under it. Only the stats the card carries appear.',
      'Weapon arcs print as the stat card glyph with letters beside it. Keywords print as outlined chips.',
      'Variants print their own photograph where one exists. When every line in a Squad has its own, the general photo is dropped.',
      'The faction colour marks Group headings and the line beside a carried Squad. Ink saver turns it all black.',
      'A Group shows what carries it, and the army prints your notes.',
      'Capacity prints as symbols, the way the screen draws it.',
    ] },
    { date: '2026-08-13', title: 'Toolbar alignment and carry lines', items: [
      'Every row in the Add Units toolbar starts on one left edge.',
      'The carry line ends at the edge of the picture. A new link draws itself from the carrier into the cargo, while opening an existing army draws nothing.',
      'Linked transport has the accent fill and icon tile, and Add Transports is outlined.',
      'Group cards in the list name the Transports carrying them.',
      'Pictures on Squads and Variant blocks are a fifth bigger on desktop and scaled up on phones. At 640px and below they stay inside their box.',
    ] },
    { date: '2026-08-13', title: '57 more Variant photographs', items: [
      'Variants with their own miniature show it, and the rest use the unit’s picture. That count rose from 98 of 199 to 155.',
      'Lettered Variants like Polecat A, Eagle B, Wolverine D and Juno A1 are matched by model name.',
      'Photos match despite plurals and caption typos. The Katana, Slayer, Jaguar, Menchit and Pizzaro gained theirs.',
      'Renamed Variants are found through their siblings, so the Tormentor gets its Slayer Heavy Tank (Acid Streamer) photo.',
      'Where two photos can’t be told apart, the unit’s own picture shows. 44 Variants have none of their own, including the Styx, Greave, Tachi and Falcon-A.',
    ] },
    { date: '2026-08-12', title: 'Linked transport button', items: [
      'A Squad’s Transport button is renamed Linked transport and shows a chain icon. The Group’s Add Transports button is unchanged.',
      'On narrow phones the cost and bin wrap together, and a Transport’s own row fits on one line at 320px.',
    ] },
    { date: '2026-08-12', title: 'Add Transports lists fitting ones first', items: [
      'Add Transports lists the ones that fit your Group first. With Legionnaires, the Bear APC, Raven Light Troopship and Vulture Troopship lead, and a Group of tanks gets triangle carriers first.',
      'The rest stay below in sort order (3.2.4). A Group with every Squad already aboard keeps the normal order.',
    ] },
    { date: '2026-08-12', title: 'Shorter picker toolbar', items: [
      'With Sort and filter open at 390px, the picker toolbar is five rows, down from seven. Closed, it is two.',
      'Chips are 36px tall. Add, Clear and the two toolbar buttons stay at 44px.',
      'Sort, filters and Fits share one wrapping row, and the toolbar buttons sit beside the search field.',
      'Below 390px the old layout stays, still shorter than before.',
    ] },
    { date: '2026-08-12', title: 'Group buttons stay by the name', items: [
      'On a phone the duplicate and remove buttons stay beside the Group name, and the three numbers move to the second line. Desktop is unchanged.',
    ] },
    { date: '2026-08-12', title: 'No splitting one model across Transports', items: [
      'A Unit bigger than a Transport’s whole capacity can’t ride in it (3.2.4.2). A Ferrum Drone Base fills 18, so only the Albatross can take it, never three Condors or nine Crows.',
      'Fifteen such pairs across five factions are gone. They include a Type-4 Battle Scorpion in Neptunes or Njords, a Grievance Genitor Ark in Digits, a Resistance Super Heavy Tank in Carryhawks and UCM tanks in Crows.',
      'Legal pairings are unchanged. Three Sabres still fill one Condor and six fill two.',
      'A saved army using a forbidden pairing still opens, with that Group marked illegal.',
    ] },
    { date: '2026-08-12', title: 'Last small controls enlarged', items: [
      'The weapon upgrade buy button and the Play Mode opponent Group count are at least 44px.',
      'Rule chips, footer links and the Energy number on a weapon card stay smaller on purpose.',
    ] },
    { date: '2026-08-12', title: 'Category spend labels fit', items: [
      'Standard and Vanguard fit their column in Category spend, even before the webfont loads.',
    ] },
    { date: '2026-08-12', title: 'Units first in Add Units', items: [
      'On a phone, Sort, filters and Fits fold behind one button. The first unit card starts 275px down, up from 467px.',
      'That button shows a count and lights up when a filter is on. Desktop is unchanged.',
      'Phone modals have slimmer margins, giving unit cards 348px of a 390px screen. The search placeholder fits down to 320px.',
      'Search boxes use the app’s typeface, Jost.',
    ] },
    { date: '2026-08-11', title: 'Dropfleet fleets kept out of your armies', items: [
      'Dropfleet and Dropzone sync separately. Turning on sync in one app no longer turns it on in the other or merges their lists.',
      'Your existing token still works, and names a different list in each game.',
      'Fleets that landed in your army list are removed the first time this app opens.',
      'Every edit is timestamped again, so sync keeps the latest copy across devices.',
      'An edit on a phone syncs straight away.',
    ] },
    { date: '2026-08-11', title: 'ATV and Archangel weapons show', items: [
      'Resistance ATVs and the UCM Archangel Fighter-Bomber show their weapons in the builder and on the printed sheet. All four loadouts have their guns.',
    ] },
    { date: '2026-08-11', title: 'Commanders don’t count toward the Group cap', items: [
      'A Commander’s points no longer count toward a Group’s quarter of your points cap (3.2.5).',
      'The Group meter matches the rule. Your army total still counts every point.',
    ] },
    { date: '2026-08-11', title: 'Every keyword has a rule', items: [
      'Nanomachines on the Type 7 Grand Walker, Particle on the Dragon, Razorworm Pod on the Terror Mech and Scrambler on the UCM Light Battle Mech open their rules.',
      'All 2,062 keywords the app prints have a glossary entry.',
      'Unit pages no longer cite a stat card PDF page.',
    ] },
    { date: '2026-08-11', title: 'Raw Materials as a count', items: [
      'The Raw Materials stepper shows a count with its price, in place of “3 of 12”. Each RM token costs 5pts.',
      'The limit of 12 still applies, and the plus button says so when it refuses.',
    ] },
    { date: '2026-08-11', title: 'Bigger controls and readable faction colours', items: [
      'Thirty small controls are at least 44px. Most were in Play Mode, plus the Variant stepper and the picker’s Add button.',
      'The two Victory Point counters still share one row.',
      'Unset Status Tokens are readable.',
      'UCM, Resistance, Shaltari and PHR use a darker shade for small text, and labels on coloured fills switch to black or white. A PHR chip label went from 1.9:1 to 8:1.',
      'Play Mode uses the army’s faction colour.',
      'Changelog headings, the Variant chip, “just now” on army cards, and the Rare and Aux Transport flags meet contrast.',
    ] },
    { date: '2026-08-11', title: 'Tokens clear and Pass tokens can be spent', items: [
      'Ticking a Group activated clears its Status Tokens (6.4.5). A token placed after ticking stays, and unticking restores them.',
      'Obscured is set on the Squad, as Smoke and Stealth say.',
      'Pass tokens can be spent. The card shows what is left of what you were given, and the count resets every Round.',
    ] },
    { date: '2026-08-11', title: 'New stat icons', items: [
      'Damage Points, Power, Defence and the grid and list toggle use Phosphor icons.',
      'The Damage Points hexagon is an outline so it stays readable at small sizes.',
    ] },
    { date: '2026-08-10', title: 'Variant photos, Triton upgrades and Behemoths', items: [
      'Variants with a picture show their own. 98 of the 199 have one, taken from the previous edition’s cards, so some are older sculpts.',
      'The Triton can take the RM-1 Stealth Missile Battery with either the Twin RX-20 Miniguns or the RM-7 Skyhammer Missiles. The Miniguns and Skyhammers still can’t go together.',
      'Behemoths are allowed below 3000pts. Each counts as one Group against the quarter of your points cap (1.1), so a 410pt Light Battle Mech fits a 1750pt game.',
    ] },
    { date: '2026-08-10', title: 'Animations and helpful refusals', items: [
      'Squads, Groups and armies animate in and out as you add and delete them. Reduced motion turns this off.',
      'A refusal for two unconnected Squads in a Group names which Squad goes aboard which.',
      'The M&A Max icon is gone from weapons. The words stay.',
      'Messages, tooltips and notes lost several hundred dashes.',
    ] },
    { date: '2026-08-10', title: 'Drag handles, Transport button and Foeslayer', items: [
      'Group cards and Squad rows have one visible drag handle at the leading edge, in both themes.',
      'A Squad’s Transport chooser button is labelled “Transport”, and its partner “Take out”.',
      'Two Squads with nothing carrying them get a suggested move, or an offer of a Transport or second Group when nothing fits.',
      'RM-4 Foeslayer Missiles are a Menchit and Styx upgrade only. One already bought on an Ares reprices to the models allowed it.',
      'Focus a handle and use the arrow keys to move a Group, or send a Squad to the next or previous Group.',
      'Settings shows the build number, and feedback mail includes it.',
    ] },
    { date: '2026-08-08', title: 'Gates, Raw Materials and Variant rules', items: [
      'Shaltari Gates sit in their own Group called Gates. It is numbered apart and uses none of your allowance.',
      'A Gate is never offered as a Squad’s Transport. Squads without one in a list with Gates start in Holding.',
      'Genitor Units can buy RM tokens at 5pts each, up to the number in their symbol. That is 12 on a Grievance Genitor Ark and 8 on a Gyro Aero-Genitor.',
      'RM points count toward the army and its Group but no category. They travel in share links and backups, and print as tokens.',
      'Rules for one Variant sit on that Variant. Nineteen moved, like Scanner (Greave).',
      'The builder no longer scrolls sideways on a phone, and Squad photos shrink properly.',
      'Squad alerts no longer repeat the Squad’s name.',
      'Play Mode tracks RM. Spawning takes 4 for Drones and 6 for Hulks, and Decon kills add 2 or 4, up to the symbol’s number.',
      'Squads with Variants lose their overall +/-. Units with no Variants keep theirs.',
    ] },
    { date: '2026-08-07', title: 'Dark mode, phone rail and offline download', items: [
      'Dark mode is readable. It had drawn white text on white cards across the builder, picker, reference, Play Mode and print preview.',
      'Phones show the rail with points left, Groups used and issues.',
      '“Download for offline use” fetches the app itself as well as the art.',
      'The printable faction references are linked.',
      'Variants no longer repeat the unit’s stats.',
      'Import’s instruction line wraps on a phone, and its label sits on the input line.',
      'A new Round refills Command Points up to your highest Commander Level (4.1.1). The Initiative roll shows its total on a six.',
      'In Play Mode a Behemoth counts as its full Groups for Pass tokens and can’t be Concussed or Obscured. It activates once per Power token, refilled each Round.',
      'Behemoths show their Groups Equivalent in place of “Squad 1”, and the rail counts Groups with it.',
    ] },
    { date: '2026-08-06', title: 'Behemoths and weapon cards', items: [
      'Ten Behemoths and the Venus Drone are in the Unit Reference under their own tab. Their 39 rules are in the glossary, and their Gear shows on the card and printed sheet.',
      'They can join armies, and each counts as the Groups it is worth.',
      'Play Mode reads a Behemoth’s full damage points, 18 for a Dragon. Degraded and Crippled are shown.',
      'Weapons show as cards, with all eight fields readable on a phone.',
      'An upgrade that trades transport capacity removes that capacity.',
      'Each of the four categories has its own colour.',
      'Fast Movers and Living Weapons can’t take a Commander. A swap removes the weapon it replaces from the sheet.',
      'Play Mode fits a phone screen.',
    ] },
    { date: '2026-08-02', title: 'Bigger touch targets', items: [
      'Every control is at least 44px on a phone, and the two model steppers have a gap between them.',
      'A failed Create no longer disables the button for the session.',
      'Numbers in transport symbols sit at the shape’s centre of mass.',
    ] },
    { date: '2026-08-01', title: 'Print preview and phone fixes', items: [
      'The print preview counts pages correctly on a phone and never breaks a Group across pages.',
      'Phones have a back arrow, and Play Mode’s Reset game is reachable.',
      'Concussed, Suppressed and Jammed go on the Squad. Obscured stays on the model, and set statuses show their full name.',
      'Group card costs show in full.',
      'The Standard line in Category spend is readable.',
      'Unit Reference stats are no longer cut off.',
      'Unnamed Commanders no longer repeat their Level, and unit pages no longer repeat the unit name.',
      'Empty Groups in Play Mode lose the “orphaned transports” tag.',
      'The Collection search hint fits on a phone.',
    ] },
    { date: '2026-08-01', title: 'Commander Levels and fielded weapons', items: [
      'Each Commander Level shows its CP, Command Card hand and Initiative bonus (4.1). They appear in the chooser, the rail and the printable reference.',
      'Levels a smaller game can’t reach say which game size reaches them.',
      'A Squad’s weapon table lists only the guns it fields, on screen and in print. The rules appendix skips rules for unfielded guns.',
      'Compact view in Settings hides the weapon table and repeated stat grids.',
      'Every Unit names its stat card page and release.',
      'Upgrade conditions show on the unit page, and four cards had theirs fixed.',
      'Hardy reads “a save of 4+”.',
    ] },
    { date: '2026-08-01', title: 'Builder fix, Group order and army notes', items: [
      'The builder draws Squads with a Transport again.',
      'Drag Groups to reorder them. The order matches your printed sheet.',
      'An army can say what it is for. Set it on creation or in the builder, and it travels with links, JSON and text.',
      'Play, Share and Print are in the top bar. On a phone the rail collapses to two numbers.',
      'Army cards have one menu. The picker can show only what you own, and missing art hides itself.',
    ] },
    { date: '2026-08-01', title: 'Faction quick references', items: [
      'Each faction has a printable quick reference with game sizes, Group caps, Rare limits, the Commander ladder, category rules, transport symbols, the roster and its special rules. It is linked from the landing page and footer.',
      'Nine more surfaces have square corners, including the picker cards, rail, Commander chooser, landing tiles and New Army grids.',
      'Share offers a link, plain text with indented Groups, or JSON for Import.',
      'Feedback asks four questions.',
    ] },
    { date: '2026-08-01', title: 'Surprise me and multi Transport Squads', items: [
      'A Squad that needs more than one Transport is no longer called illegal. Six Legionnaires in two Bear APCs is legal.',
      '“Surprise me” builds a legal army for your faction, size and points.',
      'Rules link to the rules they name, so Grav opens Resilient.',
      'Every rule a Unit uses prints in full under its weapon table.',
      'Lists pasted from New Recruit import, without Group nesting.',
      'Sort armies by Recent, Name, Faction or Points.',
    ] },
    { date: '2026-08-01', title: 'Print preview and Import', items: [
      'Print opens an A4 preview with page breaks and a page count. A Group is never split across pages.',
      'Compact, ink-saver and art are set in the preview. Art is off by default.',
      'Import takes a backup, an army, a share link or a New Recruit list, and reports what it couldn’t match. Importing never overwrites.',
      'Pasted lists lose their Group nesting.',
      'Change the points limit by tapping the size in the rail. The per-Group cap follows it.',
      'Variant blocks carry the model count, replacing the per-model dropdowns.',
      'Upgrades show as weapons with arc, range, attacks, accuracy, energy and specials, and the price is the button.',
    ] },
    { date: '2026-08-01', title: 'Commander names, Group copies and backups', items: [
      'Commanders can be named. An unnamed one shows its Level.',
      'Duplicate a Group with every Squad, model, Variant, upgrade and Transport link.',
      'Export every army as one JSON file to keep as a backup.',
      'On a phone a Group opens as its own screen. Desktop keeps three panes.',
    ] },
    { date: '2026-08-01', title: 'Rule values, page numbers and the Albatross', items: [
      'Rules show the value your card prints. “Aegis 6”” reads “within 6” of this Unit”, and “Ineffective: Zones” names Zones.',
      '“Pen 6+” opens Penetrator. It had opened Passive Countermeasures.',
      'Every rule shows its rulebook page in the tooltip and on the printed sheet.',
      'Transport Squads can be carried, so an Albatross can carry a Bear APC.',
      'The picker prices the whole Squad, such as 70pts over “2 × 35”.',
      'Category tabs show counts, and filters appear only when they match something. A paid weapon upgrade filter is added and Unique is removed.',
      'Search covers category, type, weapon rules and glossary aliases, so “evasion” finds Ev1.',
      'Refused controls say why. The model stepper quotes the squad size, and an empty list names the choice that emptied it.',
      'Renaming an army or Group looks editable. Enter saves and Escape cancels.',
    ] },
    { date: '2026-07-31', title: 'Full Squad stats in the army', items: [
      'A Squad in your army shows what the unit page shows, with art, capacity symbol, stats, rules, Variant blocks and the full weapon table.',
      'Choosing a Transport opens a chooser showing each option’s fit, cost and need. Part-empty fits are offered and marked.',
      'The weapon table scrolls in its own box on a phone, and the nesting indent narrows with the screen.',
    ] },
    { date: '2026-07-31', title: 'Add Squad and transport symbols', items: [
      'Add Squad is the widest button in a Group card, in your faction’s colour. Adding closes the picker.',
      'Picker cards show transport symbols (3.2.4.2).',
      'Capacity has its own band in the Group header, with the shape drawn large beside the count.',
    ] },
    { date: '2026-07-31', title: 'The picker holds still', items: [
      'Sorting or filtering keeps your place in the list.',
      'Filter by transport symbol. A shape matches whether a unit offers or fills it.',
      'The Group header shows points against the quarter army cap, Squads, models and each Transport’s used space. Full is green and overloaded is red.',
      'Add Group creates an empty Group without opening the picker.',
    ] },
    { date: '2026-07-31', title: 'Sort, filter and search the picker', items: [
      'Sort by Price, Name, Category, Squad or Capacity, each reversible.',
      'Filter by Rare, Unique, Variants, Carries and Auxiliary.',
      'Search covers names, Variants, weapons and rules. A list view sits beside the card grid.',
      'Unfinished Groups are reported when you stop building. A second Rare Squad is still refused.',
      'The active filter pill is readable, and the search box keeps your typing.',
    ] },
    { date: '2026-07-31', title: 'Groups form around Transports', items: [
      'A Transport can only join a Group alongside a Squad it can carry. Up to four Squads with their own Transports can share a larger one (3.2.4).',
      'An empty Group takes any fighting Unit. After that the picker offers only matching Transports or Squads that fit, and greys out the rest with the rule.',
      'Transports are in the picker. Picking one builds the Transport Squad, links it and sizes it to fill.',
      'With Infantry in the Group the picker offers Troopships and refuses Dropships (3.2.4.2).',
    ] },
    { date: '2026-07-31', title: 'Play Mode, Collection and share links', items: [
      'Play Mode tracks a Round per chapter 4, with CP up to your highest Commander Level, Pass tokens, Initiative as D6 + Level, and damage per model.',
      'Collection counts models and never blocks a legal choice.',
      'Share links carry the whole army in the URL.',
      'Every paid weapon upgrade has its cost, and eight weapons have their correct arcs.',
    ] },
    { date: '2026-07-30', title: 'The army builder', items: [
      'Build Groups, Squads and per-model Variants, with transport nesting drawn as a tree.',
      'Illegal choices can’t be picked.',
      'The print sheet keeps the nesting and adds the full text of every rule your list uses. Groups never split across a page.',
      'All 178 units have their own page, with a 106-rule glossary from the rulebook and faction front matter.',
    ] },
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
      // Back from Discord: join the account's list, then say so. fleet-sync.js
      // has already taken the key out of the URL, before route() below.
      const back = FleetSync.discordFinish && FleetSync.discordFinish();
      if (back) {
        back.then(r => {
          if (window.DZCBuilder && document.body.dataset.view === 'armies') DZCBuilder.renderList();
          if (window.DZCBuilder) DZCBuilder.say(`Signed in as ${r.name}`, 'check_circle');
        }).catch(e => { if (window.DZCBuilder) DZCBuilder.say(e.message); });
      }
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
    openSettings, setTheme, toggleSetting, collectionOn, compactView, faunaOn, otherGroupTransportsOn, applyCollectionSetting,
    renderOfflinePanel, runOfflineSync, deleteOfflineData,
    openSyncModal, syncStart, syncStop, syncNow, syncJoin, syncDiscordSignIn, syncDiscordSignOut,
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
