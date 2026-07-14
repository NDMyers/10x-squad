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

1. Prefer a structured selectable-subagent-model list exposed by the active agent tool.
2. Otherwise call `runSubagent` with the impossible identifier `__10x_catalog_probe__` and the no-side-effect prompt `Do not read files, write files, or invoke tools.` The expected path is rejection before child launch with the active-session selectable list.
3. Convert only returned exact labels into `catalog.models`; never supplement them from documentation, provider pages, another surface, or memory.
4. Filter forbidden entries while preserving every remaining string byte-for-byte.
5. If no reliable list is returned, STOP and show the raw harness error. There is no hardcoded fallback.

## copilot-cli adapter

1. Prefer a structured active-session selectable child-model list when the harness exposes one.
2. Otherwise invoke the active CLI child dispatch tool `task` with model `__10x_catalog_probe__` and the no-side-effect prompt `Do not read files, write files, or invoke tools.`
3. The expected proven path is failure before child launch with the exact `Available models` list for the entitled active account.
4. Convert only the exact returned labels into `catalog.models`; filter forbidden entries while preserving every remaining string byte-for-byte.
5. If no reliable list is returned, STOP and show the raw harness error. Never use help, documentation, another surface, or hardcoded data as a fallback.

## Matching states and interaction

The only states are `exact`, `likely`, `ambiguous`, `no_match`, and `banned`; never infer a sixth state.

- Exact catalog matches pass through.
- Likely matches require affirmative confirmation of the displayed exact candidate.
- `ambiguous` requires a choice from the exact returned candidates, followed by resolving the chosen exact string again.
- `no_match` shows the full selectable list and stops pending an exact choice or cancel.
- `banned` stops.

Ambiguous and `no_match` stop before preview/write; `banned` cannot proceed either. Model catalog discovery and model intent resolution remain model-only. Effort, thinking, and reasoning words in free text may be removable model-matching noise, but they never set runtime choices. Collect runtime choices separately as selection siblings.

## Runtime-setting contract

Each resolved model selection also needs explicit-or-`auto` choices for `reasoning_effort` and `context_tier`:

- `reasoning_effort`: `auto|low|medium|high|xhigh`
- `context_tier`: `auto|default|long_context`

`auto` means independently omit that corresponding dispatch parameter and allow the active harness's adaptive or default behavior. It is not Copilot model Auto and is not parent inheritance. `long_context` is the harness's named tier; never promise a numeric context size.

Only `copilot-cli` supports explicit values. For `copilot-vscode` or an unknown harness, `auto`/`auto` remains allowed. If either setting is explicit, hard-stop before any probe, preview, or write.

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

Once all five tier selections are `exact` or affirmative-confirmed `likely`, create `$SESSION_SCRATCH/SESSION.json` with exclusive creation and the fields `harness`, `catalog`, and `selections`. Each `selections[tier]` is a wrapper: `selections[tier].resolution` is the entire, unmodified single JSON object returned by that tier's `resolve` invocation. Add canonical `reasoning_effort` and `context_tier` siblings. For a likely match, add `confirmed: true` only after affirmative confirmation; `confirmed` is a sibling of `resolution`, never nested inside it. Every new session carries both settings on all five selections, including explicit `auto` values.

This complete session is executable as written:

<!-- executable-session-example:start -->
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
  "selections": {
    "trivial": {"resolution":{"harness":"copilot-cli","selectable_models":["example-model-alpha","example-model-beta"],"excluded":[],"state":"exact","candidate":"example-model-alpha","candidates":["example-model-alpha"],"requires_confirmation":false},"reasoning_effort":"auto","context_tier":"auto"},
    "lite": {"resolution":{"harness":"copilot-cli","selectable_models":["example-model-alpha","example-model-beta"],"excluded":[],"state":"exact","candidate":"example-model-alpha","candidates":["example-model-alpha"],"requires_confirmation":false},"reasoning_effort":"low","context_tier":"auto"},
    "standard_clear": {"resolution":{"harness":"copilot-cli","selectable_models":["example-model-alpha","example-model-beta"],"excluded":[],"state":"likely","candidate":"example-model-alpha","candidates":["example-model-alpha"],"requires_confirmation":true},"confirmed":true,"reasoning_effort":"auto","context_tier":"long_context"},
    "standard_ambiguous": {"resolution":{"harness":"copilot-cli","selectable_models":["example-model-alpha","example-model-beta"],"excluded":[],"state":"exact","candidate":"example-model-beta","candidates":["example-model-beta"],"requires_confirmation":false},"reasoning_effort":"medium","context_tier":"default"},
    "complex": {"resolution":{"harness":"copilot-cli","selectable_models":["example-model-alpha","example-model-beta"],"excluded":[],"state":"exact","candidate":"example-model-alpha","candidates":["example-model-alpha"],"requires_confirmation":false},"reasoning_effort":"xhigh","context_tier":"long_context"}
  }
}
```
<!-- executable-session-example:end -->

Then run:

<!-- resolver-command:verification-targets:start -->
```sh
node "$SKILL_ROOT/scripts/model-id-resolver.js" verification-targets --input "$SESSION_SCRATCH/SESSION.json"
```
<!-- resolver-command:verification-targets:end -->

Require exit 0, exactly five assignments, all five `dispatch_settings` entries, and deduplicated `verification_targets`. Verification is deduplicated by the complete tuple `(model, reasoning_effort, context_tier)`. The same model with different settings therefore produces different targets. Each target has this resolver-owned shape:

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

For the executable Copilot CLI workspace example, bind an absolute `WORKSPACE_ROOT`, then preview and upsert the same proposal:

<!-- config-command:diff-profile:start -->
```sh
node "$SKILL_ROOT/scripts/model-tier-config.js" diff-profile --input "$SESSION_SCRATCH/PROPOSAL.json" --scope workspace --workspace-root "$WORKSPACE_ROOT" --harness copilot-cli
```
<!-- config-command:diff-profile:end -->

<!-- config-command:upsert-profile:start -->
```sh
node "$SKILL_ROOT/scripts/model-tier-config.js" upsert-profile --input "$SESSION_SCRATCH/PROPOSAL.json" --scope workspace --workspace-root "$WORKSPACE_ROOT" --harness copilot-cli
```
<!-- config-command:upsert-profile:end -->

Cleanup runs unconditionally in a `finally-style` path on success, cancellation, hard-block/stop, error, or interruption: remove `RESOLVE_REQUEST.json`, `SESSION.json`, `PROPOSAL.json`, other transient proposals, and then the session-owned scratch directory. Never create the scratch directory under `.10x-squad`, overwrite anything pre-existing, or commit it.

## Evidence gate

`addressability_probe` maps to `unverified`. `dispatch_smoke_test` maps to `verified` only when requested and executed identities are observable and byte-equal. Catalog membership alone must still probe. Failed launch, invalid or unavailable identifiers, policy rejection, and observed mismatch or substitution hard-block before write.

| Observation | Status | Method | Gate |
|---|---|---|---|
| Requested/executed identities observable and byte-equal, and requested arguments match the target | `verified` | `dispatch_smoke_test` | May proceed |
| Launch succeeds but identity is not independently observable | `unverified` | `addressability_probe` | May proceed with explicit warning |
| Catalog membership only | no check | none | Must still probe |
| Invalid/unavailable/policy rejection/mismatch | no write | none | Stop |

Never hardcode selectable model names or identifiers. Always acquire them through the unchanged active-harness catalog adapters above.
