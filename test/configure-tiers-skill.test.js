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
const PERSONAS = ['einstein', 'peter', 'linus', 'cobalt', 'sentinel', 'ralph'];
const LANES = { thinker: ['einstein', 'peter'], builder: ['linus', 'ralph'], reviewer: ['cobalt', 'sentinel'] };

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

function documentedPlan() {
  const reference = readModelResolution();
  const match = reference.match(
    /<!-- executable-plan-example:start -->\s*```json\n([\s\S]*?)\n```\s*<!-- executable-plan-example:end -->/u
  );
  assert.ok(match, 'model-resolution.md must contain the marked fenced JSON PLAN example');
  return JSON.parse(match[1]);
}

function allAutoVscodePlan() {
  const plan = documentedPlan();
  plan.harness = 'copilot-vscode';
  plan.catalog.harness = 'copilot-vscode';
  for (const lane of Object.values(plan.plan.lanes)) {
    lane.model.harness = 'copilot-vscode';
    for (const tier of CANONICAL) {
      lane.effort_curve[tier] = 'auto';
      lane.context_curve[tier] = 'auto';
    }
  }
  return plan;
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

test('all four entry paths and every canonical routing key are described', () => {
  const { body } = readSkill();
  for (const key of [...CANONICAL, ...PERSONAS]) {
    assert.ok(body.includes(key), `SKILL.md must name canonical key ${key}`);
  }

  assert.match(body, /role lanes/i, 'role-lane path must be described');
  assert.match(body, /recommended/i, 'role lanes must be marked recommended');
  assert.match(body, /default-all/i, 'default-all path must be described');
  assert.match(body, /per work tier|each work tier/i, 'per-tier path must be described');
  assert.match(body, /full matrix|thirty|30/i, 'full-matrix path must be described');

  // Lanes must name their members, or a user cannot tell what three answers buy.
  for (const [lane, members] of Object.entries(LANES)) {
    const laneIndex = body.toLowerCase().indexOf(lane);
    assert.ok(laneIndex >= 0, `SKILL.md must name the ${lane} lane`);
    const window = body.slice(laneIndex, laneIndex + 200);
    for (const member of members) {
      assert.ok(window.includes(member), `the ${lane} lane must name ${member}`);
    }
  }

  assert.match(body, /no inheritance rule, lane marker, role marker, or entry-path marker is ever stored/i);
});

test('vivaldi is advisory only and never a dispatch assignment', () => {
  const contract = [readSkill().body, readText(CONFIG_FORMAT_MD), readModelResolution()].join('\n');

  assert.match(contract, /advisory/i);
  assert.match(contract, /cannot (?:select|set|change) its own model|never actuated|root session/i);
  assert.match(contract, /parent catalog, not (?:its |the )?spawn catalog/i);
  assert.match(contract, /never probed/i);
  assert.ok(!PERSONAS.includes('vivaldi'));
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

  assert.match(contract, /(?:each|one).*profile.*model.*reasoning.*context/is);
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

test('new proposals contain all thirty complete dispatch settings entries', () => {
  const configReference = readText(CONFIG_FORMAT_MD);
  const schemaMatch = configReference.match(/## Schema[\s\S]*?```json\n([\s\S]*?)\n```/u);
  assert.ok(schemaMatch, 'config-format.md must contain a fenced schema JSON example');
  const example = JSON.parse(schemaMatch[1]);

  assert.equal(example.schema_version, 3);
  const profile = example.harnesses['copilot-cli'];
  assert.ok(profile, 'schema example must include a copilot-cli profile');
  assert.deepEqual(Object.keys(profile.assignments), PERSONAS);
  assert.deepEqual(Object.keys(profile.dispatch_settings), PERSONAS);
  for (const persona of PERSONAS) {
    assert.deepEqual(Object.keys(profile.assignments[persona]), CANONICAL, persona);
    assert.deepEqual(Object.keys(profile.dispatch_settings[persona]), CANONICAL, persona);
    for (const tier of CANONICAL) {
      assert.deepEqual(
        Object.keys(profile.dispatch_settings[persona][tier]).sort(),
        ['context_tier', 'reasoning_effort']
      );
    }
  }

  // The advisory row is a sibling of assignments, never a persona inside it,
  // and carries no context_tier.
  assert.deepEqual(Object.keys(profile.advisory), ['vivaldi']);
  assert.deepEqual(Object.keys(profile.advisory.vivaldi), CANONICAL);
  for (const tier of CANONICAL) {
    assert.deepEqual(Object.keys(profile.advisory.vivaldi[tier]).sort(), ['model', 'reasoning_effort']);
  }

  const contract = `${readSkill().body}\n${configReference}`;
  assert.match(contract, /every new proposal.*all thirty.*dispatch_settings/is);
});

test('schema-v1 reads default runtime settings and successful writes upgrade to schema v2', () => {
  const contract = `${readText(CONFIG_FORMAT_MD)}\n${readText(OPERATOR_GUIDE)}`;

  assert.match(contract, /schema[- ]v1.*(?:missing|omitted) `?dispatch_settings`?.*`?auto`?\s*\/\s*`?auto`?/is);
  assert.match(contract, /successful (?:profile )?write.*schema v3|writes? upgrade.*schema v3/is);
  assert.match(
    contract,
    /unrelated retained.*legacy profiles?.*`?dispatch_settings`?.*(?:may|can).*remain omitted/is
  );
});

test('schema-v2 omission is compatibility tolerance, not provable legacy provenance', () => {
  const reference = readText(CONFIG_FORMAT_MD);

  assert.match(
    reference,
    /schema v3.*accepts.*(?:missing|omitted) `?dispatch_settings`?.*compatibility.*stored provenance.*cannot be proven/is
  );
  assert.doesNotMatch(
    reference,
    /`?dispatch_settings`?.*may be omitted only on a retained unrelated legacy profile/i
  );
  assert.match(
    reference,
    /newly (?:built|upserted).*target profile.*all thirty.*`?dispatch_settings`?/is
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

  // copilot-cli and codex-cli are the surfaces that persist explicit settings;
  // codex-cli's context_tier is auto-only (no Codex context parameter).
  assert.match(contract, /`?copilot-cli`?.*(?:allows|supports|accepts).*explicit/is);
  assert.match(contract, /`?codex-cli`?.*(?:reasoning|context).*(?:auto|explicit)/is);
  assert.match(contract, /`?copilot-vscode`?.*(?:unknown harness|unknown surface).*(?:explicit|auto)/is);
  assert.match(contract, /(?:either|any|a) setting.*(?:explicit|vocabulary).*(?:stop|hard-stop).*(?:probe|preview|write)/is);
  assert.match(contract, /`?auto`?\s*\/\s*`?auto`?.*(?:remains|is) allowed/is);
});

test('the write path is a low-freedom ordered workflow', () => {
  const { body } = readSkill();
  const labels = [
    'Acquire the active harness catalog',
    'Resolve every selected value',
    'Expand the chosen path into the full matrix',
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

  const expandIndex = body.indexOf(
    'node "$SKILL_ROOT/scripts/model-id-resolver.js" expand-selections'
  );
  const verificationTargetsIndex = body.indexOf('verification-targets');
  const buildProfileIndex = body.indexOf(
    'node "$SKILL_ROOT/scripts/model-id-resolver.js" build-profile'
  );
  const diffProfileIndex = body.indexOf('diff-profile');
  assert.ok(expandIndex >= 0, 'SKILL.md must invoke expand-selections');
  assert.ok(verificationTargetsIndex > expandIndex,
    'verification-targets must be invoked after the matrix is expanded');
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
  assert.match(contract, /`?expand-selections`? is the \*\*sole selections builder\*\*|sole selections builder/i);
  assert.match(contract,
    /build-profile.*stdout JSON unchanged.*(?:diff-profile|proposal input)/is);
});

function runDocumentedConfigurationScenario({ plan, targetScope }) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'configure-tiers-doc-session-'));
  const unrelatedCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'configure-tiers-doc-cwd-'));
  const resolveInputPath = path.join(scratch, 'RESOLVE_REQUEST.json');
  const planInputPath = path.join(scratch, 'PLAN.json');
  const sessionInputPath = path.join(scratch, 'SESSION.json');
  const proposalInputPath = path.join(scratch, 'PROPOSAL.json');
  const workspaceRoot = path.join(scratch, 'workspace');
  const xdgConfigHome = path.join(scratch, 'xdg');
  const workspaceConfigPath = path.join(workspaceRoot, '.10x-squad', 'model-routing.json');
  const globalConfigPath = path.join(xdgConfigHome, '10x-squad', 'model-routing.json');
  const sessionOwnedPaths = new Set();
  const commandOptions = {
    cwd: unrelatedCwd,
    env: {
      ...process.env,
      SKILL_ROOT: path.resolve(SKILL_DIR),
      SESSION_SCRATCH: path.resolve(scratch),
      WORKSPACE_ROOT: path.resolve(workspaceRoot),
      XDG_CONFIG_HOME: path.resolve(xdgConfigHome),
      ACTIVE_HARNESS: plan.harness,
      TARGET_SCOPE: targetScope,
    },
  };
  const resolveCommand = documentedResolverCommand('resolve');
  const expandCommand = documentedResolverCommand('expand-selections');
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
    assert.ok(['global', 'workspace'].includes(commandOptions.env.TARGET_SCOPE));
    assert.equal(commandOptions.env.ACTIVE_HARNESS, plan.harness);

    // The documented plan must exercise both matching states and, on a surface
    // that supports them, both explicit and `auto` runtime choices.
    const lanes = Object.values(plan.plan.lanes);
    assert.deepEqual(Object.keys(plan.plan.lanes).sort(), ['builder', 'reviewer', 'thinker']);
    const exact = lanes.find((lane) => lane.model.state === 'exact');
    const likely = lanes.find((lane) => lane.model.state === 'likely');
    assert.ok(exact, 'documented PLAN must include an exact model intent');
    assert.ok(likely, 'documented PLAN must include a likely model intent');
    assert.equal(likely.confirmed, true, 'likely confirmation must be a sibling of the intent');
    assert.equal(Object.hasOwn(likely.model, 'confirmed'), false,
      'confirmed must never be nested inside the resolver result');
    for (const lane of lanes) {
      assert.deepEqual(Object.keys(lane.effort_curve), CANONICAL);
      assert.deepEqual(Object.keys(lane.context_curve), CANONICAL);
    }

    const efforts = lanes.flatMap((lane) => Object.values(lane.effort_curve));
    const contexts = lanes.flatMap((lane) => Object.values(lane.context_curve));
    if (plan.harness === 'copilot-cli') {
      assert.ok(efforts.some((value) => value === 'auto'));
      assert.ok(efforts.some((value) => value !== 'auto'));
      assert.ok(contexts.some((value) => value === 'auto'));
      assert.ok(contexts.some((value) => value !== 'auto'));
    } else {
      assert.equal(plan.harness, 'copilot-vscode');
      assert.ok(efforts.every((value) => value === 'auto'),
        'unsupported explicit VS Code settings must have gated before this plan');
      assert.ok(contexts.every((value) => value === 'auto'));
    }

    const resolveCases = [
      [exact, exact.model.candidate],
      [likely, `${likely.model.candidate} Thinking XHigh Effort`],
    ];
    for (const [lane, userInput] of resolveCases) {
      assert.equal(fs.existsSync(resolveInputPath), false,
        'each intent must start without a pre-existing request file');
      fs.writeFileSync(resolveInputPath, JSON.stringify({
        harness: plan.harness,
        user_input: userInput,
        catalog: plan.catalog,
      }), { flag: 'wx' });
      try {
        const result = runDocumentedCommand(resolveCommand, commandOptions);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(lane.model, JSON.parse(result.stdout),
          'the plan must retain the entire resolver stdout object unchanged');
      } finally {
        fs.rmSync(resolveInputPath, { force: true });
      }
    }

    // The plan expands into the session; the skill never hand-assembles cells.
    assert.equal(fs.existsSync(planInputPath), false,
      'expansion must start without a pre-existing plan file');
    fs.writeFileSync(planInputPath, JSON.stringify(plan), { flag: 'wx' });
    const expandResult = runDocumentedCommand(expandCommand, commandOptions);
    assert.equal(expandResult.status, 0, expandResult.stderr);
    const session = JSON.parse(expandResult.stdout);
    assert.deepEqual(Object.keys(session.selections), PERSONAS);
    for (const persona of PERSONAS) {
      assert.deepEqual(Object.keys(session.selections[persona]), CANONICAL, persona);
      for (const tier of CANONICAL) {
        const cell = session.selections[persona][tier];
        assert.equal(Object.hasOwn(cell, 'resolution'), true);
        assert.equal(Object.hasOwn(cell, 'reasoning_effort'), true);
        assert.equal(Object.hasOwn(cell, 'context_tier'), true);
      }
    }
    // Lane membership survives as routing, not as a stored marker.
    for (const [lane, members] of Object.entries(LANES)) {
      const candidate = plan.plan.lanes[lane].model.candidate;
      for (const member of members) {
        assert.equal(session.selections[member].complex.resolution.candidate, candidate,
          `${member} must route to the ${lane} lane model`);
      }
    }
    // Key-wise, not substring-wise: "selectable_models" legitimately contains
    // "mode", and a naive substring check would flag it.
    const forbiddenKeys = new Set(['thinker', 'builder', 'reviewer', 'effort_curve', 'context_curve', 'mode', 'lanes', 'cells']);
    const walkKeys = (node) => {
      if (Array.isArray(node)) return node.forEach(walkKeys);
      if (node === null || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        assert.ok(!forbiddenKeys.has(key), `expansion leaked ${key} into the session`);
        walkKeys(value);
      }
    };
    walkKeys(session.selections);

    assert.equal(fs.existsSync(sessionInputPath), false,
      'verification must start without a pre-existing session file');
    fs.writeFileSync(sessionInputPath, expandResult.stdout, { flag: 'wx' });
    sessionOwnedPaths.add(sessionInputPath);
    const verificationResult = runDocumentedCommand(verificationCommand, commandOptions);
    assert.equal(verificationResult.status, 0, verificationResult.stderr);
    const verification = JSON.parse(verificationResult.stdout);
    assert.deepEqual(Object.keys(verification.assignments), PERSONAS);
    assert.deepEqual(Object.keys(verification.dispatch_settings), PERSONAS);
    for (const persona of PERSONAS) {
      assert.deepEqual(Object.keys(verification.assignments[persona]), CANONICAL, persona);
      assert.deepEqual(Object.keys(verification.dispatch_settings[persona]), CANONICAL, persona);
    }
    // Three lanes cost at most fifteen probes, never thirty.
    assert.ok(verification.verification_targets.length <= 15,
      'tuple dedup must keep the probe count bounded by distinct tuples');
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
      Object.keys(profile.model_checks).sort(),
      [...new Set(PERSONAS.flatMap((persona) => Object.values(verification.assignments[persona])))].sort()
    );
    fs.writeFileSync(proposalInputPath, profileResult.stdout, { flag: 'wx' });
    fs.mkdirSync(workspaceRoot, { recursive: true });
    const diffResult = runDocumentedCommand(diffCommand, commandOptions);
    assert.equal(diffResult.status, 0, diffResult.stderr);
    const diff = JSON.parse(diffResult.stdout);
    assert.equal(diff.scope, targetScope);
    assert.equal(diff.harness, session.harness);
    assert.equal(fs.existsSync(workspaceConfigPath), false, 'preview must not write workspace config');
    assert.equal(fs.existsSync(globalConfigPath), false, 'preview must not write global config');
    const upsertResult = runDocumentedCommand(upsertCommand, commandOptions);
    assert.equal(upsertResult.status, 0, upsertResult.stderr);
    const upsert = JSON.parse(upsertResult.stdout);
    assert.equal(upsert.scope, targetScope);
    assert.equal(upsert.harness, session.harness);
    const targetConfigPath = targetScope === 'workspace' ? workspaceConfigPath : globalConfigPath;
    const stored = JSON.parse(fs.readFileSync(targetConfigPath, 'utf8'));
    assert.equal(stored.schema_version, 3);
    assert.deepEqual(
      stored.harnesses[session.harness].dispatch_settings,
      verification.dispatch_settings
    );
    if (targetScope === 'global') {
      assert.equal(fs.existsSync(workspaceConfigPath), false,
        'global configuration must not write a workspace profile');
    } else {
      assert.equal(fs.existsSync(globalConfigPath), false,
        'workspace configuration must not write a global profile');
    }
    assert.deepEqual(fs.readdirSync(unrelatedCwd), [], 'commands must not use cwd for transient files');
    return { resolveCommand, expandCommand, verificationCommand, buildCommand, diffCommand, upsertCommand };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(unrelatedCwd, { recursive: true, force: true });
  }
}

test('the documented commands honor selected workspace CLI and global VS Code targets', () => {
  const scenarios = [
    { plan: documentedPlan(), targetScope: 'workspace' },
    { plan: allAutoVscodePlan(), targetScope: 'global' },
  ];
  const results = scenarios.map(runDocumentedConfigurationScenario);

  for (const commands of results) {
    assert.equal(
      commands.resolveCommand,
      'node "$SKILL_ROOT/scripts/model-id-resolver.js" resolve --input "$SESSION_SCRATCH/RESOLVE_REQUEST.json"'
    );
    assert.equal(
      commands.expandCommand,
      'node "$SKILL_ROOT/scripts/model-id-resolver.js" expand-selections --input "$SESSION_SCRATCH/PLAN.json"'
    );
    assert.equal(
      commands.verificationCommand,
      'node "$SKILL_ROOT/scripts/model-id-resolver.js" verification-targets --input "$SESSION_SCRATCH/SESSION.json"'
    );
    assert.equal(
      commands.buildCommand,
      'node "$SKILL_ROOT/scripts/model-id-resolver.js" build-profile --input "$SESSION_SCRATCH/SESSION.json"'
    );
    assert.equal(
      commands.diffCommand,
      'node "$SKILL_ROOT/scripts/model-tier-config.js" diff-profile --input "$SESSION_SCRATCH/PROPOSAL.json" --scope "$TARGET_SCOPE" --workspace-root "$WORKSPACE_ROOT" --harness "$ACTIVE_HARNESS"'
    );
    assert.equal(
      commands.upsertCommand,
      'node "$SKILL_ROOT/scripts/model-tier-config.js" upsert-profile --input "$SESSION_SCRATCH/PROPOSAL.json" --scope "$TARGET_SCOPE" --workspace-root "$WORKSPACE_ROOT" --harness "$ACTIVE_HARNESS"'
    );
  }
});

test('the skill records absolute cwd-independent scratch roots', () => {
  const { body } = readSkill();
  assert.match(body,
    /bind absolute `SKILL_ROOT`.*absolute `SESSION_SCRATCH`.*command environment/is);
  assert.match(body, /never rely on (?:the )?(?:current working directory|cwd)/i);
  assert.match(body, /every transient.*`SESSION_SCRATCH`/is);
  assert.match(body,
    /bind selected `ACTIVE_HARNESS`.*`TARGET_SCOPE`.*`global\|workspace`.*absolute `WORKSPACE_ROOT`/is);
  assert.match(body, /always pass.*`WORKSPACE_ROOT`.*global.*workspace precedence/is);
  for (const command of [
    'node "$SKILL_ROOT/scripts/model-id-resolver.js" resolve --input "$SESSION_SCRATCH/RESOLVE_REQUEST.json"',
    'node "$SKILL_ROOT/scripts/model-id-resolver.js" verification-targets --input "$SESSION_SCRATCH/SESSION.json"',
    'node "$SKILL_ROOT/scripts/model-id-resolver.js" build-profile --input "$SESSION_SCRATCH/SESSION.json"',
    'node "$SKILL_ROOT/scripts/model-tier-config.js" diff-profile --input "$SESSION_SCRATCH/PROPOSAL.json" --scope "$TARGET_SCOPE" --workspace-root "$WORKSPACE_ROOT" --harness "$ACTIVE_HARNESS"',
    'node "$SKILL_ROOT/scripts/model-tier-config.js" upsert-profile --input "$SESSION_SCRATCH/PROPOSAL.json" --scope "$TARGET_SCOPE" --workspace-root "$WORKSPACE_ROOT" --harness "$ACTIVE_HARNESS"',
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

test('model resolution defines explicit catalog adapters for every active harness', () => {
  const reference = readModelResolution();
  assert.deepEqual(
    [
      reference.includes('## copilot-vscode adapter'),
      reference.includes('## copilot-cli adapter'),
      reference.includes('## codex-cli adapter'),
      reference.includes('## codex-app adapter'),
    ],
    [true, true, true, true]
  );
});

test('the codex-app adapter forbids inheriting codex-cli catalog data', () => {
  const adapter = referenceSection('codex-app adapter');
  // The surfaces are separate because their spawnable sets drift independently
  // (spike Probe I1) — not because one was ever measured as larger.
  assert.match(adapter, /separate surface/i);
  assert.match(adapter, /Available models/);
  assert.match(adapter, /Re-acquire rather than cache/i);
  assert.match(adapter, /never\s+copy a `codex-cli` profile across/i);
});

test('the codex-cli adapter distinguishes the parent catalog from the spawn catalog', () => {
  const adapter = referenceSection('codex-cli adapter');
  assert.match(adapter, /codex debug models/i);
  // The load-bearing spike finding: listed parent models are not all spawnable.
  assert.match(adapter, /parent catalog is not the spawn catalog/i);
  assert.match(adapter, /spawn_agent/);
  assert.match(adapter, /Available models/);
  assert.match(adapter, /No feature flag is required/i);
  assert.match(adapter, /only the exact returned slugs/i);
  assert.match(adapter, /no hardcoded fallback|STOP/i);
});

test('the copilot-vscode probe targets the model parameter, never agentName', () => {
  const adapter = referenceSection('copilot-vscode adapter');
  // runSubagent exposes `agentName` and `model` as separate optional strings and
  // resolves the agent first, so a probe placed in `agentName` is rejected during
  // agent lookup and never reaches model validation — returning no catalog at all.
  assert.match(adapter, /`__10x_catalog_probe__`.*`model`/is);
  assert.match(adapter, /never in `agentName`/i);
  assert.match(adapter, /agentName.*unset/is);
  assert.match(adapter, /Requested agent .* not found/i);
  // The mis-targeted error must not be mistaken for the STOP condition.
  assert.match(adapter, /mis-targeted probe/i);
  // Copilot labels carry a vendor suffix; bare slugs are foreign identifiers.
  assert.match(adapter, /Model Name \(Vendor\)/);
  assert.match(adapter, /bare slug.*foreign-surface identifier/is);
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
