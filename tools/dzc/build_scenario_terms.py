#!/usr/bin/env python3
"""Build the verbatim rules the Dropzone scenarios page uses to explain a scenario.

    PYTHONUTF8=1 python tools/dzc/build_scenario_terms.py

A scenario's legend names rules without explaining them: "Secure these points
for 3/1 VP", "Entry: Ready or Reserved", "Railgun Turrets", "Remaining Intel".
This lifts each of those rules, word for word, out of data/dzc/rules-wiki.json
(the 3.02 rulebook as structure) into scenarios/dzc-scenario-terms.js:

  9.4.x   Entry: Deployed, Ready, Reserved, Holding
  9.6.x   the nine Scenario Objectives
  9.7.x   Objects, Finding and Carrying them, the Extraction Types, Variant Objects
  8.8.x   Zone Features: the Weapon Features table, Effect and Indestructible
          Features, Bunker Entrances
  9.2     Territory
  10, 11  unit and weapon special rules, which map keys and turret profiles name
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WIKI = os.path.join(ROOT, "data", "dzc", "rules-wiki.json")
OUT = os.path.join(ROOT, "scenarios", "dzc-scenario-terms.js")


def esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def runs_html(runs):
    out = []
    for r in runs:
        if isinstance(r, dict):
            t = esc(r.get("t", ""))
            out.append(f"<b>{t}</b>" if r.get("b") else t)
        else:
            out.append(esc(str(r)))
    return "".join(out).strip()


def index(wiki):
    found = {}

    def walk(n):
        if isinstance(n, dict):
            if n.get("number"):
                found[n["number"]] = n
            for k in ("chapters", "children"):
                for c in n.get(k) or []:
                    walk(c)

    walk(wiki)
    return found


def paras(n):
    return [
        runs_html(b.get("runs", []))
        for b in n.get("body", [])
        if b.get("kind") != "table" and runs_html(b.get("runs", []))
    ]


def need(sections, num):
    if num not in sections:
        sys.exit(f"rules-wiki.json has no section {num}")
    return sections[num]


def base_name(heading):
    """'Demo Charges X+' -> 'Demo Charges', 'Ev X (Evasion)' -> 'Ev', 'AA(...)' -> 'AA'."""
    h = re.sub(r"\s*\(.*?\)\s*", " ", heading)
    h = re.sub(r"\s+(X|X/Y|X\+|X”|-X|X Y” Z\+|: X|: X Y” Z\+)(\s|$).*$", "", h).strip()
    h = re.sub(r"\s+X.*$", "", h).strip()
    return h.rstrip(":").strip()


def main():
    with open(WIKI, encoding="utf-8") as fh:
        wiki = json.load(fh)
    s = index(wiki)
    terms = {}

    terms["territory"] = paras(need(s, "9.2"))
    # 9.5: the one sentence a game size changes about a scenario
    skirmish = next(
        (
            m.group(0)
            for p in paras(need(s, "9.5"))
            if (m := re.search(r"Any points[^.]*Skirmish[^.]*\.", p))
        ),
        None,
    )
    if not skirmish:
        sys.exit("9.5 no longer halves points for Skirmish")
    terms["skirmish"] = skirmish
    terms["entry"] = {
        need(s, n)["heading"]: paras(s[n]) for n in ("9.4.1", "9.4.2", "9.4.3", "9.4.4")
    }
    terms["objectives"] = {
        base_name(need(s, n)["heading"]): {"heading": s[n]["heading"], "body": paras(s[n])}
        for n in [f"9.6.{i}" for i in range(1, 10)]
    }

    terms["objects"] = {
        "Objects": paras(need(s, "9.7")),
        "Finding Objects": paras(need(s, "9.7.1")),
        "Carrying Objects": paras(need(s, "9.7.2")),
    }
    extraction = {}
    for p in paras(need(s, "9.7.7")):
        m = re.match(
            r"^(Friendly Lines|Enemy Lines|Extraction Point|Hold):\s*(.*)$",
            re.sub(r"<[^>]+>", "", p),
        )
        if m:
            extraction[m.group(1)] = m.group(2)
    if len(extraction) != 4:
        sys.exit(f"expected 4 extraction types, found {list(extraction)}")
    terms["extraction"] = extraction
    terms["variantObjects"] = {
        "Data Download": paras(need(s, "9.7.8.1")),
        "Remaining Intel": [
            re.sub(r"^Remaining Intel\s*[\u2013-]\s*", "", p) for p in paras(need(s, "9.7.8.2"))
        ],
    }

    # Weapon Features: the table plus the rules around it
    wf = need(s, "8.8.1")
    table = next((b for b in wf.get("body", []) if b.get("kind") == "table"), None)
    if not table:
        sys.exit("8.8.1 has no table")
    weapons = {}
    for row in table.get("rows", []):
        cells = [runs_html(c) if isinstance(c, list) else esc(str(c)) for c in row]
        if len(cells) != 7:
            sys.exit(f"unexpected Weapon Features row {cells}")
        weapons[cells[0]] = dict(
            zip(
                ["arc", "range", "attacks", "accuracy", "energy", "special"],
                cells[1:],
                strict=False,
            )
        )
    terms["weaponFeatures"] = {"rules": paras(wf), "weapons": weapons}

    features = {}
    for num in ("8.8.2", "8.8.3"):
        for p in paras(need(s, num))[1:]:
            m = re.match(r"^(.+?)\s*[\u2014\u2013]\s*(.*)$", p)
            if not m:
                sys.exit(f"cannot split feature line in {num}: {p[:60]}")
            features[re.sub(r"<[^>]+>", "", m.group(1)).strip()] = {
                "kind": "indestructible" if num == "8.8.3" else "effect",
                "text": m.group(2),
            }
    terms["features"] = features
    terms["featureRules"] = {
        "Zones - Features": paras(need(s, "8.8")),
        "Indestructible Features": paras(s["8.8.3"])[:1],
    }
    terms["bunkerEntrances"] = paras(need(s, "8.8.4"))

    special = {}
    for num, n in s.items():
        if re.match(r"^1[01]\.1\.\d+(\.\d+)?$", num):
            special[base_name(n["heading"])] = {
                "heading": n["heading"],
                "number": num,
                "body": paras(n),
            }
    terms["specialRules"] = special

    js = (
        "// Generated by tools/dzc/build_scenario_terms.py from data/dzc/rules-wiki.json.\n"
        "// Verbatim; do not edit by hand.\n"
        f"const DZ_TERMS={json.dumps(terms, ensure_ascii=False)};\n"
    )
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(js)
    print("objectives: {}".format(", ".join(terms["objectives"])))
    print("entry: {}".format(", ".join(terms["entry"])))
    print("extraction: {}".format(", ".join(extraction)))
    print("weapon features: {}".format(", ".join(weapons)))
    print("features: {}".format(", ".join(features)))
    print(f"special rules: {len(special)} (e.g. {', '.join(list(special)[:12])})")
    print(f"-> {os.path.relpath(OUT, ROOT)} ({len(js.encode('utf-8')) // 1024} KB)")


if __name__ == "__main__":
    main()
