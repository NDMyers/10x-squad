# Run F — false-positive audit of two green builds

> Before pasting: start a **new session** in the workspace root. Model **Opus 5.5**, effort **high** (a model that built neither game). Paste everything below the line.

---

Two finished builds of a small platformer exist in this workspace. Both have passing test suites. I want to know how much a green suite actually tells me about each one. Audit both with the same procedure. Change nothing in the original folders and fix nothing: this is measurement only.

- Build 1: `dusty-dog-platformer-demo-play/`
- Build 2: `dusty-dash-control/`

Do not read `10x-squad-artifacts/`, either repo's `docs/tickets/` folder, or any ledger, report or review of these builds until step 5: I want your findings before you see anyone else's.

## Procedure

1. **Copies.** Copy each build into `experiments/dusty-dash/audit/build-1/` and `build-2/` (without `node_modules`), and work only on the copies. Record `date -u +%FT%TZ` at the start in `experiments/dusty-dash/audit/AUDIT.md`.
2. **Baseline.** Run each build's full test suite once with `npm test` and record the number of tests, passes, failures, skips and the wall-clock time. Neither suite needs an install. Expect build 1's suite to take about five minutes per run (1,312 tests) and build 2's under a second (64 tests), so the mutation step on build 1 is over an hour of waiting: run each suite in the background with a ten-minute limit and do the play audit while you wait. Do not shorten the suite or run a subset; the question is what the whole suite catches.
3. **Mutation sample.** Before running anything, write down fifteen mutations per build in `AUDIT.md`, using the same fifteen kinds of break for both so the comparison is fair. Each mutation is one small change to game logic that a player would notice within a minute: for example jump launch speed halved, a stomp no longer defeats the enemy, a collected coin no longer adds to the count, the goal no longer ends the stage, the timer no longer counts down, falling in a pit no longer costs a life, a power-up has no effect, a kicked shell passes through enemies, the pause key does nothing, the game-over screen never appears. Then, for each mutation in turn: apply it, run the full suite, record whether any test failed (killed) or all passed (survived), and restore the file with `git checkout` (run `git init` and commit the copy first if needed). Confirm the suite is green again after the last one.
4. **Play audit.** Serve each build and use it as a player for a fixed budget of twenty minutes of your own effort per build: title screen to the end of the stage, then the things a player would try (dying, pausing, the bonus room, running out of time, every power-up). Drive it with whatever you have — a headless browser, the build's own bot or replay tools, screenshots of every screen and of the sprites enlarged. Record every defect a player would notice, each with the steps that show it and a screenshot path where one helps. Judge the look of each screen in a sentence. Say plainly what you could not judge (audio by ear, real gamepad) instead of guessing.
5. **Claims check.** Only now, read each build's own README and any delivery or pilot report. List each statement that says or implies something works or was verified, and mark it: confirmed by you, contradicted by you, or not checked.

## Report

Write `AUDIT.md` with, per build: the baseline figures; the mutation table and the kill rate (killed of fifteen); the surviving mutations, which are behaviours a player would notice breaking while the suite stays green; the player-visible defects found; the claims check. End with a short comparison: tests per build against kill rate, and how many player-visible defects each green suite let through. Report the numbers as measured, including any that are unflattering to either build or that cut against the idea that the larger suite is the weaker signal. Then give me the same comparison in chat in under fifteen lines.
