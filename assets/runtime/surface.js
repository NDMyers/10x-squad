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

module.exports = { CLAUDE_ENTRYPOINT_SURFACES, detectClaudeSurface };
