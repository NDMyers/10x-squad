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

const CONSTANTS = require('./routing-constants.js');

const SCHEMA_VERSION = 3;
const READABLE_SCHEMA_VERSIONS = new Set([1, 2, 3]);
// Schema 3 routes on a (persona, tier) coordinate: `assignments` and
// `dispatch_settings` become persona-major matrices. Versions 1 and 2 stay
// readable and broadcast their single tier row to every persona, so no existing
// install breaks. The stored `schema_version` is the ONLY version discriminator
// — never infer the shape by sniffing leaf types.
const MATRIX_SCHEMA_VERSION = 3;
const { TIER_KEYS, PERSONA_KEYS, ADVISORY_KEYS } = CONSTANTS;
const CONFIG_FIELDS = new Set(['schema_version', 'updated_at', 'harnesses']);
const PROFILE_FIELDS = new Set(['assignments', 'dispatch_settings', 'advisory', 'model_checks']);
const DISPATCH_SETTING_FIELDS = new Set(['reasoning_effort', 'context_tier']);
// Advisory entries carry no context_tier: no surface lets a session choose the
// context tier of its own parent, and offering the field would imply otherwise.
const ADVISORY_ENTRY_FIELDS = new Set(['model', 'reasoning_effort']);

// Per-harness runtime-setting vocabulary, wrapped for set membership from the
// canonical arrays in routing-constants.js. `new Set(array)` preserves insertion
// order, so the accepted-value lists in error messages stay byte-identical to
// the declared vocabulary.
function asCapability({ reasoning_effort, context_tier }) {
  return { reasoning_effort: new Set(reasoning_effort), context_tier: new Set(context_tier) };
}
const HARNESS_DISPATCH_CAPABILITIES = Object.fromEntries(
  Object.entries(CONSTANTS.HARNESS_DISPATCH_CAPABILITIES).map(([h, cap]) => [h, asCapability(cap)])
);
const DEFAULT_DISPATCH_CAPABILITY = asCapability(CONSTANTS.DEFAULT_DISPATCH_CAPABILITY);

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

// One persona's settings row: exactly the five canonical tiers. Under schema 1
// and 2 the profile carries a single unnamed row; under schema 3 it carries one
// per persona, and this is the shared leaf validator for both.
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

// Schema 3: one settings row per persona.
function validateDispatchSettingsMatrix(matrix, { where = 'dispatch_settings', harness } = {}) {
  if (!isPlainObject(matrix)) {
    return [`${where} must be an object with exactly the six canonical persona keys`];
  }
  const errors = [];
  for (const persona of PERSONA_KEYS) {
    if (!Object.hasOwn(matrix, persona)) {
      errors.push(`${where}: missing canonical persona key ${JSON.stringify(persona)}`);
      continue;
    }
    errors.push(...validateDispatchSettings(matrix[persona], { where: `${where}.${persona}`, harness }));
  }
  for (const key of Object.keys(matrix)) {
    if (!PERSONA_KEYS.includes(key)) errors.push(fieldError(where, key));
  }
  return errors;
}

// One persona's assignment row: exactly the five canonical tiers, each an exact
// model identifier.
function validateAssignmentRow(row, { where = 'assignments' } = {}) {
  if (!isPlainObject(row)) {
    return [`${where} must be an object with exactly the five canonical tier keys`];
  }
  const errors = [];
  for (const tier of TIER_KEYS) {
    if (!Object.hasOwn(row, tier)) {
      errors.push(`${where}: missing canonical tier key ${JSON.stringify(tier)}`);
      continue;
    }
    const v = row[tier];
    if (typeof v !== 'string' || v.trim() === '') {
      errors.push(`${where}.${tier}: value must be a non-empty exact model identifier, got ${JSON.stringify(v)}`);
    } else if (isForbiddenAssignment(v)) {
      errors.push(`${where}.${tier}: ${JSON.stringify(v)} is not an exact model identifier (auto/inherit are banned)`);
    }
  }
  for (const key of Object.keys(row)) {
    if (!TIER_KEYS.includes(key)) {
      errors.push(`${where}: unknown tier key ${JSON.stringify(key)}; canonical keys are ${TIER_KEYS.join(', ')}`);
    }
  }
  return errors;
}

// Schema 3: one assignment row per persona.
function validateAssignmentMatrix(matrix, { where = 'assignments' } = {}) {
  if (!isPlainObject(matrix)) {
    return [`${where} must be an object with exactly the six canonical persona keys`];
  }
  const errors = [];
  for (const persona of PERSONA_KEYS) {
    if (!Object.hasOwn(matrix, persona)) {
      errors.push(`${where}: missing canonical persona key ${JSON.stringify(persona)}`);
      continue;
    }
    errors.push(...validateAssignmentRow(matrix[persona], { where: `${where}.${persona}` }));
  }
  for (const key of Object.keys(matrix)) {
    if (!PERSONA_KEYS.includes(key)) {
      errors.push(`${where}: unknown persona key ${JSON.stringify(key)}; canonical keys are ${PERSONA_KEYS.join(', ')}`);
    }
  }
  return errors;
}

// Advisory rows are recommendations for a session the squad cannot actuate, so
// they are validated for shape but never probed and never enter `model_checks`.
// Optional throughout: absence is a legitimate configuration, not an error.
function validateAdvisory(advisory, { where = 'advisory', harness } = {}) {
  if (!isPlainObject(advisory)) {
    return [`${where} must be an object keyed by advisory role`];
  }
  const errors = [];
  const cap = dispatchCapability(harness);
  const forHarness = `for harness ${JSON.stringify(harness ?? 'unknown')}`;
  for (const role of ADVISORY_KEYS) {
    if (!Object.hasOwn(advisory, role)) {
      errors.push(`${where}: missing canonical advisory key ${JSON.stringify(role)}`);
      continue;
    }
    const row = advisory[role];
    if (!isPlainObject(row)) {
      errors.push(`${where}.${role} must be an object with exactly the five canonical tier keys`);
      continue;
    }
    for (const tier of TIER_KEYS) {
      if (!Object.hasOwn(row, tier)) {
        errors.push(`${where}.${role}: missing canonical tier key ${JSON.stringify(tier)}`);
        continue;
      }
      const entry = row[tier];
      if (!isPlainObject(entry)) {
        errors.push(`${where}.${role}.${tier}: entry must be an object`);
        continue;
      }
      for (const field of Object.keys(entry)) {
        if (!ADVISORY_ENTRY_FIELDS.has(field)) errors.push(fieldError(`${where}.${role}.${tier}`, field));
      }
      const model = entry.model;
      if (typeof model !== 'string' || model.trim() === '') {
        errors.push(`${where}.${role}.${tier}.model: value must be a non-empty exact model identifier, got ${JSON.stringify(model)}`);
      } else if (isForbiddenAssignment(model)) {
        errors.push(`${where}.${role}.${tier}.model: ${JSON.stringify(model)} is not an exact model identifier (auto/inherit are banned)`);
      }
      if (!Object.hasOwn(entry, 'reasoning_effort') || !cap.reasoning_effort.has(entry.reasoning_effort)) {
        errors.push(`${where}.${role}.${tier}.reasoning_effort must be one of ${[...cap.reasoning_effort].join(', ')} ${forHarness}`);
      }
    }
    for (const key of Object.keys(row)) {
      if (!TIER_KEYS.includes(key)) errors.push(fieldError(`${where}.${role}`, key));
    }
  }
  for (const key of Object.keys(advisory)) {
    if (!ADVISORY_KEYS.includes(key)) errors.push(fieldError(where, key));
  }
  return errors;
}

// Validates a single-harness proposal
// ({assignments, dispatch_settings?, advisory?, model_checks?}) with the strict
// field allowlist. Schema 3 only: proposals are always freshly built by the
// resolver's build-profile, so a legacy-shaped proposal is a stale artifact and
// failing it loudly is correct. Values are opaque and never scanned for
// secret-like text; only field NAMES are policed.
function validateProfile(profile, { harness } = {}) {
  const errors = [];
  if (!isPlainObject(profile)) {
    return { ok: false, errors: ['profile must be a JSON object'] };
  }
  for (const field of Object.keys(profile)) {
    if (!PROFILE_FIELDS.has(field)) errors.push(fieldError('profile', field));
  }

  const a = Object.hasOwn(profile, 'assignments') ? profile.assignments : undefined;
  errors.push(...validateAssignmentMatrix(a));

  if (Object.hasOwn(profile, 'dispatch_settings')) {
    errors.push(...validateDispatchSettingsMatrix(profile.dispatch_settings, { harness }));
  }

  if (Object.hasOwn(profile, 'advisory')) {
    errors.push(...validateAdvisory(profile.advisory, { harness }));
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

// Stored-file assignment check for one tier row. Deliberately terser than the
// proposal-side message: a corrupt stored file is reported to a user who is
// about to re-run configure, not to a builder debugging a proposal.
function storedAssignmentRowErrors(row, where) {
  const errors = [];
  for (const tier of TIER_KEYS) {
    const v = row[tier];
    if (!Object.hasOwn(row, tier) || typeof v !== 'string' || v.trim() === '' || isForbiddenAssignment(v)) {
      errors.push(`${where}.${tier}: missing or invalid exact model identifier`);
    }
  }
  return errors;
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
    const isMatrix = cfg.schema_version === MATRIX_SCHEMA_VERSION;
    const a = Object.hasOwn(profile, 'assignments') ? profile.assignments : undefined;
    if (!isPlainObject(a)) {
      errors.push(`harnesses.${harness}.assignments must be an object`);
      continue;
    }
    if (isMatrix) {
      for (const persona of PERSONA_KEYS) {
        if (!Object.hasOwn(a, persona) || !isPlainObject(a[persona])) {
          errors.push(`harnesses.${harness}.assignments.${persona}: missing or invalid persona row`);
          continue;
        }
        errors.push(...storedAssignmentRowErrors(a[persona], `harnesses.${harness}.assignments.${persona}`));
      }
      for (const key of Object.keys(a)) {
        if (!PERSONA_KEYS.includes(key)) {
          errors.push(`harnesses.${harness}.assignments: unknown persona key ${JSON.stringify(key)}`);
        }
      }
    } else {
      errors.push(...storedAssignmentRowErrors(a, `harnesses.${harness}.assignments`));
      for (const key of Object.keys(a)) {
        if (!TIER_KEYS.includes(key)) errors.push(`harnesses.${harness}.assignments: unknown tier key ${JSON.stringify(key)}`);
      }
    }
    if (Object.hasOwn(profile, 'dispatch_settings')) {
      if (cfg.schema_version === 1) {
        errors.push(`harnesses.${harness}.dispatch_settings is not allowed in schema version 1`);
      } else {
        const check = isMatrix ? validateDispatchSettingsMatrix : validateDispatchSettings;
        errors.push(...check(profile.dispatch_settings, {
          where: `harnesses.${harness}.dispatch_settings`,
          harness,
        }));
      }
    }
    // `advisory` is schema-3 only, rejected below 3 exactly as `dispatch_settings`
    // is rejected below 2.
    if (Object.hasOwn(profile, 'advisory')) {
      if (!isMatrix) {
        errors.push(`harnesses.${harness}.advisory is not allowed in schema version ${cfg.schema_version}`);
      } else {
        errors.push(...validateAdvisory(profile.advisory, {
          where: `harnesses.${harness}.advisory`,
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
  return Object.fromEntries(PERSONA_KEYS.map((persona) => [
    persona,
    Object.fromEntries(TIER_KEYS.map((tier) => [tier, dispatchSettingForCell(profile, persona, tier)])),
  ]));
}

// ---------------------------------------------------------------------------
// Expansion, mutation
// ---------------------------------------------------------------------------

// Schema 1 and 2 store one tier row shared by every persona. Broadcasting that
// row is exactly how those versions have always resolved, so the conversion is
// semantics-preserving — it is a change of shape, never of routing.
function broadcastTierRow(row) {
  const matrix = {};
  for (const persona of PERSONA_KEYS) {
    defineOwnDataProperty(matrix, persona, structuredClone(row));
  }
  return matrix;
}

// The single place a legacy profile becomes a matrix. Everything downstream of
// this reads one shape, so no other function needs a version check.
function normalizeProfileToMatrix(profile, schemaVersion) {
  if (schemaVersion === MATRIX_SCHEMA_VERSION) return profile;
  // Object.hasOwn throughout: an inherited `dispatch_settings` is not stored
  // data and must read as omitted, not as configuration.
  const normalized = { assignments: broadcastTierRow(profile.assignments) };
  if (Object.hasOwn(profile, 'dispatch_settings') && isPlainObject(profile.dispatch_settings)) {
    normalized.dispatch_settings = broadcastTierRow(profile.dispatch_settings);
  }
  if (Object.hasOwn(profile, 'model_checks') && isPlainObject(profile.model_checks)) {
    normalized.model_checks = profile.model_checks;
  }
  return normalized;
}

// Matrix-shaped settings lookup for one (persona, tier) cell. Keeps the v1
// fallback: a profile that stored no settings at all resolves to auto/auto.
function dispatchSettingForCell(profile, persona, tier) {
  const settings = isPlainObject(profile)
    && Object.hasOwn(profile, 'dispatch_settings')
    && isPlainObject(profile.dispatch_settings)
    ? profile.dispatch_settings
    : undefined;
  const row = settings && Object.hasOwn(settings, persona) ? settings[persona] : undefined;
  const setting = isPlainObject(row) && Object.hasOwn(row, tier) ? row[tier] : undefined;
  return isPlainObject(setting)
    ? { reasoning_effort: setting.reasoning_effort, context_tier: setting.context_tier }
    : automaticDispatchSetting();
}

function expandDefaultAll(modelId) {
  if (typeof modelId !== 'string' || modelId.trim() === '') {
    throw new Error('default-all requires a non-empty exact model identifier');
  }
  const row = {};
  for (const tier of TIER_KEYS) row[tier] = modelId;
  return broadcastTierRow(row);
}

function normalizeProfile(profile) {
  // structuredClone, not a spread: the assignments matrix is two levels deep, so
  // a shallow copy would leave every persona row aliased to the proposal's.
  const stored = {
    assignments: structuredClone(profile.assignments),
    dispatch_settings: effectiveDispatchSettings(profile),
  };
  if (
    Object.hasOwn(profile, 'advisory')
    && isPlainObject(profile.advisory)
    && Object.keys(profile.advisory).length > 0
  ) {
    stored.advisory = structuredClone(profile.advisory);
  }
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
  const priorVersion = base.schema_version;
  base.schema_version = SCHEMA_VERSION;
  base.updated_at = nowIso;
  upgradeRetainedProfiles(base, priorVersion, harness);
  defineOwnDataProperty(base.harnesses, harness, normalizeProfile(profile));
  return base;
}

// The whole file carries one schema_version, so stamping 3 obliges every
// retained profile to be matrix-shaped — otherwise the write produces a file
// that fails its own validation. Broadcasting is exactly how those profiles
// already resolved, so unrelated harnesses keep their routing semantics intact
// even though their stored shape changes.
function upgradeRetainedProfiles(base, priorVersion, skipHarness) {
  if (priorVersion === undefined || priorVersion >= MATRIX_SCHEMA_VERSION) return;
  for (const retained of Object.keys(base.harnesses)) {
    if (retained === skipHarness) continue;
    defineOwnDataProperty(
      base.harnesses,
      retained,
      normalizeProfileToMatrix(base.harnesses[retained], priorVersion)
    );
  }
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
  const priorVersion = base.schema_version;
  base.schema_version = SCHEMA_VERSION;
  base.updated_at = nowIso;
  // Removal restamps the version too, so the surviving profiles must be
  // upgraded with it or the write leaves a file that fails validation.
  upgradeRetainedProfiles(base, priorVersion, null);
  return { config: base, removed: true };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

// The single boundary where a stored profile becomes a matrix. Callers past this
// point never check a schema version, because there is only one shape past here.
function effectiveProfile({ workspaceConfig, globalConfig, harness }) {
  const ws = ownHarnessProfile(workspaceConfig, harness);
  if (ws) {
    return {
      scope: 'workspace',
      schema_version: workspaceConfig.schema_version,
      profile: normalizeProfileToMatrix(ws, workspaceConfig.schema_version),
    };
  }
  const glob = ownHarnessProfile(globalConfig, harness);
  if (glob) {
    return {
      scope: 'global',
      schema_version: globalConfig.schema_version,
      profile: normalizeProfileToMatrix(glob, globalConfig.schema_version),
    };
  }
  return null;
}

function resolve({ workspaceConfig, globalConfig, harness, tier, persona }) {
  // Both caller-supplied routing coordinates are checked before any file state,
  // so bad input never reports as a configuration problem.
  if (!TIER_KEYS.includes(tier)) {
    return {
      ok: false,
      code: EXIT.TIER,
      message: `Invalid tier ${JSON.stringify(tier)}. Canonical keys: ${TIER_KEYS.join(', ')}.`,
    };
  }
  if (persona !== undefined && !PERSONA_KEYS.includes(persona)) {
    return {
      ok: false,
      code: EXIT.TIER,
      message: `Invalid persona ${JSON.stringify(persona)}. Canonical keys: ${PERSONA_KEYS.join(', ')}.`,
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
  // A legacy profile broadcasts one row to every persona, so a personaless
  // library call still answers identically; the CLI requires the coordinate.
  const row = persona ?? PERSONA_KEYS[0];
  const model = hit.profile.assignments[row][tier];
  const dispatchSetting = dispatchSettingForCell(hit.profile, row, tier);
  return {
    ok: true,
    schema_version: hit.schema_version,
    scope: hit.scope,
    harness,
    persona: row,
    tier,
    model,
    check_status: usableCheckStatus(hit.profile, model),
    ...dispatchSetting,
  };
}

// Advisory resolution is a separate command so nothing can mistake a
// recommendation for a dispatch profile. An unconfigured advisory is a normal
// outcome, never a failure — that is what makes "never blocks" true at the
// engine boundary rather than only in prose.
function resolveAdvisory({ workspaceConfig, globalConfig, harness, tier, role = ADVISORY_KEYS[0] }) {
  if (!TIER_KEYS.includes(tier)) {
    return {
      ok: false,
      code: EXIT.TIER,
      message: `Invalid tier ${JSON.stringify(tier)}. Canonical keys: ${TIER_KEYS.join(', ')}.`,
    };
  }
  const hit = effectiveProfile({ workspaceConfig, globalConfig, harness });
  const advisory = hit && isPlainObject(hit.profile.advisory) ? hit.profile.advisory : undefined;
  const row = advisory && Object.hasOwn(advisory, role) ? advisory[role] : undefined;
  const entry = isPlainObject(row) && Object.hasOwn(row, tier) ? row[tier] : undefined;
  if (!isPlainObject(entry)) return { ok: true, advisory: false, harness, tier, role };
  return {
    ok: true,
    advisory: true,
    schema_version: hit.schema_version,
    scope: hit.scope,
    harness,
    role,
    tier,
    model: entry.model,
    reasoning_effort: entry.reasoning_effort,
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
  '  resolve          --workspace-root <path> --harness <surface> --tier <tier-key> --persona <persona-key> [--json]',
  '  resolve-advisory --workspace-root <path> --harness <surface> --tier <tier-key> [--json]',
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
  // --persona is required: routing is a (persona, tier) coordinate, and choosing
  // a row on the caller's behalf would be the silent mis-route this schema
  // exists to prevent. An orchestrator composed before this change fails loudly
  // here rather than dispatching every persona on one profile.
  require_(flags, ['harness', 'tier', 'persona']);
  const paths = configPaths({ workspaceRoot: flags['workspace-root'] });
  const workspaceConfig = paths.workspace ? readOrFail(paths.workspace) : null;
  const globalConfig = readOrFail(paths.global);
  const res = resolve({
    workspaceConfig,
    globalConfig,
    harness: flags.harness,
    tier: flags.tier,
    persona: flags.persona,
  });
  if (!res.ok) fail(res.code, res.message);
  emit(res);
  process.exit(EXIT.OK);
}

function cmdResolveAdvisory(flags) {
  require_(flags, ['harness', 'tier']);
  const paths = configPaths({ workspaceRoot: flags['workspace-root'] });
  const workspaceConfig = paths.workspace ? readOrFail(paths.workspace) : null;
  const globalConfig = readOrFail(paths.global);
  const res = resolveAdvisory({ workspaceConfig, globalConfig, harness: flags.harness, tier: flags.tier });
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
  'resolve-advisory': cmdResolveAdvisory,
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
  MATRIX_SCHEMA_VERSION,
  TIER_KEYS,
  PERSONA_KEYS,
  ADVISORY_KEYS,
  EXIT,
  expandDefaultAll,
  broadcastTierRow,
  normalizeProfileToMatrix,
  isForbiddenAssignment,
  validateProfile,
  validateConfigShape,
  usableCheckStatus,
  upsertProfile,
  removeProfile,
  effectiveProfile,
  resolve,
  resolveAdvisory,
  configPaths,
  readConfigFile,
  atomicWriteJson,
};
