# Dropzone Commander 3E Army Builder — Handoff

Reference for a fresh session. **Rules live in `CLAUDE.md`** (loaded
automatically). **The backlog is Todoist** — `#dropzone3` in *Generators & Web
Apps* — read when there is no instruction to hand, never written to before
starting work (CLAUDE.md §1). This file is neither; it is the game and
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
| `scripts/test-all.mjs` | 483 assertions across six suites |
| `assets/ref/` | the printable quick references — see §11 for why they are not at `/ref/` |

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

- **Monthly auto-update workflow** — §7. Needs a workflow file, which an
  unattended run's token cannot write.
- **Fast Play sheets, seeded example armies, tabs on the army list** — all
  three need starter lists nobody has published. Building them means inventing
  content, so they are not built.
- **Lore panels** — 6 PDFs in `Lore/`; art was the priority.
- **Art carousel, namesake lore, pronunciation, store links** — all four need
  data the scanner does not produce.

Built since this list was written, and no longer missing: the Faction
References tool (`assets/ref/`), New Recruit import, the print preview with
ink-saver, density, thumbnails, weapon tables and a Commander block, the
changeable points limit, the random generator, Group duplication, the JSON
backup and its import, and share as link / text / JSON.

Repo slug is `dropzone-3e-army-builder`, title "Dropzone Commander 3E Army
Builder". Rename if you'd prefer something else.

---

## 9b. Session — 2026-08-02, verification pass

An overnight loop had been running unattended against Todoist; stopped on
request (`ScheduleWakeup{stop:true}`, confirmed no `CronList` jobs either).
Working tree was clean at that point — every prior run's work was committed
and pushed. This pass verified rather than built:

- `node scripts/test-all.mjs` — **606 assertions, all passing**, six suites
  (data layer, army construction, share links, fleet sync, house rules,
  render). Up from 167 at the start of the previous session.
- `python tools/dzc/rebuild.py --skip-scan` — all four data audits clean.
- Latest Pages deploy: success. Live site: 200.

**Confirmed live, the thing Jet was angriest about:** the unit picker did not
show variants, so a Squad's real choice (Flak Team vs Mortar Team, a
completely different weapon) was invisible until after you'd already added
the base unit. That is fixed and verified in a running browser, not just read
in a diff: `Legionnaire Weapon Team`'s pick card now carries `Flak Team ·
25pts` and `Mortar Team · 25pts` as chips, priced, before you click. Separately,
Transports (`Bear APC`, `Condor Dropship`, ...) now appear in the same picker
as ordinary Squads, sorted together, so either can be added first — the
"click to add new Group, then add transports or units in either order"
rework Jet asked for directly. Per-model variant dropdowns are gone in favour
of a per-variant count.

Per the standing rule, no Todoist tasks were closed. Several already-closed
ones from earlier in the day may not reflect Jet's review — that rule was
violated once, in this same document's history (§0), before it existed.

**Then the tree stopped being clean.** After the check above, a concurrent
process (same overnight loop, or another session against the same repo) wrote
four files without committing: 44px touch targets on every mobile control
(`css/mobile-fixes.css` — the stepper was 24px square with 2px between plus
and minus), a Group capacity meter's always-visible label folded into its
hover/`aria-label`, a triangle badge's digit nudged off dead centre, and the
picker's "cannot be added here" units sinking to the bottom of every sort
instead of staying mixed in. Found by `git status` turning up dirty again
mid-write of this section. Verified — syntax, full suite (610, four new),
audits, and the one part not covered by a test (blocked units sinking)
checked live — then committed in two pieces, since part of the
`mobile-fixes.css` change had *already* landed separately as `1db2967`
(same content, different commit) between the two checks; `git add` on that
file found nothing left to stage. No duplicate content shipped; confirmed by
reading `git show --stat` on both commits rather than assuming.

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

**Todoist is the backlog, not a step before working.** This file is a map, not
a task list — `#dropzone3` in *Generators & Web Apps* has the standing priority
order, and it is where to look when there is no instruction to hand. Nothing is
filed there before starting work, and nothing there is closed or deleted by
Claude (CLAUDE.md §1). It is also currently at Todoist's per-project item cap,
so it cannot accept new tasks until Jet clears it.

---

## 11b. Cloud run — 2026-08-01, the fourth one

**The brief for this run said again that there is no browser here, and it was
wrong again.** That is three runs in a row. §11a already says it in capitals and
it still had to be rediscovered, so if a brief tells you the app cannot be
looked at, check before you believe it: `/opt/pw-browsers/chromium`, and
`scripts/shots.mjs` drives it.

**And then a shot turned out to be a lie in a new way.** Headless Chrome does
not advance the animation timeline while nothing is asking it for frames. Four
seconds after load, a landing tile still reported `slideUp` as *running* with
`currentTime: 0` — and `.stagger > *` starts at `opacity: 0`, so the landing
page captured as one grey ghost of a card on an empty page, in every set anyone
has ever taken. The script finishes every animation before the capture now, and
both committed sets were retaken. **If you are looking at a screenshot in
`docs/screens/dropzone/` from before this run, it is the 0% keyframe of
whatever it shows.**

Ten commits, every one of them found by looking rather than by reading code.
The two worth knowing:

**The print preview was lying to a phone, which is the one thing it exists not
to do.** The same one-page army read "1 page" at 1500 and "3 pages" at 375, with
a break drawn through the middle of a Squad — through a Group, the one atom the
sheet is built to keep whole. Two faults, and neither shows on a desktop.
`.pp-scroll` is a flex container, so its default `align-items: stretch` pulled
the paper down to the height of the window, and the page count is measured off
the paper's own height. And `paginate()` mixed two coordinate spaces that agree
only at zoom 1: `getBoundingClientRect` follows the sheet's zoom down, while
`scrollHeight`, the padding off `getComputedStyle` and every `top`/`height`
written back as a style are the element's own pixels. **Anything measured inside
`.pp-paper` has to be divided back out by its zoom.**

**On a phone there was no way back from anything.** `css/app.css` hides
`.topbar-context` below 768px — the back chevron on every view, and Play Mode's
Reset game. That was right when a phone got the separate `mobile/` build with
its own chrome; that build is deleted, and nobody went back over what the
deletion left behind. **Go looking for more of these**: `css/app.css` is 6800
lines of Dropfleet-era rules and some of them are still assuming an app that no
longer exists.

**Where a rule puts a thing is part of the rule.** Play Mode had Concussed,
Suppressed, Jammed and Obscured on every model. Three of those are Status
Tokens and the rule that creates each one names where it goes — 11.1.7, 11.1.22
and 11.1.34 all say "on its Squad" — so a Squad of five had five independent
Concussed toggles and could record a state the game cannot produce. Obscured is
not a token at all (10.1.21 makes it a question of where a model is standing),
so that one stays per model. Read the rule that *creates* a thing, not just the
one that names it.

**Four things were being drawn over or cut off**, all of them on screens that
had been shot dozens of times at page scale and never at 1:1: a Group's cost
under the drag grip, `5+ DEFENC` on the reference card (a bare `1fr` is
`minmax(auto, 1fr)`, and the stat label refuses to break inside a word), the
Standard track drawn in the category green on a card whose background is the
faction accent, and the Collection's search box cutting off its own placeholder.
**Clip a component at 1:1 before believing a page shot.** The harness now shoots
the rail, the Group list, a reference card, Share and Play, none of which had
ever been shot at all.

**Two things §11a says that are no longer true**, corrected here so they are not
re-derived: the rank insignia IS wired in (the rail Commander card and the
chooser, offset by 3 because DZC ranks run 4–7), and the truncated Strikehawk
and Carryhawk upgrade notes ARE fixed in the data — `audit_data.py` passes with
one known source-data warning, the Bioficer Surge Gunship.

The suite went 594 → 600. Every new assertion was checked to FAIL against the
code before it.

---

## 11a. Cloud run — 2026-08-01, the third one

**THERE IS A BROWSER IN A CLOUD RUN. Do not believe otherwise again.**

Chromium is at `/opt/pw-browsers/chromium`. Two previous runs, and the brief
for this one, all state flatly that there is no Chrome in a cloud session and
that nothing can be looked at. That is failing pattern #2 almost word for word,
and it cost two whole sessions of unverified work.

`scripts/shots.mjs` works here now. Two one-line faults were stopping it: it
searched four Windows paths only (it checks `CHROME_BIN` and six Linux paths
now, `/opt/pw-browsers` first), and it launched without `--no-sandbox`, which a
container running as root needs — Chrome exits before opening the debugging
port, and the script reported "Chrome never exposed a page target", which reads
exactly like the browser being absent.

```sh
python3 -m http.server 8901 &
SHOT_W=1500 SHOT_H=1100 node scripts/shots.mjs http://127.0.0.1:8901/index.html docs/screens/dropzone/<date> dzc
```

Thirty-two shots are in `docs/screens/dropzone/2026-08-01-cloud/`. Take them
BEFORE claiming anything visual, and note that 1400px is the three-pane
breakpoint — shoot at 1500 or the rail renders as an overlay and every judgment
about it is wrong.

Twenty-nine commits. Everything below the browser was shipped before the
screenshots existed; the last two commits are the first thing looking at them
found. This run read the RULEBOOK rather than the backlog's own descriptions,
and that is where most of what follows came from. If you only read one more
thing here, read the next two.

**A Group the rulebook itself draws was reported as walking on.** 9.4 says
Vehicles and Infantry begin Reserved unless they start "aboard an Aircraft, **or
in a Transport aboard an Aircraft**". `validate()` looked at the immediate
carrier only, so six Legionnaires in two Bear APCs in a Condor — the nested
stack illustrated on p11 — came back as beginning Reserved. Whether a Squad
starts on the table is the whole reason air transport earns its points (§3), so
the builder was saying the expensive option had bought you nothing. The
carriage chain is walked now, with a `seen` set so a corrupt save cannot hang
the validator.

**Two data faults and a resolver fault, all in the scanned data.**
`upgrade_note` matched a run of spans beginning with an asterisk; a footnote is
a LINE. The Strikehawk and Carryhawk stopped mid-clause at "May replace
transport capacity of", and Drones and Hulks held a paragraph of lore. Both
now caught by `audit_data.py` — a note with no upgrade weapon behind it, or one
that does not end a sentence, fails the build. Separately, the rulebook heads a
rule "Hardy X" and then reads "a save of X+" while every card prints "Hardy
4+", so the value took the plus with it and every tooltip read "a save of 4++".
`scan_rulebook.py` has a `KNOWN_HEADING_QUIRKS` table beside `KNOWN_TYPOS` for
that, correcting the template for matching only.

**`data/dzc/index.json` has been checked against chapter 3, value by value,
and matches.** It is the one file that is transcribed rather than scanned, so
it had no audit at all. Eleven assertions now pin the band EDGES (1000 is still
Skirmish, 1001 is Clash) with the rulebook's words quoted above them.

**A Squad's weapon table is the guns that Squad fires.** It used to print the
Unit's whole card — the gun only a Rapier carries on a Squad with no Rapier,
every unbought upgrade as a row. `squadGuns(s)` in `js/dzc-builder.js` is the
one definition, applied through `DZCUnits.unitWeapons`, shared by the Squad row,
the printed sheet and the sheet's rules appendix. The appendix was printing the
full text of rules for guns nobody in the army could fire.

**Two reads that went round the derived names**, which is the failure §10 warns
about and it had regressed again. `commanderTagName` looked its Commander up by
an id on the Squad's COPY of it — `syncCommanders` writes `{ level }` and no
id — so the lookup matched nobody every time and the fallback was the only
branch that ever ran. And the Aboard select appended a Group only when it had a
typed name. A share link had both problems too: it wrote the literal string
"Group" for every unnamed Group, and never carried a Commander's typed name at
all.

**What a Commander Level buys is chapter 4, not the points table.** CP up to
your highest Level (4.1.1), a hand of that many cards (4.1.4), D6 plus it for
Initiative (4.1.5). Play Mode ran on those three numbers from the day it was
written and no other screen had been told; they are now on the chooser, in the
rail and on the printable reference. A Level the agreed size cannot reach is on
the chooser dimmed, saying which game reaches it — it used to be filtered out,
which is enforcement by absence and the one form this app uses nowhere else.

**Play Mode's numbers had never been asserted, only its controls.** Eight
assertions read off the rendered screen: Round 1 caps CP at nothing, the Pass
token ladder, and a Group of only Transports ignored on your own side of it.

**Compact view**, in Settings, off by default, Dropfleet's copy with the noun
that has no DZC analogue dropped. It hides the weapon table and the stat grid
repeated under every Variant, and no control — which is the one place it
deliberately does not follow Dropfleet, whose compact hides the loadout radios.

**Two open questions on the backlog, both with the rule text quoted.** 3.2.5
places no restriction on a Commander riding in a Transport Squad and the
builder refuses it anyway; the comment now says that is a decision, not
enforcement. And the scanner still truncates the Strikehawk and Carryhawk
footnotes — the render side is guarded, the data is not fixed.

**Also shipped, and the reason to read the tests before adding to them.** The
router was the one thing nothing drove, and a route naming a view id
index.html does not declare shows a blank page and throws nothing — checked
statically now, both directions. Two scripts the page loads were in no offline
precache. The print preview and the printer kept two separate lists of which
blocks must not be cut, with nothing holding them together. The Collection's
arithmetic and Play Mode's numbers had never been asserted at all, only their
controls. Stat and weapon-column hovers carry the rulebook's own one-line
definitions instead of repeating the label printed under them.

**Still blocked, and only by one thing.** Moving `assets/ref/` to `/ref/` needs
one word on the deploy workflow's `cp` line, and a cloud run's token is refused:
`refusing to allow an OAuth App to create or update workflow .github/workflows/
deploy.yml without workflow scope`. The whole move was built and tested green,
then reset rather than pushed half — without the workflow line, `/ref/` 404s.
The nine steps are written out on that Todoist task.

The suite went 499 → 594. Every new assertion in this run was checked to FAIL
against the code before it, which is worth keeping up: an assertion that passes
either way is decoration.

---

## 11. Cloud run — 2026-08-01, the later one, no browser

Thirteen commits, none of them looked at. The load-bearing points:

**The builder was throwing on any Squad with a Transport.** `squadHtml` called
`U.transportHtml` two hundred lines above the `const U` that declares it — a
temporal dead zone, so a thrown `ReferenceError` inside `renderBuilder`, so
nothing reached the pane at all. Live since 67c4336 the previous day, through
400-odd passing assertions, because **nothing had ever driven `renderBuilder`**.
The suite tested the renderers a Unit goes through and never the screen that
assembles them.

**So every screen is driven now** (`scripts/test-dzc-render.mjs` §7): the army
list, the builder, the picker, the Transport chooser, the Commander chooser,
Share, the print preview, the unit reference, Collection and Play — each
asserted to not throw, to draw something, and to print no placeholder. Then the
builder and picker again, once per faction, over a generated army. A stub
document is not a browser and the file says so; "it renders at all" is still an
assertion nothing was making.

**A footgun that will bite the next test.** `DZCArmy.load()` re-parses
localStorage, and `renderBuilder` calls it every render — so an object handed
back by `create()` or `addSquad()` is stale as soon as a screen has drawn. **Ids
survive that; references do not.** Not a bug in the app (every handler goes
through `current`, refreshed each render), but it cost an hour.

**Two house rules were being broken silently, and both now have checks.**

- **Sharp cards.** The rule went into `css/dzc.css` halfway up the file, above
  the declarations that round `.dzc-pick`, `.dzc-rail-card` and
  `.dzc-cmdr-opt`. Same specificity, later rule wins — so the picker cards and
  the whole rail had been rounded since the rule was made. The block is now
  **last in the file and has to stay there**, and the test reads the cascade in
  load order and fails if the last word on any listed surface is not zero.
- **No word more than twice on a screen.** The landing screen said "Army
  Builder" three times. The check splits `index.html` into the screens it
  declares and fails on any word or two-word pair said three times. **Static
  markup only** — the JS-built views are not covered.

**Two more checks worth knowing about.** Every top-level path the site fetches
must be on the deploy workflow's `cp` line — that is how `ref/` would have
404'd. And `assets/ref/` is pinned to `js/dzc-units.js` and `js/dzc-builder.js`
for the six transport symbols and the six faction accents.

**`assets/ref/` is in the wrong place on purpose.** The printable quick
references belong at `/ref/`, where Dropfleet keeps its own. They are under
`assets/` because the deploy workflow stages a named list and **a cloud run's
token cannot edit a workflow file** — git push, the contents API and the
git-data API all refuse. There is a Todoist task with the one-line diff. Both
files say the same at the top.

**Shipped in the second half.** Drag a Group to reorder it (`DZCArmy.moveGroup`,
Pointer Events ported from Dropfleet — native drag does not fire on touch in
iOS Safari). An army description, set at creation and edited in the builder.
Play/Share/Print in the topbar, where the label hides below 768px. One overflow
menu on an army card instead of two loose icons. On a phone the rail collapses
behind a peek line carrying points left and the issue count — a disclosure, not
the drag sheet gap 47 asks for, because a gesture that cannot be tested is the
wrong thing to put on the phone case. Every image now removes itself on error.

**What shipped besides.** A printable quick reference per faction, generated
from `data/dzc` rather than typed (one page, `?faction=<id>`), linked from the
landing page and the footer. Share as three targets — link, plain text, JSON —
where the text keeps the Group nesting indented AND parses back through
`DZCArmy.parseList`. An army description, set at creation and editable in the
builder, travelling in the link, the JSON and the text. The four feedback
questions, taken verbatim from Dropfleet. An "Owned" filter in the picker,
gated on the Collection setting. Play/Share/Print moved into the topbar, where
the label hides below 768px.

**Not done, and why.** Fast Play sheets, seeded example armies and the army-list
tabs all need content nobody has: they would mean inventing starter lists.
The monthly stat-card workflow needs a workflow file, which this run cannot
write.

---

## 12. Cloud run — 2026-08-01, the earlier one, no browser

Thirteen commits from an unattended run with no Chrome and no access to the
Dropfleet working folder, so **everything below is tested and none of it has
been looked at.** Each commit says what it did not check; the Todoist comment
on each task says the same. The one thing worth doing before trusting any of
it is opening the app.

**Two real bugs, one of them serious.**

- **A Squad needing more than one Transport was reported illegal.**
  `DZC.loadCheck` / `DZC.isFull` measured against one vehicle's capacity and
  were never told how many Transports were in the Transport Squad, so six
  Legionnaires in two Bear APCs — the rulebook's own worked Group 3 — came
  back as "Bear APC has 3 square capacity, needs 6". Both now take a carrier
  count, defaulting to 1; every caller looking at a Squad that exists passes
  `s.models.length`.
- **"Pen 6+"** was already fixed before this run; the note stands in the
  changelog.

**The generator is a test, not a toy.** `DZCArmy.generate(faction, limit,
rand)` behind "Surprise me" in the New Army dialog. It has to produce a
*legal* army, which makes it the only thing in the suite that argues with
every rule at once — and it is what found the Transport bug above. 72 armies
across six factions and four points levels are asserted legal on every run,
with an injected `rand` so a failure reproduces. Three things it had to be
taught, all of them non-obvious: the category ratio must be checked *after* a
Group is built (the Transport's cost moves it), the Commander must be assigned
*before* Squads grow (their points land on the Group they join and can push it
past the quarter-of-the-army ceiling), and a rejected Group must not cost one
of the Group slots.

**Things that changed shape, not just gained a feature.**

- **Print goes through a preview** (`openPreview` in `js/dzc-builder.js`) with
  measured page breaks — a block the stylesheet keeps whole is pushed to the
  next page exactly as print does it, so the preview and the paper agree. The
  atom list in `paginate()` must stay in step with the `break-inside: avoid`
  rules in `css/dzc-print.css`. The sheet's styling came *out* of `@media
  print` for this: a rule that only exists at print time is a preview that
  lies. Compact / ink-saver / art live in the preview bar, not Settings.
- **The per-model variant dropdowns are gone.** `setVariantCount` /
  `canSetVariantCount`; the variant block carries the count, so a Squad's
  shape is "how many of each" rather than a dropdown per model.
- **Upgrades render as whole weapon rows** with the price as the button,
  built from `wpnHead`/`wpnCells` so they cannot drift from the table above.
- **Import exists** — `DZCArmy.importArmies` (backup/single army, ids all
  reissued so nothing is overwritten) and `DZCArmy.importList` (a pasted New
  Recruit list; conventions read out of Dropfleet's `parseArmyListText`). A
  pasted list cannot recover the Group nesting and says so.
- **The points limit is changeable** — `setPointsLimit`, off the size in the
  rail.
- **Rule text links the rules it names**, `DZC.linkKeywords`. Aliases are in
  the pool on purpose: without "First Strike" the sort matches the bare
  "Strike" inside it, which is a different rule.
- **Every rule a Unit uses prints in full** under its weapon table
  (`unitRulesHtml`) — a tooltip does not exist on a phone.

**The suite grew from 306 to 381** and two of the new checks are house rules
rather than code: the interpunct budget is now counted across the JS as well
as `index.html` (and `&middot;` counts), and every `<input>`/`<select>`/
`<textarea>`/`contenteditable` must carry an accessible name. The render suite
now loads `js/dzc-units.js` against a document stub and draws all 178 Units.

**Left for Jet, not guessable from here:** the monthly stat-card workflow
wants a PR, which CLAUDE.md §6 forbids — three options are on that task and
the recommendation is to gate on the four audits and commit to master. "Group
list sectioned by category" cannot be built as written: a DZC Group has no
category. New Recruit's *DZC* export format needs a real sample pasted onto
its task.
