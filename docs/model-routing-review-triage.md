# Triage: Codex (GPT 5.6 Sol Ultra) Review of the Model-Routing Design

**Date:** 2026-07-12 · **Reviewer verdict:** UNSOUND · **Triage outcome:** verdict **accepted in substance** — 12/12 findings accepted (10 outright, 2 with qualifications). The design was rewritten as MODEL-ROUTING.md **v3** (in `~/.claude/10x-squad/`); this file records what was accepted, what was verified vs. taken as cited, and the two qualifications.

## Verification record (symmetric duty)

The packet told the reviewer "don't correct verified facts from memory." The same discipline applies in reverse: the review's load-bearing factual claims were verified before acceptance, not taken on authority.

| Claim | Status |
|---|---|
| Copilot **Auto model selection** exists: routes on task complexity + system health; model used exposed per response (Chat hover / CLI terminal / cloud agent); available across VS Code Chat, CLI, cloud agent; 10% model-cost discount | **VERIFIED** (fetched GitHub docs 2026-07-12). Docs are silent on whether Auto engages when a custom agent omits `model:` — carried as a pre-landing verification item, as the reviewer itself required |
| **LTS models**: 1-year support commitment, Business/Enterprise; GPT-5.3-Codex designated base + LTS (2026-03-18) | **VERIFIED** (fetched) |
| **Copilot CLI programmatic mode**: `-p` non-interactive, `--model=` / `COPILOT_MODEL`, model-used reported in output | **VERIFIED** (fetched). No documented JSON output mode — the Copilot eval runner will parse text |
| GitHub supported-models catalog as the Copilot validation authority; OpenAI snapshot/alias/deprecation semantics; Codex `model` / `model_reasoning_effort` config | **TAKEN AS CITED** (consistent with verified pages and prior knowledge; will be exercised directly when `check-models` and any Codex port are built) |

## Finding-by-finding triage

| # | Sev | Finding (compressed) | Verdict | Change made (v3) |
|---|---|---|---|---|
| 1 | CRIT | Copilot Auto wrongly excluded — §5 conflated prompt-level self-selection with harness-level routing | **ACCEPT** — the review's best catch; v2's "no oracle exists" was false at the harness layer | Copilot posture is now **Auto-first** (omit pin); Auto is an eval **arm**, not an auto-winner; explicit frontier only where Auto fails a predefined critical floor |
| 2 | CRIT | Pinning `standard` in frontmatter → structurally late escalation; announce-and-recommend is a prose gate over abandoned context | **ACCEPT** — v2 repeated the squad's own "policy in an unenforceable layer" disease | No standard pin. Route **before substantive work** (pre-work tier gate); Auto/picker as actuator; routing table explicitly *advisory* on Copilot, *enforced* on Claude Code |
| 3 | CRIT | `claude -p` evals cannot promote Copilot bindings — harness is part of the evaluated system | **ACCEPT** — v2's promotion gate never ran where the models execute | Target-harness execution mandatory; Copilot CLI `-p --model` as programmatic runner (verified buildable); blinded manual A/B for IDE-only; bindings without target-harness evidence labeled **unevaluated** |
| 4 | MAJ | Classifier and binding not independent — the bound model classifies; under-classification is silent | **ACCEPT** | Policies evaluated end-to-end including triage (frontier false-negative rate); mechanical escalation: ambiguity ≥2 signals or Sensitive-Surface → frontier arm regardless of classifier verdict |
| 5 | MAJ | Capability is not a total ordering — aggregate winners can regress critical slices; rankings reverse with effort/context/harness | **ACCEPT** | Arms are execution profiles, not model names; hard non-regression floors on critical slices (seeded security recall first); specialist bindings only on demonstrated crossover |
| 6 | MAJ | "One location" invariant self-violated (binding block + frontmatter; independently editable harness blocks) | **ACCEPT** — embarrassing and correct | Single parseable **manifest** per harness; installer renders frontmatter + human blocks; parser-asserted equality; grep demoted to lint |
| 7 | MAJ | Online check targets the wrong namespace — OpenAI API lists ≠ Copilot catalog/plan/policy availability | **ACCEPT** | Validation authority per harness: GitHub catalog + CLI dry-run for Copilot; tri-state `PASS / FAIL / NOT CHECKED`; no cross-namespace ID reuse |
| 8 | MAJ | Per-ecosystem binding semantics differ (OpenAI snapshots vs aliases; Copilot display names; Codex native config) | **ACCEPT** | Per-ecosystem semantics section in v3; future Codex port uses native `model`/`model_reasoning_effort` or intentionally omits |
| 9 | MAJ | Floating aliases bypass the promotion gate; alias drift destroys the incumbent baseline | **ACCEPT** — v2 documented the tradeoff but not the architectural break | **Resolved-identity ledger**: every eval row / run records the concrete executed model (Claude `modelUsage` JSON; Copilot CLI/Chat model display); resolution drift triggers the same gate as a binding edit; unledgered alias results labeled non-reproducible |
| 10 | MAJ | 90-day hard-fail is the wrong trigger — event-driven beats calendar; LTS is the low-maintenance standard candidate | **ACCEPT** | FAIL on catalog removal / published retirement / resolution drift / uneval'd manifest edit, at install + launch + eval boundaries; calendar age demoted to warning; LTS model adopted as fallback-standard candidate |
| 11 | MAJ | 5–20 tasks can't rank close candidates; pass³ multiplies noise; multi-metric cherry-picking; suite overfitting | **ACCEPT, one qualification** — pass^k is retained as a reliability *floor* (tripwire), which the finding's own fix framing permits; it is no longer used to *rank* | Promotion reframed as regression gate: paired trials, predefined metric priority, material-effect threshold, **inconclusive → incumbent**, task-slice refresh per suite version |
| 12 | MAJ | One-model-everywhere rejected before measuring policy end-to-end; per-model scores omit classification errors, ignored switches, restart friction | **ACCEPT, one qualification** — packet §5.4 did name one-model as the fallback pending eval data, so "rejected before measuring" slightly overstates; but the operative point (it must be a measured *arm*, and the frontier/standard cost benefit isn't realizable via pins on single-window Copilot anyway) is correct and changed the design | `one-model (LTS)` and `auto` are first-class eval arms alongside `manual-tier`; operator interventions (ignored switch recommendations) count as policy failures; per-harness divergence (Copilot→Auto, Claude→tiers) is an allowed outcome |

## What this review demonstrated (for LEARNING.md's running themes)

1. **Cross-vendor review earned its cost on home turf exactly as predicted** — R4 was written *because* the OpenAI/GitHub ecosystem was our blind spot; findings 1, 8, 10 came straight from it.
2. **The reviewed design repeated the reviewed system's own diseases** (unenforceable-layer policy, gates that don't gate, self-violating invariants). Knowing a failure pattern well enough to write it up does not immunize the writer against reproducing it — only mechanisms and hostile review do.
3. **Verification is symmetric.** We told the reviewer not to correct our verified facts from memory; we then had to verify *its* facts before folding them in. Three fetches settled the three CRITICALs. Claims inherit the scope of their evidence, in both directions.

## Open items carried into the landing plan

1. Verify whether omitting `model:` in `.agent.md` yields Auto on Nick's surfaces (docs silent; both reviewer and triage flag it).
2. Verify current premium-request/billing semantics for Auto vs pinned frontier on the Enterprise plan (v2's "Enterprise covers the cost" doctrine predates current billing).
3. Build `copilot-run.sh` (CLI `-p --model` runner with model-used capture) as the Copilot-side sibling of `evals/run.sh`.
