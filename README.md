<div align="center">

# Dropzone Commander 3E Army Builder

An army builder for [Dropzone Commander](https://www.ttcombat.com/games/dropzone-commander) 3rd Edition. No login, no install. Armies save in your browser and work offline.

### ▶ [Open it](https://type37.github.io/dropzone-3e-army-builder/)

</div>

> A fork of the [Dropfleet Commander Fleet Builder](https://github.com/Type37/dropfleet-builder), converted from the space game to the ground game. The Dropfleet app has now been removed entirely — everything below runs on Dropzone data.

## What it does

- **Army builder** — Groups, Squads, per-model variants, weapon upgrades, transport nesting, live points and category ratios.
- **Unit reference** — all 178 units with stats, weapons, variants, transport symbols and rules text one tap away.
- **Print sheet** — the deployment plan, with the nesting tree and a verbatim rules appendix.
- **Play Mode** — Rounds, Command Points, Pass tokens, Initiative and per-model damage, each card citing the rule behind its number.
- **Collection** — record what you own and see what a list would still need.
- **Share links** that carry the whole army, **cross-device sync**, and an **offline download** for use at a table with no signal.

### It enforces the rules rather than grading you afterwards

Transports never appear in the picker, because a Transport "may only be chosen along with a Squad they may transport" (3.2.4) — you add the Squad, then assign what carries it. Only transports that can *actually* carry that Squad are offered, and the number you get is computed, not typed: 3 Legionnaires derive 1 Bear APC, 6 derive 2. An option that could never be taken full is offered disabled with the arithmetic, because "6 Legionnaires cannot fill transports that carry 4" is not obvious.

The same everywhere else: Rare and Unique disable with the limit quoted, squad min/max disables the stepper, and Commander levels are filtered to those your game size allows.

Only what genuinely depends on a finished list is reported instead — you have no Commander yet, or your Vanguard spend has outrun the Standard that pays for it, which it always does while you're still building.

## The data

Everything comes from TTCombat's own PDFs, which they publish free and publicly on the [Dropzone Commander resources page](https://ttcombat.com/pages/dropzone-commander-resources). Nothing is retyped by hand, so a new stat-card release is re-ingested rather than transcribed.

```sh
python -m pip install pymupdf pillow
python tools/dzc/rebuild.py
```

| Stage | Reads | Writes |
|---|---|---|
| `scan_statcards.py` | the six faction stat-card PDFs | `data/dzc/faction-*.json`, 178 transparent unit photos |
| `scan_rulebook.py` | rulebook ch.10–11 **and** each faction PDF's front matter | `data/dzc/rules.json` |
| four audits | | shape, transport symbols, art coverage, rule coverage |

**178 units across all six factions**, 0 pages skipped, and **106 glossary rules**. `data/dzc/index.json` is the one file not scanned — game sizes, category caps and Commander levels are prose tables in rulebook chapter 3, so they are transcribed with a citation on every entry.

The audits exist because these cards punish naive parsing, and each one encodes a bug that actually shipped:

- **An upright triangle and an inverted one have identical convex hulls.** Geometry alone merged two different transport symbols, which let a Condor load a K9 Pack. Orientation is now read from the lone vertex's side, and the badge ink must agree — six symbols, one colour each.
- **A diamond is not a square.** Square fills are Infantry, diamond fills Vehicle, and four of six factions use both. Collapsing them would let infantry ride in vehicle-only transports.
- **`+` and `/` between capacity symbols mean different things** — carry both at once, versus either but never mixed. The separator is printed on the card and is now read rather than assumed.
- **`∞/24"` ranges.** `pdftotext` silently drops the infinity glyph, hence PyMuPDF.
- **The core rulebook is not the whole glossary.** Faction rules — Shaltari `Gate`, PHR `Nanomachines`, Bioficer `Decon` — live in the front matter of each faction's stat-card PDF.

## Running it

Plain HTML, CSS and JavaScript. No framework, no build step. Open `index.html`, or:

```sh
npx serve .
```

Tests run against the real scanned units, not fixtures — a fixture would happily keep passing after the scanner changed shape:

```sh
node scripts/test-all.mjs
```

Fonts: [Jost](https://fonts.google.com/specimen/Jost), [Libre Baskerville](https://fonts.google.com/specimen/Libre+Baskerville), [Roboto Slab](https://fonts.google.com/specimen/Roboto+Slab).

## Changelog

### 2026-07-31 — Play Mode, Collection, and the Dropfleet app is gone
- **Play Mode** tracks a Round the way chapter 4 defines it: CP replenishing up to your highest Commander Level (and Commanders counting as Level 0 in Round 1), Pass tokens from having fewer Groups than your opponent, Initiative as D6 + Level, and damage per model. Every card states the rule that produced its number.
- **Collection** counts models, not Squads, and stays advisory — owning too few models is a shopping list, not a rules violation, so it never blocks a legal choice.
- **Share links** carry the whole army in the URL. No server, so a shared list cannot rot.
- **`app.js` is deleted.** 9,605 lines replaced by a 309-line shell; the whole Dropzone app is now 2,525 lines across nine files. The Dropfleet views, its 58 MB of ship art, its data and its 56 one-off scripts went with it. The deploy dropped from 86 MB to 26 MB.
- **Two data bugs found by chasing an odd firing-arc value.** Every paid weapon upgrade was costing nothing, because `(+15pts*)` after a weapon name was being read as a variant restriction. And upgrade footnotes below the tables were being read as stats — eight weapons had arcs like `F/S/R be taken.`

### 2026-07-30 — The army builder
- **Builds Dropzone armies.** Groups, Squads and per-model variants, with transport nesting drawn as a tree — a Bear APC with its Legionnaires indented beneath it, because that is the deployment plan.
- **The rules are enforced, not validated.** Illegal choices are unreachable rather than flagged after the fact; see above.
- **Print sheet** keeps the nesting tree and appends the verbatim text of every rule the list actually uses. Groups never split across a page and no rule breaks mid-sentence.
- **Unit reference** for all 178 units.
- **One responsive app.** The phone redirect to `/mobile/` is gone — it still served the *Dropfleet* builder, so every phone was landing in the wrong game. Verified at 320/375/414 with no horizontal overflow.

### 2026-07-30 — The data pipeline
- **178 units ingested from the stat-card PDFs**, with transparent art for every one, plus a **106-rule glossary** drawn from the rulebook and the faction front matter. Four audits, one of which proves every rule keyword a card prints resolves to real text.
- **Transport symbols corrected.** The scanner had merged the red upright triangle with the purple inverted one, and dropped the `+`/`/` separator entirely — between them, several illegal loads would have been silently permitted.
- **The audits had never actually run.** All three globbed `data/faction-*.json`, the app's Dropfleet files, and had been dying on a `KeyError` since the fork. Pointed at `data/dzc/`.
- **Deploys ship the site only.** The Pages workflow uploaded the whole repo, including ~317 MB of rules and lore PDFs the app never fetches. Now 86 MB, and a deploy takes about 20 seconds.
- Combat Calculator removed — it models Dropfleet's damage rules and has no Dropzone equivalent.

### Before the fork
This app began as the Dropfleet Commander Fleet Builder and carries its full history — print sheets, share links, cross-device sync, offline download, collection tracking and Play Mode all come from there. That changelog lives in [the original repo](https://github.com/Type37/dropfleet-builder).

## Links

A WarLore project.

- WarLore: [site](https://jetwong.neocities.org/), [Linktree](https://linktr.ee/warlore), [YouTube](https://www.youtube.com/@WarLore)
- Bug or request? [warlore1@outlook.com](mailto:warlore1@outlook.com)

## Legal

Code is MIT. Unit art and game data belong to TTCombat / Hawk Wargames. Fan project, not official or endorsed.
