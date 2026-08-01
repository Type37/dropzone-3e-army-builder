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

### 2026-08-01 — What a Level buys, and guns nobody was firing
- **A Commander Level says what it is worth.** CP replenishes up to your highest Level, your Command Card hand is that many cards, and Initiative is D6 plus it (4.1) — Play Mode has run on those three numbers since it was written, and the screen where you choose a Level had never been told. They are on every option in the chooser, once in the rail for the army, and in the Commander table on the printable reference, which is the sheet someone is holding when they ask why the Level 6 was worth 150 points.
- **A Level a smaller game cannot reach now says which game reaches it.** The chooser used to filter them out, so at Skirmish there were two rows and no way to learn that Levels 6 and 7 exist. Everything else in this app refuses and explains — a Rare Squad at its limit quotes the limit, a Transport that cannot be filled shows the arithmetic — and only the Commander ladder refused by deleting.
- **A Squad's weapon table is the guns that Squad fires.** It was printing the Unit's whole card: the gun only a Rapier carries, on a Squad with no Rapier in it, and every paid upgrade as a row whether or not you had bought one. The upgrade block below was already offering those, so an un-bought upgrade appeared twice. The printed sheet does the same now, where it matters more — you cannot expand a row on paper — and its rules appendix stops printing the full text of rules for guns nobody in the army can fire.
- **Compact view**, in Settings. A Squad reads as its whole stat card by default, which is right when you are deciding between two Units and long when you are scanning ten; this drops the weapon table and the stat grid repeated under every Variant. It takes away no control — every stepper, every upgrade and the Transport chooser stay.
- **Every Unit says which stat card page it came off**, in the reference and on each row of the printable sheet, with the release named beside them. Every rule in the app already cited its rulebook page; the Unit, whose printed card is the one thing the app cannot replace, cited nothing.
- **The sentence that qualifies an upgrade** — "Only one of these upgrades may be taken", "May replace both its MC-20 Chainguns with MM-15 Sidearm Missiles" — reads on the unit page as well as over the buttons. Four cards had it wrong in the data: the Strikehawk and Carryhawk stopped mid-clause at "May replace transport capacity of", and Drones and Hulks had a paragraph of lore in the field instead. The scanner was reading a footnote as a run of words beginning with an asterisk; a footnote is a line.
- **"A save of 4++"**, on every Infantry Unit with Hardy. The rulebook heads the rule "Hardy X" and then reads "a save of X+", while every card prints "Hardy 4+", so the value took the plus with it. Found by reading back all 412 keywords the six factions print, against the 40 rules that take a value.

### 2026-08-01 — A blank builder, and everything that was never pressed
- **The builder was drawing nothing at all for any Squad with a Transport.** `squadHtml` called a helper two hundred lines above the `const` that declares it — a temporal dead zone, so a thrown error inside the render, so the whole pane stayed empty. Live for a day, through 400-odd passing assertions, because nothing had ever driven `renderBuilder`: the suite tested the renderers a Unit goes through and never the screen that assembles them. **Every screen is driven now** — the army list, the builder, the picker, the Transport and Commander choosers, Share, the print preview, the unit reference, Collection and Play — and so is every control on them, about seventy of them, pressed in turn.
- **Drag a Group to reorder it.** The order is the order on the printed sheet, and that order is the deployment plan; until now it was whatever order you happened to add them in. A grip in the corner, Pointer Events so it works on touch, and nothing lifts as it moves.
- **An army can say what it is for.** Set it when you make one, edit it in the builder, and it travels in the link, the JSON and the text. Once you have five armies called "UCM Army 3" the name has stopped telling you anything.
- **Play, Share and Print moved into the topbar**, which on a phone costs no vertical space at all — the row above the Group list was three buttons tall on every army.
- **One menu on an army card** instead of two loose icons crowding the thing you are trying to tap. **On a phone the rail collapses** behind the two numbers you keep glancing at: points left, and whether there is anything to fix.
- **The picker can show only what you own**, when the Collection is switched on. **Missing art removes itself** rather than leaving a broken icon and a hole.

### 2026-08-01 — A sheet for the table, and corners that were never sharp
- **A printable quick reference, one per faction.** Everything you cannot look up mid-game without the book: every game size with its Group cap and Rare limit, the Commander ladder, the category and Group-cost rules, the transport symbol grammar, the faction's whole roster as one table, and last the special rules those units actually print — only those, because a sheet carrying all 107 glossary entries is the rulebook again and the rulebook is free. Dropfleet's equivalent is six hand-written files; this is one page reading the same JSON the app reads, so a re-scanned points value cannot leave it lying. Linked from the landing page and the footer.
- **The sharp-cards rule was losing to the rules below it.** It went into the stylesheet halfway up the file, above the declarations that round the picker cards, the rail and the Commander chooser — same specificity, so the later rule won and those surfaces had been rounded the whole time. Moved to the end, where it has to be, and now the tests read the cascade and fail if the last word on any card surface is not zero. Nine more surfaces joined it, including the landing tiles and both grids in the New Army dialog.
- **Share is three things.** A link for someone who will open it, plain text for a message or a forum, JSON for this app's own Import. The text keeps the Group nesting indented — the same tree the printed sheet draws — and is written in the convention the importer already reads, so a list you paste back comes home as an army.
- **Feedback asks the four questions** rather than opening a blank message.

### 2026-08-01 — Surprise me, and a bug that called legal armies illegal
- **A Squad needing more than one Transport was reported illegal.** Six Legionnaires in two Bear APCs is a Group the rulebook itself illustrates (worked example 3), and the app measured the load against *one* vehicle's capacity — "Bear APC has 3 square capacity, needs 6", with nothing you could do to fix it. The whole multi-Transport tier was in that state across every faction. Found by writing the random army generator, which has to produce a legal army and so argues with every rule at once; pinned now by six tests.
- **"Surprise me"** builds a whole army to the faction, size and points you have already chosen, legal when it stops. It spends the Commander first (an army without one is illegal), Standard before the categories Standard has to pay for (3.2), and takes a Transport only where it comes out exactly full (3.2.4). Seventy-two generated armies are asserted legal on every test run, which is the argument for it being a feature rather than a toy.
- **A rule links to the rules it names.** Grav says it ignores Resilient; Resilient is now one tap away, where before you had to know it existed and go looking. Twenty-three cross-references in the 107-rule glossary were dead ends. **Every rule a Unit uses also prints in full** under its weapon table — on a phone there is no hover, so a tooltip-only rule was simply missing.
- **A list pasted out of New Recruit imports.** Names match plural, singular, any case, and a variant standing in for its Unit; the faction is decided by which roster the names belong to rather than by the header. It cannot give back the Group nesting — a flat list does not record what rode in what — and says so.
- **Sort your armies** by Recent, Name, Faction or Points, and an empty list is the grid with a tile in it rather than a sentence saying it is empty.

### 2026-08-01 — Print what you can see first, and get your armies back
- **Print opens a preview.** Your sheet at A4, with the page breaks drawn on it and the page count in the bar. The breaks are measured, not spaced every 273mm: a Group is kept whole by the stylesheet, so a Group that would straddle a boundary is pushed onto the next page exactly as the printer will do it, and the preview then agrees with the paper. Compact, ink-saver and art are decided there too, where you can see what each one costs you in pages — art on the printed sheet is new, and stays off unless you ask, because it is the single biggest thing between a two-page list and a four-page one.
- **Import — the other half of the backup button.** There was an Export and nothing to put it into, which made the backup a file rather than a backup. A whole backup, one army, a share link, or a list pasted out of New Recruit all go in through the same box; the report says what came in and what it could not match. Nothing is overwritten and every id is reissued, so importing twice adds twice rather than quietly replacing what you have. A pasted list will not give back the Group nesting and says so — a flat list does not record what rode in what.
- **The agreed points limit can be changed after the fact.** The size in the rail opens it. It matters more than it sounds: the per-Group ceiling is a quarter of the *agreed* limit (3.2), so agreeing 1500 on the day instead of the 2000 you built at moves what is legal, and there was no way to tell the app. This was the one gap out of twenty-five in `PORTING.md` that had no task behind it.
- **The per-model variant dropdowns are gone.** A Squad of eight was eight dropdowns and you could not see the mix without opening every one. Variants are per model (3.2.2), so what a Squad *is* is how many of each — the variant blocks, which already said what each one is, which gun makes it that and what it costs, now carry the count. The thing you read is the thing you press.
- **An upgrade reads as the weapon it is** — the same columns as the table above it, with the price as the button. The question an upgrade asks is whether the new gun beats the one you have, and a name on a checkbox cannot answer it.

### 2026-08-01 — Commanders, Groups you can copy, and tests that read the markup
- **Commanders have names**, the same way Groups do. An unnamed one reports its Level, so deleting from the middle of a list can never produce two things with the same default name.
- **Duplicate a Group** — every Squad, its models and their variants, the upgrades and the nesting, with every id reissued so the copy rides its own Transports instead of the original's.
- **Every army as one JSON file you keep.** Armies live in localStorage, which a browser is free to clear; sync moves them between your own devices but propagates a deletion just as happily.
- **On a phone a Group is a screen you drill into**, not another slab in a long column. On a desktop the builder keeps its three panes.
- **Render tests.** Three regressions in one night were caught by looking at a screenshot and none by the suite — which was an argument that nothing was testing the markup, not an argument for screenshots.

### 2026-08-01 — Rules say what they mean, and the Albatross is reachable
- **A rule reads back the number your card printed.** "Aegis 6”" says *within 6” of this Unit*, not *within X”*, and word suffixes work the same way so "Ineffective: Zones" names Zones. Doing the substitution exposed three keywords the app had been reading wrongly: **"Pen 6+" was resolving to Passive Countermeasures**, so every weapon with Penetrator showed the wrong rule entirely. Fixed in the scanner, not by hand-editing generated data — a separator must consume something, a heading's space may be a hyphen on the card ("Alt-1", "Critical-1"), and a value running up to an inches mark is one token.
- **Every rule cites its page.** In the tooltip, the popover and the printed appendix, so the book falls open in the right place. Core rules only: a faction rule is scanned from that faction's own card PDF where the rules are always page 1, and citing that would point at a different document.
- **You can build an Albatross.** A Transport Squad is a Squad, so it can be carried — 3.2.4.1's "plus their own Transport Squads". The model always allowed it; the squad row was denying a Transport its own Transport control, which put the whole 18-capacity tier out of reach.
- **The picker prices the Squad, not the model** — 70pts over "2 × 35". Sixty of the 178 have a minimum above one model, so a third of the list was halving its own price at the moment you decided. Sorting by Price moved with it.
- **Tabs and filters only exist if they can match.** Category tabs carry counts; a new filter finds the 18 units with a paid weapon upgrade; and Unique is gone, because no Unique Unit has been published — the rule is still enforced, and a test now fails the day one appears.
- **Search reaches further:** category and type, the rules on a *weapon* rather than only on the Unit, and glossary aliases, so "evasion" finds a card that only ever prints "Ev1". Three copies of the filter became one.
- **Controls say what refuses them.** The model stepper went dead under your finger with nothing on screen; it quotes the squad size now. Empty lists name which choice emptied them. Renaming has an affordance, and Escape puts it back.
- **Both app logos had been 404ing on the live site since 30 July.** `.gitignore` carried an unanchored `DZC_Logo_*` from before the fork, which on Windows also matched `assets/logos/dzc_logo_white.webp`, so `git add` skipped them silently. A test now checks that every asset the markup names is a file that exists.
- **Two dead CDN scripts removed.** d3 and topojson loaded on every visit for a Dropfleet world map that no longer exists. Nothing off-site can come back — the suite checks.

### 2026-07-31 — Groups form by transport, and the picker becomes usable
- **Groups form by transport, which is what 3.2.4 says.** A Transport may only be chosen alongside a Squad it can carry, and up to four Squads plus their own Transport Squads may share one larger Transport. Nothing else puts a second Squad in a Group — there is no restriction by category anywhere in 3.2, and no "air groups". An empty Group takes any fighting Unit; after that the picker offers only a Transport for something already there, or a Squad that fits inside one, and greys the rest out quoting the rule that refuses it.
- **Composition is reported, not blocked.** A lone Transport is unfinished, not illegal. The line is whether adding something else could put it right: a second Rare Squad never can, so it stays refused, while a Transport waiting for cargo is reported when you stop building. Two tests changed because the behaviour they asserted was overruled.
- **The picker holds still.** Every control used to rebuild the whole bar, resetting the scroll and moving what you were aiming at. The bar is built once now. Sorting by Price, Name, Category, Squad or Capacity, reversible; filters for Rare, Unique, Variants, Carries and Auxiliary; filters by transport symbol, drawn with the same paths the stat cards print; search across names, variants, weapons and rules; a list view beside the card grid.
- **The Group header meters itself.** Points against the quarter-army ceiling, Squads, models, and per Transport how much of each shape's capacity is used against what it offers — green when full, red when overloaded.
- **A Squad in your army reads as the Unit it is.** Art, capacity symbol, every stat, the rules, a block per variant with its own price, and the whole weapon table. `weaponsHtml` and `variantsHtml` come out of the unit view rather than being written twice, so the two cannot drift.
- **The Transport dropdown is a chooser.** Every option shows what it offers, how many the cargo needs, what it costs and whether the fit is exact.
- **Verified at 375 through CDP device metrics**, not `resize_window`, which reports a viewport the page never sees. `shots.mjs` takes `SHOT_W`/`SHOT_H` and can clip one element at 1:1 — two badges looked right full-page and were missing their count when cropped.
- **What's New has real content.** The modal was a shell pointing at this file on GitHub.

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
