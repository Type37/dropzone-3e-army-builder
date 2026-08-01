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
  'js/count.js', 'sw.js', 'manifest.webmanifest', 'scripts/shots.mjs'
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
  for (const m of src.matchAll(/["'`](assets\/[A-Za-z0-9_\-./]+\.(?:webp|png|svg|jpg|jpeg|ico))["'`]/g)) {
    refs.add(m[1]);
  }
}
// Only three literal asset paths exist: the two wordmarks and the touch icon.
// Everything else — faction art, unit art — is interpolated from data and is
// audited by tools/dzc/audit_art.py.
ok(refs.size >= 3, 'the asset references were actually found', `found ${refs.size}`);
const gone = [...refs].filter(p => !existsSync(path.join(ROOT, p)));
const unexpected = gone.filter(p => !KNOWN_MISSING[p]);
eq(unexpected.length, 0, 'every asset the page names is in the repo');
if (unexpected.length) console.error('        ' + unexpected.join('\n        '));
const back = Object.keys(KNOWN_MISSING).filter(p => existsSync(path.join(ROOT, p)));
eq(back.length, 0, 'and no known-missing asset is still excused after arriving',
   back.join(', '));
gone.forEach(p => console.log(`!! MISSING ${p} — ${KNOWN_MISSING[p]}`));

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
