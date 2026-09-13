#!/usr/bin/env python3
"""Give each scenario's map key the keys the book prints beside its lines.

    python tools/dzc/fix_scenario_legends.py

extract_scenarios.py reads a legend entry from its coloured square, which misses
what the book keys with a picture instead: a turret or Feature token, the Object
token beside Extract, the coloured disc beside a Secure point, an outlined square,
the orange Centre line. Several printed lines also share one entry because only
the first carries a square ("2 Hardened Large Zones / Comms Uplink / Shield
Generator"), which is right for the Zones on the map but reads as one thing.

Each fix adds "keys" to an entry: [{"at": line, "token"|"square"|"circle"|
"outline"|"line": ...}], one key per printed line that has one. The page shows
each key with the lines under it. Entries keep their index, so the map specs
and hotspots that point at them need no change. Checked against the printed
pages (rulebook pp.38-43, Fauna pack pp.9-12) on 2026-09-13.

Also adds the one special rule the extraction dropped: Ground Control's Zone
Placement (rulebook p.42). Run after extract_scenarios.py; running twice is safe.
"""

import json
from pathlib import Path
from typing import NotRequired, TypedDict

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "dzc" / "scenarios.json"


class Key(TypedDict):
    """One printed line's key: the line index, and at most one picture for it."""

    at: int
    token: NotRequired[str]
    square: NotRequired[list[float]]
    circle: NotRequired[list[float]]
    outline: NotRequired[list[float]]
    line: NotRequired[list[float]]


def tok(at: int, name: str) -> Key:
    return {"at": at, "token": name}


def sq(at: int, rgb: list[float]) -> Key:
    return {"at": at, "square": rgb}


def disc(at: int, rgb: list[float]) -> Key:
    return {"at": at, "circle": rgb}


def plain(at: int) -> Key:
    return {"at": at}


# The printed key's fill, read from the page's vector data
MAGENTA = [0.93, 0.0, 0.55]
OBJECT = "object"
# the Fauna pack prints one brown Fauna icon for Hives, the Gorgon Queen, Fauna Squads
# and the Typhon
FAUNA = "hive"

# scenario id -> {legend entry index -> keys}. An entry is found by its first line, checked below.
FIXES: dict[str, dict[str, list[Key]]] = {
    "battle-royale": {
        "Heavy Cannon Turret": [tok(0, "heavy-cannon")],
        "Railgun Turrets": [tok(0, "railgun-turret")],
        "Flak Turret": [tok(0, "flak-turret")],
        "Excellent Vantage (All Buildings)": [tok(0, "excellent-vantage")],
    },
    "castles": {
        "ACM Package. These only function": [tok(0, "acm-package"), plain(2)],
    },
    "command-and-control": {
        "Secure these points for 3/1 VP.": [disc(0, [0.79, 0.16, 0.46])],
        "Extract these Objects from Friendly": [tok(0, OBJECT)],
    },
    "crucible": {
        "Secure these points for 6/2 VP.": [disc(0, [0.89, 0.47, 0.39])],
        "Extract these Objects from Friendly": [tok(0, OBJECT)],
    },
    "demolish": {
        "Heavy Cannon Turret": [tok(0, "heavy-cannon"), tok(1, "acm-package"), plain(2)],
    },
    "domination": {
        "Extract these Objects from Friendly": [tok(0, OBJECT)],
    },
    "encroach": {
        "Shield Generator": [tok(0, "shield-generator")],
        "Secure this point for 2/1 VP. Score on": [disc(0, [0.89, 0.47, 0.39])],
    },
    "ground-control": {
        "Railgun Turret": [tok(0, "railgun-turret")],
        "Comms Uplink": [tok(0, "comms-uplink-tower")],
        "Excellent Vantage": [tok(0, "excellent-vantage")],
    },
    "kill-box": {
        "Secure this point for 4/2 VP.": [disc(0, MAGENTA)],
        "Extract these Objects from Friendly": [tok(0, OBJECT)],
    },
    "strategic-points": {
        "2 Hardened Large Zones": [
            sq(0, [0.45, 0.67, 0.53]),
            tok(1, "comms-uplink-tower"),
            tok(2, "shield-generator"),
        ],
        "Secure this point for 6/2 VP. Score on": [disc(0, MAGENTA)],
        "Secure this point for 3/1 VP. Score on": [disc(0, [1.0, 0.95, 0.0])],
        "Secure this point for 3/1 VP. Score on#2": [disc(0, [0.82, 0.14, 0.16])],
    },
    "targets-of-opportunity": {
        "Secure these Zones for 2/1 VP. Score on": [{"at": 0, "outline": MAGENTA}],
        "Extract these Objects from Friendly": [tok(0, OBJECT)],
    },
    "pest-control": {
        "X Hive. Each Hive starts the game": [tok(0, FAUNA)],
        "Extract these Objects from Friendly": [tok(0, OBJECT)],
    },
    "death-from-below": {
        "Shield Generator. These only": [tok(0, "shield-generator"), tok(2, FAUNA)],
        "Extract these Objects from Friendly": [tok(0, OBJECT)],
        "Secure these Points for 2/1 VP. Score": [disc(0, [0.73, 0.24, 0.57])],
    },
    "hunting-grounds-nest": {
        "2 Large Zones": [sq(0, [0.25, 0.68, 0.29]), tok(1, "excellent-vantage")],
        "1 full strength Fauna Squad, and +1": [
            tok(0, FAUNA),
            {"at": 3, "line": [0.91, 0.34, 0.06]},
        ],
        "Secure these Points for 2/1 VP. Score": [disc(0, [0.75, 0.12, 0.18])],
    },
    "hunting-grounds-typhon": {
        "3 Medium Hardened Areas": [
            sq(0, [0.25, 0.68, 0.29]),
            tok(1, "acm-package"),
            tok(2, "shield-generator"),
            tok(3, FAUNA),
        ],
    },
}

NOTES = {
    "ground-control": (
        "Zone Placement: Zones should not be placed overlapping multiple table quarters."
    ),
}


def main():
    data = json.loads(DATA.read_text(encoding="utf-8"))
    by_id = {s["id"]: s for s in data["scenarios"]}
    for sid, fixes in FIXES.items():
        s = by_id[sid]
        seen = {}
        for entry in s["legend"]:
            first = entry["lines"][0]
            seen[first] = seen.get(first, 0) + 1
            name = first if seen[first] == 1 else f"{first}#{seen[first]}"
            if name in fixes:
                keys = fixes[name]
                if max(k["at"] for k in keys) >= len(entry["lines"]):
                    raise SystemExit(f"{sid}: {name!r} has {len(entry['lines'])} lines")
                entry["keys"] = keys
        placed = {k for k in fixes if any(e.get("keys") is fixes[k] for e in s["legend"])}
        missing = set(fixes) - placed
        if missing:
            raise SystemExit(f"{sid}: no legend entry for {sorted(missing)}")
    for sid, note in NOTES.items():
        s = by_id[sid]
        s.setdefault("notes", [])
        if note not in s["notes"]:
            # the rulebook prints it between Entry and the Variants
            s["notes"].append(note)
    DATA.write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8")
    print(f"keys on {sum(len(f) for f in FIXES.values())} entries, {len(NOTES)} note(s)")


if __name__ == "__main__":
    main()
