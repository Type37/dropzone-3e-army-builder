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
/* dzc-units.js is the renderer, but unitWeapons and removedByUpgrades in it are
 * the definition of what guns a Squad actually has — which is an army question,
 * asked here and by the printed sheet. It touches the DOM only inside render
 * functions nothing below calls. */
vm.runInContext(readFileSync(path.join(ROOT, 'js', 'dzc-units.js'), 'utf8'), sandbox);
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

/* 10.1.12 "Commanders may not be assigned to Fast Movers."
 * 10.1.20 "Commanders cannot be assigned to Living Weapons."
 *
 * Both sentences have been in data/dzc/rules.json since the rulebook was
 * scanned, shown on the card, and enforced nowhere — the app would put a Level
 * 5 Commander on an Archangel and charge you 90pts for an army no opponent
 * would accept. Ten Units carry one keyword or the other. */
console.log('\nno Commander on a Fast Mover or a Living Weapon (10.1.12, 10.1.20)');
{
  const a = army();
  const g = A.addGroup(a);
  const arch = A.addSquad(a, g.id, 'archangel', 1);            // Ev3, Fast Mover
  const mbt = A.addSquad(a, A.addGroup(a).id, 'ucm-main-battle-tank', 1);

  const r = A.setCommander(a, arch.id, 5);
  eq(r.ok, false, 'a Commander is refused on a Fast Mover');
  ok(/Fast Mover/.test(r.reason || '') && /10\.1\.12/.test(r.reason || ''),
     'and the refusal names the rule', r.reason);
  eq(A.squadCost(a, arch), 40, 'so the Squad is not charged for one');
  eq((a.commanders || []).length, 0, 'and no Commander is left stranded by the refusal');

  ok(A.setCommander(a, mbt.id, 5).ok, 'the same Commander goes on a tank');
  const targets = A.commanderTargets(a, A.commanders(a)[0].id).map(t => t.unit.name);
  ok(!targets.includes('Archangel'), 'and the Fast Mover is not even offered', targets.join(', '));

  await DZC.loadFaction('resistance');
  const b = A.create('resistance', 'Living', 1500);
  const pack = A.addSquad(b, A.addGroup(b).id, 'k9-pack', 1);  // Living Weapons
  const lr = A.setCommander(b, pack.id, 5);
  eq(lr.ok, false, 'and a Living Weapon refuses one too');
  ok(/10\.1\.20/.test(lr.reason || ''), 'naming its own rule', lr.reason);

  /* An army from a share link or from storage predates the refusal, so
   * validate has to catch what it could not stop being built. */
  A.addCommander(b, 5);
  A.commanders(b)[0].squadId = pack.id;
  ok(A.validate(b).errors.some(e => e.rule === '10.1.12'),
     'an army that already has one is reported rather than passed');

  A.remove(b.id);
  A.remove(a.id);
}

/* A swap takes a printed weapon AWAY. Five cards print one and the app used to
 * grant the new gun and keep the old ones, so a Super Heavy Tank that had
 * traded both its MC-20 Chainguns for Sidearm Missiles went to the table with a
 * sheet listing three guns it does not have. */
console.log('\na swap removes what it replaces (3.2.3)');
{
  await DZC.loadFaction('resistance');
  const a = A.create('resistance', 'Swaps', 2000);
  const U = win.DZCUnits;
  const g = A.addGroup(a);
  const tank = A.addSquad(a, g.id, 'resistance-super-heavy-tank', 1);
  const u = A.unitOf(a, tank);
  const guns = () => U.unitWeapons(u, {
    variants: tank.models.map(m => m.variant),
    hasUpgrade: w => A.hasUpgrade(tank, '*', w.name)
  }).map(w => w.name);

  eq(guns().filter(n => n === 'MC-20 Chaingun').length, 2, 'the card prints two Chainguns');
  ok(A.toggleUpgrade(a, tank.id, '*', 'MM-15 Sidearm Missiles').ok, 'the Sidearms are taken');
  eq(guns().filter(n => n === 'MC-20 Chaingun').length, 0,
     '"replace BOTH its MC-20 Chainguns" takes both');
  ok(guns().includes('MM-15 Sidearm Missiles'), 'and the Squad has what it bought');
  ok(A.toggleUpgrade(a, tank.id, '*', 'MM-15 Sidearm Missiles').ok, 'dropping it again');
  eq(guns().filter(n => n === 'MC-20 Chaingun').length, 2, 'gives both Chainguns back');

  /* The Lifthawk's takes ONE of two Missile Pods and ONE of two Machineguns,
   * which is why removal is by index and not by name. */
  const lift = A.addSquad(a, A.addGroup(a).id, 'lifthawk-troopship', 1);
  const lu = A.unitOf(a, lift);
  const lguns = () => U.unitWeapons(lu, {
    variants: lift.models.map(m => m.variant),
    hasUpgrade: w => A.hasUpgrade(lift, '*', w.name)
  }).map(w => w.name);
  eq(lguns().filter(n => n === 'MM-3 Missile Pod').length, 2, 'two Missile Pods to start');
  ok(A.toggleUpgrade(a, lift.id, '*', 'MC-20 Chaingun Pair').ok, 'the Chaingun Pair is bought');
  eq(lguns().filter(n => n === 'MM-3 Missile Pod').length, 1, 'and it costs ONE Missile Pod');
  eq(lguns().filter(n => n === 'MG-6 Twin Heavy Machineguns').length, 1,
     'and one Twin Heavy Machineguns, not both');

  // The other upgrade on the same card removes nothing, so nothing moves.
  ok(A.toggleUpgrade(a, lift.id, '*', 'MC-20 Chaingun Pair').ok, 'dropping it');
  ok(A.toggleUpgrade(a, lift.id, '*', 'Flamethrower').ok, 'and buying the Flamethrower instead');
  eq(lguns().filter(n => n === 'MM-3 Missile Pod').length, 2,
     'leaves both Missile Pods, because that upgrade is not a swap');
  A.remove(a.id);
}

/* "A Behemoth counts as that many Groups when building your Army and
 * generating Pass tokens" (Behemoth rules 1.1). They are worth three to five
 * each, so counting Group cards instead would let a Reconquest list field four
 * Dragons inside an allowance they alone are worth. */
console.log('\na Behemoth counts as several Groups (Behemoth rules 1.1)');
{
  await DZC.loadFaction('shaltari');
  const a = A.create('shaltari', 'Behemoths', 3000);
  const f = DZC.faction('shaltari');

  ok(f.byId['dragon'], 'a faction carries its own Behemoths, not just its stat-card units');
  eq(f.byId['dragon'].groupEquivalent, 5, 'and the Dragon is worth five Groups');
  eq(f.byId['venus-drone'], undefined, "and not another faction's");

  ok(A.addSquad(a, A.addGroup(a).id, 'dragon', 1), 'a Dragon is added like any other Unit');
  eq(A.groupsUsed(a), 5, 'one Group card, five Groups spent');
  A.addSquad(a, A.addGroup(a).id, 'shaltari-warstrider', 1);
  eq(A.groupsUsed(a), 6, 'and an ordinary Group is worth one');

  /* Skirmish allows 9. One Dragon is 5 and legal; two are 10 on two cards,
   * which the old card count called two. */
  /* "Commanders cannot be assigned to Behemoths" and "Behemoths ... can only
   * be taken in 3000+ point games", both from Behemoth rules 1.1. The second
   * is an error rather than a refusal, because 1.1.1 says players may agree to
   * waive any Army-building restriction in a casual game. */
  const dragonSquad = a.groups[0].squads[0];
  const cr = A.setCommander(a, dragonSquad.id, 5);
  eq(cr.ok, false, 'a Behemoth refuses a Commander');
  ok(/Behemoth/.test(cr.reason || '') && /1\.1/.test(cr.reason || ''),
     'and names the rule that says so', cr.reason);
  ok(!A.validate(a).errors.some(e => e.rule === '1.1'),
     'a 3000pt list may field one');

  const b = A.create('shaltari', 'Small', 1000);
  A.addSquad(b, A.addGroup(b).id, 'dragon', 1);
  ok(!A.validate(b).errors.some(e => e.rule === '3.1' && /Groups/.test(e.msg)),
     'one Dragon is five of the nine Skirmish allows, and legal');
  A.addSquad(b, A.addGroup(b).id, 'dragon', 1);
  const over = A.validate(b).errors.find(e => e.rule === '3.1' && /Groups/.test(e.msg));
  ok(A.validate(b).errors.some(e => e.rule === '1.1' && /3000pts or more/.test(e.msg)),
     'and a 1000pt list is told the Behemoth needs 3000',
     JSON.stringify(A.validate(b).errors.map(e => e.msg)));
  ok(over && /counting as 10/.test(over.msg),
     "and two say so in the Behemoths' own terms, not as two Groups",
     JSON.stringify(A.validate(b).errors.map(e => e.msg)));
  A.remove(b.id);
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

/* "May replace transport capacity of 2 with MM-3 Missile Boxes or MC-30 Heavy
 * Gatlings" -- the Strikehawk and the Carryhawk, the only two cards in the
 * game where buying a gun costs you room. It used to be prose in upgradeNote
 * and nothing else, so the builder would load two circles into a Strikehawk
 * that had already sold them and call the army legal. */
console.log('\nan upgrade that sells transport capacity (3.2.3)');
{
  await DZC.loadFaction('resistance');
  const a = A.create('resistance', 'U', 1500);
  const g = A.addGroup(a);
  // The Strikehawk is Support, not Transport -- an auxiliary carrier (3.2.4.3)
  // that is boarded rather than assigned.
  const hawk = A.addSquad(a, g.id, 'strikehawk-tilt-rotor', 1);
  const sentry = A.addSquad(a, g.id, 'resistance-sentry-unit', 2);   // fills circles
  const r = A.boardTransport(a, sentry.id, hawk.id);
  ok(r.ok, 'a Strikehawk carries two Sentry Units', r.reason);

  eq(A.carrierOf(a, hawk).transport.capacity.find(c => c.shape === 'circle').n, 2,
     'and offers 2 circle capacity while it is unarmed');
  ok(!A.validate(a).errors.some(e => /3\.2\.4\.3/.test(e.rule)),
     'the army is legal as built');

  ok(A.toggleUpgrade(a, hawk.id, '*', 'MC-30 Heavy Gatlings').ok, 'the Gatlings are bought');
  ok(!A.carrierOf(a, hawk).transport.capacity.some(c => c.shape === 'circle'),
     'and the circle capacity goes with them');
  ok(A.validate(a).errors.some(e => /3\.2\.4\.3/.test(e.rule)),
     'so the Sentry Units it was carrying are now an error, not a silent pass');

  // The square capacity is untouched: the footnote sells one badge, not both.
  eq(A.carrierOf(a, hawk).transport.capacity.find(c => c.shape === 'square').n, 4,
     'the square capacity survives');
  ok(A.toggleUpgrade(a, hawk.id, '*', 'MC-30 Heavy Gatlings').ok, 'dropping the gun');
  eq(A.carrierOf(a, hawk).transport.capacity.find(c => c.shape === 'circle').n, 2,
     'gives the room back');
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

  /* And it SURVIVES you working on the rest of the Group.
   *
   * refitTransports ran on every model-count change anywhere in the Army and
   * deleted any Transport Squad with nothing aboard, so buying the Condor
   * first and then setting the size of the Squad you meant to put in it lost
   * the Condor -- silently, with nothing on screen to say what had gone.
   * Reported by Jet 2026-08-07: a Squad taken from 2 to 3 and "a bunch of
   * other units in that group got deleted". */
  {
    const rider = A.addSquad(a, g.id, 'legionnaires', 2);
    eq(A.setModelCount(a, rider.id, 3).ok, true, 'a Squad in that Group grows');
    ok(g.squads.some(x => x.id === solo.id),
       'and the Transport bought first is still there afterwards');
    A.removeSquad(a, rider.id);
  }
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

/* Where a Commander may go. commanderTargets is what fills the Aboard select,
 * and until now nothing in the suite had ever called it — so the one control
 * that decides which Unit a Commander leads was answering from untested code.
 *
 * "A Squad may contain only one" (3.2.5) is the rule it enforces: a Squad
 * already holding somebody else is not offered, and the Squad holding THIS
 * Commander is, because otherwise the select could not show where they are.
 *
 * Excluding Transport Squads is the app's own decision and not something 3.2.5
 * says; it is pinned here as behaviour, with a question raised on the backlog
 * rather than a rule claimed for it.
 */
console.log('\nwhere a Commander may be assigned (3.2.5)');
{
  const a = army();
  const g = A.addGroup(a);
  const legion = A.addSquad(a, g.id, 'legionnaires', 3);
  A.assignTransport(a, legion.id, 'bear-apc');
  const g2 = A.addGroup(a);
  const tank = A.addSquad(a, g2.id, 'ucm-main-battle-tank', 2);

  const first = A.addCommander(a, 5).commander;
  let ids = A.commanderTargets(a, first.id).map(t => t.squad.id);
  eq(ids.length, 2, 'both fighting Squads are offered');
  ok(ids.includes(legion.id) && ids.includes(tank.id), 'and they are the right two');
  ok(!A.commanderTargets(a, first.id).some(t => (A.unitOf(a, t.squad) || {}).category === 'Transport'),
     'the Transport Squad is not among them');

  A.assignCommander(a, first.id, legion.id);
  ids = A.commanderTargets(a, first.id).map(t => t.squad.id);
  ok(ids.includes(legion.id), 'a Commander is still offered the Squad it is already aboard');

  const second = A.addCommander(a, 4).commander;
  ids = A.commanderTargets(a, second.id).map(t => t.squad.id);
  eq(ids.length, 1, 'a second Commander is offered only the free Squad');
  eq(ids[0], tank.id, 'and it is the one nobody is aboard');
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

/* 9.4, in full: "Vehicles and Infantry which do not begin the game aboard an
 * Aircraft, OR IN A TRANSPORT ABOARD AN AIRCRAFT, always begin Reserved."
 *
 * That second clause is the whole test. Six Legionnaires ride two Bear APCs
 * which ride one Condor — the rulebook's own illustration of nested transport
 * (3.2.4.2, p11) — so nothing in that Group begins Reserved. The check used to
 * look at the immediate carrier only, so the Legionnaires, whose carrier is a
 * Vehicle, were reported as walking on while they were in the air.
 */
console.log('\nwho actually begins Reserved (9.4)');
{
  const a = army();
  const g = A.addGroup(a);
  const legion = A.addSquad(a, g.id, 'legionnaires', 6);
  ok(A.assignTransport(a, legion.id, 'bear-apc').ok, 'six Legionnaires take two Bear APCs');
  const bears = g.squads.find(s => (A.unitOf(a, s) || {}).id === 'bear-apc');
  eq(bears.models.length, 2, 'two of them, derived from the load');
  ok(A.assignTransport(a, bears.id, 'condor-dropship').ok, 'and the Bears take a Condor');

  const v = A.validate(a);
  ok(!v.warnings.some(w => w.msg.includes('Reserved')),
     'nothing in that Group begins Reserved — the Legionnaires are in a Transport aboard an Aircraft',
     JSON.stringify(v.warnings));

  // Take the Condor away and every one of them is on the ground again.
  A.assignTransport(a, bears.id, '');
  ok(A.validate(a).warnings.some(w => w.msg.includes('Reserved')),
     'without the Aircraft they are back to starting Reserved');
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

/* A VARIANT STEPPER MOVES A MODEL. IT NEVER BUYS ONE. Jet, 2026-08-07: "click
 * shouldn't increase the miniatures. that's dumb... it's fiddly to like
 * 'increase another physical model'."
 *
 * The old control took a target COUNT and let the Squad's size follow, so
 * asking three Sabres for one Rapier gave you four tanks -- and because
 * required transport capacity is per model, that fourth tank broke the Condor
 * carrying them without saying so. */
console.log('\nthe Variant stepper redistributes, it does not buy models');
{
  const a = army(2000);
  const g = A.addGroup(a);
  const s = A.addSquad(a, g.id, 'ucm-main-battle-tank', 3);   // Sabre 35, Rapier 40
  const mix = () => s.models.map(m => m.variant).sort().join(',');
  eq(mix(), 'Sabre,Sabre,Sabre', 'a new Squad is all of the first Variant');

  ok(A.shiftVariant(a, s.id, 'Rapier', 1).ok, 'one of them can become a Rapier');
  eq(String(s.models.length), '3', 'and the Squad is still three miniatures');
  eq(mix(), 'Rapier,Sabre,Sabre', 'one Rapier, two Sabres');
  eq(A.squadCost(a, s), 110, 'costed as the mix it now is — 40 + 35 + 35');

  ok(A.shiftVariant(a, s.id, 'Rapier', 1).ok, 'and another');
  eq(mix(), 'Rapier,Rapier,Sabre', 'two Rapiers');
  eq(String(s.models.length), '3', 'still three');

  ok(A.shiftVariant(a, s.id, 'Rapier', -1).ok, 'and back the other way');
  eq(mix(), 'Rapier,Sabre,Sabre', 'one Rapier again');
  eq(String(s.models.length), '3', 'and still three');

  // Every model is already this Variant: there is nothing left to convert.
  A.shiftVariant(a, s.id, 'Sabre', 1);
  eq(mix(), 'Sabre,Sabre,Sabre', 'all three back to Sabre');
  const full = A.canShiftVariant(a, s.id, 'Sabre', 1);
  eq(full.ok, false, 'asking for a fourth Sabre in a Squad of three is refused');
  ok(/already a Sabre/.test(full.reason || '') && /Add a model/.test(full.reason || ''),
     'and it says the Squad stepper is where a fourth model comes from', full.reason);
  eq(A.canShiftVariant(a, s.id, 'Rapier', -1).ok, false,
     'and one fewer of a Variant you have none of does nothing');

  /* The point of the whole change: the Squad's size, and so the room it needs
   * in a Transport, is untouched by anything the Variant steppers do. */
  const before = s.models.length;
  ['Rapier', 'Tachi', 'Greave', 'Sabre'].forEach(n => {
    A.shiftVariant(a, s.id, n, 1); A.shiftVariant(a, s.id, n, -1);
  });
  eq(String(s.models.length), String(before), 'eight presses later it is the same three models');
  A.remove(a.id);
}

/* And the thing that made it matter: ROOM NEEDED IS PER MODEL. loadCheck
 * multiplies a Unit's fills by how many models are in the Squad, so a Squad
 * that grows behind your back needs more room than it did -- which is why a
 * Variant stepper must never grow one.
 *
 * What happens when you grow one ON PURPOSE is different and worth pinning
 * too: setModelCount calls refitTransports, so the Transport Squad resizes to
 * cover the new load rather than overflowing. It costs points you were not
 * asked about, and it can leave the Transports not full, which 3.2.4 refuses.
 */
console.log('\nrequired carrying capacity follows the model count');
{
  const f = DZC.faction('ucm');
  const mbt = f.byId['ucm-main-battle-tank'];     // fills 2 triangles per model
  const condor = f.byId['condor-dropship'];       // 6 triangles of room
  eq(JSON.stringify(DZC.loadCheck(condor, [{ unit: mbt, count: 3 }], 1).byShape),
     '{"triangle":6}', 'three tanks need six triangles');
  eq(JSON.stringify(DZC.loadCheck(condor, [{ unit: mbt, count: 4 }], 1).byShape),
     '{"triangle":8}', 'and four need eight -- the requirement is per model');
  eq(DZC.loadCheck(condor, [{ unit: mbt, count: 4 }], 1).ok, false,
     'which one Condor cannot hold');
  ok(/6 triangle capacity, needs 8/.test(
       DZC.loadCheck(condor, [{ unit: mbt, count: 4 }], 1).reason || ''),
     'and it says so in those terms');

  const a = army(2000);
  const g = A.addGroup(a);
  const tanks = A.addSquad(a, g.id, 'ucm-main-battle-tank', 3);
  const lift = A.addSquad(a, g.id, 'condor-dropship', 1);
  A.setCarrier(a, tanks.id, lift.id);
  ok(!A.validate(a).errors.some(e => /capacity|not full/.test(e.msg)),
     'three tanks fill one Condor exactly');

  /* Growing the Squad on purpose: the Transport Squad refits rather than
   * overflowing, so the fault reported is that the Condors are now half empty
   * -- not that the tanks do not fit. */
  A.setModelCount(a, tanks.id, 4);
  eq(String(A.findSquad(A.get(a.id), lift.id).models.length), '2',
     'a fourth tank buys a second Condor rather than overloading the first');
  ok(A.validate(a).errors.some(e => /not full/.test(e.msg)),
     'and eight triangles in twelve is not full, which 3.2.4 refuses');
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

console.log('\nreordering Groups');
{
  const a = A.create('ucm', 'Order', 2000);
  const g1 = A.addGroup(a, 'One');
  const g2 = A.addGroup(a, 'Two');
  const g3 = A.addGroup(a, 'Three');
  const order = () => A.get(a.id).groups.map(g => g.name).join(' ');

  ok(A.moveGroup(a, g3.id, g1.id, false), 'a Group moves before another');
  eq(order(), 'Three One Two', 'and the array order is the order on the page');
  ok(A.moveGroup(a, g3.id, g2.id, true), 'and after another');
  eq(order(), 'One Two Three', 'which puts it back');

  // The two cases that must do nothing rather than corrupt the list.
  ok(!A.moveGroup(a, g1.id, g1.id, true), 'a Group cannot be moved past itself');
  ok(!A.moveGroup(a, g1.id, 'nosuchgroup', true), 'and not next to one that is not there');
  eq(order(), 'One Two Three', 'neither of those moved anything');
  A.remove(a.id);
}

/* Dragging a Squad from one Group to another. Jet, 2026-08-07: "you should be
 * able to drag units between groups." */
console.log('\na Squad moves between Groups, and its cargo goes with it');
{
  const a = A.create('ucm', 'Moving', 2000);
  const g1 = A.addGroup(a, 'One');
  const g2 = A.addGroup(a, 'Two');
  const legs = A.addSquad(a, g1.id, 'legionnaires', 2);
  const bear = A.addSquad(a, g1.id, 'bear-apc', 1);
  A.setCarrier(a, legs.id, bear.id);
  const where = id => (A.groupOf(A.get(a.id), id) || {}).name;

  A.moveSquad(a, bear.id, g2.id);
  eq(where(bear.id), 'Two', 'the Transport moved');
  eq(where(legs.id), 'Two', 'and what it was carrying came with it');
  eq(A.findSquad(A.get(a.id), legs.id).carriedBy, bear.id,
     'still aboard, because the carrier came too');

  // Back the other way, this time moving only the passengers.
  A.moveSquad(a, legs.id, g1.id);
  eq(where(legs.id), 'One', 'a carried Squad can be moved out on its own');
  eq(where(bear.id), 'Two', 'leaving its Transport where it was');
  eq(String(A.findSquad(A.get(a.id), legs.id).carriedBy), 'null',
     'and it has got out, because the Transport is not in that Group any more');

  eq(String(A.moveSquad(a, legs.id, g1.id).ok), 'true',
     'moving a Squad to its own Group is a no-op');
  eq(String(A.moveSquad(a, legs.id, 'nosuchgroup').ok), 'false',
     'and an unknown Group is refused');
  A.remove(a.id);
}

/* The two starter armies, against TTCombat's own Group composition cards.
 *
 * The point of the test is not that they build — it is that they build the
 * army on the card AND come out legal. A starter list that opens with three
 * errors teaches a new player the wrong thing about the app and about 3.2.4,
 * and the only thing standing between here and that is this. */
/* INFANTRY IN AN APC, APC IN A DROPSHIP -- the commonest Group in the game,
 * and 3.2.4.1 says it outright: "up to 4 Squads, PLUS THEIR OWN TRANSPORT
 * SQUADS, may share one larger Transport."
 *
 * boardOptions used to refuse any carrier that was itself aboard something,
 * which made that Group unbuildable by drag and left the Buggy's own capacity
 * unreachable. Jet, 2026-08-07, looking at exactly that: "SHOULDN'T i be able
 * to click and drag the legionnaires into the buggy?" */
console.log('\na Transport that is itself aboard something can still be loaded');
{
  const a = army(750);
  const g = A.addGroup(a, 'Group 3');
  const raven = A.addSquad(a, g.id, 'raven-light-dropship', 1);   // 2 diamonds
  const buggy = A.addSquad(a, g.id, 'ucm-troop-buggy', 2);        // 1 square each, fills 1 diamond
  const legs = A.addSquad(a, g.id, 'legionnaires', 2);            // fills 1 square each
  A.setCarrier(a, buggy.id, raven.id);

  const offered = A.boardOptions(a, legs.id).map(o => o.unit.name);
  ok(offered.indexOf('UCM Troop Buggy') !== -1,
     'the Buggy is offered even though it is inside the Raven', offered.join(', '));
  ok(A.boardTransport(a, legs.id, buggy.id).ok, 'and the Legionnaires can be put in it');
  eq(A.findSquad(A.get(a.id), legs.id).carriedBy, buggy.id, 'three levels deep');
  eq(A.findSquad(A.get(a.id), buggy.id).carriedBy, raven.id, 'and the middle one still aboard');
  ok(!A.validate(a).errors.some(e => /capacity|not full|carries nothing/.test(e.msg)),
     'with nothing wrong about any of it',
     A.validate(a).errors.map(e => e.msg).join(' | '));

  /* The one thing that IS forbidden, and it has to be checked all the way
   * down: putting a Squad inside something it is already carrying. */
  eq(A.boardOptions(a, raven.id).length, 0,
     'the Raven cannot be loaded into anything it is carrying, at any depth');
  eq(A.boardTransport(a, raven.id, buggy.id).ok, false, 'and boarding it is refused');
  A.remove(a.id);
}

console.log('\nthe starter armies are the ones on the box');
{
  vm.runInContext(readFileSync(path.join(ROOT, 'js', 'dzc-starters.js'), 'utf8'), sandbox);
  const S = win.DZCStarters;
  const built = await S.seed();
  eq(String(built.length), '2', 'both starters are seeded');

  const ucm = built.find(x => x.faction === 'ucm');
  const bio = built.find(x => x.faction === 'bioficer');
  eq(String(ucm.groups.length), '9', 'the UCM card prints nine Groups');
  eq(String(bio.groups.length), '6', 'and the Bioficer card six');

  for (const a of built) {
    const v = A.validate(a);
    eq(v.errors.length + ' errors in ' + a.name, '0 errors in ' + a.name,
       `${a.name} is a legal list`,
       v.errors.map(e => e.msg).join(' | '));
  }

  // Spot-checks on the two things a from-scratch guess got wrong.
  const praet = ucm.groups.flatMap(g => g.squads).map(s => A.unitOf(ucm, s))
    .filter(Boolean).map(u => u.name);
  ok(praet.indexOf('Praetorian Spec-Ops') !== -1, 'the UCM box has Spec-Ops, not Snipers');
  ok(praet.indexOf('Praetorian Snipers') === -1, 'and not both');
  eq(String((ucm.commanders || [])[0].level), '4', 'its Commander is the Level 4 the card names');
  eq(String((bio.commanders || [])[0].level), '5', 'and the Bioficers\' is Level 5');
  const arkGroups = bio.groups.filter(g =>
    g.squads.some(s => (A.unitOf(bio, s) || {}).name === 'Grievance Genitor Ark'));
  eq(String(arkGroups.length), '2', 'the two Genitor Arks are in two Groups, as printed');

  // Seeded once, ever. Deleting one has to stick.
  eq(String((await S.seed()).length), '0', 'and they are never seeded twice');
  built.forEach(a => A.remove(a.id));
}

/* AND SEEDING NEVER EATS AN ARMY YOU ALREADY HAD.
 *
 * DZCArmy keeps the list in a module array that only load() fills, so an army
 * created against an unloaded one and saved writes over everything in the
 * store. The first version of the seeding call sat one line above load() in
 * renderList and did exactly that -- every army the user had, replaced by two
 * starters, silently. It was invisible in testing because testing always
 * started from a cleared store; the layout harness caught it by seeding an
 * army in one frame and finding it gone in another.
 *
 * Simulated here the only way it can be: fill the store, throw away the
 * in-memory copy the way a fresh page load does, and seed. */
console.log('\nseeding the starters does not eat the armies already there');
{
  store.clear();
  A.load();                       // and the module's copy of it, too
  const mine = A.create('ucm', 'Mine, from before', 2000);
  A.addSquad(A.get(mine.id), A.addGroup(A.get(mine.id), 'G').id, 'legionnaires', 3);
  A.save();
  const saved = store.get('dzc_armies');

  /* A FRESH PAGE, and getting this right is the whole test: the module's array
   * must be EMPTY while the store is full, which is the state every page load
   * starts in. Clearing the store and putting the armies back without emptying
   * the array first leaves the module still holding them, and then seeding
   * passes whether it calls load() or not. */
  store.clear();
  A.load();                       // armies = [] — the module knows nothing
  store.set('dzc_armies', saved); // and the store knows about the user's army
  const S2 = win.DZCStarters;
  await S2.seed();

  const names = A.load().map(a => a.name);
  ok(names.indexOf('Mine, from before') !== -1,
     'the army that was already in the store is still in it', names.join(', '));
  eq(String(names.length), '3', 'and the two starters joined it rather than replacing it');
  A.load().slice().forEach(a => A.remove(a.id));
  store.clear();
}

/* RAW MATERIALS — Genitor X, Bioficer Unit Special Rules.
 *
 * "Genitor Units may begin the game with up to X Raw Materials (RM) tokens
 * aboard them, and they may begin empty... RM tokens cost 5pts each and are
 * assigned to those Genitor Units. Their points contribute to their Group's
 * total cost but do not contribute towards any category."
 *
 * The last clause is the one worth a test: it is the only place in this app
 * where points count toward a total and toward no category, and getting it
 * wrong buys you free Vanguard against an inflated Standard. */
console.log('\nraw materials on Genitor Units (Genitor X)');
{
  store.clear();
  A.load();
  await DZC.loadFaction('bioficer');
  await DZC.loadFaction('ucm');

  const a = A.create('bioficer', 'RM', 2000);
  const g = A.addGroup(a, 'G');
  const ark = A.addSquad(a, g.id, 'grievance-genitor-ark', 1);
  const gyro = A.addSquad(a, g.id, 'gyro-aero-genitor', 1);
  const thorn = A.addSquad(a, g.id, 'thorn-light-skimmer', 1);

  eq(String(A.genitorCap(a, ark)), '12', 'a Grievance Genitor Ark caps at the 12 in its hollow square');
  eq(String(A.genitorCap(a, gyro)), '8', 'a Gyro Aero-Genitor caps at 8');
  eq(String(A.genitorCap(a, thorn)), '0', 'a Thorn is not a Genitor — it has no hollow square');

  ok(A.setRm(a, thorn.id, 1).ok === false, 'RM cannot be assigned to a Unit that is not a Genitor');
  ok(A.setRm(a, ark.id, 13).ok === false, 'and never more than the number in the symbol');
  ok(A.setRm(a, ark.id, -1).ok === false, 'nor below zero');

  const bare = A.squadCost(a, ark);
  ok(A.setRm(a, ark.id, 12).ok, 'a Genitor may be filled to its cap');
  eq(String(A.squadCost(a, ark) - bare), '60', '12 RM cost 60pts — 5pts each');
  eq(String(A.rmOf(ark)), '12', 'and the Squad remembers how many it holds');

  ok(A.setRm(a, ark.id, 0).ok, 'a Genitor may begin empty');
  eq(String(A.squadCost(a, ark)), String(bare), 'and an empty one costs what it always did');
  eq(A.rmOf(ark) === 0 && ark.rm === undefined, true, 'zero leaves no field behind to save or share');

  /* THE CATEGORY CLAUSE. The Ark is Standard, so if RM leaked into
   * categorySpend it would raise the very ceiling the other three are
   * measured against — 60pts of free headroom for Vanguard. */
  A.setRm(a, ark.id, 12);
  const spend = A.categorySpend(a);
  const total = A.armyCost(a);
  const summed = Object.keys(spend).reduce((t, k) => t + spend[k], 0);
  eq(String(total - summed), '60', 'RM points are in the army total and in no category');
  eq(String(A.groupCost(a, a.groups[0]) - summed), '60', 'and in their Group’s cost, which is what 3.2 meters');

  // Over the cap is unreachable by pressing anything, so validate is the
  // backstop for a share link or a backup that carries one.
  ark.rm = 99;
  ok(hasErr(A.validate(a), 'never have more than 12'), 'an over-capacity Genitor is reported (Genitor X)');
  thorn.rm = 3;
  ark.rm = 0;
  ok(hasErr(A.validate(a), 'is not a Genitor'), 'and so is RM sitting on a Unit that cannot hold any');
  delete thorn.rm;

  A.load().slice().forEach(x => A.remove(x.id));
  store.clear();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
