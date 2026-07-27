# Harness Spike — Codex CLI / ChatGPT App as a 10x Squad Surface

**Plan:** `~/.claude/plans/does-the-10x-squad-properly-toasty-falcon.md` (Phase 0)
**Started:** 2026-07-23 (Claude Opus 4.8) · **Updated:** 2026-07-27 (Probe F Part 1, criterion §5/C11)
**Status: GATE PASSED for `codex-cli` at the *unverified* evidence tier (C2/C3/C5/C9 direct evidence; C4 executed-model identity is NOT observable on this surface). `codex-app` (ChatGPT desktop) unproven — claim nothing for it.**

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
5. **Extension recorded 2026-07-27, before any Probe F evidence was taken.** A surface earns its own
   harness key only if the agent can observe, **at runtime**, which surface it is running on. Both
   Codex surfaces open the same workspace and load the same single installed Vivaldi
   (`.agents/skills/10x-squad-vivaldi/SKILL.md`), whose dispatch section hardcodes
   `--harness codex-cli`. Adding a `codex-app` key with no discriminator would therefore not leave
   the app unsupported — it would make the app resolve the **CLI's** profile silently, converting a
   known gap into a silent mis-routing failure. Capability without addressability is not support.
   (C11.)

| # | Question | Pass condition | Status |
|---|---|---|---|
| C1 | Does a root skill hold the orchestrator role? | `$10x-squad-vivaldi` loads and Vivaldi introduces itself | ✅ **PASSED** (single-turn; multi-turn persistence still interactive) |
| C2 | Does subagent spawn honour a per-call `model` and `reasoning_effort`? | Child on a model ≠ parent's runs on the requested model | ✅ **PASSED** (with a narrow model set — see C7) |
| C3 | Does an invalid model fail loud? | Visible error, no child launch, no substitution | ✅ **PASSED** |
| C4 | Is executed child model observable **to the agent**? | `codex exec --json` / spawn result exposes a comparable `model` | ❌ **FAILED** — no model field anywhere |
| C5 | Does the resolver run unattended? | `node …/model-tier-config.js resolve` runs with no per-call approval; a decline is machine-visible | ✅ **PASSED** |
| C6 | Depth + concurrency | Root Vivaldi → depth-1 personas spawn; Cobalt ∥ Sentinel both run | **PARTIAL** — depth-1 spawn proven; concurrency untested |
| C7 | Catalog discovery | Live, reliable, machine-readable list from the harness | ⚠️ **REVISED** — session catalog ≠ spawn catalog |
| C8 | ChatGPT desktop app parity | Loads `.agents/skills/`; spawns subagents with per-dispatch `model`/`reasoning_effort`; executes shell unattended | ✅ **PASSED** at the *unverified* tier (Probe F) — via `multi_agent_v1`, not v2; executed-model identity still unobservable |
| C9 | Accepted `reasoning_effort` vocabulary | Exact set accepted at the spawn boundary | ✅ **PASSED** — enforced per model at spawn |
| C10 | Are `.codex/agents/*.toml` dispatch targets? | `spawn_agent` can address a custom agent by name | ❌ **FAILED** — no agent-name parameter exists |
| C11 | Surface discriminator — can Vivaldi tell `codex-app` from `codex-cli` at runtime? | A deterministic signal observable from an agent-run shell command | ✅ **PASSED** — `CODEX_INTERNAL_ORIGINATOR_OVERRIDE=Codex Desktop`, corroborated by `PATH`; binary-path and version signals **failed** |

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

### ⚠️ `multi_agent_v2` is DISABLED on this machine — ~~BLOCKER for C2/C3/C4/C6~~

> **SUPERSEDED 2026-07-27 by Probe I2. The blocker below is wrong.** `model` and `reasoning_effort`
> are **v1** parameters, present with no feature flag on both surfaces; `--enable multi_agent_v2`
> merely swaps in a different toolset (`task_name`, `list_agents`, `followup_task`). The reasoning
> below is preserved as written because it shows the failure mode: an attribution taken from
> documentation and then treated as measured. The action item it raised — *"record whether per-spawn
> overrides exist in v1 as well"* — was the right instinct and went unrun for four days while a
> precondition built on the untested half shipped to users.

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

### Probe F — ChatGPT desktop app (`codex-app`)

Split in two because the two halves have different costs and, more importantly, **different
epistemic standing**. Part 1 is what the machine can be asked without a model call; Part 2 is what
only a human driving the GUI can answer. Nothing in Part 1 is evidence about the app's *agent
surface* — read the scope note before drawing a conclusion from it.

#### Part 1 — free evidence, RECORDED 2026-07-27 (no model calls, no billing)

> **Scope of this evidence.** Every row below observes the **engine binary the app ships**
> (`/Applications/ChatGPT.app/Contents/Resources/codex`), invoked directly from a terminal. It says
> nothing about what tools the app's chat UI exposes to a session, which is precisely what F3/F4/F5
> test. Per Principle 8 (`docs/review/LEARNING.md`), these claims inherit the scope of their
> evidence: they are about the bundled engine, not about `codex-app` as an agent surface.

Setup — a disposable workspace, never this repo:

```bash
S=/tmp/codex-app-probe && rm -rf $S && mkdir -p $S && cd $S && git init -q && echo "teh cat" > NOTES.md && git add -A
node /Users/ndmyers/Accrualify/10x-squad/bin/10x-squad.js install -d $S --harness codex
node $S/.agents/skills/10x-squad-configure-tiers/scripts/model-tier-config.js \
  upsert-profile --input <profile.json> --scope workspace --workspace-root $S --harness codex-cli
```

(`<profile.json>` is the known-good `codex-cli` profile: `gpt-5.6-terra` for `trivial`/`lite`,
`gpt-5.6-sol` for the three standard/complex tiers, efforts `low|medium|high|high|ultra`, all
contexts `auto`. `resolve --tier trivial --json` then returns
`{"ok":true,…,"model":"gpt-5.6-terra","check_status":"unverified","reasoning_effort":"low","context_tier":"auto"}`
at exit 0, so Part 2 has a real profile to resolve.)

**F0a — versions.** ChatGPT app bundle `26.721.41059` (`CFBundleShortVersionString`).

**F0b — the app ships its own engine, and it is a different build.** ⚠️

| Surface | Binary | Version |
|---|---|---|
| `codex-cli` | `~/.local/bin/codex` | `codex-cli 0.145.0` |
| `codex-app` | `/Applications/ChatGPT.app/Contents/Resources/codex` | `codex-cli 0.146.0-alpha.3.1` |

This upgrades pre-registered criterion §4 from *policy* to *evidence*: the two surfaces do not merely
deserve separate treatment by rule, they run **different engine builds**, one of them a prerelease.
A capability proven on 0.145.0 is not a capability proven on 0.146.0-alpha.3.1, in either direction.

**F0c — `multi_agent_v2` ships disabled on the app engine too.** Identical to the CLI:

```text
multi_agent                          stable             true
multi_agent_mode                     removed            false
multi_agent_v2                       stable             false
```

So the Step-2 blocker recorded for `codex-cli` applies unchanged, and Part 2 must enable the feature
or it measures v1 and proves nothing.

**F0d — the two engines see an identical *parent* catalog.** `codex debug models` from each binary,
normalized and diffed, is byte-identical: the same seven entries, same `visibility`, same
`supported_reasoning_levels` as the Step-2 snapshot. **This is not transitive to the spawn catalog.**
Probe B2 established on `codex-cli` that the spawn set is strictly smaller than the parent set and is
knowable only at the spawn boundary; the app's spawn set is unmeasured and must not be inferred from
this row.

**F0e — the launcher forwards config and feature overrides.** `codex app --help` documents
`-c <key=value>` and `--enable <FEATURE>` ("Equivalent to `-c features.<name>=true`") alongside the
`[PATH]` workspace argument. That is the mechanism Part 2 uses to try enabling `multi_agent_v2`
without touching global config. **Whether the Electron shell actually threads those into the agent
session is unproven** — F3 is the test.

**F0f — the app engine sees the installed squad skills.** `codex debug prompt-input` run from the
probe workspace with the bundled binary lists all seven installed skills — the six personas plus
`10x-squad-configure-tiers` — with `file:` locators under `/private/tmp/codex-app-probe/.agents/skills/`.
Vivaldi is **absent**, exactly as on the CLI (Probe E: `allow_implicit_invocation: false` removes a
skill from the ambient list by design; explicit `$10x-squad-vivaldi` invocation is the reachability
test, and that is F2).

Diffing the two engines' `prompt-input` output structurally: **content identical**, one structural
difference — the app engine's entries carry an extra `id` field (`msg_019fa483-…`) that the CLI's
do not. Not squad-relevant, recorded for completeness.

**F0g — the surfaces share `CODEX_HOME`, and this makes a discriminator *less* likely.** ⚠️

Both binaries document `~/.codex/config.toml` as their config source, and the app writes into that
same shared file: it owns `[mcp_servers.node_repl]` (whose `env` table carries
`CODEX_CLI_PATH = "/Applications/ChatGPT.app/Contents/Resources/codex"`,
`BROWSER_USE_CODEX_APP_VERSION = "26.721.41059"`, `CODEX_HOME`) and it owns entries in
`[shell_environment_policy.set]`.

The consequence matters for C11: **`shell_environment_policy.set` is shared**, so anything it injects
appears in *both* surfaces' agent shells and cannot discriminate. Likewise the `node_repl` `env` table
reaches that MCP server, not the agent's shell. A discriminator, if one exists, must therefore be
injected by the app **at runtime**, not read from config.

Static search of the app bundle and both engine binaries for a surface-identity variable found **no
`CODEX_SURFACE`/`CODEX_CLIENT`/`CODEX_UI` equivalent**. The nearest candidates, none confirmed to
reach an agent shell, are `CODEX_MANAGED_PACKAGE_ROOT` (two occurrences in the app engine, one in the
CLI engine), `CODEX_INTERNAL_ORIGINATOR_OVERRIDE`, and the app-only `CODEX_APP_BUILD_FLAVOR` /
`CODEX_APP_BRAND` strings in `app.asar`. **Prior going into F7: weak.** The likeliest real signal is
the resolved `codex` binary path inside the app's shell, and the fallback is the engine version —
which F7 must treat as a weak signal only (see below).

**F0h — the probe workspace is not yet trusted.** `~/.codex/config.toml` carries `trust_level`
entries for ten project paths; `/private/tmp/codex-app-probe` is not among them. Expect a trust
prompt when the app opens it — approve it in the UI, or pre-add the entry. This is a setup detail,
not a finding.

##### What Part 1 settles, and what it does not

| Question | Settled by Part 1? |
|---|---|
| Is `codex-app` a genuinely distinct surface? | **Yes** — different engine build (F0b) |
| Does the app's engine discover the installed skills? | **Yes**, for the engine invoked directly (F0f) |
| Does the app's *chat UI* expose `spawn_agent` with `model` + `reasoning_effort`? | **No** — F3/F4 |
| Can the app run the resolver unattended? | **No** — F5 |
| Can Vivaldi tell which surface it is on? | **No** — F7, and the prior is weak (F0g) |

#### Part 2 — operator protocol: **NOT YET RUN**

Requires a human at the ChatGPT GUI. Runs in one sitting against the workspace built in Part 1.
Record each row independently; a row that cannot be run is recorded as *not run*, never inferred
from a neighbouring row.

**Launch.** Try the transient path first, so global config stays untouched:

```bash
codex app --enable multi_agent_v2 /tmp/codex-app-probe
```

If the session reports no `spawn_agent` tool, fall back to the persistent path — add one line under
the **existing** `[features]` table in `~/.codex/config.toml`:

```toml
[features]
js_repl = false
multi_agent_v2 = true   # PROBE ONLY — remove after
```

> ⚠️ **This is a persistent, global change that also affects the Codex CLI.** Remove the line when
> the sitting ends, and record in the results table which launch path was used — a result obtained
> via the config fallback does **not** demonstrate that `codex app --enable` works.

**Rows to run.** Paste each into the app; record the verbatim response.

| # | What to run in the app | Pass condition | On failure, record |
|---|---|---|---|
| F1 | "List the skills you can see." | All seven installed squad skills appear (six personas + `10x-squad-configure-tiers`) | The full list returned, so the gap is attributable |
| F2 | `$10x-squad-vivaldi` | Vivaldi loads and introduces itself by name and roster | Whether the app rejected the `$` syntax or loaded nothing |
| F3 | "List your available tools verbatim, with each tool's parameter names." | `spawn_agent` present | Whether v1 `multi_agent` tools appear instead, and which launch path was used |
| F4 | (only if F3 passes) "Spawn an agent with model `gpt-5.6-sol`, reasoning_effort `ultra`, task_name `probe_f4`, message `Reply with exactly CHILD_OK`. Then wait for it." | Both parameters accepted; child returns `CHILD_OK` | The exact rejection text — and the `Available models:` enumeration if present, which is the app's real spawn catalog |
| F4b | (only if F4 passes) Repeat with model `not-a-real-model-xyz` | Rejected **before** launch, no substitution, error enumerates the accepted set | Any silent substitution — that would be a hard fail, worse than F4 failing |
| F5 | "Run exactly: `node .agents/skills/10x-squad-configure-tiers/scripts/model-tier-config.js resolve --workspace-root \"$PWD\" --harness codex-cli --tier trivial --json` and show stdout, stderr, and the exit code." | Runs with no approval prompt; stdout is the single-line JSON; exit 0 | Whether a prompt appeared, and whether a decline is machine-visible to the agent |
| F6 | "Read `.10x-squad/model-routing.json` and report the `codex-cli` profile you see." | Same profile the CLI resolves | Any divergence in config/trust/profile resolution |
| F7 | "Run and show output: `env \| sort`; `command -v codex`; `codex --version`; `printf '%s\n' \"${CODEX_HOME:-unset}\"`; `printf '%s\n' \"${CODEX_MANAGED_PACKAGE_ROOT:-unset}\"`" — then run the identical block under `codex exec` on the CLI and diff | A **stable** differing signal: an env var, or a `codex` path resolving inside `/Applications/ChatGPT.app/` | The full diff, even when empty — an empty diff is the finding |

**F7 pass bar, stated before the probe runs.** An engine-version difference (`0.146.0-alpha.3.1` vs
`0.145.0`) is a **weak** signal and does **not** on its own satisfy F7: it is a coincidence of release
timing that a CLI upgrade erases, and routing correctness must not rest on two builds staying skewed.
An env var or an install-path signal satisfies F7; a version string alone does not.

**Results table — to be filled by the session that runs this.**

| # | Result | Evidence |
|---|---|---|
| F1 | *not run* | |
| F2 | *not run* | |
| F3 | ✅ **PASSED — but under `multi_agent_v1`, not v2** | tool enumeration, 2026-07-27, below |
| F4 | ✅ **PASSED** — both parameters accepted, child ran | below |
| F4b | ✅ **PASSED** (fail-loud) — and revealed a **5-model** spawn catalog | below |
| F5 | ✅ **PASSED** — unattended, exit 0, correct JSON | below |
| F6 | ✅ **PASSED** — identical profile resolution | below |
| F7 | ✅ **PASSED** — `CODEX_INTERNAL_ORIGINATOR_OVERRIDE=Codex Desktop`, corroborated by `PATH` | below |

##### F3 — RECORDED 2026-07-27: `spawn_agent` exists, and **v1 carries the actuator**

Launched with `codex app --enable multi_agent_v2 /tmp/codex-app-probe`. The session enumerated its
own tools. The orchestration namespace it reported is **`multi_agent_v1__`**:

```text
multi_agent_v1__spawn_agent(fork_context, items, message, model, reasoning_effort, service_tier)
multi_agent_v1__wait_agent(targets, timeout_ms)
multi_agent_v1__send_input(interrupt, items, message, target)
multi_agent_v1__resume_agent(id)
multi_agent_v1__close_agent(target)
```

Shell execution is present as
`exec_command(cmd, justification, login, max_output_tokens, prefix_rule, sandbox_permissions, shell, tty, workdir, yield_time_ms)`.

**Finding 1 — a recorded surface fact is falsified, within a stated scope.** Step 2 recorded that the
per-spawn `model` / `reasoning_effort` override "is documented as part of the **v2** orchestration
toolset", and flagged as an open action: *"record whether per-spawn overrides exist in v1 as well."*
This answers it. **On the app engine (`0.146.0-alpha.3.1`), `multi_agent_v1__spawn_agent` carries both
`model` and `reasoning_effort` as first-class parameters.** The actuator is not v2-exclusive.

Scope discipline: this is evidence about **v1 on the app engine only**. It does **not** establish that
`codex-cli` 0.145.0's v1 carries them — that surface was only ever probed with v2 forced on. The
correct correction to Step 2 is "the v2-only attribution was an inference from documentation and is
now known to be false on at least one surface", **not** "v1 works everywhere".

**Finding 2 — `--enable multi_agent_v2` did not produce v2 tools in the app.** The v2 toolset has a
different shape (`followup_task`, `interrupt_agent`, `list_agents`, `send_message` — Probe B0); what
appeared is unambiguously v1 (`send_input`, `resume_agent`, `close_agent`). So either the launcher
does not thread `--enable` into the app session, or the app pins v1. **F0e's pass-through is therefore
unproven in practice**, and the app's dispatch contract must be treated as v1's.

**Finding 3 — the v1 spawn signature differs from v2's, and the differences bite.**

| | CLI, v2 (Probe B0) | App, v1 (F3) |
|---|---|---|
| spawn params | `fork_turns, message, model, reasoning_effort, task_name` | `fork_context, items, message, model, reasoning_effort, service_tier` |
| child naming | `task_name` (lowercase `snake_case` enforced) | **none** |
| wait | `wait_agent(timeout_ms)` | `wait_agent(targets, timeout_ms)` |
| enumerate children | `list_agents(path_prefix)` | **absent** |
| extra | — | `items`, `service_tier` |

Consequences if `codex-app` is ever added: the `task_name` guidance committed for `codex-cli`
(`596e91f`) **does not apply here** — there is no such parameter; `wait_agent` needs an explicit
`targets` value, so the spawn result must be captured; and there is no `list_agents` fallback for
recovering a lost child handle. `service_tier` is a new, unexamined dispatch dimension — do not pass
it speculatively.

**Finding 4 — a second, app-only dispatch surface exists.** `codex_app__create_thread(model, prompt,
target, thinking)` and `codex_app__send_message_to_thread(hostId, model, prompt, thinking, threadId)`
also take a per-call `model`. This is a distinct routing actuator with no CLI analogue. Recorded, not
probed; out of scope for C8 and not to be assumed equivalent to a subagent dispatch.

##### F4 — RECORDED 2026-07-27: the routing actuator works on the app

```text
multi_agent_v1__spawn_agent(model="gpt-5.6-sol", reasoning_effort="ultra",
                            message="Reply with exactly CHILD_OK")
  → {"agent_id":"019fa4f1-90f0-7fb3-a8c7-55bcf4cb52bb","nickname":"James"}

multi_agent_v1__wait_agent(targets=["019fa4f1-90f0-7fb3-a8c7-55bcf4cb52bb"])
  → {"status":{"019fa4f1-90f0-7fb3-a8c7-55bcf4cb52bb":{"completed":"CHILD_OK"}},"timed_out":false}
```

**C2's analogue passes on `codex-app`:** a per-dispatch `model` and `reasoning_effort` were accepted
and the child ran to completion. Child handles are server-assigned UUIDs plus a human `nickname`
("James") — there is no caller-supplied name, confirming F3's Finding 3. `wait_agent` is keyed by
`agent_id`, so a dispatcher **must** retain the spawn return; with no `list_agents` on this surface,
a lost handle is unrecoverable.

**C4's analogue fails here too.** The spawn result carries `agent_id` and `nickname`; the wait result
carries completion status. **No field in either identifies the model the child executed on.**
`codex-app` therefore sits at the same `unverified` / `addressability_probe` tier as `codex-cli` and
`copilot-vscode`. Never claim executed-model verification on the ChatGPT app either.

##### F4b — RECORDED 2026-07-27: fail-loud passes, and the spawn catalog is **bigger** ⚠️

```text
multi_agent_v1__spawn_agent(model="not-a-real-model-xyz", …)
  → Unknown model `not-a-real-model-xyz` for spawn_agent.
    Available models: gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.5, gpt-5.4
```

Rejected **before** launch, no child started, **no silent substitution** — C3's analogue passes, and
the error enumerates the accepted set, so the surface carries its own authoritative availability
source exactly as `codex-cli` does.

**The consequential finding, stated with its confound.** The enumerated app spawn set is **five**
models — `{gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.5, gpt-5.4}` — against the **two** that
`codex-cli` enumerated in Probe B2, `{gpt-5.6-sol, gpt-5.6-terra}`. `gpt-5.4` in particular was
explicitly *rejected* as a child on the CLI.

> ⚠️ **Do not yet attribute this to the surface.** The CLI figure was measured **2026-07-23** and the
> app figure **2026-07-27**. Entitlement is account-and-time-dependent, and this repo has already
> recorded once that a catalog is not an availability source of truth. The gap is therefore
> **confounded**: it is consistent with a genuine surface difference *and* with the account's spawn
> entitlement widening over four days. **A same-day CLI re-probe is required before either reading is
> recorded.** Whichever way it resolves, the result is worth having: a surface difference is direct
> §4 evidence, and a drift finding is direct evidence that spawn catalogs must be re-acquired rather
> than cached.

**If it resolves as a surface difference, it also answers the standing product question.** The open
item — "five work tiers across two spawnable models is the entire Codex routing space" — would be a
`codex-cli` constraint, not a Codex one: five spawnable models on the app restores genuine
model-axis tier differentiation instead of forcing everything onto the reasoning-effort axis.

**Finding 5 — C11 may be satisfiable without an env var.** The app session exposes a
`codex_app__*` tool family (16 tools) that the CLI's enumeration (Probe B0) did not contain, and it
names its orchestration namespace `multi_agent_v1__` where the CLI reported bare `spawn_agent`. An
agent can observe its own tool list directly, with no shell call — which is a **stronger** kind of
signal than an env var, since it is the agent's own capability surface. **Not yet a pass:** F7 must
still confirm the negative half on the CLI (that `codex_app__*` is absent there) rather than relying
on Probe B0, whose enumeration was v2 and not written to answer this question.

##### F5 / F6 — RECORDED 2026-07-27: resolver runs unattended, config resolves identically

```text
node .agents/skills/10x-squad-configure-tiers/scripts/model-tier-config.js resolve \
  --workspace-root "$PWD" --harness codex-cli --tier trivial --json

stdout:    {"ok":true,"schema_version":2,"scope":"workspace","harness":"codex-cli","tier":"trivial",
            "model":"gpt-5.6-terra","check_status":"unverified","reasoning_effort":"low","context_tier":"auto"}
stderr:    (empty)
exit code: 0
approval prompt: none appeared
```

**F5 passes** — C5's analogue holds on the app: the installed resolver executes with no per-call
approval and the exit-code contract works unmodified. **F6 passes** — the app read
`.10x-squad/model-routing.json` and reported all five tiers exactly as the CLI resolves them
(`gpt-5.6-terra` low / `gpt-5.6-terra` medium / `gpt-5.6-sol` high / `gpt-5.6-sol` high /
`gpt-5.6-sol` ultra, contexts all `auto`). Workspace config, project trust, and profile resolution
are shared state across the two surfaces.

Note what F6 also demonstrates, since it is the hazard criterion §5 was written for: the app happily
resolved a profile stored under the **`codex-cli`** key. Nothing in the surface stops it.

##### F7 — RECORDED 2026-07-27: a discriminator exists ✅

App-side (agent shell inside the ChatGPT app), squad-relevant lines only — the raw dump also carried
live credentials inherited from the user's login shell and is **deliberately not reproduced here**:

```text
CODEX_INTERNAL_ORIGINATOR_OVERRIDE=Codex Desktop
CODEX_CI=1
CODEX_SANDBOX=seatbelt
CODEX_THREAD_ID=019fa4f5-c53d-79f0-9172-c93a611e5247
__CFBundleIdentifier=com.openai.codex
PATH=…:/Applications/ChatGPT.app/Contents/Resources
command -v codex  → /Users/ndmyers/.local/bin/codex
codex --version   → codex-cli 0.145.0
CODEX_HOME                  → unset
CODEX_MANAGED_PACKAGE_ROOT  → unset
```

CLI-side negative half, obtained **free** via `codex sandbox env` (runs a command under the CLI's own
seatbelt path with no model call — the cheap trick that avoided a billable `codex exec`):

```text
CODEX_SANDBOX=seatbelt
CODEX_SANDBOX_NETWORK_DISABLED=1
__CFBundleIdentifier=com.apple.Terminal
PATH=/Users/ndmyers/.codex/tmp/arg0/…:/Users/ndmyers/.codex/packages/standalone/releases/0.145.0-aarch64-apple-darwin/codex-path:…
(no CODEX_INTERNAL_ORIGINATOR_OVERRIDE, no CODEX_CI)
```

| Candidate | App | CLI | Verdict |
|---|---|---|---|
| `CODEX_INTERNAL_ORIGINATOR_OVERRIDE` | `Codex Desktop` | absent | ✅ **primary** — names the surface directly |
| `PATH` contains `/Applications/ChatGPT.app/Contents/Resources` | yes | no (carries `.codex/packages/standalone/releases/<ver>/codex-path`) | ✅ **corroborating** |
| `__CFBundleIdentifier` | `com.openai.codex` | `com.apple.Terminal` | ⚠️ reflects the *launching* app, not the surface — fragile |
| engine version via `codex --version` | **`0.145.0`** | `0.145.0` | ❌ **fails** |
| `codex` binary path | `~/.local/bin/codex` | `~/.local/bin/codex` | ❌ **fails** |

**Two pre-probe predictions were wrong, and it matters.** The F7 pass bar named "a `codex` path
resolving inside `/Applications/ChatGPT.app/`" as a candidate — it does not: the app's shell resolves
`codex` to the *standalone CLI* at `~/.local/bin/codex`, which also reports `0.145.0`. So the engine
the app's chat session runs on is **not** the engine its shell would invoke, and the version-skew
signal recorded as "weak" in Part 1 is not weak but **absent** at the shell. Anything built on either
would have been silently wrong.

**Verdict: F7 passes on `CODEX_INTERNAL_ORIGINATOR_OVERRIDE`, with a stated reservation.** The
variable is deterministic, agent-observable without a shell round-trip through any private API, and
semantically exactly right. But its name declares it `INTERNAL` and an `OVERRIDE`: it is not a
contract, and being an override it can in principle be set by a user on the CLI, which would defeat a
naive equality check. Detection should therefore treat the `PATH` signal as corroboration and
**fail loud on conflicting signals** rather than silently preferring one.

Method caveat: the CLI half came from `codex sandbox`, not from an agent-session shell tool. It is the
same binary applying the same `shell_environment_policy`, so the inference is strong, but it is one
inferential step short of a same-surface comparison. A future `codex exec` run should confirm it.

#### Decision rule — pre-registered, honor it

Three outcomes, not two. The middle case is the one the original two-branch rule would have lost.

| Outcome | Result |
|---|---|
| **F3 ∧ F4 ∧ F5 ∧ F7 all pass** | Add `codex-app` as its own harness key: `HARNESS_DISPATCH_CAPABILITIES` in **both** `model-tier-config.js` and `model-id-resolver.js` (kept in lockstep), a `## codex-app adapter` section in `references/model-resolution.md`, surface rows in `docs/model-tier-configuration.md` and `references/config-format.md`, and tests mirroring the `codex-cli` ones. The capability values must come from the app's **own** F4 evidence — never copied from the `codex-cli` row |
| **Any of F3 / F4 / F5 fails** | Document `codex-app` as **skills-only / unsupported for routing**, plainly, here and in the README. No harness key. A partial pass is a fail for the routing gate |
| **F3–F5 pass but F7 fails** | **Capable but not safely addressable.** No harness key — and record the reason precisely, because it is not a capability gap: with no runtime discriminator, a `codex-app` key would make the app silently resolve the `codex-cli` profile (criterion §5). This is a more useful finding than a flat fail and points at the fix — a discriminator, not more capability |

---

### Probe I — same-day CLI re-probe: **both open questions resolved, both against the record** ⚠️

One `codex exec --sandbox read-only` run on `codex-cli` 0.145.0, **no `--enable` flag**, asking for a
verbatim tool enumeration and an invalid-model spawn. Run 2026-07-27, minutes after Probe F.

#### I1 — the five-vs-two catalog gap was **entitlement drift, not a surface difference**

```text
Unknown model `not-a-real-model-xyz` for spawn_agent.
Available models: gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.5, gpt-5.4
```

Identical to the app's F4b enumeration. **The confound resolves as drift**: on 2026-07-23 the CLI
spawn set was `{gpt-5.6-sol, gpt-5.6-terra}`; on 2026-07-27 the same CLI enumerates five. The gap was
four days of entitlement change, not `codex-app` being more capable.

Three recorded facts are now **stale and must not be relied on**:

- Probe B2's "the spawn set on this account today is `{gpt-5.6-sol, gpt-5.6-terra}` — 2 of the 6
  listed session models". True when measured; false now.
- Probe B2's sharpest example — "`gpt-5.4` is a perfectly valid *parent* model yet is **not
  spawnable**". `gpt-5.4` **is** spawnable today. The *lesson* it illustrated (parent set ≠ spawn set)
  survives: `gpt-5.4-mini` is still listed and still not spawnable, so the sets remain distinct.
- The standing **open product question** — "only two spawnable models exist today; five tiers across
  two models × six efforts is the whole routing space" — was a snapshot of a transient entitlement
  state, not a property of Codex. It is **withdrawn**, not answered.

**This is the strongest evidence the spike has produced for its own core rule.** The repo already held
that a catalog is documentation, not an availability source of truth — demonstrated *across surfaces*
(`codex debug models` ≠ spawn set). It is now demonstrated *across time* on one surface: the
authoritative set changed underneath a written record in four days. The adapter's requirement to
re-acquire the spawn set at the spawn boundary, and never cache or hardcode it, is vindicated. It also
means **a stored assignment can silently become invalid** — which is exactly what the fail-loud
pre-launch rejection exists to catch.

#### I2 — `multi_agent_v2` is **not** a precondition: the CLI defaults to v1, and v1 carries the actuator

With no `--enable` flag, the CLI session enumerated:

```text
multi_agent_v1__spawn_agent(fork_context, items, message, model, reasoning_effort, service_tier)
multi_agent_v1__wait_agent(targets, timeout_ms)
multi_agent_v1__send_input(interrupt, items, message, target)
multi_agent_v1__resume_agent(id)
multi_agent_v1__close_agent(target)
```

Byte-for-byte the same orchestration toolset the app exposes. **The Step-2 blocker was wrong**, and so
is the operational precondition shipped on the back of it:

- `model` and `reasoning_effort` are **v1** parameters, available with no feature flag on either
  surface. The v2 attribution was an inference from documentation that no probe had tested.
- The v2 toolset recorded in Probe B0 (`spawn_agent(fork_turns, …, task_name)`, `list_agents`,
  `followup_task`, `send_message`, `interrupt_agent`) is what `--enable multi_agent_v2` *adds*. It is
  the non-default path.
- Therefore the `task_name` constraint fixed in `596e91f` is a **v2-only** rule. Default sessions on
  both surfaces have no `task_name` parameter at all.
- `README.md`'s "Start the session with `codex --enable multi_agent_v2`" and `dispatch-codex.md`'s
  hard-block precondition are both **incorrect as shipped** and are corrected in this change.

**The design consequence that matters.** Call shape is determined by **which spawn toolset is
present (v1 vs v2)**, and the resolver's harness key is determined by **which surface is running**.
These are *orthogonal*: both surfaces default to v1, and either can be moved to v2 by a flag. Inferring
the call shape from the surface — the obvious shortcut — would be wrong on both surfaces
simultaneously. Vivaldi must detect them separately.

#### What Probe I changes about the `codex-app` decision

The decision rule was already satisfied by Probe F (F3 ∧ F4 ∧ F5 ∧ F7), and Probe I does not disturb
that. But it does change the *justification*, and the record should be honest about it: `codex-app`
does **not** earn a separate harness key by having a larger spawn catalog — the catalogs are identical
today. It earns one because the surfaces run **different engine builds** (F0b), are **independently
discriminable** (F7), and — per I1 — carry catalogs that **drift independently over time**. Binding
two surfaces to one stored profile is precisely how a stale assignment survives unnoticed.

---

## Remaining probes

| Probe | Blocked on | Proves |
|---|---|---|
| **E2** — multi-turn persona persistence | interactive session | C1 (full) |
| **F Part 2** — ChatGPT desktop app | a human at the GUI; workspace + protocol are ready | C8, C11 |
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
| §4 `codex-app` is separate (C8) | ⏳ unproven as a routing surface — but Probe F0b now shows the app ships a **different engine build** (`0.146.0-alpha.3.1` vs `0.145.0`), so §4 is backed by evidence, not only by rule. Claim nothing for the ChatGPT desktop app until Probe F Part 2 runs |
| §5 surface discriminator (C11) | ⏳ unproven; prior is **weak** — the surfaces share `CODEX_HOME` and `shell_environment_policy.set`, and no surface-identity variable exists in either binary (F0g) |

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
