# Model-Routing Configuration Format (schema v2)

One squad-wide configuration maps each of the five work-complexity tiers to a work-tier profile: one exact, surface-native model plus reasoning and context choices, per harness. Personas never carry model policy; Vivaldi resolves the task's complete profile through this configuration on every dispatch.

## Locations and precedence

1. **One-dispatch user override** — transient, announced, never stored.
2. **Workspace** — `<workspace>/.10x-squad/model-routing.json`.
3. **User-global** — `$XDG_CONFIG_HOME/10x-squad/model-routing.json`, falling back to `~/.config/10x-squad/model-routing.json`.
4. **No assignment** — configuration error; run `/10x-squad-configure-tiers`.

The override unit is **one complete harness profile**. If the workspace file defines the active harness, its five assignments replace that harness's global profile wholesale — there is no per-key merge. A workspace file that lacks the active harness falls through to the global profile. Neither location is installer-owned; reinstalling the squad preserves both.

## Schema

```json
{
  "schema_version": 2,
  "updated_at": "2026-07-13T00:00:00.000Z",
  "harnesses": {
    "copilot-cli": {
      "assignments": {
        "trivial": "example-model-slug",
        "lite": "example-model-slug",
        "standard_clear": "example-model-slug",
        "standard_ambiguous": "example-model-slug",
        "complex": "example-model-slug"
      },
      "dispatch_settings": {
        "trivial": {"reasoning_effort": "auto", "context_tier": "auto"},
        "lite": {"reasoning_effort": "low", "context_tier": "auto"},
        "standard_clear": {"reasoning_effort": "medium", "context_tier": "default"},
        "standard_ambiguous": {"reasoning_effort": "high", "context_tier": "long_context"},
        "complex": {"reasoning_effort": "xhigh", "context_tier": "long_context"}
      },
      "model_checks": {
        "example-model-slug": {
          "display_name": "Example Model",
          "status": "verified",
          "method": "dispatch_smoke_test",
          "source": "harness",
          "checked_at": "2026-07-13T00:00:00.000Z"
        }
      }
    }
  }
}
```

All model names in examples are illustrative shapes, never defaults or a selectable list. Real values must come from the active surface at configure time and pass the tuple probe; catalog membership alone does not prove executability.

### Rules

- Stored schema versions `1` and `2` are readable; every successful profile write upgrades the file to schema v2. `updated_at` is an ISO timestamp string maintained by the engine.
- A schema-v1 profile with omitted `dispatch_settings` reads as `auto`/`auto` for every tier. Schema v1 rejects v2-only fields.
- Every new proposal contains **all five canonical keys exactly once** in both `assignments` and `dispatch_settings`: `trivial`, `lite`, `standard_clear`, `standard_ambiguous`, `complex`.
- Every `dispatch_settings` entry contains exactly `reasoning_effort` and `context_tier`. The accepted vocabulary is per harness: `copilot-cli` reasoning `auto|low|medium|high|xhigh`, context `auto|default|long_context`; `codex-cli` reasoning `auto|low|medium|high|xhigh|max|ultra`, context `auto` only; every other harness (`copilot-vscode`, unknown) `auto`/`auto` only.
- Schema v2 accepts a profile with omitted `dispatch_settings` for compatibility because stored provenance cannot be proven. This read tolerance does not weaken the write contract: every newly built or upserted target profile materializes all five `dispatch_settings` entries. On unrelated retained legacy profiles, `dispatch_settings` may remain omitted.
- Assignment values are exact active-harness catalog strings resolved before proposal construction. `auto`, `inherit` (any casing), blank strings, `null`, non-strings, and unknown tier keys are invalid.
- Runtime `auto` is not a model assignment. It independently omits only its corresponding dispatch argument so the active harness can use adaptive or default behavior; it is neither Copilot model Auto nor parent inheritance.
- Explicit runtime settings are allowed for `copilot-cli` (both settings) and `codex-cli` (`reasoning_effort` only; `context_tier` is `auto`-only). `copilot-vscode` and unknown harness profiles may use `auto`/`auto`; if a setting is outside its harness's accepted vocabulary, configuration hard-stops before any probe, preview, or write. On `codex-cli` an explicit `reasoning_effort` must also be in the chosen model's `supported_reasoning_levels` (a live-catalog check the skill performs; the dependency-free engine validates only the harness vocabulary, and the harness enforces the per-model rule at spawn time).
- Each surface (`copilot-vscode`, `copilot-cli`, `codex-cli`) uses different identifier forms; each has its own profile and identifiers are never reused across surfaces. Copilot model names are not valid Codex spawn identifiers, and vice versa.
- Original user intent, including free text and keep-current input, is session-only and never stored; `original_input` is not a configuration field.
- `model_checks` is optional advisory metadata keyed by the exact assignment value; entry fields are limited to `display_name`, `status` (`verified` | `unverified`), `method`, `source`, `checked_at`. This flow uses methods `dispatch_smoke_test` and `addressability_probe` and emits `source: "harness"`. An `addressability_probe` MUST have status `unverified`. Catalog membership alone NEVER creates a `model_checks` entry. There is no time-based expiry; `checked_at` is informational.
- **Strict field allowlist on every write:** unknown fields anywhere in a proposal are rejected, and credential-shaped field names (`api_key`, `token`, `secret`, `password`, `authorization`, …) are rejected explicitly. Opaque model-ID and label *values* are never scanned for secret-like text. Credentials and provider endpoints belong in harness/provider configuration, never here.
- **Advisory leniency on read:** a missing, malformed, or unused `model_checks` entry never invalidates the five executable assignments — resolution degrades that model to `unverified`. Invalid *assignments*, unknown fields, or a wrong `schema_version` in a stored file make it corrupt and stop the pipeline (exit 2).
- A local/BYOK model is not a special tier: it is usable only as an exact addressable identifier on the active harness; endpoint and credential setup is out of band.

## Engine commands

`scripts/model-tier-config.js` (dependency-free Node 20+, installed at `.github/skills/10x-squad-configure-tiers/scripts/model-tier-config.js`):

```text
validate-profile --input <profile.json> --harness <surface>
diff-profile     --input <profile.json> --scope <global|workspace> --workspace-root <path> --harness <surface>
upsert-profile   --input <profile.json> --scope <global|workspace> --workspace-root <path> --harness <surface>
remove-profile   --scope workspace --workspace-root <path> --harness <surface> [--dry-run]
resolve          --workspace-root <path> --harness <surface> --tier <tier-key> [--json]
```

- Profile commands consume **one harness profile** (`{"assignments": {...}, "dispatch_settings": {...}, "model_checks": {...}}`), not a whole config file. New proposals always carry the complete settings map. Upsert/remove preserve every unrelated harness profile and write atomically (same-directory temp file + rename). Removing the final workspace profile deletes `model-routing.json` and leaves `.10x-squad/` intact.
- `diff-profile` and `remove-profile --dry-run` preview without writing.
- `diff-profile` and `upsert-profile` retain their existing result fields and add `effective_dispatch_settings_after` with all five effective settings entries.
- Successful `resolve` prints exactly one JSON object and no prose:

```json
{"ok":true,"schema_version":2,"scope":"workspace","harness":"copilot-cli","tier":"standard_clear","model":"surface-native-model-id","reasoning_effort":"medium","context_tier":"long_context","check_status":"verified"}
```

- Exit codes (stable; Vivaldi's contract): `0` resolved · `2` missing/corrupt/incomplete configuration or invalid input · `3` active harness profile missing · `4` invalid tier · `5` I/O or internal failure. Errors are one actionable line on stderr.
- Never hardcode selectable model names or identifiers. `long_context` is a named harness tier; this contract makes no numeric context-window promise.
