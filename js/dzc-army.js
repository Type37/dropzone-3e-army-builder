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
    try {
      armies = JSON.parse(localStorage.getItem(STORE) || '[]');
      if (!Array.isArray(armies)) armies = [];
    } catch (e) { armies = []; }
    return armies;
  }

  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(armies)); } catch (e) { /* quota */ }
    // Fleet Sync stamps and syncs whatever list it is given; it does not know
    // or care what a unit is, so it works unchanged for armies.
    if (window.FleetSync && window.FleetSync.stampChanged) {
      try { window.FleetSync.stampChanged(); } catch (e) { /* sync optional */ }
    }
  }

  function all() { return armies; }
  function get(id) { return armies.find(a => a.id === id) || null; }

  function create(faction, name, pointsLimit) {
    const a = {
      id: uid(),
      name: name || 'New Army',
      faction: faction,
      // The agreed limit is an INPUT, not the top of the band: the per-Group
      // cap is a quarter of the number the players agreed (3.2).
      pointsLimit: pointsLimit || 1500,
      groups: [],
      created: Date.now(),
      updatedAt: Date.now()
    };
    armies.unshift(a);
    save();
    return a;
  }

  function remove(id) {
    armies = armies.filter(a => a.id !== id);
    if (window.FleetSync && window.FleetSync.recordDeleted) {
      try { window.FleetSync.recordDeleted(id); } catch (e) { /* optional */ }
    }
    save();
  }

  function touch(a) { a.updatedAt = Date.now(); save(); }

  // ------------------------------------------------------------------ edits

  function addGroup(army, name) {
    const g = { id: uid(), name: name || `Group ${army.groups.length + 1}`, squads: [] };
    army.groups.push(g);
    touch(army);
    return g;
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

  function setModelCount(army, squadId, n) {
    const s = findSquad(army, squadId);
    if (!s) return;
    const u = unitOf(army, s);
    n = Math.max(0, n);
    while (s.models.length < n) s.models.push({ variant: defaultVariant(u) });
    s.models.length = n;
    if (!n) removeSquad(army, squadId); else touch(army);
  }

  function setModelVariant(army, squadId, index, variantName) {
    const s = findSquad(army, squadId);
    if (s && s.models[index]) { s.models[index].variant = variantName; touch(army); }
  }

  function removeSquad(army, squadId) {
    army.groups.forEach(g => {
      // Anything this Squad was carrying is orphaned, not deleted.
      g.squads.forEach(s => { if (s.carriedBy === squadId) s.carriedBy = null; });
      g.squads = g.squads.filter(s => s.id !== squadId);
    });
    touch(army);
  }

  function setCarrier(army, squadId, carrierSquadId) {
    const s = findSquad(army, squadId);
    if (s) { s.carriedBy = carrierSquadId || null; touch(army); }
  }

  function setCommander(army, squadId, level) {
    const s = findSquad(army, squadId);
    if (!s) return;
    // 3.2.5: a Squad may contain only one Commander.
    s.commander = level ? { level: level } : null;
    touch(army);
  }

  function findSquad(army, squadId) {
    for (const g of army.groups) {
      const s = g.squads.find(x => x.id === squadId);
      if (s) return s;
    }
    return null;
  }

  function groupOf(army, squadId) {
    return army.groups.find(g => g.squads.some(s => s.id === squadId)) || null;
  }

  function unitOf(army, squad) { return window.DZC.unit(army.faction, squad.unitId); }

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

  function commanderCost(squad) {
    if (!squad.commander) return 0;
    const lv = (window.DZC.commanderLevels('reconquest') || [])
      .find(l => l.level === squad.commander.level);
    return lv ? lv.points : 0;
  }

  function squadCost(army, squad) {
    const u = unitOf(army, squad);
    return squad.models.reduce((t, m) => t + modelCost(u, m), 0) + commanderCost(squad);
  }

  function groupCost(army, group) {
    return group.squads.reduce((t, s) => t + squadCost(army, s), 0);
  }

  function armyCost(army) {
    return army.groups.reduce((t, g) => t + groupCost(army, g), 0);
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
      out[c] = (out[c] || 0) + s.models.reduce((t, m) => t + modelCost(u, m), 0);
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
      errors.push({ rule: '3.1', msg: `${total}pts spent, ${limit}pt limit — ${total - limit} over.` });
    }

    if (size) {
      const maxG = window.DZC.maxGroups(size, limit);
      if (army.groups.length > maxG) {
        errors.push({ rule: '3.1', msg: `${army.groups.length} Groups, but ${size.label} allows ${maxG}.` });
      }
      const cap = window.DZC.maxGroupCost(limit);
      army.groups.forEach(g => {
        const c = groupCost(army, g);
        if (c > cap) {
          errors.push({ rule: '3.2', msg: `“${g.name}” costs ${c}pts — no Group may exceed a quarter of the limit (${cap}pts).` });
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

    // Rare / Unique, counted by NAME across the whole army.
    const byName = {};
    army.groups.forEach(g => g.squads.forEach(s => {
      const u = unitOf(army, s);
      if (u) (byName[u.name] = byName[u.name] || []).push(u);
    }));
    Object.keys(byName).forEach(name => {
      const u = byName[name][0], n = byName[name].length;
      if (u.unique && n > 1) {
        errors.push({ rule: '3.2.1', msg: `${name} is Unique — only one may be taken (${n} present).` });
      } else if (u.rare && size) {
        const lim = window.DZC.rareLimit(size.id);
        if (n > lim) {
          errors.push({ rule: '3.2.1', msg: `${name} is Rare — ${size.label} allows ${lim} (${n} present).` });
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
        errors.push({ rule: '2', msg: `${u.name}: ${n} model${n === 1 ? '' : 's'}, minimum is ${u.squadMin}.` });
      }
      if (u.squadMax != null && n > u.squadMax) {
        errors.push({ rule: '2', msg: `${u.name}: ${n} models, maximum is ${u.squadMax}.` });
      }
    }));

    // Transports: only alongside a Squad they can carry, and taken FULL.
    army.groups.forEach(g => {
      g.squads.forEach(s => {
        const u = unitOf(army, s);
        if (!u || u.category !== 'Transport') return;
        const cargo = g.squads.filter(x => x.carriedBy === s.id)
          .map(x => ({ unit: unitOf(army, x), count: x.models.length }))
          .filter(x => x.unit);
        if (!cargo.length) {
          errors.push({ rule: '3.2.4', msg: `${u.name} carries nothing — a Transport may only be taken alongside a Squad it can carry.` });
          return;
        }
        const chk = window.DZC.loadCheck(u, cargo);
        if (!chk.ok) errors.push({ rule: '3.2.4.2', msg: chk.reason });
        else if (!window.DZC.isFull(u, cargo)) {
          errors.push({ rule: '3.2.4', msg: `${u.name} is not full — Transports must be taken full.` });
        }
      });

      // Auxiliary Transports need NOT be full, but still cannot be overloaded,
      // and a carried Squad may not be split across several of them (3.2.4.3).
      g.squads.forEach(s => {
        const u = unitOf(army, s);
        if (!u || u.category === 'Transport' || !u.auxiliaryTransport) return;
        const cargo = g.squads.filter(x => x.carriedBy === s.id)
          .map(x => ({ unit: unitOf(army, x), count: x.models.length }))
          .filter(x => x.unit);
        if (cargo.length) {
          const chk = window.DZC.loadCheck(u, cargo);
          if (!chk.ok) errors.push({ rule: '3.2.4.3', msg: chk.reason });
        }
      });

      // Up to 4 Squads may share ONE Transport (3.2.4.1).
      g.squads.forEach(s => {
        const riders = g.squads.filter(x => x.carriedBy === s.id).length;
        if (riders > 4) {
          const u = unitOf(army, s);
          errors.push({ rule: '3.2.4.1', msg: `${u ? u.name : 'Transport'} carries ${riders} Squads — at most 4 may share one Transport.` });
        }
      });
    });

    // Commanders.
    const cmdrs = [];
    army.groups.forEach(g => g.squads.forEach(s => { if (s.commander) cmdrs.push(s.commander); }));
    if (!cmdrs.length) {
      errors.push({ rule: '3.2.5', msg: 'No Commander — an Army must contain at least one.' });
    }
    if (size) {
      const allowed = window.DZC.commanderLevels(size.id).map(l => l.level);
      cmdrs.forEach(c => {
        if (allowed.indexOf(c.level) === -1) {
          errors.push({ rule: '3.2.5', msg: `A Level ${c.level} Commander is not allowed in ${size.label}.` });
        }
      });
    }

    // Not illegal, but worth saying: anything not aboard an Aircraft starts
    // Reserved, off the table until Round 2 (9.4).
    let grounded = 0;
    army.groups.forEach(g => g.squads.forEach(s => {
      const u = unitOf(army, s);
      if (!u || u.type === 'Aircraft') return;
      const carrier = s.carriedBy ? unitOf(army, findSquad(army, s.carriedBy) || {}) : null;
      if (!carrier || carrier.type !== 'Aircraft') grounded++;
    }));
    if (grounded) {
      warnings.push({ rule: '9.4', msg: `${grounded} Squad${grounded === 1 ? '' : 's'} will begin Reserved — only Units aboard an Aircraft start on the table.` });
    }

    // Group count is not activation count (4.1.2 / 4.2.1).
    const transportOnly = army.groups.filter(g => g.squads.length && g.squads.every(s => {
      const u = unitOf(army, s);
      return u && u.category === 'Transport';
    })).length;
    if (transportOnly) {
      warnings.push({ rule: '4.2.2', msg: `${transportOnly} Group${transportOnly === 1 ? '' : 's'} contain only Transports — they cannot be activated normally and are ignored for Pass tokens.` });
    }

    return { errors, warnings, ok: !errors.length };
  }

  const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);

  window.DZCArmy = {
    load, save, all, get, create, remove, touch,
    addGroup, removeGroup, addSquad, removeSquad, setModelCount, setModelVariant,
    setCarrier, setCommander, findSquad, groupOf, unitOf,
    modelCost, squadCost, groupCost, armyCost, categorySpend, validate
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.DZCArmy;
})();
