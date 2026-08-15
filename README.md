<div align="center">

[![Dropzone Commander 3E Army Builder](assets/logos/og-preview.png)](https://type37.github.io/dropzone-3e-army-builder/)

# Dropzone Commander 3E Army Builder

### [Open it](https://type37.github.io/dropzone-3e-army-builder/)

</div>

Assemble and print your army in this unofficial army builder for [Dropzone Commander](https://www.ttcombat.com/games/dropzone-commander), published by TTCombat. Unofficial builder by WarLore.

## What it does

- Six factions, every unit, third edition.
- Enforces the rules while you build rather than grading you after: points, category spend, Group composition, transport capacity, Commander levels.
- Squads nest under the Transport carrying them, because that is how a Group works.
- Print sheets, play mode, works offline, no account.
- Rules quoted from TTCombat's stat cards, with audit scripts on every ingest.

## Design decisions

- Dresses as its own rulebook: warm paper, navy rail, gold Deco, Fluent 2 underneath. Tighter than the Dropfleet builder it forked from.
- One responsive app, not two builds. Dropfleet ships a separate `/mobile/`; this is the correction.
- Mobile first, because the phone is the one used at a table.
- Every panel is square. Buttons may have a radius; a card may not.

## Still to do

- The Squad card is too tall. A 4-Variant unit draws four weapon blocks, three of which you usually do not own. Collapsing untaken Variants means hiding gameplay text, so it needs a deliberate call.
- Big Squads need a size control that carries ranges like 3–9 and 6–12.

## Run it

```bash
python -m http.server 8899
```

## Legal

Game data, rules text, unit names and art are TTCombat's. Unofficial, not endorsed by TTCombat.

[Report a bug](https://github.com/Type37/dropzone-3e-army-builder/issues/new/choose) · [Dropfleet builder](https://type37.github.io/dropfleet-builder/) · [WarLore](https://jetwong.neocities.org/)
