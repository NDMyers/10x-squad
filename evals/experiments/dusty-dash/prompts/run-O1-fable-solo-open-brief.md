# Run O1 — solo build on an open brief (Fable 5.2, high effort)

> Runs A–E all received an eleven-item feature checklist that called the game "small". The original solo build received an open-ended request instead and came out clearly ahead of its own repeats. This run repeats the solo build with the open request, to test whether the checklist capped the result. O2 is an identical second run in `run-O2/` on port 5222.
>
> Before pasting: start a **new session** in the workspace root, set the model to **Fable 5.2** and effort to **high**. Paste everything below the line.

---

I want you to single-handedly plan, implement, review and test your own creation of a classic 8-bit side-scrolling platformer.

The epic is the first stage of the game in its entirety: menus, music, gameplay, the whole shebang. Make it as close as possible to the classic run-and-jump formula in mechanics, feel and scope, with every piece of content your own. The game is called Dusty Dash and its hero is Dusty the dog; the enemies, pixel art, chiptune music and level layout are all original, with nothing copied from any existing game.

Do it all yourself, with no sub-agents. Continuously iterate to completion. When you are done I will play it side by side against other builds of the same game and judge which is the better product.

Housekeeping:

- Work only in `experiments/dusty-dash/run-O1/` under this workspace. Create it, run `git init` there, and commit as you go. Local commits only: no GitHub repository, no push, no Jira, no Codex.
- Do not open, list or read any other folder in this workspace, and do not consult memory notes about earlier runs. Other builds of this game exist here and I want yours to be your own.
- The game must run from a plain static file server with `index.html` at the top of the run folder and no build step. If you start a local server to look at it, use port 5221.
- First action: run `date -u +%FT%TZ` and write the result as the start time at the top of `RUN-LOG.md` in the run folder. Last action: run it again and write the end time. Also list there anything you could not verify yourself.
- Do not stop to ask me questions. Make the call yourself.
- When you finish, stop any server you started and close any browser tab you opened, so no game music keeps playing.
