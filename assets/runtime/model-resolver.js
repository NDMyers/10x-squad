'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const resolverPath = path.join('skills', '10x-squad-configure-tiers', 'scripts', 'model-tier-config.js');

function resolverCandidates({ workspaceRoot, harness }) {
  const home = os.homedir();
  const installRoot = path.resolve(__dirname, '..', '..');
  const family = typeof harness === 'string' ? harness.split('-')[0] : '';
  const candidates = [];

  // Each harness searches its own install root first, so a mixed install never
  // resolves through another harness's (possibly older) copy of the engine.
  function rootsFor(isHome) {
    if (family === 'codex') return ['.agents', '.github', '.claude'];
    if (family === 'claude') return ['.claude', '.github', '.agents'];
    return isHome ? ['.copilot', '.github', '.agents', '.claude'] : ['.github', '.agents', '.claude'];
  }

  function addRoot(root) {
    if (!root) return;
    const absoluteRoot = path.resolve(root);
    const isHome = home && absoluteRoot === path.resolve(home);
    const roots = rootsFor(isHome);
    for (const discoveryRoot of roots) {
      candidates.push(path.join(absoluteRoot, discoveryRoot, resolverPath));
    }
  }

  addRoot(workspaceRoot || process.cwd());
  addRoot(installRoot);
  candidates.push(path.join(__dirname, '..', resolverPath));
  addRoot(home);
  return [...new Set(candidates)];
}

function loadModelTierConfig({ workspaceRoot, harness }) {
  const incompatible = [];
  for (const candidate of resolverCandidates({ workspaceRoot, harness })) {
    if (!fs.existsSync(candidate)) continue;
    let config;
    try {
      config = require(candidate);
    } catch (error) {
      return {
        ok: false,
        code: 'MODEL_ROUTING_RESOLVER_LOAD_FAILED',
        message: `Could not load model routing resolver at ${candidate}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (config && typeof config.resolveEffectiveProfile === 'function') {
      return { ok: true, config, path: candidate };
    }
    incompatible.push(candidate);
  }

  const detail = incompatible.length ? ` Incompatible copies: ${incompatible.join(', ')}.` : '';
  return {
    ok: false,
    code: 'MODEL_ROUTING_RESOLVER_UNAVAILABLE',
    message: `A compatible model routing resolver is unavailable.${detail} Reinstall 10x Squad for the active harness.`,
  };
}

function resolvePersonaProfile({ config, workspaceRoot, harness, tier, persona }) {
  let resolved;
  try {
    resolved = config.resolveEffectiveProfile({
      workspaceRoot: workspaceRoot || process.cwd(),
      harness,
      tier,
      persona,
    });
  } catch (error) {
    return {
      ok: false,
      persona,
      code: 'MODEL_ROUTING_RESOLUTION_FAILED',
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
  if (!resolved || typeof resolved.ok !== 'boolean') {
    return {
      ok: false,
      persona,
      code: 'INVALID_MODEL_ROUTING_RESPONSE',
      errors: ['The resolver returned an invalid response.'],
    };
  }
  if (!resolved.ok) {
    return {
      ok: false,
      persona,
      code: resolved.code || 'MODEL_ROUTING_RESOLUTION_FAILED',
      errors: resolved.errors || [resolved.message || 'The resolver reported a failure without details.'],
    };
  }

  const profile = resolved.result;
  const fields = ['model', 'reasoning_effort', 'context_tier', 'check_status'];
  if (
    !profile
    || profile.ok !== true
    || profile.persona !== persona
    || profile.harness !== harness
    || profile.tier !== tier
    || profile.agent !== `10x-${persona}`
    || fields.some((field) => typeof profile[field] !== 'string' || !profile[field].trim())
    || /^(?:auto|inherit)$/i.test(profile.model.trim())
  ) {
    return {
      ok: false,
      persona,
      code: 'INVALID_MODEL_ROUTING_RESPONSE',
      errors: ['The resolver returned an incomplete or mismatched dispatch profile.'],
    };
  }
  return { ok: true, profile };
}

module.exports = { loadModelTierConfig, resolvePersonaProfile };
