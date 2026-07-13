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
  text = text.replace(/\(\s*copilot\s*\)\s*$/iu, ' ');
  text = text.replace(/\bthinking\b/gu, ' ');
  text = text.replace(/\b(?:low|medium|high|x[\s-]?high)\s+effort\b/gu, ' ');
  text = text.replace(/\beffort(?:\s+(?:low|medium|high|x[\s-]?high))?\b/gu, ' ');
  text = text.replace(
    /\bfor\s+(?:trivial|lite|standard(?:\s+(?:clear|ambiguous))?|complex)(?:\s+work)?\b.*$/gu,
    ' '
  );
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
  process.stderr.write(`Model resolver error: ${message}\n`);
  process.exit(2);
}

function main(argv) {
  if (argv.length !== 3 || argv[1] !== '--input') {
    fail('usage: model-id-resolver.js resolve --input <request.json>');
  }

  try {
    const request = JSON.parse(fs.readFileSync(argv[2], 'utf8'));
    if (argv[0] !== 'resolve') {
      fail(`unknown command ${JSON.stringify(argv[0])}`);
    }
    process.stdout.write(`${JSON.stringify(resolveModelIntent(request))}\n`);
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
  forbiddenReason,
  matchingSignature,
  prepareCatalog,
  resolveModelIntent,
  uniqueModelIds,
};
