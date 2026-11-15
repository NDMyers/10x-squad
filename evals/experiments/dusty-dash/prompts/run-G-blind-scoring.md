# Step G — blind the builds and set up scoring

> Run this last, in a **new session** in the workspace root, after every build run has finished. Any model; low effort is fine. Paste everything below the line.

---

Prepare the finished experiment builds so I can score them without knowing which run produced which.

1. Collect the builds: every `experiments/dusty-dash/run-*/` folder (for `run-C`, export both the `pre-review` and `post-review` tags as two separate builds), plus `dusty-dash-control/` as the original solo run. Skip any run folder that has no playable `index.html` and tell me which.
2. Copy each into `experiments/dusty-dash/blind/<letter>/`, assigning letters in an order you shuffle with a random number generator. Leave out `.git`, `RUN-LOG.md`, `REVIEW.md`, `README.md`, `CONTEXT.md`, `.claude/`, `.10x-squad/`, `10x-squad-artifacts/` and anything else that names the run, the model or the method. If the game's own title screen or page title names a model or method, tell me that the blinding is imperfect for that letter, without saying which run it is.
3. Write the letter-to-run mapping to `experiments/dusty-dash/blind-key.json`. Do not print it, and do not mention any mapping in chat.
4. Start one local static server over `experiments/dusty-dash/blind/` and give me one link per letter.
5. Write `experiments/dusty-dash/scores.md` with one row per letter and these empty columns: completeness (definition-of-done items present, of 11); look (1–5); feel (1–5); bugs found in ten minutes of play (count, with a one-line note each); would I ship it (yes / no). Put the eleven definition-of-done items from `10x-squad-worktrees/product-grounded-orchestration/evals/experiments/dusty-dash/README.md` above the table as a checklist.

Then stop. When I tell you I have finished scoring, read `blind-key.json` and add three columns to `scores.md`: which run each letter was, its wall-clock time (from the start and end times in that run's `RUN-LOG.md` or `CONTEXT.md`), and a tokens column for me to fill from the `explain my usage` figures.
