/* The shipped shell, checked against itself.
 *
 * Two rules, both of the same kind: something the app declares in one place
 * has to match what it does in another, and nothing at runtime ever says so.
 *
 *   1. every custom property read is one that is also set
 *   2. every file index.html loads is in the offline cache and the manifest
 *
 * ── 1 ─────────────────────────────────────────────────────────────────────
 *
 * The first rule exists because the dark theme was white text on white cards
 * across the entire builder, the picker, the reference and Play Mode, and the
 * cause was six lines that look completely fine:
 *
 *     background: var(--surface-2, #fff);
 *     border: 1px solid var(--line, #d8d0c0);
 *     color: var(--ink-2, #6b6459);
 *
 * None of --surface-2, --line, --ink-2, --danger, --acc-ink or --surface-1 was
 * defined anywhere in the project. A var() with a fallback and no definition
 * is not a token, it is a literal with extra steps -- it cannot respond to a
 * theme, and because the fallback is right there in the source it reads as
 * deliberate and renders correctly in the theme it was written for. The one
 * theme it was NOT written for is the one nobody was looking at.
 *
 * So the check is structural: collect every --name read by a var(), collect
 * every --name assigned anywhere -- CSS declaration, inline style written by
 * JS, or setProperty -- and fail on the difference. A fallback does not count
 * as a definition, which is the whole point.
 *
 * ── 2 ─────────────────────────────────────────────────────────────────────
 *
 * The second is the same shape one level out. sw.js precaches a CORE list and
 * data/offline-manifest.json describes the download the app offers as "Rules,
 * stats & app". Both are lists of what index.html loads, written by hand,
 * beside a page that changes. The manifest's list had drifted so far it named
 * four files from the Dropfleet build that are not in this repo and none of
 * the twelve DZC modules -- so "download for offline use" fetched 26 MB of art
 * and no app, and reported a size to match.
 *
 *   node scripts/test-shell.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let pass = 0, fail = 0;
const ok = (c, label, extra) => c ? pass++ : (fail++, console.error(`  FAIL  ${label}${extra ? `\n        ${extra}` : ''}`));

const read = (dir, ext) => readdirSync(path.join(ROOT, dir))
  .filter(f => f.endsWith(ext))
  .map(f => [`${dir}/${f}`, readFileSync(path.join(ROOT, dir, f), 'utf8')]);

const css = read('css', '.css');
const js = read('js', '.js');
const html = [['index.html', readFileSync(path.join(ROOT, 'index.html'), 'utf8')]];

/* Assignments. In CSS a declaration is `--name:`; in JS a token is set either
 * through an inline style in a template literal (`style="--acc:${...}"`) or
 * through setProperty. All three forms are a definition. */
const defined = new Set();
for (const [, src] of [...css, ...js, ...html]) {
  for (const m of src.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) defined.add(m[1]);
  for (const m of src.matchAll(/setProperty\(\s*['"`](--[a-zA-Z0-9-]+)/g)) defined.add(m[1]);
}

/* Reads, with the file and line so a failure names the line to go and fix. */
console.log('\nevery token read is a token set');

const reads = new Map();   // name -> [{ where, bare }]
for (const [file, src] of [...css, ...js, ...html]) {
  src.split('\n').forEach((line, i) => {
    // `bare` = no comma before the closing paren, i.e. no fallback. A bare
    // read of an unset token makes the whole declaration invalid, so the
    // property silently reverts to its initial value.
    for (const m of line.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*([,)])/g)) {
      if (!reads.has(m[1])) reads.set(m[1], []);
      reads.get(m[1]).push({ where: `${file}:${i + 1}`, bare: m[2] === ')' });
    }
  });
}
const at = sites => sites.slice(0, 3).map(s => s.where).join(', ')
  + (sites.length > 3 ? ` (+${sites.length - 3} more)` : '');

/* Deliberately unset: a per-element override, supplied by whichever element
 * wants it, so there is no global value to give it. The list is not a waiver —
 * each one is still required to carry a fallback at every read site, which is
 * what makes it safe to leave unset. Anything NOT on this list that is unset
 * is either a dead declaration or a token that cannot follow the theme. */
const PER_ELEMENT = new Set([
  '--nav-accent',        // the rail's tint, per faction; three different defaults by site
  '--current-faction',   // set on the builder root, falls back to --navy
  '--cat-color',         // set per category chip, falls back to --ink-muted
  '--tip-arrow-left',    // where a tooltip's arrow points, in px
]);

for (const [name, sites] of [...reads].sort()) {
  if (PER_ELEMENT.has(name)) {
    const bare = sites.filter(s => s.bare);
    ok(!bare.length, `${name} carries a fallback everywhere it is read`,
       `bare at ${at(bare)}`
       + `\n        It is on PER_ELEMENT, so nothing defines it — a bare read is a dead declaration.`);
    continue;
  }
  ok(defined.has(name), `${name} is defined somewhere`,
     `read at ${at(sites)}`
     + `\n        A fallback is not a definition — this token can never follow the theme.`);
}

/* The paper theme's colour tokens must all have a dark counterpart.
 *
 * The same failure one level up: a token that IS defined, but only in :root,
 * silently keeps its paper value on a dark page. Only colour-valued tokens are
 * checked -- spacing, radius, duration and z-index are deliberately shared. */
console.log('\nevery colour token has a dark value');

const COLOUR = /^\s*(--[a-zA-Z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/;
const block = (src, head) => {
  const at = src.indexOf(head);
  if (at === -1) return '';
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  return '';
};

/* Tokens whose paper value is correct on both themes, each for a reason.
 * Anything not on this list that is light-only is a bug, not a decision. */
const THEME_FREE = new Set([
  /* A faction's colour is its colour. These six are sampled off the actual
   * card banner stripes, so they are brand, not theme — the -text variants
   * beside them are the ones re-lightened for a dark surface. */
  '--faction-ucm', '--faction-phr', '--faction-scourge',
  '--faction-shaltari', '--faction-resistance', '--faction-bioficer',
]);

const lightTokens = new Map(), darkTokens = new Set();
for (const [file, src] of css) {
  for (const [head, sink] of [[':root {', lightTokens], ['html[data-theme="dark"] {', darkTokens],
                              ['[data-theme="dark"] {', darkTokens]]) {
    for (const line of block(src, head).split('\n')) {
      const m = line.match(COLOUR);
      if (!m) continue;
      if (sink === darkTokens) sink.add(m[1]);
      else sink.set(m[1], file);
    }
  }
}

for (const [name, file] of [...lightTokens].sort()) {
  if (THEME_FREE.has(name)) { pass++; continue; }
  ok(darkTokens.has(name), `${name} has a dark value`,
     `defined light-only in ${file} -- it will keep its paper colour on a dark page`);
}

/* ── 2. what the page loads is what goes offline ────────────────────────── */
console.log('\nevery file index.html loads is cached offline');

const page = html[0][1];
const loads = [...page.matchAll(/(?:src|href)="((?!https?:|#|mailto:)[^"]+)"/g)]
  .map(m => m[1])
  .filter(u => /\.(js|css)$/.test(u));

const sw = readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const core = new Set([...(sw.match(/const CORE\s*=\s*\[([\s\S]*?)\];/) || [, ''])[1]
  .matchAll(/'([^']+)'/g)].map(m => m[1].replace(/^\.\//, '')));

/* The build number Settings shows is the one sw.js caches under.
 *
 * Two numbers in two files that must agree, edited by hand at deploy time, and
 * the whole point of showing one is that a bug report can be trusted to name
 * the build it came from. A version that lies is worse than no version. */
{
  const swV = (sw.match(/const CACHE\s*=\s*'dzc-cache-v(\d+)'/) || [])[1];
  const shell = readFileSync(path.join(ROOT, 'js/dzc-shell.js'), 'utf8');
  const uiV = (shell.match(/const BUILD\s*=\s*(\d+)/) || [])[1];
  ok(!!swV, "sw.js names its cache dzc-cache-v<number>");
  ok(!!uiV, 'dzc-shell.js declares BUILD');
  ok(swV === uiV, `BUILD ${uiV} matches the service worker cache v${swV}`,
     'Bump both, or Settings and a feedback mail report a build nobody is running.');
}

const manifest = JSON.parse(readFileSync(path.join(ROOT, 'data/offline-manifest.json'), 'utf8'));
const shipped = new Set(manifest.groups.flatMap(g => g.files).map(f => f.u.replace(/^\.\//, '')));

for (const u of loads) {
  ok(core.has(u), `sw.js precaches ${u}`,
     'index.html loads it, so an install that has not fetched it yet goes offline without it.');
  ok(shipped.has(u), `the offline manifest carries ${u}`,
     'Download for offline use would report a size that does not include it, and not fetch it.');
}

/* Both lists must also be real files -- a stale entry is a 404 on install,
 * and Cache.addAll rejects the WHOLE batch on one bad URL, so a single dead
 * path takes the entire precache down with it. */
for (const u of [...core, ...shipped]) {
  if (u === '' || u === '/') continue;
  ok(existsSync(path.join(ROOT, u)), `${u} is a file that exists`,
     'Listed for offline use but not in the repo. Cache.addAll rejects the whole batch on one 404.');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
