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
/* SHOT_W/SHOT_H drive CCP's own device-metrics override, which is what the
 * page actually lays out against — unlike resize_window, which reports a
 * viewport the page never sees. Set them to shoot the phone cases. */
const VIEW = {
  width: Number(process.env.SHOT_W) || 1400,
  height: Number(process.env.SHOT_H) || 1000
};

/* Windows first, because that is where this is normally run. The Linux paths
 * below are not decoration: a cloud run reported "there is no Chrome here" and
 * went a whole session without looking at anything it shipped, while a
 * Chromium sat at /opt/pw-browsers/chromium the entire time. CHROME_BIN wins
 * over all of it, so a path nobody predicted still works. */
const CHROME = [
  process.env.CHROME_BIN,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/opt/pw-browsers/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/snap/bin/chromium',
].filter(Boolean);

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
  // Add Group now leaves an empty Group rather than opening the picker, so
  // the blank state is its own shot and the picker is opened deliberately.
  ['05b-blank-group', `await DZCBuilder.addGroup()`],
  ['06-picker', `DZCBuilder.openPicker(document.querySelector('[onclick*="openPicker"]')
     .getAttribute('onclick').match(/openPicker\\('([^']+)'/)[1])`],
  ['07-picker-scrolled', `document.querySelector('#dzc-picker .modal-body').scrollTop = 600`],
  ['08-picker-category', `document.querySelector('#dzc-picker .modal-body').scrollTop = 0;
     const c = [...document.querySelectorAll('.dzc-chip')].find(x => /Standard/.test(x.textContent));
     c && c.click()`],
  ['09-picker-search', `DZCBuilder.pickerSearch('a')`],
  // .dzc-pick-add only — '.dzc-pick, .dzc-pick-add' matches the card first in
  // document order, which opens the unit info instead of adding.
  // Adding now CLOSES the picker, so each add is followed by reopening it.
  ['10-squad-added', `const gid = () => document.querySelector('[onclick*="openPicker"]')
       .getAttribute('onclick').match(/openPicker\\('([^']+)'/)[1];
     DZCBuilder.pickerSearch('');
     await new Promise(r => setTimeout(r, 500));
     document.querySelectorAll('.dzc-pick-add')[0].click();
     await new Promise(r => setTimeout(r, 600));
     DZCBuilder.openPicker(gid());
     await new Promise(r => setTimeout(r, 700));
     document.querySelectorAll('.dzc-pick-add')[3].click();
     await new Promise(r => setTimeout(r, 600));
     DZCBuilder.openPicker(gid())`],
  // A second Squad in the same Group is now refused unless a Transport there
  // has room, so shoot the picker in that state to see what greys out.
  ['10b-picker-second-squad', `await new Promise(r => setTimeout(r, 300))`],
  // The other half: a Transport that can carry what is here must be offered.
  ['10c-picker-transports', `const c = [...document.querySelectorAll('[data-cat]')]
     .find(x => x.dataset.cat === 'Transport'); c && c.click()`],
  // Clicking a sort must move nothing but the cards. Shot immediately after so
  // any reflow of the bar above shows up against 10c.
  ['10d-picker-sorted', `document.querySelector('[data-sort="name"]').click()`],
  ['10e-picker-shape', `document.querySelector('[data-sort="points"]').click();
     document.querySelector('[data-cat="All"]').click();
     document.querySelector('[data-shape="square"]').click()`],
  ['10f-picker-cleared', `document.querySelector('.dzc-pick-results button').click()`],
  // 1:1 on a single card, because "are the capacity numbers readable" is a
  // question about pixels that a 1400px-wide shot cannot answer.
  ['10f2-card-1to1', `document.querySelector('[data-cat="Transport"]').click();
     await new Promise(r => setTimeout(r, 300))`, '.dzc-pick'],
  // A Transport in the Group, so the header meters have capacity to report.
  // This one lands on the builder by itself: adding closes the picker now.
  ['10g-transport-added', `document.querySelector('[data-cat="Transport"]').click();
     await new Promise(r => setTimeout(r, 300));
     const add = [...document.querySelectorAll('.dzc-pick-add')].find(b => !b.disabled);
     add && add.click()`],
  ['11-builder-with-squad', `DZCBuilder.closePicker()`],
  ['11b-squad-head-1to1', `void 0`, '.dzc-sq-main'],
  // A SECOND Group, and the list on its own. Every shot before this one had
  // exactly one Group in the middle pane, so nothing that only goes wrong with
  // two of them could ever be seen -- which is how every card's drag grip came
  // to be drawn on top of the first card's points and nobody noticed.
  ['11b2-two-groups', `await DZCBuilder.addGroup(); DZCBuilder.closePicker()`],
  ['11b3-group-list-1to1', `void 0`, '.dzc-b-list'],
  // The Group itself, clipped. At 1400 it is most of the screen; at 375 this
  // is the shot that shows whether anything is spilling sideways.
  ['11c-group-card', `document.querySelector('.dzc-group-card').scrollIntoView();
     document.querySelectorAll('.toast, .dzc-toast').forEach(t => t.remove())`, '.dzc-group-card'],
  // The Transport chooser: the + beside a Squad, not a select.
  ['11d-carry-chooser', `const b = document.querySelector('.dzc-carry-add');
     b && b.click()`],
  ['12-commander-modal', `DZCBuilder.closeCarry(); DZCBuilder.openCommander()`],
  ['13-commander-added', `const b = [...document.querySelectorAll('#dzc-cmdr-body button')]
     .find(x => x.textContent.trim() === 'Add'); b && b.click()`],
  ['12-settings', `App.openSettings()`],
  ['12b-whats-new', `App.openChangelog()`],
  ['13-unit-detail', `App.closeModal('modal-changelog');
     App.closeModal('modal-settings');
     const btn = document.querySelector('.dzc-sq-name');
     btn && btn.click()`],
  // statsHtml is shared with the reference and the collection, so both get
  // shot too: changing it under them is exactly how a view breaks unnoticed.
  ['14-unit-reference', `DZCUnits.closeDetail(); location.hash = '#units'`],
  ['15-unit-reference-detail', `const c = document.querySelector('.dzc-card'); c && c.click()`],
  // A Transport, to see the capacity shapes beside the name at size.
  ['15b-transport-detail', `DZCUnits.closeDetail();
     DZCUnits.setCategory('Transport');
     await new Promise(r => setTimeout(r, 400));
     const c = document.querySelector('.dzc-card'); c && c.click()`],
  ['16-collection', `DZCUnits.closeDetail();
     App.toggleSetting('showCollection', true);
     location.hash = '#collection'`],
  /* The print preview, actually opened. This step used to be named
     17-print-sheet and its whole body was `location.hash = '#armies'`, so the
     file said print sheet and showed the army list — a shot that lies about
     what it is, which is worse than a missing one because it is the shot you
     go back to. Back to the army first, because by here the walk is on the
     Collection. */
  ['17-print-preview', `location.hash = '#armies';
     await new Promise(r => setTimeout(r, 400));
     const card = document.querySelector('.dzc-army-card');
     card && card.click();
     await new Promise(r => setTimeout(r, 700));
     await DZCBuilder.print();
     await new Promise(r => setTimeout(r, 700))`],
  ['18-armies', `DZCBuilder.closePreview(); location.hash = '#armies'`],
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
  // opens the stat card AND closes the picker, so doing that first leaves the
  // add buttons detached and every later step shoots an empty fleet.
  ['15-groups-added', `const keys = [...document.querySelectorAll('#ship-select-grid .ship-card button')]
       .map(b => (b.getAttribute('onclick') || '').match(/addShipToGroup\\('([^']+)','([^']+)'\\)/))
       .filter(Boolean);
     App.addShipToGroup(keys[0][1], keys[0][2]);
     await new Promise(r => setTimeout(r, 250));
     App.addShipToGroup(keys[1][1], keys[1][2])`],

  // Card body opens the stat card; + Add is a separate target.
  ['16-ship-detail-modal', `[...document.querySelectorAll('#ship-select-grid .ship-card')][0].click()`],

  // The one place the banned word survives: this label names a capture that is
  // already on disk and is cited by filename from a dozen Todoist tasks.
  // Renaming it breaks those citations and changes nothing in the product, so
  // it stays until Jet says otherwise.
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
  /* Linux only, and not optional there: a container runs this as root, and
     Chrome refuses to start its sandbox as root — it exits before it ever
     opens the debugging port, which surfaces as "never exposed a page target"
     and reads exactly like the browser being missing. --disable-dev-shm-usage
     is the companion: /dev/shm is small in a container and a renderer that
     runs out of it dies mid-screenshot. Neither is wanted on Windows, where
     the sandbox works. */
  ...(process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage']),
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
for (const [name, expr, clipSel] of STEPS) {
  const r = await s.send('Runtime.evaluate', { expression: `(async()=>{ ${expr} })()`, awaitPromise: true })
    .catch(e => ({ error: e.message }));
  if (r?.error) { console.log(`  ! ${name}: ${r.error}`); }
  await sleep(900);
  /* A third element clips the shot to one element at 1:1. Legibility is a
   * question about actual pixels, and a full-page shot answers it badly: at
   * 1400px wide a 20px badge is a smudge whether or not it is readable on a
   * real screen. Scale stays 1 deliberately — capturing at 2x re-rasterises
   * the text crisper than the user will ever see it. */
  let clip = null;
  if (clipSel) {
    const box = await s.send('Runtime.evaluate', {
      expression: `(() => { const e = document.querySelector('${clipSel}'); if (!e) return null;
        const r = e.getBoundingClientRect();
        return JSON.stringify({ x: r.x - 8, y: r.y - 8, width: r.width + 16, height: r.height + 16, scale: 1 }); })()`,
      returnByValue: true
    });
    if (box?.result?.value) clip = JSON.parse(box.result.value);
    else console.log(`  ! ${name}: no element matched ${clipSel}`);
  }
  const shot = await s.send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' });
  const file = join(OUT, `${name}.png`);
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  done.push(name);
  console.log(`  ${file}`);
}

ws.close();
proc.kill();
console.log(`\n${done.length} shots written to ${OUT}`);
