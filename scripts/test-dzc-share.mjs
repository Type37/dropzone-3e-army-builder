/* Round-trip tests for js/dzc-share.js.
 *
 * A share link is the one artefact that leaves this machine, so what matters is
 * that what comes back is the SAME ARMY. Same cost, same nesting, same mixed
 * variants. Costing it on both sides is the check that actually proves it,
 * because a dropped variant or a broken carriedBy shows up in the number.
 *
 *   node scripts/test-dzc-share.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const store = new Map();
const win = {};
const sandbox = {
  window: win, console, TextEncoder, TextDecoder, Response,
  CompressionStream, DecompressionStream, btoa, atob,
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  },
  location: { origin: 'https://example.test', pathname: '/dzc/', href: 'https://example.test/dzc/?x=1#armies' },
  fetch: async p => {
    try {
      return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8')) };
    } catch { return { ok: false, status: 404, json: async () => null }; }
  }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['js/dzc-data.js', 'js/dzc-army.js', 'js/dzc-share.js']) {
  vm.runInContext(readFileSync(path.join(ROOT, f), 'utf8'), sandbox);
}
const DZC = win.DZC, A = win.DZCArmy, S = win.DZCShare;

let pass = 0, fail = 0;
const ok = (c, label, extra) => c ? pass++ : (fail++, console.error(`  FAIL  ${label}${extra ? `\n        ${extra}` : ''}`));
const eq = (a, b, label) => ok(a === b, label, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

await DZC.loadIndex();
await DZC.loadFaction('ucm');
A.load();

// An army exercising everything the payload has to survive: nesting, a
// Commander, an upgrade, and a Squad with legally MIXED variants (3.2.2).
const army = A.create('ucm', 'Round Trip', 1500);
const g = A.addGroup(army, 'Spearhead');
const legion = A.addSquad(army, g.id, 'legionnaires', 3);
A.assignTransport(army, legion.id, 'bear-apc');
A.setCommander(army, legion.id, 5);
// Its own Group: a Group is one Squad and its Transports (3.2.4), so the tank
// cannot ride along beside the Legionnaires and their Bear APC.
const gTank = A.addGroup(army, 'Armour');
const tank = A.addSquad(army, gTank.id, 'ucm-main-battle-tank', 2);
A.setModelVariant(army, tank.id, 1, 'Tachi');
const g2 = A.addGroup(army, 'Air');
const arch = A.addSquad(army, g2.id, 'archangel', 1);
A.toggleUpgrade(army, arch.id, '*', 'UM-115 Missile Spread');

const before = A.armyCost(army);
const url = await S.link(army);
const payload = url.split('#share/')[1];
const back = S.unpack(JSON.parse(await S.inflate(payload)));
A.all().unshift(back);          // so costing can resolve it

console.log('\nround trip');
ok(url.startsWith('https://example.test/dzc/#share/'),
   'the link is a plain URL with the army in the hash', url.slice(0, 60));
ok(url.indexOf('?') === -1, 'any existing query string is dropped');
ok(url.split('#').length === 2, 'and there is exactly one hash');
ok(url.length < 2000, `and it fits in a URL (${url.length} chars)`);
eq(A.armyCost(back), before, 'the imported army costs exactly the same');
eq(back.faction, army.faction, 'faction survives');
eq(back.name, army.name, 'name survives');
eq(back.pointsLimit, army.pointsLimit, 'points limit survives');
eq(back.groups.length, army.groups.length, 'group count survives');

console.log('\nthe parts that are easy to lose');
const bg = back.groups[0];
const carried = bg.squads.filter(s => s.carriedBy);
eq(carried.length, 1, 'exactly one Squad is carried');
ok(bg.squads.some(s => s.id === carried[0].carriedBy),
   'and carriedBy points at a real Squad — the index was rebuilt into a new id');
// The tank has its own Group now, so look for it rather than assuming it
// rides along in the first one.
const backTank = back.groups.flatMap(g => g.squads).find(s => s.unitId === 'ucm-main-battle-tank');
eq(JSON.stringify(backTank.models.map(m => m.variant)), '["Sabre","Tachi"]',
   'a legally MIXED Squad keeps its per-model variants');
eq(bg.squads.filter(s => s.commander).length, 1, 'the Commander survives');
eq(bg.squads.find(s => s.commander).commander.level, 5, 'at the right level');
const backArch = back.groups.flatMap(g => g.squads).find(s => s.unitId === 'archangel');
ok(A.hasUpgrade(backArch, '*', 'UM-115 Missile Spread'), 'the weapon upgrade survives');

/* Names, and the difference between one you typed and one derived from a
 * position. Both were losing something across a link.
 *
 * A Group you never named has NO name. GroupName reads its position instead
 * (js/dzc-army.js) so that deleting one from the middle can never leave two
 * things called the same thing. unpack handed back the literal string "Group"
 * for those, which is that collision exactly, with no position in it either.
 *
 * A Commander's typed name was not shipped at all: only the level travelled,
 * so "Colonel Vance" arrived as "Level 5 Commander". Group names have always
 * travelled, and these are the same field on the other renameable thing. */
console.log('\nnames, typed and derived');
{
  const plain = A.create('ucm', 'Unnamed', 1500);
  const pg = A.addGroup(plain);
  const legion = A.addSquad(plain, pg.id, 'legionnaires', 3);
  A.addGroup(plain);
  const loose = A.addCommander(plain, 5);
  A.renameCommander(plain, loose.commander.id, 'Colonel Vance');
  const aboard = A.addCommander(plain, 4);
  A.assignCommander(plain, aboard.commander.id, legion.id);
  A.renameCommander(plain, aboard.commander.id, 'Major Iyer');

  const there = S.unpack(S.pack(plain));
  eq(there.groups[0].name, null, 'an unnamed Group comes back unnamed, not called "Group"');
  eq(A.groupName(there, there.groups[1]), 'Group 2',
     'so its name is still read from its position, and two of them are not the same');
  const names = A.commanders(there).map(c => A.commanderName(there, c)).sort();
  eq(JSON.stringify(names), '["Colonel Vance","Major Iyer"]',
     'a Commander you named keeps it, aboard a Squad or not');
  eq(A.commanders(there).find(c => c.name === 'Major Iyer').level, 4,
     'and still at the right level');
  A.remove(plain.id);
}

console.log('\nids are not shipped');
ok(back.id !== army.id, 'the imported army gets a fresh id, so it cannot collide');
ok(bg.squads.every(s => army.groups[0].squads.every(o => o.id !== s.id)),
   'and so does every Squad');

console.log('\nbad input fails cleanly');
let threw = null;
try { S.unpack({ v: 999 }); } catch (e) { threw = e; }
ok(threw && /version/i.test(threw.message), 'an unknown payload version is rejected by name');

/* ── plain text and JSON ──────────────────────────────────────────────
 *
 * Two more targets, and each has one thing that has to be true. The TEXT keeps
 * the nesting indented -- that tree is what every competitor's export throws
 * away -- and it is written in the convention DZCArmy.parseList reads, so it
 * comes back as an army rather than as a wall someone has to retype. The JSON
 * is the same file the backup writes, so a shared army arrives the way a
 * restored one does.
 */
console.log('\nwhat the army is for');
{
  A.setDescription(army, '  Tournament list, beats PHR walkers  ');
  eq(army.description, 'Tournament list, beats PHR walkers',
     'a description is stored as typed, trimmed at the ends');
  const there = S.unpack(S.pack(army));
  eq(there.description, army.description, 'and survives the share round trip');
  ok(S.text(army).includes(army.description), 'and is on the plain-text sheet');
  A.setDescription(army, '');
  ok(S.pack(army).d === undefined, 'an empty one is not shipped in the link at all');
  A.setDescription(army, 'Tournament list, beats PHR walkers');
}

console.log('\nplain text');
{
  const txt = S.text(army);
  ok(txt.includes(army.name), 'the army names itself');
  ok(/\[1500pts\]/.test(txt), 'and states the agreed limit');
  // The Transport is the PARENT: a Condor carries Bear APCs which carry
  // Legionnaires, and that tree is the deployment plan (HANDOFF section 3).
  ok(/^ {2}\d+ x Bear APC \[/m.test(txt), 'the Transport sits at the top of its Group');
  ok(/^ {4}\d+ x Legionnaires \[/m.test(txt), 'and what it carries is indented under it');
  ok(/^# Commanders$/m.test(txt), 'the Commander block is there');
  ok(/Level 5/.test(txt), 'with the level');
  ok(!/Level 5 Commander, Level 5/.test(txt), 'and it does not say the level twice');
  // Every line the parser has to ignore starts with "#", which is the rule
  // parseList already applies -- so nothing is skipped by accident.
  const entries = A.parseList(txt);
  ok(entries.length >= 4, 'our own parser reads the Unit lines back', `${entries.length}`);
  ok(entries.every(e => e.points > 0), 'each with a cost');
  const names = entries.map(e => e.name);
  ok(names.includes('Legionnaires') && names.includes('Bear APC'),
     'including the carried Transport', names.join(' | '));
  ok(!names.some(n => /^#/.test(n) || /Group|Commander/i.test(n)),
     'and no heading was read as a Unit', names.join(' | '));

  const r = A.importList(txt);
  ok(r.ok, 'and it imports', r.reason);
  eq(r.army.faction, 'ucm', 'onto the right faction');
  eq(r.unmatched.length, 0, 'with nothing unresolved', r.unmatched.join(' | '));
}

console.log('\nJSON');
{
  const one = S.json(army);
  const r = A.importArmies(one);
  ok(r.ok, 'a single army is a backup of one');
  eq(r.added.length, 1, 'and imports as one army');
  const copy = A.get(r.added[0].id);
  eq(A.armyCost(copy), A.armyCost(army), 'costing the same on the way back');
  eq(copy.groups.length, army.groups.length, 'with the same Groups');
  ok(copy.id !== army.id, 'and a fresh id');
}

/* Raw Materials across a link and a backup. RM is 5pts a token and the only
 * thing you can buy that leaves no trace in the models, the variants or the
 * upgrades. So a link that drops it hands your opponent an Ark that costs
 * 60pts less than the one you built and can Spawn nothing on turn one. */
console.log('\nraw materials survive the trip');
{
  await DZC.loadFaction('bioficer');
  const bio = A.create('bioficer', 'Genitors', 2000);
  const bg2 = A.addGroup(bio, 'Arks');
  const ark = A.addSquad(bio, bg2.id, 'grievance-genitor-ark', 1);
  const gyro = A.addSquad(bio, bg2.id, 'gyro-aero-genitor', 1);
  A.setRm(bio, ark.id, 12);
  A.setRm(bio, gyro.id, 3);
  const cost = A.armyCost(bio);

  const u2 = await S.link(bio);
  const back2 = S.unpack(JSON.parse(await S.inflate(u2.split('#share/')[1])));
  A.all().unshift(back2);
  const bArk = back2.groups.flatMap(g => g.squads).find(s => s.unitId === 'grievance-genitor-ark');
  const bGyro = back2.groups.flatMap(g => g.squads).find(s => s.unitId === 'gyro-aero-genitor');
  eq(A.rmOf(bArk), 12, 'a filled Genitor arrives with all 12 RM aboard');
  eq(A.rmOf(bGyro), 3, 'and a part-filled one with exactly what it had');
  eq(A.armyCost(back2), cost, 'so the shared army costs what the built one did');

  const r2 = A.importArmies(S.json(bio));
  const jArk = A.get(r2.added[0].id).groups.flatMap(g => g.squads)
    .find(s => s.unitId === 'grievance-genitor-ark');
  eq(A.rmOf(jArk), 12, 'and a JSON backup restores them too');

  ok(S.text(bio).includes('+ 12 RM'), 'the plain-text sheet names them on the Unit line');

  /* AND OUR OWN PARSER READS IT BACK. The first version wrote the RM past the
   * loadouts, where LIST_ENTRY anchors on $. So the line matched nothing and
   * re-importing an exported list dropped the whole Genitor, not just its
   * tokens. A round trip through our own format has to be lossless. */
  const txt2 = S.text(bio);
  const back3 = A.parseList(txt2);
  const arkLine = back3.find(e => /Genitor Ark/.test(e.name));
  ok(!!arkLine, 'a Genitor line still parses with RM on it', txt2);
  eq(arkLine && arkLine.rm, 12, 'and the count comes back off it');
  const imp = A.importList(txt2);
  const iArk = imp.ok && imp.army.groups.flatMap(g => g.squads)
    .find(s => s.unitId === 'grievance-genitor-ark');
  eq(iArk && A.rmOf(iArk), 12, 'so a pasted list arrives with its RM aboard');
  // A build that shipped for one afternoon wrote it after the loadouts.
  const oldStyle = A.parseList('1 x Grievance Genitor Ark [155pts]: Grievance 1 + 7 RM');
  eq(oldStyle[0] && oldStyle[0].rm, 7, 'and the shape that shipped by mistake still reads');
  eq(JSON.stringify(oldStyle[0] && oldStyle[0].loadouts), '["Grievance 1"]',
     'without leaving RM inside the loadout name');

  A.setRm(bio, ark.id, 0);
  ok(!/RM/.test(S.text(bio).split('\n').find(l => /Genitor Ark/.test(l)) || ''),
     'and says nothing at all about an empty Genitor');
}

/* Bought upgrades survive the plain-text sheet.
 *
 * They were in the points and nowhere else: an Archangel carrying a UM-115
 * Missile Spread exported as "1 x Archangel [50pts]", which is the 40pt
 * airframe plus a 10pt gun the reader is never told about. Somebody checking
 * your list off this sheet cannot see what the extra 10pts bought.
 *
 * They go on a "#" line rather than after the cost, for the same reason the RM
 * token above had to move: LIST_ENTRY anchors on $, so anything it does not
 * recognise makes the Unit line match NOTHING and the Squad disappears on the
 * way back in. Hence the second half of this block. */
console.log('\nbought upgrades survive the plain-text sheet');
{
  await DZC.loadFaction('ucm');
  const up = A.create('ucm', 'Upgrades', 1750);
  const ug = A.addGroup(up, 'Spearhead');
  A.addSquad(up, ug.id, 'ucm-main-battle-tank', 4);
  const ug2 = A.addGroup(up, 'Air');
  const arch = A.addSquad(up, ug2.id, 'archangel', 1);
  const t = A.toggleUpgrade(up, arch.id, '*', 'UM-115 Missile Spread');
  ok(t.ok, 'the upgrade is bought', t.reason);

  const txt3 = S.text(up);
  ok(/UM-115 Missile Spread/.test(txt3), 'the sheet names it', txt3);
  ok(/^\s*#\s*upgrade:/m.test(txt3), 'on its own # line', txt3);

  const back4 = A.parseList(txt3);
  eq(back4.length, 2, 'and both Squads still parse back out of the sheet');
  ok(back4.some(e => /Archangel/.test(e.name)),
     'including the upgraded one', back4.map(e => e.name).join(' | '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
