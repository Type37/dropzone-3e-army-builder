/* Screenshot a running app to PNG files, by driving Chrome over its own
 * DevTools Protocol.
 *
 * Why not the in-app browser pane: its screenshot returns an image into the
 * conversation and cannot write files, so nothing survived the session.
 * Why not a screen grab: CopyFromScreen captures the physical display, so it
 * photographs whatever the user is actually doing.
 * Why not Playwright: not wanted, and not needed — Chrome already speaks CDP,
 * and Node 22+ ships a WebSocket client, so this has zero dependencies.
 *
 *   node scripts/shots.mjs <baseUrl> <outDir> [dfc|dzc]
 *
 * Steps are declared below: each names a file and a snippet to run in the page
 * before the shot. Page.captureScreenshot renders off-screen, so the machine
 * stays usable while this runs.
 */
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:8901/index.html';
const OUT = process.argv[3] || 'docs/screens/dropfleet';
const PROFILE = join(process.env.TEMP || '/tmp', 'dzc-shots-profile');
const PORT = 9333;
const VIEW = { width: 1400, height: 1000 };

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

/* Each step: [filename, snippet]. The snippet runs in the page and may await;
 * it sets up the state the shot is meant to show. */
const APP = (process.argv[4] || (/dropzone/i.test(OUT) ? 'dzc' : 'dfc')).toLowerCase();

/* Dropzone. Ids are read off the rendered DOM rather than hardcoded, so a data
 * change cannot silently shoot the wrong screen. */
const DZC_STEPS = [
  ['01-landing', `location.hash = '#landing'`],
  ['02-armies', `location.hash = '#armies'`],
  ['03-new-army', `DZCBuilder.openNew()`],
  ['04-faction-picked', `const b = document.querySelector('#dzc-new-body [onclick*="pickFaction"]');
     b && b.click()`],
  ['05-builder-empty', `DZCBuilder.createArmy()`],
  ['06-picker', `await DZCBuilder.addGroup()`],
  ['07-picker-scrolled', `document.querySelector('#dzc-picker .modal-body').scrollTop = 600`],
  ['08-picker-category', `document.querySelector('#dzc-picker .modal-body').scrollTop = 0;
     const c = [...document.querySelectorAll('.dzc-chip')].find(x => /Standard/.test(x.textContent));
     c && c.click()`],
  ['09-picker-search', `DZCBuilder.pickerSearch('a')`],
  // .dzc-pick-add only — '.dzc-pick, .dzc-pick-add' matches the card first in
  // document order, which opens the unit info instead of adding.
  ['10-squad-added', `DZCBuilder.pickerSearch('');
     await new Promise(r => setTimeout(r, 500));
     document.querySelectorAll('.dzc-pick-add')[0].click();
     await new Promise(r => setTimeout(r, 500));
     document.querySelectorAll('.dzc-pick-add')[3].click()`],
  ['11-builder-with-squad', `document.getElementById('dzc-picker').classList.remove('active')`],
];

const DFC_STEPS = [
  ['01-landing', `App.navigate('landing')`],
  ['02-fleet-list', `App.navigate('fleets')`],
  ['03-new-fleet-modal', `App.openNewFleetModal()`],
  ['04-faction-size-picked', `App.selectFaction('bioficer'); App.selectGameSize('reconquest');
     document.getElementById('new-fleet-name').value = 'Bioficer Reconquest';
     document.getElementById('new-fleet-points').value = '4000'`],
  // createFleet ends with navigate('builder', id) but lands back on the fleet
  // grid — reproduced in a clean profile, so it is a real bug, not local state.
  // Navigate explicitly or every later step shoots the wrong screen.
  ['05-builder-empty', `App.createFleet();
     await new Promise(r => setTimeout(r, 600));
     const f = JSON.parse(localStorage.dfc_fleets || '[]').find(x => x.name === 'Bioficer Reconquest');
     App.navigate('builder', f.id)`],
  // addGroup(), not openShipSelectModal() — the real "+ Add Group" button sets
  // pendingGroupCreation, and addShipToGroup only creates a group when it is set.
  ['06-picker-all', `App.addGroup(); document.querySelector('#modal-ship-select .modal-body').scrollTop = 0`],
  ['07-picker-scrolled', `document.querySelector('#modal-ship-select .modal-body').scrollTop = 1100`],
  ['08-picker-payload-tab', `document.querySelector('#modal-ship-select .modal-body').scrollTop = 0;
     [...document.querySelectorAll('#ship-category-tabs button')].find(b=>/Payload/.test(b.textContent)).click()`],
  ['09-picker-colossal-tab', `[...document.querySelectorAll('#ship-category-tabs button')].find(b=>/Colossal/.test(b.textContent)).click()`],
  ['10-search-no-match', `[...document.querySelectorAll('#ship-category-tabs button')].find(b=>/All/.test(b.textContent)).click();
     document.getElementById('ship-search-input').value='decon'; App.searchShips('decon')`],
  ['11-search-match', `document.getElementById('ship-search-input').value='frigate'; App.searchShips('frigate')`],
  ['12-filter-one', `App.clearShipSearch(); App.toggleShipFilter('drop')`],
  ['13-filter-two', `App.toggleShipFilter('bombardment')`],
  ['14-sort-tonnage', `App.clearShipFilters(); App.sortShips('tonnage')`],

  // Ship keys are UUIDs, so read them off the rendered onclick rather than
  // guessing. Adds must happen while the picker is open: clicking a card body
  // opens the datasheet AND closes the picker, so doing that first leaves the
  // add buttons detached and every later step shoots an empty fleet.
  ['15-groups-added', `const keys = [...document.querySelectorAll('#ship-select-grid .ship-card button')]
       .map(b => (b.getAttribute('onclick') || '').match(/addShipToGroup\\('([^']+)','([^']+)'\\)/))
       .filter(Boolean);
     App.addShipToGroup(keys[0][1], keys[0][2]);
     await new Promise(r => setTimeout(r, 250));
     App.addShipToGroup(keys[1][1], keys[1][2])`],

  // Card body opens the datasheet; + Add is a separate target.
  ['16-ship-detail-modal', `[...document.querySelectorAll('#ship-select-grid .ship-card')][0].click()`],

  ['17-detail-datasheet', `App.closeModal('modal-ship-detail');
     App.closeModal('modal-ship-select');
     const f = JSON.parse(localStorage.dfc_fleets).find(x => x.name === 'Bioficer Reconquest');
     App.selectGroup(f.battleGroups[f.battleGroups.length - 1].id)`],
  ['18-detail-scrolled-hardpoints', `document.getElementById('builder-detail').scrollTop = 900`],
  ['19-hardpoint-selected', `const b=[...document.querySelectorAll('#builder-detail button')]
       .filter(x=>/^\\+\\d+$/.test(x.textContent.trim())); if(b[0]) b[0].click()`],
  ['20-alerts-issues-and-notes', `document.getElementById('builder-detail').scrollTop = 0;
     document.querySelector('.builder-sidebar').scrollTop = 0`],

  ['21-admiral-modal', `App.openAdmiralModal()`],
  ['22-admiral-modal-scrolled', `document.querySelector('#modal-admiral .modal-body').scrollTop = 500`],
  // Faction admirals carry an "Add to fleet" button and open their ability
  // picker automatically; generics use "Add" and have no abilities to choose.
  ['23-ability-picker', `document.querySelector('#modal-admiral .modal-body').scrollTop = 0;
     const b = [...document.querySelectorAll('#admiral-options button')]
       .find(x => /Add to fleet/i.test(x.textContent));
     b && b.click()`],
  ['24-admiral-rail-card', `App.closeModal('modal-admiral-abilities');
     document.querySelector('.builder-sidebar').scrollTop = 400`],

  ['25-print-preview', `App.openPrintPreview()`],
  ['26-share-modal', `document.querySelectorAll('.print-preview-overlay,.print-overlay').forEach(e=>e.remove());
     App.closeModal('modal-print'); App.shareFleet()`],
  ['27-fleet-list-fastplay-tab', `App.closeModal('modal-share'); App.navigate('fleets'); App.showFleetTab('fastplay')`],
  ['28-collection-tab', `App.showFleetTab('collection')`],
  ['29-import-modal', `App.showFleetTab('my'); App.importFleetFromClipboard()`],
  ['30-settings-modal', `App.closeModal('modal-import'); App.openSettings()`],
];

const STEPS = APP === 'dzc' ? DZC_STEPS : DFC_STEPS;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function cdpTargets() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return r.json();
}

class Session {
  #ws; #id = 0; #pending = new Map();
  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      const p = this.#pending.get(m.id);
      if (p) { this.#pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    });
  }
  send(method, params = {}) {
    const id = ++this.#id;
    this.#ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
  }
}

const bin = CHROME.find(p => existsSync(p));
if (!bin) { console.error('No Chrome or Edge found in the usual locations.'); process.exit(1); }

rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const proc = spawn(bin, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--headless=new',
  '--hide-scrollbars',
  `--window-size=${VIEW.width},${VIEW.height}`,
  '--no-first-run', '--no-default-browser-check',
  BASE,
], { stdio: 'ignore', detached: false });

let targets = [];
for (let i = 0; i < 40 && !targets.length; i++) {
  await sleep(250);
  try { targets = (await cdpTargets()).filter(t => t.type === 'page'); } catch {}
}
if (!targets.length) { console.error('Chrome never exposed a page target.'); proc.kill(); process.exit(1); }

const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
const s = new Session(ws);

await s.send('Page.enable');
await s.send('Runtime.enable');
await s.send('Emulation.setDeviceMetricsOverride', { ...VIEW, deviceScaleFactor: 1, mobile: false });

// The desktop build bounces phone-width viewports to /mobile/; force desktop.
await s.send('Runtime.evaluate', { expression: `localStorage.setItem('dfc_force_desktop','1')` });
await s.send('Page.navigate', { url: BASE });
await sleep(2500);

const done = [];
for (const [name, expr] of STEPS) {
  const r = await s.send('Runtime.evaluate', { expression: `(async()=>{ ${expr} })()`, awaitPromise: true })
    .catch(e => ({ error: e.message }));
  if (r?.error) { console.log(`  ! ${name}: ${r.error}`); }
  await sleep(900);
  const shot = await s.send('Page.captureScreenshot', { format: 'png' });
  const file = join(OUT, `${name}.png`);
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  done.push(name);
  console.log(`  ${file}`);
}

ws.close();
proc.kill();
console.log(`\n${done.length} shots written to ${OUT}`);
