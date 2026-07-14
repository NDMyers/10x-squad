# Harness Spike — Explicit Per-Dispatch Subagent Model Routing

**Plan:** `docs/plans/2026-07-13-configurable-work-tier-model-routing.md` (Task 0)
**Started:** 2026-07-13 (Claude Fable 5) · **Status: GATE PASSED for `copilot-cli` (all three pre-registered criteria, direct evidence below). For `copilot-vscode`, live catalog discovery and exact-label addressability are observed; the verified exact-routing gate has not passed because the agent-visible probe result has no independent post-launch executed-model identity signal.**

## Pre-registered evidence criteria (fixed 2026-07-13, before any probe ran)

1. A surface passes only if the executed child model's **identity** is directly observable per dispatch — from harness UI, events, timeline, or terminal output. Cost/credits-tier/price inference is insufficient on VS Code.
2. On Copilot CLI, aggregate `/usage` per-model totals are insufficient unless the probe is isolated so single-dispatch attribution is unambiguous — and that counts as spike-time evidence only, not runtime observability. Record which of the two the surface provides.
3. Vivaldi must be able to execute the resolver command unattended — no per-dispatch human approval.

## Step 1 — Surfaces and versions (RECORDED)

| Item | Value |
|---|---|
| OS | macOS (Darwin 23.6.0) |
| VS Code | 1.128.0 (`fc3def6774c76082adf699d366f31a557ce5573f`) |
| Copilot CLI | 1.0.70 (binary self-updated from 1.0.69 during spike; auto-update active) |
| Node | v20.19.0 |
| Parent model selection | `~/.copilot/settings.json` currently `{"model": "auto"}` — **violates invariant 12 premise; user must select an explicit model before squad runs** |
| VS Code forward-run parent | `GPT-5.5`, `Extra High 1M`, explicitly selected and non-Auto |
| Enterprise experiment flags (from `~/.copilot/config.json` assignment cache) | `gpt-default`, `copilot_cli_gpt_5_4_for_subagents`, `copilot_cli_gpt_5_4_mini_for_explore`, `copilot_cli_opus_medium_effort_default` — **server-side experiments actively steer default subagent models** |
| VS Code workspace trust / enterprise policy | No Restricted Mode prompt/banner was observed; the custom agent, terminal commands, and `runSubagent` were available, consistent with a trusted disposable workspace. No enterprise model-policy rejection occurred. |

## Copilot CLI findings (2026-07-13)

### Fail-loud on invalid/unavailable model — VERIFIED ✅

```
$ copilot -p "Reply with exactly: MODEL_ROUTE_OK" --model not-a-real-model-xyz --output-format json
exit=1  stderr: Error: Model "not-a-real-model-xyz" from --model flag is not available.
```

- Hard error at session init, **before any model call** (no AI credits consumed).
- Debug log shows an internal resolution chain ("Falling back to next option" for CLI-arg → session sources) that **terminates in a hard error** for explicit `--model` in non-interactive mode. No silent substitution observed.

### Catalog ≠ availability — VERIFIED ✅ (validates `model_checks` design)

`copilot help config` documents an 18-slug catalog (claude-sonnet-5, claude-sonnet-4.6, claude-sonnet-4.5, claude-haiku-4.5, claude-fable-5, claude-opus-4.8, claude-opus-4.8-fast, claude-opus-4.7, claude-opus-4.6, claude-opus-4.5, gpt-5.5, gpt-5.4, gpt-5.3-codex, gpt-5.4-mini, gpt-5-mini, gemini-3.1-pro-preview, gemini-3.5-flash, kimi-k2.7-code). Probed slugs (`claude-haiku-4.5`, `gpt-5.3-codex`, `gpt-5.4-mini`, `gpt-5.4`, `claude-sonnet-4.6`, `claude-sonnet-5`, `gpt-5.5`, `claude-opus-4.6`, `claude-opus-4.8`) were **all rejected** — help-text catalog is static documentation, not the availability source of truth. Availability must be verified per-surface at configure time, exactly as the plan's `model_checks` contract states.

### ⛔ BLOCKER: Copilot model backend unauthenticated

Debug log: `No model backend (auth, legacy provider, or BYOK registry) available, skipping custom agents load` (GitHub CLI token itself is valid). Until `copilot login` is completed interactively by the operator:

- every explicit `--model` is "not available";
- **custom agents do not load** (so Vivaldi can't run in CLI at all);
- billable probes (A: observability, B: child dispatch divergence, D: in-harness resolver) cannot run.

### Observability channels identified (mechanism verified; content pending auth)

- `--output-format json` → JSONL event stream on stdout (event types observed pre-model: `session.mcp_server_status_changed`; model-turn events pending auth).
- `--log-level all --log-dir <dir>` → per-process debug log (model resolution steps ARE logged, incl. source attribution "from CLI argument / from session").
- `--share <path>` → post-session markdown export.

### Per-subagent model selection — DOCUMENTED mechanism found

`copilot help config`: `subagents.agents.<agent-name>` supports per-subagent `model`, `effortLevel`, `contextTier`; each field may be `"inherit"`; configured via `/subagents`. This is a **static per-agent-name** mechanism — whether the dispatch tool also accepts a per-call model parameter (the plan's preferred actuator) is pending the authenticated probe.

### Silent-substitution config hazard — RECORDED ⚠️

`continueOnAutoMode` (defaults **false**): when true, eligible rate-limit errors "trigger an automatic switch to auto mode and retry". **Operational precondition: this must remain `false`** for squad sessions — enabling it reintroduces exactly the silent Auto substitution invariant 8/12 forbids. Must be stated in `docs/model-tier-configuration.md`.

### Unattended resolver execution (criteria item 3) — mechanism verified, in-harness proof pending

`--allow-tool "shell(node:*)"` (syntax per `copilot help permissions`; prefix matching on command stem) permits node invocations without per-call approval; `--deny-tool` precedence and `--available-tools` filtering documented. In-harness execution proof pending auth.

## Step 4 — CLI child-dispatch probes: **COMPLETED 2026-07-13 (post `copilot login`)** ✅

**Probe A — session-level observability (criteria §1, runtime):** `copilot -p "Reply with exactly: MODEL_ROUTE_OK" --model gpt-5.4-mini --output-format json --log-level all` → exit 0; JSONL events `assistant.turn_start`, `assistant.message`, `assistant.turn_end` each carry `"model": "gpt-5.4-mini"` (per-turn executed-model identity, machine-checkable, matching the request). Also verified for `gpt-5.4`.

**Probe B — explicit per-dispatch child model (THE ACTUATOR):** parent `--model gpt-5.4-mini`, prompt dispatched one subagent on `gpt-5.4`:

- The dispatch tool is `task` and accepts explicit arguments: `{"model": "gpt-5.4", "reasoning_effort": "low", "context_tier": "default", "agent_type": "general-purpose", "mode": "sync", ...}` — **per-dispatch model selection is a first-class tool parameter** (reasoning effort too).
- `subagent.started` reports `"model": "gpt-5.4"`; the child's own `assistant.turn_start/message/turn_end` events carry `model: gpt-5.4` while parent events carry `gpt-5.4-mini`; `subagent.completed` confirms `gpt-5.4`. Requested vs executed comparison is direct and per-dispatch.
- Cheaper-parent → pricier-child dispatch succeeded: **no VS Code-style cost-tier ceiling observed on CLI** for this pair.

**Probe B2 — invalid child model fails loud:** child dispatch with `not-a-real-model-xyz` → `tool.execution_complete` `success: false`, error `"Model 'not-a-real-model-xyz' is not available. Available models: …"`, **no `subagent.started`, no substitution**. Bonus: the error enumerates the account's full entitled model list — a usable discovery mechanism for the configure skill. Entitled on this account 2026-07-13: `claude-sonnet-4.6, claude-sonnet-4.5, claude-haiku-4.5, claude-opus-4.8, claude-opus-4.7, claude-opus-4.6, claude-opus-4.5, gpt-5.5, gpt-5.4, gpt-5.3-codex, gpt-5.4-mini, gpt-5-mini, gemini-3.1-pro-preview, gemini-3.5-flash, mai-code-1-flash-picker` (15; snapshot, not defaults).

**Probe D — unattended resolver (criteria §3):**

- D1 with `--allow-tool "shell(node:*)"`: `node -e 'console.log(JSON.stringify({ok:true}))'` executed **without any approval prompt**; stdout returned verbatim. Resolver invocations can be allowlisted per session/config.
- D2 with no allow flag (non-interactive): `tool.execution_complete` `success: false`, `error: "Permission denied and could not request permission from user"` — **declined execution is machine-visible**, satisfying the runtime contract's requirement that a declined resolver invocation maps to a hard configuration failure rather than improvisation.

**Session-level availability note:** pre-auth, ALL slugs were rejected (`No model backend available`); post-auth, both probed session models worked and the child-level list above is authoritative for dispatch. Availability is entitlement- and auth-dependent — never assume from catalogs.

### Step 8 gate evaluation — copilot-cli: **PASSED**

| Pre-registered criterion | Evidence |
|---|---|
| §1 executed-model identity observable per dispatch | `assistant.turn_*`/`subagent.started`/`subagent.completed` events carry `model`; child ≠ parent proven |
| §2 (CLI clause) runtime observability, not just spike-time | The JSONL event stream IS the session runtime output; debug logs additionally record model resolution with source attribution |
| §3 resolver runs unattended; denial visible | D1 unattended success via `--allow-tool "shell(node:*)"`; D2 machine-visible denial |

## Steps 2–3 — VS Code evidence boundary: **CATALOG DISCOVERY OBSERVED; EXECUTED IDENTITY UNPROVED**

A live `runSubagent` call with the descriptive identifier `GPT-5.4 Thinking Medium Effort for trivial work` was rejected before child launch and returned the active session's selectable model list. `Auto (copilot)` appeared in that list but remains banned. This proves a failure-path catalog discovery mechanism for that authenticated, entitled session only; it does not prove that a valid requested model launches or identify the model that ultimately executes.

A successful exact-model no-op can prove addressability. The Task 7 run later observed an internal post-launch diagnostic slug, but the agent-visible result has no canonical `executed_model` or requested-versus-executed comparison. Launch success alone therefore cannot prove byte-equal identity or the absence of substitution. The official [VS Code subagent documentation](https://code.visualstudio.com/docs/agents/subagents#_select-the-model-for-a-subagent) states that a requested subagent model above the main (parent) model's cost tier falls back to the main model; the documentation does not establish an agent-visible fallback distinction through this repository's `runSubagent` path.

The Task 7 forward run below exercised items 1–5 of this VS Code chat UI path. Item 6 is a separate persona-implementation residual check and was outside this no-side-effect configure-tiers run:

1. Select an explicit (non-Auto) parent model in the model picker; open the 10x-squad custom agent.
2. Ask Vivaldi to `runSubagent` with an exact active-catalog model and the prompt "return MODEL_ROUTE_OK and make no edits"; launch success proves addressability.
3. Record whether the **executed child model identity** is independently exposed (subagent section header, hover, request log, or result contract). Credits-on-hover alone are INSUFFICIENT.
4. If the account exposes a safe reproducible pair, request a model above the parent's cost tier and record both the fallback and whether its executed identity is visible. If no pair exists, record the scenario as skipped/unverified.
5. Record workspace trust state and any enterprise model-policy effects.
6. Check whether the child can execute a persona skill's implementation duty (no parent "no-code" inheritance).

## Task 7 — VS Code configure-tiers forward run: **COMPLETED 2026-07-13 (PDT)**

This was a signed-in Copilot Business session in a trusted, session-owned disposable workspace. VS Code was `1.128.0` (`fc3def6774c76082adf699d366f31a557ce5573f`), Copilot Chat was `0.56.0`, and the parent picker showed `GPT-5.5` with `Extra High 1M` rather than Auto. The run installed the current branch assets, began without a routing profile, and wrote only the disposable workspace's `.10x-squad/model-routing.json` after `diff-profile`.

The impossible-model `runSubagent` adapter returned this active-session catalog, in order:

```text
Claude Opus 4.6 (copilot)
Claude Opus 4.7 (copilot)
Claude Opus 4.8 (copilot)
Claude Sonnet 4.6 (copilot)
Gemini 3.1 Pro (Preview) (copilot)
Gemini 3.5 Flash (copilot)
GPT-5.3-Codex (copilot)
GPT-5.4 mini (copilot)
GPT-5.4 (copilot)
GPT-5.5 (copilot)
MAI-Code-1-Flash (copilot)
GPT-5 mini (copilot)
Claude Sonnet 4.5 (copilot)
Claude Opus 4.5 (copilot)
Claude Haiku 4.5 (copilot)
Gemini 3 Flash (Preview) (copilot)
Gemini 2.5 Pro (copilot)
```

`Auto (copilot)` was the final item in the same surface-provided list; the adapter separated and retained it as excluded with reason `squad invariant: Auto banned`.

| # | Scenario | Live observation |
|---|---|---|
| 1 | Exact | `GPT-5.5 (copilot)` returned `exact`, preserved the exact catalog string, and required no match confirmation. |
| 2 | Likely | `GPT-5.5 Thinking XHigh Effort` returned one `likely` candidate, `GPT-5.5 (copilot)`; the pre-authorized affirmative confirmation was applied. |
| 3 | Base versus mini | Both `GPT-5.4 (copilot)` and `GPT-5.4 mini (copilot)` were present. `GPT 5.4 Thinking Xhigh Effort` returned only base `GPT-5.4 (copilot)` as the likely candidate; mini was not selected. |
| 4 | No match | `Sol Ultra` returned `no_match`, no candidates, and the full active selectable list. No preview or write used this result. |
| 5 | Auto | `Auto (copilot)` returned `banned` with `squad invariant: Auto banned`. No preview or write used this result. |
| 6 | Deduplication | All five tiers resolved exactly to `GPT-5.5 (copilot)`; `verification-targets` returned one unique target and exactly one verification probe ran. The rejected catalog-discovery attempt was a separate `runSubagent` call. |
| 7 | Addressability-only | The exact harmless probe returned `MODEL_ROUTE_OK`, but its agent-visible result exposed no separate requested/executed identity fields. Internal child and extension diagnostics labeled the post-launch request `gpt-5.5`; that non-canonical slug could not be byte-compared with `GPT-5.5 (copilot)`, and because the parent was also GPT-5.5 it could not distinguish explicit child selection from parent fallback. The session therefore recorded `identity_observable: false`, `unverified`, and `addressability_probe`, with the required warning. |
| 8 | Mismatch/policy fallback | **Skipped/unverified.** The fixed parent session and successful probe surface did not expose a safe lower-cost-parent/higher-cost-child pair without changing parent state or forcing a mismatch. No pass is claimed; injected mismatch tests remain the acceptance proof. |
| 9 | Post-write | The resolver built the profile, `diff-profile` previewed it, `upsert-profile` wrote the disposable workspace profile, and all five tier keys resolved to `GPT-5.5 (copilot)` from `workspace` scope with `unverified` status and `addressability_probe` method. |

The selected identifier was `GPT-5.5 (copilot)`. The exact probe call used `Reply with exactly MODEL_ROUTE_OK. Do not read files, write files, or invoke tools.` and returned `MODEL_ROUTE_OK`. The debug tool-call record captured the requested argument `model: GPT-5.5 (copilot)`; the completed serialized UI record exposed only `modelName: GPT-5.5` plus the text result, with no independent `executed_model` field. The child debug log recorded `chat:gpt-5.5` with `debugName: tool/runSubagent`, and the extension log independently recorded `[tool/runSubagent] success | gpt-5.5`; these internal diagnostics prove a GPT-5.5 request ran, but not canonical identifier equality or the absence of same-model parent fallback. They were not promoted to contract-usable executed identity. The profile therefore correctly remains addressability-only rather than verified.

Post-write resolution result for `trivial`, `lite`, `standard_clear`, `standard_ambiguous`, and `complex`: exact model `GPT-5.5 (copilot)`, scope `workspace`, status `unverified`, method `addressability_probe`. No source or repository files changed during the external run.

## Step 5 — Unattended resolver: mechanism verified on CLI; VS Code execution observed

CLI evidence remains Probe D above. In the pre-authorized VS Code Task 7 run, the custom agent executed the installed Node resolver, `verification-targets`, `build-profile`, `diff-profile`, `upsert-profile`, and five post-write `resolve` commands. No interactive approval appeared after the initial comprehensive authorization, but the serialized substantive terminal invocations carry confirmation metadata. This run therefore proves command execution, not a general unattended approval-policy mechanism; that VS Code policy boundary remains unestablished. A failed/declined terminal invocation remains a hard stop by contract.

## Step 6 — Global-config readability

CLI: Probe D proved that an allowlisted Node command can run unattended; it did not separately read `~/.config/10x-squad/model-routing.json`, so direct readability of that file remains a forward check. VS Code: not established by the catalog-discovery call; global-config readability remains a forward test (terminal tool availability in agent context).

## Step 7 — Local/BYOK

`copilot help providers` (BYOK topic) exists in CLI 1.0.70. Not configured on this machine → **untested**, per plan: absence of local-provider setup does not block cloud-only v1; cross-provider child dispatch remains unsupported until proven.

## Step 8 — Gate status: **PASSED for `copilot-cli`; `copilot-vscode` CATALOG OBSERVED, VERIFIED EXACT ROUTING NOT PASSED**

| Gate requirement | CLI | VS Code |
|---|---|---|
| Active-session catalog discovery | ✅ invalid `task` model error enumerates entitled models (Probe B2) | ✅ invalid `runSubagent` identifier rejected before launch and returned selectable labels |
| Explicit per-dispatch selection | ✅ `task` tool `model` argument (Probe B) | ✅ exact `GPT-5.5 (copilot)` label was accepted/addressable and the no-op returned `MODEL_ROUTE_OK`; this is not executed-identity proof |
| Executed-model identity observable (criteria §1) | ✅ turn/subagent events | internal diagnostics labeled the request `gpt-5.5`, but no canonical agent-visible `executed_model` or fallback distinction; addressability-only success stays unverified |
| Resolver runs unattended | ✅ D1; denial visible D2 | commands completed in the pre-authorized Task 7 session, but invocation confirmation metadata prevents a general unattended-policy claim |

Consequences: `copilot-cli` remains the proven exact-routing surface. `copilot-vscode` configuration may complete after a successful no-op, but without independent identity evidence it records `unverified` / `addressability_probe` and emits a loud warning. An identity-observable probe records `verified` / `dispatch_smoke_test` only when requested and executed identifiers are byte-equal. Invalid or unavailable identifiers and observed mismatches or fallbacks hard-block before write. Do not claim the VS Code exact-routing gate or AC12 identity criterion has passed without that evidence.

## Addendum — custom-agent load hazard (2026-07-13, e2e verification)

In the automated verification shell, every CLI session logged `No model backend (auth, legacy provider, or BYOK registry) available, skipping custom agents load` at startup — including sessions whose model turns then succeeded. Consequence: `--agent 10x-squad` was **silently ignored** and the session ran the default agent (built-in `explore`/`task`/`general-purpose` only). Root cause is environmental (early credential access during init — likely sandbox/keychain interaction), not a squad defect; end-user terminal sessions load custom agents normally.

**Operational hazard worth knowing regardless of cause: the CLI does not error when a requested `--agent` fails to load — it degrades silently.** Mitigation is built into the squad's guardrails: Vivaldi introduces itself and announces `work tier + agent + resolved model` on every routing. **If a session does not open with Vivaldi's introduction, the custom agent did not load — stop and restart the session.**

**Residual verification item (2-minute manual step):** in a normal terminal, run one trivial task through the installed squad (`copilot --agent 10x-squad -i "fix the typo in NOTES.md: 'teh' → 'the'"`) in a workspace with a configured `.10x-squad/model-routing.json`, and confirm: (1) Vivaldi introduces itself; (2) the routing announcement shows the resolved exact model; (3) the resolver command runs before dispatch; (4) the dispatch uses the configured model (visible in `subagent.started`). Mechanism-level evidence for all four is already captured above (Probes A/B/B2/D); this step confirms prompt compliance end-to-end.
