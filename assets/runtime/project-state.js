'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateHandoff } = require('./handoff-validator');

const TIER_KEYS = ['trivial', 'lite', 'standard_clear', 'standard_ambiguous', 'complex'];
const STATUSES = ['active', 'blocked', 'complete', 'deferred', 'abandoned'];
const PHASES = ['TRIAGE', 'DELIBERATE', 'INTAKE', 'PLAN', 'BUILD', 'REVIEW', 'TEST', 'DELIVER'];
const PHASE_TRANSITIONS = {
  TRIAGE: ['DELIBERATE', 'INTAKE'],
  DELIBERATE: ['INTAKE'],
  INTAKE: ['PLAN'],
  PLAN: ['BUILD'],
  BUILD: ['REVIEW'],
  REVIEW: ['PLAN', 'BUILD', 'TEST', 'DELIVER'],
  TEST: ['BUILD', 'DELIVER'],
  DELIVER: [],
};
const PHASE_REQUIRED_ARTIFACTS = {
  TRIAGE: [],
  DELIBERATE: [],
  INTAKE: ['context'],
  PLAN: ['context'],
  BUILD: ['context', 'spec', 'gate_plan'],
  REVIEW: ['context', 'spec', 'gate_plan', 'build', 'gate_build'],
  TEST: ['context', 'spec', 'gate_plan', 'build', 'gate_build', 'review'],
  DELIVER: ['context', 'spec', 'gate_plan', 'build', 'gate_build', 'review', 'tests'],
};
const STATE_FIELDS = new Set([
  'schema_version',
  'slug',
  'title',
  'tier',
  'status',
  'phase',
  'updated_at',
  'next_action',
  'unresolved_questions',
  'artifacts',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function addError(errors, code, details = {}) {
  errors.push({ code, ...details });
}

function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || path.isAbsolute(value)) {
    return false;
  }
  return !value.split(/[\\/]/).includes('..');
}

function sortedStrings(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.valueOf()) && timestamp.toISOString() === value;
}

function validateIdentity(projectDirectory, state, errors) {
  const unknownFields = sortedStrings(Object.keys(state).filter((field) => !STATE_FIELDS.has(field)));
  if (unknownFields.length > 0) {
    addError(errors, 'UNKNOWN_FIELDS', { fields: unknownFields });
  }
  if (state.schema_version !== 1) {
    addError(errors, 'INVALID_SCHEMA_VERSION', { expected: 1, actual: state.schema_version });
  }

  const folderSlug = path.basename(path.resolve(projectDirectory));
  if (typeof state.slug !== 'string' || state.slug !== folderSlug) {
    addError(errors, 'SLUG_MISMATCH', { expected: folderSlug, actual: state.slug });
  }
  if (typeof state.title !== 'string' || state.title.trim().length === 0) {
    addError(errors, 'INVALID_TITLE');
  }
  if (!TIER_KEYS.includes(state.tier)) {
    addError(errors, 'INVALID_TIER', { allowed: TIER_KEYS, actual: state.tier });
  }
  if (!STATUSES.includes(state.status)) {
    addError(errors, 'INVALID_STATUS', { allowed: STATUSES, actual: state.status });
  }
  if (!PHASES.includes(state.phase)) {
    addError(errors, 'INVALID_PHASE', { allowed: PHASES, actual: state.phase });
  }
}

function validateLifecycle(state, errors) {
  if (!isCanonicalUtcTimestamp(state.updated_at)) {
    addError(errors, 'INVALID_UPDATED_AT');
  }
  if (['active', 'blocked'].includes(state.status) && (typeof state.next_action !== 'string' || !state.next_action.trim())) {
    addError(errors, 'NEXT_ACTION_REQUIRED');
  }
  if (state.status === 'complete' && state.next_action !== null) {
    addError(errors, 'COMPLETED_PROJECT_HAS_NEXT_ACTION');
  }
  if (state.status === 'complete' && state.phase !== 'DELIVER') {
    addError(errors, 'COMPLETED_PROJECT_NOT_DELIVERED');
  }
  if (!Array.isArray(state.unresolved_questions) || state.unresolved_questions.some((item) => typeof item !== 'string')) {
    addError(errors, 'INVALID_UNRESOLVED_QUESTIONS');
  }
}

function requiredArtifacts(state) {
  const required = [...(PHASE_REQUIRED_ARTIFACTS[state.phase] || [])];
  if (['standard_ambiguous', 'complex'].includes(state.tier) && ['PLAN', 'BUILD', 'REVIEW', 'TEST', 'DELIVER'].includes(state.phase)) {
    required.push('brief');
  }
  return sortedStrings(required);
}

function validateArtifacts(projectDirectory, state, errors) {
  const { artifacts } = state;
  if (!isPlainObject(artifacts)) {
    addError(errors, 'INVALID_ARTIFACTS');
    return;
  }

  const missingPointers = requiredArtifacts(state).filter((name) => !Object.hasOwn(artifacts, name));
  if (missingPointers.length > 0) {
    addError(errors, 'MISSING_REQUIRED_ARTIFACT_POINTERS', { artifacts: missingPointers });
  }

  const unsafe = [];
  const missing = [];
  const external = [];
  const nonFiles = [];
  const projectRoot = fs.realpathSync(projectDirectory);
  for (const [name, relativePath] of Object.entries(artifacts)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(name) || !isSafeRelativePath(relativePath)) {
      unsafe.push(name);
      continue;
    }
    const artifactPath = path.resolve(projectDirectory, relativePath);
    if (!fs.existsSync(artifactPath)) {
      missing.push(name);
      continue;
    }
    const resolvedArtifact = fs.realpathSync(artifactPath);
    const relativeToProject = path.relative(projectRoot, resolvedArtifact);
    if (relativeToProject === '..' || relativeToProject.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToProject)) {
      external.push(name);
      continue;
    }
    if (!fs.statSync(resolvedArtifact).isFile()) {
      nonFiles.push(name);
    }
  }
  if (unsafe.length > 0) {
    addError(errors, 'UNSAFE_ARTIFACT_PATHS', { artifacts: sortedStrings(unsafe) });
  }
  if (missing.length > 0) {
    addError(errors, 'MISSING_ARTIFACTS', { artifacts: sortedStrings(missing) });
  }
  if (external.length > 0) {
    addError(errors, 'EXTERNAL_ARTIFACT_PATHS', { artifacts: sortedStrings(external) });
  }
  if (nonFiles.length > 0) {
    addError(errors, 'NON_FILE_ARTIFACT_PATHS', { artifacts: sortedStrings(nonFiles) });
  }
}

function gateInputs(projectDirectory, state, gateName) {
  const readArtifact = (name) => fs.readFileSync(path.resolve(projectDirectory, state.artifacts[name]), 'utf8');
  const usesBrief = ['standard_ambiguous', 'complex'].includes(state.tier);
  return {
    brief: usesBrief ? readArtifact('brief') : undefined,
    spec: readArtifact('spec'),
    build: gateName === 'gate_build' ? readArtifact('build') : undefined,
  };
}

function safeGatePath(projectDirectory, state, gateName) {
  const relativePath = state.artifacts[gateName];
  if (!isSafeRelativePath(relativePath)) return null;
  const candidate = path.resolve(projectDirectory, relativePath);
  if (!fs.existsSync(candidate)) return null;
  const projectRoot = fs.realpathSync(projectDirectory);
  const resolved = fs.realpathSync(candidate);
  const relative = path.relative(projectRoot, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return fs.statSync(resolved).isFile() ? resolved : null;
}

function inspectGateArtifact(projectDirectory, state, gateName) {
  const gatePath = safeGatePath(projectDirectory, state, gateName);
  if (gatePath === null) return 'invalid';

  let gate;
  try {
    gate = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
  } catch {
    return 'invalid';
  }
  if (!isPlainObject(gate)) return 'invalid';
  if (gate.ok !== true || (Array.isArray(gate.errors) && gate.errors.length > 0)) return 'failed';
  if (!isPlainObject(gate.input_hashes) || !Array.isArray(gate.errors)) return 'invalid';

  let expected;
  try {
    expected = validateHandoff(gateInputs(projectDirectory, state, gateName));
  } catch {
    return 'invalid';
  }
  if (!expected.ok) return 'failed';
  return JSON.stringify(gate) === JSON.stringify(expected) ? 'current' : 'stale';
}

function validateGateArtifacts(projectDirectory, state, errors) {
  const required = requiredArtifacts(state);
  const gateNames = ['gate_plan', 'gate_build'].filter((name) => required.includes(name));
  const invalid = [];
  const failed = [];
  const stale = [];

  for (const gateName of gateNames) {
    const result = inspectGateArtifact(projectDirectory, state, gateName);
    if (result === 'invalid') invalid.push(gateName);
    if (result === 'failed') failed.push(gateName);
    if (result === 'stale') stale.push(gateName);
  }

  if (invalid.length > 0) addError(errors, 'INVALID_GATE_ARTIFACTS', { artifacts: sortedStrings(invalid) });
  if (failed.length > 0) addError(errors, 'FAILED_GATE_ARTIFACTS', { artifacts: sortedStrings(failed) });
  if (stale.length > 0) addError(errors, 'STALE_GATE_ARTIFACTS', { artifacts: sortedStrings(stale) });
}

function validateProjectState(projectDirectory, state) {
  const errors = [];
  if (!isPlainObject(state)) {
    return { ok: false, state, errors: [{ code: 'PROJECT_STATE_MUST_BE_OBJECT' }] };
  }

  validateIdentity(projectDirectory, state, errors);
  validateLifecycle(state, errors);
  validateArtifacts(projectDirectory, state, errors);
  validateGateArtifacts(projectDirectory, state, errors);

  return { ok: errors.length === 0, state, errors };
}

function validateProject(projectDirectory) {
  const statePath = path.join(projectDirectory, 'project.json');
  let state;

  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (error) {
    return {
      ok: false,
      state: null,
      errors: [{ code: 'INVALID_PROJECT_STATE', message: error.message }],
    };
  }

  return validateProjectState(projectDirectory, state);
}

function applyTransition(projectDirectory, nextState, expectedUpdatedAt) {
  const current = validateProject(projectDirectory);
  if (!current.ok) {
    return { ok: false, state: nextState, errors: [{ code: 'CURRENT_PROJECT_INVALID', errors: current.errors }] };
  }
  if (current.state.updated_at !== expectedUpdatedAt) {
    return {
      ok: false,
      state: nextState,
      errors: [{ code: 'STATE_VERSION_MISMATCH', expected: expectedUpdatedAt, actual: current.state.updated_at }],
    };
  }

  const next = validateProjectState(projectDirectory, nextState);
  if (!next.ok) {
    return next;
  }

  const errors = [];
  if (['complete', 'abandoned'].includes(current.state.status)) addError(errors, 'TERMINAL_PROJECT');
  const allowedPhases = PHASE_TRANSITIONS[current.state.phase] || [];
  if (nextState.phase !== current.state.phase && !allowedPhases.includes(nextState.phase)) {
    addError(errors, 'ILLEGAL_PHASE_TRANSITION', { from: current.state.phase, to: nextState.phase, allowed: allowedPhases });
  }
  if (Date.parse(nextState.updated_at) <= Date.parse(current.state.updated_at)) {
    addError(errors, 'UPDATED_AT_NOT_ADVANCED', { current: current.state.updated_at, next: nextState.updated_at });
  }
  if (errors.length > 0) return { ok: false, state: nextState, errors };

  const statePath = path.join(projectDirectory, 'project.json');
  const temporaryPath = path.join(projectDirectory, `.project.json.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(nextState, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(temporaryPath, statePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }

  return {
    ok: true,
    previous_phase: current.state.phase,
    state: nextState,
    errors: [],
  };
}

function transitionProject(projectDirectory, nextState, expectedUpdatedAt) {
  if (typeof expectedUpdatedAt !== 'string' || expectedUpdatedAt.length === 0) {
    return { ok: false, state: nextState, errors: [{ code: 'EXPECTED_UPDATED_AT_REQUIRED' }] };
  }

  const lockPath = path.join(projectDirectory, '.project-transition.lock');
  let lock;
  try {
    lock = fs.openSync(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') {
      return { ok: false, state: nextState, errors: [{ code: 'PROJECT_TRANSITION_LOCKED' }] };
    }
    throw error;
  }

  try {
    return applyTransition(projectDirectory, nextState, expectedUpdatedAt);
  } finally {
    fs.closeSync(lock);
    fs.rmSync(lockPath, { force: true });
  }
}

function projectDirectories(projectsRoot) {
  return sortedStrings(fs
    .readdirSync(projectsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(projectsRoot, entry.name)));
}

function loadProjects(projectsRoot) {
  const directories = projectDirectories(projectsRoot).filter((projectDirectory) =>
    fs.existsSync(path.join(projectDirectory, 'project.json'))
  );

  return directories.map((projectDirectory) => {
    const result = validateProject(projectDirectory);
    if (!result.ok) {
      throw new Error(`${path.basename(projectDirectory)}: ${JSON.stringify(result.errors)}`);
    }
    return result.state;
  });
}

function splitMarkdownRow(line) {
  const cells = [];
  let current = '';
  let escaped = false;

  for (const character of line) {
    if (escaped) {
      current += character === '|' ? '|' : `\\${character}`;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  if (escaped) {
    current += '\\';
  }
  cells.push(current.trim());

  if (cells[0] === '') {
    cells.shift();
  }
  if (cells.at(-1) === '') {
    cells.pop();
  }
  return cells;
}

function parseLegacyRegistry(markdown) {
  const projects = new Map();
  for (const line of markdown.split(/\r?\n/)) {
    const cells = splitMarkdownRow(line);
    const pathIndex = cells.findIndex((cell) => /^\[projects\/([^/]+)\/\]\(projects\/\1\/\)$/.test(cell));
    if (pathIndex === -1) {
      continue;
    }
    const pathMatch = /^\[projects\/([^/]+)\/\]\(projects\/\1\/\)$/.exec(cells[pathIndex]);
    if (!pathMatch) {
      continue;
    }

    const updatedAt = /^\d{4}-\d{2}(?:-\d{2})?$/.test(cells[pathIndex + 1] || '')
      ? cells[pathIndex + 1]
      : null;
    projects.set(pathMatch[1], {
      slug: pathMatch[1],
      title: cells[0] || pathMatch[1],
      tier: cells[1] || 'unmanaged',
      status: cells[2] || 'unmanaged',
      phase: pathIndex >= 5 ? cells[3] : 'UNMANAGED',
      updated_at: updatedAt,
      managed: false,
    });
  }
  return projects;
}

function loadProjectRecords(projectsRoot, existingRegistry = '') {
  const managed = new Map(
    loadProjects(projectsRoot).map((state) => [
      state.slug,
      {
        slug: state.slug,
        title: state.title,
        tier: state.tier,
        status: state.status,
        phase: state.phase,
        updated_at: state.updated_at.slice(0, 10),
        managed: true,
      },
    ])
  );
  const legacy = parseLegacyRegistry(existingRegistry);

  return projectDirectories(projectsRoot).map((projectDirectory) => {
    const slug = path.basename(projectDirectory);
    if (managed.has(slug)) {
      return managed.get(slug);
    }
    if (legacy.has(slug)) {
      return legacy.get(slug);
    }
    return {
      slug,
      title: slug,
      tier: 'unmanaged',
      status: 'unmanaged',
      phase: 'UNMANAGED',
      updated_at: fs.statSync(projectDirectory).mtime.toISOString().slice(0, 10),
      managed: false,
    };
  });
}

function escapeCell(value) {
  return String(value).replaceAll('|', String.raw`\|`).replaceAll(/\r?\n/g, ' ');
}

function renderRegistry(records) {
  const rows = records.map((record) => {
    const projectPath = `projects/${record.slug}/`;
    return `| ${escapeCell(record.title)} | ${record.tier} | ${record.status} | ${record.phase} | ${record.managed ? 'yes' : 'no'} | [${projectPath}](${projectPath}) | ${record.updated_at || 'unknown'} |`;
  });

  const hasLegacy = records.some((record) => !record.managed);

  return [
    '# 10x Squad Projects',
    '',
    '| Project | Tier | Status | Phase | Managed | Path | Last Active |',
    '|---------|------|--------|-------|---------|------|-------------|',
    ...rows,
    '',
    ...(hasLegacy
      ? ['> Legacy projects remain visible but must receive `project.json` before resumption.', '']
      : []),
  ].join('\n');
}

function generateRegistry(projectsRoot, existingRegistry = '') {
  return renderRegistry(loadProjectRecords(projectsRoot, existingRegistry));
}

module.exports = {
  PHASES,
  PHASE_REQUIRED_ARTIFACTS,
  PHASE_TRANSITIONS,
  STATUSES,
  TIER_KEYS,
  generateRegistry,
  loadProjectRecords,
  loadProjects,
  renderRegistry,
  splitMarkdownRow,
  transitionProject,
  validateProject,
  validateProjectState,
};