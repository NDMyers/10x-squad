'use strict';

// Vivaldi's doctrine has one source (assets/vivaldi/core.md) and two harness
// entrypoints composed from it. These tests hold the composition honest: the
// shared body must be genuinely shared, and each dispatch section must carry
// only its own surface's contract.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { composeVivaldi, harnessEntrypoints } = require('../lib/compose');

const vivaldiRoot = path.resolve(__dirname, '..', 'assets', 'vivaldi');

function frontmatterAndBody(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, 'composed entrypoint must have YAML frontmatter');
  return { frontmatter: m[1], body: m[2] };
}

test('composition is deterministic', () => {
  for (const harness of Object.keys(harnessEntrypoints)) {
    assert.equal(composeVivaldi(harness), composeVivaldi(harness), `${harness} composition must be stable`);
  }
});

test('an unknown harness is rejected rather than silently composed', () => {
  assert.throws(() => composeVivaldi('gemini'), /Unknown Vivaldi harness: gemini/);
});

test('core.md carries the dispatch marker and no dispatch content of its own', () => {
  const core = fs.readFileSync(path.join(vivaldiRoot, 'core.md'), 'utf8');

  assert.ok(core.includes('{{DISPATCH}}\n'), 'core.md must contain the {{DISPATCH}} marker');
  assert.ok(!core.includes('## Model Routing'), 'core.md must not carry a Model Routing section');
});

test('every harness entrypoint shares the same core body', () => {
  const core = fs.readFileSync(path.join(vivaldiRoot, 'core.md'), 'utf8');
  const [shared] = core.split('{{DISPATCH}}\n');

  for (const harness of Object.keys(harnessEntrypoints)) {
    const { body } = frontmatterAndBody(composeVivaldi(harness));
    assert.ok(body.startsWith(shared), `${harness} entrypoint must start with the shared core body`);
  }
});

test('each entrypoint composes in exactly one Model Routing section', () => {
  for (const harness of Object.keys(harnessEntrypoints)) {
    const { body } = frontmatterAndBody(composeVivaldi(harness));
    const occurrences = body.split('## Model Routing').length - 1;
    assert.equal(occurrences, 1, `${harness} must have exactly one Model Routing section`);
    assert.ok(!body.includes('{{DISPATCH}}'), `${harness} must not leak the dispatch marker`);
  }
});

test('no entrypoint pins a parent model', () => {
  for (const harness of Object.keys(harnessEntrypoints)) {
    const { frontmatter } = frontmatterAndBody(composeVivaldi(harness));
    assert.ok(!/^model\s*:/m.test(frontmatter), `${harness} parent model must stay manually selected`);
  }
});

test('the Codex entrypoint is named as a skill and the Copilot one as an agent', () => {
  const codex = frontmatterAndBody(composeVivaldi('codex'));
  const copilot = frontmatterAndBody(composeVivaldi('copilot'));

  assert.match(codex.frontmatter, /^name: 10x-squad-vivaldi$/m);
  assert.match(copilot.frontmatter, /^name: 10x-squad$/m);
});

test('dispatch sections do not cross surfaces', () => {
  const codex = composeVivaldi('codex');
  const copilot = composeVivaldi('copilot');

  // Copilot's actuators must not appear in the Codex contract.
  for (const copilotOnly of ['runSubagent', 'copilot-cli', 'context_tier` argument']) {
    assert.ok(!codex.includes(copilotOnly), `Codex entrypoint must not reference ${copilotOnly}`);
  }

  // ...and Codex's must not appear in Copilot's.
  for (const codexOnly of ['spawn_agent', 'multi_agent_v2', 'wait_agent']) {
    assert.ok(!copilot.includes(codexOnly), `Copilot entrypoint must not reference ${codexOnly}`);
  }
});

test('the Codex dispatch contract states its surface limits', () => {
  const codex = composeVivaldi('codex');

  // Each of these is a spike finding that must survive editing.
  assert.match(codex, /--harness codex-cli/, 'must resolve with the codex-cli harness key');
  assert.match(codex, /root session only/i, 'must require the root session (max_depth defaults to 1)');
  assert.match(codex, /multi_agent_v2/, 'must state the feature-flag precondition');
  assert.match(codex, /no agent-name or `agent_type` parameter/i, 'must state that custom agent TOMLs are unaddressable');
  assert.match(codex, /Never claim executed-model verification on Codex/i, 'must forbid claiming identity verification');
  assert.match(codex, /`context_tier` has no Codex analog|context_tier` resolves to `auto`/, 'must neutralize context_tier');
});
