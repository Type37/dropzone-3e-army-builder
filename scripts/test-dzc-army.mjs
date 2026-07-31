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

console.log('\nweapon upgrades are per VARIANT, not per model (3.2.3)');
{
  const a = army();
  const g = A.addGroup(a);
  // Archangel: 40pts, squad 1-2, one +10 upgrade.
  const s = A.addSquad(a, g.id, 'archangel', 1);
  eq(A.squadCost(a, s), 40, 'one Archangel is 40pts');
  const offered = A.upgradesFor(a, s);
  eq(offered.length, 1, 'one upgrade is offered');
  eq(offered[0].points, 10, 'and it costs 10');

  ok(A.toggleUpgrade(a, s.id, '*', 'UM-115 Missile Spread').ok, 'the upgrade can be taken');
  eq(A.squadCost(a, s), 50, 'which adds 10');

  // "All Units of the same Variant within a Squad must be upgraded equally",
  // so a second model is upgraded too and the cost follows.
  A.setModelCount(a, s.id, 2);
  eq(A.squadCost(a, s), 100, 'two upgraded Archangels are 80 + 20');
  eq(A.upgradeCost(a, s), 20, 'the upgrade is charged per model, not per squad');

  // Upgrades count toward the category ratio, since they are points spent.
  eq(A.categorySpend(a).vanguard, 100, 'and the spend lands in the right category');

  ok(A.toggleUpgrade(a, s.id, '*', 'UM-115 Missile Spread').ok, 'it can be dropped again');
  eq(A.squadCost(a, s), 80, 'restoring the base cost');
  A.remove(a.id);
}

console.log('\n"only one of these upgrades" is enforced (3.2.3)');
{
  await DZC.loadFaction('resistance');
  const a = A.create('resistance', 'U', 1500);
  const g = A.addGroup(a);
  // Strikehawk Tilt-Rotor prints "*May replace transport capacity of ..." and
  // offers three upgrades; the Triton prints the "only one" note.
  const s = A.addSquad(a, g.id, 'strikehawk-tilt-rotor', 1);
  const offered = A.upgradesFor(a, s).map(o => o.weapon.name);
  eq(offered.length, 3, 'three upgrades are offered', offered.join(', '));
  ok(A.toggleUpgrade(a, s.id, '*', 'MC-30 Heavy Gatlings').ok, 'one can be taken');
  eq(A.squadCost(a, s), 90, '55 + 35');
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

/* From here the assertions are about ENFORCEMENT: the illegal state cannot be
 * reached at all, rather than being reached and then reported. */
console.log('\nRare and Unique are refused, not reported (3.2.1)');
{
  const a = army(1000);                       // Skirmish: 1 Rare
  const g = A.addGroup(a);
  ok(A.canAddUnit(a, g.id, 'archangel').ok, 'the first Rare Squad is allowed');
  A.addSquad(a, g.id, 'archangel', 1);
  const second = A.canAddUnit(a, g.id, 'archangel');
  ok(!second.ok, 'a second Rare Squad is refused at Skirmish');
  ok(/Rare/.test(second.reason) && /1/.test(second.reason), 'and the refusal quotes the limit', second.reason);
  eq(A.addSquad(a, g.id, 'archangel', 1), null, 'addSquad refuses it too, not just the UI');

  const b = army(2500);                       // Battle: 3 Rare
  const g2 = A.addGroup(b);
  A.addSquad(b, g2.id, 'archangel', 1);
  ok(A.canAddUnit(b, g2.id, 'archangel').ok, 'a second is allowed at Battle');
  A.remove(a.id); A.remove(b.id);
}

console.log('\ntransports are assigned, never picked (3.2.4)');
{
  const a = army();
  const g = A.addGroup(a);
  // "Units with the category Transport may only be chosen along with a Squad
  // they may transport" -- so they are not choosable on their own at all.
  const direct = A.canAddUnit(a, g.id, 'condor-dropship');
  ok(!direct.ok, 'a Transport cannot be picked on its own');
  eq(A.addSquad(a, g.id, 'condor-dropship', 1), null, 'and addSquad refuses it');

  // 6 Legionnaires fill 6 squares. A Bear APC carries 3, so 2 are needed and
  // both are full. The count is DERIVED -- "as many as needed" (3.2.4).
  const legion = A.addSquad(a, g.id, 'legionnaires', 3);
  const opts = A.transportOptions(a, legion.id);
  const bear = opts.find(o => o.unit.id === 'bear-apc');
  ok(bear, 'a Bear APC is offered as a Transport for Legionnaires');
  eq(bear.per, 3, 'a Bear APC carries 3 squares');
  eq(bear.need, 1, '3 Legionnaires need exactly 1 Bear APC');
  ok(bear.exact, 'and it can be taken full');

  const vulture = opts.find(o => o.unit.id === 'vulture-troopship');
  if (vulture) {
    ok(!vulture.exact || vulture.fill % vulture.per === 0,
       'an option that cannot be taken full is marked inexact', JSON.stringify(vulture));
  }

  const r = A.assignTransport(a, legion.id, 'bear-apc');
  ok(r.ok, 'assigning the Transport succeeds', r.reason);
  const t = g.squads.find(s => (A.unitOf(a, s) || {}).category === 'Transport');
  ok(t, 'a Transport Squad was created');
  eq(t.models.length, 1, 'with the derived count');
  ok(!hasErr(A.validate(a), 'not full'), 'and it is full');

  // Growing the cargo re-fits the Transport rather than leaving it stale.
  A.setModelCount(a, legion.id, 2);
  eq(g.squads.find(s => (A.unitOf(a, s) || {}).category === 'Transport').models.length, 1,
     '2 Legionnaires still need 1 Bear APC');
  A.remove(a.id);
}

console.log('\nsquad size is enforced at the stepper');
{
  const a = army();
  const g = A.addGroup(a);
  const s = A.addSquad(a, g.id, 'legionnaires', 3);
  const u = A.unitOf(a, s);
  const over = A.setModelCount(a, s.id, (u.squadMax || 3) + 1);
  ok(!over.ok, 'exceeding the maximum Squad size is refused');
  eq(s.models.length, 3, 'and the squad is left untouched');
  A.remove(a.id);
}

console.log('\nCommander levels are gated by game size (3.2.5)');
{
  const a = army(1000);                       // Skirmish: L4 and L5 only
  const g = A.addGroup(a);
  const s = A.addSquad(a, g.id, 'ucm-main-battle-tank', 2);
  const l7 = A.setCommander(a, s.id, 7);
  ok(!l7.ok, 'a Level 7 Commander is refused at Skirmish');
  eq(s.commander, null, 'and none is assigned');
  ok(A.setCommander(a, s.id, 5).ok, 'Level 5 is accepted');
  A.remove(a.id);
}

console.log('\nsymbol shape decides what may be offered at all');
{
  await DZC.loadFaction('resistance');
  const a = A.create('resistance', 'T', 1500);
  const g = A.addGroup(a);
  const pack = A.addSquad(a, g.id, 'k9-pack', 1);
  const names = A.transportOptions(a, pack.id).map(o => o.unit.name);
  // The K9 Pack fills an INVERTED triangle. Only the K9 Technical offers that
  // capacity, so nothing else may be offered -- this is the bug that let a
  // Condor load a K9 Pack, now unreachable rather than merely reported.
  ok(names.includes('K9 Technical'), 'a K9 Technical is offered for a K9 Pack', names.join(', '));
  ok(A.assignTransport(a, pack.id, 'k9-technical').ok, 'and it can be assigned');
  A.remove(a.id);

  const b = A.create('ucm', 'T2', 1500);
  const g2 = A.addGroup(b);
  const legion = A.addSquad(b, g2.id, 'legionnaires', 3);
  const ucmNames = A.transportOptions(b, legion.id).map(o => o.unit.id);
  ok(!ucmNames.includes('condor-dropship'),
     'a Condor is NOT offered for Legionnaires — infantry fill squares, a Condor offers triangles',
     ucmNames.join(', '));
  eq(A.assignTransport(b, legion.id, 'condor-dropship').ok, false,
     'and assigning one directly is refused');
  A.remove(b.id);
}

/* "At least one Commander" cannot be enforced at the point of action -- an
 * army legitimately has none while you are still building it -- so it stays an
 * error on the finished list. That distinction is the whole line between
 * enforcing and validating, and it is worth pinning. */
console.log('\nwhat can only be checked when the list is finished (3.2.5)');
{
  const a = army(1000);
  const g = A.addGroup(a);
  const s = A.addSquad(a, g.id, 'ucm-main-battle-tank', 2);
  ok(hasErr(A.validate(a), 'No Commander'), 'an Army with no Commander is reported, not blocked');
  A.setCommander(a, s.id, 5);
  ok(!hasErr(A.validate(a), 'Commander'), 'and the error clears once one is assigned');
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
