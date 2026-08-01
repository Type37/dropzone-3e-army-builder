/* Tests for the rules in CLAUDE.md that a machine can actually check.
 *
 * These are not code correctness. They are the house rules that keep being
 * re-broken because nothing enforces them -- FAILINGS.md asks for checks that
 * do not depend on anyone remembering, and a rule with a number in it is the
 * easiest kind to enforce.
 *
 * Only rules with an unambiguous mechanical reading live here. "Default to
 * silence over explaining" is real and is not testable; "two interpuncts" is.
 *
 *   node scripts/test-house-rules.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; }
  else { fail++; console.error(`  FAIL  ${label}${extra ? `\n        ${extra}` : ''}`); }
}
function eq(a, b, label) { ok(a === b, label, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

/* Markup with the comments taken out. A rule about what the app SAYS is about
 * what reaches the screen, so a note to a future reader does not count against
 * it -- and neither does it get a free pass to say something the UI may not. */
function rendered(file) {
  return readFileSync(path.join(ROOT, file), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
}

// -------------------------------------------------------------- interpunct
/* CLAUDE.md §3: "Interpunct (·): two uses in the entire app. No more."
 *
 * The Dropfleet footer puts one between every pair -- five in its markup alone
 * -- which is exactly what the rule is a reaction to, so the source app is not
 * the answer here. Ours spends both in the footer. */
console.log('\ninterpunct');
const markup = rendered('index.html');
const puncts = (markup.match(/·/g) || []).length;
ok(puncts <= 2, 'at most two interpuncts reach the screen', `found ${puncts} in index.html`);
eq(puncts, 2, 'both are in the footer, and nothing else has taken one');

/* Most of the app's text is built in JS, not written in index.html, so
 * counting only the markup file left the rule enforced over the smaller half.
 * &middot; counts too — it is the same character by the time anyone reads it,
 * and it is the form that slips past a search for the glyph. Found by writing
 * one into the printed Commander block and catching it by hand, which is
 * exactly the kind of check that should not depend on catching it by hand. */
const punctJs = [];
for (const f of readdirSync(path.join(ROOT, 'js')).filter(n => n.endsWith('.js'))) {
  const src = readFileSync(path.join(ROOT, 'js', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  src.split('\n').forEach((line, i) => {
    if (line.trim().startsWith('//')) return;
    if (/·|&middot;/i.test(line)) punctJs.push(`js/${f}:${i + 1}`);
  });
}
eq(punctJs.length, 0, 'and nothing the JS renders spends another one');
if (punctJs.length) console.error('        ' + punctJs.join('\n        '));

/* The printable references are pages of the app too, and both are spent. The
 * Dropfleet sheets they are built on use an interpunct in the sub-heading
 * ("Dropfleet Commander · printable reference sheets"), which is exactly the
 * copy this rule was written against. */
const punctRef = ['assets/ref/index.html', 'assets/ref/sheet.html']
  .filter(f => /·|&middot;/i.test(rendered(f)));
eq(punctRef.length, 0, 'and the printable references spend none', punctRef.join(', '));

// ------------------------------------------------------------- the banned word
/* CLAUDE.md §3: never write "datasheet" -- not in the UI, not in code, not in
 * a comment, not in a variable name. It is not Jet's word; it arrived with the
 * Dropfleet source and was smuggled in from there. Where a noun is unavoidable
 * the domain term is "stat card", which is what TTCombat call the source PDFs.
 *
 * Comments count for this one, unlike the interpunct: the rule says so, and a
 * word that lives in the comments is a word that comes back into the UI. */
console.log('\nthe banned word');
const SEARCHED = [
  'index.html', 'css/app.css', 'css/dzc.css', 'css/dzc-print.css', 'css/mobile-fixes.css',
  'js/dzc-data.js', 'js/dzc-army.js', 'js/dzc-builder.js', 'js/dzc-units.js',
  'js/dzc-icons.js', 'js/dzc-share.js', 'js/dzc-play.js', 'js/dzc-collection.js',
  'js/dzc-shell.js', 'js/rank-insignia.js', 'js/fleet-sync.js', 'js/offline-sync.js',
  'js/count.js', 'sw.js', 'manifest.webmanifest', 'scripts/shots.mjs',
  'assets/ref/index.html', 'assets/ref/sheet.html'
];
// One capture on disk is named for it, and a dozen Todoist tasks cite that
// filename. Renaming it breaks those citations and changes nothing in the
// product, so the exception is written down rather than quietly tolerated.
const ALLOWED = /'17-detail-datasheet'|banned word|Renaming it breaks/;
const offenders = [];
for (const file of SEARCHED) {
  let src;
  try { src = readFileSync(path.join(ROOT, file), 'utf8'); } catch { continue; }
  src.split('\n').forEach((line, i) => {
    if (/datasheet/i.test(line) && !ALLOWED.test(line)) offenders.push(`${file}:${i + 1}`);
  });
}
eq(offenders.length, 0, 'nothing in the app says "datasheet"');
if (offenders.length) console.error('        ' + offenders.join('\n        '));

// ------------------------------------------------------------ nothing off-site
/* CLAUDE.md §4: never a CDN -- it breaks offline, which is the one thing the
 * service worker exists to prevent. Written for icons, true of any script.
 *
 * d3 and topojson sat here for months after the only thing that used them --
 * the Dropfleet world-map thumbnail -- was deleted, because a script tag that
 * loads successfully looks exactly like a script tag that is needed.
 *
 * The analytics counter is not an exception: data-goatcounter names a remote
 * endpoint, but the script itself is js/count.js and ships with the app. */
console.log('\nnothing off-site');
const srcs = [...markup.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map(m => m[1]);
const offsite = srcs.filter(s => /^(https?:)?\/\//.test(s));
ok(srcs.length > 0, 'the script tags were actually found', `matched ${srcs.length}`);
eq(offsite.length, 0, 'every script the page loads ships with the app');
if (offsite.length) console.error('        ' + offsite.join('\n        '));

// --------------------------------------------------- every control has a name
/* Gap 103: a control whose only content is an icon has no name at all in the
 * accessibility tree, and title= does not fix that -- it is a hover
 * affordance, which a screen reader treats as optional and a phone cannot
 * produce. So an icon-only button needs aria-label, and this counts them.
 *
 * It found three: the picker's view toggle had no name whatsoever, and Play
 * Mode's Command Point steppers announced themselves as "minus" and "plus".
 *
 * Not testable from the pixels, which is why it lives here rather than waiting
 * on a browser someone has to open. */
console.log('\nevery control has a name');

/* Split a template literal's body into its literal text and its ${...}
 * expressions, balancing braces so ${DZCIcon('add', { size: 14 })} comes out
 * as one expression rather than being cut at the first inner brace. */
function splitInterpolations(src) {
  const literals = [], exprs = [];
  let i = 0, last = 0;
  while ((i = src.indexOf('${', i)) !== -1) {
    literals.push(src.slice(last, i));
    let depth = 0, j = i + 1;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) break;
    }
    exprs.push(src.slice(i + 2, j));
    i = last = j + 1;
  }
  literals.push(src.slice(last));
  return { literals, exprs };
}

// These render a glyph, never a word, so a button holding only one of them is
// as nameless as an empty button.
const DRAWS_NO_WORDS = /DZCIcon|RankInsignia|transportHtml/;

const SOURCES = ['index.html', ...readdirSync(path.join(ROOT, 'js'))
  .filter(f => f.endsWith('.js')).map(f => `js/${f}`)];
let buttons = 0;
const nameless = [];
for (const file of SOURCES) {
  const src = readFileSync(path.join(ROOT, file), 'utf8');
  for (const m of src.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    buttons++;
    if (/aria-label\s*=/.test(m[1])) continue;
    const { literals, exprs } = splitInterpolations(m[2]);
    const words = literals.join(' ')
      .replace(/<svg[\s\S]*?<\/svg>/g, '')
      .replace(/<[^>]*>/g, '');
    if (/[A-Za-z]/.test(words)) continue;
    if (exprs.some(e => !DRAWS_NO_WORDS.test(e))) continue;
    nameless.push(`${file}:${src.slice(0, m.index).split('\n').length}`);
  }
}
ok(buttons > 50, 'the buttons were actually found', `matched ${buttons}`);
eq(nameless.length, 0, 'no button is left without an accessible name');
if (nameless.length) console.error('        ' + nameless.join('\n        '));

/* The same rule for the controls that are not buttons. An <input> or a
 * <select> with nothing naming it is announced as "edit text" or "combo box"
 * and nothing else, and a placeholder does not fix it — a placeholder is
 * cleared the moment you type, so it names the field only while the field is
 * empty. Three ways count, all of which the app already uses somewhere:
 * aria-label, a <label for> pointing at its id, or being wrapped in a <label>
 * that contains words. */
const controls = [];
const unnamed = [];
/* Comments out first. This file's own prose says "<select>" and "<input>" more
 * than once, and a note to a future reader is not a control on the page --
 * same reasoning as rendered() above. Line comments only where the line starts
 * with one, so a URL keeps its slashes. */
const decommented = src => src
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .split('\n').map(l => (l.trim().startsWith('//') ? '' : l)).join('\n');
for (const file of SOURCES) {
  const src = file.endsWith('.js')
    ? decommented(readFileSync(path.join(ROOT, file), 'utf8'))
    : readFileSync(path.join(ROOT, file), 'utf8');
  const fors = new Set([...src.matchAll(/<label\b[^>]*\bfor=["']([^"']+)["']/g)].map(m => m[1]));
  // Every <label> that has words of its own, as [start, end) ranges.
  const wrapping = [];
  for (const m of src.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)) {
    // An interpolated label ("${label}") is words at runtime, so it counts --
    // unless it renders a glyph, which is the same exception the buttons make.
    const body = m[1].replace(/<svg[\s\S]*?<\/svg>/g, '');
    const { literals, exprs } = splitInterpolations(body);
    const named = /[A-Za-z]/.test(literals.join(' ').replace(/<[^>]*>/g, ''))
      || exprs.some(e => !DRAWS_NO_WORDS.test(e));
    if (named) wrapping.push([m.index, m.index + m[0].length]);
  }
  for (const m of src.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
    const attrs = m[2];
    if (/\btype=["']hidden["']/.test(attrs)) continue;
    controls.push(1);
    if (/aria-label\s*=/.test(attrs)) continue;
    const id = (attrs.match(/\bid=["']([^"']+)["']/) || [])[1];
    if (id && fors.has(id)) continue;
    if (wrapping.some(([a, b]) => m.index > a && m.index < b)) continue;
    unnamed.push(`${file}:${src.slice(0, m.index).split('\n').length} <${m[1]}>`);
  }
}
ok(controls.length > 10, 'the form controls were actually found', `matched ${controls.length}`);
eq(unnamed.length, 0, 'no input, select or textarea is left without an accessible name');
if (unnamed.length) console.error('        ' + unnamed.join('\n        '));

/* A contenteditable is a text field that does not look like one to anything
 * but a mouse. With no role it is announced as a generic container and its
 * CONTENT is read as the name, so an army called "Untitled" is a field called
 * "Untitled" -- the label and the value are the same string and neither says
 * it can be typed in. role=textbox plus aria-label is what the army name and
 * the Group name already do; the Commander name did not, and this found it. */
const editables = [];
const untyped = [];
for (const file of SOURCES) {
  const src = file.endsWith('.js')
    ? decommented(readFileSync(path.join(ROOT, file), 'utf8'))
    : readFileSync(path.join(ROOT, file), 'utf8');
  for (const m of src.matchAll(/<(\w+)\b([^>]*\bcontenteditable=["']true["'][^>]*)>/g)) {
    editables.push(1);
    if (/role=["']textbox["']/.test(m[2]) && /aria-label\s*=/.test(m[2])) continue;
    untyped.push(`${file}:${src.slice(0, m.index).split('\n').length} <${m[1]}>`);
  }
}
ok(editables.length >= 3, 'the editable headings were actually found', `matched ${editables.length}`);
eq(untyped.length, 0, 'every contenteditable says it is a text box and what it names');
if (untyped.length) console.error('        ' + untyped.join('\n        '));

// ------------------------------------------------- every asset actually exists
/* An <img> whose file is not in the repo cannot deploy: .github/workflows
 * deploy.yml copies assets/ straight out of the checkout, so a file that was
 * never committed is a 404 on the live site and a broken-image icon on the
 * page.
 *
 * This is here because it happened. .gitignore carried an unanchored
 * "DZC_Logo_*" from before the fork, and on Windows -- where git defaults to
 * core.ignorecase=true -- that also matched assets/logos/dzc_logo_white.webp.
 * git add skipped the topbar and landing logos without a word, and nothing
 * noticed for two days, because the only way to notice was to load the page.
 *
 * Missing files that are already known are warnings, matching how
 * audit_rules.py treats a known card defect: a listed one is a decision, an
 * unlisted one is a bug. A listed one that has since appeared fails, so the
 * list cannot go stale. */
console.log('\nevery asset actually exists');
// Empty, and it should stay that way. Both wordmarks were listed here: they
// were on disk and simply never `git add`ed -- not ignored, just missed -- so
// the deployed site 404'd on its own logo while localhost looked fine. They
// are committed now. This test is what found it.
const KNOWN_MISSING = {};
const refs = new Set();
for (const file of ['index.html', ...readdirSync(path.join(ROOT, 'js'))
  .filter(f => f.endsWith('.js')).map(f => `js/${f}`)]) {
  const src = readFileSync(path.join(ROOT, file), 'utf8');
  // Only literal paths. An interpolated src is built at runtime from data and
  // is covered by tools/dzc/audit_art.py instead.
  // html too: the printable quick references live under assets/, and a landing
  // tile pointing at a page that is not there is the same 404 as a missing logo.
  for (const m of src.matchAll(/["'`](assets\/[A-Za-z0-9_\-./]+\.(?:webp|png|svg|jpg|jpeg|ico|html))["'`]/g)) {
    refs.add(m[1]);
  }
}
// The two wordmarks, the touch icon, and the quick-reference chooser.
// Everything else — faction art, unit art — is interpolated from data and is
// audited by tools/dzc/audit_art.py.
ok(refs.size >= 4, 'the asset references were actually found', `found ${refs.size}`);
const gone = [...refs].filter(p => !existsSync(path.join(ROOT, p)));
const unexpected = gone.filter(p => !KNOWN_MISSING[p]);
eq(unexpected.length, 0, 'every asset the page names is in the repo');
if (unexpected.length) console.error('        ' + unexpected.join('\n        '));
const back = Object.keys(KNOWN_MISSING).filter(p => existsSync(path.join(ROOT, p)));
eq(back.length, 0, 'and no known-missing asset is still excused after arriving',
   back.join(', '));
gone.forEach(p => console.log(`!! MISSING ${p} — ${KNOWN_MISSING[p]}`));

// -------------------------------------------------- art degrades quietly
/* Gap 37: a missing image must leave the layout intact -- no broken-image
 * icon, no gap where a picture was. Every <img> the JS builds therefore
 * removes itself on error.
 *
 * It matters because unit art is INTERPOLATED from data, so the asset check
 * above cannot see it: tools/dzc/audit_art.py proves every Unit has a file
 * today, and the day a re-scan renames one is the day this is the only thing
 * standing between you and twelve broken icons on the picker. */
console.log('\nart degrades quietly');
{
  const imgs = [];
  for (const f of readdirSync(path.join(ROOT, 'js')).filter(n => n.endsWith('.js'))) {
    const src = readFileSync(path.join(ROOT, 'js', f), 'utf8');
    for (const m of src.matchAll(/<img\b[\s\S]{0,300}?>/g)) {
      imgs.push({ at: `js/${f}:${src.slice(0, m.index).split('\n').length}`, tag: m[0] });
    }
  }
  ok(imgs.length > 8, 'the images were actually found', `${imgs.length}`);
  const bare = imgs.filter(i => !/onerror=/.test(i.tag)).map(i => i.at);
  eq(bare.length, 0, 'every image the app builds removes itself if it 404s');
  if (bare.length) console.error('        ' + bare.join('\n        '));
}

// ------------------------------------------ no word twice more than twice
/* CLAUDE.md §3: "No single word or phrase appears more than twice on one
 * screen."
 *
 * The landing screen was carrying "Army Builder" three times -- the topbar
 * context, the tile, and the footer credit -- and nobody counted, because
 * counting words on a screen is not something a person does.
 *
 * SCOPE, stated plainly rather than implied: this reads the STATIC markup of
 * index.html only, split into the screens it declares -- the landing screen
 * (topbar, landing section, footer) and each modal. The views the JS builds
 * are not covered and this does not pretend they are; they would need the
 * renderers driven for real, which is scripts/test-dzc-render.mjs's job.
 *
 * A repeat is allowed by being listed, with the reason. Same shape as the
 * known-missing assets above: a listed one is a decision, an unlisted one is
 * the rule being broken. */
console.log('\nno word more than twice on one screen');
{
  // Words too small or too common to mean anything on a screen.
  const NOISE = new Set(['and', 'the', 'for', 'you', 'your', 'with', 'what',
    'all', 'own', 'still', 'needs', 'from', 'this', 'that', 'are', 'not', 'its']);
  // Empty, and it should stay that way. Keyed "screen: word", valued with the
  // reason -- an excuse with no reason beside it is how a rule quietly stops
  // meaning anything.
  const ALLOWED = {};
  const strip = s => s
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/g, ' ');
  const raw = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const grab = re => (raw.match(re) || [''])[0];
  const screens = [
    ['landing', grab(/<header class="topbar"[\s\S]*?<\/header>/)
      + grab(/<section class="landing"[\s\S]*?<\/section>/)
      + grab(/<footer class="game-info-footer"[\s\S]*?<\/footer>/)]
  ];
  for (const m of raw.matchAll(/<div class="modal-overlay"[^>]*id="([^"]+)"[\s\S]*?\n<\/div>/g)) {
    screens.push([m[1], m[0]]);
  }
  /* The quick-reference chooser is a screen of the app too, and it was outside
   * this check entirely — six faction names down a page is exactly the shape
   * of thing that repeats a word without anyone noticing. Its sibling
   * sheet.html is not here because it has no static text at all: every word on
   * it is drawn from data/dzc at load, and this check reads markup. */
  screens.push(['reference chooser', readFileSync(path.join(ROOT, 'assets/ref/index.html'), 'utf8')]);
  ok(screens.length > 5, 'the screens were actually found', `${screens.length}`);

  const over = [];
  for (const [name, html] of screens) {
    const words = (strip(html).toLowerCase().match(/[a-z][a-z'’-]+/g) || [])
      .filter(w => w.length > 3 && !NOISE.has(w));
    const seen = {};
    words.forEach(w => { seen[w] = (seen[w] || 0) + 1; });
    // Two-word phrases as well: "army builder" was the real offender, and
    // neither of its halves was over on its own once the tile was counted.
    for (let i = 0; i < words.length - 1; i++) {
      const g = words[i] + ' ' + words[i + 1];
      seen[g] = (seen[g] || 0) + 1;
    }
    Object.keys(seen).filter(k => seen[k] > 2).forEach(k => {
      const key = `${name}: ${k}`;
      if (!ALLOWED[key]) over.push(`${key} ×${seen[k]}`);
    });
  }
  eq(over.length, 0, 'no word or pair is said three times on one screen');
  if (over.length) console.error('        ' + over.join('\n        '));
}

// ------------------------------------------------------------- sharp cards
/* CLAUDE.md §4: "Every card surface is square -- border-radius: 0. Buttons,
 * chips and inputs may keep a radius; a control can be soft, a panel may not."
 *
 * A standing rule, so it needs a standing check. css/app.css is Dropfleet-era
 * and rounds everything, and css/dzc.css squares things back one selector at a
 * time -- which means the rule holds only for the surfaces someone remembered
 * to list. The landing tiles and both grids in the New Army dialog were
 * rounded for a fortnight after the rule was made, on the first two screens
 * anyone sees.
 *
 * Cascade order is the load order in index.html, so the LAST declaration for a
 * surface is the one that paints. */
console.log('\nsharp cards');
{
  const SURFACES = [
    'dzc-pick', 'dzc-card', 'dzc-army-card', 'dzc-army-new', 'dzc-rail-card',
    'dzc-group-card', 'dzc-issues', 'dzc-cmdr-opt', 'dzc-cmdr-add', 'dzc-pcard',
    'dzc-play-group', 'dzc-pop', 'dzc-toast', 'dzc-upgrades', 'dzc-coll-row',
    'dzc-short', 'dzc-ratio', 'dzc-faction-btn', 'tool-card', 'game-size-option',
    'modal-panel'
  ];
  // The order index.html loads them in. A later file wins, which is the whole
  // reason dzc.css can square what app.css rounded.
  const sheets = ['css/app.css', 'css/mobile-fixes.css', 'css/dzc.css']
    .map(f => readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))
    .join('\n');
  const last = {};
  // Innermost blocks only, so an @media wrapper is skipped rather than parsed.
  for (const m of sheets.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const radius = (m[2].match(/border-radius\s*:\s*([^;]+)/) || [])[1];
    if (!radius) continue;
    for (const cls of SURFACES) {
      if (new RegExp(`\\.${cls}(?![\\w-])`).test(m[1])) last[cls] = radius.trim();
    }
  }
  const missing = SURFACES.filter(c => last[c] == null);
  eq(missing.length, 0, 'every listed surface actually declares a radius', missing.join(', '));
  const soft = SURFACES.filter(c => last[c] && last[c] !== '0');
  eq(soft.length, 0, 'and the last word on every card surface is border-radius: 0',
     soft.map(c => `.${c} -> ${last[c]}`).join(', '));
}

// ------------------------------------------------------------ the way back
/* The topbar's context slot carries the back chevron on every view, and Play
 * Mode's Reset game beside it. css/app.css hides the whole slot below 768px --
 * correct when a phone got the separate mobile/ build with its own chrome, and
 * left behind when that build was deleted. For a fortnight a phone had no way
 * back from an army except the wordmark, which goes to the landing screen, and
 * no way to reset a game at all.
 *
 * CLAUDE.md §4: the phone is the case that has to work, because it is the one
 * used at a table. So the last word on this slot may not be display: none.
 * Cascade order is the load order in index.html. */
console.log('\nthe way back');
{
  const sheets = ['css/app.css', 'css/mobile-fixes.css', 'css/dzc.css']
    .map(f => readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))
    .join('\n');
  let last = null;
  for (const m of sheets.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/\.topbar-context(?![\w-])/.test(m[1])) continue;
    const d = (m[2].match(/display\s*:\s*([^;]+)/) || [])[1];
    if (d) last = d.trim();
  }
  ok(last && last !== 'none',
     'the topbar keeps its back chevron at every width', `display: ${last}`);
}

// ------------------------------------------------- everything fetched is staged
/* The deploy workflow copies a NAMED list of top-level paths into _site, so a
 * directory the site fetches but the list does not name is a 404 on the live
 * site and fine on localhost. That is the failure mode the two missing logos
 * had, in a different disguise: the only way to notice is to load the deployed
 * page, and nobody does that on the one screen the change was not about.
 *
 * So: every top-level path index.html and the service worker reach for has to
 * be on the cp line. This is a read of the workflow, not a write — the token a
 * cloud run gets cannot edit one. */
console.log('\neverything the site fetches is staged for deploy');
{
  const wf = readFileSync(path.join(ROOT, '.github/workflows/deploy.yml'), 'utf8');
  const cp = (wf.match(/cp -r ([\s\S]*?)\n\s*echo/) || [])[1] || '';
  const staged = new Set(cp.replace(/\\\n/g, ' ').split(/\s+/)
    .filter(Boolean).filter(w => w !== '_site/'));
  ok(staged.size > 5, 'the staged list was actually found', [...staged].join(' '));

  const wanted = new Set();
  const add = p => { const top = p.replace(/^\.\//, '').split('/')[0]; if (top) wanted.add(top); };
  for (const m of markup.matchAll(/(?:href|src)="(?!https?:|mailto:|#|data:)([^"]+)"/g)) add(m[1]);
  for (const m of readFileSync(path.join(ROOT, 'sw.js'), 'utf8')
    .matchAll(/'\.\/([^']+)'/g)) add('./' + m[1]);
  const unstaged = [...wanted].filter(p => p && !staged.has(p) && existsSync(path.join(ROOT, p)));
  eq(unstaged.length, 0, 'every top-level path the site fetches is on the cp line',
     unstaged.join(', '));
}

// -------------------------------- the preview and the printer agree on breaks
/* The print preview draws the page breaks. It can only draw them where the
 * printer will actually make them, and the two know that from different
 * places: the stylesheet says which blocks must not be cut, and paginate()
 * carries its own list of the blocks it treats as unbreakable.
 *
 * A block the stylesheet keeps whole and paginate does not know about is a
 * break drawn where the printer will not make one — a preview that lies, which
 * is worse than no preview, because the whole reason it exists is that you can
 * trust what you see before spending paper. The source comment on paginate
 * says the two lists have to stay in step; nothing was holding them there.
 *
 * One direction only. paginate may treat MORE things as atoms than the
 * stylesheet marks — a heading it keeps with what follows is not a
 * break-inside rule — but it may never know about fewer.
 */
console.log('\nthe print preview knows every block the stylesheet keeps whole');
{
  const css = readFileSync(path.join(ROOT, 'css/dzc-print.css'), 'utf8');
  const builder = readFileSync(path.join(ROOT, 'js/dzc-builder.js'), 'utf8');

  /* Every rule block that declares break-inside: avoid, back to the class it
   * actually applies to.
   *
   * The SUBJECT of the selector, not every class in it. Each rule here is
   * scoped ":is(#dzc-print, .pp-paper) .pr-group", so taking every class would
   * report .pp-paper — the paper the sheet is drawn on — as a block that must
   * not be cut. Commas are split at paren depth zero so the :is() list is not
   * mistaken for a selector list. */
  const subjects = sel => {
    const parts = [];
    let depth = 0, start = 0;
    for (let i = 0; i < sel.length; i++) {
      if (sel[i] === '(') depth++;
      else if (sel[i] === ')') depth--;
      else if (sel[i] === ',' && depth === 0) { parts.push(sel.slice(start, i)); start = i + 1; }
    }
    parts.push(sel.slice(start));
    return parts.map(p => p.trim().split(/\s+/).pop() || '');
  };
  const whole = new Set();
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!/break-inside\s*:\s*avoid/.test(m[2])) continue;
    for (const s of subjects(m[1])) {
      for (const c of s.matchAll(/\.([a-z][\w-]*)/g)) whole.add(c[1]);
    }
  }
  ok(whole.size >= 3, 'the stylesheet names blocks it will not cut', [...whole].join(', '));

  const atoms = (builder.match(/paper\.querySelectorAll\('([^']*pr-[^']*)'\)/) || [])[1] || '';
  ok(atoms.length > 10, 'and paginate has its own list of them', atoms);
  const unknown = [...whole].filter(c => !atoms.includes('.' + c));
  eq(unknown.length, 0, 'and knows about every one of them', unknown.join(', '));
}

// ------------------------------------- the offline precache matches the page
/* Everything index.html loads has to be in the service worker's CORE list.
 *
 * Not because a missing entry crashes anything — a <script> that 404s takes
 * only itself down — but because the list is a promise that the app works at a
 * table with no signal, and a promise nobody checks is the same drift that put
 * ref/ on the live site as a 404. Two files had been outside it since they
 * were added.
 */
console.log('\nthe offline precache matches what the page loads');
{
  const sw = readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const core = new Set([...sw.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]));
  ok(core.size > 15, 'the precache list was found', `${core.size} entries`);
  const loaded = [...markup.matchAll(/(?:src|href)="((?:js|css)\/[^"]+)"/g)].map(m => m[1]);
  ok(loaded.length > 10, 'and index.html loads a good few of them', `${loaded.length}`);
  const uncached = [...new Set(loaded)].filter(p => !core.has(p));
  eq(uncached.length, 0, 'every script and stylesheet the page loads is precached',
     uncached.join(', '));
}

// --------------------------------------------------- every route lands somewhere
/* The router is the one part of the app nothing drives.
 *
 * It is also the part that carries a link somebody else clicked: #army/<id> off
 * a bookmark, #share/<payload> out of a message, #play/<id> off the topbar. A
 * route naming a view id that index.html does not declare shows a blank page
 * and throws nothing, which is exactly how ref/ once 404'd — the same shape of
 * fault, a name pointing at something that is not there.
 *
 * Static, deliberately: it reads the switch out of the source and holds it
 * against the markup, which needs no browser and cannot go stale against one.
 */
console.log('\nevery route lands on a view that exists');
{
  const shell = readFileSync(path.join(ROOT, 'js/dzc-shell.js'), 'utf8');
  const body = (shell.match(/function showView\([\s\S]*?\n  \}\n/) || [''])[0];
  ok(body.length > 400, 'showView was found in the shell', `${body.length} chars`);

  const views = [...new Set([...body.matchAll(/show\('([\w-]+)'\)/g)].map(m => m[1]))];
  ok(views.length >= 6, 'and it names at least six views', views.join(', '));
  const missing = views.filter(v => !new RegExp(`id="${v}"`).test(markup));
  eq(missing.length, 0, 'every view it shows is declared in index.html', missing.join(', '));

  // The routes HANDOFF §5 lists. A case quietly disappearing sends a real link
  // to the landing page, which looks like the app working.
  const routes = ['armies', 'army', 'play', 'collection', 'units', 'share'];
  const gone = routes.filter(r => !new RegExp(`case '${r}':`).test(body));
  eq(gone.length, 0, 'and every documented route still has a case', gone.join(', '));
  ok(/default:/.test(body), 'with a default, so an unknown hash lands on the landing screen');
}

// ------------------------------------------- the reference sheet stays in step
/* ref/ is a separate document, so it cannot import the app's modules — it
 * carries its own copy of the six factions and the six transport symbols.
 *
 * That copy is only safe if something holds it to the original. The symbol
 * SHAPE is the vocabulary of how a Group forms (3.2.4.2), so a path drawn
 * slightly differently on the printed sheet is a different symbol; and a
 * faction whose accent drifts is two brands for one army.
 *
 * The accents in the chooser are pinned as well, because the chooser is
 * where all six sit side by side and a wrong one is most visible. */
console.log('\nthe reference sheet stays in step');
{
  const paths = src => [...src.matchAll(/(square|diamond|triangle|triangle-down|circle|pentagon)'?:\s*\{\s*ink:\s*'([^']+)',\s*path:\s*'([^']+)'/g)]
    .map(m => `${m[1]}|${m[2]}|${m[3]}`);
  const factions = src => [...src.matchAll(/\{\s*id:\s*'([a-z]+)',\s*name:\s*'[^']*',\s*full:\s*'[^']*',\s*accent:\s*'(#[0-9a-f]{6})'/gi)]
    .map(m => `${m[1]}|${m[2].toLowerCase()}`);

  const units = readFileSync(path.join(ROOT, 'js/dzc-units.js'), 'utf8');
  const builder = readFileSync(path.join(ROOT, 'js/dzc-builder.js'), 'utf8');
  const sheet = readFileSync(path.join(ROOT, 'assets/ref/sheet.html'), 'utf8');
  const chooser = readFileSync(path.join(ROOT, 'assets/ref/index.html'), 'utf8');

  const appSymbols = paths(units), refSymbols = paths(sheet);
  eq(appSymbols.length, 6, 'six transport symbols in js/dzc-units.js');
  eq(refSymbols.join(' '), appSymbols.join(' '),
     'the sheet draws the same six symbols, same paths, same ink');

  const appFactions = factions(builder), refFactions = factions(sheet);
  eq(appFactions.length, 6, 'six factions in js/dzc-builder.js');
  eq(refFactions.join(' '), appFactions.join(' '), 'the sheet carries the same six');

  // The chooser holds its accents in CSS custom properties, one class each.
  const chooserAccents = appFactions.map(f => f.split('|')[0])
    .map(id => {
      const m = chooser.match(new RegExp(`\\.${id}\\s*\\{\\s*--f:\\s*(#[0-9a-f]{6})`, 'i'));
      return `${id}|${m ? m[1].toLowerCase() : 'missing'}`;
    });
  eq(chooserAccents.join(' '), appFactions.join(' '), 'and so does the chooser');
}

// -------------------------------------------------------------- unused styling
/* Rules for classes nothing renders any more. Not a failure — ever. A class
 * built by interpolation (dzc-issues--${kind}) is live and unfindable by
 * grep, so a hard assertion here would block legitimate work, and a check that
 * cries wolf gets deleted. It warns, and someone decides.
 *
 * Worth having because dead styling is not inert: it is the residue of a
 * feature that was removed, it describes a screen that no longer exists, and
 * the next person to read it believes it. */
console.log('\nunused styling');
{
  const css = ['css/dzc.css', 'css/dzc-print.css']
    .map(f => readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const src = SOURCES.map(f => readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  // Built as `dzc-issues--${kind}` from 'err' and 'warn'; grep cannot see them.
  const INTERPOLATED = /^dzc-issues--(err|warn)$/;
  const declared = new Set([...css.matchAll(/\.((?:dzc|pr|pp)-[A-Za-z0-9_-]+)/g)].map(m => m[1]));
  ok(declared.size > 100, 'the stylesheet classes were actually found', `${declared.size}`);
  const unused = [...declared]
    .filter(c => !src.includes(c) && !INTERPOLATED.test(c)).sort();
  unused.forEach(c => console.log(`!! unused style .${c} — nothing renders it`));
  console.log(`  ${declared.size} classes declared, ${unused.length} unreferenced`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
