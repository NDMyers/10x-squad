'use strict';

// Product grounding: the gates must be able to tell "the trace chain is intact"
// apart from "someone ran this and it works". These tests pin the two places
// that distinction is made mechanically — the build's `## Observed` section and
// the review's `## Product Check` — and that neither changes the result for
// artifacts written before they existed.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { validateHandoff } = require('../assets/runtime/handoff-validator');
const { validateReview } = require('../assets/runtime/review-validator');
const { composeVivaldi } = require('../lib/compose');

const packageRoot = path.resolve(__dirname, '..');

const plainSpec = `
## Acceptance Criteria
1. (AC1) The stage can be finished from the title screen.
2. (AC2) A stomp removes the enemy and awards score.
`;

const spec = `${plainSpec}
## Experience Criteria
1. (Q1) Look — sprites read clearly at 1x; threshold 4/5.
2. (Q2) Feel — a jump lands where the player aimed; threshold 4/5.
`;

const changelist = `
## Changelist
- \`src/game.js\` (AC1, AC2) — Stage flow and stomp handling.
`;

function codes(result) {
  return result.errors.map((error) => error.code);
}

test('a build without ## Observed validates exactly as before when the spec names no experience criteria', () => {
  const result = validateHandoff({ spec: plainSpec, build: changelist });

  assert.equal(result.ok, true);
  assert.equal('observation' in result, false);
  assert.equal('experience_criteria' in result, false);
});

test('a spec with experience criteria blocks a build that does not say whether each was seen', () => {
  const result = validateHandoff({ spec, build: changelist });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [{ code: 'UNREPORTED_EXPERIENCE_CRITERIA', ids: ['Q1', 'Q2'] }]);
  assert.deepEqual(result.experience_criteria, ['Q1', 'Q2']);
});

test('observation reports what was seen, what was not, and what the build stayed silent on', () => {
  const build = `${changelist}
## Observed
- (AC1, Q1) OBSERVED — played title to flagpole in the browser; evidence/run-1.png
- (Q2) NOT_OBSERVED — no input device in this session; jump arcs checked by test only
`;
  const result = validateHandoff({ spec, build });

  assert.equal(result.ok, true);
  assert.deepEqual(result.observation, {
    declared: true,
    observed: ['AC1', 'Q1'],
    not_observed: ['Q2'],
    unreported: ['AC2'],
  });
});

test('an honest NOT_OBSERVED satisfies the gate; the gate records it rather than hiding it', () => {
  const build = `${changelist}
## Observed
- (Q1, Q2) NOT_OBSERVED — the app could not be launched here
`;
  const result = validateHandoff({ spec, build });

  assert.equal(result.ok, true);
  assert.deepEqual(result.observation.not_observed, ['Q1', 'Q2']);
  assert.deepEqual(result.observation.observed, []);
});

test('a criterion claimed both seen and unseen counts as unseen', () => {
  const build = `${changelist}
## Observed
- (Q1, Q2) OBSERVED — looked at the sheet
- (Q2) NOT_OBSERVED — did not play it
`;
  const result = validateHandoff({ spec, build });

  assert.deepEqual(result.observation.observed, ['Q1']);
  assert.deepEqual(result.observation.not_observed, ['Q2']);
});

test('observed entries must be well formed and cite criteria the spec defines', () => {
  const build = `${changelist}
## Observed
- (Q1, Q2) OBSERVED — looked at it
- (AC9) OBSERVED — invented criterion
- it all works great
- (AC1) OBSERVED
`;
  const result = validateHandoff({ spec, build });

  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['MALFORMED_OBSERVED_ENTRIES', 'UNKNOWN_OBSERVED_IDS']);
  assert.deepEqual(result.errors[0].lines, [3, 4]);
  assert.deepEqual(result.errors[1].ids, ['AC9']);
});

function review({ productCheck = '', findings = 'None.', verdict = 'APPROVE' } = {}) {
  return `
## Lint Check
clean
${productCheck}
## Verdict: ${verdict}

## Findings
${findings}

## Summary
ok
`;
}

const passingCheck = `
## Product Check
RUN — served the build and played it in a headless browser
- (Q1) 4/5, threshold 4 — PASS — sprites legible
- (Q2) 4/5, threshold 4 — PASS — jumps land
`;

test('a review that predates Product Check validates unchanged against a spec without experience criteria', () => {
  const result = validateReview({ spec: plainSpec, review: review() });

  assert.equal(result.ok, true);
  assert.equal(result.effective_verdict, 'APPROVE');
  assert.equal('product_check' in result, false);
});

test('a review must grade every experience criterion the spec names', () => {
  const missing = validateReview({ spec, review: review() });
  assert.equal(missing.ok, false);
  assert.deepEqual(codes(missing), ['MISSING_PRODUCT_CHECK_STATUS', 'UNGRADED_EXPERIENCE_CRITERIA']);

  const graded = validateReview({ spec, review: review({ productCheck: passingCheck }) });
  assert.equal(graded.ok, true);
  assert.equal(graded.effective_verdict, 'APPROVE');
  assert.deepEqual(graded.product_check, {
    status: 'RUN',
    grades: { Q1: 'PASS', Q2: 'PASS' },
    failed: [],
    not_graded: [],
    unverified: false,
  });
});

test('a failed experience criterion forces REQUEST_CHANGES even when the reviewer wrote APPROVE', () => {
  const productCheck = `
## Product Check
RUN — played three attempts
- (Q1) 2/5, threshold 4 — FAIL — castle is unreadable, stray specks on clouds
- (Q2) 4/5, threshold 4 — PASS — fine
`;
  const result = validateReview({ spec, review: review({ productCheck }) });

  assert.equal(result.ok, true);
  assert.equal(result.stated_verdicts.cobalt, 'APPROVE');
  assert.equal(result.effective_verdict, 'REQUEST_CHANGES');
  assert.deepEqual(result.product_check.failed, ['Q1']);
});

test('a reviewer who did not run the product cannot pass a criterion, and the approval is marked unverified', () => {
  const claimed = `
## Product Check
NOT_RUN — no browser available
- (Q1) 4/5, threshold 4 — PASS — looks fine from the code
- (Q2) NOT_GRADED — could not play it
`;
  const dishonest = validateReview({ spec, review: review({ productCheck: claimed }) });
  assert.equal(dishonest.ok, false);
  assert.deepEqual(dishonest.errors, [{ code: 'GRADED_WITHOUT_RUNNING', source: 'cobalt', ids: ['Q1'] }]);

  const honest = `
## Product Check
NOT_RUN — no browser available
- (Q1) NOT_GRADED — could not view the canvas
- (Q2) NOT_GRADED — could not play it
`;
  const result = validateReview({ spec, review: review({ productCheck: honest }) });
  assert.equal(result.ok, true);
  assert.equal(result.effective_verdict, 'APPROVE');
  assert.equal(result.product_check.unverified, true);
  assert.deepEqual(result.product_check.not_graded, ['Q1', 'Q2']);
});

test('a product finding proved by an observation blocks without naming a file', () => {
  const findings = `1. **[MAJOR]** — Stuck state (PRODUCT_DEFECT) — running build
   Dropping into the two-tile well leaves the player unable to climb out.
   Proof: Observed: walked right from spawn to column 138, dropped in, held jump for 10 s; never cleared the wall.

2. **[MAJOR]** — Look (Q1) — running build
   The castle does not read as a castle at 1x.
   Proof: Observed: evidence/castle-1x.png shows a grey block with no door or crenellation.`;
  const result = validateReview({
    spec,
    review: review({ productCheck: passingCheck, findings, verdict: 'REQUEST_CHANGES' }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.effective_verdict, 'REQUEST_CHANGES');
  assert.equal(result.counts.verified_blocking, 2);
  assert.deepEqual(result.verified_findings.map((f) => f.citations.product_defect), [true, false]);
});

test('a product finding with no observation is demoted like any other unproven finding', () => {
  const findings = `1. **[MAJOR]** — Feel (PRODUCT_DEFECT) — \`src/player/movement.js:37\`
   The jump probably feels floaty given the gravity constant.`;
  const result = validateReview({
    spec,
    review: review({ productCheck: passingCheck, findings, verdict: 'REQUEST_CHANGES' }),
  });

  assert.equal(result.effective_verdict, 'APPROVE');
  assert.deepEqual(result.demoted_findings[0].demotion_reasons, ['MISSING_OBSERVATION_PROOF']);
});

// Regression: taken from the first real review the gate saw (Dusty Dash run E).
// The reviewer bolded the grade lines and cited a contract finding against an
// experience criterion as well; the gate read no grades and demoted the MAJOR,
// turning the reviewer's REQUEST_CHANGES into APPROVE.
test('grades written with markdown emphasis are still grades', () => {
  const productCheck = `
## Product Check
RUN — headless, in Node, against the real simulation and renderer.

- **(Q1) 4/5, threshold 4 — PASS.** Every item met in the running sim.
- **Q2** — 3/5, threshold 4 — FAIL — hill strip shows a seam
`;
  const result = validateReview({ spec, review: review({ productCheck }) });

  assert.equal(result.ok, true);
  assert.deepEqual(result.product_check.grades, { Q1: 'PASS', Q2: 'FAIL' });
  assert.equal(result.effective_verdict, 'REQUEST_CHANGES');
});

test('a contract finding that also names an experience criterion is judged by the contract rules', () => {
  const findings = `1. **[MAJOR]** — Music truncation (AC1, Q2, DETERMINISTIC_BUG) — \`src/audio/director.js:19\`
   The fanfare is cut off when the state changes to clear.
   Proof: running the real sim and director, the clear track stayed selected for only 4.30 s while the fanfare lasts 8.64 s.`;
  const result = validateReview({
    spec,
    review: review({ productCheck: passingCheck, findings, verdict: 'REQUEST_CHANGES' }),
  });

  assert.equal(result.counts.demoted, 0);
  assert.equal(result.counts.verified_blocking, 1);
  assert.equal(result.effective_verdict, 'REQUEST_CHANGES');
});

test('a product finding is proved by a stated proof in the reviewer\'s own words', () => {
  const findings = `1. **[MAJOR]** — Stuck state (PRODUCT_DEFECT) — running build
   The player cannot leave the two-tile well.
   Proof: dropped in at column 138 and held jump for ten seconds in three runs; never cleared the wall.`;
  const result = validateReview({
    spec,
    review: review({ productCheck: passingCheck, findings, verdict: 'REQUEST_CHANGES' }),
  });

  assert.equal(result.counts.verified_blocking, 1);
});

test('Q-looking prose does not demote a contract finding when the spec has no experience criteria', () => {
  const findings = `1. **[MAJOR]** — Regression (AC1) — \`src/game.js:12\`
   Broken since the Q3 refactor.
   Proof: \`src/game.js:12\` is reached from start() with lives = 0.`;
  const result = validateReview({
    spec: plainSpec,
    review: review({ findings, verdict: 'REQUEST_CHANGES' }),
  });

  assert.equal(result.counts.verified_blocking, 1);
});

test('cycle 2 scope lock does not suppress an observed product regression', () => {
  const previousReview = review({
    findings: `1. **[MAJOR]** — Logic (AC2) — \`src/enemy.js:8\`
   Stomp awards no score.
   Proof: \`src/enemy.js:8\` returns before the score event.`,
    verdict: 'REQUEST_CHANGES',
  });
  const findings = `1. **[MAJOR]** — Regression (PRODUCT_DEFECT) — \`src/game.js:40\`
   The fix made the stage unfinishable.
   Proof: Observed: flagpole touch no longer ends the stage in three of three runs.`;
  const result = validateReview({
    spec,
    previousReview,
    review: review({ productCheck: passingCheck, findings, verdict: 'REQUEST_CHANGES' }),
  });

  assert.equal(result.effective_verdict, 'REQUEST_CHANGES');
  assert.equal(result.counts.demoted, 0);
});

// From run E4: the reviewer re-checked a fix, measured the product regressing
// at three window sizes, and cited the edge case and the file at fault. Being
// that specific cost the finding its exemption: the lock treated it as a new
// code complaint and the gate returned APPROVE.
test('cycle 2 scope lock does not suppress an observed regression that also cites the contract', () => {
  const previousReview = review({
    findings: `1. **[MAJOR]** — Logic (AC2) — \`src/enemy.js:8\`
   Stomp awards no score.
   Proof: \`src/enemy.js:8\` returns before the score event.`,
    verdict: 'REQUEST_CHANGES',
  });
  const findings = `1. **[MAJOR]** — Regression (AC1) — \`src/main.js\`
   The fix is exact at one window size and breaks three others.
   Proof: Observed: at ratio 1.5 in a 1280x800 window the last column of the picture is page background; the previous revision drew it.`;
  const result = validateReview({
    spec,
    previousReview,
    review: review({ productCheck: passingCheck, findings, verdict: 'REQUEST_CHANGES' }),
  });

  assert.equal(result.effective_verdict, 'REQUEST_CHANGES');
  assert.equal(result.counts.demoted, 0);
});

test('the observation exemption needs a stated observation, not a file reference', () => {
  const previousReview = review({
    findings: `1. **[MAJOR]** — Logic (AC2) — \`src/enemy.js:8\`
   Stomp awards no score.
   Proof: \`src/enemy.js:8\` returns before the score event.`,
    verdict: 'REQUEST_CHANGES',
  });
  const findings = `1. **[MAJOR]** — Old scope (AC1) — \`src/main.js:12\`
   New complaint on a file the first review did not fault.
   Proof: \`src/main.js:12\` has an old scope.`;
  const result = validateReview({
    spec,
    previousReview,
    review: review({ productCheck: passingCheck, findings, verdict: 'REQUEST_CHANGES' }),
  });

  assert.equal(result.effective_verdict, 'APPROVE');
  assert.deepEqual(result.demoted_findings[0].demotion_reasons, ['OUT_OF_CYCLE_SCOPE']);
});

// Also from run E4: every earlier review had approved, so the "previous review"
// named no blocking finding and the lock it produced was empty. An empty lock
// puts every file out of scope.
test('a previous review with no blocking finding sets no scope lock', () => {
  const previousReview = review({
    findings: `1. **[MINOR]** — Polish — \`src/hud.js:3\`
   Score is not zero-padded.`,
    verdict: 'APPROVE',
  });
  const findings = `1. **[MAJOR]** — Logic (AC1) — \`src/main.js:40\`
   The stage cannot be finished.
   Proof: \`src/main.js:40\` returns before the clear event when lives = 1.`;
  const result = validateReview({
    spec,
    previousReview,
    review: review({ productCheck: passingCheck, findings, verdict: 'REQUEST_CHANGES' }),
  });

  assert.equal(result.effective_verdict, 'REQUEST_CHANGES');
  assert.equal(result.counts.demoted, 0);
});

// The doctrine below is prose, but it is the prose every harness runs. These
// assertions pin the rules a later edit must not quietly drop.
test('every harness entrypoint carries the product-grounding rules', () => {
  for (const harness of ['copilot', 'codex', 'claude']) {
    const vivaldi = composeVivaldi(harness);
    assert.match(vivaldi, /A passing gate is not evidence that the product works/, harness);
    assert.match(vivaldi, /two builders would each need to know what the other decided/, harness);
    assert.match(vivaldi, /Not verified by observation/, harness);
    assert.match(vivaldi, /One writer per deliverable/, harness);
    assert.match(vivaldi, /cost\.md/, harness);
    // From the open-brief runs: a builder handed a checklist stops at the checklist.
    assert.match(vivaldi, /the request is the bar and the spec is only the floor/, harness);
    assert.match(vivaldi, /the user's request in their own words/, harness);
    assert.match(vivaldi, /Solo shape, Ralph runs once, after the review's effective verdict is APPROVE/, harness);
    assert.match(vivaldi, /does not cover any `Q#` in `product_check\.not_graded`/, harness);
    // From run E4: three polish passes on approved reviews, and a re-test after
    // the tester's failures that needed no second tester.
    assert.match(vivaldi, /send them \*\*once, as one batch\*\*, to the \*\*same\*\* Linus/, harness);
    assert.match(vivaldi, /go on DELIVER's list, not back to the builder/, harness);
    assert.match(vivaldi, /Solo shape, do not dispatch Ralph again\*\* for the re-test/, harness);
    assert.match(vivaldi, /Pass it only for a re-review that follows `REQUEST_CHANGES`/, harness);
  }
});

test('persona skills carry their half of the product-grounding contract', () => {
  const skill = (name) => fs.readFileSync(path.join(packageRoot, 'assets', 'skills', name, 'SKILL.md'), 'utf8');

  const linus = skill('10x-linus-build');
  assert.match(linus, /^## Deviations$/m);
  assert.match(linus, /^## Observed$/m);
  assert.match(linus, /NOT_OBSERVED/);
  assert.doesNotMatch(linus, /No spec deviation/);
  assert.match(linus, /The spec is the floor; the request is the bar/);

  const cobalt = skill('10x-cobalt-review');
  assert.match(cobalt, /^## Product Check$/m);
  assert.match(cobalt, /PRODUCT_DEFECT/);
  assert.match(cobalt, /NOT_RUN/);
  assert.match(cobalt, /Prove it with a `Proof: Observed:` line whichever ID it cites/);

  const peter = skill('10x-peter-spec');
  assert.match(peter, /^## Experience Criteria/m);
  assert.match(peter, /Brief form/);
  assert.match(peter, /The request is the bar; the spec is the floor/);
  assert.match(peter, /do not translate it into a feature checklist/);

  const ralph = skill('10x-ralph-test');
  assert.match(ralph, /fail for the right reason/i);
  assert.match(ralph, /## Not Covered/);
});

test('all harnesses distinguish real context replacement from a follow-up without weakening completion gates', () => {
  for (const harness of ['copilot', 'codex', 'claude', 'antigravity']) {
    const vivaldi = composeVivaldi(harness);
    assert.match(vivaldi, /Retain context\*\* for a short follow-up/, harness);
    assert.match(vivaldi, /work-order budget is exhausted with work left/, harness);
    assert.match(vivaldi, /not the session's historical peak/, harness);
    assert.match(vivaldi, /Save builder state first/, harness);
    assert.match(vivaldi, /new-child dispatch/, harness);
    assert.match(vivaldi, /old child has ended its work order and any in-flight writing commands have finished/, harness);
    assert.match(vivaldi, /staged, unstaged and untracked work preserved/, harness);
    assert.match(vivaldi, /do not run the BUILD-to-REVIEW transition while work remains/, harness);
    assert.match(vivaldi, /Fresh context must not advance pipeline state, clear blockers, reset retry counts/, harness);
    assert.match(vivaldi, /No progress is not a reason to reset and try again/, harness);
    assert.match(vivaldi, /Evidence shows a new, relevant finding/, harness);
    assert.match(vivaldi, /a legitimate command is still running, wait for its completion/, harness);
    assert.match(vivaldi, /Keep builder-state private to the builder and Vivaldi/, harness);

    const routing = vivaldi.slice(vivaldi.indexOf('## Model Routing'), vivaldi.indexOf('## Todo Schema'));
    assert.match(routing, /retained-or-fresh policy/, harness);
    assert.match(routing, /\(fresh context\)/, harness);
    assert.match(routing, /CONTEXT_RESET_UNAVAILABLE/, harness);
    assert.doesNotMatch(routing, /instead of starting a new one|otherwise re-dispatch with `build\.md`/, harness);
  }
});

test('builder disk memory preserves cumulative work and verifies live state before recovery', () => {
  const linus = fs.readFileSync(path.join(packageRoot, 'assets', 'skills', '10x-linus-build', 'SKILL.md'), 'utf8');
  assert.match(linus, /State: <absolute path to the saved builder-state file>/);
  assert.match(linus, /preserve its requirements here in the user's own words/);
  assert.match(linus, /Preserve earlier completed work/);
  assert.match(linus, /Decisions and failed approaches/);
  assert.match(linus, /pre-existing user changes that must be preserved/);
  assert.match(linus, /results invalidated by later edits/);
  assert.match(linus, /fresh context does not reset those counts/);
  assert.match(linus, /On fresh-context dispatch or after native compaction, read this state and the referenced request\/spec before editing/);
  assert.match(linus, /reconcile them with the saved state/);
  assert.match(linus, /report `BLOCKED:` for unresolved decisions/);
  assert.match(linus, /whole build across all work orders/);
  assert.doesNotMatch(linus, /continues you with your context intact/);
});
