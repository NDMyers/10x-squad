# Review Packet: Model-Routing Design for the 10x-Squad

**To:** Codex (GPT 5.6 Sol Ultra) — external design review
**From:** Claude (Fable 5), working with Nick Myers
**Date:** 2026-07-12
**Authorship disclosure:** this packet was written by the AI whose plan you are reviewing. Confidence markers below are self-assessed; discount accordingly and attack freely. You are chosen as reviewer specifically because you are a different vendor's model with no stake in this design and home-turf knowledge of the OpenAI/Codex ecosystem.

This document is self-contained — you need no other files. Everything relevant from the underlying design doc (`MODEL-ROUTING.md`) and its system context is restated here.

---

## 1. What we want from you

Review the model-routing design in §4–§5 against the constraints in §6. Specifically:

1. **R1 — Soundness:** Does the three-way separation (classify / bind / rank, §4.0) hold up, or are there task-model interactions it wrongly assumes away?
2. **R2 — Attack the rejections (§5):** We rejected four alternatives, including LLM-self-selection and models-API auto-discovery. If any rejection is wrong — especially given OpenAI-ecosystem capabilities we may not know — say so concretely.
3. **R3 — The weak points (§7):** We list seven claims we're least confident in. Confirm, refute, or reprioritize them; add ones we missed.
4. **R4 — OpenAI-side binding correctness:** The Copilot model picker includes OpenAI models. Evaluate our binding scheme against OpenAI naming/deprecation/aliasing practice (dated snapshots vs. floating names, deprecation cadence, Codex-side agent config conventions). This is your home turf; we have the least visibility here.
5. **R5 — Failure modes:** What breaks first in production use by a single professional developer (not a platform team)? Assume no ops staff and ~zero maintenance appetite.
6. **Output format** (so findings are actionable): a verdict (SOUND / SOUND-WITH-CHANGES / UNSOUND), then numbered findings, each with severity (CRITICAL / MAJOR / MINOR), the packet section it targets, the failure scenario, and what the fix must achieve. Please do not restate the design back to us; findings only.

## 2. System context (minimum necessary)

- **The 10x-squad** is Nick's personal multi-agent development pipeline: an orchestrator persona ("Vivaldi") routing work through personas — deliberation (Einstein), spec (Peter), build (Linus), correctness review (Cobalt), security/data-integrity review (Sentinel, parallel and domain-disjoint to Cobalt), test (Ralph) — over a tiered triage: Trivial / Lite / Standard-clear / Standard-ambiguous / Complex.
- **Dual-harness deployment.** Primary: GitHub Copilot — one custom agent (`.github/agents/10x-squad.agent.md`) + six skills (`.github/skills/10x-*/SKILL.md`), installed by a small npm installer from a git-versioned `assets/` source of truth. Secondary: a Claude Code port (currently broken/stale; scheduled for regeneration from the same source).
- **Relevant constraints from a recent architecture review of the whole squad:**
  - On Copilot, all personas execute inside **one context window** (custom agents have no in-session sub-agent spawning); "routing" to a persona is a prompt-level simulation. One agent file = one model; the agent cannot switch models mid-session — the human's model picker decides.
  - The squad's standing failure pattern is *specifying* determinism in prose ("mandatory", "mechanical", "hard-block") with no mechanism behind it. All new design must put invariants in scripts/config, not prose.
  - **Workspace rule:** no prompt change lands without (a) a git commit, (b) deployment-parity check green, (c) an eval delta from a frozen task suite (`claude -p` headless runs, pass@1 / pass^3 / cost / seeded-defect-recall metrics). The eval baseline has not run yet, so this design is *designed but deliberately not landed*.

## 3. The problem

Vivaldi's current Model Routing section hardcodes model names in prose — "Standard (e.g., Sonnet 4.6, GPT-5.4): use `high` or `xhigh` reasoning… Higher-tier (e.g., Opus 4.6)" — plus a billing-coupled effort doctrine ("Never use default/low. The Enterprise Copilot subscription covers the cost"). Failure modes observed or foreseeable:

- **P1 — Rot:** model names age out quickly; nothing detects it; the orchestrator confidently recommends deprecated models.
- **P2 — Scattered binding:** names appear inside doctrine text, so updating means editing prose in N places across two harnesses (drift between copies has already bitten this project elsewhere).
- **P3 — Billing leakage:** the flat-max effort doctrine is correct for flat-rate Enterprise Copilot and wrong for the metered Claude Pro plan the port runs on.
- **P4 — Wish-routing:** the routing table implies the agent switches models per persona; on Copilot it mechanically cannot. Policy lives in a layer that can't enforce it.

Nick's ask: *"Is there a way to have the agent route the most applicable and capable model to the task?"* — ideally without hardcoded names at all.

## 4. Proposed design, with reasoning

### 4.0 The core move: separate three concerns by change-rate and owner

| Concern | Nature | Changes | Owner | Lives in |
|---|---|---|---|---|
| Task classification — what capability does *this task* need? | judgment | per task | the LLM (existing triage tiers) | orchestrator prompt |
| Tier→model binding — which concrete model is "frontier" today? | configuration | a few times/year | the human, informed by evals | ONE data block per harness |
| Capability ranking — is the new model actually better *for this codebase's work*? | empirical | per model release | the eval suite | eval results |

Mantra: **let the model classify the task; never let the model choose the model; let evals choose the binding.**

Reasoning: these change at different speeds (per-task / quarterly / per-release) and conflating them is what created P1–P4. Classification is genuinely a judgment call the LLM is good at and already does (tiering). Binding is config that must be diffable and single-located. Ranking has no oracle — see §5.

### 4.1 Policy layer (semantic, stable — lives in the orchestrator prompt)

The routing table keeps its shape but names only **capability tiers** (`standard`, `frontier`), never models. Two tiers, matching the current design's Standard/Higher-tier split; deliberately no economy tier (existing floor policy: minimum Standard for all agents). Effort levels move out of doctrine into the per-harness binding (fixes P3). New behavioral rule replacing wish-routing (fixes P4): *announce the required tier; if the session's active model is below it and the harness cannot switch, say so and recommend the human switch before the step runs* — making the human the actuator the harness actually provides.

### 4.2 Binding layer (volatile data, one location per harness)

**Copilot (primary):** a single fenced "Model Binding" block at the top of the agent file — the only place model names may appear: `frontier: <name>`, `standard: <name>`, effort policy, and a `reviewed: YYYY-MM-DD` stamp. The `.agent.md` frontmatter `model:` property is set to the *standard* binding (single string — see verified facts, §8). Per-persona model pinning would require splitting personas into separate `.agent.md` files (a move already planned for isolation reasons, not taken yet).

**Claude Code (port):** subagent frontmatter uses **floating aliases** (`opus`, `sonnet`) or `inherit` — the harness re-points aliases to the current best model in each family, eliminating rot within a vendor family with zero edits. No dated model IDs anywhere. Effort set per-dispatch, scaled to tier (metered plan).

**Known tradeoff we accept (please stress-test):** floating aliases trade *rot* for *silent behavior change* — a provider re-point is an uncontrolled mid-project upgrade with no commit. Mitigation: re-run the eval suite on provider release news; escape hatch: temporary dated pin in the binding block if a regression traces to a re-point. Pins fail worse (rot silently *and* forgo improvements), but the reproducibility boundary becomes the provider's release calendar, which is a real cost.

### 4.3 Verification layer (make staleness loud — scripts, not prose)

A `check-models.sh` run alongside the existing deployment-parity check:
1. **Structural invariant (offline, deterministic):** grep all squad prompt sources for model-name patterns *outside* the binding block / agent frontmatter → any hit fails. Mechanically enforces names-live-in-one-place.
2. **Cadence alarm (offline):** `reviewed:` date older than 90 days → fail. Converts "forgot to re-evaluate" from silent to blocking.
3. **Online check (optional, when API keys present):** validate pinned IDs against provider model-list endpoints; warn on newer family members.

### 4.4 Promotion layer (how the binding earns updates)

A new model never enters the binding for being new. It gets a branch: update binding → run the frozen eval suite → compare pass@1/pass^3/cost/seeded-recall vs. incumbent → promote on evidence, with numbers in the commit message. "Most capable" becomes a measured, dated, reversible decision.

## 5. Alternatives considered and rejected (challenge these)

1. **LLM self-selection ("agent picks the best model at runtime").** Rejected: circular (the selector's model knowledge is stale training data), unauditable, and on Copilot mechanically impossible (the agent can't switch). Would recreate the squad's core disease — capability specified in prose with no mechanism.
2. **Models-API auto-discovery.** Rejected as *primary* mechanism: provider list endpoints enumerate IDs, not capabilities; nothing machine-readable ranks "best for deliberation on a brownfield Rails monolith." Retained as the optional online *deprecation* check (§4.3.3) — discovery of absence is reliable even where discovery of quality isn't.
3. **Status quo (pinned names, manual prose updates).** Rejected: it's the observed failure (P1, P2).
4. **No routing (one model everywhere).** Seriously considered for simplicity — it does eliminate the binding layer. Rejected because the tier structure already exists and the cost asymmetry is real (frontier-model deliberation vs. standard-model mechanical builds), especially on the metered harness. But if the eval baseline later shows routing buys nothing, this is the fallback and we'd take it.
5. **External router service (OpenRouter-style "auto" meta-routing).** Rejected: adds a dependency and a second opaque judgment layer for a two-tier personal system; not available inside Copilot's picker anyway.

## 6. Constraints your review must respect

- Two harnesses, Copilot primary; single professional developer; no ops staff; near-zero standing maintenance budget.
- Invariants must be mechanically checkable (scripts/config), not prose promises — this is the squad's #1 standing correction.
- Eval-first sequencing: the design lands only after the eval baseline exists (frozen suite, headless runs); recommendations that require landing prompt changes first are non-starters.
- Personal-tool scale: solutions that presume a model-gateway service, weekly benchmarking rotas, or a platform team are out of scope.

## 7. Claims we're least confident in (prioritized attack surface)

1. **The 90-day cadence is arbitrary.** Is there a better trigger (provider release feeds? picker-diff detection?) that stays near-zero-maintenance?
2. **Two tiers may be wrong.** The floor policy ("no economy models") was written under flat-rate billing; on the metered harness, a third cheap tier for Trivial work might pay. We kept two for simplicity, pending eval data.
3. **Announce-and-recommend may not work behaviorally.** It assumes the human actually flips the model picker when told mid-flow. If humans ignore it, Complex work silently runs on standard models — the exact failure the table was meant to prevent. Is there a stronger pattern within Copilot's actual mechanics?
4. **The grep-based structural check may misfire** — false positives on legitimate prose *about* models (docs, this packet), false negatives on novel names. Is a allowlist-of-locations approach (only binding block + frontmatter may match) robust enough in practice?
5. **Floating-alias silent upgrades (§4.2 tradeoff)** — is our mitigation (eval re-run on release news) realistic for one person, or does this need the dated-pin-by-default posture instead, with alias as the exception?
6. **Eval-suite sensitivity:** promotion assumes a ~5–20 task suite can distinguish models. Plausibly it can only distinguish *large* gaps; small regressions ride in under noise. Is promotion-by-eval honest at this n, or theater?
7. **Cross-vendor binding entries** (OpenAI models in the Copilot picker): our scheme treats "frontier/standard" as vendor-neutral slots. Does OpenAI's naming/deprecation practice (snapshots, floating names, deprecation windows) break any assumption here? (R4 — your home turf.)

## 8. Verified environmental facts (checked 2026-07-12 — do not "correct" these from memory; they may postdate your training)

| Fact | Source |
|---|---|
| Copilot custom agents: `.agent.md` YAML frontmatter supports an optional `model` property (honored in VS Code, JetBrains, Eclipse, Xcode); values are display-name strings, e.g. `model: 'Claude Sonnet 4 (copilot)'` | [GitHub Docs — Custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration) |
| Copilot CLI rejects the array form of `model:` that VS Code accepts — single string required for cross-surface compat | [github/copilot-cli #2133](https://github.com/github/copilot-cli/issues/2133) |
| Reasoning-effort is not a supported `.agent.md` frontmatter field on Copilot CLI (open feature request) | [github/copilot-cli #2904](https://github.com/github/copilot-cli/issues/2904) |
| Claude Code subagents: per-agent Markdown definitions with frontmatter `model:` accepting floating family aliases (`opus`, `sonnet`, `haiku`) or `inherit` (track the session model); per-dispatch effort control exists | Claude Code docs (subagents); verified in the live harness this session |
| The squad's Copilot deployment is one custom agent + six skill files; installer + assets are git-versioned as of 2026-07-12; a categorized deployment-parity script (`check-sync.sh`) runs cross-copy checksum checks | local repo state, verified this session |

## 9. Out of scope for this review

The broader squad findings (single-window persona simulation, prose-gates, eval-harness design) have their own review workspace and ladder; touch them only where they constrain this design (they're summarized in §2/§6). The task-tier *classification rubric* itself (Trivial→Complex definitions) is also out of scope — assume it works; §4.0 only relies on its existence.
