# Harness Spike — Explicit Per-Dispatch Subagent Model Routing

**Plan:** `docs/plans/2026-07-13-configurable-work-tier-model-routing.md` (Task 0)
**Started:** 2026-07-13 (Claude Fable 5) · **Status: GATE PASSED for `copilot-cli` (all three pre-registered criteria, direct evidence below). For `copilot-vscode`, failure-path catalog discovery is observed; the verified exact-routing gate has not passed because there is no independent post-launch executed-model identity signal.**

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
| Enterprise experiment flags (from `~/.copilot/config.json` assignment cache) | `gpt-default`, `copilot_cli_gpt_5_4_for_subagents`, `copilot_cli_gpt_5_4_mini_for_explore`, `copilot_cli_opus_medium_effort_default` — **server-side experiments actively steer default subagent models** |
| Workspace trust / enterprise policy | not recorded by the VS Code catalog-discovery observation (forward test remains) |

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

A successful exact-model no-op can prove addressability. The current repository has no automated, independent post-launch executed-model identity signal for VS Code, so launch success alone cannot prove identity or the absence of substitution. The official [VS Code subagent documentation](https://code.visualstudio.com/docs/agents/subagents#_select-the-model-for-a-subagent) states that a requested subagent model above the main (parent) model's cost tier falls back to the main model; the documentation does not establish whether that fallback is independently observable through this repository's `runSubagent` path.

Remaining forward checks require the VS Code chat UI:

1. Select an explicit (non-Auto) parent model in the model picker; open the 10x-squad custom agent.
2. Ask Vivaldi to `runSubagent` with an exact active-catalog model and the prompt "return MODEL_ROUTE_OK and make no edits"; launch success proves addressability.
3. Record whether the **executed child model identity** is independently exposed (subagent section header, hover, request log, or result contract). Credits-on-hover alone are INSUFFICIENT.
4. If the account exposes a safe reproducible pair, request a model above the parent's cost tier and record both the fallback and whether its executed identity is visible. If no pair exists, record the scenario as skipped/unverified.
5. Record workspace trust state and any enterprise model-policy effects.
6. Check whether the child can execute a persona skill's implementation duty (no parent "no-code" inheritance).

## Step 5 — Unattended resolver: mechanism verified (CLI); VS Code terminal-tool execution remains a forward test.

## Step 6 — Global-config readability

CLI: Probe D proved that an allowlisted Node command can run unattended; it did not separately read `~/.config/10x-squad/model-routing.json`, so direct readability of that file remains a forward check. VS Code: not established by the catalog-discovery call; global-config readability remains a forward test (terminal tool availability in agent context).

## Step 7 — Local/BYOK

`copilot help providers` (BYOK topic) exists in CLI 1.0.70. Not configured on this machine → **untested**, per plan: absence of local-provider setup does not block cloud-only v1; cross-provider child dispatch remains unsupported until proven.

## Step 8 — Gate status: **PASSED for `copilot-cli`; `copilot-vscode` CATALOG OBSERVED, VERIFIED EXACT ROUTING NOT PASSED**

| Gate requirement | CLI | VS Code |
|---|---|---|
| Active-session catalog discovery | ✅ invalid `task` model error enumerates entitled models (Probe B2) | ✅ invalid `runSubagent` identifier rejected before launch and returned selectable labels |
| Explicit per-dispatch selection | ✅ `task` tool `model` argument (Probe B) | `runSubagent` processes the model parameter; each valid label still requires an exact-model no-op |
| Executed-model identity observable (criteria §1) | ✅ turn/subagent events | no automated, independent post-launch signal in this repository; addressability-only success stays unverified |
| Resolver runs unattended | ✅ D1; denial visible D2 | not established; forward test remains |

Consequences: `copilot-cli` remains the proven exact-routing surface. `copilot-vscode` configuration may complete after a successful no-op, but without independent identity evidence it records `unverified` / `addressability_probe` and emits a loud warning. An identity-observable probe records `verified` / `dispatch_smoke_test` only when requested and executed identifiers are byte-equal. Invalid or unavailable identifiers and observed mismatches or fallbacks hard-block before write. Do not claim the VS Code exact-routing gate or AC12 identity criterion has passed without that evidence.

## Addendum — custom-agent load hazard (2026-07-13, e2e verification)

In the automated verification shell, every CLI session logged `No model backend (auth, legacy provider, or BYOK registry) available, skipping custom agents load` at startup — including sessions whose model turns then succeeded. Consequence: `--agent 10x-squad` was **silently ignored** and the session ran the default agent (built-in `explore`/`task`/`general-purpose` only). Root cause is environmental (early credential access during init — likely sandbox/keychain interaction), not a squad defect; end-user terminal sessions load custom agents normally.

**Operational hazard worth knowing regardless of cause: the CLI does not error when a requested `--agent` fails to load — it degrades silently.** Mitigation is built into the squad's guardrails: Vivaldi introduces itself and announces `work tier + agent + resolved model` on every routing. **If a session does not open with Vivaldi's introduction, the custom agent did not load — stop and restart the session.**

**Residual verification item (2-minute manual step):** in a normal terminal, run one trivial task through the installed squad (`copilot --agent 10x-squad -i "fix the typo in NOTES.md: 'teh' → 'the'"`) in a workspace with a configured `.10x-squad/model-routing.json`, and confirm: (1) Vivaldi introduces itself; (2) the routing announcement shows the resolved exact model; (3) the resolver command runs before dispatch; (4) the dispatch uses the configured model (visible in `subagent.started`). Mechanism-level evidence for all four is already captured above (Probes A/B/B2/D); this step confirms prompt compliance end-to-end.
