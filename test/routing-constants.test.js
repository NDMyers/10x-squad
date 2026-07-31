'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPTS = path.join(
  __dirname, '..', 'assets', 'skills', '10x-squad-configure-tiers', 'scripts'
);

const constants = require(path.join(SCRIPTS, 'routing-constants.js'));
const { TIER_KEYS, PERSONA_KEYS, ROLE_LANES, ADVISORY_KEYS } = constants;

test('canonical tier keys are the five work tiers in triage order', () => {
  assert.deepEqual(TIER_KEYS, ['trivial', 'lite', 'standard_clear', 'standard_ambiguous', 'complex']);
});

test('canonical persona keys are the six dispatchable personas in pipeline order', () => {
  // Order is load-bearing: it fixes diff ordering and verification-target
  // ordering, both of which are asserted elsewhere by deep equality.
  assert.deepEqual(PERSONA_KEYS, ['einstein', 'peter', 'linus', 'cobalt', 'sentinel', 'ralph']);
});

test('vivaldi is never a dispatchable persona', () => {
  // It runs as the root session on every surface and cannot set its own model,
  // so it can only ever appear as an advisory row.
  assert.ok(!PERSONA_KEYS.includes('vivaldi'));
  assert.deepEqual(ADVISORY_KEYS, ['vivaldi']);
});

test('role lanes partition every persona exactly once', () => {
  const laned = Object.values(ROLE_LANES).flat();
  assert.deepEqual([...laned].sort(), [...PERSONA_KEYS].sort(), 'lanes must cover every persona');
  assert.equal(new Set(laned).size, laned.length, 'no persona may appear in two lanes');
});

test('role lanes name only canonical personas', () => {
  for (const [lane, members] of Object.entries(ROLE_LANES)) {
    for (const member of members) {
      assert.ok(PERSONA_KEYS.includes(member), `lane ${lane} names unknown persona ${member}`);
    }
  }
});

test('persona and tier key spaces are disjoint', () => {
  // A safety property, not a mechanism: version discrimination is by
  // schema_version, never by sniffing which key space a leaf belongs to.
  const overlap = PERSONA_KEYS.filter((persona) => TIER_KEYS.includes(persona));
  assert.deepEqual(overlap, []);
});

test('both routing scripts source their vocabulary from this module', () => {
  const engine = require(path.join(SCRIPTS, 'model-tier-config.js'));

  // Node caches by resolved path, so a shared relative require is one instance.
  // Asserting the require is present in both files is what rules out a private
  // copy drifting back in — a drift would be a silent mis-expansion, where one
  // script builds a matrix over a key list the other validates against.
  for (const script of ['model-tier-config.js', 'model-id-resolver.js']) {
    const source = fs.readFileSync(path.join(SCRIPTS, script), 'utf8');
    assert.match(source, /require\('\.\/routing-constants\.js'\)/, `${script} must share the constants`);
    assert.doesNotMatch(
      source,
      /^const TIER_KEYS = \[/m,
      `${script} must not redeclare TIER_KEYS`
    );
  }
  assert.equal(engine.TIER_KEYS, TIER_KEYS);

  assert.ok(Object.isFrozen(TIER_KEYS));
  assert.ok(Object.isFrozen(PERSONA_KEYS));
  assert.ok(Object.isFrozen(ROLE_LANES));
  assert.ok(Object.isFrozen(ROLE_LANES.thinker));
  assert.throws(() => { PERSONA_KEYS.push('intruder'); }, TypeError);
});

test('harness dispatch capabilities keep declaration order for error messages', () => {
  const { HARNESS_DISPATCH_CAPABILITIES, DEFAULT_DISPATCH_CAPABILITY } = constants;

  assert.deepEqual(
    HARNESS_DISPATCH_CAPABILITIES['copilot-cli'].reasoning_effort,
    ['auto', 'low', 'medium', 'high', 'xhigh']
  );
  assert.deepEqual(HARNESS_DISPATCH_CAPABILITIES['copilot-cli'].context_tier, ['auto', 'default', 'long_context']);
  for (const surface of ['codex-cli', 'codex-app']) {
    assert.deepEqual(
      HARNESS_DISPATCH_CAPABILITIES[surface].reasoning_effort,
      ['auto', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
    );
    assert.deepEqual(HARNESS_DISPATCH_CAPABILITIES[surface].context_tier, ['auto']);
  }
  // copilot-vscode is deliberately absent: an unverified dispatch contract gets
  // the safe auto/auto posture.
  assert.ok(!Object.hasOwn(HARNESS_DISPATCH_CAPABILITIES, 'copilot-vscode'));
  assert.deepEqual(DEFAULT_DISPATCH_CAPABILITY, { reasoning_effort: ['auto'], context_tier: ['auto'] });
});
