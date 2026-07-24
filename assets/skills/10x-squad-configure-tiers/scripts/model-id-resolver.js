#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const AUTO_REASON = 'squad invariant: Auto banned';
const INHERIT_REASON = 'inherit is not an executable model identifier';
const AUTO = /^auto(?:\s*\([^)]*\))?$/iu;
const INHERIT = /^inherit(?:\s*\([^)]*\))?$/iu;
const TIER_KEYS = ['trivial', 'lite', 'standard_clear', 'standard_ambiguous', 'complex'];
// Per-harness runtime-setting vocabulary — kept in lockstep with the identical
// map in model-tier-config.js. A harness absent from the map allows only
// `auto`/`auto`. Per-MODEL reasoning-effort legality is a live-catalog fact
// enforced during resolution against the acquired catalog and finally by the
// harness at spawn time; it is never hardcoded here.
const HARNESS_DISPATCH_CAPABILITIES = {
  'copilot-cli': {
    reasoning_effort: ['auto', 'low', 'medium', 'high', 'xhigh'],
    context_tier: ['auto', 'default', 'long_context'],
  },
  'codex-cli': {
    reasoning_effort: ['auto', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    context_tier: ['auto'],
  },
};
const DEFAULT_DISPATCH_CAPABILITY = {
  reasoning_effort: ['auto'],
  context_tier: ['auto'],
};

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

function uniqueModelIds(assignments) {
  if (!isPlainObject(assignments)) {
    throw new Error('assignments must be an object');
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

function resolvedAssignments(request) {
  const prepared = prepareCatalog(request.catalog, request.harness);
  if (!isPlainObject(request.selections)) {
    throw new Error('selections must be an object');
  }
  const keys = Object.keys(request.selections);
  if (
    keys.length !== TIER_KEYS.length
    || TIER_KEYS.some(
      (tier) => !Object.prototype.hasOwnProperty.call(request.selections, tier)
    )
  ) {
    throw new Error('selections must contain exactly the five canonical tier keys');
  }

  const assignments = {};
  for (const tier of TIER_KEYS) {
    const selection = request.selections[tier];
    const resolution = isPlainObject(selection) ? selection.resolution : null;
    if (
      !isPlainObject(resolution)
      || !['exact', 'likely'].includes(resolution.state)
    ) {
      throw new Error(`selection for ${tier} is unresolved`);
    }
    if (resolution.state === 'likely' && selection.confirmed !== true) {
      throw new Error(`selection for ${tier} requires confirmation`);
    }
    if (
      typeof resolution.candidate !== 'string'
      || !prepared.models.includes(resolution.candidate)
    ) {
      throw new Error(`selection for ${tier} is not in active harness catalog`);
    }
    assignments[tier] = resolution.candidate;
  }
  return assignments;
}

function resolvedDispatchSettings(selections, harness) {
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
    if (!isPlainObject(selection)) {
      throw new Error(`selection for ${tier} is unresolved`);
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
        `selection for ${tier} reasoning_effort must be one of ${cap.reasoning_effort.join(', ')} ${forHarness}`
      );
    }
    if (!cap.context_tier.includes(contextTier)) {
      throw new Error(
        `selection for ${tier} context_tier must be one of ${cap.context_tier.join(', ')} ${forHarness}`
      );
    }
    dispatchSettings[tier] = {
      reasoning_effort: reasoningEffort,
      context_tier: contextTier,
    };
  }
  return dispatchSettings;
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

function uniqueVerificationTargets(assignments, dispatchSettings) {
  const targets = [];
  const seen = new Set();
  for (const tier of TIER_KEYS) {
    const target = verificationTarget(assignments[tier], dispatchSettings[tier]);
    if (!seen.has(target.id)) {
      seen.add(target.id);
      targets.push(target);
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

  return {
    assignments,
    dispatch_settings: dispatchSettings,
    model_checks: Object.fromEntries(modelChecks),
  };
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
  'verification-targets': verificationPlan,
  'build-profile': buildResolvedProfile,
};

function main(argv) {
  if (argv.length !== 3 || argv[1] !== '--input') {
    fail(
      'usage: model-id-resolver.js <resolve|verification-targets|build-profile> --input <request.json>'
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
  forbiddenReason,
  matchingSignature,
  prepareCatalog,
  resolvedAssignments,
  resolvedDispatchSettings,
  resolveModelIntent,
  uniqueModelIds,
  verificationPlan,
};
