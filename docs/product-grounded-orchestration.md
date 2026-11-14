# Product-Grounded Orchestration

The squad's gates used to answer one question: is the paperwork consistent? This change makes the squad also answer the question the user actually asks: does the thing work, and is it good? It comes from a control experiment (November 2026) in which a single-session build of a small game beat the squad's build of the same kind of game on quality, in about one twenty-fifth of the wall-clock time, while the squad's own run reported green gates throughout.

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

**Cost.** `cost.md` gets one row per dispatch and totals at DELIVER; figures that were not captured are written as such, never estimated.

All of this is backward compatible: a spec without `## Experience Criteria`, a build without `## Observed` and a review without `## Product Check` validate exactly as before.

## What is deliberately not done yet

These depend on the experiments in `evals/experiments/dusty-dash/` or are larger than a first step.

- **Solo as its own routing tier.** Solo is a shape, routed on the existing `(persona, tier)` coordinate. A dedicated tier key would let the builder be configured differently for Solo work, but it changes the stored 30-cell matrix and forces every existing install to reconfigure. Decide after runs A and B show which builder model the Solo shape needs.
- **Default builder model.** Whether the wizard should recommend the strongest model for the Builder lane, or a cheaper model at high effort with the advisor, is what runs A and B measure.
- **Mandatory product review at Lite.** Run C measures what a product review adds on top of a solo build.
- **Cost capture in the runtime.** `cost.md` is written by Vivaldi. A `record-cost` command and totals in `advance-phase` would make it deterministic.
- **Workflow board.** The monitor does not yet show the `observation` and `product_check` results.
- **Sentinel.** Unchanged; it reviews the diff, not the product.
- **Continuing a builder on Codex and Copilot.** `dispatch-claude.md` says how; the other dispatch contracts fall back to re-dispatch with `build.md` and the findings.
- **AC observation is advisory.** Only `Q#` is enforced in `## Observed`; unreported `AC#` are listed, not blocked, so existing builds still pass.

## Limits of the evidence

One run of each approach, with different art briefs and no token counts. The changes above are the ones the squad's own records support regardless of how the experiments come out: they make the squad say what it checked. The routing defaults are the part that should move with the results.
