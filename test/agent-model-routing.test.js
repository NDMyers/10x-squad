'use strict';

// Machine contract for Vivaldi's operative model-routing section. Anchors on
// load-bearing tokens (resolver command, complete resolved profile, dispatch
// arguments, hard blocks, parent-only no-code scoping) — not editorial phrasing.
// Behavioral wording is owned by forward tests and the dispatch spike
// (docs/model-routing-harness-spike.md).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { composeVivaldi } = require('../lib/compose');

const RESOLVER_PATH = '.github/skills/10x-squad-configure-tiers/scripts/model-tier-config.js';
const CANONICAL = ['trivial', 'lite', 'standard_clear', 'standard_ambiguous', 'complex'];
const PERSONAS = ['einstein', 'peter', 'linus', 'cobalt', 'sentinel', 'ralph'];

function readAgent() {
  const raw = composeVivaldi('copilot');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, 'agent file must have YAML frontmatter');
  return { frontmatter: m[1], body: m[2] };
}

function routingSection(body) {
  const m = body.match(/## Model Routing\n([\s\S]*?)(?:\n---|\n## )/);
  assert.ok(m, 'agent file must contain a ## Model Routing section');
  return m[1];
}

function lineContaining(section, token) {
  const line = section.split('\n').find((candidate) => candidate.includes(token));
  assert.ok(line, `routing section must contain a line with ${token}`);
  return line;
}

test('frontmatter has no model pin', () => {
  const { frontmatter } = readAgent();
  assert.ok(!/^model\s*:/m.test(frontmatter), 'Vivaldi parent model must stay manually selected (no model: pin)');
});

test('the persona-by-model-tier table and tier vocabulary are gone', () => {
  const { body } = readAgent();
  assert.ok(!/Higher-tier/i.test(body), 'obsolete Higher-tier vocabulary must be absent');
  assert.ok(!/economy[- ]tier/i.test(body), 'obsolete economy-tier vocabulary must be absent');
  assert.ok(!/\bmodel tier\b/i.test(body), '"model tier" vocabulary must be replaced by resolved model');
  assert.ok(!/Sonnet|Opus|GPT-\d/i.test(body), 'no model names in operative agent instructions');
});

test('the installed resolver command is the only routing source', () => {
  const section = routingSection(readAgent().body);
  assert.ok(section.includes(RESOLVER_PATH), 'must invoke the installed resolver path');
  assert.ok(section.includes(' resolve'), 'must use the resolve subcommand');
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

test('resolver JSON supplies that persona\'s complete three-part profile', () => {
  const section = routingSection(readAgent().body);
  assert.match(section, /that persona's resolved three-part profile/i,
    "resolver output must be treated as one persona's three-part profile");
  for (const field of ['persona', 'model', 'reasoning_effort', 'context_tier', 'check_status']) {
    assert.ok(section.includes(`"${field}"`), `resolver JSON must contain ${field}`);
  }
  assert.match(section,
    /consume[^.\n]*`persona`[^.\n]*`model`[^.\n]*`reasoning_effort`[^.\n]*`context_tier`[^.\n]*`check_status`/i,
    'all additive resolver fields must be consumed');
});

test('resolver failures and model mismatches hard-block the pipeline', () => {
  const section = routingSection(readAgent().body);
  assert.match(section, /nonzero exit/i, 'nonzero resolver exit must be handled');
  assert.match(section, /malformed JSON/i, 'malformed resolver output must be handled');
  assert.match(section, /hard/i, 'failures must hard-block');
  assert.match(section, /requested[^.\n]*executed|executed[^.\n]*requested/i,
    'requested vs executed model comparison must be present');
  assert.match(section, /mismatch/i, 'mismatch handling must be present');
  assert.match(section, /never[^.\n]*(auto|inherit|cheaper|close)/i,
    'silent Auto/inherit/substitution must be forbidden');
});

test('the resolved model is supplied explicitly on subagent dispatch', () => {
  const section = routingSection(readAgent().body);
  assert.match(section, /model (argument|parameter)/i,
    'dispatch must pass the exact resolved model as an explicit argument/parameter');
  const everyDispatch = lineContaining(section, 'Every persona dispatch');
  assert.match(everyDispatch, /exact resolved model/i,
    'every persona dispatch must reuse the exact resolved model');
  assert.match(everyDispatch, /explicitly[^.\n]*`model` argument/i,
    'the model argument must always be explicit');
  assert.match(section, /re-?resolv/i, 'reclassification must trigger re-resolution');
});

test('non-auto runtime settings pass exactly and auto fields omit independently', () => {
  const section = routingSection(readAgent().body);
  for (const field of ['reasoning_effort', 'context_tier']) {
    const rule = lineContaining(section, `If \`${field}\` is non-\`auto\``);
    assert.match(rule, /exact resolved value/i, `${field} must pass exactly`);
    assert.ok(rule.includes(`dispatch \`${field}\` argument`),
      `${field} must use its matching dispatch argument`);
    assert.match(rule, /if it is `auto`, omit only that argument/i,
      `${field} auto must omit only its own argument`);
  }
});

test('runtime auto is announced omission, distinct from the parent model Auto ban', () => {
  const { body } = readAgent();
  const section = routingSection(body);
  assert.match(section, /Copilot model Auto[^.\n]*parent session[^.\n]*(banned|user error)/i,
    'the parent model Auto ban must remain explicit');
  assert.match(section, /Copilot model Auto[^.\n]*banned[^.\n]*every subagent dispatch/i,
    'model Auto must remain banned for child dispatches too');
  assert.match(section, /runtime `auto`[^.\n]*(valid|allowed)[^.\n]*(omit|omission)/i,
    'runtime auto must be a valid omission choice');
  assert.match(section, /runtime `auto`[^.\n]*not[^.\n]*(model Auto|parent inheritance)/i,
    'runtime auto must be distinguished from model Auto and inheritance');
  const replacementRule = lineContaining(section, 'Never replace runtime `auto`');
  for (const replacement of ['maximum', 'default', 'inherited', 'guessed']) {
    assert.match(replacementRule, new RegExp(`\\b${replacement}\\b`, 'i'),
      `runtime auto must not become a ${replacement} value`);
  }
  assert.doesNotMatch(body, /highest supported/i,
    'the obsolete highest-supported policy must be removed entirely');
});

test('routing announcement names persona tier harness and all three choices', () => {
  const section = routingSection(readAgent().body);
  const announcement = lineContaining(section, 'Announce the persona');
  for (const detail of ['work tier', 'harness', 'exact model', 'reasoning choice', 'context choice']) {
    assert.match(announcement, new RegExp(detail, 'i'), `announcement must include ${detail}`);
  }
  assert.match(announcement, /every persona dispatch/i,
    'the complete routing announcement must precede every dispatch');
  assert.match(announcement, /including `auto`/i, 'auto choices must still be announced');
});

test('each persona dispatch resolves its own profile', () => {
  const section = routingSection(readAgent().body);
  const reuse = lineContaining(section, 'Every persona dispatch resolves its own');
  assert.match(reuse, /never reuse another persona/i,
    'one persona profile must never be carried to another persona');
  assert.match(reuse, /re-?run the resolver/i);
  assert.match(reuse, /repeat[^.\n]*complete routing announcement/i,
    'every persona dispatch must repeat the complete routing announcement');
  // Regression guard: the retired one-profile-per-task contract must be gone.
  assert.doesNotMatch(section, /same resolved three-part profile/i);

  const reclassification = lineContaining(section, 'If the work tier is reclassified');
  assert.match(reclassification, /every subsequent dispatch re-?resolves/i);
  assert.match(reclassification, /re-?run the resolver/i);
  assert.match(reclassification, /consume and re-?announce/i);
  for (const field of ['model', 'reasoning_effort', 'context_tier']) {
    assert.ok(reclassification.includes(`\`${field}\``),
      `reclassification must refresh ${field}`);
  }
  assert.match(reclassification, /before the next dispatch/i);
  assert.match(reclassification, /running children are not restarted/i);
});

test('unsupported runtime arguments hard-block without unverifiable identity claims', () => {
  const section = routingSection(readAgent().body);
  const unsupported = lineContaining(section, 'If either configured non-`auto` runtime argument');
  assert.match(unsupported, /unavailable or rejected/i);
  assert.match(unsupported, /active dispatch contract/i);
  assert.match(unsupported, /hard-block/i);

  const observability = lineContaining(section, 'Do not claim post-launch observability');
  assert.match(observability, /reasoning[^.\n]*context identity/i,
    'reasoning/context identity must not be claimed after launch');
});

test('one-dispatch overrides cover the complete profile without persistence', () => {
  const section = routingSection(readAgent().body);
  const match = section.match(/\*\*One-dispatch override:\*\*([\s\S]*?)(?=\n\n\*\*Hard failure contract\.)/);
  assert.ok(match, 'one-dispatch override contract must be present');
  const override = match[1];
  for (const field of ['model', 'reasoning_effort', 'context_tier']) {
    assert.ok(override.includes(`\`${field}\``), `override may include ${field}`);
  }
  assert.match(override, /`model` override[^.\n]*exact[^.\n]*non-Auto/i,
    'a one-dispatch model override must not permit model Auto');
  assert.match(override, /announce/i);
  assert.match(override, /apply (?:it|the override) once/i);
  assert.match(override, /never store/i);
  assert.match(override, /explicit runtime override[^.\n]*active dispatch contract[^.\n]*supports/i);
  assert.match(override, /`auto` override[^.\n]*omit[^.\n]*independently/i);
  assert.match(override, /one dispatch of one persona/i, 'an override is scoped to a single persona');
  assert.match(override, /never propagates/i);
});

test('vivaldi announces an advisory model it can never actuate', () => {
  const section = routingSection(readAgent().body);
  assert.ok(section.includes('resolve-advisory'), 'TRIAGE must resolve the advisory');
  assert.match(section, /advisory/i);
  assert.match(section, /recommendation/i);
  assert.match(section, /never blocks?/i, 'an advisory must never block the pipeline');
  assert.match(section, /cannot change its own model/i);
  assert.match(section, /announce nothing and continue/i,
    'an unconfigured advisory must be silent, not an error');
});

test('hard failure reports the requested three-part profile', () => {
  const section = routingSection(readAgent().body);
  const match = section.match(/\*\*Hard failure contract\.\*\*([\s\S]*)/);
  assert.ok(match, 'hard failure contract must be present');
  const failure = match[1];
  assert.match(failure, /requested three-part profile/i);
  assert.match(failure, /the persona and its canonical key/i,
    'a routing failure must name which persona failed');
  assert.match(failure, /invalid tier or persona/i, 'exit 4 covers both routing coordinates');
  for (const field of ['model', 'reasoning_effort', 'context_tier']) {
    assert.ok(failure.includes(`\`${field}\``), `hard failure report must include ${field}`);
  }
});

test('the no-code rule is scoped to the parent context', () => {
  const { body } = readAgent();
  assert.ok(!/\*\*You do not write code\.\*\*/.test(body), 'unscoped parent prohibition must be gone');
  assert.match(body, /parent context does not implement code/i, 'scoped parent rule must be present');
  assert.match(body, /Linus may implement within its isolated child context/i,
    'child persona implementation permission must be explicit');
});
