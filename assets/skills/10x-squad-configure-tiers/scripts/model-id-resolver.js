#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const CONSTANTS = require('./routing-constants.js');

const AUTO_REASON = 'squad invariant: Auto banned';
const INHERIT_REASON = 'inherit is not an executable model identifier';
const AUTO = /^auto(?:\s*\([^)]*\))?$/iu;
const INHERIT = /^inherit(?:\s*\([^)]*\))?$/iu;
const {
  TIER_KEYS,
  PERSONA_KEYS,
  ROLE_LANES,
  ADVISORY_KEYS,
  HARNESS_DISPATCH_CAPABILITIES,
  DEFAULT_DISPATCH_CAPABILITY,
} = CONSTANTS;

function dispatchCapability(harness) {
  // Object.hasOwn, not a bare lookup: a harness literally named "__proto__" (or
  // another inherited key) must fall through to the default, not resolve to
  // Object.prototype.
  return typeof harness === 'string' && Object.hasOwn(HARNESS_DISPATCH_CAPABILITIES, harness)
    ? HARNESS_DISPATCH_CAPABILITIES[harness]
    : DEFAULT_DISPATCH_CAPABILITY;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function forbiddenReason(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (AUTO.test(normalized)) {
    return AUTO_REASON;
  }

  return INHERIT.test(normalized) ? INHERIT_REASON : null;
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return false;
  }

  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function prepareCatalog(catalog, harness) {
  if (!isPlainObject(catalog)) {
    throw new TypeError('catalog must be an object');
  }
  if (typeof harness !== 'string' || harness.trim() === '') {
    throw new TypeError('non-empty active harness is required');
  }
  if (typeof catalog.harness !== 'string' || catalog.harness.trim() === '') {
    throw new TypeError('catalog harness must be a non-empty string');
  }
  if (catalog.harness !== harness) {
    throw new TypeError('catalog harness must equal active harness');
  }
  if (catalog.source !== 'harness') {
    throw new TypeError('catalog source must be harness');
  }
  if (!isIsoTimestamp(catalog.checked_at)) {
    throw new TypeError('catalog checked_at must be a valid ISO timestamp');
  }
  if (!Array.isArray(catalog.models)) {
    throw new TypeError('catalog models must be an array');
  }
  const hasExcluded = Object.prototype.hasOwnProperty.call(catalog, 'excluded');
  if (hasExcluded && !Array.isArray(catalog.excluded)) {
    throw new TypeError('catalog excluded must be an array');
  }
  const suppliedExclusions = hasExcluded ? catalog.excluded : [];

  const models = [];
  const excluded = [];
  const excludedModels = new Set();
  for (const entry of suppliedExclusions) {
    const reason = isPlainObject(entry) ? forbiddenReason(entry.model) : null;
    if (!reason || entry.reason !== reason) {
      throw new TypeError(
        'catalog excluded must contain canonical forbidden records'
      );
    }
    if (!excludedModels.has(entry.model)) {
      excludedModels.add(entry.model);
      excluded.push({ model: entry.model, reason });
    }
  }
  const seen = new Set();

  for (const model of catalog.models) {
    if (typeof model !== 'string' || model.trim() === '') {
      throw new TypeError('catalog models must contain non-empty strings');
    }
    if (seen.has(model)) {
      continue;
    }
    seen.add(model);

    const reason = forbiddenReason(model);
    if (reason) {
      if (!excludedModels.has(model)) {
        excludedModels.add(model);
        excluded.push({ model, reason });
      }
    } else {
      models.push(model);
    }
  }

  return { ...catalog, models, excluded };
}

function commonResult(prepared) {
  return {
    harness: prepared.harness,
    selectable_models: prepared.models,
    excluded: prepared.excluded,
  };
}

function matchingSignature(value) {
  let text = value.normalize('NFKC').toLowerCase().trim();
  text = text.replace(/\bthinking\b/gu, ' ');
  text = text.replace(/\b(?:low|medium|high|x[\s-]?high)\s+effort\b/gu, ' ');
  text = text.replace(/\beffort(?:\s+(?:low|medium|high|x[\s-]?high))?\b/gu, ' ');
  text = text.replace(
    /\bfor\s+(?:trivial|lite|standard(?:\s+(?:clear|ambiguous))?|complex)(?:\s+work)?\b.*$/gu,
    ' '
  );
  text = text.replace(/\(\s*copilot\s*\)\s*$/iu, ' ');
  return text
    .replace(/[()._\-\u2010-\u2015]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

// Persona-major is the schema-3 shape; a tier-major row is the legacy shape and
// broadcasts to every persona, exactly as versions 1 and 2 have always resolved.
// Detection is by key space, which is unambiguous because persona and tier keys
// are disjoint — anything not wholly persona-keyed is validated as a legacy row
// so its error messages stay the ones callers already handle.
function isPersonaMajor(object) {
  const keys = Object.keys(object);
  return keys.length > 0 && keys.every((key) => PERSONA_KEYS.includes(key));
}

function requireCompletePersonaKeys(object, what) {
  const keys = Object.keys(object);
  if (keys.length !== PERSONA_KEYS.length || PERSONA_KEYS.some((persona) => !hasOwn(object, persona))) {
    throw new Error(`${what} must contain exactly the six canonical persona keys`);
  }
}

function uniqueModelIds(assignments) {
  if (!isPlainObject(assignments)) {
    throw new Error('assignments must be an object');
  }
  if (isPersonaMajor(assignments)) {
    requireCompletePersonaKeys(assignments, 'assignments');
    const ids = new Set();
    for (const persona of PERSONA_KEYS) {
      const row = assignments[persona];
      if (!isPlainObject(row)) {
        throw new Error(`assignments for ${persona} must be an object`);
      }
      for (const id of uniqueModelIds(row)) ids.add(id);
    }
    return [...ids];
  }
  const keys = Object.keys(assignments);
  if (
    keys.length !== TIER_KEYS.length
    || TIER_KEYS.some(
      (tier) => !Object.prototype.hasOwnProperty.call(assignments, tier)
    )
  ) {
    throw new Error('assignments must contain exactly the five canonical tier keys');
  }
  const values = Object.values(assignments);
  if (values.some((value) => typeof value !== 'string' || value.trim() === '')) {
    throw new Error('assignments must contain non-empty strings');
  }
  return [...new Set(values)];
}

// One persona's assignment row. `label` carries the persona prefix under schema
// 3 and the bare tier under the legacy shape, so each caller sees the coordinate
// it actually supplied.
function resolvedAssignmentRow(selections, prepared, labelFor) {
  if (!isPlainObject(selections)) {
    throw new Error('selections must be an object');
  }
  const keys = Object.keys(selections);
  if (
    keys.length !== TIER_KEYS.length
    || TIER_KEYS.some((tier) => !hasOwn(selections, tier))
  ) {
    throw new Error('selections must contain exactly the five canonical tier keys');
  }

  const assignments = {};
  for (const tier of TIER_KEYS) {
    const selection = selections[tier];
    const label = labelFor(tier);
    const resolution = isPlainObject(selection) ? selection.resolution : null;
    if (
      !isPlainObject(resolution)
      || !['exact', 'likely'].includes(resolution.state)
    ) {
      throw new Error(`selection for ${label} is unresolved`);
    }
    if (resolution.state === 'likely' && selection.confirmed !== true) {
      throw new Error(`selection for ${label} requires confirmation`);
    }
    if (
      typeof resolution.candidate !== 'string'
      || !prepared.models.includes(resolution.candidate)
    ) {
      throw new Error(`selection for ${label} is not in active harness catalog`);
    }
    assignments[tier] = resolution.candidate;
  }
  return assignments;
}

function resolvedAssignments(request) {
  const prepared = prepareCatalog(request.catalog, request.harness);
  if (!isPlainObject(request.selections)) {
    throw new Error('selections must be an object');
  }
  requireCompletePersonaKeys(request.selections, 'selections');
  const assignments = {};
  for (const persona of PERSONA_KEYS) {
    assignments[persona] = resolvedAssignmentRow(
      request.selections[persona],
      prepared,
      (tier) => `${persona}.${tier}`
    );
  }
  return assignments;
}

function resolvedDispatchSettingsRow(selections, harness, labelFor) {
  if (!isPlainObject(selections)) {
    throw new Error('selections must be an object');
  }
  const cap = dispatchCapability(harness);
  const forHarness = `for harness ${JSON.stringify(harness ?? 'unknown')}`;
  const keys = Object.keys(selections);
  if (
    keys.length !== TIER_KEYS.length
    || TIER_KEYS.some(
      (tier) => !Object.prototype.hasOwnProperty.call(selections, tier)
    )
  ) {
    throw new Error('selections must contain exactly the five canonical tier keys');
  }

  const dispatchSettings = {};
  for (const tier of TIER_KEYS) {
    const selection = selections[tier];
    const label = labelFor(tier);
    if (!isPlainObject(selection)) {
      throw new Error(`selection for ${label} is unresolved`);
    }
    const reasoningEffort = Object.prototype.hasOwnProperty.call(
      selection,
      'reasoning_effort'
    ) ? selection.reasoning_effort : 'auto';
    const contextTier = Object.prototype.hasOwnProperty.call(
      selection,
      'context_tier'
    ) ? selection.context_tier : 'auto';
    if (!cap.reasoning_effort.includes(reasoningEffort)) {
      throw new Error(
        `selection for ${label} reasoning_effort must be one of ${cap.reasoning_effort.join(', ')} ${forHarness}`
      );
    }
    if (!cap.context_tier.includes(contextTier)) {
      throw new Error(
        `selection for ${label} context_tier must be one of ${cap.context_tier.join(', ')} ${forHarness}`
      );
    }
    dispatchSettings[tier] = {
      reasoning_effort: reasoningEffort,
      context_tier: contextTier,
    };
  }
  return dispatchSettings;
}

function resolvedDispatchSettings(selections, harness) {
  if (!isPlainObject(selections)) {
    throw new Error('selections must be an object');
  }
  requireCompletePersonaKeys(selections, 'selections');
  const matrix = {};
  for (const persona of PERSONA_KEYS) {
    matrix[persona] = resolvedDispatchSettingsRow(
      selections[persona],
      harness,
      (tier) => `${persona}.${tier}`
    );
  }
  return matrix;
}

function verificationTarget(model, setting) {
  const { reasoning_effort: reasoningEffort, context_tier: contextTier } = setting;
  const dispatchArguments = { model };
  if (reasoningEffort !== 'auto') {
    dispatchArguments.reasoning_effort = reasoningEffort;
  }
  if (contextTier !== 'auto') {
    dispatchArguments.context_tier = contextTier;
  }
  return {
    id: JSON.stringify([model, reasoningEffort, contextTier]),
    model,
    reasoning_effort: reasoningEffort,
    context_tier: contextTier,
    dispatch_arguments: dispatchArguments,
  };
}

// Deduplication keys on the complete execution tuple, which is persona
// independent — so widening from five cells to thirty does not multiply probes.
// Six personas sharing one model and effort still cost exactly one probe.
function uniqueVerificationTargets(assignments, dispatchSettings) {
  const targets = [];
  const seen = new Set();
  const rows = PERSONA_KEYS.map((persona) => [assignments[persona], dispatchSettings[persona]]);
  for (const [assignmentRow, settingsRow] of rows) {
    for (const tier of TIER_KEYS) {
      const target = verificationTarget(assignmentRow[tier], settingsRow[tier]);
      if (!seen.has(target.id)) {
        seen.add(target.id);
        targets.push(target);
      }
    }
  }
  return targets;
}

function verificationPlan(request) {
  const assignments = resolvedAssignments(request);
  // Vocabulary is enforced per harness inside resolvedDispatchSettings: a
  // harness that supports only `auto`/`auto` rejects any explicit value there,
  // which subsumes the former "does not support explicit settings" guard.
  const dispatchSettings = resolvedDispatchSettings(request.selections, request.harness);
  return {
    assignments,
    dispatch_settings: dispatchSettings,
    verification_targets: uniqueVerificationTargets(assignments, dispatchSettings),
  };
}

function dispatchArgumentsMatch(actual, expected) {
  if (!isPlainObject(actual)) {
    return false;
  }
  const actualKeys = Object.keys(actual);
  const expectedKeys = Object.keys(expected);
  return actualKeys.length === expectedKeys.length
    && expectedKeys.every(
      (key) => Object.prototype.hasOwnProperty.call(actual, key)
        && actual[key] === expected[key]
    );
}

function buildResolvedProfile(request) {
  const {
    assignments,
    dispatch_settings: dispatchSettings,
    verification_targets: verificationTargets,
  } = verificationPlan(request);
  if (!isPlainObject(request.probes)) {
    throw new Error('probes must be an object');
  }
  const targetsById = new Map(
    verificationTargets.map((target) => [target.id, target])
  );
  for (const targetId of Object.keys(request.probes)) {
    if (!targetsById.has(targetId)) {
      throw new Error(`unexpected probe for ${targetId}`);
    }
  }

  const modelChecks = new Map();

  for (const target of verificationTargets) {
    if (!Object.prototype.hasOwnProperty.call(request.probes, target.id)) {
      throw new Error(`missing probe for ${target.id}`);
    }
    const probe = request.probes[target.id];
    if (!isPlainObject(probe)) {
      throw new Error(`missing probe for ${target.id}`);
    }
    if (probe.requested_model !== target.model) {
      throw new Error(`probe requested model does not match ${target.id}`);
    }
    if (!dispatchArgumentsMatch(probe.requested_arguments, target.dispatch_arguments)) {
      throw new Error(
        `probe requested arguments do not match dispatch arguments for ${target.id}`
      );
    }
    if (probe.ok !== true) {
      throw new Error(
        `probe failed for ${target.id}: ${probe.error || 'unknown failure'}`
      );
    }
    if (!isIsoTimestamp(probe.checked_at)) {
      throw new Error(`valid ISO probe checked_at is required for ${target.id}`);
    }
    if (typeof probe.identity_observable !== 'boolean') {
      throw new Error(`probe identity_observable is required for ${target.id}`);
    }

    let modelCheck;
    if (probe.identity_observable) {
      if (
        typeof probe.executed_model !== 'string'
        || probe.executed_model !== target.model
      ) {
        throw new Error(
          `requested/executed model mismatch for ${target.id}: ${probe.executed_model}`
        );
      }
      modelCheck = {
        status: 'verified',
        method: 'dispatch_smoke_test',
        source: 'harness',
        checked_at: probe.checked_at,
      };
    } else {
      if (Object.prototype.hasOwnProperty.call(probe, 'executed_model')) {
        throw new Error(
          `unobservable probe must not supply executed_model for ${target.id}`
        );
      }
      modelCheck = {
        status: 'unverified',
        method: 'addressability_probe',
        source: 'harness',
        checked_at: probe.checked_at,
      };
    }

    const priorCheck = modelChecks.get(target.model);
    if (
      priorCheck === undefined
      || modelCheck.status === 'unverified'
      || priorCheck.status === 'verified'
    ) {
      modelChecks.set(target.model, modelCheck);
    }
  }

  const profile = {
    assignments,
    dispatch_settings: dispatchSettings,
    model_checks: Object.fromEntries(modelChecks),
  };
  // Advisory rows never contribute a model_checks entry: they are not probed,
  // so there is no evidence to record.
  const advisory = resolvedAdvisory(request);
  if (advisory !== undefined) {
    profile.advisory = advisory;
  }
  return profile;
}

// ---------------------------------------------------------------------------
// Selection expansion
// ---------------------------------------------------------------------------
//
// The wizard asks 1, 3, 5, or 30 questions; storage is always the same fully
// explicit 30-cell matrix. Expansion happens here so `build-profile` never
// learns four input dialects and the skill never hand-assembles cells from
// prose. No lane, role, or mode marker survives into the output.

function expansionCell(spec, where) {
  if (!isPlainObject(spec)) {
    throw new Error(`${where} must be an object`);
  }
  if (!isPlainObject(spec.model)) {
    throw new Error(`${where}.model must be a resolver result object`);
  }
  const cell = {
    resolution: spec.model,
    reasoning_effort: hasOwn(spec, 'reasoning_effort') && spec.reasoning_effort !== undefined
      ? spec.reasoning_effort
      : 'auto',
    context_tier: hasOwn(spec, 'context_tier') && spec.context_tier !== undefined
      ? spec.context_tier
      : 'auto',
  };
  if (spec.confirmed === true) {
    cell.confirmed = true;
  }
  return cell;
}

function tierCurve(spec, field, where) {
  if (!hasOwn(spec, field)) {
    return Object.fromEntries(TIER_KEYS.map((tier) => [tier, 'auto']));
  }
  const curve = spec[field];
  if (!isPlainObject(curve)) {
    throw new Error(`${where}.${field} must be an object`);
  }
  const keys = Object.keys(curve);
  if (keys.length !== TIER_KEYS.length || TIER_KEYS.some((tier) => !hasOwn(curve, tier))) {
    throw new Error(`${where}.${field} must contain exactly the five canonical tier keys`);
  }
  return curve;
}

function fullMatrix(rowFor) {
  const out = {};
  for (const persona of PERSONA_KEYS) {
    out[persona] = rowFor(persona);
  }
  return out;
}

function expandDefaultAllPlan(plan) {
  const cell = expansionCell(plan, 'plan');
  return fullMatrix(() => Object.fromEntries(TIER_KEYS.map((tier) => [tier, { ...cell }])));
}

function expandRoleLanesPlan(plan) {
  const lanes = plan.lanes;
  if (!isPlainObject(lanes)) {
    throw new Error('plan.lanes must be an object');
  }
  const laneNames = Object.keys(ROLE_LANES);
  for (const lane of laneNames) {
    if (!hasOwn(lanes, lane)) {
      throw new Error(`plan.lanes: missing lane ${JSON.stringify(lane)}`);
    }
  }
  for (const key of Object.keys(lanes)) {
    if (!laneNames.includes(key)) {
      throw new Error(`plan.lanes: unknown lane ${JSON.stringify(key)}; canonical lanes are ${laneNames.join(', ')}`);
    }
  }

  const byPersona = {};
  for (const [lane, personas] of Object.entries(ROLE_LANES)) {
    const spec = lanes[lane];
    if (!isPlainObject(spec)) {
      throw new Error(`plan.lanes.${lane} must be an object`);
    }
    const efforts = tierCurve(spec, 'effort_curve', `plan.lanes.${lane}`);
    const contexts = tierCurve(spec, 'context_curve', `plan.lanes.${lane}`);
    for (const persona of personas) {
      byPersona[persona] = Object.fromEntries(TIER_KEYS.map((tier) => [tier, expansionCell({
        model: spec.model,
        confirmed: spec.confirmed,
        reasoning_effort: efforts[tier],
        context_tier: contexts[tier],
      }, `plan.lanes.${lane}.${tier}`)]));
    }
  }
  return fullMatrix((persona) => byPersona[persona]);
}

function expandPerTierPlan(plan) {
  const tiers = plan.tiers;
  if (!isPlainObject(tiers)) {
    throw new Error('plan.tiers must be an object');
  }
  const keys = Object.keys(tiers);
  if (keys.length !== TIER_KEYS.length || TIER_KEYS.some((tier) => !hasOwn(tiers, tier))) {
    throw new Error('plan.tiers must contain exactly the five canonical tier keys');
  }
  const row = Object.fromEntries(
    TIER_KEYS.map((tier) => [tier, expansionCell(tiers[tier], `plan.tiers.${tier}`)])
  );
  return fullMatrix(() => Object.fromEntries(TIER_KEYS.map((tier) => [tier, { ...row[tier] }])));
}

function expandMatrixPlan(plan) {
  const cells = plan.cells;
  if (!isPlainObject(cells)) {
    throw new Error('plan.cells must be an object');
  }
  requireCompletePersonaKeys(cells, 'plan.cells');
  return fullMatrix((persona) => {
    const row = cells[persona];
    if (!isPlainObject(row)) {
      throw new Error(`plan.cells.${persona} must be an object`);
    }
    const keys = Object.keys(row);
    if (keys.length !== TIER_KEYS.length || TIER_KEYS.some((tier) => !hasOwn(row, tier))) {
      throw new Error(`plan.cells.${persona} must contain exactly the five canonical tier keys`);
    }
    return Object.fromEntries(
      TIER_KEYS.map((tier) => [tier, expansionCell(row[tier], `plan.cells.${persona}.${tier}`)])
    );
  });
}

const EXPANSION_MODES = {
  default_all: expandDefaultAllPlan,
  role_lanes: expandRoleLanesPlan,
  per_tier: expandPerTierPlan,
  matrix: expandMatrixPlan,
};

function expandSelections(request) {
  if (!isPlainObject(request)) {
    throw new Error('request must be an object');
  }
  const plan = request.plan;
  if (!isPlainObject(plan)) {
    throw new Error('plan must be an object');
  }
  if (typeof plan.mode !== 'string' || !hasOwn(EXPANSION_MODES, plan.mode)) {
    throw new Error(`plan.mode must be one of ${Object.keys(EXPANSION_MODES).join(', ')}`);
  }

  const selections = EXPANSION_MODES[plan.mode](plan);
  requireCompletePersonaKeys(selections, 'selections');

  const session = { harness: request.harness, catalog: request.catalog, selections };
  if (hasOwn(request, 'parent_catalog')) {
    session.parent_catalog = request.parent_catalog;
  }
  if (hasOwn(request, 'advisory')) {
    session.advisory = request.advisory;
  }
  return session;
}

// ---------------------------------------------------------------------------
// Advisory rows
// ---------------------------------------------------------------------------
//
// An advisory names the model a tier wants for the ROOT session, which the squad
// can report but never select. It therefore resolves against the parent catalog
// — the spawn catalog is a strictly smaller set and would wrongly reject a
// parent-only model — and it is never probed, because probing means dispatching
// a child.
function resolvedAdvisory(request) {
  if (!hasOwn(request, 'advisory') || request.advisory === undefined) {
    return undefined;
  }
  const advisory = request.advisory;
  if (!isPlainObject(advisory)) {
    throw new Error('advisory must be an object keyed by advisory role');
  }
  if (!hasOwn(request, 'parent_catalog')) {
    throw new Error('advisory requires parent_catalog: a parent model is not resolvable against the spawn catalog');
  }
  const prepared = prepareCatalog(request.parent_catalog, request.harness);
  const cap = dispatchCapability(request.harness);
  const forHarness = `for harness ${JSON.stringify(request.harness ?? 'unknown')}`;

  for (const key of Object.keys(advisory)) {
    if (!ADVISORY_KEYS.includes(key)) {
      throw new Error(`advisory: unknown role ${JSON.stringify(key)}; canonical roles are ${ADVISORY_KEYS.join(', ')}`);
    }
  }

  const out = {};
  for (const role of ADVISORY_KEYS) {
    if (!hasOwn(advisory, role)) {
      throw new Error(`advisory: missing role ${JSON.stringify(role)}`);
    }
    const row = advisory[role];
    if (!isPlainObject(row)) {
      throw new Error(`advisory.${role} must be an object`);
    }
    const keys = Object.keys(row);
    if (keys.length !== TIER_KEYS.length || TIER_KEYS.some((tier) => !hasOwn(row, tier))) {
      throw new Error(`advisory.${role} must contain exactly the five canonical tier keys`);
    }
    out[role] = {};
    for (const tier of TIER_KEYS) {
      const entry = row[tier];
      const label = `advisory.${role}.${tier}`;
      const resolution = isPlainObject(entry) ? entry.resolution ?? entry.model : null;
      if (!isPlainObject(resolution) || !['exact', 'likely'].includes(resolution.state)) {
        throw new Error(`${label} is unresolved`);
      }
      if (resolution.state === 'likely' && entry.confirmed !== true) {
        throw new Error(`${label} requires confirmation`);
      }
      if (typeof resolution.candidate !== 'string' || !prepared.models.includes(resolution.candidate)) {
        throw new Error(`${label} is not in the active harness parent catalog`);
      }
      const effort = hasOwn(entry, 'reasoning_effort') ? entry.reasoning_effort : 'auto';
      if (!cap.reasoning_effort.includes(effort)) {
        throw new Error(`${label} reasoning_effort must be one of ${cap.reasoning_effort.join(', ')} ${forHarness}`);
      }
      out[role][tier] = { model: resolution.candidate, reasoning_effort: effort };
    }
  }
  return out;
}

function resolveModelIntent(request) {
  if (
    !isPlainObject(request)
    || typeof request.user_input !== 'string'
    || request.user_input.trim() === ''
  ) {
    throw new TypeError('request must contain non-empty string user_input');
  }

  const prepared = prepareCatalog(request.catalog, request.harness);
  const reason = forbiddenReason(request.user_input);

  if (reason) {
    return {
      ...commonResult(prepared),
      state: 'banned',
      reason,
    };
  }

  const exact = prepared.models.find((model) => model === request.user_input);

  if (exact !== undefined) {
    return {
      ...commonResult(prepared),
      state: 'exact',
      candidate: exact,
      candidates: [exact],
      requires_confirmation: false,
    };
  }

  const signature = matchingSignature(request.user_input);

  if (signature === '') {
    return {
      ...commonResult(prepared),
      state: 'no_match',
      candidates: [],
    };
  }

  const matches = prepared.models.filter(
    (model) => matchingSignature(model) === signature
  );

  if (matches.length === 1) {
    return {
      ...commonResult(prepared),
      state: 'likely',
      candidate: matches[0],
      candidates: matches,
      requires_confirmation: true,
    };
  }

  if (matches.length > 1) {
    return {
      ...commonResult(prepared),
      state: 'ambiguous',
      candidates: matches,
      requires_choice: true,
    };
  }

  return {
    ...commonResult(prepared),
    state: 'no_match',
    candidates: [],
  };
}

function fail(message) {
  const safeMessage = String(message).replace(
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu,
    (character) => `\\u${character.codePointAt(0).toString(16).padStart(4, '0')}`
  );
  process.stderr.write(`Model resolver error: ${safeMessage}\n`);
  process.exitCode = 2;
}

const COMMANDS = {
  resolve: resolveModelIntent,
  'expand-selections': expandSelections,
  'verification-targets': verificationPlan,
  'build-profile': buildResolvedProfile,
};

function main(argv) {
  if (argv.length !== 3 || argv[1] !== '--input') {
    fail(
      'usage: model-id-resolver.js <resolve|expand-selections|verification-targets|build-profile> --input <request.json>'
    );
    return;
  }

  try {
    const handler = Object.prototype.hasOwnProperty.call(COMMANDS, argv[0])
      ? COMMANDS[argv[0]]
      : null;
    if (!handler) {
      fail(`unknown command ${JSON.stringify(argv[0])}`);
      return;
    }
    const request = JSON.parse(fs.readFileSync(argv[2], 'utf8'));
    process.stdout.write(`${JSON.stringify(handler(request))}\n`);
  } catch (error) {
    fail(error.message);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  AUTO_REASON,
  INHERIT_REASON,
  buildResolvedProfile,
  expandSelections,
  resolvedAdvisory,
  forbiddenReason,
  matchingSignature,
  prepareCatalog,
  resolvedAssignments,
  resolvedDispatchSettings,
  resolveModelIntent,
  uniqueModelIds,
  verificationPlan,
};
