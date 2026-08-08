# The carry line — spec and handover

Jet drew this on 2026-08-07 after five failed attempts at it. Read the whole
file before touching `css/dzc.css`. The failures were not arithmetic; four of
them were arithmetic and they were all fixed, and it was still wrong. The fifth
was wrong about **what the line is**.

## What it is

A **connector between two photographs**. It leaves the bottom of a carrier's
unit image, drops, and reaches sideways INTO the image of the thing it is
carrying — not to the edge of that card, into the picture. Each level of
nesting steps right.

That is the whole idea and it has not changed since the first sentence Jet
said about it.

## What it is NOT — this is where five attempts died

**It is not a bar down the left of the guns.** Jet, 2026-08-07, on the version
that shipped: *"what you seem to want to do is have a green line that seems to
extend along the left of the guns, like some kind of left bar. No. That's not
what I want."*

Anything that reads as a rule, a rail, a border-left, a tree guide, or an
indent bar is wrong, however precisely its endpoints land. The test is not
"does it start and stop in the right place" — a full-height rail can pass that
test and still be the wrong object. The test is **does it read as one line
joining two pictures**.

Specifically, do not:

- put it on `border-left` of anything
- run it from the top of a block to the bottom of a block
- run it the height of the cargo block, alongside the cargo's own content
- draw it in the card's outer gutter as a tree indent guide
- solve a length problem by making the line longer and quieter

## Geometry, from the drawing, in the app's real numbers

Row coordinates, x measured from the Squad row's left edge.

```
carrier row     x = 0
carrier image   x = 37 .. 142      (105 wide, 75 tall, --mini-x is 37)
cargo row       x = 52             (--rider-step)
cargo image     x = 89 .. 194      (52 + 37)
```

The two images are only 52px apart horizontally. They very nearly share a
column — the connector is a short jog, not a traverse.

**Where the vertical sits.** In the drawing the vertical runs a few pixels
LEFT OF THE CARGO'S IMAGE, not down the carrier's own left edge. Measured off
Jet's drawing: carrier image left 40, cargo image left 57, vertical at 52 —
five pixels left of the cargo, thirteen right of the carrier. In app terms
that is **x ≈ 84**, not x = 37.

This matters and it is the second thing the last attempt got wrong. At x=37
the line hugs the carrier and runs down its side, which is what makes it read
as that unit's left bar. At x=84 it sits in the cargo's own indent and reads
as something hanging off the carrier down to the cargo. Same two endpoints,
completely different object.

It still leaves the bottom of the carrier's image, because 84 is inside the
carrier's image span of 37..142.

**Where the horizontal sits.** At the vertical middle of the cargo's image,
entering about 12–22px. The drawing shows a short tick, not a long arm.

## The problem nobody has solved yet — do not paper over it

Between the carrier's image and the cargo's image sits **the carrier's own
stat table and weapon cards**. On a Raven that is 78px. On a Squad with six
Variant blocks it is about 900px.

In Jet's drawing there is nothing between one image and the next except two or
three thin stat bars. That is why his line is short and reads as a connector.
In the app the same line is 130px to 900px long, and a 900px vertical is a bar
no matter what you call it.

**Do not solve this by:**

- making the line thinner, paler, or dashed so the length stops mattering
- moving the cargo to sit under the carrier's header (Jet has vetoed this
  layout change three times — 2026-08-07, twice explicitly)
- collapsing or hiding the carrier's guns (CLAUDE.md: never hide content)
- deleting the line

If you cannot make it read as a connector at 900px, **say so and stop**. That
is a real answer. Shipping a bar and describing it as a connector is what
happened five times.

## CSS traps already discovered — you will hit these

1. **A Squad in the middle of a chain plays three parts.** A Buggy inside a
   Raven with Legionnaires inside it is cargo (needs the horizontal), a
   carrier (needs the vertical), and the last child of its block (needs
   whatever ends its parent's line). Three jobs, two pseudo-elements. Putting
   two of them on `::after` means the later rule in the file silently wins and
   one of the three never draws at all. The arm currently lives on
   `.dzc-sq-main::after` for exactly this reason.

2. **Paint order.** `::after` is generated as an element's LAST child, so a
   carrier's `::after` paints ON TOP of everything inside `.dzc-riders`. Two
   positioned boxes at `z-index: auto` paint in tree order. This is why a
   paint-out that ends a line has to carry `z-index: 1` — every number in it
   was right and it was landing underneath the line it existed to end.

3. **A rider row has 2px more padding than a top-level row.** Constants
   measured against one do not hold for the other.

4. **`--mini-x` was 27px for a long time and the row is 37.** 27 is the
   drag-handle gutter. Anything anchored there misses the picture entirely and
   looks like a margin rule — which is one of the ways this went wrong.

5. **Never use `:has()` for it.** It drew nothing on Jet's machine for a whole
   commit and no test here can see that. `squadHtml` emits `is-carrier` on any
   Squad with something aboard; hang it off that.

## How to verify — do not skip this, and do not eyeball it

The in-app browser pane serves stale frames. A correct version looked broken
for two rounds because of it. Measure AND screenshot, and if the two disagree,
believe the measurement and force a repaint.

Build a Raven Light Dropship carrying a UCM Howitzer, and a Raven carrying a
UCM Troop Buggy carrying Legionnaires (three levels). For every carrier assert,
in row coordinates:

- the vertical's x sits between the carrier's image left and the cargo's image
  left, nearer the cargo
- the vertical starts at the carrier's image BOTTOM
- the vertical ends at the horizontal, with nothing below it
- the horizontal is at the cargo image's vertical MIDDLE
- the horizontal finishes INSIDE the cargo's image, not at its edge
- no content box intersects the vertical's band

Then look at a screenshot and ask the only question that has ever mattered:
**does that read as one line joining two pictures, or as a bar down the side
of a column?** If it is the second, it is wrong, and no amount of correct
arithmetic makes it right.

## Do not bump these without saying so

`sw.js` carries `const CACHE = 'dzc-cache-vNNN'` and says at the top to bump it
on every deploy. Two commits shipped without it and Jet saw no change at all,
which cost a round of "the lines still don't work" that was not about lines.
