// Service worker for offline support. Network-first for fresh content when
// online (the app updates often), falling back to cache when offline, and
// populating the cache as resources are fetched.
// Bump this on every deploy so existing clients purge the old cache on activate
// (the app updates frequently — stale assets must not survive a new build).
const CACHE = 'dzc-cache-v439';
// Same-origin code/data that MUST be fresh when online. Network-first alone is
// not enough: fetch() still consults the browser HTTP cache, so a client can
// keep running a stale app.js for as long as GitHub Pages' cache headers allow.
// For these we force a true network hit (cache:'no-store'), falling back to the
// SW cache only when offline. Images/fonts keep normal caching (they're large
// and rarely change).
const FRESH_RE = /\.(?:html|js|css|json|webmanifest)(?:\?|$)/i;
const CORE = [
  './',
  './index.html',
  './css/app.css',
  './css/mobile-fixes.css',
  './css/dzc.css',
  './css/dzc-print.css',
  './js/rank-insignia.js',
  './js/offline-sync.js',
  // Both of these were loaded by index.html and precached by nothing, so an
  // install that happened before either had been fetched went offline without
  // them. Neither is fatal missing — a <script> that 404s takes only itself
  // down, and both callers are guarded — but a precache list that does not
  // match what the page loads is a list nobody can trust, and this is the same
  // shape of drift as a path missing from the deploy staging.
  './js/count.js',
  './js/fleet-sync.js',
  './js/dzc-data.js',
  './js/dzc-share.js',
  './js/dzc-starters.js',
  './js/dzc-builder.js',
  './js/dzc-army.js',
  './js/dzc-icons.js',
  './js/dzc-units.js',
  './js/dzc-play.js',
  './js/dzc-collection.js',
  './js/dzc-shell.js',
  './data/dzc/index.json',
  './data/dzc/rules.json',
  './manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE).catch(() => {})));
});

// The user-initiated offline download (Settings → Offline use) lives in its own
// unversioned cache. It must SURVIVE the purge below: a deploy silently throwing
// away a 28 MB bundle someone chose to download would be indefensible. Its
// contents are still served automatically, because CacheStorage.match() in the
// fetch handler searches every cache, not just CACHE.
const KEEP = 'dfc-offline';

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE && k !== KEEP).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let cross-origin (fonts CDN) pass through

  // The root SW controls the whole origin — desktop AND the /mobile/ sub-app.
  // Both use the same strategy: network-first for fresh content when online,
  // falling back to cache when offline (so each works at the table with no signal).
  const isMobile = url.pathname.includes('/mobile/');
  const offlineShell = isMobile ? './mobile/index.html' : './index.html';

  // Navigations and code/data: bypass the HTTP cache so clients always run the
  // latest build when online. Everything else: ordinary network-first.
  const mustBeFresh = req.mode === 'navigate' || FRESH_RE.test(url.pathname);
  const netFetch = mustBeFresh ? fetch(req, { cache: 'no-store' }) : fetch(req);

  e.respondWith(
    netFetch
      .then(res => {
        // cache a copy of successful same-origin responses (offline fallback)
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      // ignoreVary: the offline bundle is stored by fetch() (Accept: */*) but
      // replayed for <img> requests (Accept: image/avif,image/webp,…). If the
      // host ever sends "Vary: Accept", strict matching would miss every
      // thumbnail the user deliberately downloaded.
      //
      // ignoreSearch: the deploy stamps css/js with ?v=<sha> to defeat the
      // Pages cache, but CORE below precaches the bare paths. Without this a
      // cold offline start would miss every stylesheet and script it had
      // deliberately downloaded. Nothing in this app carries meaning in a
      // query string — share links travel in the hash — so dropping it when
      // falling back to cache is safe.
      .catch(() => caches.match(req, { ignoreVary: true, ignoreSearch: true })
        .then(hit => hit || caches.match(offlineShell, { ignoreVary: true })))
  );
});
