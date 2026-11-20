'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { advancePhase } = require('../assets/runtime/phase-runner');
const {
  GENERATED_MARKER,
  recordCost,
  summarizeUsageEvents,
} = require('../assets/runtime/cost-recorder');

const controlScript = path.resolve(__dirname, '..', 'assets', 'runtime', 'control.js');
const tempDirectories = [];

function tempDir() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-cost-'));
  tempDirectories.push(directory);
  return directory;
}

test.after(() => {
  for (const directory of tempDirectories) fs.rmSync(directory, { recursive: true, force: true });
});

const PER_MILLION = 1_000_000;

function usageEvent({ agentId, at, model = 'model-a', input = 1000, cacheRead = 0, output = 100, rate = 1, effort = 'high', costed = true }) {
  const inputRate = 200_000_000_000 * rate;
  const details = [
    { batchSize: PER_MILLION, costPerBatch: inputRate, tokenCount: input - cacheRead, tokenType: 'input', model },
    { batchSize: PER_MILLION, costPerBatch: inputRate / 10, tokenCount: cacheRead, tokenType: 'cache_read', model },
    { batchSize: PER_MILLION, costPerBatch: 1_000_000_000_000 * rate, tokenCount: output, tokenType: 'output', model },
  ];
  const totalNanoAiu = details.reduce((sum, d) => sum + d.tokenCount * (d.costPerBatch / d.batchSize), 0);
  return {
    type: 'session.usage_record',
    ...(agentId ? { agentId } : {}),
    timestamp: at,
    data: {
      usage: {
        model,
        inputTokens: input,
        outputTokens: output,
        reasoningEffort: effort,
        numToolCalls: 2,
        duration: 1000,
        ...(costed ? { copilotUsage: { tokenDetails: details, totalNanoAiu } } : {}),
      },
    },
  };
}

function started(agentId, agentName, model, at) {
  return { type: 'subagent.started', agentId, timestamp: at, data: { agentName, model, toolCallId: `call_${agentId}` } };
}

function prompted(agentId, at) {
  return { type: 'user.message', agentId, timestamp: at, data: { content: 'prompt' } };
}

function compacted(agentId, at) {
  return { type: 'session.compaction_complete', agentId, timestamp: at, data: { success: true } };
}

function writeEvents(directory, events, name = 'events.jsonl') {
  const file = path.join(directory, name);
  const noise = [
    { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:00.000Z', data: {} },
    { type: 'hook.start', timestamp: '2026-01-01T00:00:00.000Z', data: {} },
  ];
  fs.writeFileSync(file, `${[...noise, ...events].map((event) => JSON.stringify(event)).join('\n')}\nnot json at all\n`);
  return file;
}

function sampleEvents() {
  return [
    usageEvent({ at: '2026-01-01T10:00:00.000Z', model: 'orchestrator-model', input: 5000 }),
    started('b1', '10x-linus', 'builder-model', '2026-01-01T10:01:00.000Z'),
    prompted('b1', '2026-01-01T10:01:01.000Z'),
    usageEvent({ agentId: 'b1', at: '2026-01-01T10:02:00.000Z', model: 'builder-model', input: 100_000 }),
    usageEvent({ agentId: 'b1', at: '2026-01-01T10:03:00.000Z', model: 'builder-model', input: 300_000, rate: 2 }),
    compacted('b1', '2026-01-01T10:04:00.000Z'),
    prompted('b1', '2026-01-01T11:00:00.000Z'),
    usageEvent({ agentId: 'b1', at: '2026-01-01T11:05:00.000Z', model: 'builder-model', input: 20_000 }),
    started('r1', '10x-cobalt', 'reviewer-model', '2026-01-01T11:10:00.000Z'),
    prompted('r1', '2026-01-01T11:10:01.000Z'),
    usageEvent({ agentId: 'r1', at: '2026-01-01T11:11:00.000Z', model: 'reviewer-model', input: 8000 }),
  ];
}

test('summarizeUsageEvents attributes credits to personas and separates the initial prompt from follow-ups', () => {
  const dir = tempDir();
  const { rows, totals } = summarizeUsageEvents(writeEvents(dir, sampleEvents()));

  const builder = rows.find((row) => row.persona === 'linus');
  assert.equal(builder.model, 'builder-model');
  assert.equal(builder.calls, 3);
  assert.equal(builder.peak_context_tokens, 300_000);
  assert.equal(builder.compactions, 1);
  assert.equal(builder.follow_up_prompts, 1);
  assert.deepEqual(builder.prompts.map((prompt) => prompt.calls), [2, 1]);

  const reviewer = rows.find((row) => row.persona === 'cobalt');
  assert.equal(reviewer.follow_up_prompts, 0);
  assert.equal(rows.find((row) => row.agent_id === 'main').persona, 'vivaldi');

  assert.equal(totals.dispatches, 2);
  assert.equal(totals.calls, 5);
  assert.ok(Math.abs(totals.credits - rows.reduce((sum, row) => sum + row.credits, 0)) < 1e-9);
});

test('premium-rate calls are found from the lowest rate the same model was billed in the session', () => {
  const dir = tempDir();
  const { rows } = summarizeUsageEvents(writeEvents(dir, sampleEvents()));
  const builder = rows.find((row) => row.persona === 'linus');

  assert.equal(builder.premium_rate_calls, 1);
  const surchargeNano = 300_000 * 200_000 + 100 * 1_000_000;
  assert.ok(Math.abs(builder.premium_surcharge_credits - surchargeNano / 1e9) < 1e-6);

  const other = rows.filter((row) => row.persona !== 'linus');
  assert.ok(other.every((row) => row.premium_rate_calls === 0));
});

test('since drops earlier events, and calls without credit data are counted but not priced', () => {
  const dir = tempDir();
  const events = [
    ...sampleEvents(),
    usageEvent({ agentId: 'r1', at: '2026-01-01T11:12:00.000Z', model: 'reviewer-model', costed: false }),
  ];
  const file = writeEvents(dir, events);

  const recent = summarizeUsageEvents(file, { since: '2026-01-01T11:00:00.000Z' });
  assert.equal(recent.rows.find((row) => row.agent_id === 'main'), undefined);
  assert.equal(recent.totals.calls, 3);
  assert.equal(recent.totals.uncosted_calls, 1);
  assert.throws(() => summarizeUsageEvents(file, { since: 'yesterday' }), /ISO timestamp/);
});

test('recordCost writes a generated cost.md and will not overwrite hand-written rows', () => {
  const dir = tempDir();
  const events = writeEvents(dir, sampleEvents());
  const project = path.join(dir, 'project');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'cost.md'), '| Step | Persona |\n| Build | Linus |\n');

  const blocked = recordCost({ projectDirectory: project, eventsPath: events });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.errors[0].code, 'COST_FILE_NOT_GENERATED');
  assert.match(fs.readFileSync(path.join(project, 'cost.md'), 'utf8'), /Step \| Persona/);

  const written = recordCost({ projectDirectory: project, eventsPath: events, overwrite: true });
  assert.equal(written.ok, true);
  const markdown = fs.readFileSync(path.join(project, 'cost.md'), 'utf8');
  assert.ok(markdown.startsWith(GENERATED_MARKER));
  assert.match(markdown, /\| Linus \| `builder-model` \| high \| 3 \|/);
  assert.match(markdown, /Work between prompts/);
  assert.match(markdown, /Linus `b1` \| follow-up 1 \|/);

  assert.equal(recordCost({ projectDirectory: project, eventsPath: events }).ok, true);
});

test('recordCost finds the session from the environment and reports missing telemetry plainly', () => {
  const dir = tempDir();
  const project = path.join(dir, 'project');
  fs.mkdirSync(project);
  const sessionDir = path.join(dir, 'home', 'session-state', 'abc-123');
  fs.mkdirSync(sessionDir, { recursive: true });
  writeEvents(sessionDir, sampleEvents());

  const env = { COPILOT_HOME: path.join(dir, 'home'), COPILOT_AGENT_SESSION_ID: 'abc-123' };
  const found = recordCost({ projectDirectory: project, env });
  assert.equal(found.ok, true);
  assert.equal(found.events_path, path.join(sessionDir, 'events.jsonl'));

  const none = recordCost({ projectDirectory: project, env: {} });
  assert.equal(none.ok, false);
  assert.equal(none.errors[0].code, 'TELEMETRY_UNAVAILABLE');
  assert.match(none.errors[0].message, /not captured/);

  const empty = writeEvents(dir, [], 'empty.jsonl');
  assert.equal(recordCost({ projectDirectory: project, eventsPath: empty, overwrite: true }).errors[0].code, 'NO_USAGE_RECORDED');
});

test('record-cost command exits non-zero with a code when telemetry is missing', () => {
  const dir = tempDir();
  const project = path.join(dir, 'project');
  fs.mkdirSync(project);
  const env = { ...process.env };
  delete env.COPILOT_AGENT_SESSION_ID;

  const missing = spawnSync(process.execPath, [controlScript, 'record-cost', '--project', project], { env, encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stdout).errors[0].code, 'TELEMETRY_UNAVAILABLE');

  const events = writeEvents(dir, sampleEvents());
  const ok = spawnSync(process.execPath, [controlScript, 'record-cost', '--project', project, '--events', events], { env, encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).totals.dispatches, 2);
});

function intakeProject(dir, name) {
  const project = path.join(dir, name);
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'CONTEXT.md'), '# Project\n');
  fs.writeFileSync(path.join(project, 'project.json'), JSON.stringify({
    schema_version: 1,
    slug: name,
    title: name,
    tier: 'standard_clear',
    status: 'active',
    phase: 'INTAKE',
    updated_at: '2026-01-01T00:00:00.000Z',
    next_action: 'Prepare the plan.',
    unresolved_questions: [],
    artifacts: { context: 'CONTEXT.md' },
  }));
  return project;
}

test('advance-phase records cost only when asked and never fails the transition over it', () => {
  const dir = tempDir();
  const saved = { home: process.env.COPILOT_HOME, session: process.env.COPILOT_AGENT_SESSION_ID };
  const sessionDir = path.join(dir, 'home', 'session-state', 'sess-1');
  fs.mkdirSync(sessionDir, { recursive: true });
  writeEvents(sessionDir, sampleEvents());
  process.env.COPILOT_HOME = path.join(dir, 'home');
  process.env.COPILOT_AGENT_SESSION_ID = 'sess-1';
  try {
    const off = advancePhase({ projectDirectory: intakeProject(dir, 'off'), targetPhase: 'PLAN' });
    assert.equal(off.ok, true, JSON.stringify(off));
    assert.equal(off.cost, null);

    const recorded = intakeProject(dir, 'recorded');
    const on = advancePhase({ projectDirectory: recorded, targetPhase: 'PLAN', recordCost: true });
    assert.equal(on.ok, true, JSON.stringify(on));
    assert.equal(on.cost.ok, true, JSON.stringify(on.cost));
    assert.equal(fs.existsSync(path.join(recorded, 'cost.md')), true);

    process.env.COPILOT_AGENT_SESSION_ID = 'no-such-session';
    const unavailable = advancePhase({ projectDirectory: intakeProject(dir, 'unavailable'), targetPhase: 'PLAN', recordCost: true });
    assert.equal(unavailable.ok, true, JSON.stringify(unavailable));
    assert.equal(unavailable.cost.ok, false);
    assert.equal(unavailable.cost.errors[0].code, 'TELEMETRY_UNAVAILABLE');
  } finally {
    for (const [key, value] of [['COPILOT_HOME', saved.home], ['COPILOT_AGENT_SESSION_ID', saved.session]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
