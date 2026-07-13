'use strict';

// Machine contract for Vivaldi's operative model-routing section. Anchors on
// load-bearing tokens (resolver command, flags, exit handling, dispatch model
// argument, mismatch hard-block, parent-only no-code scoping) — not editorial
// phrasing. Behavioral wording is owned by forward tests and the dispatch
// spike (docs/model-routing-harness-spike.md).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AGENT_MD = path.join(__dirname, '..', 'assets', 'agents', '10x-squad.agent.md');
const RESOLVER_PATH = '.github/skills/10x-squad-configure-tiers/scripts/model-tier-config.js';
const CANONICAL = ['trivial', 'lite', 'standard_clear', 'standard_ambiguous', 'complex'];

function readAgent() {
  const raw = fs.readFileSync(AGENT_MD, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, 'agent file must have YAML frontmatter');
  return { frontmatter: m[1], body: m[2] };
}

function routingSection(body) {
  const m = body.match(/## Model Routing\n([\s\S]*?)(?:\n---|\n## )/);
  assert.ok(m, 'agent file must contain a ## Model Routing section');
  return m[1];
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
  for (const flag of ['--workspace-root', '--harness', '--tier', '--json']) {
    assert.ok(section.includes(flag), `resolver invocation must pass ${flag}`);
  }
  for (const key of CANONICAL) {
    assert.ok(section.includes(key), `canonical tier key ${key} must be listed`);
  }
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
  assert.match(section, /re-?resolv/i, 'reclassification must trigger re-resolution');
});

test('the no-code rule is scoped to the parent context', () => {
  const { body } = readAgent();
  assert.ok(!/\*\*You do not write code\.\*\*/.test(body), 'unscoped parent prohibition must be gone');
  assert.match(body, /parent context does not implement code/i, 'scoped parent rule must be present');
  assert.match(body, /Linus may implement within its isolated child context/i,
    'child persona implementation permission must be explicit');
});
