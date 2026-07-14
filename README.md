# 10x-squad

Standalone installer for the 10x Squad workspace customization — Vivaldi (orchestrator agent) plus seven skills for GitHub Copilot: six personas (Einstein, Peter, Linus, Cobalt, Sentinel, Ralph) and `10x-squad-configure-tiers` (work-tier model, reasoning, and context routing).

```
assets/agents/10x-squad.agent.md     Vivaldi — orchestrator custom agent
assets/skills/10x-*/                 seven skills, installed as complete packages
                                     (SKILL.md + nested scripts/, references/, agents/)
lib/installer.js                     asset manifest + recursive copy logic
bin/10x-squad.js                     CLI: 10x-squad install [-d <dir>]
test/                                node --test suites (npm test runs full discovery)
```

## Model routing

Each work-tier profile combines one exact model, one reasoning choice, and one context choice. `/10x-squad-configure-tiers` writes `<workspace>/.10x-squad/model-routing.json` (workspace) or `$XDG_CONFIG_HOME/10x-squad/model-routing.json` (global), and Vivaldi resolves that profile for every persona dispatch through the installed resolver script. Runtime `auto` omits only its corresponding dispatch argument; it is not Copilot model Auto or parent inheritance. Explicit reasoning/context values are supported only by Copilot CLI today; VS Code and unknown harnesses allow `auto`/`auto` only. **Reinstalling never touches these config files.** Operator guide and learning summary: `docs/model-tier-configuration.md`; harness evidence: `docs/model-routing-harness-spike.md`.

## The source-of-truth rule

**This repo's `assets/` is the only place squad prompts are edited.** Deployed copies (`<workspace>/.github/agents|skills/`, corpay-agents) are build outputs — never edit them in place.

History: until 2026-07-12 it was the other way around — the live `.github/` copy evolved (Sentinel, traceability gates, Jun 1) while `assets/` sat at May 8, so running the installer would have *rolled back* the best lineage and omitted Sentinel (absent from the manifest). That lineage was adopted back into `assets/` and the manifest fixed; this repo was git-initialized the same day so `.bak` files are retired as a versioning mechanism.

## Release flow

1. Edit `assets/…` (and `lib/installer.js` if the manifest changes — mirror it in `test/installer.test.js`, which intentionally duplicates the manifest as a spec).
2. `npm test`
3. Commit.
4. Deploy: `node bin/10x-squad.js install --directory <workspace-root>` (re-running is idempotent; unrelated `.github` customizations are preserved).
5. Verify parity: `~/.claude/10x-squad/evals/check-sync.sh` must report zero source↔live failures.
6. Upstream to corpay-agents via normal PR when ready.

## Related

Review, architecture diagrams, eval plan, and improvement ladder for the squad live in `~/.claude/10x-squad/` (start at README.md there). The Claude Code port regeneration (planned installer target) is step 4 on that ladder.
