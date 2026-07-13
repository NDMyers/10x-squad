#!/usr/bin/env node
'use strict';

const AUTO_REASON = 'squad invariant: Auto banned';
const INHERIT_REASON = 'inherit is not an executable model identifier';
const AUTO = /^auto(?:\s*\([^)]*\))?$/iu;
const INHERIT = /^inherit(?:\s*\([^)]*\))?$/iu;

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

  return {
    ...commonResult(prepared),
    state: 'no_match',
    candidates: [],
  };
}

module.exports = {
  AUTO_REASON,
  INHERIT_REASON,
  forbiddenReason,
  prepareCatalog,
  resolveModelIntent,
};
