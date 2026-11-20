#!/usr/bin/env node
// Runs a command under a wall-clock cap and an optional credit cap.
//
//   guarded-run.js [--max-seconds N] [--max-credits N] [--events FILE] [--workdir DIR]
//                  [--marker FILE] [--interval-ms N] -- command [args...]
//
// The credit cap needs usage records: it reads them from the --events file when the
// harness streams them there, and otherwise from the Copilot session log whose cwd is
// --workdir. With neither, only the wall-clock cap is active. Exit 124 means the guard
// stopped the command, and the marker file records which cap fired.

'use strict';

const fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');
const { findSessionLogByWorkdir } = require('./cost-columns.js');

const USAGE_PREFIX = '{"type":"session.usage_record"';
const STOPPED_EXIT = 124;
const KILL_GRACE_MS = 10000;

class CreditTail {
  constructor(filePath) {
    this.filePath = filePath;
    this.offset = 0;
    this.carry = '';
    this.credits = 0;
  }

  poll() {
    let size;
    try {
      size = fs.statSync(this.filePath).size;
    } catch {
      return this.credits;
    }
    if (size < this.offset) {
      this.offset = 0;
      this.carry = '';
      this.credits = 0;
    }
    const fd = fs.openSync(this.filePath, 'r');
    try {
      const buffer = Buffer.allocUnsafe(1 << 20);
      let bytes;
      while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, this.offset)) > 0) {
        this.offset += bytes;
        const lines = (this.carry + buffer.toString('utf8', 0, bytes)).split('\n');
        this.carry = lines.pop();
        for (const line of lines) this.add(line);
      }
    } finally {
      fs.closeSync(fd);
    }
    return this.credits;
  }

  add(line) {
    if (!line.startsWith(USAGE_PREFIX)) return;
    try {
      const nano = JSON.parse(line).data.usage.copilotUsage.totalNanoAiu;
      if (Number.isFinite(nano)) this.credits += nano / 1e9;
    } catch {}
  }
}

function parseArgs(argv) {
  const separator = argv.indexOf('--');
  if (separator === -1 || separator === argv.length - 1) {
    throw new Error('usage: guarded-run.js [options] -- command [args...]');
  }
  const options = {};
  const flags = argv.slice(0, separator);
  for (let index = 0; index < flags.length; index += 2) {
    const key = flags[index];
    const value = flags[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error('options must be --name value pairs');
    options[key.slice(2)] = value;
  }
  return { options, command: argv.slice(separator + 1) };
}

function run({ options, command }) {
  const maxMs = options['max-seconds'] ? Number(options['max-seconds']) * 1000 : Infinity;
  const maxCredits = options['max-credits'] ? Number(options['max-credits']) : Infinity;
  const intervalMs = Number(options['interval-ms'] || 5000);
  const startedMs = Date.now();
  let stoppedBy = null;
  let detail = null;

  const isWindows = process.platform === 'win32';
  const child = spawn(command[0], command.slice(1), { stdio: 'inherit', detached: !isWindows });
  const stopGroup = (signal) => {
    if (isWindows) {
      if (child.exitCode !== null || child.signalCode !== null) return;
      // Windows has no process groups or POSIX signals; taskkill /T ends the whole tree.
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      return;
    }
    try {
      process.kill(-child.pid, signal);
    } catch {}
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stopGroup(signal));

  const stdoutTail = options.events && Number.isFinite(maxCredits) ? new CreditTail(options.events) : null;
  let sessionTail = null;

  const stop = (reason, text) => {
    if (stoppedBy) return;
    stoppedBy = reason;
    detail = text;
    stopGroup('SIGTERM');
    setTimeout(() => stopGroup('SIGKILL'), KILL_GRACE_MS).unref();
  };

  const timer = setInterval(() => {
    if (stoppedBy) return;
    const elapsed = Date.now() - startedMs;
    if (elapsed >= maxMs) {
      stop('wall_clock', `stopped after ${Math.round(elapsed / 1000)}s`);
      return;
    }
    if (!Number.isFinite(maxCredits)) return;
    let credits = stdoutTail ? stdoutTail.poll() : 0;
    if (credits === 0 && options.workdir) {
      if (!sessionTail) {
        const logPath = findSessionLogByWorkdir({ workdir: options.workdir, startedMs, finishedMs: undefined });
        if (logPath) sessionTail = new CreditTail(logPath);
      }
      if (sessionTail) credits = sessionTail.poll();
    }
    if (credits >= maxCredits) stop('credits', `stopped at ${credits.toFixed(1)} credits`);
  }, intervalMs);

  return new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      clearInterval(timer);
      if (stoppedBy && options.marker) {
        fs.writeFileSync(options.marker, `${JSON.stringify({ stopped_by: stoppedBy, detail })}\n`);
      }
      if (stoppedBy) resolve(STOPPED_EXIT);
      else if (code !== null) resolve(code);
      else resolve(128 + (signal === 'SIGINT' ? 2 : 15));
    });
    child.on('error', (error) => {
      clearInterval(timer);
      console.error(`guarded-run failed to start: ${error.message}`);
      resolve(127);
    });
  });
}

if (require.main === module) {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  run(parsed).then((code) => {
    process.exitCode = code;
  });
}

module.exports = { CreditTail, parseArgs, run };
