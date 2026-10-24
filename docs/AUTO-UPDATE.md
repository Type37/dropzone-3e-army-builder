# Automatic update: Claude's part

The monthly run (2nd weekday of the month) in `.github/workflows/sources.yml` found
that TTCombat published a new release of a source this app is built from
(`check.json`), downloaded the sources into `rules/`, and ran the whole pipeline:
`tools/dzc/rebuild.py` (scan plus every audit), then `scripts/test-all.mjs`. One of
those stopped. `update.txt` is its output and ends where it stopped. You are called
to get it through, and for nothing else.

Read `CLAUDE.md` and `FAILINGS.md` first. They hold for you too.

## How

1. Read the end of `update.txt` and find the first thing that failed:
   - **Download** (`## Download`): usually a renamed file the patterns in
     `SOURCES` in `tools/dzc/fetch_sources.py` no longer match. Fix the pattern.
   - **Rebuild or an audit**: the scanner met something on the new cards it does
     not read (a new layout, a keyword, a weapon cell), or a rule moved. Fix the
     scanner (`tools/dzc/scan_statcards.py`, `scan_rulebook.py`) or the audit's
     expectation, never the generated data by hand: the next rebuild would undo it.
     Run `uv run python tools/dzc/rebuild.py` until it passes.
   - **Tests**: most often `scripts/test-dzc-sources.mjs` reporting that a printed
     keyword now opens a different rule, or a new keyword. Check each new mapping
     against the card and the rulebook. When every one is right, accept them with
     `UPDATE_RULE_SNAPSHOT=1 node scripts/test-dzc-sources.mjs`.
2. Look at the cards you changed handling for (`rules/*.pdf`), not only at the
   audits: "the audit passes" is not "the card is right" (FAILINGS.md, 15 and 16).
3. Finish with `uv run python tools/dzc/fetch_sources.py --record` and
   `node scripts/test-all.mjs` passing.

The workflow then reruns everything, writes the What's New entry and the
"Updated ..." line, raises the build number, and commits only if all of it passes.

## Do not

- commit, push, open issues or pull requests. The workflow does that.
- add PDFs or notes to the repo. `rules/` is a download folder and is ignored.
- guess. If the cards cannot settle something (two documents disagree, a rule
  needs builder behaviour you cannot implement with confidence, a card is
  unreadable), write `NEEDS_JET.md`: what changed, what you did, and the one
  question. That is the only thing that emails Jet, so use it only when it is
  truly needed.
