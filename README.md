# 10x-squad


Standalone installer for the 10x Squad workspace customization — Vivaldi (orchestrator) plus seven skills: six personas (Einstein, Peter, Linus, Cobalt, Sentinel, Ralph) and `10x-squad-configure-tiers` (work-tier model, reasoning, and context routing). Ships to **GitHub Copilot** and **Codex CLI / ChatGPT app**.

```
assets/vivaldi/                      Vivaldi's single source: core.md (harness-agnostic body)
                                     + dispatch-<harness>.md + frontmatter-<harness>.yml
assets/skills/10x-*/                 seven skills, installed as complete packages
                                     (SKILL.md + nested scripts/, references/, agents/)
lib/compose.js                       renders each harness entrypoint from assets/vivaldi/
lib/installer.js                     per-harness asset manifest + recursive copy logic
bin/10x-squad.js                     CLI: 10x-squad install [-d <dir>] [--harness <name>]
test/                                node --test suites (npm test runs full discovery)
evals/                               deployment parity check + headless eval harness
docs/review/                         squad review, architecture, eval plan, learning notes
```

## Quickstart

Clone repository then inside run:
```
node bin/10x-squad.js install --directory <workspace-root>
```
(re-running is idempotent; unrelated `.github` / `.agents` customizations are preserved).

`--harness copilot|codex|all` selects targets; the default is `all`.

| Harness | Entrypoint | Installed to |
|---|---|---|
| `copilot` | `10x-squad` custom agent | `.github/agents/`, `.github/skills/` |
| `codex` | `$10x-squad-vivaldi` skill | `.agents/skills/` |

**Codex operating notes.** One Codex install serves **two surfaces** — the Codex CLI (`codex-cli`)
and the ChatGPT desktop app (`codex-app`, launched with `codex app <path>`). Both are supported;
each keeps its own routing profile, because they run different engine builds and their spawnable
model sets drift independently. Vivaldi detects which one it is on at runtime.

Codex has no flag to boot the primary session as a custom agent, so Vivaldi is a skill invoked at the
**root** session (`$10x-squad-vivaldi`) — persona subagents spawn at depth 1 from there. No feature
flag is needed: the per-dispatch `model` / `reasoning_effort` actuator is available by default on
both surfaces. Vivaldi sets `allow_implicit_invocation: false`, so it never fires on an unrelated
request and does not appear in the ambient skill list — invoke it by name. Evidence and surface
limits: `docs/codex-harness-spike.md`.

## Model routing

Each work-tier profile combines one exact model, one reasoning choice, and one context choice. `/10x-squad-configure-tiers` writes `<workspace>/.10x-squad/model-routing.json` (workspace) or `$XDG_CONFIG_HOME/10x-squad/model-routing.json` (global), and Vivaldi resolves that profile for every persona dispatch through the installed resolver script. Runtime `auto` omits only its corresponding dispatch argument; it is not Copilot model Auto or parent inheritance. Explicit reasoning/context values are supported only by Copilot CLI today; VS Code and unknown harnesses allow `auto`/`auto` only. **Reinstalling never touches these config files.** Operator guide and learning summary: `docs/model-tier-configuration.md`; harness evidence: `docs/model-routing-harness-spike.md`.

## The source-of-truth rule

**This repo's `assets/` is the only place squad prompts are edited.** Deployed copies (`<workspace>/.github/agents|skills/`, `<workspace>/.agents/skills/`, corpay-agents) are build outputs — never edit them in place. Vivaldi is doubly a build output: both harness entrypoints are *composed* from `assets/vivaldi/`, so there is no checked-in copy of the assembled file to edit by mistake. `evals/check-sync.sh` recomposes and compares.

History: until 2026-07-12 it was the other way around — the live `.github/` copy evolved (Sentinel, traceability gates, Jun 1) while `assets/` sat at May 8, so running the installer would have *rolled back* the best lineage and omitted Sentinel (absent from the manifest). That lineage was adopted back into `assets/` and the manifest fixed; this repo was git-initialized the same day so `.bak` files are retired as a versioning mechanism.

