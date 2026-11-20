#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { summarizeUsageEvents } = require('../assets/runtime/cost-recorder.js');

const USAGE_MARKER = '"type":"session.usage_record"';
const EMPTY = {
  credits: null,
  credits_by_persona: null,
  peak_context_tokens: null,
  surcharge_credits: null,
  compactions: null,
  follow_ups: null,
  cost_source: 'none',
};

function containsUsage(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return false;
  }
  try {
    const buffer = Buffer.allocUnsafe(1 << 20);
    let carry = '';
    let bytes;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      const text = carry + buffer.toString('utf8', 0, bytes);
      if (text.includes(USAGE_MARKER)) return true;
      carry = text.slice(-USAGE_MARKER.length);
    }
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

// The session id appears on the first events; do not read a multi-hundred-MB log for it.
function sessionIdFromEvents(filePath) {
  let head;
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(256 * 1024);
      head = buffer.toString('utf8', 0, fs.readSync(fd, buffer, 0, buffer.length, 0));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  for (const line of head.split(/\r?\n/)) {
    if (!line.includes('sessionId')) continue;
    try {
      const event = JSON.parse(line);
      const id = event.sessionId || (event.data && event.data.sessionId);
      if (typeof id === 'string' && id) return id;
    } catch {}
  }
  return null;
}

function sessionStateRoot({ env = process.env, homeDir = os.homedir() } = {}) {
  return env.COPILOT_HOME
    ? path.join(env.COPILOT_HOME, 'session-state')
    : path.join(homeDir, '.copilot', 'session-state');
}

function readFirstLine(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(16384);
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.toString('utf8', 0, bytes).split('\n', 1)[0];
  } finally {
    fs.closeSync(fd);
  }
}

// A session started inside the run window whose recorded cwd is the run's workdir.
function findSessionLogByWorkdir({ workdir, startedMs, finishedMs, env, homeDir }) {
  const root = sessionStateRoot({ env, homeDir });
  if (!workdir || !fs.existsSync(root)) return null;
  const wanted = new Set([path.resolve(workdir)]);
  try {
    wanted.add(fs.realpathSync(workdir));
  } catch {}

  const matches = [];
  for (const entry of fs.readdirSync(root)) {
    const logPath = path.join(root, entry, 'events.jsonl');
    let stat;
    try {
      stat = fs.statSync(logPath);
    } catch {
      continue;
    }
    if (startedMs && stat.mtimeMs < startedMs) continue;
    try {
      const start = JSON.parse(readFirstLine(logPath));
      const data = start.data || {};
      const cwd = data.context && data.context.cwd;
      const startTime = Date.parse(data.startTime);
      if (!cwd || !wanted.has(path.resolve(cwd))) continue;
      if (startedMs && startTime < startedMs - 5000) continue;
      if (finishedMs && startTime > finishedMs) continue;
      matches.push({ logPath, startTime });
    } catch {}
  }
  matches.sort((a, b) => a.startTime - b.startTime);
  return matches.length ? matches[0].logPath : null;
}

function locateLog(options) {
  if (options.events && containsUsage(options.events)) {
    return { logPath: options.events, source: 'stdout' };
  }
  const sessionId = options.events ? sessionIdFromEvents(options.events) : null;
  if (sessionId) {
    const candidate = path.join(sessionStateRoot(options), sessionId, 'events.jsonl');
    if (fs.existsSync(candidate)) return { logPath: candidate, source: 'session-log' };
  }
  const byWorkdir = findSessionLogByWorkdir(options);
  return byWorkdir ? { logPath: byWorkdir, source: 'session-log' } : null;
}

function byPersona(rows) {
  const totals = new Map();
  for (const row of rows) totals.set(row.persona, (totals.get(row.persona) || 0) + row.credits);
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([persona, credits]) => `${persona}=${credits.toFixed(1)}`)
    .join(';');
}

function costColumns(options = {}) {
  const located = locateLog(options);
  if (!located) return { ...EMPTY };
  let summary;
  try {
    summary = summarizeUsageEvents(located.logPath);
  } catch {
    return { ...EMPTY };
  }
  if (summary.rows.length === 0) return { ...EMPTY };
  const { rows, totals } = summary;
  return {
    credits: Number(totals.credits.toFixed(3)),
    credits_by_persona: byPersona(rows),
    peak_context_tokens: rows.reduce((max, row) => Math.max(max, row.peak_context_tokens), 0),
    surcharge_credits: Number(totals.premium_surcharge_credits.toFixed(3)),
    compactions: rows.reduce((sum, row) => sum + row.compactions, 0),
    follow_ups: totals.follow_up_prompts,
    cost_source: located.source,
  };
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('options must be --name value pairs');
    }
    options[key.slice(2)] = value;
  }
  return options;
}

function main(argv) {
  try {
    const raw = parseArgs(argv.slice(2));
    const result = costColumns({
      events: raw.events,
      workdir: raw.workdir,
      startedMs: raw['started-ms'] ? Number(raw['started-ms']) : undefined,
      finishedMs: raw['finished-ms'] ? Number(raw['finished-ms']) : undefined,
    });
    console.log(JSON.stringify(result));
    return 0;
  } catch (error) {
    console.error(`cost-columns failed: ${error.message}`);
    return 2;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv);
}

module.exports = { EMPTY, costColumns, findSessionLogByWorkdir, locateLog, sessionIdFromEvents };
