'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const packageRoot = path.resolve(__dirname, '..');
const evalRoot = path.join(packageRoot, 'evals');
const { normalizeEvents } = require('../evals/normalize-events');

test('normalizes observable JSONL metrics without inventing unavailable values', () => {
  const events = [
    { type: 'thread.started', thread_id: 'thread-1' },
    { type: 'turn.started' },
    { type: 'item.started', item: { type: 'command_execution' } },
    {
      type: 'turn.completed',
      usage: { input_tokens: 120, cached_input_tokens: 20, output_tokens: 30 },
    },
    { type: 'subagent.started', model: 'review-model' },
    { type: 'assistant.turn_start', model: 'parent-model' },
  ];

  assert.deepEqual(normalizeEvents(events, { harness: 'codex-cli', model: 'requested-model', durationMs: 42, exitCode: 0 }), {
    harness: 'codex-cli',
    requested_model: 'requested-model',
    observed_models: ['parent-model', 'review-model'],
    agent_exit: 0,
    duration_ms: 42,
    input_tokens: 120,
    cached_input_tokens: 20,
    output_tokens: 30,
    model_calls: 1,
    subagent_calls: 1,
    tool_calls: 1,
    cost_usd: null,
    event_parse_errors: 0,
  });
});

test('normalizer leaves token metrics null when the harness does not report usage', () => {
  const result = normalizeEvents([{ type: 'assistant.message', model: 'gpt-example' }], {
    harness: 'copilot-cli',
    model: 'gpt-example',
    durationMs: 7,
    exitCode: 1,
  });

  assert.equal(result.input_tokens, null);
  assert.equal(result.output_tokens, null);
  assert.equal(result.cost_usd, null);
  assert.equal(result.model_calls, null);
  assert.equal(result.subagent_calls, null);
  assert.equal(result.tool_calls, null);
  assert.equal(result.agent_exit, 1);
});

test('normalizes recorded Codex turn and completed command events', () => {
  const result = normalizeEvents([
    { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'item-1', type: 'command_execution', exit_code: 0 } },
    { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } },
  ], {
    harness: 'codex-cli',
    model: 'codex-model',
    durationMs: 10,
    exitCode: 0,
  });

  assert.equal(result.model_calls, 1);
  assert.equal(result.tool_calls, 1);
});

test('target adapters invoke the current harness entrypoints with JSONL output', () => {
  const copilot = fs.readFileSync(path.join(evalRoot, 'adapters', 'copilot-cli.sh'), 'utf8');
  const codex = fs.readFileSync(path.join(evalRoot, 'adapters', 'codex-cli.sh'), 'utf8');
  const runner = fs.readFileSync(path.join(evalRoot, 'run.sh'), 'utf8');

  assert.match(copilot, /copilot/);
  assert.match(copilot, /--agent 10x-squad/);
  assert.match(copilot, /--output-format json/);
  assert.match(copilot, /--model/);
  assert.match(codex, /args=\(exec/);
  assert.match(codex, /codex "\$\{args\[@\]\}"/);
  assert.match(codex, /\$10x-squad-vivaldi/);
  assert.match(codex, /--json/);
  assert.match(codex, /--model/);
  assert.match(codex, /--skip-git-repo-check/);
  assert.match(runner, /EVAL_ROUTING_CONFIG/);
  assert.match(runner, /model-routing\.json/);
});

test('dry-run eval emits the target-harness metric schema without a model call', () => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-eval-'));
  const csv = path.join(outputDirectory, 'results.csv');
  const runs = path.join(outputDirectory, 'runs');
  const smokeTask = path.join(evalRoot, 'tasks', 'smoke-hello');

  const result = spawnSync('bash', [path.join(evalRoot, 'run.sh'), 'test-variant', smokeTask], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DRY_RUN: '1',
      REPS: '1',
      EVAL_HARNESS: 'copilot-cli',
      RESULTS_CSV: csv,
      RUNS_DIR: runs,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const csvContent = fs.readFileSync(csv, 'utf8');
  const [header, row] = csvContent.trim().split(/\r?\n/);
  assert.equal(
    header,
    'timestamp,variant,prompt_sha,harness,requested_model,requested_reasoning,observed_models,task,rep,pass,agent_exit,input_tokens,cached_input_tokens,output_tokens,duration_ms,model_calls,subagent_calls,tool_calls,cost_usd,event_parse_errors,raw_events'
  );
  assert.match(row, /,test-variant,[^,]+,copilot-cli,dry-run,auto,,smoke-hello,1,1,0,/);
  assert.match(csvContent, /\r\n$/);
});

test('eval CSV quotes comma-bearing fields and remains summarizable', () => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-eval-csv-'));
  const csv = path.join(outputDirectory, 'results.csv');
  const smokeTask = path.join(evalRoot, 'tasks', 'smoke-hello');
  const result = spawnSync('bash', [path.join(evalRoot, 'run.sh'), 'baseline,control', smokeTask], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DRY_RUN: '1',
      REPS: '1',
      EVAL_HARNESS: 'copilot-cli',
      RESULTS_CSV: csv,
      RUNS_DIR: path.join(outputDirectory, 'runs'),
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(fs.readFileSync(csv, 'utf8'), /"baseline,control"/);

  const summary = spawnSync('bash', [path.join(evalRoot, 'summarize.sh')], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: { ...process.env, RESULTS_CSV: csv },
  });
  assert.equal(summary.status, 0, summary.stderr || summary.stdout);
  assert.match(summary.stdout, /baseline,control/);
  assert.match(summary.stdout, /copilot-cli/);
});

test('eval runner rejects an incompatible existing CSV schema before running tasks', () => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-eval-schema-'));
  const csv = path.join(outputDirectory, 'results.csv');
  fs.writeFileSync(csv, 'timestamp,variant,prompt_sha,task,rep,pass,cost_usd,duration_ms,num_turns\n');
  const smokeTask = path.join(evalRoot, 'tasks', 'smoke-hello');

  const result = spawnSync('bash', [path.join(evalRoot, 'run.sh'), 'schema-check', smokeTask], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DRY_RUN: '1',
      REPS: '1',
      EVAL_HARNESS: 'copilot-cli',
      RESULTS_CSV: csv,
      RUNS_DIR: path.join(outputDirectory, 'runs'),
    },
  });

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stderr, /incompatible results CSV schema/i);
  assert.equal(fs.readFileSync(csv, 'utf8').trim().split(/\r?\n/).length, 1);
});

test('eval runner rejects a results file already owned by another run', () => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-eval-lock-'));
  const csv = path.join(outputDirectory, 'results.csv');
  fs.mkdirSync(`${csv}.lock`);
  const smokeTask = path.join(evalRoot, 'tasks', 'smoke-hello');

  const result = spawnSync('bash', [path.join(evalRoot, 'run.sh'), 'locked', smokeTask], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DRY_RUN: '1',
      REPS: '1',
      EVAL_HARNESS: 'codex-cli',
      RESULTS_CSV: csv,
      RUNS_DIR: path.join(outputDirectory, 'runs'),
    },
  });

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stderr, /results CSV is already in use/);
  assert.equal(fs.existsSync(csv), false);
  assert.equal(fs.existsSync(`${csv}.lock`), true, 'must not remove another run\'s lock');
});

test('eval runner marks a corrupt JSONL event stream as failed', () => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-eval-corrupt-'));
  const csv = path.join(outputDirectory, 'results.csv');
  const events = path.join(outputDirectory, 'events.jsonl');
  fs.writeFileSync(events, 'null\n{"unexpected":true}\n');
  const smokeTask = path.join(evalRoot, 'tasks', 'smoke-hello');

  const result = spawnSync('bash', [path.join(evalRoot, 'run.sh'), 'corrupt-events', smokeTask], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DRY_RUN: '1',
      DRY_RUN_EVENTS_FILE: events,
      REPS: '1',
      EVAL_HARNESS: 'codex-cli',
      RESULTS_CSV: csv,
      RUNS_DIR: path.join(outputDirectory, 'runs'),
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const row = fs.readFileSync(csv, 'utf8').trim().split(/\r?\n/)[1];
  const values = row.split(',');
  assert.equal(values[9], '0', 'pass must be false');
  assert.equal(values[19], '2', 'parse error count must be preserved');
});

test('variant labels cannot escape the configured runs directory', () => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-eval-variant-path-'));
  const csv = path.join(outputDirectory, 'results.csv');
  const runs = path.join(outputDirectory, 'runs');
  const smokeTask = path.join(evalRoot, 'tasks', 'smoke-hello');

  const result = spawnSync('bash', [path.join(evalRoot, 'run.sh'), '../../escaped', smokeTask], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DRY_RUN: '1',
      REPS: '1',
      EVAL_HARNESS: 'codex-cli',
      RESULTS_CSV: csv,
      RUNS_DIR: runs,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const rawPath = fs.readFileSync(csv, 'utf8').trim().split(/\r?\n/)[1].split(',').at(-1);
  assert.ok(path.resolve(rawPath).startsWith(`${path.resolve(runs)}${path.sep}`));
  assert.equal(fs.existsSync(path.join(outputDirectory, 'escaped')), false);
});

test('tasks with the same basename are rejected before evidence can collide', () => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-eval-task-collision-'));
  const csv = path.join(outputDirectory, 'results.csv');
  const runs = path.join(outputDirectory, 'runs');
  const tasks = ['first', 'second'].map((parent) => {
    const task = path.join(outputDirectory, parent, 'same-task');
    const workspace = path.join(task, 'workspace');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(task, 'prompt.md'), 'Create the dry-run marker.\n');
    const check = path.join(task, 'check.sh');
    fs.writeFileSync(check, '#!/usr/bin/env bash\n[[ -f .dry-run-marker ]]\n');
    fs.chmodSync(check, 0o755);
    return task;
  });

  const result = spawnSync('bash', [path.join(evalRoot, 'run.sh'), 'collision-check', ...tasks], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DRY_RUN: '1',
      REPS: '1',
      EVAL_HARNESS: 'codex-cli',
      RESULTS_CSV: csv,
      RUNS_DIR: runs,
    },
  });

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stderr, /duplicate eval task name: same-task/);
  assert.equal(fs.existsSync(csv), false);
  assert.equal(fs.existsSync(runs), false);
});

test('repeated eval invocations preserve distinct raw event paths', () => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-eval-runs-'));
  const csv = path.join(outputDirectory, 'results.csv');
  const runs = path.join(outputDirectory, 'runs');
  const smokeTask = path.join(evalRoot, 'tasks', 'smoke-hello');
  const options = {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DRY_RUN: '1',
      REPS: '1',
      EVAL_HARNESS: 'codex-cli',
      RESULTS_CSV: csv,
      RUNS_DIR: runs,
    },
  };

  for (let invocation = 0; invocation < 2; invocation += 1) {
    const result = spawnSync('bash', [path.join(evalRoot, 'run.sh'), 'same-variant', smokeTask], options);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  const rows = fs.readFileSync(csv, 'utf8').trim().split(/\r?\n/).slice(1);
  assert.equal(rows.length, 2);
  const rawPaths = rows.map((row) => row.split(',').at(-1));
  assert.notEqual(rawPaths[0], rawPaths[1]);
  for (const rawPath of rawPaths) {
    assert.equal(fs.existsSync(path.join(evalRoot, rawPath)), false, 'custom RUNS_DIR paths remain absolute');
    assert.equal(fs.existsSync(rawPath), true);
  }
});

test('summarizer groups target profiles and reports missing metrics as n/a', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-summary-'));
  const csv = path.join(directory, 'results.csv');
  fs.writeFileSync(
    csv,
    [
      'timestamp,variant,prompt_sha,harness,requested_model,requested_reasoning,observed_models,task,rep,pass,agent_exit,input_tokens,cached_input_tokens,output_tokens,duration_ms,model_calls,subagent_calls,tool_calls,cost_usd,event_parse_errors,raw_events',
      '2026-08-21T00:00:00Z,variant-a,abc123,copilot-cli,gpt-example,low,gpt-example,task-a,1,1,0,,,,100,2,1,3,,0,runs/a.jsonl',
      '2026-08-21T00:01:00Z,variant-a,abc123,copilot-cli,gpt-example,low,gpt-example,task-a,2,1,0,,,,120,2,1,2,,0,runs/b.jsonl',
      '',
    ].join('\n')
  );

  const result = spawnSync('bash', [path.join(evalRoot, 'summarize.sh')], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: { ...process.env, RESULTS_CSV: csv },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /variant-a/);
  assert.match(result.stdout, /copilot-cli/);
  assert.match(result.stdout, /100%/);
  assert.match(result.stdout, /n\/a/);
});