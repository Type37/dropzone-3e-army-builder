/* Render tests: what the builder actually puts on the page.
 *
 * These exist because three regressions in one night were caught by opening a
 * screenshot and none by the suite, and all three were plain string bugs that
 * a test could have seen:
 *
 *   - a Group with no stored name rendered "null" has 2 Squads, because
 *     validate() read g.name directly instead of going through groupName
 *   - the army card set --ink for a category colour, which is the GLOBAL ink
 *     token, so every thumbnail repainted its own text colour
 *   - the Collection rail wrapper was given .dzc-coll-body, a class that was
 *     already on all 178 unit rows, and forced a two-column grid onto them
 *
 * Screenshots caught those because they were visual. That is not an argument
 * that looking beats testing -- it is an argument that nothing was testing the
 * markup. So: render the real functions against the real data and assert on
 * the strings.
 *
 *   node scripts/test-dzc-render.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let pass = 0, fail = 0;
const ok = (c, label, extra) => c ? pass++ : (fail++, console.error(`  FAIL  ${label}${extra ? `\n        ${extra}` : ''}`));
const eq = (a, b, label) => ok(a === b, label, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

/* ── 1. Nothing renders a JS placeholder ──────────────────────────────
 *
 * A template literal that reaches an absent field prints the word null or
 * undefined straight into the page. It is never correct and it is the exact
 * shape of the Group-name bug, so it is checked structurally: every `${...}`
 * that interpolates a bare `.name` must go through a resolver.
 */
console.log('\nno template prints a placeholder');

const store = new Map();
const win = {};
const sandbox = {
  window: win, console,
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  },
  fetch: async (p) => {
    try {
      return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8')) };
    } catch { return { ok: false, status: 404, json: async () => null }; }
  }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(path.join(ROOT, 'js', 'dzc-data.js'), 'utf8'), sandbox);
vm.runInContext(readFileSync(path.join(ROOT, 'js', 'dzc-army.js'), 'utf8'), sandbox);
const DZC = win.DZC, A = win.DZCArmy;

await DZC.loadIndex();
await DZC.loadFaction('ucm');

/* Every message validate() can produce, over an army built to trip as many of
 * them as possible. A Group with no name is the default state now, so this is
 * the case that regressed. */
{
  const a = A.create('ucm', 'Render probe', 2000);
  const g = A.addGroup(a);
  A.addSquad(a, g.id, 'legionnaires', 2);
  A.addSquad(a, g.id, 'praetorian-snipers', 2);
  const g2 = A.addGroup(a);
  A.addSquad(a, g2.id, 'ucm-light-battle-tank', 2);

  const v = A.validate(a);
  const all = [...v.errors, ...v.warnings].map(x => x.msg).join(' ~ ');
  ok(all.length > 0, 'the probe army actually produces messages', all);
  ok(!/\bnull\b/.test(all), 'no message contains "null"', all);
  ok(!/\bundefined\b/.test(all), 'no message contains "undefined"', all);
  ok(/Group 1|Group 2/.test(all), 'Groups are named by position in messages', all);

  // groupName is the only sanctioned way to read a Group's name.
  eq(A.groupName(a, g), 'Group 1', 'groupName resolves an unnamed Group');
  eq(g.name, null, 'and the Group really has nothing stored');
  A.remove(a.id);
}

/* ── 2. No custom property collides with a global token ───────────────
 *
 * --ink, --acc, --line, --gold and --danger are app-wide. Setting one inline
 * for a local purpose silently repaints everything inside that element, which
 * is what --ink did on the army-card thumbnails and --acc did on the picker's
 * active chip. Local variables must be named for their job.
 */
console.log('\nno inline style hijacks a global token');

const GLOBAL_TOKENS = ['ink', 'ink-2', 'acc', 'line', 'gold', 'danger', 'surface', 'surface-2', 'surface-3'];
const jsFiles = readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'));
const hijacks = [];
for (const f of jsFiles) {
  const src = readFileSync(path.join(ROOT, 'js', f), 'utf8');
  // style="--x:..." written into markup, which is the only way a local value
  // can shadow a token for a subtree.
  // Read the whole attribute, not the line around it: what matters is the
  // value assigned, and a line number is not a reliable way back to it.
  for (const m of src.matchAll(/style="([^"]*)"/g)) {
    const attr = m[1];
    for (const d of attr.matchAll(/--([a-z0-9-]+)\s*:\s*([^;"]*)/gi)) {
      const name = d[1].toLowerCase(), value = d[2];
      if (!GLOBAL_TOKENS.includes(name)) continue;
      // --acc assigned FROM an accent is the token doing its job, not a hijack.
      if (name === 'acc' && /acc/i.test(value)) continue;
      const line = src.slice(0, m.index).split('\n').length;
      hijacks.push(`js/${f}:${line} --${name}: ${value.trim()}`);
    }
  }
}
eq(hijacks.length, 0, 'no inline custom property shadows a global token');
if (hijacks.length) console.error('        ' + hijacks.join('\n        '));

/* ── 3. A class name means one thing ──────────────────────────────────
 *
 * .dzc-coll-body was the inner span of a unit row and then became the
 * Collection pane wrapper, so a grid meant for one element landed on 178. Two
 * elements with the same class and unrelated jobs is the bug; this catches the
 * case where a class is used at two different nesting depths in one file with
 * different tag names, which is what that was.
 */
console.log('\na class name is not reused for two different things');

const KNOWN_SHARED = new Set([
  // Deliberately shared: the same visual component in several places.
  'dzc-rail-card', 'dzc-rail-line', 'dzc-rail-title', 'dzc-rail-pts',
  'dzc-chip', 'dzc-tab', 'dzc-search', 'dzc-search-row', 'dzc-ratios',
  'dzc-ratio', 'dzc-badge', 'dzc-badge-n', 'dzc-transport', 'dzc-sep',
  'dzc-stat', 'dzc-stats', 'dzc-rule', 'dzc-flag', 'dzc-icon-btn',
  'dzc-empty', 'dzc-count', 'dzc-card-stats', 'dzc-wrap', 'dzc-grid',
  'dzc-pts', 'dzc-none', 'dzc-toolbar', 'dzc-tabs', 'dzc-pop'
]);
const clashes = [];
for (const f of jsFiles) {
  const src = readFileSync(path.join(ROOT, 'js', f), 'utf8');
  const byClass = new Map();
  for (const m of src.matchAll(/<(\w+)[^>]*?class="([^"]*)"/g)) {
    const tag = m[1];
    for (const cls of m[2].split(/\s+/)) {
      const name = cls.split('$')[0].trim();
      if (!name.startsWith('dzc-') || name.length < 5 || KNOWN_SHARED.has(name)) continue;
      if (!byClass.has(name)) byClass.set(name, new Set());
      byClass.get(name).add(tag);
    }
  }
  for (const [name, tags] of byClass) {
    if (tags.size > 1) clashes.push(`js/${f}: .${name} on <${[...tags].join('> and <')}>`);
  }
}
eq(clashes.length, 0, 'no class is used on two different element types in one file');
if (clashes.length) console.error('        ' + clashes.join('\n        '));

/* ── 4. Every class the JS emits has a rule behind it ─────────────────
 *
 * A styled element whose class was renamed in one file and not the other looks
 * fine in the markup and unstyled on screen — which is how the faction-mark
 * revert could have left dead classes behind.
 */
console.log('\nevery class the JS emits is styled somewhere');

const css = readFileSync(path.join(ROOT, 'css', 'dzc.css'), 'utf8')
  + readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');
const emitted = new Set();
for (const f of jsFiles) {
  const src = readFileSync(path.join(ROOT, 'js', f), 'utf8');
  for (const m of src.matchAll(/class="([^"]*)"/g)) {
    for (const cls of m[1].split(/\s+/)) {
      const name = cls.split('$')[0].replace(/[^a-z0-9-]/gi, '').trim();
      if (name.startsWith('dzc-') && name.length > 4) emitted.add(name);
    }
  }
}
ok(emitted.size > 40, 'the class scan actually found classes', `found ${emitted.size}`);
const unstyled = [...emitted].filter(c => !css.includes('.' + c));
eq(unstyled.length, 0, 'every dzc- class the JS emits appears in the CSS');
if (unstyled.length) console.error('        ' + unstyled.join('\n        '));

/* ── 5. The unit renderers, run against every real Unit ───────────────
 *
 * js/dzc-units.js draws the same strings for the reference view, the picker
 * card and the Squad row, so a bug in one of them is a bug in all three. It
 * touches `document` only inside the handlers, so it loads against a stub and
 * the pure renderers can be called for real.
 */
console.log('\nthe unit renderers survive all 178 units');
{
  const stub = () => ({ style: {}, classList: { add() {}, remove() {} } });
  sandbox.document = {
    getElementById: () => null, querySelector: () => null,
    createElement: stub, addEventListener() {}, removeEventListener() {}
  };
  sandbox.setTimeout = setTimeout;
  vm.runInContext(readFileSync(path.join(ROOT, 'js', 'dzc-icons.js'), 'utf8'), sandbox);
  vm.runInContext(readFileSync(path.join(ROOT, 'js', 'dzc-units.js'), 'utf8'), sandbox);
  const U = win.DZCUnits;

  let drawn = 0, placeholders = [], ruleBlocks = 0;
  for (const fid of ['ucm', 'phr', 'scourge', 'shaltari', 'resistance', 'bioficer']) {
    const f = await DZC.loadFaction(fid);
    for (const u of f.units) {
      const html = U.statsHtml(u) + U.weaponsHtml(u, fid) + U.variantsHtml(u)
        + U.transportHtml(u) + U.rulesHtml(u.special, fid) + U.unitRulesHtml(u, fid);
      drawn++;
      if (/\b(null|undefined|NaN)\b/.test(html)) placeholders.push(`${fid}/${u.id}`);
      if (U.unitRulesHtml(u, fid)) ruleBlocks++;
    }
  }
  ok(drawn > 170, 'every unit in the game was rendered', `${drawn}`);
  eq(placeholders.length, 0, 'and not one of them printed null, undefined or NaN',
     placeholders.slice(0, 5).join(', '));
  ok(ruleBlocks > 100, 'most units carry a rules block, so the check is meaningful', `${ruleBlocks}`);

  // Gap 44/65: the rule text is on the page, not only behind a hover -- there
  // is no hover on a phone, so a tooltip-only rule does not exist there.
  const legion = DZC.faction('ucm').byId.legionnaires;
  const block = U.unitRulesHtml(legion, 'ucm');
  ok(block.length > 200, 'Legionnaires print their rules in full', `${block.length} chars`);
  ok(!/title="/.test(block), 'and not as a tooltip');
}

/* ── 6. The printable quick reference, all six factions ───────────────
 *
 * The quick reference is one page parameterised by ?faction=, drawn from the same
 * JSON the app reads. It is the part of the site least likely to be opened by
 * anyone -- you go there once, print it, and never load it again -- so a stray
 * "undefined" in a stat cell could sit there for months. Draw all six.
 */
console.log('\nthe quick reference draws for every faction');
{
  const html = readFileSync(path.join(ROOT, 'assets', 'ref', 'sheet.html'), 'utf8');
  // The page's own script, minus the two <script src> tags above it.
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).filter(s => s.includes('function render'));
  eq(inline.length, 1, 'the sheet has exactly one render script');

  let title = '', painted = '';
  sandbox.location = { search: '?faction=ucm' };
  sandbox.document = {
    getElementById: id => (id === 'sheet'
      ? { set innerHTML(v) { painted = v; }, get innerHTML() { return painted; } } : null),
    documentElement: { style: { setProperty() {} } },
    querySelector: () => null,
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }),
    addEventListener() {}, removeEventListener() {},
    set title(v) { title = v; }, get title() { return title; }
  };
  vm.runInContext(inline[0], sandbox);

  const drawn = [];
  for (const fid of ['ucm', 'phr', 'scourge', 'shaltari', 'resistance', 'bioficer']) {
    sandbox.location.search = `?faction=${fid}`;
    painted = '';
    await win.DZCRefSheet.render();
    drawn.push([fid, painted]);
  }
  ok(drawn.every(([, h]) => h.length > 8000), 'every sheet has real content',
     drawn.map(([f, h]) => `${f}:${h.length}`).join(' '));
  const placeholders = drawn.filter(([, h]) => /\b(null|undefined|NaN)\b/.test(h)).map(([f]) => f);
  eq(placeholders.length, 0, 'and none of them prints null, undefined or NaN',
     placeholders.join(', '));
  ok(drawn.every(([, h]) => h.includes('Force construction') && h.includes('Special rules')),
     'each sheet carries the construction rules and the glossary');
  // Generated Units (Bioficer Drones and Hulks) cannot be picked, but they are
  // on the table in play, so the sheet lists them under their own heading.
  ok(drawn.find(([f]) => f === 'bioficer')[1].includes('never chosen'),
     'the Bioficer sheet says why its Generated Units cannot be taken');

  // CLAUDE.md §3: the banned word never reaches a page, including this one.
  ok(!/datasheet/i.test(html), 'the sheet markup does not say the banned word');
}

/* ── 7. The whole builder, driven for real ────────────────────────────
 *
 * Sections 1-5 test the renderers a Unit goes through. Nothing tested the two
 * screens themselves, and the first time they were driven against a document
 * stub the builder threw outright:
 *
 *   ReferenceError: Cannot access 'U' before initialization
 *
 * squadHtml read U.transportHtml two hundred lines above the `const U` that
 * declares it -- a temporal dead zone, so a thrown error rather than an
 * undefined. It only fired when a Squad actually HAD a Transport, which is the
 * commonest thing in the app, and it took the entire builder view down with
 * it: renderBuilder threw, so nothing reached the pane at all.
 *
 * A stub document is enough because these renderers build a string and assign
 * it to innerHTML. That is not the same as looking at the screen and this does
 * not claim to be -- but "it renders at all" is a real assertion and there was
 * not one.
 */
console.log('\nevery screen renders');
{
  const els = {};
  const stub = id => (els[id] = els[id] || {
    id, innerHTML: '', textContent: '', dataset: {},
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
    appendChild() {}, removeChild() {}, remove() {}, focus() {},
    setAttribute() {}, removeAttribute() {}, offsetHeight: 84, offsetWidth: 168,
    // A modal titles itself through querySelector rather than by id, so this
    // has to answer with something writable rather than null.
    querySelector: () => stub('scratch'), querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}, scrollTop: 0
  });
  sandbox.document = {
    body: stub('body'), documentElement: stub('html'),
    getElementById: id => els[id] || null,
    querySelector: () => stub('scratch'), querySelectorAll: () => [],
    createElement: () => stub('scratch'),
    addEventListener() {}, removeEventListener() {}
  };
  sandbox.location = { hash: '', href: 'https://e.test/', search: '' };
  // The print preview measures the page and listens for a resize; in a real
  // browser these are on window, and the app is entitled to expect them.
  win.addEventListener = () => {};
  win.removeEventListener = () => {};
  win.innerWidth = 1280; win.innerHeight = 900;
  win.scrollX = 0; win.scrollY = 0;
  win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  // The preview parks a history entry so Back closes it, the same guard the
  // modals use.
  sandbox.history = { pushState() {}, back() {} };
  sandbox.requestAnimationFrame = fn => fn();
  sandbox.btoa = btoa; sandbox.atob = atob;
  sandbox.TextEncoder = TextEncoder; sandbox.TextDecoder = TextDecoder;
  sandbox.Response = Response;
  sandbox.queueMicrotask = queueMicrotask;
  sandbox.setTimeout = setTimeout; sandbox.clearTimeout = clearTimeout;
  // A browser has these; the app is entitled to expect them. The clipboard is
  // stubbed to SUCCEED so the ordinary path is the one that gets exercised --
  // without it every copy falls into the blocked-clipboard branch.
  sandbox.navigator = { clipboard: { writeText: async () => {} } };
  win.prompt = () => null;
  win.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
  win.Blob = class { constructor() {} };
  for (const f of ['dzc-share.js', 'dzc-builder.js', 'dzc-play.js', 'dzc-collection.js']) {
    vm.runInContext(readFileSync(path.join(ROOT, 'js', f), 'utf8'), sandbox);
  }
  const B = win.DZCBuilder;
  // Every mount point index.html declares for these screens. A missing one
  // reads as "no such element" and the renderer quietly does nothing, so they
  // are all created up front rather than on demand.
  ['view-armies', 'view-army', 'view-units', 'view-play', 'view-collection',
    'dzc-picker', 'dzc-picker-body', 'dzc-carry', 'dzc-carry-body',
    'dzc-cmdr', 'dzc-cmdr-body', 'dzc-share', 'dzc-share-body',
    'dzc-detail', 'dzc-detail-body', 'dzc-print', 'topbar-actions'].forEach(stub);

  // Everything a Squad can be at once: carried, commanded, and a legally mixed
  // Squad of two Variants (3.2.2). The Transport is the case that threw.
  const a = A.create('ucm', 'Driven probe', 1500, 'For the club night');
  const g = A.addGroup(a);
  const legion = A.addSquad(a, g.id, 'legionnaires', 3);
  A.assignTransport(a, legion.id, 'bear-apc');
  A.addCommander(a, 5);
  const g2 = A.addGroup(a);
  const tank = A.addSquad(a, g2.id, 'ucm-main-battle-tank', 2);
  A.setModelVariant(a, tank.id, 1, 'Tachi');

  let threw = null;
  try {
    await B.renderList();
    await B.renderBuilder(a.id);
  } catch (e) { threw = e; }
  ok(!threw, 'neither screen throws', threw && `${threw.message}\n        ${(threw.stack || '').split('\n')[1]}`);

  const list = els['view-armies'].innerHTML;
  const builder = els['view-army'].innerHTML;
  // The detail pane shows ONE Group, so the mixed-variant Squad has to be
  // selected before it is on the page at all. selectGroup sets the selection
  // and kicks a render it does not await, so the render is repeated here --
  // reading innerHTML straight after it returns reads the previous frame.
  B.selectGroup(g2.id);
  await B.renderBuilder(a.id);
  const second = els['view-army'].innerHTML;
  ok(list.length > 400, 'the army list actually drew something', `${list.length} chars`);
  ok(builder.length > 2000, 'and so did the builder', `${builder.length} chars`);
  // The Transport chip is the thing that was throwing, so name it rather than
  // trusting a length.
  ok(/Bear APC/.test(builder), 'the assigned Transport is on the page');
  ok(/Tachi/.test(second), 'and the second Variant of a mixed Squad, once its Group is open');
  ok(/Level 5/.test(builder), 'and the Commander');
  /* Gap 47: on a phone the rail collapses behind a line carrying the two
   * numbers you keep glancing at. The line is always in the markup — CSS
   * decides whether it is on screen — so what is asserted here is that it
   * carries them. */
  ok(/dzc-rail-peek/.test(builder), 'the rail has a peek line');
  ok(/pts left/.test(builder) && /of \d+ Groups/.test(builder),
     'and it carries the points left and the Group count');
  ok(/For the club night/.test(builder) && /For the club night/.test(list),
     'and what the army is for, on both screens');

  /* Gap 53: Play, Share and Print belong to the whole army, so they live in
   * the topbar and not in a row above the Group list. Play is the one that
   * has state -- it cannot run without a Commander. */
  const bar = els['topbar-actions'].innerHTML;
  ok(/>Play</.test(bar) && /Share/.test(bar) && /Print/.test(bar),
     'the topbar carries Play, Share and Print');
  ok(!/dzc-b-right/.test(builder), 'and the row above the list is gone');
  // Play needs a Commander ON a Squad, not merely in the army: CP, hand size
  // and Initiative all come from a Commander who is on the table (4.1).
  const playBtn = h => (h.match(/<button[\s\S]*?<\/button>/) || [''])[0];
  ok(/disabled/.test(playBtn(bar)), 'Play is refused while the Commander is unassigned');
  /* Re-fetched, not reused. DZCArmy.load() re-parses localStorage, and
   * renderBuilder calls it on every render -- so an object handed back by
   * create() or addSquad() is stale the moment a screen has drawn. Ids are
   * stable across that; object identity is not. */
  const live = A.get(a.id);
  A.assignCommander(live, A.commanders(live)[0].id, legion.id);
  await B.renderBuilder(a.id);
  ok(!/disabled/.test(playBtn(els['topbar-actions'].innerHTML)),
     'and live once they are aboard a Squad');

  for (const [name, html] of [['army list', list], ['builder', builder], ['second Group', second]]) {
    const words = html.replace(/<[^>]*>/g, ' ');
    ok(!/\b(null|undefined|NaN)\b/.test(words), `the ${name} prints no placeholder`,
       (words.match(/.{0,40}\b(null|undefined|NaN)\b.{0,40}/) || [])[0]);
  }
  /* Every other screen, opened the way the app opens it.
   *
   * The builder crash above was invisible for a day because nothing had ever
   * driven the screen that assembles the renderers. The same was true of all
   * of these. Each one is a whole view or dialog that either comes up or does
   * not; a thrown error in any of them is a blank pane, not a wrong pixel. */
  const drive = async (name, fn) => {
    let err = null;
    try { await fn(); } catch (e) { err = e; }
    ok(!err, `${name} does not throw`,
       err && `${err.message}\n        ${((err.stack || '').split('\n')[1] || '').trim()}`);
  };
  await drive('the picker', () => B.openPicker(g.id));
  /* Gap 32: the Owned filter is gated twice -- on the Collection setting and
   * on actually owning something in this faction -- so with neither it must
   * not be on the bar at all. A filter that empties the list and does not say
   * why is worse than no filter. */
  ok(!/>Owned</.test(els['dzc-picker-body'].innerHTML),
     'the Owned filter stays off the bar with the Collection switched off');
  const realCollection = win.DZCCollection;
  win.App = { collectionOn: () => true };
  win.DZCCollection = { count: (fid, id) => (id === 'legionnaires' ? 2 : 0) };
  await B.openPicker(g.id);
  ok(/>Owned</.test(els['dzc-picker-body'].innerHTML),
     'and appears once the Collection is on and something is owned');
  delete win.App;
  win.DZCCollection = realCollection;
  await drive('the Transport chooser', () => B.openCarry(legion.id));
  await drive('the Commander chooser', () => B.openCommander());
  await drive('Share', () => B.share());
  await drive('the print preview', () => B.print());
  await drive('the unit reference', () => win.DZCUnits.open());
  await drive('Collection', () => win.DZCCollection.open());
  await drive('Play mode', () => win.DZCPlay.open(a.id));

  for (const [name, html, min] of [
    ['the picker', els['dzc-picker-body'].innerHTML, 2000],
    ['the Transport chooser', els['dzc-carry-body'].innerHTML, 500],
    ['the Commander chooser', els['dzc-cmdr-body'].innerHTML, 200],
    ['Share', els['dzc-share-body'].innerHTML, 200],
    ['the unit reference', els['view-units'].innerHTML, 20000],
    ['Collection', els['view-collection'].innerHTML, 5000],
    ['Play mode', els['view-play'].innerHTML, 1000]
  ]) {
    ok(html.length > min, `${name} drew something`, `${html.length} chars`);
    const words = html.replace(/<[^>]*>/g, ' ');
    ok(!/\b(null|undefined|NaN)\b/.test(words), `${name} prints no placeholder`,
       (words.match(/.{0,40}\b(null|undefined|NaN)\b.{0,40}/) || [])[0]);
  }

  /* Every control on the screen, pressed.
   *
   * The crash above was in a renderer, and renderers are only half of it: the
   * other half is fifty handlers hanging off onclick attributes, none of which
   * had ever been called by anything. A handler that throws is a control that
   * does nothing when you press it, silently, and there is no browser here to
   * press them by hand.
   *
   * This does not check that a control does the RIGHT thing -- the army suite
   * owns that, against the model. It checks that pressing it does not throw
   * and does not leave a placeholder on the screen, which is the failure mode
   * a stub document can actually see. */
  const pressed = [];
  const press = async (label, fn) => {
    try { await fn(); } catch (e) {
      pressed.push(`${label}: ${e.message} (${((e.stack || '').split('\n')[1] || '').trim()})`);
    }
  };
  const gid = A.get(a.id).groups[0].id;
  const sid = A.get(a.id).groups[0].squads.find(x => x.unitId === 'legionnaires').id;

  await press('toggleRail open', () => B.toggleRail());
  await press('toggleRail shut', () => B.toggleRail());
  await press('armyMenu open', () => B.armyMenu({
    stopPropagation() {}, currentTarget: stub('army-menu-btn') }, a.id));
  await press('armyMenu close', () => B.armyMenu({
    stopPropagation() {}, currentTarget: stub('army-menu-btn') }, a.id));
  await press('sortList', () => B.sortList('name'));
  await press('sortList back', () => B.sortList('recent'));
  await press('selectGroup', () => B.selectGroup(gid));
  await press('backToGroups', () => B.backToGroups());
  await press('openPicker', () => B.openPicker(gid));
  await press('pickerSearch', () => B.pickerSearch('leg'));
  await press('pickerSearch empty', () => B.pickerSearch(''));
  await press('pickerCat', () => B.pickerCat('Standard'));
  await press('pickerCat All', () => B.pickerCat('All'));
  await press('pickerSort', () => B.pickerSort('name'));
  await press('pickerSort reverse', () => B.pickerSort('name'));
  await press('pickerFilter', () => B.pickerFilter('variants'));
  await press('pickerShape', () => B.pickerShape('square'));
  await press('pickerView', () => B.pickerView('list'));
  await press('pickerView back', () => B.pickerView('grid'));
  await press('pickerClear', () => B.pickerClear());
  await press('closePicker', () => B.closePicker());
  await press('count up', () => B.count(sid, 1));
  await press('count down', () => B.count(sid, -1));
  await press('variantCount', () => B.variantCount(sid, 0, 1));
  await press('openCarry', () => B.openCarry(sid));
  await press('closeCarry', () => B.closeCarry && B.closeCarry());
  await press('openCommander', () => B.openCommander());
  await press('addCommander', () => B.addCommander(4));
  await press('removeCommander', () => B.removeCommander(A.commanders(A.get(a.id)).slice(-1)[0].id));
  await press('share', () => B.share());
  await press('copyShare text', () => B.copyShare('text'));
  await press('closeShare', () => B.closeShare());
  await press('sizeChanger', () => B.sizeChanger({ stopPropagation() {}, currentTarget: stub('size-btn') }));
  await press('applySize', () => B.applySize('battle'));
  await press('setLimit', () => B.setLimit('1500'));
  await press('rename', () => B.rename({ textContent: 'Renamed', dataset: {} }));
  await press('renameGroup', () => B.renameGroup(gid, 'Spearhead'));
  await press('setDescription', () => B.setDescription('Club night'));
  await press('duplicateGroup', () => B.duplicateGroup(gid));
  await press('addGroup', () => B.addGroup());
  await press('print preview', () => B.print());
  await press('printOpt', () => B.printOpt('ink', true));
  await press('closePreview', () => B.closePreview());
  await press('removeSquad', () => B.removeSquad(sid));
  await press('removeGroup', () => B.removeGroup(A.get(a.id).groups.slice(-1)[0].id));
  eq(pressed.length, 0, 'no control on the builder throws when it is pressed');
  if (pressed.length) console.error('        ' + pressed.join('\n        '));
  const after = els['view-army'].innerHTML.replace(/<[^>]*>/g, ' ');
  ok(!/\b(null|undefined|NaN)\b/.test(after), 'and the screen is still clean afterwards',
     (after.match(/.{0,40}\b(null|undefined|NaN)\b.{0,40}/) || [])[0]);

  /* Play mode and the Collection have handlers too, and the same nobody had
   * ever called them. Play is the one that matters most at a table: it is
   * driven entirely by controls, and a Round counter that throws mid-game is
   * the worst possible time to find out. */
  const played = [];
  const tap = async (label, fn) => {
    try { await fn(); } catch (e) {
      played.push(`${label}: ${e.message} (${((e.stack || '').split('\n')[1] || '').trim()})`);
    }
  };
  {
    /* A fresh army rather than the one above: that one has just had a Squad
     * and a Group removed by the control sweep, so what is left in it is a
     * function of the order those presses happened in. Play mode needs a
     * Commander aboard a Squad or it will not open at all. */
    const pa = A.create('ucm', 'Play probe', 1500);
    const pgroup = A.addGroup(pa);
    const psquad = A.addSquad(pa, pgroup.id, 'legionnaires', 3);
    A.addCommander(pa, 5);
    const plive = A.get(pa.id);
    A.assignCommander(plive, A.commanders(plive)[0].id, psquad.id);
    await win.DZCPlay.open(pa.id);
    const P = win.DZCPlay;
    const pg = A.get(pa.id).groups[0];
    const psid = pg.squads[0].id;
    await tap('round up', () => P.round(1));
    await tap('round down', () => P.round(-1));
    await tap('replenish', () => P.replenish());
    await tap('cp up', () => P.cp(1));
    await tap('cp down', () => P.cp(-1));
    await tap('my VP', () => P.vp('myVP', 1));
    await tap('their VP', () => P.vp('oppVP', 1));
    await tap('their Groups', () => P.oppGroups('4'));
    await tap('activate', () => P.activate(pg.id));
    await tap('activate again', () => P.activate(pg.id));
    await tap('damage', () => P.dp(psid, 0, -1));
    await tap('repair', () => P.dp(psid, 0, 1));
    await tap('status on', () => P.status(psid, 0, 'Reserved'));
    await tap('status off', () => P.status(psid, 0, 'Reserved'));
    await tap('initiative roll', () => P.roll());

    const C = win.DZCCollection;
    await tap('collection open', () => C.open());
    await tap('collection faction', () => C.setFaction('phr'));
    await tap('collection search', () => C.setSearch('nept'));
    await tap('collection search clear', () => C.setSearch(''));
    await tap('collection owned only', () => C.toggleOwned());
    await tap('collection adjust', () => C.adjust('neptune-dropship', 1));
    await tap('collection adjust back', () => C.adjust('neptune-dropship', -1));
    await tap('collection owned off', () => C.toggleOwned());
    await tap('collection back to ucm', () => C.setFaction('ucm'));
    A.remove(pa.id);
  }
  eq(played.length, 0, 'no control in Play mode or the Collection throws');
  if (played.length) console.error('        ' + played.join('\n        '));
  for (const [name, id] of [['Play mode', 'view-play'], ['the Collection', 'view-collection']]) {
    const html = els[id].innerHTML.replace(/<[^>]*>/g, ' ');
    ok(!/\b(null|undefined|NaN)\b/.test(html), `${name} is still clean afterwards`,
       (html.match(/.{0,40}\b(null|undefined|NaN)\b.{0,40}/) || [])[0]);
  }

  A.remove(a.id);

  /* And once per faction, over an army the generator built.
   *
   * Everything above is UCM, and a render bug does not have to be
   * faction-agnostic: the Bioficer list carries Units that cannot be selected
   * at all, Shaltari has a Vehicle that fills a square, and four of the six
   * use two capacity shapes at once. A generated army is the only way to get
   * every one of those onto a screen without hand-building six lists, and it
   * is already trusted to be legal by the army suite.
   *
   * Seeded, so a failure reproduces: the generator takes its own rand. */
  let seed = 20260801;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (const fid of ['ucm', 'phr', 'scourge', 'shaltari', 'resistance', 'bioficer']) {
    await DZC.loadFaction(fid);
    const r = A.generate(fid, 1500, rand);
    ok(r.ok, `the generator built a ${fid.toUpperCase()} army to render`, r.reason);
    if (!r.ok) continue;
    const built = r.army;
    let err = null;
    try {
      await B.renderBuilder(built.id);
      await B.openPicker(built.groups[0].id);
    } catch (e) { err = e; }
    ok(!err, `a generated ${fid.toUpperCase()} army renders`,
       err && `${err.message}\n        ${((err.stack || '').split('\n')[1] || '').trim()}`);
    const html = els['view-army'].innerHTML.replace(/<[^>]*>/g, ' ');
    ok(!/\b(null|undefined|NaN)\b/.test(html), `and the ${fid.toUpperCase()} builder prints no placeholder`,
       (html.match(/.{0,40}\b(null|undefined|NaN)\b.{0,40}/) || [])[0]);
    A.remove(built.id);
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
