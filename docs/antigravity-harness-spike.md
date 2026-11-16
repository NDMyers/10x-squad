# Google Antigravity Harness Spike Notes

This document summarizes the verified Antigravity Desktop and Antigravity CLI (`agy`) contracts used by `10x-squad`.

## Surfaces and Runtime Detection

Antigravity runs across two distinct user-facing surfaces that share the same customization discovery layout while exporting distinct environment signals:

| Surface | Key | `ANTIGRAVITY_APP_DATA_DIR` basename | Fallback Signals |
|---|---|---|---|
| Antigravity CLI (`agy`) | `antigravity-cli` | `antigravity-cli` | `ANTIGRAVITY_AGENTAPI_EXE` ending in `agy` / `agy.exe`, or `ANTIGRAVITY_CLI_ALIAS` |
| Antigravity Desktop / IDE | `antigravity-desktop` | `antigravity` or `antigravity-ide` | `ANTIGRAVITY_AGENTAPI_EXE` containing `Antigravity.app` or ending in `language_server` / `language_server.exe`, or `__CFBundleIdentifier=com.google.antigravity` |

`node .10x-squad/runtime/control.js detect-surface --family antigravity` inspects those environment variables and fails nonzero (`NOT_ANTIGRAVITY`, `UNKNOWN_SURFACE`, or `NO_SURFACE_SIGNAL`) rather than guessing between `antigravity-cli` and `antigravity-desktop`.

## Customization Discovery Layout

- **Workspace root:** `.agents/`
  - `.agents/skills/10x-squad/SKILL.md` (Vivaldi root skill)
  - `.agents/agents/10x-*.md` (6 custom persona subagents)
  - `.agents/skills/10x-*/` (8 shared squad skills)
- **User-global root (`--directory ~`):** `~/.gemini/config/`
  - `~/.gemini/config/skills/10x-squad/SKILL.md`
  - `~/.gemini/config/agents/10x-*.md`
  - `~/.gemini/config/skills/10x-*/`

Because both Codex and Antigravity install shared skills under `.agents/skills/10x-*/`, the installer deduplicates shared targets during `install` and preserves any shared file still owned by a remaining installed harness during targeted `uninstall --harness <name>`.

## Custom Subagent Frontmatter

Persona subagent files (`.agents/agents/10x-<persona>.md`) use YAML frontmatter parsed by Antigravity:

- `name`: `10x-<persona>`
- `description`: JSON-escaped summary string
- `subagent: true`
- `mainAgent: false`
- `tools`: mapped from `PERSONA_AGENTS[*].tools` via `ANTIGRAVITY_TOOL_MAP`:
  - `read` -> `read_file`
  - `search` -> `read_file`
  - `edit` -> `edit_file`, `write_file`
  - `execute` -> `run_command`, `manage_task`

No `model:` field is emitted in persona frontmatter so routing always flows through `model-tier-config.js` rather than static pins.

## Catalog Discovery and Dispatch Actuation

- **Catalog discovery:** `agy models` outputs available models as tab-separated columns starting with the exact slug in column 1 after the `Model ID` header. In-session, `swarm` (`{"action": "models", "all": true}`) returns the active session's selectable model slugs.
- **Runtime settings:** Antigravity model slugs encode effort variants directly (for example `-low`, `-medium`, `-high`, `-xhigh`), and child dispatch exposes no separate effort or context parameter. Accordingly, `dispatch_settings` accepts `auto` / `auto` only on `antigravity-cli` and `antigravity-desktop`.
- **Dispatch actuators:**
  - `invoke_subagent` addresses installed custom subagents via `TypeName: "10x-<persona>"` and `Model: "<resolved>"`.
  - `swarm` (`action: "add"`, `name`, `model`, `brief`) pins workers to any exact model slug from the Antigravity catalog.
- **Verification ceiling:** In-session subagent and swarm calls do not return the child's executed model identifier, so configure probes record `identity_observable: false` (`unverified` / `addressability_probe`).
