'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const SCRIPT = path.join(
  __dirname,
  '..',
  'assets',
  'skills',
  '10x-squad-configure-tiers',
  'scripts',
  'model-id-resolver.js'
);

const {
  buildResolvedProfile,
  prepareCatalog,
  resolveModelIntent,
  uniqueModelIds,
  verificationPlan,
} = require(SCRIPT);

function catalog(models, harness = 'copilot-vscode') {
  return {
    harness,
    source: 'harness',
    checked_at: '2026-07-13T00:00:00.000Z',
    models,
  };
}

function writeRequest(value) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'model-id-resolver-'));
  const requestPath = path.join(directory, 'request.json');
  fs.writeFileSync(requestPath, JSON.stringify(value), 'utf8');
  return requestPath;
}

function runResolver(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

function exactSelection(
  candidate,
  reasoningEffort = 'auto',
  contextTier = 'auto'
) {
  return {
    resolution: { state: 'exact', candidate },
    reasoning_effort: reasoningEffort,
    context_tier: contextTier,
  };
}

function likelySelection(
  candidate,
  confirmed,
  reasoningEffort = 'auto',
  contextTier = 'auto'
) {
  return {
    resolution: { state: 'likely', candidate },
    confirmed,
    reasoning_effort: reasoningEffort,
    context_tier: contextTier,
  };
}

function fiveSelections(
  value,
  reasoningEffort = 'auto',
  contextTier = 'auto'
) {
  return {
    trivial: exactSelection(value, reasoningEffort, contextTier),
    lite: exactSelection(value, reasoningEffort, contextTier),
    standard_clear: exactSelection(value, reasoningEffort, contextTier),
    standard_ambiguous: exactSelection(value, reasoningEffort, contextTier),
    complex: exactSelection(value, reasoningEffort, contextTier),
  };
}

function automaticSelection(candidate) {
  return { resolution: { state: 'exact', candidate } };
}

function expectedTarget(
  model,
  reasoningEffort = 'auto',
  contextTier = 'auto'
) {
  const dispatchArguments = { model };
  if (reasoningEffort !== 'auto') {
    dispatchArguments.reasoning_effort = reasoningEffort;
  }
  if (contextTier !== 'auto') {
    dispatchArguments.context_tier = contextTier;
  }
  return {
    id: JSON.stringify([model, reasoningEffort, contextTier]),
    model,
    reasoning_effort: reasoningEffort,
    context_tier: contextTier,
    dispatch_arguments: dispatchArguments,
  };
}

function successfulProbe(target, overrides = {}) {
  return {
    ok: true,
    requested_model: target.model,
    requested_arguments: { ...target.dispatch_arguments },
    identity_observable: false,
    checked_at: '2026-07-13T01:00:00.000Z',
    ...overrides,
  };
}

test('catalog excludes Copilot Auto with explicit reason and deduplicates exact identifiers', () => {
  const prepared = prepareCatalog(
    catalog(['GPT-5.5 (copilot)', 'Auto (copilot)', 'GPT-5.5 (copilot)']),
    'copilot-vscode'
  );

  assert.deepEqual(prepared.models, ['GPT-5.5 (copilot)']);
  assert.deepEqual(prepared.excluded, [
    { model: 'Auto (copilot)', reason: 'squad invariant: Auto banned' },
  ]);
});

test('resolver preserves adapter-supplied forbidden catalog exclusions', () => {
  const result = resolveModelIntent({
    harness: 'copilot-vscode',
    user_input: 'GPT-5.5 (copilot)',
    catalog: {
      harness: 'copilot-vscode',
      source: 'harness',
      checked_at: '2026-07-13T00:00:00.000Z',
      models: ['GPT-5.5 (copilot)', 'GPT-5.4 (copilot)'],
      excluded: [
        {
          model: 'Auto (copilot)',
          reason: 'squad invariant: Auto banned',
        },
      ],
    },
  });

  assert.deepEqual(result.selectable_models, [
    'GPT-5.5 (copilot)',
    'GPT-5.4 (copilot)',
  ]);
  assert.deepEqual(result.excluded, [
    {
      model: 'Auto (copilot)',
      reason: 'squad invariant: Auto banned',
    },
  ]);
});

test('catalog merges and deduplicates supplied and discovered exclusions', () => {
  const exactAllowedModel = ' GPT-5.5 (copilot) ';
  const autoExclusion = {
    model: 'Auto (copilot)',
    reason: 'squad invariant: Auto banned',
  };
  const prepared = prepareCatalog({
    ...catalog([
      exactAllowedModel,
      'Auto (copilot)',
      'inherit',
      exactAllowedModel,
    ]),
    excluded: [autoExclusion, { ...autoExclusion }],
  }, 'copilot-vscode');

  assert.deepEqual(prepared.models, [exactAllowedModel]);
  assert.deepEqual(prepared.excluded, [
    autoExclusion,
    {
      model: 'inherit',
      reason: 'inherit is not an executable model identifier',
    },
  ]);
});

test('exact selectable identifier passes through byte-for-byte', () => {
  const userInput = 'GPT-5.5 (copilot)';
  const result = resolveModelIntent({
    harness: 'copilot-vscode',
    user_input: userInput,
    catalog: catalog(['GPT-5.5 (copilot)']),
  });

  assert.equal(result.state, 'exact');
  assert.equal(result.candidate, userInput);
  assert.equal(result.requires_confirmation, false);
});

test('descriptive effort text produces a likely model candidate', () => {
  const result = resolveModelIntent({
    harness: 'copilot-vscode',
    user_input: 'GPT-5.5 Thinking XHigh Effort',
    catalog: catalog([
      'GPT-5.5 (copilot)',
      'GPT-5.4 (copilot)',
      'GPT-5.4 mini (copilot)',
    ]),
  });

  assert.equal(result.state, 'likely');
  assert.equal(result.candidate, 'GPT-5.5 (copilot)');
  assert.equal(result.requires_confirmation, true);

  const composedResult = resolveModelIntent({
    harness: 'copilot-vscode',
    user_input: 'GPT-5.5 (copilot) Thinking XHigh Effort',
    catalog: catalog(['GPT-5.5 (copilot)']),
  });

  assert.equal(composedResult.state, 'likely');
  assert.equal(composedResult.candidate, 'GPT-5.5 (copilot)');
});

test('mini remains distinguishing in descriptive model intent', () => {
  const result = resolveModelIntent({
    harness: 'copilot-vscode',
    user_input: 'GPT 5.4 Thinking Xhigh Effort for trivial work',
    catalog: catalog(['GPT-5.4 (copilot)', 'GPT-5.4 mini (copilot)']),
  });

  assert.equal(result.state, 'likely');
  assert.deepEqual(result.candidates, ['GPT-5.4 (copilot)']);
});

test('same normalized signature is ambiguous in catalog order', () => {
  const result = resolveModelIntent({
    harness: 'copilot-vscode',
    user_input: 'GPT 5.4 Thinking Medium Effort',
    catalog: catalog(['GPT-5.4 (copilot)', 'GPT 5.4 (copilot)']),
  });

  assert.equal(result.state, 'ambiguous');
  assert.deepEqual(result.candidates, [
    'GPT-5.4 (copilot)',
    'GPT 5.4 (copilot)',
  ]);
});

test('unmatched input returns the full active model list in catalog order', () => {
  const models = ['GPT-5.5 (copilot)', 'Claude Opus 4.8 (copilot)'];
  const result = resolveModelIntent({
    harness: 'copilot-vscode',
    user_input: 'Sol Ultra',
    catalog: catalog(models),
  });

  assert.equal(result.state, 'no_match');
  assert.deepEqual(result.selectable_models, models);
});

test('preview, Codex, mini, and provider tokens remain model-distinguishing', () => {
  const cases = [
    ['GPT-5.4 mini', 'GPT-5.4 mini (copilot)'],
    ['GPT-5.3-Codex', 'GPT-5.3-Codex (copilot)'],
    ['Gemini 3.1 Pro Preview', 'Gemini 3.1 Pro (Preview) (copilot)'],
  ];

  for (const [userInput, model] of cases) {
    const result = resolveModelIntent({
      harness: 'copilot-vscode',
      user_input: userInput,
      catalog: catalog([model]),
    });

    assert.equal(result.candidate, model);
  }
});

test('model-distinguishing symbols do not become likely matches', () => {
  const result = resolveModelIntent({
    harness: 'copilot-vscode',
    user_input: 'Model X',
    catalog: catalog(['Model+X (copilot)']),
  });

  assert.equal(result.state, 'no_match');

  const emptySignatureResult = resolveModelIntent({
    harness: 'copilot-vscode',
    user_input: '---',
    catalog: catalog(['...']),
  });

  assert.equal(emptySignatureResult.state, 'no_match');
});

test('verification targets deduplicate repeated exact assignments', () => {
  const assignments = {
    trivial: 'GPT-5.4 mini (copilot)',
    lite: 'GPT-5.4 mini (copilot)',
    standard_clear: 'GPT-5.5 (copilot)',
    standard_ambiguous: 'GPT-5.5 (copilot)',
    complex: 'GPT-5.5 (copilot)',
  };

  assert.deepEqual(uniqueModelIds(assignments), [
    'GPT-5.4 mini (copilot)',
    'GPT-5.5 (copilot)',
  ]);
});

test('verification targets require exactly five nonblank canonical tiers', () => {
  assert.throws(
    () => uniqueModelIds({ trivial: 'm' }),
    /five canonical tier keys/
  );

  const canonical = {
    trivial: 'm',
    lite: 'm',
    standard_clear: 'm',
    standard_ambiguous: 'm',
    complex: 'm',
  };

  assert.throws(
    () => uniqueModelIds({ ...canonical, unknown: 'm' }),
    /five canonical tier keys/
  );
  assert.throws(
    () => uniqueModelIds({
      trivial: 'm',
      lite: 'm',
      standard_clear: 'm',
      standard_ambiguous: 'm',
      unknown: 'm',
    }),
    /five canonical tier keys/
  );
  assert.throws(
    () => uniqueModelIds({ ...canonical, complex: '   ' }),
    /non-empty strings/
  );
});

test('verification plan requires five resolved confirmed catalog selections', () => {
  const mini = 'GPT-5.4 mini (copilot)';
  const advanced = 'GPT-5.5 (copilot)';
  const request = {
    harness: 'copilot-vscode',
    catalog: catalog([mini, advanced]),
    selections: fiveSelections(advanced),
  };
  const missingComplex = { ...request.selections };
  delete missingComplex.complex;

  assert.throws(
    () => verificationPlan({ ...request, selections: missingComplex }),
    /five canonical tier keys/
  );
  assert.throws(
    () => verificationPlan({
      ...request,
      selections: {
        ...request.selections,
        complex: likelySelection(mini, false),
      },
    }),
    /requires confirmation/
  );
  assert.throws(
    () => verificationPlan({
      ...request,
      selections: {
        ...request.selections,
        complex: { resolution: { state: 'no_match' } },
      },
    }),
    /is unresolved/
  );
  assert.throws(
    () => verificationPlan({
      ...request,
      selections: fiveSelections('not in catalog'),
    }),
    /not in active harness catalog/
  );
});

test('verification plan returns complete settings and exact executable tuple targets', () => {
  const mini = 'GPT-5.4 mini (copilot)';
  const advanced = 'GPT-5.5 (copilot)';
  const selections = {
    ...fiveSelections(advanced, 'medium', 'long_context'),
    trivial: exactSelection(mini, 'auto', 'auto'),
    lite: exactSelection(mini, 'auto', 'auto'),
  };

  const result = verificationPlan({
    harness: 'copilot-cli',
    catalog: catalog([mini, advanced], 'copilot-cli'),
    selections,
  });

  assert.deepEqual(result, {
    assignments: {
      trivial: mini,
      lite: mini,
      standard_clear: advanced,
      standard_ambiguous: advanced,
      complex: advanced,
    },
    dispatch_settings: {
      trivial: { reasoning_effort: 'auto', context_tier: 'auto' },
      lite: { reasoning_effort: 'auto', context_tier: 'auto' },
      standard_clear: {
        reasoning_effort: 'medium',
        context_tier: 'long_context',
      },
      standard_ambiguous: {
        reasoning_effort: 'medium',
        context_tier: 'long_context',
      },
      complex: {
        reasoning_effort: 'medium',
        context_tier: 'long_context',
      },
    },
    verification_targets: [
      expectedTarget(mini),
      expectedTarget(advanced, 'medium', 'long_context'),
    ],
  });
});

test('omitted selection settings default to auto and auto arguments are omitted', () => {
  const model = 'GPT-5.5 (copilot)';
  const selections = Object.fromEntries([
    'trivial',
    'lite',
    'standard_clear',
    'standard_ambiguous',
    'complex',
  ].map((tier) => [tier, automaticSelection(model)]));

  const result = verificationPlan({
    harness: 'copilot-vscode',
    catalog: catalog([model]),
    selections,
  });

  assert.deepEqual(result.dispatch_settings, {
    trivial: { reasoning_effort: 'auto', context_tier: 'auto' },
    lite: { reasoning_effort: 'auto', context_tier: 'auto' },
    standard_clear: { reasoning_effort: 'auto', context_tier: 'auto' },
    standard_ambiguous: { reasoning_effort: 'auto', context_tier: 'auto' },
    complex: { reasoning_effort: 'auto', context_tier: 'auto' },
  });
  assert.deepEqual(result.verification_targets, [expectedTarget(model)]);
  assert.deepEqual(result.verification_targets[0].dispatch_arguments, { model });
});

test('verification plan rejects explicit settings for unsupported harnesses', () => {
  const model = 'gpt-5.4';
  const unsupportedHarnesses = [
    'copilot-vscode',
    'unknown-surface',
    'copilot-cli-preview',
  ];
  const explicitSettings = [
    ['low', 'auto'],
    ['auto', 'default'],
  ];

  for (const harness of unsupportedHarnesses) {
    for (const [reasoningEffort, contextTier] of explicitSettings) {
      const selections = fiveSelections(model);
      selections.complex = exactSelection(
        model,
        reasoningEffort,
        contextTier
      );
      assert.throws(
        () => verificationPlan({
          harness,
          catalog: catalog([model], harness),
          selections,
        }),
        new RegExp(
          `harness ${JSON.stringify(harness)} does not support explicit runtime settings`
        )
      );
    }
  }
});

test('unsupported harnesses still allow automatic runtime settings', () => {
  const model = 'gpt-5.4';

  for (const harness of ['copilot-vscode', 'unknown-surface']) {
    const plan = verificationPlan({
      harness,
      catalog: catalog([model], harness),
      selections: fiveSelections(model),
    });

    assert.deepEqual(plan.verification_targets, [expectedTarget(model)]);
  }
});

test('copilot-cli allows explicit reasoning and context settings', () => {
  const model = 'gpt-5.4';
  const plan = verificationPlan({
    harness: 'copilot-cli',
    catalog: catalog([model], 'copilot-cli'),
    selections: fiveSelections(model, 'xhigh', 'default'),
  });

  assert.deepEqual(plan.verification_targets, [
    expectedTarget(model, 'xhigh', 'default'),
  ]);
});

test('verification targets deduplicate full tuples but keep settings variants', () => {
  const model = 'gpt-5.4';
  const selections = {
    trivial: exactSelection(model, 'low', 'auto'),
    lite: exactSelection(model, 'low', 'auto'),
    standard_clear: exactSelection(model, 'auto', 'default'),
    standard_ambiguous: exactSelection(model, 'high', 'long_context'),
    complex: exactSelection(model, 'high', 'long_context'),
  };

  const result = verificationPlan({
    harness: 'copilot-cli',
    catalog: catalog([model], 'copilot-cli'),
    selections,
  });

  assert.deepEqual(result.verification_targets, [
    expectedTarget(model, 'low', 'auto'),
    expectedTarget(model, 'auto', 'default'),
    expectedTarget(model, 'high', 'long_context'),
  ]);
});

test('verification plan accepts only canonical reasoning and context settings', () => {
  const model = 'gpt-5.4';
  const reasoningValues = ['auto', 'low', 'medium', 'high', 'xhigh'];
  const contextValues = ['auto', 'default', 'long_context'];
  const validSelections = Object.fromEntries(reasoningValues.map((reasoning, index) => [
    ['trivial', 'lite', 'standard_clear', 'standard_ambiguous', 'complex'][index],
    exactSelection(model, reasoning, contextValues[index % contextValues.length]),
  ]));

  assert.equal(verificationPlan({
    harness: 'copilot-cli',
    catalog: catalog([model], 'copilot-cli'),
    selections: validSelections,
  }).verification_targets.length, 5);

  for (const invalid of ['Auto', 'inherit', '', null, 42, {}, [], undefined]) {
    const badReasoning = fiveSelections(model);
    badReasoning.lite.reasoning_effort = invalid;
    assert.throws(
      () => verificationPlan({
        harness: 'copilot-cli',
        catalog: catalog([model], 'copilot-cli'),
        selections: badReasoning,
      }),
      /reasoning_effort must be one of auto, low, medium, high, xhigh/
    );

    const badContext = fiveSelections(model);
    badContext.lite.context_tier = invalid;
    assert.throws(
      () => verificationPlan({
        harness: 'copilot-cli',
        catalog: catalog([model], 'copilot-cli'),
        selections: badContext,
      }),
      /context_tier must be one of auto, default, long_context/
    );
  }
});

test('invalid settings fail before profile probe construction', () => {
  const model = 'gpt-5.4';
  const selections = fiveSelections(model);
  selections.complex.context_tier = 'extended';
  const request = {
    harness: 'copilot-cli',
    catalog: catalog([model], 'copilot-cli'),
    selections,
  };
  Object.defineProperty(request, 'probes', {
    get() {
      assert.fail('probes must not be read when settings are invalid');
    },
  });

  assert.throws(
    () => buildResolvedProfile(request),
    /context_tier must be one of auto, default, long_context/
  );
});

test('profile builder rejects unsupported explicit settings before reading probes', () => {
  const model = 'gpt-5.4';
  const cases = [
    ['copilot-vscode', 'medium', 'auto'],
    ['unknown-surface', 'auto', 'default'],
  ];

  for (const [harness, reasoningEffort, contextTier] of cases) {
    const selections = fiveSelections(model);
    selections.standard_ambiguous = exactSelection(
      model,
      reasoningEffort,
      contextTier
    );
    const request = {
      harness,
      catalog: catalog([model], harness),
      selections,
    };
    Object.defineProperty(request, 'probes', {
      get() {
        assert.fail('probes must not be read for unsupported explicit settings');
      },
    });

    assert.throws(
      () => buildResolvedProfile(request),
      /does not support explicit runtime settings/
    );
  }
});

test('profile builder returns complete assignments settings and model checks', () => {
  const mini = 'GPT-5.4 mini (copilot)';
  const advanced = 'GPT-5.5 (copilot)';
  const miniTarget = expectedTarget(mini);
  const advancedTarget = expectedTarget(advanced, 'medium', 'long_context');
  const selections = {
    ...fiveSelections(advanced, 'medium', 'long_context'),
    trivial: exactSelection(mini),
    complex: likelySelection(advanced, true, 'medium', 'long_context'),
  };
  const profile = buildResolvedProfile({
    harness: 'copilot-cli',
    catalog: catalog([mini, advanced], 'copilot-cli'),
    selections,
    probes: Object.fromEntries([
      [miniTarget.id, successfulProbe(miniTarget)],
      [advancedTarget.id, successfulProbe(advancedTarget, {
        identity_observable: true,
        executed_model: advanced,
        checked_at: '2026-07-13T01:01:00.000Z',
      })],
    ]),
    original_input: 'must not be copied',
  });

  assert.deepEqual(Object.keys(profile).sort(), [
    'assignments',
    'dispatch_settings',
    'model_checks',
  ]);
  assert.equal(profile.assignments.trivial, mini);
  assert.deepEqual(profile.dispatch_settings, {
    trivial: { reasoning_effort: 'auto', context_tier: 'auto' },
    lite: { reasoning_effort: 'medium', context_tier: 'long_context' },
    standard_clear: {
      reasoning_effort: 'medium',
      context_tier: 'long_context',
    },
    standard_ambiguous: {
      reasoning_effort: 'medium',
      context_tier: 'long_context',
    },
    complex: { reasoning_effort: 'medium', context_tier: 'long_context' },
  });
  assert.deepEqual(profile.model_checks, {
    [mini]: {
      status: 'unverified',
      method: 'addressability_probe',
      source: 'harness',
      checked_at: '2026-07-13T01:00:00.000Z',
    },
    [advanced]: {
      status: 'verified',
      method: 'dispatch_smoke_test',
      source: 'harness',
      checked_at: '2026-07-13T01:01:00.000Z',
    },
  });
  assert.doesNotMatch(JSON.stringify(profile), /original_input/u);

  const protoModel = '__proto__';
  const protoTarget = expectedTarget(protoModel);
  const protoProfile = buildResolvedProfile({
    harness: 'copilot-vscode',
    catalog: catalog([protoModel]),
    selections: fiveSelections(protoModel),
    probes: Object.fromEntries([
      [protoTarget.id, successfulProbe(protoTarget, {
        checked_at: '2026-07-13T01:02:00.000Z',
      })],
    ]),
  });

  assert.equal(
    Object.prototype.hasOwnProperty.call(protoProfile.model_checks, protoModel),
    true
  );
  assert.equal(protoProfile.model_checks[protoModel].method, 'addressability_probe');
  assert.equal(protoProfile.model_checks[protoModel].status, 'unverified');
});

test('model checks stay unverified if any tuple probe lacks observable identity', () => {
  const model = 'gpt-5.4';
  const autoTarget = expectedTarget(model);
  const explicitTarget = expectedTarget(model, 'high', 'long_context');
  const selections = {
    ...fiveSelections(model, 'high', 'long_context'),
    trivial: exactSelection(model),
    lite: exactSelection(model),
  };
  const request = {
    harness: 'copilot-cli',
    catalog: catalog([model], 'copilot-cli'),
    selections,
  };

  const conservative = buildResolvedProfile({
    ...request,
    probes: Object.fromEntries([
      [autoTarget.id, successfulProbe(autoTarget)],
      [explicitTarget.id, successfulProbe(explicitTarget, {
        identity_observable: true,
        executed_model: model,
        checked_at: '2026-07-13T01:01:00.000Z',
      })],
    ]),
  });

  assert.deepEqual(conservative.model_checks[model], {
    status: 'unverified',
    method: 'addressability_probe',
    source: 'harness',
    checked_at: '2026-07-13T01:00:00.000Z',
  });

  const fullyObservable = buildResolvedProfile({
    ...request,
    probes: Object.fromEntries([
      [autoTarget.id, successfulProbe(autoTarget, {
        identity_observable: true,
        executed_model: model,
      })],
      [explicitTarget.id, successfulProbe(explicitTarget, {
        identity_observable: true,
        executed_model: model,
        checked_at: '2026-07-13T01:02:00.000Z',
      })],
    ]),
  });

  assert.deepEqual(fullyObservable.model_checks[model], {
    status: 'verified',
    method: 'dispatch_smoke_test',
    source: 'harness',
    checked_at: '2026-07-13T01:02:00.000Z',
  });
});

test('profile builder requires exactly one probe keyed by every target id', () => {
  const model = 'GPT-5.5 (copilot)';
  const target = expectedTarget(model);
  const request = {
    harness: 'copilot-vscode',
    catalog: catalog([model]),
    selections: fiveSelections(model),
  };

  assert.throws(
    () => buildResolvedProfile({ ...request, probes: {} }),
    /missing probe/
  );
  assert.throws(
    () => buildResolvedProfile({
      harness: 'copilot-vscode',
      catalog: catalog(['__proto__']),
      selections: fiveSelections('__proto__'),
      probes: {},
    }),
    /missing probe/
  );
  assert.throws(
    () => buildResolvedProfile({
      ...request,
      probes: Object.fromEntries([
        [target.id, successfulProbe(target)],
        ['unexpected-target', successfulProbe(target)],
      ]),
    }),
    /unexpected probe/
  );
  assert.throws(
    () => buildResolvedProfile({
      ...request,
      probes: { [model]: successfulProbe(target) },
    }),
    /unexpected probe/
  );
});

test('profile builder rejects failed and model-mismatched probes', () => {
  const model = 'GPT-5.5 (copilot)';
  const target = expectedTarget(model);
  const request = {
    harness: 'copilot-vscode',
    catalog: catalog([model]),
    selections: fiveSelections(model),
  };

  assert.throws(
    () => buildResolvedProfile({
      ...request,
      probes: {
        [target.id]: successfulProbe(target, {
          ok: false,
          error: 'model unavailable',
        }),
      },
    }),
    /probe failed/
  );
  assert.throws(
    () => buildResolvedProfile({
      ...request,
      probes: {
        [target.id]: successfulProbe(target, {
          requested_model: 'GPT-5.4 (copilot)',
        }),
      },
    }),
    /probe requested model does not match/
  );
  assert.throws(
    () => buildResolvedProfile({
      ...request,
      probes: {
        [target.id]: successfulProbe(target, {
          identity_observable: true,
          executed_model: 'GPT-5.4 (copilot)',
        }),
      },
    }),
    /requested\/executed model mismatch/
  );
  assert.throws(
    () => buildResolvedProfile({
      ...request,
      probes: {
        [target.id]: {
          ...successfulProbe(target),
          identity_observable: undefined,
        },
      },
    }),
    /identity_observable is required/
  );
});

test('probe requested arguments must exactly match dispatch arguments', () => {
  const model = 'gpt-5.4';
  const explicitTarget = expectedTarget(model, 'medium', 'long_context');
  const explicitRequest = {
    harness: 'copilot-cli',
    catalog: catalog([model], 'copilot-cli'),
    selections: fiveSelections(model, 'medium', 'long_context'),
  };
  const mismatches = [
    { model, reasoning_effort: 'medium' },
    { model, reasoning_effort: 'high', context_tier: 'long_context' },
    {
      model,
      reasoning_effort: 'medium',
      context_tier: 'long_context',
      temperature: 0,
    },
    null,
  ];

  for (const requestedArguments of mismatches) {
    assert.throws(
      () => buildResolvedProfile({
        ...explicitRequest,
        probes: {
          [explicitTarget.id]: successfulProbe(explicitTarget, {
            requested_arguments: requestedArguments,
          }),
        },
      }),
      /probe requested arguments do not match dispatch arguments/
    );
  }

  const autoTarget = expectedTarget(model);
  assert.throws(
    () => buildResolvedProfile({
      harness: 'copilot-cli',
      catalog: catalog([model], 'copilot-cli'),
      selections: fiveSelections(model),
      probes: {
        [autoTarget.id]: successfulProbe(autoTarget, {
          requested_arguments: { model, reasoning_effort: 'auto' },
        }),
      },
    }),
    /probe requested arguments do not match dispatch arguments/
  );
});

test('forbidden user intent is rejected before matching', () => {
  const availableCatalog = catalog(['GPT-5.5', 'Auto']);
  const cases = [
    ['Auto', 'squad invariant: Auto banned'],
    ['Auto (copilot)', 'squad invariant: Auto banned'],
    ['inherit', 'inherit is not an executable model identifier'],
    ['inherit (surface)', 'inherit is not an executable model identifier'],
  ];

  for (const [userInput, reason] of cases) {
    const result = resolveModelIntent({
      harness: 'copilot-vscode',
      user_input: userInput,
      catalog: availableCatalog,
    });

    assert.equal(result.state, 'banned');
    assert.equal(result.reason, reason);
  }
});

test('blank input and missing, blank, or mismatched harnesses fail closed', () => {
  assert.throws(
    () => resolveModelIntent({
      harness: 'copilot-vscode',
      user_input: '   ',
      catalog: catalog(['GPT-5.5']),
    }),
    /non-empty string user_input/
  );

  for (const active of [undefined, '', '   ']) {
    assert.throws(
      () => prepareCatalog({ ...catalog(['GPT-5.5']), harness: active }, active),
      /non-empty active harness/
    );
  }

  assert.throws(
    () => prepareCatalog(catalog(['GPT-5.5']), 'copilot-cli'),
    /catalog harness must equal active harness/
  );
});

test('malformed catalog data fails closed', () => {
  assert.throws(
    () => prepareCatalog(null, 'copilot-vscode'),
    /catalog must be an object/
  );
  assert.throws(
    () => prepareCatalog({ ...catalog(['GPT-5.5']), harness: '   ' }, 'copilot-vscode'),
    /catalog harness must be a non-empty string/
  );
  assert.throws(
    () => prepareCatalog({ ...catalog(['GPT-5.5']), source: 'documentation' }, 'copilot-vscode'),
    /source must be harness/
  );

  for (const checkedAt of [123, '   ']) {
    assert.throws(
      () => prepareCatalog({ ...catalog(['GPT-5.5']), checked_at: checkedAt }, 'copilot-vscode'),
      /valid ISO timestamp/
    );
  }

  assert.throws(
    () => prepareCatalog({ ...catalog(['GPT-5.5']), models: {} }, 'copilot-vscode'),
    /models must be an array/
  );
  assert.throws(
    () => prepareCatalog({ ...catalog(['GPT-5.5']), models: new Array(1) }, 'copilot-vscode'),
    /non-empty strings/
  );
  assert.throws(
    () => prepareCatalog(catalog(['GPT-5.5', '   ']), 'copilot-vscode'),
    /non-empty strings/
  );
});

test('catalog excluded must be an array when supplied', () => {
  for (const excluded of [null, {}, 'Auto (copilot)']) {
    assert.throws(
      () => prepareCatalog({ ...catalog(['GPT-5.5']), excluded }, 'copilot-vscode'),
      /catalog excluded must be an array/
    );
  }

  assert.deepEqual(
    prepareCatalog(catalog(['GPT-5.5']), 'copilot-vscode').excluded,
    []
  );
});

test('catalog exclusions accept only canonical forbidden records', () => {
  const malformedExclusions = [
    new Array(1),
    ['Auto (copilot)'],
    [{ model: '   ', reason: 'squad invariant: Auto banned' }],
    [{ model: 'GPT-5.5 (copilot)', reason: 'squad invariant: Auto banned' }],
    [{ model: 'Auto (copilot)', reason: 'not the canonical reason' }],
    [{ model: 'inherit', reason: null }],
  ];

  for (const excluded of malformedExclusions) {
    assert.throws(
      () => prepareCatalog({ ...catalog(['GPT-5.5']), excluded }, 'copilot-vscode'),
      /catalog excluded must contain canonical forbidden records/
    );
  }
});

test('CLI verification-targets rejects unsupported explicit settings without output', () => {
  const model = 'gpt-5.4';
  const cases = [
    ['copilot-vscode', 'high', 'auto'],
    ['copilot-vscode', 'auto', 'default'],
    ['unknown-surface', 'high', 'auto'],
    ['unknown-surface', 'auto', 'default'],
  ];

  for (const [harness, reasoningEffort, contextTier] of cases) {
    const selections = fiveSelections(model);
    selections.lite = exactSelection(model, reasoningEffort, contextTier);
    const requestPath = writeRequest({
      harness,
      catalog: catalog([model], harness),
      selections,
    });
    const result = runResolver([
      'verification-targets',
      '--input',
      requestPath,
    ]);

    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /does not support explicit runtime settings/u);
    assert.equal(result.stderr.trim().split('\n').length, 1);
  }
});

test('CLI verification-targets and build-profile use the executable gate', () => {
  const model = 'GPT-5.5 (copilot)';
  const target = expectedTarget(model);
  const session = {
    harness: 'copilot-vscode',
    catalog: catalog([model]),
    selections: fiveSelections(model),
    probes: {},
  };
  const requestPath = writeRequest(session);

  const verificationResult = runResolver([
    'verification-targets',
    '--input',
    requestPath,
  ]);
  const rejectedProfileResult = runResolver([
    'build-profile',
    '--input',
    requestPath,
  ]);

  assert.equal(verificationResult.status, 0);
  assert.deepEqual(
    JSON.parse(verificationResult.stdout).verification_targets,
    [target]
  );
  assert.equal(rejectedProfileResult.status, 2);
  assert.equal(rejectedProfileResult.stdout, '');
  assert.match(rejectedProfileResult.stderr, /missing probe/u);
  assert.equal(rejectedProfileResult.stderr.trim().split('\n').length, 1);

  const printableErrorText = 'sixth "quoted" \\path';
  const multilineFailurePath = writeRequest({
    ...session,
    probes: {
      [target.id]: successfulProbe(target, {
        ok: false,
        error: 'first\nsecond\u0085third\u2028fourth\u2029fifth\u001b[2J'
          + printableErrorText,
      }),
    },
  });
  const multilineFailureResult = runResolver([
    'build-profile',
    '--input',
    multilineFailurePath,
  ]);

  assert.equal(multilineFailureResult.status, 2);
  assert.equal(multilineFailureResult.stdout, '');
  assert.equal(multilineFailureResult.stderr.endsWith('\n'), true);
  assert.equal(
    (multilineFailureResult.stderr.match(/\n/gu) || []).length,
    1
  );
  const stderrPayload = multilineFailureResult.stderr.slice(0, -1);
  assert.doesNotMatch(
    stderrPayload,
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u
  );
  assert.equal(stderrPayload.endsWith(printableErrorText), true);
  for (const encoded of [
    '\\u000a',
    '\\u0085',
    '\\u2028',
    '\\u2029',
    '\\u001b',
  ]) {
    assert.equal(stderrPayload.includes(encoded), true);
  }

  const largeError = 'x'.repeat(256 * 1024);
  const largeFailurePath = writeRequest({
    ...session,
    probes: {
      [target.id]: successfulProbe(target, {
        ok: false,
        error: largeError,
      }),
    },
  });
  const largeFailureResult = runResolver([
    'build-profile',
    '--input',
    largeFailurePath,
  ]);
  const expectedLargeStderr = `Model resolver error: probe failed for ${target.id}: ${largeError}\n`;

  assert.equal(largeFailureResult.status, 2);
  assert.equal(largeFailureResult.stdout, '');
  assert.equal(largeFailureResult.stderr.length, expectedLargeStderr.length);
  assert.equal(largeFailureResult.stderr, expectedLargeStderr);

  const successfulPath = writeRequest({
    ...session,
    probes: {
      [target.id]: successfulProbe(target),
    },
  });
  const successfulProfileResult = runResolver([
    'build-profile',
    '--input',
    successfulPath,
  ]);

  assert.equal(successfulProfileResult.status, 0);
  assert.equal(
    JSON.parse(successfulProfileResult.stdout).model_checks[model].method,
    'addressability_probe'
  );
});

test('CLI resolve emits exactly one machine-readable result', () => {
  const requestPath = writeRequest({
    harness: 'copilot-vscode',
    user_input: 'GPT-5.5 Thinking XHigh Effort',
    catalog: catalog(['GPT-5.5 (copilot)']),
  });

  const result = runResolver(['resolve', '--input', requestPath]);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  const output = result.stdout.trim();
  assert.notEqual(output, '');
  assert.equal(output.split('\n').length, 1);
  assert.equal(JSON.parse(output).state, 'likely');
});

test('CLI contract errors exit 2 with empty stdout and one stderr line', () => {
  const validPath = writeRequest({
    harness: 'copilot-vscode',
    user_input: 'GPT-5.5 (copilot)',
    catalog: catalog(['GPT-5.5 (copilot)']),
  });
  const missingPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'model-id-resolver-missing-')),
    'request.json'
  );
  const malformedPath = writeRequest(null);
  fs.writeFileSync(malformedPath, '{ malformed', 'utf8');

  const cases = [
    [],
    ['unknown', '--input', validPath],
    ['constructor', '--input', validPath],
    ['resolve', '--input', missingPath],
    ['resolve', '--input', malformedPath],
  ];

  for (const args of cases) {
    const result = runResolver(args);

    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^Model resolver error:/u);
    const stderr = result.stderr.trim();
    assert.equal(stderr.split('\n').length, 1);
  }

  const unknownResult = runResolver(['unknown', '--input', validPath]);
  assert.equal(
    unknownResult.stderr,
    'Model resolver error: unknown command "unknown"\n'
  );
});
