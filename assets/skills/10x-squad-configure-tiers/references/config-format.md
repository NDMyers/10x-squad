# Model-Routing Configuration Format (schema v3)

One squad-wide configuration maps each **(persona, work tier)** pair to a work-tier profile: one exact, surface-native model plus reasoning and context choices, per harness. Six dispatchable personas × five work tiers is a 30-cell matrix. Personas never carry model policy in their own skill files — the persona is a coordinate Vivaldi passes to the resolver on every dispatch, and Vivaldi resolves each persona's own profile.

Routing on `(persona, tier)` separates two things that a tier-only key conflates: how hard the task is, and how much reasoning the role needs. A Complex task can warrant a frontier model at maximum effort for the personas that plan and gate the work, and a cheaper model for the persona executing an already-reviewed spec.

## Locations and precedence

1. **One-dispatch user override** — transient, announced, never stored.
2. **Workspace** — `<workspace>/.10x-squad/model-routing.json`.
3. **User-global** — `$XDG_CONFIG_HOME/10x-squad/model-routing.json`, falling back to `~/.config/10x-squad/model-routing.json`.
4. **No assignment** — configuration error; run `/10x-squad-configure-tiers`.

The override unit is **one complete harness profile**. If the workspace file defines the active harness, its whole matrix replaces that harness's global profile wholesale — there is no per-key merge, and no per-persona merge. A workspace file that lacks the active harness falls through to the global profile. Neither location is installer-owned; reinstalling the squad preserves both.

## Schema

```json
{
  "schema_version": 3,
  "updated_at": "2026-07-13T00:00:00.000Z",
  "harnesses": {
    "copilot-cli": {
      "assignments": {
        "einstein": {"trivial": "example-top-slug", "lite": "example-top-slug", "standard_clear": "example-top-slug", "standard_ambiguous": "example-top-slug", "complex": "example-top-slug"},
        "peter": {"trivial": "example-top-slug", "lite": "example-top-slug", "standard_clear": "example-top-slug", "standard_ambiguous": "example-top-slug", "complex": "example-top-slug"},
        "linus": {"trivial": "example-cheap-slug", "lite": "example-cheap-slug", "standard_clear": "example-cheap-slug", "standard_ambiguous": "example-cheap-slug", "complex": "example-cheap-slug"},
        "cobalt": {"trivial": "example-mid-slug", "lite": "example-mid-slug", "standard_clear": "example-mid-slug", "standard_ambiguous": "example-mid-slug", "complex": "example-mid-slug"},
        "sentinel": {"trivial": "example-mid-slug", "lite": "example-mid-slug", "standard_clear": "example-mid-slug", "standard_ambiguous": "example-mid-slug", "complex": "example-mid-slug"},
        "ralph": {"trivial": "example-cheap-slug", "lite": "example-cheap-slug", "standard_clear": "example-cheap-slug", "standard_ambiguous": "example-cheap-slug", "complex": "example-cheap-slug"}
      },
      "dispatch_settings": {
        "einstein": {
          "trivial": {"reasoning_effort": "low", "context_tier": "auto"},
          "lite": {"reasoning_effort": "medium", "context_tier": "auto"},
          "standard_clear": {"reasoning_effort": "high", "context_tier": "default"},
          "standard_ambiguous": {"reasoning_effort": "high", "context_tier": "long_context"},
          "complex": {"reasoning_effort": "xhigh", "context_tier": "long_context"}
        },
        "peter": {
          "trivial": {"reasoning_effort": "low", "context_tier": "auto"},
          "lite": {"reasoning_effort": "low", "context_tier": "auto"},
          "standard_clear": {"reasoning_effort": "medium", "context_tier": "default"},
          "standard_ambiguous": {"reasoning_effort": "high", "context_tier": "long_context"},
          "complex": {"reasoning_effort": "high", "context_tier": "long_context"}
        },
        "linus": {
          "trivial": {"reasoning_effort": "auto", "context_tier": "auto"},
          "lite": {"reasoning_effort": "low", "context_tier": "auto"},
          "standard_clear": {"reasoning_effort": "medium", "context_tier": "default"},
          "standard_ambiguous": {"reasoning_effort": "medium", "context_tier": "default"},
          "complex": {"reasoning_effort": "medium", "context_tier": "long_context"}
        },
        "cobalt": {
          "trivial": {"reasoning_effort": "low", "context_tier": "auto"},
          "lite": {"reasoning_effort": "medium", "context_tier": "auto"},
          "standard_clear": {"reasoning_effort": "high", "context_tier": "default"},
          "standard_ambiguous": {"reasoning_effort": "high", "context_tier": "long_context"},
          "complex": {"reasoning_effort": "high", "context_tier": "long_context"}
        },
        "sentinel": {
          "trivial": {"reasoning_effort": "low", "context_tier": "auto"},
          "lite": {"reasoning_effort": "medium", "context_tier": "auto"},
          "standard_clear": {"reasoning_effort": "high", "context_tier": "default"},
          "standard_ambiguous": {"reasoning_effort": "high", "context_tier": "long_context"},
          "complex": {"reasoning_effort": "high", "context_tier": "long_context"}
        },
        "ralph": {
          "trivial": {"reasoning_effort": "auto", "context_tier": "auto"},
          "lite": {"reasoning_effort": "low", "context_tier": "auto"},
          "standard_clear": {"reasoning_effort": "medium", "context_tier": "default"},
          "standard_ambiguous": {"reasoning_effort": "medium", "context_tier": "default"},
          "complex": {"reasoning_effort": "medium", "context_tier": "long_context"}
        }
      },
      "advisory": {
        "vivaldi": {
          "trivial": {"model": "example-parent-slug", "reasoning_effort": "low"},
          "lite": {"model": "example-parent-slug", "reasoning_effort": "medium"},
          "standard_clear": {"model": "example-parent-slug", "reasoning_effort": "high"},
          "standard_ambiguous": {"model": "example-parent-slug", "reasoning_effort": "high"},
          "complex": {"model": "example-parent-slug", "reasoning_effort": "xhigh"}
        }
      },
      "model_checks": {
        "example-top-slug": {
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

- Stored schema versions `1`, `2`, and `3` are readable; every successful profile write upgrades the file to schema v3. `updated_at` is an ISO timestamp string maintained by the engine.
- **The stored `schema_version` is the only shape discriminator.** Versions 1 and 2 store one tier row per harness; version 3 stores a persona-major matrix. Never infer the shape by inspecting leaf types.
- **Schema 1 and 2 profiles broadcast**: their single tier row resolves for every persona. That is exactly how those versions have always routed, so an existing install keeps working unchanged and nobody is forced to reconfigure.
- A schema-v1 profile with omitted `dispatch_settings` reads as `auto`/`auto` for every tier. Schema v1 rejects v2-only fields, and schemas v1 and v2 both reject the v3-only `advisory` field.
- Every new proposal contains **all six canonical persona keys exactly once** (`einstein`, `peter`, `linus`, `cobalt`, `sentinel`, `ralph`) in both `assignments` and `dispatch_settings`, and within each persona row **all five canonical tier keys exactly once** (`trivial`, `lite`, `standard_clear`, `standard_ambiguous`, `complex`). Every new proposal contains all five `dispatch_settings` entries per persona — 30 in total.
- **No inheritance rule, lane marker, role marker, or entry-path marker is ever stored.** The wizard's four entry paths differ only in how many questions they ask; each produces the same fully explicit 30-cell proposal.
- Every `dispatch_settings` entry contains exactly `reasoning_effort` and `context_tier`. The accepted vocabulary is per harness: `copilot-cli` reasoning `auto|low|medium|high|xhigh`, context `auto|default|long_context`; `codex-cli` and `codex-app` reasoning `auto|low|medium|high|xhigh|max|ultra`, context `auto` only; every other harness (`copilot-vscode`, unknown) `auto`/`auto` only.
- Schema v3 accepts a profile with omitted `dispatch_settings` for compatibility because stored provenance cannot be proven. This read tolerance does not weaken the write contract: every newly built or upserted target profile materializes all thirty `dispatch_settings` entries. On unrelated retained legacy profiles, `dispatch_settings` may remain omitted.
- Assignment values are exact active-harness catalog strings resolved before proposal construction. `auto`, `inherit` (any casing), blank strings, `null`, non-strings, unknown tier keys, and unknown persona keys are invalid.
- Runtime `auto` is not a model assignment. It independently omits only its corresponding dispatch argument so the active harness can use adaptive or default behavior; it is neither Copilot model Auto nor parent inheritance.
- Explicit runtime settings are allowed for `copilot-cli` (both settings) and for `codex-cli` and `codex-app` (`reasoning_effort` only; `context_tier` is `auto`-only). `copilot-vscode` and unknown harness profiles may use `auto`/`auto`; if a setting is outside its harness's accepted vocabulary, configuration hard-stops before any probe, preview, or write. On either Codex surface an explicit `reasoning_effort` must also be in the chosen model's `supported_reasoning_levels` (a live-catalog check the skill performs; the dependency-free engine validates only the harness vocabulary, and the harness enforces the per-model rule at spawn time).
- Each surface (`copilot-vscode`, `copilot-cli`, `codex-cli`, `codex-app`) uses different identifier forms; each has its own profile and identifiers are never reused across surfaces. Copilot model names are not valid Codex spawn identifiers, and vice versa. The two Codex surfaces are also kept separate from each other: they run different engine builds, and their spawnable sets drift independently, so a profile stored for one is not valid for the other.
- Original user intent, including free text and keep-current input, is session-only and never stored; `original_input` is not a configuration field.
- `model_checks` is optional advisory metadata keyed by the exact assignment value; entry fields are limited to `display_name`, `status` (`verified` | `unverified`), `method`, `source`, `checked_at`. This flow uses methods `dispatch_smoke_test` and `addressability_probe` and emits `source: "harness"`. An `addressability_probe` MUST have status `unverified`. Catalog membership alone NEVER creates a `model_checks` entry. There is no time-based expiry; `checked_at` is informational.
- **Strict field allowlist on every write:** unknown fields anywhere in a proposal are rejected, and credential-shaped field names (`api_key`, `token`, `secret`, `password`, `authorization`, …) are rejected explicitly. Opaque model-ID and label *values* are never scanned for secret-like text. Credentials and provider endpoints belong in harness/provider configuration, never here.
- **Advisory leniency on read:** a missing, malformed, or unused `model_checks` entry never invalidates the 30 executable assignments — resolution degrades that model to `unverified`. Invalid *assignments*, unknown fields, or a wrong `schema_version` in a stored file make it corrupt and stop the pipeline (exit 2).
- A local/BYOK model is not a special tier: it is usable only as an exact addressable identifier on the active harness; endpoint and credential setup is out of band.

## The `advisory` field

`advisory` records the model a tier *wants* for Vivaldi's own session. It is **optional and never actuated**.

- Vivaldi always runs as the root session on every supported surface, so the squad cannot select its model — the user does that in the harness. An advisory is a recommendation Vivaldi announces at TRIAGE and, where the surface exposes the running parent model, warns about on mismatch. It **never blocks** and never attempts to set the parent model.
- It lives beside `assignments` rather than inside it precisely because `assignments` is the executable routing source: anything in `assignments` is actuatable by definition.
- Advisory models are **parent** models, so they are resolved against the harness's **parent** catalog, not its spawn catalog. The spawn set is strictly smaller (on the reference Codex account, two spawnable models against six listed), and resolving a parent model against it would wrongly reject a legitimate recommendation.
- Advisory entries are **never probed** — probing means dispatching a child, which is both the wrong signal and likely to fail for a parent-only model — and therefore never produce a `model_checks` entry.
- Entries carry exactly `model` and `reasoning_effort`. There is deliberately no `context_tier`: no surface lets a session choose its own parent's context tier, and offering the field would imply otherwise.
- An absent advisory resolves successfully with `advisory: false`. Absence is a legitimate configuration, never an error.

## Engine commands

`scripts/model-tier-config.js` (dependency-free Node 20+, installed at `.github/skills/10x-squad-configure-tiers/scripts/model-tier-config.js`), sharing its canonical key spaces with `scripts/model-id-resolver.js` through `scripts/routing-constants.js`:

```text
validate-profile --input <profile.json> --harness <surface>
diff-profile     --input <profile.json> --scope <global|workspace> --workspace-root <path> --harness <surface>
upsert-profile   --input <profile.json> --scope <global|workspace> --workspace-root <path> --harness <surface>
remove-profile   --scope workspace --workspace-root <path> --harness <surface> [--dry-run]
resolve          --workspace-root <path> --harness <surface> --tier <tier-key> --persona <persona-key> [--json]
resolve-advisory --workspace-root <path> --harness <surface> --tier <tier-key> [--json]
```

- Profile commands consume **one harness profile** (`{"assignments": {...}, "dispatch_settings": {...}, "advisory": {...}, "model_checks": {...}}`), not a whole config file. New proposals always carry the complete settings matrix.
- **Retention across a schema upgrade is semantic, not byte-for-byte.** Upsert and remove preserve every unrelated harness profile and write atomically (same-directory temp file + rename). Because the file carries one `schema_version`, stamping v3 also broadcast-upgrades every retained v1/v2 profile into matrix form — their stored shape changes, their routing does not, and the written file always passes its own validator. Removing the final workspace profile deletes `model-routing.json` and leaves `.10x-squad/` intact.
- `diff-profile` and `remove-profile --dry-run` preview without writing.
- `diff-profile` and `upsert-profile` retain their existing result fields; `effective_after` and `effective_dispatch_settings_after` are persona-major matrices.
- `resolve` **requires `--persona`**: routing is a `(persona, tier)` coordinate, and picking a row on the caller's behalf would be the silent mis-route this schema exists to prevent. Successful `resolve` prints exactly one JSON object and no prose:

```json
{"ok":true,"schema_version":3,"scope":"workspace","harness":"copilot-cli","persona":"linus","tier":"standard_clear","model":"surface-native-model-id","reasoning_effort":"medium","context_tier":"long_context","check_status":"verified"}
```

- `resolve-advisory` takes no persona (the advisory role is implicit) and prints `{"ok":true,"advisory":false, …}` with exit 0 when no advisory is configured.
- Exit codes (stable; Vivaldi's contract): `0` resolved · `2` missing/corrupt/incomplete configuration or invalid input (including an omitted `--persona`) · `3` active harness profile missing · `4` invalid tier **or persona** · `5` I/O or internal failure. Errors are one actionable line on stderr.
- Never hardcode selectable model names or identifiers. `long_context` is a named harness tier; this contract makes no numeric context-window promise.
