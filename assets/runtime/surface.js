'use strict';

// Runtime surface detection for Claude Code (docs/claude-code-harness-spike.md,
// C11). Claude Code exports CLAUDECODE=1 and CLAUDE_CODE_ENTRYPOINT into every
// shell it runs, on Windows, macOS and Linux alike, so the signal is read from
// the environment rather than from binary paths, versions or OS-specific
// install locations. An unknown entrypoint is a hard failure: resolving another
// surface's profile would be a silent mis-route.

// Entrypoint value -> routing surface key. Each row is backed by spike evidence;
// add a row only after probing that surface (never by analogy).
const CLAUDE_ENTRYPOINT_SURFACES = Object.freeze({
  cli: 'claude-cli', // interactive `claude` in a terminal
  'sdk-cli': 'claude-cli', // `claude -p` (print / headless) from a terminal or CI
  'claude-desktop': 'claude-desktop', // Claude desktop app, Code tab
});

function detectClaudeSurface(env = process.env) {
  const claudeCode = env.CLAUDECODE;
  const entrypoint = env.CLAUDE_CODE_ENTRYPOINT;
  const signals = {
    CLAUDECODE: claudeCode === undefined ? null : claudeCode,
    CLAUDE_CODE_ENTRYPOINT: entrypoint === undefined ? null : entrypoint,
  };

  if (claudeCode !== '1') {
    return {
      ok: false,
      error: 'NOT_CLAUDE_CODE',
      message: 'CLAUDECODE is not 1: this shell was not started by Claude Code.',
      signals,
    };
  }
  if (!entrypoint) {
    return {
      ok: false,
      error: 'NO_ENTRYPOINT',
      message: 'CLAUDE_CODE_ENTRYPOINT is unset; the surface cannot be determined.',
      signals,
    };
  }
  if (!Object.hasOwn(CLAUDE_ENTRYPOINT_SURFACES, entrypoint)) {
    return {
      ok: false,
      error: 'UNKNOWN_SURFACE',
      message: `Claude Code entrypoint "${entrypoint}" is not a verified 10x Squad surface. `
        + `Verified: ${Object.keys(CLAUDE_ENTRYPOINT_SURFACES).join(', ')}.`,
      signals,
    };
  }
  // Known limitation (spike Probe F): the CLI keeps an inherited
  // CLAUDE_CODE_ENTRYPOINT, so `claude` started from a shell inside the desktop
  // app reports claude-desktop. No environment signal separates that case
  // (CLAUDE_CODE_EXECPATH is set in both), so it is documented, not guessed at;
  // unset CLAUDE_CODE_ENTRYPOINT before launching a nested CLI.
  return { ok: true, harness: CLAUDE_ENTRYPOINT_SURFACES[entrypoint], signals };
}

// Antigravity data-dir basename -> routing surface key.
// Antigravity CLI (`agy`) exports ANTIGRAVITY_APP_DATA_DIR ending in `antigravity-cli`;
// Antigravity Desktop / IDE exports `antigravity` or `antigravity-ide`.
const ANTIGRAVITY_DATA_DIR_SURFACES = Object.freeze({
  'antigravity-cli': 'antigravity-cli',
  antigravity: 'antigravity-desktop',
  'antigravity-ide': 'antigravity-desktop',
});

function pathBasename(value) {
  const trimmed = String(value).replace(/[/\\]+$/, '');
  const parts = trimmed.split(/[/\\]+/).filter(Boolean);
  return (parts.at(-1) || '').toLowerCase();
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function hasAntigravitySignal(env = process.env) {
  return env.ANTIGRAVITY_AGENT === '1'
    || nonEmpty(env.ANTIGRAVITY_APP_DATA_DIR)
    || nonEmpty(env.ANTIGRAVITY_AGENTAPI_EXE)
    || nonEmpty(env.ANTIGRAVITY_CLI_ALIAS)
    || env.__CFBundleIdentifier === 'com.google.antigravity';
}

function detectAntigravitySurface(env = process.env) {
  const agent = env.ANTIGRAVITY_AGENT;
  const appDataDir = env.ANTIGRAVITY_APP_DATA_DIR;
  const agentApiExe = env.ANTIGRAVITY_AGENTAPI_EXE;
  const cliAlias = env.ANTIGRAVITY_CLI_ALIAS;
  const bundleId = env.__CFBundleIdentifier;
  const signals = {
    ANTIGRAVITY_AGENT: agent === undefined ? null : agent,
    ANTIGRAVITY_APP_DATA_DIR: appDataDir === undefined ? null : appDataDir,
    ANTIGRAVITY_AGENTAPI_EXE: agentApiExe === undefined ? null : agentApiExe,
    ANTIGRAVITY_CLI_ALIAS: cliAlias === undefined ? null : cliAlias,
    __CFBundleIdentifier: bundleId === undefined ? null : bundleId,
  };

  if (!hasAntigravitySignal(env)) {
    return {
      ok: false,
      error: 'NOT_ANTIGRAVITY',
      message: 'ANTIGRAVITY_AGENT is not 1: this shell was not started by Antigravity.',
      signals,
    };
  }

  if (nonEmpty(appDataDir)) {
    const base = pathBasename(appDataDir);
    if (Object.hasOwn(ANTIGRAVITY_DATA_DIR_SURFACES, base)) {
      return { ok: true, harness: ANTIGRAVITY_DATA_DIR_SURFACES[base], signals };
    }
    return {
      ok: false,
      error: 'UNKNOWN_SURFACE',
      message: `Antigravity data directory "${base}" is not a verified 10x Squad surface. `
        + `Verified: ${Object.keys(ANTIGRAVITY_DATA_DIR_SURFACES).join(', ')}.`,
      signals,
    };
  }

  if (nonEmpty(agentApiExe)) {
    const exeBase = pathBasename(agentApiExe);
    if (exeBase === 'agy' || exeBase === 'agy.exe') {
      return { ok: true, harness: 'antigravity-cli', signals };
    }
    if (agentApiExe.includes('Antigravity.app') || exeBase === 'language_server' || exeBase === 'language_server.exe') {
      return { ok: true, harness: 'antigravity-desktop', signals };
    }
  }

  if (bundleId === 'com.google.antigravity') {
    return { ok: true, harness: 'antigravity-desktop', signals };
  }

  if (nonEmpty(cliAlias)) {
    return { ok: true, harness: 'antigravity-cli', signals };
  }

  return {
    ok: false,
    error: 'NO_SURFACE_SIGNAL',
    message: 'ANTIGRAVITY_APP_DATA_DIR is unset; the Antigravity surface cannot be determined.',
    signals,
  };
}

function detectSurface(env = process.env, { family } = {}) {
  if (family === 'claude') {
    return detectClaudeSurface(env);
  }
  if (family === 'antigravity') {
    return detectAntigravitySurface(env);
  }
  if (family === undefined) {
    if (env.CLAUDECODE === '1' || nonEmpty(env.CLAUDE_CODE_ENTRYPOINT)) {
      return detectClaudeSurface(env);
    }
    if (hasAntigravitySignal(env)) {
      return detectAntigravitySurface(env);
    }
    return detectClaudeSurface(env);
  }
  throw new Error(`Unknown surface family: ${family}. Expected claude or antigravity.`);
}

module.exports = {
  ANTIGRAVITY_DATA_DIR_SURFACES,
  CLAUDE_ENTRYPOINT_SURFACES,
  detectAntigravitySurface,
  detectClaudeSurface,
  detectSurface,
};
