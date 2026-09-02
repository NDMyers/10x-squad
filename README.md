# 10x-squad

Standalone installer for the 10x Squad workspace customization — Vivaldi (orchestrator), seven
skills, and a dependency-free deterministic control runtime. The skills include six personas
(Einstein, Peter, Linus, Cobalt, Sentinel, Ralph) plus `10x-squad-configure-tiers` for work-tier
model, reasoning, and context routing.

Ships to **GitHub Copilot** and **Codex** (Codex CLI and the ChatGPT desktop app).

Requires Node.js ≥ 20. No runtime dependencies.

---

## Install

```
git clone <this repo> && cd 10x-squad
node bin/10x-squad.js install --directory <workspace-root>
```

```
Usage: 10x-squad <command> [options]

Commands:
  install
  uninstall
  validate-handoff
  validate-project
  transition-project
  generate-registry

  -d, --directory <path>   Target project directory (default: cwd)
  --harness <name>         copilot | codex | all (default: all)
  -h, --help               Show help
  -v, --version            Show version
```

Re-running is idempotent, and unrelated `.github/` / `.agents/` customizations in the target
workspace are preserved — the installer only writes the files it owns. It **never** touches model
routing config (see [Model routing](#model-routing)).

### What each harness installs

`--harness` here selects **install targets** — which files land where. It is a different axis from
the routing surface key described under [Model routing](#model-routing); don't confuse the two.

| `--harness` | Entrypoint | Files written |
|---|---|---|
| `copilot` | `10x-squad` custom agent | `.github/agents/10x-squad.agent.md`<br>`.github/skills/10x-*/` |
| `codex` | `$10x-squad-vivaldi` skill | `.agents/skills/10x-squad-vivaldi/SKILL.md`<br>`.agents/skills/10x-squad-vivaldi/agents/openai.yaml`<br>`.agents/skills/10x-*/` |
| `all` *(default)* | both | both trees |

Each skill installs as a complete package — `SKILL.md` plus its nested `scripts/`, `references/`,
and `agents/` directories. Vivaldi is not copied but *composed* per harness from `assets/vivaldi/`,
so both entrypoints stay derived from one body. Every install also writes the shared
`.10x-squad/runtime/` control scripts. A harness-specific uninstall preserves this runtime; an
all-harness uninstall removes it while preserving `.10x-squad/model-routing.json`.

### Verify the install

```
ls <workspace-root>/.github/agents/10x-squad.agent.md          # copilot
ls <workspace-root>/.agents/skills/10x-squad-vivaldi/SKILL.md  # codex
```

Then open the workspace in the harness and invoke the orchestrator — `@10x-squad` on Copilot,
`$10x-squad-vivaldi` on Codex. It introduces itself before doing anything; if it doesn't, the skill
didn't load.

---

## Harness notes

### GitHub Copilot

Vivaldi installs as a first-class custom agent, so it can be selected as the primary agent for a
session. Personas dispatch as subagents.

Explicit reasoning and context values are supported on **Copilot CLI** today. **VS Code** — and any
harness the resolver doesn't recognize — accepts `auto`/`auto` only.

### Codex

One Codex install serves **two surfaces**: the Codex CLI (`codex-cli`) and the ChatGPT desktop app
(`codex-app`, launched with `codex app <path>`). Both are supported. Each keeps its **own** routing
profile, because the surfaces run different engine builds and their spawnable model sets drift
independently. Vivaldi detects which surface it is on at runtime and resolves the matching profile;
if that profile is missing it stops rather than borrowing the other surface's.

Codex has no flag to boot the primary session as a custom agent, so Vivaldi ships as a skill invoked
at the **root** session (`$10x-squad-vivaldi`); persona subagents spawn at depth 1 from there.

No feature flag is needed — the per-dispatch `model` / `reasoning_effort` actuator is available by
default on both surfaces. Vivaldi sets `allow_implicit_invocation: false`, so it never fires on an
unrelated request and does not appear in the ambient skill list; invoke it by name.

Evidence, probe records, and known surface limits: [`docs/codex-harness-spike.md`](docs/codex-harness-spike.md).

---

## Model routing

Routing is a **(persona, work tier)** coordinate: six dispatchable personas × five work tiers, so 30
cells, each a profile combining one exact model, one reasoning choice, and one context choice.
Vivaldi resolves **each persona's own** profile on every dispatch through the installed resolver
script, and announces what it picked.

That split matters because tier alone conflates two things: how hard the task is, and how much
reasoning the role needs. On a Complex task, Einstein and Cobalt — who draft the plan and gate the
work — earn a frontier model at high effort. Linus, working from a good spec and a good review, does
not.

Thirty questions would be a miserable setup, so the configure skill offers four entry paths that all
write the same fully explicit matrix:

| Path | Answers | What you pick |
|---|---|---|
| **Role lanes** *(recommended)* | 3 | one model + a tier-stepped effort curve per lane — Thinker (`einstein`, `peter`), Builder (`linus`, `ralph`), Reviewer (`cobalt`, `sentinel`) |
| Default-all | 1 | one profile for every persona and tier |
| Per work tier | 5 | one profile per tier, broadcast across personas |
| Full matrix | 30 | every cell individually |

No lane, role, or inheritance marker is ever stored — the paths differ only in how much they ask.

**Vivaldi gets an advisory row, not an assignment.** It always runs as the root session and cannot
select its own model, so the squad can record and announce a recommended parent model per tier, warn
if the running session differs, and nothing more. It never blocks, and leaving it unset is fine.

Run **`/10x-squad-configure-tiers`** inside the harness to write a profile. It stores to:

| Scope | Path |
|---|---|
| workspace | `<workspace>/.10x-squad/model-routing.json` |
| global | `$XDG_CONFIG_HOME/10x-squad/model-routing.json` |

**Reinstalling never touches these files.**

Profiles are keyed by **routing surface** — a finer-grained identifier than the installer's
`--harness`, because dispatch capability differs across surfaces of the same product:

| Surface key | Reasoning effort | Context tier |
|---|---|---|
| `copilot-cli` | `auto` `low` `medium` `high` `xhigh` | `auto` `default` `long_context` |
| `codex-cli` | `auto` `low` `medium` `high` `xhigh` `max` `ultra` | `auto` |
| `codex-app` | `auto` `low` `medium` `high` `xhigh` `max` `ultra` | `auto` |
| anything else (incl. `copilot-vscode`) | `auto` | `auto` |

Configure each surface you actually use. A missing profile is a hard stop, not a fallback.

Two rules worth knowing before you configure:

- **`auto` is not inheritance.** A runtime `auto` omits only its corresponding dispatch argument. It
  is not Copilot model Auto, and it is not "inherit from the parent".
- **Model identifiers must be exact and current.** Spawnable model sets drift; the skill re-acquires
  the live catalog rather than trusting a cached list, and rejects `auto`/`inherit` as assignments.
- **Personas are still model-agnostic.** The persona is a coordinate Vivaldi passes to the resolver,
  never metadata inside a persona skill. No persona file pins a model.
- **Existing configs keep working.** A stored schema-v1 or v2 profile applies its single tier row to
  every persona, exactly as it always routed. The next successful write upgrades the file to schema
  v3; nothing forces you to reconfigure.

Operator guide: [`docs/model-tier-configuration.md`](docs/model-tier-configuration.md) ·
harness evidence: [`docs/model-routing-harness-spike.md`](docs/model-routing-harness-spike.md).

---

## Repository layout

```
assets/vivaldi/         Vivaldi's single source: core.md (harness-agnostic body)
                        + dispatch-<harness>.md + frontmatter-<harness>.yml
assets/skills/10x-*/    seven skills, installed as complete packages
assets/runtime/         installed trace, state, transition, and registry controls
lib/compose.js          renders each harness entrypoint from assets/vivaldi/
lib/installer.js        per-harness asset manifest + recursive copy logic
bin/10x-squad.js        CLI: 10x-squad install [-d <dir>] [--harness <name>]
test/                   node --test suites (npm test runs full discovery)
evals/                  deployment parity check + Copilot/Codex JSONL eval harness
docs/                   harness spikes, model-tier operator guide
docs/review/            squad review, architecture, eval plan, learning notes
```

## Deterministic controls

Installed Vivaldi entrypoints invoke `.10x-squad/runtime/control.js` for invariants that do not
require model judgment:

```
node .10x-squad/runtime/control.js validate-handoff --spec <spec.md> [--brief <brief.md>] [--build <build.md>]
node .10x-squad/runtime/control.js validate-project --project <project-directory>
node .10x-squad/runtime/control.js transition-project --project <project-directory> --state <next-state.json> --expected-updated-at <current-timestamp>
node .10x-squad/runtime/control.js generate-registry --projects-root <projects-directory> --output <PROJECTS.md>
```

The project registry supports gradual migration: directories without `project.json` remain visible
as `UNMANAGED`, but must receive validated state before the squad resumes them.

## Development

```
npm test                                  # full suite
W=/tmp/sync && rm -rf $W && mkdir -p $W
node bin/10x-squad.js install -d $W
SQUAD_ROOT=$W bash evals/check-sync.sh --source-only
DRY_RUN=1 REPS=1 EVAL_HARNESS=copilot-cli bash evals/run.sh smoke
```

`check-sync.sh` recomposes Vivaldi and compares it against the deployed copy. Its exit code is the
total failure count, split into three categories with different owners: **SOURCE** (the invariant
below — must always be 0), **UPSTREAM** (corpay-agents copies lagging), and **PORT** (Claude Code
command stubs). `--source-only` skips optional legacy distribution checks and exits on SOURCE
failures alone, making it suitable for CI. Without that flag the complete historical audit remains
available.

Real eval runs require `EVAL_HARNESS=copilot-cli|codex-cli`, an exact target-surface `EVAL_MODEL`,
and `EVAL_ROUTING_CONFIG` pointing to a `model-routing.json` containing that surface's persona
profiles. Each run installs the selected harness and routing config into its isolated fixture,
preserves uniquely addressed raw JSONL events under `evals/runs/`, and appends only observable
metrics to `evals/results.csv`; unavailable token or cost values remain blank rather than being
reported as zero. One eval process owns a results CSV at a time; use separate `RESULTS_CSV` paths
for concurrent suites.

## The source-of-truth rule

**This repo's `assets/` is the only place squad prompts are edited.** Deployed copies
(`<workspace>/.github/agents|skills/`, `<workspace>/.agents/skills/`, corpay-agents) are build
outputs — never edit them in place. Vivaldi is doubly a build output: both harness entrypoints are
*composed* from `assets/vivaldi/`, so there is no checked-in copy of the assembled file to edit by
mistake.

History: until 2026-07-12 it was the other way around — the live `.github/` copy evolved (Sentinel,
traceability gates, Jun 1) while `assets/` sat at May 8, so running the installer would have *rolled
back* the best lineage and omitted Sentinel (absent from the manifest). That lineage was adopted back
into `assets/` and the manifest fixed; this repo was git-initialized the same day, so `.bak` files
are retired as a versioning mechanism.
