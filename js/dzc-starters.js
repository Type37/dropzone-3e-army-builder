/* The two starter armies, seeded into Your Armies for every user.
 *
 * Jet, 2026-08-07: "let's wire up starter lists that show up pre-built in your
 * armies."
 *
 * Both lists are TRANSCRIBED, not designed. Jet photographed the two "Starter
 * Army Group Composition" cards from the DZC 3.0 two-player box on 2026-08-07
 * and they give the whole thing: which Transport carries which Squad, Group by
 * Group, down to which model holds the Commander and what Level it is. Nine
 * Groups for the UCM, six for the Bioficers, in the order printed.
 *
 * An earlier version of this file worked the organisation out from the sprue
 * contents instead. It came out legal and it came out wrong -- Praetorian
 * Snipers where the box has Spec-Ops, both Genitor Arks in one Group where
 * TTCombat split them, a Commander at the cheapest Level rather than the one
 * they picked. There was a right answer in the box the whole time.
 *
 * Both validate with no errors (see test-dzc-army). The UCM's one note is the
 * Scimitars starting Reserved, which TTCombat's card prints too.
 *
 * Seeded ONCE. A user who deletes one has deleted it: the marker below says
 * they have been offered, not that they are present, so they never come back
 * uninvited.
 */
(function () {
  'use strict';

  const SEEDED_KEY = 'dzc.starters.v1';

  /* A Group is squads[] in the order the card prints them -- the Transport
   * first, then what it carries, which is how the app stacks a Group anyway.
   * `rides` names the carrier by INDEX within its own Group. */
  const STARTERS = [
    {
      name: 'UCM starter',
      faction: 'ucm',
      pointsLimit: 1500,
      description: 'The UCM half of the two-player starter set, in TTCombat’s own Group composition.',
      // "1 Sabre has L4 Commander", on the card.
      commander: { level: 4, group: 0 },
      groups: [
        { name: 'Sabres', squads: [
          { unit: 'condor-dropship', n: 1 },
          { unit: 'ucm-main-battle-tank', n: 3, variant: 'Sabre', rides: 0 }
        ] },
        { name: 'Polecat A', squads: [
          { unit: 'vulture-dropship', n: 1 },
          { unit: 'polecat-buggy', n: 4, variant: 'Polecat A', rides: 0 }
        ] },
        { name: 'Polecat B', squads: [
          { unit: 'raven-light-dropship', n: 1 },
          { unit: 'polecat-buggy', n: 2, variant: 'Polecat B', rides: 0 }
        ] },
        /* Two Squads of two Legionnaires in one Vulture Troopship, exactly as
         * the card prints it -- 3.2.4 allows up to four Squads to share one
         * larger Transport, and two of these fill its four squares. */
        { name: 'Legionnaires', squads: [
          { unit: 'vulture-troopship', n: 1 },
          { unit: 'legionnaires', n: 2, rides: 0 },
          { unit: 'legionnaires', n: 2, rides: 0 }
        ] },
        { name: 'Legionnaires', squads: [
          { unit: 'raven-light-troopship', n: 1 },
          { unit: 'legionnaires', n: 2, rides: 0 }
        ] },
        { name: 'Rapiers', squads: [
          { unit: 'condor-dropship', n: 1 },
          { unit: 'ucm-main-battle-tank', n: 3, variant: 'Rapier', rides: 0 }
        ] },
        { name: 'Falcon', squads: [
          { unit: 'falcon-gunship', n: 1, variant: 'Falcon-A' }
        ] },
        { name: 'Praetorians', squads: [
          { unit: 'raven-light-troopship', n: 1 },
          { unit: 'praetorian-spec-ops', n: 2, rides: 0 }
        ] },
        // "(Starting Reserved)" on the card, which is the 9.4 note the app
        // already raises for a Squad that is not aboard an Aircraft.
        { name: 'Scimitars', squads: [
          { unit: 'ucm-heavy-tank', n: 2, variant: 'Scimitar' }
        ] }
      ]
    },
    {
      name: 'Bioficer starter',
      faction: 'bioficer',
      pointsLimit: 1500,
      description: 'The Bioficer half of the starter set. Hulks and Drones are Generated in play, so they are not bought.',
      // "1 Tusk has L5 Commander", on the card.
      commander: { level: 5, group: 2 },
      groups: [
        /* The Silence Heavy Gunship is not a Transport -- it is a Heavy that
         * carries, so it need not be full (3.2.4.3) -- and one Ark is its four
         * triangles exactly anyway. */
        { name: 'Silence', squads: [
          { unit: 'silence-heavy-gunship', n: 1 },
          { unit: 'grievance-genitor-ark', n: 1, rides: 0 }
        ] },
        { name: 'Genitor Ark', squads: [
          { unit: 'data-strike-dropship', n: 1 },
          { unit: 'grievance-genitor-ark', n: 1, rides: 0 }
        ] },
        { name: 'Tusks', squads: [
          { unit: 'device-dropship', n: 1 },
          { unit: 'tusk-main-battle-skimmer', n: 4, rides: 0 }
        ] },
        // Six Thorns are six triangles; three Digits are six.
        { name: 'Thorns', squads: [
          { unit: 'digit-light-dropship', n: 3 },
          { unit: 'thorn-light-skimmer', n: 6, rides: 0 }
        ] },
        { name: 'Tangents', squads: [
          { unit: 'data-strike-dropship', n: 1 },
          { unit: 'tangent-support-skimmer', n: 2, rides: 0 }
        ] },
        { name: 'Gyro', squads: [
          { unit: 'gyro-aero-genitor', n: 1 }
        ] }
      ]
    }
  ];

  /* Build one starter into a real army through the ordinary army API, so a
   * starter is a list you could have built by hand and nothing about it is a
   * special case downstream. */
  function build(spec) {
    const A = window.DZCArmy;
    const a = A.create(spec.faction, spec.name, spec.pointsLimit, spec.description);
    spec.groups.forEach(gs => {
      const g = A.addGroup(a, gs.name);
      const made = gs.squads.map(s => A.addSquad(a, g.id, s.unit, s.n));
      gs.squads.forEach((s, i) => {
        const sq = made[i];
        if (!sq) return;
        /* Every model of the Squad is the named Variant. Set per MODEL, not
         * through setVariantCount: that one takes a COUNT of models already
         * carrying the variant, so asking a fresh 3-model Squad for three
         * Sabres adds three more and you get six. */
        if (s.variant) sq.models.forEach((m, mi) => A.setModelVariant(a, sq.id, mi, s.variant));
        // `rides` names the carrier by index within its own Group -- index
        // rather than id because ids are minted here and an index is a thing
        // that can be written down beside the card it was read off.
        if (s.rides != null && made[s.rides]) A.setCarrier(a, sq.id, made[s.rides].id);
      });
    });
    /* The Commander the card names, on the Squad the card names -- "1 Sabre
     * has L4 Commander", "1 Tusk has L5 Commander". Not a guess at the
     * cheapest legal one: TTCombat picked a Level and a Squad, and the two
     * lists are meant to be a fair game against each other.
     *
     * It also happens to be required. An army must contain at least one
     * Commander (3.2.5), so a starter without one would open with an error
     * against a list the app built itself. */
    const c = spec.commander;
    if (c) {
      const add = A.addCommander(a, c.level);
      const g = a.groups[c.group];
      // The fighting Squad in that Group, which is the one the card marks --
      // never the Transport carrying it (3.2.5 refuses that anyway).
      const target = A.commanderTargets(a, add.commander && add.commander.id)
        .find(t => g && t.group.id === g.id);
      if (add.ok && target) A.assignCommander(a, add.commander.id, target.squad.id);
    }
    A.save();
    return a;
  }

  /* Seed on first run and never again. The marker records the OFFER, not the
   * armies: deleting one has to stick, and a marker keyed on "is it present"
   * would put it back on the next load. */
  async function seed() {
    const A = window.DZCArmy;
    if (!A) return [];
    /* The store, before anything is added to it. DZCArmy keeps the army list in
     * a module array that only load() fills, so creating an army against an
     * unloaded one and saving writes these two over EVERYTHING already there.
     * That is exactly what shipped for one commit: the call in renderList sat
     * one line above its load() and wiped the user's armies. Belt and braces,
     * so the ordering can never be got wrong from a new caller. */
    A.load();
    let done = null;
    try { done = localStorage.getItem(SEEDED_KEY); } catch (e) { return []; }
    if (done) return [];
    const out = [];
    for (const spec of STARTERS) {
      // Needs the faction's units loaded before a Squad can be added.
      try { await window.DZC.loadFaction(spec.faction); } catch (e) { continue; }
      out.push(build(spec));
    }
    try { localStorage.setItem(SEEDED_KEY, '1'); } catch (e) { /* private mode */ }
    return out;
  }

  window.DZCStarters = { seed, build, STARTERS, SEEDED_KEY };
})();
