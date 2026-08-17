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
 *
 * Damage is tracked per MODEL rather than per Squad, because DP is a per-model
 * stat and a Squad shrinks as models die.
 *
 * A game is six Rounds "unless the Scenario says otherwise" (p34), which is
 * where the "of 6" beside the Round counter comes from and why the counter
 * still goes past it rather than stopping.
 *
 * NOTHING ON THIS SCREEN IS REDRAWN BY REBUILDING IT. Every action used to run
 * render() again over the whole view, which is a thousand elements thrown away
 * and remade to change one number: the button you were touching stopped
 * existing under your finger, focus went back to the top of the document, and
 * a rule popover opened from a weapon card was orphaned mid-read. sync() walks
 * the view that is already there and writes the values into it. render() runs
 * twice in a game -- when you open it, and if you reset it.
 *
 * State lives under the army id, so closing the tab mid-game loses nothing.
 */
(function () {
  'use strict';

  const KEY = 'dzc_play';
  /* Status Tokens are placed on a SQUAD, and the rulebook says so every time
   * one is placed:
   *
   *   11.1.7  Concussion. "place a Concussed Status Token on its Squad.
   *           Concussed Squads suffer -2Ac."
   *   11.1.22 Jammer:    "place a Jammed Status Token on its Squad."
   *   11.1.34 Suppress:  "place a Suppressed Status Token on its Squad.
   *           Suppressed Squads may only move 0” if any Unit within it attacks."
   *   11.1.32 Smoke:     "place an Obscured Status Token on that Squad. Squads
   *           with Obscured Status Tokens are Obscured."
   *   10.1.30 Stealth:   "this Squad gains an Obscured Status Token."
   *
   * Obscured used to sit on the MODEL here, argued off 10.1.21 Obscurer X”:
   * "All friendly Vehicle and Infantry UNITS within X” of this Unit are
   * Obscured to enemies". That rule is real, but it is a different thing. Being
   * Obscured because of where you are standing places no token and needs no
   * tracking, since this app does not know where anything is standing. The
   * Obscured Status TOKEN is a token, it goes on the Squad like the other
   * three, and 10.1.18 Large turns on the distinction: "Large Vehicles cannot
   * be Obscured except by Obscured Status Tokens granted by Stealth". So the
   * only Obscured worth a button here is the Squad-wide one, and putting it on
   * the model meant a Stealth Squad had no way to record what Stealth gave it.
   *
   * THE PICTURE IS THE ONE ON THE TABLE. Page 51 of the rulebook prints all 28
   * tokens at punch size; tools/dzc/extract_tokens.py cuts them out. Concussed
   * is a spiral, Suppressed a burst of ricochets, Jammed a struck-out signal,
   * Obscured a struck-out eye -- and those four shapes are what is sitting
   * beside the models. A letter C was a thing to learn; the token is a thing to
   * match. The name rises off it when you press it, which is the trade Jet
   * asked for on 2026-08-17: "the status effects should just be icons. When you
   * tap them, the full name of the effect should rise up like a toast." */
  const SQUAD_STATUSES = [
    { name: 'Concussed',  effect: '−2Ac (11.1.7)' },
    { name: 'Suppressed', effect: 'May only move 0” if any Unit in it attacks (11.1.34)' },
    { name: 'Jammed',     effect: 'Gains UC and cannot benefit from Aegis (11.1.22)' },
    { name: 'Obscured',   effect: 'Hit on 4+ at best, and never Critically (11.1.32)' }
  ];

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');

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

  const CONDITION = {
    Intact: '',
    Degraded: ', cannot Advance',
    Crippled: ', cannot Advance or Charge, worth half points'
  };

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
    return { round: 1, cp: 0, myVP: 0, oppVP: 0, oppGroups: 0, passUsed: 0,
      activated: {}, models: models, squads: squads };
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
    /* A game saved before the Squad statuses moved carries them on each model.
     * Hoist them rather than dropping them: a token placed on ANY model was a
     * token on that Squad, which is what the rules meant by it in the first
     * place. Nothing lives on a model now, Obscured included, so this empties
     * every model's list on its way past. */
    state.squads = state.squads || {};
    Object.keys(fresh.squads).forEach(id => {
      if (!state.squads[id]) state.squads[id] = fresh.squads[id];
      // A game saved before Power tokens existed has no pt on its Squads.
      if (state.squads[id].pt == null) state.squads[id].pt = fresh.squads[id].pt;
      // Nor RM. Seeded from the army rather than zeroed: a game in progress
      // when this shipped still has whatever it paid for aboard.
      if (state.squads[id].rm == null) state.squads[id].rm = fresh.squads[id].rm;
      (state.models[id] || []).forEach(m => {
        (m.st || []).forEach(st => {
          if (state.squads[id].st.indexOf(st) === -1) state.squads[id].st.push(st);
        });
        m.st = [];
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

  /* What is still in your hand. Pass tokens are SPENT: "A player may use a Pass
   * token instead of activating a Group" (4.2.1), and they do not carry over,
   * because "once all Groups which may activate normally have done so, discard
   * any remaining Pass tokens" and the next Initiation Phase generates a fresh
   * lot (4.1.2). The card showed only what you were dealt, so from the second
   * pass onward the number on screen was one you had already used. */
  function passLeft(army) {
    return Math.max(0, passTokens(army) - (state.passUsed || 0));
  }

  /* ── the values, once ──
   *
   * Every changing number on this screen is drawn TWICE: into the markup when
   * the screen is built, and into the node when sync() updates it. A first
   * paint with empty wells and a flash of numbers a frame later is not
   * acceptable on a screen you glance at mid-turn, and neither is a template
   * and an updater that can quietly drift into disagreeing.
   *
   * So neither of them computes anything. Both read these. */
  const val = {
    round: () => 'Round ' + state.round,
    cp: () => String(state.cp),
    cpMax: army => '/ ' + commanderLevel(army),
    cpWhy: army => state.round <= 1
      ? 'Commanders count as Level 0 throughout Round 1 (4.1.1)'
      : (l => `Hand size is also ${l} card${l === 1 ? '' : 's'} (4.1.4)`)(commanderLevel(army)),
    pass: army => String(passLeft(army)),
    passMax: army => '/ ' + passTokens(army),
    vp: k => String(state[k] || 0),
    alive: s => aliveIn(s) + '/' + (state.models[s.id] || []).length,
    dp: (sid, i) => String(((state.models[sid] || [])[i] || {}).dp),
    pt: (s, u) => Math.max(0, Math.min(power(u), (state.squads[s.id] || {}).pt || 0)),
    rm: (army, s) => String(Math.max(0,
      Math.min(window.DZCArmy.genitorCap(army, s), (state.squads[s.id] || {}).rm || 0))),
    // A Behemoth's condition, from the damage it has taken (1.5.5). Degraded
    // cannot Advance; Crippled cannot Advance or Charge and is worth half its
    // points. Which is worth knowing without counting.
    cond: (u, models) => (t => t ? t + CONDITION[t] : '')(
      models.length === 1 ? threshold(u, models[0].dp) : null),
    statusOn: (sid, st) => (((state.squads[sid] || {}).st) || []).indexOf(st) !== -1,
    done: (army, g) => !!state.activated[g.id] && !hasBehemoth(army, g),
    tickable: (army, g) => activeGroups(army).some(x => x.id === g.id) && !hasBehemoth(army, g)
  };

  function hasBehemoth(army, g) {
    return g.squads.some(s => {
      const u = window.DZCArmy.unitOf(army, s);
      return u && u.type === 'Behemoth' && aliveIn(s) > 0;
    });
  }

  // ----------------------------------------------------------------- floats

  /* A number that rises off the control you pressed and fades, the way a game
   * prints damage over the thing it hit. Jet, 2026-08-17: "when you tap for
   * damage, same thing -- '+1 Damage! +1 Damage!'"
   *
   * It is the only thing on this screen that says what a button did. The
   * statuses are icons now and the steppers are a minus and a plus, so a title
   * attribute -- which a phone never shows -- was the whole explanation.
   *
   * FIXED, in a layer of its own, and never in the flow. Anything appended to
   * the document at an absolute top can grow the page and bring a scrollbar
   * with it, and a scrollbar arriving is exactly the layout shift this is
   * supposed to be an alternative to. The layer is inert to the pointer, so
   * one landing over a button does not eat the next tap.
   *
   * Consecutive floats step sideways and up rather than stacking in one place,
   * so hitting damage four times reads as four numbers instead of one that
   * flickers. */
  let floatSeq = 0;
  let floatAt = 0;

  function floatLayer() {
    let el = document.getElementById('dzc-floats');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dzc-floats';
      el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
    }
    return el;
  }

  function float(el, text, kind) {
    // The element is the control that was pressed, and every handler is reached
    // from an onclick that passes `this`. Reached any other way -- a test, a
    // keyboard shortcut, anything scripted -- the action still has to work, so
    // a missing anchor drops the float rather than throwing inside it.
    if (!el || !text || typeof el.getBoundingClientRect !== 'function') return;
    const now = Date.now();
    // A fresh press after half a second starts the stack again.
    floatSeq = now - floatAt < 700 ? (floatSeq + 1) % 4 : 0;
    floatAt = now;
    const b = el.getBoundingClientRect();
    const n = document.createElement('span');
    n.className = 'dzc-float' + (kind ? ' is-' + kind : '');
    n.textContent = text;
    n.style.left = (b.left + b.width / 2) + 'px';
    n.style.top = (b.top - 2) + 'px';
    n.style.setProperty('--float-shift', (floatSeq % 2 ? 1 : -1) * floatSeq * 7 + 'px');
    floatLayer().appendChild(n);
    n.addEventListener('animationend', () => n.remove());
    // A browser with animations turned off never fires animationend, so the
    // node would sit there for the rest of the game.
    setTimeout(() => n.remove(), 1600);
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

    /* The faction's own colour, which Play Mode never had. Every other view
     * sets --acc from the army's faction and this one did not, so a Scourge
     * game and a PHR game were both drawn in the same fallback navy. It also
     * carries --acc-on, which is the ink a Status Token's name is set in once
     * it sits on a fill of that colour: white on Scourge purple, near-black on
     * PHR gold, which is 1.9:1 the other way round. */
    root.innerHTML = `<div class="dzc-wrap dzc-play" style="${
      window.DZC.accentStyle(window.DZCBuilder.accentOf(army.faction))}">
      <header class="dzc-play-head">
        <div class="dzc-round">
          <button type="button" class="dzc-press" onclick="DZCPlay.round(-1)" aria-label="Previous round">${window.DZCIcon('remove', { size: 16 })}</button>
          <span><b data-round>${val.round()}</b><i>of 6</i></span>
          <button type="button" class="dzc-press" onclick="DZCPlay.round(1)" aria-label="Next round">${window.DZCIcon('add', { size: 16 })}</button>
        </div>
        <div class="dzc-play-vp">
          ${counter('My VP', 'myVP')}
          ${counter('Opp VP', 'oppVP')}

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
        <div class="dzc-pcard" data-cp-card title="${esc(val.cpWhy(army))}">
          <span class="dzc-pcard-k">Command Points</span>
          <span class="dzc-pcard-v"><b data-cp>${val.cp()}</b><i data-cp-max>${val.cpMax(army)}</i></span>
          <div class="dzc-pcard-act">
            <button type="button" class="dzc-press" aria-label="One fewer Command Point"
                    onclick="DZCPlay.cp(this,-1)">−</button>
            <button type="button" class="dzc-press" aria-label="One more Command Point"
                    onclick="DZCPlay.cp(this,1)">+</button>
            <button type="button" class="dzc-press" onclick="DZCPlay.replenish(this)" title="Replenish up to your highest Commander Level (4.1.1)">Refill</button>
          </div>
        </div>

        <!-- Your own Group count is the other half of the Pass arithmetic, so
             it stays, as a number beside theirs, not as a sentence about it. -->
        <div class="dzc-pcard" title="A Group of only non-auxiliary Transports cannot be activated and is ignored here (4.1.2)">
          <span class="dzc-pcard-k">Pass Tokens</span>
          <span class="dzc-pcard-v"><b data-pass>${val.pass(army)}</b><i data-pass-max>${val.passMax(army)}</i></span>
          <div class="dzc-pcard-act">
            <button type="button" class="dzc-press" aria-label="Use a Pass token"
                    onclick="DZCPlay.pass(this,-1)" title="Use one instead of activating a Group (4.2.1)">−</button>
            <button type="button" class="dzc-press" aria-label="Take a used Pass token back"
                    onclick="DZCPlay.pass(this,1)">+</button>
            <!-- Derived from the army, not typed. Uneditable IS the enforcement,
                 so it has to say why rather than just refuse the caret. -->
            <label>Yours<input type="number" value="${groupsOnTable(army)}" data-mine disabled
                   title="Counted from your army. Groups of only Transports are ignored (4.1.2), and a Behemoth counts as several (1.1)"></label>
            <label>Theirs
              <input type="number" min="0" max="40" value="${state.oppGroups}"
                     oninput="DZCPlay.oppGroups(this.value)"></label>
          </div>
        </div>
      </div>

      <div class="dzc-play-main">
        ${army.groups.map(g => groupHtml(army, g)).join('')}
      </div>
      </div>
    </div>`;
    sync(army);
  }

  /* The Initiative roller is gone. Jet, 2026-08-17: "remove the initiative
   * roller." It was the one card on this screen that did not track anything --
   * you roll a D6 on the table and the app cannot see it, so all it ever did
   * was roll a different D6 and print a sum you then had to reconcile with the
   * dice in front of you. Commander Level is still what it added, and that is
   * printed on the Command Points card, which is where it comes from. */

  function counter(label, key) {
    return `<div class="dzc-vp">
      <span>${esc(label)}</span>
      <button type="button" class="dzc-press" onclick="DZCPlay.vp(this,'${key}',-1)"
              aria-label="One fewer ${esc(label)}">−</button>
      <b data-vp="${key}">${val.vp(key)}</b>
      <button type="button" class="dzc-press" onclick="DZCPlay.vp(this,'${key}',1)"
              aria-label="One more ${esc(label)}">+</button>
    </div>`;
  }

  function groupHtml(army, g) {
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
    const behemoth = hasBehemoth(army, g);
    const why = behemoth
      ? 'A Behemoth activates once per Power token, not once per Round (1.3). The Power track below is the count'
      : orphaned
        ? 'Cannot be picked for a normal activation (4.2.1); activates in the Orphaned Transport step (4.2.2)'
        : g.squads.length ? 'Nothing left in this Group' : 'No Squads in this Group';
    return `<section class="dzc-play-group${val.done(army, g) ? ' is-done' : ''}${
      live.length ? '' : ' is-dead'}" data-group="${esc(g.id)}">
      <header>
        <label class="dzc-act">
          <!-- The tag beside this says the same thing, but a disabled control
               has to carry its own reason: the tag is a separate hover target
               and you are pointing at the box that will not tick. -->
          <input type="checkbox" data-act title="${esc(why)}"
                 ${val.done(army, g) ? 'checked' : ''} ${val.tickable(army, g) ? '' : 'disabled'}
                 onchange="DZCPlay.activate(this,'${esc(g.id)}')">
          <b>${esc(window.DZCArmy.groupName(army, g))}</b>
        </label>
        ${orphaned ? `<span class="dzc-play-tag" title="${esc(why)}">${window.DZCIcon('local_shipping', { size: 12 })} orphaned transports</span>` : ''}
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
   * Squad either way, DZCArmy.squadGuns, so the two cannot drift.
   *
   * Every rule on every gun is a chip that opens the rule, because wpnCard
   * runs its Special column through the same linker the reference does. That
   * was already true and worth saying, because the Squad's OWN rules were the
   * half that was missing -- see rulesHtml below. */
  function weaponsHtml(army, s, u) {
    const U = window.DZCUnits;
    const ws = U.unitWeapons(u, window.DZCArmy.squadGuns(s));
    if (!ws.length) return '';
    return `<div class="dzc-play-wpn">${
      ws.map(w => U.wpnCard(w, army.faction)).join('')}</div>`;
  }

  /* THE SQUAD'S OWN RULES, tappable. Jet, 2026-08-17: "Units need all their
   * special rules and gun special rules tappable in play mode."
   *
   * The guns already carried theirs -- they arrive inside wpnCard. What a
   * Squad is, though, was nowhere on this screen: an Archangel's Aegis, a
   * Legionnaire's Vulnerable, a Sabre's Stabilised. Mid-game those are the
   * rules being argued over, and Play Mode's answer was to go back to the
   * builder and find the Squad again.
   *
   * Restricted rules go with the Variant that has them (3.2.2), and only the
   * Variants this Squad actually fields: a Squad of three Sabres should not be
   * offered the Tachi's rules. variantRuleFilter is the builder's, so the two
   * screens cannot disagree about which rule belongs to whom. */
  function rulesHtml(army, s, u) {
    const U = window.DZCUnits;
    if (!u.special) return '';
    const fac = u.faction || army.faction;
    const own = U.rulesHtml(u.special, fac, U.variantRuleFilter(u, null));
    const taken = [];
    (s.models || []).forEach(m => {
      if (m.variant && taken.indexOf(m.variant) === -1) taken.push(m.variant);
    });
    const byVariant = taken.map(v => {
      const r = U.rulesHtml(u.special, fac, U.variantRuleFilter(u, v), true);
      return r ? `<span class="dzc-play-rule-of">${esc(v)}</span>${r}` : '';
    }).join('');
    if (!own && !byVariant) return '';
    return `<div class="dzc-play-rules">${own}${byVariant}</div>`;
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
    const left = val.pt(s, u);
    const dots = Array.from({ length: max }, (_, i) =>
      `<i class="dzc-pt-dot${i < left ? ' is-on' : ''}"></i>`).join('');
    return `<div class="dzc-play-pt" data-pt="${esc(s.id)}" title="Power tokens: one Action each, refilled every Round (1.3)">
      <button type="button" class="dzc-press" onclick="DZCPlay.pt(this,'${esc(s.id)}',-1)" aria-label="Spend a Power token">−</button>
      <span class="dzc-pt-track" aria-label="${left} of ${max} Power tokens left">${dots}</span>
      <b data-pt-n>${left}</b><i>of ${max} PT</i>
      <button type="button" class="dzc-press" onclick="DZCPlay.pt(this,'${esc(s.id)}',1)" aria-label="Give back a Power token">+</button>
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
    return `<div class="dzc-play-rm" data-rm="${esc(s.id)}">
      <button type="button" class="dzc-press" onclick="DZCPlay.rm(this,'${esc(s.id)}',-1)" aria-label="Spend an RM token">−</button>
      ${window.DZCIcon('rm', { size: 14 })}<b data-rm-n>${val.rm(army, s)}</b><i>of ${cap} RM</i>
      <button type="button" class="dzc-press" onclick="DZCPlay.rm(this,'${esc(s.id)}',1)" aria-label="Gain an RM token">+</button>
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
    return `<div class="dzc-play-squad" data-squad="${esc(s.id)}">
      <!-- The model, washed out, under its own numbers. Jet, 2026-08-17:
           "maybe the background of the card in play mode is a watermark or
           washed out image of the unit." Which is the fastest way to find a
           Squad on a screen of eleven of them: you are looking for the shape
           you just picked up off the table, not for its name. Decorative and
           inert -- it carries no information the row does not already print,
           so it is alt="" and out of the pointer's way. -->
      ${u.art ? `<img class="dzc-play-art" src="${esc(u.art)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      <div class="dzc-play-sq">
      <div class="dzc-play-sq-head">
        <span class="dzc-play-name">${esc(u.name)}</span>
        ${s.commander ? `<span class="dzc-cmdr-tag">${window.DZCIcon('military_tech', { size: 11 })}L${s.commander.level}</span>` : ''}
        <span class="dzc-statuses">${SQUAD_STATUSES.map(st => {
    const on = val.statusOn(s.id, st.name);
    return `<button
          type="button" class="dzc-st${on ? ' is-on' : ''}" data-st="${esc(st.name)}"
          aria-pressed="${on}"
          ${noTokens ? `disabled title="${esc(noWhy)}"` : `title="${esc(st.name)} — ${esc(st.effect)}"`}
          aria-label="${esc(st.name)}"
          onclick="DZCPlay.squadStatus(this,'${esc(s.id)}','${esc(st.name)}')"
          ><img src="assets/tokens/${slug(st.name)}.webp" alt="" width="28" height="28"
                onerror="this.replaceWith(document.createTextNode('${st.name[0]}'))"></button>`;
  }).join('')}</span>
        <span class="dzc-play-alive" data-alive>${val.alive(s)}</span>
      </div>
      ${ptHtml(s, u)}
      ${rmHtml(army, s)}
      ${(t => threshold(u, maxDp(u))
    /* Always drawn for a Behemoth, never for anything else. A line that
     * appears the moment a threshold is crossed would push the whole Squad
     * down mid-game, so the row is held open from the start and only its
     * words change -- which, on a Behemoth at full health, is "Intact". */
    ? `<p class="dzc-play-cond${t ? ' is-' + t.split(',')[0].toLowerCase() : ''}" data-cond>${esc(t)}</p>`
    : '')(val.cond(u, models))}
      <div class="dzc-play-models">
        ${models.map((m, i) => `<div class="dzc-model${m.dp > 0 ? '' : ' is-dead'}" data-model="${i}">
          <button type="button" class="dzc-press" onclick="DZCPlay.dp(this,'${esc(s.id)}',${i},-1)" aria-label="One damage point off ${esc(u.name)}">−</button>
          <b data-dp>${m.dp}</b><i>/${m.max}</i>
          <button type="button" class="dzc-press" onclick="DZCPlay.dp(this,'${esc(s.id)}',${i},1)" aria-label="One damage point back on ${esc(u.name)}">+</button>
        </div>`).join('')}
      </div>
      ${rulesHtml(army, s, u)}
      ${weaponsHtml(army, s, u)}
      </div>
    </div>`;
  }

  // ------------------------------------------------------------------- sync

  /* Write every changing value into the view that is already on screen.
   *
   * One pass, everything, rather than a patch per action -- because almost
   * nothing here is local. Killing the last model in a Squad can change the
   * Commander Level, which changes the CP cap, which changes the CP you hold;
   * it can drop a Group off the table, which changes Pass tokens; and it can
   * take a Behemoth past a threshold. Hand-patching the four things a damage
   * button "obviously" touches is how a screen ends up disagreeing with itself.
   *
   * Nothing here writes innerHTML on a container. Values go into leaf nodes and
   * states go on to classes and attributes, so no element the user is touching
   * is ever replaced, and no box changes size unless the game changed. */
  function sync(army) {
    const root = document.getElementById('view-play');
    if (!root || !army || typeof root.querySelector !== 'function') return;
    const q = (sel, ctx) => (ctx || root).querySelector(sel);

    const setText = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };
    const setCls = (el, cls, on) => { if (el) el.classList.toggle(cls, !!on); };

    setText(q('[data-round]'), val.round());
    setText(q('[data-cp]'), val.cp());
    setText(q('[data-cp-max]'), val.cpMax(army));
    const cpCard = q('[data-cp-card]');
    if (cpCard) cpCard.title = val.cpWhy(army);
    setText(q('[data-pass]'), val.pass(army));
    setText(q('[data-pass-max]'), val.passMax(army));
    const mine = q('[data-mine]');
    // Property AND attribute. The property is what the field shows; the
    // attribute is what serialises, and this number is read back out of the
    // rendered markup by the render tests.
    if (mine) { mine.value = groupsOnTable(army); mine.setAttribute('value', mine.value); }
    ['myVP', 'oppVP'].forEach(k => setText(q(`[data-vp="${k}"]`), val.vp(k)));

    army.groups.forEach(g => {
      const sec = q(`[data-group="${cssId(g.id)}"]`);
      if (!sec) return;
      const done = val.done(army, g);
      const box = q('[data-act]', sec);
      if (box) { box.checked = done; box.disabled = !val.tickable(army, g); }
      setCls(sec, 'is-done', done);
      setCls(sec, 'is-dead', !g.squads.some(s => aliveIn(s) > 0));

      g.squads.forEach(s => {
        const el = q(`[data-squad="${cssId(s.id)}"]`, sec);
        if (!el) return;
        const u = window.DZCArmy.unitOf(army, s);
        const models = state.models[s.id] || [];
        setText(q('[data-alive]', el), val.alive(s));
        el.querySelectorAll('[data-st]').forEach(b => {
          const on = val.statusOn(s.id, b.getAttribute('data-st'));
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        const pt = q('[data-pt]', el);
        if (pt) {
          const left = val.pt(s, u);
          setText(q('[data-pt-n]', pt), String(left));
          pt.querySelectorAll('.dzc-pt-dot').forEach((d, i) => d.classList.toggle('is-on', i < left));
          const track = q('.dzc-pt-track', pt);
          if (track) track.setAttribute('aria-label', `${left} of ${power(u)} Power tokens left`);
        }
        const rm = q('[data-rm]', el);
        if (rm) setText(q('[data-rm-n]', rm), val.rm(army, s));
        const cond = q('[data-cond]', el);
        if (cond) {
          const t = val.cond(u, models);
          setText(cond, t);
          cond.className = 'dzc-play-cond' + (t ? ' is-' + t.split(',')[0].toLowerCase() : '');
        }
        el.querySelectorAll('[data-model]').forEach(m => {
          const i = +m.getAttribute('data-model');
          if (!models[i]) return;
          setText(q('[data-dp]', m), val.dp(s.id, i));
          m.classList.toggle('is-dead', models[i].dp <= 0);
        });
      });
    });
  }

  /* An army id is generated from base36 and can start with a digit, which is
   * not a valid start to a CSS identifier. Escaped rather than trusted. */
  function cssId(id) {
    return window.CSS && CSS.escape ? CSS.escape(id) : String(id).replace(/["\\]/g, '\\$&');
  }

  // ------------------------------------------------------------------ actions

  const army = () => window.DZCArmy.get(armyId);

  /* Can the view be written into, or does it have to be rebuilt?
   *
   * A browser can do the first, which is the whole point of sync(). The render
   * tests run this module against a DOM stub whose innerHTML is a plain string
   * and whose querySelector answers with a scratch object -- there, nothing
   * written into a node is ever readable again, and the only way an action can
   * show up at all is to rebuild the markup.
   *
   * Detected by trying it once, not by sniffing for a global. A guess about
   * which environment this is would be wrong the first time either of them
   * changed. */
  let patchable = null;
  function canPatch() {
    if (patchable !== null) return patchable;
    try {
      const d = document.createElement('div');
      d.innerHTML = '<i data-probe></i>';
      const hit = d.querySelector('[data-probe]');
      patchable = !!(hit && hit.getAttribute && hit.getAttribute('data-probe') === '');
    } catch (e) { patchable = false; }
    return patchable;
  }

  const commit = () => {
    save();
    if (canPatch()) sync(army()); else render(army());
  };

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
      /* Pass tokens are generated fresh in every Initiation Phase and the
       * leftovers are discarded, not banked: "once all Groups which may
       * activate normally have done so, discard any remaining Pass tokens"
       * (4.2.1). So the spend count goes back to nothing with the Round.
       *
       * The stash of tokens an activation took off goes with it. A Group that
       * activated last Round is not going to be un-ticked now, and keeping it
       * would hand a Round-old Concussion back on a mis-tap. */
      state.passUsed = 0;
      Object.keys(state.squads || {}).forEach(id => { delete state.squads[id].was; });
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
      commit();
    },
    replenish: el => {
      const was = state.cp;
      state.cp = commanderLevel(army());
      float(el, state.cp > was ? `+${state.cp - was} CP` : 'No CP to draw', 'good');
      commit();
    },
    cp: (el, d) => {
      const was = state.cp;
      state.cp = Math.max(0, Math.min(commanderLevel(army()), state.cp + d));
      float(el, state.cp === was ? (d > 0 ? 'At your Commander Level' : 'No CP')
        : (d > 0 ? '+1 CP' : '−1 CP'), state.cp === was ? 'nil' : d > 0 ? 'good' : 'bad');
      commit();
    },
    vp: (el, k, d) => {
      const was = state[k] || 0;
      state[k] = Math.max(0, was + d);
      float(el, state[k] === was ? 'None to give back' : (d > 0 ? '+1 VP' : '−1 VP'),
        state[k] === was ? 'nil' : d > 0 ? 'good' : 'bad');
      commit();
    },
    oppGroups: v => { state.oppGroups = Math.max(0, parseInt(v, 10) || 0); commit(); },
    /* Ticking a Group is the END of its activation, and that is when its Status
     * Tokens come off: "Remove any Status Tokens on a Squad at the end of its
     * activation unless they were placed that activation" (6.4.5). Nothing
     * removed them before, so a Squad Concussed in Round 1 stayed Concussed for
     * the rest of the game and every -2Ac after the first was invented.
     *
     * The exception falls out of the order you do things in rather than needing
     * a rule of its own: you tick the box when the activation is over, so a
     * token placed AFTER the tick is a token placed that activation and stays.
     *
     * Un-ticking hands them back, because the box is also how you undo a
     * mis-tap and silently eating three tokens for one is worse than the bug
     * this fixes. Merged, not restored wholesale, so a token placed since the
     * tick survives the undo too. */
    activate: (el, id) => {
      const a = army();
      const g = a.groups.find(x => x.id === id);
      const on = !state.activated[id];
      state.activated[id] = on;
      let cleared = 0;
      (g ? g.squads : []).forEach(s => {
        const q = state.squads[s.id];
        if (!q) return;
        q.st = q.st || [];
        if (on) { cleared += q.st.length; q.was = q.st.slice(); q.st = []; }
        else {
          (q.was || []).forEach(st => { if (q.st.indexOf(st) === -1) q.st.push(st); });
          delete q.was;
        }
      });
      float(el, on ? (cleared ? `Activated, ${cleared} token${cleared === 1 ? '' : 's'} off` : 'Activated')
        : 'Not activated', on ? 'good' : 'nil');
      commit();
    },
    dp: (el, sid, i, d) => {
      const m = (state.models[sid] || [])[i];
      if (!m) return;
      const was = m.dp;
      m.dp = Math.max(0, Math.min(m.max, m.dp + d));
      /* What the button DID, over the button. A minus and a plus say nothing
       * about which way damage runs, and this screen is used one-handed with a
       * model in the other hand. The clamped case is the one worth naming
       * loudest: pressing damage on a wreck should not look like it worked. */
      float(el, m.dp === was ? (d < 0 ? 'Already destroyed' : 'Undamaged')
        : m.dp === 0 ? 'Destroyed' : d < 0 ? '+1 damage' : '−1 damage',
      m.dp === was ? 'nil' : m.dp === 0 ? 'dead' : d < 0 ? 'bad' : 'good');
      commit();
    },
    /* Spent, not counted. Clamped to what was generated so it cannot go
     * negative or bank tokens you were never dealt (4.1.2, 4.2.1). */
    pass: (el, d) => {
      const a = army();
      const gen = passTokens(a);
      const was = passLeft(a);
      state.passUsed = Math.max(0, Math.min(gen, (state.passUsed || 0) - d));
      const now = passLeft(a);
      float(el, now === was ? (gen ? (d < 0 ? 'None left' : 'All in hand') : 'None generated')
        : d < 0 ? 'Passed' : 'Token back', now === was ? 'nil' : d < 0 ? 'bad' : 'good');
      commit();
    },
    rm: (el, sid, d) => {
      const a = army();
      const s = a && window.DZCArmy.findSquad(a, sid);
      const q = s && state.squads[sid];
      if (!q) return;
      const was = q.rm || 0;
      // Clamped at the cap, not refused: "any above X are discarded" is the
      // rule, so the token simply does not go aboard.
      q.rm = Math.max(0, Math.min(window.DZCArmy.genitorCap(a, s), was + d));
      float(el, q.rm === was ? (d > 0 ? 'At its cap' : 'None aboard')
        : d > 0 ? '+1 RM' : '−1 RM', q.rm === was ? 'nil' : d > 0 ? 'good' : 'bad');
      commit();
    },
    pt: (el, sid, d) => {
      const a = army();
      const s = a && window.DZCArmy.findSquad(a, sid);
      const q = s && state.squads[sid];
      if (!q) return;
      const was = q.pt || 0;
      q.pt = Math.max(0, Math.min(power(window.DZCArmy.unitOf(a, s)), was + d));
      float(el, q.pt === was ? (d > 0 ? 'Track is full' : 'No Power left')
        : d > 0 ? '+1 PT' : '−1 PT', q.pt === was ? 'nil' : d > 0 ? 'good' : 'bad');
      commit();
    },
    squadStatus: (el, sid, st) => {
      if (isBehemoth(sid)) return;
      const q = (state.squads = state.squads || {})[sid] || (state.squads[sid] = { st: [] });
      q.st = q.st || [];
      const at = q.st.indexOf(st);
      if (at === -1) q.st.push(st); else q.st.splice(at, 1);
      /* The icon is the token and the token has no name on it, so this IS the
       * label. Jet, 2026-08-17: "when you tap a status effect, we should see
       * like 'concussed!' rising." */
      float(el, at === -1 ? st + '!' : st + ' off', at === -1 ? 'bad' : 'good');
      commit();
    },
    reset: () => {
      if (!confirm('Reset this game? Damage, VP and Round all go back to the start.')) return;
      state = blank(army());
      save();
      render(army());
    }
  };
})();
