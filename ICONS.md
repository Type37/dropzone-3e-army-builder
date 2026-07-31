# Icons — for review

Everything lives in `js/dzc-icons.js` as an inline path map, used as
`DZCIcon('add')`.

**Inlined on purpose.** An icon font or SVG sprite from a CDN would break the
app at a table with no signal, which is the one place it has to work. This
follows the pattern already used by `mobile/js/mobile.js` (`ICON_PATHS`), and
HANDOFF §2.6 ("Inline them — never load from a CDN, it breaks offline").

**Source:** Material Symbols / Material Icons, 24×24 viewBox, Apache 2.0.
Attribution is in the Settings dialog, under About, and in `js/dzc-icons.js`.

**Except the six stat icons**, which are drawn for this app and owe nobody
anything — see the stats table below.

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
| `local_shipping` | **Transport** | — |
| `military_tech` | **Commander** | a medal reads as rank |
| `list_alt` | army roster | — |
| `calculate` | points | — |

## Stat icons — drawn here, not Material

Geometric rather than pictorial, following the language already set in the
Dropfleet builder (arrow for movement, hexagon for the damage track). Reached
via `DZCIcon.stat('Mv')`.

| Stat | Shape | Why |
|---|---|---|
| Move | arrow | same idea as Dropfleet's Thrust |
| Armour | solid shield | |
| Damage Points | hexagon | the Hull analogue, and Hull is a hexagon there |
| Offence | solid triangle | a blade, pointing out |
| Defence | outline shield | pairs with Armour at a lighter weight, so the two read as one idea |
| Bravery | star | |

Worth a second opinion: **Offence and Bravery are the weak picks.** A triangle
is generic, and a star is a rating idiom more than a nerve one. If chapter 12's
token legend has anything better, lift it.

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
