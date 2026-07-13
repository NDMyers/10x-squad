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

For `copilot-vscode`:

1. Prefer a structured selectable-subagent-model list exposed by the active agent tool.
2. Otherwise call `runSubagent` with the impossible identifier `__10x_catalog_probe__` and the no-side-effect prompt `Do not read files, write files, or invoke tools.` The expected path is rejection before child launch with the active-session selectable list.
3. Convert only returned exact labels into `catalog.models`; never supplement them from documentation, provider pages, another surface, or memory.
4. Filter forbidden entries while preserving every remaining string byte-for-byte.
5. If no reliable list is returned, STOP and show the raw harness error. There is no hardcoded fallback.

## Matching states and interaction

The only states are `exact`, `likely`, `ambiguous`, `no_match`, and `banned`; never infer a sixth state.

- Exact catalog matches pass through.
- Likely matches require affirmative confirmation of the displayed exact candidate.
- `ambiguous` requires a choice from the exact returned candidates, followed by resolving the chosen exact string again.
- `no_match` shows the full selectable list and stops pending an exact choice or cancel.
- `banned` stops.

Ambiguous and `no_match` stop before preview/write; `banned` cannot proceed either. Effort, thinking, and reasoning words express user intent only. The routing schema has no reasoning-effort field.

## Executable resolver and probe contract

For every model intent, create session-only `RESOLVE_REQUEST.json` containing exactly the request `{harness,user_input,catalog}`, then run:

```text
node scripts/model-id-resolver.js resolve --input RESOLVE_REQUEST.json
```

Require exit 0 and exactly one JSON object. Malformed output or exit 2 stops. Retain the returned resolution, not a reconstructed version.

Once all five tier selections are `exact` or affirmative-confirmed `likely`, create `SESSION.json` with `harness`, `catalog`, and `selections`, then run:

```text
node scripts/model-id-resolver.js verification-targets --input SESSION.json
```

Require exit 0, exactly five assignments, and deduplicated `verification_targets`. Verification is deduplicated by unique identifier. Probe each target once with the exact prompt specified in `SKILL.md`, then add only raw observations under `probes[requested_model]`: `ok`, `requested_model`, `identity_observable`, `checked_at`, and any observed `executed_model` or failure `error`.

Every successful probe explicitly includes `identity_observable: true` or `false`. `true` also requires `executed_model`; `false` omits it. Missing `executed_model` alone must NEVER be inferred as unobservable. A missing observability flag is a gate error.

After every target has one successful, non-blocking observation, run:

```text
node scripts/model-id-resolver.js build-profile --input SESSION.json
```

Require exit 0 and exactly one stdout JSON object. Pass its stdout JSON UNCHANGED as proposal input to `validate-profile` (if used), `diff-profile`, and `upsert-profile`. The skill must not manually assemble `assignments` or `model_checks`. Only exact active-catalog strings enter `assignments`; `original_input` is never stored.

Remove `RESOLVE_REQUEST.json`, `SESSION.json`, and any transient proposal after completion or cancellation. Never create session files under `.10x-squad` or commit them.

## Evidence gate

`addressability_probe` maps to `unverified`. `dispatch_smoke_test` maps to `verified` only when requested and executed identities are observable and byte-equal. Catalog membership alone must still probe. Failed launch, invalid or unavailable identifiers, policy rejection, and observed mismatch or substitution hard-block before write.

| Observation | Status | Method | Gate |
|---|---|---|---|
| Requested/executed identities observable and byte-equal | `verified` | `dispatch_smoke_test` | May proceed |
| Launch succeeds but identity is not independently observable | `unverified` | `addressability_probe` | May proceed with explicit warning |
| Catalog membership only | no check | none | Must still probe |
| Invalid/unavailable/policy rejection/mismatch | no write | none | Stop |
