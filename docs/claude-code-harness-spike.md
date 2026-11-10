✅ **PASSED** — desktop → `claude-desktop`; `claude -p` from a plain environment → `sdk-cli` → `claude-cli` (Probe F); unset `CLAUDECODE` fails loudly. **Known limitation:** a CLI launched from a shell *inside* the desktop app inherits `CLAUDE_CODE_ENTRYPOINT=claude-desktop`, and no environment variable separates the two (`CLAUDE_CODE_EXECPATH` is set in both), so it resolves the desktop profile; unset the variable first. Interactive `claude` reports `cli` per its docs, not yet probed directly |

**Started:** 2026-11-09 · **Completed:** 2026-11-09 (Claude Opus 5.5) · **Status: SPIKE COMPLETE.** `claude-cli` and `claude-desktop` both **pass the routing gate** (C2 + C3 + C5) at the in-session *unverified* tier; the eval harness observes executed child models from `claude -p` output. Open: multi-turn persistence on desktop (C1), a fresh desktop session end to end, and Copilot leakage (C12).

Companion to `docs/codex-harness-spike.md` and `docs/model-routing-harness-spike.md`. Same method,
same evidence discipline: the criteria below were fixed **before** any probe ran, and a criterion
passes only on direct evidence from the surface itself — never on documentation or inference.

---

## Pre-registered evidence criteria (fixed 2026-11-09, before any probe ran)

1. A surface passes the **routing gate** only if a subagent dispatch can carry an explicit,
   per-dispatch model, an invalid model **fails loud** with no silent substitution, and the resolver
   can run **unattended** once the user has approved it. (C2 + C3 + C5.)
2. Executed-child-model **identity** must be observable to the agent or to the eval harness from the
   surface's own output for a `verified` record; anything weaker records `unverified`. (C4.)
3. The model catalog must come from a **live harness source**, never a hardcoded list. (C7.)
4. `claude-desktop` (Claude desktop app, Code tab) is a **separate surface** from `claude-cli` and
   inherits nothing from it; each needs its own evidence. (C8.)
5. A surface earns its own key only if the agent can tell, **at runtime from a shell it runs**,
   which surface it is on; disagreement or absence must fail loudly. (C11.)
6. Every probe runs on **Windows** (the dev box). Nothing in the dispatch contract may depend on a
   POSIX-only path, binary, or shell construct that Claude Code does not provide on all three OSes.
7. Claude-specific: installing `.claude/` assets must not alter what Copilot or Codex load, or the
   leakage must be named and contained. (C12.)

| # | Question | Pass condition | Status |
|---|---|---|---|
| C1 | Does a root skill hold the orchestrator role? | `/10x-squad` loads, Vivaldi introduces itself and keeps state over 3+ turns | ✅ **PASSED (CLI, single turn)** — `/10x-squad` in `claude -p` introduced Vivaldi, triaged Trivial, detected `claude-cli`, resolved, announced, dispatched `10x-linus`, applied the edit, delivered (Probe E). 3+-turn persistence and a fresh desktop session not yet run |
| C2 | Per-dispatch `model` + `effort` honoured? | Child on a model ≠ parent's runs on the requested model | ✅ **PASSED (both)** — desktop: Opus parent → `haiku`/`low` child recorded as `claude-haiku-5-5` (Probe C1), nine opus/sonnet × effort tuples ran (Probe D). CLI: `haiku` parent → `10x-einstein` child streamed as `claude-sonnet-5-5` (Probe F) |
| C3 | Invalid model fails loud? | Visible error, no child launch, no substitution | ✅ **PASSED (both)** — `model: "__10x_catalog_probe__"` → `InputValidationError` before launch, enumerating the accepted values (Probes B, F) |
| C4 | Executed child model observable? | Surface output carries the child's model id | ⚠️ **Not in-session** — the dispatch result carries no model. Out of band: desktop child transcripts; CLI stream-json `modelUsage` always, and child `message.model` for a lone background dispatch but not for parallel foreground ones (Probe F). Profiles record `unverified`; evals report observed models |
| C5 | Resolver runs unattended? | `node …/model-tier-config.js resolve` runs with no per-call prompt after approval; failure is machine-visible | ✅ **PASSED (CLI)** — the skill's `allowed-tools` approved `detect-surface`, `resolve`, and `resolve-advisory` with zero denials (Probe E2), **once commands carry no quotes, `$VARS`, or chains**: E1 showed Claude Code refuses to pre-approve `--workspace-root "$PWD"` and `;` chains, so the contract uses `--workspace-root .`, one command per call |
| C6 | Depth + concurrency | Cobalt ∥ Sentinel dispatched in one turn both run, overlap evidenced | ✅ **PASSED (both)** — nine (desktop) and four (CLI) dispatches from one message ran concurrently (Probes D, F) |
| C7 | Catalog discovery | Live, machine-readable accepted-model set at the dispatch boundary | ✅ **PASSED (both)** — the C3 rejection enumerates the live set (`sonnet`, `opus`, `haiku`, `fable` on the reference account): family aliases, not dated IDs |
| C8 | Desktop app parity | Desktop loads `.claude/skills` + `.claude/agents`, dispatches with model/effort | ✅ C2/C3/C6/C7/C9/C11 proven on the desktop app itself; C1/C10 proven on the CLI with the same installed files; a fresh desktop session end to end is still to run |
| C9 | Accepted `effort` vocabulary | Exact set accepted at the dispatch boundary | ✅ **PASSED** — `effort: "__probe__"` rejected pre-launch enumerating `low`, `medium`, `high`, `xhigh`, `max`; all five accepted on desktop (Probe D), `low`/`medium` on CLI (Probe F); CLI `--effort` help lists the same set |
| C10 | Are `.claude/agents/*.md` dispatch targets? | `subagent_type: "10x-<persona>"` addresses the installed agent | ✅ **PASSED (CLI)** — init listed all six `10x-*` agents; `10x-einstein` and `10x-linus` dispatches launched (`system/task_started` carries `subagent_type`) and completed (Probes F, E) |
| C11 | Surface discriminator | Deterministic, OS-neutral signal from an agent-run shell | ✅ **PASSED** — desktop → `claude-desktop`; `claude -p` from a plain environment → `sdk-cli` → `claude-cli` (Probe F); unset `CLAUDECODE` fails loudly. **Limitation:** a CLI launched from a shell inside the desktop app inherits `claude-desktop`, and no variable separates the two (`CLAUDE_CODE_EXECPATH` is set in both); unset `CLAUDE_CODE_ENTRYPOINT` first. Interactive `claude` reports `cli` per its docs, not probed directly |
| C12 | Cross-harness leakage | `.claude/` assets do not change Copilot/Codex behaviour, or are contained | ⚠️ **Partly probed** — Codex reads `.agents/` only; Copilot CLI is not installed here. VS Code Copilot also scans `.claude/skills`, so the installer keeps every copy byte-identical and reports shadowing |

---

## Step 1 — Surfaces and versions (recorded 2026-11-09)

| Item | Value |
|---|---|
| OS | Windows 11 Home 10.0.26200 (x64) |
| Claude Code CLI | `2.1.322` (npm global, `claude.ps1` on PATH) — **not signed in** at probe time |
| Claude desktop app | `CLAUDE_CODE_DESKTOP_APP_VERSION=4.23118.1`, Agent SDK `0.3.321` |
| Node | v24.13.0 |
| Shells | Git Bash (Bash tool) and Windows PowerShell 5.1 (PowerShell tool) both present |

## Step 2 — Free evidence (no model calls)

- `claude --help`: `--agent <agent>` exists (a main-thread agent), but the desktop app has no
  equivalent, so Vivaldi ships as the `/10x-squad` **skill**, which runs in the main conversation on
  both surfaces. Subagents cannot dispatch subagents, so a subagent Vivaldi would be inert.
- `claude -p … --output-format stream-json --verbose` init event (unauthenticated run) listed the
  scratch repo's `.claude/agents/probe-echo.md` among `agents`, and listed the dispatch tool as
  **`Task`**, while the desktop session exposes it as **`Agent`** with the same parameters. The
  dispatch contract names both.
- `--effort <level>` CLI help: `low, medium, high, xhigh, max` — matches the dispatch tool's enum.
- `--model`: "an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet') or a model's full
  name" — the **parent** accepts full names; the **dispatch** tool accepts only the aliases (C7).

## Probe B — fail-loud and catalog (desktop)

Dispatch `general-purpose` with `model: "__10x_catalog_probe__"` → `InputValidationError` with
`values: ["sonnet","opus","haiku","fable"]`, no child launched. Dispatch with `effort:
"__probe__"` → `InputValidationError` with `values: ["low","medium","high","xhigh","max"]`.

## Probe C1 — per-dispatch model and surface signal (desktop)

Parent `claude-opus-5-5`. Dispatch `general-purpose`, `model: "haiku"`, `effort: "low"`. The child
reported `MODEL_ID=claude-haiku-5-5` and, from its own shell, `ENTRYPOINT=claude-desktop
CLAUDECODE=1`. Independent of self-report, the child transcript
(`~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl`) recorded
`"model":"claude-haiku-5-5"` on all six assistant turns, and its `.meta.json` recorded
`"model":"haiku","effort":"low","spawnDepth":1,"requestShape":"background"`. The dispatch returned
immediately with a background-launch acknowledgement; the result arrived as a task notification —
hence the contract's "collect results before advancing" rule.

## Probe D — configure-tiers engine end to end (desktop)

Installed `--harness claude` into a scratch repo, then drove the skill's engine with the live catalog
from Probe B: `resolve` (`opus`, `sonnet` → `exact`), `expand-selections` (role lanes, effort curves
up to `max`), `verification-targets` → **9 unique tuples**. All nine were dispatched in one message
with `general-purpose` + the `MODEL_ROUTE_OK` prompt; every one was accepted at launch, ran
concurrently in the background, and returned `MODEL_ROUTE_OK` (2.7–6.8 s each).

## Probe F — CLI dispatch, catalog, and surface value (CLI, signed in)

- Parent `haiku`: catalog probe rejected pre-launch with the same four aliases as desktop;
  `subagent_type: "10x-einstein"`, `model: "sonnet"`, `effort: "low"` launched and returned
  `MODEL_ROUTE_OK`, with the child's turn streamed as `message.model: "claude-sonnet-5-5"`
  (`parent_tool_use_id` set) — child ≠ parent, observed from the surface's own output.
- Four parallel probes (sonnet, haiku, sonnet/low, sonnet/medium) from one message: all completed,
  `modelUsage` lists `claude-sonnet-5-5` although the parent ran `haiku`. Per-child turns were
  **not** streamed for these foreground parallel dispatches; only `system/task_started` /
  `task_notification` events appear per child.
- The init event names the dispatch tool `Task`; the assistant's `tool_use` blocks name it
  `Agent` — same tool, two names.
- Environment, `claude -p` launched from a plain environment: `CLAUDECODE=1`,
  `CLAUDE_CODE_ENTRYPOINT=sdk-cli`. Launched from the desktop app's shell: the inherited
  `claude-desktop` value is kept (C11 limitation). The eval adapter therefore unsets
  `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT` before launching.

## Probe E — `/10x-squad` end to end (CLI, `--permission-mode acceptEdits`)

Scratch repo with `--harness claude` installed and a `claude-cli` profile written through the real
configure-tiers engine (`resolve` → `expand-selections` → `verification-targets` → 4 live probes →
`build-profile` → `upsert-profile`). Task: add `greet(name)` to `hello.js`.

- **E1:** Vivaldi introduced itself, triaged Trivial, ran `detect-surface` (→ `claude-cli`), and
  dispatched `10x-linus` on `haiku`; the edit was correct. But the resolver call as then written
  (`--workspace-root "$PWD"`, two commands chained with `;`) was **denied** ("Quoted text in this
  command can't be checked before it runs"); Vivaldi recovered by retrying with `--workspace-root .`.
- **E2 (after fixing the contract):** zero denials for squad commands; routing announcement
  `Routing to Linus — Trivial (trivial) [claude-cli] — model haiku; effort auto`; correct edit;
  $0.22. The only denial was Vivaldi's own `node --check hello.js`, a project verification
  command outside the skill's pre-approval, which an interactive session would prompt for.

## Probe G — eval harness

`EVAL_HARNESS=claude-cli EVAL_MODEL=sonnet bash evals/run.sh … evals/tasks/smoke-hello` on Windows
(Git Bash): **pass@1 100%**, observed models `claude-haiku-5-5;claude-sonnet-5-5`, 1 subagent,
$0.058. The first attempt surfaced a runner bug unrelated to Claude: a relative task path broke the
check, because the check runs from inside the task workspace. Fixed and covered by a test.
