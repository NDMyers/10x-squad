# Product-Grounded Orchestration

The squad's gates used to answer one question: is the paperwork consistent? This change makes the squad also answer the question the user actually asks: does the thing work, and is it good? It comes from a control experiment (November 2026) in which a single-session build of a small game beat the squad's build of the same kind of game on quality, in about one twenty-fifth of the wall-clock time, while the squad's own run reported green gates throughout. Follow-up runs then showed that much of that gap came from how the work was briefed, and that with an open brief the squad from this branch produced the builds the owner preferred; see "What the experiments showed".

## What went wrong, in the squad's own records

| Finding from the experiment | Where it showed up | Cause in the squad's design |
|---|---|---|
| Nobody judged the product. | The pilot report opens: "Nothing here judges how the game looks, sounds or feels." | Every gate measured conformance to the spec. Peter's checklist rejected subjective criteria, so they were dropped rather than graded. |
| Green did not mean working. | Ralph reported `ALL_PASS` on tickets where Cobalt then found MAJOR defects (FND, PLY, GFX). Zone tests passed against stubs and broke when real zones merged. A digest helper hashed every grid to the same value, so the determinism checks built on it could not tell which grid was drawn. | A passing test was treated as proof. Nothing required a test to be shown able to fail, or to run against the real integrated code. |
| Hand-backs were trusted as evidence. | The ledger records several builder summaries that were wrong (grid counts, which test was skipped). Art was accepted with every look judgement marked "UNVERIFIED". | The orchestrator sees only a builder's summary, and no artifact distinguished "I ran it and saw this" from "I believe this". |
| Review could reject but not improve. | Cobalt was the most valuable step, yet it reviewed diffs against the spec only. | The review gate demoted any finding that did not cite a spec ID and a `file:line`, so "I played it and got stuck" could only be a MINOR. |
| The builder was told not to think. | Anything the spec did not name was nobody's job. | Linus was defined as "No spec deviation" and routed to the cheapest model at the lowest effort. |
| Splitting coupled work created work. | A contract layer, stubs and replay hashes were 27% of the source; all 29 integration defects came from the split. | File-disjointness was treated as sufficient for parallel builders. |
| The plan was frozen before anything ran. | About 65,000 words of specs, then 37 change requests. | Specs fixed how, not just what and why. |
| Cost was unknown. | Neither run recorded tokens. | No cost record existed. |

## What changed

**Evidence classes.** `core.md` now defines OBSERVED, TESTED, GATED and UNVERIFIED, and DELIVER reports by class with a mandatory "Not verified by observation" list. Vivaldi may not present a gate result, a test count or a sub-agent summary as proof the product works.

**The builder observes and flags.** Linus hands back `## Changelist`, `## Deviations` and `## Observed`. He owns the detail the spec leaves open, must run what he built, and marks anything he could not run or see as `NOT_OBSERVED`. Deviating from a wrong spec is correct when flagged.

**Experience criteria (`Q#`).** Peter names the qualities no assertion can decide under `## Experience Criteria`, each with a threshold. They are opt-in per spec and then enforced mechanically:

- `validate-handoff --build` fails with `UNREPORTED_EXPERIENCE_CRITERIA` if the build is silent on any `Q#`, and returns an `observation` object (`observed`, `not_observed`, `unreported`).
- `validate-review` fails with `UNGRADED_EXPERIENCE_CRITERIA` if Cobalt did not grade one, and with `GRADED_WITHOUT_RUNNING` if a `PASS` comes from a review marked `NOT_RUN`. Any `FAIL` forces `effective_verdict: REQUEST_CHANGES` whatever the reviewer wrote. `product_check.unverified` tells Vivaldi the approval covers the diff only.

**Product review.** Cobalt uses the running product before reading the diff, with clean context. A finding may cite `PRODUCT_DEFECT` or a `Q#` and is proved by `Proof: Observed: …`; it needs no file path and is exempt from the cycle-2 file scope lock.

**Tests that can fail.** Ralph must test the real integrated code, show each AC's test failing for the right reason (`## Falsification`), run the main path end to end, and list what the tests do not establish (`## Not Covered`).

**Shape before tier.** Triage first decides Solo (default), Pipeline, or separate runs, using one test: if two builders would each need to know what the other decided, it is one task. Solo uses a one-page brief-form spec, one builder from start to finish, and sends review findings back to the same builder. `parallel_batches` from `partition-plan` is now necessary, not sufficient, for parallel builders.

**Builder routing.** The configure-tiers wizard no longer suggests low effort for the Builder lane, the "cheap builder executing a reviewed spec" rationale is removed from the routing docs, and Vivaldi warns once when the builder resolves to the lowest effort. Vivaldi still never changes a resolved value.

**Stuck builders ask.** Linus reports `BLOCKED:`; Vivaldi consults Einstein in advisor mode and continues the same Linus with the answer.

**Cost.** On Copilot, `record-cost` rebuilds `cost.md` from the session log, so every turn of a dispatch is counted, including resumed ones; elsewhere `cost.md` gets one hand-kept row per dispatch and totals at DELIVER, with figures that were not captured written as such, never estimated.

**Bounded builder turns.** Every dispatch or resume of Linus carries a scope and a call and time budget and ends in a `## Checkpoint`; Vivaldi decides at each checkpoint whether to continue, using the cost of the stretch just ended. Linus also stops and reports `BLOCKED:` after about ten calls that neither edit anything nor teach him anything new. The budget defaults (about 200 calls or 60 minutes) and the ten-call threshold are starting values that no eval has yet tuned.

**The request is the bar.** Added after the experiments below. Vivaldi passes the user's own words about ambition, scope and judging to Peter and to the builder; Peter is told not to turn an open request into a feature checklist and to write only the acceptance criteria whose absence the user would notice; Linus is told that meeting every `AC#` is the floor.

**One test run in Solo shape.** Added after the experiments. Ralph runs once, after the review approves; revisions before that go back to Cobalt alone.

**Ungraded is not approved.** Added after the experiments. An approval does not cover a `Q#` the reviewer could not grade, and DELIVER names each one as the user's to check.

**One polish pass.** Added after run E4. In Solo shape, `MINOR` findings on an approved review go back to the builder once, as one batch, followed by a narrow re-check. Later ones go on DELIVER's list unless the polish pass itself caused them or Vivaldi records why one blocks the user's stated bar.

**Re-test without the tester.** Added after run E4. When the tester's single run reports failures in Solo shape, the same builder fixes them, Vivaldi reruns the tester's saved suite itself, and the reviewer checks the fix narrowly.

**The scope lock no longer hides an observed regression.** Added after run E4. `validate-review` used to demote a blocking finding as `OUT_OF_CYCLE_SCOPE` in two cases it should not have: when the "previous review" had no blocking finding at all (an empty lock puts every file out of scope), and when a regression proved by `Proof: Observed:` cited the contract ID it broke instead of `PRODUCT_DEFECT`. Both now stand. A new complaint about untouched code with no stated observation is still demoted.

All of this is backward compatible: a spec without `## Experience Criteria`, a build without `## Observed` and a review without `## Product Check` validate exactly as before.

## What the experiments showed

Thirteen builds of the same game, Dusty Dash, judged by the owner by playing them. Prompts and the run table are in `evals/experiments/dusty-dash/`.

**Round one: every run given an eleven-item feature checklist.** The owner ranked the original solo build clearly best and a Sonnet solo build worst, with two Fable solo repeats, a solo build plus product review, a second Sonnet solo build and the squad from this branch all in between.

- The original beat its own two repeats. The repeats had been given a reconstruction of the brief: a feature list that called the game "small". The original had been given an open request ("the whole shebang", "I will judge the two side by side"). The repeats met the list in about 20 minutes and stopped; the original worked for about 33 and spent the difference on art, scenery and screens.
- So round one measured the checklist, not the arrangements. Its ranking among the checklist runs stands; its gap to the original does not.

**Round two: the open request, no checklist.**

| Run | Arrangement | Working time | Sub-agent tokens | Owner's ranking |
|---|---|---|---|---|
| E3 | Squad from this branch, Fable builder, one-page spec, request passed to the builder word for word | 2 h 17 min | about 0.8 million | Best of the four, with one defect: the view sways when the player changes direction |
| E2 | Squad from this branch, Sonnet builder, squad's normal brief-form spec | 3 h 10 min | about 1.19 million | Second |
| O1, O2 | Fable solo | 36 and 31 min | not recorded | "All right" |

Token figures exclude the orchestrator. E3's is the sum of each agent's last reported figure; if those figures are per segment rather than running totals it is about 1.28 million.

What follows from that:

- **The brief was the largest lever.** All four round-two builds had the richer look the checklist builds lacked, with either builder model and with or without the squad.
- **With an open brief the squad's builds were preferred to the solo builds.** That reverses the result this document started from. In round two the review step found things the builder had not (an ending too close to an existing game, garbled on-screen text, a game that kept playing when its window lost focus) and the same builder fixed them.
- **The squad costs four to six times the solo time.** Whether that is worth paying is the owner's call per piece of work; the experiment says only that it now buys something.
- **A stronger builder with a looser plan was cheaper, not dearer.** E3's Fable builder used about 306,000 tokens on its first build against 446,000 for E2's Sonnet builder, needed one revision instead of two, and finished 53 minutes sooner. E3 changed builder model and plan length together, so the gain cannot be assigned to either alone.
- **The tester did not earn its cost in Solo shape.** Across the three squad runs the tester ran six times, used between 233,000 and 318,000 tokens in each squad run, and no revision was ever driven by a test result. Limiting it to one run did not lower its cost: four runs in the first squad build cost about 293,000 tokens, one run in E2 about 318,000.
- **The one defect the owner found sat in a quality nobody graded.** E3's reviewer approved with feel and polish marked `NOT_GRADED`, because the harness rendered about two frames a second and played no sound. The swaying view is a feel defect. The squad reported the gap honestly and still shipped the defect: honest reporting is necessary and not sufficient.
- **"Green did not mean working" needs narrowing.** That row above describes the first squad run's own records and is accurate about them. But a mutation audit of the two original builds found both test suites caught all fifteen injected faults, and play found no logic defect in either. What reached the owner were defects of look and usability. Tests were not lying about logic; they were being read as a verdict on a product they do not measure.

**Round three: E3 repeated with a different builder.**

Run E4 repeated E3 with two routing cells changed: the builder ran on Opus at high effort instead of Fable, and the tester (Sonnet) at medium effort instead of high. Same request, same one-page spec rule, same squad rules, now carried by the squad itself.

| Run | Builder | Working time | Sub-agent tokens | First build | Revisions | Review passes |
|---|---|---|---|---|---|---|
| E4 | Opus, high | 5 h 12 min | about 1.33 million | 88 min, 368,000 tokens | 6 | 7 |
| E3 | Fable, high | 2 h 17 min | about 0.8 million | 52 min, 306,000 tokens | 1 | 2 |

The owner called the two builds give and take. E4 was better on mechanics, had ideas E3 lacked and fitted the screen; E3 had the better art. E3 has the swaying view and a small play area; E4 has spacing faults in its menus.

Where E4's time went, from its cost record:

| Part of the run | Time |
|---|---|
| First build | 88 min |
| First review (approved, seven `MINOR` findings) | 23 min |
| Revision 1 and its re-review: a level and HUD too close to an existing game, graded `MINOR` by the reviewer and treated as blocking by the orchestrator, plus five smaller defects | 42 min |
| Polish passes 2 and 3 with their re-checks | about 14 min |
| The tester's single run | 88 min |
| Three fix cycles after the tester's two failures, including three suite reruns by the orchestrator | about 1 h |

The parts sum to slightly more than the run because the tester overlapped the last polish re-check.

- **The builders came out level, with different strengths, and the Opus builder cost more overall.** Its first build took 36 minutes and about 60,000 tokens more than the Fable builder's. Its first review, though, was an approval with no blocking finding; the Fable builder's first review asked for changes on two. One run of each, so neither difference is established.
- **Most of the extra time was not the builder's first build.** Of the 2 h 55 min between the two runs, the first build accounts for 36 minutes. The rest came after it: one substantial revision, two short polish passes, a tester run two and a half times as long as E3's, and the fixes the tester's failures led to.
- **The polish loop was cheap in time and still worth bounding.** Passes 2 and 3 took about 14 minutes together. But pass 2 introduced a regression that pass 3 had to fix, and each pass drew new `MINOR` findings from the reviewer. Hence the one-pass rule above.
- **A test result drove a revision for the first time.** The tester's single run failed 2 of 36 tests, both edge cases: the game stalled when the browser could not start audio, and pixels were uneven at one fractional display scaling. The fixes took three cycles. The first fix for the scaling was exact at the tested window size and broke three others, which the reviewer caught by measuring the running game. The reworked display from those cycles is the likely reason the owner found that E4 fits the screen better; that link is an inference, not something measured.
- **The gate would have passed that regression.** The reviewer filed it as `MAJOR` with an observed proof, and `validate-review` demoted it and returned `APPROVE`; the orchestrator acted on the observation instead. The cause and the fix are under "The scope lock no longer hides an observed regression".
- **Lower tester effort saved nothing.** At medium effort the tester used about 256,000 tokens and 88 minutes, inside the 233,000 to 318,000 range of the earlier runs at high effort and far longer than E3's.
- **Feel and sound were ungraded again.** As in E3, the reviewer could not judge either. The owner's complaints about both builds (a swaying view, a small play area, menu spacing) are all things seen at real speed and real window size.

## What is deliberately not done yet

These are larger than a first step or need more than one run to settle.

- **Solo as its own routing tier.** Solo is a shape, routed on the existing `(persona, tier)` coordinate. A dedicated tier key would let the builder be configured differently for Solo work, but it changes the stored 30-cell matrix and forces every existing install to reconfigure.
- **Default builder model.** Round two favoured the strongest model in the Builder lane for work judged on taste. The repeat has now run (E4: only the builder model and the tester's effort changed). The owner rated the two builds level with different strengths, and the Opus builder's run was slower and dearer overall, though much of that was the loop after the first build rather than the builder. One run of each settles nothing, so the wizard's suggestion is unchanged.
- **Dropping the tester from Solo shape.** Rounds one and two would support it: no revision was driven by a test result. In E4 the tester's one run found two edge-case failures nobody else had, at the cost of 88 minutes and about an hour of fixes. It stays at one run.
- **A way to judge motion and sound.** No agent in these runs could see the game at full speed or hear it. Until one can, feel and audio are the user's to check, and DELIVER says so.
- **Mandatory product review at Lite.** The solo-plus-review run in round one showed no gain the owner noticed, under the checklist brief. Not re-run under the open brief.
- **Cost capture beyond Copilot.** `record-cost` reads the Copilot session log. Claude Code, Codex and Antigravity record no usage this way and keep the hand-kept rows.
- **Workflow board.** The monitor does not yet show the `observation` and `product_check` results.
- **Sentinel.** Unchanged; it reviews the diff, not the product.
- **Continuing a builder on Codex and Copilot.** `dispatch-claude.md` says how; the other dispatch contracts fall back to re-dispatch with `build.md` and the findings.
- **AC observation is advisory.** Only `Q#` is enforced in `## Observed`; unreported `AC#` are listed, not blocked, so existing builds still pass.

## Limits of the evidence

One game, one judge, and one run of most arrangements; the two solo repeats in each round show how far a single run can wander. Rankings are the owner's impressions from play, not scores. Solo token counts were not recorded, so cost comparisons across solo and squad rest on time. Two of the round-two runs were interrupted by a usage limit and resumed; their times exclude the pause.

The original changes are the ones the squad's own records support regardless of how the experiments came out: they make the squad say what it checked. The rules added afterwards (three after round two, two after run E4) rest on the experiments and should be revisited if a repeat disagrees. The scope-lock fix does not: it is a defect reproduced from E4's own review and spec.
