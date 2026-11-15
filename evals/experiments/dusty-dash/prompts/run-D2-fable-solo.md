# Run D2 — solo build (Fable 5.2, high effort)

> Before pasting: start a **new session** in the workspace root, set the model to **Fable 5.2** and effort to **high**. Paste everything below the line. When it finishes, type `explain my usage` in that session and copy the token total into the score sheet.

---

You are the only builder of a small game. Plan it, build it, look at it running, test it, and fix what you find — all in this one session. Do not use sub-agents or delegate any part of the work.

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

- Work only in `experiments/dusty-dash/run-D2/` under this workspace. Create it, run `git init` there, and commit as you go. Local commits only: no GitHub repository, no push, no Jira, no Codex.
- Build from the brief alone. Do not open, list or read any other folder in this workspace — other builds of this game exist here and reading them would spoil the measurement. Do not consult memory notes about earlier runs.
- First action: run `date -u +%FT%TZ` and write the result as the start time at the top of `RUN-LOG.md` in the run folder. Last action: run it again and write the end time.
- Do not stop to ask me questions. Make the call yourself and note it in `RUN-LOG.md`.

## What to hand back

Keep `RUN-LOG.md` in the run folder with: start and end time; every defect you found and how you found it (test, bot, looking at the running game); anything you could not verify yourself (for example audio by ear, a real gamepad) stated plainly as not verified; and how to start the game. Finish with a five-line summary in chat. Do not claim anything works that you did not run and see.
