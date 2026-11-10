'use strict';

// Cross-platform runtime helpers: Claude Code surface detection and the
// Workflow Monitor's file: URL / OS browser opener.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { detectClaudeSurface, CLAUDE_ENTRYPOINT_SURFACES } = require('../assets/runtime/surface');
const { browserOpener, dashboardUrl, openDashboard } = require('../assets/runtime/workflow-board');

const controlPath = path.resolve(__dirname, '..', 'assets', 'runtime', 'control.js');

test('each verified Claude Code entrypoint maps to its own surface key', () => {
  assert.deepEqual(detectClaudeSurface({ CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' }).harness, 'claude-cli');
  assert.deepEqual(detectClaudeSurface({ CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }).harness, 'claude-cli');
  assert.deepEqual(
    detectClaudeSurface({ CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' }).harness,
    'claude-desktop'
  );
  assert.deepEqual(new Set(Object.values(CLAUDE_ENTRYPOINT_SURFACES)), new Set(['claude-cli', 'claude-desktop']));
});

test('surface detection fails loudly instead of guessing', () => {
  assert.equal(detectClaudeSurface({}).error, 'NOT_CLAUDE_CODE');
  assert.equal(detectClaudeSurface({ CLAUDECODE: '1' }).error, 'NO_ENTRYPOINT');
  const unknown = detectClaudeSurface({ CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'claude-vscode' });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error, 'UNKNOWN_SURFACE');
  assert.match(unknown.message, /claude-vscode/);
});

test('detect-surface prints one JSON line and exits nonzero on failure', () => {
  const env = { ...process.env, CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_EXECPATH: '' };
  const ok = spawnSync(process.execPath, [controlPath, 'detect-surface'], { encoding: 'utf8', env });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).harness, 'claude-cli');

  const bad = spawnSync(process.execPath, [controlPath, 'detect-surface'], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDECODE: '', CLAUDE_CODE_ENTRYPOINT: '' },
  });
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).ok, false);
});

test('dashboard URLs are valid file: URLs on every OS', () => {
  const file = path.join(os.tmpdir(), 'a dir', 'dashboard.html');
  const url = dashboardUrl(file);
  assert.match(url, /^file:\/\/\//);
  assert.ok(!url.includes('\\'), 'a file: URL never contains backslashes');
  assert.ok(url.includes('a%20dir'), 'spaces are percent-encoded');
  assert.equal(new URL(url).protocol, 'file:');
  assert.equal(dashboardUrl(null), null);
});

test('the browser opener uses each platform handler without a shell', () => {
  assert.deepEqual(browserOpener('file:///x', 'win32'), {
    command: 'rundll32.exe',
    args: ['url.dll,FileProtocolHandler', 'file:///x'],
  });
  assert.deepEqual(browserOpener('file:///x', 'darwin'), { command: 'open', args: ['file:///x'] });
  assert.deepEqual(browserOpener('file:///x', 'linux'), { command: 'xdg-open', args: ['file:///x'] });
});

test('open-dashboard renders on request and reports its URL (dry run)', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-open-dashboard-'));
  try {
    const now = new Date().toISOString();
    fs.writeFileSync(path.join(project, 'project.json'), `${JSON.stringify({
      schema_version: 1,
      slug: path.basename(project),
      title: 'Open dashboard',
      tier: 'trivial',
      status: 'active',
      phase: 'INTAKE',
      created_at: now,
      updated_at: now,
      artifacts: {},
    }, null, 2)}\n`);
    const result = openDashboard(project, { dryRun: true, platform: 'linux' });
    assert.equal(result.ok, true);
    assert.equal(result.opened, false);
    assert.ok(fs.existsSync(result.dashboard_path));
    assert.equal(result.url, dashboardUrl(result.dashboard_path));
    assert.deepEqual(result.opener, { command: 'xdg-open', args: [result.url] });
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('open-dashboard without project state reports instead of throwing', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), '10x-squad-open-empty-'));
  try {
    const result = openDashboard(empty, { dryRun: true });
    assert.deepEqual(result, { ok: false, opened: false, url: null, reason: 'NO_PROJECT_STATE' });
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});
