# Work-Tier Model Configuration — Operator Guide

The squad routes every persona dispatch through a user-configured mapping of the five work-complexity tiers (`trivial`, `lite`, `standard_clear`, `standard_ambiguous`, `complex`) to **exact, surface-native model identifiers**, per harness. Model choice is the user's due diligence (external benchmarks, official release data); the repo's tests validate squad conformance only — private work tasks are never a model leaderboard.

## Configure

Run `/10x-squad-configure-tiers` (or ask to view/change squad model assignments). The skill:

- shows the current effective five-row mapping and its source scope;
- offers **default-all** (one model expanded into all five explicit assignments — nothing stores a "default") or **individual** per-tier assignment;
- previews the stored-file diff and resulting effective mapping before writing;
- validates and writes atomically via the bundled engine — never hand-edit `model-routing.json`.

## Scope and precedence

1. One-dispatch user override — transient, announced, never stored.
2. Workspace: `<workspace>/.10x-squad/model-routing.json`.
3. User-global: `$XDG_CONFIG_HOME/10x-squad/model-routing.json` (fallback `~/.config/10x-squad/model-routing.json`).

A workspace profile replaces the same harness's global profile **wholesale** — no per-key merge. Removing the workspace profile reveals the global one. Neither file is installer-owned; reinstalling preserves both.

## Per-surface identifiers

Each harness has its own profile and identifier namespace — never reuse identifiers across surfaces.

| Surface | Key | Status (2026-07-13) | Identifier form |
|---|---|---|---|
| Copilot CLI | `copilot-cli` | **Supported — actuator proven** (see `model-routing-harness-spike.md`) | CLI slugs, e.g. shape `gpt-5.4` |
| VS Code Copilot | `copilot-vscode` | **Unsupported pending manual probe** (AC12); configurable, not yet verified | picker display strings |

Example values in docs are illustrative shapes, never defaults. Catalog/doc presence ≠ availability: entitlement and auth filter the real list. On the CLI, the authoritative list comes from the harness itself (e.g., a failed dispatch error enumerates entitled models; `/subagents` shows per-agent choices).

## Operational preconditions (Copilot CLI)

- **Select Vivaldi's parent model explicitly.** Copilot Auto is banned at every level (squad invariant 12); an Auto parent session is user error, not detected or compensated. Check `~/.copilot/settings.json` — `"model": "auto"` violates the premise.
- **Keep `continueOnAutoMode` false** (its default). When true, rate-limit errors silently switch the session to Auto and retry — exactly the substitution the squad forbids.
- **Allow the resolver unattended:** the session needs `--allow-tool "shell(node:*)"` (or equivalent config) so Vivaldi can run the resolver before each dispatch without approval prompts. A declined resolver invocation hard-stops the pipeline.
- Server-side experiments steer *default* subagent models on Copilot accounts; the squad's explicit per-dispatch `model` argument overrides them — one more reason never to rely on defaults.

## Free-text and local/BYOK

Free-text identifiers are stored byte-for-byte and stay visibly **unverified** until the active harness verifies them (harmless preflight or a no-side-effect dispatch probe comparing requested vs executed model). A local/BYOK model is configurable only as an exact identifier the active harness/provider already exposes; endpoints and credentials live outside routing configuration (the engine rejects credential-shaped fields). Cross-provider child dispatch is unsupported until a dedicated compatibility test proves it.

## Failure behavior

Resolution and dispatch fail loud — no Auto, no parent inheritance, no cheaper or "close" substitutes. Failures state the surface, tier + canonical key, requested identifier (or `<unresolved>`), reason, and next action (`/10x-squad-configure-tiers`, another identifier, or an explicitly approved one-dispatch override). Resolver exit codes: `0` resolved · `2` missing/corrupt/incomplete config · `3` harness profile missing · `4` invalid tier · `5` I/O.

## When new models ship

Nothing auto-promotes. Read the release evidence, run `/10x-squad-configure-tiers`, pick the identifier (it arrives unverified), let a no-side-effect probe verify it, and save. Retirements/policy changes surface as fail-loud dispatch errors, which route you back to the same skill.
