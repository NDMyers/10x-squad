# Work-Tier Runtime Settings Design

## Decision

Extend the existing five work-tier routes so each tier resolves one exact model plus two optional execution settings: reasoning effort and context tier. The settings apply uniformly to every persona dispatched for that work tier. Do not add persona-specific overrides.

The configuration UI offers an explicit value or `auto` for each setting. `auto` means the orchestrator omits that dispatch argument and lets the active harness use its adaptive or default behavior. It does not mean Copilot model Auto, which remains banned, and it does not mean inherit the parent session. Explicit reasoning values are `low`, `medium`, `high`, and `xhigh`; explicit context values are `default` and `long_context` (presented to users as default or extended context rather than an arbitrary token count).

Three storage approaches were considered. Replacing each model string with a nested route object is visually clean but forces a disruptive migration and changes model-check keys. A persona-by-tier matrix is expressive but creates thirty configuration cells before settings are counted. A parallel per-tier settings map preserves the model contract and is the smallest safe extension, so it is selected.

## Schema and compatibility

Schema v2 retains `assignments` as the exact five-tier model map and adds optional `dispatch_settings` with the same five canonical keys. Each stored tier setting contains exactly `reasoning_effort` and `context_tier`. New configure-skill proposals always write the complete map, including explicit `auto` values.

The engine continues to read schema-v1 files. A missing `dispatch_settings` map resolves as `auto` for both settings on all tiers. Any successful profile write upgrades the file to schema v2 while preserving unrelated harness profiles without adding fields to them. Schema v1 rejects v2-only fields; schema v2 permits an omitted settings map solely for retained legacy harness profiles.

`resolve` remains additive and backward compatible: it keeps the existing `model` and `check_status` fields and adds `reasoning_effort` and `context_tier`. Preview and write results similarly retain the existing effective model map and add an effective settings map.

## Configuration and dispatch flow

The configure skill first obtains the active model catalog, then collects a model, reasoning choice, and context choice for every tier. Model intent follows the existing exact/likely/ambiguous gates. Runtime settings use closed canonical vocabularies; free-form near matches require confirmation rather than silent normalization.

Verification deduplicates by the complete execution tuple `(model, reasoning_effort, context_tier)`, not model alone. This ensures the same model configured with different runtime settings receives separate harmless probes. For `auto`, the corresponding tool argument is omitted from the probe. A rejected or unsupported explicit setting stops before preview or write.

Copilot CLI is initially the only surface allowed to persist explicit runtime settings because its `task` tool has demonstrated `reasoning_effort` and `context_tier` arguments. VS Code and unknown harnesses allow `auto` only until their live subagent contract proves equivalent parameters. Vivaldi passes every non-`auto` resolved value explicitly, omits `auto` values, and announces model, reasoning, and context on each dispatch. A task reclassification re-resolves all three values.

## Failure handling and tests

Unknown fields, missing tier keys, unsupported values, credential-shaped fields, malformed legacy data, and surface-capability mismatches fail closed. Invalid proposals do not modify the prior file. Model identity mismatch remains a hard block. Runtime setting acceptance is established by the tuple probe; no claim is made that a harness exposes post-launch reasoning-token or context-window identity when it does not.

Tests cover schema-v1 compatibility, schema-v2 validation, explicit and `auto` values, mixed tier settings, tuple deduplication, CLI probe arguments, VS Code capability rejection, additive resolver output, precedence, atomic writes, skill instructions, installer parity, and Vivaldi dispatch behavior. A forward test uses the same user request before and after the skill change to demonstrate that thinking and context move from discarded prose to executable tier settings.
