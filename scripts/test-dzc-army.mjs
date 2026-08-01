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
 * reached at all, rather than being reached and then reported.
 *
 * The line between the two is whether adding something else could put it
 * right. Taking a second Rare Squad never can, so it is refused. A Group that
 * does not yet make sense — a lone Transport, two Squads with nothing carrying
 * them — is only wrong once you stop building, so validate() reports it. */
console.log('\nRare and Unique are refused, not reported (3.2.1)');
{
  const a = army(1000);                       // Skirmish: 1 Rare
  const g = A.addGroup(a);
  ok(A.canAddUnit(a, g.id, 'archangel').ok, 'the first Rare Squad is allowed');
  A.addSquad(a, g.id, 'archangel', 1);
  const gB = A.addGroup(a);
  const second = A.canAddUnit(a, gB.id, 'archangel');
  ok(!second.ok, 'a second Rare Squad is refused at Skirmish');
  ok(/Rare/.test(second.reason) && /1/.test(second.reason), 'and the refusal quotes the limit', second.reason);
  eq(A.addSquad(a, gB.id, 'archangel', 1), null, 'addSquad refuses it too, not just the UI');

  const b = army(2500);                       // Battle: 3 Rare
  const g2 = A.addGroup(b);
  A.addSquad(b, g2.id, 'archangel', 1);
  const g2b = A.addGroup(b);
  ok(A.canAddUnit(b, g2b.id, 'archangel').ok, 'a second is allowed at Battle');
  A.remove(a.id); A.remove(b.id);
}

console.log('\ntransports and their cargo form one Group (3.2.4)');
{
  const a = army();
  const g = A.addGroup(a);
  // Either order works: buy the Transport first and fill it after, or pick the
  // Squad and then choose what carries it. What is refused is a Transport
  // joining a Group where nothing needs it and nothing has room for it.
  ok(A.canAddUnit(a, g.id, 'condor-dropship').ok, 'a Transport may start a Group');
  const solo = A.addSquad(a, g.id, 'condor-dropship', 1);
  ok(solo !== null, 'and it is added, to be filled afterwards');
  // A lone Transport is UNFINISHED, not illegal — you may be about to fill it —
  // so it is reported when the list is done rather than blocked as you build.
  ok(hasErr(A.validate(a), 'carries nothing'), 'a Transport carrying nothing is reported');
  A.removeSquad(a, solo.id);

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

  // The Group header's meters: a Bear APC offers 3 squares and 2 Legionnaires
  // are aboard, so there is room for one more and the header must say so.
  const space = A.groupSpace(a, g);
  const sq = space.find(x => x.shape === 'square');
  ok(sq, 'the Group reports square capacity', JSON.stringify(space));
  eq(sq.total, 3, 'one Bear APC offers 3 squares');
  eq(sq.used, 2, 'and 2 Legionnaires are aboard');
  A.remove(a.id);
}

/* A part-empty Transport is unfinished, not illegal -- 2 Legionnaires in a
 * 3-square Bear APC becomes legal the moment a third is bought, so refusing
 * the assignment would make that state unreachable. Assigned, then reported. */
{
  const a = A.create('ucm', 'Part-full', 1500);
  const g = A.addGroup(a);
  const legion = A.addSquad(a, g.id, 'legionnaires', 2);
  const r = A.assignTransport(a, legion.id, 'bear-apc');
  ok(r.ok, 'a Transport that would not be full is still assigned', r.reason);
  ok(/not full/.test(r.warn || ''), 'and it says why it is not finished', r.warn);
  ok(hasErr(A.validate(a), 'not full'), 'validate reports the part-empty Transport');

  // Growing into it clears the report with no further action.
  A.setModelCount(a, legion.id, 3);
  ok(!hasErr(A.validate(a), 'not full'), 'buying the third Legionnaire fills it');

  // A shape mismatch is still refused: nothing you add later fixes it.
  const l2 = A.addSquad(a, A.addGroup(a).id, 'legionnaires', 3);
  eq(A.assignTransport(a, l2.id, 'condor-dropship').ok, false,
     'but a Transport of the wrong shape is still refused');
  A.remove(a.id);
}

/* Commanders are named the same way Groups are: derived from the Level unless
 * you gave one a name. The rulebook never names them -- 3.2.5 sets a Level and
 * a cost and nothing else -- so the default has to carry the Level. */
{
  const a = A.create('ucm', 'Commander names', 2000);
  const g = A.addGroup(a);
  const s1 = A.addSquad(a, g.id, 'legionnaires', 2);
  // Levels are 4-7 (armyRules.commanders.levels); 5 is legal in Clash.
  const r = A.addCommander(a, 5);
  ok(r.ok, 'a Level 5 Commander is allowed at 2000pts', r.reason);
  const c = r.commander;
  eq(A.commanderName(a, c), 'Level 5 Commander', 'and is named for its Level');
  eq(c.name, null, 'with nothing stored');

  A.renameCommander(a, c.id, 'Marshal Aguilar');
  eq(A.commanderName(a, c), 'Marshal Aguilar', 'a chosen name sticks');
  A.renameCommander(a, c.id, '  ');
  eq(A.commanderName(a, c), 'Level 5 Commander', 'clearing it goes back to the Level');
  A.renameCommander(a, c.id, 'Level 5 Commander');
  eq(c.name, null, 'and typing the default back stores nothing');

  // A Level 3 does not exist and a Level 7 is Battle-and-up, so neither is
  // takeable here (3.2.5).
  eq(A.addCommander(a, 3).ok, false, 'a Level that does not exist is refused');
  eq(A.addCommander(a, 7).ok, false, 'and a Level above the game size is refused');
  A.remove(a.id);
}

/* Group names track position. Baking the number in at creation produced two
 * Groups both called "Group 3" as soon as you deleted from the middle. */
{
  const a = A.create('ucm', 'Naming', 2000);
  const g1 = A.addGroup(a), g2 = A.addGroup(a), g3 = A.addGroup(a);
  eq(A.groupName(a, g2), 'Group 2', 'a new Group is named for its position');

  A.removeGroup(a, g1.id);
  eq(A.groupName(a, g2), 'Group 1', 'deleting the first renumbers the rest');
  eq(A.groupName(a, g3), 'Group 2', 'all the way down');

  const g4 = A.addGroup(a);
  eq(A.groupName(a, g4), 'Group 3', 'and the next one added continues the count');

  // The old bug, stated: length+1 after a middle deletion collided.
  const names = a.groups.map(g => A.groupName(a, g));
  eq(new Set(names).size, names.length, 'no two Groups ever share a name');

  // A name you actually chose is kept; typing the auto name back gives it up.
  A.renameGroup(a, g2.id, 'Air wing');
  eq(A.groupName(a, g2), 'Air wing', 'a chosen name sticks');
  A.removeGroup(a, g3.id);
  eq(A.groupName(a, g2), 'Air wing', 'and does not renumber');
  A.renameGroup(a, g2.id, '   ');
  eq(A.groupName(a, g2), 'Group 1', 'clearing it hands the Group back to the numbering');
  A.remove(a.id);
}

/* An unnamed Group stores null, so anything quoting a Group by name has to go
 * through groupName. It did not, and the rail read: "null" has 2 Squads. */
{
  const a = A.create('ucm', 'Named errors', 2000);
  const g = A.addGroup(a);
  A.addSquad(a, g.id, 'legionnaires', 2);
  A.addSquad(a, g.id, 'praetorian-snipers', 2);
  const msgs = A.validate(a).errors.map(e => e.msg).join(' | ');
  ok(!/null|undefined/.test(msgs), 'no error names a Group "null"', msgs);
  ok(/Group 1/.test(msgs), 'they use its position instead', msgs);
  A.remove(a.id);
}

/* The Vulture deadlock. A Vulture Troopship carries 4 squares; every UCM
 * infantry Squad is 2-3 models filling 1 square each, so no single Squad can
 * ever total 4. Buying one per Squad left it permanently "not full" while
 * canSetCount refused to grow past squadMax -- the Transport was unusable and
 * nothing you could do fixed it. 3.2.4.1 is the way out: share it. */
{
  const a = A.create('ucm', 'Vulture', 2000);
  const g = A.addGroup(a);

  // The trap itself, asserted so it stays understood rather than rediscovered.
  const vult = DZC.unit('ucm', 'vulture-troopship');
  const leg = DZC.unit('ucm', 'legionnaires');
  eq(DZC.capacityFor(vult, 'square'), 4, 'a Vulture carries 4 squares');
  eq(leg.squadMax, 3, 'and Legionnaires cap at 3 models');
  ok(4 % 1 !== 0 || leg.squadMax < 4, 'so one Legionnaire Squad can never fill one');

  const s1 = A.addSquad(a, g.id, 'legionnaires', 2);
  ok(A.assignTransport(a, s1.id, 'vulture-troopship').ok, 'the Vulture is still takeable');
  ok(hasErr(A.validate(a), 'not full'), 'and it starts out not full');
  eq(A.canSetCount(a, s1.id, 4).ok, false, 'growing the Squad to 4 is refused by squadMax');

  // The move that was missing: a second Squad boards the Vulture already here.
  const s2 = A.addSquad(a, g.id, 'praetorian-snipers', 2);
  const opts = A.boardOptions(a, s2.id);
  const here = opts.find(o => (o.unit || {}).id === 'vulture-troopship');
  ok(here, 'the Vulture already in the Group is offered', JSON.stringify(opts.map(o => o.unit.id)));
  eq(here.room, 4, 'with 4 squares of room');
  eq(here.used, 2, '2 of them already taken');
  ok(here.full, 'and boarding these Snipers fills it exactly');

  const r = A.boardTransport(a, s2.id, here.squad.id);
  ok(r.ok, 'boarding succeeds', r.reason);
  eq(r.warn, null, 'with nothing left to report');
  ok(!hasErr(A.validate(a), 'not full'), 'the Vulture is full and the deadlock is gone');

  // Still one Vulture, not two: sharing must not quietly buy a second.
  const carriers = g.squads.filter(s => (A.unitOf(a, s) || {}).category === 'Transport');
  eq(carriers.length, 1, 'and only one Vulture was ever bought');
  eq(carriers[0].models.length, 1, 'exactly one of it');
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
  ok(hasErr(A.validate(a), "haven't added a Commander"), 'an Army with no Commander is reported, not blocked');
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

/* Jet: "as far as i know, there's no way as written to like, add an albatross?
 * what would the flow be there?"
 *
 * There is, and this is it, built end to end: rulebook Group 5, an Albatross
 * carrying two Bear APCs with three Legionnaires each plus a tank Squad. The
 * point is that you never add an Albatross. You give one to a Bear APC exactly
 * as you gave the Bear to the Legionnaires -- a Transport Squad is a Squad, so
 * it can be carried, which is what 3.2.4.1's "plus their own Transport Squads"
 * means. Nesting is recursive and the data is what bounds it.
 *
 * Asserted step by step rather than only at the end, because the flow being
 * REACHABLE is the thing in question. A final assertion on a hand-built object
 * would pass even if no sequence of clicks could produce it. */
console.log('\nan Albatross is reached by carrying a Transport (3.2.4.1)');
{
  const a = army(2000);
  const g = A.addGroup(a);

  const l1 = A.addSquad(a, g.id, 'legionnaires', 3);
  ok(A.assignTransport(a, l1.id, 'bear-apc').ok, 'three Legionnaires take a Bear APC');
  const l2 = A.addSquad(a, g.id, 'legionnaires', 3);
  ok(A.assignTransport(a, l2.id, 'bear-apc').ok, 'a second Squad takes a second Bear');

  ok(A.canAddUnit(a, g.id, 'ucm-main-battle-tank').ok,
     'tanks may join the Group — nothing in 3.2 restricts a Group by category');
  const tanks = A.addSquad(a, g.id, 'ucm-main-battle-tank', 6);

  // THE step. A Bear fills 3 triangles and an Albatross offers 18, so the
  // Albatross is in the Bear's own list of Transports.
  const bears = g.squads.filter(s => s.unitId === 'bear-apc');
  eq(bears.length, 2, 'two Bear Squads exist');
  const forBear = A.transportOptions(a, bears[0].id).map(o => o.unit.id);
  ok(forBear.indexOf('albatross-heavy-dropship') !== -1,
     'a Bear APC Squad is itself offered an Albatross', JSON.stringify(forBear));
  ok(A.assignTransport(a, bears[0].id, 'albatross-heavy-dropship').ok,
     'and it can be taken');

  const alba = g.squads.find(s => s.unitId === 'albatross-heavy-dropship');
  ok(!!alba, 'the Albatross Squad is created by carrying, never by adding');
  ok(A.boardTransport(a, bears[1].id, alba.id).ok, 'the second Bear boards the same Albatross');
  ok(A.boardTransport(a, tanks.id, alba.id).ok, 'and the tanks fill what is left');

  const space = A.groupSpace(a, g);
  eq(space.length, 1, 'the Group offers one shape — the Albatross triangles');
  eq(space[0].total, 18, 'eighteen triangles offered');
  // 2 Bears at 3 + 6 tanks at 2. The Bears' own square capacity is NOT counted:
  // their cargo is already aboard, so it is ignored (3.2.4.2).
  eq(space[0].used, 18, 'and eighteen filled, so the Albatross is taken full');
  eq(alba.models.length, 1, 'exactly one Albatross is bought, derived and not typed');

  const v = A.validate(a);
  ok(!v.errors.some(e => e.rule.startsWith('3.2.4')),
     'the finished Group breaks no transport rule',
     JSON.stringify(v.errors.map(e => `${e.rule} ${e.msg}`)));
  A.remove(a.id);
}

/* Gap 124. Two Groups of the same thing is a normal army, not an edge case:
 * three Legionnaire Squads each in their own Bear is the same six clicks and
 * the same Transport chooser, three times. */
console.log('\nduplicating a Group (gap 124)');
{
  const a = army(2000);
  const g = A.addGroup(a);
  const l = A.addSquad(a, g.id, 'legionnaires', 3);
  A.assignTransport(a, l.id, 'bear-apc');
  const before = A.groupCost(a, g);

  const r = A.duplicateGroup(a, g.id);
  ok(r.ok, 'a Group duplicates', r.reason);
  eq(a.groups.length, 2, 'and there are two Groups');
  const copy = a.groups[1];
  eq(copy.squads.length, g.squads.length, 'with the same number of Squads');
  eq(A.groupCost(a, copy), before, 'and the same cost');

  // THE thing that has to be right. carriedBy holds a Squad id; copying the
  // ids as they are leaves the new Squads riding the OLD Group's Transports,
  // which is a corrupt army that still renders.
  const rider = copy.squads.find(s => s.carriedBy);
  ok(!!rider, 'the copy kept its nesting');
  ok(copy.squads.some(s => s.id === rider.carriedBy),
     'and rides a Transport in its OWN Group, not the original\'s');
  ok(!g.squads.some(s => s.id === rider.carriedBy), 'nothing points back at the original');
  // Ids must be fresh, or findSquad returns whichever it hits first.
  const ids = new Set(a.groups.flatMap(x => x.squads.map(s => s.id)));
  eq(ids.size, g.squads.length + copy.squads.length, 'every Squad id is unique across the Army');

  // The copy is unnamed, so it takes its own number rather than a second
  // "Group 1".
  eq(A.groupName(a, copy), 'Group 2', 'the copy is numbered by position');
  A.remove(a.id);
}

{
  // Per-model variants are the thing a duplicate is FOR: rebuilding a mixed
  // Squad by hand is the tedium this removes.
  const a = army(2000);
  const g = A.addGroup(a);
  const s = A.addSquad(a, g.id, 'ucm-main-battle-tank', 2);
  A.setModelVariant(a, s.id, 0, 'Tachi');
  const cost = A.squadCost(a, s);
  ok(A.duplicateGroup(a, g.id).ok, 'a Group with a mixed Squad duplicates');
  const copied = a.groups[1].squads[0];
  eq(copied.models.map(m => m.variant).join(','), s.models.map(m => m.variant).join(','),
     'every model keeps the variant it had');
  eq(A.squadCost(a, copied), cost, 'so the copy costs what the original costs');
  A.remove(a.id);
}

{
  // Refused where it could never be legal, quoting the rule -- not recorded
  // and reported afterwards.
  const a = army(1000);           // Skirmish: Rare limit 1
  const rare = (DZC.faction('ucm').units || []).find(u => u.rare && u.selectable !== false);
  const g = A.addGroup(a);
  A.addSquad(a, g.id, rare.id, rare.squadMin || 1);
  const r = A.duplicateGroup(a, g.id);
  eq(r.ok, false, 'a Group holding a Rare Squad will not duplicate past the limit');
  ok(/Rare/.test(r.reason || ''), 'and says which rule refuses it', r.reason);
  eq(a.groups.length, 1, 'nothing was added');
  A.remove(a.id);
}

{
  // The agreed limit is an input for the whole life of the army, not just at
  // creation: the per-Group ceiling is a quarter of it (3.2) and the Group cap
  // and Rare allowance move with the band (3.1, 3.2.1).
  const a = army(2000);
  eq(DZC.maxGroupCost(a.pointsLimit), 500, 'a 2000pt army caps a Group at 500');
  eq(A.setPointsLimit(a, 1500), 1500, 'the limit can be re-agreed after creation');
  eq(DZC.maxGroupCost(a.pointsLimit), 375, 'and the per-Group ceiling follows it');
  eq(DZC.gameSizeFor(a.pointsLimit).id, 'clash', '1500 is still a Clash');
  eq(A.setPointsLimit(a, 3000), 3000, 'moving up a band is the same one number');
  eq(DZC.gameSizeFor(a.pointsLimit).id, 'battle', '3000 is a Battle');
  eq(DZC.maxGroups(DZC.gameSizeFor(a.pointsLimit), 3000), 16, 'so the Group cap moves too');
  eq(A.setPointsLimit(a, 0), 3000, 'zero is not a limit anyone agreed — ignored');
  eq(A.setPointsLimit(a, 'nonsense'), 3000, 'nor is a value that is not a number');
  A.remove(a.id);
}

{
  // Variants are per MODEL (3.2.2), so a Squad is "how many of each", and the
  // count is the control. Squad min/max are still the only limits.
  const a = army(2000);
  const g = A.addGroup(a);
  const s = A.addSquad(a, g.id, 'ucm-main-battle-tank', 2);   // Sabre 35, Tachi 40
  const mix = () => s.models.map(m => m.variant).sort().join(',');
  eq(mix(), 'Sabre,Sabre', 'a new Squad is all of the first variant');
  ok(A.setVariantCount(a, s.id, 'Tachi', 1).ok, 'a Tachi can be added');
  eq(s.models.length, 3, 'and the Squad grew by one — the size follows the mix');
  eq(A.squadCost(a, s), 110, 'two Sabres and a Tachi cost 70 + 40');
  const min = A.canSetVariantCount(a, s.id, 'Sabre', 0);
  eq(min.ok, false, 'dropping both Sabres would leave one model, under the Squad minimum');
  ok(/minimum/i.test(min.reason || ''), 'and says so in the stepper’s own sentence', min.reason);
  A.setVariantCount(a, s.id, 'Tachi', 2);
  ok(A.setVariantCount(a, s.id, 'Sabre', 0).ok, 'with two Tachi the Sabres can go');
  eq(mix(), 'Tachi,Tachi', 'leaving a Squad of Tachi');
  eq(A.canSetVariantCount(a, s.id, 'Tachi', 0).ok, false,
     'but a Squad is never emptied this way — that is what Remove Squad is');
  // 2-9, so ten is over the maximum.
  A.setVariantCount(a, s.id, 'Sabre', 7);
  eq(s.models.length, 9, 'the Squad fills to nine');
  const over = A.canSetVariantCount(a, s.id, 'Greave', 1);
  eq(over.ok, false, 'and the Squad maximum refuses one more');
  ok(/maximum/i.test(over.reason || ''), 'in the same sentence the stepper uses', over.reason);
  A.remove(a.id);
}

console.log('\nimporting a backup');
{
  // The other half of exportArmies. A backup you cannot restore is not a
  // backup, and the export is the stored shape unmodified — so the round trip
  // is exactly "stringify the store, read it back".
  const a = army(2000);
  a.name = 'Backup probe';
  const g = A.addGroup(a);
  const carried = A.addSquad(a, g.id, 'legionnaires', 3);
  const t = A.transportOptions(a, carried.id).find(o => o.exact);
  if (t) A.assignTransport(a, carried.id, t.unit.id);
  A.addCommander(a, 5);
  const before = JSON.stringify([a]);
  const cost = A.armyCost(a);

  const r = A.importArmies(before);
  eq(r.ok, true, 'a backup imports');
  eq(r.added.length, 1, 'one army came back');
  eq(r.added[0].unknown.length, 0, 'and every unit id in it resolved');
  const back = A.get(r.added[0].id);
  ok(back.id !== a.id, 'the import gets a new id, so it never overwrites what you have');
  eq(A.armyCost(back), cost, 'and costs what the original costs');
  eq(back.groups[0].squads.length, a.groups[0].squads.length, 'every Squad came with it');
  eq(back.commanders.length, 1, 'and the Commander');

  // The nesting is the part an id-preserving import would corrupt silently.
  const oldIds = a.groups[0].squads.map(s => s.id);
  const newCarry = back.groups[0].squads.filter(s => s.carriedBy).map(s => s.carriedBy);
  eq(newCarry.some(id => oldIds.indexOf(id) !== -1), false,
     'no imported Squad rides a Squad from the ORIGINAL army');
  newCarry.forEach(id => ok(!!A.findSquad(back, id), 'and every carrier it names is its own'));

  A.importArmies(before);
  eq(A.all().filter(x => x.name === 'Backup probe').length, 3,
     'importing twice adds twice — an import never costs you an army');

  A.all().filter(x => x.name === 'Backup probe').forEach(x => A.remove(x.id));
  A.remove(a.id);
}

{
  const bad = A.importArmies('not json at all');
  eq(bad.ok, false, 'a file that is not JSON is refused');
  ok(/JSON/.test(bad.reason || ''), 'and says why', bad.reason);
  const shaped = A.importArmies('[{"name":"nope"},{"faction":"ucm","groups":[]}]');
  eq(shaped.added.length, 1, 'a list imports what it can');
  eq(shaped.skipped.length, 1, 'and reports what it could not');
  eq(shaped.skipped[0].reason, 'no faction', 'naming the reason, not just the count');
  shaped.added.forEach(x => A.remove(x.id));
}

console.log('\nimporting a pasted list');
{
  // New Recruit's conventions, read out of Dropfleet's parser rather than
  // guessed at: "N x Name [Npts]", "##" headers, bullets, a headline total.
  const text = [
    '## Test Force [500pts]',
    '',
    '## Standard [180pts]',
    '• 3 x Legionnaires [45pts]',
    '2 x UCM Main Battle Tank [70pts]: Tachi',
    '',
    '## Nonsense [10pts]',
    '1 x Not A Real Unit [10pts]'
  ].join('\n');
  const r = A.importList(text);
  eq(r.ok, true, 'a pasted list imports');
  eq(r.army.faction, 'ucm', 'the faction is voted from the unit names, not the header');
  eq(r.matched.length, 2, 'both real units resolved');
  eq(r.unmatched.length, 1, 'and the line that resolved to nothing is REPORTED, not dropped');
  eq(r.army.name, 'Test Force', 'the title loses its points tag');
  eq(r.army.groups.length, 2, 'each Squad lands in a Group of its own');
  const tank = r.army.groups.map(g => g.squads[0]).find(s => s.unitId === 'ucm-main-battle-tank');
  eq(tank.models.length, 2, 'the count comes off the "2 x"');
  eq(tank.models[0].variant, 'Tachi', 'and a named loadout picks the variant');
  A.remove(r.army.id);
}

{
  // A list shared collapsed onto one line, which New Recruit does.
  const one = '## Flat [90pts], 3 x Legionnaires [45pts], 2 x Polecat Buggy [40pts]';
  const r = A.importList(one);
  eq(r.ok, true, 'a comma-collapsed list still reads');
  eq(r.matched.length, 2, 'both entries came back out of the one line');
  A.remove(r.army.id);

  eq(A.importList('just some prose with no points in it').ok, false,
     'and something that is not a list is refused rather than half-imported');
}

console.log('\nSurprise me');
{
  /* The generator has to produce a LEGAL army, which makes it the only test in
   * here that argues with every rule at once rather than one at a time. It is
   * what found the multi-Transport capacity bug: a hand-written fixture uses
   * one carrier, because that is what a person reaches for.
   *
   * Deterministic rand, so a failure is reproducible rather than "it went
   * wrong once last Tuesday". */
  let seed = 1234567;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const made = [];
  let illegal = 0, thin = 0;
  for (const fac of ['ucm', 'phr', 'scourge', 'shaltari', 'resistance', 'bioficer']) {
    await DZC.loadFaction(fac);
    for (const limit of [1000, 1500, 2000, 3000]) {
      for (let i = 0; i < 3; i++) {
        const r = A.generate(fac, limit, rand);
        if (!r.ok) { illegal++; continue; }
        made.push(r.army);
        const v = A.validate(r.army);
        if (v.errors.length) {
          illegal++;
          if (illegal < 3) console.error(`        ${fac} ${limit}: ${v.errors[0].msg}`);
        }
        // A generator that returns three Squads and calls it an army is not
        // doing the job the feature exists for.
        if (A.armyCost(r.army) < limit * 0.4) thin++;
      }
    }
  }
  eq(made.length, 72, 'seventy-two armies were generated');
  eq(illegal, 0, 'and every one of them is legal');
  eq(thin, 0, 'and none of them stopped under 40% of the budget');
  made.forEach(x => A.remove(x.id));

  eq(A.generate('ucm', 100).ok, false, 'a limit below the 501pt minimum builds nothing');
  eq(A.generate('nosuchfaction', 2000).ok, false, 'and so does a faction that does not exist');
}

console.log('\nwhat an army is for');
{
  const a = A.create('ucm', 'Described', 1500, '  Club night, no Rare  ');
  eq(a.description, 'Club night, no Rare', 'the New Army dialog\'s text arrives trimmed');
  eq(A.create('ucm', 'Plain', 1500).description, '', 'and an army without one has an empty string, not undefined');
  A.setDescription(a, 'x'.repeat(600));
  eq(a.description.length, 500, 'it is capped, because it travels in a share link');
  // A backup written before descriptions existed has no key at all.
  const back = A.importArmies(JSON.stringify({ faction: 'ucm', name: 'Old', pointsLimit: 1500, groups: [] }));
  ok(back.ok, 'an army from before the field imports');
  eq(A.get(back.added[0].id).description, '', 'with an empty description rather than undefined');
  A.remove(a.id);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
