# Persona × Work-Tier Model, Reasoning, and Context Configuration

The squad routes every persona dispatch through a user-configured **(persona, work tier)** matrix: six dispatchable personas (`einstein`, `peter`, `linus`, `cobalt`, `sentinel`, `ralph`) × five work tiers (`trivial`, `lite`, `standard_clear`, `standard_ambiguous`, `complex`) — 30 profiles per harness. Each profile combines an **exact, surface-native model identifier**, a reasoning choice, and a context choice.

Tier alone conflates how hard the task is with how much reasoning the role needs. On a Complex task the personas that plan and gate the work earn a frontier model at high effort; the persona executing an already-reviewed spec does not. Vivaldi resolves each persona's own profile per dispatch. Model choice is the user's due diligence; the repo's tests validate squad conformance only — private work tasks are never a model leaderboard.

## Configure

Run `/10x-squad-configure-tiers` (or ask to view/change squad model assignments). The skill:

- shows the current effective persona × tier mapping of model + reasoning + context and its source scope, collapsing identical persona rows;
- offers four entry paths, all writing the same fully explicit 30-cell matrix — **role lanes** (recommended, 3 answers: Thinker `einstein`/`peter`, Builder `linus`/`ralph`, Reviewer `cobalt`/`sentinel`, each a model plus a tier-stepped effort curve), **default-all** (1 answer), **per work tier** (5 answers, broadcast across personas), and **full matrix** (30 answers). No lane, role, or inheritance marker is ever stored;
- optionally records **Vivaldi's advisory model** per tier — a recommendation for the root session, resolved against the harness's *parent* catalog, never probed, and never actuated;
- offers explicit or `auto` choices for both runtime settings, per the active harness's vocabulary (see the per-surface table below);
- previews the stored-file diff and resulting effective mapping before writing;
- validates and writes atomically via the bundled engine — never hand-edit `model-routing.json`.

Runtime `auto` independently omits its corresponding dispatch argument and lets the active harness use adaptive or default behavior. It is not Copilot model Auto and does not inherit the parent model. `long_context` is a named harness tier; there is no numeric context-size promise.

## Scope and precedence

1. One-dispatch user override — transient, announced, never stored.
2. Workspace: `<workspace>/.10x-squad/model-routing.json`.
3. User-global: `$XDG_CONFIG_HOME/10x-squad/model-routing.json` (fallback `~/.config/10x-squad/model-routing.json`).

A workspace profile replaces the same harness's global profile **wholesale** — no per-key merge. Removing the workspace profile reveals the global one. Neither file is installer-owned; reinstalling preserves both. Schema-v1 profiles remain readable and resolve missing runtime settings as `auto`/`auto`; every successful configure write uses schema v3. When another harness's legacy profile is retained during an upsert, it may continue to omit `dispatch_settings`.

### Migrating from a tier-only config (schema v1/v2)

Nothing breaks and nothing forces a reconfigure. A stored v1 or v2 profile carries one tier row, and that row **broadcasts to every persona** — exactly how those versions have always routed, so existing installs resolve identically. The stored `schema_version` is the only shape discriminator; the engine never guesses by inspecting leaf types.

The first successful write upgrades the file to schema v3. Because the file carries one version stamp, that write also broadcast-upgrades every *retained* profile for other harnesses into matrix form: their stored shape changes, their routing does not, and the written file always passes its own validator. Retention across the upgrade is therefore **semantic, not byte-for-byte**.

One upgrade coupling is deliberate: `resolve` now requires `--persona`. An orchestrator composed before this change omits it and hard-stops with exit 2 rather than dispatching every persona on one profile — a loud failure in preference to a silent mis-route. Reinstall to refresh the composed entrypoint.

### Vivaldi's advisory row

Vivaldi always runs as the root session on every supported surface, so the squad **cannot** select its model — the user does that in the harness. The advisory row records what a tier *would* want, Vivaldi announces it at TRIAGE, and where the surface exposes the running parent model it warns once on mismatch. It never blocks and never attempts to set the model.

Two consequences follow from it being a *parent* model: it resolves against the harness's **parent** catalog rather than its spawn catalog (the spawn set is strictly smaller — on the reference Codex account, two spawnable models against six listed — so the spawn catalog would wrongly reject a valid recommendation), and it is **never probed**, since probing means dispatching a child. Advisory entries therefore never produce a `model_checks` entry. Leaving the advisory unset is a normal configuration: `resolve-advisory` reports `{"ok":true,"advisory":false}` with exit 0.

The workspace path is the live-proven configuration path. Global-file resolution is implemented and covered by automated tests, but direct readability of the global file from each live harness remains a forward check; prefer workspace scope until you have verified that access in your environment.

## Per-surface identifiers

Each harness has its own profile and identifier namespace — never reuse identifiers across surfaces.

| Surface | Key | Status | Identifier form |
|---|---|---|---|
| Copilot CLI | `copilot-cli` | **Supported — actuator proven** (see `model-routing-harness-spike.md`) | exact slugs returned by the CLI |
| VS Code Copilot | `copilot-vscode` | **Catalog discovery and exact-label addressability proven; verified exact-routing gate not passed** — addressability-only probes stay unverified | picker display strings |
| Codex CLI | `codex-cli` | **Supported at the unverified tier** — per-dispatch model + reasoning proven, but executed-model identity is not observable, so probes stay `unverified` (see `codex-harness-spike.md`) | spawnable model slugs |
| ChatGPT desktop app | `codex-app` | **Supported at the unverified tier** — spawn, per-dispatch model + reasoning, fail-loud, and unattended resolver all proven on this surface (Probe F); executed-model identity is not observable here either | spawnable model slugs, acquired on this surface |

The two Codex surfaces are deliberately kept separate. They run different engine builds
(`0.145.0` vs `0.146.0-alpha.3.1` on the reference machine), and their spawnable model sets drift
independently over time — one surface's set changed from two entries to five in four days — so a
profile configured for one is not valid for the other. Vivaldi detects the active surface at runtime
from `CODEX_INTERNAL_ORIGINATOR_OVERRIDE`, corroborated by `/Applications/ChatGPT.app/` on `PATH`;
the `codex` binary path and `codex --version` do **not** discriminate.

Explicit dispatch settings by surface: `copilot-cli` accepts both settings; `codex-cli` and
`codex-app` accept explicit `reasoning_effort` but only `auto` `context_tier` (the Codex spawn tool
has no context parameter); `copilot-vscode` and unknown harnesses allow `auto`/`auto` only. A setting
outside its surface's vocabulary hard-stops before any probe, preview, or write. Accepted
vocabularies:

| Surface | `reasoning_effort` | `context_tier` |
|---|---|---|
| `copilot-cli` | `auto\|low\|medium\|high\|xhigh` | `auto\|default\|long_context` |
| `codex-cli` | `auto\|low\|medium\|high\|xhigh\|max\|ultra` | `auto` only |
| `codex-app` | `auto\|low\|medium\|high\|xhigh\|max\|ultra` | `auto` only |
| `copilot-vscode`, unknown | `auto` only | `auto` only |

Example values in docs are illustrative shapes, never defaults or a selectable list. Catalog/doc presence ≠ availability: entitlement, authentication, and the active session filter the real list. On the CLI, the authoritative list comes from the harness itself (e.g., a failed dispatch error enumerates entitled models; `/subagents` shows per-agent choices). On VS Code, a live invalid `runSubagent` call rejected the identifier before child launch and returned that active session's selectable labels. A later exact picker-label no-op returned `MODEL_ROUTE_OK`, proving that label was addressable in the tested session.

For VS Code, a successful exact-model no-op proves that the label is addressable. Internal diagnostics used a provider-normalized label, but the agent-visible result exposed no canonical `executed_model`, and the parent used the same model family; the run could not byte-compare identifiers or distinguish explicit execution from same-model parent fallback. In addition, the official [VS Code subagent documentation](https://code.visualstudio.com/docs/agents/subagents#_select-the-model-for-a-subagent) states that a requested subagent model above the main (parent) model's cost tier falls back to the main model. A VS Code probe is therefore verified only when requested and executed identities are independently observable and byte-equal; otherwise a successful launch remains explicitly addressability-only and unverified.

## Operational preconditions (Copilot CLI)

- **Select Vivaldi's parent model explicitly.** Copilot Auto is banned at every level (squad invariant 12); an Auto parent session is user error, not detected or compensated. Check `~/.copilot/settings.json` — `"model": "auto"` violates the premise.
- **Confirm the custom agent actually loaded.** Copilot CLI can silently ignore `--agent 10x-squad` and start its default agent when custom-agent loading fails. Vivaldi must introduce itself and announce `work tier + agent + resolved model`; if it does not, stop and restart rather than continuing without squad routing.
- **Keep `continueOnAutoMode` false** (its default). When true, rate-limit errors silently switch the session to Auto and retry — exactly the substitution the squad forbids.
- **Allow the resolver unattended:** the session needs `--allow-tool "shell(node:*)"` (or equivalent config) so Vivaldi can run the resolver before each dispatch without approval prompts. A declined resolver invocation hard-stops the pipeline.
- Server-side experiments steer *default* subagent models on Copilot accounts; the squad's explicit per-dispatch `model` argument overrides them — one more reason never to rely on model defaults. Runtime settings marked `auto` are intentionally omitted.

## Operational preconditions (Codex CLI / ChatGPT app)

- **Vivaldi runs at the root session.** Codex has no flag to boot the primary session as a custom agent, so Vivaldi is the `$10x-squad-vivaldi` skill invoked at the root; personas spawn at depth 1 from there (`max_depth` defaults to 1, so a spawned Vivaldi could not spawn personas). If the session did not open with Vivaldi's introduction, the skill did not load — restart.
- **No feature flag is required.** The spawn tool carrying the per-dispatch `model` / `reasoning_effort` actuator is present by default on both Codex surfaces; `multi_agent_v2` swaps in a different toolset (and a required `task_name`), it does not supply the actuator. Verify the actuator rather than assuming a flag either way: if the available spawn tool is missing or lacks both parameters, the pipeline hard-blocks before the first dispatch.
- **`context_tier` is always `auto`.** Codex `spawn_agent` has no context parameter; the resolver resolves `context_tier` to `auto` and it is never passed.
- **Executed-model identity is not observable.** `spawn_agent`/`wait_agent`/`list_agents` and the event stream carry no model field, so Codex profiles record `unverified` / `addressability_probe`. The backstop is fail-loud: an invalid model or unsupported reasoning effort is rejected before child launch with the accepted set enumerated. That rejection is the authoritative availability source.
- **The spawn model set is narrower than the parent set.** `codex debug models` lists parent-selectable models; `spawn_agent` accepts a smaller subset. Assignments must be spawnable models, taken from the spawn-time `Available models:` enumeration, not from `codex debug models` alone.
- **Reasoning effort is validated per model.** `max`/`ultra` exist only on models that list them (`codex debug models` → `supported_reasoning_levels`). The configure skill checks the chosen effort against the chosen model before writing; the harness enforces it again at spawn.
- **Vivaldi is invoked by name.** Its `agents/openai.yaml` sets `allow_implicit_invocation: false`, so a 25KB orchestrator never fires on an unrelated request — and it does not appear in the ambient skill list. Invoke `$10x-squad-vivaldi` explicitly.

## Free-text and local/BYOK

Free text is session-only model intent and is never stored as an assignment. Start with an exact catalog label or recognizable model name; matching is deliberately conservative, with thinking, effort, tier, and punctuation wording treated as removable model-matching noise rather than runtime configuration. Select reasoning and context separately from their closed vocabularies. A non-match returns the full live catalog and requires an exact choice. The skill stores only the exact returned candidate, byte-for-byte, and never hardcodes selectable model names or identifiers.

Each unique `(model, reasoning_effort, context_tier)` tuple gets a harmless dispatch probe. The probe uses exactly the resolver's `dispatch_arguments`; runtime `auto` fields remain omitted. Independently observable, byte-equal requested and executed identities record `verified` / `dispatch_smoke_test`; a successful launch without an independent identity signal records `unverified` / `addressability_probe` and requires a loud warning. Invalid or unavailable identifiers, rejected settings, argument mismatches, and observed model fallbacks hard-block before write. A local/BYOK model is configurable only as an exact identifier the active harness/provider already exposes; endpoints and credentials live outside routing configuration. Cross-provider child dispatch is unsupported until a dedicated compatibility test proves it.

## Failure behavior

Resolution and dispatch fail loud — no model Auto, no parent inheritance, and no cheaper or "close" substitutes. Runtime `auto` has only the independent omission meaning above. Failures state the surface, persona + canonical key, tier + canonical key, requested profile (or `<unresolved>`), reason, and next action (`/10x-squad-configure-tiers`, another choice, or an explicitly approved one-dispatch override). Resolver exit codes: `0` resolved · `2` missing/corrupt/incomplete config, including an omitted `--persona` · `3` harness profile missing · `4` invalid tier **or persona** · `5` I/O.

## When new models ship

Nothing auto-promotes. Read the release evidence, run `/10x-squad-configure-tiers`, pick the live identifier and runtime choices, and let tuple probes determine whether model identity is verified or only addressable and unverified before saving. Retirements, setting rejection, and policy changes surface as fail-loud dispatch errors, which route you back to the same skill.

## What we learned

- **Model intent and runtime settings are different data.** Free text may name a model and include removable effort/tier wording, but it is not a general semantic capability search and does not set reasoning or context. Only an exact identifier returned by the active harness is safe to store; runtime settings come from closed choices.
- **The active surface is the source of truth.** Documentation, another Copilot surface, and remembered model names can all be stale or use a different namespace. Catalog acquisition and saved profiles are always harness-specific.
- **Addressability is not executed identity.** A successful no-op proves a model label can launch. It becomes `verified` only when the surface independently exposes requested and executed identities and they are byte-equal; otherwise it remains `unverified` / `addressability_probe` with a warning.
- **Failing closed is safer than a clever fallback.** Auto, inherit, unavailable labels, ambiguous intent, failed probes, policy rejection, and observed model substitution stop before writing. The squad never silently chooses a cheaper, nearby, or parent model.
- **Profiles must be complete and explicit.** Each new harness proposal stores all thirty canonical model assignments and all thirty settings entries. A workspace profile replaces that harness's global profile wholesale, which keeps precedence understandable and avoids partial-merge surprises.
- **One probe per unique tuple is enough.** The dedup key is the complete `(model, reasoning_effort, context_tier)` tuple, which is persona independent — so widening to thirty cells does not multiply probes. Six personas sharing one model and effort still cost exactly one probe. Practical ceilings: `default_all` 1, `role_lanes` up to 15 (commonly ~9), `per_tier` up to 5, `matrix` up to 30. The skill discloses the count before probing and confirms above five. The final profile is built only by `build-profile` from confirmed resolver results and raw observations that include the exact requested arguments, then previewed, atomically written, and resolved again.
- **The persona is a routing coordinate, not persona metadata.** Persona skills stay model-agnostic: nothing in a persona file names a model or an effort. Widening the routing key changed what the orchestrator passes to the resolver, not what the personas know about themselves.

Best operating pattern: explicitly select a non-Auto parent, invoke `/10x-squad-configure-tiers`, choose the active harness and scope, use **role lanes** first — three answers buy most of the benefit, and you can drop to the full matrix later — accept only exact or confirmed likely model matches, choose reasoning and context deliberately, inspect the preview and evidence status, then let the skill perform its post-write resolves across the matrix. Re-run the skill whenever entitlement, provider policy, available models, or setting support changes; never hand-edit the routing file.
