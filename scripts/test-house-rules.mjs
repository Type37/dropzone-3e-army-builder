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
const KNOWN_MISSING = {
  'assets/logos/dzc_logo_white.webp':
    'the topbar wordmark — on Jet\'s disk, never committed (gitignore DZC_Logo_*)',
  'assets/logos/dzc_logo_dark.webp':
    'the landing wordmark — same cause. Brand art, so only Jet can supply it.'
};
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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
