# Run E4 — the builder ladder: Opus builder at Standard (clear)

Run E3 is the build the owner ranked best: Fable builder, one-page spec, request passed to the builder word for word. This run repeats E3 with the routing the owner proposes to make the global default. Against E3 it changes two routing cells:

1. **Builder model.** At Standard (clear), the tier E2 and E3 both ran at, the builder runs on Opus 5.5 at high effort instead of Fable. The ladder is Sonnet at Trivial and Lite, Opus at Standard (clear), Fable at Standard (ambiguous) and Complex. Only this folder is affected: `experiments/dusty-dash/run-E4/.10x-squad/model-routing.json` overrides the global routing for this workspace.
2. **Tester effort.** The tester (Sonnet) runs at medium effort at Standard instead of high. Spec writer (Fable) and reviewer (Opus) are unchanged.

As in E3, the spec is held to one page, the builder is handed the owner's request word for word, and the tester runs once, after the reviewer approves. The squad installed here is the released one, which now carries those three rules itself; E3's squad was told them by this prompt only.

## Setup

Already done: the released squad (`main` at `ce88497`) is installed in `experiments/dusty-dash/run-E4/`, its own git repository, with the routing override above.

Start a **new session whose working folder is `experiments/dusty-dash/run-E4`**, model **Fable 5.2**, effort **high**. Type `/10x-squad`, wait for Vivaldi's introduction, and paste everything below the line.

---

Before triage, check that the right build of the squad loaded: your own instructions must contain a section titled "What a Gate Proves", and the `10x-linus` agent's description must say it flags every deviation from the spec. If either is missing, an older squad loaded instead: stop and tell me, and do nothing else. Once you have triaged, resolve the builder's and the tester's routing for that tier before the first dispatch and record the model, effort and scope each reports; the scope must be `workspace`, and if it is not, stop and tell me. This run is meant to exercise the Standard (clear) cells, where the builder is `opus` at high effort and the tester is `sonnet` at medium. If your triage lands on another tier, carry on with what that tier resolves to and say so in the hand-back.

Build the product below with the squad. Treat it as one deliverable.

## The request

I want the squad to plan, implement, review and test its own creation of a classic 8-bit side-scrolling platformer.

The epic is the first stage of the game in its entirety: menus, music, gameplay, the whole shebang. Make it as close as possible to the classic run-and-jump formula in mechanics, feel and scope, with every piece of content original. The game is called Dusty Dash and its hero is Dusty the dog; the enemies, pixel art, chiptune music and level layout are all original, with nothing copied from any existing game.

Continuously iterate to completion. When it is done I will play it side by side against other builds of the same game and judge which is the better product.

## Ground rules

- Work only in this folder. Commit as you go. Local commits only: no GitHub repository, no push, no Jira, no Codex.
- Build from the request alone. Do not open, list or read any folder outside this one — other builds of this game exist in the parent workspace and I want this one to be the squad's own.
- Keep the plan loose. The spec is one page: the goal, the experience criteria (completeness, look, feel and polish, threshold 4 of 5 each), the hard constraints, and only those acceptance criteria whose absence I would notice as a player. Everything else is the builder's decision.
- Give the builder "The request" section above word for word, alongside the spec. The spec is the floor; my request is the bar.
- The game must run from a plain static file server with `index.html` at the top of this folder and no build step. Any local server uses port 5225.
- To hold cost down: dispatch the tester once, after the reviewer approves. Revisions before that go back to the reviewer alone.
- First action: run `date -u +%FT%TZ` and record it as the start time in the project's `CONTEXT.md`. At delivery, record the end time the same way.
- Do not stop to ask me questions unless the pipeline requires a user checkpoint. Make the call and record it.
- When you finish, stop any server that was started and close any browser tab that was opened, so no game music keeps playing.

## What to hand back

Your normal DELIVER report by evidence class, including the "Not verified by observation" list and the cost totals. Also tell me, in three lines: the shape and tier you chose and why, how many dispatches and revision cycles the run took, and any point where the pipeline's rules got in the way of a better product.
