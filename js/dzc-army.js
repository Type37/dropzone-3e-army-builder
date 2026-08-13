/* DZC army model, costing and validation.
 *
 * Force construction is rulebook chapter 3. All the numbers live in
 * data/dzc/index.json with a section citation, so this file holds the SHAPE of
 * an army and the checks -- never the values.
 *
 * The shape is the thing Dropfleet could not express:
 *
 *   Army   -> Groups          a Group is the activation unit (4.2.1)
 *   Group  -> Squads          up to 4 Squads may share one Transport (3.2.4.1)
 *   Squad  -> Models          variants are chosen PER MODEL (3.2.2)
 *
 * Nesting is a parent link rather than a tree: a Squad names the Squad that
 * carries it. Condor -> 2x Bear APC -> 6x Legionnaires is two carriedBy hops,
 * and the rules put no limit on depth, so a tree of fixed height would be
 * wrong as well as awkward.
 */
(function () {
  'use strict';

  const STORE = 'dzc_armies';
  let armies = [];

  const uid = () => 'a' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  // ------------------------------------------------------------- persistence

  function load() {
    bindSync();
    try {
      armies = JSON.parse(localStorage.getItem(STORE) || '[]');
      if (!Array.isArray(armies)) armies = [];
    } catch (e) { armies = []; }
    // Dropfleet fleets that crossed over while the two apps shared a sync
    // document are evicted in fleet-sync.js, not here. This function does not
    // run until the armies view is first opened, and a sync can happen before
    // that; the eviction has to be in front of both.
    //
    // Armies saved before Commanders moved to the army carry them on their
    // Squads. Lift those into the store, then mirror the store back down, so
    // an old save and a new one look the same to everything downstream.
    armies.forEach(a => {
      if (!Array.isArray(a.commanders)) {
        a.commanders = [];
        (a.groups || []).forEach(g => (g.squads || []).forEach(s => {
          if (s.commander) a.commanders.push({ id: uid(), level: s.commander.level, squadId: s.id });
        }));
      }
      // Groups saved with a baked "Group 3" go back to tracking their position.
      // Only a name you actually chose survives, which is the whole point of
      // the change -- an old save should not keep a number that has since
      // stopped matching where the Group sits.
      (a.groups || []).forEach(g => {
        if (typeof g.name === 'string' && /^Group \d+$/.test(g.name.trim())) g.name = null;
      });
      syncCommanders(a);
    });
    return armies;
  }

  /* Point Fleet Sync at the ARMY list. Its merge is game-agnostic -- it moves an
   * opaque list of {id, updatedAt} records and never looks inside them -- but
   * the storage key was hardcoded to the Dropfleet list, so without this every
   * army save stamped and synced the wrong thing entirely. */
  function bindSync() {
    if (window.FleetSync && window.FleetSync.setStorageKey) {
      try { window.FleetSync.setStorageKey(STORE); } catch (e) { /* optional */ }
    }
  }

  function save() {
    bindSync();
    /* Stamp BEFORE writing. stampChanged mutates the armies it finds changed,
     * setting updatedAt on each, and that timestamp is the whole of how a merge
     * decides a conflict -- so it has to be in the JSON that goes to disk and
     * then to the cloud. It also has to be handed the list: called with nothing
     * it read an empty array, concluded every army had been deleted, and left
     * updatedAt untouched on all of them. Every Dropzone army therefore looked
     * equally undated to the merge, which is the state where a stale phone can
     * overwrite work done on a laptop. */
    let changed = false;
    try { changed = !!(window.FleetSync && FleetSync.stampChanged(armies)); }
    catch (e) { /* sync optional */ }
    try { localStorage.setItem(STORE, JSON.stringify(armies)); } catch (e) { /* quota */ }
    // Push it up. Debounced and rate limited inside Fleet Sync, and a no-op
    // when sync is off, so calling it on every real edit costs nothing.
    if (changed) { try { FleetSync.notifyChanged(); } catch (e) { /* optional */ } }
  }

  function all() { return armies; }
  function get(id) { return armies.find(a => a.id === id) || null; }

  function create(faction, name, pointsLimit, description) {
    const a = {
      id: uid(),
      name: name || 'New Army',
      /* What this list is FOR, in your words. Dropfleet has had it since the
       * beginning (new-fleet-desc, app.js:1456) and it earns its place once
       * you have five armies with names like "UCM Army 3": the tournament it
       * was built for, the opponent it is meant to beat, why the Sabres are
       * there. Empty by default and it shows nothing when empty. */
      description: typeof description === 'string' ? description.trim() : '',
      faction: faction,
      // The agreed limit is an INPUT, not the top of the band: the per-Group
      // cap is a quarter of the number the players agreed (3.2).
      pointsLimit: pointsLimit || 2000,
      groups: [],
      created: Date.now(),
      updatedAt: Date.now()
    };
    armies.unshift(a);
    save();
    return a;
  }

  /* Reading an army back in.
   *
   * There was an export and nothing to put it into. A backup you cannot
   * restore is not a backup, and localStorage is exactly the store a browser
   * is free to clear. So this is the other half of exportArmies, not a
   * convenience.
   *
   * Every id is reissued, and carriedBy and squadId are remapped through the
   * same map. Keeping the ids as they are would be the corrupt-but-renders
   * failure duplicateGroup already had to be taught about: import a backup you
   * still have the armies from and the new Squads ride the OLD Squads'
   * Transports. Reissuing also means importing twice adds twice rather than
   * silently overwriting. Nothing an import does may cost you an army.
   *
   * Nothing is validated against the rules on the way in. A saved army may be
   * mid-build or illegal, and refusing to restore it would be the app deciding
   * your backup is not worth having; validate() reports it afterwards exactly
   * as it does for one you built by hand. Only the SHAPE is checked, because a
   * thing without groups is not an army at all. */
  function readArmy(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { reason: 'not an army' };
    if (typeof raw.faction !== 'string' || !raw.faction) return { reason: 'no faction' };
    if (!Array.isArray(raw.groups)) return { reason: 'no Groups' };

    const map = {};                        // old squad id -> new squad id
    const army = {
      id: uid(),
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Imported Army',
      description: typeof raw.description === 'string' ? raw.description.trim() : '',
      faction: raw.faction,
      pointsLimit: Number(raw.pointsLimit) > 0 ? Math.round(Number(raw.pointsLimit)) : 2000,
      groups: [],
      created: Number(raw.created) || Date.now(),
      updatedAt: Date.now(),
      commanders: []
    };
    const unknown = [];
    (raw.groups || []).forEach(gr => {
      if (!gr || !Array.isArray(gr.squads)) return;
      const group = { id: uid(), name: typeof gr.name === 'string' ? gr.name : null, squads: [] };
      gr.squads.forEach(sq => {
        if (!sq || typeof sq.unitId !== 'string') return;
        const id = uid();
        if (sq.id) map[sq.id] = id;
        // A unit id the data no longer has is worth SAYING, not worth
        // refusing: a card can be renamed between releases and the rest of the
        // army is still yours. It is reported and left in place.
        if (window.DZC.faction(army.faction) && !window.DZC.unit(army.faction, sq.unitId)) {
          unknown.push(sq.unitId);
        }
        group.squads.push({
          id: id,
          unitId: sq.unitId,
          models: (Array.isArray(sq.models) ? sq.models : []).map(m => ({
            variant: m && typeof m.variant === 'string' ? m.variant : null
          })),
          carriedBy: sq.carriedBy || null,
          commander: sq.commander ? { id: null, level: Number(sq.commander.level) || 0 } : null,
          upgrades: sq.upgrades && typeof sq.upgrades === 'object' ? sq.upgrades : undefined,
          // Restored as saved, not clamped. A backup may be illegal and
          // validate reports it -- the same contract every other field here
          // has, and silently binning somebody's 12 RM would be worse.
          rm: Number(sq.rm) > 0 ? Math.floor(Number(sq.rm)) : undefined
        });
      });
      army.groups.push(group);
    });
    // Second pass, once every Squad has its new id.
    army.groups.forEach(g => g.squads.forEach(s => {
      s.carriedBy = s.carriedBy && map[s.carriedBy] ? map[s.carriedBy] : null;
    }));
    /* A backup taken before Commanders moved to the army carries them on their
     * Squads instead, and syncCommanders mirrors the store DOWN. So importing
     * one of those without lifting them first would wipe every Commander in
     * it. load() already does this for a save on disk; an import is the same
     * file arriving by a different door. */
    if (Array.isArray(raw.commanders)) {
      raw.commanders.forEach(c => {
        if (!c) return;
        army.commanders.push({
          id: uid(),
          name: typeof c.name === 'string' ? c.name : null,
          level: Number(c.level) || 0,
          squadId: c.squadId && map[c.squadId] ? map[c.squadId] : null
        });
      });
    } else {
      army.groups.forEach(g => g.squads.forEach(s => {
        if (s.commander) army.commanders.push({ id: uid(), name: null, level: s.commander.level, squadId: s.id });
      }));
    }
    syncCommanders(army);
    return { army: army, unknown: [...new Set(unknown)] };
  }

  function importArmies(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) {
      return { ok: false, reason: 'That is not a backup. It will not parse as JSON.', added: [], skipped: [] };
    }
    const list = Array.isArray(data) ? data : [data];
    const added = [], skipped = [];
    list.forEach((raw, i) => {
      const r = readArmy(raw);
      if (!r.army) { skipped.push({ at: i + 1, reason: r.reason }); return; }
      armies.unshift(r.army);
      added.push({ id: r.army.id, name: r.army.name, unknown: r.unknown });
    });
    if (added.length) save();
    return { ok: added.length > 0, added: added, skipped: skipped };
  }

  /* A pasted army list, rather than a file this app wrote.
   *
   * The conventions are New Recruit's and they are not DZC-specific. "3 x
   * Legionnaires [45pts]", "##" section headers, bullets, a "[2000pts]" title,
   * and lists that arrive collapsed onto one line with commas where the
   * newlines were. All of that is read out of Dropfleet's own parser
   * (parseArmyListText / nrNormalize, git show 43773fa:js/app.js:6887) rather
   * than guessed at.
   *
   * What is NOT recovered is the Group nesting, and that is a real limit, not
   * an oversight. A Group here is a Transport and what it carries (3.2.4), and
   * a flat list does not say what rode in what. Every Squad therefore lands in
   * a Group of its own, and validate() will say so. Getting further needs a
   * real New Recruit DZC export to read, which nobody has pasted yet.
   *
   * Nothing is silently dropped: a line that resolves to no Unit comes back in
   * the report, because the one thing worse than a partial import is a partial
   * import that looked complete. */
  const LIST_SECTION = /^#{0,2}\s*(Standard|Vanguard|Heavy|Support|Transport|Commander|Configuration|Reference)s?\b/i;
  /* "+ 12 RM" after the cost, and it is not decoration in this regex.
   *
   * DZCShare.text writes the RM aboard a Genitor onto its line, and the first
   * version of that put it at the very end -- after the loadouts -- where this
   * pattern anchors on $. The line then matched NOTHING, so importing a list
   * this app had just exported dropped the whole Squad rather than dropping
   * the tokens. A round trip through our own format has to be lossless, and
   * the failure mode of getting it wrong is silent.
   *
   * So it has its own capture, between the cost and the loadouts, and the
   * writer puts it there. A line without it matches exactly as before. */
  const LIST_ENTRY = /^(?:[•\-*]\s*)?(?:(\d+)\s*[x×]\s*)?(.+?)\s*\[\s*(\d+)\s*pts?\s*\](?:\s*\+\s*(\d+)\s*RM\b)?\s*(?::\s*(.*))?$/i;

  /* New Recruit shares a list collapsed onto one line often enough that
   * Dropfleet grew this; the same normalisation puts the breaks back. A no-op
   * on a normal multi-line paste. */
  function listNormalize(text) {
    if (text.split(/\n/).length > 6) return text;
    return text
      .replace(/\s*[•]\s*(\d+\s*[x×])/g, '\n• $1')
      .replace(/,\s*(?=(?:\d+\s*[x×]\s*)?[A-Z][A-Za-z0-9'’.\- ]+?\s*\[\s*\d+\s*pts)/g, '\n');
  }

  /* Tolerant of plural, case and the variant standing in for its Unit: a list
   * may well name the Sabre rather than the UCM Main Battle Tank it is. */
  function findByName(factionId, name) {
    const f = window.DZC.faction(factionId);
    if (!f) return null;
    const lc = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!lc) return null;
    const pick = list => list.find(Boolean) || null;
    const units = (f.units || []).filter(u => u.selectable !== false);
    const exact = units.find(u => {
      const n = (u.name || '').toLowerCase();
      return n === lc || n === lc + 's' || lc === n + 's';
    });
    if (exact) return { unit: exact, variant: null };
    for (const u of units) {
      const v = (u.variants || []).find(x => (x.name || '').toLowerCase() === lc);
      if (v) return { unit: u, variant: v.name };
    }
    const fuzzy = pick(units.filter(u => {
      const n = (u.name || '').toLowerCase();
      return n.length > 3 && (n.indexOf(lc) === 0 || lc.indexOf(n) === 0);
    }));
    return fuzzy ? { unit: fuzzy, variant: null } : null;
  }

  function parseList(text) {
    const lines = listNormalize(String(text || '')).split(/\r?\n/);
    const entries = [];
    lines.forEach(raw => {
      const line = raw.trim();
      // A "#" line is a heading, always. The title, a section, a Configuration
      // block. Dropfleet treats it the same way, and without it "## Test Force
      // [500pts]" reads as a Unit called Test Force that resolved to nothing.
      if (!line || /^[#+]/.test(line) || LIST_SECTION.test(line)) return;
      const m = line.match(LIST_ENTRY);
      if (!m) return;
      // A trailing "+ N RM" is also stripped off the loadouts, because one
      // build shipped writing it there and those exports are already out.
      const tail = String(m[5] || '');
      const late = tail.match(/\+\s*(\d+)\s*RM\b\s*$/i);
      entries.push({
        line: line,
        count: m[1] ? parseInt(m[1], 10) : 1,
        name: m[2].replace(/^#+\s*/, '').trim(),
        points: parseInt(m[3], 10),
        rm: parseInt(m[4], 10) || (late ? parseInt(late[1], 10) : 0),
        loadouts: (late ? tail.slice(0, late.index) : tail)
          .split(',').map(s => s.trim()).filter(Boolean)
      });
    });
    return entries;
  }

  const FACTION_IDS = ['ucm', 'phr', 'scourge', 'shaltari', 'resistance', 'bioficer'];

  /* Which faction's roster the names actually belong to. A header can say one
   * thing over a list of another faction's units; the units cannot lie. Only
   * factions already fetched can vote, so the caller loads them first. */
  function voteFaction(entries) {
    let best = null, bestN = 0;
    FACTION_IDS.forEach(key => {
      if (!window.DZC.faction(key)) return;
      const n = entries.filter(e => findByName(key, e.name)).length;
      if (n > bestN) { bestN = n; best = key; }
    });
    return best;
  }

  function importList(text) {
    const entries = parseList(text);
    if (!entries.length) {
      return { ok: false, reason: 'That does not read as an army list.', matched: [], unmatched: [] };
    }
    const faction = voteFaction(entries);
    if (!faction) {
      return { ok: false, reason: 'No unit in that list belongs to a faction this app knows.', matched: [], unmatched: [] };
    }
    const total = entries.reduce((n, e) => n + (e.points || 0), 0);
    const title = String(text || '').split(/\r?\n/).map(s => s.trim()).find(Boolean) || '';
    // The first [Npts] in the file is the list's own headline. Taking whichever
    // of it and the sum is larger keeps an over-budget import from arriving at
    // a limit it already breaks, without inventing a number of our own.
    const headline = parseInt((String(text).match(/\[\s*(\d+)\s*pts?\s*\]/i) || [])[1], 10) || 0;
    const army = {
      id: uid(),
      name: title.replace(/\[\s*\d+\s*pts?\s*\][\s\S]*$/i, '').replace(/^#+\s*/, '')
        .replace(/\+\+/g, '').replace(/[\s\-–]+$/, '').trim() || 'Imported list',
      faction: faction,
      pointsLimit: Math.max(headline, total) || 2000,
      groups: [], commanders: [], created: Date.now(), updatedAt: Date.now()
    };
    const matched = [], unmatched = [];
    entries.forEach(e => {
      const hit = findByName(faction, e.name);
      if (!hit) { unmatched.push(e.line); return; }
      const u = hit.unit;
      // A named variant wins; otherwise a loadout name may identify one.
      const named = hit.variant
        || (u.variants || []).map(v => v.name).find(v =>
          e.loadouts.some(l => l.toLowerCase() === v.toLowerCase()))
        || defaultVariant(u);
      const g = { id: uid(), name: null, squads: [] };
      g.squads.push({
        id: uid(), unitId: u.id,
        models: Array.from({ length: Math.max(1, e.count) }, () => ({ variant: named })),
        carriedBy: null, commander: null,
        // Only where the Unit can actually hold any. A pasted list is somebody
        // else's file and may say anything; validate reports what survives.
        rm: e.rm > 0 && window.DZC.capacityFor(u, 'square') > 0 && faction === 'bioficer'
          ? e.rm : undefined
      });
      army.groups.push(g);
      matched.push({ name: u.name, count: e.count });
    });
    if (!matched.length) {
      return { ok: false, reason: 'Nothing in that list matched a Unit.', matched: [], unmatched: unmatched };
    }
    armies.unshift(army);
    save();
    return { ok: true, army: army, matched: matched, unmatched: unmatched };
  }

  /* An army out of nothing, filled to the budget and legal when it stops.
   *
   * Not a gimmick. Three real jobs: it is the fastest way to see what a
   * faction can do at a points level you have never played, it is what makes
   * the app worth opening before you own anything, and, this is the reason it
   * is worth the code, it is an exhaustive exercise of the enforcement layer.
   * A generator that has to produce a legal army finds the rules that cannot
   * be satisfied, which is not something a hand-built fixture will ever do.
   *
   * The order it builds in is the order the rules bind:
   *
   *   1. A Commander, because an army without one is illegal (3.2.5), and
   *      their points come off the budget before anything is spent.
   *   2. Standard first, because Vanguard, Heavy and Support may EACH not
   *      exceed Standard (3.2). Spend on those before there is any Standard
   *      to pay for it and every later choice is fighting the ratio.
   *   3. A Transport only when the fit is EXACT, because a Transport must be
   *      taken full (3.2.4) and an inexact one is an error nothing later fixes.
   *
   * rand is injectable so a test can be deterministic; it defaults to
   * Math.random. */
  function generate(factionId, pointsLimit, rand) {
    const rnd = rand || Math.random;
    const f = window.DZC.faction(factionId);
    const size = window.DZC.gameSizeFor(pointsLimit);
    if (!f || !size) return { ok: false, reason: 'That faction or points limit is not one this app can build for.' };

    const a = create(factionId, 'Surprise me', pointsLimit);
    const maxG = window.DZC.maxGroups(size, pointsLimit);
    const cap = window.DZC.maxGroupCost(pointsLimit);
    const pick = list => list[Math.floor(rnd() * list.length)];

    // The best Commander the size allows that does not eat a quarter of the
    // list. A Level 7 in a 1000pt game is legal and is not an army.
    const levels = window.DZC.commanderLevels(size.id)
      .filter(l => levelCost(l.level) <= pointsLimit * 0.25);
    const lv = levels.length ? levels[levels.length - 1].level
      : window.DZC.commanderLevels(size.id)[0].level;
    addCommander(a, lv);

    const buildable = (f.units || []).filter(u =>
      u.selectable !== false && u.category !== 'Transport');
    const byCat = c => buildable.filter(u => u.category === c);

    /* Attempts, not Groups. A rejected Group -- over budget, over the ceiling,
     * over Standard -- used to cost one of the twelve, so a list could stop at
     * four Groups and half the budget having simply been unlucky. Four tries
     * per slot is enough to fill a list and still terminate. */
    /* groupsUsed, not groups.length. A Behemoth Group is worth three to five
     * of the allowance (Behemoth rules 1.1), so counting cards let this build
     * a Shaltari 3000 with sixteen Groups that count as eighteen. An illegal
     * list, from the one thing in here whose job is to produce a legal one.
     * Found by the generator, which is what it is for. */
    for (let n = 0; n < maxG * 4 && groupsUsed(a) < maxG; n++) {
      const spend = categorySpend(a);
      const std = spend.standard || 0;
      /* Standard until there is something for the rest to be measured
       * against, then whichever of the three has the most room left. Picking
       * at random here produces a list that is all Heavy and illegal. */
      const others = ['vanguard', 'heavy', 'support']
        .map(c => ({ c: c, room: std - (spend[c] || 0) }))
        .filter(x => x.room > 0)
        .sort((x, y) => y.room - x.room);
      const cat = (!std || !others.length || rnd() < 0.45)
        ? 'Standard' : others[0].c[0].toUpperCase() + others[0].c.slice(1);
      const pool = byCat(cat).length ? byCat(cat) : byCat('Standard');
      if (!pool.length) break;

      const g = addGroup(a);
      const u = pick(pool);
      if (!canAddUnit(a, g.id, u.id).ok) { removeGroup(a, g.id); continue; }
      const s = addSquad(a, g.id, u.id, u.squadMin || 1);
      if (!s) { removeGroup(a, g.id); continue; }

      // A Transport, but only where it comes out exact and the Group can still
      // afford it. Roughly half the time, so a generated list is not uniformly
      // mounted or uniformly on foot.
      if (rnd() < 0.5) {
        const opt = transportOptions(a, s.id)
          .filter(o => o.exact && o.need > 0)
          // A Transport is a Unit, so Rare and Unique bite on it too (3.2.1) --
          // and taking the same Rare dropship for three different Squads is
          // exactly what an unguarded generator does.
          .filter(o => canAddUnit(a, g.id, o.unit.id).ok)
          .find(o => groupCost(a, g) + (o.unit.points || 0) * o.need <= cap
            && armyCost(a) + (o.unit.points || 0) * o.need <= pointsLimit);
        if (opt) assignTransport(a, s.id, opt.unit.id);
      }

      /* Over the budget, over the Group ceiling, or over Standard, so this
       * Group never happened.
       *
       * All three are checked AFTER the fact because none of them can be
       * predicted from the card: a Squad's price is the sum of its models and
       * its Transports, and the ratio moves with what the Transport cost.
       * Which is why picking the category with the most room was not enough on
       * its own, and produced a breach in one generated list out of six. */
      const now = categorySpend(a);
      const overRatio = ['vanguard', 'heavy', 'support']
        .some(c => (now[c] || 0) > (now.standard || 0));
      if (armyCost(a) > pointsLimit || groupCost(a, g) > cap || overRatio) {
        removeGroup(a, g.id);
      }
    }

    /* The Commander rides with someone, and this happens BEFORE the Squads
     * grow, not after. A Commander's points land on the Group they join, so
     * assigning one last pushed that Group over the quarter-of-the-army
     * ceiling (3.2) after every check had already passed -- nine Main Battle
     * Tanks at 315 plus a Level 6 at 150 is 465 against a cap of 375. One
     * sitting on the shelf is as illegal as not having one (3.2.5). */
    const cmdr = commanders(a)[0];
    const targets = commanderTargets(a, cmdr.id);
    // Prefer a Group that can absorb the Commander's points without breaching
    // the ceiling; join one anyway rather than leave them on the shelf, which
    // is the worse of the two errors.
    const room = targets.filter(t => groupCost(a, t.group) + levelCost(cmdr.level) <= cap);
    const host = (room.length ? room : targets)[0] ? pick(room.length ? room : targets) : null;
    if (host) assignCommander(a, cmdr.id, host.squad.id);

    /* Groups run out before points do. Twelve Squads at their minimum size is
     * half a Clash. So the rest of the budget goes into the Squads that are
     * already there, one model at a time.
     *
     * Only Squads that nothing is riding in and that are carrying nobody: a
     * Transport must be taken FULL (3.2.4), so growing a Squad that is aboard
     * one breaks the Group, and the fix would be buying another Transport,
     * which is a different decision. */
    const growable = () => {
      const out = [];
      a.groups.forEach(g => g.squads.forEach(s => {
        const u = unitOf(a, s);
        if (!u || u.category === 'Transport' || s.carriedBy) return;
        if (g.squads.some(x => x.carriedBy === s.id)) return;
        if (!canSetCount(a, s.id, s.models.length + 1).ok) return;
        out.push({ g: g, s: s, u: u });
      }));
      return out;
    };
    for (let guard = 0; guard < 400; guard++) {
      const list = growable();
      if (!list.length) break;
      const t = pick(list);
      const before = JSON.stringify(t.s.models);
      t.s.models.push({ variant: defaultVariant(t.u) });
      const now = categorySpend(a);
      const bad = armyCost(a) > pointsLimit || groupCost(a, t.g) > cap
        || ['vanguard', 'heavy', 'support'].some(c => (now[c] || 0) > (now.standard || 0));
      if (bad) {
        t.s.models = JSON.parse(before);
        // That one will not grow again either, and there is no cheaper move
        // left once every candidate has been tried, so stop when the whole
        // list is refusing rather than spinning to the guard.
        if (list.length === 1) break;
      }
    }

    a.name = `${(f.name || factionId)} ${size.label}`;
    touch(a);
    return { ok: true, army: a, reason: null };
  }

  function remove(id) {
    armies = armies.filter(a => a.id !== id);
    if (window.FleetSync && window.FleetSync.recordDeleted) {
      try { window.FleetSync.recordDeleted(id); } catch (e) { /* optional */ }
    }
    save();
  }

  function touch(a) { a.updatedAt = Date.now(); save(); }

  /* The agreed limit is not settled at creation, and the app behaved as though
   * it were: create() wrote pointsLimit once and nothing ever wrote it again.
   *
   * It moves more than the total. The per-Group ceiling is a quarter of the
   * AGREED number (3.2), the Group cap comes off the size band (3.1) and the
   * Rare allowance moves with the band too (3.2.1). So agreeing 1500 on the
   * day instead of the 2000 you built at changes what is legal, and there was
   * no way to tell the app. Anything the change makes illegal is reported by
   * validate(), not refused here; the number is the players' to agree. */
  function setPointsLimit(army, pts) {
    const n = Math.round(Number(pts) || 0);
    if (n <= 0 || n === army.pointsLimit) return army.pointsLimit;
    army.pointsLimit = n;
    touch(army);
    return n;
  }

  // ------------------------------------------------------------------ edits

  /* A Group's name is its POSITION unless you have actually given it one.
   *
   * Baking "Group 3" in at creation went wrong two ways: delete Group 1 and
   * "Group 2" is sitting first, and delete the middle of three and the next
   * one you add is numbered from the length, so you get two Groups both called
   * "Group 3". Storing nothing and deriving the number means the list always
   * counts 1, 2, 3 no matter what you remove. */
  function addGroup(army, name) {
    const g = { id: uid(), name: name || null, squads: [] };
    army.groups.push(g);
    touch(army);
    return g;
  }

  /* Duplicate a Group: every Squad, its models and their variants, the weapon
   * upgrades, and the nesting.
   *
   * The nesting is the part that has to be got right. carriedBy holds a Squad
   * id, so every id is reissued and every link is remapped through the same
   * map. Copy the ids as they are and the new Group's Squads ride the OLD
   * Group's Transports, which is a corrupt army that still renders.
   *
   * Refused rather than reported where it could never be legal: the Group cap
   * and Rare/Unique, which is exactly what Dropfleet refuses (copyGroup).
   * Everything else about a Group is a question of what it looks like when you
   * have finished, and validate() asks that.
   *
   * The Commander does not come along. One is assigned to a Unit and costs
   * points from the Army (3.2.5); copying a Squad should not quietly buy you a
   * second Commander. */
  function duplicateGroup(army, groupId) {
    const g = (army.groups || []).find(x => x.id === groupId);
    if (!g) return { ok: false, reason: 'Unknown Group.' };

    const size = window.DZC.gameSizeFor(army.pointsLimit);
    const maxG = size ? window.DZC.maxGroups(size, army.pointsLimit) : 0;
    if (maxG && groupsUsed(army) >= maxG) {
      return { ok: false, reason: `${size.label} allows ${maxG} Groups (3.1).` };
    }

    // Rare and Unique are counted in Squads across the whole Army, so a Group
    // holding two Squads of the same Rare Unit adds two, not one.
    const adding = new Map();
    g.squads.forEach(s => {
      const u = unitOf(army, s);
      if (u) adding.set(u, (adding.get(u) || 0) + 1);
    });
    for (const [u, n] of adding) {
      const after = squadsNamed(army, u.name) + n;
      if (u.unique && after > 1) {
        return { ok: false, reason: `${u.name} is Unique: one per Army (3.2.1).` };
      }
      if (u.rare) {
        const lim = size ? window.DZC.rareLimit(size.id) : 1;
        if (after > lim) {
          return { ok: false,
                   reason: `${u.name} is Rare: ${size ? size.label : 'this size'} allows ${lim} (3.2.1).` };
        }
      }
    }

    const idMap = {};
    const squads = g.squads.map(s => {
      const id = uid();
      idMap[s.id] = id;
      const copy = {
        id: id,
        unitId: s.unitId,
        models: s.models.map(m => ({ variant: m.variant })),
        carriedBy: s.carriedBy,
        commander: null
      };
      if (s.upgrades) copy.upgrades = JSON.parse(JSON.stringify(s.upgrades));
      return copy;
    });
    squads.forEach(s => { if (s.carriedBy) s.carriedBy = idMap[s.carriedBy] || null; });

    // No name, so it takes its own number rather than a second "Group 3".
    const copy = { id: uid(), name: null, squads: squads };
    army.groups.push(copy);
    touch(army);
    return { ok: true, reason: null, group: copy };
  }

  /* A Group of Gates is not "Group 3", and calling it that is the whole of
   * what Jet noticed at a table: "I had them in specific groups in the builder
   * but they're more dynamic/fluid in gameplay. Friend had to really focus on
   * not just always grouping them as listed every turn."
   *
   * It is called Gates, and it is numbered separately, because the numbers ARE
   * the Group allowance -- printing "Group 4" over something that spends none
   * of it is the sheet telling you the wrong thing to plan around.
   *
   * A name you typed still wins. This only replaces the automatic one. */
  function groupName(army, g) {
    if (g.name) return g.name;
    const squads = g.squads || [];
    if (squads.length && squads.every(s => gateSquad(army, s))) {
      const gateGroups = (army.groups || []).filter(x =>
        (x.squads || []).length && x.squads.every(s => gateSquad(army, s)));
      return gateGroups.length > 1 ? `Gates ${gateGroups.indexOf(g) + 1}` : 'Gates';
    }
    // Numbered among the Groups that actually spend the allowance, so the
    // numbers on screen are the ones the cap is counted in.
    const real = (army.groups || []).filter(x =>
      !((x.squads || []).length && x.squads.every(s => gateSquad(army, s))));
    const i = real.indexOf(g);
    return `Group ${(i === -1 ? army.groups.indexOf(g) : i) + 1}`;
  }

  /* Typing the auto name back in, or clearing the field, hands the Group
   * to the numbering again rather than freezing today's number as a custom
   * name that stops tracking. */
  /* Free text, so it is stored as typed apart from the ends -- a description
   * that silently rewrote what you wrote would be worse than not having one.
   * Capped, because it travels in a share link. */
  function setDescription(army, text) {
    army.description = String(text == null ? '' : text).trim().slice(0, 500);
    touch(army);
    return army.description;
  }

  /* Move a Group so it sits before or after another.
   *
   * The array order IS the order on the screen and on the printed sheet, and
   * that order is the deployment plan -- which Group you put down first is a
   * decision, and until now it was whatever order you happened to add them in.
   *
   * Dropfleet constrains the same move to a weight class (reorderGroupWithinClass,
   * app.js:2760) because its groups bucket by one. A DZC Group has no category:
   * it is one Squad and its Transports (3.2.4), and the Squads inside it can be
   * anything. So there is nothing to constrain it to and any order is legal. */
  function moveGroup(army, draggedId, targetId, placeAfter) {
    if (!draggedId || draggedId === targetId) return false;
    const gs = army.groups;
    const dragged = gs.find(g => g.id === draggedId);
    const target = gs.find(g => g.id === targetId);
    if (!dragged || !target) return false;
    gs.splice(gs.indexOf(dragged), 1);
    const at = gs.indexOf(target);
    gs.splice(placeAfter ? at + 1 : at, 0, dragged);
    touch(army);
    return true;
  }

  function renameGroup(army, groupId, text) {
    const g = army.groups.find(x => x.id === groupId);
    if (!g) return;
    const t = (text || '').trim();
    g.name = (!t || t === `Group ${army.groups.indexOf(g) + 1}`) ? null : t;
    touch(army);
  }

  /* A Commander's name, the same deal as a Group's: derived unless you gave it
   * one. The rulebook never names Commanders, 3.2.5 only sets a Level and a
   * cost, so the default has to say the thing that matters, and the thing
   * that matters is the Level. */
  function commanderName(army, c) {
    if (c.name) return c.name;
    return `Level ${c.level} Commander`;
  }

  function renameCommander(army, commanderId, text) {
    const c = commanders(army).find(x => x.id === commanderId);
    if (!c) return;
    const t = (text || '').trim();
    c.name = (!t || t === `Level ${c.level} Commander`) ? null : t;
    touch(army);
  }

  function removeGroup(army, groupId) {
    army.groups = army.groups.filter(g => g.id !== groupId);
    touch(army);
  }

  function addSquad(army, groupId, unitId, count) {
    const g = army.groups.find(x => x.id === groupId);
    if (!g) return null;
    const u = window.DZC.unit(army.faction, unitId);
    if (!u) return null;
    // Refuse rather than record-and-report. The picker already hides anything
    // illegal; this is the backstop for a direct call.
    if (!canAddUnit(army, groupId, unitId).ok) return null;
    // A new Squad starts at its minimum legal size, or one model where the
    // card gives no size (Transports: you take as many as the cargo needs).
    const n = count || u.squadMin || 1;
    const s = {
      id: uid(),
      unitId: unitId,
      models: Array.from({ length: n }, () => ({ variant: defaultVariant(u) })),
      carriedBy: null,
      commander: null
    };
    g.squads.push(s);
    touch(army);
    return s;
  }

  function defaultVariant(u) {
    const v = (u.variants || [])[0];
    return v ? v.name : null;
  }

  /* Zero is a Squad with nothing in it, not a removed Squad. Jet, 2026-08-09:
   * "leave it at 0 units if it's selected. And leave it at 0... make the
   * entire card greyed out with 0 models but not deleted... rather than code
   * it in specifically for some units, going from 0 to x in each squad would
   * cover every squad." Emptying it used to call removeSquad outright, which
   * left no legal way to reach "I want this at zero for now" without also
   * losing the Squad's Transport, Commander and place in the Group. The only
   * thing that removes a Squad now is pressing Remove, on purpose. */
  function setModelCount(army, squadId, n) {
    const s = findSquad(army, squadId);
    if (!s) return { ok: false, reason: 'Unknown Squad.' };
    const u = unitOf(army, s);
    n = Math.max(0, n);
    const chk = canSetCount(army, squadId, n);
    if (!chk.ok) return chk;
    while (s.models.length < n) s.models.push({ variant: defaultVariant(u) });
    s.models.length = n;
    // A Transport carrying this Squad must still be full afterwards, so its
    // derived count is recomputed rather than left stale.
    refitTransports(army);
    touch(army);
    return { ok: true, reason: null };
  }

  function setModelVariant(army, squadId, index, variantName) {
    const s = findSquad(army, squadId);
    if (s && s.models[index]) { s.models[index].variant = variantName; touch(army); }
  }

  /* Variants are per MODEL (3.2.2), so what a Squad actually is is HOW MANY OF
   * EACH -- not "which one". Asking each model in turn which variant it is,
   * one dropdown per model, describes the same fact from the wrong end: it
   * makes the count the fixed thing and the mix the fiddly thing, when the mix
   * is the decision.
   *
   * THE MIX MOVES MODELS AROUND. IT DOES NOT BUY THEM. Jet, 2026-08-07: "click
   * shouldn't increase the miniatures. that's dumb... it's fiddly to like
   * 'increase another physical model'."
   *
   * It used to. Pressing + on a Variant took its count up by one and the
   * Squad's size followed, so asking a Squad of three Sabres for one Rapier
   * gave you FOUR tanks -- a model you had not asked for, did not own, and
   * were now paying for. And because required transport capacity is per model
   * (loadCheck multiplies fills by the count), that fourth tank silently broke
   * the Condor carrying them: 6 triangles of room, 8 needed.
   *
   * So the two controls do two different jobs and neither does the other's:
   *
   *   the Squad stepper   changes how many miniatures are in the Squad
   *   a Variant stepper   changes what the miniatures you already have ARE
   *
   * A shift takes from, or gives to, the LARGEST other Variant -- ties broken
   * by the order the card prints them. Deterministic, and it matches what you
   * mean: with three Sabres, one Rapier comes out of the Sabres because there
   * is nowhere else it could come from. */
  function variantNames(army, s) {
    const u = unitOf(army, s);
    return ((u && u.variants) || []).map(v => v.name);
  }

  /* The Variant that gives up a model to this one, or receives one from it. */
  function counterpart(army, s, variantName) {
    const others = variantNames(army, s).filter(n => n !== variantName);
    if (!others.length) return null;
    const n = name => s.models.filter(m => m.variant === name).length;
    return others.reduce((best, name) => (n(name) > n(best) ? name : best), others[0]);
  }

  function canShiftVariant(army, squadId, variantName, delta) {
    const s = findSquad(army, squadId);
    if (!s) return { ok: false, reason: 'Unknown Squad.' };
    const other = counterpart(army, s, variantName);
    if (!other) return { ok: false, reason: 'This Unit has only one Variant.' };
    const have = name => s.models.filter(m => m.variant === name).length;
    if (delta > 0) {
      if (!have(other)) {
        return { ok: false,
                 reason: `Every model in this Squad is already a ${variantName}. Add a model to the Squad to take another.` };
      }
      return { ok: true, reason: null, from: other };
    }
    if (!have(variantName)) return { ok: false, reason: null };
    return { ok: true, reason: null, to: other };
  }

  /* One model changes what it is. The Squad's size is untouched, always. */
  function shiftVariant(army, squadId, variantName, delta) {
    const chk = canShiftVariant(army, squadId, variantName, delta);
    if (!chk.ok) return chk;
    const s = findSquad(army, squadId);
    const from = delta > 0 ? chk.from : variantName;
    const to = delta > 0 ? variantName : chk.to;
    // From the END, so the models you already had keep their order.
    for (let i = s.models.length - 1; i >= 0; i--) {
      if (s.models[i].variant === from) { s.models[i].variant = to; break; }
    }
    touch(army);
    return chk;
  }

  /* shiftVariant MOVES a model between Variants -- it cannot change how many
   * are in the Squad, because a fixed-size Squad (squadMin === squadMax) has
   * no room to grow into. That is wrong for the other case: a Squad whose
   * size is a RANGE (2026-08-09 bug reports -- Resistance Main Battle Tank,
   * Bioficer Grievance/Thorn/Tusk/Tangent, Scourge Interceptor) has no top
   * stepper (sizeControl hides it whenever a Unit has Variant blocks, on
   * Jet's own call, 2026-08-08: "remove that +/- stepper" on the Troop
   * Buggy row, because pressing + up there had to GUESS which Variant you
   * meant). With the top stepper gone and shiftVariant only ever moving a
   * model that already exists, every Variant Unit with a size range was left
   * with no way to add a second model at all -- stuck at whatever the Squad
   * started with.
   *
   * So a range-sized Squad gets its own pair, ADDING and REMOVING a model of
   * this Variant outright rather than trading with a sibling -- which is
   * what "+/- the number of units we have in that variant" (Jet, on the Bus)
   * asked for in the first place. A fixed-size Squad keeps shiftVariant; a
   * ranged one uses this instead. */
  function canAdjustVariantCount(army, squadId, variantName, delta) {
    const s = findSquad(army, squadId);
    if (!s) return { ok: false, reason: 'Unknown Squad.' };
    if (delta < 0 && !s.models.some(m => m.variant === variantName)) {
      return { ok: false, reason: null };
    }
    return canSetCount(army, squadId, s.models.length + delta);
  }

  function adjustVariantCount(army, squadId, variantName, delta) {
    const chk = canAdjustVariantCount(army, squadId, variantName, delta);
    if (!chk.ok) return chk;
    const s = findSquad(army, squadId);
    if (delta > 0) {
      s.models.push({ variant: variantName });
    } else {
      // From the END, so the models you already had keep their order.
      const i = s.models.map(m => m.variant).lastIndexOf(variantName);
      s.models.splice(i, 1);
    }
    // Zero is a Squad with nothing in it, not a removed Squad -- see
    // setModelCount's note. The last model of a Variant coming out is no
    // different from the Squad stepper reaching zero the same way.
    // A Transport carrying this Squad must still be full afterwards.
    refitTransports(army);
    touch(army);
    return { ok: true, reason: null };
  }

  function removeSquad(army, squadId) {
    army.groups.forEach(g => {
      // Anything this Squad was carrying is orphaned, not deleted.
      g.squads.forEach(s => { if (s.carriedBy === squadId) s.carriedBy = null; });
      g.squads = g.squads.filter(s => s.id !== squadId);
    });
    touch(army);
  }

  /* MOVE A SQUAD TO ANOTHER GROUP. Jet, 2026-08-07: "you should be able to
   * drag units between groups."
   *
   * Everything it is CARRYING comes with it, all the way down. A Bear APC full
   * of Legionnaires that moved on its own would leave the Legionnaires in the
   * old Group riding a Transport that is no longer there -- a state no rule
   * describes and nothing else in the app can produce.
   *
   * What does NOT come with it is whatever was carrying IT. That link is cut,
   * because the carrier is staying: a Squad dragged out of a Transport and
   * into another Group has got out of the Transport, which is exactly what the
   * gesture looks like.
   *
   * Deliberately does not refuse. Group legality (3.2.4) is validate()'s to
   * report, and it reports it on the Group card now -- blocking the drag would
   * mean you could not rearrange an army except through states the rules
   * already allow, and rearranging is the whole point of picking one up. */
  function moveSquad(army, squadId, toGroupId) {
    const to = army.groups.find(g => g.id === toGroupId);
    const from = groupOf(army, squadId);
    if (!to || !from) return { ok: false, reason: 'Unknown Group.' };
    if (from.id === to.id) return { ok: true, reason: null };

    // The Squad and everything riding on it, transitively.
    const moving = [];
    const take = id => {
      const s = from.squads.find(x => x.id === id);
      if (!s || moving.indexOf(s) !== -1) return;
      moving.push(s);
      from.squads.filter(x => x.carriedBy === id).forEach(x => take(x.id));
    };
    take(squadId);
    if (!moving.length) return { ok: false, reason: 'Unknown Squad.' };

    const ids = moving.map(s => s.id);
    // It has got out of whatever was carrying it, unless that came too.
    moving.forEach(s => { if (s.carriedBy && ids.indexOf(s.carriedBy) === -1) s.carriedBy = null; });
    from.squads = from.squads.filter(s => ids.indexOf(s.id) === -1);
    // And anything left behind that was riding one of these is on foot.
    from.squads.forEach(s => { if (s.carriedBy && ids.indexOf(s.carriedBy) !== -1) s.carriedBy = null; });
    to.squads = to.squads.concat(moving);
    touch(army);
    return { ok: true, reason: null, moved: moving.length };
  }

  function setCarrier(army, squadId, carrierSquadId) {
    const s = findSquad(army, squadId);
    if (s) { s.carriedBy = carrierSquadId || null; touch(army); }
  }

  /* 3.2.5: a Squad may contain only one Commander, and the level must be one
   * the game size allows. Both are enforced here as well as in the UI. */
  /* Commanders belong to the ARMY, not to a Squad.
   *
   * You buy one and then decide who it rides with, which is the order people
   * actually work in. And it is the only way an unassigned Commander can
   * exist long enough to say "add a Squad this Commander can join". Squads
   * still carry a `commander` object so everything that renders a Squad keeps
   * working; `commanders` is the store and assignment keeps the two in step. */
  function commanders(army) { return (army.commanders = army.commanders || []); }

  function commanderFor(army, squadId) {
    return commanders(army).find(c => c.squadId === squadId) || null;
  }

  /* Which Squads this Commander may join: a fighting Unit, one Commander each
   * (3.2.5), and never a Transport Squad. */
  /* Which Squads this Commander may be assigned to.
   *
   * "Squads can only contain one Commander" (3.2.5) is the rule, and it is why
   * a Squad holding somebody else is not offered. The Squad holding THIS
   * Commander stays on the list, because the select has to be able to show
   * where they already are.
   *
   * Excluding TRANSPORT Squads is not that rule. 3.2.5 reads, in full, that a
   * Commander "must be assigned to a Unit when building your Army" and that a
   * Squad may contain one. A Transport is a Unit and a Transport Squad is a
   * Squad, so the rules permit it and this refuses it. It is a design decision
   * and it is marked as one: 3.2.5 also says a Commander is killed with the
   * Unit they are assigned to, and riding in the Bear APC instead of with the
   * Legionnaires it carries is strictly the worse place to be. Whether the
   * builder should still allow it is on the backlog, unsettled. */
  /* Units no Commander may ever be assigned to, in the rulebook's own words:
   *
   *   10.1.12 Fast Mover     "Commanders may not be assigned to Fast Movers."
   *   10.1.20 Living Weapons "Commanders cannot be assigned to Living Weapons."
   *
   * Both sentences have been in data/dzc/rules.json since the rulebook was
   * scanned, and both were shown on the card and enforced nowhere. So the app
   * would put a Level 5 Commander on an Archangel and price it, which is an
   * illegal army it never mentioned. Its own test suite built one.
   *
   * Matched off the Unit's printed Special, which is where the keyword is:
   * "Ev3, Fast Mover" on the Archangel, "Agile 1, Dogs, FS2, Living Weapons"
   * on the K9 Pack. Ten Units carry one or the other. */
  const NO_COMMANDER = [
    [/\bFast Mover\b/i, 'a Fast Mover', '10.1.12'],
    [/\bLiving Weapons?\b/i, 'a Living Weapon', '10.1.20'],
  ];

  function commanderBan(unit) {
    if (!unit) return null;
    // "Commanders cannot be assigned to Behemoths" (Behemoth rules 1.1). By
    // TYPE rather than by a keyword, because the card does not print one, the
    // whole of 1.1 is what says it.
    if (unit.type === 'Behemoth') {
      return { reason: `${unit.name} is a Behemoth: Commanders cannot be assigned to one (1.1).` };
    }
    const sp = unit.special || '';
    for (const [re, what, rule] of NO_COMMANDER) {
      if (re.test(sp)) {
        return { reason: `${unit.name} is ${what}: Commanders may not be assigned to one (${rule}).` };
      }
    }
    return null;
  }

  function commanderTargets(army, cmdrId) {
    const out = [];
    army.groups.forEach(g => g.squads.forEach(s => {
      const u = unitOf(army, s);
      if (!u || u.category === 'Transport' || commanderBan(u)) return;
      const held = commanderFor(army, s.id);
      if (held && held.id !== cmdrId) return;
      out.push({ squad: s, unit: u, group: g });
    }));
    return out;
  }

  function addCommander(army, level) {
    const size = window.DZC.gameSizeFor(army.pointsLimit);
    const allowed = size ? window.DZC.commanderLevels(size.id).map(l => l.level) : [];
    if (allowed.indexOf(level) === -1) {
      return { ok: false, reason: `A Level ${level} Commander is not allowed in ${size ? size.label : 'this game size'} (3.2.5).` };
    }
    const c = { id: uid(), level: level, squadId: null, name: null };
    commanders(army).push(c);
    syncCommanders(army);
    touch(army);
    return { ok: true, commander: c, reason: null };
  }

  function removeCommander(army, cmdrId) {
    army.commanders = commanders(army).filter(c => c.id !== cmdrId);
    syncCommanders(army);
    touch(army);
    return { ok: true, reason: null };
  }

  function assignCommander(army, cmdrId, squadId) {
    const c = commanders(army).find(x => x.id === cmdrId);
    if (!c) return { ok: false, reason: 'Unknown Commander.' };
    if (!squadId) { c.squadId = null; syncCommanders(army); touch(army); return { ok: true, reason: null }; }
    const s = findSquad(army, squadId);
    if (!s) return { ok: false, reason: 'Unknown Squad.' };
    const u = unitOf(army, s);
    if (u && u.category === 'Transport') {
      return { ok: false, reason: 'A Commander is assigned to a fighting Unit, not to a Transport Squad.' };
    }
    const ban = commanderBan(u);
    if (ban) return { ok: false, reason: ban.reason };
    const held = commanderFor(army, squadId);
    if (held && held.id !== cmdrId) {
      return { ok: false, reason: 'That Squad already has a Commander: one per Squad (3.2.5).' };
    }
    c.squadId = squadId;
    syncCommanders(army);
    touch(army);
    return { ok: true, reason: null };
  }

  /* Mirror the store onto the Squads, and drop assignments whose Squad has
   * been removed, so a deleted Squad cannot strand a Commander. */
  function syncCommanders(army) {
    army.groups.forEach(g => g.squads.forEach(s => { s.commander = null; }));
    commanders(army).forEach(c => {
      if (!c.squadId) return;
      const s = findSquad(army, c.squadId);
      if (!s) { c.squadId = null; return; }
      s.commander = { level: c.level };
    });
  }

  /* Kept for the older call path: pick a level for this Squad, or clear it. */
  function setCommander(army, squadId, level) {
    const s = findSquad(army, squadId);
    if (!s) return { ok: false, reason: 'Unknown Squad.' };
    const held = commanderFor(army, squadId);
    if (!level) {
      if (held) removeCommander(army, held.id);
      return { ok: true, reason: null };
    }
    if (held) removeCommander(army, held.id);
    const r = addCommander(army, level);
    if (!r.ok) return r;
    const a = assignCommander(army, r.commander.id, squadId);
    if (!a.ok) { removeCommander(army, r.commander.id); return a; }
    touch(army);
    return { ok: true, reason: null };
  }

  // ═══════════════════════════════════════════════════════════ ENFORCEMENT
  //
  // The builder refuses illegal actions rather than reporting them after the
  // fact. Anything that can be made unreachable is made unreachable; the
  // issues list is only for states that depend on an army being finished
  // (no Commander yet, a category ratio that the build order inverts).

  /* Rare and Unique are counted per SQUAD of the same name (3.2.1), not per
   * model -- a Squad of three Archangels is one Rare choice, not three. */
  function squadsNamed(army, name) {
    let n = 0;
    army.groups.forEach(g => g.squads.forEach(s => {
      const u = unitOf(army, s);
      if (u && u.name === name) n++;
    }));
    return n;
  }

  /* May this unit be added to this Group right now? */

  /* What every Transport in a Group offers, and what is already aboard, per
   * shape. The Group header draws it, so "is there room, and for what shape"
   * is answered by looking instead of by trying and being refused.
   *
   * A Transport that is itself being carried is skipped: its capacity is
   * unreachable while it is inside something else (3.2.4.2). Capacity is
   * multiplied by the number of models, because three Bear APCs offer three
   * times what one does. */
  function groupSpace(army, group) {
    const by = {};
    const slot = sh => (by[sh] = by[sh] || { shape: sh, total: 0, used: 0 });
    (group.squads || []).forEach(t => {
      const tu = carrierOf(army, t);
      if (!tu || t.carriedBy) return;
      const cap = ((tu.transport || {}).capacity) || [];
      if (!cap.length) return;
      cap.forEach(c => { slot(c.shape).total += (c.n || 0) * t.models.length; });
      const aboard = group.squads.filter(x => x.carriedBy === t.id)
        .map(x => ({ unit: unitOf(army, x), count: x.models.length }))
        .filter(x => x.unit);
      const chk = window.DZC.loadCheck(tu, aboard, t.models.length);
      Object.keys(chk.byShape).forEach(sh => { slot(sh).used += chk.byShape[sh]; });
    });
    return Object.keys(by).map(k => by[k]);
  }

  function canAddUnit(army, groupId, unitId) {
    const u = window.DZC.unit(army.faction, unitId);
    if (!u) return { ok: false, reason: 'Unknown unit.' };

    if (u.selectable === false) {
      return { ok: false, reason: `${u.name} is Generated in play and can never be chosen.` };
    }

    /* What may join a Group is decided by transport and nothing else.
     *
     * 3.2.4.   A Transport may only be chosen alongside a Squad it can carry.
     *          Those Transports form a Squad; those two Squads form one Group.
     * 3.2.4.1. Up to 4 Squads, plus their own Transport Squads, may share ONE
     *          larger Transport, and those all form one Group.
     *
     * There is no other way for a second Squad to enter a Group, and no
     * restriction by category or unit type anywhere in 3.2. So an empty Group
     * takes any fighting Unit; after that the only legal additions are a
     * Transport for something already here, or a Squad that fits inside a
     * Transport already here. */
    const group = groupId ? (army.groups || []).find(g => g.id === groupId) : null;
    const squads = (group && group.squads) || [];
    const occupied = squads.length > 0;

    // The 4-Squad ceiling is the one composition rule that can never come good
    // by adding something else, so it is the only one blocked here. Everything
    // else about a Group is a question of what it looks like when you have
    // FINISHED. A lone Transport is unfinished, not illegal, and you may well
    // be about to put something in it. Those are reported by validate().
    if (occupied && u.category !== 'Transport' && squads.filter(s => s.carriedBy).length >= 4) {
      return { ok: false, reason: 'At most 4 Squads may share one Transport (3.2.4.1).' };
    }

    /* "A Gate is never part of another Group." Refused rather than reported,
     * because unlike a lone Transport this can never come good by adding
     * something: no arrangement of a Gate and a Squad in one Group is legal.
     * It cuts both ways -- a Gate may not join a Group with Squads in it, and
     * a Squad may not join a Group of Gates. */
    if (occupied) {
      const allGates = squads.every(s => gateSquad(army, s));
      if (isGate(u) && !allGates) {
        return { ok: false, reason: `${u.name} is a Gate: a Gate is never part of another Group.` };
      }
      if (!isGate(u) && allGates) {
        return { ok: false, reason: 'That Group is Gates, and a Gate is never part of another Group.' };
      }
    }

    const taken = squadsNamed(army, u.name);
    if (u.unique && taken >= 1) {
      return { ok: false, reason: `${u.name} is Unique: one per Army (3.2.1).` };
    }
    if (u.rare) {
      const size = window.DZC.gameSizeFor(army.pointsLimit);
      const lim = size ? window.DZC.rareLimit(size.id) : 1;
      if (taken >= lim) {
        return { ok: false, reason: `${u.name} is Rare: ${size ? size.label : 'this size'} allows ${lim} (3.2.1).` };
      }
    }
    return { ok: true, reason: null };
  }

  /* Squad size limits (the card's own min/max). Transports are exempt: they
   * have no squad size, and their count is derived from their cargo.
   *
   * The MAXIMUM is a hard ceiling -- there is no such thing as "six Battle
   * Buses, temporarily" -- so it still refuses outright.
   *
   * The MINIMUM used to refuse the same way, and that is what forced the
   * odd behaviour Baxter flagged 2026-08-09: with nowhere legal to land
   * between "at minimum" and "gone", a Squad you were shrinking toward zero
   * would sit stuck at minimum, or a Variant control would flip which model
   * you had rather than let the count move. Jet, 2026-08-09: "let squads
   * drop to 0."
   *
   * So it no longer blocks. A Squad under its minimum is not a state this
   * function forbids you from reaching -- it is a state validate() reports
   * (rule 2), the same way an over-capacity Genitor or a half-full Transport
   * already are: buildable, and named as unfinished rather than refused. */
  function canSetCount(army, squadId, n) {
    const s = findSquad(army, squadId);
    if (!s) return { ok: false, reason: 'Unknown Squad.' };
    const u = unitOf(army, s);
    if (!u) return { ok: false, reason: 'Unknown unit.' };
    if (u.category === 'Transport') {
      return { ok: false, reason: 'A Transport’s count follows its cargo. Change the Squad it carries.' };
    }
    if (u.squadMax != null && n > u.squadMax) {
      return { ok: false, reason: `${u.name} has a maximum Squad size of ${u.squadMax}.` };
    }
    return { ok: true, reason: null };
  }

  /* Total capacity space a Squad occupies, in its cheapest legal shape.
   * A Unit with two solid symbols may use either (3.2.4.2). */
  function squadFill(army, squad, shape) {
    const u = unitOf(army, squad);
    if (!u) return 0;
    const f = (window.DZC.fillsOf(u) || []).filter(x => !shape || x.shape === shape);
    if (!f.length) return 0;
    const best = f.reduce((a, b) => (b.n < a.n ? b : a));
    return best.n * squad.models.length;
  }

  /* Which Transports in this faction could carry this Squad, and how many of
   * each it would take. "You may take as many identical Transports as needed"
   * (3.2.4), so the number is computed -- never typed by the user. */
  function transportOptions(army, squadId) {
    const s = findSquad(army, squadId);
    const u = s && unitOf(army, s);
    const f = window.DZC.faction(army.faction);
    if (!u || !f) return [];
    /* NEVER A GATE. "Gates are always Transports but are not taken with any
     * Units aboard" -- so a Gate is not a Transport you buy for a Squad, and
     * offering one here put a Shaltari Squad inside a Gate on the list when
     * the rules start it in Holding instead. Two of the five were being
     * offered to Brave Warsuits and both were accepted. */
    return f.units.filter(t => t.category === 'Transport' && !isGate(t)
        && window.DZC.canCarry(t, u))
      .map(t => {
        /* The shape a Unit with two solid symbols uses here is the cheapest
         * one this Transport can actually hold a whole model of, not the first
         * one whose shape matches -- fitsIn has already thrown away any that
         * cannot. */
        const opt = window.DZC.fitsIn(t, u).reduce((a, b) => (b.n < a.n ? b : a));
        const shape = opt.shape;
        const per = window.DZC.capacityFor(t, shape);
        const fill = squadFill(army, s, shape);
        /* COUNTED IN MODELS, NOT IN SPACE.
         *
         * This divided the Squad's total fill by the Transport's capacity,
         * which is the same arithmetic that let a model be cut in half. Each
         * vehicle takes whole models -- floor(capacity / fill per model) --
         * and you need enough vehicles for all of them (3.2.4).
         *
         * DEFENSIVE, and said plainly rather than dressed up as a fix: every
         * real Transport's capacity is an exact multiple of the fill of
         * anything it can carry, so on today's data this returns what the old
         * division returned, for all 740 pairs. Checked by diffing every unit
         * at every legal Squad size against every Transport offered to it: 27
         * lines disappear, all of them a model being split, and not one
         * surviving line changes. It is here because the rule is about models
         * and the old form was about space, and the next card TTCombat print
         * does not have to divide evenly. */
        const eachHolds = Math.floor(per / opt.n);
        const need = eachHolds ? Math.ceil(s.models.length / eachHolds) : 0;
        return {
          unit: t, shape: shape, per: per, need: need,
          /* "Transports must be taken full" (3.2.4), and full means every one
           * of them full. Two conditions, because both can fail on their own:
           * the models have to divide evenly between the vehicles (5
           * Legionnaires cannot fill two Bear APCs), and a full vehicle's
           * worth of models has to actually come to its capacity -- a hold
           * of 3 taking one model of 2 has a hole in it however many of them
           * you take. The second condition cannot fail on today's cards, for
           * the reason given above; it is what makes the first one mean what
           * it says. */
          exact: eachHolds > 0 && s.models.length % eachHolds === 0
            && eachHolds * opt.n === per,
          fill: fill
        };
      });
  }

  /* Transports ALREADY in this Group that still have room for this Squad.
   *
   * This is 3.2.4.1 -- "up to 4 Squads, plus their own Transport Squads, may
   * share one larger Transport" -- and without it some Transports can never be
   * taken at all. A Vulture Troopship carries 4 squares; every UCM infantry
   * Squad is 2-3 models filling 1 square each. No single Squad can ever total
   * 4, so buying a Vulture per Squad leaves it permanently "not full" and the
   * model stepper refuses to grow past squadMax. The way out is the one the
   * rules already give you: put a second Squad in the one you have. */
  /* Is `maybe` somewhere inside `squadId` -- riding it, or riding something
   * riding it, at any depth? The one thing a Squad may never be put into. */
  function carriesTransitively(army, squadId, maybe) {
    const g = groupOf(army, squadId);
    if (!g) return false;
    const seen = {};
    const walk = id => {
      if (seen[id]) return false;
      seen[id] = true;
      return g.squads.filter(x => x.carriedBy === id)
        .some(x => x.id === maybe || walk(x.id));
    };
    return walk(squadId);
  }

  /* SHARING IS ONE TRANSPORT, NOT A TRANSPORT SQUAD.
   *
   * Jet, 2026-08-08: "Squad of Hazards and squad of legionnaires in a group
   * with Ferrets: okay. ...in a group with Ravens: not okay."
   *
   * Two rules, and the difference between them is the whole of it.
   *
   * 3.2.4.1: "Up to 4 Squads, plus their Transport Squads if they have any,
   * may all share ONE Transport." One Transport -- one model. The book's own
   * Group 5 is a single Albatross holding two Bear APC Squads and their two
   * Legionnaire Squads. A Squad may still fill SEVERAL identical Transports
   * on its own (Group 3, six Sabres in two Condors); what it may not do is
   * share them with somebody else's Squad.
   *
   * 3.2.4.3: "Auxiliary Transports do not have to be full. Any Squad/s which
   * the Auxiliary Transports do carry join the Auxiliary Transports' Group."
   * Squad/s, plural, across the whole Squad of them -- which is Group 4 in the
   * book: four Ferrets carrying two Legionnaires AND two Hazard Suits.
   *
   * So an Auxiliary Transport Squad may be shared at any size, and a Transport
   * Squad may be shared only while it is one model.
   *
   * What made this reachable was the spare seat. Three Legionnaires need two
   * Raven Troopships and two Troopships hold four, so a square went begging
   * and a Hazard Suit was allowed into it -- two Squads split across two
   * aircraft, which is the case Jet named. */
  function canShare(carrierUnit, carrierSquad, aboard) {
    if (!aboard.length) return true;                 // nobody to share with yet
    if (carrierUnit.auxiliaryTransport) return true;  // 3.2.4.3
    return carrierSquad.models.length <= 1;           // 3.2.4.1: ONE Transport
  }

  function boardOptions(army, squadId) {
    const s = findSquad(army, squadId);
    const g = groupOf(army, squadId);
    const u = s && unitOf(army, s);
    if (!u || !g) return [];
    return g.squads.filter(t => {
      /* A CARRIER THAT IS ITSELF ABOARD SOMETHING IS STILL A CARRIER. Jet,
       * 2026-08-07, looking at Legionnaires beside a Troop Buggy already
       * inside a Raven: "SHOULDN'T i be able to click and drag the
       * legionnaires into the buggy?"
       *
       * Yes -- and it is not an edge case, it is the commonest Group in the
       * game: infantry in an APC, APC in a dropship. 3.2.4.1 says it in as
       * many words, "up to 4 Squads, PLUS THEIR OWN TRANSPORT SQUADS, may
       * share one larger Transport". This line used to read `t.carriedBy`
       * and refuse, which quietly made that Group unbuildable by drag and
       * left the Buggy's own capacity -- one square each, exactly what a
       * Legionnaire fills -- unreachable.
       *
       * What is genuinely forbidden is a loop: putting a Squad into something
       * it is already carrying. That is the test now, and it walks all the way
       * down rather than one level. */
      if (t.id === s.id) return false;
      if (carriesTransitively(army, s.id, t.id)) return false;
      const tu = carrierOf(army, t);
      if (!tu || !(tu.category === 'Transport' || tu.auxiliaryTransport)) return false;
      // A Gate is never boarded when the list is built, and it is never part
      // of another Group either -- so it can never be a carrier in here. An
      // Aux Gate is, and deliberately: it is "taken as a non-Gate Squad".
      if (isGate(tu)) return false;
      if (!window.DZC.canCarry(tu, u)) return false;
      // 3.2.4.1 caps the sharing at 4 Squads.
      const aboard = g.squads.filter(x => x.carriedBy === t.id && x.id !== s.id);
      if (aboard.length >= 4) return false;
      if (!canShare(tu, t, aboard)) return false;
      const load = aboard.map(x => ({ unit: unitOf(army, x), count: x.models.length }))
        .filter(x => x.unit);
      load.push({ unit: u, count: s.models.length });
      return window.DZC.loadCheck(tu, load, t.models.length).ok;
    }).map(t => {
      const tu = carrierOf(army, t);
      const aboard = g.squads.filter(x => x.carriedBy === t.id && x.id !== s.id);
      const load = aboard.map(x => ({ unit: unitOf(army, x), count: x.models.length }))
        .filter(x => x.unit);
      const before = window.DZC.loadCheck(tu, load, t.models.length);
      load.push({ unit: u, count: s.models.length });
      const after = window.DZC.loadCheck(tu, load, t.models.length);
      const shape = Object.keys(after.byShape)[0];
      const room = shape ? window.DZC.capacityFor(tu, shape) * t.models.length : 0;
      return {
        squad: t, unit: tu, shape: shape,
        used: shape ? (before.byShape[shape] || 0) : 0,
        after: shape ? after.byShape[shape] : 0,
        room: room,
        riders: aboard.length,
        full: shape ? after.byShape[shape] === room : false
      };
    });
  }

  /* Put a Squad aboard a Transport Squad that is already in its Group. */
  function boardTransport(army, squadId, carrierSquadId) {
    const s = findSquad(army, squadId);
    if (!s) return { ok: false, reason: 'Unknown Squad.' };
    const opt = boardOptions(army, squadId).find(o => o.squad.id === carrierSquadId);
    if (!opt) {
      /* Which rule refused it. "No room" was the only sentence here and it is
       * the wrong one for a Squad kept out by the sharing rule rather than by
       * capacity -- a Squad of 2 Ravens with a square going spare has room,
       * and is still not something two Squads may split (3.2.4.1). A refusal
       * has to name the rule it is enforcing. */
      const t = findSquad(army, carrierSquadId);
      const tu = t && carrierOf(army, t);
      const g = groupOf(army, squadId);
      const aboard = t && g ? g.squads.filter(x => x.carriedBy === t.id && x.id !== s.id) : [];
      if (tu && !canShare(tu, t, aboard)) {
        return { ok: false,
          reason: `${aboard.length + 1} Squads may only share ONE Transport, and this is a Squad of ${t.models.length} (3.2.4.1).` };
      }
      return { ok: false, reason: 'That Transport has no room for this Squad (3.2.4.2).' };
    }

    // Drop whatever it was riding first, so a Transport bought only for this
    // Squad does not linger empty.
    const g = groupOf(army, squadId);
    const old = g.squads.find(x => x.id === s.carriedBy);
    if (old && old.id !== carrierSquadId) {
      const ou = unitOf(army, old);
      const others = g.squads.filter(x => x.carriedBy === old.id && x.id !== s.id);
      s.carriedBy = null;
      if (ou && ou.category === 'Transport' && !others.length) {
        g.squads = g.squads.filter(x => x.id !== old.id);
      }
    }
    s.carriedBy = carrierSquadId;
    refitTransports(army);
    touch(army);
    return {
      ok: true, reason: null,
      warn: opt.full ? null
        : `${opt.unit.name} still has room for ${opt.room - opt.after}. Transports must be taken full (3.2.4).`
    };
  }

  /* Assign (or clear) the Transport carrying a Squad. Creates the Transport
   * Squad, sets its count to exactly what the cargo needs, and links them --
   * "Those Transport(s) form a Squad. Those two Squads form one Group." */
  function assignTransport(army, squadId, transportUnitId) {
    const s = findSquad(army, squadId);
    const g = groupOf(army, squadId);
    if (!s || !g) return { ok: false, reason: 'Unknown Squad.' };

    // Drop any Transport Squad that exists only to carry this one.
    const old = g.squads.find(x => x.id === s.carriedBy);
    if (old) {
      const ou = unitOf(army, old);
      const others = g.squads.filter(x => x.carriedBy === old.id && x.id !== s.id);
      s.carriedBy = null;
      if (ou && ou.category === 'Transport' && !others.length) {
        g.squads = g.squads.filter(x => x.id !== old.id);
      }
    }
    if (!transportUnitId) { touch(army); return { ok: true, reason: null }; }

    const opt = transportOptions(army, squadId).find(o => o.unit.id === transportUnitId);
    if (!opt) return { ok: false, reason: 'That Transport cannot carry this Squad (3.2.4.2).' };
    /* A part-empty Transport is UNFINISHED, not illegal: two Legionnaires in a
     * Bear APC becomes legal the moment you buy a third, and refusing the
     * assignment means you can never get there. It is made, and validate()
     * reports "not full" until the Squad grows into it. Only a Transport that
     * cannot carry this Squad at all is refused, because nothing you add later
     * changes a shape mismatch. */
    const warn = opt.exact ? null
      : `${opt.need} × ${opt.unit.name} is not full: it carries ${opt.per} and this Squad `
        + `fills ${opt.fill}. Transports must be taken full (3.2.4).`;
    const t = {
      id: uid(), unitId: opt.unit.id,
      models: Array.from({ length: opt.need }, () => ({ variant: defaultVariant(opt.unit) })),
      carriedBy: null, commander: null
    };
    g.squads.push(t);
    s.carriedBy = t.id;
    touch(army);
    return { ok: true, reason: null, warn: warn };
  }

  /* Keep a Transport Squad's count in step after its cargo changes. Called on
   * every model-count change so the derived number can never drift. */
  function refitTransports(army) {
    army.groups.forEach(g => {
      g.squads.slice().forEach(t => {
        const tu = carrierOf(army, t);
        if (!tu || tu.category !== 'Transport') return;
        const riders = g.squads.filter(x => x.carriedBy === t.id);
        /* Nothing aboard means there is nothing to size it against, it does
         * NOT mean delete it.
         *
         * This used to drop the Transport Squad here, and refitTransports runs
         * on every single model-count change anywhere in the Army. So buying a
         * Condor first and then adding the Squad to put in it, which the
         * picker offers in as many words, lost the Condor the moment you set
         * the Squad's size, silently, with nothing on screen to say what had
         * gone or why. Reported by Jet 2026-08-07: a Squad taken from 2 to 3
         * and "a bunch of other units in that group got deleted".
         *
         * The two operations that genuinely orphan a Transport, clearing a
         * Squad's Transport, and moving it to a different one, already delete
         * it themselves, at the point where the user did the thing that
         * orphaned it. removeSquad deliberately does not, and says so. A
         * Transport carrying nothing is an illegal Army (3.2.4) and validate
         * reports it; it is not the builder's to take away. */
        if (!riders.length) return;
        const shape = (window.DZC.fillsOf(unitOf(army, riders[0]) || {})
          .find(x => window.DZC.capacityFor(tu, x.shape) > 0) || {}).shape;
        const per = window.DZC.capacityFor(tu, shape);
        const fill = riders.reduce((n, r) => n + squadFill(army, r, shape), 0);
        const need = per ? Math.ceil(fill / per) : t.models.length;
        while (t.models.length < need) t.models.push({ variant: defaultVariant(tu) });
        t.models.length = Math.max(1, need);
      });
    });
  }

  function findSquad(army, squadId) {
    for (const g of army.groups) {
      const s = g.squads.find(x => x.id === squadId);
      if (s) return s;
    }
    return null;
  }

  /* How many Groups this army actually spends against its allowance.
   *
   * Normally one per Group. A Behemoth is the exception: "A Behemoth counts as
   * that many Groups when building your Army and generating Pass tokens"
   * (Behemoth rules 1.1), and they are worth three to five each. Counting the
   * cards instead would let a Reconquest list field four Dragons inside a
   * twenty-Group allowance that they alone are worth.
   *
   * A Group containing a Behemoth costs its Groups Equivalent INSTEAD of one,
   * not as well, the Behemoth is what the Group is. */
  /* A GATE IS NOT PART OF YOUR ARMY'S GROUP STRUCTURE.
   *
   * Jet, 2026-08-08, after demoing Shaltari: "what if Gates were their own
   * category since they aren't directly attached to groups and don't count
   * towards the group limit? ... I had them in specific groups in the builder
   * but they're more dynamic/fluid in gameplay."
   *
   * The rulebook agrees in three separate sentences (Gate, Shaltari Unit
   * Special Rules):
   *
   *   "Gates are always Transports but are not taken with any Units aboard."
   *   "Gates do not count against your number of allowed Groups."
   *   "A Gate is never part of another Group."
   *
   * Read off the printed rule, not off a list of ids, so a new Gate needs no
   * code. The token has to match EXACTLY: "Aux Gate" contains "Gate" and is a
   * different unit entirely -- a Firedrake, a Tegu, an Adamah are Auxiliary
   * Transports "taken as non-Gate Squads", which do join a Group and do count.
   * A substring test would have quietly taken all three out of the Group
   * count, which is the opposite of what their own rule says. */
  function isGate(unit) {
    return !!unit && String(unit.special || '').split(',')
      .some(t => t.trim() === 'Gate');
  }

  function gateSquad(army, squad) { return isGate(unitOf(army, squad)); }

  function groupsUsed(army) {
    return (army.groups || []).reduce((n, g) => {
      // "Gates do not count against your number of allowed Groups." A Group
      // that is nothing but Gates spends none of the allowance; a Group that
      // mixes them is illegal and is reported rather than discounted here.
      const squads = g.squads || [];
      if (squads.length && squads.every(s => gateSquad(army, s))) return n;
      const ge = squads.map(s => {
        const u = unitOf(army, s);
        return (u && u.groupEquivalent) || 0;
      }).filter(Boolean);
      return n + (ge.length ? Math.max.apply(null, ge) : 1);
    }, 0);
  }

  function groupOf(army, squadId) {
    return army.groups.find(g => g.squads.some(s => s.id === squadId)) || null;
  }

  function unitOf(army, squad) { return window.DZC.unit(army.faction, squad.unitId); }

  /* The Unit a Transport Squad IS, with the room its own upgrades cost it
   * already taken off. Every question about how much a Transport in an army
   * can carry goes through this rather than through unitOf, because the
   * Strikehawk that sold its capacity for missiles is a different carrier from
   * the one on the card and both are called "Strikehawk Tilt-Rotor". */
  function carrierOf(army, squad) {
    return window.DZC.carrierWithUpgrades(unitOf(army, squad), w => hasAnyUpgrade(squad, w.name));
  }

  function hasAnyUpgrade(squad, name) {
    const up = squad.upgrades || {};
    return Object.keys(up).some(k => up[k][name]);
  }

  /* What this Squad's models actually are and what it actually bought, in the
   * shape DZCUnits.unitWeapons wants.
   *
   * One definition, because the Squad row, the printed sheet, its rules
   * appendix and Play Mode must not disagree about what is in the Squad. And
   * the appendix is where disagreeing costs paper, since a rule collected off a
   * gun nobody fires is a paragraph printed for nothing. */
  function squadGuns(squad) {
    return {
      variants: squad.models.map(m => m.variant),
      hasUpgrade: w => hasAnyUpgrade(squad, w.name)
    };
  }

  // ------------------------------------------------------------- upgrades
  //
  // 3.2.3: a green name box is a paid Weapon upgrade, and "All Units of the
  // same Variant within a Squad must be upgraded equally". So an upgrade is
  // chosen PER VARIANT, not per model -- a different granularity from the
  // variants themselves, which are per model. Stored as
  //   squad.upgrades = { <variant or '*'>: { <weapon name>: true } }

  const ALL_VARIANTS = '*';

  /* Which upgrades this Squad may take, grouped by the variant they apply to.
   * A weapon with no variant bracket applies to every model in the Squad. */
  function upgradesFor(army, squad) {
    const u = unitOf(army, squad);
    if (!u) return [];
    const out = [];
    (u.weapons || []).forEach(w => {
      if (w.box !== 'upgrade' || w.upgradePoints == null) return;
      const scopes = (w.variants || []).length ? w.variants : [ALL_VARIANTS];
      scopes.forEach(scope => {
        // Only offer an upgrade for a variant this Squad actually fields.
        const n = scope === ALL_VARIANTS
          ? squad.models.length
          : squad.models.filter(m => m.variant === scope).length;
        if (n > 0) out.push({ weapon: w, scope: scope, count: n, points: w.upgradePoints });
      });
    });
    return out;
  }

  /* A gun that GAINS a variant bracket must not drop the purchases already
   * made against it.
   *
   * The Foeslayer was scoped to '*' until 2026-08-10, when the data caught up
   * with the card and restricted it to Menchit and Styx. Every saved army that
   * had bought one holds it under '*', and reading only the new scopes would
   * have taken the gun off the Squad and its points off the list without a
   * word -- the worst shape a data fix can take, because the list you printed
   * yesterday quietly stops matching the models in the case.
   *
   * So a purchase under '*' still counts, at whatever scopes the weapon names
   * now. The total moves, and correctly: it was being charged per model across
   * a whole mixed Squad, including the Ares that were never offered it. */
  function hasUpgrade(squad, scope, name) {
    if (!squad.upgrades) return false;
    if (squad.upgrades[scope] && squad.upgrades[scope][name]) return true;
    return !!(squad.upgrades[ALL_VARIANTS] && squad.upgrades[ALL_VARIANTS][name]);
  }

  /* Take or drop an upgrade. Where the card prints "Only one of these upgrades
   * may be taken", that is enforced rather than noted. */
  function toggleUpgrade(army, squadId, scope, name) {
    const s = findSquad(army, squadId);
    if (!s) return { ok: false, reason: 'Unknown Squad.' };
    const u = unitOf(army, s);
    s.upgrades = s.upgrades || {};
    s.upgrades[scope] = s.upgrades[scope] || {};

    // The legacy '*' record has to go with it, or a purchase inherited from
    // before the weapon named its variants cannot be sold back: the button
    // deletes an entry that was never there and hasUpgrade keeps saying yes.
    if (hasUpgrade(s, scope, name)) {
      delete s.upgrades[scope][name];
      if (s.upgrades[ALL_VARIANTS]) delete s.upgrades[ALL_VARIANTS][name];
      touch(army);
      return { ok: true, reason: null };
    }
    /* "Only one of these upgrades may be taken" applies to the STARRED ones.
     *
     * This used to read the footnote and refuse a second upgrade of any kind,
     * which is wrong on the only two cards in the game that print it. Both
     * Tritons list three upgrades and star two:
     *
     *     RM-1 Stealth Missile Battery (+10pts)
     *     Twin RX-20 Miniguns (+5pts*)
     *     RM-7 Skyhammer Missiles (+15pts*)
     *     *Only one of these upgrades may be taken.
     *
     * Jet, 2026-08-10: "With the Triton you can take the RM-1 with the RX-20 or
     * the RM-7. Just not the RX-20 with the RM-7." The star is the scope, the
     * scanner carries it as `exclusive`, and the clash is between two starred
     * upgrades rather than between any two at all. The RM-1 was being refused
     * alongside either of them, so the Triton's commonest loadout could not be
     * built.
     *
     * The refusal names both guns: "only one of these" is the card's wording,
     * and on a card with an unstarred third upgrade it does not say which two. */
    const starred = n => (u && u.weapons || []).some(w => w.name === n && w.exclusive);
    if (starred(name)) {
      const clash = Object.keys(s.upgrades)
        .reduce((all, k) => all.concat(Object.keys(s.upgrades[k])), [])
        .find(n => n !== name && starred(n));
      if (clash) {
        return { ok: false,
          reason: `${u.name}: only one of ${clash} and ${name} may be taken (3.2.3).` };
      }
    }
    s.upgrades[scope][name] = true;
    touch(army);
    return { ok: true, reason: null };
  }

  /* Points added by upgrades. Cost is per upgraded MODEL, and every model of
   * that variant is upgraded, because they must be upgraded equally. */
  function upgradeCost(army, squad) {
    if (!squad.upgrades) return 0;
    let total = 0;
    upgradesFor(army, squad).forEach(o => {
      if (hasUpgrade(squad, o.scope, o.weapon.name)) total += o.points * o.count;
    });
    return total;
  }

  // ------------------------------------------------------------------ costing

  /* A model costs what its VARIANT costs. 49 of 178 units have no unit-level
   * price at all -- they are priced per variant -- so falling back to
   * unit.points alone would silently cost those squads at zero. */
  function modelCost(u, model) {
    if (!u) return 0;
    if (model && model.variant) {
      const v = (u.variants || []).find(x => x.name === model.variant);
      if (v && v.points != null) return v.points;
    }
    if (u.points != null) return u.points;
    const ps = (u.variants || []).map(v => v.points).filter(p => p != null);
    return ps.length ? Math.min.apply(null, ps) : 0;
  }

  function levelCost(level) {
    const lv = (window.DZC.commanderLevels('reconquest') || []).find(l => l.level === level);
    return lv ? lv.points : 0;
  }

  /* A Commander is stored on the army now, but it still costs the Squad it
   * rides with. Charging it to the army instead would quietly change how the
   * quarter-of-the-limit Group cap (3.2) behaves, and that is a rules call,
   * not a refactor. Only the storage moved.
   *
   * A Commander with no Squad yet has no Group to charge, so it is added to
   * the army total directly, its points are spent either way. */
  function commandersCost(army) {
    return ((army && army.commanders) || [])
      .filter(c => !c.squadId).reduce((t, c) => t + levelCost(c.level), 0);
  }

  /* RAW MATERIALS, the Bioficer resource you may buy before the game.
   *
   * "Genitor Units may begin the game with up to X Raw Materials (RM) tokens
   * aboard them, and they may begin empty -- X is shown within their Transport
   * Symbol. When building your Army, RM tokens cost 5pts each and are assigned
   * to those Genitor Units. Their points contribute to their Group's total
   * cost but do not contribute towards any category." (Genitor X, Bioficer
   * Unit Special Rules.)
   *
   * WHAT MAKES A GENITOR. The rule identifies them by the symbol and nothing
   * else: a Bioficer Unit with a HOLLOW GREEN SQUARE, and the number in it is
   * the cap. There is no "Genitor" entry in a Unit's special rules to read --
   * the Ark's say "Puppeteer 6", Skimmer, Surveyor" -- so the symbol is the
   * only place this fact lives. A square capacity alone will not do: a UCM
   * Raven Light Troopship has square 2 and is not a Genitor, because the
   * colour is what the rule is naming and the colour is the faction.
   *
   * Two Units qualify today: Grievance Genitor Ark 12, Gyro Aero-Genitor 8.
   * Read off the data rather than listed here, so a new card needs no code. */
  const RM_POINTS = 5;

  function genitorCap(army, squad) {
    if (!army || army.faction !== 'bioficer') return 0;
    const u = unitOf(army, squad);
    if (!u) return 0;
    /* capacityFor is PER MODEL -- the hollow green square on one Gyro's own
     * card. Reported 2026-08-09: a second Gyro added to the Squad left the
     * cap sitting at 8 while the Squad's RM total read 16, because nothing
     * here was multiplying by how many Genitors are actually in the Squad. */
    return window.DZC.capacityFor(u, 'square') * squad.models.length;
  }

  function rmOf(squad) {
    const n = Number(squad && squad.rm) || 0;
    return n > 0 ? Math.floor(n) : 0;
  }

  function rmCost(squad) {
    return rmOf(squad) * RM_POINTS;
  }

  /* Refused with the rule, not clamped. Everywhere else in this builder that
   * cannot do what you asked says why (3.2), and a stepper that silently
   * stops at 12 is the dead control canSetCount was fixed for. */
  function setRm(army, squadId, n) {
    const s = findSquad(army, squadId);
    if (!s) return { ok: false, reason: 'Unknown Squad.' };
    const cap = genitorCap(army, s);
    const u = unitOf(army, s);
    if (!cap) {
      return { ok: false,
        reason: `${u ? u.name : 'This Unit'} is not a Genitor: RM tokens are assigned to Units with a hollow green square.` };
    }
    const want = Math.floor(Number(n) || 0);
    if (want < 0) return { ok: false, reason: 'A Genitor may begin empty, but not below zero.' };
    if (want > cap) {
      return { ok: false,
        reason: `${u.name} may never have more than ${cap} RM tokens aboard.` };
    }
    s.rm = want;
    if (!want) delete s.rm;
    touch(army);
    return { ok: true, reason: null };
  }

  function squadCost(army, squad) {
    const u = unitOf(army, squad);
    const c = commanderFor(army, squad.id);
    return squad.models.reduce((t, m) => t + modelCost(u, m), 0)
      + upgradeCost(army, squad) + rmCost(squad) + (c ? levelCost(c.level) : 0);
  }

  function groupCost(army, group) {
    return group.squads.reduce((t, s) => t + squadCost(army, s), 0);
  }

  /* What a Group costs for the COMPOSITION rules, which is not what it costs.
   *
   * 3.2.5, on a Commander: "The Commander's points combine with that Unit's
   * points during games but are ignored during Army composition besides
   * counting towards your total allowed points."
   *
   * Two halves, and only one of them was implemented. categorySpend already
   * leaves Commanders out, which is the Standard/Vanguard/Heavy/Support half.
   * The quarter-of-your-points cap is an Army composition rule too (3.2) and
   * it was being checked against the full Group cost, so 430pts of tanks plus
   * a Level 6 Commander read 580 against a 500 cap and the list was called
   * illegal. Composition sees 430 and it is legal.
   *
   * RM stays IN. Its own rule is the opposite way round and says so: "Their
   * points contribute to their Group's total cost but do not contribute
   * towards any category" (Genitor X). Group cost yes, category no. */
  function groupCompositionCost(army, group) {
    return group.squads.reduce((t, s) => {
      const c = commanderFor(army, s.id);
      return t + squadCost(army, s) - (c ? levelCost(c.level) : 0);
    }, 0);
  }

  function armyCost(army) {
    return army.groups.reduce((t, g) => t + groupCost(army, g), 0) + commandersCost(army);
  }

  /* Category spend, for the ratio checks. Commander points are counted toward
   * the TOTAL but ignored here -- 3.2.5 says so explicitly, and including them
   * would let a Commander push Vanguard over Standard on paper. */
  function categorySpend(army) {
    const out = {};
    army.groups.forEach(g => g.squads.forEach(s => {
      const u = unitOf(army, s);
      if (!u) return;
      const c = (u.category || '').toLowerCase();
      /* RM is deliberately absent. "Their points contribute to their Group's
       * total cost but do not contribute towards any category" (Genitor X),
       * so buying 12 RM onto a Standard Ark must not move Standard up and
       * quietly buy you 60pts of Vanguard against it. squadCost adds them;
       * this does not, and the difference is the rule. */
      out[c] = (out[c] || 0) + s.models.reduce((t, m) => t + modelCost(u, m), 0)
        + upgradeCost(army, s);
    }));
    return out;
  }

  // --------------------------------------------------------------- validation

  /* Every check cites its rulebook section, because a builder that says "no"
   * without saying why is worse than one that says nothing. */
  function validate(army) {
    const errors = [];
    const warnings = [];
    const idx = window.DZC.index;
    if (!idx) return { errors, warnings, ok: true };

    const limit = army.pointsLimit;
    const size = window.DZC.gameSizeFor(limit);
    const total = armyCost(army);

    if (!size) {
      errors.push({ rule: '3.1', msg: `${limit}pts is below the 501pt minimum for a game.` });
    }
    if (total > limit) {
      errors.push({ rule: '3.1', msg: `${total}pts spent, ${limit}pt limit, ${total - limit} over.` });
    }

    if (size) {
      const maxG = window.DZC.maxGroups(size, limit);
      const used = groupsUsed(army);
      if (used > maxG) {
        // Says the card count too when a Behemoth has made the two differ,
        // or "9 Groups, but Clash allows 12" reads as a bug.
        const how = used === army.groups.length ? `${used} Groups`
          : `${army.groups.length} Groups counting as ${used} (Behemoths count as several, 1.1)`;
        errors.push({ rule: '3.1', msg: `${how}, but ${size.label} allows ${maxG}.` });
      }
      const cap = window.DZC.maxGroupCost(limit);
      army.groups.forEach(g => {
        // Composition cost, not cost: a Commander's points are ignored here
        // (3.2.5). See groupCompositionCost.
        const c = groupCompositionCost(army, g);
        if (c > cap) {
          errors.push({ rule: '3.2', group: g.id, msg: `“${groupName(army, g)}” costs ${c}pts. No Group may exceed a quarter of the limit (${cap}pts).` });
        }
      });
    }

    // Vanguard, Heavy and Support may EACH not exceed Standard.
    const spend = categorySpend(army);
    const std = spend.standard || 0;
    ['vanguard', 'heavy', 'support'].forEach(c => {
      if ((spend[c] || 0) > std) {
        errors.push({ rule: '3.2', msg: `${cap1(c)} spend (${spend[c]}pts) exceeds Standard (${std}pts).` });
      }
    });

    /* "A Gate is never part of another Group." Its own sentence in its own
     * rule, and the reason Jet noticed: a Gate sitting in a Group reads as
     * belonging to those Squads, and at the table it belongs to nobody --
     * "any number of them which have not yet been activated that Round may be
     * activated together with any non-Gate Group."
     *
     * Two ways to break it, and both are reported rather than fixed: a Gate
     * beside other Squads, and a Squad put inside one. */
    army.groups.forEach(g => {
      const gates = g.squads.filter(s => gateSquad(army, s));
      const rest = g.squads.filter(s => !gateSquad(army, s));
      if (gates.length && rest.length) {
        errors.push({ rule: 'Gate', group: g.id,
          msg: `${unitOf(army, gates[0]).name}: a Gate is never part of another Group.` });
      }
      gates.forEach(t => {
        const aboard = g.squads.filter(x => x.carriedBy === t.id);
        const u = unitOf(army, t);
        if (aboard.length && u) {
          errors.push({ rule: 'Gate', group: g.id,
            msg: `${u.name}: Gates are not taken with any Units aboard. A Squad starts in Holding instead.` });
        }
      });
    });

    /* Two Squads split across a Transport SQUAD. 3.2.4.1 shares ONE Transport
     * and 3.2.4.3 exempts Auxiliary Transports, so this is only ever a Squad
     * of two or more Transport-category models with more than one Squad
     * riding it. boardOptions refuses it now, so nothing you can press builds
     * one -- this is for a link, a backup, or a list built before the check. */
    army.groups.forEach(g => {
      const riders = {};
      g.squads.forEach(s => { if (s.carriedBy) (riders[s.carriedBy] = riders[s.carriedBy] || []).push(s); });
      Object.keys(riders).forEach(id => {
        if (riders[id].length < 2) return;
        const t = g.squads.find(x => x.id === id);
        const tu = t && carrierOf(army, t);
        if (!tu || canShare(tu, t, riders[id].slice(1))) return;
        errors.push({ rule: '3.2.4.1', group: g.id,
          msg: `${tu.name}: ${riders[id].length} Squads aboard a Squad of ${t.models.length}. Up to 4 Squads may share ONE Transport.` });
      });
    });

    /* More RM aboard than the symbol allows. Reachable by a share link, an
     * imported backup, or a card whose capacity has been reduced between
     * releases -- setRm refuses it, so nothing you can press gets here. */
    army.groups.forEach(g => g.squads.forEach(s => {
      const held = rmOf(s);
      if (!held) return;
      const cap = genitorCap(army, s);
      const u = unitOf(army, s);
      if (!u) return;
      if (!cap) {
        errors.push({ rule: 'Genitor X', group: g.id,
          msg: `${u.name} holds ${held} RM but is not a Genitor.` });
      } else if (held > cap) {
        errors.push({ rule: 'Genitor X', group: g.id,
          msg: `${u.name} holds ${held} RM. It may never have more than ${cap} aboard.` });
      }
    }));

    // Rare / Unique, counted by NAME across the whole army.
    const byName = {};
    army.groups.forEach(g => g.squads.forEach(s => {
      const u = unitOf(army, s);
      if (u) (byName[u.name] = byName[u.name] || []).push(u);
    }));
    Object.keys(byName).forEach(name => {
      const u = byName[name][0], n = byName[name].length;
      if (u.unique && n > 1) {
        errors.push({ rule: '3.2.1', msg: `${name} is Unique: only one may be taken (${n} present).` });
      } else if (u.rare && size) {
        const lim = window.DZC.rareLimit(size.id);
        if (n > lim) {
          errors.push({ rule: '3.2.1', msg: `${name} is Rare: ${size.label} allows ${lim} (${n} present).` });
        }
      }
    });

    // Squad sizes. Transports have none by design, so a missing size is only
    // reported for units that should have one.
    army.groups.forEach(g => g.squads.forEach(s => {
      const u = unitOf(army, s);
      if (!u) return;
      const n = s.models.length;
      if (u.squadMin != null && n < u.squadMin) {
        errors.push({ rule: '2', group: g.id, msg: `${u.name}: ${n} model${n === 1 ? '' : 's'}, minimum is ${u.squadMin}.` });
      }
      if (u.squadMax != null && n > u.squadMax) {
        errors.push({ rule: '2', group: g.id, msg: `${u.name}: ${n} models, maximum is ${u.squadMax}.` });
      }
    }));

    /* THERE IS NO 3000pt RULE. Removed 2026-08-10.
     *
     * This used to refuse every Behemoth in a game under 3000pts, citing
     * "Behemoths are so huge that they can only be taken in 3000+ point games"
     * as Behemoth rules chapter 1. That sentence is real, and it is the only
     * time 3000 appears anywhere in the document, but it is the INTRODUCTION,
     * two lines after "these are not recommended for new players since they
     * are quite complex" -- and it says SOME Behemoths. Neither the rules nor
     * any of the eleven stat cards ever says which, so there was nothing to
     * enforce and the app enforced it against all of them.
     *
     * What actually limits a Behemoth is 1.1, and it is already enforced: "A
     * Behemoth counts as that many Groups when building your Army and
     * generating Pass tokens but counts as 1 Group for the 'no Group may cost
     * more than 1/4 of your total allowed pts' rule." That is the quarter cap
     * above, and it does the real work -- a 1750pt game allows 437, so a
     * Behemoth over that is refused on its cost and one under it is legal.
     *
     * Reported by Jet, 2026-08-10, against a 410pt UCM Light Battle Mech in a
     * 1750pt list: "This tag is incorrect, the Light is 410pts so under the
     * 1/4 restriction." 410 of 437, and the app was calling it illegal. */

    /* WHICH GROUP AN ISSUE BELONGS TO. Jet, 2026-08-07: "new rule: alerts live
     * on the group card."
     *
     * Every message raised inside a `army.groups.forEach` carries `group: g.id`
     * from here down, so the builder can put it where the thing that is wrong
     * actually is. The ones with no group, the points limit, the Commander,
     * the category ratio, are facts about the ARMY and have nowhere else to
     * go, so they stay in the rail. */
    // Transports: only alongside a Squad they can carry, and taken FULL.
    army.groups.forEach(g => {
      g.squads.forEach(s => {
        const u = carrierOf(army, s);
        if (!u || u.category !== 'Transport') return;
        /* A Gate is EXEMPT from both of these. "Gates are always Transports
         * but are not taken with any Units aboard" -- so an empty one is the
         * correct and only way to take it, and "carries nothing" was a
         * permanent error printed on every properly built Shaltari list. */
        if (isGate(u)) return;
        const cargo = g.squads.filter(x => x.carriedBy === s.id)
          .map(x => ({ unit: unitOf(army, x), count: x.models.length }))
          .filter(x => x.unit);
        if (!cargo.length) {
          errors.push({ rule: '3.2.4', group: g.id, msg: `${u.name}: carries nothing. A Transport may only be taken alongside a Squad it can carry.` });
          return;
        }
        // s.models.length is how many of that Transport the Squad holds, and
        // "as many identical Transports as needed" (3.2.4) means their capacity
        // adds up. Without it, every Group needing two reported as illegal.
        const chk = window.DZC.loadCheck(u, cargo, s.models.length);
        if (!chk.ok) errors.push({ rule: '3.2.4.2', group: g.id, msg: chk.reason });
        else if (!window.DZC.isFull(u, cargo, s.models.length)) {
          errors.push({ rule: '3.2.4', group: g.id, msg: `${u.name}: not full. Transports must be taken full.` });
        }
      });

      // Auxiliary Transports need NOT be full, but still cannot be overloaded,
      // and a carried Squad may not be split across several of them (3.2.4.3).
      g.squads.forEach(s => {
        const u = carrierOf(army, s);
        if (!u || u.category === 'Transport' || !u.auxiliaryTransport) return;
        const cargo = g.squads.filter(x => x.carriedBy === s.id)
          .map(x => ({ unit: unitOf(army, x), count: x.models.length }))
          .filter(x => x.unit);
        if (cargo.length) {
          const chk = window.DZC.loadCheck(u, cargo, s.models.length);
          if (!chk.ok) errors.push({ rule: '3.2.4.3', group: g.id, msg: chk.reason });
        }
      });

      /* A Group is one Squad and its Transports, or up to 4 Squads sharing one
       * larger Transport (3.2.4 / 3.2.4.1). Two Squads standing side by side
       * with nothing carrying either of them is not a Group. But it is a
       * perfectly ordinary state to pass through while building, so it is
       * reported when you are done rather than blocked as you go. */
      const loose = g.squads.filter(s => {
        const u = unitOf(army, s);
        return u && u.category !== 'Transport' && !s.carriedBy;
      });
      /* AND IT SAYS WHAT TO DO ABOUT IT.
       *
       * This is the message Grotwurks hit in the 2026-08-09 thread. He added a
       * Triton X Gunship next to a Medusa, meaning to put one inside the
       * other, and got "Group 1 has 2 Squads with nothing carrying them" the
       * instant the second Squad landed. "Oh look, now I have an error", then
       * "I did select add unit... I then selected the Triton X. Now I have an
       * error." Baxter could not reproduce it and called it a bug, then said
       * it was not one. Neither of them could tell whether the app was broken.
       *
       * The refusal was correct and it named its rule, which is the house
       * standard. What it did not name was the move: the Triton X carries two
       * squares, the Medusa fills two, and one tap of the Medusa's Transport
       * button clears the whole thing. So when a pair in this Group can
       * actually solve it, the message says which pair and which way round --
       * that is boardOptions, the same list the button opens, so it can only
       * suggest something that will work. When no pair fits, the fix is a
       * Transport or a second Group, and it says that instead.
       *
       * It stays an ERROR. 3.2.4 makes the list illegal and a legality check
       * that goes quiet to feel friendlier is worth nothing at a table. What
       * was wrong was a message that read as a fault in the app. */
      if (loose.length > 1) {
        let fix = 'Put one aboard the other, give one a Transport, or move one to a Group of its own.';
        for (const rider of loose) {
          const opt = boardOptions(army, rider.id)
            .find(o => loose.some(l => l.id === o.squad.id));
          if (!opt) continue;
          const ru = unitOf(army, rider);
          fix = `Put the ${ru.name} aboard the ${opt.unit.name}.`;
          break;
        }
        errors.push({
          rule: '3.2.4',
          group: g.id,
          msg: `“${groupName(army, g)}” has ${loose.length} Squads with nothing carrying them. A Group is one Squad and its Transports, `
            + `or up to 4 Squads sharing one larger Transport. ${fix}`
        });
      }

      // Up to 4 Squads may share ONE Transport (3.2.4.1).
      g.squads.forEach(s => {
        const riders = g.squads.filter(x => x.carriedBy === s.id).length;
        if (riders > 4) {
          const u = unitOf(army, s);
          errors.push({ rule: '3.2.4.1', group: g.id, msg: `${u ? u.name : 'Transport'} carries ${riders} Squads: at most 4 may share one Transport.` });
        }
      });
    });

    // Commanders.
    const cmdrs = (army.commanders || []).slice();
    if (!cmdrs.length) {
      errors.push({ rule: '3.2.5', msg: 'You haven\'t added a Commander. Your army must contain at least one.' });
    }
    if (size) {
      const allowed = window.DZC.commanderLevels(size.id).map(l => l.level);
      cmdrs.forEach(c => {
        if (allowed.indexOf(c.level) === -1) {
          errors.push({ rule: '3.2.5', msg: `A Level ${c.level} Commander is not allowed in ${size.label}.` });
        }
      });
    }
    // Bought but riding with nobody. A Commander is assigned to a Unit
    // (3.2.5), so one sitting on the shelf is as illegal as not having one,
    // and the builder holds both back until the list is half spent rather
    // than nagging about them from the first Squad.
    cmdrs.filter(c => !c.squadId).forEach(c => {
      errors.push({ rule: '3.2.5', msg: `Your Level ${c.level} Commander is not with a Squad yet.` });
    });
    /* Riding with a Unit that may never carry one (10.1.12, 10.1.20).
     * assignCommander refuses this now, so it cannot be built here. But an
     * army arriving from a share link or from storage predates that refusal,
     * and validate is where an army the app did not build is checked. */
    cmdrs.filter(c => c.squadId).forEach(c => {
      const s = findSquad(army, c.squadId);
      const ban = s && commanderBan(unitOf(army, s));
      if (ban) errors.push({ rule: '10.1.12', msg: ban.reason });
    });

    /* NOTHING IS SAID ABOUT WHO BEGINS RESERVED. Jet, 2026-08-13:
     * "remove this warning."
     *
     * It counted every Squad not aboard an Aircraft and warned that they
     * begin Reserved (9.4). True, and not a problem with the list -- it is
     * how deployment works, restated. On a normal army it fired on most of
     * the Squads in it, so the warning panel opened with a line that reads
     * the same every game and says nothing about what you just built.
     *
     * The walk that worked out who was flying is gone with it rather than
     * left sitting unused; 9.4's nested-carrier clause is in the history if
     * this ever comes back as something printed on the sheet instead. */

    // Group count is not activation count (4.1.2 / 4.2.1).
    const transportOnly = army.groups.filter(g => g.squads.length && g.squads.every(s => {
      const u = unitOf(army, s);
      return u && u.category === 'Transport';
    })).length;
    if (transportOnly) {
      // "1 Group contain only Transports", the verb has to agree with the
      // count as well as the noun.
      warnings.push({ rule: '4.2.2', msg: transportOnly === 1
        ? '1 Group contains only Transports. It cannot be activated normally and is ignored for Pass tokens.'
        : `${transportOnly} Groups contain only Transports. They cannot be activated normally and are ignored for Pass tokens.` });
    }

    return { errors, warnings, ok: !errors.length };
  }

  const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);

  window.DZCArmy = {
    load, save, all, get, create, remove, touch, setPointsLimit, setDescription,
    importArmies, importList, parseList, generate,
    addGroup, removeGroup, duplicateGroup, moveGroup, groupName, renameGroup,
    commanderName, renameCommander, addSquad, removeSquad, setModelCount, setModelVariant,
    canShiftVariant, shiftVariant, canAdjustVariantCount, adjustVariantCount,
    setCarrier, moveSquad, setCommander, findSquad, groupOf, unitOf, carrierOf, squadGuns,
    commanders, commanderFor, commanderTargets,
    addCommander, removeCommander, assignCommander, syncCommanders, levelCost,
    modelCost, squadCost, groupCost, groupCompositionCost, armyCost, categorySpend, validate,
    // Raw Materials (Genitor X)
    genitorCap, rmOf, rmCost, setRm, RM_POINTS,
    // Shaltari Gates (Gate, Shaltari Unit Special Rules)
    isGate, gateSquad,
    // enforcement
    canAddUnit, canSetCount, squadsNamed, squadFill,
    upgradesFor, hasUpgrade, toggleUpgrade, upgradeCost,
    transportOptions, assignTransport, refitTransports, groupSpace, groupsUsed,
    boardOptions, boardTransport
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.DZCArmy;
})();
