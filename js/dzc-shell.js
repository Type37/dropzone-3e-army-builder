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

  function openSettings() {
    const dark = settings.theme === 'dark';
    $('settings-body').innerHTML = `
      <div class="dzc-set-row">
        <div><b>Theme</b><p>Dark mode is easier at a dim table.</p></div>
        <div class="dzc-seg">
          <button type="button" class="${dark ? '' : 'is-on'}" onclick="App.setTheme('light')">Light</button>
          <button type="button" class="${dark ? 'is-on' : ''}" onclick="App.setTheme('dark')">Dark</button>
        </div>
      </div>
      <div class="dzc-set-row"><div><b>Offline use</b>
        <p>Download the whole app so it works with no signal.</p></div></div>
      <div id="offline-panel"></div>
      <div class="dzc-set-row">
        <div><b>Sync armies online</b>
          <p>Opt in to keep two devices in step. No account, no password.</p></div>
        <button class="btn btn-outline btn-sm" type="button" onclick="App.openSyncModal()">Sync…</button>
      </div>
      <div class="dzc-set-row">
        <div><b>About</b><p>A WarLore project. Game data and art belong to TTCombat.</p></div>
        <button class="btn btn-ghost btn-sm" type="button" onclick="App.openChangelog()">What's New</button>
      </div>`;
    openModal('modal-settings');
    renderOfflinePanel();
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

  function openChangelog() {
    $('changelog-body').innerHTML = `
      <p>The full changelog lives in the repository's README.</p>
      <p><a href="https://github.com/Type37/dropzone-3e-army-builder#changelog"
            target="_blank" rel="noopener">Read it on GitHub</a></p>`;
    openModal('modal-changelog');
  }

  // ------------------------------------------------------------------- init

  function init() {
    loadSettings();
    applyTheme(settings.theme);
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
    openSettings, setTheme,
    renderOfflinePanel, runOfflineSync, deleteOfflineData,
    openSyncModal, syncStart, syncStop, syncNow, syncJoin,
    openChangelog
  };
})();
window.App = App;
