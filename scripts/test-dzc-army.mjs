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
 * the definition of what guns a Squad actually has. Which is an army question,
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

/* The refusal names the move, not just the rule (3.2.4).
 *
 * Grotwurks, 2026-08-09, adding a Triton X Gunship beside a Medusa meaning to
 * put one inside the other: "Oh look, now I have an error." Then: "I did
 * select add unit... I then selected the Triton X. Now I have an error."
 * Baxter could not reproduce it and called it a bug, then said it was not one.
 * Neither of them could tell whether the app was broken. It was not. The list
 * really was illegal, and one tap fixed it. Nothing said which tap. */
console.log('\ntwo loose Squads: the error says which one goes aboard which');
{
  await DZC.loadFaction('phr');
  const a = A.create('phr', 'Loose', 2000);
  const g = A.addGroup(a);
  const med = A.addSquad(a, g.id, 'medusa', 1);
  A.addSquad(a, g.id, 'triton-x-gunship', 1);
  const e = A.validate(a).errors.find(x => x.rule === '3.2.4' && /nothing carrying/.test(x.msg));
  ok(!!e, 'two Squads walking on is still an error');
  // Case-insensitive: the clause opens the sentence now that the em-dash
  // before it became a full stop, so it reads "A Group", not "a Group".
  ok(/a Group is one Squad and its Transports/i.test(e.msg), 'and still quotes the rule', e.msg);
  ok(/Put the Medusa aboard the Triton X Gunship\./.test(e.msg),
     'and now names the pair, the right way round', e.msg);

  // The suggestion comes from boardOptions, so taking it must clear the error.
  const tx = g.squads.find(s => s.unitId === 'triton-x-gunship');
  ok(A.boardTransport(a, med.id, tx.id).ok, 'the move it suggests is one the model allows');
  ok(!A.validate(a).errors.some(x => /nothing carrying/.test(x.msg)), 'and it clears the error');

  /* Nothing in the Group can carry anything else: no pair to name, so it says
   * the general way out instead of inventing one. */
  const b = A.create('phr', 'No fit', 2000);
  const g2 = A.addGroup(b);
  A.addSquad(b, g2.id, 'medusa', 1);
  A.addSquad(b, g2.id, 'type-9-frontier-walker', 1);
  const e2 = A.validate(b).errors.find(x => /nothing carrying/.test(x.msg));
  ok(!!e2 && /give one a Transport, or move one to a Group of its own/.test(e2.msg),
     'with no pair that fits, it offers the two general ways out', e2 && e2.msg);
  ok(!/Put the .* aboard the/.test(e2.msg), 'and does not invent a pairing', e2.msg);

  A.remove(a.id); A.remove(b.id);
}

/* An upgrade a card offers to SOME variants (3.2.3).
 *
 * "Menchit and Styx may replace Twin RX-20 Miniguns with RM-4 Foeslayer
 * Missiles". The only sentence in the data that restricts a purchase rather
 * than a printed gun. The restriction lived on the swap and not on the weapon,
 * so upgradesFor scoped it to '*' and an Ares could buy a Foeslayer for 5pts
 * with nothing traded in. Reported by a player, 2026-08-09: "The Foeslayer
 * should be Menchit and Styx only." */
console.log('\nan upgrade restricted to some variants (3.2.3)');
{
  await DZC.loadFaction('phr');
  const U = win.DZCUnits;
  const a = A.create('phr', 'Foeslayer', 1500);
  const s = A.addSquad(a, A.addGroup(a).id, 'type-1-battle-walker', 2);
  eq(A.squadCost(a, s), 70, 'two Ares are 35pts each');
  eq(A.upgradesFor(a, s).length, 0, 'an all-Ares Squad is offered no upgrade at all');

  A.setModelVariant(a, s.id, 0, 'Menchit');
  const offered = A.upgradesFor(a, s);
  eq(offered.length, 1, 'swapping one for a Menchit offers it');
  eq(offered[0].scope, 'Menchit', 'scoped to the Menchit');
  eq(offered[0].count, 1, 'and charged for the one model that may take it');

  ok(A.toggleUpgrade(a, s.id, 'Menchit', 'RM-4 Foeslayer Missiles').ok, 'it can be bought');
  eq(A.upgradeCost(a, s), 5, '5pts, not 10 — the Ares is not paying for a gun it cannot have');

  // The swap must still take the Menchit's miniguns and leave the Ares alone.
  const guns = v => U.unitWeapons(DZC.faction('phr').units.find(x => x.id === 'type-1-battle-walker'),
    { variants: [v], hasUpgrade: w => A.hasUpgrade(s, v, w.name) }).map(w => w.name);
  ok(guns('Menchit').includes('RM-4 Foeslayer Missiles'), 'the Menchit fires it');
  ok(!guns('Menchit').includes('Twin RX-20 Miniguns'), 'and has given up its miniguns for it');
  ok(!guns('Ares').includes('RM-4 Foeslayer Missiles'), 'the Ares does not fire it');

  /* A saved army that bought one before the weapon named its variants holds it
   * under '*'. Reading only the new scopes would take the gun and its points
   * off the list without a word. */
  s.upgrades = { '*': { 'RM-4 Foeslayer Missiles': true } };
  ok(A.hasUpgrade(s, 'Menchit', 'RM-4 Foeslayer Missiles'), 'an old save keeps its purchase');
  eq(A.upgradeCost(a, s), 5, 'repriced to the models that may actually carry it');
  ok(A.toggleUpgrade(a, s.id, 'Menchit', 'RM-4 Foeslayer Missiles').ok, 'and it can still be sold back');
  eq(A.upgradeCost(a, s), 0, 'which clears the legacy record too');

  A.remove(a.id);
}

/* 10.1.12 "Commanders may not be assigned to Fast Movers."
 * 10.1.20 "Commanders cannot be assigned to Living Weapons."
 *
 * Both sentences have been in data/dzc/rules.json since the rulebook was
 * scanned, shown on the card, and enforced nowhere. The app would put a Level
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
  /* A 1000pt game allows 250 a Group, and a Dragon is 950. So it IS refused in
   * a small game, on the rule that actually says so (3.2, the quarter cap that
   * 1.1 points at) rather than on a 3000pt minimum the rulebook never states.
   * See the note in validate: the only mention of 3000 anywhere in the
   * Behemoth document is an introduction saying SOME Behemoths are that big,
   * and nothing says which. */
  ok(A.validate(b).errors.some(e => e.rule === '3.2' && /quarter/.test(e.msg)),
     'a 950pt Dragon busts the quarter cap of a 1000pt game',
     JSON.stringify(A.validate(b).errors.map(e => e.msg)));
  ok(!A.validate(b).errors.some(e => /3000pts or more/.test(e.msg)),
     'and is not told it needs a 3000pt game, which is not a rule');
  ok(over && /counting as 10/.test(over.msg),
     "and two say so in the Behemoths' own terms, not as two Groups",
     JSON.stringify(A.validate(b).errors.map(e => e.msg)));
  A.remove(b.id);
  A.remove(a.id);
}

/* A Behemoth that FITS the quarter cap is legal, whatever the game size.
 *
 * Jet, 2026-08-10, on a 410pt UCM Light Battle Mech in a 1750pt list: "This
 * tag is incorrect, the Light is 410pts so under the 1/4 restriction." A
 * quarter of 1750 is 437, the Group card read "410 of 437pts", and the app was
 * calling the list illegal anyway. */
console.log('\na Behemoth inside the quarter cap is legal at any size (1.1)');
{
  await DZC.loadFaction('ucm');
  const a = A.create('ucm', 'Light', 1750);
  const g = A.addGroup(a);
  const s = A.addSquad(a, g.id, 'ucm-light-battle-mech', 1);
  A.setModelVariant(a, s.id, 0, 'India');          // 410pts, the dearer of the two
  eq(A.squadCost(a, s), 410, 'the India is 410pts');
  const v = A.validate(a);
  ok(!v.errors.some(e => /3000pts or more/.test(e.msg)),
     'no 3000pt refusal', JSON.stringify(v.errors.map(e => e.msg)));
  /* The quarter cap specifically. The list DOES raise "Heavy spend exceeds
   * Standard", which is the category ratio (3.2) and correct: a lone Behemoth
   * in the Heavy slot with nothing Standard beside it is illegal for a reason
   * that has nothing to do with being a Behemoth. */
  ok(!v.errors.some(e => /quarter/.test(e.msg)),
     '410 is inside the 437 a 1750pt game allows a Group',
     JSON.stringify(v.errors.map(e => e.msg)));

  // And it still counts as its Groups Equivalent for the allowance (1.1).
  eq(A.groupsUsed(a), 3, 'while still spending three of the Group allowance');
  A.remove(a.id);
}

/* A TRANSPORT BEHEMOTH'S CARGO IS A GROUP OF ITS OWN. Transport Behemoths:
 *
 *   "Except for Behemoths with the Director Gear, Behemoths taken with Squads
 *    aboard do not share a Group with their transported Squads. Instead, all
 *    Squads aboard a Behemoth at the start of the game form a single Group."
 *
 * The Squads were riding free: an Explorator with a Squad in the back cost its
 * Groups Equivalent of 4 and the Squad cost nothing. */
console.log('\na Transport Behemoth does not share its Group with its cargo');
{
  store.clear();
  A.load();
  await DZC.loadFaction('resistance');
  const a = A.create('resistance', 'Explorator', 5000);
  const g = A.addGroup(a);
  const ex = A.addSquad(a, g.id, 'explorator', 1);
  eq(DZC.unit('resistance', 'explorator').groupEquivalent, 4, 'an Explorator is worth four Groups');
  eq(A.groupsUsed(a), 4, 'and on its own that is what it spends');

  const sq = A.addSquad(a, g.id, 'resistance-fighters', 3);
  ok(A.boardTransport(a, sq.id, ex.id).ok, 'a Squad rides in the back');
  eq(A.groupsUsed(a), 5, 'which is a fifth Group, not a free ride');

  const sq2 = A.addSquad(a, g.id, 'berserkers', 2);
  ok(A.boardTransport(a, sq2.id, ex.id).ok, 'a second Squad joins it');
  eq(A.groupsUsed(a), 5, 'and they are ONE Group between them, not two');

  /* Director Gear is the exception the rule names. The Type 6 Grand Walker
   * lists "Director 2: 4 Venus", and its Venus Drones are not taken separately
   * at all (Directed), so nothing about it is a second Group. */
  await DZC.loadFaction('phr');
  const t6 = DZC.unit('phr', 'type-6-grand-walker');
  ok((t6.gear || []).some(x => /^Director\b/.test(x.name)), 'the Type 6 has Director Gear');
  ok(!DZC.unit('phr', 'venus-drone').selectable, 'and its Venus Drones cannot be taken separately');

  A.load().slice().forEach(x => A.remove(x.id));
  store.clear();
  await DZC.loadFaction('ucm');
}

/* THE ONE CARD OPTION THAT BUYS NO GUN.
 *
 * UCM Harrier Gunship: "May remove one UM-117 Cannons and gain Scanner and
 * Scout." Every other swap in the game hangs its toggle off the green name box
 * of the gun it sells you; this one sells nothing, so it had no control at all
 * and the sentence sat in the data doing nothing. It is free, so no points
 * move — what moves is a weapon off the Squad and two rules onto it. */
console.log('\na card option that buys no gun (UCM Harrier Gunship)');
{
  store.clear();
  A.load();
  await DZC.loadFaction('ucm');
  const a = A.create('ucm', 'Harrier', 2000);
  const g = A.addGroup(a);
  const s = A.addSquad(a, g.id, 'harrier-gunship');
  const guns = () => win.DZCUnits.unitWeapons(A.unitOf(a, s), A.squadGuns(s)).map(w => w.name);

  const opts = A.optionsFor(a, s);
  eq(String(opts.length), '1', 'the Harrier offers one such option');
  eq(opts[0].swap.removes[0].weapon, 'UM-117 Cannons', 'and it drops a UM-117 Cannons');

  const before = guns();
  eq(String(before.filter(n => n === 'UM-117 Cannons').length), '2', 'it starts with two of them');
  eq(A.unitOf(a, s).special, 'Ev1', 'and neither Scanner nor Scout');
  const cost = A.squadCost(a, s);

  A.toggleOption(a, s, opts[0].scope, opts[0].key);
  eq(String(guns().filter(n => n === 'UM-117 Cannons').length), '1',
     'taking it removes ONE — the card says one');
  eq(A.unitOf(a, s).special, 'Ev1, Scanner, Scout', 'and the Squad gains both rules');
  eq(String(A.squadCost(a, s)), String(cost), 'it is free, so nothing moves in the points');

  /* A copy, never a mutation. unit objects are the shared faction data, so a
   * Harrier that gained Scanner in place would have gained it for every
   * Harrier in every army in the browser. */
  const s2 = A.addSquad(a, A.addGroup(a).id, 'harrier-gunship');
  eq(A.unitOf(a, s2).special, 'Ev1', 'a second Harrier is untouched by the first');
  eq(DZC.unit('ucm', 'harrier-gunship').special, 'Ev1', 'and so is the faction data');

  A.toggleOption(a, s, opts[0].scope, opts[0].key);
  eq(String(guns().filter(n => n === 'UM-117 Cannons').length), '2', 'putting it back restores the gun');
  eq(A.unitOf(a, s).special, 'Ev1', 'and takes the rules away again');

  // It travels: the key is stored the way an upgrade is, so a share link
  // carries it with no encoder of its own.
  A.toggleOption(a, s, opts[0].scope, opts[0].key);
  ok(A.hasOption(s, opts[0].swap), 'the option is recorded on the Squad');
  ok(/option:/.test(JSON.stringify(s.upgrades)),
     'under a key no weapon name can collide with', JSON.stringify(s.upgrades));

  A.load().slice().forEach(x => A.remove(x.id));
  store.clear();
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

/* And it applies to the STARRED upgrades, not to all of them.
 *
 * Both Tritons are the only cards in the game printing that footnote, and both
 * star two of their three upgrades:
 *
 *     RM-1 Stealth Missile Battery (+10pts)
 *     Twin RX-20 Miniguns (+5pts*)
 *     RM-7 Skyhammer Missiles (+15pts*)
 *     *Only one of these upgrades may be taken.
 *
 * Jet, 2026-08-10: "With the Triton you can take the RM-1 with the RX-20 or the
 * RM-7. Just not the RX-20 with the RM-7." */
console.log('\nthe footnote binds the starred upgrades only (3.2.3)');
{
  await DZC.loadFaction('phr');
  for (const id of ['triton-light-dropship', 'triton-light-troopship']) {
    const a = A.create('phr', 'Triton', 1500);
    const s = A.addSquad(a, A.addGroup(a).id, id, 1);
    const base = A.squadCost(a, s);
    const RM1 = 'RM-1 Stealth Missile Battery';   // +10, unstarred
    const RX = 'Twin RX-20 Miniguns';             // +5,  starred
    const RM7 = 'RM-7 Skyhammer Missiles';        // +15, starred

    ok(A.toggleUpgrade(a, s.id, '*', RM1).ok, `${id}: the RM-1 can be taken`);
    ok(A.toggleUpgrade(a, s.id, '*', RX).ok, 'and the RX-20 alongside it');
    eq(A.squadCost(a, s), base + 15, 'costing both, 10 + 5');

    const clash = A.toggleUpgrade(a, s.id, '*', RM7);
    eq(clash.ok, false, 'but not the RM-7 as well');
    ok(/only one of/.test(clash.reason) && new RegExp(RX).test(clash.reason)
       && /3\.2\.3/.test(clash.reason),
       'and the refusal names both guns and its rule', clash.reason);

    // Drop the RX-20 and the RM-7 becomes legal: the RM-1 never blocked it.
    ok(A.toggleUpgrade(a, s.id, '*', RX).ok, 'dropping the RX-20');
    ok(A.toggleUpgrade(a, s.id, '*', RM7).ok, 'lets the RM-7 in beside the RM-1');
    eq(A.squadCost(a, s), base + 25, 'costing 10 + 15');
    A.remove(a.id);
  }
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
 * does not yet make sense, a lone Transport, two Squads with nothing carrying
 * them, is only wrong once you stop building, so validate() reports it. */
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
  // A lone Transport is UNFINISHED, not illegal, you may be about to fill it,
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

/* Jet, 2026-08-09: "let squads drop to 0." canSetCount used to refuse
 * n < squadMin outright, which left a Squad you were shrinking with nowhere
 * legal to land between "at minimum" and "gone" -- the maximum is still a
 * hard ceiling (there is no such thing as six of a Unit "temporarily"), but
 * the minimum is now something validate() reports rather than something the
 * stepper blocks.
 *
 * And zero itself stopped deleting the Squad the same day it stopped being
 * refused. Jet, later the same day: "leave it at 0 units if it's selected...
 * make the entire card greyed out with 0 models but not deleted... rather
 * than code it in specifically for some units, going from 0 to x in each
 * squad would cover every squad." Emptying a Squad used to call removeSquad;
 * now the only thing that removes one is removeSquad itself, called on
 * purpose. */
console.log('\nbut the minimum is not -- a Squad may sit below it and say so');
{
  const a = army();
  const g = A.addGroup(a);
  const s = A.addSquad(a, g.id, 'legionnaires', 3);   // squadMin 2
  eq(String(A.unitOf(a, s).squadMin), '2', 'Legionnaires have a minimum of two');

  ok(A.setModelCount(a, s.id, 1).ok, 'dropping to one is allowed, not refused');
  eq(s.models.length, 1, 'the Squad actually shrank');
  ok(hasErr(A.validate(a), 'minimum is 2'), 'and validate reports it as unfinished (rule 2)');

  ok(A.setModelCount(a, s.id, 0).ok, 'and it can go all the way to zero');
  ok(!!A.findSquad(a, s.id), 'without removing the Squad -- it is empty, not gone');
  eq(A.findSquad(a, s.id).models.length, 0, 'zero models');
  ok(hasErr(A.validate(a), 'minimum is 2'), 'and validate still reports it, the same as at one');

  ok(A.setModelCount(a, s.id, 1).ok, 'it can be filled back in from zero');
  eq(A.findSquad(a, s.id).models.length, 1, 'without ever having needed re-adding');

  A.removeSquad(a, s.id);
  eq(A.findSquad(a, s.id), null, 'only removeSquad, called on purpose, actually removes it');
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
 * and until now nothing in the suite had ever called it. So the one control
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

/* A MODEL IS NOT DIVISIBLE (3.2.4.2).
 *
 * "Transports may only carry Units with the same shaped Symbol as itself and
 * may not carry more than their number indicates." The number on a solid
 * symbol is what ONE Unit fills, so a Unit filling more than a Transport's
 * whole capacity cannot ride in it -- not in two of them, not in nine.
 *
 * Shape alone was the whole test, and the count was then the Squad's total
 * fill divided by the Transport's capacity. That offered a Ferrum Drone Base
 * at 18 three Condors at 6, which is one vehicle sawn into three pieces.
 * Reported by Jet, 2026-08-12: "i'm pretty sure that one big vehicle can't be
 * carried by 3 small ones." 15 such pairs existed across five factions.
 *
 * The rulebook's own worked examples are the fixed points on the other side of
 * this, and they are asserted first: whatever the fix does, 3 Sabres must
 * still fill one Condor (3.2.4.2) and 6 must still fill two (Group 3). */
console.log('\na Unit too big for a Transport cannot ride in several of them (3.2.4.2)');
{
  await DZC.loadFaction('ucm');
  const a = A.create('ucm', 'T', 3000);

  const g1 = A.addGroup(a);
  const sabres3 = A.addSquad(a, g1.id, 'ucm-main-battle-tank', 3);
  const c3 = A.transportOptions(a, sabres3.id).find(o => o.unit.id === 'condor-dropship');
  eq(c3 && c3.need, 1, "3 Sabres at 2 fill one Condor at 6 — the rulebook's own example");
  eq(c3 && c3.exact, true, 'and it is exactly full');

  const g2 = A.addGroup(a);
  const sabres6 = A.addSquad(a, g2.id, 'ucm-main-battle-tank', 6);
  const c6 = A.transportOptions(a, sabres6.id).find(o => o.unit.id === 'condor-dropship');
  eq(c6 && c6.need, 2, '6 Sabres fill two Condors, three in each (Group 3)');
  eq(c6 && c6.exact, true, 'and both are full');

  const g3 = A.addGroup(a);
  const ferrum = A.addSquad(a, g3.id, 'ferrum-drone-base', 1);
  const names = A.transportOptions(a, ferrum.id).map(o => o.unit.id);
  ok(!names.includes('condor-dropship'),
     'a Condor at 6 is NOT offered for a Ferrum Drone Base at 18', names.join(', '));
  ok(!names.includes('crow-dropship'), 'nor a Crow at 2', names.join(', '));
  ok(names.includes('albatross-heavy-dropship'),
     'the Albatross at 18 is, and it is the only one', names.join(', '));
  eq(A.assignTransport(a, ferrum.id, 'condor-dropship').ok, false,
     'and assigning three Condors directly is refused');

  /* A Squad already saved this way -- built before the rule was enforced --
   * must still open and be REPORTED, not silently repaired and not crashed. */
  const t = A.addSquad(a, g3.id, 'condor-dropship', 3);
  ferrum.carriedBy = t.id;
  ok(A.validate(a).errors.some(e => e.rule === '3.2.4.2' && /Ferrum Drone Base/.test(e.msg)),
     'an army saved under the old rule opens and is named illegal');
  A.remove(a.id);
}

/* The same rule reaches Auxiliary Transports, which are a different path --
 * they are chosen as ordinary Squads and go through canCarry rather than
 * transportOptions. 3.2.4.3 excuses them from being FULL; it does not excuse
 * them from the capacity number. An Angelos Jetskimmer carries 1 square and a
 * Medusa fills 2, so no number of Angelos ever carries a Medusa. */
console.log('\nan Auxiliary Transport is excused being full, not being big enough (3.2.4.3)');
{
  await DZC.loadFaction('phr');
  const angelos = DZC.unit('phr', 'angelos-jetskimmer');
  const medusa = DZC.unit('phr', 'medusa');
  ok(angelos && medusa, 'both cards are in the data');
  eq(DZC.canCarry(angelos, medusa), false,
     'an Angelos at 1 square cannot carry a Medusa at 2');
  eq(DZC.loadCheck(angelos, [{ unit: medusa, count: 1 }], 2).ok, false,
     'and two Angelos between them still cannot — a model is not divisible');
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
  ok(!v.warnings.some(w => w.msg.includes('Reserved')), 'nothing is said about who begins Reserved');
  ok(!v.errors.some(e => e.msg.includes('Reserved')), 'and it was never an error either');
  A.remove(a.id);
}

/* 9.4 SAYS NOTHING ANY MORE. Jet, 2026-08-13: "remove this warning."
 *
 * It counted the Squads not aboard an Aircraft and warned they begin
 * Reserved, which is true of most Squads in most armies and is deployment
 * restated rather than a fault in the list.
 *
 * What went with it was a real piece of rules reading, and it is recorded
 * here because the next person to want this on the sheet needs it: 9.4 is
 * "Vehicles and Infantry which do not begin the game aboard an Aircraft, OR
 * IN A TRANSPORT ABOARD AN AIRCRAFT, always begin Reserved." That second
 * clause is the whole of it. Six Legionnaires in two Bear APCs in one Condor
 * -- the rulebook's own illustration of nested transport (3.2.4.2, p11) --
 * all fly in, and the first version looked at the immediate carrier only and
 * reported the Legionnaires walking on while they were in the air.
 *
 * The check below is what remains: the validator stays silent either way.
 */
console.log('\nnothing is said about who begins Reserved (9.4)');
{
  const a = army();
  const g = A.addGroup(a);
  const legion = A.addSquad(a, g.id, 'legionnaires', 6);
  ok(A.assignTransport(a, legion.id, 'bear-apc').ok, 'six Legionnaires take two Bear APCs');
  const bears = g.squads.find(s => (A.unitOf(a, s) || {}).id === 'bear-apc');
  eq(bears.models.length, 2, 'two of them, derived from the load');
  ok(A.assignTransport(a, bears.id, 'condor-dropship').ok, 'and the Bears take a Condor');
  ok(!A.validate(a).warnings.some(w => w.msg.includes('Reserved')),
     'aboard an Aircraft: silent', JSON.stringify(A.validate(a).warnings));

  A.assignTransport(a, bears.id, '');
  ok(!A.validate(a).warnings.some(w => w.msg.includes('Reserved')),
     'and on the ground: still silent');
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

/* THE OTHER HALF: a Variant Unit whose Squad size is a RANGE, not a fixed
 * number. shiftVariant only ever trades one model for another -- there is
 * nothing to trade with on a fresh Squad of one, and sizeControl hides the
 * top stepper for every Variant Unit (2026-08-08, "remove that +/- stepper"
 * on the Troop Buggy). Between the two, a Grievance Genitor Ark (1-2, two
 * Variants) had no way to become two models at all -- reported 2026-08-09,
 * and not just for Bioficer: Resistance Main Battle Tank, Thorn, Tusk,
 * Tangent and the Scourge Interceptor are all squadMin !== squadMax with
 * Variants. adjustVariantCount is the fix: it adds or removes a model of ONE
 * Variant outright, bounded by squadMin/squadMax the way the missing top
 * stepper would be. */
console.log('\nthe ranged Variant stepper adds and removes models (not just trades)');
{
  await DZC.loadFaction('bioficer');
  const a = A.create('bioficer', 'T', 2000);
  const g = A.addGroup(a);
  const s = A.addSquad(a, g.id, 'grievance-genitor-ark');   // squadMin 1, squadMax 2
  const u = A.unitOf(a, s);
  eq(String(u.squadMin), '1', 'a Grievance starts at one');
  eq(String(u.squadMax), '2', 'and caps at two');
  eq(String(s.models.length), '1', 'a fresh Squad is the minimum, one model');

  // The OLD control on a Squad of one, tried on its OWN Squad so it cannot
  // touch the one the rest of this test grows: shiftVariant CAN convert the
  // sole model (it is a trade, not a purchase, and one model can always
  // become a different one) -- but repeating it can never grow the Squad,
  // because there is never a second model for it to pull from. That is the
  // actual bug: not that the Squad stayed the wrong Variant, but that it
  // never stopped being one model at all.
  {
    const lone = A.addSquad(a, g.id, 'grievance-genitor-ark');
    ok(A.canShiftVariant(a, lone.id, u.variants[1].name, 1).ok,
       'shiftVariant CAN turn the one model into the other Variant...');
    ok(A.shiftVariant(a, lone.id, u.variants[1].name, 1).ok, 'so the shift itself succeeds');
    eq(String(lone.models.length), '1', '...but it is still one model afterward, never two');
    // And it stays reversible-but-stuck: shifting it straight back works too
    // (there is always exactly one model for the OTHER direction to pull),
    // so nothing about shiftVariant ever refuses outright here -- it just
    // never has a second model to offer, which is the actual bug.
    ok(A.canShiftVariant(a, lone.id, u.variants[0].name, 1).ok,
       'the reverse shift is just as legal -- shiftVariant never refuses...');
    ok(A.shiftVariant(a, lone.id, u.variants[0].name, 1).ok, '...it just trades the same one model back and forth');
    eq(String(lone.models.length), '1', 'forever one model, never two, no matter which way you press it');
    A.removeSquad(a, lone.id);
  }

  ok(A.canAdjustVariantCount(a, s.id, u.variants[0].name, 1).ok,
     'the ranged control can still grow the Squad');

  ok(A.adjustVariantCount(a, s.id, u.variants[0].name, 1).ok, 'a second model is added outright');
  eq(String(s.models.length), '2', 'the Squad is now two');
  ok(A.canAdjustVariantCount(a, s.id, u.variants[0].name, 1).ok === false,
     'a third is refused -- squadMax is 2');

  // Two clicks, not a shift: remove the first Variant, add the second.
  ok(A.adjustVariantCount(a, s.id, u.variants[0].name, -1).ok, 'one model can be removed');
  ok(A.adjustVariantCount(a, s.id, u.variants[1].name, 1).ok, 'and the other Variant added in its place');
  eq(s.models.map(m => m.variant).sort().join(','), [u.variants[0].name, u.variants[1].name].sort().join(','),
     'landing on one of each without ever leaving squadMin..squadMax');

  ok(A.adjustVariantCount(a, s.id, u.variants[1].name, -1).ok, 'shrinking back toward the minimum is allowed');
  eq(String(s.models.length), '1', 'down to one');

  // Squad of one: the last model may still come out, same as pressing the
  // Squad stepper down to zero would (canSetCount no longer refuses below
  // squadMin at all -- Jet, 2026-08-09: "let squads drop to 0"). And it
  // stays -- empty, not removed (Jet, later: "leave it at 0 units... not
  // deleted"; adjustVariantCount matches setModelCount's own note on this).
  ok(A.canAdjustVariantCount(a, s.id, u.variants[0].name, -1).ok,
     'and the last model can still come out, same as the Squad stepper going to zero');
  ok(A.adjustVariantCount(a, s.id, u.variants[0].name, -1).ok, 'taking it out');
  eq(String(A.findSquad(a, s.id).models.length), '0', 'leaves the Squad at zero, not removed');
  A.remove(a.id);

  // A Unit whose squadMin is actually above one -- Thorn, 2-8. Dropping below
  // it used to be refused outright; now it is allowed and the SQUAD reports
  // itself unfinished instead (Jet, 2026-08-09: "let squads drop to 0").
  const b = A.create('bioficer', 'T2', 2000);
  const g2 = A.addGroup(b);
  const thornSq = A.addSquad(b, g2.id, 'thorn-light-skimmer');   // starts at squadMin, 2
  eq(String(thornSq.models.length), '2', 'a fresh Thorn Squad is already at its minimum of two');
  ok(A.setModelCount(b, thornSq.id, 1).ok, 'dropping it to one is no longer refused');
  ok(hasErr(A.validate(b), 'minimum is 2'), 'validate reports it as unfinished instead (rule 2)');
  ok(A.setModelCount(b, thornSq.id, 0).ok, 'and it can still go all the way to zero');
  ok(!!A.findSquad(b, thornSq.id), 'without being removed');
  eq(String(A.findSquad(b, thornSq.id).models.length), '0', 'just empty');
  A.remove(b.id);
}

/* THE RADIO CASE: squadMin === squadMax === 1 with more than one Variant
 * (Resistance Super Heavy Tank, four hull names, always exactly one model).
 * The builder's dot picker used to only run when the Squad already had its
 * one model -- there was no way to reach zero at all, since pickVariant
 * refused outright on an empty Squad. Jet, 2026-08-09: "you probably should
 * just set them all to the ability to be reduced to zero... that lets the
 * user then pick a different variant if they wish." adjustVariantCount is
 * what the dot now calls either way: -1 on the Variant already showing takes
 * it to zero, +1 on any Variant from zero takes it. */
console.log('\na fixed one-model Squad can reach zero too, and be filled back in as a different Variant');
{
  await DZC.loadFaction('resistance');
  const a = A.create('resistance', 'T3', 2000);
  const g = A.addGroup(a);
  const s = A.addSquad(a, g.id, 'resistance-super-heavy-tank');
  const u = A.unitOf(a, s);
  eq(String(u.squadMin), '1', 'squadMin 1');
  eq(String(u.squadMax), '1', 'squadMax 1 -- always exactly one model');
  eq(s.models[0].variant, u.variants[0].name, 'a fresh Squad is the first hull, Alexander');

  ok(A.adjustVariantCount(a, s.id, u.variants[0].name, -1).ok, 'the dot already showing can take it to zero');
  eq(String(s.models.length), '0', 'empty, not removed');

  ok(A.canAdjustVariantCount(a, s.id, u.variants[2].name, 1).ok, 'from zero, a different hull can be pressed');
  ok(A.adjustVariantCount(a, s.id, u.variants[2].name, 1).ok, 'Belisarius, say');
  eq(String(s.models.length), '1', 'back to one model');
  eq(s.models[0].variant, u.variants[2].name, 'and it is the hull that was pressed, not the first one again');
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
  // backup, and the export is the stored shape unmodified, so the round trip
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
 * The point of the test is not that they build. It is that they build the
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
  for (const spec of S.STARTERS) await DZC.loadFaction(spec.faction);
  const built = S.STARTERS.map((_, i) => S.quickPlay(i));
  eq(String(built.length), '2', 'both starter lists build');

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

  /* The chooser describes what the builder makes, off the same spec -- so it
   * cannot advertise a Group count or a model count that is not there. */
  const shown = S.list();
  eq(String(shown.length), '2', 'the chooser offers both');
  eq(String(shown[0].groups), String(ucm.groups.length), 'and counts the UCM Groups right');
  eq(String(shown[0].models),
     String(ucm.groups.reduce((n, g) => n + g.squads.reduce((m, q) => m + q.models.length, 0), 0)),
     'and its models');
  eq(String(shown[1].groups), String(bio.groups.length), 'and the Bioficer Groups');
  built.forEach(a => A.remove(a.id));
}

/* AND QUICK PLAY NEVER EATS AN ARMY YOU ALREADY HAD.
 *
 * DZCArmy keeps the list in a module array that only load() fills, so an army
 * created against an unloaded one and saved writes over everything in the
 * store. That shipped once, from a caller that ran one line above its load(),
 * and it replaced every army the user had. It was invisible in testing because
 * testing always started from a cleared store; the layout harness caught it by
 * seeding an army in one frame and finding it gone in another.
 *
 * Simulated here the only way it can be: fill the store, throw away the
 * in-memory copy the way a fresh page load does, then build one. */
console.log('\nquick play does not eat the armies already there');
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
   * the array first leaves the module still holding them, and then it passes
   * whether quickPlay calls load() or not. */
  store.clear();
  A.load();                       // armies = [], the module knows nothing
  store.set('dzc_armies', saved); // and the store knows about the user's army
  win.DZCStarters.quickPlay(0);

  const names = A.load().map(a => a.name);
  ok(names.indexOf('Mine, from before') !== -1,
     'the army that was already in the store is still in it', names.join(', '));
  eq(String(names.length), '2', 'and the starter joined it rather than replacing it');
  A.load().slice().forEach(a => A.remove(a.id));
  store.clear();
}

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

  /* genitorCap used to be capacityFor alone -- the ONE Gyro's own hollow
   * square, never multiplied by how many Gyros are actually in the Squad.
   * Reported 2026-08-09: a second Gyro left the cap sitting at 8 while the
   * Squad's RM total read 16. */
  A.setModelCount(a, gyro.id, 2);
  eq(String(A.genitorCap(a, gyro)), '16', 'a second Gyro doubles the cap -- 8 per model, not 8 flat');
  ok(A.setRm(a, gyro.id, 16).ok, 'and the Squad can actually hold that much');
  ok(A.setRm(a, gyro.id, 17).ok === false, 'but not a token more');
  A.setRm(a, gyro.id, 0);
  A.setModelCount(a, gyro.id, 1);

  ok(A.setRm(a, ark.id, 0).ok, 'a Genitor may begin empty');
  eq(String(A.squadCost(a, ark)), String(bare), 'and an empty one costs what it always did');
  eq(A.rmOf(ark) === 0 && ark.rm === undefined, true, 'zero leaves no field behind to save or share');

  /* THE CATEGORY CLAUSE. The Ark is Standard, so if RM leaked into
   * categorySpend it would raise the very ceiling the other three are
   * measured against, 60pts of free headroom for Vanguard. */
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

/* SHARING ONE TRANSPORT vs SHARING A TRANSPORT SQUAD, 3.2.4.1 and 3.2.4.3.
 *
 * Jet, 2026-08-08: "Squad of Hazards and squad of legionnaires in a group with
 * Ferrets: okay. ...in a group with Ravens: not okay."
 *
 * Both are the rulebook's own worked examples on page 10, so both are asserted
 * against it: Group 4 is four Ferrets carrying two Legionnaires AND two Hazard
 * Suits, and Group 5 is ONE Albatross holding two Bear APC Squads with their
 * Legionnaires. The line between them is "ONE Transport" against "a Squad of
 * Transports", and it was invisible until a Squad of two Ravens had a seat
 * going spare. */
console.log('\nsharing a Transport (3.2.4.1) and an Auxiliary Transport (3.2.4.3)');
{
  store.clear();
  A.load();
  await DZC.loadFaction('ucm');
  const mk = () => { const a = A.create('ucm', 'Share', 3000); return [a, A.addGroup(a, 'G')]; };

  // Group 4. An Auxiliary Transport Squad may carry Squad/S, at any size.
  const [a, g] = mk();
  const ferrets = A.addSquad(a, g.id, 'ucm-troop-buggy', 4);
  ferrets.models.forEach(m => { m.variant = 'Ferret'; });
  const legs = A.addSquad(a, g.id, 'legionnaires', 2);
  A.boardTransport(a, legs.id, ferrets.id);
  const haz = A.addSquad(a, g.id, 'hazard-suits', 2);
  const boarded = A.boardTransport(a, haz.id, ferrets.id);
  ok(boarded.ok,
     'four Ferrets carry Legionnaires AND Hazard Suits — the book’s Group 4 (3.2.4.3)');
  /* "Auxiliary Transports do not have to be full" (3.2.4.3), and this said
   * they did: boarding one raised "still has room for 2. Transports must be
   * taken full (3.2.4)" on the book's own legal Group, while validate — which
   * has always had the exemption — said nothing. A toast that contradicts the
   * army panel is worse than no toast. */
  eq(boarded.warn, null, 'and nothing warns them they must be full: they need not be');

  // The case Jet named. Three Legionnaires need two Troopships, two Troopships
  // hold four, and that spare square is what let a second Squad in.
  const [b, g2] = mk();
  const l2 = A.addSquad(b, g2.id, 'legionnaires', 3);
  A.assignTransport(b, l2.id, 'raven-light-troopship');
  const ravens = A.findSquad(b, l2.carriedBy);
  eq(String(ravens.models.length), '2', 'three Legionnaires take two Raven Troopships');
  const haz2 = A.addSquad(b, g2.id, 'hazard-suits', 1);
  const refused = A.boardTransport(b, haz2.id, ravens.id);
  ok(!refused.ok, 'a second Squad may NOT split a Squad of two Ravens (3.2.4.1)');
  ok(/ONE Transport/.test(refused.reason || ''),
     'and the refusal names the rule rather than blaming capacity', refused.reason);
  ok(A.boardOptions(b, haz2.id).length === 0, 'so the chooser never offers it either');

  // Group 5. ONE larger Transport, shared by up to 4 Squads and their own.
  const [c, g3] = mk();
  const c1 = A.addSquad(c, g3.id, 'legionnaires', 3);
  A.assignTransport(c, c1.id, 'bear-apc');
  const bear1 = A.findSquad(c, c1.carriedBy);
  const c2 = A.addSquad(c, g3.id, 'legionnaires', 3);
  A.assignTransport(c, c2.id, 'bear-apc');
  const bear2 = A.findSquad(c, c2.carriedBy);
  A.assignTransport(c, bear1.id, 'albatross-heavy-dropship');
  const alb = A.findSquad(c, bear1.carriedBy);
  eq(String(alb.models.length), '1', 'one Albatross carries a Bear APC and its Legionnaires');
  ok(A.boardTransport(c, bear2.id, alb.id).ok,
     'and a second Bear APC Squad shares that ONE Albatross — the book’s Group 5');

  /* THE WHOLE OF GROUP 5, WHICH IS WHERE IT USED TO STOP.
   *
   * The book prints it as one Albatross over two Bear APCs, their two
   * Legionnaire Squads, three Sabres and two Gladius (p.10) — four Squads,
   * "plus their Transport Squads if they have any", filling all 18 triangles
   * exactly.
   *
   * The cap counted every Squad in the GROUP holding a carrier of any kind,
   * so the two Bears each spent a slot their own rule gives them for free and
   * the count hit four with half the Group still to add. The Sabres were
   * refused, and the Albatross left holding six of eighteen then reported
   * "not full" for good — an error thrown at an Army the rulebook prints as
   * legal. Reported 2026-08-15. */
  const sabres = A.addSquad(c, g3.id, 'ucm-main-battle-tank', 3);
  ok(!!sabres, 'three Sabres join that Group — the Bears do not spend a slot (3.2.4.1)',
     sabres ? '' : A.canAddUnit(c, g3.id, 'ucm-main-battle-tank').reason);
  if (sabres) ok(A.boardTransport(c, sabres.id, alb.id).ok, 'and board the Albatross');
  const gladius = A.addSquad(c, g3.id, 'ucm-heavy-tank', 2);
  ok(!!gladius, 'and so do two Gladius, the fourth Squad',
     gladius ? '' : A.canAddUnit(c, g3.id, 'ucm-heavy-tank').reason);
  if (gladius) ok(A.boardTransport(c, gladius.id, alb.id).ok, 'boarding it as well');
  const bookV = A.validate(c);
  ok(!hasErr(bookV, 'not full'),
     'the book’s Group 5, complete, fills the Albatross exactly',
     JSON.stringify(bookV.errors.map(e => e.msg)));
  ok(!hasErr(bookV, 'share one Transport'),
     'and four Squads plus their two Transport Squads is not five');

  /* The cap is still a cap, and it is enforced where the sharing happens.
   *
   * Not at addSquad: a Group whose only Transport is full is exactly where you
   * stand when you are about to buy a second Squad AND the second Transport to
   * put it in, so refusing on capacity there would block a legal build. The
   * Albatross itself refuses, which is the press that would break the rule. */
  const fifth = A.addSquad(c, g3.id, 'praetorian-snipers', 2);
  ok(!!fifth, 'a fifth Squad may still be ADDED — it may be about to get its own ride');
  const over = A.boardTransport(c, fifth.id, alb.id);
  ok(!over.ok, 'but the Albatross refuses it: four Squads is four (3.2.4.1)', over.reason);
  ok(!A.boardOptions(c, fifth.id).some(o => o.squad && o.squad.id === alb.id),
     'and the chooser does not offer the Albatross either');

  // Group 3. One Squad may still fill several identical Transports alone.
  const [d, g4] = mk();
  const tanks = A.addSquad(d, g4.id, 'ucm-main-battle-tank', 6);
  ok(A.assignTransport(d, tanks.id, 'condor-dropship').ok,
     'six tanks still fill two Condors on their own — the book’s Group 3');

  /* Flexible Capacity, end to end. Three places assert fullness -- the warning
   * when you choose a Transport, the warning when you board one already in the
   * Group, and validate -- and all three quoted "Transports must be taken
   * full" at a card that says otherwise. */
  {
    await DZC.loadFaction('resistance');
    const r = A.create('resistance', 'Flex', 3000);
    const rg = A.addGroup(r, 'G');
    const fighters = A.addSquad(r, rg.id, 'resistance-fighters', 2);
    const got = A.assignTransport(r, fighters.id, 'battle-bus');
    ok(got.ok, 'a Battle Bus takes two Resistance Fighters');
    eq(got.warn, null, 'with no warning: two of four squares is half (Flexible Capacity)');
    ok(!hasErr(A.validate(r), 'not full'), 'and the Army is legal at half a Bus');

    // The rule it names when it IS under half, because a refusal names the
    // rule it is enforcing -- and that rule is not 3.2.4 here.
    const s2 = A.create('resistance', 'Flex2', 3000);
    const sg = A.addGroup(s2, 'G');
    const bomb = A.addSquad(s2, sg.id, 'remote-bomb-bus', 1);
    const under = A.assignTransport(s2, bomb.id, 'leviathan-heavy-hovercraft');
    ok(/Flexible Capacity/.test(under.warn || ''),
       'under half, the Leviathan names Flexible Capacity, not "taken full"', under.warn);
    ok(hasErr(A.validate(s2), 'Flexible Capacity'),
       'and validate says the same thing about the same Transport');
    await DZC.loadFaction('ucm');
  }

  // Nothing you can press builds an illegal share, so validate is for a link.
  const [e, g5] = mk();
  const l5 = A.addSquad(e, g5.id, 'legionnaires', 3);
  A.assignTransport(e, l5.id, 'raven-light-troopship');
  const rv = A.findSquad(e, l5.carriedBy);
  const h5 = A.addSquad(e, g5.id, 'hazard-suits', 1);
  h5.carriedBy = rv.id;                      // exactly what a share link can do
  ok(hasErr(A.validate(e), 'share ONE Transport'),
     'an illegal share arriving from elsewhere is reported (3.2.4.1)');

  A.load().slice().forEach(x => A.remove(x.id));
  store.clear();
}

/* SHALTARI GATES, Gate, Shaltari Unit Special Rules.
 *
 * Jet, 2026-08-08, after demoing them: "what if Gates were their own category
 * since they aren't directly attached to groups and don't count towards the
 * group limit? ... I had them in specific groups in the builder but they're
 * more dynamic/fluid in gameplay."
 *
 * Three sentences of the rule say so outright, and the builder was breaking
 * all three. The trap is "Aux Gate", which contains the word and is a
 * different unit: a Firedrake, a Tegu and an Adamah are Auxiliary Transports
 * "taken as non-Gate Squads", so they DO join a Group and DO count. */
console.log('\nShaltari Gates are not part of the Group structure');
{
  store.clear();
  A.load();
  await DZC.loadFaction('shaltari');
  const f = DZC.faction('shaltari');

  const gates = f.units.filter(u => A.isGate(u)).map(u => u.name);
  eq(String(gates.length), '5', 'five Units print the Gate rule', gates.join(', '));
  const aux = f.units.filter(u => /Aux Gate/.test(u.special || ''));
  eq(String(aux.filter(u => A.isGate(u)).length), '0',
     'and an Aux Gate is not one of them — Firedrake, Tegu, Adamah are ordinary Squads',
     aux.map(u => u.name).join(', '));

  const a = A.create('shaltari', 'Gates', 2000);
  const g = A.addGroup(a, 'Fighting');
  const braves = A.addSquad(a, g.id, 'brave-warsuits', 2);

  // "Gates are always Transports but are not taken with any Units aboard."
  eq(String(A.transportOptions(a, braves.id).filter(o => A.isGate(o.unit)).length), '0',
     'a Gate is never offered as a Squad’s Transport');

  // "A Gate is never part of another Group." Both directions.
  ok(!A.canAddUnit(a, g.id, 'spirit-light-gate').ok,
     'a Gate may not join a Group that has Squads in it');
  const g2 = A.addGroup(a, 'Gates');
  A.addSquad(a, g2.id, 'spirit-light-gate', 1);
  A.addSquad(a, g2.id, 'eden-medium-gate', 1);
  ok(!A.canAddUnit(a, g2.id, 'brave-warsuits').ok,
     'and a Squad may not join a Group of Gates');

  // "Gates do not count against your number of allowed Groups."
  eq(String(a.groups.length), '2', 'the army has two Groups on the card');
  eq(String(A.groupsUsed(a)), '1', 'but only the fighting one spends the allowance');

  // The error that used to print on every correctly built Shaltari list.
  const v = A.validate(a);
  ok(!hasErr(v, 'carries nothing'), 'an empty Gate is correct, not an error');
  /* Nor the warning that came after it. A Group of Gates IS every Gate in the
   * army, not a Group that failed to get a fighting Squad, and its own rule
   * gives it an activation: "any number of them which have not yet been
   * activated that Round may be activated together with any non-Gate Group."
   * The 4.2.2 line was permanent on every Shaltari list that took one. */
  ok(!v.warnings.some(w => /only Transports/.test(w.msg)),
     'and a Group of Gates is not warned about as Transport-only');
  // The Holding line went with the Reserved one it stood in for (2026-08-13):
  // both restated deployment rather than naming a fault in the list.
  ok(!v.warnings.some(w => /Holding|begin Reserved/.test(w.msg)),
     'and neither deployment line is printed at a Shaltari list');

  /* THERE IS A WAY IN. Reported from a phone, 2026-08-15: "I'm not able to add
   * transports for shaltari".
   *
   * Every Shaltari Transport is a Gate, canAddUnit refuses a Gate into a Group
   * with anything in it, and every Group you are looking at has something in
   * it -- so Add Transports counted zero everywhere and disabled itself. The
   * refusal is right; what was missing is where the Gate goes instead. */
  const home = A.gateHome(a, false);
  ok(!!home && home.id === g2.id, 'gateHome finds the Group the Gates are in');
  ok(A.canAddUnit(a, home.id, 'gaia-heavy-gate').ok,
     'and a Gate may be added THERE while it is refused beside the Braves');

  {
    const fresh = A.create('shaltari', 'No Gates yet', 2000);
    const only = A.addGroup(fresh);
    A.addSquad(fresh, only.id, 'brave-warsuits', 2);
    const made = A.gateHome(fresh, true);
    ok(!!made && made.id !== only.id, 'with no Gates Group yet, one is made');
    ok(A.addSquad(fresh, made.id, 'spirit-light-gate', 1) !== null,
       'and the Gate goes into it');
    eq(String(A.groupsUsed(fresh)), '1', 'the new Group spends none of the allowance');
    eq(A.groupName(fresh, made), 'Gates', 'and it is called Gates, not Group 2');
    ok(A.gateHome(fresh, false).id === made.id,
       'a second Gate finds the same home rather than making another');
  }

  /* Reachable only from a link or a backup. CanAddUnit refuses to build it,
   * which is why the Squad is pushed straight onto the Group here rather than
   * added. That refusal is itself the point: nothing you can press makes one. */
  const g3 = A.addGroup(a, 'Smuggled');
  const gate = A.addSquad(a, g3.id, 'gaia-heavy-gate', 1);
  ok(A.addSquad(a, g3.id, 'brave-warsuits', 2) === null,
     'addSquad will not put a Squad in a Group of Gates at all');
  const rider = { id: 'smuggled', unitId: 'brave-warsuits',
    models: [{ variant: null }, { variant: null }], carriedBy: gate.id, commander: null };
  g3.squads.push(rider);
  const v2 = A.validate(a);
  ok(hasErr(v2, 'never part of another Group'), 'a Gate sharing a Group is reported');
  ok(hasErr(v2, 'not taken with any Units aboard'), 'and so is a Squad put inside one');

  A.load().slice().forEach(x => A.remove(x.id));
  store.clear();
}

/* SUBTERRANEAN (Resistance Unit Special Rules) — the Gate rule in a Resistance
 * coat, and unenforced until 2026-08-15.
 *
 *   "Unarmed Subterranean Units do not count against your number of allowed
 *    Groups. Subterranean Units with a Transport Symbol are not taken with any
 *    Units aboard."
 *
 * The two Splitting Drills are the only Units that print it. Both are unarmed,
 * both are Auxiliary Transports, and both spent a Group they do not cost and
 * accepted cargo they may not be taken with. Neither card prints the bare word
 * — they print "Subterranean Small" and "Subterranean Medium" — which is why
 * an exact-token test the way Gate does it would have matched neither.
 */
console.log('\nunarmed Subterranean Units cost no Group and carry nothing on the list');
{
  store.clear();
  A.load();
  await DZC.loadFaction('resistance');
  const drills = DZC.faction('resistance').units.filter(u => A.isSubterranean(u));
  eq(String(drills.length), '2', 'two Units print Subterranean', drills.map(u => u.name).join(', '));
  ok(drills.every(u => !(u.weapons || []).length), 'and both of them are unarmed');
  ok(!A.isSubterranean(DZC.unit('resistance', 'kraken-hovercraft')),
     'an ordinary Resistance Transport is not one of them');

  const a = A.create('resistance', 'Drills', 2000);
  const dg = A.addGroup(a);
  const drill = A.addSquad(a, dg.id, '209-splitting-drill', 1);
  ok(!!drill, 'a Splitting Drill is an ordinary Squad you may take');
  eq(String(A.groupsUsed(a)), '0', 'and its Group spends none of the allowance');
  const fg = A.addGroup(a);
  A.addSquad(a, fg.id, 'resistance-fighters', 2);
  eq(String(A.groupsUsed(a)), '1', 'only the fighting Group is counted');

  // "...not taken with any Units aboard." Refused, and it names its own rule.
  const rider = A.addSquad(a, dg.id, 'atvs', 2);
  ok(!A.boardOptions(a, rider.id).length, 'the chooser never offers a Splitting Drill');
  const no = A.boardTransport(a, rider.id, drill.id);
  ok(!no.ok, 'and boarding one is refused');
  ok(/Subterranean/.test(no.reason || ''),
     'naming Subterranean rather than blaming capacity', no.reason);

  // Reachable only from a link or a backup made before this was enforced.
  rider.carriedBy = drill.id;
  ok(hasErr(A.validate(a), 'not taken with any Units aboard'),
     'a Squad smuggled aboard one is reported');

  A.load().slice().forEach(x => A.remove(x.id));
  store.clear();
  await DZC.loadFaction('ucm');
}

/* A Commander's points do not count toward the quarter-of-your-points cap.
 *
 * 3.2.5: "The Commander's points combine with that Unit's points during games
 * but are ignored during Army composition besides counting towards your total
 * allowed points."
 *
 * Two halves. categorySpend already left Commanders out, which is the
 * Standard/Vanguard/Heavy/Support half. The per-Group cap is an Army
 * composition rule too (3.2) and was being checked against the full Group
 * cost, so 430pts of tanks plus a Level 6 Commander read 580 against a 500 cap
 * and a legal list was refused. */
console.log('\na Commander is ignored by the quarter cap (3.2.5)');
{
  await DZC.loadFaction('ucm');
  const a = A.create('ucm', 'Cap', 2000);            // a quarter of 2000 is 500
  const g = A.addGroup(a);
  const s = A.addSquad(a, g.id, 'ucm-main-battle-tank', 6);
  A.addSquad(a, g.id, 'ucm-heavy-tank', 4);
  eq(A.groupCompositionCost(a, g), 430, 'the units come to 430');

  ok(A.setCommander(a, s.id, 6).ok, 'a Level 6 Commander goes on one of them');
  eq(A.groupCost(a, g), 580, 'the Group really costs 580 with the Commander');
  eq(A.groupCompositionCost(a, g), 430, 'but composition still sees 430');
  ok(!A.validate(a).errors.some(e => /quarter/.test(e.msg)),
     'so 430 under a 500 cap is legal',
     JSON.stringify(A.validate(a).errors.map(e => e.msg)));

  // The Commander's points DO count toward the army total. 3.2.5 says the cap
  // is the one composition rule they are not ignored by.
  eq(A.armyCost(a), 580, 'and the 150 still counts toward the total allowed points');

  // And the cap still bites when the UNITS alone bust it.
  A.addSquad(a, g.id, 'ucm-heavy-tank', 3);
  const over = A.validate(a).errors.find(e => /quarter/.test(e.msg));
  ok(!!over, 'units alone over the cap are still refused');
  ok(/595pts/.test(over ? over.msg : ''),
     'and the refusal quotes the composition figure, not the Commander-inflated one',
     over && over.msg);
  A.remove(a.id);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
