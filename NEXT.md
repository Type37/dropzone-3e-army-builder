# Next

Rewritten 2026-08-08, re-checked 2026-08-16. Everything described as done is
committed and pushed to `master`. Suite: 1680 assertions, layout harness
126/126.

Read `CLAUDE.md` first, then `FAILINGS.md`. This file is only the open work,
and it is only worth having if it is true — the version before this one listed
three things that had already shipped, which is worse than listing nothing.

---

## 1. Decisions only Jet can make

**None of these is a bug. Every one changes what gets built, so none should be
guessed.** The last two are settled and kept here as answers, not questions.

### The Squad card is still too tall

Called too tall twice, and nobody has re-judged it since the Variant blocks
landed. A 4-Variant Unit now draws four weapon blocks, three of which you
usually do not own — see any UCM Main Battle Tank.

The obvious lever is **collapsing untaken Variants to their header**, and it is
not being pulled without a word from Jet, because the global rule in
`~/.claude/CLAUDE.md` is absolute: *never* `display: none` on gameplay text. A
Variant's weapon table is gameplay text. Collapsing it is a deliberate
exception to a rule that has none, so it is Jet's call and not mine.

If it is still too tall, the useful answer is a **target** — "a 3-model Squad
fits in 200px" — rather than another round of trimming px and guessing.

### What control the big Squads get

Open in Todoist: the ranges too wide for a size tab switcher (3–6, 3–9, 4–8,
6–12). That task carries the unit lists and three options.

### Whether an Aux Gate may be taken loaded

Added 2026-08-16, out of the rules sweep. "Aux Gate" says these "use the same
rules as Gates except they are taken as non-Gate Squads"; the Gate rule says a
Gate is "not taken with any Units aboard". Whether the exception covers that
sentence decides whether a Firedrake, a Tegu and an Adamah may be loaded on the
list. The app allows it today. Nothing in the app should decide this by
guessing which reading is nicer.

### Whether a Transport Behemoth's cargo becomes a real Group

Its rule is enforced in the ALLOWANCE as of build 455 — an Explorator with a
Squad aboard costs five Groups, not four — but the Squads are still drawn
inside the Behemoth's Group on screen and on the sheet, because `carriedBy` is
what draws the nesting tree. Splitting them into a second Group is a change to
how a Group is modelled, not a fix.

### Whether assignTransport should grow a Squad to fill its ride

Jet, 2026-08-15: **"No automatic."** Left here as the answer rather than the
question, so nobody re-opens it. The picker offers Transports that report "not
full" at the Squad's default size; 68 of those come good by growing the Squad
and 33 need a second Squad to share the ride (3.2.4.1), which the app supports.
Both are the error firing correctly at an unfinished Group.

### Small and mechanical, not a decision

- **The dead `/mobile/` branch.** `sw.js` and `js/offline-sync.js` both test
  `location.pathname.includes('/mobile/')` for a sub-app Dropfleet has and this
  app does not — one responsive build is the whole point. Two lines, but they
  are service-worker lines, so they come out together and get tested rather
  than tidied in passing.

---

## 2. Everything else that was in this file has shipped

- **Two starter lists** — `js/dzc-starters.js`, transcribed off TTCombat's own
  Starter Army Group Composition cards rather than worked out from the sprue.
  Nine UCM Groups, six Bioficer. Both come back clean from `validate`. Seeded
  once, so deleting one deletes it.
- **Variant-restricted special rules** — `5937b1a`, `9dde97d`. Parsed in
  `scan_statcards.py` into `specialVariants`, rendered on the Variant in the
  builder, the Unit Reference and the printed sheet.
- **The no-jump fix** — verified 2026-08-08, see below.

### The 2026-08-15 player report, and the sweep it started

Three things from a player, then eight builds of chasing what else was claimed
in the PDFs and not done in the app. All on `master`.

| Build | What was wrong |
|---|---|
| 452 | Seven units had NO rules: a Special cell that wrapped was read on one line. Siren Corps, Type-3 Strike Walker, ATVs, Evicerators, Assault Warsuits, both Shaltari Grav-tanks. Shaltari could not take a Gate at all. Print produced one blank page in every browser — `css/app.css` hid the sheet in favour of `#print-container`, Dropfleet's id, never ported |
| 453 | The 4-Squad cap counted Transport Squads, which 3.2.4.1 exempts, so the rulebook's own Group 5 was refused and the Albatross reported "not full" for good. Flexible Capacity was unimplemented |
| 454 | Subterranean unimplemented: the Splitting Drills spent a Group they do not cost and took cargo they may not be taken with. An Auxiliary Transport was told it must be full |
| 455 | A Transport Behemoth's cargo rode free of the Group allowance |
| 456 | Behemoth Gear lost its Variant bracket and one Gear name was cut off, so both Grand Walkers offered each Variant the other's Power-priced gear |
| 457 | The Harrier Gunship's card option, the one swap in the game that grants no weapon and so had no control |
| 458 | Errata 3.01 checked against the sources — already applied — and the Field rule it amended was printing the same paragraph twice |
| 459 | Chapter 11 is two-column and was read right-column-first, so **Blast** shipped ending mid-sentence and three Behemoth rules ended with the next chapter's title |

Four audits now stand behind that: `audit_special` and `audit_card_text` open
the PDFs and prove every word printed on a card reached the data, and two
glossary checks in `test-dzc-data.mjs` prove no rule is cut off, swallows a
chapter title, or says the same sentence twice.

---

## 3. The no-jump fix is verified

It was recorded here as unverifiable: an iframe sizes to its content, so the
harness had no scrollbar to move. That was true of an *iframe* and not of the
problem. `scripts/shots.mjs` drives a real Chrome window at a real viewport
size, and `SHOT_REPORT` reads a value back out of it.

Pressing + at three scroll positions on a scrollable army (page 2616px,
viewport 700px) moved the page **0px, 0px and 1px**, and the button stayed
under the pointer to within the same 1px. Focus returns to the control that
was pressed — proven separately, because a programmatic `.click()` on an
element that was never focused leaves `activeElement` on BODY.

Two traps if this is ever re-measured:

- **`btn.focus()` scrolls an off-screen element into view.** Focusing one
  400px down the page still moved it 39px. That is the harness moving the
  page, not the app. Click without focusing, or only pick a button already on
  screen.
- **Pick an on-screen button.** Clicking one far above the fold reports a
  jump that is really the content above the viewport growing.

---

## 4. How to check anything here

```sh
node scripts/test-all.mjs
```

```sh
python -m http.server 8899
```

Then `http://localhost:8899/tools/dzc/layout-check.html?url=../../index.html`.
126 checks — 6 routes and 12 overlays at 7 widths each — for content off the
edge, text cut with an ellipsis, and text squeezed out of its own box. It
asserts `instrumentOk` first: **if the instrument disagrees with what you
asked for, stop.**

One of those 12 is the **Group drilled into**, added 2026-08-08. It is the
screen a phone actually uses and this tool had never opened one; a horizontal
overflow lived in it while the harness reported 119/119.

To look at something no walk sets up, and without needing the browser pane to
composite a frame:

```sh
SHOT_W=900 SHOT_H=700 SHOT_NAME=x SHOT_CLIP='.dzc-squad' SHOT_STEP='<js>' node scripts/shots.mjs http://127.0.0.1:8899/index.html out custom
```

`SHOT_REPORT='<expr>'` prints a value out of the page alongside the shot.

---

## 5. The Todoist backlog is mostly stale

`#dropzone3` in *Generators & Web Apps*. Most of what is left is the 131-gap
list from 2026-07-31 and much of that shipped months of commits ago. **Do not
work down it top to bottom.** Read it for a specific question, and check the
code before believing any single item.
