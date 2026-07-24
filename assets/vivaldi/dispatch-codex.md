## Model Routing

Work-tier → profiles are user-configured per harness via the `10x-squad-configure-tiers` skill. On Codex each profile contains one exact spawnable model and one reasoning choice. `context_tier` has no Codex analog: it is always `auto` and is never passed. Persona skills carry no routing policy, and Vivaldi never chooses these values from memory, tables, or defaults — it resolves them. The user manually selects Vivaldi's own parent model in the harness. **The parent model set and the spawnable child model set are different on this surface** — never infer one from the other, and never assume a model is dispatchable because the parent session runs on it.

### Session preconditions — verify before TRIAGE

1. **Vivaldi runs at the root session only.** Codex has no flag that boots the primary session as a custom agent, so Vivaldi is always a skill invoked at the root. Spawned agents cannot reliably spawn their own children (`max_depth` defaults to 1). If you determine you are running as a spawned agent, stop and report that the squad must be started from the root session.
2. **`multi_agent_v2` must be enabled.** The `spawn_agent` `model` and `reasoning_effort` parameters — the squad's routing actuator — come from that feature, and it ships disabled. Start the session with `codex --enable multi_agent_v2`, or enable it in config. If `spawn_agent` is unavailable, or is available without both parameters, **hard-block before the first dispatch** and report the precondition. Never fall back to an unrouted dispatch.
3. **Skill-load check.** If this session did not open with Vivaldi's introduction, the skill did not load — stop and restart rather than improvising the pipeline.

### Resolution — after TRIAGE, before the first subagent dispatch

1. Detect the active harness profile (`codex-cli`, …). Never reuse another surface's identifiers; Copilot model names are not valid here.
2. Run the installed resolver with the task's work tier:

   ```bash
   node .agents/skills/10x-squad-configure-tiers/scripts/model-tier-config.js resolve \
     --workspace-root "$PWD" \
     --harness codex-cli \
     --tier <canonical-tier-key> \
     --json
   ```

   Canonical tier keys: `trivial`, `lite`, `standard_clear`, `standard_ambiguous`, `complex`.
3. Consume only the resolver's single-line stdout JSON as the resolved work-tier profile. Consume `model`, `reasoning_effort`, and `check_status`; treat any missing field, nonzero exit, malformed JSON, or declined/unexecutable resolver invocation as a hard configuration failure. `context_tier` resolves to `auto` on this surface and is never passed to a dispatch. Do not parse precedence yourself, reinterpret configuration from prose, or improvise any profile value.
4. Announce the persona name, work tier and canonical key, active harness, exact model, and reasoning choice before every persona dispatch, including `auto`: **Routing to `<Persona>` — `<Work tier>` (`<canonical-key>`) [codex-cli] — model `<exact-id>`; reasoning `<choice>`**.
5. Every persona dispatch always supplies the profile's exact resolved model explicitly as the `spawn_agent` `model` argument, together with the persona skill invocation and the permitted context slice.
   - If `reasoning_effort` is non-`auto`, pass its exact resolved value as the `spawn_agent` `reasoning_effort` argument; if it is `auto`, omit only that argument. Announce and report `auto`, but never pass it. Never replace runtime `auto` with a maximum, default, inherited, or guessed value.
   - **`spawn_agent` has no agent-name or `agent_type` parameter.** Persona identity is carried entirely in the `message` payload: the explicit persona skill invocation (for example `$10x-linus-build`) plus the context slice the Context Visibility Matrix permits. Do not rely on `.codex/agents/*.toml` definitions — they are not addressable dispatch targets.
   - Use a lowercase `snake_case` `task_name` — `<persona>_<canonical-tier-key>`, e.g. `linus_trivial` — so the agent tree stays readable; `spawn_agent` rejects hyphens and uppercase in `task_name`. Collect the result with `wait_agent`.
   - If the configured model or reasoning effort is rejected by `spawn_agent`, hard-block before launch; never drop the argument or fall back to another value. Rejections are loud and pre-launch — they enumerate the accepted set, which is the surface's authoritative availability source.
6. **Executed-model confirmation is not available on this surface.** `spawn_agent` returns only `{"task_name": …}`, `wait_agent` returns only completion status, `list_agents` returns only name and status, and the event stream carries no model field. Accepted dispatch arguments are the only evidence. **Never claim executed-model verification on Codex**, and never present an addressability success as identity proof. The pre-launch rejection of an invalid model is the backstop that replaces post-launch confirmation.

### Concurrency and depth

Cobalt and Sentinel run as two concurrent depth-1 children of the root session. Respect the session's `max_concurrent_threads_per_session` cap; if a spawn is refused for capacity, wait and retry rather than collapsing the two reviewers into one context. Persona children must not spawn their own subagents — `max_depth` defaults to 1, and the pipeline never requires depth 2.

Every later persona dispatch for the same task uses the same resolved profile — exact model and reasoning choice — and must repeat the complete routing announcement. If the work tier is reclassified, re-run the resolver to re-resolve, then consume and re-announce `model` and `reasoning_effort` before the next dispatch; running children are not restarted.

**One-dispatch override:** the user may override `model` and/or `reasoning_effort` for one dispatch. A `model` override must be an exact, spawnable identifier and is still passed explicitly. Announce the complete effective profile, apply the override once, and never store it. An `auto` override omits its corresponding argument.

**Hard failure contract.** On missing/corrupt/incomplete configuration (resolver exit 2), missing harness profile (3), invalid tier (4), I/O failure (5), an unmet session precondition, a rejected model or reasoning effort, or a declined resolver invocation — stop and report: the active harness/surface; the work tier and canonical key; the requested profile (`model` and `reasoning_effort`, using `<unresolved>` for any unresolved field); the reason; and the exact next action (run `/10x-squad-configure-tiers`, enable `multi_agent_v2`, choose another value, or explicitly approve a one-dispatch override). Never silently inherit the parent model, select a cheaper model, or substitute a "close" model.
