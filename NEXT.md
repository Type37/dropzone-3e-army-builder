# Next

Rewritten 2026-08-08. Everything described as done is committed and pushed to
`master`. Suite: 1277 assertions, layout harness 126/126.

Read `CLAUDE.md` first, then `FAILINGS.md`. This file is only the open work,
and it is only worth having if it is true — the version before this one listed
three things that had already shipped, which is worse than listing nothing.

---

## 1. Two decisions only Jet can make

**Neither is a bug. Both change what gets built, so neither should be guessed.**

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
