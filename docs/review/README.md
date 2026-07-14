# 10x-Squad — Review & Improvement Workspace

> Vendored into this repo from `~/.claude/10x-squad/` on 2026-07-14; this copy is canonical.

Created 2026-07-12 during a confidence review of the squad; **revised same day (v2)** after Nick's correction — the persona skills exist on the GitHub Copilot side (`Accrualify/.github/skills/`), and the real system is substantially more advanced than the Claude-side stubs implied. `~/.claude` is a git repo; baseline tag `baseline-v0` (`ae14ae7`).

| File | What it is |
|---|---|
| [REVIEW.md](REVIEW.md) | **Start here.** Revision notice (what v1 got wrong), corrected system map, ranked findings F1–F8 with evidence → standard → fix → measurement, priority ladder. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Mermaid diagrams: the real design (tiers, trace gates, Cobalt∥Sentinel) vs. the split-brain deployment vs. target v2. |
| [EVAL-PLAN.md](EVAL-PLAN.md) | Metrics, experimental protocol, task-suite design incl. seeded-bug and isolation-probe experiments. |
| [LEARNING.md](LEARNING.md) | Eight transferable principles (incl. P8, learned from this review's own error) + learn-by-doing path + reading list. |
| [evals/](../../evals/) | Runnable harness (repo root `evals/`): `run.sh` (headless suite runner, `DRY_RUN` supported), `summarize.sh`, **`check-sync.sh`** (deployment parity alarm — was **14 failures** at review time, correctly). |

**Headline (v2):** the squad is a *dual-harness split brain*. The live Copilot lineage (Jun 1: 6 skills incl. Sentinel, trace-ID hard-block gates, visibility matrix) is genuinely advanced — but unversioned (`.bak` file), ahead of its own installer source (which would roll it back and omits Sentinel from its manifest), and simulated inside one context window. The Claude Code port references skills that were never installed and has run on improvisation since May. Nothing measures, enforces, or syncs any of it — the design repeatedly says "mechanical / hard-block / isolated / MANDATORY," and no mechanism exists behind any of those words.

**Rule adopted with this workspace:** no prompt change without (1) a commit, (2) parity green or explicitly waived, (3) an eval delta. Baseline before fixing.
