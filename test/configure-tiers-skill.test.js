'use strict';

// Package contract for the 10x-squad-configure-tiers skill. Deliberately NOT a
// wording snapshot: it asserts structure, referenced resources, canonical
// vocabulary, and engine-command usage. Conversational quality is owned by
// forward tests and the harness dispatch spike.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILL_DIR = path.join(__dirname, '..', 'assets', 'skills', '10x-squad-configure-tiers');
const SKILL_MD = path.join(SKILL_DIR, 'SKILL.md');
const MODEL_RESOLUTION_MD = path.join(SKILL_DIR, 'references', 'model-resolution.md');

const CANONICAL = ['trivial', 'lite', 'standard_clear', 'standard_ambiguous', 'complex'];

function readSkill() {
  const raw = fs.readFileSync(SKILL_MD, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, 'SKILL.md must start with a YAML frontmatter block');
  const frontmatter = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) frontmatter[kv[1]] = kv[2].replace(/^"|"$/g, '');
  }
  return { frontmatter, body: m[2], raw };
}

function readModelResolution() {
  return fs.existsSync(MODEL_RESOLUTION_MD) ? fs.readFileSync(MODEL_RESOLUTION_MD, 'utf8') : '';
}

test('frontmatter is limited to a valid name and description', () => {
  const { frontmatter } = readSkill();
  assert.deepEqual(Object.keys(frontmatter).sort(), ['description', 'name']);
  assert.equal(frontmatter.name, '10x-squad-configure-tiers');
  assert.ok(frontmatter.description.length >= 40, 'description must be informative');
  assert.ok(!/TODO/i.test(frontmatter.description), 'description must not be template text');
});

test('bundled resources are referenced by valid relative paths and exist', () => {
  const { body } = readSkill();
  for (const rel of [
    'scripts/model-tier-config.js',
    'scripts/model-id-resolver.js',
    'references/config-format.md',
    'references/model-resolution.md',
  ]) {
    assert.ok(body.includes(rel), `SKILL.md must reference ${rel}`);
    assert.ok(fs.existsSync(path.join(SKILL_DIR, rel)), `${rel} must exist in the skill package`);
  }
  assert.ok(fs.existsSync(path.join(SKILL_DIR, 'agents', 'openai.yaml')), 'UI metadata must exist');
});

test('both configuration flows and all five canonical tier keys are described', () => {
  const { body } = readSkill();
  for (const key of CANONICAL) {
    assert.ok(body.includes(key), `SKILL.md must name canonical key ${key}`);
  }
  assert.match(body, /all five work tiers/i, 'default-all flow must be described');
  assert.match(body, /each (work )?tier individually|individual/i, 'individual flow must be described');
});

test('the skill drives the harness-aware engine commands, not direct file edits', () => {
  const { body } = readSkill();
  for (const cmd of ['validate-profile', 'diff-profile', 'upsert-profile', 'remove-profile', 'resolve']) {
    assert.ok(body.includes(cmd), `SKILL.md must use the ${cmd} engine command`);
  }
  assert.match(body, /never edit .*model-routing\.json.* (directly|by hand)/i,
    'SKILL.md must forbid editing the config file directly');
});

test('no retired routing vocabulary or auto/inherit assignment guidance', () => {
  const { body } = readSkill();
  assert.ok(!/frontier1|frontier2|higher-tier|economy[- ]tier/i.test(body),
    'retired tier taxonomy must not appear');
  assert.match(body, /auto.*(banned|never|rejected|invalid)/i,
    'auto must be identified as an invalid assignment');
});

test('the write path is a low-freedom ordered workflow', () => {
  const { body } = readSkill();
  const labels = [
    'Acquire the active harness catalog',
    'Resolve every selected value',
    'Verify each unique resolved identifier',
    'Build the gated profile',
    'Preview before writing',
    'Write',
    'Prove the result',
  ];

  let previousIndex = -1;
  for (const label of labels) {
    const labelIndex = body.indexOf(label);
    assert.ok(labelIndex > previousIndex, `${label} must appear after the previous workflow label`);
    previousIndex = labelIndex;
  }

  const verificationTargetsIndex = body.indexOf('verification-targets');
  const buildProfileIndex = body.indexOf('build-profile');
  const diffProfileIndex = body.indexOf('diff-profile');
  assert.ok(verificationTargetsIndex >= 0, 'SKILL.md must invoke verification-targets');
  assert.ok(buildProfileIndex > verificationTargetsIndex,
    'build-profile must be invoked after verification-targets');
  assert.ok(diffProfileIndex > buildProfileIndex,
    'diff-profile must be invoked after build-profile');
});

test('every model source is resolved against one live selectable catalog', () => {
  const { body } = readSkill();
  const contract = `${body}\n${readModelResolution()}`;

  assert.match(contract, /free text is `?user intent`?.*never assumed to be an exact identifier/i);
  assert.match(contract, /exact catalog matches pass through/i);
  assert.match(contract, /likely matches require affirmative confirmation/i);
  assert.match(contract, /ambiguous and `?no_match`?.*stop before preview\/write/i);
  assert.match(contract, /`?no_match`?.*full selectable list/i);
  assert.match(contract, /Auto \(copilot\)/);
  assert.match(contract, /Auto \(copilot\).*excluded.*banned/is);
  assert.match(contract, /only exact active-catalog strings enter `?assignments`?/i);
  assert.match(contract, /every source.*keep-current.*user intent.*resolution against the catalog/is);
});

test('verification gates every unique resolved identifier before proposal construction', () => {
  const { body } = readSkill();
  const contract = `${body}\n${readModelResolution()}`;

  assert.match(contract, /verification is deduplicated by unique identifier/i);
  assert.match(contract, /(?:observed )?(?:substitution|mismatch).*hard-block/is);
  assert.match(contract, /(?:unavailability|unavailable).*hard-block/is);
  assert.match(contract, /addressability_probe.*unverified/is);
  assert.match(contract,
    /dispatch_smoke_test.*verified.*requested.*executed.*observable.*byte-equal/is);
  assert.match(contract, /catalog membership alone.*must still probe/is);
});

test('resolver output is the sole persisted profile proposal', () => {
  const { body } = readSkill();
  const contract = `${body}\n${readModelResolution()}`;

  assert.match(contract, /original_input.*never stored/i);
  assert.match(contract, /final success is forbidden.*unresolved or unaddressable/i);
  assert.match(contract,
    /(?:must not|never) manually (?:assemble|build).*assignments.*model_checks/is);
  assert.match(contract,
    /build-profile.*stdout JSON unchanged.*(?:diff-profile|proposal input)/is);
});
