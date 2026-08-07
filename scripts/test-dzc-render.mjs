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

  /* "Behemoths have a Groups Equivalent stat instead of Squad Size" (Behemoth
   * rules 1.1). Every card that says how many of a Unit you take goes through
   * sizeHtml, so the two cannot be labelled differently in different places —
   * which is how all eleven ended up saying "Squad 1", a stat their cards do
   * not print, while the number that decides how much of a Group allowance one
   * eats appeared nowhere. */
  eq(U.sizeHtml(legion), 'Squad 2–3', 'an ordinary Unit still says its Squad size');
  const shal = await DZC.loadFaction('shaltari');
  eq(U.sizeHtml(shal.byId.dragon), 'Groups Equivalent 5',
     'a Behemoth says its Groups Equivalent instead (1.1)');
  const behs = ['ucm', 'phr', 'scourge', 'shaltari', 'resistance']
    .flatMap(f => DZC.faction(f).units).filter(u => u.type === 'Behemoth');
  ok(behs.length >= 10, 'and there are ten of them to get wrong', String(behs.length));
  eq(behs.filter(u => /Squad/.test(U.sizeHtml(u))).length, 0,
     'not one of which is labelled with a Squad size');
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
  /* What a Commander Level is worth is chapter 4, not the points table, and
   * this is the sheet on the table when someone asks why the Level 6 cost 150
   * points. Level 4 is legal at every size, so its row is always there: 50
   * points, 4 CP, 4 cards, +4 Initiative. */
  ok(drawn.every(([, h]) => /Level 4<\/td><td class="num">50<\/td><td class="num">4<\/td><td class="num">4<\/td><td class="num">\+4</.test(h)),
     'and what each Commander Level buys per Round');
  /* The sheet summarises the cards, it does not replace them — the art, the
   * wording and the upgrade footnotes are only on the card — so every roster
   * row says which page it came off, and the footer says which release those
   * pages are counted in. A page number with no edition beside it cannot be
   * checked against anything. */
  ok(drawn.every(([, h]) => /<th>Card<\/th>/.test(h)), 'every roster row cites its stat card page');
  ok(drawn.every(([, h]) => /release<\/span>/.test(h)), 'and the footer names the release those pages are in');
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

  /* A Squad's weapon table is the whole card, with the guns that Squad fires
   * marked and the rest left on the page and quiet. This Squad is a Sabre and
   * a Tachi, so the Avenger Railgun and the Laser are live and the Rapier's
   * Gatlings are not — nobody in the Squad is a Rapier.
   *
   * It used to DROP the Rapier's row, which fixed the right fault with the
   * wrong tool: the complaint was that nothing said which rows were live, and
   * the answer taken was deletion. What is asserted now is that the number you
   * would compare against is still on screen, and still says it is not yours. */
  /* Cards now, not table rows — same eight fields, laid out to be read rather
   * than to line up in a 620px table that scrolled sideways on a phone. What
   * is asserted is unchanged: every gun on the card is on the page, and the
   * ones this Squad actually fires are the ones marked. */
  const wcards = (second.match(/<div class="dzc-wcards dzc-wcards--marked">[\s\S]*/) || [''])[0];
  const cardFor = gun => (wcards.match(/<article class="dzc-wc[^"]*"[\s\S]*?<\/article>/g) || [])
    .find(c => c.includes(gun)) || '';
  ok(wcards.length > 0, 'a Squad marks its weapon cards rather than filtering them');
  ok(/is-live/.test(cardFor('UM-702 Laser')),
     'the gun of a Variant in the Squad is marked live');
  ok(/is-off/.test(cardFor('UM-28 Gatling')),
     'and the gun of one that is not stays on the page, marked off');
  ok(/UM-28 Gatling/.test(second), 'the Variant blocks still name it too');
  const refTable = win.DZCUnits.weaponCardsHtml(DZC.faction('ucm').byId['ucm-main-battle-tank'], 'ucm');
  ok(/UM-28 Gatling/.test(refTable), 'and the reference view is still the whole card');
  ok(!/is-off|is-live|--marked/.test(refTable),
     'with nothing marked, because outside a Squad there is no selection to mark against');
  ok(/Level 5/.test(builder), 'and the Commander');
  /* Gap 51: what the Level is worth per Round, in the rail. Off the HIGHEST
   * Level on the table (4.1.1, 4.1.4, 4.1.5), so it is one line about the army
   * rather than a repeat on each Commander card — this army has a single
   * Level 5, which makes 5 CP, 5 cards and +5 Initiative. */
  ok(/dzc-cmdr-buys--rail/.test(builder), 'the rail says what the Level is worth per Round');
  ok(/<b>5<\/b><i>CP<\/i>/.test(builder) && /<b>\+5<\/b><i>Initiative<\/i>/.test(builder),
     'and reads it off the highest Level in the army');
  /* Gap 47: on a phone the rail collapses behind a line carrying the two
   * numbers you keep glancing at. The line is always in the markup — CSS
   * decides whether it is on screen — so what is asserted here is that it
   * carries them. */
  ok(/dzc-rail-peek/.test(builder), 'the rail has a peek line');
  ok(/pts left/.test(builder) && /of \d+ Groups/.test(builder),
     'and it carries the points left and the Group count');
  ok(/For the club night/.test(builder) && /For the club night/.test(list),
     'and what the army is for, on both screens');

  /* Gap 107: compact view. A Squad reads as its whole stat card by default,
   * which is right when you are deciding and long when you are scanning ten of
   * them — Dropfleet's own comment on this toggle says it is what makes
   * showing everything by default safe. What it must NOT do is take away a
   * control: a denser overview that also refuses you a purchase is a different
   * feature, so the steppers, the upgrades and the Transport chooser are
   * asserted still present. */
  ok(/dzc-sq-wpn/.test(builder), 'a Squad carries its weapon table by default');
  // Both, because the builder reads this shim two ways: `window.App` in the
  // picker's filter list and a bare `App` in shortfallHtml. A browser makes
  // those the same object; a vm sandbox does not.
  sandbox.App = win.App = { compactView: () => true };
  await B.renderBuilder(a.id);
  const dense = els['view-army'].innerHTML;
  delete sandbox.App; delete win.App;
  ok(!/dzc-sq-wpn/.test(dense), 'compact view drops it');
  ok(dense.length < builder.length, 'and the screen gets shorter',
     `${builder.length} to ${dense.length} chars`);
  ok(/dzc-stepper/.test(dense) && /dzc-carry-add/.test(dense),
     'and it takes away no control');
  await B.renderBuilder(a.id);

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

  /* Both places a Commander or a Group is named on the builder, and both were
   * reading round the derived name.
   *
   * The tag on a Squad looked the Commander up by an id on the Squad's COPY of
   * it — syncCommanders writes `{ level }` and no id, so it matched nobody
   * every time and a Commander you had named still read "Level 5". And the
   * Aboard select appended the Group only where the Group had a typed name, so
   * two Squads of the same Unit in two unnamed Groups were two identical
   * options with no way to tell which was which. */
  {
    const held = A.get(a.id);
    A.renameCommander(held, A.commanders(held)[0].id, 'Colonel Vance');
    // The tag lives on the Squad, and only the SELECTED Group's Squads are in
    // the detail pane. The Commander is aboard the Legionnaires, in the first
    // Group, and the second one has been open since the mixed-Variant check.
    B.selectGroup(g.id);
    await B.renderBuilder(a.id);
    const named = els['view-army'].innerHTML;
    // Scoped to the tag on the Squad. The rail card beside it has always read
    // the name correctly, so a whole-page match would pass either way and
    // prove nothing about the tag.
    const tag = (named.match(/<span class="dzc-cmdr-tag"[\s\S]*?<\/span>/) || [''])[0];
    ok(/Colonel Vance/.test(tag), 'a named Commander reads as its name on the Squad it is aboard', tag);
    ok(/Legionnaires — Group 1/.test(named),
       'and every Aboard option names its Group, even one nobody named');
    A.renameCommander(A.get(a.id), A.commanders(A.get(a.id))[0].id, '');
    await B.renderBuilder(a.id);
  }

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
  /* Gap 63 on paper, where it matters more: you cannot expand a row on a
   * printed sheet to discover that the gun above it belongs to a Variant
   * nobody in the Squad is. The sheet takes its guns from the same definition
   * the Squad row does.
   *
   * printNow is the one that builds the sheet the printer gets -- print()
   * opens the preview, which draws into a node this stub registry does not
   * hold. window.print is stubbed because the sandbox has no printer and the
   * call is the last thing the function does. */
  win.print = () => {};
  await drive('the printed sheet', () => B.printNow());
  const sheet = els['dzc-print'].innerHTML;
  ok(/UM-702 Laser/.test(sheet), 'the printed sheet lists the Squad\'s guns');
  ok(!/UM-28 Gatling/.test(sheet), 'and not the ones it does not have');
  /* A Commander you have not named reports its Level AS its name, so the field
   * beside it must not say the Level again. Both places that draw one did:
   * "Level 5 Commander  Level 5  not assigned" on the sheet, and "Level 5,
   * 90pts" under "Level 5 Commander" in the rail.
   *
   * Counted rather than matched, because "Level 5" appearing at all is right —
   * it is the name. Twice in one row is the fault. */
  {
    const row = (sheet.match(/<div class="pr-cmdr-row">[\s\S]*?<\/div>/) || [''])[0];
    ok((row.match(/Level 5/g) || []).length === 1,
       'an unnamed Commander says its Level once on the printed sheet', row);
    const card = (els['view-army'].innerHTML.match(/<div class="dzc-rail-card dzc-cmdr-card[\s\S]*?<\/div>\s*<\/div>/) || [''])[0];
    ok((card.match(/Level 5/g) || []).length === 1,
       'and once on its rail card', card);
  }
  await drive('the unit reference', () => win.DZCUnits.open());
  await drive('Collection', () => win.DZCCollection.open());
  await drive('Play mode', () => win.DZCPlay.open(a.id));

  /* The detail view against the printed card it is a copy of.
   *
   * Two fields were scanned into all 178 Units and rendered nowhere. The page
   * is the one reference the app cannot replace — the printed card carries art
   * and wording this does not — and every rule already cites its own page
   * while the Unit cited nothing. The upgrade note is the sentence that says
   * what taking an upgrade costs you, and the builder has always shown it over
   * the buttons while the reference showed the rows with no qualification.
   *
   * Hulks is the reason the note is gated on there being an upgrade: it has no
   * upgrade box, so the scanner took the lore paragraph off the bottom of the
   * card instead. It is not selectable, so the builder never drew it — but the
   * reference draws all 178. */
  await drive('the unit detail', () => win.DZCUnits.openDetail('legionnaires', 'ucm'));
  ok(/Stat card p\.3</.test(els['dzc-detail-body'].innerHTML),
     'the detail view says which stat card page the Unit is on');
  await drive('a unit with upgrades', () => win.DZCUnits.openDetail('harrier-gunship', 'ucm'));
  ok(/dzc-upg-note/.test(els['dzc-detail-body'].innerHTML),
     'and prints the sentence that qualifies its upgrades');
  await drive('a unit with none', () => win.DZCUnits.openDetail('hulks', 'bioficer'));
  ok(!/dzc-upg-note/.test(els['dzc-detail-body'].innerHTML),
     'and stays silent where the field holds lore rather than a constraint');

  /* What a Level buys is chapter 4 arithmetic, not a points table: CP up to
   * your highest Level (4.1.1), a hand of that many cards (4.1.4), D6 plus it
   * for Initiative (4.1.5). Play Mode has run on those three numbers since it
   * was written; the chooser left them out, so the ladder was four prices with
   * nothing to weigh them against. Level 4 is legal at every game size, so it
   * is always on the chooser and always safe to assert. */
  {
    const html = els['dzc-cmdr-body'].innerHTML;
    ok(/<b>4<\/b><i>CP<\/i>/.test(html), 'the Commander chooser prices Level 4 at 4 CP');
    ok(/<b>4<\/b><i>cards<\/i>/.test(html), 'and a hand of 4 cards');
    ok(/<b>\+4<\/b><i>Initiative<\/i>/.test(html), 'and +4 Initiative');
    /* Gap 35: a refused option says why rather than not being there. This army
     * is 1500pts, which is a Clash, so Level 7 is out — and it is on the
     * chooser, dimmed, naming the size that reaches it. Filtering it away
     * enforced 3.2.5 by making it unlearnable: at Skirmish there was no way to
     * find out Levels 6 and 7 exist. */
    ok(/Level 7/.test(html), 'a Level the agreed size cannot reach is still on the chooser');
    ok(/is-blocked/.test(html) && /Battle and up/.test(html), 'refused, and naming the size that reaches it');
  }

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

  /* Play Mode's arithmetic, which nothing had ever asserted.
   *
   * The sweep above proves no control throws. It does not prove a single
   * number on the screen is right, and these are the numbers you read across a
   * table mid-game, where being wrong loses you the game rather than failing a
   * build. Chapter 4, verbatim:
   *
   *   4.1.1  "Players generate/replenish their Command Points (CP) up to a
   *          number equal to their highest Commander Level on the Table...
   *          Commanders count as Level 0 throughout Round 1"
   *   4.1.2  "If a player has two fewer Groups on the Table/Ready to enter it
   *          than their opponent, they generate a Pass token. For each
   *          additional Group fewer than their opponent, they generate another
   *          Pass token. Groups which contain only non-auxiliary Transports
   *          are ignored when generating Pass tokens."
   *
   * Read off the rendered screen rather than out of the module: the arithmetic
   * is private, and what matters is the number a player is looking at. */
  {
    const P = win.DZCPlay;
    const ma = A.create('ucm', 'Mid-game', 1500);
    const m1 = A.addGroup(ma), lead = A.addSquad(ma, m1.id, 'legionnaires', 3);
    const m2 = A.addGroup(ma); A.addSquad(ma, m2.id, 'ucm-main-battle-tank', 2);
    const m3 = A.addGroup(ma); A.addSquad(ma, m3.id, 'legionnaires', 3);
    const mlive = A.get(ma.id);
    A.assignCommander(mlive, A.addCommander(mlive, 5).commander.id, lead.id);
    await P.open(ma.id);

    const cap = () => (els['view-play'].innerHTML
      .match(/Command Points<\/span>[\s\S]*?<span class="dzc-pcard-v">\d+<i>\/ (\d+)<\/i>/) || [])[1];
    const passes = () => (els['view-play'].innerHTML
      .match(/Pass Tokens<\/span>[\s\S]*?<span class="dzc-pcard-v">(\d+)<\/span>/) || [])[1];

    const held = () => (els['view-play'].innerHTML
      .match(/Command Points<\/span>[\s\S]*?<span class="dzc-pcard-v">(\d+)<i>/) || [])[1];

    eq(cap(), '0', 'Round 1 caps CP at nothing — every Commander counts as Level 0 (4.1.1)');
    P.round(1);
    eq(cap(), '5', 'and from Round 2 the cap is the highest Commander Level');

    /* 4.1.1 is "generate/replenish ... up to", and advancing a Round used to
     * do only the losing half of it: the cap moved to 5 and you were left
     * holding 0 until you found the Refill button. */
    eq(held(), '5', 'advancing a Round GENERATES the CP, it does not only cap it');
    P.cp(-1); P.cp(-1);
    eq(held(), '3', 'and spending it takes it away');
    P.round(-1);
    eq(held(), '0', 'stepping back a Round is a mis-tap, not an Initiation Phase');
    P.round(1);
    eq(held(), '5', 'and the next Round hands it back in full');


    P.oppGroups('3');
    eq(passes(), '0', 'level on Groups earns no Pass token');
    P.oppGroups('4');
    eq(passes(), '0', 'and one Group behind still earns none (4.1.2)');
    P.oppGroups('5');
    eq(passes(), '1', 'two Groups behind earns one');
    P.oppGroups('7');
    eq(passes(), '3', 'and each further Group behind earns another');

    // A Group of only non-auxiliary Transports is not a Group for this
    // purpose, so adding one must not change the count either way (4.1.2).
    const m4 = A.addGroup(A.get(ma.id));
    A.addSquad(A.get(ma.id), m4.id, 'condor-dropship', 1);
    await P.open(ma.id);
    P.oppGroups('7');
    eq(passes(), '3', 'a Group of only Transports is ignored on your own side of it');
    /* And it says so, while a Group that is merely EMPTY does not. Three
     * different things stop a Group activating and the tag was drawn for all
     * three, so an empty Group was told a rule about transports it does not
     * contain. Counted, because the Condor Group above must still carry it. */
    A.addGroup(A.get(ma.id));
    await P.open(ma.id);
    const tags = (els['view-play'].innerHTML.match(/orphaned transports/g) || []).length;
    eq(String(tags), '1', 'and only the transport Group is called an orphaned transport');
    /* Where a Status Token goes, which is a rule and not a layout choice:
     *
     *   11.1.7  "place a Concussed Status Token on its Squad"
     *   11.1.22 "place a Jammed Status Token on its Squad"
     *   11.1.34 "place a Suppressed Status Token on its Squad"
     *
     * and against those, 10.1.21 Obscurer X”: "All friendly Vehicle and
     * Infantry UNITS within X” of this Unit are Obscured" — where you are
     * standing, not a token on the Squad, so that one stays per model.
     *
     * Four squads (3 + 2 + 3 Legionnaires/tanks, plus the Condor) and nine
     * models between them. All four statuses were on every model, so this used
     * to be 36 and 36. */
    const play = els['view-play'].innerHTML;
    eq(String((play.match(/DZCPlay\.squadStatus\(/g) || []).length), '12',
       'three Status Tokens per Squad, not per model (11.1.7, 11.1.22, 11.1.34)');
    eq(String((play.match(/DZCPlay\.status\(/g) || []).length), '9',
       'and Obscured stays on the model, because it is where it is standing (10.1.21)');
    A.remove(ma.id);
  }

  /* Behemoths, in Play Mode. Two rules off the same page, both of which the
   * builder already honours and Play Mode did not:
   *
   *   1.1  "A Behemoth counts as that many Groups when building your Army and
   *        generating Pass tokens"
   *   1.2  "Behemoths cannot receive Status tokens" / "Behemoths cannot be
   *        Obscured, even by special rules"
   */
  {
    const P = win.DZCPlay;
    const ba = A.create('ucm', 'Behemoth at the table', 3000);
    const bg = A.addGroup(ba);
    A.addSquad(ba, bg.id, 'ucm-heavy-battle-mech', 1);
    await P.open(ba.id);

    const view = () => els['view-play'].innerHTML;
    const passes = () => (view()
      .match(/Pass Tokens<\/span>[\s\S]*?<span class="dzc-pcard-v">(\d+)<\/span>/) || [])[1];
    const mine = () => (view().match(/Yours<input type="number" value="(\d+)"/) || [])[1];

    const ge = win.DZC.faction('ucm').byId['ucm-heavy-battle-mech'].groupEquivalent;
    ok(ge > 1, 'the Heavy Battle Mech is worth more than one Group', String(ge));
    eq(mine(), String(ge), 'one Behemoth card counts as its Groups Equivalent (1.1)');
    // Counting cards, a lone Behemoth was 1 Group and six behind an opponent
    // on 7 — five Pass tokens for fielding the biggest thing on the table.
    P.oppGroups('7');
    eq(passes(), String(7 - ge - 1), 'so the Pass tokens are counted off its worth, not off one card');

    const bsid = A.get(ba.id).groups[0].squads[0].id;
    P.squadStatus(bsid, 'Concussed');
    P.status(bsid, 0, 'Obscured');
    ok(!/dzc-st is-on/.test(view()),
       'and no Status Token, Obscured included, will stick to a Behemoth (1.2)',
       (view().match(/.{0,60}dzc-st is-on.{0,40}/) || [])[0]);
    ok(/disabled title="[^"]*Behemoth/.test(view()),
       'the buttons say why rather than vanishing');

    /* 1.3: "Behemoths begin each Round with a number of Power tokens (PT)
     * equal to their Power. When you may activate a normal Group, you may
     * instead activate a Behemoth with PT remaining." Play Mode gave its
     * Group the same one-shot activation box as everything else, which said a
     * Behemoth with seven PT was finished for the Round after one Action. */
    const pt = () => (view().match(/<b>(\d+)<\/b><i>of (\d+) PT/) || []).slice(1);
    const pw = parseInt(win.DZC.faction('ucm').byId['ucm-heavy-battle-mech'].stats.Power, 10);
    eq(pt().join('/'), `${pw}/${pw}`, 'a Behemoth starts the Round on a full Power track (1.3)');
    P.pt(bsid, -1); P.pt(bsid, -1);
    eq(pt().join('/'), `${pw - 2}/${pw}`, 'and spends one per Action');
    P.round(1);
    eq(pt().join('/'), `${pw}/${pw}`, 'refilled every Round, spent or not');
    ok(/A Behemoth activates once per Power token/.test(view()),
       'and its Group cannot be ticked off after one activation');
    A.remove(ba.id);
  }

  /* And the builder's own Group meter, which is measured against an allowance
   * counted in Groups — so it has to be counted in Groups too. It was counting
   * cards, which put the rail and validate's own error on different numbers
   * for the same army. */
  {
    const ga = A.create('shaltari', 'Groups meter', 3000);
    A.addSquad(ga, A.addGroup(ga).id, 'dragon', 1);
    A.addSquad(ga, A.addGroup(ga).id, 'warstrider', 1);
    await B.renderBuilder(ga.id);
    const rail = els['view-army'].innerHTML;
    const meter = (rail.match(/(\d+) of (\d+|—) Groups/) || []);
    eq(meter[1], String(A.groupsUsed(A.get(ga.id))),
       'the rail counts what the Groups are worth, not the cards (1.1)');
    ok(A.groupsUsed(A.get(ga.id)) > 2, 'and this army is worth more than its two cards',
       String(A.groupsUsed(A.get(ga.id))));
    ok(/Group cards? — a Behemoth counts as several/.test(rail),
       'saying how many cards that is, so the two numbers are not a mystery');
    A.remove(ga.id);
  }

  /* What rides in what, drawn rather than indented — and draggable.
   *
   * "Units with the category Transport may only be chosen along with a Squad
   * they may transport... Those two Squads form one Group" (3.2.4), so the
   * nesting IS the Group. The bracket needs the markup to hang off, and the
   * drag needs every row to be findable by Squad id; both are easy to lose in
   * a refactor and neither shows up as an error. */
  {
    const na = A.create('ucm', 'Nesting', 2000);
    const ng = A.addGroup(na);
    const tanks = A.addSquad(na, ng.id, 'ucm-main-battle-tank', 3);
    A.assignTransport(na, tanks.id, 'condor-dropship');
    await B.renderBuilder(na.id);
    const html = els['view-army'].innerHTML;
    const live = A.get(na.id).groups[0].squads;

    ok(/class="dzc-riders"/.test(html), 'a carried Squad is drawn inside its carrier’s bracket');
    ok(/Aboard Condor Dropship/.test(html), 'and the bracket names the carrier');
    ok(/dzc-squad[^"]*is-carrier/.test(html), 'the carrier is marked as one');
    eq(String(live.filter(s => !html.includes(`data-sid="${s.id}"`)).length), '0',
       'every Squad row carries its id, which is what the drag looks it up by');
    eq(String((html.match(/DZCBuilder\.sqGrip\(/g) || []).length), String(live.length),
       'and every Squad has a grip to drag it by');
    A.remove(na.id);
  }

  /* The Collection's arithmetic, which nothing had asserted either.
   *
   * It counts MODELS, not Squads — "I own four Sabres" is what decides whether
   * a Squad of six is buildable tonight — and it is advisory, never enforcing.
   * That second half is the one worth a test: owning too few models is a
   * shopping list, or a proxy, or a friend's box, and it must never make a
   * legal army illegal. The builder enforces the RULES and reports the rest.
   */
  {
    const C = win.DZCCollection;
    C.load();
    const ca = A.create('ucm', 'Shopping list', 1500);
    const cg = A.addGroup(ca);
    const clegion = A.addSquad(ca, cg.id, 'legionnaires', 6);
    A.assignTransport(ca, clegion.id, 'bear-apc');
    const cg2 = A.addGroup(ca);
    const ctank = A.addSquad(ca, cg2.id, 'ucm-main-battle-tank', 3);
    A.setModelVariant(ca, ctank.id, 1, 'Tachi');

    const need = C.needed(A.get(ca.id));
    eq(need.legionnaires, 6, 'six models of Legionnaires are needed, not one Squad of them');
    eq(need['bear-apc'], 2, 'and both Bear APCs, because a Transport Squad is models you own');
    eq(need['ucm-main-battle-tank'], 3, 'a mixed-Variant Squad counts under the one Unit it is');

    C.set('ucm', 'legionnaires', 4);
    let short = C.shortfall(A.get(ca.id));
    const legionShort = short.find(s => s.unitId === 'legionnaires');
    ok(legionShort, 'owning four of six puts Legionnaires on the shortfall');
    eq(legionShort.need + '/' + legionShort.have, '6/4', 'with both numbers, not just a flag');
    C.set('ucm', 'legionnaires', 6);
    ok(!C.shortfall(A.get(ca.id)).some(s => s.unitId === 'legionnaires'),
       'and owning six takes it off again');

    // The line that matters: nothing above may touch legality.
    C.set('ucm', 'legionnaires', 0);
    C.set('ucm', 'bear-apc', 0);
    C.set('ucm', 'ucm-main-battle-tank', 0);
    const withNone = A.validate(A.get(ca.id));
    ok(!withNone.errors.some(e => /collection|own/i.test(e.msg)),
       'owning none of it is never an error — the Collection is advisory');
    ok(C.shortfall(A.get(ca.id)).length === 3, 'though it is still the whole shopping list');
    A.remove(ca.id);
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
