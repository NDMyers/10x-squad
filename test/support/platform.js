'use strict';

// Cross-platform helpers for tests that need a POSIX shell, a symlink, or an
// isolated home directory. Windows ships `bash.exe` in System32 (the WSL
// launcher), which cannot read Windows paths, so a bare `bash` is not usable.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let cachedShell;

function gitBashCandidates() {
  const candidates = [];
  if (process.env.TENX_BASH) candidates.push(process.env.TENX_BASH);
  const execPath = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
  if (execPath.status === 0) {
    // <git>/mingw64/libexec/git-core -> <git>/bin/bash.exe
    const gitRoot = path.resolve(execPath.stdout.trim(), '..', '..', '..');
    candidates.push(path.join(gitRoot, 'bin', 'bash.exe'), path.join(gitRoot, 'usr', 'bin', 'bash.exe'));
  }
  for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]) {
    if (base) candidates.push(path.join(base, 'Git', 'bin', 'bash.exe'), path.join(base, 'Programs', 'Git', 'bin', 'bash.exe'));
  }
  return candidates;
}

/** Absolute path of a bash that understands this OS's paths, or null. */
function posixShell() {
  if (cachedShell !== undefined) return cachedShell;
  if (process.platform !== 'win32') {
    cachedShell = process.env.TENX_BASH || 'bash';
    return cachedShell;
  }
  cachedShell = gitBashCandidates().find((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  }) || null;
  return cachedShell;
}

/** Skip option for node:test when no usable POSIX shell exists. */
function requiresPosixShell() {
  return posixShell() ? false : 'no POSIX shell (install Git for Windows or set TENX_BASH)';
}

/**
 * Create a symlink, or skip the current test when the OS refuses (Windows
 * without Developer Mode or elevation). Returns false after skipping.
 */
function symlinkOrSkip(t, target, linkPath, type) {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch (error) {
    if (process.platform === 'win32' && (error.code === 'EPERM' || error.code === 'EACCES')) {
      t.skip('symlink creation requires Developer Mode or elevation on Windows');
      return false;
    }
    throw error;
  }
}

/** Environment overrides that redirect os.homedir() on every OS. */
function homeEnv(home) {
  return { HOME: home, USERPROFILE: home };
}

module.exports = { posixShell, requiresPosixShell, symlinkOrSkip, homeEnv };
