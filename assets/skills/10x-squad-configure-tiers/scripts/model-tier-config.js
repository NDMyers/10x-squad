#!/usr/bin/env node
'use strict';

// Deterministic work-tier model routing engine for the 10x Squad.
//
// Owns configuration precedence, schema validation, and resolution. Vivaldi
// consumes only the `resolve` subprocess contract (single JSON object on
// stdout, stable exit codes); the configure-tiers skill uses the profile
// commands. Dependency-free by design: this file must run on a bare Node 20+
// with no npm install step, because it executes inside installed workspaces.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA_VERSION = 2;
const READABLE_SCHEMA_VERSIONS = new Set([1, 2]);
const TIER_KEYS = ['trivial', 'lite', 'standard_clear', 'standard_ambiguous', 'complex'];
const CONFIG_FIELDS = new Set(['schema_version', 'updated_at', 'harnesses']);
const PROFILE_FIELDS = new Set(['assignments', 'dispatch_settings', 'model_checks']);
const DISPATCH_SETTING_FIELDS = new Set(['reasoning_effort', 'context_tier']);

// Per-harness runtime-setting vocabulary. A harness absent from this map allows
// only `auto`/`auto` — the safe posture for a surface whose dispatch contract
// has not been verified (this is how copilot-vscode behaves). Per-MODEL
// reasoning-effort legality (e.g. gpt-5.5 rejecting `ultra`) is a live-catalog
// fact, NOT encoded here: the dependency-free engine never hardcodes model
// facts. That check lives in the configure-tiers skill against the acquired
// catalog and is finally enforced by the harness at spawn time (fail-loud).
// See docs/codex-harness-spike.md (C7/C9) and references/model-resolution.md.
const HARNESS_DISPATCH_CAPABILITIES = {
  'copilot-cli': {
    reasoning_effort: new Set(['auto', 'low', 'medium', 'high', 'xhigh']),
    context_tier: new Set(['auto', 'default', 'long_context']),
  },
  'codex-cli': {
    reasoning_effort: new Set(['auto', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']),
    context_tier: new Set(['auto']),
  },
  // Same vocabulary as codex-cli, established from codex-app's own evidence
  // (Probe F) rather than copied: its spawn tool takes model + reasoning_effort
  // and no context parameter, and its catalog reports the same effort levels.
  // Separate key because the surfaces run different engine builds and their
  // spawnable sets drift independently (docs/codex-harness-spike.md, Probe I1).
  'codex-app': {
    reasoning_effort: new Set(['auto', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']),
    context_tier: new Set(['auto']),
  },
};
const DEFAULT_DISPATCH_CAPABILITY = {
  reasoning_effort: new Set(['auto']),
  context_tier: new Set(['auto']),
};

function dispatchCapability(harness) {
  // Object.hasOwn, not a bare lookup: a harness literally named "__proto__" (or
  // another inherited key) must fall through to the default, not resolve to
  // Object.prototype.
  return typeof harness === 'string' && Object.hasOwn(HARNESS_DISPATCH_CAPABILITIES, harness)
    ? HARNESS_DISPATCH_CAPABILITIES[harness]
    : DEFAULT_DISPATCH_CAPABILITY;
}
const CHECK_FIELDS = new Set(['display_name', 'status', 'method', 'source', 'checked_at']);
const CHECK_STATUSES = new Set(['verified', 'unverified']);
const CREDENTIAL_FIELD = /^(api[_-]?key|token|secret|password|passphrase|authorization|bearer|credentials?)$/i;

const CONFIGURE_HINT = 'Run /10x-squad-configure-tiers to configure work-tier model assignments.';

// Exit codes (stable contract consumed by Vivaldi — do not renumber):
// 0 resolved · 2 missing/corrupt/incomplete configuration or invalid input ·
// 3 active harness profile missing · 4 invalid tier · 5 I/O or internal failure.
const EXIT = { OK: 0, CONFIG: 2, HARNESS: 3, TIER: 4, IO: 5 };

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function defineOwnDataProperty(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function hasOwnHarness(config, harness) {
  return Boolean(
    config
    && isPlainObject(config.harnesses)
    && Object.hasOwn(config.harnesses, harness)
  );
}

function ownHarnessProfile(config, harness) {
  return hasOwnHarness(config, harness) ? config.harnesses[harness] : undefined;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isForbiddenAssignment(value) {
  if (typeof value !== 'string') return false;
  return /^(?:auto|inherit)(?:\s*\([^)]*\))?$/iu.test(value.trim());
}

function fieldError(where, field) {
  const kind = CREDENTIAL_FIELD.test(field) ? 'credential-shaped field' : 'unknown field';
  return `${where}: ${kind} ${JSON.stringify(field)} is not allowed`;
}

function validateDispatchSettings(dispatchSettings, { where = 'dispatch_settings', harness } = {}) {
  const errors = [];
  if (!isPlainObject(dispatchSettings)) {
    return [`${where} must be an object with exactly the five canonical tier keys`];
  }

  const cap = dispatchCapability(harness);
  const forHarness = `for harness ${JSON.stringify(harness ?? 'unknown')}`;
  for (const tier of TIER_KEYS) {
    if (!Object.hasOwn(dispatchSettings, tier)) {
      errors.push(`${where}: missing canonical tier key ${JSON.stringify(tier)}`);
      continue;
    }
    const setting = dispatchSettings[tier];
    if (!isPlainObject(setting)) {
      errors.push(`${where}.${tier}: setting must be an object`);
      continue;
    }
    for (const field of Object.keys(setting)) {
      if (!DISPATCH_SETTING_FIELDS.has(field)) errors.push(fieldError(`${where}.${tier}`, field));
    }
    if (!Object.hasOwn(setting, 'reasoning_effort') || !cap.reasoning_effort.has(setting.reasoning_effort)) {
      errors.push(`${where}.${tier}.reasoning_effort must be one of ${[...cap.reasoning_effort].join(', ')} ${forHarness}`);
    }
    if (!Object.hasOwn(setting, 'context_tier') || !cap.context_tier.has(setting.context_tier)) {
      errors.push(`${where}.${tier}.context_tier must be one of ${[...cap.context_tier].join(', ')} ${forHarness}`);
    }
  }
  for (const key of Object.keys(dispatchSettings)) {
    if (!TIER_KEYS.includes(key)) errors.push(fieldError(where, key));
  }
  return errors;
}

// Validates a single-harness proposal
// ({assignments, dispatch_settings?, model_checks?}) with the strict field
// allowlist. Values are opaque and never scanned for secret-like text; only
// field NAMES are policed.
function validateProfile(profile, { harness } = {}) {
  const errors = [];
  if (!isPlainObject(profile)) {
    return { ok: false, errors: ['profile must be a JSON object'] };
  }
  for (const field of Object.keys(profile)) {
    if (!PROFILE_FIELDS.has(field)) errors.push(fieldError('profile', field));
  }

  const a = Object.hasOwn(profile, 'assignments') ? profile.assignments : undefined;
  if (!isPlainObject(a)) {
    errors.push('assignments must be an object with exactly the five canonical tier keys');
  } else {
    for (const tier of TIER_KEYS) {
      if (!Object.hasOwn(a, tier)) {
        errors.push(`assignments: missing canonical tier key ${JSON.stringify(tier)}`);
        continue;
      }
      const v = a[tier];
      if (typeof v !== 'string' || v.trim() === '') {
        errors.push(`assignments.${tier}: value must be a non-empty exact model identifier, got ${JSON.stringify(v)}`);
      } else if (isForbiddenAssignment(v)) {
        errors.push(`assignments.${tier}: ${JSON.stringify(v)} is not an exact model identifier (auto/inherit are banned)`);
      }
    }
    for (const key of Object.keys(a)) {
      if (!TIER_KEYS.includes(key)) {
        errors.push(`assignments: unknown tier key ${JSON.stringify(key)}; canonical keys are ${TIER_KEYS.join(', ')}`);
      }
    }
  }

  if (Object.hasOwn(profile, 'dispatch_settings')) {
    errors.push(...validateDispatchSettings(profile.dispatch_settings, { harness }));
  }

  if (Object.hasOwn(profile, 'model_checks')) {
    const mc = profile.model_checks;
    if (!isPlainObject(mc)) {
      errors.push('model_checks must be an object keyed by exact assignment value');
    } else {
      for (const [key, entry] of Object.entries(mc)) {
        if (!isPlainObject(entry)) {
          errors.push(`model_checks[${JSON.stringify(key)}]: entry must be an object`);
          continue;
        }
        for (const field of Object.keys(entry)) {
          if (!CHECK_FIELDS.has(field)) errors.push(fieldError(`model_checks[${JSON.stringify(key)}]`, field));
        }
        if (!CHECK_STATUSES.has(entry.status)) {
          errors.push(`model_checks[${JSON.stringify(key)}].status must be "verified" or "unverified"`);
        }
        for (const field of ['display_name', 'method', 'source', 'checked_at']) {
          if (Object.hasOwn(entry, field) && typeof entry[field] !== 'string') {
            errors.push(`model_checks[${JSON.stringify(key)}].${field} must be a string`);
          }
        }
      }
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}

// Validates a whole stored config file. Assignments are strict (they are the
// executable routing source); model_checks entries are advisory at read time
// and unusable entries degrade to "unverified" instead of invalidating the
// file (see usableCheckStatus).
function validateConfigShape(cfg) {
  const errors = [];
  if (!isPlainObject(cfg)) return { ok: false, errors: ['configuration must be a JSON object'] };
  for (const field of Object.keys(cfg)) {
    if (!CONFIG_FIELDS.has(field)) errors.push(fieldError('config', field));
  }
  if (!READABLE_SCHEMA_VERSIONS.has(cfg.schema_version)) {
    errors.push(`schema_version must be one of ${[...READABLE_SCHEMA_VERSIONS].join(', ')}, got ${JSON.stringify(cfg.schema_version)}`);
  }
  if (typeof cfg.updated_at !== 'string') {
    errors.push('updated_at must be an ISO timestamp string');
  }
  if (!isPlainObject(cfg.harnesses)) {
    errors.push('harnesses must be an object keyed by surface');
    return { ok: false, errors };
  }
  for (const [harness, profile] of Object.entries(cfg.harnesses)) {
    if (!isPlainObject(profile)) {
      errors.push(`harnesses.${harness}: profile must be an object`);
      continue;
    }
    for (const field of Object.keys(profile)) {
      if (!PROFILE_FIELDS.has(field)) errors.push(fieldError(`harnesses.${harness}`, field));
    }
    const a = Object.hasOwn(profile, 'assignments') ? profile.assignments : undefined;
    if (!isPlainObject(a)) {
      errors.push(`harnesses.${harness}.assignments must be an object`);
      continue;
    }
    for (const tier of TIER_KEYS) {
      const v = a[tier];
      if (!Object.hasOwn(a, tier) || typeof v !== 'string' || v.trim() === '' || isForbiddenAssignment(v)) {
        errors.push(`harnesses.${harness}.assignments.${tier}: missing or invalid exact model identifier`);
      }
    }
    for (const key of Object.keys(a)) {
      if (!TIER_KEYS.includes(key)) errors.push(`harnesses.${harness}.assignments: unknown tier key ${JSON.stringify(key)}`);
    }
    if (Object.hasOwn(profile, 'dispatch_settings')) {
      if (cfg.schema_version === 1) {
        errors.push(`harnesses.${harness}.dispatch_settings is not allowed in schema version 1`);
      } else {
        errors.push(...validateDispatchSettings(profile.dispatch_settings, {
          where: `harnesses.${harness}.dispatch_settings`,
          harness,
        }));
      }
    }
    if (Object.hasOwn(profile, 'model_checks') && !isPlainObject(profile.model_checks)) {
      errors.push(`harnesses.${harness}.model_checks must be an object`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

// Advisory metadata: an entry counts as usable verification evidence only if
// it is well-formed; anything else reads as "unverified" without failing the
// resolve. No time-based expiry — checked_at is informational.
function usableCheckStatus(profile, model) {
  const checks = profile
    && Object.hasOwn(profile, 'model_checks')
    && isPlainObject(profile.model_checks)
    ? profile.model_checks
    : undefined;
  const entry = checks && Object.hasOwn(checks, model) ? checks[model] : undefined;
  if (!isPlainObject(entry)) return 'unverified';
  for (const field of Object.keys(entry)) {
    if (!CHECK_FIELDS.has(field)) return 'unverified';
  }
  return CHECK_STATUSES.has(entry.status) ? entry.status : 'unverified';
}

function automaticDispatchSetting() {
  return { reasoning_effort: 'auto', context_tier: 'auto' };
}

function dispatchSettingFor(profile, tier) {
  const settings = isPlainObject(profile)
    && Object.hasOwn(profile, 'dispatch_settings')
    && isPlainObject(profile.dispatch_settings)
    ? profile.dispatch_settings
    : undefined;
  const setting = settings && Object.hasOwn(settings, tier) ? settings[tier] : undefined;
  return isPlainObject(setting)
    ? { reasoning_effort: setting.reasoning_effort, context_tier: setting.context_tier }
    : automaticDispatchSetting();
}

function effectiveDispatchSettings(profile) {
  return Object.fromEntries(TIER_KEYS.map((tier) => [tier, dispatchSettingFor(profile, tier)]));
}

// ---------------------------------------------------------------------------
// Expansion, mutation
// ---------------------------------------------------------------------------

function expandDefaultAll(modelId) {
  if (typeof modelId !== 'string' || modelId.trim() === '') {
    throw new Error('default-all requires a non-empty exact model identifier');
  }
  const assignments = {};
  for (const tier of TIER_KEYS) assignments[tier] = modelId;
  return assignments;
}

function normalizeProfile(profile) {
  const stored = {
    assignments: { ...profile.assignments },
    dispatch_settings: effectiveDispatchSettings(profile),
  };
  if (
    Object.hasOwn(profile, 'model_checks')
    && isPlainObject(profile.model_checks)
    && Object.keys(profile.model_checks).length > 0
  ) {
    stored.model_checks = structuredClone(profile.model_checks);
  }
  return stored;
}

function upsertProfile(config, harness, profile, nowIso) {
  if (typeof harness !== 'string' || harness.trim() === '') {
    throw new Error('harness must be a non-empty surface key');
  }
  const check = validateProfile(profile, { harness });
  if (!check.ok) throw new Error(`invalid profile: ${check.errors.join('; ')}`);
  const base = config
    ? structuredClone(config)
    : { schema_version: SCHEMA_VERSION, updated_at: nowIso, harnesses: {} };
  base.schema_version = SCHEMA_VERSION;
  base.updated_at = nowIso;
  defineOwnDataProperty(base.harnesses, harness, normalizeProfile(profile));
  return base;
}

function removeProfile(config, harness, nowIso = new Date().toISOString()) {
  const base = structuredClone(config);
  if (!isPlainObject(base.harnesses) || !Object.hasOwn(base.harnesses, harness)) {
    return { config: base, removed: false };
  }
  delete base.harnesses[harness];
  if (Object.keys(base.harnesses).length === 0) {
    return { config: null, removed: true }; // caller deletes the file, directory stays
  }
  base.schema_version = SCHEMA_VERSION;
  base.updated_at = nowIso;
  return { config: base, removed: true };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function effectiveProfile({ workspaceConfig, globalConfig, harness }) {
  const ws = ownHarnessProfile(workspaceConfig, harness);
  if (ws) return { scope: 'workspace', schema_version: workspaceConfig.schema_version, profile: ws };
  const glob = ownHarnessProfile(globalConfig, harness);
  if (glob) return { scope: 'global', schema_version: globalConfig.schema_version, profile: glob };
  return null;
}

function resolve({ workspaceConfig, globalConfig, harness, tier }) {
  if (!TIER_KEYS.includes(tier)) {
    return {
      ok: false,
      code: EXIT.TIER,
      message: `Invalid tier ${JSON.stringify(tier)}. Canonical keys: ${TIER_KEYS.join(', ')}.`,
    };
  }
  if (!workspaceConfig && !globalConfig) {
    return {
      ok: false,
      code: EXIT.CONFIG,
      message: `No model-routing configuration found. ${CONFIGURE_HINT}`,
    };
  }
  const hit = effectiveProfile({ workspaceConfig, globalConfig, harness });
  if (!hit) {
    return {
      ok: false,
      code: EXIT.HARNESS,
      message: `No profile for harness ${JSON.stringify(harness)} in workspace or global configuration. ${CONFIGURE_HINT}`,
    };
  }
  const model = hit.profile.assignments[tier];
  const dispatchSetting = dispatchSettingFor(hit.profile, tier);
  return {
    ok: true,
    schema_version: hit.schema_version,
    scope: hit.scope,
    harness,
    tier,
    model,
    check_status: usableCheckStatus(hit.profile, model),
    ...dispatchSetting,
  };
}

// ---------------------------------------------------------------------------
// Paths and file I/O
// ---------------------------------------------------------------------------

function configPaths({ workspaceRoot, env = process.env, homedir = os.homedir() } = {}) {
  const xdg = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim() !== ''
    ? env.XDG_CONFIG_HOME
    : path.join(homedir, '.config');
  return {
    workspace: workspaceRoot ? path.join(workspaceRoot, '.10x-squad', 'model-routing.json') : null,
    global: path.join(xdg, '10x-squad', 'model-routing.json'),
  };
}

// → {status:'ok', config} | {status:'missing'} | {status:'corrupt', message} | {status:'io_error', message}
function readConfigFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { status: 'missing' };
    return { status: 'io_error', message: `${file}: ${err.message}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { status: 'corrupt', message: `${file}: not valid JSON (${err.message})` };
  }
  const shape = validateConfigShape(parsed);
  if (!shape.ok) return { status: 'corrupt', message: `${file}: ${shape.errors.join('; ')}` };
  return { status: 'ok', config: parsed };
}

function atomicWriteJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data = JSON.stringify(obj, null, 2) + '\n';
  JSON.parse(data); // serialization sanity check before touching the target
  const tmp = path.join(path.dirname(file), `.model-routing.tmp-${crypto.randomBytes(6).toString('hex')}`);
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = [
  'usage: model-tier-config.js <command> [flags]',
  '  validate-profile --input <profile.json> --harness <surface>',
  '  diff-profile     --input <profile.json> --scope <global|workspace> --workspace-root <path> --harness <surface>',
  '  upsert-profile   --input <profile.json> --scope <global|workspace> --workspace-root <path> --harness <surface>',
  '  remove-profile   --scope workspace --workspace-root <path> --harness <surface> [--dry-run]',
  '  resolve          --workspace-root <path> --harness <surface> --tier <tier-key> [--json]',
].join('\n');

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument ${JSON.stringify(arg)}`);
    const name = arg.slice(2);
    if (name === 'dry-run' || name === 'json') {
      flags[name] = true;
    } else {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`flag --${name} requires a value`);
      flags[name] = value;
      i += 1;
    }
  }
  return flags;
}

function fail(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function require_(flags, names) {
  for (const name of names) {
    if (!flags[name]) fail(EXIT.CONFIG, `Missing required flag --${name}.\n${USAGE}`);
  }
}

function readProposal(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    fail(err.code === 'ENOENT' ? EXIT.CONFIG : EXIT.IO, `Cannot read proposal ${file}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(EXIT.CONFIG, `Proposal ${file} is not valid JSON: ${err.message}`);
  }
  return undefined; // unreachable
}

// Reads one config file for CLI use, mapping read problems to exit codes.
function readOrFail(file) {
  const res = readConfigFile(file);
  if (res.status === 'io_error') fail(EXIT.IO, `I/O failure reading configuration: ${res.message}`);
  if (res.status === 'corrupt') fail(EXIT.CONFIG, `Corrupt configuration: ${res.message} ${CONFIGURE_HINT}`);
  return res.status === 'ok' ? res.config : null;
}

function scopeFile(flags, paths) {
  if (flags.scope !== 'global' && flags.scope !== 'workspace') {
    fail(EXIT.CONFIG, `--scope must be "global" or "workspace".\n${USAGE}`);
  }
  if (flags.scope === 'workspace' && !paths.workspace) {
    fail(EXIT.CONFIG, '--workspace-root is required for workspace scope.');
  }
  return flags.scope === 'workspace' ? paths.workspace : paths.global;
}

function cmdValidateProfile(flags) {
  require_(flags, ['input', 'harness']);
  const proposal = readProposal(flags.input);
  const res = validateProfile(proposal, { harness: flags.harness });
  if (!res.ok) fail(EXIT.CONFIG, `Invalid profile for ${flags.harness}: ${res.errors.join('; ')}`);
  emit({ ok: true, harness: flags.harness });
  process.exit(EXIT.OK);
}

function cmdDiffProfile(flags) {
  require_(flags, ['input', 'scope', 'harness']);
  const paths = configPaths({ workspaceRoot: flags['workspace-root'] });
  const target = scopeFile(flags, paths);
  const proposal = readProposal(flags.input);
  const check = validateProfile(proposal, { harness: flags.harness });
  if (!check.ok) fail(EXIT.CONFIG, `Invalid profile for ${flags.harness}: ${check.errors.join('; ')}`);

  const targetCfg = readOrFail(target);
  const wsCfg = paths.workspace && paths.workspace !== target ? readOrFail(paths.workspace) : null;
  const globalCfg = paths.global !== target ? readOrFail(paths.global) : null;

  const after = upsertProfile(targetCfg, flags.harness, proposal, new Date().toISOString());
  const afterProfile = ownHarnessProfile(after, flags.harness);
  const simulated = effectiveProfile({
    workspaceConfig: flags.scope === 'workspace' ? after : wsCfg,
    globalConfig: flags.scope === 'global' ? after : globalCfg,
    harness: flags.harness,
  });

  emit({
    scope: flags.scope,
    harness: flags.harness,
    path: target,
    stored_before: ownHarnessProfile(targetCfg, flags.harness) || null,
    stored_after: afterProfile,
    effective_after: simulated ? { ...simulated.profile.assignments } : null,
    effective_dispatch_settings_after: simulated ? effectiveDispatchSettings(simulated.profile) : null,
  });
  process.exit(EXIT.OK);
}

function cmdUpsertProfile(flags) {
  require_(flags, ['input', 'scope', 'harness']);
  const paths = configPaths({ workspaceRoot: flags['workspace-root'] });
  const target = scopeFile(flags, paths);
  const proposal = readProposal(flags.input);
  const check = validateProfile(proposal, { harness: flags.harness });
  if (!check.ok) fail(EXIT.CONFIG, `Invalid profile for ${flags.harness}: ${check.errors.join('; ')}`);

  const existing = readOrFail(target);
  const workspaceConfig = flags.scope === 'global' && paths.workspace
    ? readOrFail(paths.workspace)
    : null;
  const next = upsertProfile(existing, flags.harness, proposal, new Date().toISOString());
  const simulated = effectiveProfile({
    workspaceConfig: flags.scope === 'workspace' ? next : workspaceConfig,
    globalConfig: flags.scope === 'global' ? next : null,
    harness: flags.harness,
  });
  try {
    atomicWriteJson(target, next);
  } catch (err) {
    fail(EXIT.IO, `Failed to write ${target}: ${err.message}`);
  }
  emit({
    ok: true,
    scope: flags.scope,
    harness: flags.harness,
    path: target,
    effective_after: { ...simulated.profile.assignments },
    effective_dispatch_settings_after: effectiveDispatchSettings(simulated.profile),
  });
  process.exit(EXIT.OK);
}

function cmdRemoveProfile(flags) {
  require_(flags, ['scope', 'harness']);
  if (flags.scope !== 'workspace') {
    fail(EXIT.CONFIG, 'remove-profile supports --scope workspace only.');
  }
  const paths = configPaths({ workspaceRoot: flags['workspace-root'] });
  if (!paths.workspace) fail(EXIT.CONFIG, '--workspace-root is required for workspace scope.');
  const existing = readOrFail(paths.workspace);
  const found = hasOwnHarness(existing, flags.harness);

  if (flags['dry-run']) {
    const remaining = existing ? Object.keys(existing.harnesses).filter((h) => h !== flags.harness) : [];
    emit({
      dry_run: true,
      scope: 'workspace',
      harness: flags.harness,
      found,
      would_delete_file: found && remaining.length === 0,
      remaining_harnesses: remaining,
    });
    process.exit(EXIT.OK);
  }

  if (!found) {
    fail(EXIT.HARNESS, `No workspace profile for harness ${JSON.stringify(flags.harness)} to remove.`);
  }
  const { config: next } = removeProfile(existing, flags.harness, new Date().toISOString());
  if (next === null) {
    try {
      fs.unlinkSync(paths.workspace); // .10x-squad directory is left intact
    } catch (err) {
      fail(EXIT.IO, `Failed to delete ${paths.workspace}: ${err.message}`);
    }
    emit({ ok: true, removed: true, deleted_file: true, harness: flags.harness });
  } else {
    try {
      atomicWriteJson(paths.workspace, next);
    } catch (err) {
      fail(EXIT.IO, `Failed to write ${paths.workspace}: ${err.message}`);
    }
    emit({ ok: true, removed: true, deleted_file: false, harness: flags.harness });
  }
  process.exit(EXIT.OK);
}

function cmdResolve(flags) {
  require_(flags, ['harness', 'tier']);
  const paths = configPaths({ workspaceRoot: flags['workspace-root'] });
  const workspaceConfig = paths.workspace ? readOrFail(paths.workspace) : null;
  const globalConfig = readOrFail(paths.global);
  const res = resolve({ workspaceConfig, globalConfig, harness: flags.harness, tier: flags.tier });
  if (!res.ok) fail(res.code, res.message);
  emit(res);
  process.exit(EXIT.OK);
}

const COMMANDS = {
  'validate-profile': cmdValidateProfile,
  'diff-profile': cmdDiffProfile,
  'upsert-profile': cmdUpsertProfile,
  'remove-profile': cmdRemoveProfile,
  resolve: cmdResolve,
};

function main(argv) {
  const [command, ...rest] = argv;
  const handler = COMMANDS[command];
  if (!handler) fail(EXIT.CONFIG, `Unknown command ${JSON.stringify(command ?? '')}.\n${USAGE}`);
  let flags;
  try {
    flags = parseFlags(rest);
  } catch (err) {
    fail(EXIT.CONFIG, `${err.message}\n${USAGE}`);
  }
  try {
    handler(flags);
  } catch (err) {
    fail(EXIT.IO, `Internal failure: ${err.message}`);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  SCHEMA_VERSION,
  TIER_KEYS,
  EXIT,
  expandDefaultAll,
  isForbiddenAssignment,
  validateProfile,
  validateConfigShape,
  usableCheckStatus,
  upsertProfile,
  removeProfile,
  effectiveProfile,
  resolve,
  configPaths,
  readConfigFile,
  atomicWriteJson,
};
