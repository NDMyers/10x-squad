# Work-Tier Model Configuration — Operator Guide

The squad routes every persona dispatch through a user-configured mapping of the five work-complexity tiers (`trivial`, `lite`, `standard_clear`, `standard_ambiguous`, `complex`) to **exact, surface-native model identifiers**, per harness. Model choice is the user's due diligence (external benchmarks, official release data); the repo's tests validate squad conformance only — private work tasks are never a model leaderboard.

## Configure

Run `/10x-squad-configure-tiers` (or ask to view/change squad model assignments). The skill:

- shows the current effective five-row mapping and its source scope;
- offers **default-all** (one model expanded into all five explicit assignments — nothing stores a "default") or **individual** per-tier assignment;
- previews the stored-file diff and resulting effective mapping before writing;
- validates and writes atomically via the bundled engine — never hand-edit `model-routing.json`.

## Scope and precedence

1. One-dispatch user override — transient, announced, never stored.
2. Workspace: `<workspace>/.10x-squad/model-routing.json`.
3. User-global: `$XDG_CONFIG_HOME/10x-squad/model-routing.json` (fallback `~/.config/10x-squad/model-routing.json`).

A workspace profile replaces the same harness's global profile **wholesale** — no per-key merge. Removing the workspace profile reveals the global one. Neither file is installer-owned; reinstalling preserves both.

The workspace path is the live-proven configuration path. Global-file resolution is implemented and covered by automated tests, but direct readability of the global file from each live harness remains a forward check; prefer workspace scope until you have verified that access in your environment.

## Per-surface identifiers

Each harness has its own profile and identifier namespace — never reuse identifiers across surfaces.

| Surface | Key | Status (2026-07-13) | Identifier form |
|---|---|---|---|
| Copilot CLI | `copilot-cli` | **Supported — actuator proven** (see `model-routing-harness-spike.md`) | CLI slugs, e.g. shape `gpt-5.4` |
| VS Code Copilot | `copilot-vscode` | **Catalog discovery and exact-label addressability proven; verified exact-routing gate not passed** — addressability-only probes stay unverified | picker display strings |

Example values in docs are illustrative shapes, never defaults. Catalog/doc presence ≠ availability: entitlement, authentication, and the active session filter the real list. On the CLI, the authoritative list comes from the harness itself (e.g., a failed dispatch error enumerates entitled models; `/subagents` shows per-agent choices). On VS Code, a live invalid `runSubagent` call rejected the identifier before child launch and returned that active session's selectable labels. A later exact `GPT-5.5 (copilot)` no-op returned `MODEL_ROUTE_OK`, proving that label was addressable in the tested session.

For VS Code, a successful exact-model no-op proves that the label is addressable. Internal diagnostics labeled the tested child request `gpt-5.5`, but the agent-visible result exposed no canonical `executed_model`, and the parent was also GPT-5.5; the run could not byte-compare identifiers or distinguish explicit execution from same-model parent fallback. In addition, the official [VS Code subagent documentation](https://code.visualstudio.com/docs/agents/subagents#_select-the-model-for-a-subagent) states that a requested subagent model above the main (parent) model's cost tier falls back to the main model. A VS Code probe is therefore verified only when requested and executed identities are independently observable and byte-equal; otherwise a successful launch remains explicitly addressability-only and unverified.

## Operational preconditions (Copilot CLI)

- **Select Vivaldi's parent model explicitly.** Copilot Auto is banned at every level (squad invariant 12); an Auto parent session is user error, not detected or compensated. Check `~/.copilot/settings.json` — `"model": "auto"` violates the premise.
- **Confirm the custom agent actually loaded.** Copilot CLI can silently ignore `--agent 10x-squad` and start its default agent when custom-agent loading fails. Vivaldi must introduce itself and announce `work tier + agent + resolved model`; if it does not, stop and restart rather than continuing without squad routing.
- **Keep `continueOnAutoMode` false** (its default). When true, rate-limit errors silently switch the session to Auto and retry — exactly the substitution the squad forbids.
- **Allow the resolver unattended:** the session needs `--allow-tool "shell(node:*)"` (or equivalent config) so Vivaldi can run the resolver before each dispatch without approval prompts. A declined resolver invocation hard-stops the pipeline.
- Server-side experiments steer *default* subagent models on Copilot accounts; the squad's explicit per-dispatch `model` argument overrides them — one more reason never to rely on defaults.

## Free-text and local/BYOK

Free text is session-only user intent and is never stored as an assignment. Start with an exact catalog label or recognizable model name; matching is deliberately conservative, with thinking, effort, tier, and punctuation wording treated as removable noise rather than arbitrary capability prose being interpreted. A non-match returns the full catalog and requires an exact choice. The skill stores only the exact returned candidate, byte-for-byte. Each unique candidate gets a harmless preflight or no-side-effect dispatch probe. Independently observable, byte-equal requested and executed identities record `verified` / `dispatch_smoke_test`; a successful launch without an independent identity signal records `unverified` / `addressability_probe` and requires a loud warning. Invalid or unavailable identifiers and observed mismatches or fallbacks hard-block before write. A local/BYOK model is configurable only as an exact identifier the active harness/provider already exposes; endpoints and credentials live outside routing configuration (the engine rejects credential-shaped fields). Cross-provider child dispatch is unsupported until a dedicated compatibility test proves it.

## Failure behavior

Resolution and dispatch fail loud — no Auto, no parent inheritance, no cheaper or "close" substitutes. Failures state the surface, tier + canonical key, requested identifier (or `<unresolved>`), reason, and next action (`/10x-squad-configure-tiers`, another identifier, or an explicitly approved one-dispatch override). Resolver exit codes: `0` resolved · `2` missing/corrupt/incomplete config · `3` harness profile missing · `4` invalid tier · `5` I/O.

## When new models ship

Nothing auto-promotes. Read the release evidence, run `/10x-squad-configure-tiers`, pick the identifier (it arrives unverified), and let a no-side-effect probe determine whether its identity is verified or only addressable and unverified before saving. Retirements/policy changes surface as fail-loud dispatch errors, which route you back to the same skill.

## What we learned

- **Intent and execution identifiers are different data.** Free text may name a model and include removable effort/tier wording, but it is not a general semantic capability search. Only an exact identifier returned by the active harness is safe to store; the resolver keeps the original intent session-only and preserves the selected catalog string byte-for-byte.
- **The active surface is the source of truth.** Documentation, another Copilot surface, and remembered model names can all be stale or use a different namespace. Catalog acquisition and saved profiles are always harness-specific.
- **Addressability is not executed identity.** A successful no-op proves a model label can launch. It becomes `verified` only when the surface independently exposes requested and executed identities and they are byte-equal; otherwise it remains `unverified` / `addressability_probe` with a warning.
- **Failing closed is safer than a clever fallback.** Auto, inherit, unavailable labels, ambiguous intent, failed probes, policy rejection, and observed model substitution stop before writing. The squad never silently chooses a cheaper, nearby, or parent model.
- **Profiles must be complete and explicit.** Each harness profile stores all five canonical tier assignments. A workspace profile replaces that harness's global profile wholesale, which keeps precedence understandable and avoids partial-merge surprises.
- **One probe per unique model is enough.** Five tiers may share a model, but verification is deduplicated. The final profile is built only from confirmed resolver results and raw probe observations, then previewed, atomically written, and resolved again for all five tiers.

Best operating pattern: explicitly select a non-Auto parent, invoke `/10x-squad-configure-tiers`, choose the active harness and scope, use **default-all** first unless you have a measured reason to differentiate tiers, accept only exact or confirmed likely matches, inspect the preview and evidence status, then let the skill perform its five post-write resolves. Re-run the skill whenever entitlement, provider policy, or available models change; never hand-edit the routing file.
