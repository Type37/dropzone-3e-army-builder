# Icons — for review

Everything lives in `js/dzc-icons.js` as an inline path map, used as
`DZCIcon('add')`.

**Inlined on purpose.** An icon font or SVG sprite from a CDN would break the
app at a table with no signal, which is the one place it has to work. This
follows the pattern already used by `mobile/js/mobile.js` (`ICON_PATHS`), and
HANDOFF §2.6 ("Inline them — never load from a CDN, it breaks offline").

**Sources, per icon.** Every path says where it came from on its own line in
`js/dzc-icons.js`. The mix:

| Source | Licence | Icons |
|---|---|---|
| Material Symbols, 24×24 | Apache 2.0 | 22, the UI set: add, remove, close, edit, delete, search, arrow_back, content_copy, more_vert, print, share, error, warning, check_circle, info, lock, layers, link, local_shipping, calculate, groups, deployed_code, tune |
| Phosphor | MIT | stat_mv_infantry, stat_b, stat_dp, stat_power, stat_df, grid_view, list_alt |
| Supplied for this app, own grids | — | stat_mv (512), stat_a (512), stat_of (640), settings (26), rm (512), dice (32), drag_dots, military_tech |

Attribution is in the Settings dialog, under About, and in `js/dzc-icons.js`.

**Three of these used to be typed by hand and were replaced on 2026-08-11.**
stat_dp was `M12 2 21 7v10l-9 5-9-5V7l9-5z`, a seven-point polygon; stat_power
was a bolt in eight integer moves; stat_df was a shield outline whose numbers
(5.5, 5.9, 10.6, 8.5) match no icon set, drawn by eye. A fourth, grid_view,
was four bare rectangles. None had a single curve command in it. The file
header claimed "the six stat_* paths are NOT Material, they are drawn for this
app", which covered for exactly the three that were the problem and named
none of them, so provenance is now per icon rather than one blanket sentence.

---

## In use

| Name | Where | Why this one |
|---|---|---|
| `add` | Add Group, Add Squad | — |
| `remove` | model stepper, minus | pairs with `add` |
| `close` | modal close, remove Squad/Group | — |
| `edit` | rename army / group | — |
| `delete` | delete army | distinct from `close` so "remove from list" and "destroy" don't look alike |
| `search` | pickers | — |
| `arrow_back` | topbar back | — |
| `content_copy` | duplicate army | not wired yet |
| `print` | print sheet | not wired yet |
| `share` | share link | not wired yet |
| `settings` | topbar | matches the existing cog |
| `error` | blocked action, illegal state | — |
| `warning` | advisory (starts Reserved, transport-only Group) | — |
| `check_circle` | army is legal | — |
| `info` | rule explanation | — |
| `lock` | an option disabled by a rule | reads as "the rules forbid this", not "broken" |
| `layers` | **Group** | a Group is things that activate together — a stack, not a folder |
| `link` | **Linked transport**, on a Squad | two links of a chain: the button is the tie between this Squad and a Transport, not a Transport, so it must not be a second lorry |
| `local_shipping` | **Transport** | — |
| `military_tech` | **Commander** | a medal reads as rank |
| `list_alt` | army roster | — |
| `calculate` | points | — |
| `tune` | picker sort and filter, phone only | sliders at their own stops, which is what a sort plus a set of filters is; a funnel says things thrown away |

## Stat icons — drawn here, not Material

Geometric rather than pictorial, following the language already set in the
Dropfleet builder (arrow for movement, hexagon for the damage track). Reached
via `DZCIcon.stat('Mv')`.

| Stat | Shape | Source | Why |
|---|---|---|---|
| Move | route between two nodes | supplied, 512 | same idea as Dropfleet's Thrust |
| Move (infantry) | sneaker | Phosphor | infantry walk, so not a route |
| Armour | plate over a ribcage | supplied, 512 | a UI shield said security, not armour |
| Damage Points | outline hexagon | Phosphor | the Hull analogue, and Hull is a hexagon there |
| Offence | soldier firing | supplied, 640 | |
| Defence | outline shield | Phosphor | pairs with Armour at a lighter weight, so the two read as one idea |
| Bravery | banner | Phosphor | |
| Power | bolt | Phosphor | spent and replenished, not compared |

Worth a second opinion: **Damage Points is the weak pick.** It is a real
Phosphor hexagon rather than a typed one, and it keeps the cross-app language
with Dropfleet's Hull, but a hexagon says "damage track" only to somebody who
already knows Dropfleet. If chapter 12's token legend has a damage marker
worth lifting, it would beat this.

## Decisions I made, worth a second opinion

- **`layers` for a Group.** Considered `folder` and `grid_view`. A Group is the
  activation unit, not a container of files, and `layers` carries "these act as
  one" better. Weakest pick of the set — say if you want something else.
- **`military_tech` for a Commander.** The Material glyph is a medal. Reads as
  rank, but is quite ornate at 16px. A rulebook rank pip would be better if the
  book has one worth lifting.
- **`lock` vs `error` for a blocked option.** Used `lock` where the rules forbid
  something and `error` where the user's army is currently illegal. The
  distinction matters: one is "you can't", the other is "you have".
- **No icon for a faction.** The six faction logos exist in the source PDFs as
  watermarks. Not extracted — likely wanted as proper art rather than a scrape.

## Wanted, not yet found

Rulebook-native game tokens would beat Material for these, per your note that
game tokens can come from the rulebook:

- the six **transport symbols** — currently drawn as inline SVG geometry in
  `js/dzc-units.js` (`SYMBOL`), in the cards' own colours. These are correct and
  probably want keeping over any icon set.
- **Status tokens** (Concussed, Jammed, Suppressed, Shield, Excellent Vantage).
  Rulebook chapter 12 is an icon legend for exactly these — it is scannable the
  same way the stat cards were, if you want them properly.
- **Arc icons** (Front / Side Left / Side Right / Rear). DZC arcs are 90°
  wedges (rulebook 6.1.2), so the Dropfleet arc icons do NOT carry over and
  these need drawing.
