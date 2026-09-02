'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const packageRoot = path.resolve(__dirname, '..');
const cliPath = path.join(packageRoot, 'bin', '10x-squad.js');
const { digestText, validateHandoff } = require('../assets/runtime/handoff-validator');
const { installTenXSquad, uninstallTenXSquad } = require('../lib/installer');

const brief = `
## Decision Table
| ID | Decision | Rationale |
|----|----------|-----------|
| D1 | Preserve the API contract. | Existing consumers depend on it. |
| D2 | Add focused regression coverage. | Prevent recurrence. |
| D3 | Defer the optional cleanup. | It is outside scope. |
`;

const spec = `
## Acceptance Criteria
1. (AC1 ← D1) Existing consumers receive the same response.
2. (AC2 ← D2) The regression test fails before the fix and passes after it.

## Deferred Decisions
- D3 — Deferred because the cleanup is outside this task.
`;

const build = `
## Changelist
- \`lib/example.js\` (AC1) — Preserves the response contract.
- \`test/example.test.js\` (AC2 ← D2) — Covers the regression.

## Validation
- Focused tests passed.
`;

function error(result, code) {
  return result.errors.find((entry) => entry.code === code);
}

test('validates a complete brief to spec to build trace chain', () => {
  const result = validateHandoff({ brief, spec, build });

  assert.deepEqual(result, {
    ok: true,
    decisions: ['D1', 'D2', 'D3'],
    acceptance_criteria: ['AC1', 'AC2'],
    input_hashes: {
      brief: digestText(brief),
      spec: digestText(spec),
      build: digestText(build),
    },
    errors: [],
  });
});

test('reports dropped decisions and acceptance criteria together', () => {
  const result = validateHandoff({
    brief,
    spec: spec.replace('- D3 — Deferred because the cleanup is outside this task.\n', ''),
    build: build.replace('- `test/example.test.js` (AC2 ← D2) — Covers the regression.\n', ''),
  });

  assert.equal(result.ok, false);
  assert.deepEqual(error(result, 'UNCONSUMED_DECISIONS').ids, ['D3']);
  assert.deepEqual(error(result, 'UNIMPLEMENTED_ACCEPTANCE_CRITERIA').ids, ['AC2']);
});

test('only changelist citations satisfy build acceptance criteria', () => {
  const result = validateHandoff({
    brief,
    spec,
    build: build.replace(
      '- `test/example.test.js` (AC2 ← D2) — Covers the regression.\n',
      '\n## Validation\n- AC2 passed in the focused test run.\n'
    ),
  });

  assert.equal(result.ok, false);
  assert.deepEqual(error(result, 'UNIMPLEMENTED_ACCEPTANCE_CRITERIA').ids, ['AC2']);
});

test('rejects prose-only AC claims inside the changelist', () => {
  const result = validateHandoff({
    spec: '## Acceptance Criteria\n1. (AC1) The implementation preserves behavior.\n',
    build: '## Changelist\n- No implementation exists yet; AC1 is pending.\n',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(error(result, 'MALFORMED_CHANGELIST_CITATIONS').ids, ['AC1']);
  assert.deepEqual(error(result, 'UNIMPLEMENTED_ACCEPTANCE_CRITERIA').ids, ['AC1']);
});

test('rejects unstructured acceptance criteria', () => {
  const result = validateHandoff({
    spec: '## Acceptance Criteria\n- AC1 is mentioned but has no criterion contract.\n',
    build: '## Changelist\n- `lib/example.js` (AC1) — Claims coverage.\n',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(error(result, 'MALFORMED_ACCEPTANCE_CRITERIA').ids, ['AC1']);
  assert.ok(error(result, 'NO_ACCEPTANCE_CRITERIA'));
});

test('rejects malformed decision syntax in spec and changelist citations', () => {
  for (const malformedCitation of ['AC1 junk D1', 'AC1 <- D1 trailing garbage']) {
    const malformedSpec = validateHandoff({
      brief,
      spec: `## Acceptance Criteria\n1. (${malformedCitation}) Invalid citation.\n\n## Deferred Decisions\n- D2 — Deferred.\n- D3 — Deferred.\n`,
    });
    assert.equal(malformedSpec.ok, false, malformedCitation);
    assert.deepEqual(error(malformedSpec, 'MALFORMED_ACCEPTANCE_CRITERIA').ids, ['AC1']);

    const malformedBuild = validateHandoff({
      spec: '## Acceptance Criteria\n1. (AC1) Valid criterion.\n',
      build: `## Changelist\n- \`lib/example.js\` (${malformedCitation}) — Invalid citation.\n`,
    });
    assert.equal(malformedBuild.ok, false, malformedCitation);
    assert.deepEqual(error(malformedBuild, 'MALFORMED_CHANGELIST_CITATIONS').ids, ['AC1']);
  }
});

test('requires every changelist bullet to be cited or explicitly marked support', () => {
  const uncited = validateHandoff({
    spec: '## Acceptance Criteria\n1. (AC1) Valid criterion.\n',
    build: '## Changelist\n- `lib/example.js` (AC1) — Implements behavior.\n- `lib/extra.js` — Uncited change.\n',
  });
  assert.equal(uncited.ok, false);
  assert.deepEqual(error(uncited, 'MALFORMED_CHANGELIST_ENTRIES').lines, [2]);

  const decisionOnly = validateHandoff({
    spec: '## Acceptance Criteria\n1. (AC1) Valid criterion.\n',
    build: '## Changelist\n- `lib/example.js` (AC1) — Implements behavior.\n- `lib/extra.js` (D1) — Decision only.\n',
  });
  assert.equal(decisionOnly.ok, false);
  assert.deepEqual(error(decisionOnly, 'MALFORMED_CHANGELIST_ENTRIES').lines, [2]);

  const support = validateHandoff({
    spec: '## Acceptance Criteria\n1. (AC1) Valid criterion.\n',
    build: '## Changelist\n- `lib/example.js` (AC1) — Implements behavior.\n- `package-lock.json` (support) — Updates dependency lock.\n',
  });
  assert.equal(support.ok, true);
});

test('rejects invented trace IDs and ACs without decision sources', () => {
  const result = validateHandoff({
    brief,
    spec: spec.replace('(AC2 ← D2)', '(AC2)').replace('D3 —', 'D4 —'),
    build: build.replace('(AC2 ← D2)', '(AC2, AC7-equivalent ← D9)'),
  });

  assert.equal(result.ok, false);
  assert.deepEqual(error(result, 'ACCEPTANCE_CRITERIA_WITHOUT_DECISIONS').ids, ['AC2']);
  assert.deepEqual(error(result, 'UNKNOWN_SPEC_DECISIONS').ids, ['D4']);
  assert.deepEqual(error(result, 'UNKNOWN_BUILD_DECISIONS').ids, ['D9']);
  assert.deepEqual(error(result, 'UNKNOWN_BUILD_ACCEPTANCE_CRITERIA').ids, ['AC7']);
});

test('allows a Standard-clear handoff without a deliberation brief', () => {
  const directSpec = spec.replaceAll(' ← D1', '').replaceAll(' ← D2', '').replace(/\n## Deferred Decisions[\s\S]*/, '');
  const result = validateHandoff({ spec: directSpec, build });

  assert.equal(result.ok, true);
  assert.deepEqual(result.decisions, []);
});

test('validates the brief to spec gate before a build exists', () => {
  const result = validateHandoff({ brief, spec });

  assert.deepEqual(result, {
    ok: true,
    decisions: ['D1', 'D2', 'D3'],
    acceptance_criteria: ['AC1', 'AC2'],
    input_hashes: {
      brief: digestText(brief),
      spec: digestText(spec),
      build: null,
    },
    errors: [],
  });
});

test('validate-handoff CLI accepts a plan-stage brief and spec', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-plan-gate-'));
  const briefPath = path.join(directory, 'brief.md');
  const specPath = path.join(directory, 'spec.md');
  fs.writeFileSync(briefPath, brief);
  fs.writeFileSync(specPath, spec);

  const result = spawnSync(process.execPath, [cliPath, 'validate-handoff', '--brief', briefPath, '--spec', specPath], {
    cwd: packageRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).ok, true);
});

test('validate-handoff CLI returns compact JSON and a failing exit code', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-handoff-'));
  const specPath = path.join(directory, 'spec.md');
  const buildPath = path.join(directory, 'build.md');
  fs.writeFileSync(specPath, spec);
  fs.writeFileSync(buildPath, build.replace('(AC2 ← D2)', '(AC2, AC7-equivalent)'));

  const result = spawnSync(process.execPath, [cliPath, 'validate-handoff', '--spec', specPath, '--build', buildPath], {
    cwd: packageRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.deepEqual(error(output, 'UNKNOWN_BUILD_ACCEPTANCE_CRITERIA').ids, ['AC7']);
});

test('installed runtime exposes the same validator to every harness', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-runtime-'));
  const specPath = path.join(workspace, 'spec.md');
  const buildPath = path.join(workspace, 'build.md');
  fs.writeFileSync(specPath, spec);
  fs.writeFileSync(buildPath, build);

  installTenXSquad({ directory: workspace, harness: 'copilot' });

  const controlPath = path.join(workspace, '.10x-squad', 'runtime', 'control.js');
  const result = spawnSync(process.execPath, [controlPath, 'validate-handoff', '--spec', specPath, '--build', buildPath], {
    cwd: workspace,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).ok, true);

  installTenXSquad({ directory: workspace, harness: 'codex' });
  uninstallTenXSquad({ directory: workspace, harness: 'copilot' });
  assert.equal(fs.existsSync(controlPath), true, 'targeted uninstall must preserve the shared runtime');

  uninstallTenXSquad({ directory: workspace });
  assert.equal(fs.existsSync(controlPath), false, 'full uninstall owns and removes the shared runtime');
});