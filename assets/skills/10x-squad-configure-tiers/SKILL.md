---
name: 10x-squad-configure-tiers
description: Use when a user asks to configure, review, or fix the exact model, reasoning effort, or context tier for 10x Squad work tiers, or when Vivaldi reports missing or invalid model-routing configuration.
---

# Configure 10x Squad Work Tiers

Maps `trivial`, `lite`, `standard_clear`, `standard_ambiguous`, and `complex` to five work-tier profiles for the active harness. Each work-tier profile combines one exact, surface-native model with one `reasoning_effort` choice and one `context_tier` choice. Vivaldi resolves the same three-part profile for every persona dispatch; personas remain model-agnostic.

Use `scripts/model-tier-config.js` for configuration and `scripts/model-id-resolver.js` for model intent. See `references/config-format.md` for storage and `references/model-resolution.md` for the catalog, matching, probe, and session-file contracts. **Never edit `model-routing.json` directly**; the engine validates and writes atomically while preserving unrelated harness profiles.

## When this skill runs

- The user invokes `/10x-squad-configure-tiers` or asks to view or change assignments.
- Vivaldi reports missing or invalid routing configuration (exit 2/3 from `resolve`) and offers this skill.

It never runs automatically during a healthy pipeline.

## Start the conversation

1. Detect the active harness (`copilot-vscode`, `copilot-cli`, …). If uncertain, ask once. Never guess or reuse another surface's identifier namespace.
2. Show the current effective mapping by running `resolve` for all five tiers and displaying model, reasoning, context, check status, and source scope in a five-row table. Show actionable resolution errors.
3. Ask for user-global or current-workspace scope. A workspace profile replaces that harness's global profile wholesale and must contain all five keys.
4. Offer these actions:
   - Apply one model + reasoning + context profile to **all five work tiers** (default-all).
   - Configure **each work tier individually**, including its model, reasoning, and context.
   - Review and validate the current mapping (read-only).
   - Remove the active workspace profile and reveal the global profile.
   - Refresh model suggestions.

Read-only review stops after reporting validation. Changes follow every gate below in order.

## Gated change workflow

1. **Acquire the active harness catalog**

   Create a unique, session-owned scratch directory outside `.10x-squad`. Bind absolute `SKILL_ROOT` (the directory containing this `SKILL.md`) and absolute `SESSION_SCRATCH` (that scratch directory) in the command environment. At initial creation, refuse to overwrite any pre-existing path; never overwrite a path not created and owned by this session. Exclusively create every fixed scratch path on first use. The session may later update only its owned `SESSION.json` to add probe observations. Every transient and proposal file stays under `SESSION_SCRATCH`. Never rely on the current working directory. Acquire one current catalog for the active harness before accepting any new values. Follow the exact harness procedure in `references/model-resolution.md`. “Refresh model suggestions” means reacquire that harness catalog only; there is no frontier, documentation, or other-surface scan fallback. `Auto (copilot)` is excluded and banned. Stop if the harness does not return a reliable selectable list.

2. **Resolve every selected value**

   Every source, including a structured choice, reused session value, free text, and keep-current, is user intent requiring resolution against the catalog. Free text is `user intent`, never assumed to be an exact identifier. Invoke `node "$SKILL_ROOT/scripts/model-id-resolver.js" resolve --input "$SESSION_SCRATCH/RESOLVE_REQUEST.json"` for every selected value.

   Exact catalog matches pass through. Likely matches require affirmative confirmation: display the exact candidate, ask once, and set `confirmed: true` only after an affirmative response. For `ambiguous`, show only returned exact candidates; after the user chooses, resolve that chosen exact string again so the stored outcome is `exact`. For `no_match`, show the full selectable list and stop pending an exact choice or cancel. `banned` stops. Ambiguous and `no_match` results stop before preview/write; `banned` does too.

   For each tier, retain the full resolver result under `selection.resolution`, then offer an explicit or `auto` choice for reasoning and context as sibling fields. The canonical reasoning choices are `reasoning_effort: auto|low|medium|high|xhigh`; the canonical context choices are `context_tier: auto|default|long_context`. Near matches and different casing require confirmation rather than silent normalization. Thinking words in free-form model intent affect model matching only; they never choose a runtime setting.

   `auto` is a runtime-setting value only. It means omit that corresponding dispatch argument and let the active harness use its adaptive or default behavior. Reasoning and context omission are independent. Runtime `auto` is not Copilot model Auto and is not parent model inheritance.

   Explicit runtime settings are supported only for `copilot-cli`. On `copilot-vscode` or an unknown harness, `auto`/`auto` remains allowed; if either setting is explicit, hard-stop before any probe, preview, or write. Do not create a proposal or claim partial support.

   Resolve all five models to `exact` or confirmed `likely` before constructing session state. Only exact active-catalog strings enter `assignments`. Every new proposal must contain all five `dispatch_settings` entries, each with both canonical fields; only `build-profile` may construct that proposal.

3. **Verify each unique resolved tuple**

   Put all five complete selections in session state, exclusively create `$SESSION_SCRATCH/SESSION.json`, then invoke `node "$SKILL_ROOT/scripts/model-id-resolver.js" verification-targets --input "$SESSION_SCRATCH/SESSION.json"`. Require exit 0, exactly five assignments, exactly five settings entries, and its deduplicated `verification_targets`. Verification is deduplicated by the complete execution tuple `(model, reasoning_effort, context_tier)`, not by model alone.

   For each returned `target`, invoke one harmless probe keyed as `probes[target.id]`. Supply exactly `target.dispatch_arguments` as the model/runtime dispatch arguments and this exact prompt:

   `Reply with exactly MODEL_ROUTE_OK. Do not read files, write files, or invoke tools.`

   Never reconstruct `dispatch_arguments`, and never add an omitted `auto` field. Copy those exact arguments to `requested_arguments` alongside the raw harness observation. Also record `requested_model`, `ok`, `identity_observable`, `checked_at`, and only raw observed `executed_model` or `error` values. Record `identity_observable` from the harness capability/result contract, never from a missing field. Every successful probe must explicitly provide `identity_observable: true` or `false`; a missing flag is a gate error. When true, `executed_model` is required. Missing `executed_model` alone must never be inferred as unobservable. Catalog membership alone is not verification and must still probe.

   A failed, unavailable, or policy-rejected launch hard-blocks. Observed substitution/mismatch or unavailability is a hard-block, including provider changes. Stop before writing.

4. **Build the gated profile**

   After all probes, run `node "$SKILL_ROOT/scripts/model-id-resolver.js" build-profile --input "$SESSION_SCRATCH/SESSION.json"` and require exit 0 with exactly one JSON object. Never manually assemble or modify `assignments`, `dispatch_settings`, or `model_checks`; `build-profile` is the sole proposal builder. The resolver maps observable, byte-equal requested/executed identity to `verified`/`dispatch_smoke_test`; a successful launch without an independent identity signal maps to `unverified`/`addressability_probe` and may proceed only with a loud warning. `original_input` is session-only and never stored.

5. **Preview before writing**

   Save the exact `build-profile` stdout bytes by exclusive creation at `$SESSION_SCRATCH/PROPOSAL.json`. Pass that unchanged JSON as proposal input to `diff-profile`; use the same unchanged file for all later profile commands. `validate-profile` may perform a standalone validation. Show the stored-file change and resulting effective model + reasoning + context mapping, distinguish verified from addressability-only entries, and ask for confirmation.

   For the executable Copilot CLI workspace path, bind absolute `WORKSPACE_ROOT` and run:

   `node "$SKILL_ROOT/scripts/model-tier-config.js" diff-profile --input "$SESSION_SCRATCH/PROPOSAL.json" --scope workspace --workspace-root "$WORKSPACE_ROOT" --harness copilot-cli`

6. **Write**

   After confirmation, pass only the unchanged resolver-built proposal to `upsert-profile`. A successful write uses schema v2. Invalid input leaves the prior file untouched.

   `node "$SKILL_ROOT/scripts/model-tier-config.js" upsert-profile --input "$SESSION_SCRATCH/PROPOSAL.json" --scope workspace --workspace-root "$WORKSPACE_ROOT" --harness copilot-cli`

7. **Prove the result**

   Run `resolve` again for all five tiers from saved configuration and report model, reasoning, context, scope, and check status. Schema-v1 profiles without `dispatch_settings` resolve as `auto`/`auto`; successful configure writes use schema v2. Distinguish `verified` dispatch identity from addressability-only `unverified` evidence; never call the latter fully verified. Final success is forbidden while any tier is unresolved or unaddressable.

Cleanup runs unconditionally in a `finally-style` path on success, cancellation, hard-block/stop, error, or interruption. Remove only the session-owned scratch directory. Never place it under `.10x-squad` or commit it.

## Removal

Run `remove-profile --dry-run` first, show what changes (including whether the file would be deleted), confirm, then remove and re-run `resolve` for all five tiers to show the revealed global profile.

## Default-all behavior

“Apply one profile to all five work tiers” asks for one model intent plus one explicit-or-`auto` reasoning choice and one explicit-or-`auto` context choice. Resolve the model, then copy the complete selection into all five canonical session keys before verification. No assignment default, flag, or inheritance rule is stored; the resulting proposal always contains five explicit assignments and five explicit settings entries.

## Routing invariants

- Model `auto` and `inherit` are invalid in any casing. Copilot model Auto is never used at any level (squad invariant 12). Runtime-setting `auto` has only the independent omission meaning defined above.
- Local/BYOK models are allowed only as exact addressable identifiers returned by the active harness. Endpoints and credentials are out of band; never store credentials in routing configuration.
- Cross-provider child dispatch remains unsupported without a dedicated compatibility test.
- Never hardcode selectable model names or identifiers; always use the unchanged live catalog procedure. Treat `long_context` as the harness's named tier and never promise a numeric context size.
