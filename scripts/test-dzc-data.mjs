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

/* The band EDGES and the Commander prices, against the book.
 *
 * data/dzc/index.json is the one file in the pipeline that is transcribed
 * rather than scanned — chapter 3's limits are prose tables, so there is
 * nothing to parse. That makes it the one file where a slip is a typing
 * mistake nobody would notice, and every number in it decides whether an
 * illegal army is refused.
 *
 * Read off A5_Dropzone_3.01_Rulebook_Compressed.pdf, pages 9 and 12, verbatim:
 *
 *   "Skirmish: 501–1000 points. 9 Groups Max.
 *    Clash: 1001–2000 points. 12 Groups Max.
 *    Battle: 2001–3000 points. 16 Groups Max.
 *    Reconquest: 3001 points and above. 20 Groups Max but add 4 Groups to the
 *    maximum allowed for every 1000pts above 3000."
 *
 *   Level 4 / 50 / All Game Sizes.  Level 5 / 90 / All Game Sizes.
 *   Level 6 / 150 / Clash, Battle, Reconquest.  Level 7 / 230 / Battle,
 *   Reconquest.
 *
 * The middle of a band is already asserted above; these are the edges, which
 * is where an off-by-one lives. */
eq(DZC.gameSizeFor(501).id, 'skirmish', '501 is the first legal points total');
eq(DZC.gameSizeFor(1000).id, 'skirmish', '1000 is still Skirmish');
eq(DZC.gameSizeFor(1001).id, 'clash', 'and 1001 is Clash');
eq(DZC.gameSizeFor(2000).id, 'clash', '2000 is still Clash');
eq(DZC.gameSizeFor(2001).id, 'battle', 'and 2001 is Battle');
eq(DZC.gameSizeFor(3000).id, 'battle', '3000 is still Battle');
eq(DZC.gameSizeFor(3001).id, 'reconquest', 'and 3001 is Reconquest');
eq(DZC.gameSizeFor(500), null, '500 is one under the minimum and is no game size at all');
eq(DZC.maxGroups(DZC.gameSizeFor(750), 750), 9, 'Skirmish allows 9 Groups');
eq(DZC.maxGroups(DZC.gameSizeFor(2500), 2500), 16, 'Battle allows 16');
eq(JSON.stringify(DZC.commanderLevels('reconquest').map(l => [l.level, l.points])),
   '[[4,50],[5,90],[6,150],[7,230]]', 'the whole Commander ladder is priced as the book prices it');

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
/* The rulebook heads it "Hardy X" and then reads "a save of X+", and every
 * card in the game prints "Hardy 2+", "3+" or "4+". Built from the heading as
 * printed, X ran to the end of the string and took the plus with it, so the
 * tooltip read "a save of 4++". Its siblings -- Pen X+, Destroyer X+, Demo
 * Charges X+ -- all end their capture before the plus, and scan_rulebook now
 * says Hardy does too. */
ok(/save of 4\+ against/.test(DZC.ruleText('Hardy 4+', 'bioficer')),
   'Hardy 4+ reads one plus, not two', DZC.ruleText('Hardy 4+', 'bioficer'));

// Sweep every keyword the six factions actually print. A placeholder surviving
// into a tooltip is the bug this is here to catch, and it is only visible
// against the real cards.
{
  const factions = [ucm, scourge, shaltari, resistance,
                    await DZC.loadFaction('phr'), await DZC.loadFaction('bioficer')];
  let checked = 0;
  const leaked = [];
  /* A capture one character too long does not leave a placeholder behind -- it
   * substitutes, and reads as nonsense. "Hardy 4+" took the plus into the
   * value and came out "a save of 4++", which the placeholder sweep was blind
   * to. A doubled operator beside a digit is the shape of that mistake. */
  const doubled = [];
  for (const f of factions) {
    for (const u of f.units || []) {
      const lines = [u.special || ''].concat((u.weapons || []).map(w => w.special || ''));
      for (const line of lines) {
        for (const tok of DZC.splitSpecial(line, f.id)) {
          const text = DZC.ruleText(tok, f.id);
          if (text == null) continue;
          checked++;
          if (/\b[XYZ]\b/.test(text)) leaked.push(`${f.id}/${u.id}: ${tok}`);
          if (/\d\+\+|\d””|\d""/.test(text)) doubled.push(`${f.id}/${u.id}: ${tok}`);
        }
      }
    }
  }
  ok(checked > 500, 'the sweep saw the whole printed glossary', `checked ${checked}`);
  eq(leaked.length, 0, 'no printed keyword leaves a placeholder in its text');
  if (leaked.length) console.error('        ' + leaked.slice(0, 8).join('\n        '));
  eq(doubled.length, 0, 'and none doubles the operator the value already carried');
  if (doubled.length) console.error('        ' + doubled.slice(0, 8).join('\n        '));
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
/* Gap 39: a rule cites the page it is printed on, so the book falls open at
 * the right place mid-game. Core rules only -- a faction rule is scanned from
 * that faction's own card PDF, where the rules block is always page 1, and
 * printing "p.1" would point at a different document. */
console.log('\npage numbers (gap 39)');
{
  const aegis = DZC.rule('Aegis 6\u201d', 'ucm');
  eq(aegis.page, 44, 'a core rule carries its rulebook page');
  eq(DZC.rule('Nanomachines', 'phr').page, null,
     'a faction rule carries none, because its page 1 is not the rulebook\'s');
  /* "Core" is no longer the same thing as "in the rulebook". The 39 Behemoth
   * rules are core — Macro and Huge Blast are how Behemoths work, not a
   * faction's trick — but they come out of the Behemoth supplement, and its
   * p.4 is a different book's p.4. Each rule says which document its page is
   * in, and the range check follows the document rather than assuming one. */
  const core = DZC.rules.core;
  eq(core.filter(r => !r.page).length, 0, 'every core rule has a page');
  eq(core.filter(r => !r.source).length, 0, 'and says which document it is in');
  const beh = core.filter(r => r.source === 'behemoths');
  ok(beh.length > 30, 'the Behemoth supplement is in there', `${beh.length} rules`);
  ok(Math.max(...beh.map(r => r.page)) <= 12,
     'and its rules are on its own first pages', String(Math.max(...beh.map(r => r.page))));
  const pages = core.filter(r => r.source === 'rulebook').map(r => r.page);
  ok(Math.min(...pages) >= 44 && Math.max(...pages) <= 50,
     'and every rulebook rule is in chapters 10-11 (pp.44-50)',
     `${Math.min(...pages)}-${Math.max(...pages)}`);
}

console.log('\nno dead chips (gap 38)');
{
  /* Kept in step with KNOWN_CARD_QUIRKS in tools/dzc/audit_rules.py. Both
   * lists exist because the CARD is wrong, not the parser, and each entry is a
   * decision someone made; anything not listed still fails. */
  const KNOWN_CARD_DEFECTS = [
    'Friendly Vehicles and Aircraft 6” 5+',   // Shield, missing its prefix
    'Shield: Zones',                          // Shield, missing radius and save
    'Macro Critical 1'                        // Death Mech, two keywords with no comma
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

/* Gap 30: one search, and it reaches further than the name.
 *
 * The picker, the unit reference and the collection all ran their own copy of
 * the filter. They are one function now, which is the only way a field worded
 * the same in three places behaves the same in three places. */
/* Gap 13: the picker prints what taking this Unit actually costs -- the
 * smallest legal Squad -- with the arithmetic under it. */
/* Gap 24's filters are only as good as the data shape behind them, and a
 * predicate that silently matches nothing looks exactly like a filter nobody
 * uses. Both of these guard a decision made in the picker. */
console.log('\nwhat the picker filters can actually find');
{
  const all = [];
  for (const id of ['ucm', 'phr', 'scourge', 'shaltari', 'resistance', 'bioficer']) {
    const f = await DZC.loadFaction(id);
    for (const u of f.units || []) if (u.selectable !== false) all.push(u);
  }
  ok(all.length > 150, 'the sweep saw the pickable units', `${all.length}`);

  // A paid weapon upgrade is a green name box with a cost (3.2.3). If the
  // scanner renames either field the Upgrades filter goes quietly dead.
  const upgradeable = all.filter(u =>
    (u.weapons || []).some(w => w.box === 'upgrade' && w.upgradePoints != null));
  ok(upgradeable.length > 0, 'paid weapon upgrades exist to filter for',
     `${upgradeable.length} units`);
  ok(upgradeable.length < all.length / 2,
     'and they are selective enough to be worth a filter', `${upgradeable.length}`);

  /* Not one Unique Unit is published. The picker therefore does not draw a
   * Unique chip -- it could never match. canAddUnit still enforces the rule
   * (3.2.1), so when TTCombat print one the enforcement is already there; this
   * assertion is what will tell you to put the chip back. */
  const unique = all.filter(u => u.unique);
  eq(unique.length, 0, 'no Unique Unit exists yet — if this fails, restore the Unique filter',
     unique.map(u => u.id).join(', '));
}

console.log('\nsquadPrice (gap 13)');
{
  // Dropfleet's own example shape: "70 pts" over "2x 35".
  const lbt = DZC.squadPrice(ucm.byId['ucm-light-battle-tank']);
  eq(lbt.n, 2, 'a Squad of Light Battle Tanks starts at two');
  eq(lbt.lo, 70, 'so it costs 70, not 35');
  eq(lbt.perLo, 35, 'and the breakdown is 2 x 35');

  // Priced per variant, so the floor and the ceiling really are different.
  const mbt = DZC.squadPrice(ucm.byId['ucm-main-battle-tank']);
  eq(mbt.lo, 70, 'two Sabres are 70');
  eq(mbt.hi, 80, 'two Tachi are 80');

  // A Transport has no squad size: its count follows its cargo, so there is no
  // minimum Squad and the per-model price is the honest number.
  const bear = DZC.squadPrice(ucm.byId['bear-apc']);
  eq(bear.n, 1, 'a Transport prices per model');
  eq(bear.lo, ucm.byId['bear-apc'].points, 'at its own points');

  eq(DZC.squadPrice(null), null, 'no unit, no price');

  // Nothing anywhere should come out below its own per-model price, which is
  // the shape of a multiply-by-zero bug.
  let bad = [];
  for (const u of ucm.units) {
    const p = DZC.squadPrice(u);
    if (p && p.lo < p.perLo) bad.push(u.id);
  }
  eq(bad.length, 0, 'no Squad costs less than one of its models', bad.join(', '));
}

console.log('\nsearch (gap 30)');
{
  const m = (id, q) => DZC.matches(ucm.byId[id], q, 'ucm');
  ok(m('legionnaires', 'legion'), 'the name still matches');
  ok(m('ucm-main-battle-tank', 'sabre'), 'a variant name matches');
  ok(m('legionnaires', 'standard'), 'the CATEGORY matches — it did not before');
  ok(m('legionnaires', 'infantry'), 'and the type');
  ok(!m('legionnaires', 'transport'), 'and it does not match a category it is not');

  // A weapon's Special line is where most of the interesting words live, and
  // none of the three copies were reading it.
  const alt = ucm.units.find(u => (u.weapons || []).some(w => /Alt/i.test(w.special || '')));
  ok(alt && DZC.matches(alt, 'alt', 'ucm'), 'a WEAPON rule matches', alt && alt.name);

  // The card prints "Ev1"; the player thinks "evasion". Resolved names and
  // aliases are indexed so both find it.
  const ev = ucm.units.find(u => /\bEv\s?\d/.test(u.special || ''));
  const evTok = ev && (ev.special.match(/\bEv\s?\d/) || [])[0];
  ok(!!evTok, 'a UCM unit printing Ev was found to test the alias against');
  if (evTok) {
    ok(DZC.matches(ev, evTok, 'ucm'), `the printed keyword matches (${evTok})`, ev.name);
    ok(DZC.matches(ev, 'evasion', 'ucm'), 'and so does its glossary alias', ev.name);
  }

  // Rule TEXT is deliberately NOT indexed: half the glossary mentions Units and
  // damage, so matching bodies makes every search return everything.
  eq(ucm.units.filter(u => DZC.matches(u, 'this weapon inflicts', 'ucm')).length, 0,
     'glossary prose is not indexed');
  eq(ucm.units.filter(u => DZC.matches(u, '', 'ucm')).length, ucm.units.length,
     'an empty query matches everything');
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

/* "You may take as many identical Transports as needed" (3.2.4), and Group 3
 * of the rulebook's worked examples is a single Squad filling SEVERAL
 * identical Transports. Both of these read one vehicle's capacity until
 * 2026-08-01, so six Legionnaires in two Bear APCs — a legal Group, and an
 * ordinary one — was reported as "Bear APC has 3 square capacity, needs 6"
 * with nothing you could do about it. Found by the random army generator,
 * which has to produce a legal army and so argues with every rule at once. */
ok(!DZC.loadCheck(bear, [{ unit: legion, count: 6 }]).ok, 'six Legionnaires do not fit ONE Bear APC');
ok(DZC.loadCheck(bear, [{ unit: legion, count: 6 }], 2).ok, 'but they fit two of them (3.2.4)');
ok(DZC.isFull(bear, [{ unit: legion, count: 6 }], 2), 'and fill both exactly');
ok(!DZC.isFull(bear, [{ unit: legion, count: 5 }], 2), 'five fills neither, so the Group is not legal');
ok(!DZC.loadCheck(bear, [{ unit: legion, count: 7 }], 2).ok, 'and seven overfills the pair');
ok(DZC.isFull(bear, [{ unit: legion, count: 3 }]), 'a count of one is still the default');

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

/* What a column MEANS, in the rulebook's words. Chapter 2 defines every one,
 * and the two that matter most are the ones you cannot work out from the
 * numbers around them: an Accuracy of "A" hits automatically and a Bravery of
 * "A" passes automatically (2.6.1, 2.7), and both are printed on real cards.
 *
 * The hover used to carry the label, which the cell already prints — a tooltip
 * saying what is written directly under it. */
console.log('\nwhat a stat means, not just what it is called');
ok(/^Bravery — /.test(DZC.statHelp('B')), 'a stat hover leads with the stat name', DZC.statHelp('B'));
ok(/a value of A passes automatically/.test(DZC.statHelp('B')),
   'and Bravery says what an A means', DZC.statHelp('B'));
ok(/a value of A hits automatically/.test(DZC.weaponColHelp('Ac')),
   'as does Accuracy', DZC.weaponColHelp('Ac'));
ok(/in place of an Armour value/.test(DZC.statHelp('DF')),
   'Defence says it stands in for Armour', DZC.statHelp('DF'));
eq(DZC.statHelp('Nonsense'), 'Nonsense', 'an unknown key falls back to itself, never to undefined');
eq(DZC.weaponColHelp('Special'), '', 'and a column with no definition gets no empty tooltip');

/* And the mode ENFORCED, not merely recorded. Until now the suite proved the
 * scanner read the "/" and the "+" correctly and never proved the builder did
 * anything with either. 3.2.4.2, verbatim:
 *
 *   "A Transport with two hollow Symbols separated by a /, e.g. [] / /\, may
 *    not carry a mix of those Symbol shapes (in this case, either all solid
 *    squares or all solid triangles). A Transport with two hollow Symbols
 *    separated by a +, e.g. [] + O, may carry both simultaneously."
 *
 * The Harbinger is 3 squares OR 4 inverted triangles; the Strikehawk is 4
 * squares AND 2 circles. Loading each with one of each shape is the only case
 * that tells them apart, and it is the case that decides whether an illegal
 * Group is buildable. */
{
  const warriors = scourge.byId.warriors;
  const skimmer2 = scourge.byId['scourge-light-skimmer'];
  ok(DZC.loadCheck(harbinger, [{ unit: warriors, count: 3 }], 1).ok,
     'a Harbinger takes three Warriors, filling its squares');
  ok(DZC.loadCheck(harbinger, [{ unit: skimmer2, count: 4 }], 1).ok,
     'or four Light Skimmers, filling its inverted triangles');
  const mixed = DZC.loadCheck(harbinger,
    [{ unit: warriors, count: 1 }, { unit: skimmer2, count: 1 }], 1);
  ok(!mixed.ok, 'but never one of each — a "/" Transport carries no mixture');
  ok(/not a mixture/.test(mixed.reason || ''), 'and it says so rather than just refusing',
     mixed.reason);

  const strike = resistance.byId['strikehawk-tilt-rotor'];
  const fighters = resistance.byId['resistance-fighters'];
  const sentry = resistance.byId['resistance-sentry-unit'];
  ok(DZC.loadCheck(strike, [{ unit: fighters, count: 4 }, { unit: sentry, count: 2 }], 1).ok,
     'a "+" Transport carries both shapes at once, filled to both numbers');
  ok(!DZC.loadCheck(strike, [{ unit: fighters, count: 5 }, { unit: sentry, count: 1 }], 1).ok,
     'and still refuses one over on either of them');

  /* The Strikehawk footnote, as arithmetic: "May replace transport capacity of
   * 2 with MM-3 Missile Boxes or MC-30 Heavy Gatlings". The scanner puts the
   * delta on the weapon so nothing at runtime parses English. */
  const gatlings = strike.weapons.find(w => w.name === 'MC-30 Heavy Gatlings');
  eq(JSON.stringify(gatlings.capacityDelta), '[{"shape":"circle","n":-2}]',
     'the scanner read the capacity footnote onto the weapon');
  const armed = DZC.carrierWithUpgrades(strike, w => w.name === 'MC-30 Heavy Gatlings');
  eq(DZC.capacityFor(armed, 'circle'), 0, 'buying it spends the circle capacity');
  eq(DZC.capacityFor(armed, 'square'), 4, 'and leaves the square capacity alone');
  ok(!DZC.loadCheck(armed, [{ unit: sentry, count: 1 }], 1).ok,
     'so the armed Strikehawk carries no Sentry Unit at all');
  ok(DZC.carrierWithUpgrades(strike, () => false) === strike,
     'an unarmed carrier is the unit itself, not a copy of it');
  ok(DZC.carrierWithUpgrades(fighters, () => true) === fighters,
     'and so is anything with no capacity to sell');
}

// ------------------------------------------------------------------ arc icons
console.log('\nfiring arcs are 90-degree wedges (6.1.2)');
{
  /* Counted off OPACITY, not off fill. Every wedge is drawn now — an unlit one
   * is what a lit one is read against — so "how many are filled" stopped being
   * a question about the fill attribute and became one about which are lit. */
  const wedges = a => (Icon.arc(a).match(/opacity="1"/g) || []).length;
  const drawn = a => (Icon.arc(a).match(/<path /g) || []).length;
  eq(wedges('F'), 1, 'F lights one wedge');
  eq(wedges('F/S'), 3, 'F/S lights front and both sides');
  eq(wedges('F/S/R'), 4, 'F/S/R lights all four');
  eq(wedges('F/Sl'), 2, 'F/Sl lights two');
  eq(wedges('R'), 1, 'R lights one');
  eq(drawn('F'), 4, 'and the other three are still drawn, or there is nothing to read it against');
  /* The wedges must not share an edge. They used to meet exactly on the
   * diagonal, so two lit ones fused into a single shape with no boundary and
   * "F/S" read as one 270-degree blob. Each is inset 3 degrees; the test is
   * that no two paths name the same point. */
  const corners = Icon.arc('F/S/R').match(/L([\d.]+) ([\d.]+)/g) || [];
  eq(corners.length, 4, 'each wedge starts at its own corner');
  eq(new Set(corners).size, 4, 'and no two wedges start at the same point — they do not touch');
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

/* Gap 41: a rule that sends you to another rule is tappable where it says so.
 * Overcharge ends "counts as a High Power weapon"; the chips on the card never
 * carried High Power, because the card never printed it, so the only route was
 * to know it existed and go looking. */
console.log('\nrules link to the rules they name');
{
  await DZC.loadFaction('shaltari');
  const link = (k, f) => DZC.linkKeywords(DZC.ruleText(k, f), f, (DZC.rule(k, f) || {}).name);

  const grav = link('Grav', 'shaltari');
  ok(/>Resilient</.test(grav), 'Grav links the Resilient it ignores', grav);
  ok(/>Large</.test(grav), 'and the Large it looks for', grav);

  /* "First Strike" is the ALIAS of "FS X", and without aliases in the pool the
   * longest-first sort matches the bare "Strike" inside it -- a different rule
   * entirely, about Disembarking. That is the "Pen 6+" failure again: a
   * shorter name eating part of a longer one and confidently showing the wrong
   * text. */
  const agile = link('Agile 2', 'shaltari');
  ok(/>First Strike</.test(agile), 'First Strike links whole', agile);
  ok(!/>Strike</.test(agile), 'and never as the bare "Strike" inside it', agile);

  // A definition that links to itself is a circle, and the popover is already
  // headed with the rule's own name.
  const scout = link('Scout', 'shaltari');
  ok(!/>Scout</.test(scout), 'a rule does not link to itself', scout);

  eq(DZC.linkKeywords('', 'ucm'), '', 'no text, no markup');
  eq(DZC.linkKeywords('a < b & c', 'ucm'), 'a &lt; b &amp; c',
     'and the text is escaped BEFORE anything is wrapped, so it cannot open a tag');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
