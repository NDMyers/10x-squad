#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const AUTO_REASON = 'squad invariant: Auto banned';
const INHERIT_REASON = 'inherit is not an executable model identifier';
const AUTO = /^auto(?:\s*\([^)]*\))?$/iu;
const INHERIT = /^inherit(?:\s*\([^)]*\))?$/iu;
const TIER_KEYS = ['trivial', 'lite', 'standard_clear', 'standard_ambiguous', 'complex'];

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

  const models = [];
  const excluded = [];
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
      excluded.push({ model, reason });
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

function verificationPlan(request) {
  const assignments = resolvedAssignments(request);
  return {
    assignments,
    verification_targets: uniqueModelIds(assignments),
  };
}

function buildResolvedProfile(request) {
  const { assignments, verification_targets: verificationTargets } = verificationPlan(request);
  if (!isPlainObject(request.probes)) {
    throw new Error('probes must be an object');
  }
  for (const model of Object.keys(request.probes)) {
    if (!verificationTargets.includes(model)) {
      throw new Error(`unexpected probe for ${model}`);
    }
  }

  const modelCheckEntries = [];

  for (const model of verificationTargets) {
    if (!Object.prototype.hasOwnProperty.call(request.probes, model)) {
      throw new Error(`missing probe for ${model}`);
    }
    const probe = request.probes[model];
    if (!isPlainObject(probe)) {
      throw new Error(`missing probe for ${model}`);
    }
    if (probe.requested_model !== model) {
      throw new Error(`probe requested model does not match ${model}`);
    }
    if (probe.ok !== true) {
      throw new Error(`probe failed for ${model}: ${probe.error || 'unknown failure'}`);
    }
    if (!isIsoTimestamp(probe.checked_at)) {
      throw new Error(`valid ISO probe checked_at is required for ${model}`);
    }
    if (typeof probe.identity_observable !== 'boolean') {
      throw new Error(`probe identity_observable is required for ${model}`);
    }

    if (probe.identity_observable) {
      if (
        typeof probe.executed_model !== 'string'
        || probe.executed_model !== model
      ) {
        throw new Error(
          `requested/executed model mismatch for ${model}: ${probe.executed_model}`
        );
      }
      modelCheckEntries.push([model, {
        status: 'verified',
        method: 'dispatch_smoke_test',
        source: 'harness',
        checked_at: probe.checked_at,
      }]);
    } else {
      if (Object.prototype.hasOwnProperty.call(probe, 'executed_model')) {
        throw new Error(`unobservable probe must not supply executed_model for ${model}`);
      }
      modelCheckEntries.push([model, {
        status: 'unverified',
        method: 'addressability_probe',
        source: 'harness',
        checked_at: probe.checked_at,
      }]);
    }
  }

  return {
    assignments,
    model_checks: Object.fromEntries(modelCheckEntries),
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
  resolveModelIntent,
  uniqueModelIds,
  verificationPlan,
};
