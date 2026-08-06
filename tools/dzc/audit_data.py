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
        if u["selectable"]:
            problems.append(f"behemoth/{u['name']}: selectable while its faction is unknown")
    # Not a problem, because it is not in the source to be got wrong: the cards
    # simply do not say. Nine of the eleven never name a faction and there is no
    # logo or colour to read one off. Until someone supplies the mapping these
    # stay reference-only.
    unfactioned = [u["name"] for u in bh["units"] if not u.get("faction")]
    if unfactioned:
        warnings.append(f"{len(unfactioned)} Behemoths carry no faction -- the cards do not "
                        f"print one, so they are reference-only until it is supplied")

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
