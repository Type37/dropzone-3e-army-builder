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
      p: army.pointsLimit,
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
          if (sq.commander) o.k = sq.commander.level;
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
      id: uid(), name: data.n || 'Shared Army', faction: data.f,
      pointsLimit: data.p || 1500, groups: [],
      created: Date.now(), updatedAt: Date.now()
    };
    (data.g || []).forEach(gr => {
      const group = { id: uid(), name: gr.n || 'Group', squads: [] };
      (gr.s || []).forEach(sq => {
        group.squads.push({
          id: uid(), unitId: sq.u,
          models: (sq.m || []).map(v => ({ variant: v || null })),
          carriedBy: null,
          commander: sq.k ? { level: sq.k } : null,
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
    return location.origin + location.pathname.replace(/\/?$/, '/') + '#share/' + payload;
  }

  async function importFrom(payload) {
    const army = unpack(JSON.parse(await inflate(payload)));
    const list = window.DZCArmy.load();
    list.unshift(army);
    window.DZCArmy.save();
    return army;
  }

  window.DZCShare = { link, importFrom, pack, unpack, deflate, inflate };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.DZCShare;
})();
