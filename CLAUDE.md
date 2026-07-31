# Project rules — Dropzone Commander 3E Army Builder

This file is loaded automatically every session. `HANDOFF.md` is not. If a rule
matters, it belongs here.

**Read [FAILINGS.md](FAILINGS.md) first.** It is the record of how this project
has actually been failed — five repeating patterns and the specific incidents
that produced them. The rules below exist because of it.

Five things that keep going wrong, in short: deciding for myself what "enough"
means; reporting one tool's limit as if it were the limit of what is possible;
verifying by proxy instead of looking; producing work into the chat and never
writing it to disk; and racing to a fix when told to study something.

## 1. Todoist first, always

**Before doing anything Jet asks for, create the Todoist task.** Project
*Generators & Web Apps*, label `#dropzone3`.

- The task goes in **before** the work starts. A task added afterwards is a
  status report, not tracking.
- **Claude does not close tasks.** Only Jet's satisfaction closes a task. Not
  "I think this is done." Not a passing test. If Jet has not said so, the task
  stays open.
- **Claude never deletes a task.** Not duplicates, not superseded ones, not
  ones that look obsolete. Add and read only — deleting is Jet's alone. The
  list is meant to be long.
- One instruction, one task. Do not batch three asks into one task.
- The task description records **Jet's actual words**, quoted.

The open work is Todoist, not this file and not `HANDOFF.md`. Work top-down by
priority.

## 2. Never invent what already exists

The Dropfleet Commander Fleet Builder is the source for copy, layout, defaults
and brand assets. Check it **before** building any equivalent:

- `D:\wargaming\Web Apps\Dropfleet-Builder\` — the live source
- `git show 43773fa:<path>` — this repo's fork point
- Live: type37.github.io/dropfleet-builder

If it exists there, use it. This has been the root cause of repeated rework:
the New Army dialog, the Settings copy, Collection defaults and the wordmark
were all invented from scratch when a better version was already on disk.

**Never invent logos, wordmarks or brand art.** Real files live in
`assets/logos/` and `assets/factions/`. If something is missing, ask.

## 3. Write in Jet's voice

- Default to silence over explaining. If a control needs a caption to be
  usable, the control is wrong — not the copy.
- No explainer sentences under headings, cards, or controls.
- A refusal must name the rule it is enforcing. That is the only copy that
  earns its place.
- Sentence case always. Never all-caps.
- **Interpunct (`·`): two uses in the entire app.** No more.
- **Never write "datasheet."** Not in the UI, not in code, not in a comment,
  not in a variable name, not in the docs. It is not Jet's word — it came from
  the Dropfleet source and was smuggled in from there. The app already says
  **"Stats, weapons and rules"**; where a noun is unavoidable the domain term
  is **stat card**, which is what TTCombat call the source PDFs.
- No single word or phrase appears more than twice on one screen.
- Do not write new phrasing for anything the Dropfleet builder already words.

Reference for voice and wording, not just tokens:
`D:\wargaming\Web Apps\Dropfleet-Builder\fluent2-reference.html`.

## 4. Design

- **Fluent 2** layered over the Dropfleet look. Tokens, spacing, radius,
  elevation, motion curves, z-index ladder, two-stroke focus ring.
- Keep Dropfleet's warm paper/ink palette, navy rail, gold accents.
- **Tighter spacing than Dropfleet.** Smaller cards, less padding everywhere.
- Art Deco visual language: `.gold-frame`, `.card-deco`, `.deco-divider`,
  `.deco-diamond`.
- Fonts: Terminal Grotesque Open (wordmark), Jost (body and condensed),
  Roboto Slab (display), Libre Baskerville (lore). Barlow Condensed is out.
- **Mobile first.** Every layout decision starts at phone width and grows up.
  The phone is the case that has to work — it is the one used at a table.
- **Desktop keeps panes. Mobile does not.** One responsive app, not two builds.
  On mobile a Group is a screen you drill into, not a pane beside a list —
  which is how the Dropfleet mobile build does it (`renderGroupDetail`).
- Icons: rulebook tokens where they exist, otherwise Flowbite / Streamline /
  Simple Icons / SVG Spinners via Iconify. **Always inlined, never a CDN** —
  a CDN icon breaks offline.
- **Sharp cards.** Every card surface is square — `border-radius: 0`. Picker
  cards, unit cards, army cards, rail cards, Group cards, alert panels, modal
  panels. Buttons, chips and inputs may keep a radius; a control can be soft,
  a panel may not.
- Never truncate or clip content. Never shift layout when a menu opens.

## 5. Verify in the real app

`resize_window` lies — it reports 375×812 while `window.innerWidth` stays 867.
A responsive check run against it measures the wrong viewport, and that is
exactly how a horizontal-overflow bug shipped to a real phone.

```sh
python -m http.server 8899
# http://localhost:8899/tools/dzc/layout-check.html?url=../../index.html
```

The harness asserts `instrumentOk` first. **If the instrument disagrees with
what you asked for, stop.**

A floating action button must live at `<body>` level. `.screen` carries
`will-change: transform`, which makes it a containing block for
`position: fixed` and parks a nested FAB off-screen.

## 6. Working style

- Terse, opinionated recommendations. Make the call; don't present menus.
- Bias to doing the work over asking permission.
- Edit serially, not in giant parallel batches.
- When told to stop, stop the current tool call. Don't finish it first.
- Working notes go in `NOTES.md` (gitignored), never into GitHub.
