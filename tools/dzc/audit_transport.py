#!/usr/bin/env python3
"""
Sanity checks on transport symbols, the hardest part of the scan and the part
the Group builder depends on most.

Symbol SHAPE is what decides which transports may carry a unit, so a
misclassified shape produces a builder that silently permits illegal lists.
Two shape bugs were caught this way and this guards against their return:

  * A hollow badge is drawn as nested outlines, so counting path items called
    the Condor's hollow TRIANGLE a hexagon. The rulebook explicitly shows a
    Condor carrying Bear APCs and Sabres, both of which fill triangles, so
    that pairing is a fixed point the data must reproduce.
  * A diamond is not a square. Square fills are 23/24 Infantry and diamond
    fills are 22/25 Vehicle, and four of six factions use both, so collapsing
    them would let infantry ride in vehicle-only transports.
"""

import collections
import glob
import json
import os
import sys

problems, warnings = [], []
units = {}

for path in sorted(glob.glob(os.path.join("data", "faction-*.json"))):
    data = json.load(open(path, encoding="utf-8"))
    for u in data["units"]:
        units[(data["faction"], u["name"])] = u

# --- known-good pairings straight from the rulebook -------------------------
FIXED = [
    # (faction, carrier, shape, capacity) from rulebook 3.2.4.2's worked example
    ("ucm", "Condor Dropship", "triangle", 6),
    ("ucm", "Bear APC", "square", 3),
    ("ucm", "Albatross Heavy Dropship", "triangle", 18),
]
for fid, name, shape, n in FIXED:
    u = units.get((fid, name))
    if not u:
        problems.append(f"{fid}/{name}: missing from data")
        continue
    got = [(c["shape"], c["n"]) for c in u["transport"]["capacity"]]
    if (shape, n) not in got:
        problems.append(f"{fid}/{name}: expected to carry {shape} {n}, got {got}")

# Sabre (a UCM Main Battle Tank variant) must fill a triangle, or the Condor
# cannot carry three of them as the rulebook says.
mbt = units.get(("ucm", "UCM Main Battle Tank"))
if mbt:
    fills = [(c["shape"], c["n"]) for c in mbt["transport"]["fills"]]
    if ("triangle", 2) not in fills:
        problems.append(f"ucm/UCM Main Battle Tank: expected to fill triangle 2, got {fills}")

# --- shape/type coherence ---------------------------------------------------
by_shape = collections.defaultdict(collections.Counter)
odd = []
for (fid, name), u in units.items():
    for c in u["transport"]["fills"]:
        by_shape[c["shape"]][u["type"]] += 1

EXPECT = {"square": "Infantry", "triangle": "Vehicle", "diamond": "Vehicle"}
for shape, expected in EXPECT.items():
    counts = by_shape.get(shape)
    if not counts:
        problems.append(f"no unit fills a {shape} -- shape classification regressed?")
        continue
    dominant, n = counts.most_common(1)[0]
    if dominant != expected:
        problems.append(f"{shape} is filled mostly by {dominant}, expected {expected}: {dict(counts)}")

for (fid, name), u in units.items():
    for c in u["transport"]["fills"]:
        exp = EXPECT.get(c["shape"])
        if exp and u["type"] != exp and not (c["shape"] == "diamond" and u["type"] == "Aircraft"):
            warnings.append(f"{fid}/{name}: {u['type']} fills a {c['shape']} "
                            f"(usually {exp}) -- verify against the card")

# diamond must remain distinct from square
sq = sum(by_shape["square"].values())
di = sum(by_shape["diamond"].values())
if not (sq and di):
    problems.append("square and diamond are no longer both present -- did they collapse?")

print(f"fills by shape: " + ", ".join(
    f"{s}={dict(c)}" for s, c in sorted(by_shape.items())))
print(f"\n=== {len(warnings)} warnings ===")
for w in warnings:
    print("  " + w)
print(f"\n=== {len(problems)} problems ===")
for p in problems:
    print("  " + p)

sys.exit(1 if problems else 0)
