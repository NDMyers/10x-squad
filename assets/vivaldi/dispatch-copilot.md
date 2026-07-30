## Model Routing

Work-tier → three-part profiles are user-configured per harness via the `10x-squad-configure-tiers` skill. Each profile contains one exact model, one reasoning choice, and one context choice. Persona skills carry no routing policy, and Vivaldi never chooses these values from memory, tables, or defaults — it resolves them. The user manually selects Vivaldi's own parent model in the harness; Copilot model Auto is banned for the parent session and every subagent dispatch, and an Auto parent session is user error. Runtime `auto` is a valid omission choice for reasoning/context: omit only the corresponding dispatch argument; it is not Copilot model Auto or parent inheritance.

**After TRIAGE and before the first subagent dispatch:**

1. Detect the active harness profile (`copilot-cli`, `copilot-vscode`, …). Never reuse another surface's identifiers.
2. Run the installed resolver with the task's work tier:

   ```bash
   node .github/skills/10x-squad-configure-tiers/scripts/model-tier-config.js resolve \
     --workspace-root "$PWD" \
     --harness <surface> \
     --tier <canonical-tier-key> \
     --json
   ```

   Canonical tier keys: `trivial`, `lite`, `standard_clear`, `standard_ambiguous`, `complex`.
3. Consume only the resolver's single-line stdout JSON as the resolved three-part work-tier profile (`{"ok":true, …, "model":"<exact-id>", "reasoning_effort":"<choice>", "context_tier":"<choice>", "check_status":…}`). Consume `model`, `reasoning_effort`, `context_tier`, and `check_status`; treat any missing field, nonzero exit, malformed JSON, or declined/unexecutable resolver invocation as a hard configuration failure. Do not parse precedence yourself, reinterpret configuration from prose, or improvise any profile value.
4. Announce the persona name, work tier and canonical key, active harness, exact model, reasoning choice, and context choice before every persona dispatch, including `auto`: **Routing to `<Persona>` — `<Work tier>` (`<canonical-key>`) [<harness>] — model `<exact-id>`; reasoning `<choice>`; context `<choice>`**.
5. Every persona dispatch always supplies the profile's exact resolved model explicitly as the dispatch `model` argument (Copilot CLI `task` tool `model`; VS Code `runSubagent` model parameter), together with the persona skill and permitted context slice.
   - If `reasoning_effort` is non-`auto`, pass its exact resolved value as the dispatch `reasoning_effort` argument; if it is `auto`, omit only that argument.
   - If `context_tier` is non-`auto`, pass its exact resolved value as the dispatch `context_tier` argument; if it is `auto`, omit only that argument.
   These omissions are independent: pass any non-`auto` sibling even when the other choice is `auto`. Announce and report `auto`, but never pass it as an argument. Never replace runtime `auto` with a maximum, default, inherited, or guessed value.
   If either configured non-`auto` runtime argument is unavailable or rejected by the active dispatch contract, hard-block before launch; never drop it or fall back to another value.
6. Confirm the executed model where the surface reports it (Copilot CLI: `subagent.started` / child turn events carry `model`). Any requested-versus-executed model mismatch hard-blocks the pipeline. Do not claim post-launch observability of reasoning or context identity; accepted dispatch arguments are the available evidence.

Every later persona dispatch for the same task uses the same resolved three-part profile — exact model, reasoning choice, and context choice — and must repeat the complete routing announcement. If the work tier is reclassified, re-run the resolver to re-resolve, then consume and re-announce `model`, `reasoning_effort`, and `context_tier` before the next dispatch; running children are not restarted.

**One-dispatch override:** the user may override any subset of `model`, `reasoning_effort`, and `context_tier` for one dispatch. A `model` override must be an exact, non-Auto identifier and is still passed explicitly. Announce the complete effective profile, apply the override once, and never store it. An explicit runtime override is allowed only when the active dispatch contract supports that argument; otherwise hard-block. An `auto` override must omit its corresponding runtime argument independently.

**Hard failure contract.** On missing/corrupt/incomplete configuration (resolver exit 2), missing harness profile (3), invalid tier (4), I/O failure (5), policy rejection, unavailable/rejected runtime arguments, provider mismatch, cost-ceiling substitution, or observed-model mismatch — stop and report: the active harness/surface; the work tier and canonical key; the requested three-part profile (`model`, `reasoning_effort`, and `context_tier`, using `<unresolved>` for any unresolved field); the reason; and the exact next action (run `/10x-squad-configure-tiers`, choose another value, or explicitly approve a one-dispatch override). Never silently use model Auto, inherit the parent, select a cheaper model, or substitute a "close" model.
