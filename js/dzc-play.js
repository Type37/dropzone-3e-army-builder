/* Play Mode, run a game from a built army.
 *
 * Tracks the things a Round actually needs and that are easy to get wrong at a
 * table, all of which come out of rulebook chapter 4:
 *
 *   4.1.1  CP is replenished UP TO your highest Commander Level on the table,
 *          and you LOSE CP if you hold more than that. Commanders count as
 *          Level 0 throughout Round 1, so Round 1 gives you nothing.
 *   4.1.2  Pass tokens come from having FEWER Groups than your opponent. Two
 *          fewer earns one, and each further Group earns another. Groups of
 *          only non-auxiliary Transports do not count toward either side.
 *   4.1.4  Command Card hand size is also the highest Commander Level.
 *   4.1.5  Initiative is D6 + highest Commander Level.
 *
 * Damage is tracked per MODEL rather than per Squad, because DP is a per-model
 * stat and a Squad shrinks as models die.
 *
 * A game is six Rounds "unless the Scenario says otherwise" (p34), which is
 * where the "of 6" beside the Round counter comes from and why the counter
 * still goes past it rather than stopping.
 *
 * State lives under the army id, so closing the tab mid-game loses nothing.
 */
(function () {
  'use strict';

  const KEY = 'dzc_play';
  /* Status Tokens are placed on a SQUAD, and the rulebook says so three times:
   *
   *   11.1.7  Concussion. "place a Concussed Status Token on its Squad.
   *           Concussed Squads suffer -2Ac."
   *   11.1.22 Jammer    , "place a Jammed Status Token on its Squad."
   *   11.1.34 Suppress  , "place a Suppressed Status Token on its Squad.
   *           Suppressed Squads may only move 0” if any Unit within it attacks."
   *
   * Obscured is not one of them and does not move. 10.1.21 Obscurer X”. "All
   * friendly Vehicle and Infantry UNITS within X” of this Unit are Obscured to
   * enemies". So it is a state a model is in because of where it is standing,
   * and two models of one Squad can genuinely differ. */
  const SQUAD_STATUSES = ['Concussed', 'Suppressed', 'Jammed'];
  const MODEL_STATUSES = ['Obscured'];

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let armyId = null;
  let state = null;

  /* A Behemoth prints several DP values, "6, 12, 22", and "the final value
   * is its actual DP" (Behemoth rules 1.5.5). The ones before it are the
   * thresholds where it becomes Degraded and then Crippled.
   *
   * parseInt on the whole string takes the FIRST number, so a Dragon came into
   * Play Mode with 6 damage points instead of 22 and would have been called
   * dead at a quarter of the damage it takes to kill. */
  function dpValues(u) {
    return String((u && u.stats && u.stats.DP) || '')
      .split(',').map(x => parseInt(x, 10)).filter(n => !isNaN(n));
  }

  function maxDp(u) {
    const v = dpValues(u);
    return v.length ? v[v.length - 1] : 1;
  }

  /* Intact, Degraded or Crippled, off the thresholds it has passed (1.5.5).
   * Only a Behemoth has any: everything else is alive or it is not. */
  function threshold(u, dp) {
    const v = dpValues(u);
    if (v.length < 2) return null;
    const lost = v[v.length - 1] - dp;
    // Two values means Intact or Crippled; three adds Degraded between them.
    if (v.length >= 3 && lost >= v[1]) return 'Crippled';
    if (v.length === 2 && lost >= v[0]) return 'Crippled';
    if (lost >= v[0]) return 'Degraded';
    return 'Intact';
  }

  /* Power, as a number. "Behemoths begin each Round with a number of Power
   * tokens (PT) equal to their Power" (Behemoth rules 1.3), and every Behemoth
   * in the game prints one, 4 to 10 of them. Nothing else does, so a missing
   * or unreadable Power means no track rather than a track of zero. */
  function power(u) {
    const n = parseInt((u && u.stats && u.stats.Power) || '', 10);
    return isNaN(n) ? 0 : n;
  }

  function blank(army) {
    const models = {}, squads = {};
    army.groups.forEach(g => g.squads.forEach(s => {
      const u = window.DZCArmy.unitOf(army, s);
      const dp = maxDp(u);
      models[s.id] = s.models.map(() => ({ dp: dp, max: dp, st: [] }));
      // RM starts at what you BOUGHT, because that is what is aboard when the
      // game begins (Genitor X). From there it only moves in play.
      squads[s.id] = { st: [], pt: power(u), rm: window.DZCArmy.rmOf(s) };
    }));
    return { round: 1, cp: 0, myVP: 0, oppVP: 0, oppGroups: 0, activated: {},
      models: models, squads: squads };
  }

  function load(army) {
    armyId = army.id;
    let all = {};
    try { all = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { all = {}; }
    state = all[armyId] || blank(army);
    // A Squad added or resized since the last session needs its models seeding.
    const fresh = blank(army);
    Object.keys(fresh.models).forEach(id => {
      if (!state.models[id]) state.models[id] = fresh.models[id];
      else if (state.models[id].length !== fresh.models[id].length) {
        const old = state.models[id];
        state.models[id] = fresh.models[id].map((m, i) => old[i] || m);
      }
    });
    /* A game saved before the Squad statuses moved carries all four on each
     * model. Hoist the three that belong to the Squad rather than dropping
     * them: a token placed on ANY model was a token on that Squad, which is
     * what the rules meant by it in the first place. */
    state.squads = state.squads || {};
    Object.keys(fresh.squads).forEach(id => {
      if (!state.squads[id]) state.squads[id] = fresh.squads[id];
      // A game saved before Power tokens existed has no pt on its Squads.
      if (state.squads[id].pt == null) state.squads[id].pt = fresh.squads[id].pt;
      // Nor RM. Seeded from the army rather than zeroed: a game in progress
      // when this shipped still has whatever it paid for aboard.
      if (state.squads[id].rm == null) state.squads[id].rm = fresh.squads[id].rm;
      (state.models[id] || []).forEach(m => {
        m.st = (m.st || []).filter(st => {
          if (MODEL_STATUSES.indexOf(st) !== -1) return true;
          if (state.squads[id].st.indexOf(st) === -1) state.squads[id].st.push(st);
          return false;
        });
      });
    });
    return state;
  }

  function save() {
    let all = {};
    try { all = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { all = {}; }
    all[armyId] = state;
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { /* quota */ }
  }

  // ------------------------------------------------------------ round maths

  /* Highest Commander Level on the table. Round 1 is deliberately 0: "Commanders
   * count as Level 0 throughout Round 1" (4.1.1), which means no CP, no cards
   * and no Initiative bonus in the first Round. */
  function commanderLevel(army) {
    if (state.round <= 1) return 0;
    let best = 0;
    army.groups.forEach(g => g.squads.forEach(s => {
      if (s.commander && aliveIn(s) > 0) best = Math.max(best, s.commander.level);
    }));
    return best;
  }

  function aliveIn(squad) {
    const m = state.models[squad.id] || [];
    return m.filter(x => x.dp > 0).length;
  }

  /* Groups that can be activated normally. A Group of only non-auxiliary
   * Transports cannot be picked (4.2.1) and is ignored for Pass tokens
   * (4.1.2), so Group count is NOT activation count. */
  function activeGroups(army) {
    return army.groups.filter(g => {
      const live = g.squads.filter(s => aliveIn(s) > 0);
      if (!live.length) return false;
      return !live.every(s => {
        const u = window.DZCArmy.unitOf(army, s);
        return u && u.category === 'Transport' && !u.auxiliaryTransport;
      });
    });
  }

  /* What a Group is WORTH, not that there is one. "A Behemoth counts as that
   * many Groups when building your Army and generating Pass tokens" (Behemoth
   * rules 1.1). The builder has counted them that way since they arrived and
   * Play Mode was still counting cards, so a Dragon worth five Groups was one
   * Group here and every Pass token in the game came out wrong.
   *
   * Dead models do not hold the Group open: the same rule that drops a wiped
   * Group out of activeGroups drops its weight with it. */
  function groupWeight(army, g) {
    const ge = (g.squads || []).filter(s => aliveIn(s) > 0).map(s => {
      const u = window.DZCArmy.unitOf(army, s);
      return (u && u.groupEquivalent) || 0;
    }).filter(Boolean);
    return ge.length ? Math.max.apply(null, ge) : 1;
  }

  function groupsOnTable(army) {
    return activeGroups(army).reduce((n, g) => n + groupWeight(army, g), 0);
  }

  function passTokens(army) {
    const mine = groupsOnTable(army);
    const theirs = state.oppGroups || 0;
    return theirs - mine >= 2 ? theirs - mine - 1 : 0;
  }

  // --------------------------------------------------------------- rendering

  async function open(id) {
    const root = document.getElementById('view-play');
    if (!root) return;
    await window.DZC.loadIndex();
    window.DZCArmy.load();
    const army = window.DZCArmy.get(id);
    if (!army) { location.hash = '#armies'; return; }
    await window.DZC.loadFaction(army.faction);
    load(army);
    render(army);
  }

  function render(army) {
    const root = document.getElementById('view-play');
    const lvl = commanderLevel(army);
    const pass = passTokens(army);

    root.innerHTML = `<div class="dzc-wrap dzc-play">
      <header class="dzc-play-head">
        <div class="dzc-round">
          <button type="button" onclick="DZCPlay.round(-1)" aria-label="Previous round">${window.DZCIcon('remove', { size: 16 })}</button>
          <span><b>Round ${state.round}</b><i>of 6</i></span>
          <button type="button" onclick="DZCPlay.round(1)" aria-label="Next round">${window.DZCIcon('add', { size: 16 })}</button>
        </div>
        <div class="dzc-play-vp">
          ${counter('My VP', state.myVP, 'myVP')}
          ${counter('Opp VP', state.oppVP, 'oppVP')}
        </div>
      </header>

      <!-- Two panes on a desktop, same split as the builder: the numbers you
           consult sit still on the left while the Groups you actually touch
           scroll on the right. One column meant scrolling the CP counter off
           the top the moment an army had more than three Groups. -->
      <div class="dzc-play-body">
      <div class="dzc-play-cards">
        <!-- No captions. Each card had a paragraph under it citing the rule
             that produced its number, which is the app explaining itself. The
             rules still live here, on hover, where they are there when you
             want them and silent when you do not. -->
        <div class="dzc-pcard" title="${state.round <= 1
          ? 'Commanders count as Level 0 throughout Round 1 (4.1.1)'
          : `Hand size is also ${lvl} card${lvl === 1 ? '' : 's'} (4.1.4)`}">
          <span class="dzc-pcard-k">Command Points</span>
          <span class="dzc-pcard-v">${state.cp}<i>/ ${lvl}</i></span>
          <div class="dzc-pcard-act">
            <button type="button" aria-label="One fewer Command Point"
                    onclick="DZCPlay.cp(-1)">−</button>
            <button type="button" aria-label="One more Command Point"
                    onclick="DZCPlay.cp(1)">+</button>
            <button type="button" onclick="DZCPlay.replenish()" title="Replenish up to your highest Commander Level (4.1.1)">Refill</button>
          </div>
        </div>

        <!-- Your own Group count is the other half of the Pass arithmetic, so
             it stays, as a number beside theirs, not as a sentence about it. -->
        <div class="dzc-pcard" title="A Group of only non-auxiliary Transports cannot be activated and is ignored here (4.1.2)">
          <span class="dzc-pcard-k">Pass Tokens</span>
          <span class="dzc-pcard-v">${pass}</span>
          <div class="dzc-pcard-act">
            <!-- Derived from the army, not typed. Uneditable IS the enforcement,
                 so it has to say why rather than just refuse the caret. -->
            <label>Yours<input type="number" value="${groupsOnTable(army)}" disabled
                   title="Counted from your army. Groups of only Transports are ignored (4.1.2), and a Behemoth counts as several (1.1)"></label>
            <label>Theirs
              <input type="number" min="0" max="40" value="${state.oppGroups}"
                     oninput="DZCPlay.oppGroups(this.value)"></label>
          </div>
        </div>

        <div class="dzc-pcard" title="A natural 6 wins outright; re-roll ties after adding Level (4.1.5)">
          <span class="dzc-pcard-k">Initiative</span>
          <span class="dzc-pcard-v">D6 +${lvl}</span>
          <div class="dzc-pcard-act">
            <button type="button" onclick="DZCPlay.roll()">Roll</button>
            <span id="dzc-roll" class="dzc-roll"></span>
          </div>
        </div>
      </div>

      <div class="dzc-play-main">
        ${army.groups.map(g => groupHtml(army, g)).join('')}
      </div>
      </div>
    </div>`;
  }

  function counter(label, val, key) {
    return `<div class="dzc-vp">
      <span>${esc(label)}</span>
      <button type="button" onclick="DZCPlay.vp('${key}',-1)" aria-label="Less">−</button>
      <b>${val}</b>
      <button type="button" onclick="DZCPlay.vp('${key}',1)" aria-label="More">+</button>
    </div>`;
  }

  function groupHtml(army, g) {
    const done = !!state.activated[g.id];
    const live = g.squads.filter(s => aliveIn(s) > 0);
    const canAct = activeGroups(army).some(x => x.id === g.id);
    /* Three different things stop a Group activating, and only one of them is
     * 4.2.2. A Group with nothing in it yet, and a Group whose every model is
     * dead, were both being tagged "orphaned transports" and told a rule about
     * transports they do not contain. Say which one it actually is. */
    const orphaned = !canAct && live.length > 0;
    /* A Behemoth does not have one activation to tick off. "When you may
     * activate a normal Group, you may instead activate a Behemoth with PT
     * remaining" (1.3). It goes as many times as it has Power tokens, so a
     * box that says "done" after the first Action says the wrong thing. Its
     * Power track is the tracker; the box is disabled and points at it. */
    const behemoth = g.squads.some(s => {
      const u = window.DZCArmy.unitOf(army, s);
      return u && u.type === 'Behemoth' && aliveIn(s) > 0;
    });
    const why = behemoth
      ? 'A Behemoth activates once per Power token, not once per Round (1.3). The Power track below is the count'
      : orphaned
        ? 'Cannot be picked for a normal activation (4.2.1); activates in the Orphaned Transport step (4.2.2)'
        : g.squads.length ? 'Nothing left in this Group' : 'No Squads in this Group';
    const tickable = canAct && !behemoth;
    return `<section class="dzc-play-group${done && !behemoth ? ' is-done' : ''}${live.length ? '' : ' is-dead'}">
      <header>
        <label class="dzc-act">
          <!-- The tag beside this says the same thing, but a disabled control
               has to carry its own reason: the tag is a separate hover target
               and you are pointing at the box that will not tick. -->
          <input type="checkbox" ${done && !behemoth ? 'checked' : ''} ${tickable ? '' : 'disabled'}
                 ${tickable ? '' : `title="${esc(why)}"`}
                 onchange="DZCPlay.activate('${g.id}')">
          <b>${esc(window.DZCArmy.groupName(army, g))}</b>
        </label>
        ${orphaned ? `<span class="dzc-play-tag" title="${why}">${window.DZCIcon('local_shipping', { size: 12 })} orphaned transports</span>` : ''}
      </header>
      ${g.squads.map(s => squadHtml(army, s)).join('')}
    </section>`;
  }

  /* The guns this Squad fires, and only those.
   *
   * Play Mode had no weapons on it at all, which made it a damage tracker
   * rather than something you could play off. The numbers you argue over
   * across a table are in this table, and the alternative was leaving the game
   * to go and open the card.
   *
   * FILTERED, not marked, which is the opposite of the builder and deliberate:
   * while you are building, a gun you did not take is a comparison, and while
   * you are playing it is a distraction. Same definition of what is in the
   * Squad either way, DZCArmy.squadGuns, so the two cannot drift. */
  function weaponsHtml(army, s, u) {
    const U = window.DZCUnits;
    const ws = U.unitWeapons(u, window.DZCArmy.squadGuns(s));
    if (!ws.length) return '';
    return `<div class="dzc-play-wpn">${
      ws.map(w => U.wpnCard(w, army.faction)).join('')}</div>`;
  }

  /* The Power track, which is how a Behemoth takes a turn at all.
   *
   * "Behemoths begin each Round with a number of Power tokens (PT) equal to
   * their Power. When you may activate a normal Group, you may instead
   * activate a Behemoth with PT remaining. It must then complete one Action
   * from the Power Table" (1.3). So a Behemoth goes several times a Round and
   * stops when its PT run out. Play Mode gave its Group the same one-shot
   * activation checkbox as everything else, which said a Dragon with ten PT
   * was finished for the Round after one Action.
   *
   * A track of dots rather than a number, because what you look at mid-Round
   * is "can it go again", and that is a shape, not arithmetic. */
  function ptHtml(s, u) {
    const max = power(u);
    if (!max) return '';
    const left = Math.max(0, Math.min(max, (state.squads[s.id] || {}).pt || 0));
    const dots = Array.from({ length: max }, (_, i) =>
      `<i class="dzc-pt-dot${i < left ? ' is-on' : ''}"></i>`).join('');
    return `<div class="dzc-play-pt" title="Power tokens: one Action each, refilled every Round (1.3)">
      <button type="button" onclick="DZCPlay.pt('${s.id}',-1)" aria-label="Spend a Power token">−</button>
      <span class="dzc-pt-track" aria-label="${left} of ${max} Power tokens left">${dots}</span>
      <b>${left}</b><i>of ${max} PT</i>
      <button type="button" onclick="DZCPlay.pt('${s.id}',1)" aria-label="Give back a Power token">+</button>
    </div>`;
  }

  /* RM ABOARD, which is the one number on a Genitor that changes every turn.
   *
   * You buy them before the game and then spend them: 4 for Drones, 6 for
   * Hulks, never more than the cap in one activation. You also GAIN them --
   * every Decon kill places 2 or 4, and a Collector may pass its own up -- so
   * this counts both ways rather than only down.
   *
   * The cap is the ceiling and it is enforced, because "Genitor Units may
   * never have more than X RM tokens aboard -- any above X are discarded".
   * Same shape as the Power track above it, without the dots: Power is 5 at
   * most and reads as pips, RM goes to 12 and would be a row of confetti. */
  function rmHtml(army, s) {
    const cap = window.DZCArmy.genitorCap(army, s);
    if (!cap) return '';
    const have = Math.max(0, Math.min(cap, (state.squads[s.id] || {}).rm || 0));
    return `<div class="dzc-play-rm">
      <button type="button" onclick="DZCPlay.rm('${s.id}',-1)" aria-label="Spend an RM token">−</button>
      ${window.DZCIcon('rm', { size: 14 })}<b>${have}</b><i>of ${cap} RM</i>
      <button type="button" onclick="DZCPlay.rm('${s.id}',1)" aria-label="Gain an RM token">+</button>
    </div>`;
  }

  function squadHtml(army, s) {
    const u = window.DZCArmy.unitOf(army, s);
    if (!u) return '';
    const models = state.models[s.id] || [];
    /* "Behemoths cannot receive Status tokens" and "Behemoths cannot be
     * Obscured, even by special rules" (Behemoth rules 1.2). All four buttons
     * were live on one, so Play Mode would let you record a state the game
     * cannot produce. The same fault as putting a Squad's token on every
     * model, one rule further along. Disabled rather than removed: the reason
     * has to be somewhere, and a control that vanishes says nothing. */
    const noTokens = u.type === 'Behemoth';
    const noWhy = `${u.name} is a Behemoth: Behemoths cannot receive Status tokens or be Obscured (1.2)`;
    return `<div class="dzc-play-squad">
      <div class="dzc-play-sq-head">
        <span class="dzc-play-name">${esc(u.name)}</span>
        ${s.commander ? `<span class="dzc-cmdr-tag">${window.DZCIcon('military_tech', { size: 11 })}L${s.commander.level}</span>` : ''}
        <!-- A set status says its whole name; an unset one is its letter. The
             alternative was a legend line under the row, which is the caption
             under a control this app does not write, and a title alone is
             nothing at all on a phone. -->
        <span class="dzc-statuses">${SQUAD_STATUSES.map(st => {
    const on = ((state.squads[s.id] || {}).st || []).indexOf(st) !== -1;
    return `<button type="button" class="dzc-st${on ? ' is-on' : ''}"
          ${noTokens ? `disabled title="${esc(noWhy)}"` : `title="${st}"`} aria-label="${st}"
          onclick="DZCPlay.squadStatus('${s.id}','${st}')">${on ? st : st[0]}</button>`;
  }).join('')}</span>
        <span class="dzc-play-alive">${aliveIn(s)}/${models.length}</span>
      </div>
      ${ptHtml(s, u)}
      ${rmHtml(army, s)}
      ${(() => {
        // A Behemoth's condition, from the damage it has taken (1.5.5).
        // Degraded cannot Advance; Crippled cannot Advance or Charge and is
        // worth half its points. Which is worth knowing without counting.
        const t = models.length === 1 ? threshold(u, models[0].dp) : null;
        return t ? `<p class="dzc-play-cond is-${t.toLowerCase()}">${esc(t)}${
          t === 'Degraded' ? ', cannot Advance'
            : t === 'Crippled' ? ', cannot Advance or Charge, worth half points' : ''}</p>` : '';
      })()}
      <div class="dzc-play-models">
        ${models.map((m, i) => `<div class="dzc-model${m.dp > 0 ? '' : ' is-dead'}">
          <button type="button" onclick="DZCPlay.dp('${s.id}',${i},-1)" aria-label="Damage">−</button>
          <b>${m.dp}</b><i>/${m.max}</i>
          <button type="button" onclick="DZCPlay.dp('${s.id}',${i},1)" aria-label="Repair">+</button>
          <span class="dzc-statuses">${MODEL_STATUSES.map(st => {
    const on = (m.st || []).indexOf(st) !== -1;
    return `<button type="button" class="dzc-st${on ? ' is-on' : ''}"
            ${noTokens ? `disabled title="${esc(noWhy)}"` : `title="${st}"`} aria-label="${st}"
            onclick="DZCPlay.status('${s.id}',${i},'${st}')">${on ? st : st[0]}</button>`;
  }).join('')}</span>
        </div>`).join('')}
      </div>
      ${weaponsHtml(army, s, u)}
    </div>`;
  }

  // ------------------------------------------------------------------ actions

  const army = () => window.DZCArmy.get(armyId);
  const redraw = () => { save(); render(army()); };

  /* The disabled button is the explanation; this is the enforcement. A
   * disabled control is a hint to a mouse and nothing at all to anything else
   * reaching the same handler (1.2). */
  function isBehemoth(squadId) {
    const a = army();
    const s = a && window.DZCArmy.findSquad(a, squadId);
    const u = s && window.DZCArmy.unitOf(a, s);
    return !!(u && u.type === 'Behemoth');
  }

  window.DZCPlay = {
    open,
    round: d => {
      const was = state.round;
      state.round = Math.max(1, state.round + d);
      state.activated = {};
      /* 4.1.1 is two halves and only the second was here: "Players generate/
       * replenish their Command Points (CP) up to a number equal to their
       * highest Commander Level on the Table. Players lose CP here if they
       * have more than that." Advancing a Round capped CP and never generated
       * it, so a Level 3 Commander started Round 2 on nothing and you had to
       * find the Refill button to be given what the rules already gave you.
       *
       * Only when advancing. Stepping back is a mis-tap, not an Initiation
       * Phase, and handing back a Round's spent CP for it would be worse than
       * the bug. The cap still applies either way. You may never hold more
       * than your Commander Level. */
      const lvl = commanderLevel(army());
      state.cp = state.round > was ? lvl : Math.min(state.cp, lvl);
      /* "Behemoths begin each Round with a number of Power tokens (PT) equal
       * to their Power" (1.3). Every Round, spent or not, which is the same
       * shape as the Command Point line above and needs no undo guard: a full
       * Power track is where a Round starts whichever way you stepped. */
      const a = army();
      a.groups.forEach(g => g.squads.forEach(s => {
        const q = state.squads[s.id];
        if (q && q.pt != null) q.pt = power(window.DZCArmy.unitOf(a, s));
      }));
      redraw();
    },
    replenish: () => { state.cp = commanderLevel(army()); redraw(); },
    cp: d => { state.cp = Math.max(0, Math.min(commanderLevel(army()), state.cp + d)); redraw(); },
    vp: (k, d) => { state[k] = Math.max(0, (state[k] || 0) + d); redraw(); },
    oppGroups: v => { state.oppGroups = Math.max(0, parseInt(v, 10) || 0); redraw(); },
    activate: id => { state.activated[id] = !state.activated[id]; redraw(); },
    dp: (sid, i, d) => {
      const m = (state.models[sid] || [])[i];
      if (!m) return;
      m.dp = Math.max(0, Math.min(m.max, m.dp + d));
      redraw();
    },
    status: (sid, i, st) => {
      const m = (state.models[sid] || [])[i];
      if (!m || isBehemoth(sid)) return;
      m.st = m.st || [];
      const at = m.st.indexOf(st);
      if (at === -1) m.st.push(st); else m.st.splice(at, 1);
      redraw();
    },
    rm: (sid, d) => {
      const a = army();
      const s = a && window.DZCArmy.findSquad(a, sid);
      const q = s && state.squads[sid];
      if (!q) return;
      // Clamped at the cap, not refused: "any above X are discarded" is the
      // rule, so the token simply does not go aboard.
      q.rm = Math.max(0, Math.min(window.DZCArmy.genitorCap(a, s), (q.rm || 0) + d));
      redraw();
    },
    pt: (sid, d) => {
      const a = army();
      const s = a && window.DZCArmy.findSquad(a, sid);
      const q = s && state.squads[sid];
      if (!q) return;
      q.pt = Math.max(0, Math.min(power(window.DZCArmy.unitOf(a, s)), (q.pt || 0) + d));
      redraw();
    },
    squadStatus: (sid, st) => {
      if (isBehemoth(sid)) return;
      const q = (state.squads = state.squads || {})[sid] || (state.squads[sid] = { st: [] });
      q.st = q.st || [];
      const at = q.st.indexOf(st);
      if (at === -1) q.st.push(st); else q.st.splice(at, 1);
      redraw();
    },
    roll: () => {
      const d6 = 1 + Math.floor(Math.random() * 6);
      const lvl = commanderLevel(army());
      const el = document.getElementById('dzc-roll');
      if (el) {
        /* The total is printed on a 6 as well. 4.1.5: "A roll of 6 wins
         * automatically, but if both players roll 6s, add their Commander
         * Level as normal". So the one roll that hid its total was the one
         * roll with a case that needs it. */
        el.textContent = `${d6} + ${lvl} = ${d6 + lvl}${
          d6 === 6 ? ', wins unless they rolled a 6 too' : ''}`;
      }
    },
    reset: () => {
      if (!confirm('Reset this game? Damage, VP and Round all go back to the start.')) return;
      state = blank(army());
      redraw();
    }
  };
})();
