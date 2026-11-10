'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { inspectProjectBoard, serveBoard } = require('../assets/runtime/workflow-board');

const spec = `
## Summary
Update the service.

## File Plan
- \`src/service.js\` — Update the service.

## Acceptance Criteria
1. (AC1) The service works.

## Sensitive Surface
- Service boundary.
`;

const build = '## Changelist\n- `src/service.js` (AC1) — Updated the service.\n';
const review = '## Verdict: APPROVE\n\n## Findings\nNone.\n';

function writeAt(directory, name, content, timestamp) {
  const file = path.join(directory, name);
  fs.writeFileSync(file, content);
  fs.utimesSync(file, timestamp / 1000, timestamp / 1000);
}

function createProject(t, { phase = 'REVIEW', nextAction, now = Date.now() } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), '10x-board-regression-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  writeAt(directory, 'CONTEXT.md', '# Test\n', now - 40000);
  writeAt(directory, 'spec.md', spec, now - 35000);
  writeAt(directory, 'build.md', build, now - 30000);
  writeAt(directory, 'gate-build.json', '{"ok":true}', now - 30000);
  writeAt(directory, 'review.md', review, now - 20000);
  const state = {
    schema_version: 1,
    slug: path.basename(directory),
    title: 'Board regression',
    tier: 'standard_clear',
    status: 'active',
    phase,
    updated_at: new Date(now - 30000).toISOString(),
    next_action: nextAction || 'Dispatch Cobalt, Sentinel, and Ralph in the verification wave.',
    unresolved_questions: [],
    artifacts: {
      context: 'CONTEXT.md',
      spec: 'spec.md',
      build: 'build.md',
      review: 'review.md',
    },
  };
  fs.writeFileSync(path.join(directory, 'project.json'), JSON.stringify(state));
  return { directory, state, now };
}

function writeState(directory, state) {
  fs.writeFileSync(path.join(directory, 'project.json'), JSON.stringify(state));
}

test('parallel verification keeps Ralph on the original timeline across phase and action changes', (t) => {
  const { directory, state, now } = createProject(t);
  const first = inspectProjectBoard(directory);
  const verify = first.cards.find((card) => card.id === 'verify');
  const ralph = verify.agents.find((agent) => agent.id === 'ralph');
  assert.equal(ralph.started_at_ms, now - 30000);
  assert.ok(Math.abs(first.timing.verify_ms - (Date.now() - (now - 30000))) < 1000);
  assert.equal(verify.started_at_ms, now - 30000);

  state.next_action = 'Wait for the remaining verifiers.';
  state.updated_at = new Date(now - 5000).toISOString();
  writeState(directory, state);
  const waiting = inspectProjectBoard(directory);
  const waitingRalph = waiting.cards.find((card) => card.id === 'verify').agents.find((agent) => agent.id === 'ralph');
  assert.equal(waitingRalph.state, 'active');
  assert.equal(waitingRalph.started_at_ms, now - 30000);

  state.phase = 'TEST';
  state.next_action = 'Verify Ralph test execution results.';
  state.updated_at = new Date(now).toISOString();
  writeState(directory, state);
  const testing = inspectProjectBoard(directory);
  const testingRalph = testing.cards.find((card) => card.id === 'verify').agents.find((agent) => agent.id === 'ralph');
  assert.equal(testingRalph.started_at_ms, now - 30000);
  assert.ok(Math.abs(testing.timing.verify_ms - (Date.now() - (now - 30000))) < 1000);
});

test('sequential test execution starts at TEST and counts the elapsed review time only once', (t) => {
  const { directory, state, now } = createProject(t, { nextAction: 'Dispatch Cobalt and Sentinel for review.' });
  inspectProjectBoard(directory);
  state.phase = 'TEST';
  state.next_action = 'Dispatch Ralph for tests.';
  state.updated_at = new Date(now - 5000).toISOString();
  writeState(directory, state);

  const board = inspectProjectBoard(directory);
  const ralph = board.cards.find((card) => card.id === 'verify').agents.find((agent) => agent.id === 'ralph');
  assert.equal(ralph.started_at_ms, now - 5000);
  assert.ok(Math.abs(board.timing.verify_ms - (Date.now() - (now - 30000))) < 1000);
});

test('a spec dispute invalidates the old build and keeps one loop through rebuild and review', (t) => {
  const { directory, state, now } = createProject(t, {
    phase: 'PLAN',
    nextAction: 'Revise the disputed spec.',
  });
  writeAt(directory, 'review.md', '## Verdict: SPEC_DISPUTE\n', now - 20000);
  writeAt(directory, 'spec.md', `${spec}\nRevised scope.\n`, now - 10000);
  state.updated_at = new Date(now - 19000).toISOString();
  writeState(directory, state);

  const replanning = inspectProjectBoard(directory);
  assert.equal(replanning.cards.find((card) => card.id === 'build').state, 'queued');
  assert.equal(replanning.cards.find((card) => card.id === 'build').agents[0].state, 'queued');
  assert.equal(replanning.timing.non_linear.total_loops, 1);
  assert.equal(replanning.timing.non_linear.loopbacks.length, 1);

  state.phase = 'BUILD';
  state.next_action = 'Rebuild against the revised spec.';
  state.updated_at = new Date(now - 9000).toISOString();
  writeState(directory, state);
  const rebuilding = inspectProjectBoard(directory);
  assert.equal(rebuilding.cards.find((card) => card.id === 'build').state, 'active');
  assert.equal(rebuilding.timing.non_linear.total_loops, 1);

  writeAt(directory, 'build.md', `${build}\nRebuilt.\n`, now - 5000);
  state.phase = 'REVIEW';
  state.next_action = 'Dispatch Cobalt, Sentinel, and Ralph in the verification wave.';
  state.updated_at = new Date(now - 4000).toISOString();
  writeState(directory, state);
  const reviewing = inspectProjectBoard(directory);
  assert.equal(reviewing.cards.find((card) => card.id === 'build').state, 'done');
  assert.equal(reviewing.cards.find((card) => card.id === 'verify').agents[0].state, 'active');
  assert.equal(reviewing.timing.non_linear.total_loops, 1);
  assert.equal(reviewing.timing.non_linear.loopbacks[0].reason, 'SPEC_DISPUTE');

  writeAt(directory, 'review.md', '## Verdict: REQUEST_CHANGES\n', now - 3000);
  state.phase = 'BUILD';
  state.next_action = 'Fix the new review findings.';
  state.updated_at = new Date(now - 2000).toISOString();
  writeState(directory, state);
  const nextRework = inspectProjectBoard(directory);
  assert.equal(nextRework.timing.non_linear.total_loops, 2);
  assert.equal(nextRework.timing.non_linear.cycles.build, 3);
  assert.equal(nextRework.timing.non_linear.loopbacks[1].reason, 'REQUEST_CHANGES');
});

test('an inferred loop remains in history after review resumes, including legacy telemetry', (t) => {
  const { directory, state, now } = createProject(t, { phase: 'BUILD', nextAction: 'Fix review findings.' });
  const rework = inspectProjectBoard(directory);
  assert.equal(rework.timing.non_linear.total_loops, 1);
  assert.equal(rework.timing.non_linear.loopbacks.length, 1);

  const telemetryPath = path.join(directory, 'telemetry.json');
  const telemetry = JSON.parse(fs.readFileSync(telemetryPath, 'utf8'));
  telemetry.loopbacks = [];
  fs.writeFileSync(telemetryPath, JSON.stringify(telemetry));
  state.phase = 'REVIEW';
  state.updated_at = new Date(now).toISOString();
  writeState(directory, state);

  const reviewing = inspectProjectBoard(directory);
  assert.equal(reviewing.timing.non_linear.total_loops, 1);
  assert.equal(reviewing.timing.non_linear.loopbacks.length, 1);
  assert.equal(reviewing.timing.non_linear.cycles.build, 2);
});

test('invalid telemetry is reported instead of silently discarded', async (t) => {
  const { directory } = createProject(t);
  fs.writeFileSync(path.join(directory, 'telemetry.json'), '{invalid');
  assert.throws(() => inspectProjectBoard(directory), /telemetry/i);
  const { server, url } = await serveBoard({ projectDirectory: directory, port: 0 });
  try {
    const response = await fetch(`${url}/api/board`);
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /telemetry/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('board server ignores its own telemetry writes and still broadcasts project changes', async (t) => {
  const { directory, state, now } = createProject(t);
  const { server, url } = await serveBoard({ projectDirectory: directory, port: 0 });
  let reader;
  try {
    const response = await fetch(`${url}/api/board`);
    assert.equal(response.status, 200);
    const telemetryPath = path.join(directory, 'telemetry.json');
    const initialMtime = fs.statSync(telemetryPath).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(fs.statSync(telemetryPath).mtimeMs, initialMtime);

    const events = await fetch(`${url}/api/events`);
    reader = events.body.getReader();
    state.phase = 'BUILD';
    state.next_action = 'Fix the review findings.';
    state.updated_at = new Date(now).toISOString();
    writeState(directory, state);

    let timeout;
    const event = await Promise.race([
      (async () => {
        let data = '';
        while (!/event: board\ndata:[^\n]*\n\n/.test(data)) {
          const next = await reader.read();
          assert.equal(next.done, false);
          data += Buffer.from(next.value).toString('utf8');
        }
        return data;
      })(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Timed out waiting for a board event')), 2000);
      }),
    ]).finally(() => clearTimeout(timeout));
    assert.match(event, /"phase":"BUILD"/);
  } finally {
    if (reader) await reader.cancel();
    await new Promise((resolve) => server.close(resolve));
  }
});
