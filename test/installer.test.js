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

const { composeVivaldi } = require('../lib/compose');
const { detectShadowedSkills, installTenXSquad } = require('../lib/installer');

// Same CLI-style args as runCli, but returns the structured install result so
// the shadow report can be asserted directly rather than scraped from stderr.
function runInstall(args, workspace) {
  const harnessIndex = args.indexOf('--harness');
  return installTenXSquad({
    directory: workspace,
    cwd: workspace,
    harness: harnessIndex === -1 ? undefined : args[harnessIndex + 1],
  });
}

function skillAssets(skillsRoot) {
  return skillNames.flatMap((skillName) => {
    const skillDir = path.join(packageRoot, 'assets', 'skills', skillName);
    return walkFiles(skillDir).map((source) => ({
      source,
      target: path.join(skillsRoot, skillName, path.relative(skillDir, source)),
    }));
  });
}

// Mirrors lib/installer.js's per-harness manifest literally, so a manifest
// change has to be made in two places on purpose rather than drift silently.
const harnessAssets = {
  copilot: [
    { contents: () => composeVivaldi('copilot'), target: path.join('.github', 'agents', '10x-squad.agent.md') },
    ...skillAssets(path.join('.github', 'skills')),
  ],
  codex: [
    {
      contents: () => composeVivaldi('codex'),
      target: path.join('.agents', 'skills', '10x-squad-vivaldi', 'SKILL.md'),
    },
    {
      source: path.join(packageRoot, 'assets', 'vivaldi', 'openai.yaml'),
      target: path.join('.agents', 'skills', '10x-squad-vivaldi', 'agents', 'openai.yaml'),
    },
    ...skillAssets(path.join('.agents', 'skills')),
  ],
};

const assets = [...harnessAssets.copilot, ...harnessAssets.codex];

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

function expectedContent(asset) {
  return asset.contents ? asset.contents() : fs.readFileSync(asset.source, 'utf8');
}

function assertInstalledAssets(workspace, expected = assets) {
  for (const asset of expected) {
    const targetContent = fs.readFileSync(path.join(workspace, asset.target), 'utf8');
    assert.equal(targetContent, expectedContent(asset), asset.target);
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
    path.join('scripts', 'routing-constants.js'),
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
  const script = "process.stdout.write(JSON.stringify(require('./lib/installer.js').assetsFor('all').map((a) => a.target)))";
  const runs = [0, 1].map(() => {
    const result = spawnSync(process.execPath, ['-e', script], { cwd: packageRoot, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  });
  assert.equal(runs[0], runs[1]);

  // Sortedness is a per-skill-directory invariant. Each harness installs the
  // same skills under its own root, so scope the check to one root at a time.
  const targets = JSON.parse(runs[0]);
  for (const skillsRoot of [path.join('.github', 'skills'), path.join('.agents', 'skills')]) {
    for (const skillName of skillNames) {
      const prefix = path.join(skillsRoot, skillName) + path.sep;
      const inSkill = targets.filter((t) => t.startsWith(prefix));
      assert.ok(inSkill.length >= 1, `no assets enumerated for ${skillsRoot}/${skillName}`);
      assert.deepEqual(inSkill, [...inSkill].sort(), `assets for ${skillsRoot}/${skillName} must be sorted`);
    }
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

// Copilot loads .github/skills, .agents/skills and .claude/skills all at once, so
// the same skill name under two roots is loaded twice and one copy shadows the
// other. A full install keeps them identical; these cover the drift cases.
const skillRoots = {
  copilot: path.join('.github', 'skills'),
  codex: path.join('.agents', 'skills'),
};

function staleCopy(workspace, root, skillName = '10x-squad-configure-tiers') {
  const target = path.join(workspace, root, skillName, 'SKILL.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '# stale build\n');
}

test('a full install leaves both harness trees identical and reports no shadowing', () => {
  const workspace = makeTempDir();

  const result = runInstall(['install'], workspace);

  assert.deepEqual(result.shadowed, []);
});

test('a single-harness install reports the other root left behind at an older revision', () => {
  const workspace = makeTempDir();
  staleCopy(workspace, skillRoots.codex);

  const result = runInstall(['install', '--harness', 'copilot'], workspace);

  assert.equal(result.shadowed.length, 1);
  const [shadow] = result.shadowed;
  assert.equal(shadow.skillName, '10x-squad-configure-tiers');
  assert.deepEqual(shadow.staleRoots, [skillRoots.codex]);
  assert.deepEqual(
    shadow.copies.map((copy) => [copy.root, copy.current]),
    [[skillRoots.copilot, true], [skillRoots.codex, false]]
  );
});

test('reinstalling every harness clears a previously shadowed skill', () => {
  const workspace = makeTempDir();
  staleCopy(workspace, skillRoots.codex);

  assert.equal(runInstall(['install', '--harness', 'copilot'], workspace).shadowed.length, 1);
  assert.deepEqual(runInstall(['install'], workspace).shadowed, []);
});

test('a stale copy in .claude/skills shadows even though the installer never writes there', () => {
  const workspace = makeTempDir();
  staleCopy(workspace, path.join('.claude', 'skills'));

  const result = runInstall(['install'], workspace);

  assert.equal(result.shadowed.length, 1);
  assert.deepEqual(result.shadowed[0].staleRoots, [path.join('.claude', 'skills')]);
});

test('one stale copy alone is not reported — it shadows nothing', () => {
  const workspace = makeTempDir();
  staleCopy(workspace, skillRoots.codex);

  // No install: the Codex tree is the only copy present, so nothing is hidden.
  assert.deepEqual(detectShadowedSkills(workspace), []);
});

test('a missing file makes a copy stale, not merely edited bytes', () => {
  const workspace = makeTempDir();
  runInstall(['install'], workspace);
  fs.rmSync(path.join(workspace, skillRoots.codex, '10x-squad-configure-tiers', 'scripts', 'routing-constants.js'));

  const shadowed = detectShadowedSkills(workspace);

  assert.equal(shadowed.length, 1);
  assert.deepEqual(shadowed[0].staleRoots, [skillRoots.codex]);
});

test('the install command warns on stderr and still exits 0', () => {
  const workspace = makeTempDir();
  staleCopy(workspace, skillRoots.codex);

  const result = spawnSync(process.execPath, [cliPath, 'install', '--harness', 'copilot'], {
    cwd: workspace,
    encoding: 'utf8',
  });

  // Shadowing is a warning, never a failure: the requested install did succeed.
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /multiple discovery roots at different revisions/);
  assert.match(result.stderr, /10x-squad-configure-tiers/);
  assert.match(result.stderr, /\(STALE\)/);
  assert.match(result.stderr, /reloading will not clear it/);
  assert.match(result.stderr, /no --harness flag/);
});

test('a clean install prints no shadow warning', () => {
  const workspace = makeTempDir();

  const result = spawnSync(process.execPath, [cliPath, 'install'], { cwd: workspace, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /discovery roots/);
});

test('uninstall removes every installed asset', () => {
  const workspace = makeTempDir();
  runCli(['install'], workspace);

  runCli(['uninstall'], workspace);

  for (const asset of assets) {
    assert.equal(fs.existsSync(path.join(workspace, asset.target)), false, asset.target);
  }
});

test('uninstall preserves .10x-squad/model-routing.json', () => {
  const workspace = makeTempDir();
  const configFile = path.join(workspace, '.10x-squad', 'model-routing.json');
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, '{"sentinel":"preserve-me"}\n');

  runCli(['install'], workspace);
  runCli(['uninstall'], workspace);

  // Routing configuration is user data, never part of the asset manifest.
  assert.equal(fs.readFileSync(configFile, 'utf8'), '{"sentinel":"preserve-me"}\n');
});

test('uninstall leaves unrelated agents and skills in shared roots alone', () => {
  const workspace = makeTempDir();
  const foreignSkill = path.join(workspace, '.github', 'skills', 'other-bundle-skill', 'SKILL.md');
  const foreignAgent = path.join(workspace, '.github', 'agents', 'other.agent.md');

  runCli(['install'], workspace);
  fs.mkdirSync(path.dirname(foreignSkill), { recursive: true });
  fs.writeFileSync(foreignSkill, 'keep me\n');
  fs.writeFileSync(foreignAgent, 'keep me\n');

  runCli(['uninstall'], workspace);

  assert.equal(fs.readFileSync(foreignSkill, 'utf8'), 'keep me\n');
  assert.equal(fs.readFileSync(foreignAgent, 'utf8'), 'keep me\n');
  // A shared root still holding another bundle's files must survive.
  assert.equal(fs.existsSync(path.join(workspace, '.github', 'skills')), true);
});

test('uninstall prunes roots it emptied', () => {
  const workspace = makeTempDir();
  runCli(['install'], workspace);

  runCli(['uninstall'], workspace);

  assert.equal(fs.existsSync(path.join(workspace, '.github')), false);
  assert.equal(fs.existsSync(path.join(workspace, '.agents')), false);
});

test('uninstall --harness removes only that harness tree', () => {
  const workspace = makeTempDir();
  runCli(['install'], workspace);

  runCli(['uninstall', '--harness', 'codex'], workspace);

  assert.equal(fs.existsSync(path.join(workspace, '.agents')), false);
  assertInstalledAssets(workspace, harnessAssets.copilot);
});

test('uninstall is idempotent and succeeds when nothing is installed', () => {
  const workspace = makeTempDir();

  const first = runCli(['uninstall'], workspace);
  assert.match(first.stdout, /Removed 0 10x Squad asset\(s\)/);

  runCli(['install'], workspace);
  runCli(['uninstall'], workspace);
  runCli(['uninstall'], workspace);
});

test('uninstall rejects an unknown harness without removing anything', () => {
  const workspace = makeTempDir();
  runCli(['install'], workspace);

  const result = spawnSync(process.execPath, [cliPath, 'uninstall', '--harness', 'nonsense'], {
    cwd: workspace,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown harness: nonsense/);
  assertInstalledAssets(workspace);
});

test('package remains independent from @corpay/ai-dlc-toolkit', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));

  assert.equal(packageJson.name, '10x-squad');
  assert.deepEqual(packageJson.bin, { '10x-squad': 'bin/10x-squad.js' });
  assert.equal(Object.hasOwn(packageJson, 'dependencies'), false);
});

test('install --harness copilot writes only the Copilot tree', () => {
  const workspace = makeTempDir();

  runCli(['install', '--harness', 'copilot'], workspace);

  assertInstalledAssets(workspace, harnessAssets.copilot);
  assert.equal(fs.existsSync(path.join(workspace, '.github')), true);
  assert.equal(fs.existsSync(path.join(workspace, '.agents')), false);
});

test('install --harness codex writes only the Codex tree', () => {
  const workspace = makeTempDir();

  runCli(['install', '--harness', 'codex'], workspace);

  assertInstalledAssets(workspace, harnessAssets.codex);
  assert.equal(fs.existsSync(path.join(workspace, '.agents')), true);
  assert.equal(fs.existsSync(path.join(workspace, '.github')), false);
});

test('install defaults to every harness', () => {
  const workspace = makeTempDir();

  runCli(['install'], workspace);

  assertInstalledAssets(workspace);
  assert.equal(fs.existsSync(path.join(workspace, '.github', 'agents', '10x-squad.agent.md')), true);
  assert.equal(fs.existsSync(path.join(workspace, '.agents', 'skills', '10x-squad-vivaldi', 'SKILL.md')), true);
});

test('install rejects an unknown harness without writing anything', () => {
  const workspace = makeTempDir();

  const result = spawnSync(process.execPath, [cliPath, 'install', '--harness', 'nonsense'], {
    cwd: workspace,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown harness: nonsense/);
  assert.equal(fs.existsSync(path.join(workspace, '.github')), false);
  assert.equal(fs.existsSync(path.join(workspace, '.agents')), false);
});

test('Codex install ships no .codex/agents definitions', () => {
  // spawn_agent exposes no agent-name parameter, so custom agent TOMLs are not
  // addressable dispatch targets (docs/codex-harness-spike.md, C10). Shipping
  // them would install files nothing can reach.
  const workspace = makeTempDir();

  runCli(['install', '--harness', 'codex'], workspace);

  assert.equal(fs.existsSync(path.join(workspace, '.codex')), false);
});
