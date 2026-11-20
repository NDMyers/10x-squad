#!/usr/bin/env node
// Writes the model-routing.json for one eval arm.
//
//   arm-routing.js --base FILE --out FILE --linus-context-tier default|long_context|auto [--harness copilot-cli]
//
// The base file is read at any readable schema and written as schema 3. Only the
// builder's context_tier changes, in all five work tiers of the chosen harness, so the
// two arms differ in that one setting and nothing else.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const configModulePath = path.join(
  __dirname, '..', '..', '..', 'assets', 'skills', '10x-squad-configure-tiers', 'scripts', 'model-tier-config.js'
);
const {
  MATRIX_SCHEMA_VERSION,
  TIER_KEYS,
  PERSONA_KEYS,
  normalizeProfileToMatrix,
  validateConfigShape,
  atomicWriteJson,
} = require(configModulePath);

const BUILDER = 'linus';
const TIERS_ALLOWED = ['auto', 'default', 'long_context'];

function withMatrixSettings(profile) {
  const settings = profile.dispatch_settings || {};
  const filled = {};
  for (const persona of PERSONA_KEYS) {
    filled[persona] = {};
    for (const tier of TIER_KEYS) {
      const existing = settings[persona]?.[tier];
      filled[persona][tier] = existing
        ? { reasoning_effort: existing.reasoning_effort, context_tier: existing.context_tier }
        : { reasoning_effort: 'auto', context_tier: 'auto' };
    }
  }
  return { ...profile, dispatch_settings: filled };
}

function buildArmConfig(base, { harness = 'copilot-cli', linusContextTier }) {
  if (!TIERS_ALLOWED.includes(linusContextTier)) {
    throw new Error(`--linus-context-tier must be one of ${TIERS_ALLOWED.join(', ')}`);
  }
  if (!base || typeof base !== 'object' || !base.harnesses || !base.harnesses[harness]) {
    throw new Error(`base config has no profile for harness ${harness}`);
  }
  const harnesses = {};
  for (const [name, profile] of Object.entries(base.harnesses)) {
    harnesses[name] = withMatrixSettings(normalizeProfileToMatrix(structuredClone(profile), base.schema_version));
  }
  for (const tier of TIER_KEYS) {
    harnesses[harness].dispatch_settings[BUILDER][tier].context_tier = linusContextTier;
  }
  const config = {
    schema_version: MATRIX_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    harnesses,
  };
  const check = validateConfigShape(config);
  if (!check.ok) throw new Error(`arm config is invalid: ${check.errors.join('; ')}`);
  return config;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error('options must be --name value pairs');
    options[key.slice(2)] = value;
  }
  return options;
}

function main(argv) {
  try {
    const options = parseArgs(argv.slice(2));
    if (!options.base || !options.out || !options['linus-context-tier']) {
      throw new Error('usage: arm-routing.js --base FILE --out FILE --linus-context-tier default|long_context|auto [--harness NAME]');
    }
    const base = JSON.parse(fs.readFileSync(options.base, 'utf8'));
    const config = buildArmConfig(base, {
      harness: options.harness || 'copilot-cli',
      linusContextTier: options['linus-context-tier'],
    });
    atomicWriteJson(options.out, config);
    console.log(`wrote ${options.out} (builder context tier: ${options['linus-context-tier']})`);
    return 0;
  } catch (error) {
    console.error(`arm-routing failed: ${error.message}`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main(process.argv);

module.exports = { buildArmConfig };
