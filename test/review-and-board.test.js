'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const packageRoot = path.resolve(__dirname, '..');
const cliPath = path.join(packageRoot, 'bin', '10x-squad.js');
const { validateHandoff } = require('../assets/runtime/handoff-validator');
const { validateReview } = require('../assets/runtime/review-validator');
const { renderBoard } = require('../assets/runtime/workflow-board');
const { partitionFilePlan, verifyBuild } = require('../assets/runtime/build-verifier');
const { advancePhase } = require('../assets/runtime/phase-runner');

const sampleBrief = `
## Decision Table
| ID | Decision | Rationale |
|----|----------|-----------|
| D1 | Scope payment queries to tenant. | Prevent IDOR. |
| D2 | Use fixed-precision decimal math. | Avoid rounding drift. |
`;

const sampleSpec = `
## Summary
Tenant-scoped payment calculation.

## Architecture
Applies D1 and D2 in the payment service.

## File Plan (file path + one-line change description each)
- \`app/services/payment_calculator.rb\` — Tenant-scoped decimal calculation

## Acceptance Criteria
1. (AC1 ← D1) Queries are scoped to the current tenant.
2. (AC2 ← D2) Amounts are computed with BigDecimal.

## Constraints
1. (K1 ← D1) MUST NOT query Payment records without a tenant_id predicate.
2. (K2 ← D2) MUST NOT convert monetary amounts to Float.

## Edge Cases
1. Zero-amount invoice returns 0.00 BigDecimal without dividing.
`;

const sampleBuild = `
## Changelist
- \`app/services/payment_calculator.rb\` (AC1, AC2, K1, K2 ← D1, D2) — Scopes query and uses BigDecimal.
`;

test('validateHandoff enforces K# constraints when ## Constraints section is present', () => {
  const valid = validateHandoff({
    brief: sampleBrief,
    spec: sampleSpec,
    build: sampleBuild,
  });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.constraints, ['K1', 'K2']);

  const missingK2 = validateHandoff({
    brief: sampleBrief,
    spec: sampleSpec,
    build: '## Changelist\n- `app/services/payment_calculator.rb` (AC1, AC2, K1 ← D1, D2) — Partial.\n',
  });
  assert.equal(missingK2.ok, false);
  assert.deepEqual(
    missingK2.errors.find((e) => e.code === 'UNIMPLEMENTED_CONSTRAINTS')?.ids,
    ['K2']
  );
});

test('validateReview keeps contract-cited proof-carrying findings and demotes performative nitpicks', () => {
  const review = `
## Lint Check
Clean.

## Coverage Check
Delegated to parallel Ralph verification.

## Verdict: REQUEST_CHANGES

## Findings
1. **[MAJOR]** — Money-math (K2, AC2) — \`app/services/payment_calculator.rb:42\`
   Uses \`to_f\` before tax multiplication.
   Proof: \`app/controllers/payments_controller.rb:19\` passes \`19.99\` into \`PaymentCalculator#call\`, producing float drift at line 42.

2. **[MAJOR]** — Style preference — \`app/services/payment_calculator.rb\`
   Consider renaming \`calc_total\` to \`compute_total_amount\` for readability.

## Summary
One real constraint violation and one ungrounded nitpick.
`;

  const result = validateReview({ spec: sampleSpec, review });
  assert.equal(result.ok, true);
  assert.equal(result.effective_verdict, 'REQUEST_CHANGES');
  assert.equal(result.counts.blocking_submitted, 2);
  assert.equal(result.counts.verified_blocking, 1);
  assert.equal(result.counts.demoted, 1);
  assert.equal(result.verified_findings[0].id, 'COBALT-F1');
  assert.deepEqual(result.demoted_findings[0].demotion_reasons, [
    'MISSING_CONTRACT_CITATION',
    'MISSING_FALSIFIABLE_PROOF',
  ]);
});

test('validateReview flips REQUEST_CHANGES to APPROVE when all blocking findings are demoted', () => {
  const performativeOnlyReview = `
## Lint Check
Clean.

## Coverage Check
Pass.

## Verdict: REQUEST_CHANGES

## Findings
1. **[MAJOR]** — Subjective refactor — \`app/services/payment_calculator.rb\`
   Extract a private helper method here.
`;

  const result = validateReview({ spec: sampleSpec, review: performativeOnlyReview });
  assert.equal(result.ok, true);
  assert.equal(result.effective_verdict, 'APPROVE');
  assert.equal(result.counts.verified_blocking, 0);
  assert.equal(result.counts.demoted, 1);
});

test('validateReview enforces Cycle 2 file scope lock against moving goalposts', () => {
  const cycle1Review = `
## Verdict: REQUEST_CHANGES

## Findings
1. **[MAJOR]** — Money-math (K2) — \`app/services/payment_calculator.rb:42\`
   Float conversion.
   Proof: \`app/services/payment_calculator.rb:42\` converts cents via \`to_f\`.
`;

  const cycle2ReviewOnUntouchedFile = `
## Verdict: REQUEST_CHANGES

## Findings
1. **[MAJOR]** — Unrelated file (AC1) — \`app/models/legacy_invoice.rb:12\`
   New complaint on a file not in Cycle 1.
   Proof: \`app/models/legacy_invoice.rb:12\` has an old scope.
`;

  const result = validateReview({
    spec: sampleSpec,
    review: cycle2ReviewOnUntouchedFile,
    previousReview: cycle1Review,
  });
  assert.equal(result.ok, true);
  assert.equal(result.effective_verdict, 'APPROVE');
  assert.deepEqual(result.demoted_findings[0].demotion_reasons, ['OUT_OF_CYCLE_SCOPE']);
});

test('render-board CLI outputs ASCII and Markdown/Mermaid workflow boards', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-board-'));
  const projectDir = path.join(root, 'payment-calc');
  fs.mkdirSync(projectDir, { recursive: true });

  fs.writeFileSync(path.join(projectDir, 'CONTEXT.md'), '# Payment Calc\n');
  fs.writeFileSync(path.join(projectDir, 'brief.md'), sampleBrief);
  fs.writeFileSync(path.join(projectDir, 'spec.md'), sampleSpec);
  fs.writeFileSync(path.join(projectDir, 'build.md'), sampleBuild);
  fs.writeFileSync(
    path.join(projectDir, 'gate-plan.json'),
    JSON.stringify(validateHandoff({ brief: sampleBrief, spec: sampleSpec }))
  );
  fs.writeFileSync(
    path.join(projectDir, 'gate-build.json'),
    JSON.stringify(validateHandoff({ brief: sampleBrief, spec: sampleSpec, build: sampleBuild }))
  );
  fs.writeFileSync(
    path.join(projectDir, 'review.md'),
    '## Verdict: APPROVE\n\n## Findings\nNone.\n'
  );
  fs.writeFileSync(
    path.join(projectDir, 'project.json'),
    JSON.stringify({
      schema_version: 1,
      slug: 'payment-calc',
      title: 'Payment Calc',
      tier: 'standard_ambiguous',
      status: 'active',
      phase: 'REVIEW',
      updated_at: '2026-10-15T17:00:00.000Z',
      next_action: 'Run validate-review and advance to DELIVER.',
      unresolved_questions: [],
      artifacts: {
        context: 'CONTEXT.md',
        brief: 'brief.md',
        spec: 'spec.md',
        gate_plan: 'gate-plan.json',
        build: 'build.md',
        gate_build: 'gate-build.json',
        review: 'review.md',
      },
    })
  );

  const asciiOut = renderBoard(projectDir, { format: 'ascii' });
  assert.match(asciiOut, /10X SQUAD WORKFLOW BOARD/);
  assert.match(asciiOut, /CONTRACT SHARPNESS & DETERMINISTIC GATE/);
  assert.match(asciiOut, /sharp -> Builder lane/);

  const htmlOut = renderBoard(projectDir, { format: 'html' });
  assert.match(htmlOut, /10x Squad/);
  assert.match(htmlOut, /CONTROL\.JS · deterministic gate/);
  assert.match(htmlOut, /Einstein/);
  assert.match(htmlOut, /toggleGroup/);
  assert.match(htmlOut, /EventSource\('\/api\/events'\)/);

  const cliResult = spawnSync(
    process.execPath,
    [cliPath, 'render-board', '--project', projectDir, '--format', 'markdown'],
    { cwd: packageRoot, encoding: 'utf8' }
  );
  assert.equal(cliResult.status, 0, cliResult.stderr || cliResult.stdout);
  assert.match(cliResult.stdout, /```mermaid/);
  assert.match(cliResult.stdout, /Contract Sharpness/);
});

test('verifyBuild catches JS syntax errors and File Plan drift before spawning reviewers', () => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-verify-build-'));
  const brokenJs = path.join(repoDir, 'broken.js');
  fs.writeFileSync(brokenJs, 'function broken( {\n');

  const spec = `
## File Plan (file path + one-line change description each)
- \`broken.js\` — Updated handler

## Acceptance Criteria
1. (AC1) Handler runs.
`;
  const build = `
## Changelist
- \`broken.js\` (AC1) — Introduces syntax error.
- \`unplanned.js\` (AC1) — Unplanned file edit.
`;

  const result = verifyBuild({ spec, build, repoRoot: repoDir, enforceFilePlan: true });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'SYNTAX_CHECK_FAILED'));
  assert.deepEqual(
    result.errors.find((e) => e.code === 'UNPLANNED_BUILD_FILES')?.files,
    ['unplanned.js']
  );
});

test('partitionFilePlan defaults to single_builder for <4 or coupled files and parallel_batches for >=4 disjoint files', () => {
  const smallSpec = `
## File Plan (file path + one-line change description each)
- \`app/models/invoice.rb\` — Model
- \`app/services/invoice_service.rb\` — Service
`;
  assert.equal(partitionFilePlan({ spec: smallSpec }).mode, 'single_builder');

  const disjointSpec = `
## File Plan (file path + one-line change description each)
- \`app/billing/tax_calculator.rb\` — Billing tax
- \`app/notifications/slack_notifier.rb\` — Slack webhook
- \`app/exports/csv_exporter.rb\` — CSV export
- \`app/audit/login_tracker.rb\` — Login audit
`;
  const disjoint = partitionFilePlan({ spec: disjointSpec });
  assert.equal(disjoint.mode, 'parallel_batches');
  assert.equal(disjoint.batches.length, 4);
});

test('advancePhase composite runner executes gates, transitions project.json, and regenerates PROJECTS.md in one call', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-advance-'));
  const projectsRoot = path.join(workspace, '10x-squad-artifacts', 'projects');
  const projectDir = path.join(projectsRoot, 'fast-funnel');
  fs.mkdirSync(projectDir, { recursive: true });

  fs.writeFileSync(path.join(projectDir, 'CONTEXT.md'), '# Fast Funnel\n');
  fs.writeFileSync(path.join(projectDir, 'brief.md'), sampleBrief);
  fs.writeFileSync(
    path.join(projectDir, 'project.json'),
    JSON.stringify({
      schema_version: 1,
      slug: 'fast-funnel',
      title: 'Fast Funnel',
      tier: 'standard_ambiguous',
      status: 'active',
      phase: 'INTAKE',
      updated_at: '2026-10-15T10:00:00.000Z',
      next_action: 'Advance to PLAN.',
      unresolved_questions: [],
      artifacts: {
        context: 'CONTEXT.md',
        brief: 'brief.md',
      },
    })
  );

  // 1. INTAKE -> PLAN
  const toPlan = advancePhase({ projectDirectory: projectDir, targetPhase: 'PLAN' });
  assert.equal(toPlan.ok, true);
  assert.equal(toPlan.phase, 'PLAN');
  assert.deepEqual(toPlan.next_personas, ['peter']);

  // 2. Write spec.md and advance PLAN -> BUILD (auto-generates gate-plan.json + builder_partition)
  fs.writeFileSync(path.join(projectDir, 'spec.md'), sampleSpec);
  const toBuild = advancePhase({ projectDirectory: projectDir, targetPhase: 'BUILD' });
  assert.equal(toBuild.ok, true);
  assert.equal(toBuild.phase, 'BUILD');
  assert.equal(toBuild.gate_result.ok, true);
  assert.equal(toBuild.builder_partition.mode, 'single_builder');
  assert.ok(fs.existsSync(path.join(projectDir, 'gate-plan.json')));

  // 3. Write build.md and advance BUILD -> REVIEW via CLI (auto-generates gate-build.json + gate-verify-build.json)
  fs.writeFileSync(path.join(projectDir, 'build.md'), sampleBuild);
  const cliToReview = spawnSync(
    process.execPath,
    [cliPath, 'advance-phase', '--project', projectDir, '--to', 'REVIEW'],
    { cwd: packageRoot, encoding: 'utf8' }
  );
  assert.equal(cliToReview.status, 0, cliToReview.stderr || cliToReview.stdout);
  const reviewPacket = JSON.parse(cliToReview.stdout);
  assert.equal(reviewPacket.ok, true);
  assert.equal(reviewPacket.phase, 'REVIEW');
  assert.deepEqual(reviewPacket.next_personas, ['cobalt', 'ralph']);
  assert.ok(fs.existsSync(path.join(workspace, '10x-squad-artifacts', 'PROJECTS.md')));
  assert.ok(fs.existsSync(path.join(projectDir, 'dashboard.html')));
});

test('toggle-ui CLI toggles workspace UI config and controls automatic dashboard.html syncing', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-toggle-ui-'));
  const projectDir = path.join(workspace, 'ui-demo');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'CONTEXT.md'), '# UI Demo\n');
  fs.writeFileSync(
    path.join(projectDir, 'project.json'),
    JSON.stringify({
      schema_version: 1,
      slug: 'ui-demo',
      title: 'UI Demo',
      tier: 'standard_clear',
      status: 'active',
      phase: 'INTAKE',
      updated_at: '2026-10-15T10:00:00.000Z',
      next_action: 'Advance to PLAN.',
      unresolved_questions: [],
      artifacts: { context: 'CONTEXT.md' },
    })
  );

  // Turn UI off in workspace scope
  const offRes = spawnSync(
    process.execPath,
    [cliPath, 'toggle-ui', '--off', '--scope', 'workspace', '--workspace-root', workspace],
    { cwd: packageRoot, encoding: 'utf8' }
  );
  assert.equal(offRes.status, 0, offRes.stderr || offRes.stdout);
  const offJson = JSON.parse(offRes.stdout);
  assert.equal(offJson.enabled, false);

  const step1 = advancePhase({ projectDirectory: projectDir, targetPhase: 'PLAN', workspaceRoot: workspace });
  assert.equal(step1.ok, true);
  assert.equal(step1.ui.enabled, false);
  assert.equal(fs.existsSync(path.join(projectDir, 'dashboard.html')), false);

  // Toggle back on with --toggle and --project
  const toggleOnRes = spawnSync(
    process.execPath,
    [cliPath, 'toggle-ui', '--toggle', '--scope', 'workspace', '--workspace-root', workspace, '--project', projectDir],
    { cwd: packageRoot, encoding: 'utf8' }
  );
  assert.equal(toggleOnRes.status, 0, toggleOnRes.stderr || toggleOnRes.stdout);
  const onJson = JSON.parse(toggleOnRes.stdout);
  assert.equal(onJson.enabled, true);
  assert.ok(fs.existsSync(path.join(projectDir, 'dashboard.html')));
});


