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
  for (const codexOnly of ['spawn_agent', 'codex-app', 'wait_agent']) {
    assert.ok(!copilot.includes(codexOnly), `Copilot entrypoint must not reference ${codexOnly}`);
  }
});

test('the Codex dispatch contract separates surface detection from call shape', () => {
  const codex = composeVivaldi('codex');

  // Probe I2: both surfaces default to the v1 toolset and either can be moved to
  // v2 by a flag, so the call shape does NOT follow from the surface. Conflating
  // them would be wrong on both surfaces at once.
  assert.match(codex, /Detect each separately\. Neither predicts the other\./);

  // v1 has no task_name and its wait is keyed by the returned agent_id, which is
  // unrecoverable once discarded (no list_agents on that toolset).
  assert.match(codex, /no `task_name` parameter/, 'must state that v1 has no task_name');
  assert.match(codex, /agent_id/, 'must state how a v1 child is collected');

  // The two signals that do NOT discriminate — both surfaces resolve the same
  // binary on PATH and report the same version.
  assert.match(
    codex,
    /Do not use the `codex` binary path or `codex --version` to identify the surface/,
    'must rule out the two signals that failed in Probe F7'
  );
});

test('the Codex dispatch contract states its surface limits', () => {
  const codex = composeVivaldi('codex');

  // Each of these is a spike finding that must survive editing.
  assert.match(codex, /--harness <detected-surface>/, 'must resolve with the detected surface, not a hardcoded key');
  assert.match(codex, /CODEX_INTERNAL_ORIGINATOR_OVERRIDE/, 'must state the surface discriminator (C11)');
  assert.match(codex, /root session only/i, 'must require the root session (max_depth defaults to 1)');
  assert.match(codex, /model.*and.*reasoning_effort.*must exist/i, 'must gate on the actuator existing, not on a feature flag');
  assert.match(codex, /no agent-name or `agent_type` parameter/i, 'must state that custom agent TOMLs are unaddressable');
  assert.match(codex, /Never claim executed-model verification on Codex/i, 'must forbid claiming identity verification');
  assert.match(codex, /`context_tier` has no Codex analog|context_tier` resolves to `auto`/, 'must neutralize context_tier');
});
