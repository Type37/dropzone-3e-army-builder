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
vm.runInContext(readFileSync(path.join(ROOT, 'js', 'dzc-icons.js'), 'utf8'), sandbox);
const DZC = win.DZC, Icon = win.DZCIcon;

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

// The value the card printed has to reach the sentence the player reads --
// "within 6” of this Unit", never "within X” of this Unit".
console.log('\nruleText');
eq(DZC.ruleText('Surveyor', 'ucm'), DZC.rule('Surveyor', 'ucm').text,
   'a plain rule is its glossary text unchanged');
ok(/within 6” of this Unit/.test(DZC.ruleText('Aegis 6”', 'ucm')),
   'Aegis 6” substitutes the inches', DZC.ruleText('Aegis 6”', 'ucm'));
ok(/suffer -1 Ac/.test(DZC.ruleText('Ev1', 'bioficer')),
   'Ev1 substitutes with the space closed up', DZC.ruleText('Ev1', 'bioficer'));
ok(/only attack 1 times/.test(DZC.ruleText('L1', 'phr')),
   'a placeholder attached to the name still substitutes', DZC.ruleText('L1', 'phr'));
ok(/within 12” of this Unit/.test(DZC.ruleText('AWACS 12” (Lynx)', 'ucm')),
   'the variant bracket is stripped before the value is read',
   DZC.ruleText('AWACS 12” (Lynx)', 'ucm'));
// A word suffix substitutes exactly as a number does.
ok(/of the type Zones/.test(DZC.ruleText('Ineffective: Zones', 'ucm')),
   'a word suffix substitutes too', DZC.ruleText('Ineffective: Zones', 'ucm'));
// Two placeholders, filled from their own capture groups and not from each
// other -- Repair 1: Vehicles prints X=1 and Y=Vehicles.
const repair = DZC.ruleText('Repair 1: Vehicles', 'ucm');
ok(/only target Vehicles/.test(repair) && /regains 1 lost DP/.test(repair),
   'two placeholders fill from their own captures', repair);
eq(DZC.ruleText('DefinitelyNotARule', 'ucm'), null, 'an unknown keyword has no text');

// Cards write a hyphen where the rulebook heads a space. Reading it as part of
// the value gave "inflicts -1 additional DP" for a rule that adds one.
ok(/inflicts 1 additional DP/.test(DZC.ruleText('Critical-1', 'shaltari')),
   'a hyphen separator is not a minus sign', DZC.ruleText('Critical-1', 'shaltari'));
eq(DZC.ruleText('Alt-1', 'ucm'), DZC.ruleText('Alt 1', 'ucm'),
   'Alt-1 and Alt 1 are the same rule with the same value');
// The wildcard used to stop one character in because the separator after it
// was allowed to match nothing.
const repairD6 = DZC.ruleText('Repair D6: Medusa', 'scourge');
ok(/only target Medusa/.test(repairD6) && /regains D6 lost DP/.test(repairD6),
   'a die expression is not split across both captures', repairD6);
// Three values, and the first of them is two words.
const shield = DZC.ruleText('Shield: Friendly Vehicles 6” 4+', 'shaltari');
ok(/as defined by Friendly Vehicles within 6” of this Unit gain 4\+/.test(shield),
   'Shield keeps its three values apart', shield);
// "Pen 6+" resolved to PX+ -- P, then "en 6" as the value -- and showed
// Passive Countermeasures on every weapon that had Penetrator.
eq(DZC.rule('Pen 6+', 'ucm').id, 'pen-x', 'Pen 6+ is Penetrator, not PX+');
eq(DZC.rule('P5+', 'shaltari').id, 'px', 'P5+ is still PX+');

// Sweep every keyword the six factions actually print. A placeholder surviving
// into a tooltip is the bug this is here to catch, and it is only visible
// against the real cards.
{
  const factions = [ucm, scourge, shaltari, resistance,
                    await DZC.loadFaction('phr'), await DZC.loadFaction('bioficer')];
  let checked = 0;
  const leaked = [];
  for (const f of factions) {
    for (const u of f.units || []) {
      const lines = [u.special || ''].concat((u.weapons || []).map(w => w.special || ''));
      for (const line of lines) {
        for (const tok of DZC.splitSpecial(line, f.id)) {
          const text = DZC.ruleText(tok, f.id);
          if (text == null) continue;
          checked++;
          if (/\b[XYZ]\b/.test(text)) leaked.push(`${f.id}/${u.id}: ${tok}`);
        }
      }
    }
  }
  ok(checked > 500, 'the sweep saw the whole printed glossary', `checked ${checked}`);
  eq(leaked.length, 0, 'no printed keyword leaves a placeholder in its text');
  if (leaked.length) console.error('        ' + leaked.slice(0, 8).join('\n        '));
}

/* Gap 38: no dead chips. Every keyword a card prints must reach glossary text,
 * because a chip that opens nothing is worse than no chip -- it looks live.
 *
 * tools/dzc/audit_rules.py proves the same thing, but against its own Python
 * resolver. This is the one the app actually renders through, and two
 * implementations of the same rule drift. So it is asserted on both sides.
 *
 * The exceptions are not ours. The Totem Shieldspire's card prints its Shield
 * rule in two broken halves -- one with no "Shield:" prefix, one with no
 * radius or save -- and inventing the missing numbers would be writing rules
 * TTCombat did not print. They are named here so that a release which fixes
 * the card shows up as an entry that has stopped being needed. */
console.log('\nno dead chips (gap 38)');
{
  const KNOWN_CARD_DEFECTS = [
    'Friendly Vehicles and Aircraft 6” 5+',   // Shield, missing its prefix
    'Shield: Zones'                            // Shield, missing radius and save
  ];
  const factions = ['ucm', 'phr', 'scourge', 'shaltari', 'resistance', 'bioficer'];
  const dead = new Set();
  let seen = 0;
  for (const id of factions) {
    const f = await DZC.loadFaction(id);
    for (const u of f.units || []) {
      const lines = [u.special || ''].concat((u.weapons || []).map(w => w.special || ''));
      for (const line of lines) {
        for (const tok of DZC.splitSpecial(line, id)) {
          seen++;
          if (!DZC.rule(tok, id)) dead.add(tok);
        }
      }
    }
  }
  ok(seen > 1000, 'the sweep saw every keyword on every card', `saw ${seen}`);
  const unexpected = [...dead].filter(t => KNOWN_CARD_DEFECTS.indexOf(t) === -1);
  eq(unexpected.length, 0, 'every printed keyword resolves to a glossary entry');
  if (unexpected.length) console.error('        ' + unexpected.join('\n        '));
  // If the cards get fixed, this fails and the exception list gets shorter.
  const stale = KNOWN_CARD_DEFECTS.filter(t => !dead.has(t));
  eq(stale.length, 0, 'and no card defect is still excused after being fixed',
     stale.join(', '));
}

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

// ------------------------------------------------------------------ arc icons
console.log('\nfiring arcs are 90-degree wedges (6.1.2)');
{
  const wedges = a => (Icon.arc(a).match(/fill="currentColor"/g) || []).length;
  eq(wedges('F'), 1, 'F fills one wedge');
  eq(wedges('F/S'), 3, 'F/S fills front and both sides');
  eq(wedges('F/S/R'), 4, 'F/S/R fills all four');
  eq(wedges('F/Sl'), 2, 'F/Sl fills two');
  eq(wedges('R'), 1, 'R fills one');
  eq(Icon.arc('-'), '', 'a dash draws nothing');
  // The Side Left / Side Right split is the reason these are drawn at all:
  // "F/Sl" and "F/Sr" read identically as text and differently as pictures.
  ok(Icon.arc('F/Sl') !== Icon.arc('F/Sr'), 'F/Sl and F/Sr are different pictures');
  eq(Icon.arcLabel('F/Sr'), 'Front, Side Right', 'and the label names the arcs');

  // Every arc value that appears on a real card must render.
  const seen = new Set();
  for (const fid of ['ucm', 'phr', 'scourge', 'shaltari', 'resistance', 'bioficer']) {
    const f = await DZC.loadFaction(fid);
    f.units.forEach(u => (u.weapons || []).forEach(w => { if (w.arc) seen.add(w.arc.trim()); }));
  }
  const undrawn = [...seen].filter(a => a !== '-' && !Icon.arc(a));
  eq(undrawn.length, 0, 'every arc printed on a card has an icon', undrawn.join(', '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
