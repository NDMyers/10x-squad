# Work-Tier Model, Reasoning, and Context Configuration

The squad routes every persona dispatch through five user-configured work-tier profiles (`trivial`, `lite`, `standard_clear`, `standard_ambiguous`, `complex`). Each profile combines an **exact, surface-native model identifier**, a reasoning choice, and a context choice for one harness. Model choice is the user's due diligence; the repo's tests validate squad conformance only — private work tasks are never a model leaderboard.

## Configure

Run `/10x-squad-configure-tiers` (or ask to view/change squad model assignments). The skill:

- shows the current effective five-row mapping of model + reasoning + context and its source scope;
- offers **default-all** (one three-part profile expanded into all five explicit entries) or **individual** per-tier profiles;
- offers explicit or `auto` choices for both runtime settings: reasoning `auto|low|medium|high|xhigh` and context `auto|default|long_context`;
- previews the stored-file diff and resulting effective mapping before writing;
- validates and writes atomically via the bundled engine — never hand-edit `model-routing.json`.

Runtime `auto` independently omits its corresponding dispatch argument and lets the active harness use adaptive or default behavior. It is not Copilot model Auto and does not inherit the parent model. `long_context` is a named harness tier; there is no numeric context-size promise.

## Scope and precedence

1. One-dispatch user override — transient, announced, never stored.
2. Workspace: `<workspace>/.10x-squad/model-routing.json`.
3. User-global: `$XDG_CONFIG_HOME/10x-squad/model-routing.json` (fallback `~/.config/10x-squad/model-routing.json`).

A workspace profile replaces the same harness's global profile **wholesale** — no per-key merge. Removing the workspace profile reveals the global one. Neither file is installer-owned; reinstalling preserves both. Schema-v1 profiles remain readable and resolve missing runtime settings as `auto`/`auto`; every successful configure write uses schema v2. When another harness's legacy profile is retained during an upsert, it may continue to omit `dispatch_settings`.

The workspace path is the live-proven configuration path. Global-file resolution is implemented and covered by automated tests, but direct readability of the global file from each live harness remains a forward check; prefer workspace scope until you have verified that access in your environment.

## Per-surface identifiers

Each harness has its own profile and identifier namespace — never reuse identifiers across surfaces.

| Surface | Key | Status (2026-07-13) | Identifier form |
|---|---|---|---|
| Copilot CLI | `copilot-cli` | **Supported — actuator proven** (see `model-routing-harness-spike.md`) | exact slugs returned by the CLI |
| VS Code Copilot | `copilot-vscode` | **Catalog discovery and exact-label addressability proven; verified exact-routing gate not passed** — addressability-only probes stay unverified | picker display strings |

Only `copilot-cli` supports explicit reasoning and context dispatch settings. `copilot-vscode` and unknown harnesses allow `auto`/`auto` only; if either setting is explicit, the configuration flow hard-stops before any probe, preview, or write.

Example values in docs are illustrative shapes, never defaults or a selectable list. Catalog/doc presence ≠ availability: entitlement, authentication, and the active session filter the real list. On the CLI, the authoritative list comes from the harness itself (e.g., a failed dispatch error enumerates entitled models; `/subagents` shows per-agent choices). On VS Code, a live invalid `runSubagent` call rejected the identifier before child launch and returned that active session's selectable labels. A later exact picker-label no-op returned `MODEL_ROUTE_OK`, proving that label was addressable in the tested session.

For VS Code, a successful exact-model no-op proves that the label is addressable. Internal diagnostics used a provider-normalized label, but the agent-visible result exposed no canonical `executed_model`, and the parent used the same model family; the run could not byte-compare identifiers or distinguish explicit execution from same-model parent fallback. In addition, the official [VS Code subagent documentation](https://code.visualstudio.com/docs/agents/subagents#_select-the-model-for-a-subagent) states that a requested subagent model above the main (parent) model's cost tier falls back to the main model. A VS Code probe is therefore verified only when requested and executed identities are independently observable and byte-equal; otherwise a successful launch remains explicitly addressability-only and unverified.

## Operational preconditions (Copilot CLI)

- **Select Vivaldi's parent model explicitly.** Copilot Auto is banned at every level (squad invariant 12); an Auto parent session is user error, not detected or compensated. Check `~/.copilot/settings.json` — `"model": "auto"` violates the premise.
- **Confirm the custom agent actually loaded.** Copilot CLI can silently ignore `--agent 10x-squad` and start its default agent when custom-agent loading fails. Vivaldi must introduce itself and announce `work tier + agent + resolved model`; if it does not, stop and restart rather than continuing without squad routing.
- **Keep `continueOnAutoMode` false** (its default). When true, rate-limit errors silently switch the session to Auto and retry — exactly the substitution the squad forbids.
- **Allow the resolver unattended:** the session needs `--allow-tool "shell(node:*)"` (or equivalent config) so Vivaldi can run the resolver before each dispatch without approval prompts. A declined resolver invocation hard-stops the pipeline.
- Server-side experiments steer *default* subagent models on Copilot accounts; the squad's explicit per-dispatch `model` argument overrides them — one more reason never to rely on model defaults. Runtime settings marked `auto` are intentionally omitted.

## Free-text and local/BYOK

Free text is session-only model intent and is never stored as an assignment. Start with an exact catalog label or recognizable model name; matching is deliberately conservative, with thinking, effort, tier, and punctuation wording treated as removable model-matching noise rather than runtime configuration. Select reasoning and context separately from their closed vocabularies. A non-match returns the full live catalog and requires an exact choice. The skill stores only the exact returned candidate, byte-for-byte, and never hardcodes selectable model names or identifiers.

Each unique `(model, reasoning_effort, context_tier)` tuple gets a harmless dispatch probe. The probe uses exactly the resolver's `dispatch_arguments`; runtime `auto` fields remain omitted. Independently observable, byte-equal requested and executed identities record `verified` / `dispatch_smoke_test`; a successful launch without an independent identity signal records `unverified` / `addressability_probe` and requires a loud warning. Invalid or unavailable identifiers, rejected settings, argument mismatches, and observed model fallbacks hard-block before write. A local/BYOK model is configurable only as an exact identifier the active harness/provider already exposes; endpoints and credentials live outside routing configuration. Cross-provider child dispatch is unsupported until a dedicated compatibility test proves it.

## Failure behavior

Resolution and dispatch fail loud — no model Auto, no parent inheritance, and no cheaper or "close" substitutes. Runtime `auto` has only the independent omission meaning above. Failures state the surface, tier + canonical key, requested profile (or `<unresolved>`), reason, and next action (`/10x-squad-configure-tiers`, another choice, or an explicitly approved one-dispatch override). Resolver exit codes: `0` resolved · `2` missing/corrupt/incomplete config · `3` harness profile missing · `4` invalid tier · `5` I/O.

## When new models ship

Nothing auto-promotes. Read the release evidence, run `/10x-squad-configure-tiers`, pick the live identifier and runtime choices, and let tuple probes determine whether model identity is verified or only addressable and unverified before saving. Retirements, setting rejection, and policy changes surface as fail-loud dispatch errors, which route you back to the same skill.

## What we learned

- **Model intent and runtime settings are different data.** Free text may name a model and include removable effort/tier wording, but it is not a general semantic capability search and does not set reasoning or context. Only an exact identifier returned by the active harness is safe to store; runtime settings come from closed choices.
- **The active surface is the source of truth.** Documentation, another Copilot surface, and remembered model names can all be stale or use a different namespace. Catalog acquisition and saved profiles are always harness-specific.
- **Addressability is not executed identity.** A successful no-op proves a model label can launch. It becomes `verified` only when the surface independently exposes requested and executed identities and they are byte-equal; otherwise it remains `unverified` / `addressability_probe` with a warning.
- **Failing closed is safer than a clever fallback.** Auto, inherit, unavailable labels, ambiguous intent, failed probes, policy rejection, and observed model substitution stop before writing. The squad never silently chooses a cheaper, nearby, or parent model.
- **Profiles must be complete and explicit.** Each new harness proposal stores all five canonical model assignments and all five settings entries. A workspace profile replaces that harness's global profile wholesale, which keeps precedence understandable and avoids partial-merge surprises.
- **One probe per unique tuple is enough.** Five tiers may share a model, but different settings still need distinct probes. The final profile is built only by `build-profile` from confirmed resolver results and raw observations that include the exact requested arguments, then previewed, atomically written, and resolved again.

Best operating pattern: explicitly select a non-Auto parent, invoke `/10x-squad-configure-tiers`, choose the active harness and scope, use **default-all** first unless you have a measured reason to differentiate tiers, accept only exact or confirmed likely model matches, choose reasoning and context deliberately, inspect the preview and evidence status, then let the skill perform its five post-write resolves. Re-run the skill whenever entitlement, provider policy, available models, or setting support changes; never hand-edit the routing file.
