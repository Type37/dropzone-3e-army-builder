/* Tests for js/dzc-data.js, run against the REAL scanned data.
 *
 * This module decides whether an army is legal, so it is tested directly
 * rather than only through the UI. It runs the real file in a stubbed browser
 * with fetch wired to the filesystem, and asserts against the actual units --
 * a fixture would happily keep passing after the scanner changed shape.
 *
 *   node scripts/test-dzc-data.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = readFileSync(path.join(ROOT, 'js', 'dzc-data.js'), 'utf8');

const win = {};
const sandbox = {
  window: win,
  console,
  fetch: async (p) => {
    const file = path.join(ROOT, p);
    try {
      const body = readFileSync(file, 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(body) };
    } catch {
      return { ok: false, status: 404, json: async () => null };
    }
  }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(SRC, sandbox);
const DZC = win.DZC;

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; }
  else { fail++; console.error(`  FAIL  ${label}${extra ? `\n        ${extra}` : ''}`); }
}
function eq(a, b, label) { ok(a === b, label, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

await DZC.loadIndex();
const ucm = await DZC.loadFaction('ucm');
const scourge = await DZC.loadFaction('scourge');
const shaltari = await DZC.loadFaction('shaltari');
const resistance = await DZC.loadFaction('resistance');

// ---------------------------------------------------------------- index rules
console.log('\nindex / army limits');
eq(DZC.gameSizeFor(750).id, 'skirmish', 'gameSizeFor(750) is Skirmish');
eq(DZC.gameSizeFor(1500).id, 'clash', 'gameSizeFor(1500) is Clash');
eq(DZC.gameSizeFor(2500).id, 'battle', 'gameSizeFor(2500) is Battle');
eq(DZC.gameSizeFor(5000).id, 'reconquest', 'gameSizeFor(5000) is Reconquest (open-ended max)');
eq(DZC.gameSizeFor(400), null, 'below 501 is not a legal game size');

eq(DZC.maxGroups(DZC.gameSizeFor(1500), 1500), 12, 'Clash allows 12 Groups');
// 20 base, +4 for each full 1000 over 3000
eq(DZC.maxGroups(DZC.gameSizeFor(3500), 3500), 20, 'Reconquest 3500 is still 20 Groups');
eq(DZC.maxGroups(DZC.gameSizeFor(4000), 4000), 24, 'Reconquest 4000 adds 4 Groups');
eq(DZC.maxGroups(DZC.gameSizeFor(5000), 5000), 28, 'Reconquest 5000 adds 8 Groups');

// The cap is a quarter of the AGREED limit, not the top of the band.
eq(DZC.maxGroupCost(1500), 375, 'group cap is a quarter of the agreed 1500');
eq(DZC.maxGroupCost(2000), 500, 'group cap tracks the agreed number, not the band');

eq(DZC.rareLimit('skirmish'), 1, 'Rare limit 1 at Skirmish');
eq(DZC.rareLimit('clash'), 2, 'Rare limit 2 at Clash');
eq(DZC.rareLimit('battle'), 3, 'Rare limit 3 at Battle');
eq(DZC.commanderLevels('skirmish').length, 2, 'Skirmish allows only L4 and L5');
eq(DZC.commanderLevels('battle').length, 4, 'Battle allows all four Commander levels');
eq(DZC.commanderLevels('clash').some(l => l.level === 7), false, 'L7 is not allowed at Clash');

// ------------------------------------------------------------------- glossary
console.log('\nglossary');
ok(DZC.rule('Surveyor', 'ucm'), 'plain rule resolves');
ok(/Aegis/i.test((DZC.rule('Aegis 6”', 'ucm') || {}).name || ''), 'parameterised: Aegis 6 -> Aegis X');
ok(DZC.rule('Ev1', 'bioficer'), 'card closes up the space: Ev1 -> Ev X');
ok(DZC.rule('L1', 'phr'), 'attached placeholder: L1 -> LX');
ok(DZC.rule('AWACS 12” (Lynx)', 'ucm'), 'variant bracket is stripped before lookup');
ok(DZC.rule('Devastor 2', 'ucm'), 'known card typo still resolves');
ok(DZC.rule('Gate', 'shaltari'), 'faction rule resolves for its own faction');
eq(DZC.rule('Nanomachines', 'phr').faction, 'phr', 'faction rule is attributed to its faction');
ok(!DZC.rule('DefinitelyNotARule', 'ucm'), 'an unknown keyword resolves to nothing');

console.log('\nsplitSpecial');
const sp = DZC.splitSpecial('Battery 2, Blast, Concussion, Indirect, Pen 6+', 'ucm');
eq(sp.length, 5, 'a plain comma list splits into five keywords');
// The merge must never swallow a rule that stands on its own.
const sp2 = DZC.splitSpecial('Ineffective: Zones, Dogs, Lethal', 'ucm');
ok(sp2.indexOf('Dogs') !== -1, 'Dogs survives beside an open-ended wildcard', JSON.stringify(sp2));
ok(sp2.indexOf('Lethal') !== -1, 'Lethal survives too', JSON.stringify(sp2));

// ------------------------------------------------------------------ transport
console.log('\ntransport nesting');
const condor = ucm.byId['condor-dropship'];
const bear = ucm.byId['bear-apc'];
const legion = ucm.byId['legionnaires'];
ok(condor && bear && legion, 'the rulebook example units are present');

eq(DZC.capacityFor(condor, 'triangle'), 6, 'Condor offers 6 triangle capacity');
eq(DZC.fillsOf(bear)[0].shape, 'triangle', 'Bear APC fills triangle capacity');
eq(DZC.fillsOf(bear)[0].n, 3, 'a Bear APC takes 3');
ok(DZC.canCarry(condor, bear), 'a Condor can carry a Bear APC');
ok(DZC.canCarry(bear, legion), 'a Bear APC can carry Legionnaires');
ok(!DZC.canCarry(bear, condor), 'a Bear APC cannot carry a Condor');

// Rulebook 3.2.4.2: a Condor carries 2 Bear APCs (3 each into 6).
ok(DZC.loadCheck(condor, [{ unit: bear, count: 2 }]).ok, 'Condor carries 2 Bear APCs');
ok(DZC.isFull(condor, [{ unit: bear, count: 2 }]), '2 Bear APCs fill a Condor exactly');
ok(!DZC.loadCheck(condor, [{ unit: bear, count: 3 }]).ok, '3 Bear APCs overfill a Condor');
ok(!DZC.isFull(condor, [{ unit: bear, count: 1 }]), '1 Bear APC leaves a Condor short');
eq(DZC.loadCheck(bear, [{ unit: legion, count: 3 }]).ok, true, 'a Bear APC carries 3 Legionnaires');

// The inverted triangle is a DIFFERENT symbol. This is the bug that let a
// Condor load a K9 Pack, so it is pinned here.
console.log('\ninverted triangle is not a triangle');
const k9pack = resistance.byId['k9-pack'];
const k9tech = resistance.byId['k9-technical'];
const harbinger = scourge.byId['harbinger-troopship'];
const skimmer = scourge.byId['scourge-light-skimmer'];
ok(k9pack && k9tech && harbinger && skimmer, 'the inverted-triangle units are present');
ok(DZC.canCarry(k9tech, k9pack), 'a K9 Technical carries a K9 Pack');
ok(!DZC.canCarry(condor, k9pack), 'a Condor CANNOT carry a K9 Pack');
ok(DZC.canCarry(harbinger, skimmer), 'a Harbinger carries a Scourge Light Skimmer');

// capacityMode: "/" is either-not-mixed, "+" is both at once.
console.log('\ncapacityMode');
eq(harbinger.transport.capacityMode, 'either', 'Harbinger is either/or');
const strikehawk = resistance.byId['strikehawk-tilt-rotor'];
eq(strikehawk.transport.capacityMode, 'both', 'Strikehawk carries both at once');
const tegu = shaltari.byId['tegu-gatestrider'];
eq(tegu.transport.capacityMode, 'either', 'Tegu is either/or');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
