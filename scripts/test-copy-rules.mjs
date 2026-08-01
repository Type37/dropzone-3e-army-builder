/* Tests for the copy rules in CLAUDE.md that a machine can actually check.
 *
 * These are not code correctness. They are the house style rules that keep
 * being re-broken because nothing enforces them -- FAILINGS.md asks for checks
 * that do not depend on anyone remembering, and a rule with a number in it is
 * the easiest kind to enforce.
 *
 * Only rules with an unambiguous mechanical reading live here. "Default to
 * silence over explaining" is real and is not testable; "two interpuncts" is.
 *
 *   node scripts/test-copy-rules.mjs
 */
import { readFileSync } from 'node:fs';
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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
