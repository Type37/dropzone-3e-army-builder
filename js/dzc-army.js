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
    try { localStorage.setItem(STORE, JSON.stringify(armies)); } catch (e) { /* quota */ }
    bindSync();
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

  function groupName(army, g) {
    if (g.name) return g.name;
    return `Group ${army.groups.indexOf(g) + 1}`;
  }

  /* Typing the auto name back in, or clearing the field, hands the Group
   * to the numbering again rather than freezing today's number as a custom
   * name that stops tracking. */
  function renameGroup(army, groupId, text) {
    const g = army.groups.find(x => x.id === groupId);
    if (!g) return;
    const t = (text || '').trim();
    g.name = (!t || t === `Group ${army.groups.indexOf(g) + 1}`) ? null : t;
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

  function setModelCount(army, squadId, n) {
    const s = findSquad(army, squadId);
    if (!s) return { ok: false, reason: 'Unknown Squad.' };
    const u = unitOf(army, s);
    n = Math.max(0, n);
    if (n === 0) { removeSquad(army, squadId); return { ok: true, reason: null }; }
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

  /* 3.2.5: a Squad may contain only one Commander, and the level must be one
   * the game size allows. Both are enforced here as well as in the UI. */
  /* Commanders belong to the ARMY, not to a Squad.
   *
   * You buy one and then decide who it rides with, which is the order people
   * actually work in — and it is the only way an unassigned Commander can
   * exist long enough to say "add a Squad this Commander can join". Squads
   * still carry a `commander` object so everything that renders a Squad keeps
   * working; `commanders` is the store and assignment keeps the two in step. */
  function commanders(army) { return (army.commanders = army.commanders || []); }

  function commanderFor(army, squadId) {
    return commanders(army).find(c => c.squadId === squadId) || null;
  }

  /* Which Squads this Commander may join: a fighting Unit, one Commander each
   * (3.2.5), and never a Transport Squad. */
  function commanderTargets(army, cmdrId) {
    const out = [];
    army.groups.forEach(g => g.squads.forEach(s => {
      const u = unitOf(army, s);
      if (!u || u.category === 'Transport') return;
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
    const c = { id: uid(), level: level, squadId: null };
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
    const held = commanderFor(army, squadId);
    if (held && held.id !== cmdrId) {
      return { ok: false, reason: 'That Squad already has a Commander — one per Squad (3.2.5).' };
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
  /* Does any Transport in this Group have space left for one more of `unit`?
   *
   * Shape alone is not enough — a Bear APC carries 3 squares, and once three
   * Legionnaires are aboard a fourth still "matches" but does not fit. So the
   * real load is rebuilt with the candidate added and checked. A Transport
   * that is itself being carried is skipped: its cargo is ignored, because it
   * is already aboard something else (3.2.4.2). */
  function roomSomewhere(army, group, unit) {
    if (!group) return false;
    return group.squads.some(t => {
      const tu = unitOf(army, t);
      if (!tu || t.carriedBy) return false;
      if (!(tu.category === 'Transport' || tu.auxiliaryTransport)) return false;
      if (!window.DZC.canCarry(tu, unit)) return false;
      const aboard = group.squads.filter(x => x.carriedBy === t.id)
        .map(x => ({ unit: unitOf(army, x), count: x.models.length }))
        .filter(x => x.unit);
      aboard.push({ unit: unit, count: 1 });
      return window.DZC.loadCheck(tu, aboard).ok;
    });
  }

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
      const tu = unitOf(army, t);
      if (!tu || t.carriedBy) return;
      const cap = ((tu.transport || {}).capacity) || [];
      if (!cap.length) return;
      cap.forEach(c => { slot(c.shape).total += (c.n || 0) * t.models.length; });
      const aboard = group.squads.filter(x => x.carriedBy === t.id)
        .map(x => ({ unit: unitOf(army, x), count: x.models.length }))
        .filter(x => x.unit);
      const chk = window.DZC.loadCheck(tu, aboard);
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
     * 3.2.4  — a Transport may only be chosen alongside a Squad it can carry.
     *          Those Transports form a Squad; those two Squads form one Group.
     * 3.2.4.1 — up to 4 Squads, plus their own Transport Squads, may share ONE
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
    // FINISHED — a lone Transport is unfinished, not illegal, and you may well
    // be about to put something in it. Those are reported by validate().
    if (occupied && u.category !== 'Transport' && squads.filter(s => s.carriedBy).length >= 4) {
      return { ok: false, reason: 'At most 4 Squads may share one Transport (3.2.4.1).' };
    }

    const taken = squadsNamed(army, u.name);
    if (u.unique && taken >= 1) {
      return { ok: false, reason: `${u.name} is Unique — one per Army (3.2.1).` };
    }
    if (u.rare) {
      const size = window.DZC.gameSizeFor(army.pointsLimit);
      const lim = size ? window.DZC.rareLimit(size.id) : 1;
      if (taken >= lim) {
        return { ok: false, reason: `${u.name} is Rare — ${size ? size.label : 'this size'} allows ${lim} (3.2.1).` };
      }
    }
    return { ok: true, reason: null };
  }

  /* Squad size limits (the card's own min/max). Transports are exempt: they
   * have no squad size, and their count is derived from their cargo. */
  function canSetCount(army, squadId, n) {
    const s = findSquad(army, squadId);
    if (!s) return { ok: false, reason: 'Unknown Squad.' };
    const u = unitOf(army, s);
    if (!u) return { ok: false, reason: 'Unknown unit.' };
    if (u.category === 'Transport') {
      return { ok: false, reason: 'A Transport’s count follows its cargo — change the Squad it carries.' };
    }
    if (u.squadMax != null && n > u.squadMax) {
      return { ok: false, reason: `${u.name} has a maximum Squad size of ${u.squadMax}.` };
    }
    if (u.squadMin != null && n < u.squadMin && n > 0) {
      return { ok: false, reason: `${u.name} has a minimum Squad size of ${u.squadMin}.` };
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
    return f.units.filter(t => t.category === 'Transport' && window.DZC.canCarry(t, u))
      .map(t => {
        const shape = (window.DZC.fillsOf(u).find(x => window.DZC.capacityFor(t, x.shape) > 0) || {}).shape;
        const per = window.DZC.capacityFor(t, shape);
        const fill = squadFill(army, s, shape);
        const need = per ? Math.ceil(fill / per) : 0;
        return {
          unit: t, shape: shape, per: per, need: need,
          // "Transports must be taken full" (3.2.4). With identical Transports
          // that means the Squad's fill must divide exactly into their
          // capacity -- 5 Legionnaires cannot fill two Bear APCs.
          exact: per > 0 && fill % per === 0,
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
  function boardOptions(army, squadId) {
    const s = findSquad(army, squadId);
    const g = groupOf(army, squadId);
    const u = s && unitOf(army, s);
    if (!u || !g) return [];
    return g.squads.filter(t => {
      if (t.id === s.id || t.carriedBy) return false;
      const tu = unitOf(army, t);
      if (!tu || !(tu.category === 'Transport' || tu.auxiliaryTransport)) return false;
      if (!window.DZC.canCarry(tu, u)) return false;
      // 3.2.4.1 caps the sharing at 4 Squads.
      const aboard = g.squads.filter(x => x.carriedBy === t.id && x.id !== s.id);
      if (aboard.length >= 4) return false;
      const load = aboard.map(x => ({ unit: unitOf(army, x), count: x.models.length }))
        .filter(x => x.unit);
      load.push({ unit: u, count: s.models.length });
      return window.DZC.loadCheck(tu, load).ok;
    }).map(t => {
      const tu = unitOf(army, t);
      const aboard = g.squads.filter(x => x.carriedBy === t.id && x.id !== s.id);
      const load = aboard.map(x => ({ unit: unitOf(army, x), count: x.models.length }))
        .filter(x => x.unit);
      const before = window.DZC.loadCheck(tu, load);
      load.push({ unit: u, count: s.models.length });
      const after = window.DZC.loadCheck(tu, load);
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
    if (!opt) return { ok: false, reason: 'That Transport has no room for this Squad (3.2.4.2).' };

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
      : `${opt.need} × ${opt.unit.name} is not full — it carries ${opt.per} and this Squad `
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
        const tu = unitOf(army, t);
        if (!tu || tu.category !== 'Transport') return;
        const riders = g.squads.filter(x => x.carriedBy === t.id);
        if (!riders.length) { g.squads = g.squads.filter(x => x.id !== t.id); return; }
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

  function groupOf(army, squadId) {
    return army.groups.find(g => g.squads.some(s => s.id === squadId)) || null;
  }

  function unitOf(army, squad) { return window.DZC.unit(army.faction, squad.unitId); }

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

  function hasUpgrade(squad, scope, name) {
    return !!(squad.upgrades && squad.upgrades[scope] && squad.upgrades[scope][name]);
  }

  /* Take or drop an upgrade. Where the card prints "Only one of these upgrades
   * may be taken", that is enforced rather than noted. */
  function toggleUpgrade(army, squadId, scope, name) {
    const s = findSquad(army, squadId);
    if (!s) return { ok: false, reason: 'Unknown Squad.' };
    const u = unitOf(army, s);
    s.upgrades = s.upgrades || {};
    s.upgrades[scope] = s.upgrades[scope] || {};

    if (s.upgrades[scope][name]) {
      delete s.upgrades[scope][name];
      touch(army);
      return { ok: true, reason: null };
    }
    const onlyOne = /only one of these upgrades/i.test(u && u.upgradeNote || '');
    if (onlyOne) {
      const already = Object.keys(s.upgrades).some(k =>
        Object.keys(s.upgrades[k]).some(n => n !== name));
      if (already) {
        return { ok: false, reason: `${u.name}: only one of these upgrades may be taken (3.2.3).` };
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
   * the army total directly — its points are spent either way. */
  function commandersCost(army) {
    return ((army && army.commanders) || [])
      .filter(c => !c.squadId).reduce((t, c) => t + levelCost(c.level), 0);
  }

  function squadCost(army, squad) {
    const u = unitOf(army, squad);
    const c = commanderFor(army, squad.id);
    return squad.models.reduce((t, m) => t + modelCost(u, m), 0)
      + upgradeCost(army, squad) + (c ? levelCost(c.level) : 0);
  }

  function groupCost(army, group) {
    return group.squads.reduce((t, s) => t + squadCost(army, s), 0);
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

      /* A Group is one Squad and its Transports, or up to 4 Squads sharing one
       * larger Transport (3.2.4 / 3.2.4.1). Two Squads standing side by side
       * with nothing carrying either of them is not a Group — but it is a
       * perfectly ordinary state to pass through while building, so it is
       * reported when you are done rather than blocked as you go. */
      const loose = g.squads.filter(s => {
        const u = unitOf(army, s);
        return u && u.category !== 'Transport' && !s.carriedBy;
      });
      if (loose.length > 1) {
        errors.push({
          rule: '3.2.4',
          msg: `“${g.name}” has ${loose.length} Squads with nothing carrying them — a Group is one Squad and its Transports, `
            + 'or up to 4 Squads sharing one larger Transport.'
        });
      }

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
    // (3.2.5), so one sitting on the shelf is as illegal as not having one —
    // and the builder holds both back until the list is half spent rather
    // than nagging about them from the first Squad.
    cmdrs.filter(c => !c.squadId).forEach(c => {
      errors.push({ rule: '3.2.5', msg: `Your Level ${c.level} Commander is not with a Squad yet.` });
    });

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
    addGroup, removeGroup, groupName, renameGroup, addSquad, removeSquad, setModelCount, setModelVariant,
    setCarrier, setCommander, findSquad, groupOf, unitOf,
    commanders, commanderFor, commanderTargets,
    addCommander, removeCommander, assignCommander, syncCommanders, levelCost,
    modelCost, squadCost, groupCost, armyCost, categorySpend, validate,
    // enforcement
    canAddUnit, canSetCount, squadsNamed, squadFill,
    upgradesFor, hasUpgrade, toggleUpgrade, upgradeCost,
    transportOptions, assignTransport, refitTransports, groupSpace,
    boardOptions, boardTransport
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.DZCArmy;
})();
