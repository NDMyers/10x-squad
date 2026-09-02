'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const packageRoot = path.resolve(__dirname, '..');
const controlPath = path.join(packageRoot, 'assets', 'runtime', 'control.js');
const projectState = require('../assets/runtime/project-state');
const { generateRegistry, transitionProject, validateProject } = projectState;
const { digestText, validateHandoff } = require('../assets/runtime/handoff-validator');
const routingConstants = require('../assets/skills/10x-squad-configure-tiers/scripts/routing-constants');

function makeProject(root, slug, overrides = {}) {
  const projectDirectory = path.join(root, slug);
  fs.mkdirSync(projectDirectory, { recursive: true });
  const artifactFiles = {
    context: 'CONTEXT.md',
    brief: 'brief.md',
    spec: 'spec.md',
    gate_plan: 'gate-plan.json',
    build: 'build.md',
    gate_build: 'gate-build.json',
    review: 'review.md',
    tests: 'tests.md',
  };
  const tier = overrides.tier || 'standard_clear';
  const brief = '## Decision Table\n| ID | Decision | Rationale |\n|----|----------|-----------|\n| D1 | Preserve behavior. | Required. |\n';
  const spec = tier === 'standard_ambiguous' || tier === 'complex'
    ? '## Acceptance Criteria\n1. (AC1 ← D1) Behavior is preserved.\n'
    : '## Acceptance Criteria\n1. (AC1) Behavior is preserved.\n';
  const build = '## Changelist\n- `lib/example.js` (AC1) — Preserves behavior.\n';
  const handoffInput = tier === 'standard_ambiguous' || tier === 'complex' ? { brief, spec } : { spec };
  fs.writeFileSync(path.join(projectDirectory, artifactFiles.context), `# ${slug}\n`);
  fs.writeFileSync(path.join(projectDirectory, artifactFiles.brief), brief);
  fs.writeFileSync(path.join(projectDirectory, artifactFiles.spec), spec);
  fs.writeFileSync(path.join(projectDirectory, artifactFiles.gate_plan), `${JSON.stringify(validateHandoff(handoffInput))}\n`);
  fs.writeFileSync(path.join(projectDirectory, artifactFiles.build), build);
  fs.writeFileSync(
    path.join(projectDirectory, artifactFiles.gate_build),
    `${JSON.stringify(validateHandoff({ ...handoffInput, build }))}\n`
  );
  fs.writeFileSync(path.join(projectDirectory, artifactFiles.review), '# Review\n');
  fs.writeFileSync(path.join(projectDirectory, artifactFiles.tests), '# Tests\n');

  const state = {
    schema_version: 1,
    slug,
    title: slug.replaceAll('-', ' '),
    tier,
    status: 'active',
    phase: 'BUILD',
    updated_at: '2026-08-21T12:00:00.000Z',
    next_action: 'Dispatch Linus with the validated spec.',
    unresolved_questions: [],
    artifacts: artifactFiles,
    ...overrides,
  };
  fs.writeFileSync(path.join(projectDirectory, 'project.json'), `${JSON.stringify(state, null, 2)}\n`);
  return { projectDirectory, state };
}

function error(result, code) {
  return result.errors.find((entry) => entry.code === code);
}

test('validates a compact project state and its current artifact pointers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-projects-'));
  const { projectDirectory } = makeProject(root, 'alpha-project');

  const result = validateProject(projectDirectory);

  assert.equal(result.ok, true);
  assert.equal(result.state.slug, 'alpha-project');
  assert.deepEqual(result.errors, []);
});

test('project tier vocabulary stays aligned with model routing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-tiers-'));

  assert.deepEqual(projectState.TIER_KEYS, routingConstants.TIER_KEYS);
  for (const tier of routingConstants.TIER_KEYS) {
    const { projectDirectory } = makeProject(root, `project-${tier}`, { tier });
    assert.equal(validateProject(projectDirectory).ok, true, tier);
  }
});

test('rejects invalid state, unsafe artifact paths, and missing artifacts together', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-invalid-state-'));
  const { projectDirectory, state } = makeProject(root, 'actual-folder', {
    slug: 'wrong-folder',
    tier: 'future-tier',
    status: 'active',
    next_action: '',
    artifacts: {
      escape: '../outside.md',
      missing: 'missing.md',
    },
    unexpected: true,
  });

  const result = validateProject(projectDirectory);

  assert.equal(result.ok, false);
  assert.ok(error(result, 'UNKNOWN_FIELDS').fields.includes('unexpected'));
  assert.ok(error(result, 'SLUG_MISMATCH'));
  assert.ok(error(result, 'INVALID_TIER'));
  assert.ok(error(result, 'NEXT_ACTION_REQUIRED'));
  assert.deepEqual(error(result, 'UNSAFE_ARTIFACT_PATHS').artifacts, ['escape']);
  assert.deepEqual(error(result, 'MISSING_ARTIFACTS').artifacts, ['missing']);
  assert.equal(state.slug, 'wrong-folder');
});

test('requires phase-specific canonical artifact pointers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-required-artifacts-'));
  const { projectDirectory } = makeProject(root, 'review-project', {
    phase: 'REVIEW',
    artifacts: {},
  });

  const result = validateProject(projectDirectory);

  assert.equal(result.ok, false);
  assert.deepEqual(error(result, 'MISSING_REQUIRED_ARTIFACT_POINTERS').artifacts, [
    'build',
    'context',
    'gate_build',
    'gate_plan',
    'spec',
  ]);
});

test('rejects artifact symlinks that resolve outside the project root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-artifact-symlink-'));
  const outside = path.join(root, 'outside.md');
  fs.writeFileSync(outside, 'outside\n');
  const { projectDirectory, state } = makeProject(root, 'symlink-project', { phase: 'INTAKE' });
  fs.symlinkSync(outside, path.join(projectDirectory, 'external-context.md'));
  fs.writeFileSync(
    path.join(projectDirectory, 'project.json'),
    `${JSON.stringify({ ...state, phase: 'INTAKE', artifacts: { context: 'external-context.md' } }, null, 2)}\n`
  );

  const result = validateProject(projectDirectory);

  assert.equal(result.ok, false);
  assert.deepEqual(error(result, 'EXTERNAL_ARTIFACT_PATHS').artifacts, ['context']);
});

test('requires successful gate artifacts for phases that depend on them', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-gate-state-'));
  const { projectDirectory } = makeProject(root, 'gate-project', { phase: 'REVIEW' });
  fs.writeFileSync(path.join(projectDirectory, 'gate-plan.json'), 'not-json\n');
  fs.writeFileSync(path.join(projectDirectory, 'gate-build.json'), '{"ok":false,"errors":[]}\n');

  const result = validateProject(projectDirectory);

  assert.equal(result.ok, false);
  assert.deepEqual(error(result, 'INVALID_GATE_ARTIFACTS').artifacts, ['gate_plan']);
  assert.deepEqual(error(result, 'FAILED_GATE_ARTIFACTS').artifacts, ['gate_build']);
});

test('rejects gate artifacts whose input hashes no longer match current artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-stale-gate-'));
  const { projectDirectory } = makeProject(root, 'stale-gate-project', { phase: 'REVIEW' });
  fs.appendFileSync(path.join(projectDirectory, 'spec.md'), '\nChanged after gate.\n');

  const result = validateProject(projectDirectory);

  assert.equal(result.ok, false);
  assert.deepEqual(error(result, 'STALE_GATE_ARTIFACTS').artifacts, ['gate_build', 'gate_plan']);
});

test('recomputes gate semantics instead of trusting forged passing evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-forged-gate-'));
  const { projectDirectory } = makeProject(root, 'forged-gate-project', { phase: 'REVIEW' });
  const buildPath = path.join(projectDirectory, 'build.md');
  fs.appendFileSync(buildPath, '- `lib/uncited.js` — Uncited change.\n');
  const gatePath = path.join(projectDirectory, 'gate-build.json');
  const forged = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
  forged.input_hashes.build = digestText(fs.readFileSync(buildPath, 'utf8'));
  fs.writeFileSync(gatePath, JSON.stringify(forged));

  const result = validateProject(projectDirectory);

  assert.equal(result.ok, false);
  assert.deepEqual(error(result, 'FAILED_GATE_ARTIFACTS').artifacts, ['gate_build']);
});

test('complete state requires a null next action', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-complete-state-'));
  const { projectDirectory } = makeProject(root, 'complete-project', {
    status: 'complete',
    phase: 'DELIVER',
    next_action: 'Do more work.',
  });

  const result = validateProject(projectDirectory);

  assert.equal(result.ok, false);
  assert.ok(error(result, 'COMPLETED_PROJECT_HAS_NEXT_ACTION'));
});

test('requires a canonical UTC ISO timestamp', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-timestamp-'));
  const { projectDirectory } = makeProject(root, 'timestamp-project', {
    updated_at: '08/21/2026 12:00 PM',
  });

  const result = validateProject(projectDirectory);

  assert.equal(result.ok, false);
  assert.ok(error(result, 'INVALID_UPDATED_AT'));
});

test('atomically applies an allowed project phase transition', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-transition-'));
  const { projectDirectory, state } = makeProject(root, 'transition-project', { phase: 'INTAKE' });
  const next = {
    ...state,
    phase: 'PLAN',
    updated_at: '2026-08-21T12:01:00.000Z',
    next_action: 'Dispatch Peter with the intake contract.',
  };

  const result = transitionProject(projectDirectory, next, state.updated_at);

  assert.equal(result.ok, true);
  assert.equal(result.previous_phase, 'INTAKE');
  assert.equal(result.state.phase, 'PLAN');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(projectDirectory, 'project.json'), 'utf8')), next);
  assert.deepEqual(fs.readdirSync(projectDirectory).filter((name) => name.includes('.tmp')), []);
});

test('rejects illegal, stale, and terminal transitions without mutating state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-rejected-transition-'));
  const { projectDirectory, state } = makeProject(root, 'rejected-project', { phase: 'INTAKE' });
  const statePath = path.join(projectDirectory, 'project.json');
  const before = fs.readFileSync(statePath, 'utf8');

  const illegal = transitionProject(projectDirectory, {
    ...state,
    phase: 'REVIEW',
    updated_at: '2026-08-21T12:01:00.000Z',
  }, state.updated_at);
  assert.ok(error(illegal, 'ILLEGAL_PHASE_TRANSITION'));
  assert.equal(fs.readFileSync(statePath, 'utf8'), before);

  const stale = transitionProject(projectDirectory, {
    ...state,
    phase: 'PLAN',
  }, state.updated_at);
  assert.ok(error(stale, 'UPDATED_AT_NOT_ADVANCED'));
  assert.equal(fs.readFileSync(statePath, 'utf8'), before);

  const completed = {
    ...state,
    status: 'complete',
    phase: 'DELIVER',
    next_action: null,
    updated_at: '2026-08-21T12:02:00.000Z',
  };
  fs.writeFileSync(statePath, `${JSON.stringify(completed, null, 2)}\n`);
  const terminal = transitionProject(projectDirectory, {
    ...completed,
    title: 'Changed after completion',
    updated_at: '2026-08-21T12:03:00.000Z',
  }, completed.updated_at);
  assert.ok(error(terminal, 'TERMINAL_PROJECT'));
  assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).title, completed.title);
});

test('rejects a stale transition after another caller advances the project', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-concurrent-transition-'));
  const { projectDirectory, state } = makeProject(root, 'concurrent-project', { phase: 'REVIEW' });
  const first = transitionProject(projectDirectory, {
    ...state,
    phase: 'BUILD',
    updated_at: '2026-08-21T12:01:00.000Z',
  }, state.updated_at);
  assert.equal(first.ok, true);

  const second = transitionProject(projectDirectory, {
    ...state,
    phase: 'TEST',
    updated_at: '2026-08-21T12:02:00.000Z',
  }, state.updated_at);

  assert.equal(second.ok, false);
  assert.ok(error(second, 'STATE_VERSION_MISMATCH'));
  assert.equal(validateProject(projectDirectory).state.phase, 'BUILD');
});

test('generates PROJECTS.md from validated project states in slug order', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-registry-'));
  makeProject(root, 'zeta-project', {
    title: 'Zeta | Project',
    tier: 'complex',
    phase: 'REVIEW',
    updated_at: '2026-08-20T10:00:00.000Z',
  });
  makeProject(root, 'alpha-project', {
    title: 'Alpha Project',
    status: 'complete',
    phase: 'DELIVER',
    next_action: null,
    updated_at: '2026-08-21T10:00:00.000Z',
  });

  const registry = generateRegistry(root);

  assert.ok(registry.indexOf('Alpha Project') < registry.indexOf('Zeta \\| Project'));
  assert.match(registry, /\| Alpha Project \| standard_clear \| complete \| DELIVER \|/);
  assert.match(registry, /\[projects\/alpha-project\/\]\(projects\/alpha-project\/\)/);
  assert.match(registry, /2026-08-21/);
});

test('registry generation preserves and labels legacy projects during migration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-legacy-registry-'));
  makeProject(root, 'managed-project');
  const legacyDirectory = path.join(root, 'legacy-project');
  const unregisteredDirectory = path.join(root, 'unregistered-project');
  fs.mkdirSync(legacyDirectory);
  fs.mkdirSync(unregisteredDirectory);
  fs.writeFileSync(path.join(legacyDirectory, 'CONTEXT.md'), '# Legacy\n');

  const existing = [
    '# 10x Squad Projects',
    '',
    '| Project | Tier | Status | Path | Last Active |',
    '|---------|------|--------|------|-------------|',
    '| Legacy \\| Name | Standard (clear) | COMPLETE | [projects/legacy-project/](projects/legacy-project/) | 2026-07-01 |',
    '',
  ].join('\n');

  const registry = generateRegistry(root, existing);
  const regenerated = generateRegistry(root, registry);

  assert.match(registry, /\| Legacy \\\| Name \| Standard \(clear\) \| COMPLETE \| UNMANAGED \|/);
  assert.match(regenerated, /\| Legacy \\\| Name \| Standard \(clear\) \| COMPLETE \| UNMANAGED \|/);
  assert.match(registry, /\| unregistered-project \| unmanaged \| unmanaged \| UNMANAGED \|/);
  assert.match(registry, /Legacy projects remain visible but must receive `project\.json` before resumption/);
});

test('control CLI validates state and writes a generated registry', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-state-cli-'));
  const projectsRoot = path.join(workspace, '10x-squad-artifacts', 'projects');
  const { projectDirectory } = makeProject(projectsRoot, 'cli-project');
  const registryPath = path.join(workspace, '10x-squad-artifacts', 'PROJECTS.md');

  const validation = spawnSync(process.execPath, [controlPath, 'validate-project', '--project', projectDirectory], {
    cwd: workspace,
    encoding: 'utf8',
  });
  assert.equal(validation.status, 0, validation.stderr || validation.stdout);
  assert.equal(JSON.parse(validation.stdout).ok, true);

  const generation = spawnSync(
    process.execPath,
    [controlPath, 'generate-registry', '--projects-root', projectsRoot, '--output', registryPath],
    { cwd: workspace, encoding: 'utf8' }
  );
  assert.equal(generation.status, 0, generation.stderr || generation.stdout);
  assert.deepEqual(JSON.parse(generation.stdout), { ok: true, projects: 1, output: registryPath });
  assert.match(fs.readFileSync(registryPath, 'utf8'), /cli project/);
});

test('control CLI applies a validated project transition', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-transition-cli-'));
  const { projectDirectory, state } = makeProject(workspace, 'cli-transition', { phase: 'INTAKE' });
  const nextStatePath = path.join(workspace, 'next-state.json');
  fs.writeFileSync(nextStatePath, JSON.stringify({
    ...state,
    phase: 'PLAN',
    updated_at: '2026-08-21T12:01:00.000Z',
  }));

  const result = spawnSync(
    process.execPath,
    [
      controlPath,
      'transition-project',
      '--project',
      projectDirectory,
      '--state',
      nextStatePath,
      '--expected-updated-at',
      state.updated_at,
    ],
    { cwd: workspace, encoding: 'utf8' }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).state.phase, 'PLAN');
  assert.equal(validateProject(projectDirectory).state.phase, 'PLAN');
});