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
  location: { origin: 'https://example.test', pathname: '/dzc/' },
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
const tank = A.addSquad(army, g.id, 'ucm-main-battle-tank', 2);
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
ok(url.startsWith('https://example.test/dzc/#share/'), 'the link is a plain URL with the army in the hash');
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
const backTank = bg.squads.find(s => s.unitId === 'ucm-main-battle-tank');
eq(JSON.stringify(backTank.models.map(m => m.variant)), '["Sabre","Tachi"]',
   'a legally MIXED Squad keeps its per-model variants');
eq(bg.squads.filter(s => s.commander).length, 1, 'the Commander survives');
eq(bg.squads.find(s => s.commander).commander.level, 5, 'at the right level');
const backArch = back.groups[1].squads[0];
ok(A.hasUpgrade(backArch, '*', 'UM-115 Missile Spread'), 'the weapon upgrade survives');

console.log('\nids are not shipped');
ok(back.id !== army.id, 'the imported army gets a fresh id, so it cannot collide');
ok(bg.squads.every(s => army.groups[0].squads.every(o => o.id !== s.id)),
   'and so does every Squad');

console.log('\nbad input fails cleanly');
let threw = null;
try { S.unpack({ v: 999 }); } catch (e) { threw = e; }
ok(threw && /version/i.test(threw.message), 'an unknown payload version is rejected by name');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
