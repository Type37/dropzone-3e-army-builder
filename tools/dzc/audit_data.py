#!/usr/bin/env python3
"""Sanity checks over scanned faction JSON. Exits non-zero if anything fails."""

import glob
import json
import os
import sys
from collections import Counter

CATEGORIES = {"Standard", "Vanguard", "Heavy", "Support", "Transport", "Generated"}
TYPES = {"Vehicle", "Aircraft", "Infantry"}

problems = []
warnings = []
stats = Counter()

for path in sorted(glob.glob(os.path.join("data", "dzc", "faction-*.json"))):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    fid = data["faction"]
    for u in data["units"]:
        tag = f"{fid}/p{u['page']} {u['name']!r}"
        stats["units"] += 1

        if not u["name"] or len(u["name"]) < 3:
            problems.append(f"{tag}: empty/short name")
        if u["category"] not in CATEGORIES:
            problems.append(f"{tag}: bad category {u['category']!r}")
        if u["type"] not in TYPES:
            problems.append(f"{tag}: bad type {u['type']!r}")

        # Costable? Either a flat cost, or every variant priced.
        if u["selectable"]:
            if u["points"] is None and not u["variants"]:
                problems.append(f"{tag}: no points and no variants")
            for v in u["variants"]:
                if v["points"] is None:
                    problems.append(f"{tag}: variant {v['name']!r} has no points")
            # Transports legitimately have none: 3.2.4 says they "do not have a
            # minimum or maximum Squad size -- you may take as many identical
            # Transports as needed to carry their Squad".
            if u["squadMin"] is None or u["squadMax"] is None:
                if u["category"] != "Transport":
                    problems.append(f"{tag}: selectable but no squad size")
            elif u["squadMin"] > u["squadMax"]:
                problems.append(f"{tag}: squad {u['squadMin']}-{u['squadMax']} inverted")

        if not u["weapons"]:
            stats["no weapons"] += 1
        for w in u["weapons"]:
            if not w["name"]:
                problems.append(f"{tag}: weapon with no name")
            if not w["arc"]:
                problems.append(f"{tag}: weapon {w['name']!r} missing Arc")
            if not w["att"] or not w["ac"]:
                problems.append(f"{tag}: weapon {w['name']!r} missing Att/Ac")
            if w["box"] is None:
                stats["weapon: unclassified swatch"] += 1
            if w.get("boxUnresolved"):
                # Source quirk, not a parse failure: the card prints an orange
                # (variant-restricted) box but names no variant.
                warnings.append(f"{tag}: weapon {w['name']!r} orange but names no variant")
            stats[f"weapon box={w['box']}"] += 1

        # An upgrade footnote with no upgrade to qualify is not a footnote, it
        # is whatever else was printed down the left margin -- which for two
        # Bioficer cards was a paragraph of lore, sitting in the data for a
        # month because nothing compared the note to the weapons above it.
        if u["upgradeNote"] and not any(w["box"] == "upgrade" for w in u["weapons"]):
            problems.append(f"{tag}: upgradeNote but no upgrade weapon")
        # It is also a SENTENCE. Stopping mid-clause is how the Strikehawk and
        # Carryhawk recorded "May replace transport capacity of" and no more.
        if u["upgradeNote"] and not u["upgradeNote"].rstrip().endswith((".", "!", "?")):
            problems.append(f"{tag}: upgradeNote does not end a sentence: {u['upgradeNote']!r}")

        t = u["transport"]
        stats["has capacity"] += bool(t["capacity"])
        stats["fills a transport"] += bool(t["fills"])
        stats["auxiliary transport"] += u["auxiliaryTransport"]
        stats["not selectable"] += not u["selectable"]
        stats[f"cat={u['category']}"] += 1
        if u["rare"]:
            stats["rare"] += 1
        if u["unique"]:
            stats["unique"] += 1
        if u["variants"]:
            stats["has variants"] += 1

# --- Behemoths -------------------------------------------------------------
#
# Their own file, their own shape: a Power stat and a Groups Equivalent instead
# of a Squad Size (Behemoth rules 1.1-1.2). Ten of them plus the one Drone that
# is "included with its Behemoth" and cannot be taken separately (2.1.1).
BEHEMOTHS = os.path.join("data", "dzc", "behemoths.json")
if os.path.exists(BEHEMOTHS):
    with open(BEHEMOTHS, encoding="utf-8") as fh:
        bh = json.load(fh)
    beh = [u for u in bh["units"] if u["type"] == "Behemoth"]
    stats["behemoths"] = len(beh)
    if len(bh["units"]) != 11:
        problems.append(f"behemoths: {len(bh['units'])} cards, expected 11 "
                        f"(ten Behemoths and the Venus Drone)")
    for u in beh:
        if u["groupEquivalent"] is None:
            problems.append(f"behemoth/{u['name']}: no Groups Equivalent -- "
                            f"it is what the Group allowance is spent against (1.1)")
        if not u["stats"].get("Power"):
            problems.append(f"behemoth/{u['name']}: no Power stat (1.2)")
    # Every one placed, and two per faction across five. The cards do not print
    # a faction; scan_statcards works it out from the weapon vocabulary in the
    # six faction scans and refuses to write the file unless it comes out in
    # that shape. This is the second pair of eyes on the result.
    FACTIONS = {"ucm", "phr", "scourge", "shaltari", "resistance", "bioficer"}
    placed = Counter()
    for u in bh["units"]:
        fac = u.get("faction")
        if fac not in FACTIONS:
            problems.append(f"behemoth/{u['name']}: faction {fac!r} is not one of the six")
        elif u["type"] == "Behemoth":
            placed[fac] += 1
    if sorted(placed.values()) != [2, 2, 2, 2, 2]:
        problems.append(f"Behemoths are not two per faction across five: {dict(placed)}")

# A weapon's variant bracket must name a variant the unit actually has.
#
# weaponLive matches these by exact name against the models a Squad fields, so
# a bracket that names nothing real marks the gun dead everywhere and the
# weapon simply vanishes. It is not hypothetical: the Resistance ATVs printed
# "(Recon ATV)" on the guns against a variant called "Recon ATVs", and the UCM
# Archangel's bracket wrapped mid-word into "Archangel Fighter- Bomber". Both
# Squads rendered with NO WEAPONS AT ALL, in the builder and on the printed
# sheet, and nothing in this file noticed. scan_statcards reconciles the two
# now (reconcile_variant_names); this is the check that says it worked.
for path in [*sorted(glob.glob(os.path.join("data", "dzc", "faction-*.json"))), BEHEMOTHS]:
    if not os.path.exists(path):
        continue
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    for u in doc["units"]:
        have = {v["name"] for v in (u.get("variants") or [])}
        if not have:
            continue
        for w in (u.get("weapons") or []):
            for vn in (w.get("variants") or []):
                if vn not in have:
                    problems.append(
                        f"{doc['faction']}/{u['name']} / {w['name']}: names variant "
                        f"{vn!r}, which this unit does not have {sorted(have)} -- "
                        f"the gun will render for nobody")


print("=== counts ===")
for k, v in sorted(stats.items()):
    print(f"  {k:34s} {v}")

print(f"\n=== {len(warnings)} source-data warnings ===")
for w_ in warnings:
    print("  " + w_)

print(f"\n=== {len(problems)} problems ===")
for p in problems[:60]:
    print("  " + p)
if len(problems) > 60:
    print(f"  ... and {len(problems) - 60} more")

sys.exit(1 if problems else 0)
