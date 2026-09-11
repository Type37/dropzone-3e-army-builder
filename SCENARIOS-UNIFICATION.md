# Unifying the scenario tools — Dropzone and Dropfleet

## Status, 2026-09-11 (supersedes the "Open" list below)

- **Both tools live on type37.github.io.** Dropfleet: scenario reference at
  `/dropfleet-builder/scenarios/dropfleet/` (every published scenario, browse),
  generator at `.../generator/` (roll). The Neocities Mission Maker redirects to
  the generator. Dropzone: `/dropzone-3e-army-builder/scenarios/`.
- **Shared code lives in the Dropfleet repo** at `scenarios/shared/`:
  `shell.js` + `shell.css` (header with the Dropfleet/Dropzone switch, grouped
  index with search, Random and fact columns, scenario bar with round/VP
  tracker, share, print) and `tooltip.js` (hover/tap/focus stats). Each page
  calls `ScenarioShell.start(game)` with its own scenarios, columns and card
  renderer. Dropzone copies the three files in with
  `tools/dzc/sync_scenario_shell.py`; edit them on the Dropfleet side.
- **Dropfleet has browse mode after all**: 35 published scenarios with maps,
  verbatim explanations and hover stats on the map symbols.
- **Dropzone page, first cut:** the sixteen scenarios from `data/dzc/scenarios.json`,
  each with objectives, entry, colour-keyed map key and variants, read from the
  legend as printed, beside the extracted map. Index columns: Objectives, Entry.
- **Next on the Dropzone side:** redraw the maps as SVG (settled below), explain
  each objective and feature from `data/dzc/rules-wiki.json`, hover stats on map
  symbols, and a roller.

Handoff note. Written from the Dropzone side on 2026-09-09 for whoever picks
this up in `D:\wargaming\Web Apps\Dropfleet-Builder`. Read it end to end before
touching either repo.

Jet's ask, in his words: two URLs, an easy button to switch between them, and a
button back to the rest of the tools. Same backend and layout, both using
extracted images to explain things.

## What already exists

**Dropfleet — `scenarios/dropfleet/index.html`.** A complete Dropfleet 2e
scenario generator. One self-contained 100KB HTML file, staged but not yet
committed at the time of writing. Deployed to
`jetwong.neocities.org/wargaming/dropfleet-commander/dropfleet-mission-maker`,
which is outside the builder's own origin.

It rolls a scenario rather than looking one up. Six flat d6 tables, each an
array of six entries:

| const | what it rolls |
| --- | --- |
| `DT` | Deployment type — Line, Table Corners, Midboard, From Corners, Attacker & Defender, Encirclement |
| `AT` | Arrival type, mapping Red and Blue to a mode in `DM` |
| `LY` | Layout — which scenery, how much |
| `VA` | Variant |
| `OB` | Objective |
| `DS` / `FS` | Dropsite stat rows and their Features |

`roll(t, c)` picks with `r6()`. Entries carry `nc: true` when they are out in
competitive play, and the competitive checkbox makes `roll` reroll them, capped
at 30 attempts.

The map is inline SVG, built by `makeMap(depRoll, layoutName, players,
variantRoll)` on a 200×200 viewBox. `depZone()` paints deployment zones as
colour-coded dashed fills. Scenery is drawn by small named builders —
`mkLC`/`mkMC`/`mkSC` for city sizes, `mkStn`, `mkRing`, `mkLO`, and `mkDim` for
dimension arrows. Feature and dropsite icons are inline SVG in `FI` and `DI`.

Print is `window.print()` against print CSS. PNG export is `savePNG()` via
dom-to-image.

**Dropzone — `data/dzc/scenarios.json` and `assets/scenarios/`.** Committed in
`fa37f6f`. Sixteen scenarios: twelve from rulebook pages 38–43 and four from
the Fauna pack. Each carries its map at native size — 401px from the rulebook,
1201px from the Fauna pack — and its legend read out of the PDF as data, every
entry tagged with the colour the rules name it by, so a page can say "the two
red Medium Zones" in words. `tools/dzc/extract_scenarios.py` regenerates both.

`assets/tokens/` holds all 28 rulebook tokens, cut from page 51 in Build 462.
Every feature the twelve rulebook scenarios key — the four turret types, ACM
Package, Shield Generator, Comms Uplink, Excellent Vantage, Power Core, Seal,
Internal Flaw, Automated Sentries, Bunker Entrance, Object, Secure Point — is
already there. The Fauna Hive marker is the only one missing, and it is vector
in the source rather than raster.

## The shape of the problem

The two games want different front doors.

Dropfleet **rolls**. There is no canonical list of Dropfleet scenarios to
browse; a scenario is what six dice hand you, and the generator is the whole
product.

Dropzone **browses**. There are sixteen named, printed scenarios with fixed
maps and fixed objectives. Jet wants each one reachable directly and printable
on one page, *and* a roller for when you want the dice to choose.

So the shared engine needs both modes, and Dropzone is the one that needs the
extra one. Do not build browse as a special case of roll.

## What is genuinely shared

- Page shell, two-column layout, the card, print CSS
- The roller and its spin animation
- SVG map primitives: viewBox, table border, grid, dimension arrows, the
  coloured dashed deployment-zone treatment
- Inline-SVG glyph rendering, and the convention that every glyph on a map is
  named and explained in the legend beside it
- The competitive filter — Dropzone's equivalent is the "Only use in Clash,
  Battle & Reconquest" line most scenarios carry, plus a Fauna on/off checkbox
- Print and PNG export

## What has to change on the way in

Four things in the Dropfleet generator break Dropzone's rules. They are not
style preferences; they are in `CLAUDE.md` on the Dropzone side.

1. **Barlow Condensed is out.** Dropzone uses Terminal Grotesque Open for the
   wordmark, Jost for body and condensed, Roboto Slab for display, Libre
   Baskerville for lore.
2. **No CDN, ever.** The generator pulls dom-to-image from cdnjs and its fonts
   from Google Fonts. A CDN dependency breaks the app offline, which is the
   case this whole tool exists for — you are at a table, on a phone, maybe on
   bad wifi. Inline it or drop the feature.
3. **Sharp cards.** Every panel surface is `border-radius: 0` on the Dropzone
   side. Buttons, chips and inputs may keep a radius.
4. **Mobile first, and no clipping.** Every layout decision starts at phone
   width. Nothing may be truncated or hidden, and nothing may shift when a
   control opens.

Also worth deciding early rather than late: the generator currently lives on
neocities, and both builders share an origin in production. If the unified tool
is going to have a switch button between the two games, they need to sit on the
same origin.

## Settled

- **The d66 chart does not survive contact with Dropzone.** 36 cells, twelve
  core scenarios, three cells each — fine. Add the Fauna four and sixteen does
  not divide into thirty-six. So the printed chart is core-only at three cells
  per scenario, and the roller handles any mix including Fauna. Jet has agreed
  to this.
- **Dropzone maps get redrawn as SVG.** The extracted rasters are the reference
  to draw against and the fallback until each one is replaced. This is also
  what makes them theme-aware and printable, and it is how the Dropfleet
  generator already works.
- **Operation Artemis is a separate button.** Its two scenarios — Escape and
  Slayer of Kings, in `rules/Extra-Rules/Operation_Artemis_Rules_Update_1.1.0.pdf`
  — are for the standalone Artemis box, PHR walkers against fauna, not a normal
  game of Dropzone. They do not belong mixed in with the sixteen.

## Open

- Where the shared code lives. Two git repos, one origin. Either one repo owns
  it and the other copies on deploy, or a third location both pull from.
- Whether the Dropfleet generator moves off neocities as part of this.
- Whether Dropfleet's browse mode is worth having at all, or whether it stays
  roll-only and only Dropzone gets the list.

## Source quirks, so nobody re-derives them

- The Fauna pack prints **"Hunting Grounds" as the title of two different
  scenarios**, pages 11 and 12. Held on the Dropzone side as Hunting Grounds
  (Nest) and Hunting Grounds (Typhon).
- Rulebook page 42 hands its two scenario maps back **bottom-first**, and
  merges the "Kill Box" title into the same text block as that scenario's first
  legend line.
- Two errata apply to the scenario pages and are already correct in the 3.02
  printing: Battle Royale's Attrition is 2 VP, and Castles' Dominate gains
  "Score on game end".
- **There is no tournament or organised-play pack for Dropzone.** The only
  tournament item on TTCombat's resources page is a score sheet,
  `Dropzone_Tournament_Record_Sheet.xlsx`. Dropfleet has a Competitive Play
  chapter; Dropzone has no equivalent, which is why the generator's `nc` flag
  has no direct Dropzone counterpart.
- **Nothing in the rulebook says what order to physically lay a table out in.**
  Chapter 3 gives the pre-game sequence — size, army, deck, then scenario, and
  it says the scenario comes last so nobody tailors a list to it. Chapter 9
  gives Zone density and the deployment roll-off. The objectives-first order is
  Jet's house procedure and must be labelled as one, not dressed up as a rule.
