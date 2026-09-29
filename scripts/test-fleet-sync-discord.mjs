/* Discord sign-in + linked Sync Token, ported with the feature from the
 * Dropfleet builder's scripts/test-fleet-sync-discord.mjs.
 *
 * Several devices, one fake Firestore with a document per path. A device that
 * signs in with Discord keeps its old token linked, so devices still on the
 * token and devices on Discord must end up with one list, never two. This
 * app's documents are "dzc-" + the key, so the paths below carry the prefix.
 *
 * Run: node scripts/test-fleet-sync-discord.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = readFileSync(path.join(ROOT, 'js', 'fleet-sync.js'), 'utf8');

let pass = 0, fail = 0;
function check(cond, label, extra) {
  if (cond) pass++;
  else { fail++; console.error(`  FAIL  ${label}${extra ? `\n        ${extra}` : ''}`); }
}
const armies = raw => { try { return JSON.parse(raw || '[]'); } catch (e) { return []; } };

function makeDevice(docs, opts) {
  opts = opts || {};
  const store = new Map(Object.entries(opts.seed || {}));
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  };
  const loc = { hash: opts.hash || '', pathname: '/dropzone-3e-army-builder/', search: '',
    href: 'https://x/dropzone-3e-army-builder/' + (opts.hash || '') };
  const win = {};
  let n = opts.rand || 1;
  const sandbox = {
    window: win, localStorage, location: loc,
    history: { replaceState: () => { loc.hash = ''; } },
    URLSearchParams,
    crypto: { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = (n++ * 2654435761) >>> 0; return a; } },
    setTimeout, clearTimeout, console,
    fetch: async (url, o) => {
      const p = decodeURIComponent(url.split('/documents/')[1].split('?')[0]);
      if (o && o.method === 'PATCH') { docs[p] = JSON.parse(o.body); return { ok: true, status: 200 }; }
      if (o && o.method === 'DELETE') { delete docs[p]; return { ok: true, status: 200 }; }
      if (!docs[p]) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => docs[p] };
    }
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  const FS = win.FleetSync;
  return {
    FS, store,
    ids: () => armies(store.get('dzc_armies')).map(f => f.id).sort().join(','),
    add: (id, at) => {
      const l = armies(store.get('dzc_armies'));
      l.push({ id, name: id, groups: [], updatedAt: at });
      store.set('dzc_armies', JSON.stringify(l));
    }
  };
}
const KEY = 'discord-' + ['abcdabcdabcdabcd', 'efghefghefghefgh', 'ijklijklijklijkl', 'mnopmnopmnopmnop'].join('-');
const doc = tok => 'sync/dzc-' + tok;
const docIds = d => d ? JSON.parse(d.fields.payload.stringValue).fleets.map(f => f.id).sort().join(',') : null;
const discordReturn = nonce => '#dsync=' + KEY + '&ds=' + nonce + '&dn=Jet&da=';
const seedOf = d => Object.fromEntries(d.store);
const one = (id, at) => JSON.stringify([{ id, groups: [], updatedAt: at || 1 }]);

console.log('\nDiscord sign-in keeps an old Sync Token linked');
{
  const docs = {};
  const phone = makeDevice(docs, { seed: { dzc_armies: one('A', 1) } });
  const P = (await phone.FS.start()).token;
  const pc0 = makeDevice(docs, { seed: { dzc_armies: one('PC1', 2), dzc_discord_state: 'n1' } });
  await pc0.FS.join(P);
  check('PC and phone share phrase P', docIds(docs[doc(P)]) === 'A,PC1');

  phone.add('B', 5); await phone.FS.sync();
  const pc = makeDevice(docs, { seed: seedOf(pc0), hash: discordReturn('n1') });
  const r = await pc.FS.discordFinish();
  check('sign-in reports the name', r && r.name === 'Jet');
  check('PC is signed in with Discord', !!pc.FS.discordUser() && pc.FS.token() === KEY);
  check('old phrase is linked', pc.FS.linkedToken() === P);
  check('PC pulled B from the phrase on sign-in', pc.ids() === 'A,B,PC1', pc.ids());
  check('Discord copy has everything', docIds(docs[doc(KEY)]) === 'A,B,PC1', docIds(docs[doc(KEY)]));
  check('the Discord document is this game\'s own', !docs['sync/' + KEY]);

  phone.add('C', 10); await phone.FS.sync();
  await pc.FS.sync();
  check('phone army reaches the PC', pc.ids().includes('C'));
  pc.add('D', 11); await pc.FS.sync();
  await phone.FS.sync();
  check('PC army reaches the phone on the phrase', phone.ids().includes('D'), phone.ids());

  const laptop = makeDevice(docs, { seed: { dzc_discord_state: 'n2' }, hash: discordReturn('n2') });
  await laptop.FS.discordFinish();
  check('fresh Discord device gets the full list', laptop.ids() === 'A,B,C,D,PC1', laptop.ids());
  check('fresh Discord device has no link', laptop.FS.linkedToken() === null);

  const kept = pc.ids();
  pc.FS.discordSignOut();
  check('sign-out keeps local armies', pc.ids() === kept);
  check('sign-out stops sync and drops the link', !pc.FS.enabled() && pc.FS.linkedToken() === null);
}

console.log('\nDiscord sign-in refuses a return it did not start');
{
  const docs = {};
  const d = makeDevice(docs, { seed: { dzc_discord_state: 'mine', dzc_armies: '[]' }, hash: discordReturn('someone-else') });
  let err = null;
  try { await d.FS.discordFinish(); } catch (e) { err = e; }
  check('wrong nonce is rejected', !!err);
  check('nothing was joined', !d.FS.enabled() && !docs[doc(KEY)]);
  const plain = makeDevice(docs, {});
  check('an ordinary load is not a Discord return', plain.FS.discordFinish() === null);
}

console.log('\nDelete online copy removes the linked copy too');
{
  const docs = {};
  const a = makeDevice(docs, { seed: { dzc_armies: one('X'), dzc_discord_state: 'n' } });
  const P = (await a.FS.start()).token;
  const b = makeDevice(docs, { seed: seedOf(a), hash: discordReturn('n') });
  await b.FS.discordFinish();
  check('two copies exist', !!docs[doc(P)] && !!docs[doc(KEY)]);
  await b.FS.deleteRemote();
  check('both copies gone', !docs[doc(P)] && !docs[doc(KEY)]);
  check('local armies kept', b.ids() === 'X');
}

console.log('\nA Dropfleet Discord login arrives signed in, not as a 64-letter token');
{
  const docs = {};
  const d = makeDevice(docs, { seed: { dfc_sync_token: KEY, dfc_sync_discord: JSON.stringify({ name: 'Jet', avatar: '' }) } });
  check('the key is adopted', d.FS.token() === KEY);
  check('and who it belongs to', (d.FS.discordUser() || {}).name === 'Jet');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
