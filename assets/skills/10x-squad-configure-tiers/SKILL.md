---
name: 10x-squad-configure-tiers
description: Use when a user asks to configure, review, or fix the exact model, reasoning effort, or context tier for a 10x Squad persona or work tier, or when Vivaldi reports missing or invalid model-routing configuration.
---

# Configure 10x Squad Work Tiers

Maps each **(persona, work tier)** pair to a profile for the active harness: six dispatchable personas (`einstein`, `peter`, `linus`, `cobalt`, `sentinel`, `ralph`) × five work tiers (`trivial`, `lite`, `standard_clear`, `standard_ambiguous`, `complex`) is a 6 × 5 matrix of 30 profiles. Each profile combines one exact, surface-native model with one `reasoning_effort` choice and one `context_tier` choice. Vivaldi resolves **each persona's own** three-part profile per dispatch; personas remain model-agnostic because the persona is a resolver coordinate, not skill metadata.

Thirty questions would be a hostile setup, so four entry paths of increasing granularity all produce the same fully explicit matrix. Most users should take **role lanes** — three questions.

Vivaldi itself gets an optional **advisory** row rather than an assignment: it always runs as the root session and cannot select its own model.

Use `scripts/model-tier-config.js` for configuration and `scripts/model-id-resolver.js` for model intent. See `references/config-format.md` for storage and `references/model-resolution.md` for the catalog, matching, probe, and session-file contracts. **Never edit `model-routing.json` directly**; the engine validates and writes atomically while preserving unrelated harness profiles.

## When this skill runs

- The user invokes `/10x-squad-configure-tiers` or asks to view or change assignments.
- Vivaldi reports missing or invalid routing configuration (exit 2/3 from `resolve`) and offers this skill.

It never runs automatically during a healthy pipeline.

## Start the conversation

1. Detect the active harness (`copilot-vscode`, `copilot-cli`, `codex-cli`, `codex-app`, …). If uncertain, ask once. Never guess or reuse another surface's identifier namespace — Copilot and Codex model identifiers are not interchangeable, and the two Codex surfaces are separate from each other because their spawnable sets drift independently.
2. Show the current effective mapping by running `resolve` for every persona and tier (30 local invocations, no dispatches) plus `resolve-advisory` for all five tiers. Display model, reasoning, context, check status, and source scope as a persona × tier table; collapse identical persona rows for readability and say which personas each collapsed row covers. Render the Vivaldi advisory visually separate and explicitly labelled as advisory. Show actionable resolution errors.
3. Ask for user-global or current-workspace scope. A workspace profile replaces that harness's global profile wholesale and must contain all five keys.
4. Offer these actions:
   - **Role lanes (recommended, 3 answers)** — one model plus a tier-stepped effort curve per lane: Thinker (`einstein`, `peter`), Builder (`linus`, `ralph`), Reviewer (`cobalt`, `sentinel`).
   - **Default-all (1 answer)** — apply one model + reasoning + context to every persona and every work tier.
   - **Per work tier (5 answers)** — one profile per work tier, broadcast across all six personas.
   - **Full matrix (30 answers)** — configure each persona × work tier cell individually.
   - Optionally set or clear Vivaldi's advisory model per work tier.
   - Review and validate the current mapping (read-only).
   - Remove the active workspace profile and reveal the global profile.
   - Refresh model suggestions.

   Suggested starting effort curve for role lanes, offered for one-keystroke acceptance and freely editable — the squad stores no default of its own, so these values only ever reach configuration because the user accepted them:

   | Lane | trivial | lite | standard_clear | standard_ambiguous | complex |
   |---|---|---|---|---|---|
   | Thinker | `auto` | `low` | `medium` | `high` | highest the model supports |
   | Builder | `auto` | `auto` | `low` | `medium` | `medium` |
   | Reviewer | `low` | `medium` | `high` | `high` | `high` |

   The rationale to state when offering it: thinkers plan and see blast radius, reviewers gate the work, and a builder working from a good spec and a good review does not need frontier reasoning even on a complex task.

Read-only review stops after reporting validation. Changes follow every gate below in order.

## Gated change workflow

1. **Acquire the active harness catalog**

   Create a unique, session-owned scratch directory outside `.10x-squad`. Bind absolute `SKILL_ROOT` (the directory containing this `SKILL.md`) and absolute `SESSION_SCRATCH` (that scratch directory) in the command environment. Bind selected `ACTIVE_HARNESS` to the active harness, selected `TARGET_SCOPE` to `global|workspace`, and absolute `WORKSPACE_ROOT` to the current workspace root. At initial creation, refuse to overwrite any pre-existing path; never overwrite a path not created and owned by this session. Exclusively create every fixed scratch path on first use. The session may later update only its owned `SESSION.json` to add probe observations. Every transient, plan, and proposal file stays under `SESSION_SCRATCH`. Never rely on the current working directory. Acquire one current catalog for the active harness before accepting any new values. Follow the exact harness procedure in `references/model-resolution.md`. “Refresh model suggestions” means reacquire that harness catalog only; there is no frontier, documentation, or other-surface scan fallback. `Auto (copilot)` is excluded and banned. Stop if the harness does not return a reliable selectable list.

2. **Resolve every selected value**

   Every source, including a structured choice, reused session value, free text, and keep-current, is user intent requiring resolution against the catalog. Free text is `user intent`, never assumed to be an exact identifier. Invoke `node "$SKILL_ROOT/scripts/model-id-resolver.js" resolve --input "$SESSION_SCRATCH/RESOLVE_REQUEST.json"` for every selected value.

   Exact catalog matches pass through. Likely matches require affirmative confirmation: display the exact candidate, ask once, and set `confirmed: true` only after an affirmative response. For `ambiguous`, show only returned exact candidates; after the user chooses, resolve that chosen exact string again so the stored outcome is `exact`. For `no_match`, show the full selectable list and stop pending an exact choice or cancel. `banned` stops. Ambiguous and `no_match` results stop before preview/write; `banned` does too.

   Resolve **distinct model intents only** — one for default-all, three for role lanes, five for per-tier, up to thirty for the full matrix. Expansion copies one resolution across the cells it covers; never re-resolve the same intent per cell. Retain the full resolver result and offer an explicit or `auto` choice for reasoning and context as sibling fields. The accepted choices are per harness: `copilot-cli` reasoning `auto|low|medium|high|xhigh` and context `auto|default|long_context`; `codex-cli` and `codex-app` reasoning `auto|low|medium|high|xhigh|max|ultra` and context `auto` only; other harnesses `auto`/`auto` only. On either Codex surface, an explicit `reasoning_effort` must also be in the chosen model's `supported_reasoning_levels` (from `codex debug models`) — confirm this before proposing, since the harness will otherwise reject it at spawn. Near matches and different casing require confirmation rather than silent normalization. Thinking words in free-form model intent affect model matching only; they never choose a runtime setting.

   `auto` is a runtime-setting value only. It means omit that corresponding dispatch argument and let the active harness use its adaptive or default behavior. Reasoning and context omission are independent. Runtime `auto` is not Copilot model Auto and is not parent model inheritance.

   Explicit runtime settings are supported for `copilot-cli` (reasoning and context) and for `codex-cli` and `codex-app` (reasoning only; `context_tier` is `auto`-only, as the Codex spawn tool has no context parameter). On `copilot-vscode` or an unknown harness, `auto`/`auto` remains allowed; if a setting falls outside its harness's accepted vocabulary, hard-stop before any probe, preview, or write. Do not create a proposal or claim partial support.

   Resolve every distinct model intent to `exact` or confirmed `likely` before constructing the plan. Only exact active-catalog strings enter `assignments`. Every new proposal must contain all thirty `dispatch_settings` entries, each with both canonical fields; only `build-profile` may construct that proposal.

   **Vivaldi's advisory (optional).** Ask once whether to record a recommended parent model per work tier. Resolve those intents against the harness's **parent** catalog, not its spawn catalog, and pass it as `parent_catalog`; the spawn set is strictly smaller and would wrongly reject a parent-only model. Advisory entries carry `model` and `reasoning_effort` only, are never probed, and never produce a `model_checks` entry. Skipping is a normal outcome.

3. **Expand the chosen path into the full matrix**

   Record the chosen entry path as a plan at `$SESSION_SCRATCH/PLAN.json` by exclusive creation, then invoke `node "$SKILL_ROOT/scripts/model-id-resolver.js" expand-selections --input "$SESSION_SCRATCH/PLAN.json"`. Require exit 0 and exactly one JSON object carrying all six canonical persona keys, each with all five canonical tier keys. Save those exact stdout bytes as `$SESSION_SCRATCH/SESSION.json`.

   `expand-selections` is the **sole selections builder**, exactly as `build-profile` is the sole proposal builder. Never hand-assemble, edit, or top up the expanded matrix. No lane, role, or mode marker survives into the session or any downstream artifact.

4. **Verify each unique resolved tuple**

   Invoke `node "$SKILL_ROOT/scripts/model-id-resolver.js" verification-targets --input "$SESSION_SCRATCH/SESSION.json"`. Require exit 0, six persona rows of five assignments each, the matching settings matrix, and its deduplicated `verification_targets`. Verification is deduplicated by the complete execution tuple `(model, reasoning_effort, context_tier)`, not by model alone and not by cell — the tuple is persona independent, so six personas sharing one model and effort still cost exactly one probe.

   Report the number of unique verification targets before the first probe. When it exceeds five, state the count explicitly and obtain confirmation before probing.

   For each returned `target`, invoke one harmless probe keyed as `probes[target.id]`. Supply exactly `target.dispatch_arguments` as the model/runtime dispatch arguments and this exact prompt:

   `Reply with exactly MODEL_ROUTE_OK. Do not read files, write files, or invoke tools.`

   Never reconstruct `dispatch_arguments`, and never add an omitted `auto` field. Copy those exact arguments to `requested_arguments` alongside the raw harness observation. Also record `requested_model`, `ok`, `identity_observable`, `checked_at`, and only raw observed `executed_model` or `error` values. Record `identity_observable` from the harness capability/result contract, never from a missing field. Every successful probe must explicitly provide `identity_observable: true` or `false`; a missing flag is a gate error. When true, `executed_model` is required. Missing `executed_model` alone must never be inferred as unobservable. Catalog membership alone is not verification and must still probe.

   A failed, unavailable, or policy-rejected launch hard-blocks. Observed substitution/mismatch or unavailability is a hard-block, including provider changes. Stop before writing.

5. **Build the gated profile**

   After all probes, run `node "$SKILL_ROOT/scripts/model-id-resolver.js" build-profile --input "$SESSION_SCRATCH/SESSION.json"` and require exit 0 with exactly one JSON object. Never manually assemble or modify `assignments`, `dispatch_settings`, `advisory`, or `model_checks`; `build-profile` is the sole proposal builder. A configured advisory is passed through to `profile.advisory` unprobed. The resolver maps observable, byte-equal requested/executed identity to `verified`/`dispatch_smoke_test`; a successful launch without an independent identity signal maps to `unverified`/`addressability_probe` and may proceed only with a loud warning. `original_input` is session-only and never stored.

6. **Preview before writing**

   Save the exact `build-profile` stdout bytes by exclusive creation at `$SESSION_SCRATCH/PROPOSAL.json`. Pass that unchanged JSON as proposal input to `diff-profile`; use the same unchanged file for all later profile commands. `validate-profile` may perform a standalone validation. Show the stored-file change and resulting effective model + reasoning + context mapping, distinguish verified from addressability-only entries, and ask for confirmation.

   Use the selected harness and scope bindings. Always pass absolute `WORKSPACE_ROOT`, including for global scope, so effective output can honor workspace precedence. Run:

   `node "$SKILL_ROOT/scripts/model-tier-config.js" diff-profile --input "$SESSION_SCRATCH/PROPOSAL.json" --scope "$TARGET_SCOPE" --workspace-root "$WORKSPACE_ROOT" --harness "$ACTIVE_HARNESS"`

7. **Write**

   After confirmation, pass only the unchanged resolver-built proposal to `upsert-profile`. A successful write uses schema v3, and broadcast-upgrades any retained schema-v1 or schema-v2 profile in the same file so the result passes its own validator. Invalid input leaves the prior file untouched.

   `node "$SKILL_ROOT/scripts/model-tier-config.js" upsert-profile --input "$SESSION_SCRATCH/PROPOSAL.json" --scope "$TARGET_SCOPE" --workspace-root "$WORKSPACE_ROOT" --harness "$ACTIVE_HARNESS"`

8. **Prove the result**

   Run `resolve` again for every persona and tier from saved configuration, plus `resolve-advisory` for all five tiers, and report model, reasoning, context, scope, and check status. Schema-v1 profiles without `dispatch_settings` resolve as `auto`/`auto`; schema-v1 and schema-v2 profiles broadcast one tier row to every persona and carry no advisory; successful configure writes use schema v3. Distinguish `verified` dispatch identity from addressability-only `unverified` evidence; never call the latter fully verified. Final success is forbidden while any cell is unresolved or unaddressable.

Cleanup runs unconditionally in a `finally-style` path on success, cancellation, hard-block/stop, error, or interruption. Remove only the session-owned scratch directory. Never place it under `.10x-squad` or commit it.

## Removal

Run `remove-profile --dry-run` first, show what changes (including whether the file would be deleted), confirm, then remove and re-run `resolve` across the matrix to show the revealed global profile.

## Entry paths

All four paths ask different numbers of questions and produce the identical fully explicit 30-cell proposal.

- **Role lanes (recommended)** asks for three model intents plus a tier-stepped effort curve — and optional context curve — per lane. Thinker covers `einstein` and `peter`, Builder covers `linus` and `ralph`, Reviewer covers `cobalt` and `sentinel`. Every persona belongs to exactly one lane.
- **Default-all** asks for one model intent plus one explicit-or-`auto` reasoning choice and one explicit-or-`auto` context choice, applied to every persona and every work tier.
- **Per work tier** asks for one complete profile per work tier and broadcasts each across all six personas — the pre-matrix behavior, preserved.
- **Full matrix** asks for each of the thirty cells individually.

**No inheritance rule, lane marker, role marker, or entry-path marker is ever stored.** Lanes are a grouping for input only; `expand-selections` materializes explicit per-persona cells before anything is verified or written.

## Routing invariants

- **Personas stay model-agnostic.** The persona is a coordinate Vivaldi passes to the resolver, never metadata inside a persona skill; no persona file gains a model, effort, or frontmatter pin.
- **Vivaldi's advisory is never actuated.** It is a recommendation for the root session, resolved against the parent catalog, never probed, and never able to block a pipeline. An absent advisory is a normal configuration.
- Model `auto` and `inherit` are invalid in any casing. Copilot model Auto is never used at any level (squad invariant 12). Runtime-setting `auto` has only the independent omission meaning defined above.
- Local/BYOK models are allowed only as exact addressable identifiers returned by the active harness. Endpoints and credentials are out of band; never store credentials in routing configuration.
- Cross-provider child dispatch remains unsupported without a dedicated compatibility test.
- Never hardcode selectable model names or identifiers; always use the unchanged live catalog procedure. Treat `long_context` as the harness's named tier and never promise a numeric context size.
