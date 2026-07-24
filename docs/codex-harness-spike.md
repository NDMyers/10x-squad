# Harness Spike — Codex CLI / ChatGPT App as a 10x Squad Surface

**Plan:** `~/.claude/plans/does-the-10x-squad-properly-toasty-falcon.md` (Phase 0)
**Started:** 2026-07-23 (Claude Opus 4.8) · **Status: GATE PASSED for `codex-cli` at the *unverified* evidence tier (C2/C3/C5/C9 direct evidence; C4 executed-model identity is NOT observable on this surface). `codex-app` (ChatGPT desktop) unproven — claim nothing for it.**

Companion to `docs/model-routing-harness-spike.md`, which gated `copilot-cli` and `copilot-vscode`.
Same methodology, same evidence discipline: criteria are fixed **before** probes run, and a gate is
claimed only when direct evidence supports it.

---

## Pre-registered evidence criteria (fixed 2026-07-23, before any probe ran)

1. A surface passes the **routing gate** only if a subagent dispatch can carry an explicit,
   per-dispatch model, an invalid model **fails loud** with no silent substitution, and the resolver
   can run **unattended**. (C2 + C3 + C5.)
2. Executed-child-model **identity** must be observable to the agent — not merely present in an
   external log file — for a `verified` / `dispatch_smoke_test` record. Anything weaker records
   `unverified` / `addressability_probe`, exactly as `copilot-vscode` does today. (C4.)
3. Catalog acquisition must come from a **live harness source**. A hardcoded model list is never
   acceptable (`10x-squad-configure-tiers/SKILL.md:102`). (C7.)
4. `codex-app` (ChatGPT desktop) is a **separate surface** and inherits nothing from `codex-cli`.
   Identifiers and capabilities are never reused across surfaces. (C8.)

| # | Question | Pass condition | Status |
|---|---|---|---|
| C1 | Does a root skill hold the orchestrator role? | `$10x-squad-vivaldi` loads and Vivaldi introduces itself | ✅ **PASSED** (single-turn; multi-turn persistence still interactive) |
| C2 | Does subagent spawn honour a per-call `model` and `reasoning_effort`? | Child on a model ≠ parent's runs on the requested model | ✅ **PASSED** (with a narrow model set — see C7) |
| C3 | Does an invalid model fail loud? | Visible error, no child launch, no substitution | ✅ **PASSED** |
| C4 | Is executed child model observable **to the agent**? | `codex exec --json` / spawn result exposes a comparable `model` | ❌ **FAILED** — no model field anywhere |
| C5 | Does the resolver run unattended? | `node …/model-tier-config.js resolve` runs with no per-call approval; a decline is machine-visible | ✅ **PASSED** |
| C6 | Depth + concurrency | Root Vivaldi → depth-1 personas spawn; Cobalt ∥ Sentinel both run | **PARTIAL** — depth-1 spawn proven; concurrency untested |
| C7 | Catalog discovery | Live, reliable, machine-readable list from the harness | ⚠️ **REVISED** — session catalog ≠ spawn catalog |
| C8 | ChatGPT desktop app parity | Loads `.agents/skills/` and `.codex/agents/`; spawns subagents; executes shell | **PENDING** (interactive) |
| C9 | Accepted `reasoning_effort` vocabulary | Exact set accepted at the spawn boundary | ✅ **PASSED** — enforced per model at spawn |
| C10 | Are `.codex/agents/*.toml` dispatch targets? | `spawn_agent` can address a custom agent by name | ❌ **FAILED** — no agent-name parameter exists |

---

## Step 1 — Surfaces and versions (RECORDED 2026-07-23)

| Item | Value |
|---|---|
| OS | macOS 14.7.6, arm64 (Darwin 23.6.0) |
| Codex CLI | `codex-cli 0.145.0`, standalone install at `~/.local/bin/codex` |
| Node | v20.19.0 |
| Auth | `~/.codex/auth.json` present; `codex doctor` reports state databases healthy |
| ChatGPT desktop app | **not yet recorded** — required before any C8 claim |
| Parent model selection | `~/.codex/config.toml` sets `model` + `model_reasoning_effort` explicitly (values not recorded here) |
| `~/.codex/agents/` | **does not exist** — no personal custom agents defined yet |
| `~/.codex/skills/` | exists; contains `.system/`, `playwright/`, `marrow-optimization/`, and symlinks into `~/.agents/skills/` |
| `~/.agents/skills/` | exists; `find-skills`, `using-git-worktrees`, `marrow-optimization.md` |
| Project trust | `/Users/ndmyers/Accrualify` carries a `trust_level` entry in `config.toml` → project-scoped `.codex/agents/` **will** load for this workspace |

---

## Step 2 — Free evidence (no model calls, no billing)

### ⛔ No primary-agent selector — CONFIRMED

`codex --help` and `codex exec --help` expose `--model`, `--profile`, `--sandbox`,
`--ask-for-approval`, `--cd`, `--json`, and more. **There is no `--agent` flag** and no
config key that boots the primary session as a named custom agent.

This confirms the Phase 1 decision: **Vivaldi must be a root-invocable skill**, not a custom agent.
Codex custom agents (`.codex/agents/*.toml`) are subagent definitions only.

### ⚠️ `multi_agent_v2` is DISABLED on this machine — BLOCKER for C2/C3/C4/C6

`codex features list`:

```
multi_agent       stable  true
multi_agent_v2    stable  false
```

The per-spawn `model` / `reasoning_effort` override — the actuator the routing design requires — is
documented as part of the **v2** orchestration toolset (`spawn_agent`, `send_message`,
`followup_task`, `wait_agent`, `list_agents`, `close_agent`). With `multi_agent_v2` off, the probes
would measure v1 behaviour and prove nothing about the contract we intend to ship.

**Action required before C2/C3/C4/C6 run:** enable it explicitly for the probe session
(`codex --enable multi_agent_v2 …`, or `codex features enable multi_agent_v2`), and record whether
per-spawn overrides exist in v1 as well. If the squad requires v2, that becomes a documented
operational precondition — the Codex analogue of the `continueOnAutoMode` hazard recorded in
`docs/model-routing-harness-spike.md:61`.

Also relevant and enabled: `skill_search` (stable, true), `plugins` (stable, true),
`hooks` (stable, true), `guardian_approval` (stable, true).

### ⚠️ C7 — Catalog discovery: **REVISED — session catalog ≠ spawn catalog**

`codex debug models` renders the *session/parent* model catalog as JSON — live, machine-readable,
non-billable. **It is not the spawn catalog.** Step 3 Probe B proved that `spawn_agent` accepts a
strictly smaller set (see below). This repeats, on a new surface, the exact lesson recorded at
`docs/model-routing-harness-spike.md:39`: **a catalog is documentation, not an availability source
of truth.** The `codex-cli` adapter must acquire the **spawn-time** list, not this one.

Session catalog snapshot, 2026-07-23 (7 entries; `visibility: "list"` is the parent-selectable set):

| slug | display_name | visibility | default effort | supported reasoning levels |
|---|---|---|---|---|
| `gpt-5.6-sol` | GPT-5.6-Sol | list | medium | low, medium, high, xhigh, max, ultra |
| `gpt-5.6-terra` | GPT-5.6-Terra | list | medium | low, medium, high, xhigh, max, ultra |
| `gpt-5.6-luna` | GPT-5.6-Luna | list | medium | low, medium, high, xhigh, max |
| `gpt-5.5` | GPT-5.5 | list | xhigh | low, medium, high, xhigh |
| `gpt-5.4` | GPT-5.4 | list | medium | low, medium, high, xhigh |
| `gpt-5.4-mini` | GPT-5.4-Mini | list | medium | low, medium, high, xhigh |
| `codex-auto-review` | Codex Auto Review | **hide** | medium | low, medium, high, xhigh |

**Adapter contract for `codex-cli` — REVISED:** `codex debug models` is usable only as the
*parent* model list. The **assignment** identifiers the squad writes into `model-routing.json` must
come from the spawn boundary (Step 3, Probe B2/C), whose error message enumerates the accepted set —
the same failure-path discovery mechanism Copilot CLI provides
(`docs/model-routing-harness-spike.md:77`). If neither source returns a reliable list, **STOP** —
no fallback, no hardcoded list.

**Note on the Auto ban:** there is no `Auto` entry in either Codex catalog. Squad invariant 12 is
vacuously satisfied on this surface; the resolver's existing `auto`/`inherit` rejection stays as a
defence-in-depth check on user input, not as a catalog exclusion.

### ✅ C9 — Reasoning vocabulary: **PASSED** (with a design consequence)

`supported_reasoning_levels` is declared **per model, not per harness**:

- `gpt-5.6-sol`, `gpt-5.6-terra` → up to `ultra`
- `gpt-5.6-luna` → up to `max`
- `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini` → up to `xhigh`

Step 3 Probe C5 confirmed this is **enforced at the spawn boundary**, not merely declared:

```text
Reasoning effort `bogus-effort` is not supported for model `gpt-5.6-sol`.
Supported reasoning efforts: low, medium, high, xhigh, max, ultra
```

**Consequence for Phase 3 (and how it was resolved).** The repo validated one global enum,
`REASONING_EFFORTS = auto|low|medium|high|xhigh`, gated by one per-harness boolean
(`EXPLICIT_DISPATCH_HARNESSES`). Effort legality on Codex has **two** dimensions:

1. A harness-level vocabulary — `max` and `ultra` are valid Codex efforts but not Copilot ones.
2. A per-model constraint — `gpt-5.5` + `ultra` is invalid while `gpt-5.6-sol` + `ultra` is valid.

Phase 3 split these by where the knowledge lives, rather than forcing both into one validator:

- **Dimension 1 → the dependency-free engine.** The global enums + boolean were replaced by a
  per-harness capability map (`HARNESS_DISPATCH_CAPABILITIES` in both scripts). `codex-cli` gets
  `…|max|ultra` reasoning and `auto`-only context; Copilot behaviour is byte-preserved.
- **Dimension 2 → the skill and the harness, NOT the engine.** Per-model legality is a *live-catalog*
  fact (`codex debug models` → `supported_reasoning_levels`). The dependency-free engine must never
  hardcode model facts, so it does not attempt this check. The configure-tiers skill validates the
  chosen effort against the chosen model's supported set at configuration time, and Codex enforces
  it again at spawn (Probe C5, above). This is strictly better than threading `assignments` into
  `validateDispatchSettings` would have been — that path could only have carried a hardcoded table.

So the plan's "per-harness supported-settings map" was the right engine shape; the per-model half
simply belongs one layer up, with the catalog.

### C5 — Unattended resolver: mechanism identified, execution unproven

`codex exec` exposes `--ask-for-approval <never|on-request|on-failure|untrusted>` and
`--sandbox <read-only|workspace-write|danger-full-access>`. `read-only` + `--ask-for-approval never`
is the intended posture for the resolver (it only reads config and writes nothing during `resolve`).
Codex also has `.rules` execpolicy files (`~/.codex/rules/`, `--ignore-rules`) as a finer-grained
allowlist mechanism — the closest analogue to Copilot's `--allow-tool "shell(node:*)"`.

**Not yet proven:** that a `node` invocation of the installed resolver actually executes without
approval under that posture, and that a *declined* invocation is machine-visible to the agent
(the Copilot D2 property, `docs/model-routing-harness-spike.md:82`). Requires a live run.

---

## Step 3 — Live dispatch probes: **COMPLETED 2026-07-23**

All runs: `codex exec -C <disposable scratch git repo> --json --sandbox read-only`, parent model
`gpt-5.4-mini`, `--enable multi_agent_v2` per invocation (no change to `~/.codex/config.toml`).
Workspace trust supplied per-invocation via `-c projects."<path>".trust_level="trusted"`.

### Probe A — session-level observability: **NO MODEL FIELD** ❌

`codex exec --json --model gpt-5.4-mini "Reply with exactly: MODEL_ROUTE_OK …"` → exit 0, correct
answer. The **complete** event stream was:

```json
{"type":"thread.started","thread_id":"019f90c5-5eb0-7a33-95a4-013e7c344b1b"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"MODEL_ROUTE_OK"}}
{"type":"turn.completed","usage":{"input_tokens":13928,"cached_input_tokens":3456,…}}
```

**No event carries `model`.** This is the sharpest contrast with Copilot CLI, where
`assistant.turn_start` / `assistant.message` / `assistant.turn_end` / `subagent.started` /
`subagent.completed` all carry `model` (`docs/model-routing-harness-spike.md:69`, `:74`).

### Probe B0 — the spawn toolset (v2 enabled)

The session enumerated its own tools:

```text
spawn_agent:     fork_turns, message, model, reasoning_effort, task_name
followup_task:   message, target
interrupt_agent: target
list_agents:     path_prefix
send_message:    message, target
wait_agent:      timeout_ms
```

`model` and `reasoning_effort` **are** first-class per-dispatch parameters. **There is no
`agent_type` / agent-name parameter** (see C10).

### Probe B/B2 — fail-loud and the real spawn catalog: **C3 PASSED**, **C7 REVISED** ⚠️

```text
spawn_agent(model="gpt-5.4", …)
  → Unknown model `gpt-5.4` for spawn_agent. Available models: gpt-5.6-sol, gpt-5.6-terra

spawn_agent(model="not-a-real-model-xyz", …)
  → Unknown model `not-a-real-model-xyz` for spawn_agent. Available models: gpt-5.6-sol, gpt-5.6-terra
```

Both rejected **before launch**, with no child started and **no substitution** — the Copilot Probe
B2 property, satisfied.

**The consequential finding:** `gpt-5.4` is a perfectly valid *parent* model (Probe A ran a whole
session on `gpt-5.4-mini`) yet is **not spawnable**. The spawn set on this account today is
**`{gpt-5.6-sol, gpt-5.6-terra}`** — 2 of the 6 listed session models. Five work tiers must be
distinguished across two models plus six reasoning efforts.

### Probe C — successful spawn and child observability: **C2 PASSED / C4 FAILED**

```text
spawn_agent(model="gpt-5.6-sol", reasoning_effort="ultra", task_name="probe_c1",
            message="Reply with exactly CHILD_OK")
  → {"task_name":"/root/probe_c1"}

wait_agent()
  → {"message":"Wait completed.","timed_out":false}

list_agents()
  → {"agents":[{"agent_name":"/root","agent_status":"running"},
               {"agent_name":"/root/probe_c1","agent_status":{"completed":"CHILD_OK"}}]}
```

The child ran and returned `CHILD_OK` — a parent on `gpt-5.4-mini` successfully spawned a child on
`gpt-5.6-sol` at `ultra` effort. **C2 passes: per-dispatch model and reasoning effort are real
actuators**, and a cheaper-parent → pricier-child dispatch is permitted (no cost-tier ceiling).

**C4 fails.** No field in `spawn_agent`, `wait_agent`, or `list_agents` identifies the model the
child executed on, and the JSONL stream carries none either (Probe A). Requested-versus-executed
comparison is **not possible** on this surface. Per pre-registered criterion 2, `codex-cli`
therefore records `identity_observable: false`, `status: unverified`, `method:
addressability_probe` — the same posture `copilot-vscode` holds today, not the `verified` posture
`copilot-cli` earned.

### Probe C4 — custom agents are not dispatch targets: **C10 FAILED** ❌

A valid `.codex/agents/probe-persona.toml` (`name`, `description`, `developer_instructions`,
`sandbox_mode`) was placed in the trusted scratch workspace. The session located the file, then
reported: the TOML "is only a persona definition; the available spawn tool still has no agent-name
argument," and answered **No** to whether any dispatch path to a named custom agent exists.

**Consequence for Phase 2 — a planned deliverable is now dead weight.** Shipping
`assets/codex-agents/*.toml` would install six files that nothing can address. Personas must
instead ride in the `spawn_agent` `message` payload as an explicit skill invocation
(`$10x-linus-build` + the permitted context slice), which is also better aligned with the repo's
existing rule that persona skills are the single source of persona behaviour.

### Probe C5 — reasoning effort validated per model at spawn: **C9 PASSED**

```text
spawn_agent(model="gpt-5.6-sol", reasoning_effort="bogus-effort", …)
  → Reasoning effort `bogus-effort` is not supported for model `gpt-5.6-sol`.
    Supported reasoning efforts: low, medium, high, xhigh, max, ultra
```

Confirms the per-model (not per-harness) validation requirement recorded under C9.

---

### Probe D — unattended resolver: **C5 PASSED** ✅

The installed skill was staged at `.agents/skills/10x-squad-configure-tiers/` in the scratch
workspace and the session was asked to run the resolver verbatim under `--sandbox read-only`:

```text
command:   /bin/zsh -lc 'node .agents/skills/10x-squad-configure-tiers/scripts/model-tier-config.js \
             resolve --workspace-root "$PWD" --harness codex-cli --tier trivial --json'
stdout:    (empty)
stderr:    No profile for harness "codex-cli" in workspace or global configuration.
           Run /10x-squad-configure-tiers to configure work-tier model assignments.
exit code: 3
```

Three things proven at once:

1. **Unattended execution** — the session answered "No" to whether any approval prompt appeared.
2. **The exit-code contract already works for Codex** — exit `3` is the engine's documented
   "active harness profile missing" code (`model-tier-config.js:35`), reached through an unmodified
   `codex-cli` harness argument. The resolver needed no changes to be callable from this surface.
3. **Failures are machine-visible** — the JSONL stream emits
   `{"type":"item.completed","item":{"type":"command_execution","command":…,"aggregated_output":…,"exit_code":…}}`,
   satisfying the runtime requirement that a declined or failed resolver invocation maps to a hard
   configuration failure rather than improvisation (the Copilot D2 property).

---

### Probe E — Vivaldi as a root skill: **C1 PASSED**, with a discovery caveat ⚠️

After a real `node bin/10x-squad.js install -d <scratch>`, `codex debug prompt-input` (free, no model
call) showed the model-visible skill list. All six persona skills appeared. **Vivaldi did not.**

Isolated by toggling one field:

| `agents/openai.yaml` | Listed in `prompt-input`? |
|---|---|
| file absent | yes |
| `policy.allow_implicit_invocation: true` | yes |
| `policy.allow_implicit_invocation: false` | **no** |

So `allow_implicit_invocation: false` removes a skill from the ambient list entirely — the model is
not told it exists. **Explicit invocation still works:**

```text
$ codex exec -C <workspace> --sandbox read-only '$10x-squad-vivaldi'
→ "I'm Vivaldi, orchestrating the 10x Squad: Einstein for deliberation, Peter for spec,
   Linus for build, Cobalt and Sentinel for review, Ralph for tests. Send the task, and
   I'll classify the tier and route it through the pipeline."
```

This is the intended posture and it is worth stating plainly because the two halves look
contradictory: Vivaldi is **invisible to implicit matching** (a 25KB orchestrator must never hijack
an unrelated request) but **fully reachable** via `$10x-squad-vivaldi`. It also confirms the
skill-load check in the Codex dispatch contract works — the introduction is the signal.

Not yet proven: that the persona holds across ≥3 turns (`codex exec` is single-shot; needs an
interactive session).

---

### Probe H — full pipeline e2e after install: **PASSED** ✅

After `node bin/10x-squad.js install -d <scratch> --harness codex` and a workspace `codex-cli`
routing profile, `$10x-squad-vivaldi` was given a real Trivial task ("fix the typo in NOTES.md").
Observed, in order: Vivaldi classified `Trivial`; ran
`model-tier-config.js resolve --harness codex-cli --tier trivial` and consumed the exact JSON
(`model gpt-5.6-terra, reasoning low, context auto`); emitted the exact announcement
`Routing to Linus — Trivial (trivial) [codex-cli] — model gpt-5.6-terra; reasoning low`; spawned the
Linus persona; the edit landed (`teh cat` → `the cat`, confirmed by `git diff`). This exercises the
whole path — install → configure → resolve → announce → dispatch → apply — on the real harness.

**Minor finding:** the first `spawn_agent` was rejected on a `task_name` naming constraint
(`Linus-trivial` — hyphen + uppercase) and Vivaldi self-recovered with a valid name. Guidance in
`dispatch-codex.md` now specifies a lowercase `snake_case` `task_name` (`linus_trivial`).

---

## Remaining probes

| Probe | Blocked on | Proves |
|---|---|---|
| **E2** — multi-turn persona persistence | interactive session | C1 (full) |
| **F** — ChatGPT desktop app | nothing; build now installs | C8 |
| **G** — concurrency | nothing | C6 (Cobalt ∥ Sentinel) |

---

## Gate status: **PASSED for `codex-cli` at the unverified evidence tier**

| Pre-registered criterion | Result |
|---|---|
| §1 routing gate — per-dispatch model (C2) | ✅ `spawn_agent` `model` + `reasoning_effort` honoured |
| §1 routing gate — fail loud (C3) | ✅ invalid model and invalid effort both rejected pre-launch, no substitution |
| §1 routing gate — unattended resolver (C5) | ✅ ran with no approval; exit 3; failure machine-visible |
| §2 executed-model identity (C4) | ❌ not observable → `unverified` / `addressability_probe` only |
| §3 live catalog (C7) | ⚠️ spawn-time error enumeration only; `codex debug models` is the wrong source |
| §4 `codex-app` is separate (C8) | ⏳ unproven — claim nothing for the ChatGPT desktop app |

**Verdict:** `codex-cli` may join `EXPLICIT_DISPATCH_HARNESSES`, but it enters at the
**`copilot-vscode` evidence tier, not the `copilot-cli` tier** — configuration completes after a
successful addressability probe and records `unverified` with a loud warning. Do not claim executed-
model verification on Codex.

**Two design changes this spike forced on the approved plan (both now implemented):**

1. **Dropped `assets/codex-agents/*.toml` from Phase 2** (C10) — personas ride in the spawn `message`.
2. **Split effort validation by knowledge layer** (C9) — harness vocabulary in the engine's
   per-harness capability map; per-model legality in the skill (live catalog) + the harness (spawn).
   See the "Consequence for Phase 3" note above for why this beats a single per-assignment validator.

**Open product question:** only two spawnable models exist today. Five work tiers across
`{gpt-5.6-sol, gpt-5.6-terra}` × six reasoning efforts is the whole routing space on this surface.
