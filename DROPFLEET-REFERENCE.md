# Dropfleet Builder — reference

What the Dropfleet Commander Fleet Builder actually renders, screen by screen.
Written from the source, not from screenshots.

**Read this before building any DZC equivalent.** Every time something was
built without checking here first, it came out worse than the thing that
already existed.

Source: `D:\wargaming\Web Apps\Dropfleet-Builder\js\app.js` (9,605 lines),
`index.html` (572), `css/app.css` (7,820). Line numbers below are `app.js`
unless stated.

---

## 0. The one rule that explains the rest

**Every card shows you what you need to decide, without a click.** Stats,
weapons, arcs, special rules, cost, art. A click is for *more*, never for
*enough*.

The corollary, which is the part that keeps getting missed: **the card body and
the add button are different targets.** Clicking the card opens the full
profile. Adding is a separate `+ Add` button with `event.stopPropagation()`
(4557, 4563). That is HANDOFF §2.8 — "tapping shows info, adding is
deliberate" — already implemented, three years before it was written down as a
requirement.

---

## 1. Shared primitives

These four functions are used by every view. Port these first; everything else
composes them.

### `renderStatGrid(ship, mods)` — 3472

Two-column grid, each main stat paired with a save on its row, Hull spanning
both: `Thrust | KS`, `Scan | ES`, `Sig | BS`, `Hull`.

- Each cell: icon, value, label. `title` carries the full meaning from
  `STAT_META`, e.g. `sig` → "Signature, how visible the ship is".
- Zero and undefined stats render **nothing** — no empty cells, no dashes.
- `mods` marks stats an upgrade changed; the cell gets `stat-cell-modified`
  and the tooltip becomes "Thrust (upgraded +3)".
- ES/KS/BS each carry their own CSS class so the save types are colour-coded.
- Reinforced Armour is an armour rule, so it renders as a chip **on the Hull
  cell**, not in the special-rules row.

`STAT_META` (label + title) and `STAT_ICONS` are hand-authored inline SVG. No
CDN.

### `renderWeaponRow(w, omitName, withCalc)` — 3614

Columns: **Weapon | Arc | Att | Lk | Dmg | Special** (header at 3302).

- **Arc** renders as an inline SVG glyph plus the letter code. `ARC_ICONS`
  (3397) draws the wedge; `ARC_LABELS` (3379) is the tooltip — "Broadside
  (Port & Starboard)", "Front Narrow". Narrow arcs are drawn at 30° not the
  rule's 22°, because 22° is an invisible sliver at 16px.
- **Att** appends a die glyph to a plain integer, so `6` reads as "roll 6
  dice". Not applied to `-` or `D6`.
- **Lk** appends `crit N` (Lock + 2) **only** for weapons whose rules actually
  use criticals — Penetrator, Critical-X, Crippling, Reave-X, Impel-X,
  Burnthrough-X.
- **Dmg** carries the damage type as a colour-coded letter: `1E`, `2K`, `1C`.
  Kinetic blue, Energy amber, Core red. The type is part of the damage, not a
  separate special.
- **Special** renders as chips via `renderWeaponSpecialChips`.

### `renderWeaponSpecialChips(specialStr)` — 3578

Every chip resolves to the glossary and opens a tooltip with the verbatim rule
plus its page number. Two behaviours worth copying:

- `Alt-1` renders as **`Alt`**, because the bare `Alt-1` reads like a rating
  (cf. `Reave-2`) when it is actually a choose-one group id. The tooltip
  carries the real rule.
- Overcharge folds the **High Power** rule text into its own tooltip, because
  overcharging turns the weapon into a High Power weapon and you should not
  have to go hunting.

### `lookupRuleFull(name)` — 3529 and `linkKeywords(text)` — 3566

One glossary, `data/fleet-index.json`. Parameterised keywords resolve to their
`-X` base and **substitute the value into the text**, so `Reave-2` reads "…by
2", never "…by X". Works for numeric (`Reave 2`) and word (`Calibre-H`)
suffixes.

`linkKeywords` wraps any glossary term found in *prose* in a tooltip, so rules
text is live everywhere, not just in chips. There are no dead chips anywhere in
the app.

---

## 2. Ship picker — `#modal-ship-select`

The screen Jet compares ours to. `renderShipSelectCard` at **4514**.

### The card renders, top to bottom

| | Source |
|---|---|
| Art thumbnail (`thumbUrl` → the `/art/thumb/` variant) | 4578 |
| Name + badge: **Admiral** / **Unique** / **Rare** / **Misc** | 4519–4525 |
| Type line — tonnage word, e.g. "Heavy" | 4558 |
| Cost, with the `groupMin × points` breakdown when a group is more than one | 4583 |
| **Full stat grid** | 4585 |
| **Weapon summary** — every weapon, damage-type colour chip, tooltip `name: 6A Lk3 D1 F/S` | 4530–4539 |
| **Launch capacity** — a worded chip per asset type (Fighters, Bombers, Torpedoes, Boarding Pods, Bulk Landers, Dropships, Drop Pods, Fire Ships, Mines), each with its own glyph | 3350 |
| **Bombardment** tag | 3373 |
| **Special rules** as chips, each resolving to the glossary | 4589 |
| Collection chip — **only if `settings.showCollection`** | 4568 |
| Separate `+ Add` button | 4563 |

Deliberately *not* on the card: a Launch/Drop badge by the name, because the
launch capacity indicator, the weapon summary and the loads already say it
(comment at 4526). The app removes redundancy on purpose.

### The toolbar around the grid — `renderShipSelectGrid` 4409

- **Search** (`index.html:347`) matches name, tonnage, special rules **and
  namesake** — so searching "Rusalka" or "Theseus" finds the ship by its
  mythological namesake.
- **Category tabs** — one per tonnage, plus All.
- **Sort** — Points / Name / Tonnage, with direction. Tonnage sort falls back
  to points within a category.
- **Filters** (`SHIP_FILTERS`) — Has Launch, Has Drop, Bombardment, Rare,
  Unique, Famous, Modular. AND logic.
- **In collection** filter, gated on `settings.showCollection`.
- **Results bar** appears only when filtered: "12 ships matching "cruiser" +
  rare" with a Clear button.
- **Empty state** is specific to *why* it is empty — no match for a search, no
  match for filters, or nothing in the category. Three different sentences.

Launch assets are excluded from the picker entirely (4418). Famous admirals
appear in the picker, sorted by their flagship's tonnage, and picking one adds
admiral + flagship together — with the add button disabled and the reason
quoted when one is already taken or the game size is too small (4553–4554).

---

## 3. Group detail — `renderGroupShipEntry` 4027

The equivalent of our squad row. It renders **the whole stat card inline**:

- Stat grid, using `effectiveStats` so a selected refit's `statMods` are
  already applied and the changed cells are highlighted.
- Weapon table = base weapons **plus** the weapons of the currently selected
  loadout option, so the table is the ship's *real current guns*.
- Loadout options render as **radio cards, each with its full weapon table**,
  so you compare the two guns before choosing. This replaced a dropdown.
  Cost reads `+15 pts` / `Included`.
- Launch assets table.
- Special rules as chips; Rare/Unique dropped from the chips because they are
  already the badge by the name — the keyword is never printed twice.
- Ship Rules prose block, always visible: "build-critical info, not flavour"
  (4129).
- Variants / counts-as, with art.

**This is the answer to "you hide all the things that you need."** Nothing is
behind a disclosure. The only thing gated is lore, and that has its own
setting.

---

## 4. Builder layout — `index.html:154`

Three panes on desktop, declared in markup, not conjured by JS:

```
.builder-layout
  aside.builder-sidebar     fleet info, points, alerts, admiral
  div.builder-overview      always visible
  div.builder-detail        appears when a group is selected
  aside.builder-calc        the calculator pane (cut for DZC)
```

The **sidebar** carries, in order: fleet name, faction, game-size badge, size
detail, the points bar (current / limit / remaining + a fill track), the groups
line, a colour-coded composition bar, the AP-per-turn line, legality alerts,
and the Admiral slot.

Two comments in the markup state the reasoning, and both apply to DZC:

- Alerts live on the rail "so it's always visible without scrolling the middle
  panel" (195).
- The Admiral lives on the rail; the flagship is a ship on the table and shows
  as a card in the middle (198).

On mobile the sidebar becomes a drag handle with a peek summary showing points
and groups (`sidebar-handle`, 158) — the status stays glanceable without
occupying the screen.

---

## 5. Fleet list — `index.html:123`

- Three tabs: **Your Fleets** / **Fast Play Sheets** / **Collection**.
  **Collection is a tab here, not a landing card.**
- Actions: **Import** (outline, with tooltip "Import fleet from clipboard") and
  **New Fleet** (primary).
- Sort bar: Recent / Name / Faction / Points.

---

## 6. Landing — `index.html:82`

Logo, deco divider with diamond, then a `stagger`-animated grid of four tool
cards, each `card-deco`: Fleet Builder, Mission Maker, Combat Calculator,
Faction References. One line of description each, no more:

> "Build and manage fleet rosters for all six factions."
> "Printable quick-reference sheets for all six factions."

No Collection card.

---

## 7. New Fleet modal — `index.html:293`

- Name and Description on one row, both **floating-label** fields.
- Faction picker: a 3-column grid, populated by `renderFactionPicker` (1297).
- Game Size: `size-grid`, then a **points limit** number input with
  `step="50"` — the agreed number is an input, not the top of the band.
- Footer: Cancel · **🎲 Surprise me** (`generateRandomFleet`, 1479) · Create
  Fleet.

The random-fleet generator is a real feature, not a gimmick: it builds a legal
fleet in the selected faction, or picks one.

---

## 8. Settings — `openSettings` 8025

**This is the copy to copy.** Groups: Appearance, Builder Display, Offline use,
Sync, then actions.

Every toggle is a **single-line name with the explanation in the `title`
tooltip**. There is no caption under any control:

| Toggle | Tooltip |
|---|---|
| Compact view | "Hide weapon tables and launch assets in the fleet builder for a denser overview" |
| Auto-expand lore | "Automatically show flavour text on ship cards instead of requiring a click" |
| Collection | "Show an 'in collection' chip on ship cards and an In-collection filter, using counts from the Collection tab" |

Sync note, and it is one sentence, state-dependent:

> "Syncing is on for this device."
> "Keep the same fleets on your phone and your computer."

Actions row: Export fleets · Feedback · Report a bug · What's New. The bug
button's tooltip: "Opens GitHub, where you can paste a screenshot straight into
the report."

Print options are **not** in Settings — they all live in Print Preview (8029).

Compare what was written for DZC — "Dark mode is easier at a dim table.",
"Opt in to keep two devices in step. No account, no password.", "Download the
whole app so it works with no signal." Three captions where Jet writes zero.

---

## 9. Defaults

| Setting | Default | Where |
|---|---|---|
| `showCollection` | **off** | gates the card chip (4568) and the filter (4469) |
| `showAdditionalShips` (Misc) | **off** | 4441 |
| `compactView` | off | |
| `autoExpandLore` | off | |
| theme | light | applied pre-paint in `<head>` |
| Service worker | production only | unregistered + caches purged on localhost |

---

## 10. Copy rules, derived from the source

1. **No caption under a control.** The name plus a `title` tooltip. Every time.
2. **Never print the same keyword twice on one card** — Rare/Unique are the
   badge, so they are stripped from the rule chips (4110).
3. **Never render an empty stat.** Undefined and zero produce no cell.
4. **Empty states name the cause**, and differ by cause.
5. **A disabled control quotes its reason** — "One named admiral per fleet",
   "Requires Battle+".
6. **Tooltips carry the verbatim rule and its page number.** No paraphrase.
7. Sentence case throughout. The Fluent reference is explicit: "Sentence case
   always", against "ALL CAPS — difficult to read at any size"
   (`fluent2-reference.html:455`).

---

## 11. Walkthrough — building a 1500pt UCM fleet

Driven in the real app. These are the things reading the source does not tell
you.

### First run is never empty

The app seeds **six Fast Play fleets**, one per faction
(`seedFastplayFleetsIfFirstRun`, 1880), each with real ships and art. You never
meet a blank screen. The fleet grid ends with a dashed **Create New Fleet**
tile, so the empty-state affordance is part of the grid rather than a separate
screen.

Each fleet card carries: faction chip with icon and faction colour, name, big
points number, `/ 1000 pts`, `Skirmish, 6 groups`, a points fill bar, **art
thumbnails of the actual ships** with a `+1` overflow, a relative timestamp,
and a `⋮` menu.

### Creating a fleet drops you straight into the builder

`createFleet` (1436) ends with `navigate('builder', fleet.id)`. You do not go
back to the grid.

> During the walkthrough it *did* land back on the fleet list — the fleet was
> created but the builder never opened. The code says it should, so that is a
> bug, most likely `showView` bouncing while `ensureFactionLoaded` is still
> resolving. Worth chasing in Dropfleet; do not copy the observed behaviour.

### The empty builder shows no alerts at all

This is the direct answer to our screen. A fresh 1500pt fleet with zero groups
shows:

- a green tick and **"1500 pts left"**
- an "Add fleet notes" field
- `Battle Groups (0)` with an Add Group button and a large dashed drop target
- Space Station, explicitly labelled **"(Optional)"**
- Secondary Objectives with a `Choose 2 ›` button

**No red banners. No "you have no admiral".** Nothing nags before you have had
a chance to act.

### Alerts live in the rail, and they advance

Once a group exists, a red panel appears **in the left rail** headed
**"2 issues to fix"**:

> Light points (60) can't exceed Medium + Heavy points (0) (rulebook 4.2)
> Fleet must contain an Admiral

Three properties worth copying exactly:

1. They are in the rail, so they never push content down or move as you work.
2. Each states the **arithmetic** and cites the rulebook section in Jet's
   phrasing — "(rulebook 4.2)", not a `4.2` chip.
3. **They resolve and are replaced by the next real blocker.** Adding the
   admiral changed the panel to "1 issue to fix" and swapped that line for
   "Captain is not assigned to a Capital ship". It is a live worklist, not a
   static checklist.

The header status icon tracks the same state: green tick at zero, amber
warning once there is something to fix.

### The picker stays open after you add

Adding does not dismiss the modal. A toast appears:

> Added group: Toulon Frigate, pick another, or close when done

and the card you added takes a blue border. You are expected to add several in
one visit.

Category tabs carry **counts** — `All Ships`, `Light (26)`, `Medium (27)`,
`Heavy (20)`, `Colossal (3)` — and a results bar appears once filtered:
`20 ships  Clear ×`.

### Clicking the card body opens the full stat card

Confirmed live. It opens a modal with big art, tonnage, points, the stat grid,
the **full weapon table** (arc glyph, `8🎲`, `3+` with `crit 5+` beneath, `1E`
colour-coded, special chips: Bloom-1, Burnthrough-1, Flash-1, Focused), the
Special Rules in full prose, a **Lore / Namesake** paragraph — and a second
**"+ Add to fleet"** button.

So there are two add paths and neither is an accident: `+ Add` on the card for
speed, `+ Add to fleet` in the stat card for when you needed to look first.

### The overview groups by tonnage

Sections with a coloured left spine, a heading and a subtotal:

> **Heavy** — 4 groups, 725 pts
> **Medium** — 2 groups, 290 pts

Each row: drag grip ("Drag to reorder Perth Battlecruiser within its weight
class"), art thumbnail, name, tonnage chip, ship count, points, duplicate and
remove. **Category chips are colour-coded** — Medium green, Heavy amber.

### Detail pane

Title with a rename pencil, group-size chip, colour-coded tonnage chip, points
chip, a Remove button, and a `− ×2 +` stepper. Then large art with a
**"Standard sculpt"** label and carousel arrows, plus an *Alternate sculpt:
Athens (TTCombat)* link out to the store. Then stats, then the weapon table,
then each weapon rule expanded inline with its page:

> **Critical-1** *p.38*
> Each of this Weapon's criticals increases the damage of that hit by 1.

Lore sits behind a `+ Lore` disclosure. **Lore is the only thing that is ever
collapsed.**

### Admiral flow

`Choose Admiral` — one caption line: *"Place a generic admiral on any Capital
ship, or pick a famous one who brings their own ship."*

- **Generic Admiral**: Level 2 (20 pts), Level 3 (40 pts), each with **rank
  insignia chevrons** (`js/rank-insignia.js`) and an Add button. Levels
  offered are filtered by game size — Clash shows 1-3, matching the rail.
- **Faction Admirals**: Captain (Level 1, 25 pts), Rear Admiral (Level 3, 65
  pts) … each listing **every ability in full rules text before you pick**,
  with its AP cost, plus "+ choose 1 from the Abilities Table".

The ability picker is its own modal: **"Captain, choose 1 ability"**, a live
counter reading **"1 pick remaining"** that becomes **"All picks made"**, a
two-column grid of checkbox cards each with an AP chip, and — importantly —
glossary keywords are **live links inside the ability prose** (`Aegis-1`,
`Bombardment` are tappable mid-sentence). Selected cards take a gold border.

The rail's Admiral card then shows: name, level, cost, Faction/Generic, an
**Aboard** dropdown listing only the Capital ships actually in the fleet,
Innate Ability with its AP cost, and `Chosen Abilities 1/1`. An **AP/turn**
line appears in the rail once an admiral exists (`3 AP/turn`).

### Details worth stealing

- Points limit input has placeholder **`∞`** and a sibling button **"Reset to
  Clash default (2000)"**.
- **Every control has a real accessible label**: "Add a battle group",
  "Click to rename battlegroup", "Duplicate Perth Battlecruiser", "Remove one",
  "Add one more", "Damage odds, open in the Combat Calculator", "Find Osaka
  Light Cruiser on the TTCombat store". We have none of this.
- The Send Feedback mailto is a **pre-filled four-question survey**: what were
  you trying to do and could you finish it; did anything look wrong (a points
  cost, a stat, a rule); what would make you use it for your next game; how
  long have you played.
- Ship art degrades silently — a missing image leaves the card layout intact,
  no broken icon, no gap.

### Second pass — Bioficers, 4000pt Reconquest

Run because the first pass stopped early and skipped states. What the bigger
list and a different faction exposed:

**Categories are data-driven.** Bioficers get a sixth tab UCM does not have:
`All Ships · Light (24) · Medium (21) · Heavy (15) · Colossal (3) · Payload (7)`.
Payload units print `Group: -` — no group size, rendered as a dash rather than
hidden or broken.

**A third capability row.** Alongside LAUNCHES there is **BOMBARDMENT**, with
its own chip ("Orbital bombardment"). Ships can show none, one or both, and
launch chips differ per asset type with distinct glyphs — Bulk Landers, Drop
Pods, Boarding Pods, Fighters, Bombers all draw differently on the same card.

**Reinforced Armour is a chip on the Hull cell**, confirmed visually on every
Colossal. It is an armour rule, so it lives on the armour stat, not in the
rules row.

**Search does not index weapon names.** "decon" returns 0 ships even though
*Decon Burst* and *Decon Slayer* are weapons in the faction. Ours does index
them — that is one place we are ahead, so do not "fix" it by copying.

**Filter chrome.** An active filter pill takes a gold check and gold border.
Two filters AND together and the results bar names both:
`4 ships matching drop, bombardment  Clear ×`. Tonnage sort orders by category
then by points inside it.

#### Two alert severities, not one

The rail carries **two separate panels**:

| Panel | Meaning |
|---|---|
| **"N issues to fix"** (red) | the list is illegal — ratios, no admiral, unassigned admiral |
| **"N notes"** (neutral) | choices you have not finished — "Zodiac Dreadnought: choose 1 from Secondary Hardpoint (has 0)", "Ascendant: choose 2 Abilities (0/2)" |

An unfinished choice is not an error. We collapse both into one red banner.

Both are live: picking the Ascendant's two abilities took the panel from
**5 notes → 4**, and selecting a hardpoint took it **4 → 3**.

#### The modular hardpoint picker — the pattern DZC variants need

On a Colossal, the detail pane carries a **Dreadnought Systems** block with an
overall counter `0 / 3-4` and sub-sections that each carry their own:

```
SECONDARY HARDPOINT                    0/1
  Grand Bisector   FN 5◉ 3+ crit5+ 3E   Bloom-2, Calibre-E/C, Crippling, …  [+15]
  Giga Winnower    F/S 15◉ 3+ 1E        Calibre-L, Close Action, Fusillade-5 [+10]
  Gravitic Hyperlance F/S 6◉ 3+ 2C      Arrest-2, Bloom-3                    [+20]
TERTIARY HARDPOINT                     0/2
LAUNCH HARDPOINT                       0/0-1
  Torpedo  [− 0 +20]  + its own launch-asset statblock
```

**Every option is its full weapon row, and its price is the button.**
You never pick a name and hope.

Selecting one updated six things in a single click: the row highlighted and
gained a stepper, `0/1 → 1/1`, `0/3-4 → 1/3-4`, **the two rival options greyed
out because the category was full**, the group went 445 → 460 pts, the fleet
1485 → 1500, and the rail went 4 notes → 3.

That is "enforce, don't validate" working. The illegal choice was made
unclickable at the moment it became illegal.

#### Famous admirals

Adding the **Ascendant** (gold ADMIRAL badge, type line "Zenith Dreadnought ·
Colossal", button reads **+ Add Admiral**) immediately opened
*"Ascendant, choose 2 abilities"*.

Its flagship then appears in the overview as a third row with **no stepper and
no points** — `Zenith Dreadnought · flies with Ascendant · incl.` The ship is
on the table but costed into the admiral.

The rail's admiral card carries: portrait, name, level, cost, "Famous", a green
**Flagship** chip, **Innate Ability** with AP, **Chosen Abilities 2/2** listed
with their AP, an **Edit abilities ›** link, **Remove**, and
**+ Add Another Admiral**. More than one admiral is supported.

#### Launch Assets are a second statblock type

Colossals render a whole separate table — `Launch | Load | Range | Thrust |
Att | Lock | Dmg | Special` — e.g. `5 Fighters 6" 16" … Close Protection
(re-roll 1)`, `5 Bombers 6" 13" 3 4+ 1x`, `1 Boarding Pods 3"`. DZC transport
capacity will need the same treatment: its own table, not a chip.

#### Still a bug: create does not open the builder

Reproduced twice, both factions. `createFleet` ends with
`navigate('builder', fleet.id)` but you land back on the fleet grid. Jet's
expectation ("it pops you in right away") matches the code, not the behaviour.

### To re-run this

```sh
cd "D:/wargaming/Web Apps/Dropfleet-Builder" && python -m http.server 8901
```

Then set `localStorage.dfc_force_desktop = '1'` before loading `/index.html`,
or the phone redirect sends you to `/mobile/` — which is the *other* build.
Note `window.innerWidth` reported **0** in the preview pane, so the redirect
fires even at desktop width. Do not trust the instrument (HANDOFF §6).

---

## 12. The gap, stated plainly

| | Dropfleet | DZC today |
|---|---|---|
| Picker card | art, stats, every weapon with arc glyphs, launch chips, rule chips, cost breakdown | name + `category · type · price · squad size` |
| Add interaction | card opens profile, separate `+ Add` button | the whole row is an add button |
| Squad row in a group | full inline stat card | name, stepper, points |
| Loadout choice | radio cards showing both weapon tables | dropdown |
| Search | name, tonnage, rules, namesake | name + variant + weapon |
| Filters | 7 filters, AND logic, results bar, 3 empty states | none |
| Sort | points / name / tonnage, reversible | none |
| Rule keywords | live tooltips in chips *and* in prose | glossary exists, not wired to chips |
| Collection | opt-in, off by default, a tab | always on, a landing card |
| Alerts | in the rail, resolve and advance, silent until actionable | full-width banners, fire on an empty list |
| Empty fleet | green tick, "1500 pts left", no alerts | two red/amber banners |
| Layout | three panes, rail persists | one scrolling column |
| Groups list | sectioned by tonnage, coloured spines, subtotals | flat |
| Adding | picker stays open, toast, blue border on what you added | modal closes |
| Commander | rank insignia, abilities in full, pick counter, Aboard dropdown | a level in a `— none —` select |
| Accessible labels | on every control | none |
| Fleet cards | faction chip, points bar, ship thumbnails, timestamp | text |
| First run | six seeded Fast Play fleets | empty |

Every row of that table is a task in Todoist.
