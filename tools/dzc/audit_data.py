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

for path in sorted(glob.glob(os.path.join("data", "faction-*.json"))):
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
