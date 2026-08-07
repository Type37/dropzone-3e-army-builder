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

  /* Feedback goes to the maker's inbox through the reader's own mail app. The
   * body is prefilled with the four questions, because a bare mailto returns
   * "looks cool" and a guided one returns something you can act on.
   *
   * The questions are Dropfleet's, word for word (FEEDBACK_HREF, git show
   * 43773fa:js/app.js:16) with the game swapped -- this is exactly the copy
   * CLAUDE.md §2 says not to rewrite. */
  const FEEDBACK_HREF = 'mailto:warlore1@outlook.com?subject='
    + encodeURIComponent('Dropzone Builder feedback') + '&body='
    + encodeURIComponent(
      'Thanks for helping improve the Dropzone Commander 3E Army Builder.\n\n'
      + '1. What were you trying to do, and could you finish it?\n\n'
      + '2. Did anything look wrong (a points cost, a stat, a rule)?\n\n'
      + '3. What would make you use it for your next game?\n\n'
      + '4. How long have you played DZC?\n'
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
      case 'army':
        show('view-army');
        ctx.innerHTML = back('armies', 'Armies list');
        if (window.DZCBuilder) DZCBuilder.renderBuilder(param);
        break;
      case 'play':
        show('view-play');
        ctx.innerHTML = back('army/' + param, 'Play Mode')
          // btn-ghost-light, not btn-ghost: this sits on the navy topbar, and
          // btn-ghost's grey is picked for the paper background — it came out
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
         * and it is the third "Army Builder" on ours — the tile below says it
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
    // its unit names are in — a header can say one thing over another
    // faction's units.
    if (parsed == null) {
      for (const f of ['ucm', 'phr', 'scourge', 'shaltari', 'resistance', 'bioficer']) {
        try { await window.DZC.loadFaction(f); } catch (e) { /* what loaded still votes */ }
      }
      const l = window.DZCArmy.importList(text);
      if (!l.ok) { report(`<p class="dzc-set-note">${esc(l.reason)}</p>`); return; }
      report(`<p class="dzc-set-note"><b>${esc(l.army.name)}</b> — ${l.matched.length}
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

  /* What's New. Same shape as the Dropfleet builder's log — {date, title,
   * items}, newest first, written for someone using the app rather than
   * reading the commits. No interpunct between date and title: the footer
   * already spends the app's budget for that glyph. */
  const CHANGELOG = [
    { date: '2026-08-07', title: 'A theme that hid the app, and a download with no app in it', items: [
      'Dark mode was white text on white cards. Six of the tokens the builder is written against — its surfaces, its lines, its second ink — were never defined anywhere, so that whole layer stayed hardcoded to paper while the ink dutifully flipped to near-white. The builder, the picker, the reference and Play Mode all went unreadable the moment you touched a switch that has sat in Settings since the beginning. The printed sheet and its preview went with them. Every screenshot is taken in both themes now, which is how this survived as long as it did.',
      'A phone had no rail at all. Points left, Groups used and issues outstanding were switched on by one stylesheet rule and off by a later one, so no phone ever saw them — and with nothing drawn there, nobody saw the fault underneath: the army was sitting in a grid column that no longer existed, pushed off a dead gutter down the left.',
      '“Download for offline use” fetched 26 MB of art and no app. The list it works from named files belonging to a different game, and none of the twelve modules this one is made of, so the group labelled for the rules and the app contained neither. It reads the list the service worker actually caches now, because two lists that have to agree is one list too many. A re-scan would have left that same download describing photos that were gone, and one missing file takes the whole offline copy down rather than one picture, so regenerating it is part of the scan.',
      'The printable faction references were unreachable. Six sheets and an index, already cached for a table with no signal, and nothing anywhere linked to any of them.',
      'Every variant printed the unit’s stats back at you, three and four times over. A Polecat Buggy gave you Move 9”, Armour 4, Damage Points 1 four times in one card. Not one of the 218 variants in the game changes a stat, so that copy had never once said anything.',
      'Import’s one line of instruction was cut to “…or a pas” on a phone, and it is the only line that tells you a pasted list will do. It wraps now. Its label also rested three rows down the middle of an empty box instead of on the line where you type.',
      'A new Round capped your Command Points and never handed you any. Replenishing up to your highest Commander Level is half of 4.1.1, and the losing half was the half that worked, so a Level 5 Commander started Round 2 on nothing. The Initiative roll prints its total on a six as well — that is the one roll with a case that needs it.',
      'Behemoths reached Play Mode a week after they reached the builder, and four of their rules had not travelled with them. One counted as a single Group when Pass tokens are worked out off Group counts and a Dragon is worth five, so every token in the game came out wrong for anyone fielding one. You could Concuss one, and Obscure one, neither of which the game allows. And the biggest model on the table was marked finished for the Round after one activation, when a Behemoth goes once per Power token — four to ten times — and that track was nowhere in the app. Every Behemoth Squad carries it now, refilled at the start of each Round.',
      'Every Behemoth also said “Squad 1”, which is a number its printed card does not carry: they have a Groups Equivalent instead, and that is the one that decides how much of your Group allowance one eats. It is on the reference card, the picker, the Collection and the unit’s own page now, and the rail counts your Groups in it — that meter was counting cards against an allowance counted in Groups, so it read 3 of 16 on a list already spending fifteen.',
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
      'Measured at 390 by 844, every control the app draws: the way back was 18px square, the card menu 24, Settings and the modal close 32, the filter and sort chips 28 high, the search field 36. A finger pad is about 45px across, so all of those were aimed at rather than pressed. Everything clears 44 now, and the model stepper — the most-pressed control here, and two of them sat 2px apart — got the gap as well as the size.',
      'One failed Create killed Create for the rest of the session. The button disabled itself for the length of the work and re-enabled after a render that a throw could step straight over, so it stayed pressed and silent and no click after it built anything until you reloaded.',
      'The number inside a transport symbol sits on the shape’s real centre of mass rather than the middle of its box, which is not the same place on a triangle.',
    ]},
    { date: '2026-08-01', title: 'A run spent looking at it', items: [
      'The print preview was telling a phone that a one-page army was three pages, and drawing a page break through the middle of a Squad — through a Group, which is the one thing the whole sheet is built to keep whole. The sheet was being stretched to the height of your window and then measured, and the measuring itself was mixing what you can see with what the paper actually is. Both fixed; a phone and a desktop now agree, and they agree with the paper.',
      'On a phone there was no way back. The back arrow lives in a strip that had been hidden below 768px since the days of a separate mobile build, so the only way out of an army was the wordmark — which goes to the front page, not back — and Play Mode’s Reset game could not be reached at all.',
      'Status Tokens go on the Squad, which is what the rulebook says three separate times. Concussed, Suppressed and Jammed were on every model, so a Squad of five had five of each and you could record a state the game cannot produce. Obscured stays on the model, because that one is about where a model is standing. A status you have set now says its whole name instead of its first letter.',
      'Every Group card was printing its cost with the last digits under the drag grip: 100/50, with the rest of the ceiling hidden. That number is how you tell whether a Group is legal.',
      'Category spend drew the Standard line in the same green as the card it sits on, so the one row that explains what the other three mean was a smudge beside a number.',
      'The Unit Reference was cutting the ends off its own stats — 5+ DEFENC, 5+ BRAVE — on nearly every card in the grid.',
      'A Commander you have not named reports its Level as its name, and then both the rail and the printed sheet said the Level again beside it. The unit page did the same with the unit’s name.',
      'A Group with nothing in it was tagged “orphaned transports” in Play Mode and told a rule about transports it did not contain.',
      'The search box on the Collection was cutting off the line that tells you what you can type. On a phone the magnifying glass beside it gives way instead of the words.',
    ]},
    { date: '2026-08-01', title: 'What a Level buys, and guns nobody was firing', items: [
      'A Commander Level says what it is worth. CP replenishes up to your highest Level, your Command Card hand is that many cards, and Initiative is D6 plus it (4.1). Play Mode has run on those three numbers since it was written; the screen where you choose a Level had never been told. They are on every option in the chooser, once in the rail for the army, and on the printable reference.',
      'A Level a smaller game cannot reach says which game reaches it, instead of not being there. At Skirmish there was no way to learn that Levels 6 and 7 exist.',
      'A Squad’s weapon table is the guns that Squad fires. It was printing the whole card — the gun only a Rapier carries, on a Squad with no Rapier in it, and every paid upgrade whether or not you had bought one. The printed sheet does the same now, where it matters more, and its rules appendix stops printing rules for guns nobody in the army can fire.',
      'Compact view, in Settings. A Squad reads as its whole stat card by default; this drops the weapon table and the stat grid repeated under every Variant, and takes away no control.',
      'Every Unit says which stat card page it came off, with the release named beside it. Every rule already cited its rulebook page; the Unit, whose printed card is the one thing this cannot replace, cited nothing.',
      'The sentence that qualifies an upgrade reads on the unit page as well as over the buttons — and four cards had it wrong in the data. Two stopped mid-clause at “May replace transport capacity of” and two held a paragraph of lore.',
      '“A save of 4++”, on every Infantry Unit with Hardy. The rulebook heads the rule “Hardy X” and then reads “a save of X+”, while every card prints “Hardy 4+”, so the value took the plus with it.',
    ]},
    { date: '2026-08-01', title: 'A blank builder, and everything that was never pressed', items: [
      'The builder was drawing nothing at all for any Squad with a Transport, and had been for a day. A helper was used two hundred lines above the line that declares it, which throws rather than coming back empty, so the whole pane stayed blank. Nothing caught it because nothing had ever drawn the builder in a test \u2014 only the pieces it is made of.',
      'Every screen is driven by the tests now, and so is every control on them: the army list, the builder, the picker, both choosers, Share, the print preview, the unit reference, Collection and Play, about seventy controls pressed in turn.',
      'Drag a Group to reorder it. The order is the order on your printed sheet, and that is the deployment plan \u2014 until now it was whatever order you happened to add them in.',
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
      'A Squad that needed more than one Transport was being reported illegal. Six Legionnaires in two Bear APCs is a Group the rulebook itself illustrates, and the app measured them against ONE vehicle\'s capacity — so it said "needs 6, has 3" and there was nothing you could do about it. Fixed, and pinned by six tests.',
      '"Surprise me" builds a whole army to the faction, size and points you have chosen, legal when it stops. It spends the Commander first, Standard before the categories Standard has to pay for, and takes a Transport only where it comes out exactly full.',
      'A rule links to the rules it names. Grav says it ignores Resilient; Resilient is now one tap away, where before you had to know it existed and go looking. Twenty-three of those cross-references were dead ends.',
      'Every rule a Unit uses prints in full under its weapon table, not only behind a hover — because on a phone there is no hover, so a tooltip-only rule was simply missing.',
      'A list pasted out of New Recruit imports. It cannot give you back the Group nesting — a flat list does not record what rode in what — and it says so rather than pretending.',
      'Sort your armies by Recent, Name, Faction or Points, and an empty list is a grid with a tile in it instead of a sentence saying it is empty.',
    ]},
    { date: '2026-08-01', title: 'Print what you can see first, and get your armies back', items: [
      'Print opens a preview: your sheet at A4 with the page breaks drawn on it and the page count in the bar. The breaks are measured rather than spaced every 273mm — a Group is kept whole by the stylesheet, so the preview pushes one that would straddle a boundary onto the next page exactly as the printer will, and then it agrees with the paper.',
      'Compact, ink-saver and art, decided in the preview where you can see what each costs you in pages. Art on the sheet is new; it stays off unless you ask, because it is the biggest thing between a two-page list and a four-page one.',
      'Import. There was an Export button and nothing to put it into, which made the backup a file rather than a backup. A whole backup, one army, a share link or a list pasted from New Recruit all go in through the same box, and the report says what came in and what it could not match. Nothing is overwritten — importing twice adds twice.',
      'A pasted list will not give you back the Group nesting, and says so: a flat list does not record what rode in what.',
      'The agreed points limit can be changed after you make the army. The size in the rail opens it. This mattered more than it sounds: the per-Group ceiling is a quarter of the AGREED number, so agreeing 1500 on the day instead of the 2000 you built at moves what is legal, and there was no way to tell the app.',
      'The per-model variant dropdowns are gone. A Squad of eight was eight dropdowns, and you could not see the mix without opening every one. The variant blocks — which already said what each variant is, which gun makes it that and what it costs — now carry the count, so the thing you read is the thing you press.',
      'An upgrade reads as the weapon it is: the same columns as the table above it, arc, range, attacks, accuracy, energy and every special, with the price as the button. The question an upgrade asks is whether the new gun beats the old one, and a name cannot answer it.',
    ]},
    { date: '2026-08-01', title: 'Commanders, Groups you can copy, and tests that read the markup', items: [
      'Commanders have names, the same way Groups do. An unnamed one reports its Level, so deleting one from the middle can never leave two things called the same thing.',
      'Duplicate a Group — every Squad, its models and their variants, the upgrades and the nesting, with every id reissued so the copy rides its own Transports rather than the original\'s.',
      'Every army as one JSON file you keep. Armies live in your browser, which is free to clear them; sync moves them between your devices but propagates a deletion just as happily.',
      'On a phone a Group is a screen you drill into rather than another slab in a long column; on a desktop the builder keeps its three panes.',
      'A test suite that reads the rendered markup. Three regressions in one night were caught by looking at a screenshot and none by the tests, which was an argument that nothing was testing the markup rather than an argument for screenshots.',
    ]},
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
