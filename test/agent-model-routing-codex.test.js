'use strict';

// Machine contract for Vivaldi's Codex routing section. The Copilot suite
// composes only the Copilot entrypoint, so the Codex dispatch contract carried
// the same load-bearing sentences with no coverage. Anchors on tokens, not
// editorial phrasing.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { composeVivaldi } = require('../lib/compose');

const RESOLVER_PATH = '.agents/skills/10x-squad-configure-tiers/scripts/model-tier-config.js';
const CANONICAL = ['trivial', 'lite', 'standard_clear', 'standard_ambiguous', 'complex'];
const PERSONAS = ['einstein', 'peter', 'linus', 'cobalt', 'sentinel', 'ralph'];

function routingSection() {
  const raw = composeVivaldi('codex');
  const m = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  assert.ok(m, 'agent file must have YAML frontmatter');
  const section = m[1].match(/## Model Routing\n([\s\S]*?)(?:\n---|\n## [A-Z])/);
  assert.ok(section, 'codex entrypoint must contain a ## Model Routing section');
  return section[1];
}

function lineContaining(section, token) {
  const line = section.split('\n').find((candidate) => candidate.includes(token));
  assert.ok(line, `routing section must contain a line with ${JSON.stringify(token)}`);
  return line;
}

test('the codex resolver invocation carries both routing coordinates', () => {
  const section = routingSection();
  assert.ok(section.includes(RESOLVER_PATH), 'must invoke the Codex-installed resolver path');
  for (const flag of ['--workspace-root', '--harness', '--tier', '--persona', '--json']) {
    assert.ok(section.includes(flag), `resolver invocation must pass ${flag}`);
  }
  for (const key of CANONICAL) {
    assert.ok(section.includes(key), `canonical tier key ${key} must be listed`);
  }
  for (const persona of PERSONAS) {
    assert.ok(section.includes(`\`${persona}\``), `canonical persona key ${persona} must be listed`);
  }
});

test('each codex persona dispatch resolves its own profile', () => {
  const section = routingSection();
  const line = lineContaining(section, 'Every persona dispatch resolves its own');
  assert.match(line, /never reuse another persona/i);
  assert.match(line, /re-?run the resolver/i);
  // Regression guard: the retired one-profile-per-task contract must be gone.
  assert.doesNotMatch(section, /same resolved profile/i);
});

test('codex consumes the persona field and never claims executed-model verification', () => {
  const section = routingSection();
  assert.match(section, /consume `persona`, `model`, `reasoning_effort`, and `check_status`/i);
  assert.match(section, /never claim executed-model verification on codex/i);
  // context_tier has no Codex analog and must never be passed.
  assert.match(section, /`context_tier` (?:has no Codex analog|resolves to `auto`)/i);
});

test('codex advisory is announced but never actuated', () => {
  const section = routingSection();
  assert.ok(section.includes('resolve-advisory'));
  assert.match(section, /recommendation/i);
  assert.match(section, /never blocks?/i);
  assert.match(section, /cannot change its own model/i);
  assert.match(section, /announce nothing and continue/i);
});

test('codex overrides are scoped to one persona and failures name the coordinate', () => {
  const section = routingSection();
  const override = lineContaining(section, '**One-dispatch override:**');
  assert.match(override, /one dispatch of one persona/i);
  assert.match(override, /never propagates/i);
  assert.match(override, /never store/i);

  const failure = lineContaining(section, '**Hard failure contract.**');
  assert.match(failure, /the persona and its canonical key/i);
  assert.match(failure, /invalid tier or persona/i);
});

test('the codex task_name convention matches the routing coordinate', () => {
  const section = routingSection();
  assert.match(section, /`<persona>_<canonical-tier-key>`/);
  assert.match(section, /routing coordinate/i);
});

test('codex routing names no model and no Copilot-only vocabulary', () => {
  const section = routingSection();
  assert.ok(!/Sonnet|Opus|GPT-\d/i.test(section), 'no model names in operative instructions');
  assert.ok(!/runSubagent|copilot-cli/i.test(section), 'Copilot dispatch tokens must not leak into Codex');
});
