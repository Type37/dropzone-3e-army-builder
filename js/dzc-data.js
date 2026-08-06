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

  /* Relative to the document, so a page that is not index.html has to say where
   * the data is. `ref/sheet.html` is the only one that does — the printable
   * quick reference reads the same three files as the app, and duplicating the
   * loader there would be a second copy of the glossary resolver. */
  const BASE = (typeof window !== 'undefined' && window.DZC_DATA_BASE) || 'data/dzc';

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

  /* The Behemoths are their own file, not a seventh faction's.
   *
   * The cards do not print a faction and none is inferred, so they load as
   * "behemoth" and read as one set. Every other path treats them like any
   * other faction file, which is why the id maps to a filename rather than
   * getting a branch of its own everywhere downstream. */
  const FILE_FOR = id => (id === 'behemoth' ? 'behemoths' : `faction-${id}`);

  async function loadFaction(id) {
    if (state.factions[id]) return state.factions[id];
    if (!state._loading[id]) {
      state._loading[id] = getJSON(`${BASE}/${FILE_FOR(id)}.json`)
        .then(async f => {
          /* A faction's Behemoths live in behemoths.json, not in its stat-card
           * file, because TTCombat ship them as a separate release. They are
           * still that faction's Units: two Heavy choices each, priced in
           * points and legal in its army.
           *
           * Merged in here rather than special-cased downstream. The picker,
           * the costing, the category ratio, validate, share links and the
           * printed sheet all ask DZC.faction(id) for a list of Units; a
           * Behemoth that is anything other than an ordinary member of that
           * list is a branch in every one of them. */
          if (id !== 'behemoth') {
            const b = await getJSON(`${BASE}/behemoths.json`).catch(() => null);
            if (b) f.units = (f.units || []).concat(
              (b.units || []).filter(u => u.faction === id));
          }
          f.byId = {};
          (f.units || []).forEach(u => { f.byId[u.id] = u; });
          state.factions[id] = f;
          return f;
        });
    }
    return state._loading[id];
  }

  // linkKeywords returns MARKUP, so it escapes its own input rather than
  // trusting the caller to have done it -- everything else here returns text.
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------ rules glossary

  // Misspellings in TTCombat's published PDFs, corrected on lookup only. Kept
  // in step with tools/dzc/audit_rules.py -- the audit proves every keyword
  // resolves, and it can only prove it for the rules THIS resolver applies.
  const KNOWN_TYPOS = {
    infliltrate: 'Infiltrate',
    devastor: 'Devastator',
    precison: 'Precision',
    // Scourge Hyperbio Cannon, on the Death Mech's card.
    ineffecive: 'Ineffective'
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
      /* Which DOCUMENT the page is in, because "core" stopped meaning "in the
       * rulebook" when the Behemoth supplement's rules joined it: Macro and
       * Huge Blast are how Behemoths work rather than a faction's trick, but
       * that book's p.4 is not the rulebook's p.4. */
      source: r.source || null,
      /* A faction rule's page is not worth printing. It is scanned from that
       * faction's own stat-card PDF where the rules block is always page 1,
       * and citing "p.1" would read as a rulebook page it is not. */
      page: r.faction ? null : (r.page || null),
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
  function resolve(keyword, faction) {
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
          if (c.toLowerCase() === r.name.toLowerCase()) return { rule: r, cand: c };
          if (r.alias && c.toLowerCase() === r.alias.toLowerCase()) return { rule: r, cand: c };
        }
      }
      for (const pool of pools) {
        for (const r of pool) if (r.re.test(c)) return { rule: r, cand: c };
      }
    }
    return null;
  }

  function rule(keyword, faction) {
    const hit = resolve(keyword, faction);
    return hit ? hit.rule : null;
  }

  /* Rule names found INSIDE prose, so a rule that sends you to another rule is
   * tappable where it says so.
   *
   * Overcharge ends "...this weapon counts as a High Power weapon", and High
   * Power is its own glossary entry — the chips on the card do not carry it,
   * because the card never printed it, so the only way to it was to know it
   * existed and go looking. Dropfleet solved the same problem with
   * linkKeywords (app.js:3566).
   *
   * Longest name first, so "High Power" is not eaten by a shorter entry that
   * happens to start the same way, and each match is skipped once wrapped so
   * nothing nests. Parameterised entries ("Aegis X\"") are left out: their
   * names contain the placeholder rather than anything prose ever says.
   *
   * `skip` is the rule you are already reading — a definition that links to
   * itself is a circle, and the popover is already headed with its name. */
  function linkKeywords(text, faction, skip) {
    const t = String(text == null ? '' : text);
    if (!state.rules || !t) return esc(t);
    const pool = (state.rules.byFaction[faction] || []).concat(state.rules.core)
      .filter(r => !(skip && r.name.toLowerCase() === String(skip).toLowerCase()));
    if (!pool.length) return esc(t);
    /* Aliases are in, and they are not a nicety. Prose writes "First Strike",
     * which is the alias of "FS X" — and without it the longest-first sort
     * matches the bare "Strike" inside it, which is a DIFFERENT rule about
     * Disembarking. That is the "Pen 6+" failure again: a shorter name eating
     * part of a longer one and confidently showing the wrong text. */
    const seen = {};
    const names = pool.reduce((out, r) => out.concat([r.name, r.alias]), [])
      .filter(n => {
        // Longer than three characters, because "UC" and "AA" appear inside
        // ordinary words; and never a name carrying the value placeholder
        // ("Aegis X"", "Ev X"), which prose does not write — the alias is what
        // it writes.
        if (!n || n.length <= 3 || /\bX\b/.test(n)) return false;
        const k = n.toLowerCase();
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      }).sort((a, b) => b.length - a.length);
    const re = new RegExp('\\b(' + names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'gi');
    // Escape FIRST, then wrap, so the markup this adds is the only markup in
    // the result and a rule whose text contains "<" cannot open a tag.
    return esc(t).replace(re, m =>
      `<button type="button" class="dzc-rule dzc-rule--inline"`
      + ` onclick="DZCUnits.showRule(this,'${m.replace(/'/g, '&#39;')}')">${m}</button>`);
  }

  /* The glossary text with the printed value folded in.
   *
   * A card prints "Aegis 3"" and the entry reads "Friendly Units within X" of
   * this Unit lose UC." Handing X straight back asks the player to redo the
   * substitution the card already did for them, which is exactly the sentence
   * they came to the tooltip to avoid working out.
   *
   * Every parameterised rule's match expression captures its value, so capture
   * 1 fills X, 2 fills Y and 3 fills Z -- the order every parameterised NAME in
   * the glossary is written in ("Repair X/Y", "Drone Base X: Y",
   * "Shield: X Y" Z+"). One pass, so a value that itself contains a bare Y is
   * never re-substituted.
   *
   * Word suffixes work the same as numeric ones: "Ineffective: Zones" reads
   * "...things of the type Zones", not "...of the type X". */
  function ruleText(keyword, faction) {
    const hit = resolve(keyword, faction);
    if (!hit) return null;
    const r = hit.rule;
    if (!r.parameterised) return r.text;
    // A trailing bracket names the VARIANTS the rule applies to, never part of
    // the value -- "AWACS 12” (Lynx)" is 12 inches, not 12” (Lynx). Lookup can
    // ignore that because the regex matches either way; substitution cannot.
    const bare = hit.cand.replace(VARIANT_TAIL, '');
    const m = r.re.exec(bare) || r.re.exec(hit.cand);
    if (!m) return r.text;
    return r.text.replace(/\b([XYZ])\b/g, (whole, ph) => {
      const v = m['XYZ'.indexOf(ph) + 1];
      return v == null ? whole : String(v).trim();
    });
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

  // --------------------------------------------------------------------- price

  /* What it costs to take this Unit AT ALL: the smallest legal Squad, not one
   * model. A picker card reading "35pts" for a Unit whose Squad starts at two
   * is off by half at the exact moment you are deciding, and deciding is the
   * whole job of that screen. 60 of the 178 have a minimum above one.
   *
   * Transports have no squad size (3.2.4) -- their count is derived from what
   * they carry -- so there is no minimum Squad to price, and the per-model
   * number is the honest one. n comes back as 1 for those.
   *
   * 49 Units are priced per VARIANT with no unit price at all, so the floor and
   * the ceiling genuinely differ (a Squad of two UCM Main Battle Tanks is 70 as
   * Sabres and 80 as Tachi). Both are returned rather than picking one and
   * being wrong about the other half the time.
   *
   * null when nothing is priced, which is not the same as free. */
  function squadPrice(unit) {
    if (!unit) return null;
    const ps = unit.points != null ? [unit.points]
      : (unit.variants || []).map(v => v.points).filter(p => p != null);
    if (!ps.length) return null;
    const lo = Math.min.apply(null, ps), hi = Math.max.apply(null, ps);
    const n = unit.squadMin > 0 ? unit.squadMin : 1;
    return { n: n, perLo: lo, perHi: hi, lo: lo * n, hi: hi * n };
  }

  // -------------------------------------------------------------------- search

  /* One search, used everywhere. The picker, the unit reference and the
   * collection all offer the same field with the same words on it, so they had
   * better behave the same way -- and three copies of the filter is precisely
   * how they stop doing that.
   *
   * Indexed: the name, the category, the type, every variant name, every
   * weapon name, and every rule keyword the card prints -- on the Unit AND on
   * its weapons, which none of the three were searching. A weapon's Special
   * line is where most of the interesting words live.
   *
   * Resolved rule names and aliases go in as well, so "evasion" finds a Unit
   * whose card only ever prints "Ev1", and "penetrator" finds one printing
   * "Pen 6+". Rule TEXT deliberately does not: matching the body of a glossary
   * entry turns every search into a shrug, because half the entries mention
   * Units and damage.
   *
   * Built once per Unit and kept. It walks the glossary, and a search box runs
   * it on every keystroke across 178 Units. */
  const searchBlobs = new Map();

  function searchBlob(unit, faction) {
    const key = `${faction}/${unit.id}`;
    const hit = searchBlobs.get(key);
    if (hit != null) return hit;
    const parts = [unit.name, unit.category, unit.type];
    (unit.variants || []).forEach(v => parts.push(v.name));
    (unit.weapons || []).forEach(w => parts.push(w.name));
    [unit.special || ''].concat((unit.weapons || []).map(w => w.special || ''))
      .forEach(line => splitSpecial(line, faction).forEach(tok => {
        parts.push(tok);
        const r = rule(tok, faction);
        if (r) parts.push(r.name, r.alias);
      }));
    const blob = parts.filter(Boolean).join(' ').toLowerCase();
    // Only keep it once the glossary is loaded, or the aliases are missing from
    // a blob that then never gets rebuilt.
    if (state.rules) searchBlobs.set(key, blob);
    return blob;
  }

  function matches(unit, query, faction) {
    const q = String(query == null ? '' : query).trim().toLowerCase();
    if (!q) return true;
    return searchBlob(unit, faction).indexOf(q) !== -1;
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

  /* A carrier's capacity AFTER its weapon upgrades, because two cards in the
   * game sell their room for guns: the Strikehawk and the Carryhawk, "May
   * replace transport capacity of 2 with MM-3 Missile Boxes or MC-30 Heavy
   * Gatlings" (3.2.3). Until this existed that sentence was a note nobody
   * read, and the app would happily load two circles into a Strikehawk that
   * had already traded them away -- a wrong army it called legal.
   *
   * `taken` is asked about each weapon; the scanner puts the arithmetic on the
   * weapon as capacityDelta, so nothing here parses English.
   *
   * Returns the unit ITSELF when nothing changes. The clone is the rare path,
   * so every identity check downstream still holds for the other 176 units. */
  function carrierWithUpgrades(unit, taken) {
    if (!unit || typeof taken !== 'function') return unit;
    const deltas = [];
    (unit.weapons || []).forEach(w => {
      if ((w.capacityDelta || []).length && taken(w)) deltas.push.apply(deltas, w.capacityDelta);
    });
    if (!deltas.length) return unit;
    const cap = (((unit.transport || {}).capacity) || []).map(c => ({ shape: c.shape, n: c.n }));
    deltas.forEach(d => {
      const hit = cap.find(c => c.shape === d.shape);
      if (hit) hit.n = Math.max(0, hit.n + d.n);
    });
    return Object.assign({}, unit, {
      transport: Object.assign({}, unit.transport || {},
        { capacity: cap.filter(c => c.n > 0) })
    });
  }

  function canCarry(carrier, passenger) {
    return fillsOf(passenger).some(f => capacityFor(carrier, f.shape) > 0);
  }

  /* Space used in `carrier` by a list of {unit, count} passengers.
   *
   * Returns { ok, byShape, mode, reason }. When a carrier is "either", a load
   * mixing two of its shapes is illegal however much room is left. */
  /* `carriers` is HOW MANY of that Transport are in the Transport Squad, and
   * leaving it out was a real bug rather than a nicety.
   *
   * "You may take as many identical Transports as needed" (3.2.4), and the
   * rulebook's own worked Group 3 is a single Squad filling several identical
   * Transports. Measuring against one vehicle's capacity therefore reported
   * six Legionnaires in two Bear APCs as "Bear APC has 3 square capacity,
   * needs 6" — an army the rules explicitly allow, called illegal, with
   * nothing you could do to make it legal. Found by the random generator,
   * which has to produce a legal army and so argues with every rule at once.
   *
   * Defaults to 1 so a caller asking "could this carry that at all" — the
   * picker, the Transport chooser — keeps asking about one vehicle. */
  function loadCheck(carrier, passengers, carriers) {
    const fleetOf = shape => capacityFor(carrier, shape) * (carriers > 0 ? carriers : 1);
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
      const room = fleetOf(shape);
      if (byShape[shape] > room) {
        return { ok: false, byShape, mode,
                 reason: `${carrier.name} has ${room} ${shape} capacity, needs ${byShape[shape]}` };
      }
    }
    return { ok: true, byShape, mode, reason: null };
  }

  /* Transports must be taken FULL (3.2.4). Auxiliary Transports need not be.
   * Full means every one of them full, so the count matters here for the same
   * reason it matters above: three Legionnaires across two Bear APCs fills
   * neither, and is not a legal Group. */
  function isFull(carrier, passengers, carriers) {
    const n = carriers > 0 ? carriers : 1;
    const chk = loadCheck(carrier, passengers, n);
    if (!chk.ok) return false;
    const shapes = Object.keys(chk.byShape);
    if (!shapes.length) return false;
    return shapes.every(s => chk.byShape[s] === capacityFor(carrier, s) * n);
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

  // Stat and weapon column abbreviations, spelled out. Rulebook 2.5-2.7 names
  // each one; a bare "A" or "DP" means nothing without having read the book.
  const STAT_LABELS = {
    Mv: 'Move', A: 'Armour', DP: 'Damage Points',
    OF: 'Offence', DF: 'Defence', B: 'Bravery',
    // Behemoths only.
    Power: 'Power'
  };
  const WEAPON_LABELS = {
    Name: 'Weapon', Arc: 'Arc', MA: 'Move & Attack', R: 'Range',
    Att: 'Attacks', Ac: 'Accuracy', E: 'Energy', Special: 'Special'
  };
  /* What each one MEANS, in the rulebook's words rather than anybody's.
   *
   * Chapter 2 defines every column on a stat card, one line each (2.5, 2.6,
   * 2.6.1, 2.7). These are those lines with the label taken off the front,
   * because the cell already prints the label and the hover repeating it was a
   * tooltip that said nothing.
   *
   * Two of them carry the thing you cannot work out from the number: an
   * Accuracy of "A" hits automatically and a Bravery of "A" passes
   * automatically, and both appear on real cards. */
  const STAT_HELP = {
    Mv: 'How far it may move (2.5)',
    A: 'How well protected it is physically (2.5)',
    DP: 'The amount of damage it can take before being destroyed (2.5)',
    OF: 'Its lethality against Infantry up close (2.6)',
    DF: 'Its skill at surviving certain situations, in place of an Armour value (2.6)',
    B: 'Roll 1D6 against it for a Bravery Test; a value of A passes automatically (2.6.1)',
    Power: 'What it spends to act, and to run its Gear (Behemoth rules 1.2)'
  };
  const WEAPON_HELP = {
    Arc: 'The directions in which it may attack (2.7)',
    MA: 'The furthest its Unit may move and still attack with it; Full is its whole move (2.7)',
    R: 'Its range; a second value is used against Vehicles and Aircraft (2.7)',
    Att: 'The number of dice it attacks with (2.7)',
    Ac: 'How accurate it is; a value of A hits automatically (2.7)',
    E: 'Its power (2.7)'
  };
  const statLabel = k => STAT_LABELS[k] || k;
  const weaponColLabel = k => WEAPON_LABELS[k] || k;
  // Label first, then the definition, so a hover reads as a sentence about a
  // named thing rather than a fragment.
  const statHelp = k => (STAT_HELP[k] ? `${statLabel(k)} — ${STAT_HELP[k]}` : statLabel(k));
  const weaponColHelp = k => (WEAPON_HELP[k] ? `${weaponColLabel(k)} — ${WEAPON_HELP[k]}` : '');

  const api = {
    loadIndex, loadFaction,
    statLabel, weaponColLabel, statHelp, weaponColHelp,
    get index() { return state.index; },
    get rules() { return state.rules; },
    faction: id => state.factions[id],
    unit: (fid, uid) => (state.factions[fid] || { byId: {} }).byId[uid],
    rule, ruleText, linkKeywords, splitSpecial, matches, squadPrice,
    capacityFor, fillsOf, canCarry, carrierWithUpgrades, loadCheck, isFull,
    gameSizeFor, maxGroups, maxGroupCost, rareLimit, commanderLevels,
    _state: state, _compileRules: compileRules
  };

  if (typeof window !== 'undefined') window.DZC = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
