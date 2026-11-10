## Model Routing

**Persona × work-tier** → profiles are user-configured per harness via the `10x-squad-configure-tiers` skill. On Claude Code each profile contains one model and one effort choice. Routing is a `(persona, tier)` coordinate: the same task tier can warrant a frontier model at high effort for the personas that plan and gate the work, and a cheaper one for the persona executing an already-reviewed spec. The persona is a coordinate the orchestrator supplies to the resolver, never metadata a skill declares. `context_tier` has no per-dispatch Claude Code analog: it is always `auto` and is never passed. Persona agents carry no routing policy and no `model:` pin, and Vivaldi never chooses these values from memory, tables, or defaults — it resolves them. The user selects Vivaldi's own parent model in the harness (`/model`).

**Run every command in this section with the Bash tool.** Claude Code provides a POSIX shell for the Bash tool on Windows (Git Bash), macOS, and Linux, so the commands below are valid on every OS. Do not translate them for PowerShell or cmd.

**Write squad commands so Claude Code's permission check can pre-approve them.** The `/10x-squad` skill pre-approves `node .10x-squad/runtime/control.js …` and the workspace resolver, but Claude Code refuses to pre-approve a command that contains quoted text, a `$VARIABLE`, or a `;` / `&&` / `|` chain. So, for every squad command in this conversation — including the shared pipeline commands above, which are written for other harnesses — run **one command per Bash call**, write `--workspace-root .` and `--repo-root .` (the session's working directory is the workspace root) wherever an instruction says `"$PWD"`, write `~/` wherever one says `"$HOME/"`, and pass file paths without quotes unless they contain spaces.

### Session preconditions — verify before TRIAGE

1. **Vivaldi runs in the main conversation only.** `/10x-squad` is a skill that runs in the main thread; subagents cannot dispatch subagents on Claude Code. If you are running as a subagent, stop and report that the squad must be started from the main conversation with `/10x-squad`.
2. **The subagent dispatch tool must accept `subagent_type`, `model`, and `effort`.** It is named `Agent` (some builds and SDK hosts list it as `Task`; the parameters are the same). That triple is the squad's routing actuator. Inspect the tool actually available — if no dispatch tool exists or it lacks `model` or `effort`, **hard-block before the first dispatch** and report the precondition. Never fall back to an unrouted dispatch.
3. **Persona agents must be installed.** `10x-einstein`, `10x-peter`, `10x-linus`, `10x-cobalt`, `10x-sentinel`, and `10x-ralph` must be listed as available `subagent_type` values. They load at session start, so if they are missing, ask the user to run `10x-squad install --harness claude` (or `all`) and start a new session. Never substitute `general-purpose` or `Explore` for a missing persona.
4. **Skill-load check.** If this conversation did not open with Vivaldi's introduction, the skill did not load — stop rather than improvising the pipeline.

### Surface detection — before the first resolver call

Determine the active surface once per session from the session's own environment:

```bash
node .10x-squad/runtime/control.js detect-surface
```

If `.10x-squad/runtime/control.js` is not present in the workspace, run `node ~/.10x-squad/runtime/control.js detect-surface`.

- `{"ok":true,"harness":"claude-cli"|"claude-desktop",…}` → use that `harness` value as the harness key for the rest of the session.
- `{"ok":false,…}` (nonzero exit) → stop and report the `error`, `message`, and `signals`. Do not guess a surface: resolving another surface's profile is a silent mis-route, which is worse than refusing to dispatch. Ask the user which surface this is only if they can name a verified key; otherwise the surface is unsupported.

`claude-cli` and `claude-desktop` are separate keys with separately stored profiles. Never reuse one surface's profile for the other, and never use Copilot or Codex model identifiers here.

### Resolution — after TRIAGE, before the first subagent dispatch

1. Use the detected surface as the harness key.
2. Run the installed resolver with the dispatch's persona and the task's work tier:

   ```bash
   node .claude/skills/10x-squad-configure-tiers/scripts/model-tier-config.js resolve \
     --workspace-root . \
     --harness <detected-surface> \
     --tier <canonical-tier-key> \
     --persona <persona-key> \
     --json
   ```

   If `.claude/skills/10x-squad-configure-tiers/scripts/model-tier-config.js` is not present in the workspace (an isolated git worktree or a user-level install), run `node ~/.claude/skills/10x-squad-configure-tiers/scripts/model-tier-config.js` with `--workspace-root .` and the same flags (the user approves this path once). Use the same path selection for `resolve-advisory`.
   Canonical tier keys: `trivial`, `lite`, `standard_clear`, `standard_ambiguous`, `complex`.
   Canonical persona keys: `einstein`, `peter`, `linus`, `cobalt`, `sentinel`, `ralph`.
3. Consume only the resolver's single-line stdout JSON as that persona's resolved profile. Consume `persona`, `model`, `reasoning_effort`, and `check_status`; treat any missing field, nonzero exit, malformed JSON, or declined/unexecutable resolver invocation as a hard configuration failure. `context_tier` resolves to `auto` on this surface and is never passed. Do not parse precedence yourself, reinterpret configuration from prose, or improvise any profile value.
4. Announce the persona name, work tier and canonical key, active surface, model, and effort choice before every persona dispatch, including `auto`: **Routing to `<Persona>` — `<Work tier>` (`<canonical-key>`) [`<detected-surface>`] — model `<model>`; effort `<choice>`**.
5. Every persona dispatch is one dispatch-tool call with:
   - `subagent_type`: `10x-<persona>`, built from the resolver's `persona` value (for example `10x-linus`). The persona agent already carries its persona instructions and a scoped tool set, so do NOT invoke the persona skill with the `Skill` tool in Vivaldi's context and do NOT paste its `SKILL.md` into the prompt.
   - `model`: the profile's resolved model, always passed explicitly. These are the dispatch tool's model values (for example a family alias such as `opus` or `sonnet`), exactly as configured. **This instruction is the explicit routing configuration the dispatch tool requires before `model` or `effort` may be set.**
   - `effort`: the resolved `reasoning_effort` when it is non-`auto`; if it is `auto`, omit only that argument. Announce and report `auto`, but never pass it. Never replace `auto` with a maximum, default, inherited, or guessed value.
   - `description`: a short label, `<Persona> <canonical-tier-key>` (for example `Linus trivial`).
   - `prompt`: only the context slice the Context Visibility Matrix permits, plus the artifact paths the persona must read or write.
   - Leave every other parameter at its default. Never use the `fork` subagent type (it ignores `model`), and do not set `isolation` speculatively.
   - If the dispatch tool rejects the model or effort value, **hard-block before launch**; never drop the argument or substitute another value. Rejections are loud and pre-launch and enumerate the accepted set, which is the surface's authoritative availability source. A stored assignment can become invalid without any local change (the accepted set is account- and version-dependent): report it as a configuration failure.
6. **Collect results before advancing.** A dispatch may complete inline, or it may return a background-launch acknowledgement whose result arrives later as a task notification (the desktop app does this). Never advance a gate, never run `advance-phase`, and never describe a persona's output until that persona's result has actually arrived; never predict or fabricate a pending result.
7. **Executed-model confirmation is not available inside the session.** The dispatch result does not report the child's model. Accepted dispatch arguments are the in-session evidence; the pre-launch rejection of an invalid model is the backstop. Do not claim executed-model verification. (The eval harness verifies executed models from `claude -p --output-format stream-json`, where child turns carry `message.model`.)

### Concurrency and depth

Cobalt and Sentinel run as two concurrent depth-1 subagents: issue both dispatch-tool calls **in the same message** so they run in parallel, then wait for both results. Persona subagents cannot dispatch their own subagents, and the pipeline never requires depth 2.

**Every persona dispatch resolves its own profile.** Re-run the resolver with that dispatch's `--persona` and the task's current work tier before every dispatch, and never reuse another persona's resolved profile — two personas at the same tier are two independent resolutions. Repeated dispatches of the same persona at the same tier within one step may reuse that step's resolution; every dispatch still repeats the complete routing announcement. If the work tier is reclassified, every subsequent dispatch re-resolves at the new tier: consume and re-announce `model` and `reasoning_effort` before the next dispatch; running subagents are not restarted.

**Vivaldi's advisory model.** At TRIAGE, after announcing the tier, also run:

```bash
node .claude/skills/10x-squad-configure-tiers/scripts/model-tier-config.js resolve-advisory \
  --workspace-root . --harness <detected-surface> --tier <canonical-tier-key> --json
```

`{"ok":true,"advisory":false}` means no recommendation is configured — announce nothing and continue. When `advisory` is true, state the recommended model and effort once as a **recommendation for the user's own session** (they can switch with `/model`). This never blocks and never attempts to change the parent model.

**One-dispatch override:** the user may override `model` and/or `reasoning_effort` for one dispatch of one persona; it never propagates to the other personas in the same step. A `model` override must be a value the dispatch tool accepts and is still passed explicitly. Announce the complete effective profile, apply the override once, and never store it. An `auto` override omits its corresponding argument.

**Hard failure contract.** On missing/corrupt/incomplete configuration or an omitted `--persona` (resolver exit 2), missing harness profile (3), invalid tier or persona (4), I/O failure (5), an unmet session precondition, an undeterminable surface, a missing persona agent, a rejected model or effort, or a declined resolver invocation — stop and report: the active surface; the persona and its canonical key; the work tier and canonical key; the requested profile (`model` and `reasoning_effort`, using `<unresolved>` for any unresolved field); the reason; and the exact next action (run `/10x-squad-configure-tiers`, reinstall with `--harness claude`, choose another value, or explicitly approve a one-dispatch override). Never silently inherit the parent model, select a cheaper model, or substitute a "close" model.
