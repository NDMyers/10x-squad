'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const packageRoot = path.resolve(__dirname, '..');
const cliPath = path.join(packageRoot, 'bin', '10x-squad.js');

const skillNames = [
  '10x-einstein-deliberation',
  '10x-peter-spec',
  '10x-linus-build',
  '10x-cobalt-review',
  '10x-sentinel-review',
  '10x-ralph-test',
];

const assets = [
  {
    source: path.join(packageRoot, 'assets', 'agents', '10x-squad.agent.md'),
    target: path.join('.github', 'agents', '10x-squad.agent.md'),
  },
  ...skillNames.map((skillName) => ({
    source: path.join(packageRoot, 'assets', 'skills', skillName, 'SKILL.md'),
    target: path.join('.github', 'skills', skillName, 'SKILL.md'),
  })),
];

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-installer-'));
}

function runCli(args, cwd) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function assertInstalledAssets(workspace) {
  for (const asset of assets) {
    const sourceContent = fs.readFileSync(asset.source, 'utf8');
    const targetContent = fs.readFileSync(path.join(workspace, asset.target), 'utf8');
    assert.equal(targetContent, sourceContent, asset.target);
  }
}

test('install writes 10x Squad assets into the current working directory by default', () => {
  const workspace = makeTempDir();

  runCli(['install'], workspace);

  assertInstalledAssets(workspace);
  assert.equal(fs.existsSync(path.join(workspace, '_cat')), false);
});

test('install --directory writes 10x Squad assets into the explicit target directory', () => {
  const cwd = makeTempDir();
  const workspace = path.join(cwd, 'target-project');
  fs.mkdirSync(workspace);

  runCli(['install', '--directory', workspace], cwd);

  assertInstalledAssets(workspace);
  assert.equal(fs.existsSync(path.join(workspace, '_cat')), false);
});

test('install --directory fails when the explicit target directory does not exist', () => {
  const cwd = makeTempDir();
  const workspace = path.join(cwd, 'missing-project');

  const result = spawnSync(process.execPath, [cliPath, 'install', '--directory', workspace], {
    cwd,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Target directory does not exist/);
  assert.equal(fs.existsSync(workspace), false);
  assert.equal(fs.existsSync(path.join(cwd, '.github')), false);
});

test('rerunning install replaces owned assets and preserves unrelated workspace customizations', () => {
  const workspace = makeTempDir();
  const unrelatedAgent = path.join(workspace, '.github', 'agents', 'custom.agent.md');
  const unrelatedSkill = path.join(workspace, '.github', 'skills', 'custom-skill', 'SKILL.md');

  for (const asset of assets) {
    const target = path.join(workspace, asset.target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'stale content\n');
  }
  fs.mkdirSync(path.dirname(unrelatedAgent), { recursive: true });
  fs.mkdirSync(path.dirname(unrelatedSkill), { recursive: true });
  fs.writeFileSync(unrelatedAgent, 'keep agent\n');
  fs.writeFileSync(unrelatedSkill, 'keep skill\n');

  runCli(['install'], workspace);

  assertInstalledAssets(workspace);
  assert.equal(fs.readFileSync(unrelatedAgent, 'utf8'), 'keep agent\n');
  assert.equal(fs.readFileSync(unrelatedSkill, 'utf8'), 'keep skill\n');
});

test('install does not create or modify CAT installation files', () => {
  const workspace = makeTempDir();
  const catConfig = path.join(workspace, '_cat', 'config.yaml');
  const catArtifact = path.join(workspace, '_cat', 'artifacts', 'keep.md');

  fs.mkdirSync(path.dirname(catArtifact), { recursive: true });
  fs.writeFileSync(catConfig, 'not: valid: cat: config\n');
  fs.writeFileSync(catArtifact, 'preserve cat artifact\n');

  runCli(['install'], workspace);

  assertInstalledAssets(workspace);
  assert.equal(fs.readFileSync(catConfig, 'utf8'), 'not: valid: cat: config\n');
  assert.equal(fs.readFileSync(catArtifact, 'utf8'), 'preserve cat artifact\n');
});

test('package remains independent from @corpay/ai-dlc-toolkit', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));

  assert.equal(packageJson.name, '10x-squad');
  assert.deepEqual(packageJson.bin, { '10x-squad': 'bin/10x-squad.js' });
  assert.equal(Object.hasOwn(packageJson, 'dependencies'), false);
});
