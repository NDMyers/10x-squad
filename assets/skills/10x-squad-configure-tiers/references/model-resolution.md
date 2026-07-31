# Active-Harness Model Resolution

This contract is session-only. Its catalog, user intent, resolver requests, selections, and probe observations are never routing configuration.

## Catalog contract

Acquire one catalog for the active harness and retain this shape in session state:

```json
{
  "harness": "copilot-vscode",
  "source": "harness",
  "checked_at": "2026-07-13T00:00:00.000Z",
  "models": ["example-model-alpha", "example-model-beta"],
  "excluded": [{"model":"Auto (copilot)","reason":"squad invariant: Auto banned"}]
}
```

`Auto (copilot)` is excluded from `models` and banned.

## copilot-vscode adapter

1. Prefer a structured selectable-subagent-model list exposed by the active agent tool. `runSubagent` declares `model` as a bare `string` with no enum, so this surface exposes no such list and the probe below is the working path.
2. Otherwise call `runSubagent` with the impossible identifier `__10x_catalog_probe__` **as the `model` argument**, `agentName` left unset, and the no-side-effect prompt `Do not read files, write files, or invoke tools.` The expected path is rejection before child launch with the active-session selectable list.
3. **The probe belongs in `model`, never in `agentName`.** These are separate optional parameters resolved in that order, and an unknown agent name is rejected during agent lookup — before model validation ever runs. `Requested agent '__10x_catalog_probe__' not found` is therefore a mis-targeted probe returning no catalog, not a harness that lacks one; re-issue it against `model` rather than treating it as the STOP condition in step 6.
4. Convert only returned exact labels into `catalog.models`; never supplement them from documentation, provider pages, another surface, or memory.
5. Filter forbidden entries while preserving every remaining string byte-for-byte. `runSubagent` documents `model` as `"Model Name (Vendor)"`, so a well-formed label on this surface carries its vendor suffix (e.g. `GPT-5.6 Terra (copilot)`); a bare slug such as `gpt-5.6-terra` is a foreign-surface identifier and must never be stored here.
6. If no reliable list is returned, STOP and show the raw harness error. There is no hardcoded fallback.

## copilot-cli adapter

1. Prefer a structured active-session selectable child-model list when the harness exposes one.
2. Otherwise invoke the active CLI child dispatch tool `task` with model `__10x_catalog_probe__` and the no-side-effect prompt `Do not read files, write files, or invoke tools.`
3. The expected proven path is failure before child launch with the exact `Available models` list for the entitled active account.
4. Convert only the exact returned labels into `catalog.models`; filter forbidden entries while preserving every remaining string byte-for-byte.
5. If no reliable list is returned, STOP and show the raw harness error. Never use help, documentation, another surface, or hardcoded data as a fallback.

## codex-cli adapter

1. Acquire the **parent** catalog with `codex debug models` — machine-readable JSON, non-billable, no dispatch needed. Take `models[]` entries where `visibility === "list"` and use each `slug` as the exact identifier; entries with `visibility: "hide"` (e.g. `codex-auto-review`) are excluded.
2. **The parent catalog is not the spawn catalog.** `codex debug models` lists every parent-selectable model; `spawn_agent` accepts a strictly smaller set (on the reference account, `{gpt-5.6-sol, gpt-5.6-terra}` versus six listed). Because Vivaldi routes personas through `spawn_agent`, the **assignment identifiers must be spawnable models**, not merely listed ones.
3. Acquire the authoritative spawn set from the spawn boundary: an invalid `spawn_agent` `model` is rejected before child launch with an `Available models:` list (e.g. `Unknown model \`x\` for spawn_agent. Available models: gpt-5.6-sol, gpt-5.6-terra`). That enumerated list is the source of truth for what a persona dispatch can address. No feature flag is required: the spawn tool carrying `model` and `reasoning_effort` is present by default (`multi_agent_v2` swaps in a different toolset, it does not supply the actuator).
4. Convert only the exact returned slugs into `catalog.models`; never supplement from `codex debug models` alone, documentation, another surface, or memory. There is no `Auto` entry to exclude on this surface.
5. Re-acquire rather than cache: the spawn set is account- and time-dependent and has been observed to change within days, invalidating a written record. A stored assignment can become unspawnable with no local change.
6. If neither source returns a reliable list, STOP and show the raw harness error. No hardcoded fallback.

## codex-app adapter

The ChatGPT desktop app is a **separate surface** with its own profile and its own catalog. It is not
a skin over the CLI: it ships its own engine build, and the two surfaces' spawnable sets have been
observed to differ from each other's *recorded* values because entitlement drifts over time. Never
copy a `codex-cli` profile across, and never assume the two catalogs match today because they matched
before.

1. Acquire the **parent** catalog with `codex debug models` exactly as for `codex-cli` — the app's own
   engine answers it, and on the reference account it returned an identical parent list.
2. **The parent catalog is not the spawn catalog** here either. Acquire the authoritative spawn set
   from the spawn boundary: an invalid `model` is rejected before child launch with an
   `Available models:` enumeration. That list is the source of truth for what a persona dispatch can
   address on this surface.
3. Convert only the exact returned slugs into `catalog.models`; never supplement from
   `codex debug models` alone, from the `codex-cli` profile, from documentation, or from memory.
4. Re-acquire rather than cache. The spawn set is account- and time-dependent: on the reference
   account it went from two entries to five in four days, which invalidated a written record. A stored
   assignment can therefore become unspawnable with no local change; the fail-loud pre-launch
   rejection is what catches it.
5. If neither source returns a reliable list, STOP and show the raw harness error. No hardcoded
   fallback.

Runtime settings match `codex-cli`'s vocabulary — reasoning `auto|low|medium|high|xhigh|max|ultra`,
`context_tier` `auto` only — but that is a conclusion drawn from this surface's own spawn signature
and catalog, not an inheritance. The per-model `supported_reasoning_levels` check below applies here
unchanged.

Detecting which surface is active is Vivaldi's job at dispatch time, not the skill's; the skill asks
once when uncertain. The signal is `CODEX_INTERNAL_ORIGINATOR_OVERRIDE` corroborated by
`/Applications/ChatGPT.app/` on `PATH`. The `codex` binary path and `codex --version` do **not**
discriminate — both surfaces resolve the same standalone binary on `PATH`.

Codex reasoning-effort legality is **per model**: `codex debug models` reports each model's `supported_reasoning_levels`, and the same value is validated at spawn time (`Reasoning effort \`x\` is not supported for model \`gpt-5.6-sol\`. Supported reasoning efforts: …`). When a tier's `reasoning_effort` is explicit, confirm it is in the chosen model's supported set before writing. The dependency-free engine validates only the harness-level vocabulary; this per-model check is the skill's responsibility because only the skill holds the live catalog. See `docs/codex-harness-spike.md` (C4/C7/C9) for evidence and for why executed-model identity is not observable on Codex.

## Matching states and interaction

The only states are `exact`, `likely`, `ambiguous`, `no_match`, and `banned`; never infer a sixth state.

- Exact catalog matches pass through.
- Likely matches require affirmative confirmation of the displayed exact candidate.
- `ambiguous` requires a choice from the exact returned candidates, followed by resolving the chosen exact string again.
- `no_match` shows the full selectable list and stops pending an exact choice or cancel.
- `banned` stops.

Ambiguous and `no_match` stop before preview/write; `banned` cannot proceed either. Model catalog discovery and model intent resolution remain model-only. Effort, thinking, and reasoning words in free text may be removable model-matching noise, but they never set runtime choices. Collect runtime choices separately as selection siblings.

## Runtime-setting contract

Each resolved model selection also needs explicit-or-`auto` choices for `reasoning_effort` and `context_tier`. The accepted vocabulary is **per harness**:

| Harness | `reasoning_effort` | `context_tier` |
|---|---|---|
| `copilot-cli` | `auto\|low\|medium\|high\|xhigh` | `auto\|default\|long_context` |
| `codex-cli` | `auto\|low\|medium\|high\|xhigh\|max\|ultra` | `auto` only |
| `codex-app` | `auto\|low\|medium\|high\|xhigh\|max\|ultra` | `auto` only |
| `copilot-vscode`, unknown | `auto` only | `auto` only |

`auto` means independently omit that corresponding dispatch parameter and allow the active harness's adaptive or default behavior. It is not Copilot model Auto and is not parent inheritance. `long_context` is a Copilot named tier; never promise a numeric context size. `context_tier` has no Codex analog — Codex `spawn_agent` takes only `model` and `reasoning_effort`, so `codex-cli` accepts `auto` alone.

`copilot-cli`, `codex-cli`, and `codex-app` support explicit values (within their columns above); on both Codex surfaces, an explicit `reasoning_effort` must additionally be in the chosen model's `supported_reasoning_levels`. For `copilot-vscode` or an unknown harness, only `auto`/`auto` is allowed. If a setting is outside its harness column, hard-stop before any probe, preview, or write.

## Executable resolver and probe contract

Create a unique, session-owned scratch directory outside `.10x-squad` using collision-safe exclusive creation. Bind absolute `SKILL_ROOT` (the directory containing this skill's `SKILL.md`) and absolute `SESSION_SCRATCH` (that scratch directory) in the command environment. At initial creation, refuse to overwrite any pre-existing file or directory. Never overwrite a path not created and owned by this session. Exclusively create every fixed scratch path on first use; the session may later update only its owned `SESSION.json` to add probe observations. Every transient and proposal file lives under `SESSION_SCRATCH`; never rely on the current working directory.

For every model intent, create `$SESSION_SCRATCH/RESOLVE_REQUEST.json` with exclusive creation and write exactly `{harness,user_input,catalog}`, then run:

<!-- resolver-command:resolve:start -->
```sh
node "$SKILL_ROOT/scripts/model-id-resolver.js" resolve --input "$SESSION_SCRATCH/RESOLVE_REQUEST.json"
```
<!-- resolver-command:resolve:end -->

Require exit 0 and exactly one JSON object. Malformed output or exit 2 stops. Retain the returned resolution, not a reconstructed version.

Remove `RESOLVE_REQUEST.json` in a per-invocation `finally` before preparing the next model intent. The outer unconditional cleanup remains responsible for interruption or other abnormal exits.

Once every distinct model intent is `exact` or affirmative-confirmed `likely`, describe the chosen entry path as a **plan** rather than assembling thirty cells by hand. Create `$SESSION_SCRATCH/PLAN.json` with exclusive creation and the fields `harness`, `catalog`, `plan`, and optionally `parent_catalog` and `advisory`.

`plan.mode` is one of `default_all`, `role_lanes`, `per_tier`, or `matrix`. Each `model` field holds the entire, unmodified single JSON object returned by that intent's `resolve` invocation. For a likely match add `confirmed: true` as a sibling of `model`, never nested inside it. `reasoning_effort` and `context_tier` default to `auto` where a plan omits them; a lane's `effort_curve` and optional `context_curve` carry all five canonical tier keys.

This complete plan is executable as written, and expands into the full 6 × 5 matrix:

<!-- executable-plan-example:start -->
```json
{
  "harness": "copilot-cli",
  "catalog": {
    "harness": "copilot-cli",
    "source": "harness",
    "checked_at": "2026-07-13T00:00:00.000Z",
    "models": ["example-model-alpha", "example-model-beta"],
    "excluded": []
  },
  "plan": {
    "mode": "role_lanes",
    "lanes": {
      "thinker": {
        "model": {"harness":"copilot-cli","selectable_models":["example-model-alpha","example-model-beta"],"excluded":[],"state":"exact","candidate":"example-model-alpha","candidates":["example-model-alpha"],"requires_confirmation":false},
        "effort_curve": {"trivial":"auto","lite":"low","standard_clear":"medium","standard_ambiguous":"high","complex":"xhigh"},
        "context_curve": {"trivial":"auto","lite":"auto","standard_clear":"default","standard_ambiguous":"long_context","complex":"long_context"}
      },
      "builder": {
        "model": {"harness":"copilot-cli","selectable_models":["example-model-alpha","example-model-beta"],"excluded":[],"state":"likely","candidate":"example-model-beta","candidates":["example-model-beta"],"requires_confirmation":true},
        "confirmed": true,
        "effort_curve": {"trivial":"auto","lite":"auto","standard_clear":"low","standard_ambiguous":"medium","complex":"medium"},
        "context_curve": {"trivial":"auto","lite":"auto","standard_clear":"auto","standard_ambiguous":"default","complex":"default"}
      },
      "reviewer": {
        "model": {"harness":"copilot-cli","selectable_models":["example-model-alpha","example-model-beta"],"excluded":[],"state":"exact","candidate":"example-model-alpha","candidates":["example-model-alpha"],"requires_confirmation":false},
        "effort_curve": {"trivial":"low","lite":"medium","standard_clear":"high","standard_ambiguous":"high","complex":"xhigh"},
        "context_curve": {"trivial":"auto","lite":"auto","standard_clear":"default","standard_ambiguous":"long_context","complex":"long_context"}
      }
    }
  }
}
```
<!-- executable-plan-example:end -->

Expand it into the session with the sole selections builder:

<!-- resolver-command:expand-selections:start -->
```sh
node "$SKILL_ROOT/scripts/model-id-resolver.js" expand-selections --input "$SESSION_SCRATCH/PLAN.json"
```
<!-- resolver-command:expand-selections:end -->

Require exit 0 and exactly one JSON object carrying all six canonical persona keys, each with all five canonical tier keys. Save those exact stdout bytes by exclusive creation at `$SESSION_SCRATCH/SESSION.json`; never hand-edit the expansion. Each `selections[persona][tier]` is a wrapper whose `resolution` is the unmodified resolver object, with canonical `reasoning_effort` and `context_tier` siblings and `confirmed: true` where a likely match was affirmed. **No lane, role, or mode marker survives expansion** — the session and every downstream artifact contain only explicit per-persona cells.

Then run:

<!-- resolver-command:verification-targets:start -->
```sh
node "$SKILL_ROOT/scripts/model-id-resolver.js" verification-targets --input "$SESSION_SCRATCH/SESSION.json"
```
<!-- resolver-command:verification-targets:end -->

Require exit 0, exactly six persona rows of five assignments each, the matching `dispatch_settings` matrix, and deduplicated `verification_targets`. Verification is deduplicated by the complete tuple `(model, reasoning_effort, context_tier)`, which is persona independent — six personas sharing one model and effort still cost exactly one probe. The same model with different settings therefore produces different targets.

Widening to thirty cells does not multiply probes, but it does raise the ceiling. Report the number of unique verification targets before the first probe; when it exceeds five, state the count explicitly and obtain confirmation before probing. Typical counts: `default_all` 1, `role_lanes` up to 15 (commonly around 9), `per_tier` up to 5, `matrix` up to 30. Each target has this resolver-owned shape:

```json
{"id":"[\"example-model-alpha\",\"auto\",\"long_context\"]","model":"example-model-alpha","reasoning_effort":"auto","context_tier":"long_context","dispatch_arguments":{"model":"example-model-alpha","context_tier":"long_context"}}
```

For each target, invoke the harmless probe using exactly `target.dispatch_arguments` plus the exact prompt specified in `SKILL.md`. Never reconstruct the arguments and never add an omitted `auto` field. Store one raw observation under `probes[target.id]`; copy the exact object to `requested_arguments` alongside raw observation fields `ok`, `requested_model`, `identity_observable`, `checked_at`, and any observed `executed_model` or failure `error`. The tuple ID, not a model string, is the probe key.

Every successful probe explicitly includes `identity_observable: true` or `false`. `true` also requires `executed_model`; `false` omits it. Missing `executed_model` alone must NEVER be inferred as unobservable. A missing observability flag is a gate error.

After every target has one successful, non-blocking observation, run:

<!-- resolver-command:build-profile:start -->
```sh
node "$SKILL_ROOT/scripts/model-id-resolver.js" build-profile --input "$SESSION_SCRATCH/SESSION.json"
```
<!-- resolver-command:build-profile:end -->

Require exit 0 and exactly one stdout JSON object. `build-profile` is the sole proposal builder: the skill must not manually assemble or modify `assignments`, `dispatch_settings`, or `model_checks`. Save its stdout JSON unchanged, by exclusive creation, as `$SESSION_SCRATCH/PROPOSAL.json`. Pass those exact bytes as proposal input to `validate-profile` (if used), `diff-profile`, and `upsert-profile`. Only exact active-catalog strings enter `assignments`; `original_input` is never stored.

The mixed `SESSION.json` example above remains a Copilot CLI example, but preview and write must honor the user's selected target. Bind selected `ACTIVE_HARNESS` to the active harness, selected `TARGET_SCOPE` to `global|workspace`, and absolute `WORKSPACE_ROOT` to the current workspace root. Always pass `WORKSPACE_ROOT`, including when `TARGET_SCOPE` is `global`, so effective output can honor workspace precedence. Preview and upsert the same proposal:

<!-- config-command:diff-profile:start -->
```sh
node "$SKILL_ROOT/scripts/model-tier-config.js" diff-profile --input "$SESSION_SCRATCH/PROPOSAL.json" --scope "$TARGET_SCOPE" --workspace-root "$WORKSPACE_ROOT" --harness "$ACTIVE_HARNESS"
```
<!-- config-command:diff-profile:end -->

<!-- config-command:upsert-profile:start -->
```sh
node "$SKILL_ROOT/scripts/model-tier-config.js" upsert-profile --input "$SESSION_SCRATCH/PROPOSAL.json" --scope "$TARGET_SCOPE" --workspace-root "$WORKSPACE_ROOT" --harness "$ACTIVE_HARNESS"
```
<!-- config-command:upsert-profile:end -->

Cleanup runs unconditionally in a `finally-style` path on success, cancellation, hard-block/stop, error, or interruption: remove `RESOLVE_REQUEST.json`, `PLAN.json`, `SESSION.json`, `PROPOSAL.json`, other transient proposals, and then the session-owned scratch directory. Never create the scratch directory under `.10x-squad`, overwrite anything pre-existing, or commit it.

## Vivaldi's advisory row

An advisory names the model a work tier wants for Vivaldi's **own** session. It is optional, and it is a recommendation the squad reports — never one it applies.

1. **Resolve it against the parent catalog, not the spawn catalog.** Vivaldi runs as the root session, so its model is a parent model. The spawn catalog is a strictly smaller set (on the reference Codex account, two spawnable models against six listed), and resolving a parent intent against it would reject a legitimate recommendation. Acquire the parent catalog with the harness's parent-catalog step above and pass it as `parent_catalog` alongside `catalog`.
2. **Never probe it.** Probing means dispatching a child, which is the wrong signal for a parent model and will usually fail outright. Advisory entries produce no verification target and no `model_checks` entry; the evidence gate below does not apply to them.
3. Supply `advisory.vivaldi[tier]` as `{model, confirmed?, reasoning_effort}`, where `model` is the unmodified `resolve` output. `reasoning_effort` is capability-gated per harness exactly as a dispatch setting is. There is no `context_tier`: no surface lets a session choose its own parent's context tier.
4. Skipping the advisory entirely is a normal outcome. `resolve-advisory` then reports `{"ok":true,"advisory":false}` with exit 0, and Vivaldi announces nothing.

## Evidence gate

`addressability_probe` maps to `unverified`. `dispatch_smoke_test` maps to `verified` only when requested and executed identities are observable and byte-equal. Catalog membership alone must still probe. Failed launch, invalid or unavailable identifiers, policy rejection, and observed mismatch or substitution hard-block before write.

| Observation | Status | Method | Gate |
|---|---|---|---|
| Requested/executed identities observable and byte-equal, and requested arguments match the target | `verified` | `dispatch_smoke_test` | May proceed |
| Launch succeeds but identity is not independently observable | `unverified` | `addressability_probe` | May proceed with explicit warning |
| Catalog membership only | no check | none | Must still probe |
| Invalid/unavailable/policy rejection/mismatch | no write | none | Stop |

Never hardcode selectable model names or identifiers. Always acquire them through the unchanged active-harness catalog adapters above.
