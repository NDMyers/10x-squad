# 10x-Squad — Architecture: Designed vs. Deployed vs. Target (v2, corrected)

Diagrams are Mermaid — GitHub and VS Code (with Mermaid preview) render them natively.
Evidence for every claim is cited in [REVIEW.md](REVIEW.md). v1 of this file diagrammed the Claude-side stubs as if they were the system; this version diagrams the real thing.

---

## 1. The pipeline as designed (live Copilot lineage, Jun 1)

```mermaid
flowchart TD
    U[User task] --> V["Vivaldi (orchestrator)\nre-anchoring rule · todo schema · context budget"]
    V --> T{"TRIAGE\n5 tiers · 5 ambiguity signals\n(2+ signals → upgrade)"}
    T -->|Trivial| LIN0[Linus only → Vivaldi verifies]
    T -->|Lite| LITE[inline spec → Linus → Cobalt]
    T -->|"Standard (clear)"| INTAKE
    T -->|"Standard (ambiguous)"| E["Einstein · Mode A brief\nD# decision table · lean header ≤1.5K tok"]
    T -->|Complex| EB["Einstein · Mode B\n+ Arch Decision Brief + PRD Seed"]
    EB --> UGATE{user confirms}
    E --> INTAKE
    UGATE --> INTAKE
    INTAKE["INTAKE (Vivaldi)\nproject folder · CONTEXT.md · PROJECTS.md row"]
    INTAKE --> TG1{{"trace gate: every D# carried\n'mechanical, hard-block'"}}
    TG1 --> P["Peter · 5-section spec\nAC# ← D# citations · Sensitive Surface flag\nDELIBERATION_DISPUTE → Einstein, max 1"]
    P --> TG2{{"trace gate: every D#\nconsumed or deferred"}}
    TG2 --> L["Linus · build\nchangelist cites AC#/D#\nrubocop self-check, max 2 fix cycles"]
    L --> TG3{{"trace gate: every AC#\nsatisfied by a changelist entry"}}
    TG3 --> C["Cobalt · correctness/spec/perf\nindependent lint · coverage gate"]
    TG3 -.->|"sensitive surface OR Complex"| SEN["Sentinel · security/data-integrity\n'parallel, own isolated context'\ndisjoint domain from Cobalt"]
    C & SEN --> MERGE{"both APPROVE?\nSPEC_DISPUTE → Peter (max 1)\nREQUEST_CHANGES → Linus (max 2)"}
    MERGE --> R["Ralph · tests\nAC→test mapping · no fabrication\nFAILURES → Linus (max 2)"]
    R --> DEL["DELIVER\nCONTEXT.md COMPLETE · registry update"]
```

This is a genuinely advanced design: tiered routing with observable predicates, a decision-traceability chain with hard-block gates, disjoint dual review, bounded dispute channels, and context contracts (visibility matrix + lean-header artifact convention). The critique is **not** the design — it's that the boxes marked `{{…}}` and the words "isolated," "parallel," "mechanical," and "hard-block" have no runtime mechanism behind them on either harness.

---

## 2. What is actually deployed (the split brain)

```mermaid
flowchart TD
    subgraph SRC["'Source of truth' — 10x-squad/ npm installer (May 8, NOT a git repo)"]
        A[assets: Vivaldi + 5 skills\nno Sentinel in manifest]
    end
    subgraph LIVE["LIVE — Accrualify/.github (Jun 1, freshest, unversioned, .bak = history)"]
        LV[Vivaldi 21KB + 6 skills incl. Sentinel\n+ trace gates]
    end
    subgraph UP["Upstream — corpay-agents repo (May 8)"]
        UPC[Vivaldi + 5 skills, stale]
    end
    subgraph CLAUDE["Claude Code port — ~/.claude/commands (May 10)"]
        ST["5 thin stubs\nreference ~/.claude/skills/10x-* \n(wrong paths AND wrong names)"]
        MISS["❌ ~/.claude/skills/10x-*: never installed"]
        IMP["→ silent improvisation, 2 months\nartifacts in .10x/ (port convention)"]
        ST --> MISS --> IMP
    end
    A -->|"installer copies →\n(would ROLL BACK live edits,\nomits Sentinel)"| LIVE
    A -->|copied May 8| UP
    LIVE -.->|"edits made HERE,\nnever flow back"| A
    A -. "hand-written port, May 10,\nnever regenerated" .-> ST

    COP["Copilot session\n(one context window)"] --> LV
    LV --> SIM["personas simulated in ONE window:\nvisibility matrix unenforceable,\n'parallel Sentinel' sequential,\ngates run on the honor system\nartifacts in 10x-squad-artifacts/\n(PROJECTS.md: never created)"]

    style MISS fill:#7f1d1d,color:#fff
    style IMP fill:#7f1d1d,color:#fff
    style SIM fill:#7f1d1d,color:#fff
```

**First measurement (2026-07-12), `evals/check-sync.sh`: 14 parity failures** — 6/6 skills drifted from installer assets and upstream, live Vivaldi ahead of its own source, Sentinel absent from the installer manifest, 6 dangling references in the Claude port.

The inversion to internalize: **the design assumes isolation and parallelism its primary harness (Copilot, one-window custom agents) cannot mechanically provide — while the harness that provides both natively (Claude Code: subagents, tool scoping, model routing, parallel dispatch) runs a stale stub port that uses none of it.**

---

## 3. Context flow (the part the design gets right — keep it)

```mermaid
flowchart LR
    BRIEF["brief.md\nLean Header ≤1.5K tok\n(D# table, recommendation)"] -->|default read| SPEC["spec.md\n5 sections, AC# ← D#"]
    BRIEF -.->|"Appendix: pulled ONLY on\nDELIBERATION_DISPUTE"| SPEC
    SPEC -->|"lean sections only"| BUILD["Linus\nchangelist AC#-cited"]
    SPEC -->|"lean + diff"| REV["Cobalt / Sentinel\n'context rot degrades recall'"]
    SPEC -->|"AC + edge cases ONLY"| TEST[Ralph]
    CTX["CONTEXT.md\nper-project resumption anchor"] -.-> BUILD & REV & TEST
```

Tiered reads, pointer-based cross-references, appendix-on-dispute, per-consumer slicing — this is textbook context engineering. It only *works* if each consumer is a separate invocation whose input you control (see §4); inside one window it's aspiration.

---

## 4. Target architecture (v2)

```mermaid
flowchart TD
    subgraph SOT["Single source of truth: 10x-squad/ (git repo)"]
        ASSETS["assets/ (adopt Jun 1 lineage)\n+ pressure-test suite per skill"]
        INST["installer: targets\n.github/ (Copilot) AND .claude/ (Claude Code)\nnames/paths/conventions match by construction"]
        ASSETS --> INST
    end
    INST --> GH["Copilot deploy\n(simulated personas — honest about it:\nmatrix as guidance, user-driven model choice)"]
    INST --> CC["Claude Code deploy\nagents/*.md: real boundaries"]

    subgraph CC2["Claude Code runtime (reference implementation of the design)"]
        RTR["router: tier by observable predicates"]
        PL["planner agent\nread-only · big model"]
        BD["builder agent\nedit+test tools · mid model"]
        G1{{"gate-trace.py: D#/AC# string-match\nEXIT CODE, logged"}}
        G2{{"gate-review.sh: lint+tests run BY SCRIPT,\nstamped into artifact"}}
        RV1["cobalt agent · READ-ONLY"]
        RV2["sentinel agent · READ-ONLY"]
        RTR --> PL --> G1 --> BD --> G2
        G2 --> RV1 & RV2
        RV1 & RV2 -->|structured verdicts| MG["merge: both-approve rule\nfixes → builder (max 2, across boundary)"]
    end
    CC --> RTR
    MG --> ART[("10x-squad-artifacts/projects/…\nfrontmatter contract + validator\nexplicit paths only")]
    ART --> EV["eval loop: results.csv + prompt_sha\ncheck-sync.sh parity alarm"]
    EV -->|deltas per commit| SOT
```

| Rule | Replaces | Finding |
|---|---|---|
| Edits flow source → deploy only; parity checked by script | live-copy editing, `.bak` versioning, rollback-trap installer | F7 |
| Trace gates and review gates are programs with exit codes and logs | "mechanical… hard-block" as prose | F4 |
| Claude agents = the visibility matrix made real (dispatch payload = the matrix row) | in-window persona simulation | F2 |
| Model/effort routing in agent frontmatter (enforceable layer); tier labels, not pinned model names | advisory prose table with rotting pins | F5 |
| One artifact convention + frontmatter validator + explicit addressing | `.10x/` vs `10x-squad-artifacts/`, "latest" fallback | F6 |
| Every run emits metrics stamped with prompt SHA | nothing | F3 |
| Skills shipped with pressure-test regression suites | untested wording | F8 |

---

## 5. The improvement loop (unchanged, now with the parity alarm)

```mermaid
flowchart LR
    A["commit change in 10x-squad/ or ~/.claude"] --> S["check-sync.sh\n(parity must pass)"]
    S --> B["evals/run.sh — frozen task suite"]
    B --> C[("results.csv + prompt_sha")]
    C --> D{"deltas: pass^3 · cost/task ·\nseeded recall · gate violations ·\nisolation-probe leaks"}
    D -->|regression| E[git revert]
    D -->|improvement| F[new baseline]
    E & F --> A
```

Current state: parity **fails (14)** — which is the correct first reading. Details: [EVAL-PLAN.md](EVAL-PLAN.md).
