# Model Routing — v4: Configurable Work-Tier Model Routing (OPERATIVE)

**Date:** 2026-07-13 · **Status:** ACCEPTED and implemented · **Supersedes:** v3 (Auto-first, commit `a3528ed` — preserved in the git history of the original `~/.claude` workspace, not this repo's) and v2 (UNSOUND).

**Source of truth for the operative design:** `Accrualify/10x-squad/` repo —
- accepted plan: `docs/plans/2026-07-13-configurable-work-tier-model-routing.md`
- operator guide: `docs/model-tier-configuration.md`
- harness evidence: `docs/model-routing-harness-spike.md` (Copilot CLI actuator PROVEN 2026-07-13; VS Code pending manual probe, unsupported until then)

## The operative policy (summary)

1. **One configuration dimension:** the five existing work tiers (`trivial`, `lite`, `standard_clear`, `standard_ambiguous`, `complex`) each map to ONE exact, surface-native model identifier, per harness (`copilot-cli`, `copilot-vscode`), managed by the `10x-squad-configure-tiers` skill. Workspace profile replaces global wholesale; no merge, no stored defaults.
2. **Vivaldi resolves, never chooses:** after TRIAGE and before every subagent dispatch it runs the installed resolver (`model-tier-config.js resolve … --json`) and passes the returned exact model explicitly on the dispatch (`task` tool `model` argument on CLI). Requested-vs-executed mismatch, nonzero resolver exit, or declined resolver invocation → hard stop.
3. **Copilot Auto is banned unconditionally, at every level** (product decision, Nick 2026-07-13). Selecting an Auto parent is user error — not detected, not compensated. `continueOnAutoMode` must stay `false`.
4. **No model evaluation/ranking in tier selection** (product decision, Nick 2026-07-13): external public benchmarks + official release data + user judgment choose models. One harmless target-harness dispatch validates reachability/identity. Deterministic repo tests (`npm test`) validate schema, precedence, dispatch instructions, installation, and fail-loud behavior — squad conformance only. Professional PRs are not a recurring model-ranking suite.
5. **Personas are model-agnostic.** No model names anywhere in operative prompts.

## What this retires from v3

Auto-first posture; promotion/regression gates as a condition of binding changes; policy arms (auto / one-model-LTS / manual-tier); the resolved-model-ID *ledger* as promotion machinery (per-dispatch executed-model confirmation remains, as a runtime hard-block); event-driven staleness automation (replaced by fail-loud dispatch errors routing to reconfiguration). v3's open pre-landing items (a)(b)(c) are moot.
