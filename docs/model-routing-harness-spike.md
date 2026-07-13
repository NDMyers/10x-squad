# Harness Spike — Explicit Per-Dispatch Subagent Model Routing

**Plan:** `docs/plans/2026-07-13-configurable-work-tier-model-routing.md` (Task 0)
**Started:** 2026-07-13 (Claude Fable 5) · **Status: IN PROGRESS — gate not yet passed**

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
| Workspace trust / enterprise policy | not yet recorded (pending VS Code manual probe) |

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

## Step 4 — CLI child-dispatch probe: **PENDING AUTH**

Planned (run after `copilot login`):

1. Probe A (session observability): `copilot -p "Reply with exactly: MODEL_ROUTE_OK" --model <entitled-slug> --output-format json --log-level all` → assert model identity appears in JSONL events/logs with requested value.
2. Probe B (child divergence): parent model X, prompt dispatches one subagent explicitly on model Y (`different from X`), no-side-effect task; assert child events report Y and parent events report X.
3. Probe B2 (invalid child model): child dispatch with invalid slug → assert hard stop, not substitution.
4. Probe D (resolver in-harness): `--allow-tool "shell(node:*)"`, agent runs `node -e 'console.log(JSON.stringify({ok:true}))'` unattended; also run with the tool NOT allowed and assert declined execution is visible (maps to hard-stop contract).

## Steps 2–3 — VS Code probes: **PENDING MANUAL (operator)**

Cannot be driven from a terminal; requires the VS Code chat UI. Operator instructions:

1. Select an explicit (non-Auto) parent model in the model picker; open the 10x-squad custom agent.
2. Ask Vivaldi to `runSubagent` with a *different* valid model and prompt "return MODEL_ROUTE_OK and make no edits".
3. Evidence to capture per pre-registered criteria: where the **executed child model identity** is displayed (subagent section header? hover? request log?). Credits-on-hover alone is INSUFFICIENT.
4. Repeat with (a) a model above the parent's cost tier (docs say silent fallback to parent — determine whether the substitution is visible) and (b) an invalid identifier (expect error).
5. Record workspace trust state and any enterprise model-policy effects.
6. Check whether the child can execute a persona skill's implementation duty (no parent "no-code" inheritance).

## Step 5 — Unattended resolver: mechanism verified (CLI); VS Code pending manual probe.

## Step 6 — Global-config readability

CLI: shell tools run as the invoking user; `~/.config/10x-squad/model-routing.json` is readable wherever `shell(node:*)` is permitted — will be confirmed empirically in Probe D. VS Code: pending manual probe (terminal tool availability in agent context).

## Step 7 — Local/BYOK

`copilot help providers` (BYOK topic) exists in CLI 1.0.70. Not configured on this machine → **untested**, per plan: absence of local-provider setup does not block cloud-only v1; cross-provider child dispatch remains unsupported until proven.

## Step 8 — Gate status: **NOT PASSED**

| Gate requirement | CLI | VS Code |
|---|---|---|
| Explicit per-dispatch selection | pending auth | pending manual |
| Executed-model identity observable (criteria §1) | pending auth | pending manual |
| Resolver runs unattended | mechanism ✅, proof pending | pending manual |

Tasks 1–4 (additive: config engine, skill, installer) proceed — they have no dependency on gate outcome. **Tasks 5–6 (production prompt rewrite + doctrine retirement) are HELD until this gate passes on at least one surface**; any unproved surface will be marked unsupported per AC12.
