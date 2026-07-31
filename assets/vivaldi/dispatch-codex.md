## Model Routing

**Persona × work-tier** → profiles are user-configured per harness via the `10x-squad-configure-tiers` skill. On Codex each profile contains one exact spawnable model and one reasoning choice. Routing is a `(persona, tier)` coordinate: the same task tier can warrant a frontier model at high effort for the personas that plan and gate the work, and a cheaper one for the persona executing an already-reviewed spec. The persona is a coordinate the orchestrator supplies to the resolver, never metadata a skill declares. `context_tier` has no Codex analog: it is always `auto` and is never passed. Persona skills carry no routing policy, and Vivaldi never chooses these values from memory, tables, or defaults — it resolves them. The user manually selects Vivaldi's own parent model in the harness. **The parent model set and the spawnable child model set are different on this surface** — never infer one from the other, and never assume a model is dispatchable because the parent session runs on it.

**Two things vary independently on Codex, and conflating them produces a wrong dispatch:**

- **Which surface is running** (`codex-cli` or `codex-app`) determines the *harness key* the resolver is called with. Each surface has its own stored profile; identifiers are never shared.
- **Which spawn toolset the session exposes** (v1 or v2) determines the *call shape*. Both surfaces default to v1, and either can be moved to v2 by a feature flag.

Detect each separately. Neither predicts the other.

### Session preconditions — verify before TRIAGE

1. **Vivaldi runs at the root session only.** Codex has no flag that boots the primary session as a custom agent, so Vivaldi is always a skill invoked at the root. Spawned agents cannot reliably spawn their own children (`max_depth` defaults to 1). If you determine you are running as a spawned agent, stop and report that the squad must be started from the root session.
2. **A spawn tool carrying both `model` and `reasoning_effort` must exist.** That pair is the squad's routing actuator. Inspect the tools actually available in this session — do not assume a feature flag is required, and do not assume one is not. If no spawn tool is available, or the available one lacks either parameter, **hard-block before the first dispatch** and report the precondition. Never fall back to an unrouted dispatch.
3. **Skill-load check.** If this session did not open with Vivaldi's introduction, the skill did not load — stop and restart rather than improvising the pipeline.

### Surface detection — before the first resolver call

Determine the active surface once per session, from the session's own environment:

```bash
printf 'originator=%s\n' "${CODEX_INTERNAL_ORIGINATOR_OVERRIDE:-none}"
case "$PATH" in (*/Applications/ChatGPT.app/*) echo 'app_path=yes';; (*) echo 'app_path=no';; esac
```

- Both signals indicate the desktop app (a desktop originator **and** the app bundle on `PATH`) → the surface is `codex-app`.
- Neither does → the surface is `codex-cli`.
- **The signals disagree** → stop and report. Do not guess and do not prefer one: resolving the wrong surface's profile is a silent mis-route, which is worse than refusing to dispatch. Ask the user which surface this is and use their answer for the rest of the session.

Do not use the `codex` binary path or `codex --version` to identify the surface. Both surfaces resolve `codex` on `PATH` to the same standalone binary reporting the same version; the engine running the session is not the engine its shell would invoke.

### Resolution — after TRIAGE, before the first subagent dispatch

1. Use the detected surface as the harness key. Never reuse another surface's identifiers; Copilot model names are not valid here, and a profile stored for one Codex surface is not valid for the other.
2. Run the installed resolver with the dispatch's persona and the task's work tier:

   ```bash
   node .agents/skills/10x-squad-configure-tiers/scripts/model-tier-config.js resolve \
     --workspace-root "$PWD" \
     --harness <detected-surface> \
     --tier <canonical-tier-key> \
     --persona <persona-key> \
     --json
   ```

   Canonical tier keys: `trivial`, `lite`, `standard_clear`, `standard_ambiguous`, `complex`.
   Canonical persona keys: `einstein`, `peter`, `linus`, `cobalt`, `sentinel`, `ralph`.
3. Consume only the resolver's single-line stdout JSON as that persona's resolved profile. Consume `persona`, `model`, `reasoning_effort`, and `check_status`; treat any missing field, nonzero exit, malformed JSON, or declined/unexecutable resolver invocation as a hard configuration failure. `context_tier` resolves to `auto` on this surface and is never passed to a dispatch. Do not parse precedence yourself, reinterpret configuration from prose, or improvise any profile value.
4. Announce the persona name, work tier and canonical key, active surface, exact model, and reasoning choice before every persona dispatch, including `auto`: **Routing to `<Persona>` — `<Work tier>` (`<canonical-key>`) [`<detected-surface>`] — model `<exact-id>`; reasoning `<choice>`**.
5. Every persona dispatch always supplies the profile's exact resolved model explicitly as the spawn `model` argument, together with the persona skill invocation and the permitted context slice.
   - If `reasoning_effort` is non-`auto`, pass its exact resolved value as the spawn `reasoning_effort` argument; if it is `auto`, omit only that argument. Announce and report `auto`, but never pass it. Never replace runtime `auto` with a maximum, default, inherited, or guessed value.
   - **The spawn tool has no agent-name or `agent_type` parameter.** Persona identity is carried entirely in the `message` payload: the explicit persona skill invocation (for example `$10x-linus-build`) plus the context slice the Context Visibility Matrix permits. Do not rely on `.codex/agents/*.toml` definitions — they are not addressable dispatch targets.
   - Pass only the parameters the routing contract needs — `model`, `reasoning_effort`, `message`, and the naming argument below. Leave every other spawn parameter at its default; `service_tier` and `fork_context` in particular are unexamined on this surface and must not be set speculatively.
   - **Match the call shape to the toolset actually present:**

     | | v1 (the default on both surfaces) | v2 (feature-flagged) |
     |---|---|---|
     | naming | no `task_name` parameter — omit it | `task_name` is required-by-convention and must be lowercase `snake_case`, `<persona>_<canonical-tier-key>` (e.g. `linus_trivial`) — exactly the `(persona, tier)` routing coordinate; hyphens and uppercase are rejected |
     | spawn result | `{"agent_id": "<uuid>", "nickname": "<name>"}` — **retain the `agent_id`** | `{"task_name": "/root/<name>"}` |
     | collect | `wait_agent` keyed by that `agent_id` | `wait_agent` on the session |
     | recovery | no `list_agents` — a lost `agent_id` is unrecoverable, so never discard it | `list_agents` can re-enumerate children |

   - If the configured model or reasoning effort is rejected by the spawn tool, hard-block before launch; never drop the argument or fall back to another value. Rejections are loud and pre-launch — they enumerate the accepted set, which is the surface's authoritative availability source.
   - **A stored assignment can become invalid without any local change.** The spawnable set is account- and time-dependent and has been observed to change within days. Treat a rejection as a configuration failure to report, never as an invitation to substitute a model that would still launch.
6. **Executed-model confirmation is not available on this surface.** The spawn result returns only a child handle, the wait result only completion status, and the event stream carries no model field. Accepted dispatch arguments are the only evidence. **Never claim executed-model verification on Codex**, and never present an addressability success as identity proof. The pre-launch rejection of an invalid model is the backstop that replaces post-launch confirmation.

### Concurrency and depth

Cobalt and Sentinel run as two concurrent depth-1 children of the root session. Respect the session's `max_concurrent_threads_per_session` cap; if a spawn is refused for capacity, wait and retry rather than collapsing the two reviewers into one context. Persona children must not spawn their own subagents — `max_depth` defaults to 1, and the pipeline never requires depth 2.

**Every persona dispatch resolves its own profile.** Re-run the resolver with that dispatch's `--persona` and the task's current work tier before every dispatch, and never reuse another persona's resolved profile — two personas at the same tier are two independent resolutions. Repeated dispatches of the same persona at the same tier within one step may reuse that step's resolution; every dispatch still repeats the complete routing announcement. If the work tier is reclassified, every subsequent dispatch re-resolves at the new tier: consume and re-announce `model` and `reasoning_effort` before the next dispatch; running children are not restarted.

**Vivaldi's advisory model.** At TRIAGE, after announcing the tier, also run:

```bash
node .agents/skills/10x-squad-configure-tiers/scripts/model-tier-config.js resolve-advisory \
  --workspace-root "$PWD" --harness <detected-surface> --tier <canonical-tier-key> --json
```

`{"ok":true,"advisory":false}` means no recommendation is configured — announce nothing and continue. When `advisory` is true, state the recommended model and reasoning choice once as a **recommendation for the user's own session**. This never blocks and never attempts to set the parent model: Vivaldi is always the root session here and cannot change its own model, and the user selects it in the harness.

**One-dispatch override:** the user may override `model` and/or `reasoning_effort` for one dispatch of one persona; it never propagates to the other personas in the same step. A `model` override must be an exact, spawnable identifier and is still passed explicitly. Announce the complete effective profile, apply the override once, and never store it. An `auto` override omits its corresponding argument.

**Hard failure contract.** On missing/corrupt/incomplete configuration or an omitted `--persona` (resolver exit 2), missing harness profile (3), invalid tier or persona (4), I/O failure (5), an unmet session precondition, an undeterminable surface, a rejected model or reasoning effort, or a declined resolver invocation — stop and report: the active surface; the persona and its canonical key; the work tier and canonical key; the requested profile (`model` and `reasoning_effort`, using `<unresolved>` for any unresolved field); the reason; and the exact next action (run `/10x-squad-configure-tiers`, confirm the surface, choose another value, or explicitly approve a one-dispatch override). Never silently inherit the parent model, select a cheaper model, or substitute a "close" model.
