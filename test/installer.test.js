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
  '10x-squad-configure-tiers',
];

function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

const assets = [
  {
    source: path.join(packageRoot, 'assets', 'agents', '10x-squad.agent.md'),
    target: path.join('.github', 'agents', '10x-squad.agent.md'),
  },
  ...skillNames.flatMap((skillName) => {
    const skillDir = path.join(packageRoot, 'assets', 'skills', skillName);
    return walkFiles(skillDir).map((source) => ({
      source,
      target: path.join('.github', 'skills', skillName, path.relative(skillDir, source)),
    }));
  }),
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

test('configure-tiers skill installs as a complete package with nested resources', () => {
  const workspace = makeTempDir();

  runCli(['install'], workspace);

  const skillRoot = path.join(workspace, '.github', 'skills', '10x-squad-configure-tiers');
  for (const rel of [
    'SKILL.md',
    path.join('scripts', 'model-tier-config.js'),
    path.join('scripts', 'model-id-resolver.js'),
    path.join('references', 'config-format.md'),
    path.join('references', 'model-resolution.md'),
    path.join('agents', 'openai.yaml'),
  ]) {
    assert.ok(fs.existsSync(path.join(skillRoot, rel)), `missing nested resource ${rel}`);
  }
});

test('every nested skill resource is copied byte-for-byte', () => {
  const workspace = makeTempDir();

  runCli(['install'], workspace);

  for (const skillName of skillNames) {
    const skillDir = path.join(packageRoot, 'assets', 'skills', skillName);
    for (const source of walkFiles(skillDir)) {
      const target = path.join(workspace, '.github', 'skills', skillName, path.relative(skillDir, source));
      assert.deepEqual(fs.readFileSync(target), fs.readFileSync(source), target);
    }
  }
});

test('asset enumeration is deterministic and sorted within each skill', () => {
  const script = "process.stdout.write(JSON.stringify(require('./lib/installer.js').assets.map((a) => a.target)))";
  const runs = [0, 1].map(() => {
    const result = spawnSync(process.execPath, ['-e', script], { cwd: packageRoot, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  });
  assert.equal(runs[0], runs[1]);

  const targets = JSON.parse(runs[0]);
  for (const skillName of skillNames) {
    const inSkill = targets.filter((t) => t.includes(path.join('skills', skillName) + path.sep));
    assert.ok(inSkill.length >= 1, `no assets enumerated for ${skillName}`);
    assert.deepEqual(inSkill, [...inSkill].sort(), `assets for ${skillName} must be sorted`);
  }
});

test('reinstall preserves .10x-squad/model-routing.json and stays idempotent', () => {
  const workspace = makeTempDir();
  const configFile = path.join(workspace, '.10x-squad', 'model-routing.json');
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, '{"sentinel":"preserve-me"}\n');

  runCli(['install'], workspace);
  assert.equal(fs.readFileSync(configFile, 'utf8'), '{"sentinel":"preserve-me"}\n');

  runCli(['install'], workspace);
  assert.equal(fs.readFileSync(configFile, 'utf8'), '{"sentinel":"preserve-me"}\n');
  assertInstalledAssets(workspace);
});

test('package remains independent from @corpay/ai-dlc-toolkit', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));

  assert.equal(packageJson.name, '10x-squad');
  assert.deepEqual(packageJson.bin, { '10x-squad': 'bin/10x-squad.js' });
  assert.equal(Object.hasOwn(packageJson, 'dependencies'), false);
});
