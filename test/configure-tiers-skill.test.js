'use strict';

// Package contract for the 10x-squad-configure-tiers skill. Deliberately NOT a
// wording snapshot: it asserts structure, referenced resources, canonical
// vocabulary, and engine-command usage. Conversational quality is owned by
// forward tests and the harness dispatch spike.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SKILL_DIR = path.join(__dirname, '..', 'assets', 'skills', '10x-squad-configure-tiers');
const SKILL_MD = path.join(SKILL_DIR, 'SKILL.md');
const MODEL_RESOLUTION_MD = path.join(SKILL_DIR, 'references', 'model-resolution.md');
const MODEL_ID_RESOLVER = path.join(SKILL_DIR, 'scripts', 'model-id-resolver.js');

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

function runModelIdResolver(command, inputPath) {
  return spawnSync(process.execPath, [MODEL_ID_RESOLVER, command, '--input', inputPath], {
    encoding: 'utf8',
  });
}

function documentedSession() {
  const reference = readModelResolution();
  const match = reference.match(
    /<!-- executable-session-example:start -->\s*```json\n([\s\S]*?)\n```\s*<!-- executable-session-example:end -->/u
  );
  assert.ok(match, 'model-resolution.md must contain the marked fenced JSON SESSION example');
  return JSON.parse(match[1]);
}

function referenceSection(heading) {
  const reference = readModelResolution();
  const marker = `## ${heading}`;
  const start = reference.indexOf(marker);
  assert.ok(start >= 0, `model-resolution.md must contain ${marker}`);
  const next = reference.indexOf('\n## ', start + marker.length);
  return reference.slice(start, next < 0 ? undefined : next);
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

test('the documented SESSION wrapper executes through both resolver gates', () => {
  const session = documentedSession();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'configure-tiers-doc-session-'));
  const inputPath = path.join(scratch, 'SESSION.json');

  try {
    const selections = Object.values(session.selections);
    const exact = selections.find((selection) => selection.resolution.state === 'exact');
    const likely = selections.find((selection) => selection.resolution.state === 'likely');
    assert.ok(exact, 'documented SESSION must include an exact selection');
    assert.ok(likely, 'documented SESSION must include a likely selection');
    assert.equal(likely.confirmed, true, 'likely confirmation must be a selection sibling');
    assert.equal(Object.hasOwn(likely.resolution, 'confirmed'), false,
      'confirmed must never be nested inside resolution');

    const resolveCases = [
      [exact, exact.resolution.candidate],
      [likely, 'GPT-5.5 Thinking XHigh Effort'],
    ];
    for (const [selection, userInput] of resolveCases) {
      fs.writeFileSync(inputPath, JSON.stringify({
        harness: session.harness,
        user_input: userInput,
        catalog: session.catalog,
      }));
      const result = runModelIdResolver('resolve', inputPath);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(selection.resolution, JSON.parse(result.stdout),
        'resolution wrapper must retain the entire resolver stdout object unchanged');
    }

    fs.writeFileSync(inputPath, JSON.stringify(session));
    const verificationResult = runModelIdResolver('verification-targets', inputPath);
    assert.equal(verificationResult.status, 0, verificationResult.stderr);
    const verification = JSON.parse(verificationResult.stdout);
    assert.deepEqual(Object.keys(verification.assignments), CANONICAL);
    assert.equal(Object.keys(verification.assignments).length, 5);
    assert.deepEqual(
      verification.verification_targets,
      [...new Set(Object.values(verification.assignments))]
    );

    session.probes = Object.fromEntries(verification.verification_targets.map((model, index) => [
      model,
      {
        ok: true,
        requested_model: model,
        identity_observable: false,
        checked_at: new Date(Date.UTC(2026, 6, 13, 1, index)).toISOString(),
      },
    ]));
    fs.writeFileSync(inputPath, JSON.stringify(session));
    const profileResult = runModelIdResolver('build-profile', inputPath);
    assert.equal(profileResult.status, 0, profileResult.stderr);
    const profile = JSON.parse(profileResult.stdout);
    assert.deepEqual(profile.assignments, verification.assignments);
    assert.deepEqual(Object.keys(profile.model_checks), verification.verification_targets);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('model resolution defines explicit catalog adapters for both active harnesses', () => {
  const reference = readModelResolution();
  assert.deepEqual(
    [
      reference.includes('## copilot-vscode adapter'),
      reference.includes('## copilot-cli adapter'),
    ],
    [true, true]
  );
});

test('the copilot-cli adapter fails before child launch to acquire only live exact labels', () => {
  const adapter = referenceSection('copilot-cli adapter');
  assert.match(adapter, /active CLI child dispatch tool.*`task`/i);
  assert.match(adapter, /`__10x_catalog_probe__`/);
  assert.match(adapter, /fail(?:s|ure) before child launch/i);
  assert.match(adapter, /`Available models`/);
  assert.match(adapter, /only (?:the )?exact returned labels/i);
  assert.match(adapter, /filter forbidden.*preserv.*byte-for-byte/is);
  assert.match(adapter, /no reliable list.*STOP.*raw harness error/is);
  assert.match(adapter,
    /never use.*help.*documentation.*another surface.*hardcoded/is);
});

test('session scratch storage is collision-safe and cleaned on every exit', () => {
  const { body } = readSkill();
  const contract = `${body}\n${readModelResolution()}`;

  assert.match(contract, /unique,? session-owned scratch directory/i);
  assert.match(contract, /scratch directory.*outside `?\.10x-squad`?/is);
  assert.match(contract, /refus(?:e|es).*overwrite.*pre-existing/is);
  assert.match(contract,
    /cleanup.*unconditional.*finally-style.*success.*cancellation.*hard-block\/stop.*error.*interruption/is);
  assert.match(contract, /never.*(?:place|create).*\.10x-squad.*commit/is);
});
