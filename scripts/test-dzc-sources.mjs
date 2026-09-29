/* The data against its SOURCES: is it scanned from the PDFs rules/ holds, and
 * does every printed keyword still open the rule it was reviewed opening.
 *
 * Both exist because the other suites check the data against itself, and
 * that is how two things shipped wrong on 2026-09-28/29:
 *
 *   - The 25 September Bioficer cards sat downloaded in rules/ for a day
 *     while the app served the 11 September ones. Nothing compared the two.
 *   - "No dead chips" (test-dzc-data) passed 2062 of 2062 while every
 *     Behemoth's "LT 9”" and "Linked 1" opened Limited. A chip that opens the
 *     WRONG rule is not dead, so it was never going to catch it.
 *
 * Run: node scripts/test-dzc-sources.mjs
 * After a new card set, a new rule or a resolver change, review the mapping:
 *   UPDATE_RULE_SNAPSHOT=1 node scripts/test-dzc-sources.mjs
 * and read the diff of scripts/fixtures/rule-resolution.json. */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const win = {};
const sandbox = {
  window: win,
  console,
  fetch: async (p) => {
    try {
      const body = readFileSync(path.join(ROOT, p), 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(body) };
    } catch {
      return { ok: false, status: 404, json: async () => null };
    }
  }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(path.join(ROOT, 'js', 'dzc-data.js'), 'utf8'), sandbox);
const DZC = win.DZC;

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; }
  else { fail++; console.error(`  FAIL  ${label}${extra ? `\n        ${extra}` : ''}`); }
}
function eq(a, b, label) { ok(a === b, label, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

await DZC.loadIndex();
const FACTIONS = ['ucm', 'phr', 'scourge', 'shaltari', 'resistance', 'bioficer'];

console.log('\nthe data is scanned from the PDFs rules/ holds');
{
  const held = readdirSync(path.join(ROOT, 'rules')).filter(f => f.endsWith('.pdf'));
  const stem = f => f.replace(/_\d{6,8}(?=\.pdf$)/, '').toLowerCase();
  for (const file of FACTIONS.map(f => `faction-${f}.json`).concat(['behemoths.json'])) {
    const src = JSON.parse(readFileSync(path.join(ROOT, 'data', 'dzc', file), 'utf8')).sourcePdf;
    ok(held.indexOf(src) !== -1, `${file} was scanned from ${src}, which rules/ holds`,
      `rules/ has ${held.filter(h => stem(h) === stem(src)).join(', ') || 'no release of it'}`
      + ' -- run python tools/dzc/rebuild.py');
  }
}

console.log('\nevery keyword opens the rule it was reviewed opening');
{
  const map = {};
  for (const id of FACTIONS) {
    const f = await DZC.loadFaction(id);
    for (const u of f.units || []) {
      const fac = u.faction || id;
      const lines = [u.special || '']
        .concat((u.weapons || []).map(w => w.special || ''))
        .concat((u.gear || []).map(g => g.name || ''));
      for (const line of lines) {
        for (const tok of DZC.splitSpecial(line, fac)) {
          const r = DZC.rule(tok, fac);
          map[`${fac} | ${tok}`] = r ? (r.id || r.name) : null;
        }
      }
    }
  }
  const now = Object.fromEntries(Object.keys(map).sort().map(k => [k, map[k]]));
  ok(Object.keys(now).length > 500, 'the sweep saw the printed keywords', String(Object.keys(now).length));
  const dir = path.join(ROOT, 'scripts', 'fixtures');
  const file = path.join(dir, 'rule-resolution.json');
  if (process.env.UPDATE_RULE_SNAPSHOT || !existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(now, null, 1) + '\n');
    console.log(`  wrote ${Object.keys(now).length} keywords to scripts/fixtures/rule-resolution.json`);
  }
  const want = JSON.parse(readFileSync(file, 'utf8'));
  const changed = Object.keys({ ...want, ...now }).filter(k => want[k] !== now[k]);
  eq(changed.length, 0, 'no keyword opens a different rule than the reviewed snapshot');
  changed.slice(0, 25).forEach(k => console.error(`        ${k}: ${want[k]} -> ${now[k]}`));
  const dead = Object.keys(now).filter(k => now[k] == null);
  eq(dead.length, 0, 'and none opens nothing');
  dead.slice(0, 10).forEach(k => console.error(`        ${k}`));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
