# Run C — Fable solo, one Opus product review, one fix pass

> Before pasting: start a **new session** in the workspace root, set the model to **Fable 5.2** and effort to **high**. Paste everything below the line. When it finishes, type `explain my usage` and copy the token total into the score sheet. This run yields two builds to score: the `pre-review` and `post-review` tags.

---

You are the only builder of a small game. The run has three phases; do them in order.

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

- Work only in `experiments/dusty-dash/run-C/` under this workspace. Create it, run `git init` there, and commit as you go. Local commits only: no GitHub repository, no push, no Jira, no Codex.
- Build from the brief alone. Do not open, list or read any other folder in this workspace — other builds of this game exist here and reading them would spoil the measurement. Do not consult memory notes about earlier runs.
- **Phase 1 — build alone.** Build the whole game as above with no sub-agents. When you believe it is done, commit and tag the commit `pre-review`.
- **Phase 2 — one clean-context product review.** Start exactly one sub-agent with the `opus` model at high effort. Give it only: the brief above, the run folder path, and how to start the game. Do not tell it anything about how you built the game, what you are proud of, or what you suspect is weak. Its instructions: use the running game the way a player would (serve it, drive it with a headless browser or the bot, view screenshots of every screen and of the sprites enlarged), then grade four criteria from 1 to 5 with a threshold of 4 each — completeness against the eleven definition-of-done items, look, feel, polish — and list findings as `what a player meets → what the fix must achieve`, each with the steps that showed it. It must not read your commit messages or `RUN-LOG.md`, must not edit files, and must say plainly which criteria it could not judge (for example audio) instead of guessing. Save its report verbatim as `REVIEW.md`.
- **Phase 3 — one fix pass.** Fix what the review found, in this session, re-running the game to confirm each fix. Commit and tag `post-review`. One pass only: do not request a second review.
- In `RUN-LOG.md` record the time at each tag, the review's grades, which findings you fixed, which you declined and why, and the review sub-agent's reported token usage.
- First action: run `date -u +%FT%TZ` and write the result as the start time at the top of `RUN-LOG.md` in the run folder. Last action: run it again and write the end time.
- Do not stop to ask me questions. Make the call yourself and note it in `RUN-LOG.md`.

## What to hand back

Keep `RUN-LOG.md` in the run folder with: start and end time; every defect you found and how you found it (test, bot, looking at the running game); anything you could not verify yourself (for example audio by ear, a real gamepad) stated plainly as not verified; and how to start the game. Finish with a five-line summary in chat. Do not claim anything works that you did not run and see.
