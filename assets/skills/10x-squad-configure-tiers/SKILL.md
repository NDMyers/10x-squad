---
name: 10x-squad-configure-tiers
description: View or change which exact model each 10x Squad work tier dispatches on. Use when the user asks to configure, review, or fix squad model assignments, or when Vivaldi reports missing/invalid model-routing configuration. Assigns one model to all five work tiers or each tier individually, per harness, at workspace or user-global scope.
---

# Configure 10x Squad Work Tiers

Maps the squad's five work-complexity tiers — `trivial`, `lite`, `standard_clear`, `standard_ambiguous`, `complex` — to exact, surface-native model identifiers for the active harness. Vivaldi resolves every persona dispatch through this configuration; personas stay model-agnostic.

All reads and writes go through the bundled engine, `scripts/model-tier-config.js` (schema, precedence, and exit codes: `references/config-format.md`). **Never edit `model-routing.json` directly** — the engine validates and writes atomically, and preserves other harness profiles.

## When this skill runs

- The user invokes `/10x-squad-configure-tiers`.
- The user asks to view or change squad model assignments.
- Vivaldi hit missing/invalid routing configuration (exit 2/3 from `resolve`) and offered this skill.

It never runs automatically during a healthy pipeline.

## Conversation flow

1. **Detect the active harness/surface** (`copilot-vscode`, `copilot-cli`, …). If uncertain, ask once — never guess an identifier namespace; VS Code and CLI identifiers are not interchangeable.
2. **Show the current effective mapping**: run `resolve` for each of the five tier keys and display a five-row table with its source scope (workspace or global). If resolution fails, show the actionable error instead.
3. **Ask for scope**: user-global or current workspace. A workspace save replaces that harness's global profile wholesale for this workspace (no per-key merge; the engine requires a complete five-key profile either way).
4. **Offer actions**:
   - Apply one model to **all five work tiers** (default-all).
   - Configure **each work tier individually**.
   - Review and validate the current mapping (read-only).
   - Remove the active workspace profile (reveals the global profile).
   - Refresh model suggestions.
5. **Model selection** — present sections in this order, using the harness's structured choice UI when available and numbered choices otherwise; free text is always available:
   1. **Verified available in this harness** (from `model_checks` with `status: "verified"`, or a current harness catalog check).
   2. **Other current candidates** from an optional official/frontier scan — clearly marked *unverified here*. Prefer current official harness/provider sources; public benchmark evidence may be summarized but must carry its date and source, and must **never auto-select** a model. A failed or offline scan must not block manual configuration — fall through to free text.
   3. **Exact free-text model identifier** — preserved byte-for-byte, visibly marked unverified until the active harness verifies it.
   4. **Keep current value**, when one exists.
6. **Reuse models already entered** this session so individual mode never repeats discovery five times.
7. **Preview before writing**: build the proposal file (five `assignments`, optional `model_checks`) and run `diff-profile` — show both the stored-file change and the resulting effective five-row mapping.
8. **Ask for confirmation.**
9. **Write**: `upsert-profile` (validates first; `validate-profile` is available for a standalone check). Invalid input leaves the prior file untouched.
10. **Prove the result**: run `resolve` again for all five tiers from the saved configuration and report the effective mapping and its scope.

For removal, run `remove-profile --dry-run` first, show what changes (including whether the file itself would be deleted), confirm, then remove and re-resolve to show the revealed global profile.

## Default-all behavior

"Apply one model to all five work tiers" asks for **one exact model identifier** and expands it into the five canonical keys before validation. No `default` value, flag, or inheritance rule is ever stored — the file always contains five explicit assignments.

## Rules that protect the routing contract

- Assignment values must be exact executable identifiers for the active surface. `auto` and `inherit` are banned in any casing — Copilot Auto is never used, at any level (squad invariant 12); the engine rejects them.
- Catalog or documentation presence does not prove executability: mark a model `verified` only after an explicit subagent capability signal or an observable dispatch smoke test **on this surface**. Otherwise it stays visibly `unverified`.
- Before substantive work on an unverified value, preflight it when the harness offers a harmless check; if only a dispatch can verify it, use a no-side-effect child probe and compare requested versus executed model where observable.
- If the harness cannot address the identifier, changes provider unexpectedly, substitutes another model, or cannot make execution identity auditable — stop and report the surface, tier, configured ID, and this skill as the fix. Never continue on a "close" model.
- A local/BYOK model is configurable only as an exact addressable identifier already exposed by the active harness/provider; endpoints and credentials are out of band and never stored here. Cross-provider child dispatch is unsupported until a dedicated compatibility test proves it.
- Never write credentials into routing configuration; the engine rejects credential-shaped fields.
