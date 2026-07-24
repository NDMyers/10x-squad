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
  isForbiddenAssignment,
  validateProfile,
  validateConfigShape,
  upsertProfile,
  removeProfile,
  effectiveProfile,
  resolve,
  configPaths,
} = engine;

const CANONICAL = ['trivial', 'lite', 'standard_clear', 'standard_ambiguous', 'complex'];
const NOW = '2026-07-13T00:00:00.000Z';
const AUTO_SETTINGS = { reasoning_effort: 'auto', context_tier: 'auto' };

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

function defineOwn(obj, key, value) {
  Object.defineProperty(obj, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function mkDispatchSettings(reasoningEffort = 'auto', contextTier = 'auto') {
  return Object.fromEntries(CANONICAL.map((tier) => [tier, {
    reasoning_effort: reasoningEffort,
    context_tier: contextTier,
  }]));
}

function mkConfig(harnessMap) {
  const harnesses = {};
  for (const [h, model] of Object.entries(harnessMap)) {
    defineOwn(harnesses, h, mkProfile(model));
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

test('canonical tier keys and latest schema version', () => {
  assert.deepEqual(TIER_KEYS, CANONICAL);
  assert.equal(SCHEMA_VERSION, 2);
});

test('stored schema versions 1 and 2 are readable while other versions are rejected', () => {
  const v1 = mkConfig({ 'copilot-cli': 'm' });
  const v2 = { ...structuredClone(v1), schema_version: 2 };
  assert.equal(validateConfigShape(v1).ok, true);
  assert.equal(validateConfigShape(v2).ok, true);

  for (const version of [0, 3, '2', null]) {
    assert.equal(validateConfigShape({ ...structuredClone(v1), schema_version: version }).ok, false);
  }
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

test('dispatch settings require exactly the five canonical tier keys', () => {
  const complete = mkProfile('m', { dispatch_settings: mkDispatchSettings() });
  assert.equal(validateProfile(complete, { harness: 'copilot-cli' }).ok, true);

  const missing = structuredClone(complete);
  delete missing.dispatch_settings.complex;
  assert.equal(validateProfile(missing, { harness: 'copilot-cli' }).ok, false);

  const unknown = structuredClone(complete);
  unknown.dispatch_settings.standard = { ...AUTO_SETTINGS };
  assert.equal(validateProfile(unknown, { harness: 'copilot-cli' }).ok, false);
});

test('dispatch setting entries contain exactly reasoning_effort and context_tier', () => {
  for (const field of ['reasoning_effort', 'context_tier']) {
    const missing = mkProfile('m', { dispatch_settings: mkDispatchSettings() });
    delete missing.dispatch_settings.lite[field];
    assert.equal(validateProfile(missing, { harness: 'copilot-cli' }).ok, false, `missing ${field}`);
  }

  const unknown = mkProfile('m', { dispatch_settings: mkDispatchSettings() });
  unknown.dispatch_settings.lite.temperature = 'auto';
  assert.equal(validateProfile(unknown, { harness: 'copilot-cli' }).ok, false);

  const inherited = mkProfile('m', { dispatch_settings: mkDispatchSettings() });
  inherited.dispatch_settings.lite = Object.create(AUTO_SETTINGS);
  assert.equal(validateProfile(inherited, { harness: 'copilot-cli' }).ok, false);
});

test('dispatch settings accept only canonical reasoning and context values', () => {
  for (const reasoningEffort of ['auto', 'low', 'medium', 'high', 'xhigh']) {
    const p = mkProfile('m', { dispatch_settings: mkDispatchSettings(reasoningEffort, 'auto') });
    assert.equal(validateProfile(p, { harness: 'copilot-cli' }).ok, true, reasoningEffort);
  }
  for (const contextTier of ['auto', 'default', 'long_context']) {
    const p = mkProfile('m', { dispatch_settings: mkDispatchSettings('auto', contextTier) });
    assert.equal(validateProfile(p, { harness: 'copilot-cli' }).ok, true, contextTier);
  }

  for (const bad of ['Auto', 'inherit', '', null, 42, {}, []]) {
    const reasoning = mkProfile('m', { dispatch_settings: mkDispatchSettings() });
    reasoning.dispatch_settings.lite.reasoning_effort = bad;
    assert.equal(validateProfile(reasoning, { harness: 'copilot-cli' }).ok, false, `reasoning ${JSON.stringify(bad)}`);

    const context = mkProfile('m', { dispatch_settings: mkDispatchSettings() });
    context.dispatch_settings.lite.context_tier = bad;
    assert.equal(validateProfile(context, { harness: 'copilot-cli' }).ok, false, `context ${JSON.stringify(bad)}`);
  }
});

test('dispatch settings reject unknown and credential-shaped nested fields', () => {
  const unknown = mkProfile('m', { dispatch_settings: mkDispatchSettings() });
  unknown.dispatch_settings.standard_clear.temperature = 'low';
  const unknownResult = validateProfile(unknown, { harness: 'copilot-cli' });
  assert.equal(unknownResult.ok, false);
  assert.match(unknownResult.errors.join('; '), /unknown field/);

  for (const field of ['api_key', 'apiKey', 'token', 'secret', 'password', 'authorization']) {
    const p = mkProfile('m', { dispatch_settings: mkDispatchSettings() });
    p.dispatch_settings.standard_clear[field] = 'x';
    const result = validateProfile(p, { harness: 'copilot-cli' });
    assert.equal(result.ok, false, `field ${field}`);
    assert.match(result.errors.join('; '), /credential-shaped field/);
  }
});

test('only copilot-cli supports explicit dispatch settings', () => {
  const explicit = mkProfile('m', { dispatch_settings: mkDispatchSettings('medium', 'long_context') });
  assert.equal(validateProfile(explicit, { harness: 'copilot-cli' }).ok, true);
  assert.equal(validateProfile(explicit, { harness: 'copilot-vscode' }).ok, false);
  assert.equal(validateProfile(explicit, { harness: 'unknown-surface' }).ok, false);

  const automatic = mkProfile('m', { dispatch_settings: mkDispatchSettings() });
  assert.equal(validateProfile(automatic, { harness: 'copilot-vscode' }).ok, true);
  assert.equal(validateProfile(automatic, { harness: 'unknown-surface' }).ok, true);
});

test('codex-cli accepts max/ultra reasoning but only auto context_tier', () => {
  for (const effort of ['max', 'ultra']) {
    const p = mkProfile('gpt-5.6-sol', { dispatch_settings: mkDispatchSettings(effort, 'auto') });
    assert.equal(validateProfile(p, { harness: 'codex-cli' }).ok, true, effort);
  }

  // context_tier has no Codex analog — only auto is legal (spike C7).
  for (const contextTier of ['default', 'long_context']) {
    const p = mkProfile('gpt-5.6-sol', { dispatch_settings: mkDispatchSettings('high', contextTier) });
    const result = validateProfile(p, { harness: 'codex-cli' });
    assert.equal(result.ok, false, contextTier);
    assert.match(result.errors.join('; '), /context_tier must be one of auto for harness "codex-cli"/);
  }

  // max/ultra are Codex-only and must not leak into the Copilot vocabulary.
  for (const effort of ['max', 'ultra']) {
    const p = mkProfile('gpt-5.4', { dispatch_settings: mkDispatchSettings(effort, 'auto') });
    assert.equal(validateProfile(p, { harness: 'copilot-cli' }).ok, false, effort);
  }
});

test('schema v1 rejects dispatch settings while schema v2 permits legacy profiles without them', () => {
  const v1 = mkConfig({ 'copilot-cli': 'm' });
  v1.harnesses['copilot-cli'].dispatch_settings = mkDispatchSettings();
  assert.equal(validateConfigShape(v1).ok, false);

  const v2Legacy = { ...mkConfig({ 'copilot-vscode': 'm' }), schema_version: 2 };
  assert.equal(validateConfigShape(v2Legacy).ok, true);

  const v2ExplicitUnsupported = structuredClone(v2Legacy);
  v2ExplicitUnsupported.harnesses['copilot-vscode'].dispatch_settings = mkDispatchSettings('high', 'default');
  assert.equal(validateConfigShape(v2ExplicitUnsupported).ok, false);
});

test('inherited optional proposal fields are ignored and never persisted', () => {
  const profile = mkProfile('m');
  Object.setPrototypeOf(profile, {
    dispatch_settings: mkDispatchSettings('high', 'long_context'),
    model_checks: { m: { status: 'verified' } },
  });

  assert.equal(validateProfile(profile, { harness: 'copilot-vscode' }).ok, true);
  const cfg = upsertProfile(null, 'copilot-vscode', profile, NOW);
  const stored = cfg.harnesses['copilot-vscode'];
  assert.deepEqual(stored.dispatch_settings, mkDispatchSettings());
  assert.equal(Object.hasOwn(stored, 'model_checks'), false);
});

test('inherited optional stored fields read as omitted legacy data', () => {
  const profile = mkProfile('m');
  Object.setPrototypeOf(profile, {
    dispatch_settings: mkDispatchSettings('high', 'long_context'),
    model_checks: { m: { status: 'verified' } },
  });
  const cfg = {
    schema_version: 1,
    updated_at: NOW,
    harnesses: { 'copilot-cli': profile },
  };

  assert.equal(validateConfigShape(cfg).ok, true);
  const result = resolve({ workspaceConfig: cfg, globalConfig: null, harness: 'copilot-cli', tier: 'lite' });
  assert.equal(result.reasoning_effort, 'auto');
  assert.equal(result.context_tier, 'auto');
  assert.equal(result.check_status, 'unverified');
});

test('per-tier mode requires exactly all five canonical keys', () => {
  const missing = mkProfile('m');
  delete missing.assignments.complex;
  assert.equal(validateProfile(missing, { harness: 'h' }).ok, false);

  const unknown = mkProfile('m');
  unknown.assignments.standard = 'm'; // old 4-tier vocabulary is not a canonical key
  assert.equal(validateProfile(unknown, { harness: 'h' }).ok, false);
});

test('proposal assignment maps require own canonical tier keys', () => {
  const inherited = { assignments: Object.create(mkAssignments('m')) };
  assert.equal(validateProfile(inherited, { harness: 'copilot-cli' }).ok, false);
});

test('stored assignment maps require own canonical tier keys', () => {
  const cfg = mkConfig({ 'copilot-cli': 'm' });
  cfg.harnesses['copilot-cli'].assignments = Object.create(mkAssignments('m'));
  assert.equal(validateConfigShape(cfg).ok, false);
});

test('auto, inherit, blank, null, and non-string assignments are invalid', () => {
  for (const bad of [
    'auto',
    'Auto',
    'AUTO',
    'Auto (copilot)',
    'AUTO (GitHub Copilot)',
    'inherit',
    'Inherit',
    'inherit (surface)',
    '',
    '   ',
    null,
    42,
    {},
    [],
  ]) {
    const p = mkProfile('ok-model');
    p.assignments.lite = bad;
    const r = validateProfile(p, { harness: 'h' });
    assert.equal(r.ok, false, `expected invalid for ${JSON.stringify(bad)}`);
  }
});

test('isForbiddenAssignment recognizes decorated auto and inherit values', () => {
  for (const value of ['Auto (copilot)', 'AUTO (GitHub Copilot)', 'inherit (surface)']) {
    assert.equal(isForbiddenAssignment(value), true, `expected forbidden for ${JSON.stringify(value)}`);
  }
});

test('stored config rejects a decorated auto assignment', () => {
  const cfg = mkConfig({ 'copilot-cli': 'Auto (copilot)' });
  assert.equal(validateConfigShape(cfg).ok, false);
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

test('already-resolved opaque exact identifier is preserved byte-for-byte', () => {
  const exactModel = 'Claude Sonnet 4.5 (copilot)';
  const p = { assignments: mkAssignments(exactModel) };
  const cfg = upsertProfile(null, 'copilot-vscode', p, '2026-07-13T01:00:00.000Z');
  assert.equal(cfg.harnesses['copilot-vscode'].assignments.trivial, exactModel);
});

// ---------------------------------------------------------------------------
// Pure resolution: precedence, wholesale replacement, advisory metadata
// ---------------------------------------------------------------------------

test('effective profile ignores absent prototype-colliding harness names', () => {
  const cfg = mkConfig({ 'copilot-cli': 'm' });
  for (const harness of ['toString', 'constructor', '__proto__']) {
    assert.equal(
      effectiveProfile({ workspaceConfig: cfg, globalConfig: null, harness }),
      null,
      harness
    );
  }
});

test('prototype-colliding absent harness names resolve with HARNESS code 3', () => {
  const cfg = mkConfig({ 'copilot-cli': 'm' });
  for (const harness of ['toString', 'constructor', '__proto__']) {
    const result = resolve({ workspaceConfig: cfg, globalConfig: null, harness, tier: 'lite' });
    assert.equal(result.ok, false, harness);
    assert.equal(result.code, 3, harness);
  }
});

test('schema-v1 profiles resolve omitted runtime settings as auto', () => {
  const cfg = mkConfig({ 'copilot-cli': 'gpt-5.4' });
  const result = resolve({
    workspaceConfig: cfg,
    globalConfig: null,
    harness: 'copilot-cli',
    tier: 'complex',
  });
  assert.equal(result.ok, true);
  assert.equal(result.schema_version, 1);
  assert.deepEqual(
    { reasoning_effort: result.reasoning_effort, context_tier: result.context_tier },
    AUTO_SETTINGS
  );
});

test('schema-v2 profiles resolve explicit per-tier runtime settings', () => {
  const profile = mkProfile('gpt-5.4', {
    dispatch_settings: mkDispatchSettings('medium', 'long_context'),
  });
  profile.dispatch_settings.standard_clear = { reasoning_effort: 'xhigh', context_tier: 'default' };
  const cfg = {
    schema_version: 2,
    updated_at: NOW,
    harnesses: { 'copilot-cli': profile },
  };
  assert.equal(validateConfigShape(cfg).ok, true);

  const result = resolve({
    workspaceConfig: cfg,
    globalConfig: null,
    harness: 'copilot-cli',
    tier: 'standard_clear',
  });
  assert.equal(result.ok, true);
  assert.equal(result.schema_version, 2);
  assert.equal(result.model, 'gpt-5.4');
  assert.equal(result.reasoning_effort, 'xhigh');
  assert.equal(result.context_tier, 'default');
});

test('resolve reports the schema version of the selected config scope', () => {
  const workspace = mkConfig({ 'copilot-vscode': 'workspace-vs' });
  const global = { ...mkConfig({ 'copilot-cli': 'global-cli' }), schema_version: 2 };

  const result = resolve({
    workspaceConfig: workspace,
    globalConfig: global,
    harness: 'copilot-cli',
    tier: 'lite',
  });
  assert.equal(result.ok, true);
  assert.equal(result.scope, 'global');
  assert.equal(result.schema_version, 2);
});

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
  const proposal = mkProfile('cli-m', { dispatch_settings: mkDispatchSettings('medium', 'long_context') });
  const after = upsertProfile(before, 'copilot-cli', proposal, '2026-07-13T02:00:00.000Z');
  assert.equal(
    JSON.stringify(after.harnesses['copilot-vscode']) + JSON.stringify(after.harnesses.other),
    frozen
  );
  assert.equal(after.harnesses['copilot-cli'].assignments.lite, 'cli-m');
  assert.deepEqual(after.harnesses['copilot-cli'].dispatch_settings.lite, {
    reasoning_effort: 'medium',
    context_tier: 'long_context',
  });
  assert.equal(after.schema_version, 2);
  assert.equal(after.updated_at, '2026-07-13T02:00:00.000Z');
  // Input object is not mutated.
  assert.equal(before.harnesses['copilot-cli'], undefined);
  assert.equal(before.schema_version, 1);
});

test('upsert rejects an invalid proposal without producing a config', () => {
  const bad = mkProfile('m');
  bad.assignments.lite = 'auto';
  assert.throws(() => upsertProfile(null, 'copilot-cli', bad, '2026-07-13T02:00:00.000Z'));
});

test('upsert materializes all-auto settings only on the targeted profile', () => {
  const before = mkConfig({ 'copilot-vscode': 'vs-m' });
  const unrelatedBefore = JSON.stringify(before.harnesses['copilot-vscode']);
  const after = upsertProfile(before, 'copilot-cli', mkProfile('cli-m'), '2026-07-13T02:00:00.000Z');

  assert.deepEqual(after.harnesses['copilot-cli'].dispatch_settings, mkDispatchSettings());
  assert.equal(JSON.stringify(after.harnesses['copilot-vscode']), unrelatedBefore);
  assert.equal(Object.hasOwn(after.harnesses['copilot-vscode'], 'dispatch_settings'), false);
});

test('upsert stores __proto__ as a literal own harness key', () => {
  const cfg = upsertProfile(null, '__proto__', mkProfile('proto-m'), NOW);

  assert.equal(Object.hasOwn(cfg.harnesses, '__proto__'), true);
  assert.equal(cfg.harnesses.__proto__.assignments.lite, 'proto-m');
  assert.equal(Object.getPrototypeOf(cfg.harnesses), Object.prototype);
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(cfg)).harnesses, '__proto__'), true);
});

test('upsert rejects explicit settings for an unsupported harness', () => {
  const explicit = mkProfile('m', { dispatch_settings: mkDispatchSettings('high', 'default') });
  assert.throws(
    () => upsertProfile(null, 'copilot-vscode', explicit, '2026-07-13T02:00:00.000Z'),
    /copilot-vscode/
  );
});

test('remove drops one harness, updates time, and reports when the last profile is removed', () => {
  const cfg = mkConfig({ a: 'm1', b: 'm2' });
  const removedAt = '2026-07-13T03:00:00.000Z';
  const step1 = removeProfile(cfg, 'a', removedAt);
  assert.equal(step1.removed, true);
  assert.ok(step1.config);
  assert.equal(step1.config.harnesses.a, undefined);
  assert.equal(JSON.stringify(step1.config.harnesses.b), JSON.stringify(cfg.harnesses.b));
  assert.equal(step1.config.schema_version, 2);
  assert.equal(step1.config.updated_at, removedAt);

  const step2 = removeProfile(step1.config, 'b', '2026-07-13T04:00:00.000Z');
  assert.equal(step2.removed, true);
  assert.equal(step2.config, null); // caller deletes the file

  const miss = removeProfile(cfg, 'nope', removedAt);
  assert.equal(miss.removed, false);
  assert.equal(miss.config.updated_at, cfg.updated_at);
});

test('remove ignores inherited prototype-colliding harness names', () => {
  const cfg = mkConfig({ 'copilot-cli': 'm' });
  for (const harness of ['toString', 'constructor', '__proto__']) {
    const result = removeProfile(cfg, harness, '2026-07-13T03:00:00.000Z');
    assert.equal(result.removed, false, harness);
    assert.deepEqual(result.config, cfg);
  }
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
    reasoning_effort: 'auto',
    context_tier: 'auto',
  });
});

test('resolve: schema-v2 explicit runtime settings are additive JSON fields', () => {
  const sb = sandbox();
  const cfg = {
    schema_version: 2,
    updated_at: NOW,
    harnesses: {
      'copilot-cli': mkProfile('gpt-5.4', {
        dispatch_settings: mkDispatchSettings('high', 'long_context'),
      }),
    },
  };
  writeJson(sb.wsFile, cfg);

  const r = runCli(
    ['resolve', '--workspace-root', sb.root, '--harness', 'copilot-cli', '--tier', 'complex', '--json'],
    { env: sb.env }
  );
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.model, 'gpt-5.4');
  assert.equal(out.check_status, 'unverified');
  assert.equal(out.reasoning_effort, 'high');
  assert.equal(out.context_tier, 'long_context');
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
  badVersion.schema_version = 3;
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

test('resolve: absent prototype-colliding harness names exit 3', () => {
  const sb = sandbox();
  writeJson(sb.wsFile, mkConfig({ 'copilot-cli': 'm' }));

  for (const harness of ['toString', 'constructor', '__proto__']) {
    const r = runCli(
      ['resolve', '--workspace-root', sb.root, '--harness', harness, '--tier', 'lite', '--json'],
      { env: sb.env }
    );
    assert.equal(r.code, 3, `${harness}: ${r.stderr}`);
    assert.equal(r.stdout.trim(), '', harness);
  }
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
  const explicit = path.join(sb.root, 'explicit.json');
  writeJson(good, mkProfile('m'));
  const badProfile = mkProfile('m');
  badProfile.assignments.lite = 'inherit';
  writeJson(bad, badProfile);
  writeJson(explicit, mkProfile('m', { dispatch_settings: mkDispatchSettings('medium', 'default') }));

  assert.equal(runCli(['validate-profile', '--input', good, '--harness', 'copilot-cli'], { env: sb.env }).code, 0);
  const r = runCli(['validate-profile', '--input', bad, '--harness', 'copilot-cli'], { env: sb.env });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /inherit/);

  assert.equal(
    runCli(['validate-profile', '--input', explicit, '--harness', 'copilot-cli'], { env: sb.env }).code,
    0
  );
  const unsupported = runCli(
    ['validate-profile', '--input', explicit, '--harness', 'copilot-vscode'],
    { env: sb.env }
  );
  assert.equal(unsupported.code, 2);
  assert.match(unsupported.stderr, /copilot-vscode/);
});

test('upsert-profile: writes atomically, preserves unrelated profiles byte-for-byte at data level', () => {
  const sb = sandbox();
  writeJson(sb.wsFile, mkConfig({ 'copilot-vscode': 'vs-m' }));
  const beforeVs = JSON.stringify(JSON.parse(fs.readFileSync(sb.wsFile, 'utf8')).harnesses['copilot-vscode']);

  const proposal = path.join(sb.root, 'proposal.json');
  writeJson(proposal, mkProfile('cli-m', {
    dispatch_settings: mkDispatchSettings('medium', 'long_context'),
  }));
  const r = runCli(
    ['upsert-profile', '--input', proposal, '--scope', 'workspace', '--workspace-root', sb.root, '--harness', 'copilot-cli'],
    { env: sb.env }
  );
  assert.equal(r.code, 0, r.stderr);

  const output = JSON.parse(r.stdout);
  assert.equal(output.effective_after.lite, 'cli-m');
  assert.deepEqual(output.effective_dispatch_settings_after.lite, {
    reasoning_effort: 'medium',
    context_tier: 'long_context',
  });

  const after = JSON.parse(fs.readFileSync(sb.wsFile, 'utf8'));
  assert.equal(JSON.stringify(after.harnesses['copilot-vscode']), beforeVs);
  assert.equal(after.harnesses['copilot-cli'].assignments.trivial, 'cli-m');
  assert.deepEqual(after.harnesses['copilot-cli'].dispatch_settings.trivial, {
    reasoning_effort: 'medium',
    context_tier: 'long_context',
  });
  assert.equal(after.schema_version, 2);
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

test('upsert-profile: decorated auto exits 2 and leaves the prior file byte-for-byte unchanged', () => {
  const sb = sandbox();
  writeJson(sb.wsFile, mkConfig({ 'copilot-cli': 'keep-me' }));
  const beforeBytes = fs.readFileSync(sb.wsFile, 'utf8');

  const proposal = path.join(sb.root, 'proposal.json');
  const bad = mkProfile('m');
  bad.assignments.lite = 'Auto (copilot)';
  writeJson(proposal, bad);
  const r = runCli(
    ['upsert-profile', '--input', proposal, '--scope', 'workspace', '--workspace-root', sb.root, '--harness', 'copilot-cli'],
    { env: sb.env }
  );
  assert.equal(r.code, 2);
  assert.equal(fs.readFileSync(sb.wsFile, 'utf8'), beforeBytes);
});

test('upsert-profile: unsupported explicit settings exit 2 and leave the prior file unchanged', () => {
  const sb = sandbox();
  writeJson(sb.wsFile, mkConfig({ 'copilot-vscode': 'keep-me' }));
  const beforeBytes = fs.readFileSync(sb.wsFile, 'utf8');

  const proposal = path.join(sb.root, 'proposal.json');
  writeJson(proposal, mkProfile('m', { dispatch_settings: mkDispatchSettings('medium', 'default') }));
  const r = runCli(
    ['upsert-profile', '--input', proposal, '--scope', 'workspace', '--workspace-root', sb.root, '--harness', 'copilot-vscode'],
    { env: sb.env }
  );
  assert.equal(r.code, 2);
  assert.match(r.stderr, /copilot-vscode/);
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
  const output = JSON.parse(r.stdout);
  assert.deepEqual(output.effective_after, mkAssignments('gm'));
  assert.deepEqual(output.effective_dispatch_settings_after, mkDispatchSettings());

  const cfg = JSON.parse(fs.readFileSync(sb.globalFile, 'utf8'));
  assert.equal(cfg.harnesses['copilot-cli'].assignments.complex, 'gm');
  assert.deepEqual(cfg.harnesses['copilot-cli'].dispatch_settings, mkDispatchSettings());

  const resolvedRun = runCli(
    ['resolve', '--workspace-root', sb.root, '--harness', 'copilot-cli', '--tier', 'complex', '--json'],
    { env: sb.env }
  );
  assert.equal(resolvedRun.code, 0, resolvedRun.stderr);
  const resolved = JSON.parse(resolvedRun.stdout);
  assert.equal(resolved.scope, 'global');
  assert.equal(resolved.model, output.effective_after.complex);
  assert.equal(resolved.reasoning_effort, output.effective_dispatch_settings_after.complex.reasoning_effort);
  assert.equal(resolved.context_tier, output.effective_dispatch_settings_after.complex.context_tier);
});

test('upsert-profile: global write reports an existing workspace profile as effective', () => {
  const sb = sandbox();
  const workspace = mkConfig({ 'copilot-cli': 'workspace-m' });
  workspace.schema_version = 2;
  workspace.harnesses['copilot-cli'].dispatch_settings = mkDispatchSettings('low', 'default');
  writeJson(sb.wsFile, workspace);
  const workspaceBefore = fs.readFileSync(sb.wsFile, 'utf8');
  writeJson(sb.globalFile, mkConfig({ 'copilot-cli': 'old-global-m' }));

  const proposal = path.join(sb.root, 'proposal.json');
  writeJson(proposal, mkProfile('new-global-m', {
    dispatch_settings: mkDispatchSettings('xhigh', 'long_context'),
  }));
  const r = runCli(
    ['upsert-profile', '--input', proposal, '--scope', 'global', '--workspace-root', sb.root, '--harness', 'copilot-cli'],
    { env: sb.env }
  );
  assert.equal(r.code, 0, r.stderr);

  const output = JSON.parse(r.stdout);
  assert.deepEqual(output.effective_after, mkAssignments('workspace-m'));
  assert.deepEqual(
    output.effective_dispatch_settings_after,
    mkDispatchSettings('low', 'default')
  );

  const storedGlobal = JSON.parse(fs.readFileSync(sb.globalFile, 'utf8'));
  assert.deepEqual(storedGlobal.harnesses['copilot-cli'].assignments, mkAssignments('new-global-m'));
  assert.deepEqual(
    storedGlobal.harnesses['copilot-cli'].dispatch_settings,
    mkDispatchSettings('xhigh', 'long_context')
  );
  assert.equal(fs.readFileSync(sb.wsFile, 'utf8'), workspaceBefore);

  const resolvedRun = runCli(
    ['resolve', '--workspace-root', sb.root, '--harness', 'copilot-cli', '--tier', 'standard_ambiguous', '--json'],
    { env: sb.env }
  );
  assert.equal(resolvedRun.code, 0, resolvedRun.stderr);
  const resolved = JSON.parse(resolvedRun.stdout);
  assert.equal(resolved.scope, 'workspace');
  assert.equal(resolved.model, output.effective_after.standard_ambiguous);
  assert.equal(
    resolved.reasoning_effort,
    output.effective_dispatch_settings_after.standard_ambiguous.reasoning_effort
  );
  assert.equal(
    resolved.context_tier,
    output.effective_dispatch_settings_after.standard_ambiguous.context_tier
  );
});

test('upsert-profile: persists __proto__ as a literal own harness key', () => {
  const sb = sandbox();
  const proposal = path.join(sb.root, 'proposal.json');
  writeJson(proposal, mkProfile('proto-m'));

  let r = runCli(
    ['upsert-profile', '--input', proposal, '--scope', 'workspace', '--workspace-root', sb.root, '--harness', '__proto__'],
    { env: sb.env }
  );
  assert.equal(r.code, 0, r.stderr);

  const cfg = JSON.parse(fs.readFileSync(sb.wsFile, 'utf8'));
  assert.equal(Object.hasOwn(cfg.harnesses, '__proto__'), true);
  assert.equal(cfg.harnesses.__proto__.assignments.complex, 'proto-m');
  assert.equal(Object.getPrototypeOf(cfg.harnesses), Object.prototype);

  r = runCli(
    ['resolve', '--workspace-root', sb.root, '--harness', '__proto__', '--tier', 'complex', '--json'],
    { env: sb.env }
  );
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).model, 'proto-m');
});

test('diff-profile: previews stored and effective change without writing', () => {
  const sb = sandbox();
  writeJson(sb.globalFile, mkConfig({ 'copilot-cli': 'global-m' }));
  const proposal = path.join(sb.root, 'proposal.json');
  writeJson(proposal, mkProfile('new-m', {
    dispatch_settings: mkDispatchSettings('xhigh', 'long_context'),
  }));

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
  assert.deepEqual(out.effective_dispatch_settings_after.lite, {
    reasoning_effort: 'xhigh',
    context_tier: 'long_context',
  });
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
  assert.equal(cfg.schema_version, 2);
  assert.notEqual(cfg.updated_at, NOW);
  assert.doesNotThrow(() => new Date(cfg.updated_at).toISOString());
  assert.equal(cfg.harnesses['copilot-cli'], undefined);
  assert.equal(cfg.harnesses['copilot-vscode'].assignments.lite, 'b');
});

test('remove-profile: inherited prototype-colliding harness names are not found', () => {
  const sb = sandbox();

  for (const harness of ['toString', 'constructor', '__proto__']) {
    writeJson(sb.wsFile, mkConfig({ 'copilot-cli': 'm' }));
    const beforeBytes = fs.readFileSync(sb.wsFile, 'utf8');

    const dryRun = runCli(
      ['remove-profile', '--scope', 'workspace', '--workspace-root', sb.root, '--harness', harness, '--dry-run'],
      { env: sb.env }
    );
    assert.equal(dryRun.code, 0, `${harness}: ${dryRun.stderr}`);
    assert.equal(JSON.parse(dryRun.stdout).found, false, harness);

    const removal = runCli(
      ['remove-profile', '--scope', 'workspace', '--workspace-root', sb.root, '--harness', harness],
      { env: sb.env }
    );
    assert.equal(removal.code, 3, `${harness}: ${removal.stderr}`);
    assert.equal(fs.readFileSync(sb.wsFile, 'utf8'), beforeBytes, harness);
  }
});

test('already-resolved opaque exact identifier round-trips byte-for-byte through the CLI and resolves unverified', () => {
  const sb = sandbox();
  const exactModel = 'claude-sonnet-4.5';
  const proposal = path.join(sb.root, 'proposal.json');
  writeJson(proposal, { assignments: mkAssignments(exactModel) });
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
  assert.equal(out.model, exactModel);
  assert.equal(out.check_status, 'unverified');
});
