---
name: 10x-squad-configure-tiers
description: View or change which exact model each 10x Squad work tier dispatches on. Use when the user asks to configure, review, or fix squad model assignments, or when Vivaldi reports missing/invalid model-routing configuration. Assigns one model to all five work tiers or each tier individually, per harness, at workspace or user-global scope.
---

# Configure 10x Squad Work Tiers

Maps `trivial`, `lite`, `standard_clear`, `standard_ambiguous`, and `complex` to exact, surface-native model identifiers for the active harness. Vivaldi resolves every persona dispatch through this configuration; personas remain model-agnostic.

Use `scripts/model-tier-config.js` for configuration and `scripts/model-id-resolver.js` for model intent. See `references/config-format.md` for storage and `references/model-resolution.md` for the catalog, matching, probe, and session-file contracts. **Never edit `model-routing.json` directly**; the engine validates and writes atomically while preserving unrelated harness profiles.

## When this skill runs

- The user invokes `/10x-squad-configure-tiers` or asks to view or change assignments.
- Vivaldi reports missing or invalid routing configuration (exit 2/3 from `resolve`) and offers this skill.

It never runs automatically during a healthy pipeline.

## Start the conversation

1. Detect the active harness (`copilot-vscode`, `copilot-cli`, …). If uncertain, ask once. Never guess or reuse another surface's identifier namespace.
2. Show the current effective mapping by running `resolve` for all five tiers and displaying a five-row table with each source scope. Show actionable resolution errors.
3. Ask for user-global or current-workspace scope. A workspace profile replaces that harness's global profile wholesale and must contain all five keys.
4. Offer these actions:
   - Apply one model to **all five work tiers** (default-all).
   - Configure **each work tier individually**.
   - Review and validate the current mapping (read-only).
   - Remove the active workspace profile and reveal the global profile.
   - Refresh model suggestions.

Read-only review stops after reporting validation. Changes follow every gate below in order.

## Gated change workflow

1. **Acquire the active harness catalog**

   First create a unique, session-owned scratch directory outside `.10x-squad`; use it for every request, catalog, session, probe, and proposal file, and refuse to overwrite any pre-existing path. Acquire one current catalog for the active harness before accepting any new values. Follow the exact harness procedure in `references/model-resolution.md`. “Refresh model suggestions” means reacquire that harness catalog only; there is no frontier, documentation, or other-surface scan fallback. `Auto (copilot)` is excluded and banned. Stop if the harness does not return a reliable selectable list.

2. **Resolve every selected value**

   Every source, including a structured choice, reused session value, free text, and keep-current, is user intent requiring resolution against the catalog. Free text is `user intent`, never assumed to be an exact identifier. Invoke `node scripts/model-id-resolver.js resolve --input RESOLVE_REQUEST.json` for every selected value.

   Exact catalog matches pass through. Likely matches require affirmative confirmation: display the exact candidate, ask once, and set `confirmed: true` only after an affirmative response. For `ambiguous`, show only returned exact candidates; after the user chooses, resolve that chosen exact string again so the stored outcome is `exact`. For `no_match`, show the full selectable list and stop pending an exact choice or cancel. `banned` stops. Ambiguous and `no_match` results stop before preview/write; `banned` does too.

   Resolve all five tiers to `exact` or confirmed `likely` before constructing a proposal. Only exact active-catalog strings enter `assignments`; effort or reasoning words remain intent, not routing fields.

3. **Verify each unique resolved identifier**

   Put all five resolved selections in session state, then invoke `node scripts/model-id-resolver.js verification-targets --input SESSION.json`. Require exit 0, exactly five assignments, and its deduplicated `verification_targets`. Verification is deduplicated by unique identifier: probe each returned target exactly once with this exact prompt:

   `Reply with exactly MODEL_ROUTE_OK. Do not read files, write files, or invoke tools.`

   Add only raw harness observations to the session. Record `identity_observable` from the harness capability/result contract, never from a missing field. Every successful probe must explicitly provide `identity_observable: true` or `false`; a missing flag is a gate error. When true, `executed_model` is required. Missing `executed_model` alone must never be inferred as unobservable. Catalog membership alone is not verification and must still probe.

   A failed, unavailable, or policy-rejected launch hard-blocks. Observed substitution/mismatch or unavailability is a hard-block, including provider changes. Stop before writing.

4. **Build the gated profile**

   After all probes, run `node scripts/model-id-resolver.js build-profile --input SESSION.json` and require exit 0 with exactly one JSON object. Never manually assemble `assignments` or `model_checks`. The resolver maps observable, byte-equal requested/executed identity to `verified`/`dispatch_smoke_test`; a successful launch without an independent identity signal maps to `unverified`/`addressability_probe` and may proceed only with a loud warning. `original_input` is session-only and never stored.

5. **Preview before writing**

   Pass the `build-profile` stdout JSON unchanged as proposal input to `diff-profile`; use that same unchanged output for all later profile commands. `validate-profile` may perform a standalone validation. Show the stored-file change and resulting effective five-row mapping, distinguish verified from addressability-only entries, and ask for confirmation.

6. **Write**

   After confirmation, pass only the unchanged resolver-built proposal to `upsert-profile`. Invalid input leaves the prior file untouched.

7. **Prove the result**

   Run `resolve` again for all five tiers from saved configuration and report model, scope, and check status. Distinguish `verified` dispatch identity from addressability-only `unverified` evidence; never call the latter fully verified. Final success is forbidden while any tier is unresolved or unaddressable.

Cleanup runs unconditionally in a `finally-style` path on success, cancellation, hard-block/stop, error, or interruption. Remove only the session-owned scratch directory. Never place it under `.10x-squad` or commit it.

## Removal

Run `remove-profile --dry-run` first, show what changes (including whether the file would be deleted), confirm, then remove and re-run `resolve` for all five tiers to show the revealed global profile.

## Default-all behavior

“Apply one model to all five work tiers” asks for one model intent, resolves it, and copies that resolved selection into all five canonical session keys before verification. No `default`, flag, or inheritance rule is stored; the resulting profile always contains five explicit assignments.

## Routing invariants

- `auto` and `inherit` are invalid in any casing. Copilot Auto is never used at any level (squad invariant 12).
- Local/BYOK models are allowed only as exact addressable identifiers returned by the active harness. Endpoints and credentials are out of band; never store credentials in routing configuration.
- Cross-provider child dispatch remains unsupported without a dedicated compatibility test.
