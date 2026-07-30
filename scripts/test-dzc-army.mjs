/* Army construction tests for js/dzc-army.js, against the REAL scanned units.
 *
 * These are the rules that decide whether a list is legal at a table, so each
 * assertion names the rulebook section it is defending.
 *
 *   node scripts/test-dzc-army.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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

let pass = 0, fail = 0;
const ok = (c, label, extra) => c ? pass++ : (fail++, console.error(`  FAIL  ${label}${extra ? `\n        ${extra}` : ''}`));
const eq = (a, b, label) => ok(a === b, label, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const hasErr = (v, frag) => v.errors.some(e => e.msg.toLowerCase().includes(frag.toLowerCase()));

await DZC.loadIndex();
await DZC.loadFaction('ucm');
A.load();

// Helper: a minimal legal-ish army we can break in specific ways.
function army(limit = 1500) {
  const a = A.create('ucm', 'Test', limit);
  return a;
}

console.log('\ncosting');
{
  const a = army();
  const g = A.addGroup(a);
  // UCM Main Battle Tank is variant-priced: Sabre 35, Tachi 40. There is NO
  // unit-level price, so a naive cost would be zero.
  const s = A.addSquad(a, g.id, 'ucm-main-battle-tank', 2);
  eq(A.squadCost(a, s), 70, 'two Sabres cost 70 (variant price, not a null unit price)');
  A.setModelVariant(a, s.id, 0, 'Tachi');
  eq(A.squadCost(a, s), 75, 'mixing a Tachi in costs 40 + 35 — variants are per model (3.2.2)');
  A.setCommander(a, s.id, 5);
  eq(A.squadCost(a, s), 165, 'a Level 5 Commander adds 90pts (3.2.5)');
  A.remove(a.id);
}

console.log('\ncategory ratios (3.2)');
{
  const a = army();
  const g = A.addGroup(a);
  A.addSquad(a, g.id, 'archangel', 2);           // Vanguard
  let v = A.validate(a);
  ok(hasErr(v, 'exceeds Standard'), 'Vanguard with no Standard is illegal');
  const g2 = A.addGroup(a);
  A.addSquad(a, g2.id, 'ucm-main-battle-tank', 9);   // Standard, 9x35 = 315
  v = A.validate(a);
  ok(!hasErr(v, 'exceeds Standard'), 'enough Standard spend clears the ratio');
  // Commander points are IGNORED for the ratio (3.2.5) but count to the total.
  const s = A.groupOf(a, g.squads[0].id).squads[0];
  A.setCommander(a, s.id, 7);
  v = A.validate(a);
  ok(!hasErr(v, 'exceeds Standard'), 'a Commander cannot push Vanguard over Standard (3.2.5)');
  A.remove(a.id);
}

console.log('\ngroup cost cap (3.2)');
{
  const a = army(1000);                       // quarter = 250
  eq(DZC.maxGroupCost(1000), 250, 'the cap is a quarter of the AGREED limit');
  const g = A.addGroup(a);
  A.addSquad(a, g.id, 'ucm-main-battle-tank', 9);   // 315 > 250
  ok(hasErr(A.validate(a), 'quarter of the limit'), 'a Group over a quarter of the limit is illegal');
  A.remove(a.id);
}

console.log('\nRare and Unique (3.2.1)');
{
  const a = army(1000);                       // Skirmish: 1 Rare
  const g = A.addGroup(a);
  A.addSquad(a, g.id, 'archangel', 1);
  A.addSquad(a, g.id, 'archangel', 1);
  ok(hasErr(A.validate(a), 'Rare'), 'two Rare squads of a name is illegal at Skirmish');
  const b = army(2500);                       // Battle: 3 Rare
  const g2 = A.addGroup(b);
  A.addSquad(b, g2.id, 'archangel', 1);
  A.addSquad(b, g2.id, 'archangel', 1);
  ok(!hasErr(A.validate(b), 'Rare'), 'two is fine at Battle');
  A.remove(a.id); A.remove(b.id);
}

console.log('\ntransports (3.2.4)');
{
  const a = army();
  const g = A.addGroup(a);
  const condor = A.addSquad(a, g.id, 'condor-dropship', 1);
  ok(hasErr(A.validate(a), 'carries nothing'), 'a Transport carrying nothing is illegal');

  const bears = A.addSquad(a, g.id, 'bear-apc', 1);
  A.setCarrier(a, bears.id, condor.id);
  ok(hasErr(A.validate(a), 'not full'), 'one Bear APC leaves the Condor unfilled (must be taken full)');

  A.setModelCount(a, bears.id, 2);
  ok(!hasErr(A.validate(a), 'not full'), 'two Bear APCs fill a Condor exactly');

  A.setModelCount(a, bears.id, 3);
  ok(hasErr(A.validate(a), 'capacity'), 'three Bear APCs overload a Condor');
  A.remove(a.id);
}

console.log('\ninverted triangle is enforced, not just stored');
{
  await DZC.loadFaction('resistance');
  const a = A.create('resistance', 'T', 1500);
  const g = A.addGroup(a);
  const tech = A.addSquad(a, g.id, 'k9-technical', 1);
  const pack = A.addSquad(a, g.id, 'k9-pack', 1);
  A.setCarrier(a, pack.id, tech.id);
  ok(!hasErr(A.validate(a), 'cannot be carried'), 'a K9 Technical may carry a K9 Pack');
  A.remove(a.id);

  const b = A.create('ucm', 'T2', 1500);
  const g2 = A.addGroup(b);
  const condor = A.addSquad(b, g2.id, 'condor-dropship', 1);
  // Cross-faction is not buildable in the UI, but the capacity check is what
  // stops a red triangle from accepting a purple one.
  const legion = A.addSquad(b, g2.id, 'legionnaires', 3);
  A.setCarrier(b, legion.id, condor.id);
  ok(hasErr(A.validate(b), 'cannot be carried'),
     'a Condor cannot carry Legionnaires directly — infantry fill squares, a Condor offers triangles');
  A.remove(b.id);
}

console.log('\ncommanders (3.2.5)');
{
  const a = army(1000);                       // Skirmish: L4 and L5 only
  const g = A.addGroup(a);
  const s = A.addSquad(a, g.id, 'ucm-main-battle-tank', 2);
  ok(hasErr(A.validate(a), 'No Commander'), 'an Army with no Commander is illegal');
  A.setCommander(a, s.id, 7);
  ok(hasErr(A.validate(a), 'not allowed in Skirmish'), 'a Level 7 Commander is not allowed at Skirmish');
  A.setCommander(a, s.id, 5);
  ok(!hasErr(A.validate(a), 'Commander'), 'a Level 5 Commander is legal at any size');
  A.remove(a.id);
}

console.log('\nwarnings that are not errors');
{
  const a = army();
  const g = A.addGroup(a);
  const s = A.addSquad(a, g.id, 'ucm-main-battle-tank', 2);
  A.setCommander(a, s.id, 5);
  const v = A.validate(a);
  ok(v.warnings.some(w => w.msg.includes('Reserved')), 'ground units are flagged as starting Reserved (9.4)');
  ok(!v.errors.some(e => e.msg.includes('Reserved')), 'that is a warning, never an error');
  A.remove(a.id);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
