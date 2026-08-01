# Dropzone Commander 3E Army Builder — Handoff

Reference for a fresh session. **Rules live in `CLAUDE.md`** (loaded
automatically). **Open work lives in Todoist** — project *Generators & Web
Apps*, label `#dropzone3`. This file is neither; it is the game and
infrastructure reference.

---

## 1. What this is

An army builder for **Dropzone Commander 3rd Edition**, built as a fork of the
**Dropfleet Commander Fleet Builder**. The Dropfleet app is 594 commits of
work. The job was to keep it and swap the game underneath.

| | |
|---|---|
| **Working folder** | `D:\wargaming\Web Apps\Dropzone-3E-Army-Builder` |
| **This repo** | `github.com/Type37/dropzone-3e-army-builder` |
| **Upstream remote** | `upstream-dropfleet` → `github.com/Type37/dropfleet-builder` |
| **Reference app** | `D:\wargaming\Web Apps\Dropfleet-Builder` (read-only) |
| **Fork point** | `git show 43773fa:<path>` |

GitHub would not allow a true fork, so this is a clone with history preserved.
Dropfleet fixes can still be cherry-picked:

```sh
git fetch upstream-dropfleet && git cherry-pick <sha>
```

**In a cloud session, run `git fetch --unshallow` first.** Those checkouts clone
shallow, so `43773fa` does not resolve and every "check the Dropfleet source
first" instruction silently has nowhere to look.

---

## 2. The data pipeline

`tools/dzc/` converts TTCombat's published stat-card PDFs into JSON, so a new
release is re-ingested rather than re-typed.

```sh
python -m pip install pymupdf pillow
python tools/dzc/rebuild.py            # scan both sources, then all four audits
python tools/dzc/rebuild.py --skip-scan   # re-audit data already on disk
```

Stages run in order; the first failure stops the run.

| Stage | Out |
|---|---|
| `scan_statcards.py` | `data/dzc/faction-*.json`, `assets/units/*.webp` |
| `scan_rulebook.py` | `data/dzc/rules.json` |
| `audit_data.py` | shape, categories, weapon boxes |
| `audit_transport.py` | symbol shapes, carrier/passenger lineages |
| `audit_art.py` | every unit has art, every art file has a unit |
| `audit_rules.py` | every printed keyword resolves to glossary text |

`data/dzc/index.json` is the one file **not** scanned — game sizes, category
caps, commander levels and Command Card deck rules are prose tables in chapter
3, so they are transcribed with rulebook citations.

**The app reads `data/dzc/` natively.** There is no adapter and there should
not be one: an adapter means two canonical shapes forever plus a mapping layer
that has to lie (`Mv`→`thrust`, `DP`→`hull`).

Source PDFs are in `rules/`, published free at
<https://ttcombat.com/pages/dropzone-commander-resources>.

### Two rules the audits pin down

Both are regression tests because both silently permit illegal armies.

- **Transport symbol shape comes from the convex hull, not the path-item
  count.** A hollow badge is nested outlines, so a hollow triangle has 6 line
  items and a bordered one 12 — and 12 divides by both 3 and 4.
  `audit_transport.py` pins the rulebook's Condor→Bear APC→Sabre pairings.
- **A diamond is not a square.** Square fills are 23/24 Infantry, diamond fills
  22/25 Vehicle, and four of six factions use both. Collapsing them would let
  infantry ride in vehicle-only transports.

One source-data quirk, not a bug: the Bioficer **Surge Gunship**'s *Decon
Pulse* prints a variant-restricted name box but names no variant, contradicting
3.2.2. Flagged `boxUnresolved`, treated as all-variants.

---

## 3. DZC rules the builder must enforce

Rulebook 3.01, chapter 3.

| Game size | Points | Max Groups |
|---|---|---|
| Skirmish | 501–1000 | 9 |
| Clash | 1001–2000 | 12 |
| Battle | 2001–3000 | 16 |
| Reconquest | 3001+ | 20, +4 per 1000 over 3000 |

- Categories: **Standard / Vanguard / Heavy / Support / Transport**, plus
  *Generated* for Bioficer Drones and Hulks, which cannot be selected.
- Vanguard, Heavy and Support may **each** not exceed points spent on Standard.
- No Group may cost more than **¼ of the agreed limit** — the number agreed,
  not the top of the band, so the limit must be an input.
- **Rare**: 1 in Skirmish, 2 in Clash, 3 in Battle/Reconquest. **Unique**: 1.
- **Transports** may only be taken alongside a Squad they can carry, and must
  be taken **full**. They have no min/max squad size. The transports form their
  own Squad; the two Squads form one Group.
- **Auxiliary Transports** (hollow symbol, category *not* Transport) are taken
  as normal Squads and need **not** be full. A carried Squad **cannot be split
  across multiple Auxiliary Transport Squads** (3.2.4.3).
- At least one **Commander**: L4=50, L5=90 (any size), L6=150 (Clash+),
  L7=230 (Battle+). Points count toward the total but are **ignored** for the
  category ratios (3.2.5). Assigned to a Unit, one Commander per Squad.
- **Variants are per MODEL, not per squad** (3.2.2) — a Squad may legally mix
  them, so a squad's cost is the sum of its models.
- **Weapon upgrades** (green name box, points cost) — some *replace* an
  existing weapon and the card says which. **All Units of the same Variant in a
  Squad must be upgraded equally** (3.2.3), so the upgrade is a per-Variant
  choice, not per-model like the Variant itself.

### A Group is a nesting tree, not a list

Condor → 2× Bear APC → 6× Legionnaires. Group structure is **generated by
rules, not chosen from a menu**: 3.2.4 (a Transport plus the Squad it carries
form one Group), 3.2.4.1 (up to 4 Squads may share one larger Transport),
3.2.4.3 (Auxiliary Transports). Nesting is recursive with no depth limit in the
rules — what limits depth is which capacity symbols exist in the data.

The two hard caps: **4 Squads** sharing one Transport, and a carried Squad
**cannot be split** across multiple Auxiliary Transport Squads.

The rulebook illustrates five worked examples. They are examples, **not** an
exhaustive taxonomy — do not model them as five cases.

| | |
|---|---|
| Group 1 | single Squad, no Transport |
| Group 2 | single Squad exactly filling one Transport |
| Group 3 | single Squad filling multiple identical Transports |
| Group 4 | one or more Squads in a single **Auxiliary** Transport Squad |
| Group 5 | **up to 4 different Squads**, with their own filled Transports, filling one larger Transport |

When a Transport carries another Transport, **the smaller one's cargo is
ignored** for capacity — it is already aboard.

### Transport symbol grammar (3.2.4.2)

Hollow = capacity offered. Solid = space filled. A Transport carryable by a
larger Transport prints both.

| Printed | Means | In the data |
|---|---|---|
| `4□ + 2○` | both shapes **simultaneously** | `capacityMode: "both"` |
| `3□ / 4△` | **either** shape, never mixed | `capacityMode: "either"` |
| `4□ / 6△ , 6△`(solid) | capacity group, comma, then what it fills | `fills[]` |
| two **solid** symbols `/` | the Unit may use either — free choice | |

### Consequences that reach beyond the roster

- Vehicles and Infantry that do **not** begin aboard an Aircraft (or in a
  Transport aboard an Aircraft) begin **Reserved** — off table until Round 2
  (9.4). This is *why* air transports are worth their points, and the builder
  should surface it.
- A Group of **only non-auxiliary Transports** cannot be picked for a normal
  activation and is **ignored when generating Pass tokens** (4.1.2, 4.2.1); it
  activates in the Orphaned Transport step (4.2.2). So Group count is the
  activation count *minus* transport-only Groups.
- **Commander Level is load-bearing in play** — it sets CP per Round, Command
  Card hand size, and the Initiative modifier (4.1).

Famous Commanders are **not released**; schema slot exists, ship generic only.
Command Cards are **not published**. Deck rules are known (3.2.6): a 33-card
Core Set, decks of 45 from Core plus a faction's own 33, or 66 for casual;
optional at Skirmish.

---

## 4. Print mode

The printed sheet is the deployment plan. Keep the **Group nesting tree**,
indented, with capacity at each level — every competitor exports a flat list.
Drop chrome and art. Groups never split across a page; rules text never breaks
mid-sentence.

Carried from Dropfleet: per-unit thumbnails, ink-saver and density toggles,
accurate page-break preview. Two-column print was tried and **removed** on
mobile — don't reintroduce it.

**Print mode is supposed to be researched and DZC-specific. That research has
not happened.** What exists was guessed. It needs a real spec from Jet.

---

## 5. Where the code is

| | |
|---|---|
| `js/dzc-data.js` | glossary resolution, transport capacity, army limits |
| `js/dzc-army.js` | army model, costing, enforcement, validation |
| `js/dzc-builder.js` | army list, builder, unit picker, print sheet |
| `js/dzc-units.js` | unit reference (all 178) |
| `js/dzc-icons.js` | inlined Material Symbols — see `ICONS.md` |
| `js/dzc-share.js` | share links — the whole army travels in the URL |
| `js/dzc-play.js` | Play Mode — Rounds, CP, Pass tokens, Initiative, damage |
| `js/dzc-collection.js` | what you own; advisory, never blocking |
| `js/dzc-shell.js` | routing, modals, settings, theme, offline, sync |
| `css/dzc.css`, `css/dzc-print.css` | |
| `scripts/test-all.mjs` | 167 assertions across four suites |

Routes: `#armies`, `#army/<id>`, `#units`, `#collection`, `#play/<id>`,
`#share/<payload>`.

`css/app.css` is Dropfleet-era and **stays** — the Dropzone views build on its
tokens and its button, modal, topbar and card classes. Unpicking it is the
natural first step of the Fluent pass.

The Dropfleet `app.js`, `mobile/`, `ref/`, the calculator and the Dropfleet
data files are deleted. All of it is in this repo's history and in the
`upstream-dropfleet` remote.

### Enforce, don't validate

The builder refuses illegal actions at the point of action. Anything that can
be made unreachable is unreachable; only what genuinely depends on a finished
list is reported.

| Enforced (cannot happen) | Reported (only knowable when done) |
|---|---|
| Transports never appear in the picker; they are assigned to a Squad (3.2.4) | No Commander yet (3.2.5) |
| Only Transports that can carry that Squad are offered | Category ratios |
| Transport count is derived, never typed | Points or Group count over the limit |
| An option that cannot be taken full is disabled, with the arithmetic | A Group of only Transports (4.2.2) |
| Rare/Unique disabled with the limit quoted (3.2.1) | Squads beginning Reserved (9.4) |
| Squad min/max disables the stepper | |
| Commander levels filtered by game size (3.2.5) | |

---

## 6. Verification harness

`tools/dzc/layout-check.html` loads the app in real fixed-width iframes and
reports every element crossing the viewport edge at 320 / 375 / 414 / 768.

**How to run it, and why it exists, are in [CLAUDE.md](CLAUDE.md) §5** — which
loads every session, where this file does not. Two copies of one instruction
drift, and the copy that drifts is the one nobody reads.

---

## 7. Deployment

- GitHub Pages via `.github/workflows/deploy.yml`.
- **Stage only the site.** The repo carries ~317 MB of PDFs the app never
  fetches.
- **Cache-bust `css`/`js` with the commit SHA.** Pages caches them ~10 minutes
  with no fingerprint — a fix once appeared not to deploy at all for exactly
  this reason.
- Fetch data JSON with `cache: 'no-cache'`; filenames must stay stable for the
  monthly re-scan.

**Wanted:** first Tuesday monthly, GitHub Actions fetches the TTCombat
resources page, hash-diffs the stat card PDFs, re-runs the scanner and **opens
a pull request** — never auto-merge, so a bad parse cannot corrupt live data.
URLs follow `DZC_{Faction}_Stat_Cards_{YYMMDD}.pdf`.

---

## 8. Feature decisions (settled)

| Dropfleet feature | Decision |
|---|---|
| Combat Calculator | **Cut.** Done — files removed. |
| Space Stations | **Cut.** No DZC equivalent. |
| Secondary Objectives | **Cut.** No DZC equivalent. |
| Play Mode | **Keep**, re-based on DZC. |
| Fleet Sync | **Keep** as-is — it syncs an opaque payload. |
| Collection tracker | **Keep**, but **off by default**, as in Dropfleet. |

---

## 9. What is not built

The port is done — checked against the fork point rather than assumed, and the
working is in [PORTING.md](PORTING.md): every Dropfleet capability, sorted into
ported / cut / not applicable / missing. The short list below is the headline;
that file is the twenty-five.

- **The points limit cannot be changed after an army is created** — the one
  gap that was on no list at all until that audit.
- **Faction References tool** — Dropfleet has `ref/`; DZC has nothing.
- **New Recruit import/export** — Dropfleet has it; DZC does not.
- **Print extras** — preview with page-break markers, ink-saver, density,
  thumbnails, weapon tables, Commander block.
- **Monthly auto-update workflow** — §7.
- **Lore panels** — 6 PDFs in `Lore/`; art was the priority.

Repo slug is `dropzone-3e-army-builder`, title "Dropzone Commander 3E Army
Builder". Rename if you'd prefer something else.

---

## 10. Session handoff — 2026-08-01

Long overnight session, both an interactive one and an unattended cloud
routine (`RemoteTrigger`, recurring every 2h against the same Todoist backlog)
working the same repo in parallel. Read git log for the full list; the load-
bearing points a fresh session needs:

**The Vulture deadlock (fixed).** A Vulture Troopship carries 4 squares;
every UCM infantry Squad is 2–3 models at 1 square each, so no single Squad
could ever fill one — and the model stepper refused to grow past `squadMax`.
3.2.4.1 (up to 4 Squads may share one larger Transport) was never offered as
an option. `boardOptions`/`boardTransport` in `js/dzc-army.js` let a Squad
join a Transport already in its Group; the Transport chooser (`openCarry` in
`js/dzc-builder.js`) lists those first, under "Already in this Group".

**Group and Commander names are derived, not stored**, unless you actually
typed one. `groupName(army, g)` / `commanderName(army, c)` — an unnamed one
reports its position/Level, so deleting from the middle of a list can never
produce two things with the same default name again. Every renderer must go
through these functions; a raw `g.name` or `c.level` read is the bug that
regressed twice this session (see FAILINGS.md if that keeps happening).

**Desktop keeps panes now, on all four views** (builder, Play, Collection,
reference), per CLAUDE.md §4. Builder is three panes above 1400px (rail /
Group list / Group detail); below 900px a Group is a screen you drill into on
mobile (`selectedGroup`/`drilled` state in `js/dzc-builder.js`), not a long
stacked column.

**New test suite: `scripts/test-dzc-render.mjs`**, registered in
`test-all.mjs`. Catches markup-string bugs (null/undefined leaking into
rendered text, an inline `style="--x:"` shadowing a global CSS custom
property, one class name used on two unrelated elements, a class the JS
emits with no CSS rule behind it). Written after three regressions in one
night were caught by screenshots and none by tests — see the "render tests"
commit for the reasoning and a proof that each check catches its bug.

**No pull requests, ever — CLAUDE.md §6.** Commit to `master` and push,
always, even when a change can't be visually verified; say what wasn't
checked in the commit message instead of parking it in a branch.

**Turn discipline — CLAUDE.md §7.** "Work autonomously" means chaining many
tasks in one turn (finish → test → commit → push → next), not one task per
turn with a status report in between. Written down after Jet had to say it
four different ways in one session.

**Left mid-flight:** Commander naming (this session's last change) is
tested (306 assertions) but not yet visually verified — no screenshot was
taken of the rail card before this handoff was written. Worth a look before
trusting the layout.

**Todoist is still the real backlog.** This file is a map, not a task list —
`#dropzone3` in *Generators & Web Apps* has the live priority order, and a
lot of p1s remain (explainer-slop passes, Fluent wording guidance, print
mode research, the points-limit-after-creation gap). Work top-down by
priority there, not from this section.
