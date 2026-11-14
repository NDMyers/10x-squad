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
  }
});

test('persona skills carry their half of the product-grounding contract', () => {
  const skill = (name) => fs.readFileSync(path.join(packageRoot, 'assets', 'skills', name, 'SKILL.md'), 'utf8');

  const linus = skill('10x-linus-build');
  assert.match(linus, /^## Deviations$/m);
  assert.match(linus, /^## Observed$/m);
  assert.match(linus, /NOT_OBSERVED/);
  assert.doesNotMatch(linus, /No spec deviation/);

  const cobalt = skill('10x-cobalt-review');
  assert.match(cobalt, /^## Product Check$/m);
  assert.match(cobalt, /PRODUCT_DEFECT/);
  assert.match(cobalt, /NOT_RUN/);

  const peter = skill('10x-peter-spec');
  assert.match(peter, /^## Experience Criteria/m);
  assert.match(peter, /Brief form/);

  const ralph = skill('10x-ralph-test');
  assert.match(ralph, /fail for the right reason/i);
  assert.match(ralph, /## Not Covered/);
});
