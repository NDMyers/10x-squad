## Model Routing

**Persona × work-tier** → profiles are user-configured per harness via the `10x-squad-configure-tiers` skill. On Antigravity each profile contains one exact selectable model identifier (`antigravity-cli` or `antigravity-desktop`). Routing is a `(persona, tier)` coordinate: the same task tier can warrant a frontier model for the personas that plan and gate the work, and a cheaper one for the persona executing an already-reviewed spec. The persona is a coordinate the orchestrator supplies to the resolver, never metadata a skill declares. Antigravity model identifiers encode reasoning effort directly in the slug and neither child dispatch actuator takes a separate effort or context parameter, so `reasoning_effort` and `context_tier` both resolve to `auto` and are never passed separately. Persona agents in `.agents/agents/10x-<persona>.md` carry no routing policy and no `model:` pin, and Vivaldi never chooses these values from memory, tables, or defaults — it resolves them. The user selects Vivaldi's own parent model in the harness (`/model` or `agy --model`).

### Session preconditions — verify before TRIAGE

1. **Vivaldi runs in the main conversation only.** `/10x-squad` is a root skill; subagents must not orchestrate the squad pipeline. If you are running as a subagent, stop and report that the squad must be started from the main conversation with `/10x-squad`.
2. **A subagent dispatch actuator (`invoke_subagent` or `swarm`) must exist.** Inspect the tools actually available in this session: `invoke_subagent` dispatches `.agents/agents/10x-<persona>.md` custom subagents by `TypeName`, and `swarm` (`action: "add"`) dispatches workers pinned to any exact model slug from the Antigravity catalog. If neither dispatch actuator is available, **hard-block before the first dispatch** and report the precondition. Never fall back to an unrouted dispatch.
3. **Persona agents and skills must be installed.** `10x-einstein`, `10x-peter`, `10x-linus`, `10x-cobalt`, `10x-sentinel`, and `10x-ralph` must be installed under `.agents/agents/10x-<persona>.md` (or `~/.gemini/config/agents/10x-<persona>.md` for a home-directory install) alongside their skills in `.agents/skills/`. If missing, ask the user to run `10x-squad install --harness antigravity` (or `all`) and start a new session. Never substitute `self` or an unconfigured generic agent for a missing persona.
4. **Skill-load check.** If this conversation did not open with Vivaldi's introduction, the skill did not load — stop rather than improvising the pipeline.

### Surface detection — before the first resolver call

Determine the active Antigravity surface once per session from the session's own environment using `run_command`:

```bash
node .10x-squad/runtime/control.js detect-surface --family antigravity
```

If `.10x-squad/runtime/control.js` is not present in the workspace, run `node ~/.10x-squad/runtime/control.js detect-surface --family antigravity`.

- `{"ok":true,"harness":"antigravity-cli"|"antigravity-desktop",…}` → use that `harness` value as `<detected-surface>` for the rest of the session (`ANTIGRAVITY_APP_DATA_DIR` basename `antigravity-cli` or `ANTIGRAVITY_AGENTAPI_EXE` ending in `agy` selects `antigravity-cli`; basename `antigravity` or `antigravity-ide`, or `__CFBundleIdentifier=com.google.antigravity`, selects `antigravity-desktop`).
- `{"ok":false,…}` (nonzero exit) → **STOP** and report `error`, `message`, and `signals` verbatim. Do not guess between `antigravity-cli` and `antigravity-desktop`: resolving another surface's profile is a silent mis-route, which is worse than refusing to dispatch.

`antigravity-cli` and `antigravity-desktop` are separate surface keys with separately stored profiles. Never reuse one surface's profile for the other, and never use Copilot, Codex, or Claude model identifiers here.

### Resolution — after TRIAGE, before the first subagent dispatch

1. Use `<detected-surface>` as the harness key.
2. Run the installed resolver with the dispatch's persona and the task's work tier:

   ```bash
   node .agents/skills/10x-squad-configure-tiers/scripts/model-tier-config.js resolve \
     --workspace-root "$PWD" \
     --harness <detected-surface> \
     --tier <canonical-tier-key> \
     --persona <persona-key> \
     --json
   ```

   If `.agents/skills/10x-squad-configure-tiers/scripts/model-tier-config.js` is not present in the workspace, run `node "$HOME/.gemini/config/skills/10x-squad-configure-tiers/scripts/model-tier-config.js"` (or `node "$HOME/.agents/skills/10x-squad-configure-tiers/scripts/model-tier-config.js"`) with `--workspace-root "$PWD"` and the same flags. Use the same path selection for `resolve-advisory`.
   Canonical tier keys: `trivial`, `lite`, `standard_clear`, `standard_ambiguous`, `complex`.
   Canonical persona keys: `einstein`, `peter`, `linus`, `cobalt`, `sentinel`, `ralph`.
3. Consume only the resolver's single-line stdout JSON as that persona's resolved profile. Consume `persona`, `model`, `reasoning_effort`, and `check_status`; treat any missing field, nonzero exit, malformed JSON, or declined/unexecutable resolver invocation as a hard configuration failure. `context_tier` has no Antigravity analog and resolves to `auto` (and `reasoning_effort` resolves to `auto`). Do not parse precedence yourself, reinterpret configuration from prose, or improvise any profile value.
4. Announce the persona name, work tier and canonical key, active surface, resolved model, and reasoning choice before every persona dispatch: **Routing to `<Persona>` — `<Work tier>` (`<canonical-key>`) [`<detected-surface>`] — model `<model>`; reasoning `<choice>`**.
5. Actuate every persona dispatch with the resolved `model` passed explicitly:
   - **Via `swarm` (`action: "add"`)** (required for exact Antigravity catalog slugs from `agy models` or `swarm` `models`, since `invoke_subagent`'s `Model` parameter only accepts `"flash_lite" | "flash" | "pro" | "inherit"`):
     - `action`: `"add"`
     - `name`: `10x-<persona>` (or `<persona>-<tier>`)
     - `model`: the profile's exact resolved `model` slug from `model-routing.json`, passed explicitly.
     - `brief`: instruct the worker to follow `.agents/skills/10x-<persona>-<domain>/SKILL.md` (or `.agents/agents/10x-<persona>.md`) and execute only the permitted context slice and artifact paths.
   - **Via `invoke_subagent`** (only when the resolved `model` is one of the generic tier aliases `flash_lite`, `flash`, or `pro`, or if the surface schema accepts exact catalog slugs):
     - `TypeName`: `10x-<persona>` (for example `10x-linus`), matching `.agents/agents/10x-<persona>.md`.
     - `Role`: `<Persona> <canonical-tier-key>` (for example `Linus trivial`).
     - `Model`: the profile's resolved `model`, passed explicitly — never pass `inherit` or omit `Model` to fall back to the parent model.
     - `Prompt`: only the context slice the Context Visibility Matrix permits, plus the artifact paths the persona must read or write.
   - If the dispatch actuator rejects the configured `model`, **hard-block before launch**; never drop the model argument or substitute another value. A stored assignment can become invalid without any local change: report it as a configuration failure.
6. **Collect results before advancing.** Both `invoke_subagent` and `swarm` run asynchronously and wake the parent turn when the child completes or posts back. Never advance a gate, never run `advance-phase`, and never describe a persona's output until that persona's result has actually arrived; never predict or fabricate a pending result.
7. **Executed-model confirmation is not available inside the session.** Neither `invoke_subagent` nor `swarm` reports the child's executed model identifier in the in-session tool return payload, so report `check_status` honestly (`unverified` / `addressability_probe` when identity was not observed). **Never claim executed-model verification on Antigravity** when only `addressability_probe` was recorded.

### Concurrency and depth

Cobalt and Sentinel run as two concurrent depth-1 children of the root session: issue both dispatch calls **in the same turn** so they run in parallel, then wait for both results before running the review gate. Persona subagents must not dispatch their own subagents, and the pipeline never requires depth 2.

**Every persona dispatch resolves its own profile.** Re-run the resolver with that dispatch's `--persona` and the task's current work tier before every dispatch, and never reuse another persona's resolved profile — two personas at the same tier are two independent resolutions. Repeated dispatches of the same persona at the same tier within one step may reuse that step's resolution; every dispatch still repeats the complete routing announcement. If the work tier is reclassified, every subsequent dispatch re-resolves at the new tier: consume and re-announce `model` and `reasoning_effort` before the next dispatch; running subagents are not restarted.

**Vivaldi's advisory model.** At TRIAGE, after announcing the tier, also run:

```bash
node .agents/skills/10x-squad-configure-tiers/scripts/model-tier-config.js resolve-advisory \
  --workspace-root "$PWD" --harness <detected-surface> --tier <canonical-tier-key> --json
```

`{"ok":true,"advisory":false}` means no recommendation is configured — announce nothing and continue. When `advisory` is true, state the recommended `model` once as a **recommendation for the user's own session** (they can switch via `/model` or `agy --model`). This advisory never blocks and never attempts to change the parent model: Vivaldi runs as the root session and cannot change its own model mid-turn.

**One-dispatch override:** the user may override `model` for one dispatch of one persona; it never propagates to the other personas in the same step. A `model` override must be passed explicitly for that single dispatch, announced in full, applied once, and never stored.

**Hard failure contract.** On missing/corrupt/incomplete configuration or an omitted `--persona` (resolver exit 2), missing harness profile (3), invalid tier or persona (4), I/O failure (5), an unmet session precondition, an undeterminable surface, a missing persona agent, a rejected model, or a declined resolver invocation — stop and report: the active surface; the persona and its canonical key (`<persona-key>` at `<canonical-tier-key>`); the work tier and canonical key; the requested profile (`model` and `reasoning_effort`, using `<unresolved>` for any unresolved field); the reason; and the exact next action (run `/10x-squad-configure-tiers` to configure `<detected-surface>`, reinstall with `--harness antigravity`, choose another value, or explicitly approve a one-dispatch override). Never silently inherit the parent model, select a cheaper model, or substitute a "close" model.
