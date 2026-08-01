/* Round-trip tests for js/dzc-share.js.
 *
 * A share link is the one artefact that leaves this machine, so what matters is
 * that what comes back is the SAME ARMY — same cost, same nesting, same mixed
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
 * A Group you never named has NO name — groupName reads its position instead
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
