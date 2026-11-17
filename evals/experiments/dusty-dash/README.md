# Dusty Dash experiments

One squad run and one solo run of a small game is a strong hint, not proof: the two runs differed in model, effort, structure and art brief at once. These runs hold the brief constant and change one thing at a time. Each prompt in `prompts/` is self-contained: open a new session, set the model named at the top of the file, and paste everything below its line.

## The runs

| Run | Prompt | Session model | What it changes | Question it answers |
|---|---|---|---|---|
| A | `run-A-sonnet-solo.md` | Sonnet 5.5, high | Model only | Was it the model or the structure? |
| B | `run-B-sonnet-with-advisor.md` | Sonnet 5.5, high | Sonnet drives, Fable advises when stuck | Does the advisor pattern close the gap to a Fable solo build, and at what cost? |
| C | `run-C-fable-solo-plus-review.md` | Fable 5.2, high | Adds one Opus product review and one fix pass | Does a clean-context product review add quality on top of a solo build? |
| D1, D2 | `run-D1-fable-solo.md`, `run-D2-fable-solo.md` | Fable 5.2, high | Nothing: repeats of the original solo run | How much does the result vary from run to run? |
| E | `run-E-updated-squad.md` | Fable 5.2, high (orchestrator) | The squad from this branch, Solo shape, Sonnet builder at high | Does the updated squad close the gap, and what does its structure still cost? |
| F | `run-F-false-positive-audit.md` | Opus 5.5, high | No build: audits the two existing builds | How much does a green test suite tell you about each build? |
| G | `run-G-blind-scoring.md` | Any | No build: blinds the results | Lets you score without knowing which run is which |

### Round two: the open brief

Runs A to E all carry the same brief, and that brief turned out to be the problem: it is an eleven-item feature list that calls the game "small", where the original solo build had been given an open-ended request. Every round-one build met the list and stopped. Round two repeats the arrangements worth repeating with the open request and no list. Results for both rounds are in `docs/product-grounded-orchestration.md`.

| Run | Prompt | Session model | Arrangement |
|---|---|---|---|
| O1, O2 | `run-O1-fable-solo-open-brief.md` (O2 is the same prompt with `run-O2/` and port 5222) | Fable 5.2, high | Solo build, open brief |
| E2 | `run-E2-updated-squad-open-brief.md` | Fable 5.2, high (orchestrator) | Squad from this branch, Sonnet builder, tester once |
| E3 | `run-E3-upgraded-squad.md` | Fable 5.2, high (orchestrator) | As E2 with a Fable builder (workspace routing file in the run folder), a one-page spec, and the request passed to the builder word for word |
| E4 | `run-E4-ladder-routing.md` | Fable 5.2, high (orchestrator) | As E3 with the released squad, an Opus builder at high effort and the tester at medium effort (workspace routing file in the run folder) |

A squad run's opening message must begin with the typed `/10x-squad` command; the orchestrator skill cannot be loaded by a model on its own.

### Running round one

A, B, C, D1, D2 and F are independent and can run at the same time in separate sessions opened on the workspace root. E runs in its own folder, `experiments/dusty-dash/run-E/`, where this branch's squad is already installed; its file says how to start it. Run G after the build runs finish.

Run F needs no new build and is the most direct test of the false-positive claim, so start it first. It is slow rather than expensive: build 1's suite takes about five minutes per run and the audit runs it sixteen times.

## Recording

- **Time**: each run writes its own start and end time with `date -u`.
- **Tokens**: when a run finishes, type `explain my usage` in that session and note the total. Runs B, C and E also log their sub-agent usage.
- **Not verified**: every run must list what it could not check itself. Read that list before you play; it tells you where to look.

## Score sheet

Score blind (step G) after ten minutes of play per build. Your score is the measure that counts.

| Criterion | Scale | How to judge |
|---|---|---|
| Completeness | 0–11 | One point per definition-of-done item that is present and works |
| Look | 1–5 | Do the sprites, tiles and screens read clearly and hang together? |
| Feel | 1–5 | Do the controls respond, and does a jump land where you aimed? |
| Bugs in ten minutes | count | Anything a player would notice going wrong |
| Would ship | yes / no | Your overall call |

Definition of done (the eleven completeness items):

1. Title menu, stage intro card, pause, game over and stage-clear screens
2. HUD: score, collectibles, stage, timer, lives
3. Momentum-based run / jump physics with variable jump height and a run button
4. A stompable walker enemy and a shelled enemy whose shell can be kicked
5. Breakable blocks, mystery blocks, a hidden block, a multi-collectible block
6. Power-ups: grow, projectile, invincibility, extra life
7. Tunnels with a hidden underground bonus room
8. Pits, stairs, a checkpoint, an end-of-stage goal with height bonus and time tally
9. Original chiptune soundtrack and sound effects, synthesised at runtime
10. Keyboard and gamepad input; runs in any modern browser with no install
11. Automated tests plus a headless bot that proves the stage is completable

## What each result decides for the squad

Read D first: it sets how big a difference has to be before it means anything.

| Result | What it means | Change to the squad |
|---|---|---|
| D1, D2 and the original solo build score within a point of each other | Single runs are informative | Treat the differences below as real |
| D1 and D2 differ by as much as the arms do | Run-to-run noise is as large as the effect | Repeat A and E before changing any default |
| A scores near the Fable solo builds | Structure was the main loss, not the model | Keep Solo as the default shape; suggest a cheaper builder at high effort in the wizard |
| A scores well below, B closes most of the gap | Judgement can be borrowed | Make the stuck-builder consult a first-class step and record consults in `cost.md` |
| A and B both score well below | The builder seat needs the strong model for work judged on taste | Wizard recommends the strongest model for the Builder lane on user-facing work |
| C's `post-review` build beats `pre-review` by a point on any criterion, or loses two or more player-visible bugs | Product review earns its cost | Keep product review mandatory in Solo shape, including Lite |
| C's two builds score the same | A strong solo builder already catches what the review finds | Make product review optional below Standard |
| E scores within a point of A at no more than twice A's time and tokens | The updated squad's structure is affordable | Merge the branch; next, add Solo as its own routing tier |
| E scores below A, or costs several times more | Structure still loses quality or time | E's own report says where the rules got in the way: fix those first |
| F: build 1's far larger suite kills no more mutations than build 2's, and play finds defects in a green build | Test count was not measuring product quality | Keep Ralph's falsification and end-to-end rules as written |
| F: the large suite kills clearly more mutations | The suite was doing real work | Soften the claim; cost of the suite, not its value, was the problem |

## Fairness

- No run may read another build. The prompts forbid opening other folders; run them in fresh sessions.
- The original solo run also created a Jira epic and a GitHub repository; these runs do not, so their wall-clock is slightly flattered against it. Compare the new runs with each other first.
- The model that wrote this plan built one of the games being compared. That is why scoring is blind and yours.
