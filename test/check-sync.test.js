'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const packageRoot = path.resolve(__dirname, '..');
const checkSync = path.join(packageRoot, 'evals', 'check-sync.sh');
const { installTenXSquad } = require('../lib/installer');

function makeWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-sync-'));
  installTenXSquad({ directory: workspace });
  return workspace;
}

function runCheck(workspace, ...args) {
  return spawnSync('bash', [checkSync, ...args], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      SQUAD_ROOT: workspace,
      CLAUDE_CMDS: path.join(workspace, 'missing-claude-commands'),
    },
  });
}

test('check-sync --source-only gates only canonical deployed assets', () => {
  const workspace = makeWorkspace();

  const clean = runCheck(workspace, '--source-only');

  assert.equal(clean.status, 0, clean.stdout || clean.stderr);
  assert.match(clean.stdout, /SOURCE failures:\s+0/);
  assert.doesNotMatch(clean.stdout, /UPSTREAM lag|PORT dangling/);

  fs.appendFileSync(
    path.join(workspace, '.10x-squad', 'runtime', 'control.js'),
    '\nlocal drift\n'
  );

  const drifted = runCheck(workspace, '--source-only');

  assert.equal(drifted.status, 1, drifted.stdout || drifted.stderr);
  assert.match(drifted.stdout, /runtime\/control\.js: live != assets/);
  assert.match(drifted.stdout, /SOURCE failures:\s+1/);
});

test('check-sync --source-only fails when the Codex deployment is missing', () => {
  const workspace = makeWorkspace();
  fs.rmSync(path.join(workspace, '.agents'), { recursive: true });

  const result = runCheck(workspace, '--source-only');

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /\.agents\/skills\/10x-squad-vivaldi\/SKILL\.md: missing/);
});

test('check-sync --source-only fails when one Copilot skill is missing', () => {
  const workspace = makeWorkspace();
  fs.rmSync(path.join(workspace, '.github', 'skills', '10x-linus-build'), { recursive: true });

  const result = runCheck(workspace, '--source-only');

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /\.github\/skills\/10x-linus-build\/SKILL\.md: missing/);
});

test('check-sync --source-only fails on extra files and retired 10x skills', () => {
  const workspace = makeWorkspace();
  fs.writeFileSync(path.join(workspace, '.github', 'skills', '10x-linus-build', 'stale.md'), 'stale\n');
  const retired = path.join(workspace, '.agents', 'skills', '10x-retired-skill');
  fs.mkdirSync(retired);
  fs.writeFileSync(path.join(retired, 'SKILL.md'), 'retired\n');

  const result = runCheck(workspace, '--source-only');

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /\.github\/skills\/10x-linus-build\/stale\.md: extra deployed file/);
  assert.match(result.stdout, /\.agents\/skills\/10x-retired-skill\/SKILL\.md: extra deployed file/);
});

test('check-sync rejects a same-content symlinked owned file', () => {
  const workspace = makeWorkspace();
  const target = path.join(workspace, '.10x-squad', 'runtime', 'control.js');
  const external = path.join(workspace, 'external-control.js');
  fs.copyFileSync(target, external);
  fs.rmSync(target);
  fs.symlinkSync(external, target);

  const result = runCheck(workspace, '--source-only');

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /\.10x-squad\/runtime\/control\.js: not a regular owned file/);
});

test('check-sync normalizes 256 source failures to a nonzero exit', () => {
  const workspace = makeWorkspace();
  const skill = path.join(workspace, '.github', 'skills', '10x-linus-build');
  for (let index = 0; index < 256; index += 1) {
    fs.writeFileSync(path.join(skill, `stale-${index}.md`), 'stale\n');
  }

  const result = runCheck(workspace, '--source-only');

  assert.equal(result.status, 1);
  assert.match(result.stdout, /SOURCE failures:\s+256/);
});