/* Play Mode — run a game from a built army.
 *
 * Tracks the things a Round actually needs and that are easy to get wrong at a
 * table, all of which come out of rulebook chapter 4:
 *
 *   4.1.1  CP is replenished UP TO your highest Commander Level on the table,
 *          and you LOSE CP if you hold more than that. Commanders count as
 *          Level 0 throughout Round 1, so Round 1 gives you nothing.
 *   4.1.2  Pass tokens come from having FEWER Groups than your opponent — two
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
   *   11.1.7  Concussion — "place a Concussed Status Token on its Squad.
   *           Concussed Squads suffer -2Ac."
   *   11.1.22 Jammer     — "place a Jammed Status Token on its Squad."
   *   11.1.34 Suppress   — "place a Suppressed Status Token on its Squad.
   *           Suppressed Squads may only move 0” if any Unit within it attacks."
   *
   * Obscured is not one of them and does not move. 10.1.21 Obscurer X” — "All
   * friendly Vehicle and Infantry UNITS within X” of this Unit are Obscured to
   * enemies" — so it is a state a model is in because of where it is standing,
   * and two models of one Squad can genuinely differ. */
  const SQUAD_STATUSES = ['Concussed', 'Suppressed', 'Jammed'];
  const MODEL_STATUSES = ['Obscured'];

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let armyId = null;
  let state = null;

  function blank(army) {
    const models = {}, squads = {};
    army.groups.forEach(g => g.squads.forEach(s => {
      const u = window.DZCArmy.unitOf(army, s);
      const dp = u ? parseInt(u.stats && u.stats.DP, 10) || 1 : 1;
      models[s.id] = s.models.map(() => ({ dp: dp, max: dp, st: [] }));
      squads[s.id] = { st: [] };
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
      if (!state.squads[id]) state.squads[id] = { st: [] };
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

  function passTokens(army) {
    const mine = activeGroups(army).length;
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
    const groups = activeGroups(army);
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
             it stays — as a number beside theirs, not as a sentence about it. -->
        <div class="dzc-pcard" title="A Group of only non-auxiliary Transports cannot be activated and is ignored here (4.1.2)">
          <span class="dzc-pcard-k">Pass Tokens</span>
          <span class="dzc-pcard-v">${pass}</span>
          <div class="dzc-pcard-act">
            <!-- Derived from the army, not typed. Uneditable IS the enforcement,
                 so it has to say why rather than just refuse the caret. -->
            <label>Yours<input type="number" value="${groups.length}" disabled
                   title="Counted from your army — Groups of only Transports are ignored (4.1.2)"></label>
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
    const why = orphaned
      ? 'Cannot be picked for a normal activation (4.2.1); activates in the Orphaned Transport step (4.2.2)'
      : g.squads.length ? 'Nothing left in this Group' : 'No Squads in this Group';
    return `<section class="dzc-play-group${done ? ' is-done' : ''}${live.length ? '' : ' is-dead'}">
      <header>
        <label class="dzc-act">
          <!-- The tag beside this says the same thing, but a disabled control
               has to carry its own reason: the tag is a separate hover target
               and you are pointing at the box that will not tick. -->
          <input type="checkbox" ${done ? 'checked' : ''} ${canAct ? '' : 'disabled'}
                 ${canAct ? '' : `title="${why}"`}
                 onchange="DZCPlay.activate('${g.id}')">
          <b>${esc(window.DZCArmy.groupName(army, g))}</b>
        </label>
        ${orphaned ? `<span class="dzc-play-tag" title="${why}">${window.DZCIcon('local_shipping', { size: 12 })} orphaned transports</span>` : ''}
      </header>
      ${g.squads.map(s => squadHtml(army, s)).join('')}
    </section>`;
  }

  function squadHtml(army, s) {
    const u = window.DZCArmy.unitOf(army, s);
    if (!u) return '';
    const models = state.models[s.id] || [];
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
          title="${st}" aria-label="${st}"
          onclick="DZCPlay.squadStatus('${s.id}','${st}')">${on ? st : st[0]}</button>`;
  }).join('')}</span>
        <span class="dzc-play-alive">${aliveIn(s)}/${models.length}</span>
      </div>
      <div class="dzc-play-models">
        ${models.map((m, i) => `<div class="dzc-model${m.dp > 0 ? '' : ' is-dead'}">
          <button type="button" onclick="DZCPlay.dp('${s.id}',${i},-1)" aria-label="Damage">−</button>
          <b>${m.dp}</b><i>/${m.max}</i>
          <button type="button" onclick="DZCPlay.dp('${s.id}',${i},1)" aria-label="Repair">+</button>
          <span class="dzc-statuses">${MODEL_STATUSES.map(st => {
    const on = (m.st || []).indexOf(st) !== -1;
    return `<button type="button" class="dzc-st${on ? ' is-on' : ''}"
            title="${st}" aria-label="${st}"
            onclick="DZCPlay.status('${s.id}',${i},'${st}')">${on ? st : st[0]}</button>`;
  }).join('')}</span>
        </div>`).join('')}
      </div>
    </div>`;
  }

  // ------------------------------------------------------------------ actions

  const army = () => window.DZCArmy.get(armyId);
  const redraw = () => { save(); render(army()); };

  window.DZCPlay = {
    open,
    round: d => {
      state.round = Math.max(1, state.round + d);
      // A new Round replenishes CP and clears who has activated (4.1, 4.2).
      state.activated = {};
      state.cp = Math.min(state.cp, commanderLevel(army()));
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
      if (!m) return;
      m.st = m.st || [];
      const at = m.st.indexOf(st);
      if (at === -1) m.st.push(st); else m.st.splice(at, 1);
      redraw();
    },
    squadStatus: (sid, st) => {
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
        el.textContent = d6 === 6
          ? `${d6} — wins outright`
          : `${d6} + ${lvl} = ${d6 + lvl}`;
      }
    },
    reset: () => {
      if (!confirm('Reset this game? Damage, VP and Round all go back to the start.')) return;
      state = blank(army());
      redraw();
    }
  };
})();
