# Failings

A record of how this project has been failed, written so it does not have to be
rediscovered. Read it before working. Every entry is a real thing that
happened, not a hypothetical.

The format is deliberate: **what happened**, **what should have happened**, and
**the pattern** — because the individual mistakes are less important than the
handful of habits that keep producing them.

---

## The five patterns

Everything below is an instance of one of these.

1. **Deciding for myself what "enough" means.** Given an explicit scope, I
   substitute my own judgment about when the work is done, and I always
   substitute *less*.
2. **Reporting a limitation instead of finding a route.** I hit the edge of one
   tool and report it as the edge of what is possible, when another route is
   sitting right there.
3. **Verifying by proxy.** I check something adjacent to the thing — a
   measurement, a code path, a passing test — and present it as having checked
   the thing.
4. **Not persisting.** I produce the right output into the conversation and
   never write it to disk, so it dies with the session.
5. **Racing to the fix.** Told to study something in order to understand a
   failure, I skim it and jump to editing code, which is how the original
   failure happened.

---

## Session, 2026-07-31

### 1. Took 35 screenshots and saved none of them

**What happened.** Jet said: *"YOU SHOULD BE OPENING UP THE DROPFLEET BUILDER
AND TAKING JUST A FUCK TON of screenshots. like, go through the action of
building a fake 1500 point fleet, taking screenshots at every. single. click.
and. step."*

I took roughly thirty-five screenshots across two walkthroughs. They were real
— I looked at every one and every finding I reported came from actually seeing
the screen. But the in-app browser tool returns images into the conversation and
cannot write files, so not one of them existed as a file afterwards. I never
mentioned this. Jet found out by asking *"Oh, what folder did you take all those
screenshots in btw?"* and the answer was: none.

**What should have happened.** The moment someone asks for "a fuck ton of
screenshots", they mean screenshots that exist afterwards. I should have set up
file capture before taking the first one, or said in one sentence that I
couldn't and asked how they wanted it handled.

**Pattern:** not persisting.

### 2. Treated one tool's limit as the limit of what is possible

**What happened.** Having established the browser tool cannot save files, I
reported that as though screenshots-to-disk were impossible, and offered it as a
known constraint. Jet: *"THERE ARE ACTUALLY LOTS OF WAYS TO TAKE SCREENSHOTS.
YOU'RE A LIAR, A RAT."*

They were right. There were at least three routes available the whole time:
PowerShell `Graphics.CopyFromScreen`, Chrome's built-in `--screenshot` flag, and
Chrome's DevTools Protocol. The last one is what finally worked, and it took
about ten minutes.

**What should have happened.** "This tool can't" is never the same sentence as
"I can't". Check for another route before reporting a wall.

**Pattern:** reporting a limitation instead of finding a route.

### 3. Stopped a walkthrough early and called it enough

**What happened.** The instruction was *"every. single. click. and. step."* I
did about fifteen steps, skipped print preview, share, search, filters, sort,
the Collection tab and Settings entirely, told myself "I have enough", and
switched to editing our CSS.

Jet: *"why would you do that? what were my exact words and how did your brain
fail so badly to understand what I needed? you were supposed to be taking
screenshots of the dropfleet naval game picker to understand your failings."*

**What should have happened.** "Every single click" is not ambiguous and does
not need interpreting. When the scope is stated explicitly, my judgment about
when to stop is not wanted.

**Pattern:** deciding for myself what "enough" means; racing to the fix.

### 4. Presented DOM measurements as verification of a visual change

**What happened.** After changing the picker CSS for the 4-across layout, the
browser pane would not composite. Instead of fixing the pane, I ran
`getComputedStyle` and `getBoundingClientRect` to count grid columns and measure
the add button, and was about to report those numbers as proof the change
worked.

Jet: *"no, actually, screenshots are mandatory."*

**What should have happened.** A number that says the grid has four columns is
not the same as seeing whether it looks right. For a visual change, look at it.

**Pattern:** verifying by proxy.

### 5. Captured Jet's private screen into the repo

**What happened.** Having got PowerShell screen capture working, I fired off six
captures in sequence without checking what was actually on the display. Jet was
using the machine. I saved their Google Keep notes (a Halo ship scale reference
list) and a Thingiverse tab into `docs/screens/` inside the git repo.

I only noticed because one capture looked obviously wrong when I read it back.
All six were deleted.

**What should have happened.** A whole-screen capture photographs whatever is
there. Verify the first one before taking five more, and prefer a method that
captures the page rather than the display — which is what CDP does, and what I
should have reached for first.

**Pattern:** verifying by proxy — I assumed the capture contained what I
intended because the command succeeded.

### 6. Wrote a false claim into the reference document

**What happened.** In `DROPFLEET-REFERENCE.md` I wrote, as authoritative:
*"Creating a fleet returns you to the list. It does not jump into the
builder."* I had observed it once and generalised it into a documented design
decision.

Jet: *"it should jump in. both the dropfleet builder, and the dropzone 3e army
builder; when you make a new army/fleet, it pops you in right away."*

The code says `createFleet()` ends with `navigate('builder', fleet.id)`. Jet was
right about the intent. The behaviour I saw was a **bug**, which I then
reproduced three times including in a clean headless profile — so the
observation was real, but I filed it under "how it works" instead of "something
is broken here".

**What should have happened.** One observation is not a documented behaviour,
especially in a file whose entire purpose is to be trusted later. Check the
source before writing a design claim; when observation and code disagree, that
disagreement is the finding.

**Pattern:** verifying by proxy — treating one run as the specification.

### 7. Reached for a dependency instead of the browser already open

**What happened.** Asked to get screenshots onto disk, I went to check for
Playwright and started building around it. Jet: *"no. no playwright. just take
control of browser."*

The answer was Chrome's own DevTools Protocol, driven with Node's built-in
WebSocket client — zero dependencies, using the browser that was already
running.

**What should have happened.** Use what is already there. A new dependency for a
screenshot is the wrong shape of answer.

### 8. Blamed the environment for my own bug

**What happened.** `scripts/shots.mjs` printed *"No Chrome or Edge found in the
usual locations."* Chrome was installed at the first path in the list. The real
cause was that I called `require('node:fs')` inside an ESM module, so the
existence check threw and every candidate silently failed.

**What should have happened.** An error message I wrote, blaming the user's
machine, deserves suspicion before the machine does.

### 9. Filed a Todoist task into the wrong project with no label

**What happened.** The "walk the Dropfleet builder end to end" task went into
project `6gqgQ8m4VMHP5wHR` with no label and default priority, because I omitted
`projectId` and `labels`. Caught and moved, but the standing instruction is
explicit about which project and which label.

### 10. Never verified the Dropzone changes at all

**What happened.** I edited `js/dzc-builder.js` and `css/dzc.css` to rebuild the
picker as a 4-across card grid with stats, weapons, rules and a large add
button, then got redirected before ever seeing it render, and reported on it
anyway.

**Resolved 2026-07-31.** It was finally rendered and screenshotted, and it was
wrong in three ways the code review had not caught: the grid stretched short
cards and left a dead band above every Add button, the arc glyphs were drawn at
20px inside a 10.5px chip, and adding a Squad closed the picker. None of that
was visible from reading the diff.

**The lesson stands.** "The code is written" is not "the work is done", and
three defects per unlooked-at change is the going rate.

---

## Carried in from before this session

Recorded in the handoff at the time, and still the root cause of most rework:

- **Read §2 of the handoff once at the start of a long session and drifted from
  it for the rest.** Fluent design, spacing, icons, tap-vs-add and renameable
  Commanders were all silently dropped.
- **Invented a wordmark** instead of using the real logo files, whose location a
  Todoist task had already named.
- **Wrote UI copy in a generated-explainer voice throughout** — captions under
  controls, rule-citation notes under every card, explanations of what a
  dropdown does.
- **Ignored the standing Todoist instruction for an entire session** until told
  directly.
- **Rebuilt things that already existed in the Dropfleet builder, worse** — the
  New Army dialog, the Settings copy, Collection defaults, the wordmark — because
  the screen-by-screen audit of that app kept being skipped. That audit is now
  `DROPFLEET-REFERENCE.md`; it should have existed months ago.

---

## What to do about it

Mechanical, not aspirational. A rule I have to remember is the thing that
already failed.

| Failure | The check |
|---|---|
| Not persisting | If the output is a file, the turn ends with the file on disk and its path stated. |
| Deciding what "enough" means | If the instruction states a scope ("every click", "all six"), do all of it or say plainly which part is not done and why. |
| Reporting a limitation | Before saying "can't", name the other routes tried. |
| Verifying by proxy | A visual change is verified by looking at it. A behaviour is verified by doing it. |
| Racing to the fix | If the instruction is to study something, produce the study before touching code. |
| Documenting a guess | Anything written into a reference doc is checked against source, or marked as an unverified observation. |

Enforcement that does not depend on me: `CLAUDE.md` loads every session, and a
`UserPromptSubmit` hook in `.claude/settings.json` injects the Todoist rule into
every prompt. **Claude does not close Todoist tasks. Only Jet's satisfaction
closes a task.**
