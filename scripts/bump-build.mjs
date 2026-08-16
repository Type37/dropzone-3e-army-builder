/* Raise the build number in both places that hold it.
 *
 *   node scripts/bump-build.mjs
 *
 * There are two: `const BUILD` in js/dzc-shell.js, and the cache name in
 * sw.js. scripts/test-shell.mjs fails when they disagree, so this writes both
 * or neither.
 *
 * It exists for .github/workflows/sources.yml. That job commits new points
 * straight from TTCombat's PDFs without a person in the loop, and data that
 * lands without a new cache name is data nobody sees: sw.js precaches
 * data/dzc/index.json and rules.json under the old name, so an installed app
 * keeps serving the old prices with nothing on screen to say so.
 *
 * The regexes are copied from test-shell.mjs deliberately. If the declaration
 * is reworded, both fail together rather than this one silently matching
 * nothing.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHELL = path.join(ROOT, 'js', 'dzc-shell.js');
const SW = path.join(ROOT, 'sw.js');

const BUILD_RE = /(const BUILD\s*=\s*)(\d+)/;
const CACHE_RE = /(const CACHE\s*=\s*'dzc-cache-v)(\d+)(')/;

const shell = fs.readFileSync(SHELL, 'utf8');
const sw = fs.readFileSync(SW, 'utf8');

const found = shell.match(BUILD_RE);
if (!found) {
  console.error('js/dzc-shell.js: no `const BUILD = <number>` to raise.');
  process.exit(1);
}
if (!CACHE_RE.test(sw)) {
  console.error("sw.js: no `const CACHE = 'dzc-cache-v<number>'` to raise.");
  process.exit(1);
}

const next = Number(found[2]) + 1;

fs.writeFileSync(SHELL, shell.replace(BUILD_RE, `$1${next}`));
fs.writeFileSync(SW, sw.replace(CACHE_RE, `$1${next}$3`));

console.log(`Build ${found[2]} -> ${next}`);
