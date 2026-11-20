'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { posixShell } = require('./support/platform');

const BASH = posixShell() || 'bash';
const packageRoot = path.resolve(__dirname, '..');
const evalRoot = path.join(packageRoot, 'evals');
const experimentRoot = path.join(evalRoot, 'experiments', 'budget-and-ceiling');

const { costColumns } = require('../evals/cost-columns');
const { buildArmConfig } = require('../evals/experiments/budget-and-ceiling/arm-routing');
const { applyNumbers } = require('../evals/experiments/budget-and-ceiling/apply-numbers');
const { pack, reveal, parseCsv } = require('../evals/blind');

const tempDirectories = [];
function tempDir() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-budget-eval-'));
  tempDirectories.push(directory);
  return directory;
}
test.after(() => {
  for (const directory of tempDirectories) fs.rmSync(directory, { recursive: true, force: true });
});

const PER_MILLION = 1_000_000;

// One priced usage record. Input rate 0.2 AI credits per million tokens, output 1.0.
function usageLine({ input = 1000, output = 100, agentId } = {}) {
  const details = [
    { batchSize: PER_MILLION, costPerBatch: 200_000_000_000, tokenCount: input, tokenType: 'input', model: 'model-a' },
    { batchSize: PER_MILLION, costPerBatch: 1_000_000_000_000, tokenCount: output, tokenType: 'output', model: 'model-a' },
  ];
  const totalNanoAiu = details.reduce((sum, d) => sum + d.tokenCount * (d.costPerBatch / d.batchSize), 0);
  return JSON.stringify({
    type: 'session.usage_record',
    ...(agentId ? { agentId } : {}),
    timestamp: '2026-01-01T00:00:00.000Z',
    data: {
      usage: {
        model: 'model-a',
        inputTokens: input,
        outputTokens: output,
        reasoningEffort: 'high',
        numToolCalls: 1,
        duration: 1000,
        copilotUsage: { tokenDetails: details, totalNanoAiu },
      },
    },
  });
}

test('cost columns read usage records and report nothing when there are none', () => {
  const directory = tempDir();
  const events = path.join(directory, 'events.jsonl');
  fs.writeFileSync(events, `${usageLine()}\n${usageLine({ input: 2000 })}\n`);

  const columns = costColumns({ events });
  assert.equal(columns.cost_source, 'stdout');
  assert.equal(columns.peak_context_tokens, 2000);
  assert.ok(columns.credits > 0);
  assert.match(columns.credits_by_persona, /^[a-z-]+=[0-9.]+$/);

  const empty = path.join(directory, 'empty.jsonl');
  fs.writeFileSync(empty, '{"type":"assistant.message"}\n');
  assert.deepEqual(
    costColumns({ events: empty, workdir: directory, env: { COPILOT_HOME: path.join(directory, 'none') } }),
    { credits: null, credits_by_persona: null, peak_context_tokens: null, surcharge_credits: null, compactions: null, follow_ups: null, cost_source: 'none' }
  );
});

test('cost columns find the session log for a workdir when stdout has no usage records', () => {
  const directory = tempDir();
  const home = path.join(directory, 'copilot-home');
  const workdir = path.join(directory, 'work');
  fs.mkdirSync(workdir);
  const session = path.join(home, 'session-state', 'abc');
  fs.mkdirSync(session, { recursive: true });
  const start = JSON.stringify({ type: 'session.start', data: { startTime: new Date().toISOString(), context: { cwd: workdir } } });
  fs.writeFileSync(path.join(session, 'events.jsonl'), `${start}\n${usageLine()}\n`);
  const other = path.join(home, 'session-state', 'elsewhere');
  fs.mkdirSync(other);
  const otherStart = JSON.stringify({ type: 'session.start', data: { startTime: new Date().toISOString(), context: { cwd: path.join(directory, 'other') } } });
  fs.writeFileSync(path.join(other, 'events.jsonl'), `${otherStart}\n${usageLine({ input: 9_000_000 })}\n`);

  const columns = costColumns({
    workdir,
    startedMs: Date.now() - 60_000,
    finishedMs: Date.now() + 60_000,
    env: { COPILOT_HOME: home },
  });
  assert.equal(columns.cost_source, 'session-log');
  assert.equal(columns.peak_context_tokens, 1000);
});

function guarded(args, command) {
  return spawnSync(process.execPath, [path.join(evalRoot, 'guarded-run.js'), ...args, '--', ...command], {
    encoding: 'utf8',
    timeout: 30_000,
  });
}

test('guarded run stops a command at the wall-clock cap and records why', () => {
  const marker = path.join(tempDir(), 'stopped.json');
  const result = guarded(['--max-seconds', '1', '--interval-ms', '100', '--marker', marker], [process.execPath, '-e', 'setTimeout(() => {}, 60000)']);
  assert.equal(result.status, 124);
  assert.equal(JSON.parse(fs.readFileSync(marker, 'utf8')).stopped_by, 'wall_clock');
});

test('guarded run stops a command once recorded credits pass the cap', () => {
  const directory = tempDir();
  const events = path.join(directory, 'events.jsonl');
  const marker = path.join(directory, 'stopped.json');
  const writer = `require('node:fs').writeFileSync(${JSON.stringify(events)}, ${JSON.stringify(`${usageLine({ input: 5_000_000 })}\n`)}); setTimeout(() => {}, 60000)`;
  const result = guarded(
    ['--max-credits', '1', '--events', events, '--workdir', directory, '--interval-ms', '100', '--marker', marker],
    [process.execPath, '-e', writer]
  );
  assert.equal(result.status, 124);
  assert.equal(JSON.parse(fs.readFileSync(marker, 'utf8')).stopped_by, 'credits');
});

test('guarded run passes the exit code through and leaves no marker when no cap fires', () => {
  const marker = path.join(tempDir(), 'stopped.json');
  const result = guarded(['--max-seconds', '30', '--interval-ms', '100', '--marker', marker], [process.execPath, '-e', 'process.exit(3)']);
  assert.equal(result.status, 3);
  assert.equal(fs.existsSync(marker), false);
});

function legacyConfig() {
  const tiers = ['trivial', 'lite', 'standard_clear', 'standard_ambiguous', 'complex'];
  const row = (value) => Object.fromEntries(tiers.map((tier) => [tier, value]));
  return {
    schema_version: 2,
    updated_at: '2026-01-01T00:00:00.000Z',
    harnesses: {
      'copilot-cli': {
        assignments: row('gpt-6.2-astra'),
        dispatch_settings: row({ reasoning_effort: 'high', context_tier: 'long_context' }),
      },
    },
  };
}

test('an arm routing config changes only the builder context tier', () => {
  const config = buildArmConfig(legacyConfig(), { linusContextTier: 'default' });
  assert.equal(config.schema_version, 3);
  const settings = config.harnesses['copilot-cli'].dispatch_settings;
  for (const tier of Object.keys(settings.linus)) {
    assert.deepEqual(settings.linus[tier], { reasoning_effort: 'high', context_tier: 'default' });
    assert.deepEqual(settings.cobalt[tier], { reasoning_effort: 'high', context_tier: 'long_context' });
  }
  assert.throws(() => buildArmConfig(legacyConfig(), { linusContextTier: 'huge' }), /must be one of/);
  assert.throws(() => buildArmConfig(legacyConfig(), { harness: 'codex-cli', linusContextTier: 'default' }), /no profile/);
});

function fakeSquadRoot(directory) {
  const core = path.join(directory, 'assets', 'vivaldi', 'core.md');
  const linus = path.join(directory, 'assets', 'skills', '10x-linus-build', 'SKILL.md');
  fs.mkdirSync(path.dirname(core), { recursive: true });
  fs.mkdirSync(path.dirname(linus), { recursive: true });
  fs.writeFileSync(core, 'Start with about 200 calls or 60 minutes, whichever comes first.\n');
  fs.writeFileSync(linus, 'Stop after about 10 calls in a row that neither edit a file.\n');
  return { core, linus };
}

test('budget numbers are replaced exactly once and a reworded prompt fails loudly', () => {
  const directory = tempDir();
  const { core, linus } = fakeSquadRoot(directory);
  applyNumbers(directory, { calls: 100, minutes: 30, noProgress: 5 });
  assert.match(fs.readFileSync(core, 'utf8'), /about 100 calls or 30 minutes/);
  assert.match(fs.readFileSync(linus, 'utf8'), /about 5 calls in a row/);
  assert.throws(() => applyNumbers(directory, { calls: 100, minutes: 30, noProgress: 5 }), /exactly once, found 0/);
  assert.throws(() => applyNumbers(directory, { calls: 0, minutes: 30, noProgress: 5 }), /positive whole number/);
});

function resultsCsv(directory, rows) {
  const csv = path.join(directory, 'results.csv');
  const init = spawnSync(process.execPath, [path.join(evalRoot, 'result-csv.js'), 'init', csv], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const header = fs.readFileSync(csv, 'utf8').split(/\r?\n/, 1)[0].split(',');
  for (const row of rows) {
    const values = header.map((name) => (name in row ? row[name] : ''));
    const append = spawnSync(process.execPath, [path.join(evalRoot, 'result-csv.js'), 'append', csv, ...values], { encoding: 'utf8' });
    assert.equal(append.status, 0, append.stderr);
  }
  return csv;
}

test('blind packing hides the arm from the judge packet and reveal joins scores back to it', () => {
  const directory = tempDir();
  const rows = [];
  for (const [variant, credits, quality] of [['baseline', 9000, 0.8], ['baseline', 8000, 0.9], ['budget', 4000, 0.9], ['budget', 5000, 0.7]]) {
    const rep = rows.filter((row) => row.variant === variant).length + 1;
    const runDir = path.join(directory, 'runs', `${variant}-${rep}`);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'final.patch'), `diff for ${variant} ${rep}\n`);
    rows.push({ variant, task: 'large-feature', rep, pass: 1, credits, quality, raw_events: path.join(runDir, 'events.jsonl') });
  }
  rows.push({ variant: 'budget', task: 'large-feature', rep: 3, raw_events: path.join(directory, 'runs', 'no-patch', 'events.jsonl') });
  const csv = resultsCsv(directory, rows);
  const out = path.join(directory, 'blind');

  const result = pack({ csv, task: 'large-feature', out, seed: 7 });
  assert.equal(result.packed, 4);
  assert.deepEqual(result.skipped, ['budget rep 3']);

  const packetFiles = fs.readdirSync(path.join(out, 'packet')).sort();
  assert.deepEqual(packetFiles, ['A.patch', 'B.patch', 'C.patch', 'D.patch']);
  assert.doesNotMatch(fs.readFileSync(path.join(out, 'JUDGE.md'), 'utf8'), /baseline|budget/);

  const key = JSON.parse(fs.readFileSync(path.join(out, 'blind-key.json'), 'utf8')).key;
  for (const letter of ['A', 'B', 'C', 'D']) {
    const patch = fs.readFileSync(path.join(out, 'packet', `${letter}.patch`), 'utf8');
    assert.equal(patch, `diff for ${key[letter].variant} ${key[letter].rep}\n`);
  }

  const scores = parseCsv(fs.readFileSync(path.join(out, 'scores.csv'), 'utf8'));
  assert.equal(scores.length, 4);
  const filled = ['letter,correctness,completeness,repo_fit,would_merge,biggest_problem']
    .concat(scores.map((row) => `${row.letter},${key[row.letter].variant === 'budget' ? 4 : 5},4,4,yes,none`));
  fs.writeFileSync(path.join(out, 'scores.csv'), `${filled.join('\n')}\n`);

  const summary = Object.fromEntries(reveal({ out }).map((entry) => [entry.variant, entry]));
  assert.equal(summary.baseline.correctness, 5);
  assert.equal(summary.budget.correctness, 4);
  assert.equal(summary.baseline.mean_credits, 8500);
  assert.equal(summary.budget.mean_credits, 4500);
  assert.equal(summary.budget.would_merge, '2/2');
});

test('a dry run records cost columns from usage records and the summary prints them', () => {
  const directory = tempDir();
  const events = path.join(directory, 'recorded.jsonl');
  fs.writeFileSync(events, `${usageLine({ input: 4_000_000 })}\n`);
  const csv = path.join(directory, 'results.csv');
  const env = {
    ...process.env,
    DRY_RUN: '1',
    REPS: '1',
    EVAL_HARNESS: 'copilot-cli',
    DRY_RUN_EVENTS_FILE: events,
    RESULTS_CSV: csv,
    RUNS_DIR: path.join(directory, 'runs'),
  };
  const run = spawnSync(BASH, [path.join(evalRoot, 'run.sh'), 'arm-x', path.join(evalRoot, 'tasks', 'smoke-hello')], {
    cwd: packageRoot,
    encoding: 'utf8',
    env,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const [row] = parseCsv(fs.readFileSync(csv, 'utf8'));
  assert.equal(row.cost_source, 'stdout');
  assert.ok(Number(row.credits) > 0);
  assert.equal(row.peak_context_tokens, '4000000');
  assert.equal(row.stopped_by, '');

  const summary = spawnSync(BASH, [path.join(evalRoot, 'summarize.sh')], { cwd: packageRoot, encoding: 'utf8', env });
  assert.equal(summary.status, 0, summary.stderr || summary.stdout);
  assert.match(summary.stdout, /credits med/);
  assert.match(summary.stdout, /arm-x\s+smoke-hello/);
});

test('arm runner sets up the old and current squad and the builder context tier', { skip: !fs.existsSync(path.join(packageRoot, '.git')) }, () => {
  const directory = tempDir();
  const base = path.join(directory, 'base.json');
  fs.writeFileSync(base, JSON.stringify(legacyConfig()));
  const prepare = (arm, extra = {}) => spawnSync(BASH, [path.join(experimentRoot, 'run-arm.sh'), arm], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: { ...process.env, PREPARE_ONLY: '1', BASE_ROUTING: base, BASELINE_REF: 'HEAD', ...extra },
  });

  const both = prepare('both', { BUDGET_CALLS: '100' });
  assert.equal(both.status, 0, both.stderr || both.stdout);
  assert.match(both.stdout, /label=both-c100-m60-n10/);
  assert.match(both.stdout, /about 100 calls or 60 minutes/);
  assert.match(both.stdout, /linus context_tier = default/);

  const baseline = prepare('baseline');
  assert.equal(baseline.status, 0, baseline.stderr || baseline.stdout);
  assert.match(baseline.stdout, /linus context_tier = long_context/);

  assert.notEqual(prepare('baseline', { BUDGET_CALLS: '100' }).status, 0);
  assert.notEqual(prepare('nonsense').status, 0);
});
