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
const CONFIG_FORMAT_MD = path.join(SKILL_DIR, 'references', 'config-format.md');
const MODEL_RESOLUTION_MD = path.join(SKILL_DIR, 'references', 'model-resolution.md');
const OPENAI_YAML = path.join(SKILL_DIR, 'agents', 'openai.yaml');
const OPERATOR_GUIDE = path.join(__dirname, '..', 'docs', 'model-tier-configuration.md');
const README_MD = path.join(__dirname, '..', 'README.md');

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

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function documentedResolverCommand(subcommand) {
  const commands = [...readModelResolution().matchAll(/```(?:text|sh)\n([\s\S]*?)\n```/gu)]
    .map((match) => match[1].trim())
    .filter((command) => (
      !command.includes('\n')
      && command.includes('model-id-resolver.js')
      && command.includes(` ${subcommand} --input `)
    ));
  assert.equal(commands.length, 1, `expected one fenced ${subcommand} command`);
  return commands[0];
}

function documentedConfigCommand(subcommand) {
  const commands = [...readModelResolution().matchAll(/```(?:text|sh)\n([\s\S]*?)\n```/gu)]
    .map((match) => match[1].trim())
    .filter((command) => (
      !command.includes('\n')
      && command.includes('model-tier-config.js')
      && command.includes(` ${subcommand} `)
    ));
  assert.equal(commands.length, 1, `expected one fenced ${subcommand} command`);
  return commands[0];
}

function runDocumentedCommand(command, options) {
  return spawnSync('/bin/sh', ['-c', command], {
    encoding: 'utf8',
    ...options,
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

test('no retired routing vocabulary or model auto/inherit assignment guidance', () => {
  const { body } = readSkill();
  assert.ok(!/frontier1|frontier2|higher-tier|economy[- ]tier/i.test(body),
    'retired tier taxonomy must not appear');
  assert.match(body, /(?:model|assignment).*`?auto`?.*(?:banned|never|rejected|invalid)/i,
    'model Auto must be identified as an invalid assignment');
});

test('one tier profile combines an exact model with reasoning and context choices', () => {
  const { body } = readSkill();
  const contract = [
    body,
    readText(CONFIG_FORMAT_MD),
    readModelResolution(),
    readText(OPERATOR_GUIDE),
  ].join('\n');

  assert.match(contract, /(?:each|one) work-tier profile.*model.*reasoning.*context/is);
  assert.match(contract, /reasoning_effort.*`?auto`?.*`?low`?.*`?medium`?.*`?high`?.*`?xhigh`?/is);
  assert.match(contract, /context_tier.*`?auto`?.*`?default`?.*`?long_context`?/is);
  assert.match(contract, /(?:choose|choice|offer).*(?:explicit.*or `?auto`?|`?auto`?.*or explicit).*reasoning/is);
  assert.match(contract, /(?:choose|choice|offer).*(?:explicit.*or `?auto`?|`?auto`?.*or explicit).*context/is);
});

test('runtime auto omits only its own dispatch argument and is not model Auto or inheritance', () => {
  const { body } = readSkill();
  const contract = `${body}\n${readModelResolution()}\n${readText(OPERATOR_GUIDE)}`;

  assert.match(contract, /`auto`.*omit.*(?:corresponding|that) dispatch argument/is);
  assert.match(contract, /(?:independently|one setting.*without.*other)/is);
  assert.match(contract, /active harness.*(?:adaptive|default) behavior/is);
  assert.match(contract, /not.*(?:Copilot )?model Auto/is);
  assert.match(contract, /not.*parent (?:model )?inheritance|not.*inherit.*parent/is);
  assert.match(contract, /never (?:reconstruct|add).*`auto`/is);
});

test('new proposals contain all five complete dispatch settings entries', () => {
  const configReference = readText(CONFIG_FORMAT_MD);
  const schemaMatch = configReference.match(/## Schema[\s\S]*?```json\n([\s\S]*?)\n```/u);
  assert.ok(schemaMatch, 'config-format.md must contain a fenced schema JSON example');
  const example = JSON.parse(schemaMatch[1]);

  assert.equal(example.schema_version, 2);
  const profile = example.harnesses['copilot-cli'];
  assert.ok(profile, 'schema example must include a copilot-cli profile');
  assert.deepEqual(Object.keys(profile.assignments), CANONICAL);
  assert.deepEqual(Object.keys(profile.dispatch_settings), CANONICAL);
  for (const tier of CANONICAL) {
    assert.deepEqual(
      Object.keys(profile.dispatch_settings[tier]).sort(),
      ['context_tier', 'reasoning_effort']
    );
  }

  const contract = `${readSkill().body}\n${configReference}`;
  assert.match(contract, /every new proposal.*all five.*dispatch_settings/is);
});

test('schema-v1 reads default runtime settings and successful writes upgrade to schema v2', () => {
  const contract = `${readText(CONFIG_FORMAT_MD)}\n${readText(OPERATOR_GUIDE)}`;

  assert.match(contract, /schema[- ]v1.*(?:missing|omitted) `?dispatch_settings`?.*`?auto`?\s*\/\s*`?auto`?/is);
  assert.match(contract, /successful (?:profile )?write.*schema v2|writes? upgrade.*schema v2/is);
  assert.match(
    contract,
    /unrelated retained.*legacy profiles?.*`?dispatch_settings`?.*(?:may|can).*remain omitted/is
  );
});

test('schema-v2 omission is compatibility tolerance, not provable legacy provenance', () => {
  const reference = readText(CONFIG_FORMAT_MD);

  assert.match(
    reference,
    /schema v2.*accepts.*(?:missing|omitted) `?dispatch_settings`?.*compatibility.*stored provenance.*cannot be proven/is
  );
  assert.doesNotMatch(
    reference,
    /`?dispatch_settings`?.*may be omitted only on a retained unrelated legacy profile/i
  );
  assert.match(
    reference,
    /newly (?:built|upserted).*target profile.*all five.*`?dispatch_settings`?/is
  );
  assert.match(
    reference,
    /unrelated retained legacy profiles?.*(?:may|can).*remain omitted/is
  );
});

test('explicit runtime settings are capability-gated before any side effect', () => {
  const contract = [
    readSkill().body,
    readText(CONFIG_FORMAT_MD),
    readModelResolution(),
    readText(OPERATOR_GUIDE),
  ].join('\n');

  assert.match(contract, /only `?copilot-cli`?.*(?:allows|supports|may persist) explicit/is);
  assert.match(contract, /`?copilot-vscode`?.*(?:unknown harness|unknown surface).*explicit/is);
  assert.match(contract, /(?:either|any) setting.*explicit.*stop before.*probe.*preview.*write/is);
  assert.match(contract, /`?auto`?\s*\/\s*`?auto`?.*(?:remains|is) allowed/is);
});

test('the write path is a low-freedom ordered workflow', () => {
  const { body } = readSkill();
  const labels = [
    'Acquire the active harness catalog',
    'Resolve every selected value',
    'Verify each unique resolved tuple',
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
  const buildProfileIndex = body.indexOf(
    'node "$SKILL_ROOT/scripts/model-id-resolver.js" build-profile'
  );
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

test('verification gates every unique execution tuple before proposal construction', () => {
  const { body } = readSkill();
  const contract = `${body}\n${readModelResolution()}`;

  assert.match(contract, /verification is deduplicated by (?:the )?(?:complete|full).*tuple/i);
  assert.match(contract, /model.*reasoning_effort.*context_tier/is);
  assert.match(contract, /invoke.*exactly.*(?:target\.)?`?dispatch_arguments`?/is);
  assert.match(contract, /probes\[target\.id\]|tuple id/is);
  assert.match(contract, /requested_arguments.*raw (?:harness )?(?:observation|evidence)/is);
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
    /(?:must not|never) manually (?:assemble|build).*assignments.*dispatch_settings.*model_checks/is);
  assert.match(contract,
    /build-profile.*stdout JSON unchanged.*(?:diff-profile|proposal input)/is);
});

test('the documented resolver commands execute from an unrelated cwd through both gates', () => {
  const session = documentedSession();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'configure-tiers-doc-session-'));
  const unrelatedCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'configure-tiers-doc-cwd-'));
  const resolveInputPath = path.join(scratch, 'RESOLVE_REQUEST.json');
  const sessionInputPath = path.join(scratch, 'SESSION.json');
  const proposalInputPath = path.join(scratch, 'PROPOSAL.json');
  const workspaceRoot = path.join(scratch, 'workspace');
  const sessionOwnedPaths = new Set();
  const commandOptions = {
    cwd: unrelatedCwd,
    env: {
      ...process.env,
      SKILL_ROOT: path.resolve(SKILL_DIR),
      SESSION_SCRATCH: path.resolve(scratch),
      WORKSPACE_ROOT: path.resolve(workspaceRoot),
    },
  };
  const resolveCommand = documentedResolverCommand('resolve');
  const verificationCommand = documentedResolverCommand('verification-targets');
  const buildCommand = documentedResolverCommand('build-profile');
  let diffCommand;
  let upsertCommand;

  try {
    diffCommand = documentedConfigCommand('diff-profile');
    upsertCommand = documentedConfigCommand('upsert-profile');
    assert.equal(path.isAbsolute(commandOptions.env.SKILL_ROOT), true);
    assert.equal(path.isAbsolute(commandOptions.env.SESSION_SCRATCH), true);
    assert.equal(path.isAbsolute(commandOptions.env.WORKSPACE_ROOT), true);
    assert.equal(session.harness, 'copilot-cli',
      'mixed explicit runtime settings are supported only by the CLI harness');
    const selections = Object.values(session.selections);
    const exact = selections.find((selection) => selection.resolution.state === 'exact');
    const likely = selections.find((selection) => selection.resolution.state === 'likely');
    assert.ok(exact, 'documented SESSION must include an exact selection');
    assert.ok(likely, 'documented SESSION must include a likely selection');
    assert.equal(likely.confirmed, true, 'likely confirmation must be a selection sibling');
    assert.equal(Object.hasOwn(likely.resolution, 'confirmed'), false,
      'confirmed must never be nested inside resolution');
    for (const selection of selections) {
      assert.equal(Object.hasOwn(selection, 'reasoning_effort'), true);
      assert.equal(Object.hasOwn(selection, 'context_tier'), true);
    }
    assert.ok(selections.some((selection) => selection.reasoning_effort === 'auto'));
    assert.ok(selections.some((selection) => selection.reasoning_effort !== 'auto'));
    assert.ok(selections.some((selection) => selection.context_tier === 'auto'));
    assert.ok(selections.some((selection) => selection.context_tier !== 'auto'));

    const resolveCases = [
      [exact, exact.resolution.candidate],
      [likely, `${likely.resolution.candidate} Thinking XHigh Effort`],
    ];
    for (const [selection, userInput] of resolveCases) {
      assert.equal(fs.existsSync(resolveInputPath), false,
        'each intent must start without a pre-existing request file');
      fs.writeFileSync(resolveInputPath, JSON.stringify({
        harness: session.harness,
        user_input: userInput,
        catalog: session.catalog,
      }), { flag: 'wx' });
      try {
        const result = runDocumentedCommand(resolveCommand, commandOptions);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(selection.resolution, JSON.parse(result.stdout),
          'resolution wrapper must retain the entire resolver stdout object unchanged');
      } finally {
        fs.rmSync(resolveInputPath, { force: true });
      }
    }

    assert.equal(fs.existsSync(sessionInputPath), false,
      'verification must start without a pre-existing session file');
    fs.writeFileSync(sessionInputPath, JSON.stringify(session), { flag: 'wx' });
    sessionOwnedPaths.add(sessionInputPath);
    const verificationResult = runDocumentedCommand(verificationCommand, commandOptions);
    assert.equal(verificationResult.status, 0, verificationResult.stderr);
    const verification = JSON.parse(verificationResult.stdout);
    assert.deepEqual(Object.keys(verification.assignments), CANONICAL);
    assert.equal(Object.keys(verification.assignments).length, 5);
    assert.deepEqual(Object.keys(verification.dispatch_settings), CANONICAL);
    for (const target of verification.verification_targets) {
      assert.deepEqual(
        JSON.parse(target.id),
        [target.model, target.reasoning_effort, target.context_tier]
      );
      assert.equal(target.dispatch_arguments.model, target.model);
      assert.equal(
        Object.hasOwn(target.dispatch_arguments, 'reasoning_effort'),
        target.reasoning_effort !== 'auto'
      );
      assert.equal(
        Object.hasOwn(target.dispatch_arguments, 'context_tier'),
        target.context_tier !== 'auto'
      );
    }

    session.probes = Object.fromEntries(verification.verification_targets.map((target, index) => [
      target.id,
      {
        ok: true,
        requested_model: target.model,
        requested_arguments: { ...target.dispatch_arguments },
        identity_observable: false,
        checked_at: new Date(Date.UTC(2026, 6, 13, 1, index)).toISOString(),
      },
    ]));
    assert.equal(sessionOwnedPaths.has(sessionInputPath), true,
      'only this session may update its exclusively created session file');
    fs.writeFileSync(sessionInputPath, JSON.stringify(session));
    const profileResult = runDocumentedCommand(buildCommand, commandOptions);
    assert.equal(profileResult.status, 0, profileResult.stderr);
    const profile = JSON.parse(profileResult.stdout);
    assert.deepEqual(profile.assignments, verification.assignments);
    assert.deepEqual(profile.dispatch_settings, verification.dispatch_settings);
    assert.deepEqual(
      Object.keys(profile.model_checks),
      [...new Set(Object.values(verification.assignments))]
    );
    fs.writeFileSync(proposalInputPath, profileResult.stdout, { flag: 'wx' });
    fs.mkdirSync(workspaceRoot, { recursive: true });
    const diffResult = runDocumentedCommand(diffCommand, commandOptions);
    assert.equal(diffResult.status, 0, diffResult.stderr);
    const upsertResult = runDocumentedCommand(upsertCommand, commandOptions);
    assert.equal(upsertResult.status, 0, upsertResult.stderr);
    const stored = JSON.parse(fs.readFileSync(
      path.join(workspaceRoot, '.10x-squad', 'model-routing.json'),
      'utf8'
    ));
    assert.equal(stored.schema_version, 2);
    assert.deepEqual(stored.harnesses['copilot-cli'].dispatch_settings, verification.dispatch_settings);
    assert.deepEqual(fs.readdirSync(unrelatedCwd), [], 'commands must not use cwd for transient files');
    assert.equal(
      resolveCommand,
      'node "$SKILL_ROOT/scripts/model-id-resolver.js" resolve --input "$SESSION_SCRATCH/RESOLVE_REQUEST.json"'
    );
    assert.equal(
      verificationCommand,
      'node "$SKILL_ROOT/scripts/model-id-resolver.js" verification-targets --input "$SESSION_SCRATCH/SESSION.json"'
    );
    assert.equal(
      buildCommand,
      'node "$SKILL_ROOT/scripts/model-id-resolver.js" build-profile --input "$SESSION_SCRATCH/SESSION.json"'
    );
    assert.equal(
      diffCommand,
      'node "$SKILL_ROOT/scripts/model-tier-config.js" diff-profile --input "$SESSION_SCRATCH/PROPOSAL.json" --scope workspace --workspace-root "$WORKSPACE_ROOT" --harness copilot-cli'
    );
    assert.equal(
      upsertCommand,
      'node "$SKILL_ROOT/scripts/model-tier-config.js" upsert-profile --input "$SESSION_SCRATCH/PROPOSAL.json" --scope workspace --workspace-root "$WORKSPACE_ROOT" --harness copilot-cli'
    );
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(unrelatedCwd, { recursive: true, force: true });
  }
});

test('the skill records absolute cwd-independent scratch roots', () => {
  const { body } = readSkill();
  assert.match(body,
    /bind absolute `SKILL_ROOT`.*absolute `SESSION_SCRATCH`.*command environment/is);
  assert.match(body, /never rely on (?:the )?(?:current working directory|cwd)/i);
  assert.match(body, /every transient.*`SESSION_SCRATCH`/is);
  for (const command of [
    'node "$SKILL_ROOT/scripts/model-id-resolver.js" resolve --input "$SESSION_SCRATCH/RESOLVE_REQUEST.json"',
    'node "$SKILL_ROOT/scripts/model-id-resolver.js" verification-targets --input "$SESSION_SCRATCH/SESSION.json"',
    'node "$SKILL_ROOT/scripts/model-id-resolver.js" build-profile --input "$SESSION_SCRATCH/SESSION.json"',
    'node "$SKILL_ROOT/scripts/model-tier-config.js" diff-profile --input "$SESSION_SCRATCH/PROPOSAL.json" --scope workspace --workspace-root "$WORKSPACE_ROOT" --harness copilot-cli',
    'node "$SKILL_ROOT/scripts/model-tier-config.js" upsert-profile --input "$SESSION_SCRATCH/PROPOSAL.json" --scope workspace --workspace-root "$WORKSPACE_ROOT" --harness copilot-cli',
  ]) {
    assert.ok(body.includes(command), `SKILL.md must use cwd-independent command: ${command}`);
  }
});

test('UI metadata, operator guide, and README expose the three-part tier contract', () => {
  const metadata = readText(OPENAI_YAML);
  const operatorGuide = readText(OPERATOR_GUIDE);
  const readme = readText(README_MD);

  assert.match(metadata, /model.*reasoning.*context/is);
  assert.match(metadata, /\$10x-squad-configure-tiers/);
  for (const text of [operatorGuide, readme]) {
    assert.match(text, /work-tier.*model.*reasoning.*context/is);
    assert.match(text, /runtime `?auto`?.*(?:omit|omits|omitted)/is);
  }
  assert.match(operatorGuide, /copilot-cli.*explicit.*reasoning.*context/is);
  assert.match(operatorGuide, /copilot-vscode.*`?auto`?\s*\/\s*`?auto`?/is);
});

test('public docs promise live catalog discovery and named context tiers, not hardcoded choices or sizes', () => {
  const contract = [
    readSkill().body,
    readModelResolution(),
    readText(CONFIG_FORMAT_MD),
    readText(OPERATOR_GUIDE),
    readText(README_MD),
  ].join('\n');

  assert.match(contract, /never hardcode selectable model (?:names|identifiers)/i);
  assert.match(contract, /`long_context`.*(?:harness label|named tier)/is);
  assert.match(contract, /(?:no|never promise).*numeric context (?:size|window)/is);
  assert.doesNotMatch(contract, /\b\d+(?:,\d{3})*\s*(?:tokens?|k[- ]?tokens?)\b/i);
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
  const reference = readModelResolution();
  const contract = `${body}\n${reference}`;

  assert.match(contract, /unique,? session-owned scratch directory/i);
  assert.match(contract, /scratch directory.*outside `?\.10x-squad`?/is);
  assert.match(contract, /refus(?:e|es).*overwrite.*pre-existing/is);
  assert.match(contract,
    /cleanup.*unconditional.*finally-style.*success.*cancellation.*hard-block\/stop.*error.*interruption/is);
  assert.match(contract, /never.*(?:place|create).*\.10x-squad.*commit/is);
  assert.match(reference,
    /bind.*`SKILL_ROOT`.*`SESSION_SCRATCH`.*command environment/is);
  assert.match(reference,
    /create.*RESOLVE_REQUEST\.json.*exclusive.*remove.*per-invocation.*finally.*before.*next model intent/is);
  assert.match(reference,
    /create.*SESSION\.json.*exclusive/is);
  assert.match(reference,
    /never overwrite.*(?:not|was not).*(?:created|owned).*session/is);
});
