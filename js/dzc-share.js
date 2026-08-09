/* Share an army as a link.
 *
 * The whole army travels IN the URL. There is no server, and adding one for
 * this would be the only piece of infrastructure the app needs — a link that
 * carries its own payload keeps the thing offline-first and means a shared
 * list never rots because a host went away.
 *
 * Shape of the payload, and why it is not just JSON.stringify(army):
 *
 *   - ids are dropped. They are random per device and regenerated on import,
 *     so shipping them wastes bytes and would collide with the importer's
 *     existing armies.
 *   - `carriedBy` is an id, so it becomes an INDEX within its Group. That is
 *     what makes the nesting survive the round trip.
 *   - keys are shortened, then the result is deflated. A URL has a practical
 *     length limit and an army of twenty Squads is verbose.
 */
(function () {
  'use strict';

  const VERSION = 1;

  // ------------------------------------------------------------------ encode

  function pack(army) {
    return {
      v: VERSION,
      f: army.faction,
      n: army.name,
      // Only when there is one. An empty key in every link is bytes in a URL
      // that already has a practical length limit.
      d: army.description || undefined,
      p: army.pointsLimit,
      // Assigned Commanders still travel as `k` on their Squad, so a link made
      // today still opens in a build from before they moved to the army. `u`
      // carries the ones not yet with a Squad, which had nowhere to live.
      u: ((army.commanders || []).filter(c => !c.squadId).map(c => c.level)),
      // Their TYPED names, parallel to `u` and absent unless somebody typed
      // one. A Commander you named "Colonel Vance" arrived as "Level 5
      // Commander", which is the derived name — so a link silently undid the
      // one thing about a Commander you had chosen. Group names have always
      // travelled; this is the same field on the other renameable thing.
      w: ((army.commanders || []).filter(c => !c.squadId).some(c => c.name)
        ? (army.commanders || []).filter(c => !c.squadId).map(c => c.name || 0)
        : undefined),
      g: army.groups.map(gr => ({
        n: gr.name,
        s: gr.squads.map(sq => {
          const o = {
            u: sq.unitId,
            // Variants are per model, so the list is per model -- collapsing
            // it to a count would lose a legally mixed Squad (3.2.2).
            m: sq.models.map(m => m.variant || 0)
          };
          if (sq.carriedBy) {
            const i = gr.squads.findIndex(x => x.id === sq.carriedBy);
            if (i >= 0) o.c = i;
          }
          // Raw Materials aboard a Genitor. Only when bought, because a Genitor
          // may legally begin empty and a 0 in every Squad is bytes in a URL
          // with a real length limit. `r`, since `g` is already this Squad's
          // upgrades and `c` its carrier.
          if (sq.rm > 0) o.r = sq.rm;
          if (sq.commander) {
            o.k = sq.commander.level;
            // The name is on the army's Commander, not on the Squad's copy of
            // it -- syncCommanders mirrors the level down and nothing else.
            const c = (army.commanders || []).find(x => x.squadId === sq.id);
            if (c && c.name) o.j = c.name;
          }
          if (sq.upgrades) {
            const up = {};
            Object.keys(sq.upgrades).forEach(scope => {
              const names = Object.keys(sq.upgrades[scope]).filter(n => sq.upgrades[scope][n]);
              if (names.length) up[scope] = names;
            });
            if (Object.keys(up).length) o.g = up;
          }
          return o;
        })
      }))
    };
  }

  function unpack(data) {
    if (!data || data.v !== VERSION) throw new Error('Unrecognised share link version.');
    const uid = () => 'a' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    const army = {
      id: uid(), name: data.n || 'Shared Army', description: data.d || '', faction: data.f,
      pointsLimit: data.p || 2000, groups: [],
      created: Date.now(), updatedAt: Date.now()
    };
    (data.g || []).forEach(gr => {
      /* null, never "Group". A Group's name is DERIVED unless you typed one
       * (groupName in js/dzc-army.js), so a shared army of six unnamed Groups
       * arrived as six things all called "Group" — the exact collision the
       * derived name exists to prevent, and it reported no position either. */
      const group = { id: uid(), name: gr.n || null, squads: [] };
      (gr.s || []).forEach(sq => {
        group.squads.push({
          id: uid(), unitId: sq.u,
          models: (sq.m || []).map(v => ({ variant: v || null })),
          carriedBy: null,
          // The name rides on the Squad's copy only as far as the rebuild
          // below; syncCommanders writes the copy back as a bare level.
          commander: sq.k ? { level: sq.k, name: sq.j || null } : null,
          rm: Number(sq.r) > 0 ? Math.floor(Number(sq.r)) : undefined,
          upgrades: sq.g ? Object.keys(sq.g).reduce((acc, scope) => {
            acc[scope] = {};
            sq.g[scope].forEach(n => { acc[scope][n] = true; });
            return acc;
          }, {}) : undefined
        });
      });
      // Second pass: indices become the new ids now that all Squads exist.
      (gr.s || []).forEach((sq, i) => {
        if (sq.c != null && group.squads[sq.c]) group.squads[i].carriedBy = group.squads[sq.c].id;
      });
      army.groups.push(group);
    });
    // Rebuild the army-level store from what the Squads carry, plus any
    // Commander that had not been given a Squad when the link was made.
    army.commanders = [];
    army.groups.forEach(g => g.squads.forEach(s => {
      if (s.commander) {
        army.commanders.push({
          id: uid(), name: s.commander.name || null, level: s.commander.level, squadId: s.id
        });
      }
    }));
    (data.u || []).forEach((lv, i) => army.commanders.push({
      id: uid(), name: (data.w || [])[i] || null, level: lv, squadId: null
    }));
    return army;
  }

  // ------------------------------------------------------------ compression

  const b64url = bytes => btoa(String.fromCharCode.apply(null, bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  function fromB64url(s) {
    const t = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(t + '==='.slice((t.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deflate(str) {
    const bytes = new TextEncoder().encode(str);
    // CompressionStream is not everywhere. Falling back to uncompressed keeps
    // sharing working rather than failing, at the cost of a longer link, and
    // the prefix says which it is so decoding never has to guess.
    if (typeof CompressionStream === 'undefined') return 'u' + b64url(bytes);
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter(); w.write(bytes); w.close();
    const buf = await new Response(cs.readable).arrayBuffer();
    return 'z' + b64url(new Uint8Array(buf));
  }

  async function inflate(payload) {
    const kind = payload[0], body = fromB64url(payload.slice(1));
    if (kind === 'u') return new TextDecoder().decode(body);
    if (kind !== 'z') throw new Error('Unrecognised share link.');
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter(); w.write(body); w.close();
    return new TextDecoder().decode(await new Response(ds.readable).arrayBuffer());
  }

  // ------------------------------------------------------------------- API

  async function link(army) {
    const payload = await deflate(JSON.stringify(pack(army)));
    // Take the current URL minus its hash and query, rather than appending a
    // slash to the path: that produced "index.html/#share/..." whenever the
    // page was opened by filename instead of as a directory.
    const base = (location.href || '').split('#')[0].split('?')[0];
    return base + '#share/' + payload;
  }

  async function importFrom(payload) {
    const army = unpack(JSON.parse(await inflate(payload)));
    const list = window.DZCArmy.load();
    list.unshift(army);
    window.DZCArmy.save();
    return army;
  }

  // -------------------------------------------------------------- plain text

  /* The army as text you can paste into a message.
   *
   * Two things it has to be at once, and they do not fight:
   *
   *   - readable. It keeps the Group nesting INDENTED, the same tree the print
   *     sheet draws, because a Condor carrying two Bear APCs carrying six
   *     Legionnaires is the deployment plan and every competitor's export
   *     flattens it.
   *   - readable BACK. Every Unit line is written in the "3 x Name [45pts]"
   *     convention DZCArmy.parseList already reads, so a list pasted into this
   *     app's Import comes back as an army. Nesting does not survive that trip
   *     — a flat list cannot say what rode in what — but the Units and their
   *     counts do, and the indentation is still there for the human.
   *
   * Every line the parser must ignore starts with "#", which is exactly the
   * rule parseList applies: headings, totals, and the Commander block, which
   * has no Unit to resolve to.
   */
  function text(army) {
    const A = window.DZCArmy, D = window.DZC;
    const size = D.gameSizeFor(army.pointsLimit);
    const cost = A.armyCost(army);
    const out = [
      `# ${army.name} [${army.pointsLimit}pts]`,
      army.description ? `# ${army.description}` : '',
      `# ${army.faction.toUpperCase()}, ${size ? size.label : 'below the minimum'}`
        + `, ${cost} of ${army.pointsLimit}pts, ${army.groups.length} Group`
        + `${army.groups.length === 1 ? '' : 's'}`,
      ''
    ];

    function squad(g, s, depth) {
      const u = A.unitOf(army, s);
      if (!u) return;
      const pad = '  '.repeat(depth);
      // The mix, because Variants are per model (3.2.2) and a Squad may
      // legally hold more than one. A Squad of one Variant names it inline so
      // the line still reads as a single entry.
      const mix = {};
      s.models.forEach(m => { const k = m.variant || u.name; mix[k] = (mix[k] || 0) + 1; });
      const kinds = Object.keys(mix);
      // A count only where there is one to give: "Sabre, Tachi" reads better
      // than "1x Sabre, 1x Tachi", and it is also what importList matches a
      // loadout name against, so one of each survives the trip back.
      const tail = kinds.length && !(kinds.length === 1 && kinds[0] === u.name)
        ? `: ${kinds.map(k => (mix[k] > 1 ? `${mix[k]}x ${k}` : k)).join(', ')}` : '';
      /* Named on the line, not left inside the points. The cost already
       * carries them, so a Genitor with 8 RM just reads 40pts dearer than the
       * same Ark without -- and the one thing an opponent reading your list
       * wants to know about a Genitor is how much it can Spawn on turn one. */
      /* AFTER THE COST, BEFORE THE LOADOUTS, and that ordering is the whole
       * bug this line used to have. It was written at the very end, past the
       * "* : Sabre, Greave" tail, where LIST_ENTRY anchors on $ -- so the line
       * matched nothing at all and importing a list this app had just exported
       * dropped the entire Squad. Losing the tokens would have been bad; losing
       * the Genitor silently was worse. */
      const rm = A.rmOf(s);
      out.push(`${pad}${s.models.length} x ${u.name} [${A.squadCost(army, s)}pts]`
        + (rm ? ` + ${rm} RM` : '') + tail);
      g.squads.filter(x => x.carriedBy === s.id).forEach(r => squad(g, r, depth + 1));
    }

    army.groups.forEach(g => {
      out.push(`# ${A.groupName(army, g)} — ${A.groupCost(army, g)}pts`);
      g.squads.filter(s => !s.carriedBy).forEach(s => squad(g, s, 1));
      out.push('');
    });

    const cmdrs = A.commanders(army);
    if (cmdrs.length) {
      out.push('# Commanders');
      cmdrs.forEach(c => {
        const sq = c.squadId ? A.findSquad(army, c.squadId) : null;
        const cu = sq ? A.unitOf(army, sq) : null;
        // An unnamed Commander already reports its Level as its name, so
        // saying it twice is the line reading "Level 5 Commander, Level 5".
        const nm = A.commanderName(army, c);
        const lvl = `Level ${c.level}`;
        out.push(`# ${nm}${nm.indexOf(lvl) === -1 ? ', ' + lvl : ''}`
          + `, ${cu ? 'with ' + cu.name : 'not assigned'} [${A.levelCost(c.level)}pts]`);
      });
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  /* The army as the file the app's own Import reads (DZCArmy.importArmies).
   * The backup button writes an array of these; this is one of them, so the
   * two formats are the same format and a shared army arrives the same way a
   * restored one does. */
  function json(army) {
    return JSON.stringify(army, null, 2);
  }

  window.DZCShare = { link, text, json, importFrom, pack, unpack, deflate, inflate };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.DZCShare;
})();
