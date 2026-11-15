# Run E2 — the updated squad on an open brief

Run E gave the squad an eleven-item feature checklist. Its build landed mid-pack: mechanically sound, visually thin. This run gives the same squad the open-ended request the original solo build received, to test whether the squad carries an owner's ambition through its spec step or reduces it to a list.

Two things differ from run E, and only the first is under test:

1. The brief is the open request below, with no definition-of-done list.
2. To hold cost down, the tester runs once, after the reviewer approves. In run E the tester ran four times, used about a quarter of the sub-agent tokens and found no defect.

The squad installed in `experiments/dusty-dash/run-E2/` also includes the review-gate fix that run E lacked, which removes one corrective cycle and does not change the product.

## Setup

Already done: the branch build is installed in `experiments/dusty-dash/run-E2/`, its own git repository. Builder and tester route to `sonnet` at `high` effort, as in run E.

Start a **new session whose working folder is `experiments/dusty-dash/run-E2`**, model **Fable 5.2**, effort **high**. Type `/10x-squad`, wait for Vivaldi's introduction, and paste everything below the line.

---

Before triage, check that the right build of the squad loaded: your own instructions must contain a section titled "What a Gate Proves", and the `10x-linus` agent's description must say it flags every deviation from the spec. If either is missing, an older squad loaded instead: stop and tell me, and do nothing else.

Build the product below with the squad. Treat it as one deliverable.

## The request

I want the squad to plan, implement, review and test its own creation of a classic 8-bit side-scrolling platformer.

The epic is the first stage of the game in its entirety: menus, music, gameplay, the whole shebang. Make it as close as possible to the classic run-and-jump formula in mechanics, feel and scope, with every piece of content original. The game is called Dusty Dash and its hero is Dusty the dog; the enemies, pixel art, chiptune music and level layout are all original, with nothing copied from any existing game.

Continuously iterate to completion. When it is done I will play it side by side against other builds of the same game and judge which is the better product.

## Ground rules

- Work only in this folder. Commit as you go. Local commits only: no GitHub repository, no push, no Jira, no Codex.
- Build from the request alone. Do not open, list or read any folder outside this one — other builds of this game exist in the parent workspace and I want this one to be the squad's own.
- A person will see, hear and operate the result, so the spec must carry experience criteria: completeness, look, feel and polish, threshold 4 of 5 each.
- The game must run from a plain static file server with `index.html` at the top of this folder and no build step. Any local server uses port 5223.
- To hold cost down: dispatch the tester once, after the reviewer approves. Revisions before that go back to the reviewer alone.
- First action: run `date -u +%FT%TZ` and record it as the start time in the project's `CONTEXT.md`. At delivery, record the end time the same way.
- Do not stop to ask me questions unless the pipeline requires a user checkpoint. Make the call and record it.
- When you finish, stop any server that was started and close any browser tab that was opened, so no game music keeps playing.

## What to hand back

Your normal DELIVER report by evidence class, including the "Not verified by observation" list and the cost totals. Also tell me, in three lines: the shape and tier you chose and why, how many dispatches and revision cycles the run took, and any point where the pipeline's rules got in the way of a better product.
