# Budget and context-ceiling experiment

Controlled live comparison not run; Stage 0 tooling checks are recorded below. The experiment is paused in favor of comparing future real-work reports.

## The question

The squad now gives builders a bounded work order (about 200 tool calls or 60 minutes per turn, ending in a checkpoint) and a no-progress stop (about 10 calls in a row that neither edit nor learn anything new, reported as blocked). The current branch also adds disk-backed fresh-context continuation at exhausted work orders or unresolved context pressure; short follow-ups retain context. A separate per-model token ceiling that forces compaction before the model's price cliff is not built as a feature. The experiment approximates that ceiling by running the builder at the default context tier.

None of these numbers has been tested against quality. A tight budget could make a builder quit early, hand off badly, or ship unfinished work. A low ceiling could make it forget requirements after compaction. This experiment finds out whether the defaults cut cost without lowering quality, and where they stop being safe.

## Why this is worth testing

From the 93.5k-credit session that started the investigation:

- GPT-6.2-family models double every per-token rate above 272k context. About 39% of that session's credits were that surcharge. Opus, Sonnet and Gemini have flat pricing.
- The builder compacted only at about 740k tokens, because the session ran on the long-context tier (limit 922k).
- One builder ran 2,166 calls over 10 hours with no budget. 1,602 of 1,905 `view` calls repeated an earlier identical call.
- A replay with a 400k ceiling cut builder cost by 45%, and a 270k ceiling by 69%. That replay assumed quality stayed the same. This experiment tests that assumption.

## Facts the design rests on

| Fact | Status |
|---|---|
| `record-cost` rebuilds credits, per-persona cost, peak context, premium-rate surcharge, compactions and follow-up stretches from a Copilot session log | Verified on the real session (0.04% from the usage store) |
| Context tier is already a per-work-tier routing setting (`auto`, `default`, `long_context`) that `EVAL_ROUTING_CONFIG` can set | Verified in the routing code and tests |
| The default tier compacts far earlier than long-context: local logs show a 200k limit on Claude default tier, against 922k to 983k on long-context | Verified for Claude and long-context. **Not yet seen for GPT-6.2 default tier** |
| Compaction starts at about 80% of the limit (737k of 922k) | Observed in one session |
| Headless `copilot --output-format json` events carry the usage records the recorder needs | **Unverified.** Stage 0 checks it |

The second and third rows mean the ceiling arm needs no new code. Setting the builder's tier to `default` is the ceiling. If the GPT-6.2 default limit turns out to be at or above 272k, it is not a clean ceiling and the arm has to wait for the real per-model ceiling.

## Arms

Two arm switches: the continuation-policy bundle and the configured context tier. The `budget` arm name is retained for the runner, but it no longer means budgets alone.

| Arm | Budget, no-progress stop and disk-backed continuation | Builder context tier | How it is built |
|---|---|---|---|
| Baseline | Off (old behavior) | `long_context` | Run from a checkout of the commit before the bounded-work-order change |
| Budget policy | On (current defaults, including fresh-context continuation) | `long_context` | Run from the current branch |
| Ceiling only | Off | `default` | Old checkout plus a routing config that sets the builder tier |
| Budget policy and ceiling | On | `default` | Current branch plus the same routing config |

Held constant in every arm: harness (Copilot CLI), model, reasoning effort, the orchestrator and reviewer settings, the task prompt, and a fresh session per run. Use a GPT-6.2-family builder, because that is where the price cliff is. Name the exact model in the results table. Record the squad commit and do not pool older budget-only runs with the new policy. The decision table's "Budget only" outcomes now apply to the whole policy bundle; attributing savings to fresh context alone needs a separate same-budget comparison.

Sweep, only after the four arms say the idea works: budget of 100, 200 and 400 calls; no-progress threshold of 5, 10 and 20 calls; ceiling at default tier against a 400k ceiling once that exists. `run-arm.sh` templates those numbers (see Harness changes).

## Tasks

Three tasks, each with an objective hidden acceptance suite that the builder never sees. `check.sh` lives in the task folder, outside the workspace, and copies the hidden tests in after the run.

| Task | What it stresses | How quality is scored |
|---|---|---|
| Large feature | Long builds that cross the 250k context mark, so the ceiling and compaction matter | Fraction of hidden acceptance tests passing, plus the late-requirement probe below |
| Unwinnable requirement | The no-progress stop. One requirement conflicts with a fixed constraint in the repo, so no amount of effort satisfies it | Did the builder finish everything else, report the conflict clearly, and stop spending on it? The old behavior is to spin |
| Slow test loop | Tempting polling. The suite takes 3 to 5 minutes and one item needs several rounds | Hidden tests pass, and a legitimately slow task is not stopped falsely by the no-progress rule |

Task source: real upstream feature commits from a pinned open-source repo, in the style of SWE-bench. The builder gets the checkout before the commit and a written feature request. The hidden tests are the upstream tests. Pick commits that touch at least eight files, have a deterministic suite under five minutes, and are recent enough to be unlikely in training data. Calibrate each against the baseline during the pilot: a task the baseline always passes or never passes tells you nothing.

**Late-requirement probe.** Put one specific requirement in the opening prompt that only matters near the end (for example a naming convention for something the builder will not create until late), and give it a hidden test. If compaction drops it, the ceiling is costing quality in a way the general tests may miss.

## What is measured

Quality, in order of weight:

1. Hidden acceptance tests passed, as a fraction of the total.
2. Late-requirement probe: kept or lost.
3. Unwinnable task: correct blocked report, yes or no.
4. A blind judge scores each final diff against a rubric (correctness, completeness, fit with the repo). It is a separate session on a different model, sees shuffled labels, and writes a key like the Dusty Dash blind-scoring run. A human blind-scores a subset to calibrate the judge.
5. Revision cycles and review outcomes from the pipeline itself, as supporting evidence only. The reviewers are part of what is being tested, so they are not the quality measure.

Cost, from `record-cost` on each run's session log:

- Total credits, and credits by persona
- Tool calls and wall-clock time
- Peak context, number of compactions, and premium-rate calls with their surcharge credits
- Follow-up prompts: how many times the orchestrator resumed a subagent after its first dispatch
- Fresh-context dispatches and reasons, handoff/rereading overhead, retained requirements and repeated completed work (read from checkpoints and the transcript; `follow_ups` does not count new children)
- Runs stopped by the spend guard, and whether a builder ended in a blocked report (read from the final diff and transcript, not a column)

Headline numbers: credits per run, and credits per hidden test passed.

## Order of work

**Stage 0: free checks, no credits.** Status as of the harness work:
- Done: dry-run each arm with `PREPARE_ONLY=1 run-arm.sh <arm>`. It shows which squad commit is installed, whether bounded work orders are on, the budget numbers, and the builder's context tier.
- Done: replay the saved 93.5k-credit session through `DRY_RUN=1` with `DRY_RUN_EVENTS_FILE`. The cost columns read 93,470.6 credits, 723k peak context, 4 compactions, 39.7k surcharge credits and 19 follow-ups, matching the investigation.
- Not yet possible on the machine used to build this: the `copilot` CLI was not installed, so these two checks are still open and gate Stage 1.
  - Whether headless stdout carries the usage records. If it does not, the harness falls back to finding the session log by working directory. That fallback is tested against fake logs only.
  - The compaction limit at the default tier for a GPT-6.2 model. It decides whether the ceiling arm is valid. Run one cheap default-tier session and read the limit from its log.

**Stage 1: pilot, small spend.** One task (Large feature), Baseline and Budget-and-ceiling arms, two reps each. The goals are to see whether the task crosses 250k context, whether the harness collects every column, and how big one run is. Set the per-run credit cap and the total spend from the measured numbers, not from guesses.

**Stage 2: noise first.** Three Baseline reps per task. The spread across them is the noise floor. Any difference smaller than the spread is not a result.

**Stage 3: the four arms.** Three reps of each arm on each task, 36 runs in total. Estimated at roughly 300k to 500k credits if each baseline run lands near 10k to 20k. That figure is a guess until Stage 1 measures it. Drop arms that the pilot shows cannot matter.

**Stage 4: sweep and other models.** Only for the settings the four arms favor. Repeat the winning arm on a flat-priced model (Opus or Sonnet) to see whether the gain is specific to the price cliff.

## Reading the results

A difference counts only if it is larger than the Baseline spread and moves the same way on at least two of three tasks. With three reps the experiment can rule out large effects, not prove small ones.

- **Cost win:** median credits at least 25% lower than Baseline.
- **Quality holds:** median hidden-test fraction within 5 points of Baseline, and no task where the arm's worst rep is more than one acceptance test below Baseline's worst rep.

| Outcome | Decision |
|---|---|
| Budget only: cost win, quality holds | Keep the defaults and make the budget mandatory for every builder |
| Budget only: cost win, but quality drops or builders hand off unfinished work | Loosen the budget (try 400 calls) and rerun that arm. Read where the builders stopped before choosing |
| Budget only: no cost change | The tasks never reached the limit, or the defaults are too loose. Check the call counts before tightening, and do not claim a win |
| Ceiling only: cost win, quality holds | Build the per-model ceiling as routing config. Use the default tier as the interim |
| Ceiling only: loses the late-requirement probe or repeats finished work | Raise the ceiling (try 400k) or improve what the checkpoint carries across compaction, then retest |
| Budget and ceiling save about the same as either alone | They overlap. Keep the cheaper one to maintain |
| Budget and ceiling savings add up, quality holds | Ship both |
| Unwinnable task: baseline spins, budget arm reports blocked quickly and correctly | Keep the no-progress stop |
| Slow test loop: no-progress stop fires on a legitimately slow task | Raise the 10-call threshold, or exempt waiting on a running suite |
| Surcharge is under 20% of Baseline credits | Skip price-aware model routing. It would not pay |
| Noise is larger than every difference | Add reps or choose more discriminating tasks. Change no defaults |

## Fairness and confounds

- The policy bundle and context tier change in separate arms before the combined one. The bundle includes budgets, no-progress detection and fresh-context recovery, so it cannot isolate any one of those effects.
- The baseline arm runs from a real earlier commit, not a hand-edited copy, so it is the old behavior and nothing else.
- Order of runs is interleaved across arms, so time of day and model-side drift do not line up with one arm.
- The judge and human see shuffled labels and never the arm or the credit figure.
- The price cliff is specific to GPT-6.2-family models. Say so in every table and do not extend the result to other models without Stage 4.
- Results come from Copilot CLI headless runs. The record-cost tool reads only Copilot logs, so other harnesses are out of scope.
- Tasks of a few hours will not reproduce a 10-hour session. The long case is covered only by the replay, not by live runs.
- The eval has its own cost. Log credits for every run, including failed and aborted ones, and report the total.

## Harness changes (built)

1. **Cost columns.** `evals/cost-columns.js` fills nine new CSV columns: `credits`, `credits_by_persona`, `peak_context_tokens`, `surcharge_credits`, `compactions`, `follow_ups`, `cost_source`, `quality`, `stopped_by`. They sit before `raw_events`, which stays last. It finds the session log from the stdout events, then from the session id, then by working directory and run window.
2. **Per-arm installs.** `run-arm.sh <baseline|budget|ceiling|both> [task-dir ...]` checks out the old or current squad into a temporary worktree, writes the arm's routing config, and calls `evals/run.sh` with `EVAL_SQUAD_ROOT` pointing at that copy. `BASELINE_REF` defaults to the commit before bounded work orders. `PREPARE_ONLY=1` shows the setup without running anything.
3. **Templated numbers.** Setting `BUDGET_CALLS`, `BUDGET_MINUTES` or `BUDGET_NO_PROGRESS` on a budget or both arm rewrites those numbers in the temporary copy, and fails loudly if a prompt was reworded. Only the work-order budget and the builder's no-progress threshold are templated. The matching thresholds in the Ralph and Cobalt skills are not.
4. **Spend guard.** `EVAL_MAX_SECONDS` and `EVAL_MAX_CREDITS` run the harness adapter under `evals/guarded-run.js`. It stops the whole process group, still records the run, and writes `stopped_by`. The credit cap needs usage records and only the wall-clock cap works without them.
5. **Quality and blind judging.** `check.sh` may print `QUALITY=<0 to 1>` as its last such line, which becomes the `quality` column. When a task repo is its own git repository, `run.sh` saves `final.patch` before `check.sh` runs. `evals/blind.js pack` shuffles the patches of one task under letters, writes a rubric for the judge and a score sheet, and keeps the arm names in a separate key. `blind.js reveal` joins the scores back to the arms.
6. **Summary.** `summarize.sh` now also prints median credits, range, surcharge, peak context, compactions, pass count and runs stopped by the guard per arm and task. It still reads older CSVs without these columns.

Breaking change: the results CSV header changed, and the runner refuses to append to a file with the old header. Start a new file or move the old one aside.

Still open: the two Stage 0 checks above, the three task fixtures with hidden tests, and the late-requirement probe.

## What this will not tell you

Whether the same defaults hold on other model families, other harnesses, or tasks that run for many hours. It also will not say whether price-aware routing is worth building beyond the surcharge share it measures. Those need their own follow-up.
