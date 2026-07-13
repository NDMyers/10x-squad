'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(
  __dirname, '..', 'assets', 'skills', '10x-squad-configure-tiers', 'scripts', 'model-tier-config.js'
);

const engine = require(SCRIPT);
const {
  TIER_KEYS,
  SCHEMA_VERSION,
  expandDefaultAll,
  validateProfile,
  upsertProfile,
  removeProfile,
  resolve,
  configPaths,
} = engine;

const CANONICAL = ['trivial', 'lite', 'standard_clear', 'standard_ambiguous', 'complex'];

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function mkAssignments(model) {
  const a = {};
  for (const k of CANONICAL) a[k] = model;
  return a;
}

function mkProfile(model, extra = {}) {
  return { assignments: mkAssignments(model), ...extra };
}

function mkConfig(harnessMap) {
  const harnesses = {};
  for (const [h, model] of Object.entries(harnessMap)) {
    harnesses[h] = mkProfile(model);
  }
  return { schema_version: 1, updated_at: '2026-07-13T00:00:00.000Z', harnesses };
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}

function runCli(args, { env = {}, cwd } = {}) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: cwd || process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

// Sandbox: workspace root + isolated global config via XDG_CONFIG_HOME.
function sandbox() {
  const root = tmpdir('mtc-ws-');
  const xdg = tmpdir('mtc-xdg-');
  const wsFile = path.join(root, '.10x-squad', 'model-routing.json');
  const globalFile = path.join(xdg, '10x-squad', 'model-routing.json');
  const env = { XDG_CONFIG_HOME: xdg };
  return { root, xdg, wsFile, globalFile, env };
}

// ---------------------------------------------------------------------------
// Constants and default-all expansion
// ---------------------------------------------------------------------------

test('canonical tier keys and schema version', () => {
  assert.deepEqual(TIER_KEYS, CANONICAL);
  assert.equal(SCHEMA_VERSION, 1);
});

test('default-all expansion produces exactly five explicit assignments', () => {
  const a = expandDefaultAll('surface-native-id');
  assert.deepEqual(Object.keys(a).sort(), [...CANONICAL].sort());
  for (const k of CANONICAL) assert.equal(a[k], 'surface-native-id');
  // No default/inheritance marker is stored anywhere.
  assert.equal(JSON.stringify(a).includes('default'), false);
});

// ---------------------------------------------------------------------------
// Profile validation
// ---------------------------------------------------------------------------

test('valid complete profile passes', () => {
  const r = validateProfile(mkProfile('gpt-x'), { harness: 'copilot-cli' });
  assert.equal(r.ok, true, JSON.stringify(r.errors || []));
});

test('per-tier mode requires exactly all five canonical keys', () => {
  const missing = mkProfile('m');
  delete missing.assignments.complex;
  assert.equal(validateProfile(missing, { harness: 'h' }).ok, false);

  const unknown = mkProfile('m');
  unknown.assignments.standard = 'm'; // old 4-tier vocabulary is not a canonical key
  assert.equal(validateProfile(unknown, { harness: 'h' }).ok, false);
});

test('auto, inherit, blank, null, and non-string assignments are invalid', () => {
  for (const bad of ['auto', 'Auto', 'AUTO', 'inherit', 'Inherit', '', '   ', null, 42, {}, []]) {
    const p = mkProfile('ok-model');
    p.assignments.lite = bad;
    const r = validateProfile(p, { harness: 'h' });
    assert.equal(r.ok, false, `expected invalid for ${JSON.stringify(bad)}`);
  }
});

test('unknown profile-level fields are rejected (strict allowlist)', () => {
  const p = mkProfile('m', { default: 'm' });
  assert.equal(validateProfile(p, { harness: 'h' }).ok, false);
});

test('credential-shaped fields are rejected wherever they appear', () => {
  for (const field of ['api_key', 'apiKey', 'token', 'secret', 'password', 'authorization']) {
    const p = mkProfile('m');
    p.model_checks = { m: { status: 'unverified', [field]: 'x' } };
    assert.equal(validateProfile(p, { harness: 'h' }).ok, false, `field ${field}`);
  }
});

test('opaque assignment and label values are not heuristically scanned for secrets', () => {
  const p = mkProfile('model-with-token=abc123-in-name');
  p.model_checks = {
    'model-with-token=abc123-in-name': { status: 'unverified', display_name: 'secret token model' },
  };
  assert.equal(validateProfile(p, { harness: 'h' }).ok, true);
});

test('model_checks status must be verified or unverified in a proposal', () => {
  const p = mkProfile('m');
  p.model_checks = { m: { status: 'sort-of' } };
  assert.equal(validateProfile(p, { harness: 'h' }).ok, false);
});

test('free-text identifiers are preserved byte-for-byte', () => {
  const weird = '  My Local Llama 70B (exp) — v2  ';
  const p = { assignments: mkAssignments(weird) };
  const cfg = upsertProfile(null, 'copilot-cli', p, '2026-07-13T01:00:00.000Z');
  assert.equal(cfg.harnesses['copilot-cli'].assignments.trivial, weird);
});

// ---------------------------------------------------------------------------
// Pure resolution: precedence, wholesale replacement, advisory metadata
// ---------------------------------------------------------------------------

test('workspace profile replaces the matching global harness profile wholesale', () => {
  const ws = mkConfig({ 'copilot-cli': 'ws-model' });
  const glob = mkConfig({ 'copilot-cli': 'global-model' });
  for (const tier of CANONICAL) {
    const r = resolve({ workspaceConfig: ws, globalConfig: glob, harness: 'copilot-cli', tier });
    assert.equal(r.ok, true);
    assert.equal(r.model, 'ws-model');
    assert.equal(r.scope, 'workspace');
  }
});

test('workspace file without the active harness falls through to the global profile', () => {
  const ws = mkConfig({ 'copilot-vscode': 'vs-model' });
  const glob = mkConfig({ 'copilot-cli': 'global-model' });
  const r = resolve({ workspaceConfig: ws, globalConfig: glob, harness: 'copilot-cli', tier: 'lite' });
  assert.equal(r.ok, true);
  assert.equal(r.model, 'global-model');
  assert.equal(r.scope, 'global');
});

test('harness mismatch never reuses another surface identifier', () => {
  const glob = mkConfig({ 'copilot-vscode': 'GPT-X (copilot)' });
  const r = resolve({ workspaceConfig: null, globalConfig: glob, harness: 'copilot-cli', tier: 'lite' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 3);
});

test('vscode and cli profiles may carry different identifier forms', () => {
  const glob = {
    schema_version: 1,
    updated_at: '2026-07-13T00:00:00.000Z',
    harnesses: {
      'copilot-vscode': mkProfile('GPT-X (copilot)'),
      'copilot-cli': mkProfile('gpt-x'),
    },
  };
  const vs = resolve({ workspaceConfig: null, globalConfig: glob, harness: 'copilot-vscode', tier: 'complex' });
  const cli = resolve({ workspaceConfig: null, globalConfig: glob, harness: 'copilot-cli', tier: 'complex' });
  assert.equal(vs.model, 'GPT-X (copilot)');
  assert.equal(cli.model, 'gpt-x');
});

test('invalid tier key is rejected with code 4', () => {
  const glob = mkConfig({ 'copilot-cli': 'm' });
  const r = resolve({ workspaceConfig: null, globalConfig: glob, harness: 'copilot-cli', tier: 'standard' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 4);
});

test('no configuration anywhere yields code 2', () => {
  const r = resolve({ workspaceConfig: null, globalConfig: null, harness: 'copilot-cli', tier: 'lite' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 2);
});

test('missing, malformed, or unused advisory metadata never blocks resolution', () => {
  // No model_checks at all → unverified.
  const noChecks = mkConfig({ 'copilot-cli': 'm' });
  let r = resolve({ workspaceConfig: null, globalConfig: noChecks, harness: 'copilot-cli', tier: 'lite' });
  assert.equal(r.ok, true);
  assert.equal(r.check_status, 'unverified');

  // Unused entry (keyed by a value no assignment uses) → still resolves.
  const unused = mkConfig({ 'copilot-cli': 'm' });
  unused.harnesses['copilot-cli'].model_checks = { other: { status: 'verified' } };
  r = resolve({ workspaceConfig: null, globalConfig: unused, harness: 'copilot-cli', tier: 'lite' });
  assert.equal(r.ok, true);
  assert.equal(r.check_status, 'unverified');

  // Malformed advisory entry (non-object) → resolves as unverified.
  const malformed = mkConfig({ 'copilot-cli': 'm' });
  malformed.harnesses['copilot-cli'].model_checks = { m: 'yes' };
  r = resolve({ workspaceConfig: null, globalConfig: malformed, harness: 'copilot-cli', tier: 'lite' });
  assert.equal(r.ok, true);
  assert.equal(r.check_status, 'unverified');
});

test('verified status is honored with no time-based expiry', () => {
  const cfg = mkConfig({ 'copilot-cli': 'm' });
  cfg.harnesses['copilot-cli'].model_checks = {
    m: { status: 'verified', method: 'dispatch_smoke_test', source: 'harness', checked_at: '2001-01-01T00:00:00.000Z' },
  };
  const r = resolve({ workspaceConfig: null, globalConfig: cfg, harness: 'copilot-cli', tier: 'complex' });
  assert.equal(r.ok, true);
  assert.equal(r.check_status, 'verified');
});

// ---------------------------------------------------------------------------
// Pure mutation: upsert / remove preserve unrelated profiles
// ---------------------------------------------------------------------------

test('upsert preserves every unrelated harness profile at the data level', () => {
  const before = mkConfig({ 'copilot-vscode': 'vs-m', other: 'o-m' });
  const frozen = JSON.stringify(before.harnesses['copilot-vscode']) + JSON.stringify(before.harnesses.other);
  const after = upsertProfile(before, 'copilot-cli', mkProfile('cli-m'), '2026-07-13T02:00:00.000Z');
  assert.equal(
    JSON.stringify(after.harnesses['copilot-vscode']) + JSON.stringify(after.harnesses.other),
    frozen
  );
  assert.equal(after.harnesses['copilot-cli'].assignments.lite, 'cli-m');
  assert.equal(after.updated_at, '2026-07-13T02:00:00.000Z');
  // Input object is not mutated.
  assert.equal(before.harnesses['copilot-cli'], undefined);
});

test('upsert rejects an invalid proposal without producing a config', () => {
  const bad = mkProfile('m');
  bad.assignments.lite = 'auto';
  assert.throws(() => upsertProfile(null, 'copilot-cli', bad, '2026-07-13T02:00:00.000Z'));
});

test('remove drops one harness and reports when the last profile is removed', () => {
  const cfg = mkConfig({ a: 'm1', b: 'm2' });
  const step1 = removeProfile(cfg, 'a');
  assert.equal(step1.removed, true);
  assert.ok(step1.config);
  assert.equal(step1.config.harnesses.a, undefined);
  assert.equal(JSON.stringify(step1.config.harnesses.b), JSON.stringify(cfg.harnesses.b));

  const step2 = removeProfile(step1.config, 'b');
  assert.equal(step2.removed, true);
  assert.equal(step2.config, null); // caller deletes the file

  const miss = removeProfile(cfg, 'nope');
  assert.equal(miss.removed, false);
});

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

test('config path resolution is deterministic under injected env', () => {
  const p1 = configPaths({ workspaceRoot: '/ws', env: { XDG_CONFIG_HOME: '/xdg' }, homedir: '/home/u' });
  assert.equal(p1.workspace, path.join('/ws', '.10x-squad', 'model-routing.json'));
  assert.equal(p1.global, path.join('/xdg', '10x-squad', 'model-routing.json'));

  const p2 = configPaths({ workspaceRoot: '/ws', env: {}, homedir: '/home/u' });
  assert.equal(p2.global, path.join('/home/u', '.config', '10x-squad', 'model-routing.json'));
});

// ---------------------------------------------------------------------------
// CLI subprocess contract (the interface Vivaldi consumes)
// ---------------------------------------------------------------------------

test('resolve: success prints exactly one JSON object on stdout and exits 0', () => {
  const sb = sandbox();
  writeJson(sb.wsFile, mkConfig({ 'copilot-vscode': 'surface-native-model-id' }));
  const r = runCli(
    ['resolve', '--workspace-root', sb.root, '--harness', 'copilot-vscode', '--tier', 'standard_clear', '--json'],
    { env: sb.env }
  );
  assert.equal(r.code, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 1, 'stdout must be a single JSON object with no prose');
  const out = JSON.parse(lines[0]);
  assert.deepEqual(out, {
    ok: true,
    schema_version: 1,
    scope: 'workspace',
    harness: 'copilot-vscode',
    tier: 'standard_clear',
    model: 'surface-native-model-id',
    check_status: 'unverified',
  });
});

test('resolve: exit 2 when configuration is missing everywhere', () => {
  const sb = sandbox();
  const r = runCli(
    ['resolve', '--workspace-root', sb.root, '--harness', 'copilot-cli', '--tier', 'lite', '--json'],
    { env: sb.env }
  );
  assert.equal(r.code, 2);
  assert.equal(r.stdout.trim(), '');
  assert.match(r.stderr, /10x-squad-configure-tiers/); // actionable next step
});

test('resolve: exit 2 when configuration is corrupt or incomplete', () => {
  const sb = sandbox();
  fs.mkdirSync(path.dirname(sb.wsFile), { recursive: true });
  fs.writeFileSync(sb.wsFile, '{ not json');
  let r = runCli(
    ['resolve', '--workspace-root', sb.root, '--harness', 'copilot-cli', '--tier', 'lite', '--json'],
    { env: sb.env }
  );
  assert.equal(r.code, 2);

  const incomplete = mkConfig({ 'copilot-cli': 'm' });
  delete incomplete.harnesses['copilot-cli'].assignments.complex;
  writeJson(sb.wsFile, incomplete);
  r = runCli(
    ['resolve', '--workspace-root', sb.root, '--harness', 'copilot-cli', '--tier', 'lite', '--json'],
    { env: sb.env }
  );
  assert.equal(r.code, 2);

  const badVersion = mkConfig({ 'copilot-cli': 'm' });
  badVersion.schema_version = 2;
  writeJson(sb.wsFile, badVersion);
  r = runCli(
    ['resolve', '--workspace-root', sb.root, '--harness', 'copilot-cli', '--tier', 'lite', '--json'],
    { env: sb.env }
  );
  assert.equal(r.code, 2);
});

test('resolve: exit 3 when the active harness profile is missing', () => {
  const sb = sandbox();
  writeJson(sb.globalFile, mkConfig({ 'copilot-vscode': 'm' }));
  const r = runCli(
    ['resolve', '--workspace-root', sb.root, '--harness', 'copilot-cli', '--tier', 'lite', '--json'],
    { env: sb.env }
  );
  assert.equal(r.code, 3);
  assert.match(r.stderr, /copilot-cli/);
});

test('resolve: exit 4 on an invalid tier key', () => {
  const sb = sandbox();
  writeJson(sb.wsFile, mkConfig({ 'copilot-cli': 'm' }));
  const r = runCli(
    ['resolve', '--workspace-root', sb.root, '--harness', 'copilot-cli', '--tier', 'frontier1', '--json'],
    { env: sb.env }
  );
  assert.equal(r.code, 4);
});

test('resolve: exit 5 on an I/O failure reading configuration', () => {
  const sb = sandbox();
  fs.mkdirSync(sb.wsFile, { recursive: true }); // a directory where the file should be → EISDIR
  const r = runCli(
    ['resolve', '--workspace-root', sb.root, '--harness', 'copilot-cli', '--tier', 'lite', '--json'],
    { env: sb.env }
  );
  assert.equal(r.code, 5);
});

test('resolve: workspace precedence over global, and fallthrough per harness', () => {
  const sb = sandbox();
  writeJson(sb.globalFile, mkConfig({ 'copilot-cli': 'global-m', 'copilot-vscode': 'global-vs' }));
  writeJson(sb.wsFile, mkConfig({ 'copilot-cli': 'ws-m' }));

  let r = runCli(
    ['resolve', '--workspace-root', sb.root, '--harness', 'copilot-cli', '--tier', 'complex', '--json'],
    { env: sb.env }
  );
  let out = JSON.parse(r.stdout);
  assert.equal(out.model, 'ws-m');
  assert.equal(out.scope, 'workspace');

  r = runCli(
    ['resolve', '--workspace-root', sb.root, '--harness', 'copilot-vscode', '--tier', 'complex', '--json'],
    { env: sb.env }
  );
  out = JSON.parse(r.stdout);
  assert.equal(out.model, 'global-vs');
  assert.equal(out.scope, 'global');
});

test('validate-profile: valid input exits 0, invalid exits 2', () => {
  const sb = sandbox();
  const good = path.join(sb.root, 'good.json');
  const bad = path.join(sb.root, 'bad.json');
  writeJson(good, mkProfile('m'));
  const badProfile = mkProfile('m');
  badProfile.assignments.lite = 'inherit';
  writeJson(bad, badProfile);

  assert.equal(runCli(['validate-profile', '--input', good, '--harness', 'copilot-cli'], { env: sb.env }).code, 0);
  const r = runCli(['validate-profile', '--input', bad, '--harness', 'copilot-cli'], { env: sb.env });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /inherit/);
});

test('upsert-profile: writes atomically, preserves unrelated profiles byte-for-byte at data level', () => {
  const sb = sandbox();
  writeJson(sb.wsFile, mkConfig({ 'copilot-vscode': 'vs-m' }));
  const beforeVs = JSON.stringify(JSON.parse(fs.readFileSync(sb.wsFile, 'utf8')).harnesses['copilot-vscode']);

  const proposal = path.join(sb.root, 'proposal.json');
  writeJson(proposal, mkProfile('cli-m'));
  const r = runCli(
    ['upsert-profile', '--input', proposal, '--scope', 'workspace', '--workspace-root', sb.root, '--harness', 'copilot-cli'],
    { env: sb.env }
  );
  assert.equal(r.code, 0, r.stderr);

  const after = JSON.parse(fs.readFileSync(sb.wsFile, 'utf8'));
  assert.equal(JSON.stringify(after.harnesses['copilot-vscode']), beforeVs);
  assert.equal(after.harnesses['copilot-cli'].assignments.trivial, 'cli-m');
  assert.equal(after.schema_version, 1);
  // No temp files left behind.
  const leftovers = fs.readdirSync(path.dirname(sb.wsFile)).filter((f) => f !== 'model-routing.json');
  assert.deepEqual(leftovers, []);
});

test('upsert-profile: invalid input exits nonzero and leaves the prior file unchanged', () => {
  const sb = sandbox();
  writeJson(sb.wsFile, mkConfig({ 'copilot-cli': 'keep-me' }));
  const beforeBytes = fs.readFileSync(sb.wsFile, 'utf8');

  const proposal = path.join(sb.root, 'proposal.json');
  const bad = mkProfile('m');
  bad.assignments.lite = '';
  writeJson(proposal, bad);
  const r = runCli(
    ['upsert-profile', '--input', proposal, '--scope', 'workspace', '--workspace-root', sb.root, '--harness', 'copilot-cli'],
    { env: sb.env }
  );
  assert.notEqual(r.code, 0);
  assert.equal(fs.readFileSync(sb.wsFile, 'utf8'), beforeBytes);
});

test('upsert-profile: global scope writes under XDG_CONFIG_HOME', () => {
  const sb = sandbox();
  const proposal = path.join(sb.root, 'proposal.json');
  writeJson(proposal, mkProfile('gm'));
  const r = runCli(
    ['upsert-profile', '--input', proposal, '--scope', 'global', '--workspace-root', sb.root, '--harness', 'copilot-cli'],
    { env: sb.env }
  );
  assert.equal(r.code, 0, r.stderr);
  const cfg = JSON.parse(fs.readFileSync(sb.globalFile, 'utf8'));
  assert.equal(cfg.harnesses['copilot-cli'].assignments.complex, 'gm');
});

test('diff-profile: previews stored and effective change without writing', () => {
  const sb = sandbox();
  writeJson(sb.globalFile, mkConfig({ 'copilot-cli': 'global-m' }));
  const proposal = path.join(sb.root, 'proposal.json');
  writeJson(proposal, mkProfile('new-m'));

  const r = runCli(
    ['diff-profile', '--input', proposal, '--scope', 'workspace', '--workspace-root', sb.root, '--harness', 'copilot-cli'],
    { env: sb.env }
  );
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.scope, 'workspace');
  assert.equal(out.stored_before, null); // no workspace file yet
  assert.equal(out.stored_after.assignments.lite, 'new-m');
  assert.equal(out.effective_after.lite, 'new-m');
  assert.equal(fs.existsSync(sb.wsFile), false); // nothing written
});

test('remove-profile: dry-run previews without writing; removing last profile deletes only the file', () => {
  const sb = sandbox();
  writeJson(sb.globalFile, mkConfig({ 'copilot-cli': 'global-m' }));
  writeJson(sb.wsFile, mkConfig({ 'copilot-cli': 'ws-m' }));
  const beforeBytes = fs.readFileSync(sb.wsFile, 'utf8');

  let r = runCli(
    ['remove-profile', '--scope', 'workspace', '--workspace-root', sb.root, '--harness', 'copilot-cli', '--dry-run'],
    { env: sb.env }
  );
  assert.equal(r.code, 0, r.stderr);
  const preview = JSON.parse(r.stdout);
  assert.equal(preview.dry_run, true);
  assert.equal(preview.would_delete_file, true);
  assert.equal(fs.readFileSync(sb.wsFile, 'utf8'), beforeBytes);

  r = runCli(
    ['remove-profile', '--scope', 'workspace', '--workspace-root', sb.root, '--harness', 'copilot-cli'],
    { env: sb.env }
  );
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fs.existsSync(sb.wsFile), false);
  assert.equal(fs.existsSync(path.dirname(sb.wsFile)), true); // .10x-squad dir intact

  // Global profile is revealed on the next resolve.
  const res = runCli(
    ['resolve', '--workspace-root', sb.root, '--harness', 'copilot-cli', '--tier', 'lite', '--json'],
    { env: sb.env }
  );
  const out = JSON.parse(res.stdout);
  assert.equal(out.model, 'global-m');
  assert.equal(out.scope, 'global');
});

test('remove-profile: keeps the file when other harness profiles remain', () => {
  const sb = sandbox();
  writeJson(sb.wsFile, mkConfig({ 'copilot-cli': 'a', 'copilot-vscode': 'b' }));
  const r = runCli(
    ['remove-profile', '--scope', 'workspace', '--workspace-root', sb.root, '--harness', 'copilot-cli'],
    { env: sb.env }
  );
  assert.equal(r.code, 0, r.stderr);
  const cfg = JSON.parse(fs.readFileSync(sb.wsFile, 'utf8'));
  assert.equal(cfg.harnesses['copilot-cli'], undefined);
  assert.equal(cfg.harnesses['copilot-vscode'].assignments.lite, 'b');
});

test('free-text value round-trips byte-for-byte through the CLI and resolves unverified', () => {
  const sb = sandbox();
  const weird = 'Llama-3.3-70B @local (byok) — «exact»';
  const proposal = path.join(sb.root, 'proposal.json');
  writeJson(proposal, { assignments: mkAssignments(weird) });
  let r = runCli(
    ['upsert-profile', '--input', proposal, '--scope', 'workspace', '--workspace-root', sb.root, '--harness', 'copilot-cli'],
    { env: sb.env }
  );
  assert.equal(r.code, 0, r.stderr);

  r = runCli(
    ['resolve', '--workspace-root', sb.root, '--harness', 'copilot-cli', '--tier', 'trivial', '--json'],
    { env: sb.env }
  );
  const out = JSON.parse(r.stdout);
  assert.equal(out.model, weird);
  assert.equal(out.check_status, 'unverified');
});
