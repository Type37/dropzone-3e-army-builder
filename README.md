<div align="center">

# Dropzone Commander 3E Army Builder

An army builder for [Dropzone Commander](https://www.ttcombat.com/games/dropzone-commander) 3rd Edition. No login, no install. Armies save in your browser and work offline.

### ▶ [Open it](https://type37.github.io/dropzone-3e-army-builder/)

</div>

> **Under construction.** This is a fork of the [Dropfleet Commander Fleet Builder](https://github.com/Type37/dropfleet-builder), being converted from the space game to the ground game. The **data pipeline is finished and audited**; the app itself still renders Dropfleet's ships and rules while its domain layer is migrated. What is live today is not yet a working Dropzone builder — follow the changelog below.

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

Tests run on the real data, not fixtures:

```sh
node scripts/test-dzc-data.mjs
```

Fonts: [Jost](https://fonts.google.com/specimen/Jost), [Libre Baskerville](https://fonts.google.com/specimen/Libre+Baskerville), [Roboto Slab](https://fonts.google.com/specimen/Roboto+Slab).

## Changelog

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
