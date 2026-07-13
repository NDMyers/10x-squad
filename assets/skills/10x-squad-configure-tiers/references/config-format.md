# Model-Routing Configuration Format (schema v1)

One squad-wide configuration maps the five work-complexity tiers to exact, surface-native model identifiers, per harness. Personas never carry model policy; Vivaldi resolves the task's tier through this configuration on every dispatch.

## Locations and precedence

1. **One-dispatch user override** — transient, announced, never stored.
2. **Workspace** — `<workspace>/.10x-squad/model-routing.json`.
3. **User-global** — `$XDG_CONFIG_HOME/10x-squad/model-routing.json`, falling back to `~/.config/10x-squad/model-routing.json`.
4. **No assignment** — configuration error; run `/10x-squad-configure-tiers`.

The override unit is **one complete harness profile**. If the workspace file defines the active harness, its five assignments replace that harness's global profile wholesale — there is no per-key merge. A workspace file that lacks the active harness falls through to the global profile. Neither location is installer-owned; reinstalling the squad preserves both.

## Schema

```json
{
  "schema_version": 1,
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

All model names in examples are illustrative shapes, never defaults; real values must be verified against the active surface at configure time (catalog listings alone do not prove executability — the CLI rejects documented-but-unentitled slugs).

### Rules

- `schema_version` must be exactly `1`; `updated_at` is an ISO timestamp string maintained by the engine.
- A harness profile contains **all five canonical keys exactly once**: `trivial`, `lite`, `standard_clear`, `standard_ambiguous`, `complex`.
- Assignment values are exact active-harness catalog strings resolved before proposal construction. `auto`, `inherit` (any casing), blank strings, `null`, non-strings, and unknown tier keys are invalid.
- VS Code (`copilot-vscode`) and Copilot CLI (`copilot-cli`) use different identifier forms; each surface has its own profile and identifiers are never reused across surfaces.
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

- Profile commands consume **one harness profile** (`{"assignments": {...}, "model_checks": {...}}`), not a whole config file. Upsert/remove preserve every unrelated harness profile and write atomically (same-directory temp file + rename). Removing the final workspace profile deletes `model-routing.json` and leaves `.10x-squad/` intact.
- `diff-profile` and `remove-profile --dry-run` preview without writing.
- Successful `resolve` prints exactly one JSON object and no prose:

```json
{"ok":true,"schema_version":1,"scope":"workspace","harness":"copilot-vscode","tier":"standard_clear","model":"surface-native-model-id","check_status":"verified"}
```

- Exit codes (stable; Vivaldi's contract): `0` resolved · `2` missing/corrupt/incomplete configuration or invalid input · `3` active harness profile missing · `4` invalid tier · `5` I/O or internal failure. Errors are one actionable line on stderr.
