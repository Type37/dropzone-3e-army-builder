# Is the adaptation finished, or is there porting left?

Jet asked, 2026-07-31. Answered 2026-08-01 by reading the fork point, not by
guessing.

---

## The answer

**The port is finished. Nothing is half-ported.** Every Dropfleet subsystem
that was kept has a working Dropzone equivalent, and the three that are gone
were cut on purpose. There is no subsystem in a broken middle state.

**What is left is not porting. It is features.** Twenty-five discrete things
Dropfleet does that this app does not, and they are absent because nobody built
them, not because a port stalled. Twenty-four already had a Todoist task; the
twenty-fifth had none, and it was the worst of them:

> **You cannot change an army's points limit after you create it.** Dropfleet
> has `openGameSizeChanger` / `applyGameSize` / `setCustomMax`. Here
> `pointsLimit` is written once, in `create()`, and never again. Agree 1500
> instead of 2000 on the day and there is no way to say so — and because the
> per-Group cost cap is a quarter of the *agreed* limit (3.2), every Group in
> the list silently changes legality with it.

**Built 2026-08-01.** `setPointsLimit` in `js/dzc-army.js`, and the size in the
builder rail is now the control that opens the changer — a band per row, then
the exact number, in Dropfleet's shape.

---

## How this was checked

Dropfleet exports its entire public surface as one object literal at the bottom
of `js/app.js` — about 120 functions. That list is the feature inventory, and
it is exhaustive by construction: nothing the UI can call is missing from it.

```sh
git show 43773fa:js/app.js          # the fork point
git show 43773fa:index.html         # its views and modals
git ls-tree -r --name-only 43773fa  # ref/, mobile/, calc
```

Every entry was matched against ours and put in one of four buckets. Where the
answer was "we have it", it was grepped for rather than remembered — three
things thought missing turned out to be present, and they are listed at the
bottom.

The fork point is only reachable in a full clone. A cloud session starts
shallow, so `git fetch --unshallow` comes first or `43773fa` does not resolve.

---

## Ported — the whole architecture

| Dropfleet | Here |
|---|---|
| routing, views, modals | `js/dzc-shell.js` |
| fleet list, builder, picker | `js/dzc-builder.js` |
| ship reference | `js/dzc-units.js` — all 178 |
| admiral → Commander | rail card, chooser, assignment, rank insignia |
| loadouts → **variants** | per MODEL, which is what 3.2.2 actually says |
| systems → **weapon upgrades** | per VARIANT, which is what 3.2.3 says |
| Play Mode | `js/dzc-play.js`, rebased on Rounds/CP/Pass |
| share links | `js/dzc-share.js` — the army travels in the URL |
| print | `css/dzc-print.css` — and ours keeps the nesting tree |
| collection | `js/dzc-collection.js`, off by default |
| offline, sync, analytics | `offline-sync.js`, `fleet-sync.js`, `count.js` — unchanged |

Two of those are not copies but re-derivations: Dropfleet's loadouts and
systems became variants and weapon upgrades because DZC scopes them
differently. Same job, different rule, so a straight port would have been
wrong.

## Cut on purpose

Recorded in HANDOFF §8, and all four are genuinely gone rather than stubbed.

| | |
|---|---|
| Combat Calculator | `calc-data.js`, `calc-engine.js`, `calc-ui.js`, `#view-calc`, `getCalcData` |
| Space Stations | `openStationModal`, `selectStation`, `addStationSystem`, two modals |
| Secondary Objectives | `toggleSecondaryObjective`, `openSecondaryModal`, one modal |
| the separate `mobile/` build | one responsive app instead — two builds drifted apart once already |

## Not applicable — a Dropfleet mechanic with no Dropzone counterpart

Not gaps. Listing them so nobody re-files them as gaps.

`selectFlagship`, `changeFlagshipLoadout` (no flagship) · `playSpikeChange`
(scan spikes) · `playCripChange`, `playCripToggle`, `playToggleCripPanel`
(crippling) · `playToggleFire`, `playTogglePower` · `playCorruptorChange` ·
`playSetOrder`, `playOrderUp/Down/Move/Cancel` (Dropfleet's activation order)

## Blocked on TTCombat, not on us

- **Famous Commanders** — `addFactionAdmiral`, `addFamousAdmiral`,
  `toggleAdmiralAbility`. Not released. The schema slot exists; only generic
  Commanders can ship.
- **Command Cards** — not published. Deck rules are known (3.2.6), the cards
  are not.

So gaps 78/79/80/86 — the ability picker and its pick counter — cannot be
built until there are abilities to pick.

---

## Not ported — the twenty-five

Ranked by how much they cost someone actually using this at a table.

**Blocks a real session**

1. **Change the points limit after creation.** No task. See above.
2. Print preview with page-break markers (110)
3. Import from clipboard, including a New Recruit list (113) and its import
   report (114)
4. Faction References tool — `ref/`, seven files (119)

**Costs you time every session**

5. Duplicate a Group (124)
6. Drag to reorder Groups (123)
7. Sort the army list (98)
8. Tabs on the army list (96)
9. Per-army overflow menu (100)
10. Share as plain text and as JSON (115)
11. Export every army as a JSON backup (116)
12. Ink-saver and density toggles for print (111)
13. Per-unit thumbnails on the printed sheet (112)

**Makes the app feel unfinished**

14. Seed example armies on first run (94)
15. Fast Play sheets (118)
16. A "Surprise me" random army generator (91)
17. An army description field (88)
18. Misc/optional units toggle in the picker (31)
19. In-collection filter in the picker (32)
20. Mobile rail as a drag handle with a peek summary (47)
21. Art carousel with sculpt labels (67) and store links (122)
22. Namesake lore per unit (120)
23. Pronunciation guide (121)
24. Deployable Feature / carrier handling — the Bioficer Generated case (127)
25. Three-pane desktop layout (45) — a rail exists; the third pane does not

---

## Three notes that were out of date

Found while checking, because "we have it" was grepped for rather than
remembered.

- **`js/rank-insignia.js` is not unused.** Gap 76 says it is "ALREADY loaded in
  our index.html and completely unused". It is called twice in
  `js/dzc-builder.js` — the Commander rail card and the level chooser.
- **The What's New modal is not an empty shell.** It has a real `CHANGELOG`
  array in `js/dzc-shell.js` with dated entries.
- **The glossary IS wired to the picker.** Gap 38 says it is not. The picker
  builds cards through `unitFacts`, which calls the same `rulesHtml` as the
  unit reference.

None of those are worth reopening. They are noted so the next audit does not
spend an hour rediscovering them.
