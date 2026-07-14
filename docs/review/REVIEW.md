# 10x-Squad — Confidence Review (v2, corrected)

**Date:** 2026-07-12 · **Prompt-repo baseline:** `~/.claude` @ `baseline-v0` (`ae14ae7`)
**Scope:** the full dual-harness system — live Copilot deployment (`Accrualify/.github/agents/10x-squad.agent.md` + six `.github/skills/10x-*` skills), the `10x-squad/` npm installer project, the `corpay-agents` upstream copies, the `~/.claude/commands/10x*.md` Claude Code port, and real output artifacts (`.10x/`, `10x-squad-artifacts/`).

---

## ⚠️ Revision notice — what v1 got wrong

v1 of this review was written after searching only the Claude-side universe (`~/.claude`, `~/.agents`, plugin caches). Nick corrected me: the persona skills live in `.github/skills/` — the **GitHub Copilot** layer, which nothing on the Claude side references. v1 errors, owned explicitly:

1. **"The knowledge layer doesn't exist"** — false. It exists and is *substantially more sophisticated than the stubs implied*. What's true: the Claude Code port dangles (details in F1).
2. **"Sonar 'mandatory' check lost a negotiation with reality"** — unfair. The real Cobalt skill *designs* the degradation path ("if SonarQube is unavailable… flag as MINOR"). The observed run was compliant. The residual critique is different and milder (F4).
3. **"No routing, no tiers anywhere"** — false for the real system: it has a 5-tier triage with ambiguity signals, per-agent model routing, and a reasoning-effort policy. The critique moves to *enforceability* (F5).
4. **"The reviewer fixes its own findings"** — that's the Claude *port's* wording. The real design routes fixes back to Linus across a declared boundary with cycle caps. The residual critique is about whether boundaries exist at runtime at all (F2).

The lesson is itself now Principle 8 in [LEARNING.md](LEARNING.md): **claims inherit the scope of their evidence.** I declared nonexistence after searching one of two universes. Same class of error as "tests pass" when only half the suite ran.

---

## The corrected system map

Two harnesses, four copies, two lineages, one installer — none of it version-controlled:

| Location | Contents | Last touched | Role |
|---|---|---|---|
| `Accrualify/.github/agents/` + `.github/skills/` | Vivaldi (21KB, Sentinel-aware) + **6** skills | **Jun 1** (one editing session; `.bak` file as version control) | **Live, freshest lineage** — what Copilot actually loads |
| `Accrualify/10x-squad/` | npm installer (`bin/`, `lib/installer.js`, tests) + assets: Vivaldi + **5** skills | May 8 | Nominal source of truth — **lags its own deployment**; knows nothing of Sentinel |
| `Accrualify/corpay-agents/.github/skills/` (+ `extraneous/`) | 5 skills + old Vivaldi | May 8 | Company upstream (github.com/Accrualify/corpay-agents) — stale |
| `~/.claude/commands/10x*.md` | 5 thin command stubs | May 10 | **Claude Code port** — hand-written from the May-era design, references skill paths/names that were never installed |

md5 verdict: every persona differs between the live lineage and the other three (which are mutually identical). The installer copies *forward* (assets → `.github/`), but edits happened *in the deployed copy* — so running the installer today would **roll back the Jun 1 evolution and delete Sentinel from the manifest** (it's not in `installer.js`'s `skillNames`).

**Overall verdict, revised:** the *design* is top-decile for a personal agent stack — genuinely advanced. The *systems layer* (deployment, enforcement, measurement, versioning) is absent, and that absence is already costing you: your best lineage is unversioned, your installer is a rollback trap, and your Claude runs spent two months improvising a protocol that exists, in full, one directory tree away.

---

## What the real system gets impressively right

Worth naming precisely, because these are the ideas to *engineer*, not rewrite:

- **Context Visibility Matrix** — a per-agent contract for exactly which artifacts each persona may see ("Chat History: Never"), with the correct justification ("Violating this matrix degrades output quality"). This is context engineering most production stacks don't have on paper.
- **The D#/AC# traceability chain** (Jun 1 addition) — every material decision gets an immutable ID; Peter must consume-or-defer each `D#`; Linus cites `AC#` per changelist entry; handoff gates check the chain by *string-matching*, with hard-block semantics and single corrective cycles. The stated rationale is exactly right: silent drops are the most common multi-agent failure mode.
- **Disjoint dual review** (Cobalt ⊥ Sentinel) — a security/data-integrity reviewer with its own threat-model checklist (money-math, IDOR, migration safety, TOCTOU), engaged by observable triggers (sensitive-surface declaration in Peter's spec, or Complex tier), domain-disjoint so verdicts can't conflict on the same axis, merged by an explicit both-must-approve rule. This is a professional review architecture.
- **Dispute channels with bounded arbitration** — SPEC_DISPUTE (Cobalt→Peter), DELIBERATION_DISPUTE (Peter→Einstein), each max 1 cycle then user escalation. Bounded loops everywhere (Linus↔Cobalt max 2, revision cycles capped, "Cycle 3 → Escalation Protocol").
- **Tiered artifacts with a Lean Header contract** (≤1.5K tokens) + appendix pulled only on dispute, cross-references as pointers not copies — and Cobalt/Sentinel skills explicitly cite context rot as the reason. The tiered-context-reads sections show real understanding of attention budgets.
- **Triage with observable ambiguity signals** — 5 signals, "2+ → upgrade tier," announce tier + reason. Plus the RE-ANCHORING rule (restate step/tier/next at every transition) as drift control.
- **A real deterministic tool in the loop** — `rubocop_changed_lines` exists at the workspace root and is woven into both Linus's self-check and Cobalt's independent verification, with correct worktree caveats.
- **Engineering standards inheritance** — the anti-speculative-defensive-programming doctrine from your CLAUDE.md appears verbatim as squad-wide law, with per-agent enforcement duties (Cobalt flags false optionality; Linus removes proven-unneeded guards).

The failure pattern, restated against this stronger baseline: **the system repeatedly *specifies* determinism it never *implements*.** "Mechanical," "non-negotiable," "hard-block," "MANDATORY" appear throughout — as adjectives. There is no script, hook, or CI behind any of them.

---

## F1 — Split-brain deployment: the Claude Code port dangles, and ran improvised for two months. 🔴 CRITICAL

**Evidence.** The five `~/.claude/commands/10x*.md` stubs (May 10) instruct: "Read the skill from `~/.claude/skills/10x-einstein/SKILL.md`" etc. Those paths were never populated — the installer (`10x-squad/lib/installer.js`) targets only `.github/agents/` and `.github/skills/`, and even the *names* differ (`10x-einstein` vs. the real `10x-einstein-deliberation`). So every Claude Code squad run since May: file-not-found → silent improvisation from a 2-line persona summary. Meanwhile the artifacts prove divergence: Claude-era outputs use the port's `.10x/` convention (`SESSION.md`, flat `specs/`) while the real design specifies `10x-squad-artifacts/` with project folders — both conventions now coexist in your repo (F6).

**Standards violated.** Fail fast/fail loud — a missing dependency must halt, not degrade into plausible improvisation (an LLM is a plausibility engine; it papers over missing structure with confident synthesis). Single source of truth. One-command reproducible deploys.

**Consequence.** Your two harnesses have been running *different systems under the same name* — one rich and current, one improvised from stale stubs — and no signal distinguished them. Everything you learned from Claude-side runs taught you about the port, not the design.

**Fix.**
1. Extend `installer.js` with a Claude Code target: generate `~/.claude/skills/10x-*/SKILL.md` (or better, project-level `.claude/skills/`) from the *same* assets, and regenerate the command stubs from the live Vivaldi so names/paths/artifact conventions match by construction.
2. Existence gate: first action of every command/agent is a manifest check (`test -f` each referenced path) that hard-stops with the missing list. This is a 10-line script (see `evals/check-sync.sh`, built today).

**Measure.** `check-sync.sh` exit code (today it fails; after the fix it passes permanently), plus protocol-adherence rate on Claude-side runs before/after (template fields present, tier announced with reason).

**Principle:** a prompt system has a *deployment* — treat "which text is actually loaded where" as a build artifact with integrity checks, not a filing convention.

---

## F2 — Agent boundaries are simulated on both harnesses — the design assumes isolation that neither deployment actually provides. 🔴 CRITICAL

**Evidence.** The design's language is explicit: Sentinel runs "in parallel with Cobalt, **in your own isolated context window**"; the Visibility Matrix promises Einstein sees "Chat History: Never"; Vivaldi "invokes" each persona with a sliced payload.

- **On Copilot:** a `.agent.md` custom agent is, to my knowledge of the mechanism, *one* chat session. There is no in-session primitive by which Vivaldi can spawn isolated sub-contexts, slice what they see, or run two reviewers in true parallel — every persona's "invocation" lands in the same window, where the matrix is unenforceable (you cannot un-see what's already in context; "Chat History: Never" is violated by construction). The RE-ANCHORING rule — needed precisely because one long session drifts — is the design tacitly admitting this. *(If your Copilot setup has grown real sub-agent spawning, this downgrades to "verify isolation actually happens" — and the eval in §Measure tests exactly that.)*
- **On Claude Code:** the harness *does* provide real isolation — subagents with fresh windows, per-agent `tools:` scoping (a reviewer that structurally cannot edit), per-agent `model:` routing, genuine parallel dispatch. `~/.claude/agents/` is empty; the port uses none of it. The port even added a design violation the real system doesn't have: "adopt Linus persona, fix, re-review" *inside the review context* (`10x-review.md:21`) — self-approving review, which the real design correctly routes back to Linus.

**The inversion, plainly:** *the design was written for isolation its primary harness can't grant, and ported thinly onto the harness that grants it natively.* Your most advanced ideas (visibility matrix, parallel disjoint review) are executable today — on the Claude side.

**Standards violated.** An agent boundary is a *runtime* property: context window + tool scope + model. Prose declarations of isolation don't create it. Anthropic's multi-agent guidance locates the value of subagents precisely in separate windows (clean attention, independent judgment, parallelism); evaluator independence is what makes review verdicts mean anything.

**Fix.** Make the Claude deployment the reference implementation of the design's own claims: `agents/cobalt-reviewer.md` and `agents/sentinel-reviewer.md` (read-only tools, routed models), dispatched in parallel; builder as a separate agent; the Visibility Matrix implemented as *what the orchestrator actually passes* to each dispatch — which is the only way a visibility matrix can be real.

**Measure.** Seeded-defect recall, same-window persona simulation vs. isolated subagents (identical skill text, N planted bugs incl. sensitive-surface ones for Sentinel). Also an isolation probe: plant a poisoned instruction in "chat history" that the matrix says a persona must never see; check whether it leaks into that persona's output. Cheap, decisive, and it directly validates or falsifies the matrix.

**Principle:** in multi-agent design, isolation is a mechanism, not a stage direction. If the harness can't enforce "never sees X," the matrix is documentation of an intention, not an architecture.

---

## F3 — Still no measurement loop anywhere — and the system's best mechanism has no logs. 🔴 CRITICAL (unchanged by the correction; blocks your stated goal)

**Evidence.** No run records, cost capture, adherence logs, or outcome tracking on either harness. The Jun 1 traceability gates — the squad's sharpest idea — produce no artifact when they "run": no gate log, no dropped-ID record, nothing to audit. `PROJECTS.md` (the registry the design mandates) doesn't exist in your repo: `10x-squad-artifacts/` contains one brief in `briefs/`, no `projects/` tree at all — so live-side adherence to the artifact protocol is *also* unmeasured and, on current evidence, low.

**Standards violated.** Eval-first agent engineering (Anthropic guidance: ~20 tasks, LLM judge + human spot-checks, token spend as first-class metric). Basic experimental method: no baseline → no attribution → "markedly better with quantitative proof" is structurally impossible.

**Consequence.** You cannot currently distinguish (a) the squad helps, (b) the base model is good and the squad is ceremony, (c) the squad helps on Copilot and hurts on Claude. F1 ran undetected for two months because nothing measured either side.

**Fix.** The harness in [`evals/`](evals/) (runnable; smoke-tested) + [EVAL-PLAN.md](EVAL-PLAN.md). Sequence discipline: baseline the *current* systems first — including the broken port, as-is — then land fixes one commit at a time and re-run. That's also why I've changed no prompt files: rewriting before baselining destroys the "before" forever.

**Measure.** This finding *is* the instrument. First datapoint already exists: `check-sync.sh` quantifies deployment drift today (see F7).

**Principle:** an agent pipeline without an eval suite is a hypothesis. Version the prompts, freeze a task set, and let deltas — not demos — decide what improved.

---

## F4 — "Mechanical" is an adjective, not an artifact: every deterministic algorithm is specified in prose and assigned to the model. 🟠 HIGH

**Evidence.** The design *specifies* determinism repeatedly — and implements none of it:
- Traceability gate: "Vivaldi runs a **mechanical** check — string-match the trace IDs, no judgment… **hard-blocks** the handoff." A regex algorithm, executed by an LLM on the honor system. Nothing writes a gate result anywhere.
- Cobalt's checklist: "Lint verification… **non-negotiable** — a review without lint verification is incomplete." Who verifies Cobalt ran it? Nobody — the review *reports* a Lint Check section; no mechanism confirms the command actually executed.
- Coverage gate: >80% or MAJOR — **with a designed waiver**: "if SonarQube is unavailable… MINOR." (v1 mischaracterized this as decay; it's compliant behavior. The residual critique: a waivable gate is non-binding exactly where you run most — local worktrees — so the coverage bar exists only in CI-shaped environments, i.e., the gate's strength silently varies by machine.)
- "Never fabricate outputs," "Do NOT fabricate test results" (Ralph) — honesty invariants, prompt-only.
- Zero hooks, zero scripts behind any of this, on either harness. The one real tool (`rubocop_changed_lines` — credit, it exists and is well-integrated) is *voluntarily* invoked by the model.

**Standards violated.** Deterministic-where-possible: an algorithm you can state as string-matching belongs in code; Claude Code hooks and plain scripts exist precisely so "mandatory" can mean mandatory. A checker that isn't itself checked is trust with extra steps.

**Fix (highest leverage-per-line in the whole system).**
1. `squad-gate-trace.py` (~40 lines): parse `D#`/`AC#` from brief/spec/changelist, diff the sets, exit non-zero with the dropped IDs, append a row to a gate log. The design already wrote its spec — in the Traceability Gates section.
2. `squad-gate-review.sh`: runs lint (and tests) itself and stamps results into the review artifact — Cobalt cites the stamp; APPROVE without a stamp is invalid by schema.
3. On Claude side, wire both as hooks so they cannot be skipped.

**Measure.** Gate-violation count (target: structural 0), plus dropped-D# rate per project — a number the design itself declares is the most common multi-agent failure mode, and which today nobody counts.

**Principle:** if you can specify the check as string-matching, you've written the program — let a program run it. Prompts are for judgment; scripts are for invariants.

---

## F5 — Routing and effort policy: right idea, wrong enforcement layer — plus stale model pins. 🟠 MEDIUM-HIGH (corrected from v1)

**Evidence.** The real Vivaldi has a per-agent × per-tier model-routing table and a reasoning policy — v1 was wrong to say none exists. The residual problems:
- **Unenforceable where it lives:** on Copilot, the *user* selects the model; a `.agent.md` cannot switch models per sub-task or set reasoning effort per persona. The routing table is advisory prose. On Claude Code — where `model:` and per-dispatch effort are real, enforceable fields — the port contains no routing at all.
- **Stale pins:** "Sonnet 4.6, GPT-5.4, Opus 4.6" — model names hardcoded in prompt prose rot silently (they're already aging). Pin capability *tiers* in the design; bind concrete model IDs in per-harness config.
- **Flat-max policy:** "Always request the highest reasoning effort… Never use default/low. The Enterprise Copilot subscription covers the cost." Defensible on flat-rate Copilot; wrong as a portable doctrine — on your metered Claude Pro plan, max-effort-everything for a Lite-tier mechanical build is pure burn, and it contradicts effort-scaling guidance (match effort to task class).
- Ceremony survives: self-introduction on every invocation (tokens spent on theater), from the same author whose CLAUDE.md says every token matters.

**Fix.** Move routing to the enforceable layer per harness: Claude agents get `model:`/effort in frontmatter keyed to tier; Copilot side keeps the table as *user guidance* (it can't be more). Replace model names with tier labels + a small per-harness binding block. Delete the intro.

**Measure.** Cost/task by tier (harness-captured), tier distribution sanity (if 80% of tasks land Standard+, the rubric isn't discriminating), and quality metrics holding flat as routing sheds cost.

**Principle:** policy belongs in the layer that can enforce it. A routing table the runtime can't execute is a wish; the same table in agent frontmatter is a system.

---

## F6 — Artifact layer: good design, zero validation, and two conventions currently coexisting. 🟠 MEDIUM (corrected — v1 over-blamed the design for the port's sins)

**Evidence.** The real artifact architecture is solid: per-project folders, `CONTEXT.md` resumption anchor, `decisions.md` at gates, append-only `PROJECTS.md` registry, phase-qualified names, archive. But:
- **Two conventions live in your repo right now:** the port's `.10x/` (SESSION.md + flat specs — including the two byte-identical specs under different ticket names) and the design's `10x-squad-artifacts/` (one brief, no `projects/`, no `PROJECTS.md`). Neither side notices the other.
- **Nothing validates anything:** artifacts carry no frontmatter contract (`task_id`, `ticket`, `stage`, `status`, `producer`), so the mislabeled-duplicate-spec failure is undetectable by machine; the port's "find the latest in `.10x/specs/`" fallback remains a wrong-ticket hazard.
- The design's own registry discipline ("append at INTAKE, update at DELIVER") is — per your repo — not happening, and nothing flags it (F3/F4 again).

**Fix.** One convention (the design's), one addition: required frontmatter on every artifact + a 10-line validator; explicit paths only (delete "latest"); the port regenerated to speak the same convention (F1 fix covers this).

**Measure.** Validator violations (→0), cold-resume success rate over 10 fresh sessions, wrong-artifact incidents (→ structurally impossible).

**Principle:** inter-agent artifacts are APIs — schema, explicit addressing, one writer, a validator. A great folder structure without a validator is a style guide, not a contract.

---

## F7 — Lineage chaos: four copies, two lineages, `.bak`-file versioning, and an installer that would roll back your best work. 🟠 HIGH (massively strengthened by the correction)

**Evidence.**
- Live lineage (Jun 1: all six skills + Vivaldi, one editing session) is **ahead of its own source**: installer assets and corpay-agents upstream sit at May 8. Edits happen in the *deployed* copy; the "source of truth" is a rollback trap — `installer.js` today would overwrite the Jun 1 evolution, and its `skillNames` manifest doesn't include Sentinel at all (a fresh install deploys a Vivaldi that routes to a reviewer that was never installed — F1's failure mode, freshly minted).
- Version control: none. The freshest lineage's history is `10x-squad.agent.md.bak`. The npm project (with tests!) isn't a git repo. The company upstream lags a month.
- Claude side: `~/.claude` CLAUDE.md still instructs `/user:10x…` — a retired namespace (commands surface as `/10x…`) — and the superpowers plugin's session hook now mandates overlapping process (brainstorming ≈ Einstein, verification-before-completion ≈ Ralph…) with undefined precedence against the squad.

**Standards violated.** Single source of truth; edits flow source → deploy, never the reverse; upstream sync as routine; prompts-as-code (versioned, diffable, releasable).

**Fix.**
1. `git init` in `Accrualify/10x-squad/` (it's your personal tool — recommend, with the caveat it lives in a work tree; alternatively move source into corpay-agents and treat that as canonical).
2. Reverse the flow once: copy live `.github/` state *back* into assets (adopting Jun 1 as source), add Sentinel to `skillNames`, add the Claude Code target (F1), then **only ever edit assets and reinstall**.
3. `check-sync.sh` (built today, in `evals/`) as the parity alarm: manifest existence + cross-copy checksums, exit non-zero on drift. Run it in the eval loop and before any squad session.
4. Decide the superpowers boundary on the Claude side (recommendation: squad owns triage/artifacts/review-gates; superpowers owns generic process; disable the overlap for squad runs).

**Measure.** `check-sync.sh` today: **fails with 6/6 skills drifted + 6/6 port references missing + Sentinel absent from installer manifest.** After: exits 0, forever. Drift-detection latency drops from "months, by accident, during an external review" to "next run."

**Principle:** the moment a prompt system exists in two places, you have a distributed system — and it needs what distributed systems need: a canonical writer, a sync mechanism, and a parity check.

---

## F8 — Skill content: strong — but untested, and most descriptions still say *what*, not *when*. 🟡 MEDIUM (softened from v1)

**Evidence & standards** (rubric: superpowers `writing-skills` + Anthropic skill guidance):
- **Quality credit:** exact output templates, self-validation checklists, severity calibration with anti-inflation rules, domain disjointness, tiered context reads — this is well above typical skill quality.
- **Descriptions:** `10x-einstein-deliberation`'s is exemplary ("Use when the pipeline reaches Step 1 DELIBERATE, when… or when…"). The other five are what-summaries ("Cobalt — Senior Code Review Agent. Reviews code against spec…") — the rubric's tested failure mode: agents act on the summary instead of loading the skill body. Rewrite all five as trigger-conditions-only.
- **The Iron Law:** none of this was ever baseline-tested (pressure scenario without the skill → capture the actual failure → write the skill against it → re-test). E.g., whether Cobalt's "a review with zero findings is a failure" line prevents rubber-stamping — or *causes* fabricated findings under a clean diff (its own checklist worries about this: "No fabricated issues") — is an empirical wording question that a 5-rep micro-test answers. Nobody has run it.
- Persona-preamble-in-fenced-block is a reasonable pattern for the Copilot simulation; on the Claude side those preambles should *become* agent files (F2) rather than quoted text.

**Fix.** Fold into the F1 rebuild: descriptions rewritten as triggers; each skill gets 1–2 pressure scenarios kept as a regression suite; wording claims (adversarial-mindset line, zero-findings rule) micro-tested per the rubric before being kept.

**Measure.** The pressure-scenario suite is the measure — prompt regression tests, run per prompt commit like any other tests.

**Principle:** prompt wording is an empirical question. Baseline the failure before writing the guidance — otherwise you're decorating.

---

## Priority order (revised)

| # | Action | Findings | Status / effort |
|---|---|---|---|
| 0 | Version-control `~/.claude` (`baseline-v0` = `ae14ae7`) | F3,F7 | ✅ done today |
| 1 | `check-sync.sh` parity/manifest alarm | F1,F7 | ✅ built today — **fails, correctly** |
| 2 | Git-init `10x-squad/`; adopt live Jun 1 lineage back into assets; add Sentinel to installer manifest | F7 | ✅ done same day (`10x-squad/` commits `6957b06`→`e310e02`): tests 6/6, scratch install byte-identical to live 7/7, SOURCE failures 8→**0**; remaining = UPSTREAM 7 (PR corpay-agents), PORT 6 (step 4) |
| 3 | Baseline eval run on both current systems as-is (incl. the broken port) | F3 | ~1 evening — **← next** |
| 4 | Installer: Claude Code target; regenerate port from live lineage; existence gates | F1 | 1 session |
| 5 | `squad-gate-trace.py` + review-gate script (+ hooks on Claude side) | F4 | 1 session — highest leverage/line |
| 6 | Real subagents on Claude side (read-only reviewers, routed models, parallel Cobalt∥Sentinel); run the seeded-bug + isolation-probe A/B | F2 | 1–2 sessions — the headline experiment |
| 7 | Artifact frontmatter + validator; kill "latest"; one convention | F6 | 1 session |
| 8 | Routing to enforceable layer; de-pin model names; superpowers boundary; description rewrites + pressure tests | F5,F8 | 1–2 sessions |
| 9 | Re-run suite per step; keep deltas | F3 | ongoing |

Every step = its own commit; every eval row carries `prompt_sha`. The deltas down this ladder are the quantitative proof.
