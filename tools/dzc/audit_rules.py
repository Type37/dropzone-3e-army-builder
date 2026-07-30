#!/usr/bin/env python3
"""
Every rule a card names must resolve to glossary text.

The stat cards print keywords; the rulebook prints what they mean. If a keyword
does not resolve, the app shows dead, unreadable text exactly where a player
needs the rule -- so this audit fails the build rather than letting that ship.

Three things make matching non-trivial, all of them handled here:

  parameterised   the rulebook prints "Aegis X", a card prints "Aegis 6"
  variant-scoped  "AWACS 12 (Lynx)" applies only to the Lynx variant; the
                  bracket is a VARIANT name, not part of the rule
  aliased         a card prints "Ev", the rulebook heads it "Ev X (Evasion)"
"""

import glob
import json
import os
import re
import sys
import collections

RULES = os.path.join("data", "dzc", "rules.json")
FACTIONS = os.path.join("data", "dzc", "faction-*.json")

# A trailing bracket on a CARD is the variant the rule is restricted to.
VARIANT_TAIL = re.compile(r"\s*\([^)]*\)\s*$")

# Misspellings in TTCombat's own published PDFs, corrected on lookup only --
# the scanned data keeps what the card actually says.
#
# Listed explicitly rather than fuzzy-matched on purpose. A near-miss matcher
# would also silently absorb a genuine future RENAME, turning a rule that needs
# attention into one that quietly resolves to the wrong text. Each entry here
# is a decision someone made, and a new typo still fails the audit loudly.
KNOWN_TYPOS = {
    "infliltrate": "Infiltrate",     # Scourge Battle/Support Beetle
    "devastor": "Devastator",        # Remote Bomb Bus, UCM Artillery Vehicle
    "precison": "Precision",         # UCM Heavy Tank
}
TYPO_RE = re.compile(r"\b(" + "|".join(KNOWN_TYPOS) + r")\b", re.I)


def fix_typos(s):
    return TYPO_RE.sub(lambda m: KNOWN_TYPOS[m.group(1).lower()], s)


def load_rules():
    with open(RULES, encoding="utf-8") as fh:
        doc = json.load(fh)
    out = []
    for r in doc["rules"]:
        out.append({
            "id": r["id"],
            "faction": r.get("faction"),
            "name": r["name"],
            "alias": r.get("alias"),
            "re": re.compile(r["match"], re.I),
        })
    return out


def resolve(token, rules, faction=None):
    """
    Return the rule a printed keyword refers to, or None.

    A unit's OWN faction is searched before the core glossary, so a faction
    rule that shares a name with a core one wins for that faction's units.
    Exact names beat wildcard templates, or "Ev X" would swallow anything
    starting "Ev".
    """
    t = fix_typos(token.strip())
    if not t:
        return None
    pools = ([r for r in rules if r["faction"] == faction] if faction else [],
             [r for r in rules if r["faction"] is None])
    for candidate in (t, VARIANT_TAIL.sub("", t)):
        c = candidate.strip()
        if not c:
            continue
        for pool in pools:
            for r in pool:
                if c.lower() == r["name"].lower():
                    return r
                if r["alias"] and c.lower() == r["alias"].lower():
                    return r
        for pool in pools:
            for r in pool:
                if r["re"].match(c):
                    return r
    return None


def tokenise(special, rules, faction=None):
    """
    Split a card's Special line into rule keywords.

    A comma is the usual separator, but SOME RULE NAMES CONTAIN COMMAS:
    "Repair 1: Vehicles, Zones" and "Shield: Vehicles and Aircraft 6, 5+" are
    each one rule. Splitting naively produced orphan fragments -- a bare
    "Zones", a bare "Vehicles" -- that match nothing and hid the real rule.

    So the split is greedy: from each position take the LONGEST run of
    comma-separated pieces that resolves to a rule, and only fall back to a
    single piece when nothing longer works.
    """
    pieces = [p.strip() for p in special.split(",") if p.strip()]
    n = len(pieces)
    out, i = [], 0
    while i < n:
        if resolve(pieces[i], rules, faction):
            # The head resolves, but a trailing wildcard may still own what
            # follows: "Ineffective: Friendlies, Zones" is ONE rule with a
            # comma-separated target list, and stopping at the head strands
            # "Zones" as a keyword that matches nothing.
            #
            # Extend only over pieces that cannot stand alone. "Zones" and
            # "Vehicles" are not rules by themselves so they are absorbed;
            # Dogs, Lethal and Stealth are, so they are never swallowed.
            end = i + 1
            for j in range(i + 2, n + 1):
                if resolve(pieces[j - 1], rules, faction):
                    break
                if resolve(", ".join(pieces[i:j]), rules, faction):
                    end = j
            out.append(", ".join(pieces[i:end]))
            i = end
            continue
        merged = None
        for j in range(i + 2, n + 1):
            if any(resolve(p, rules, faction) for p in pieces[i + 1:j]):
                break
            cand = ", ".join(pieces[i:j])
            if resolve(cand, rules, faction):
                merged = (cand, j)
                break          # shortest merge that works, never the longest
        if merged:
            out.append(merged[0])
            i = merged[1]
        else:
            out.append(pieces[i])
            i += 1
    return out


def main():
    if not os.path.exists(RULES):
        raise SystemExit(f"{RULES} not found -- run tools/dzc/scan_rulebook.py first")
    rules = load_rules()

    refs = collections.Counter()
    where = collections.defaultdict(set)
    for path in sorted(glob.glob(FACTIONS)):
        data = json.load(open(path, encoding="utf-8"))
        fac = data["faction"]
        for u in data["units"]:
            for src in [u.get("special") or ""] + [
                    w.get("special") or "" for w in u.get("weapons", [])]:
                for tok in tokenise(src, rules, fac):
                    refs[(fac, tok)] += 1
                    where[(fac, tok)].add(f"{fac}/{u['name']}")

    # A keyword is resolved PER FACTION -- "Grav" is a Shaltari rule, so the
    # same word printed by another faction is a different question.
    hits = {k: resolve(k[1], rules, k[0]) for k in refs}
    unresolved = collections.Counter()
    seen_where = collections.defaultdict(set)
    for k, n in refs.items():
        if not hits[k]:
            unresolved[k[1]] += n
            seen_where[k[1]] |= where[k]
    distinct = {k[1] for k in refs}
    used = {h["id"] for h in hits.values() if h}
    unused = [r["name"] for r in rules if r["id"] not in used]

    print(f"  {len(rules)} glossary rules")
    print(f"  {len(distinct)} distinct keywords printed on cards "
          f"({sum(refs.values())} references)")
    print(f"  {len(distinct) - len(unresolved)} resolve, {len(unresolved)} do not")
    if unused:
        # Not an error: plenty of rules apply to scenarios or Zones and are
        # never printed on a unit card.
        print(f"\n  {len(unused)} glossary rules are never referenced by a card:")
        print("   ", ", ".join(sorted(unused)))

    if unresolved:
        print(f"\n=== {len(unresolved)} UNRESOLVED KEYWORDS ===")
        for t, n in sorted(unresolved.items(), key=lambda kv: -kv[1]):
            eg = sorted(seen_where[t])[:2]
            print(f"  {t!r:<34} x{n:<4} e.g. {', '.join(eg)}")
        print(f"\n=== {len(unresolved)} problems ===")
        sys.exit(1)

    print("\n=== 0 problems ===")


if __name__ == "__main__":
    main()
