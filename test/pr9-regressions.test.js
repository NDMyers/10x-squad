'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const packageRoot = path.resolve(__dirname, '..');
const cli = path.join(packageRoot, 'bin', '10x-squad.js');
const { parseFilePlan, verifyBuild } = require('../assets/runtime/build-verifier');
const { validateHandoff } = require('../assets/runtime/handoff-validator');
const { advancePhase } = require('../assets/runtime/phase-runner');
const { validateReview } = require('../assets/runtime/review-validator');
const { expandDefaultAll } = require('../assets/skills/10x-squad-configure-tiers/scripts/model-tier-config');
const { composePersonaAgent, composeVivaldi } = require('../lib/compose');
const tempDirectories = [];

function tempDir() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-pr9-45f91494-'));
  tempDirectories.push(directory);
  return directory;
}

test.after(() => {
  for (const directory of tempDirectories) fs.rmSync(directory, { recursive: true, force: true });
});

function runNode(script, args, cwd, home) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    env: { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config') },
    encoding: 'utf8',
  });
}

function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function setupProject(workspace, slug = 'project') {
  const project = path.join(workspace, slug);
  fs.mkdirSync(project);
  write(path.join(project, 'CONTEXT.md'), '# Project\n');
  write(path.join(project, 'project.json'), JSON.stringify({
    schema_version: 1,
    slug,
    title: 'Project',
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

function writeRoutingConfig(workspace) {
  const assignments = Object.fromEntries(
    ['trivial', 'lite', 'standard_clear', 'standard_ambiguous', 'complex'].map((tier) => [tier, 'test-model'])
  );
  write(path.join(workspace, '.10x-squad', 'model-routing.json'), JSON.stringify({
    schema_version: 1,
    updated_at: '2026-01-01T00:00:00.000Z',
    harnesses: {
      'copilot-cli': { assignments },
      'codex-cli': { assignments },
    },
  }));
}

function setupReviewProject(workspace, review) {
  const project = setupProject(workspace);
  const spec = '## File Plan\n- `src/example.js` — Change.\n## Acceptance Criteria\n1. (AC1) Works.\n';
  const build = '## Changelist\n- `src/example.js` (AC1) — Changed.\n';
  const gatePlan = validateHandoff({ spec });
  const gateBuild = validateHandoff({ spec, build });
  assert.equal(gatePlan.ok, true);
  assert.equal(gateBuild.ok, true);
  write(path.join(project, 'spec.md'), spec);
  write(path.join(project, 'build.md'), build);
  write(path.join(project, 'gate-plan.json'), JSON.stringify(gatePlan));
  write(path.join(project, 'gate-build.json'), JSON.stringify(gateBuild));
  write(path.join(project, 'review.md'), review);
  const statePath = path.join(project, 'project.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.phase = 'REVIEW';
  state.artifacts = {
    ...state.artifacts,
    spec: 'spec.md',
    build: 'build.md',
    gate_plan: 'gate-plan.json',
    gate_build: 'gate-build.json',
    review: 'review.md',
  };
  write(statePath, JSON.stringify(state));
  return project;
}

function runAdvance(workspace, home, project, harness) {
  return runNode(path.join(workspace, '.10x-squad', 'runtime', 'control.js'), [
    'advance-phase', '--project', project, '--to', 'PLAN',
    '--workspace-root', workspace, '--harness', harness,
  ], workspace, home);
}

test('File Plan accepts root files and plain table paths without treating other cells as files', () => {
  const spec = `
## File Plan
- \`Dockerfile\` — Container build.
- Makefile — Local commands.
| # | File path | Action | Description |
|---|-----------|--------|-------------|
| 1 | src/server.js | Modify | Server |
| 2 | LICENSE | Add | License |
| 3 | .dockerignore | Add | Ignore |
`;
  const build = `## Changelist
- \`Dockerfile\` (AC1) — Container.
- \`Makefile\` (AC1) — Commands.
- \`src/server.js\` (AC1) — Server.
- \`LICENSE\` (AC1) — License.
- \`.dockerignore\` (AC1) — Ignore.
`;
  assert.deepEqual(parseFilePlan(spec), ['Dockerfile', 'Makefile', 'src/server.js', 'LICENSE', '.dockerignore']);
  const result = verifyBuild({ spec, build, enforceFilePlan: true });
  assert.equal(result.ok, true);
  assert.equal(result.scope_clean, true);
});

test('File Plan reads only its explicitly referenced appendix, even when another comes first', () => {
  const spec = `
## File Plan
See Appendix B for the planned files.

## Appendix A — Background
- \`unrelated.md\` — Context.

## Appendix B — File Plan
| File | Change |
|------|--------|
| src/actual.js | Modify |
`;
  assert.deepEqual(parseFilePlan(spec), ['src/actual.js']);
});

test('coverage-gate findings with evidence survive deterministic review filtering', () => {
  const review = `
## Verdict: REQUEST_CHANGES
## Findings
1. **[MAJOR]** — Insufficient Test Coverage (COVERAGE_GATE) — \`src/example.js\`
   Proof: SonarQube branch report; changed-file coverage: 80%, not greater than 80%.
`;
  const result = validateReview({ spec: '## Acceptance Criteria\n1. (AC1) Works.\n', review });
  assert.equal(result.effective_verdict, 'REQUEST_CHANGES');
  assert.equal(result.counts.verified_blocking, 1);
});

test('a blocking coverage verdict routes back to BUILD and cannot advance to TEST or DELIVER', () => {
  const review = `## Verdict: REQUEST_CHANGES
## Findings
1. **[MAJOR]** — Insufficient Test Coverage (COVERAGE_GATE) — \`src/example.js\`
   Proof: SonarQube branch report; changed-file coverage: 80%.
`;
  const project = setupReviewProject(tempDir(), review);
  for (const targetPhase of ['TEST', 'DELIVER', 'PLAN']) {
    const result = advancePhase({ projectDirectory: project, targetPhase });
    assert.equal(result.ok, false, targetPhase);
    assert.equal(result.errors[0].code, 'REVIEW_VERDICT_PHASE_MISMATCH');
    assert.equal(result.errors[0].required_phase, 'BUILD');
    assert.equal(JSON.parse(fs.readFileSync(path.join(project, 'project.json'), 'utf8')).phase, 'REVIEW');
  }
  const rework = advancePhase({ projectDirectory: project, targetPhase: 'BUILD' });
  assert.equal(rework.ok, true);
  assert.equal(rework.phase, 'BUILD');
});

test('review approval advances and a spec dispute routes only to PLAN', () => {
  const approved = setupReviewProject(tempDir(), '## Verdict: APPROVE\n## Findings\nNone.\n');
  assert.equal(advancePhase({ projectDirectory: approved, targetPhase: 'TEST' }).phase, 'TEST');

  const disputed = setupReviewProject(tempDir(), '## Verdict: SPEC_DISPUTE\n## Findings\nNone.\n');
  const wrongPhase = advancePhase({ projectDirectory: disputed, targetPhase: 'TEST' });
  assert.equal(wrongPhase.ok, false);
  assert.equal(wrongPhase.errors[0].required_phase, 'PLAN');
  assert.equal(advancePhase({ projectDirectory: disputed, targetPhase: 'PLAN' }).phase, 'PLAN');
});

test('coverage-gate evidence enforces the strict threshold and requires a report', () => {
  const spec = '## Acceptance Criteria\n1. (AC1) Works.\n';
  for (const proof of [
    'SonarQube report; changed-file coverage: 80.01%.',
    'SonarQube report without a percentage.',
    'changed-file coverage: 79%.',
  ]) {
    const review = `## Verdict: REQUEST_CHANGES
## Findings
1. **[MAJOR]** — Insufficient Test Coverage (COVERAGE_GATE) — \`src/example.js\`
   Proof: ${proof}
`;
    const result = validateReview({ spec, review });
    assert.equal(result.ok, false, proof);
    assert.equal(result.effective_verdict, 'APPROVE', proof);
    assert.ok(result.demoted_findings[0].demotion_reasons.includes('INVALID_COVERAGE_EVIDENCE'));
    assert.ok(result.errors.some((error) => error.code === 'INVALID_COVERAGE_EVIDENCE'));
  }
});

test('the changed-file coverage gate remains blocking during a scope-locked re-review', () => {
  const spec = '## Acceptance Criteria\n1. (AC1) Works.\n';
  const previousReview = `## Verdict: REQUEST_CHANGES
## Findings
1. **[MAJOR]** — Logic (AC1) — \`src/first.js\`
   Proof: \`src/first.js:1\` returns the wrong result.
`;
  const review = `## Verdict: REQUEST_CHANGES
## Findings
1. **[MAJOR]** — Insufficient Test Coverage (COVERAGE_GATE) — \`src/second.js\`
   Proof: SonarQube branch report; changed-file coverage: 79.9%.
`;
  const result = validateReview({ spec, review, previousReview });
  assert.equal(result.effective_verdict, 'REQUEST_CHANGES');
  assert.equal(result.counts.verified_blocking, 1);
});

test('parallel review retains the SonarQube gate without rerunning test suites', () => {
  const cobalt = composePersonaAgent('cobalt');
  const vivaldi = composeVivaldi('copilot');
  assert.match(cobalt, /current branch\/PR changes at every tier, including when Ralph runs in parallel/);
  assert.match(cobalt, /coverage is \*\*>80%\*\*/);
  assert.match(cobalt, /\*\*≤80%\*\*.*\*\*MAJOR\*\*/);
  assert.match(cobalt, /\*\*MINOR\*\* finding \("SonarQube coverage data unavailable"\)/);
  assert.match(cobalt, /Do not rerun tests or builds to retrieve the report/);
  assert.match(vivaldi, /accessible only through a tool unavailable to scoped Cobalt/);
  assert.match(vivaldi, /Ralph owns test execution exclusively/);
});

test('a Copilot-only home install mirrors skills and agents and uninstalls only its assets', () => {
  const home = tempDir();
  const unrelated = path.join(home, '.copilot', 'skills', 'unrelated', 'SKILL.md');
  write(unrelated, 'keep\n');
  const installed = runNode(cli, ['install', '--directory', home, '--harness', 'copilot'], packageRoot, home);
  assert.equal(installed.status, 0, installed.stderr);

  for (const relative of [
    '10x-cobalt-review/SKILL.md',
    '10x-squad-configure-tiers/scripts/model-tier-config.js',
    '10x-squad-configure-tiers/references/model-resolution.md',
  ]) {
    assert.deepEqual(
      fs.readFileSync(path.join(home, '.copilot', 'skills', relative)),
      fs.readFileSync(path.join(home, '.github', 'skills', relative))
    );
  }
  assert.ok(fs.existsSync(path.join(home, '.copilot', 'agents', '10x-linus.agent.md')));

  const workspace = tempDir();
  writeRoutingConfig(workspace);
  const resolver = path.join(home, '.copilot', 'skills', '10x-squad-configure-tiers', 'scripts', 'model-tier-config.js');
  const resolved = runNode(resolver, [
    'resolve', '--workspace-root', workspace, '--harness', 'copilot-cli',
    '--tier', 'standard_clear', '--persona', 'peter', '--json',
  ], workspace, home);
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.equal(JSON.parse(resolved.stdout).model, 'test-model');

  const project = setupProject(workspace);
  const advanced = runNode(path.join(home, '.10x-squad', 'runtime', 'control.js'), [
    'advance-phase', '--project', project, '--to', 'PLAN',
    '--workspace-root', workspace, '--harness', 'copilot-cli',
  ], workspace, home);
  assert.equal(advanced.status, 0, advanced.stderr || advanced.stdout);
  assert.equal(JSON.parse(advanced.stdout).next_dispatches.profiles[0].model, 'test-model');

  const removed = runNode(cli, ['uninstall', '--directory', home, '--harness', 'copilot'], packageRoot, home);
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.existsSync(path.join(home, '.copilot', 'skills', '10x-cobalt-review', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(home, '.copilot', 'agents', '10x-linus.agent.md')), false);
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'keep\n');
});

test('home installs warn when a Copilot CLI skill mirror is stale', () => {
  const home = tempDir();
  const first = runNode(cli, ['install', '--directory', home, '--harness', 'copilot'], packageRoot, home);
  assert.equal(first.status, 0, first.stderr);
  write(path.join(home, '.copilot', 'skills', '10x-cobalt-review', 'SKILL.md'), 'stale\n');
  const other = runNode(cli, ['install', '--directory', home, '--harness', 'codex'], packageRoot, home);
  assert.equal(other.status, 0, other.stderr);
  assert.match(other.stderr, /\.copilot\/skills\/10x-cobalt-review\s+\(STALE\)/);
  const refreshed = runNode(cli, ['install', '--directory', home, '--harness', 'copilot'], packageRoot, home);
  assert.equal(refreshed.status, 0, refreshed.stderr);
  assert.doesNotMatch(refreshed.stderr, /10x-cobalt-review/);
});

test('installed runtime chooses a usable resolver in mixed-harness upgrades', () => {
  const workspace = tempDir();
  const home = tempDir();
  const installed = runNode(cli, ['install', '--directory', workspace, '--harness', 'codex'], packageRoot, home);
  assert.equal(installed.status, 0, installed.stderr);
  const oldResolver = path.join(
    workspace, '.github', 'skills', '10x-squad-configure-tiers', 'scripts', 'model-tier-config.js'
  );
  write(oldResolver, "throw new Error('wrong harness resolver');\n");
  writeRoutingConfig(workspace);
  const project = setupProject(workspace);

  const result = runAdvance(workspace, home, project, 'codex-cli');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const packet = JSON.parse(result.stdout);
  assert.equal(packet.next_dispatches.ok, true);
  assert.equal(packet.next_dispatches.profiles[0].persona, 'peter');
  assert.equal(packet.next_dispatches.profiles[0].model, 'test-model');

  const board = runNode(path.join(workspace, '.10x-squad', 'runtime', 'control.js'), [
    'render-board', '--project', project, '--format', 'json',
    '--workspace-root', workspace, '--harness', 'codex-cli',
  ], workspace, home);
  assert.equal(board.status, 0, board.stderr);
  assert.equal(JSON.parse(board.stdout).profiles.peter.model, 'test-model');

  const withoutHarness = runNode(path.join(workspace, '.10x-squad', 'runtime', 'control.js'), [
    'render-board', '--project', project, '--format', 'json', '--workspace-root', workspace,
  ], workspace, home);
  assert.equal(withoutHarness.status, 0, withoutHarness.stderr);
  const unresolvedProfiles = JSON.parse(withoutHarness.stdout).profiles;
  assert.equal(unresolvedProfiles.peter.model, 'unresolved');
  assert.equal(unresolvedProfiles.routing_error.code, 'HARNESS_REQUIRED');

  write(oldResolver, 'module.exports = null;\n');
  const secondProject = setupProject(workspace, 'copilot-project');
  const fallback = runAdvance(workspace, home, secondProject, 'copilot-cli');
  assert.equal(fallback.status, 0, fallback.stderr || fallback.stdout);
  assert.equal(JSON.parse(fallback.stdout).next_dispatches.profiles[0].model, 'test-model');

  const relativeProject = setupProject(workspace, 'relative-project');
  const relative = runNode(path.join(workspace, '.10x-squad', 'runtime', 'control.js'), [
    'advance-phase', '--project', relativeProject, '--to', 'PLAN',
    '--workspace-root', '.', '--harness', 'codex-cli',
  ], workspace, home);
  assert.equal(relative.status, 0, relative.stderr || relative.stdout);
  assert.equal(JSON.parse(relative.stdout).next_dispatches.profiles[0].model, 'test-model');
});

test('the board distinguishes resolved persona profiles from the parent advisory', () => {
  const workspace = tempDir();
  const home = tempDir();
  const project = setupProject(workspace);
  const tiers = ['trivial', 'lite', 'standard_clear', 'standard_ambiguous', 'complex'];
  write(path.join(workspace, '.10x-squad', 'model-routing.json'), JSON.stringify({
    schema_version: 3,
    updated_at: '2026-01-01T00:00:00.000Z',
    harnesses: {
      'copilot-cli': {
        assignments: expandDefaultAll('test-model'),
        advisory: {
          vivaldi: Object.fromEntries(tiers.map((tier) => [tier, {
            model: 'recommended-parent', reasoning_effort: 'auto',
          }])),
        },
      },
    },
  }));
  const result = runNode(path.join(packageRoot, 'assets', 'runtime', 'control.js'), [
    'render-board', '--project', project, '--format', 'json',
    '--workspace-root', workspace, '--harness', 'copilot-cli',
  ], workspace, home);
  assert.equal(result.status, 0, result.stderr);
  const profiles = JSON.parse(result.stdout).profiles;
  assert.equal(profiles.peter.model, 'test-model');
  assert.equal(profiles.vivaldi.model, 'recommended-parent');
  assert.equal(profiles.vivaldi.reasoning_effort, 'auto');
  assert.equal(profiles.vivaldi.advisory, true);
});

test('missing or broken resolvers fail explicitly before the project phase changes', () => {
  for (const mode of ['missing', 'broken', 'malformed']) {
    const workspace = tempDir();
    const home = tempDir();
    const installed = runNode(cli, ['install', '--directory', workspace, '--harness', 'codex'], packageRoot, home);
    assert.equal(installed.status, 0, installed.stderr);
    const codexResolver = path.join(
      workspace, '.agents', 'skills', '10x-squad-configure-tiers', 'scripts', 'model-tier-config.js'
    );
    if (mode === 'missing') {
      fs.unlinkSync(codexResolver);
    } else {
      const copilotResolver = path.join(
        workspace, '.github', 'skills', '10x-squad-configure-tiers', 'scripts', 'model-tier-config.js'
      );
      write(copilotResolver, mode === 'broken'
        ? "throw new Error('resolver is broken');\n"
        : 'exports.resolveEffectiveProfile = () => ({ ok: true, result: {} });\n');
    }
    writeRoutingConfig(workspace);
    const project = setupProject(workspace);
    const result = runAdvance(workspace, home, project, 'copilot-cli');
    assert.notEqual(result.status, 0, mode);
    const packet = JSON.parse(result.stdout);
    assert.equal(packet.ok, false);
    assert.equal(packet.next_dispatches.ok, false);
    const expected = mode === 'missing' ? /resolver.*unavailable/i
      : mode === 'broken' ? /resolver is broken/ : /incomplete or mismatched dispatch profile/;
    assert.match(JSON.stringify(packet.next_dispatches), expected);
    assert.equal(JSON.parse(fs.readFileSync(path.join(project, 'project.json'), 'utf8')).phase, 'INTAKE');
  }
});
