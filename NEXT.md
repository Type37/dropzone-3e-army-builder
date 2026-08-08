# Next

Written 2026-08-07 at the end of a long session. Everything described as done
is committed and pushed to `master`; the working tree was clean when this was
written. Suite: 1176 assertions, layout harness 119/119.

Read `CLAUDE.md` first, then `FAILINGS.md`. This file is only the open work.

---

## 1. Two starter lists, seeded for every user

Jet, 2026-08-07: *"we should wire up two starter lists that are available for
all users at the start."*

Source: the DZC 3.0 two-player starter set sprue instructions —
`https://cdn.shopify.com/s/files/1/0965/1274/files/Dropzone_Commander_3.0_Starter.pdf?v=1785486479`

**The PDF has no extractable text.** It is vector art. `page.get_text()`
returns nothing; render the pages and read them:

```python
import fitz
d = fitz.open('starter.pdf')
for i, p in enumerate(d):
    p.get_pixmap(dpi=130).save(f'st{i+1}.png')
```

### What is in the box, read off those four pages

**UCM** (pages 1–2)

| n | unit |
|---|------|
| 6 | Legionnaires |
| 2 | Praetorians |
| 3 | Sabre Main Battle Tank |
| 3 | Rapier Main Battle Tank |
| 2 | Scimitar Heavy Tank |
| 4 | Polecat A buggy |
| 2 | Polecat B buggy |
| 2 | Condor Medium Dropship |
| 1 | Vulture Troopship |
| 1 | Vulture Dropship |
| 2 | Raven Troopship |
| 1 | Raven Dropship |
| 1 | Falcon A Gunship |

**Bioficers** (pages 3–4)

| n | unit |
|---|------|
| 6 | Drones |
| 4 | Hulks |
| 4 | Tusk Main Battle Skimmer |
| 6 | Thorn Light Skimmer |
| 2 | Tangent Support Skimmer |
| 2 | Grievance Genitor Ark |
| 1 | Device Dropship |
| 2 | Data Strike Dropship |
| 3 | Digit Light Dropship |
| 1 | Silence Heavy Gunship |
| 1 | Gyro Aero-Genitor |

Names are as printed on the sheets. Resolve each to a real unit id against
`data/dzc/faction-ucm.json` and `faction-bioficer.json` before building
anything — do not assume the id is the slugified name.

### Two decisions Jet has not made yet

Both change the work, so ask before building:

1. **Is a starter list a legal army?** The box is not built to be one — six
   Legionnaires and two Praetorians against three Sabres, three Rapiers and two
   Scimitars will not satisfy the category ratio (3.2), and the whole box is
   well past a Skirmish. Either pick a subset that IS legal at a stated size,
   or list the box as it comes and let `validate` say what is wrong with it.
2. **Where do they live?** Two real armies seeded into "Your Armies" on first
   run, or a separate read-only tab you copy from? Dropfleet does the second —
   six Fast Play sheets on their own tab — and CLAUDE.md §2 says use what is
   there rather than inventing. See gaps 94 and 118 in Todoist, and
   `git show 43773fa:index.html` for the tab.

Whichever it is: every Squad needs a legal Transport under 3.2.4, and both
lists must come back clean from `DZCArmy.validate` before this ships. A seeded
army that is illegal is worse than no seeded army, because it is the first
thing a new user sees.

---

## 2. Variant-restricted special rules, in the parser

Jet, 2026-08-07: *"sort special abilities that are only on one loadout, into
that loadout. IE Scanner (Greave) means this goes only on the greave variant.
please ensure that's written into the parser, btw. and update across the
board."*

The rulebook says the same at 3.2.2: *"Special rules which only apply to
certain Variants will be indicated in brackets after the rule."*

This is a data-pipeline change, not a render tweak:

1. `tools/dzc/scan_statcards.py` — parse the parenthetical off a special rule
   and attach the variant list to it, the same shape weapons already use
   (`box: 'variant'`, `variants: [...]`). Today the whole string including
   "(Greave)" lands in `u.special` as text.
2. Re-run the scan across all six faction PDFs and the Behemoth PDF, then
   `tools/dzc/audit_*.py`, then the suite.
3. Render them inside their variant block, which is where weapons already go —
   see `variantGuns()` in `js/dzc-builder.js` and the `lens` option on
   `DZCUnits.weaponCardsHtml`. The mechanism exists; the rules just need the
   same treatment.

Do it in that order. Rendering first would mean parsing English in the browser,
which `3f7b541` already recorded as the wrong answer for capacity upgrades.

---

## 3. Still unverified

- **The no-jump fix** (`b91cfe7`). Pressing + used to move the page: the view's
  innerHTML is replaced, the document collapses for a frame and the browser
  clamps the scroll. The view's height is now pinned across the swap, the
  scroll is restored, and focus returns to the same control. **The focus half
  is proven; the scroll half is not** — an iframe sizes to its content, so the
  harness has no scrollbar to move and nothing I tried made one. It needs a
  real window. If it still jumps, the real cure is patching the changed Squad
  in place instead of rebuilding the whole view.

---

## 4. Open questions Jet raised and I have not answered

- **Squad card height.** Jet has called it too tall twice. It is much shorter
  than it was — the transport tripling, the duplicate upgrade table and half
  the dividers are gone — but nobody has re-judged it since. If it is still too
  tall, ask for a target ("a 3-model Squad should fit in 200px") and cut until
  it hits, rather than trimming a few px at a time and guessing.
- **Collapsing untaken Variants.** A three-Variant Unit now draws three weapon
  blocks, which is what was asked for and is inherently taller than one merged
  list. Collapsing the ones you have not taken to their header is the obvious
  next move if it is too much.

---

## 5. The Todoist backlog is mostly stale

`#dropzone3` in *Generators & Web Apps*, 200+ items. 68 were closed on
2026-08-07 as genuinely done. Most of what is left is the 131-gap list from
2026-07-31 and much of that shipped months of commits ago — the picker gaps
24–33, the print and share gaps, the Settings gaps. **Do not work down it
top to bottom.** Read it for a specific question, and check the code before
believing any single item.

One task added that day is real and still open:
*"DECIDE: what control the big Squads get (3–6, 3–9, 4–8, 6–12)"* — the ranges
too wide for the size tab switcher. It carries the unit lists and three
options.

---

## How to check anything here

```sh
node scripts/test-all.mjs
```

```sh
python -m http.server 8899
```

Then `http://localhost:8899/tools/dzc/layout-check.html?url=../../index.html`.
It measures 6 routes and 11 modals at 7 widths each — 119 checks — for content
off the edge, text cut with an ellipsis, and text squeezed out of its own box.
It asserts `instrumentOk` first: **if the instrument disagrees with what you
asked for, stop.**
