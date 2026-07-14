# Becoming a Better Agentic Engineer — What the 10x-Squad Teaches (v2, corrected)

You built the squad by delegating the reasoning to AI and want to own the understanding now. This doc is the transferable layer: the principles behind each finding, why they're true, and how to internalize them by doing. Findings referenced as F1–F8 from [REVIEW.md](REVIEW.md). v2 incorporates the correction: the skills exist (Copilot side, `.github/skills/`) and are far better than v1 knew — which *changed the diagnosis but sharpened the lessons*.

---

## The one-sentence diagnosis (revised)

**The design is advanced; the system around the design — deployment, enforcement, isolation, measurement, versioning — is absent.** Your prompts repeatedly *specify* engineering ("mechanical," "hard-block," "isolated context," "MANDATORY") that nothing *implements*. That gap, not prompt quality, is where all eight findings live.

---

## Eight principles, with the reasoning

### 1. An LLM is a plausibility engine, so silent failure is the default — build the loudness. (F1, F4)
Classical software crashes on a missing dependency. A model, handed a dangling reference, *synthesizes a plausible substitute* and keeps going — that's its core competency pointed the wrong way. Your Claude port referenced skills that were never installed (wrong paths *and* wrong names), and for two months every run improvised the protocol — while the real, sophisticated protocol sat one directory tree away. **Absence of error is zero evidence of correctness.** Anything that must be true (file exists, gate ran, template followed) needs a mechanism that cannot be improvised around: exit codes, hooks, schema validators, manifest checks.

### 2. Isolation is a mechanism, not a stage direction. (F2)
The design says Sentinel runs "in your own isolated context window" and the Visibility Matrix says Einstein sees "Chat History: Never." Neither deployment can make that true: Copilot custom agents live in one window (you cannot un-see what's in context), and the Claude port never touches the harness's real subagents. An agent boundary is a *runtime* property — context window + tool scope + model. Prose declarations of isolation produce **simulated multi-agency**: the ceremony of a squad with the epistemics of one agent. The tell: the design's own RE-ANCHORING rule exists because one long window drifts. And note the inversion — the harness that *can* enforce the matrix (Claude Code) is the one running the stub port. Test isolation empirically (the probe in EVAL-PLAN §3): plant an instruction the matrix forbids a persona from seeing; count leaks.

### 3. If you can specify the check as string-matching, you've already written the program — let a program run it. (F4)
The Jun 1 Traceability Gates section is the crown jewel *and* the specimen: "a **mechanical** check — string-match the trace IDs, no judgment — **hard-blocks** the handoff." That's a complete spec for a 40-line script, assigned instead to the LLM on the honor system. The determinism ladder, strongest rung first: schema validation → script with exit code → hook → REQUIRED template slot → prompt instruction → persona vibe. Engineering an agent stack largely means walking each behavior *up* that ladder. "Mechanical" must name an artifact, not an adjective. Prompts are for judgment; scripts are for invariants.

### 4. No eval, no engineering. (F3)
Without versioned prompts + a frozen task suite + captured outcomes, "the squad works better now" is unfalsifiable — you can't distinguish your orchestration's contribution from the base model's, or notice that one harness runs a different system than the other (exactly what happened). Minimum rig: ~5–20 tasks, deterministic checks where possible, LLM judge with a rubric (spot-checked) where not, 3 reps, cost captured, every row stamped with the prompt SHA. Corollary: **baseline before you fix** — which is why the broken port stays untouched until it's measured.

### 5. Policy belongs in the layer that can enforce it. (F5)
The model-routing table and reasoning policy are correct ideas placed where they're unenforceable (Copilot prose — the user picks the model) and absent where they're enforceable (Claude agent frontmatter: `model:`, effort, `tools:`). Same lesson as #3, one level up: a routing table the runtime can't execute is a wish. Also: never pin model *names* in design prose ("Sonnet 4.6, GPT-5.4" is already rotting) — pin capability tiers, bind names in per-harness config. And effort policy must respect the billing model it runs under: flat-max reasoning is rational on flat-rate Enterprise Copilot and waste on metered Pro.

### 6. Inter-agent artifacts are APIs. (F6)
The artifact architecture (project folders, CONTEXT.md anchor, decisions.md, registry) is genuinely good *design* — and still failed in practice (registry never created; two conventions coexisting; byte-identical specs under two ticket names) because there's no *contract*: no frontmatter schema, no validator, no explicit addressing, "latest"-file fallbacks. A folder structure without a validator is a style guide. Schema, one writer, explicit paths, a checker — same as any API.

### 7. A prompt system deployed to two places is a distributed system. (F1, F7)
Four copies, two lineages, edits flowing deploy-ward (live `.github/` ahead of installer assets), a `.bak` file as version control, an installer that would roll back the best lineage and whose manifest omits Sentinel entirely. The moment text exists in two places you need what distributed systems need: one canonical writer, edits flowing source → deploy only, a sync mechanism, and a parity alarm (`check-sync.sh`: 14 failures on first run — drift detection latency dropped from "months, by accident" to "one command"). Re-baseline against your harnesses on a schedule too: platforms grow primitives under your scaffolding (Claude's real subagents arrived; the port never noticed).

### 8. Claims inherit the scope of their evidence. (the reviewer's own error)
v1 of this review declared "the knowledge layer doesn't exist anywhere on this machine" after searching the Claude-side universe only — `.github/skills/` (a Copilot convention) was never checked. The claim was scoped "anywhere"; the evidence was scoped "the places Claude Code reads." Nick's one-line correction collapsed a CRITICAL finding into a *different* CRITICAL finding. The discipline: before asserting nonexistence, enumerate the universes you searched and say *those* — and when a system spans ecosystems, the search must span them too. (This is also why "tests pass" must state *which* tests ran.) A reviewer that states evidence scope is corrected in minutes; one that overclaims is trusted less on everything else.

---

## The meta-lesson about AI-assisted building (revised)

The squad's prose is not the problem — the AI-assisted design work produced genuinely advanced ideas (visibility matrix, trace chain, disjoint dual review). What's missing is what a senior engineer adds *around* any implementation, regardless of who typed it: version control, deployment, enforcement, observability, tests. Two sharper corollaries from the corrected picture:

1. **AI assistance is strongest at the specification layer and silent at the systems layer.** It happily writes "Vivaldi runs a mechanical gate" and feels done; nothing pushes back that no gate exists. When you delegate building, you must still own the checklist: *what happens when this file is missing / this step is skipped / this claim is false / these copies disagree?*
2. **Design ambition must be checked against harness capability.** The squad specifies runtime semantics (parallel isolated reviewers, per-subtask model switching) its primary harness cannot deliver — plausible-sounding architecture unmoored from the execution substrate. Before adopting a designed mechanism, ask: *which runtime feature makes this true?* If none, it's documentation of an intention.

## Learn-by-doing path (ordered, each step produces evidence)

1. **Run `evals/check-sync.sh`** — you already have your first number (14). Watch it hit 0 as you fix F7/F1. (P1, P7)
2. **Git-init `10x-squad/`, adopt the Jun 1 lineage into assets, fix the installer manifest** — one hour, converts your best work from "unversioned floating folder" to source of truth. (P7)
3. **Baseline the suite** on both systems as-is. (P4)
4. **Write `gate-trace.py` from the design's own Traceability Gates spec** — the design already wrote your requirements doc. Feel the difference between "mechanical" as adjective and as artifact. (P3)
5. **Run the seeded-bug + isolation-probe A/B** — in-window personas vs. real read-only subagents, same skill text. Likely your first marked, quantified improvement, and it settles P2 empirically. (P2)
6. **Rebuild one skill test-first** per `superpowers:writing-skills` (Cobalt: does "zero findings = failure" prevent rubber-stamping or *cause* fabricated findings? 5 reps against a no-guidance control). (P4, F8)
7. Then the full v2 in [ARCHITECTURE.md](ARCHITECTURE.md) §4.

## Canonical reading (short list, high signal)

- **Anthropic — "Building Effective Agents"** — workflows vs. agents; simplicity ratchet; orchestrator-workers; evaluator-optimizer.
- **Anthropic — "Effective Context Engineering for AI Agents"** — attention budget; compaction; just-in-time retrieval. (Your lean-header/tiered-reads design is validated here — it needs real invocation boundaries to bind.)
- **Anthropic — "How We Built Our Multi-Agent Research System"** — effort scaling, token-spend-vs-performance, parallel tool use, orchestrator task descriptions.
- **Claude Code docs: Subagents, Hooks, Skills, Headless mode** — the primitives that make the Claude deployment the natural *reference implementation* of your own design.
- **GitHub Copilot docs: custom agents (`.agent.md`) + Agent Skills** — know exactly which runtime semantics the primary harness does and doesn't provide; P2 hinges on it.
- **superpowers `writing-skills`** (installed) — TDD for process documentation; descriptions = triggers only; micro-testing wording.
- Zheng et al. 2023, *"When 'A Helpful Assistant' Is Not Really Helpful"* — persona prompts alone don't buy correctness.

*v2 written 2026-07-12 after Nick's correction, against `~/.claude` baseline `ae14ae7` and the live Jun 1 Copilot lineage. When you disagree with a claim here, good — design the eval that settles it.*
