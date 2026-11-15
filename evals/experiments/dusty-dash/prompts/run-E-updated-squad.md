# Run E — the updated squad (feature branch, Solo shape)

This run uses the squad itself, installed from the `feat/product-grounded-orchestration` branch.

## Setup

Already done (repeat only if the branch changes):

- The branch build is installed in `experiments/dusty-dash/run-E/`, which is its own git repository so that only this copy of the squad loads there. To refresh it after further branch changes, from the workspace root:

  ```bash
  node 10x-squad-worktrees/product-grounded-orchestration/bin/10x-squad.js install --harness claude -d experiments/dusty-dash/run-E
  ```

- Global routing for the Claude desktop app sends the builder and the tester to `sonnet` at `high` effort for standard work, the same builder as run A.

Left for you:

1. Start a **new session whose working folder is `experiments/dusty-dash/run-E`** (the squad's skills load from the session's own folder). Set the session model to **Fable 5.2**, effort **high**: that is Vivaldi, the orchestrator.
2. Type `/10x-squad`, wait for Vivaldi's introduction, and paste everything below the line.
3. Afterwards type `explain my usage` and copy the token total into the score sheet; the per-dispatch figures are in the project's `cost.md`.

---

Before triage, check that the right build of the squad loaded: your own instructions must contain a section titled "What a Gate Proves", and the `10x-linus` agent's description must say it flags every deviation from the spec. If either is missing, an older squad loaded instead: stop and tell me, and do nothing else.

Build the product below with the squad. Treat it as one deliverable.

## The brief (identical for every run)

**Dusty Dash** — a complete first stage of a classic 8-bit style side-scrolling platformer, as close as possible to the classic run-and-jump formula in mechanics, feel and scope. All content is original: the character (Dusty the dog), enemies, pixel art, chiptune music and level layout.

Definition of done:

1. Title menu, stage intro card, pause, game over and stage-clear screens
2. HUD: score, collectibles, stage, timer, lives
3. Momentum-based run / jump physics with variable jump height and a run button
4. A stompable walker enemy and a shelled enemy whose shell can be kicked
5. Breakable blocks, mystery blocks, a hidden block, a multi-collectible block
6. Power-ups: grow, projectile, invincibility, extra life
7. Tunnels with a hidden underground bonus room
8. Pits, stairs, a checkpoint, an end-of-stage goal with height bonus and time tally
9. Original chiptune soundtrack (title, overworld, underground, invincible, hurry-up, clear, death, game over) and sound effects, synthesised at runtime
10. Keyboard and gamepad input; runs in any modern browser with no install
11. Automated tests plus a headless bot that proves the stage is completable

Out of scope: additional stages; any copied third-party assets, characters, music or level layouts. Everything must be original work.

## Ground rules

- Work only in this folder. Run `git init` here and commit as you go. Local commits only: no GitHub repository, no push, no Jira, no Codex.
- Build from the brief alone. Do not open, list or read any folder outside this one — other builds of this game exist in the parent workspace and reading them would spoil the measurement.
- A person will see, hear and operate the result, so the spec must carry experience criteria: completeness, look, feel and polish, threshold 4 of 5 each.
- First action: run `date -u +%FT%TZ` and record it as the start time in the project's `CONTEXT.md`. At delivery, record the end time the same way.
- Do not stop to ask me questions unless the pipeline requires a user checkpoint. Make the call and record it.

## What to hand back

Your normal DELIVER report by evidence class, including the "Not verified by observation" list and the cost totals. Also tell me, in three lines: the shape and tier you chose and why, how many dispatches and revision cycles the run took, and any point where the pipeline's rules got in the way of a better product.
