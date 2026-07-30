# Dropzone Commander 3E Army Builder — Handoff

Everything a fresh session needs to pick this up. Read this first.

---

## 1. What this is

An army builder for **Dropzone Commander 3rd Edition**, built as a **fork of the
Dropfleet Commander Fleet Builder** — not a rewrite. The Dropfleet app represents
months of work (594 commits, ~200 functions, print/share/sync/offline/collection
tracker/rules tooltips/art carousels). The job is to keep all of that and swap
the *game* underneath it: different stats, units, rules, appearance.

> The single most important thing to understand: **do not rebuild this app.**
> An earlier attempt hand-built a lookalike from scratch and lost every feature.
> Adapt the fork.

### Where things live

| | |
|---|---|
| **Working folder** | `D:\wargaming\Web Apps\Dropzone-3E-Army-Builder` |
| **This repo** | `github.com/Type37/dropzone-3e-army-builder` |
| **Upstream remote** | `upstream-dropfleet` → `github.com/Type37/dropfleet-builder` |
| **Reference app (read-only)** | `D:\wargaming\Web Apps\Dropfleet-Builder` |
| **Retired** | `D:\wargaming\Web Apps\Dropzone-Commander-Arsenal-3e` + its repo — superseded, see §7 |

GitHub would not allow a true fork (one account cannot own both parent and
fork), so this is a full clone with history preserved and Dropfleet kept as a
remote. Future Dropfleet fixes can still be cherry-picked:

```sh
git fetch upstream-dropfleet
git cherry-pick <sha>
```

---

## 2. What the owner wants

Stated requirements, in their words where it matters:

1. **Fork, don't rebuild.** "What I want is the dropfleet builder app I spent
   months making, but then we change the functionality, stats, appearance and
   units and such."
2. **One app, not two.** Dropfleet ships a desktop build *and* a separate
   `mobile/` build; they drifted apart. Unify into a single responsive app.
   Desktop keeps panes; mobile does not.
3. **Fluent 2 design**, layered over the Dropfleet look. Reference:
   <https://jetwong.neocities.org/fluent2-reference> — tokens, spacing, radius,
   elevation, motion curves, z-index ladder, two-stroke focus ring.
4. **Keep Dropfleet's colours and type.** Warm paper/ink palette, navy rail,
   gold accents. **Tighter spacing** than Dropfleet.
5. **Fonts:** Terminal Grotesque Open (wordmark), Jost (body *and* the condensed
   label role), Roboto Slab (display), Libre Baskerville (lore).
   **Barlow Condensed is out.**
6. **Icons matter.** They like them. Game tokens can come from the rulebook;
   otherwise Flowbite, Streamline, Simple Icons, SVG Spinners (via Iconify).
   Inline them — never load from a CDN, it breaks offline.
7. **Images for every unit.** Done — 178/178.
8. **Mobile-friendly for real.** Tapping shows info; adding is deliberate.
9. **Renaming:** Groups and generic Commanders yes. Armies no.
10. **Print mode** matters, researched and DZC-specific (see §5).
11. **Lore** later; art is the priority.
12. **Task tracking:** Todoist project *Generators & Web Apps*, label
    `#dropzone3`. Add tasks when given work; complete them when done.
13. Working notes go in `NOTES.md` (gitignored), **not** into GitHub.

---

## 3. The data pipeline (done, and the part worth keeping)

`tools/dzc/` converts TTCombat's published stat-card PDFs straight into JSON, so
a new release is re-ingested rather than re-typed.

```sh
python -m pip install pymupdf pillow
python tools/dzc/rebuild.py          # scan both sources, then run all four audits
python tools/dzc/rebuild.py --skip-scan   # re-audit data already on disk
```

`rebuild.py` is the whole pipeline and the only thing a new stat-card release
should need. Stages run in order and the first failure stops the run, because
each consumes the one before it:

| Stage | In | Out |
|---|---|---|
| `scan_statcards.py` | the six faction PDFs | `data/dzc/faction-*.json`, `assets/units/*.webp` |
| `scan_rulebook.py` | rulebook ch.10/11 **and** each faction PDF's front matter | `data/dzc/rules.json` |
| `audit_data.py` | | shape, categories, weapon boxes |
| `audit_transport.py` | | symbol shapes and carrier/passenger lineages |
| `audit_art.py` | | every unit has art, every art file has a unit |
| `audit_rules.py` | | every keyword a card prints resolves to glossary text |

`data/dzc/index.json` is the one file **not** scanned. Game sizes, category
caps, commander levels and the Command Card deck rules are prose tables in
chapter 3, not stat cards, and they change only with an edition — so they are
transcribed, each entry citing its rulebook section.

> **There is no adapter, and there should not be one.** An earlier plan had a
> `build_app_data.py` reshaping DZC JSON into the Dropfleet format. That means
> two canonical shapes forever and a mapping layer that has to lie
> (`Mv`→`thrust`, `DP`→`hull`) to keep the old renderers quiet. The app has to
> change anyway for columns, nesting and validation, so it reads `data/dzc/`
> **natively**. One source of truth.

**Status: 178 units across all six factions, 0 pages skipped, all three audits
clean.** Plus 178 transparent WebP unit photos (12.5 MB total).

Source PDFs are in `rules/` — TTCombat publish them free and publicly at
<https://ttcombat.com/pages/dropzone-commander-resources>.

### Things the cards do that break naive parsers (all handled)

| Card behaviour | Why it bites |
|---|---|
| `∞/24"` ranges | `pdftotext` silently drops the infinity glyph — hence PyMuPDF |
| `(Surge 1, 2, and 3)` | prefix written once; means Surge 1, Surge 2, Surge 3 |
| `(Jack­al)` split over a line | soft hyphen, not ASCII `-` |
| `(Recon ATVs)` vs `(Recon ATV)` | banner and weapon bracket disagree on plurals |
| Greave has no unique weapon | variants must come from points + weapons + specials |
| Points and Squad Size share a `y` | banner columns must be read separately or they interleave |
| Badge digit printed twice | a template glyph at ~19.9pt and the real value at ~14.2pt over it |
| Faction logo watermark | drawn *larger* than the photo on 139/178 cards |

Two hard-won rules encoded in the audits:

- **Transport symbol shape** decides which transports may carry a unit, so a
  misclassification silently permits illegal armies. Shape comes from the
  **convex hull**, not the path-item count: a hollow badge is nested outlines,
  so a hollow triangle has 6 line items and a bordered one 12, and 12 divides by
  both 3 and 4. `audit_transport.py` pins the rulebook's Condor→Bear APC→Sabre
  pairings as regression tests.
- **A diamond is not a square.** Square fills are 23/24 Infantry, diamond fills
  22/25 Vehicle, and four of six factions use both. Collapsing them would let
  infantry ride in vehicle-only transports.

One known source-data quirk (not a bug): the Bioficer **Surge Gunship**'s *Decon
Pulse* prints an orange variant-restricted name box but names no variant,
contradicting rulebook 3.2.2. Flagged as `boxUnresolved`, treated as
all-variants.

---

## 4. DZC rules the builder must enforce

Rulebook 3.01, chapter 3.

| Game size | Points | Max Groups |
|---|---|---|
| Skirmish | 501–1000 | 9 |
| Clash | 1001–2000 | 12 |
| Battle | 2001–3000 | 16 |
| Reconquest | 3001+ | 20, +4 per 1000 over 3000 |

- Categories: **Standard / Vanguard / Heavy / Support / Transport** (+ *Generated*
  for Bioficer Drones and Hulks, which cannot be selected).
- Vanguard, Heavy and Support may **each** not exceed points spent on Standard.
- No Group may cost more than **¼ of the agreed limit** (the number you agreed,
  not the top of the band — so the limit must be an input).
- **Rare**: 1 in Skirmish, 2 in Clash, 3 in Battle/Reconquest. **Unique**: 1.
- **Transports** may only be taken alongside a Squad they can carry, and must be
  taken **full**. They have no min/max squad size — a missing squad size is
  normal for them. The transports form their own Squad; the two Squads form one
  Group.
- **Auxiliary Transports** (hollow symbol, category *not* Transport) are taken as
  normal Squads and need **not** be full. A carried Squad **cannot be split
  across multiple Auxiliary Transport Squads** (3.2.4.3).
- At least one **Commander**: L4=50, L5=90 (any size), L6=150 (Clash+),
  L7=230 (Battle+). Points count toward the total but are **ignored** for the
  category ratios (3.2.5). Assigned to a **Unit**, one Commander per Squad.
- **Variants are per MODEL, not per squad** — a Squad may legally mix them
  (3.2.2), so a squad's cost is the sum of its models.
- **Weapon upgrades** (green name box, points cost) — some *replace* an existing
  weapon, and the card says which. **All Units of the same Variant in a Squad
  must be upgraded equally** (3.2.3). So the upgrade is a per-Variant choice,
  not per-model like the Variant itself.

### 3.2.4.1 — up to four Squads may share one larger Transport

Group structure is **generated by rules, not chosen from a menu**. The rules are
3.2.4 (a Transport plus the Squad it carries form one Group), 3.2.4.1 (up to 4
Squads may share one larger Transport), and 3.2.4.3 (Auxiliary Transports).
Nesting is recursive and the rules set **no depth limit** — what limits depth in
practice is which capacity symbols actually exist in the data.

The two hard caps are the **4-Squad limit** on sharing one Transport, and that a
carried Squad **cannot be split** across multiple Auxiliary Transport Squads.

The rulebook then illustrates five worked examples. They are examples, *not* an
exhaustive taxonomy — do not model them as five cases:

| | |
|---|---|
| Group 1 | single Squad, no Transport |
| Group 2 | single Squad exactly filling one Transport |
| Group 3 | single Squad filling multiple identical Transports |
| Group 4 | one or more Squads in a single **Auxiliary** Transport Squad (need not fill it) |
| Group 5 | **up to 4 different Squads**, with their own filled Transports, filling one larger Transport |

Group 5 is the deep case: Condor → 2× Bear APC → 3+3 Legionnaires. When a
Transport carries another Transport, **the smaller one's cargo is ignored** for
capacity — it is already aboard.

### Transport symbol grammar (3.2.4.2)

Hollow = capacity it offers. Solid = space it fills. A Transport carryable by a
larger Transport prints **both**.

| Printed | Means |
|---|---|
| `4□ + 2○` | carries both shapes **simultaneously** |
| `3□ / 4△` | **either** shape, never mixed |
| `4□ / 6△ , 6△`(solid) | capacity group, then a comma, then what it fills |
| two **solid** symbols `/` | the Unit may use **either** — always a free choice |

> ⚠ **Known data gap.** `scan_statcards.py` records capacity as `[{shape, n}]`
> and **drops the `/` vs `+` separator**, which is the difference between
> either-or and both-at-once. Four units are affected; verified against the
> printed cards:
> **Strikehawk `+`**, **Carryhawk `+`**, **Harbinger `/`**, **Tegu `/`**.
> The comma case is already handled correctly (Tegu's `fills` is right). Fix the
> scanner before the adapter consumes this, or the builder will permit illegal
> loads.

### Consequences that reach beyond the roster

- Vehicles and Infantry that do **not** begin aboard an Aircraft (or in a
  Transport aboard an Aircraft) always begin **Reserved** — off table until
  Round 2 (9.4). This is *why* air transports are worth their points, and the
  builder should surface it.
- A Group containing **only non-auxiliary Transports** cannot be picked for a
  normal activation and is **ignored when generating Pass tokens** (4.1.2,
  4.2.1). Such Groups activate together in the Orphaned Transport step (4.2.2).
  So Group count is the activation count *minus* transport-only Groups.
- **Commander Level is load-bearing in play**, not just a points line: it sets CP
  per Round, Command Card hand size, and the Initiative modifier (4.1).

### The thing that makes DZC different

**A Group is a nesting tree, not a list.** Condor → 2× Bear APC → 6× Legionnaires.
Transports must be full, squads with transports **begin the game aboard them**,
and activation alternates **one Group at a time** — so Group count *is* your
activation count. No competing builder models this well; it's the differentiator.

Famous Commanders are **not released yet**. Schema slot exists; ship generic only.
Command Cards are **not published anywhere** — deferred.

---

## 5. Print mode

The printed sheet is the deployment plan. Keep the **Group nesting tree**,
indented, with capacity at each level. Drop chrome and art. Groups never split
across a page; rules text never breaks mid-sentence.

Carried from Dropfleet: per-unit thumbnails, ink-saver and density toggles,
accurate page-break preview. Two-column print was tried and **removed** on
mobile — don't reintroduce it.

---

## 6. Adaptation plan (the actual remaining work)

The app only ever fetches three things, so **the adaptation is a data layer, not
an edit of 26,000 lines**:

```
data/fleet-index.json    gameSystem.gameSizes / admiralLevels / objectives, factions
data/faction-<id>.json   { id, name, shortName, admirals[],
                           groups[{ id, name, category,
                                    ship{ name, cost, stats{}, weapons[],
                                          loads[], specialRules[] } }],
                           launchAssets, spaceStations, deployableFeatures }
data/pronunciations.json (optional)
```

**The rules are data.** Game sizes, group caps and admiral levels all live in
`fleet-index.json`, so most of DZC force construction is a data file.

### Domain mapping

| Dropfleet | Dropzone |
|---|---|
| Fleet → Battlegroup → Ship | Army → **Group** → Unit/Squad |
| Admiral (AP, abilities) | **Commander** (CP, Command Cards) |
| tonnage light/medium/heavy/colossal | **category** Standard/Vanguard/Heavy/Support/Transport |
| launch assets (`loads`) | **transport capacity** — *and nesting, which is new* |
| thrust/scan/sig/hull/es/ks/bs | Mv/A/DP, or Mv/OF/DF/B/DP for Infantry |
| arc/attack/lock/damage/type | arc/MA/R/Att/Ac/E |
| Colossal group limits | ¼-per-Group limit, category ratios |

**Reuse, don't invent:** Dropfleet's **Resistance modular ships** (Systems /
Hardpoint pickers, loadout refits folded into fielded stats) are already the
pattern DZC **variants** need.

### Order of work

1. ~~Adapter~~ — **dropped.** The app reads `data/dzc/` natively; see §3.
2. ~~Data layer~~ — **done.** `js/dzc-data.js` reads `data/dzc/` directly.
   The Dropfleet `transformIndex`/`transformFaction` were left alone rather
   than rewritten: the DZC app is built beside them and the old views are being
   retired, which is less risky than mutating 9,600 lines in place.
3. ~~Terminology~~ — **done in the DZC views.** They never used Dropfleet's
   vocabulary; they were written against Army / Group / Squad / Unit /
   Commander from the start.
4. Stats/weapons columns — **done for the reference, builder and print.**
   Arcs still to do: DZC arcs are **90° wedges** (6.1.2) with a Side Left /
   Side Right split, so Dropfleet's arc icons do NOT carry over.
5. ~~Validation~~ → superseded by **enforcement**; see below.
6. ~~Unify desktop + mobile~~ — **done.** The `/mobile/` redirect is gone.
   `mobile/` still exists and is still the Dropfleet build; it is now
   unreachable from the site and should be deleted once nothing wants it.
7. Appearance: Fluent tokens, tighter spacing, faction accents. Outstanding.

### Enforce, don't validate

The builder refuses illegal actions at the point of action. Anything that can
be made unreachable is unreachable, and only what genuinely depends on a
finished list is reported:

| Enforced (cannot happen) | Reported (only knowable when done) |
|---|---|
| Transports never appear in the picker; they are assigned to a Squad (3.2.4) | No Commander yet (3.2.5) |
| Only Transports that can carry that Squad are offered | Category ratios — you add Vanguard before the Standard paying for it |
| Transport COUNT is derived, never typed; the stepper is a locked readout | Points/Group-count over the limit |
| An option that cannot be taken **full** is disabled, with the arithmetic | A Group of only Transports (4.2.2) |
| Rare/Unique disabled with the limit quoted (3.2.1) | Squads beginning Reserved (9.4) |
| Squad min/max disables the stepper | |
| Commander levels filtered by game size (3.2.5) | |

### What exists now

| | |
|---|---|
| `js/dzc-data.js` | glossary resolution, transport capacity, army limits |
| `js/dzc-army.js` | army model, costing, enforcement, validation |
| `js/dzc-builder.js` | army list, builder, unit picker, print sheet |
| `js/dzc-units.js` | unit reference (all 178) |
| `js/dzc-icons.js` | inlined Material Symbols — see `ICONS.md` |
| `css/dzc.css`, `css/dzc-print.css` | |
| `scripts/test-dzc-data.mjs` | 48 assertions |
| `scripts/test-dzc-army.mjs` | 38 assertions |

Routes: `#armies`, `#army/<id>`, `#units`. The Dropfleet routes (`#fleets`,
`#builder/<id>`) still work but are no longer linked from anywhere.

### How big step 2 really is

Measured, not guessed — occurrences of Dropfleet-only vocabulary:

| | `app.js` | `mobile.js` |
|---|---|---|
| `admiral` | 577 | 261 |
| `launch` | 262 | 135 |
| `battlegroup` | 160 | 95 |
| `loads` | 131 | 66 |
| `hull` | 121 | 90 |
| `tonnage` | 99 | 32 |
| `colossal` | 83 | 30 |

~2,500 references across 26,000 lines. So "swap the data and the app follows"
is not true, and planning as though it were is how the schedule gets lost.

What that does **not** mean is a rewrite. The split is:

- **Keep, essentially untouched** — `sw.js`, `fleet-sync.js`, `offline-sync.js`,
  `count.js`, storage/settings/theme/routing, the modal and action-sheet
  system, print scaffolding, the CSS design system. None of it knows what a
  ship is.
- **Rewrite** — the domain model and the views that render ships, stats,
  launch assets and admirals. Those encode Dropfleet's *game*, and no amount of
  data reshaping makes them describe Dropzone.

Cut first (decided, see §9): Combat Calculator, Space Stations, Secondary
Objectives. That deletes a meaningful slice of the above before any of it needs
migrating.

---

## 7. What was salvaged from the abandoned "Arsenal" attempt

Before the fork decision, a from-scratch app was built and discarded. What
survived and is now in this repo:

- `tools/dzc/` — the scanner and its three audits
- `data/dzc/faction-*.json` — 178 scanned units
- `assets/units/` — 178 transparent WebPs
- `rules/` — the PDFs
- `tools/dzc/layout-check.html` — see below
- `NOTES.md` — working notes (gitignored)

The Arsenal repo and folder can be deleted once you're happy this has everything.

### Verification harness — please keep using this

`tools/dzc/layout-check.html` loads the app in **real fixed-width iframes** and
reports every element crossing the viewport edge at 320 / 375 / 414 / 768.

```sh
python -m http.server 8899
# then http://localhost:8899/tools/dzc/layout-check.html?url=../../index.html
```

**Why it exists:** `resize_window` reports *"Viewport set to 375x812"* while
leaving `window.innerWidth` at **867**. A responsive check run against it
measures the wrong viewport. That is exactly how a horizontal-overflow bug
shipped to a real phone. The harness asserts `instrumentOk` before trusting any
measurement — **if the instrument disagrees with what you asked for, stop.**

Related trap, from Dropfleet's own source comment: a floating action button
**must** live at `<body>` level. `.screen` carries `will-change: transform`,
which makes it a containing block for `position: fixed` and parks a nested FAB
off-screen.

---

## 8. Deployment notes

- GitHub Pages via `.github/workflows/deploy.yml`.
- **Stage only the site.** The repo carries ~317 MB of rules and lore PDFs the
  app never fetches; uploading them makes every deploy slow for nothing.
- **Cache-bust `css`/`js` with the commit SHA.** Pages caches them ~10 minutes
  with no fingerprint, so a deploy does not reach anyone holding the old copy —
  a fix once appeared not to deploy at all for exactly this reason.
- Fetch data JSON with `cache: 'no-cache'` so it revalidates; its filename must
  stay stable for the monthly re-scan.

### Wanted: monthly auto-update

First Tuesday of the month, GitHub Actions should fetch
<https://ttcombat.com/pages/dropzone-commander-resources>, hash-diff the stat
card PDFs, re-run the scanner and **open a pull request** — never auto-merge, so
a bad parse cannot silently corrupt live data. URLs follow
`DZC_{Faction}_Stat_Cards_{YYMMDD}.pdf`.

---

## 9. Feature decisions (settled)

| Dropfleet feature | Decision |
|---|---|
| **Combat Calculator** | **Cut.** Remove `js/calc-*.js`, `#view-calc`, its CSS and the three `scripts/test-calc-*.mjs`. ~143 KB of JS. |
| **Play Mode** | **Keep**, re-based on DZC. Needs CP/hand size/Initiative from Commander Level (4.1), Pass tokens excluding transport-only Groups (4.1.2), and DZC Status Tokens in place of Crippling Effects. |
| **Fleet Sync** | **Keep** as-is. Game-agnostic — it syncs an opaque JSON payload, so nothing in it knows about ships. |
| **Collection tracker** | **Keep.** Maps cleanly onto units. |
| **Space Stations** | **Cut.** No DZC equivalent. |
| **Secondary Objectives** | **Cut.** No DZC equivalent. |

Command Cards stay deferred — no card data is published — but the **deck rules
are now known** (3.2.6): a 33-card Core Set, decks of 45 built from Core plus a
faction's own 33-card set, or 66 for casual play; optional at Skirmish size.

Still open:

- Repo slug is `dropzone-3e-army-builder`; title is "Dropzone Commander 3E Army
  Builder". Rename if you'd prefer something else.
