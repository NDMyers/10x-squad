# Active-Harness Model Resolution

This contract is session-only. Its catalog, user intent, resolver requests, selections, and probe observations are never routing configuration.

## Catalog contract

Acquire one catalog for the active harness and retain this shape in session state:

```json
{
  "harness": "copilot-vscode",
  "source": "harness",
  "checked_at": "2026-07-13T00:00:00.000Z",
  "models": ["GPT-5.5 (copilot)", "GPT-5.4 (copilot)"],
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

Ambiguous and `no_match` stop before preview/write; `banned` cannot proceed either. Effort, thinking, and reasoning words express user intent only. The routing schema has no reasoning-effort field.

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

Once all five tier selections are `exact` or affirmative-confirmed `likely`, create `$SESSION_SCRATCH/SESSION.json` with exclusive creation and the fields `harness`, `catalog`, and `selections`. Each `selections[tier]` is a wrapper: `selections[tier].resolution` is the entire, unmodified single JSON object returned by that tier's `resolve` invocation. An exact wrapper is `{"resolution": <resolve stdout>}`. A likely wrapper is `{"resolution": <resolve stdout>, "confirmed": true}` only after affirmative confirmation; `confirmed` is a sibling of `resolution`, never nested inside it.

This complete session is executable as written:

<!-- executable-session-example:start -->
```json
{
  "harness": "copilot-vscode",
  "catalog": {
    "harness": "copilot-vscode",
    "source": "harness",
    "checked_at": "2026-07-13T00:00:00.000Z",
    "models": ["GPT-5.5 (copilot)"],
    "excluded": []
  },
  "selections": {
    "trivial": {"resolution":{"harness":"copilot-vscode","selectable_models":["GPT-5.5 (copilot)"],"excluded":[],"state":"exact","candidate":"GPT-5.5 (copilot)","candidates":["GPT-5.5 (copilot)"],"requires_confirmation":false}},
    "lite": {"resolution":{"harness":"copilot-vscode","selectable_models":["GPT-5.5 (copilot)"],"excluded":[],"state":"exact","candidate":"GPT-5.5 (copilot)","candidates":["GPT-5.5 (copilot)"],"requires_confirmation":false}},
    "standard_clear": {"resolution":{"harness":"copilot-vscode","selectable_models":["GPT-5.5 (copilot)"],"excluded":[],"state":"likely","candidate":"GPT-5.5 (copilot)","candidates":["GPT-5.5 (copilot)"],"requires_confirmation":true},"confirmed":true},
    "standard_ambiguous": {"resolution":{"harness":"copilot-vscode","selectable_models":["GPT-5.5 (copilot)"],"excluded":[],"state":"exact","candidate":"GPT-5.5 (copilot)","candidates":["GPT-5.5 (copilot)"],"requires_confirmation":false}},
    "complex": {"resolution":{"harness":"copilot-vscode","selectable_models":["GPT-5.5 (copilot)"],"excluded":[],"state":"exact","candidate":"GPT-5.5 (copilot)","candidates":["GPT-5.5 (copilot)"],"requires_confirmation":false}}
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

Require exit 0, exactly five assignments, and deduplicated `verification_targets`. Verification is deduplicated by unique identifier. Probe each target once with the exact prompt specified in `SKILL.md`, then update only this session-owned `SESSION.json` to add raw observations under `probes[requested_model]`: `ok`, `requested_model`, `identity_observable`, `checked_at`, and any observed `executed_model` or failure `error`.

Every successful probe explicitly includes `identity_observable: true` or `false`. `true` also requires `executed_model`; `false` omits it. Missing `executed_model` alone must NEVER be inferred as unobservable. A missing observability flag is a gate error.

After every target has one successful, non-blocking observation, run:

<!-- resolver-command:build-profile:start -->
```sh
node "$SKILL_ROOT/scripts/model-id-resolver.js" build-profile --input "$SESSION_SCRATCH/SESSION.json"
```
<!-- resolver-command:build-profile:end -->

Require exit 0 and exactly one stdout JSON object. Pass its stdout JSON UNCHANGED as proposal input to `validate-profile` (if used), `diff-profile`, and `upsert-profile`. The skill must not manually assemble `assignments` or `model_checks`. Only exact active-catalog strings enter `assignments`; `original_input` is never stored.

Cleanup runs unconditionally in a `finally-style` path on success, cancellation, hard-block/stop, error, or interruption: remove `RESOLVE_REQUEST.json`, `SESSION.json`, transient proposals, and then the session-owned scratch directory. Never create the scratch directory under `.10x-squad`, overwrite anything pre-existing, or commit it.

## Evidence gate

`addressability_probe` maps to `unverified`. `dispatch_smoke_test` maps to `verified` only when requested and executed identities are observable and byte-equal. Catalog membership alone must still probe. Failed launch, invalid or unavailable identifiers, policy rejection, and observed mismatch or substitution hard-block before write.

| Observation | Status | Method | Gate |
|---|---|---|---|
| Requested/executed identities observable and byte-equal | `verified` | `dispatch_smoke_test` | May proceed |
| Launch succeeds but identity is not independently observable | `unverified` | `addressability_probe` | May proceed with explicit warning |
| Catalog membership only | no check | none | Must still probe |
| Invalid/unavailable/policy rejection/mismatch | no write | none | Stop |
