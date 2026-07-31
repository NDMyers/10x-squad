'use strict';

// Canonical routing vocabulary shared by the two dependency-free scripts in this
// skill. Both `model-tier-config.js` (the storage/resolution engine) and
// `model-id-resolver.js` (catalog matching and proposal construction) walk the
// same key spaces; a drift between them would not surface as a loud error but as
// a silent mis-expansion — one file building a matrix over a key list the other
// validates against. Single source of truth, required as a co-installed sibling.
//
// Arrays are canonical because order is load-bearing: it fixes diff ordering,
// verification-target ordering, and the order values appear in error messages.
// Consumers that want set membership wrap these at module load, which preserves
// insertion order and therefore keeps those messages byte-identical.

const TIER_KEYS = ['trivial', 'lite', 'standard_clear', 'standard_ambiguous', 'complex'];

// The six dispatchable personas, in pipeline order (assets/vivaldi/core.md).
// Routing is a (persona, tier) coordinate: the same task tier can warrant a
// frontier model for the personas that plan and gate the work and a cheaper one
// for the persona that executes an already-reviewed spec.
//
// Vivaldi is deliberately absent. It is always the root session and cannot set
// its own model, so it is never a dispatch target — see ADVISORY_KEYS.
const PERSONA_KEYS = ['einstein', 'peter', 'linus', 'cobalt', 'sentinel', 'ralph'];

// Role lanes exist so the configure wizard can ask three questions instead of
// thirty. They are a grouping for INPUT only: every lane is expanded into
// explicit per-persona entries before anything is stored, and no lane marker is
// ever written to configuration.
const ROLE_LANES = {
  thinker: ['einstein', 'peter'],
  builder: ['linus', 'ralph'],
  reviewer: ['cobalt', 'sentinel'],
};

// Advisory rows are recommendations, never actuations. Vivaldi runs as the root
// session on every surface, so the squad can report which parent model a tier
// wants but can never select it — the user does that in the harness.
const ADVISORY_KEYS = ['vivaldi'];

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
    reasoning_effort: ['auto', 'low', 'medium', 'high', 'xhigh'],
    context_tier: ['auto', 'default', 'long_context'],
  },
  'codex-cli': {
    reasoning_effort: ['auto', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    context_tier: ['auto'],
  },
  // Same vocabulary as codex-cli, established from codex-app's own evidence
  // (Probe F) rather than copied: its spawn tool takes model + reasoning_effort
  // and no context parameter, and its catalog reports the same effort levels.
  // Separate key because the surfaces run different engine builds and their
  // spawnable sets drift independently (docs/codex-harness-spike.md, Probe I1).
  'codex-app': {
    reasoning_effort: ['auto', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    context_tier: ['auto'],
  },
};

const DEFAULT_DISPATCH_CAPABILITY = {
  reasoning_effort: ['auto'],
  context_tier: ['auto'],
};

// Deep-freeze so two consumers sharing one module instance cannot mutate each
// other's view of the vocabulary.
function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

module.exports = deepFreeze({
  TIER_KEYS,
  PERSONA_KEYS,
  ROLE_LANES,
  ADVISORY_KEYS,
  HARNESS_DISPATCH_CAPABILITIES,
  DEFAULT_DISPATCH_CAPABILITY,
});
