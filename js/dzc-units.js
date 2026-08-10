/* DZC unit reference — the first screen rendered from data/dzc/.
 *
 * Deliberately its own file rather than more of app.js: app.js is 9,600 lines
 * of Dropfleet domain logic that is being retired, and nothing here should
 * inherit from it. This is the seed of the Dropzone app.
 *
 * Reads the canonical scanner output through js/dzc-data.js. No translation
 * layer, no Dropfleet field names.
 */
(function () {
  'use strict';

  const FACTIONS = [
    { id: 'ucm', name: 'UCM', full: 'United Colonies of Mankind', accent: '#30903c' },
    { id: 'phr', name: 'PHR', full: 'Post-Human Republic', accent: '#c9a92c' },
    { id: 'scourge', name: 'Scourge', full: 'Scourge', accent: '#60489c' },
    { id: 'shaltari', name: 'Shaltari', full: 'Shaltari', accent: '#e46024' },
    { id: 'resistance', name: 'Resistance', full: 'Resistance', accent: '#3c84c0' },
    { id: 'bioficer', name: 'Bioficers', full: 'Bioficers', accent: '#9c1818' },
    /* Not a faction, and it is last for that reason: the Behemoth PDF prints
       ten of them and none of the cards says whose they are. Until that is
       known they are a set you can read, not a faction you can build from —
       every one is selectable: false, so they never reach the picker. */
    { id: 'behemoth', name: 'Behemoths', full: 'Behemoths', accent: '#6b6459' }
  ];

  // Force-organisation order (rulebook 3.2). Generated units are produced in
  // play and can never be chosen, so they sort last and say so.
  const CATEGORIES = ['Standard', 'Vanguard', 'Heavy', 'Support', 'Transport', 'Generated'];

  // The six transport symbols. Colour is 1:1 with shape on the cards; it is
  // reproduced here because it is how a player recognises them at a glance.
  const SYMBOL = {
    square:          { ink: '#00a04d', path: 'M3 3h18v18H3z' },
    diamond:         { ink: '#e8b233', path: 'M12 2l10 10-10 10L2 12z' },
    triangle:        { ink: '#be1622', path: 'M12 2l11 19H1z' },
    'triangle-down': { ink: '#662483', path: 'M12 22L1 3h22z' },
    circle:          { ink: '#3b8ac9', path: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z' },
    pentagon:        { ink: '#e94e1b', path: 'M12 2l10 7.3-3.8 11.7H5.8L2 9.3z' }
  };

  // `lens` is per unit id: which variant's guns the weapon table is showing.
  let state = { faction: 'ucm', search: '', category: 'All', lens: {} };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* The bare glyph, no count. The Group header and the picker's shape chips
   * both draw the symbols on their own, and both must use the same path and
   * the same ink as the badges -- the shape IS the vocabulary (3.2.4.2), so a
   * second set drawn slightly differently would read as a different symbol. */
  function shapeSvg(shape, size, hollow) {
    const s = SYMBOL[shape];
    if (!s) return '';
    const px = size || 14;
    return `<svg viewBox="0 0 24 24" width="${px}" height="${px}" aria-hidden="true"><path d="${s.path}"
      fill="${hollow ? 'none' : s.ink}" stroke="${s.ink}" stroke-width="3" stroke-linejoin="round"/></svg>`;
  }

  /* A transport badge.
   *
   * Two words, and only these two. A HOLLOW badge is this unit's CAPACITY —
   * room it offers. A SOLID one is its CARGO — the room it takes up aboard
   * something else. "Carries" and "Takes up" were two more ways of saying the
   * same pair, and a vocabulary of four words for two ideas is how a symbol
   * stops being read.
   *
   * The solid is drawn SMALLER than the hollow, and that is the whole grammar
   * in one picture: a green solid looks like it would drop into a green hollow,
   * because that is exactly what it does. Same path, same ink, same digit —
   * only the size says which way round it is, so the shape stays free to mean
   * what the rulebook says it means (3.2.4.2).
   *
   * The two sizes are CSS (--badge-px / --cargo-px on .dzc-badge), not values
   * passed in from here. They were set inline once and it did nothing: the SVG
   * is `position: absolute; inset: 0`, so it takes the box's size whatever its
   * width attribute says, and both badges came out identical.
   */
  function badge(shape, n, hollow) {
    const s = SYMBOL[shape];
    if (!s) return '';
    const label = `${hollow ? 'Capacity' : 'Cargo'}: ${n} ${shape.replace('-', ' ')}`;
    // A triangle narrows to a point, so its interior at the centroid height
    // (where the digit sits, see .dzc-badge-triangle in dzc.css) is nowhere
    // near as wide as a square or diamond's. A 2-digit count (12/18/24 appear
    // 9 times across the six factions) is wide enough to overhang the sloped
    // edge. Shrink only when both things are true — and as a ratio, so it
    // follows whatever size the context asked for.
    const tight = (shape === 'triangle' || shape === 'triangle-down') && String(n).length > 1;
    const style = `color:${hollow ? s.ink : '#fff'}${tight ? ';font-size:.78em' : ''}`;
    return `<span class="dzc-badge dzc-badge-${shape}${hollow ? '' : ' is-cargo'}"
      title="${esc(label)}" aria-label="${esc(label)}">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="${s.path}" fill="${hollow ? 'none' : s.ink}" stroke="${s.ink}" stroke-width="2.5" stroke-linejoin="round"/>
      </svg><span class="dzc-badge-n" style="${style}">${esc(n)}</span></span>`;
  }

  function transportHtml(u) {
    const t = u.transport || {};
    const cap = (t.capacity || []).map(c => badge(c.shape, c.n, true));
    const fills = (t.fills || []).map(c => badge(c.shape, c.n, false));
    if (!cap.length && !fills.length) return '';
    // "+" carries both shapes at once; "/" is either but never a mixture.
    const joiner = t.capacityMode === 'both' ? '+' : t.capacityMode === 'either' ? '/' : '';
    const capStr = cap.join(joiner ? `<span class="dzc-sep" title="${
      t.capacityMode === 'both' ? 'Carries both at once' : 'Either, never mixed'}">${joiner}</span>` : '');
    return `<span class="dzc-transport">${capStr}${
      cap.length && fills.length ? '<span class="dzc-sep">,</span>' : ''}${fills.join('')}</span>`;
  }

  /* Points. 49 of 178 units are priced PER VARIANT ("35pts (Sabre, Greave),
   * 40pts (Tachi, Rapier)"), so there is no single unit price -- showing one
   * would be a lie. Those show a range and the variants carry the real cost. */
  function pointsHtml(u) {
    if (u.points != null) return `${u.points}<span class="dzc-pts">pts</span>`;
    const ps = (u.variants || []).map(v => v.points).filter(p => p != null);
    if (!ps.length) return '<span class="dzc-pts">—</span>';
    const lo = Math.min.apply(null, ps), hi = Math.max.apply(null, ps);
    return (lo === hi ? `${lo}` : `${lo}–${hi}`) + '<span class="dzc-pts">pts</span>';
  }

  function squadHtml(u) {
    if (u.squadMin == null && u.squadMax == null) return '—';
    if (u.squadMin === u.squadMax) return String(u.squadMin);
    return `${u.squadMin}–${u.squadMax}`;
  }

  /* How many of it you take, in the words its own card uses.
   *
   * "Behemoths have a Groups Equivalent stat instead of Squad Size" (Behemoth
   * rules 1.1) — instead of, not as well as. All eleven of them were labelled
   * "Squad 1", which is a stat their cards do not print, while the number that
   * decides how much of your Group allowance one eats appeared nowhere in the
   * app at all. It is four or five for most of them, out of twelve for a
   * Clash, so it is the first thing you need to know about taking one.
   *
   * The whole phrase, not the number: every caller was writing the word
   * "Squad" in front of it, which is exactly the assumption that was wrong. */
  function sizeHtml(u) {
    if (u.type === 'Behemoth' && u.groupEquivalent != null) {
      return `Groups Equivalent ${u.groupEquivalent}`;
    }
    if (u.squadMin == null) return '';
    /* A Squad of one is not a fact about the Squad, it is the absence of one.
     * "Squad 1" was printed on every single-model Unit in the game and told
     * you nothing you could act on -- Jet, 2026-08-07: "don't bother showing
     * ANYTHING like 1x or 1 or squad size 1". */
    if (u.squadMin === 1 && u.squadMax === 1) return '';
    // A size with no choice in it is a multiplier and nothing else.
    if (u.squadMin === u.squadMax) return `×${u.squadMax}`;
    return `Squad ${squadHtml(u)}`;
  }

  /* Two columns, three rows. Each row pairs stats that mean something
   * together: how it moves and what stops shots, then the fight, then nerve
   * and how much it takes to kill. Copied from the Dropfleet builder's
   * renderStatGrid (app.js:3472), which is a 2-column grid of
   * icon + value + label cells. */
  // Power last: only Behemoths print one, and it is the stat their whole turn
  // is spent out of rather than one you compare against another Unit's.
  const STAT_ORDER = ['Mv', 'A', 'OF', 'DF', 'B', 'DP', 'Power'];

  /* Two views of the same block.
   *
   *   compact  — the "Add a Squad" picker. Icon plus the short code the stat
   *              card itself prints. Four cards across cannot carry six
   *              spelled-out words.
   *   detailed — the default once a unit is on your list, and whenever you tap
   *              one to see everything. Icon plus the word.
   *
   * The codes are the game's own (Mv, A, DP, OF, DF, B) rather than one letter
   * each, because Defence and Damage Points would both be "D". */
  function statsHtml(u, opts) {
    // Vehicles/Aircraft print Mv/A/DP; Infantry print Mv/OF/DF/B/DP. Render
    // whatever the card actually had rather than assuming a shape.
    //
    // A table, not a wrap of chips: values sit under their heading in fixed
    // columns, so two units can be read against each other. Labels are spelled
    // out (2.5-2.7) rather than left as bare letters, and each carries its
    // icon.
    // Only what the unit's card actually prints. Vehicles and Aircraft have
    // Mv/A/DP; Infantry have Mv/OF/DF/B/DP. Armour is meaningless on Infantry
    // and Bravery on a tank, so an empty cell for it is noise — showing three
    // greyed dashes made every Vehicle look half broken.
    const stats = u.stats || {};
    const keys = STAT_ORDER.filter(k => stats[k] != null);
    if (!keys.length) return '';
    const compact = !!(opts && opts.compact);
    const cells = keys.map(k => {
      const label = window.DZC.statLabel(k);
      // The hover carries what the stat MEANS. It used to carry the label,
      // which the cell prints directly underneath — a tooltip repeating what
      // is already on the screen.
      return `<div class="dzc-stat" title="${esc(window.DZC.statHelp(k))}">
        <span class="dzc-stat-i">${window.DZCIcon.stat(k, { size: 17, type: u.type })}</span>
        <span class="dzc-stat-v">${esc(stats[k])}</span>
        <span class="dzc-stat-k">${esc(compact ? k : label)}</span>
      </div>`;
    }).join('');
    return `<div class="dzc-stats${compact ? ' is-compact' : ''} n-${keys.length}">${cells}</div>`;
  }

  /* Rule keywords, each resolved to its glossary text and tappable. */
  /* Every rule carries its text on hover, so you can read it without
   * committing to a click. Clicking still opens the fuller popup with the
   * rule's name and where it comes from. */
  /* WHICH RULES BELONG TO WHICH LOADOUT. Jet, 2026-08-07: "sort special
   * abilities that are only on one loadout, into that loadout. IE Scanner
   * (Greave) means this goes only on the greave variant."
   *
   * 3.2.2 says the same: "Special rules which only apply to certain Variants
   * will be indicated in brackets after the rule."
   *
   * The bracket is parsed by the SCANNER, not here -- u.specialVariants is
   * [{rule, variants}], the same shape a weapon's variant restriction already
   * takes. 3f7b541 recorded reading English at render time as the wrong answer
   * and this is the same trap one field over.
   *
   * `lens` names a Variant: pass one and you get only that Variant's rules,
   * pass nothing and you get the card's unrestricted ones. Matching is on
   * "ends with", because a rule that spans a comma -- "Ineffective:
   * Friendlies, Zones" -- is stored by its tail, and a tail is unique within
   * one card either way.
   *
   * A card with no specialVariants behaves exactly as it always did, which is
   * every card in five of the six factions and most of the sixth. */
  /* The token splitSpecial hands back still carries its bracket -- "Scanner
   * (Greave)" -- so the comparison has to drop it. Same regex dzc-data.js uses
   * to resolve a keyword, for the same reason. */
  const VARIANT_TAIL = /\s*\([^)]*\)\s*$/;

  function variantRuleFilter(u, lens) {
    const list = (u && u.specialVariants) || [];
    if (!list.length) return null;
    return tok => {
      const bare = String(tok).replace(VARIANT_TAIL, '').trim();
      const hit = list.find(x => bare === x.rule || bare.endsWith(x.rule));
      if (!hit) return !lens;              // unrestricted: the card's own
      return !!lens && hit.variants.indexOf(lens) !== -1;
    };
  }

  /* `bare` drops the "(Greave)" from the chip. Inside the Greave's own block
   * the bracket is the block's heading said twice, which CLAUDE.md §3 forbids
   * outright -- and it is the whole reason the rule moved there. */
  function rulesHtml(special, faction, filter, bare) {
    if (!special) return '';
    let toks = window.DZC.splitSpecial(special, faction);
    if (filter) toks = toks.filter(filter);
    if (bare) toks = toks.map(t => String(t).replace(VARIANT_TAIL, '').trim());
    if (!toks.length) return '';
    return toks.map(tok => {
      const r = window.DZC.rule(tok, faction);
      // The page goes on the hover too, not only in the popover: someone
      // reading the tooltip with the rulebook open wants to turn to it without
      // a second click to find out where.
      const tip = (window.DZC.ruleText(tok, faction) || 'No glossary entry — read it from the stat card.')
        + (r && r.page ? ` (p.${r.page})` : '');
      // Written out — "Tracking-1", not "T1". The printed token is still what
      // looks it up and still what the popover is opened with.
      return `<button type="button" class="dzc-rule${r ? '' : ' dzc-rule--unknown'}"
        onclick="DZCUnits.showRule(this,'${esc(tok).replace(/'/g, '&#39;')}')"
        title="${esc(tip)}">${esc(window.DZC.ruleLabel(tok, faction))}</button>`;
    }).join('');
  }

  function unitCard(u, faction) {
    const flags = [
      u.rare ? '<span class="dzc-flag dzc-flag--rare">Rare</span>' : '',
      u.unique ? '<span class="dzc-flag dzc-flag--unique">Unique</span>' : '',
      u.auxiliaryTransport ? '<span class="dzc-flag">Aux Transport</span>' : '',
      u.selectable === false ? '<span class="dzc-flag">Not selectable</span>' : ''
    ].join('');
    return `<article class="dzc-card" onclick="DZCUnits.openDetail('${esc(u.id)}')" tabindex="0"
      onkeydown="if(event.key==='Enter'){DZCUnits.openDetail('${esc(u.id)}')}">
      <!-- Picture, and directly under it the capacity and cargo symbols — on
           EVERY card, whether the unit prints one or not. They used to sit at
           the bottom of the body and only when there was something to show, so
           the one thing that decides whether a Unit can join a Group was in a
           different place on every card and missing from a third of them. A
           fixed slot is a place the eye can go without reading. -->
      <div class="dzc-card-side">
        <div class="dzc-card-art">${u.art ? `<img src="${esc(u.art)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</div>
        <div class="dzc-card-caps">${transportHtml(u) || '<span class="dzc-caps-none">—</span>'}</div>
      </div>
      <div class="dzc-card-body">
        <h3 class="dzc-card-name">${esc(u.name)}</h3>
        <div class="dzc-card-meta">
          <span class="dzc-cat" data-cat="${esc(u.category)}">${esc(u.category)}</span>
          <span>${esc(u.type || '')}</span>
          <span class="dzc-points">${pointsHtml(u)}</span>
          <span class="dzc-squad">${sizeHtml(u)}</span>
          ${flags}
        </div>
        <div class="dzc-card-stats">${statsHtml(u)}</div>
      </div>
    </article>`;
  }

  async function render() {
    const root = document.getElementById('view-units');
    if (!root) return;
    await window.DZC.loadIndex();
    const f = await window.DZC.loadFaction(state.faction);
    const acc = (FACTIONS.find(x => x.id === state.faction) || {}).accent || '#1b3a5c';

    const q = state.search.trim().toLowerCase();
    let units = f.units.slice();
    if (q) units = units.filter(u => window.DZC.matches(u, q, state.faction));
    if (state.category !== 'All') units = units.filter(u => u.category === state.category);

    const tabs = FACTIONS.map(x =>
      `<button type="button" class="dzc-tab${x.id === state.faction ? ' is-active' : ''}"
        style="--acc:${x.accent}" onclick="DZCUnits.setFaction('${x.id}')" title="${esc(x.full)}"
        >${esc(x.name)}</button>`).join('');

    const cats = ['All'].concat(CATEGORIES).map(c =>
      `<button type="button" class="dzc-chip${c === state.category ? ' is-active' : ''}"
        onclick="DZCUnits.setCategory('${c}')">${esc(c)}</button>`).join('');

    /* Every category the six know about, and then anything else the data
     * carries. That tail is not defensive padding: the Venus Drone's card
     * prints "N/A" where a category goes, and mapping over a fixed list of six
     * dropped it off the page while the count line above still said eleven of
     * eleven. A Unit that is on the screen's own count and not on the screen
     * is the worst version of hiding something. */
    const extra = [...new Set(units.map(u => u.category)
      .filter(c => c && CATEGORIES.indexOf(c) === -1))];
    const groups = CATEGORIES.concat(extra).map(cat => {
      const inCat = units.filter(u => u.category === cat);
      if (!inCat.length) return '';
      const pts = inCat.map(u => u.points).filter(p => p != null);
      return `<section class="dzc-group">
        <h2 class="dzc-group-head">${esc(cat)}
          <span class="dzc-group-count">${inCat.length} unit${inCat.length === 1 ? '' : 's'}</span>
          ${cat === 'Generated' ? '<span class="dzc-group-note">produced in play — cannot be chosen</span>' : ''}
        </h2>
        <div class="dzc-grid">${inCat.map(u => unitCard(u, state.faction)).join('')}</div>
      </section>`;
    }).join('');

    root.innerHTML = `
      <div class="dzc-wrap" style="--acc:${acc}">
        <div class="dzc-tabs">${tabs}</div>
        <div class="dzc-toolbar">
          <input class="dzc-search" type="search" placeholder="Search units, variants, weapons or rules"
                 value="${esc(state.search)}" oninput="DZCUnits.setSearch(this.value)" aria-label="Search units">
          <div class="dzc-chips">${cats}</div>
        </div>
        <p class="dzc-count">${units.length} of ${f.units.length} units${q ? ` matching “${esc(state.search)}”` : ''}</p>
        <!-- Named by cause, and worded exactly as the picker words it. "Nothing
             matches that search" over an empty category is the app blaming a
             search box you never touched. -->
        ${groups || `<p class="dzc-empty">${q ? `Nothing matches “${esc(state.search)}”.`
          : 'Nothing in this category.'}</p>`}
      </div>`;
  }

  /* `faction` is optional: the reference browses one at a time, but the army
   * builder opens a unit from whatever faction that army is. */
  /* The weapon table, whole. Shared with the builder so a Unit sitting in your
   * army reads exactly as it does when you open it -- there is no version of
   * this that is "enough for the roster", because the numbers you argue over
   * at the table are the ones in this table. */
  /* The weapon table's header and one row of it, separately, because the
   * upgrade chooser needs the same eight columns with a ninth of its own —
   * an upgrade is a weapon and should be read as one, not as a name and a
   * price you have to go and look up. */
  /* Every column heading carries its rulebook definition on hover, the same
   * way the stat cells do — "Accuracy" over a column of 3+ and 4+ tells you
   * nothing about the "A" two rows down, which hits automatically (2.7). */
  function wpnHead(extra) {
    const h = k => esc(window.DZC.weaponColHelp(k));
    return `<tr><th>Weapon</th><th title="${h('Arc')}">Arc</th>
      <th class="dzc-wpn-ma" title="${h('MA')}">${window.DZCIcon.moveAttack({ size: 15 })}M&amp;A Max</th>
      <th title="${h('R')}">Range</th><th title="${h('Att')}">Attacks</th>
      <th title="${h('Ac')}">Accuracy</th><th title="${h('E')}">Energy</th>
      <th>Special</th>${extra || ''}</tr>`;
  }

  /* opts.only overrides the variant note (the upgrade chooser splits one
   * weapon into a row per variant, so the row says which one it is offering
   * rather than listing them all), and opts.price drops the +Npts tag when
   * something else on the row is already the price. */
  function wpnCells(w, faction, opts) {
    const fac = faction || state.faction;
    const o = opts || {};
    const only = o.only !== undefined ? o.only : ((w.variants || []).length ? w.variants.join(', ') : '');
    return `<td class="dzc-wpn-name">${esc(w.name)}
        ${only ? `<span class="dzc-wpn-only">${esc(only)} only</span>` : ''}
        ${o.price !== false && w.upgradePoints != null ? `<span class="dzc-wpn-up">+${w.upgradePoints}pts</span>` : ''}</td>
      <td class="dzc-arc-cell">${window.DZCIcon.arc(w.arc)}<span>${esc(w.arc || '')}</span></td>
      <td>${esc(w.ma || '')}</td><td>${esc(w.r || '')}</td>
      <td>${esc(w.att || '')}</td><td>${esc(w.ac || '')}</td><td>${esc(w.e || '')}</td>
      <td>${rulesHtml(w.special, fac)}</td>`;
  }

  /* Does this Squad actually fire this gun? `opts.variants` is what its models
   * are and `opts.hasUpgrade` says which upgrades it bought; with neither, the
   * question is not being asked and every gun on the card is live.
   *
   * The variant test only bites when the Unit HAS variants. A model on a Unit
   * with none carries variant: null, and testing against a list of nulls would
   * call every variant-boxed row dead on a Unit with no variants to take. */
  function weaponLive(u, w, opts) {
    const o = opts || {};
    if (o.variants && (u.variants || []).length && w.box === 'variant'
        && (w.variants || []).length
        && !w.variants.some(v => o.variants.indexOf(v) !== -1)) return false;
    if (o.hasUpgrade && w.box === 'upgrade' && !o.hasUpgrade(w)) return false;
    return true;
  }

  /* Does this gun belong in the block headed `lens`?
   *
   * The test used to be "box is variant, and it names this one", which read the
   * box rather than the restriction and got both edges wrong.
   *
   * An UPGRADE may be restricted too. "Menchit and Styx may replace Twin RX-20
   * Miniguns with RM-4 Foeslayer Missiles" -- so the Foeslayer is not a gun an
   * Ares may buy, and it was appearing in the Ares block with a live +5pts
   * button and no restriction printed on it, because the block suppresses the
   * "Menchit, Styx" chip on the grounds that the heading already says which
   * variant you are looking at. Reported by a player, 2026-08-09: "The
   * Foeslayer should be Menchit and Styx only."
   *
   * A gun that names NOBODY belongs to everybody, which now includes the one
   * variant-boxed row whose variants the scanner could not resolve (the Surge
   * Gunship's Decon Pulse, boxUnresolved). It used to fall out of every block
   * and so off the Squad entirely -- a gun printed on the card that the app
   * would not show you anywhere. Shown in all four blocks is the wrong-but-
   * visible answer, and visible is the one that matters. */
  function inLens(w, lens) {
    if (!lens) return true;
    const vs = w.variants || [];
    return !vs.length || vs.indexOf(lens) !== -1;
  }

  /* Which printed weapons a bought upgrade has taken AWAY, by index.
   *
   * Five cards print a swap — "May replace both its MC-20 Chainguns with MM-15
   * Sidearm Missiles" — and the app used to grant the new gun and keep the old
   * ones, so a Super Heavy Tank went to the table with a sheet listing three
   * guns it does not have. The scanner reads the sentence into what it removes
   * and what it grants; this applies it.
   *
   * By INDEX, not by name: a card prints "MC-20 Chaingun" on two separate rows
   * and the Lifthawk's swap takes ONE of its two MM-3 Missile Pods. A name is
   * not enough to say which rows went. */
  function removedByUpgrades(u, opts) {
    const o = opts || {};
    const out = {};
    if (!o.hasUpgrade) return out;
    const ws = u.weapons || [];
    (u.swaps || []).forEach(sw => {
      // A swap with no gun to buy has no control to take it with yet — the
      // Harrier Gunship's "remove one UM-117 Cannons and gain Scanner and
      // Scout". Its sentence is still printed; nothing is removed for it.
      if (!sw.grants) return;
      const gun = ws.find(w => w.box === 'upgrade' && w.name === sw.grants);
      if (!gun || !o.hasUpgrade(gun)) return;
      // "Menchit and Styx may replace..." only bites on a Squad fielding one.
      if ((sw.variants || []).length && o.variants
          && !sw.variants.some(v => o.variants.indexOf(v) !== -1)) return;
      (sw.removes || []).forEach(r => {
        let left = r.count == null ? ws.length : r.count;
        ws.forEach((w, i) => {
          if (left > 0 && !out[i] && w.name === r.weapon) { out[i] = true; left--; }
        });
      });
    });
    return out;
  }

  /* The guns a Squad fires, with the rest dropped. This is the PAPER answer:
   * the printed sheet cannot dim a row, and its rules appendix must not collect
   * a rule off a gun nobody fires — a paragraph printed for nothing. On screen
   * use weaponsHtml, which marks instead of drops. */
  function unitWeapons(u, opts) {
    const o = opts || {};
    if (!o.variants && !o.hasUpgrade) return u.weapons || [];
    const gone = removedByUpgrades(u, o);
    return (u.weapons || []).filter((w, i) => !gone[i] && weaponLive(u, w, o));
  }

  /* Every weapon printed on the card, always — including guns that only a
   * variant you did not take carries, and upgrades nobody has bought.
   *
   * A Squad used to get this table filtered down to the guns it fires, which
   * fixed the right fault with the wrong tool: the problem was that nothing
   * said which rows were live, and the answer taken was deletion. Marking says
   * it without hiding, keeps the table the same shape as the card you are
   * holding, and stops it changing height every time you toggle an upgrade.
   * Nothing on a row needs explaining that the row does not already say — the
   * name cell carries "Alexander only" and "+10pts" as it always has. */
  /* The variant switcher over a weapon table.
   *
   * A Unit with four variants prints eight guns and only three of them are on
   * the model in front of you; reading the card means holding "Alexander only"
   * in your head down the whole Name column. The switcher does that reading:
   * pick a variant and the table is that variant's guns and the ones every
   * variant carries.
   *
   * It is a LENS, not a choice — it changes nothing about the Unit and nothing
   * about a Squad. Which is why it opens on "All": the card is the whole card
   * until you ask it to be less, and a switcher that starts filtered is a
   * switcher that hides seven eighths of a stat card from someone who did not
   * ask. */
  function variantLensHtml(u) {
    const vs = u.variants || [];
    if (vs.length < 2) return '';
    const sel = state.lens[u.id] || '';
    const chip = (val, label) => `<button type="button" class="dzc-chip dzc-chip--sm${
      sel === val ? ' is-active' : ''}" aria-pressed="${sel === val}"
      onclick="DZCUnits.setLens('${esc(u.id)}','${esc(val).replace(/'/g, '&#39;')}')"
      >${esc(label)}</button>`;
    return `<div class="dzc-chips dzc-lens">${
      [chip('', 'All')].concat(vs.map(v => chip(v.name, v.name))).join('')}</div>`;
  }

  function weaponsHtml(u, faction, opts) {
    /* THE UNIT'S OWN FACTION FIRST. A Behemoth belongs to one of the six and
     * prints that faction's rules, but it is browsed from a tab whose id is
     * "behemoth" -- so a Type 7 Grand Walker's "Nanomachines" was looked up in
     * a faction glossary that has no such rule and came back as "No glossary
     * entry for this keyword", which is the one thing a rule chip must never
     * say. The caller's faction is the fallback, not the answer. */
    const fac = u.faction || faction || state.faction;
    const o = opts || {};
    const marking = !!(o.variants || o.hasUpgrade);
    const all = u.weapons || [];
    if (!all.length) return '<p class="dzc-none">No weapons.</p>';
    /* The lens narrows what is drawn to one variant's guns plus the ones every
     * variant carries. Rows keep their ORIGINAL index, because a swap removes
     * the second of two identically-named rows and a re-indexed list would
     * strike out the wrong one. */
    const lens = o.lens === undefined ? state.lens[u.id] : o.lens;
    const gone = marking ? removedByUpgrades(u, o) : {};
    const rows = all.map((w, i) => [w, i])
      .filter(([w]) => inLens(w, lens))
      .map(([w, i]) => {
        // A weapon a swap took away is struck out rather than dimmed. It is not
        // "a gun this Squad could have" — it is one the card printed and the
        // purchase above traded in, which is a different thing to say.
        const mark = gone[i] ? 'is-swapped' : weaponLive(u, w, o) ? 'is-live' : 'is-off';
        const cls = [w.box === 'upgrade' ? 'is-upgrade' : w.box === 'variant' ? 'is-variant' : '']
          .concat(marking ? [mark] : [])
          .filter(Boolean).join(' ');
        return `<tr${cls ? ` class="${cls}"` : ''}>${wpnCells(w, fac)}</tr>`;
      }).join('');
    return `
      <table class="dzc-wpn${marking ? ' dzc-wpn--marked' : ''}">
        <thead>${wpnHead()}</thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  /* The arrow on the variant chip. Drawn rather than typed: "▸" is a glyph
   * some systems do not have, and a missing glyph in a 10px chip is a box. */
  const ARROW = '<svg class="dzc-wc-only-i" width="6" height="7" viewBox="0 0 6 7" '
    + 'aria-hidden="true" focusable="false"><path d="M0 0l6 3.5L0 7z" fill="currentColor"/></svg>';

  /* A weapon as a CARD rather than a row of a wide table.
   *
   * The table wants ~620px and got it by scrolling sideways inside its own box,
   * which on a phone means the Special column — the one carrying the rules — is
   * the one you never see without dragging. And eight columns of 10px headings
   * repeated above every Unit is a lot of chrome for six numbers.
   *
   * The card is Jet's layout: the name, the arc drawn once at a size you can
   * actually read, then the six values in two columns of label-and-number, then
   * the rules underneath at full width. Nothing is dropped — this is the same
   * eight fields, laid out to be read rather than to line up.
   *
   * The numbers still line up: each pair is a grid with a fixed label column, so
   * every value in a card starts at the same x whatever its label says.
   */
  function wpnCard(w, faction, opts) {
    const fac = faction || state.faction;
    const o = opts || {};
    const cell = (k, v) => v == null || v === '' ? '' :
      `<div class="dzc-wc-stat" title="${esc(window.DZC.weaponColHelp(k))}">
         <span class="dzc-wc-k">${k === 'MA' ? window.DZCIcon.moveAttack({ size: 13 }) : ''
           }${esc(window.DZC.weaponColLabel(k))}</span>
         ${k === 'E'
           /* Energy is the one stat that is a QUESTION rather than a number:
              on its own it says nothing, and paired with the Armour in front
              of you it says what you roll to hurt it and what you roll to
              Crit (6.2.4). So it is the one stat you can press. */
           ? `<button type="button" class="dzc-wc-e"
                onclick="DZCUnits.showDamage(this,'${esc(String(v)).replace(/'/g, '&#39;')}')"
                aria-label="Damage and Critical rolls for Energy ${esc(v)}">${esc(v)}</button>`
           : `<span class="dzc-wc-v">${esc(v)}${k === 'Att'
           /* "5d6". Attacks IS a number of dice, so it prints as one --
              Jet, 2026-08-07. */
           ? window.DZCIcon('dice', { size: 13 }) : ''}</span>`}</div>`;
    /* "Sabre only" — and NOT under a heading that already says Sabre.
     *
     * Jet, 2026-08-07: "remove this line shit: Sabre only... it's obvious what
     * the source is." In a Squad the cards are dealt out into a block per
     * variant, so the gun under the Sabre heading is the Sabre's gun and the
     * label repeated the heading four rows running. `grouped` is that case.
     * Ungrouped — the reference card, which prints every gun in one list —
     * nothing else says it, so it stays. */
    const only = o.grouped || !(w.variants || []).length ? '' : w.variants.join(', ');
    return `<article class="dzc-wc${o.cls ? ' ' + o.cls : ''}">
      <header class="dzc-wc-head">
        <h4 class="dzc-wc-name">${esc(w.name)}</h4>
        ${only ? `<span class="dzc-wc-only">${ARROW}${esc(only)}</span>` : ''}
        ${w.upgradePoints == null ? ''
          /* The price is the BUTTON when there is somewhere to buy it. The
             upgrade table under the Squad printed this whole weapon a second
             time just to hang a price on it -- same eight fields, once as a
             card and once as a row. The card is the better of the two, so the
             price moved onto it and the table went. */
          : o.buy ? o.buy(w)
          : `<span class="dzc-wpn-up">+${w.upgradePoints}pts</span>`}
      </header>
      <div class="dzc-wc-body">
        <div class="dzc-wc-arc" title="${esc(window.DZCIcon.arcLabel(w.arc) || '')}">
          ${window.DZCIcon.arc(w.arc, { size: 32 })}
          <span>${esc(w.arc || '')}</span>
        </div>
        <div class="dzc-wc-stats">
          ${cell('MA', w.ma)}${cell('Att', w.att)}
          ${cell('R', w.r)}${cell('Ac', w.ac)}
          ${cell('E', w.e)}
        </div>
      </div>
      ${w.special ? `<div class="dzc-wc-rules">${rulesHtml(w.special, fac)}</div>` : ''}
    </article>`;
  }

  /* Which guns were this Squad's last time we drew it, keyed by Squad and
   * weapon name. Buying an upgrade or taking a Variant rebuilds the whole
   * builder, so without a memory across renders there is no way to tell "this
   * gun is yours" from "this gun just became yours" — and the moment you paid
   * for it is the moment worth marking.
   *
   * A name the map has never seen is not an unlock: the first draw of a Squad
   * would otherwise light up every gun it owns. */
  const wasLive = new Map();

  /* The same list of weapons, as cards. Same filtering and the same marks. */
  function weaponCardsHtml(u, faction, opts) {
    // The unit's own faction first -- see weaponsHtml.
    const fac = u.faction || faction || state.faction;
    const o = opts || {};
    const marking = !!(o.variants || o.hasUpgrade);
    const all = u.weapons || [];
    if (!all.length) return '<p class="dzc-none">No weapons.</p>';
    const lens = o.lens === undefined ? state.lens[u.id] : o.lens;
    const gone = marking ? removedByUpgrades(u, o) : {};
    const cards = all.map((w, i) => [w, i])
      .filter(([w]) => inLens(w, lens))
      .map(([w, i]) => {
        const mark = gone[i] ? 'is-swapped' : weaponLive(u, w, o) ? 'is-live' : 'is-off';
        let gained = '';
        if (marking && o.key) {
          const id = o.key + '|' + w.name;
          const live = mark === 'is-live';
          if (live && wasLive.get(id) === false) gained = ' is-gained';
          wasLive.set(id, live);
        }
        /* No variant EDGE on a card. It said what the chip beside the name
         * says (see .dzc-wc-only), and in a lensed list -- one variant's guns
         * under that variant's heading -- it said what the heading says, on
         * every card in the block. The upgrade edge stays: "can I buy this"
         * is a different question and the only one still needing an edge. */
        const cls = [w.box === 'upgrade' ? 'is-upgrade' : '']
          .concat(marking ? [mark] : []).filter(Boolean).join(' ') + gained;
        return wpnCard(w, fac, { cls: cls, buy: o.buy, grouped: !!lens });
      }).join('');
    return `<div class="dzc-wcards${marking ? ' dzc-wcards--marked' : ''}">${cards}</div>`;
  }

  /* A Behemoth's Gear: equipment priced in POWER, not points.
   *
   * It costs nothing to put on a list — it comes out of the same pool the
   * Behemoth spends to act (Behemoth rules 1.2, 1.7) — so it is not a purchase
   * and gets no buttons. It is a price list you read during a game, which is
   * why it sits with the weapons rather than with the upgrades.
   *
   * Each name is run through the rule linker, so "Jump System 18”" is the chip
   * that opens 1.7.2 with its own 18 substituted in.
   */
  function gearHtml(u, faction) {
    const fac = u.faction || faction || state.faction;
    if (!(u.gear || []).length) return '';
    return `<div class="dzc-gear">
      <span class="dzc-gear-head">Gear — paid in Power, not points</span>
      <ul class="dzc-gear-list">${u.gear.map(g => `<li>
        <span class="dzc-gear-pt">${esc(g.power)}<small>PT</small></span>
        ${rulesHtml(g.name, fac) || esc(g.name)}</li>`).join('')}</ul>
    </div>`;
  }

  /* The sentence on the card that qualifies its upgrades — "Only one of these
   * upgrades may be taken", "May replace both its MC-20 Chainguns with MM-15
   * Sidearm Missiles". The builder has always shown it over the upgrade
   * buttons, where it is the constraint on a choice; here it is the same
   * sentence over the table you are reading the choice out of, and without it
   * an upgrade row said what the gun is and nothing about what taking it costs
   * you.
   *
   * Gated on there BEING an upgrade, which is belt and braces now that
   * audit_data refuses a note with no upgrade weapon behind it — the fault it
   * was written for was Drones and Hulks carrying a paragraph of lore in this
   * field, and that is fixed in the scanner. The gate stays because a note
   * with nothing to qualify is not a note, whatever put it there. */
  function upgradeNoteHtml(u) {
    if (!u.upgradeNote) return '';
    if (!(u.weapons || []).some(w => w.box === 'upgrade')) return '';
    return `<p class="dzc-upg-note">${esc(u.upgradeNote)}</p>`;
  }

  /* A variant is a different model, so it gets its own block rather than a
   * line in a price list: what it is called, the gun that makes it that
   * variant, what it costs, and the stats it fights with. A weapon marked
   * "all" is on every variant, so only the variant-restricted ones name it. */
  /* `control` lets the builder hang a count on each block without this file
   * learning anything about armies. The reference view passes nothing and the
   * blocks stay what they are: a description. In a Squad they become the
   * control itself, which is how the per-model dropdowns went away.
   *
   * `opts.stats: false` drops the stat grid under each block. DZC variants
   * differ by gun and price and never by stats, so a Squad of five variants
   * repeated one identical grid five times — which is worth it when you are
   * comparing two Units and is pure bulk when you are scanning ten. Compact
   * view is what asks for it. */
  /* Variants, and their stats ONLY where a variant has any of its own.
   *
   * This used to print statsHtml(u) under every variant -- the UNIT's stats,
   * not the variant's, so it was the same block by construction. A Polecat
   * Buggy showed Move 9" / Armour 4 / Damage Points 1 four times in one card:
   * once for itself and once under each of Polecat A, B and C. Across all six
   * factions there are 218 variants and not one of them changes a stat, so
   * there was never a case where the copy said anything.
   *
   * Kept as a capability rather than deleted: the day a variant does carry its
   * own profile, this draws it. Today it draws nothing, and a variant is what
   * it actually is -- a name, its gun and its price. */
  function variantsHtml(u, control, opts) {
    const withStats = !opts || opts.stats !== false;
    if (!(u.variants || []).length) return '';
    const base = JSON.stringify(u.stats || {});
    return `<div class="dzc-variants">
      ${u.variants.map((v, i) => {
        const own = (u.weapons || []).filter(w =>
          w.box === 'variant' && (w.variants || []).indexOf(v.name) !== -1);
        const head = [esc(v.name)]
          .concat(own.length ? [own.map(w => esc(w.name)).join(', ')] : [])
          .concat([v.points != null ? v.points + 'pts' : '—'])
          .join(' — ');
        const differs = v.stats && JSON.stringify(v.stats) !== base;
        // The rules the card gives this Variant and no other (3.2.2). On the
        // Variant, the same as its own weapons are -- the whole point of the
        // list is that a line says what one loadout IS.
        const vr = rulesHtml(u.special, u.faction, variantRuleFilter(u, v.name), true);
        return `<div class="dzc-variant">
          <div class="dzc-variant-head"><span>${head}</span>${control ? control(v, i) : ''}</div>
          ${vr ? `<div class="dzc-variant-rules">${vr}</div>` : ''}
          ${withStats && differs ? statsHtml(Object.assign({}, u, { stats: v.stats })) : ''}
        </div>`;
      }).join('')}
    </div>`;
  }

  /* Every rule this Unit uses, in full, under the weapon table.
   *
   * A chip with a tooltip is fine when you already know the rule and want
   * reminding. It is not fine when you are deciding: you cannot compare two
   * Units by hovering eleven chips in turn, and on a phone there is no hover
   * at all, so the tooltip does not exist. The source comment on Dropfleet's
   * equivalent says it outright — "always visible, this is build-critical
   * info, not flavour" (app.js:4129).
   *
   * Keyed by the PRINTED keyword rather than the rule id, the same way the
   * printed sheet keys it: Aegis 3" and Aegis 6" are one entry and two
   * different sentences once the value is folded in, and this Unit's is the
   * one that matters. Weapon rules are in, because a rule on the gun is a rule
   * you are choosing (gap 44). */
  function unitRulesHtml(u, faction) {
    // The Unit's own faction wins. A Behemoth sits under the Behemoths tab but
    // belongs to one of the six, and its card prints that faction's rules.
    const fac = u.faction || faction || state.faction;
    const used = new Map();
    [u.special || ''].concat((u.weapons || []).map(w => w.special || '')).forEach(sp => {
      window.DZC.splitSpecial(sp, fac).forEach(tok => {
        if (used.has(tok)) return;
        const r = window.DZC.rule(tok, fac);
        if (r) used.set(tok, r);
      });
    });
    if (!used.size) return '';
    const rows = [...used.keys()].map(tok => [tok, window.DZC.ruleLabel(tok, fac)])
      // Sorted on what it is CALLED, because that is what is printed and what
      // you are scanning for. Sorting on "TX" put Tracking between Terror and
      // UC.
      .sort((a, b) => a[1].localeCompare(b[1])).map(([tok, label]) => {
      const r = used.get(tok);
      return `<div class="dzc-ruledef">
        <h5>${esc(label)}${label.toLowerCase() !== tok.toLowerCase()
          ? ` <i>(${esc(tok)})</i>` : ''}</h5>
        <p>${window.DZC.linkKeywords(window.DZC.ruleText(tok, fac), fac, r.name)}</p>
        <span class="dzc-ruledef-src">${esc(ruleSource(r))}</span>
      </div>`;
    }).join('');
    return `<div class="dzc-ruledefs">${rows}</div>`;
  }

  function openDetail(unitId, faction) {
    if (faction) state.faction = faction;
    const f = window.DZC.faction(state.faction);
    const u = f && f.byId[unitId];
    if (!u) return;
    const weapons = weaponCardsHtml(u, u.faction || state.faction);
    detailOf = { id: unitId, faction: state.faction };
    const variants = variantsHtml(u);

    document.getElementById('dzc-detail-body').innerHTML = `
      <div class="dzc-detail-head">
        ${u.art ? `<img class="dzc-detail-art" src="${esc(u.art)}" alt="" onerror="this.remove()">` : ''}
        <div>
          <!-- Capacity sits beside the name at size, not buried under the meta
               line: what a Transport can carry is the first thing you look for
               on one, and the shapes are the whole grammar (3.2.4.2). -->
          <h3 class="dzc-detail-name">${esc(u.name)}
            <span class="dzc-detail-cap">${transportHtml(u)}</span></h3>
          <!-- Where it is in TTCombat's PDF. Every rule already says which page
               of the rulebook it is on; the Unit itself said nothing, so the
               one thing you cannot look up from the app -- the printed card,
               with the art and the wording -- was the one thing with no
               reference. Scanned per Unit, so it cannot go stale against a
               re-scan the way a typed number would. -->
          <p class="dzc-detail-meta"><span class="dzc-cat" data-cat="${esc(u.category)}">${esc(u.category)}</span> <span>${esc(u.type || '')}</span>
            <span>${pointsHtml(u)}</span> <span>${sizeHtml(u)}</span>
            ${u.page ? `<span>Stat card p.${esc(u.page)}</span>` : ''}
            ${u.rare ? '<span class="dzc-flag dzc-flag--rare">Rare</span>' : ''}${u.unique ? '<span class="dzc-flag dzc-flag--unique">Unique</span>' : ''}</p>
          <div class="dzc-card-stats">${statsHtml(u)}</div>
        </div>
      </div>
      ${u.special ? (r => r ? `<div class="dzc-detail-rules">${r}</div>` : '')(
        rulesHtml(u.special, u.faction || state.faction, variantRuleFilter(u, null))) : ''}
      ${variants}
      ${variantLensHtml(u)}
      ${weapons}
      ${gearHtml(u, u.faction || state.faction)}
      ${upgradeNoteHtml(u)}
      ${unitRulesHtml(u, u.faction || state.faction)}`;
    /* NOT the Unit's name: the body opens with it, at size and beside its
     * capacity symbol, and on a phone both were on screen at once. The header
     * is what stays put when the body scrolls, so it says what the panel is —
     * in the app's own words for it, and not the word this project does not
     * write (CLAUDE.md §3). */
    document.querySelector('#dzc-detail .modal-title').textContent = 'Stats, weapons and rules';
    document.getElementById('dzc-detail').classList.add('active');
  }

  /* Redraw the open card with a different variant selected. The whole panel is
   * rebuilt rather than the table swapped in place, because the variant blocks
   * above it carry the same selection and would otherwise disagree with it. */
  function setLens(unitId, variant) {
    state.lens[unitId] = variant || '';
    if (detailOf && detailOf.id === unitId) openDetail(unitId, detailOf.faction);
  }

  let detailOf = null;

  function closeDetail() { document.getElementById('dzc-detail').classList.remove('active'); }

  /* Where a rule comes from, close enough to go and read it. The section
   * number says which rule; the page number says where the book falls open,
   * which is the one you want mid-game with the rulebook on the table. */
  function ruleSource(r) {
    if (r.faction) return r.faction.toUpperCase() + ' rules';
    // Naming the right book. "Rulebook 3.1.8, p.9" for Macro pointed at the
    // core rulebook's page 9, which is the game-size table.
    const book = r.source === 'behemoths' ? 'Behemoth rules' : 'Rulebook';
    return book + ' ' + r.section + (r.page ? `, p.${r.page}` : '');
  }

  /* Rule popover. Positioned absolutely against the page so opening one never
   * displaces the content behind it. */
  function showRule(el, token) {
    hideRule();
    const r = window.DZC.rule(token, state.faction);
    const pop = document.createElement('div');
    pop.className = 'dzc-pop';
    pop.id = 'dzc-pop';
    // Headed with the written-out name and footnoted with what the card
    // prints, which is the way round you need it: you came here from the chip,
    // and the thing you cannot look up is which two letters on the stat card
    // this is.
    const label = window.DZC.ruleLabel(token, state.faction);
    pop.innerHTML = r
      ? `<h5>${esc(label)}${label.toLowerCase() !== String(token).trim().toLowerCase()
          ? ` <span class="dzc-pop-alias">(${esc(token)})</span>` : ''}</h5>
         <p>${window.DZC.linkKeywords(window.DZC.ruleText(token, state.faction), state.faction, r.name)}</p>
         <span class="dzc-pop-src">${esc(ruleSource(r))}</span>`
      : `<h5>${esc(token)}</h5><p>No glossary entry for this keyword — read it from the stat card.</p>`;
    document.body.appendChild(pop);
    placePop(pop, el);
    setTimeout(() => document.addEventListener('click', onDocClick), 0);
  }
  /* What this Weapon rolls to damage, and what it rolls to Crit, against every
   * Armour in the game (6.2.4). In the same popover the rules use, for the
   * same reason: it opens over the page rather than inside it, so pressing a
   * stat never moves the card you pressed.
   *
   * The Critical row is the whole point. It is TWO HIGHER THAN THE DAMAGE
   * ROLL, not two higher than the Weapon's Ac -- Ac decides whether you hit at
   * all, and this is the second roll after that. Against a 5+ or a 6+ there is
   * no Critical to be had, and the row says so rather than leaving a gap you
   * have to interpret. */
  function showDamage(el, energy) {
    hideRule();
    const t = window.DZC.damageTable(energy);
    const pop = document.createElement('div');
    pop.className = 'dzc-pop dzc-pop--dmg';
    pop.id = 'dzc-pop';
    if (t.kind !== 'energy') {
      pop.innerHTML = `<h5>${esc(String(energy))}</h5><p>${
        t.kind === 'small'
          ? `Small Arms. Each hit destroys 1DP of Infantry with no roll, so no Critical.
             Against a Vehicle or Aircraft it does nothing until five Small Arms attacks
             are combined into one attack at Energy ${t.e} (6.4.2).`
          : t.kind === 'zero'
            ? 'E0 cannot inflict damage on anything, Infantry included (6.2.4).'
            : 'This Weapon has no Energy value.'}</p>
        <span class="dzc-pop-src">6.2.4, p.21</span>`;
    } else {
      const head = t.rows.map(r => `<th>${r.a}</th>`).join('');
      const need = t.rows.map(r => `<td>${r.need ? r.need + '+' : '—'}</td>`).join('');
      const crit = t.rows.map(r => `<td>${r.crit ? r.crit + '+' : '—'}</td>`).join('');
      pop.innerHTML = `<h5>Energy ${esc(String(t.e))}</h5>
        <table class="dzc-dmg">
          <tr><th class="dzc-dmg-k">Armour</th>${head}</tr>
          <tr><th class="dzc-dmg-k">Damage</th>${need}</tr>
          <tr class="dzc-dmg-crit"><th class="dzc-dmg-k">Critical</th>${crit}</tr>
        </table>
        <p>A Critical is two higher than the damage roll, not the Weapon's Accuracy,
           and inflicts another 1DP. Infantry take 1DP per hit without rolling, so they
           never take Criticals.</p>
        <span class="dzc-pop-src">6.2.4, p.21</span>`;
    }
    document.body.appendChild(pop);
    placePop(pop, el);
    setTimeout(() => document.addEventListener('click', onDocClick), 0);
  }

  /* Under the control, and never off the right edge. Shared so the rule
   * popover and the damage table cannot drift apart. */
  function placePop(pop, el) {
    const b = el.getBoundingClientRect();
    pop.style.top = (window.scrollY + b.bottom + 6) + 'px';
    pop.style.left = Math.max(8, Math.min(window.scrollX + b.left,
      window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 8)) + 'px';
  }

  function onDocClick(e) { if (!e.target.closest('#dzc-pop')) hideRule(); }
  function hideRule() {
    const p = document.getElementById('dzc-pop');
    if (p) p.remove();
    document.removeEventListener('click', onDocClick);
  }

  window.DZCUnits = {
    render,
    open: () => render(),
    setFaction: id => { state.faction = id; state.search = ''; render(); },
    setCategory: c => { state.category = c; render(); },
    setSearch: v => { state.search = v; render(); },
    openDetail, closeDetail, setLens, showRule, showDamage, hideRule,
    // Shared with the builder's picker so a unit reads the same in both places.
    statsHtml, rulesHtml, variantRuleFilter, squadHtml, sizeHtml, transportHtml, unitWeapons, weaponLive,
    removedByUpgrades, weaponsHtml, variantsHtml,
    unitRulesHtml, wpnHead, wpnCells, wpnCard, weaponCardsHtml, variantLensHtml,
    pointsHtml, shape: shapeSvg,
    SHAPES: Object.keys(SYMBOL),
    shapeInk: s => (SYMBOL[s] || {}).ink || 'currentColor',
    shapeName: s => String(s).replace('-', ' ')
  };
})();
