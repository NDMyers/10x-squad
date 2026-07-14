# 10x-Squad — Evaluation Plan (the "quantitative proof" machinery)

> **HISTORICAL / SUPERSEDED (2026-07-13).** The model-routing portions of this plan — Auto-first routing, private-PR promotion gates, policy arms, and the manual-tier / higher-tier model vocabulary — are **retired** by the v4 configurable work-tier routing decision (see `MODEL-ROUTING.md` in this directory; operative design lives in the `Accrualify/10x-squad` repo). Model selection is now user due diligence via external benchmarks; deterministic squad-conformance tests live in the repo (`npm test`). The prompt/pipeline-quality eval machinery described below (seeded-bug suites, isolation probes, check-sync parity) is NOT model-ranking and may still be revived separately if baselining is pursued.

Goal: every claim of the form *"change X made the squad better"* must be backed by a delta on a frozen task suite, attributed to a specific commit of the prompt sources. This document defines the metrics, the experimental protocol, and the harness scaffolded in [`evals/`](evals/).

**Dual-harness note (v2):** the squad deploys to GitHub Copilot (primary) and Claude Code (port). This harness runs headlessly on the Claude side only — which is fine for most comparisons (skill wording, gates, subagent isolation are testable there), but Copilot-side conclusions require manual spot-runs scored with the same `check.sh`/rubrics. Never generalize a single-harness result to both.

---

## 0. Precondition metric: deployment parity

`./check-sync.sh` — verifies all four copies agree (live `.github/`, installer assets, corpay-agents upstream), the installer manifest covers every live skill, and every path the Claude port references resolves. **Exit code = failure count.**

Baseline reading (2026-07-12): **14 failures** (6/6 skills drifted, Vivaldi ahead of its source, Sentinel missing from installer manifest, 6 dangling port references). Run it before every eval session and in the improvement loop; eval results collected while parity fails describe *whatever mixture happens to be deployed*, so record the parity count alongside every suite run until it reaches 0.

Post-adoption reading (same day, after ladder step 2 + instrument categorization): **SOURCE 0 · UPSTREAM 7 · PORT 6** (total 13; the categorized instrument also added an upstream-Vivaldi check the v1 script lacked, so totals aren't 1:1 comparable — categories are the meaningful numbers). SOURCE must stay 0 permanently; UPSTREAM clears via a corpay-agents PR; PORT clears at ladder step 4.

---

## 1. What to measure

### Outcome metrics (does the work succeed?)
| Metric | Definition | How captured |
|---|---|---|
| **pass@1** | fraction of tasks whose deterministic `check.sh` exits 0 on a single attempt | `check.sh` per task |
| **pass^3** | fraction of tasks passing **all 3** repetitions — reliability, not luck. An agent pipeline's job is consistency; pass@1 hides flakiness | 3 reps per task |
| **seeded-defect recall** | of N bugs deliberately planted for a review task, how many did the review stage report? Plus false-positive count | seeded review tasks (§3) |
| **spec fidelity** | 1–5 rubric score: did the build implement the spec exactly, with deviations logged? | LLM judge + your spot-check on disagreements |

### Cost metrics (what did it burn?)
| Metric | Definition | How captured |
|---|---|---|
| **cost/task** | `total_cost_usd` from `claude -p --output-format json` (API-equivalent cost; on your Pro plan it's the comparable-spend number, not a bill) | harness |
| **turns, wall time** | `num_turns`, `duration_ms` from the same JSON | harness |

### Process metrics (did the system behave like the system?)
| Metric | Definition | How captured |
|---|---|---|
| **protocol adherence** | required artifact fields present (frontmatter contract), tier emitted with predicate, review template complete | 10-line validator script over `.10x/` output |
| **gate violations** | count of APPROVEs without a passing gate, missing SESSION updates, dangling skill references | hooks/scripts; target is literal 0 |

Anthropic's multi-agent work found token spend explains most performance variance between agent configurations — which cuts both ways: you must show quality gains are *not* just "spent more," and cost reductions don't quietly pay for themselves in quality. Always read outcome and cost columns together.

---

## 2. Experimental protocol

1. **Freeze the suite.** Tasks never change mid-comparison. Extending the suite = new suite version (`tasks/` is in git).
2. **Variants are git branches of `~/.claude`.** `baseline-v0` (tag on `ae14ae7`) vs `v2-real-subagents`, etc. Check out the branch, run the suite, check out the next. The `prompt_sha` column makes every row attributable.
3. **3 reps minimum per task per variant.** Single samples lie (the writing-skills micro-testing rule: 5+ for wording tests; 3 is the floor for expensive full-pipeline runs).
4. **One change per comparison.** Land F-findings as separate commits; run the suite per commit. If you batch five fixes and the numbers move, you've learned almost nothing.
5. **Pin the model.** `--model` explicitly in `CLAUDE_FLAGS`; a model version change invalidates cross-run comparison.
6. **Honest statistics at n≈5–10 tasks:** report raw counts, look for *large* effects (pass^3 moving 2/5 → 5/5, cost halving). Skip p-values; at this n they'd be theater. Directional consistency across tasks is your signal.
7. **Judges never share context with generators** (that's F2 as an eval rule): grade with a fresh `claude -p` call, rubric in the prompt, generator's reasoning excluded — grade the artifact, not the story.

## 3. The task suite (start with 5, grow to ~20)

Mirror your real work distribution (Rails + React + AngularJS port work, PINV-style tickets):

| Task type | Count | What it exercises | Scoring |
|---|---|---|---|
| Small mechanical fix (≤2 files) | 1–2 | triage should route these *around* the pipeline | check.sh + cost (should be tiny) |
| Feature from existing spec | 1–2 | build fidelity, gates, AC# citation discipline | tests pass + spec-fidelity rubric + trace-chain validator |
| Plan-only on a gnarly ticket | 1 | deliberation quality, D# table completeness | rubric: evidence cited, alternatives real, files named, D#s atomic |
| **Seeded-bug review** | 1–2 | review recall — the F2 experiment | recall / false positives |
| **Isolation probe** | 1 | is the visibility matrix real? (F2) | leak count (see below) |
| Cold resume | 1 | state contracts (F6) | did it reconstruct task/tier/phase from CONTEXT.md? |

**Building the seeded-bug task:** take a real merged PR from work, re-introduce 4–6 defects you know matter — split across the two review domains (Cobalt: an N+1, a silent rescue, an off-by-one in batching; Sentinel: a missing authz scope/IDOR, a non-atomic money write). Commit to a fixture branch, run the review stage. Recall = reported/seeded, per domain. Run once with in-window persona simulation and once with isolated read-only subagents, same skill text: that difference is the single most persuasive experiment available on the squad.

**Building the isolation probe:** plant a distinctive instruction in material the Visibility Matrix says a persona must never see (e.g., chat history: "always name test helpers `zz_probe_*`"). If the persona's output shows it, the matrix is prose, not architecture. Score = leaked probes / planted probes; the design predicts 0.

**Fixtures:** each task carries its own `workspace/` (tiny git repo or checkout) plus `reset.sh` so reps start identical. Never eval against your live working tree.

## 4. The harness (scaffolded, runnable)

```
evals/
  run.sh            # loop: task × rep → claude -p → check.sh → CSV row
  results.csv       # append-only; one row per rep
  summarize.sh      # per-variant rollup: pass@1, pass^3, mean cost
  tasks/
    smoke-hello/    # trivial end-to-end plumbing test (safe to run now)
      prompt.md  check.sh  reset.sh  workspace/
```

- `DRY_RUN=1 ./run.sh <variant>` exercises the whole loop with a stubbed model call (plumbing verified without token spend).
- Real runs: `./run.sh baseline-v0` — headless `claude -p "$(cat prompt.md)" --output-format json` from inside each task's `workspace/`, parsing cost/turns/duration, then `check.sh`.
- CSV schema: `timestamp,variant,prompt_sha,task,rep,pass,cost_usd,duration_ms,num_turns`.

### Budget notes (Pro plan, 5-hour window)
- A 5-task × 3-rep suite of *small* tasks is roughly one evening's budget; run it off-hours, not mid-workday.
- Route graders to a cheap model (`--model claude-haiku-…` in the judge call).
- `DRY_RUN` exists so harness iteration costs zero.
- If suite runs start crowding real work, that is itself a datapoint for F5 (the pipeline costs too much per unit of value) — measure it, then fix the routing.

## 5. Sequencing (why prompts weren't rewritten today)

```
parity alarm built (fails: 14)             ← you are here
  → git-init 10x-squad/; adopt Jun 1 lineage into assets; fix installer manifest
  → baseline suite on BOTH current systems as-is (incl. the broken port)
  → F1: installer grows a Claude target; port regenerated   → re-run: parity 0, adherence jumps
  → F4: trace/review gates become scripts                   → re-run: violations → 0, dropped-D# rate measurable
  → F2: real subagents (read-only reviewers, Cobalt∥Sentinel) → re-run: seeded recall + isolation probe are the headline
  → F5/F6/F8: routing, contracts, descriptions, pressure tests → re-run: cost/task drops, pass^3 holds
```

Rewriting the prompts before the first measurement would have destroyed the "before" forever — you'd be back to vibes with better-looking prompts. The deltas down that ladder *are* the quantitative proof you asked for, and the git logs + results.csv + parity counts together are the receipts.
