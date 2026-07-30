/* DZC data layer — loads data/dzc/ and answers questions about it.
 *
 * The app reads the scanner's output NATIVELY. There is deliberately no
 * translation into the old Dropfleet shape: that would mean two canonical
 * formats and a mapping layer that has to lie (Mv->thrust, DP->hull) to keep
 * the old renderers quiet. One source of truth, and it is what the PDFs said.
 *
 * Three files, all produced by tools/dzc/rebuild.py:
 *
 *   data/dzc/index.json         game sizes, category caps, commander levels
 *   data/dzc/faction-<id>.json  units, weapons, variants, transport symbols
 *   data/dzc/rules.json         the glossary, core + per-faction
 *
 * Loaded by both apps, so army construction can never mean two different
 * things on desktop and phone.
 */
(function () {
  'use strict';

  const BASE = 'data/dzc';

  const state = {
    index: null,
    rules: null,
    factions: {},        // id -> parsed faction file
    _loading: {}
  };

  // Data must revalidate: the filename is stable across the monthly re-scan, so
  // without this a cached copy survives a data fix indefinitely.
  const FETCH_OPTS = { cache: 'no-cache' };

  async function getJSON(path) {
    const res = await fetch(path, FETCH_OPTS);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  }

  async function loadIndex() {
    if (state.index) return state.index;
    if (!state._loading.index) {
      state._loading.index = Promise.all([
        getJSON(`${BASE}/index.json`),
        getJSON(`${BASE}/rules.json`)
      ]).then(([idx, rules]) => {
        state.index = idx;
        state.rules = compileRules(rules);
        return idx;
      });
    }
    return state._loading.index;
  }

  async function loadFaction(id) {
    if (state.factions[id]) return state.factions[id];
    if (!state._loading[id]) {
      state._loading[id] = getJSON(`${BASE}/faction-${id}.json`).then(f => {
        f.byId = {};
        (f.units || []).forEach(u => { f.byId[u.id] = u; });
        state.factions[id] = f;
        return f;
      });
    }
    return state._loading[id];
  }

  // ------------------------------------------------------------ rules glossary

  // Misspellings in TTCombat's published PDFs, corrected on lookup only. Kept
  // in step with tools/dzc/audit_rules.py -- the audit proves every keyword
  // resolves, and it can only prove it for the rules THIS resolver applies.
  const KNOWN_TYPOS = {
    infliltrate: 'Infiltrate',
    devastor: 'Devastator',
    precison: 'Precision'
  };
  const TYPO_RE = new RegExp('\\b(' + Object.keys(KNOWN_TYPOS).join('|') + ')\\b', 'gi');
  const VARIANT_TAIL = /\s*\([^)]*\)\s*$/;

  function compileRules(doc) {
    const all = (doc.rules || []).map(r => ({
      id: r.id,
      faction: r.faction || null,
      name: r.name,
      alias: r.alias || null,
      text: r.text,
      section: r.section,
      parameterised: !!r.parameterised,
      re: new RegExp(r.match, 'i')
    }));
    return {
      all,
      core: all.filter(r => !r.faction),
      byFaction: all.reduce((m, r) => {
        if (r.faction) (m[r.faction] = m[r.faction] || []).push(r);
        return m;
      }, {})
    };
  }

  function fixTypos(s) {
    return s.replace(TYPO_RE, m => KNOWN_TYPOS[m.toLowerCase()]);
  }

  /* Resolve one printed keyword to its glossary entry.
   *
   * A unit's OWN faction is searched first: "Grav" is a Shaltari rule, and a
   * faction rule must beat a core one of the same name. Exact names beat
   * wildcard templates, or the open-ended "Ev X" would swallow anything
   * starting "Ev". */
  function rule(keyword, faction) {
    if (!state.rules || !keyword) return null;
    const t = fixTypos(String(keyword).trim());
    if (!t) return null;
    const pools = [state.rules.byFaction[faction] || [], state.rules.core];
    const tries = [t, t.replace(VARIANT_TAIL, '')];
    for (const cand of tries) {
      const c = cand.trim();
      if (!c) continue;
      for (const pool of pools) {
        for (const r of pool) {
          if (c.toLowerCase() === r.name.toLowerCase()) return r;
          if (r.alias && c.toLowerCase() === r.alias.toLowerCase()) return r;
        }
      }
      for (const pool of pools) {
        for (const r of pool) if (r.re.test(c)) return r;
      }
    }
    return null;
  }

  /* Split a card's Special line into keywords.
   *
   * A comma is the usual separator, but some rule names CONTAIN one --
   * "Repair 1: Vehicles, Zones" is a single rule. So a piece is merged with
   * what follows only when it does not resolve alone, never past a piece that
   * does, and by the shortest merge that works. A greedy version swallowed
   * Dogs, Lethal and Stealth into a preceding open wildcard. */
  function splitSpecial(special, faction) {
    const pieces = String(special || '').split(',').map(s => s.trim()).filter(Boolean);
    const out = [];
    let i = 0;
    while (i < pieces.length) {
      if (rule(pieces[i], faction)) {
        // The head resolves, but a trailing wildcard may still own what
        // follows: "Ineffective: Friendlies, Zones" is ONE rule with a
        // comma-separated target list. Extend only over pieces that cannot
        // stand alone, so Zones and Vehicles are absorbed while Dogs, Lethal
        // and Stealth -- which are rules in their own right -- never are.
        let end = i + 1;
        for (let j = i + 2; j <= pieces.length; j++) {
          if (rule(pieces[j - 1], faction)) break;
          if (rule(pieces.slice(i, j).join(', '), faction)) end = j;
        }
        out.push(pieces.slice(i, end).join(', '));
        i = end;
        continue;
      }
      let merged = null;
      for (let j = i + 2; j <= pieces.length; j++) {
        if (pieces.slice(i + 1, j).some(p => rule(p, faction))) break;
        const cand = pieces.slice(i, j).join(', ');
        if (rule(cand, faction)) { merged = [cand, j]; break; }
      }
      if (merged) { out.push(merged[0]); i = merged[1]; }
      else { out.push(pieces[i]); i++; }
    }
    return out;
  }

  // --------------------------------------------------------- transport nesting

  /* Can `carrier` carry `passenger`, and how much room does it take?
   *
   * Shape is what decides legality (rulebook 3.2.4.2), so an upright triangle
   * and an inverted one are NOT interchangeable -- that distinction is the
   * whole reason the scanner separates them.
   *
   * capacityMode says how multiple capacity symbols combine:
   *   "both"   (printed +)  the shapes are carried simultaneously
   *   "either" (printed /)  one shape or the other, never a mixture
   */
  function capacityFor(carrier, shape) {
    const cap = (carrier.transport && carrier.transport.capacity) || [];
    const hit = cap.find(c => c.shape === shape);
    return hit ? hit.n : 0;
  }

  function fillsOf(unit) {
    return (unit.transport && unit.transport.fills) || [];
  }

  function canCarry(carrier, passenger) {
    return fillsOf(passenger).some(f => capacityFor(carrier, f.shape) > 0);
  }

  /* Space used in `carrier` by a list of {unit, count} passengers.
   *
   * Returns { ok, byShape, mode, reason }. When a carrier is "either", a load
   * mixing two of its shapes is illegal however much room is left. */
  function loadCheck(carrier, passengers) {
    const mode = (carrier.transport && carrier.transport.capacityMode) || null;
    const byShape = {};
    for (const p of passengers) {
      // A Unit with two solid symbols separated by "/" may use EITHER, so the
      // cheapest legal fit is taken rather than the first listed.
      const opts = fillsOf(p.unit).filter(f => capacityFor(carrier, f.shape) > 0);
      if (!opts.length) {
        return { ok: false, byShape, mode,
                 reason: `${p.unit.name} cannot be carried by ${carrier.name}` };
      }
      const best = opts.reduce((a, b) => (b.n < a.n ? b : a));
      byShape[best.shape] = (byShape[best.shape] || 0) + best.n * (p.count || 1);
    }
    const used = Object.keys(byShape);
    if (mode === 'either' && used.length > 1) {
      return { ok: false, byShape, mode,
               reason: `${carrier.name} carries either ${used.join(' or ')}, not a mixture` };
    }
    for (const shape of used) {
      const room = capacityFor(carrier, shape);
      if (byShape[shape] > room) {
        return { ok: false, byShape, mode,
                 reason: `${carrier.name} has ${room} ${shape} capacity, needs ${byShape[shape]}` };
      }
    }
    return { ok: true, byShape, mode, reason: null };
  }

  /* Transports must be taken FULL (3.2.4). Auxiliary Transports need not be. */
  function isFull(carrier, passengers) {
    const chk = loadCheck(carrier, passengers);
    if (!chk.ok) return false;
    const shapes = Object.keys(chk.byShape);
    if (!shapes.length) return false;
    return shapes.every(s => chk.byShape[s] === capacityFor(carrier, s));
  }

  // -------------------------------------------------------------- army limits

  function gameSizeFor(points) {
    const sizes = (state.index && state.index.gameSizes) || [];
    return sizes.find(g => points >= g.min && (g.max == null || points <= g.max)) || null;
  }

  function maxGroups(gameSize, agreedLimit) {
    if (!gameSize) return 0;
    let n = gameSize.maxGroups;
    const extra = gameSize.groupsPerExtra;
    if (extra && agreedLimit > extra.above) {
      n += Math.floor((agreedLimit - extra.above) / extra.per) * extra.add;
    }
    return n;
  }

  /* The per-Group cost cap is a quarter of the AGREED limit, not a quarter of
   * the top of the band -- so the agreed number has to be an input. */
  function maxGroupCost(agreedLimit) {
    const f = state.index && state.index.armyRules
      && state.index.armyRules.groupCostCap
      && state.index.armyRules.groupCostCap.fraction;
    return Math.floor(agreedLimit * (f || 0.25));
  }

  function rareLimit(gameSizeId) {
    const r = state.index && state.index.armyRules && state.index.armyRules.rare;
    return (r && r.limits && r.limits[gameSizeId]) || 1;
  }

  function commanderLevels(gameSizeId) {
    const c = state.index && state.index.armyRules && state.index.armyRules.commanders;
    return ((c && c.levels) || []).filter(l => l.allowedIn.indexOf(gameSizeId) !== -1);
  }

  const api = {
    loadIndex, loadFaction,
    get index() { return state.index; },
    get rules() { return state.rules; },
    faction: id => state.factions[id],
    unit: (fid, uid) => (state.factions[fid] || { byId: {} }).byId[uid],
    rule, splitSpecial,
    capacityFor, fillsOf, canCarry, loadCheck, isFull,
    gameSizeFor, maxGroups, maxGroupCost, rareLimit, commanderLevels,
    _state: state, _compileRules: compileRules
  };

  if (typeof window !== 'undefined') window.DZC = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
