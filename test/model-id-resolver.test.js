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

// Selections are persona-major now. These tests exercise tier behavior, which
// is persona independent, so they build one row and broadcast it.
function broadcast(row) {
  const matrix = {};
  for (const persona of ['einstein', 'peter', 'linus', 'cobalt', 'sentinel', 'ralph']) {
    matrix[persona] = row;
  }
  return matrix;
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
    selections: broadcast(fiveSelections(advanced)),
  };
  const withComplex = (selection) => {
    const row = { ...fiveSelections(advanced), complex: selection };
    return broadcast(row);
  };

  const missingComplex = { ...fiveSelections(advanced) };
  delete missingComplex.complex;

  assert.throws(
    () => verificationPlan({ ...request, selections: broadcast(missingComplex) }),
    /five canonical tier keys/
  );
  assert.throws(
    () => verificationPlan({ ...request, selections: withComplex(likelySelection(mini, false)) }),
    /requires confirmation/
  );
  assert.throws(
    () => verificationPlan({
      ...request,
      selections: withComplex({ resolution: { state: 'no_match' } }),
    }),
    /is unresolved/
  );
  assert.throws(
    () => verificationPlan({
      ...request,
      selections: broadcast(fiveSelections('not in catalog')),
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
    selections: broadcast(selections),
  });

  const expectedRow = {
    trivial: mini,
    lite: mini,
    standard_clear: advanced,
    standard_ambiguous: advanced,
    complex: advanced,
  };
  const expectedSettings = {
    trivial: { reasoning_effort: 'auto', context_tier: 'auto' },
    lite: { reasoning_effort: 'auto', context_tier: 'auto' },
    standard_clear: { reasoning_effort: 'medium', context_tier: 'long_context' },
    standard_ambiguous: { reasoning_effort: 'medium', context_tier: 'long_context' },
    complex: { reasoning_effort: 'medium', context_tier: 'long_context' },
  };

  assert.deepEqual(result, {
    assignments: broadcast(expectedRow),
    dispatch_settings: broadcast(expectedSettings),
    // Six personas sharing a tuple still cost one probe: dedup keys on the
    // execution tuple, which is persona independent.
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
    selections: broadcast(selections),
  });

  assert.deepEqual(result.dispatch_settings, broadcast({
    trivial: { reasoning_effort: 'auto', context_tier: 'auto' },
    lite: { reasoning_effort: 'auto', context_tier: 'auto' },
    standard_clear: { reasoning_effort: 'auto', context_tier: 'auto' },
    standard_ambiguous: { reasoning_effort: 'auto', context_tier: 'auto' },
    complex: { reasoning_effort: 'auto', context_tier: 'auto' },
  }));
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
          selections: broadcast(selections),
        }),
        new RegExp(
          `must be one of auto for harness ${JSON.stringify(harness)}`
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
      selections: broadcast(fiveSelections(model)),
    });

    assert.deepEqual(plan.verification_targets, [expectedTarget(model)]);
  }
});

test('copilot-cli allows explicit reasoning and context settings', () => {
  const model = 'gpt-5.4';
  const plan = verificationPlan({
    harness: 'copilot-cli',
    catalog: catalog([model], 'copilot-cli'),
    selections: broadcast(fiveSelections(model, 'xhigh', 'default')),
  });

  assert.deepEqual(plan.verification_targets, [
    expectedTarget(model, 'xhigh', 'default'),
  ]);
});

test('codex-cli allows max and ultra reasoning efforts', () => {
  const model = 'gpt-5.6-sol';
  for (const effort of ['max', 'ultra']) {
    const plan = verificationPlan({
      harness: 'codex-cli',
      catalog: catalog([model], 'codex-cli'),
      selections: broadcast(fiveSelections(model, effort, 'auto')),
    });
    assert.deepEqual(plan.verification_targets, [expectedTarget(model, effort, 'auto')]);
  }
});

test('codex-cli rejects any explicit context_tier (auto only)', () => {
  const model = 'gpt-5.6-sol';
  for (const contextTier of ['default', 'long_context']) {
    const selections = fiveSelections(model);
    selections.complex = exactSelection(model, 'auto', contextTier);
    assert.throws(
      () => verificationPlan({
        harness: 'codex-cli',
        catalog: catalog([model], 'codex-cli'),
        selections: broadcast(selections),
      }),
      /context_tier must be one of auto for harness "codex-cli"/
    );
  }
});

test('codex-app carries its own capability entry, not codex-cli\'s by inheritance', () => {
  const model = 'gpt-5.6-sol';
  for (const effort of ['max', 'ultra']) {
    const plan = verificationPlan({
      harness: 'codex-app',
      catalog: catalog([model], 'codex-app'),
      selections: broadcast(fiveSelections(model, effort, 'auto')),
    });
    assert.deepEqual(plan.verification_targets, [expectedTarget(model, effort, 'auto')]);
  }

  // The Codex spawn tool takes no context parameter on either surface.
  const selections = fiveSelections(model);
  selections.complex = exactSelection(model, 'auto', 'long_context');
  assert.throws(
    () => verificationPlan({
      harness: 'codex-app',
      catalog: catalog([model], 'codex-app'),
      selections: broadcast(selections),
    }),
    /context_tier must be one of auto for harness "codex-app"/
  );
});

test('copilot-cli rejects the Codex-only ultra effort', () => {
  const model = 'gpt-5.4';
  const selections = fiveSelections(model);
  selections.complex = exactSelection(model, 'ultra', 'auto');
  assert.throws(
    () => verificationPlan({
      harness: 'copilot-cli',
      catalog: catalog([model], 'copilot-cli'),
      selections: broadcast(selections),
    }),
    /reasoning_effort must be one of auto, low, medium, high, xhigh for harness "copilot-cli"/
  );
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
    selections: broadcast(selections),
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
    selections: broadcast(validSelections),
  }).verification_targets.length, 5);

  for (const invalid of ['Auto', 'inherit', '', null, 42, {}, [], undefined]) {
    const badReasoning = fiveSelections(model);
    badReasoning.lite.reasoning_effort = invalid;
    assert.throws(
      () => verificationPlan({
        harness: 'copilot-cli',
        catalog: catalog([model], 'copilot-cli'),
        selections: broadcast(badReasoning),
      }),
      /reasoning_effort must be one of auto, low, medium, high, xhigh/
    );

    const badContext = fiveSelections(model);
    badContext.lite.context_tier = invalid;
    assert.throws(
      () => verificationPlan({
        harness: 'copilot-cli',
        catalog: catalog([model], 'copilot-cli'),
        selections: broadcast(badContext),
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
    selections: broadcast(selections),
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
      selections: broadcast(selections),
    };
    Object.defineProperty(request, 'probes', {
      get() {
        assert.fail('probes must not be read for unsupported explicit settings');
      },
    });

    assert.throws(
      () => buildResolvedProfile(request),
      /must be one of auto for harness/
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
    selections: broadcast(selections),
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
  assert.equal(profile.assignments.einstein.trivial, mini);
  assert.deepEqual(profile.dispatch_settings, broadcast({
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
  }));
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
    selections: broadcast(fiveSelections(protoModel)),
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
    selections: broadcast(selections),
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
    selections: broadcast(fiveSelections(model)),
  };

  assert.throws(
    () => buildResolvedProfile({ ...request, probes: {} }),
    /missing probe/
  );
  assert.throws(
    () => buildResolvedProfile({
      harness: 'copilot-vscode',
      catalog: catalog(['__proto__']),
      selections: broadcast(fiveSelections('__proto__')),
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
    selections: broadcast(fiveSelections(model)),
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
    selections: broadcast(fiveSelections(model, 'medium', 'long_context')),
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
      selections: broadcast(fiveSelections(model)),
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
      selections: broadcast(selections),
    });
    const result = runResolver([
      'verification-targets',
      '--input',
      requestPath,
    ]);

    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /must be one of auto for harness/u);
    assert.equal(result.stderr.trim().split('\n').length, 1);
  }
});

test('CLI verification-targets and build-profile use the executable gate', () => {
  const model = 'GPT-5.5 (copilot)';
  const target = expectedTarget(model);
  const session = {
    harness: 'copilot-vscode',
    catalog: catalog([model]),
    selections: broadcast(fiveSelections(model)),
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

// ---------------------------------------------------------------------------
// Selection expansion (persona x tier)
// ---------------------------------------------------------------------------

const { expandSelections } = require(SCRIPT);

const PERSONAS = ['einstein', 'peter', 'linus', 'cobalt', 'sentinel', 'ralph'];
const TIERS = ['trivial', 'lite', 'standard_clear', 'standard_ambiguous', 'complex'];
const CELL_FIELDS = ['resolution', 'confirmed', 'reasoning_effort', 'context_tier'];

function exactIntent(candidate) {
  return { state: 'exact', candidate };
}

function assertCompleteMatrix(selections) {
  assert.deepEqual(Object.keys(selections), PERSONAS, 'persona rows must be complete and ordered');
  for (const persona of PERSONAS) {
    assert.deepEqual(Object.keys(selections[persona]), TIERS, `${persona} row must be complete`);
    for (const tier of TIERS) {
      for (const field of Object.keys(selections[persona][tier])) {
        assert.ok(CELL_FIELDS.includes(field), `${persona}.${tier} leaked field ${field}`);
      }
    }
  }
}

function expandPlan(plan, extra = {}) {
  return expandSelections({
    harness: 'codex-app',
    catalog: catalog(['m-top', 'm-mid', 'm-cheap'], 'codex-app'),
    plan,
    ...extra,
  });
}

test('default-all expands one answer into every cell', () => {
  const session = expandPlan({ mode: 'default_all', model: exactIntent('m-top'), reasoning_effort: 'high' });

  assertCompleteMatrix(session.selections);
  for (const persona of PERSONAS) {
    for (const tier of TIERS) {
      assert.equal(session.selections[persona][tier].resolution.candidate, 'm-top');
      assert.equal(session.selections[persona][tier].reasoning_effort, 'high');
    }
  }
});

test('role lanes expand three answers into thirty explicit cells', () => {
  const session = expandPlan({
    mode: 'role_lanes',
    lanes: {
      thinker: {
        model: exactIntent('m-top'),
        effort_curve: { trivial: 'low', lite: 'medium', standard_clear: 'high', standard_ambiguous: 'xhigh', complex: 'ultra' },
      },
      builder: {
        model: exactIntent('m-cheap'),
        effort_curve: { trivial: 'low', lite: 'low', standard_clear: 'medium', standard_ambiguous: 'medium', complex: 'high' },
      },
      reviewer: {
        model: exactIntent('m-mid'),
        effort_curve: { trivial: 'low', lite: 'medium', standard_clear: 'high', standard_ambiguous: 'high', complex: 'high' },
      },
    },
  });

  assertCompleteMatrix(session.selections);
  // Lane membership: thinkers get the frontier model, builders the cheap one.
  assert.equal(session.selections.einstein.complex.resolution.candidate, 'm-top');
  assert.equal(session.selections.peter.complex.resolution.candidate, 'm-top');
  assert.equal(session.selections.linus.complex.resolution.candidate, 'm-cheap');
  assert.equal(session.selections.ralph.complex.resolution.candidate, 'm-cheap');
  assert.equal(session.selections.cobalt.complex.resolution.candidate, 'm-mid');
  assert.equal(session.selections.sentinel.complex.resolution.candidate, 'm-mid');
  // The curve steps by tier within a lane.
  assert.equal(session.selections.einstein.trivial.reasoning_effort, 'low');
  assert.equal(session.selections.einstein.complex.reasoning_effort, 'ultra');
  assert.equal(session.selections.linus.complex.reasoning_effort, 'high');
});

test('per-tier expands five answers by broadcasting across personas', () => {
  const tiers = Object.fromEntries(TIERS.map((tier) => [tier, { model: exactIntent('m-mid'), reasoning_effort: 'medium' }]));
  const session = expandPlan({ mode: 'per_tier', tiers });

  assertCompleteMatrix(session.selections);
  for (const persona of PERSONAS) {
    assert.equal(session.selections[persona].complex.resolution.candidate, 'm-mid');
  }
});

test('full matrix passes thirty cells through unchanged', () => {
  const cells = {};
  for (const persona of PERSONAS) {
    cells[persona] = Object.fromEntries(TIERS.map((tier) => [tier, {
      model: exactIntent(`m-${persona === 'einstein' ? 'top' : 'cheap'}`),
      reasoning_effort: persona === 'einstein' ? 'ultra' : 'low',
    }]));
  }
  const session = expandPlan({ mode: 'matrix', cells });

  assertCompleteMatrix(session.selections);
  assert.equal(session.selections.einstein.trivial.reasoning_effort, 'ultra');
  assert.equal(session.selections.ralph.trivial.reasoning_effort, 'low');
});

test('no lane, role, or mode marker survives expansion', () => {
  const session = expandPlan({
    mode: 'role_lanes',
    lanes: {
      thinker: { model: exactIntent('m-top') },
      builder: { model: exactIntent('m-cheap') },
      reviewer: { model: exactIntent('m-mid') },
    },
  });

  // Key-wise, not substring-wise: "selectable_models" legitimately contains
  // "mode", so a naive substring scan would flag a clean expansion.
  const forbidden = new Set(['thinker', 'builder', 'reviewer', 'mode', 'lanes', 'cells', 'effort_curve', 'context_curve']);
  const walkKeys = (node) => {
    if (Array.isArray(node)) return node.forEach(walkKeys);
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      assert.ok(!forbidden.has(key), `expansion leaked ${key}`);
      walkKeys(value);
    }
  };
  walkKeys(session.selections);
});

test('expansion rejects an unknown mode', () => {
  assert.throws(() => expandPlan({ mode: 'whatever' }), /plan\.mode must be one of/);
});

test('expansion rejects unknown or missing lanes', () => {
  assert.throws(
    () => expandPlan({ mode: 'role_lanes', lanes: { thinker: { model: exactIntent('m-top') } } }),
    /missing lane/
  );
  assert.throws(
    () => expandPlan({
      mode: 'role_lanes',
      lanes: {
        thinker: { model: exactIntent('m-top') },
        builder: { model: exactIntent('m-cheap') },
        reviewer: { model: exactIntent('m-mid') },
        security: { model: exactIntent('m-mid') },
      },
    }),
    /unknown lane/
  );
});

test('expansion rejects an incomplete persona or tier axis', () => {
  const cells = {};
  for (const persona of PERSONAS) {
    cells[persona] = Object.fromEntries(TIERS.map((t) => [t, { model: exactIntent('m-mid') }]));
  }
  delete cells.ralph;
  assert.throws(() => expandPlan({ mode: 'matrix', cells }), /six canonical persona keys/);

  const short = Object.fromEntries(TIERS.slice(0, 4).map((t) => [t, { model: exactIntent('m-mid') }]));
  assert.throws(() => expandPlan({ mode: 'per_tier', tiers: short }), /five canonical tier keys/);
});

test('expansion rejects vivaldi as a matrix cell', () => {
  const cells = {};
  for (const persona of PERSONAS) {
    cells[persona] = Object.fromEntries(TIERS.map((t) => [t, { model: exactIntent('m-mid') }]));
  }
  cells.vivaldi = Object.fromEntries(TIERS.map((t) => [t, { model: exactIntent('m-mid') }]));
  assert.throws(() => expandPlan({ mode: 'matrix', cells }), /six canonical persona keys/);
});

test('expansion carries the session forward for the next gate', () => {
  const parent = catalog(['m-parent'], 'codex-app');
  const session = expandPlan(
    { mode: 'default_all', model: exactIntent('m-top') },
    { parent_catalog: parent, advisory: { vivaldi: {} } }
  );

  assert.equal(session.harness, 'codex-app');
  assert.deepEqual(session.parent_catalog, parent);
  assert.deepEqual(session.advisory, { vivaldi: {} });
});

test('expand-selections runs as a CLI gate emitting one JSON object', () => {
  const requestPath = writeRequest({
    harness: 'codex-app',
    catalog: catalog(['m-top'], 'codex-app'),
    plan: { mode: 'default_all', model: exactIntent('m-top'), reasoning_effort: 'high' },
  });
  const result = runResolver(['expand-selections', '--input', requestPath]);

  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1);
  assertCompleteMatrix(JSON.parse(lines[0]).selections);
});

// ---------------------------------------------------------------------------
// Probe bounds across the widened matrix
// ---------------------------------------------------------------------------

function matrixSelections(perPersona) {
  const out = {};
  for (const persona of PERSONAS) {
    const [model, effort] = perPersona[persona] ?? perPersona.default;
    out[persona] = Object.fromEntries(TIERS.map((tier) => [tier, exactSelection(model, effort, 'auto')]));
  }
  return out;
}

test('thirty identical cells still cost exactly one probe', () => {
  const plan = verificationPlan({
    harness: 'codex-app',
    catalog: catalog(['m-top'], 'codex-app'),
    selections: matrixSelections({ default: ['m-top', 'high'] }),
  });

  assert.equal(plan.verification_targets.length, 1);
  assert.deepEqual(plan.verification_targets[0], expectedTarget('m-top', 'high'));
});

test('three role lanes cost three probes, not thirty', () => {
  const plan = verificationPlan({
    harness: 'codex-app',
    catalog: catalog(['m-top', 'm-mid', 'm-cheap'], 'codex-app'),
    selections: matrixSelections({
      einstein: ['m-top', 'ultra'],
      peter: ['m-top', 'ultra'],
      linus: ['m-cheap', 'low'],
      ralph: ['m-cheap', 'low'],
      cobalt: ['m-mid', 'high'],
      sentinel: ['m-mid', 'high'],
    }),
  });

  assert.equal(plan.verification_targets.length, 3);
});

test('thirty distinct tuples are the worst case and are not capped', () => {
  const models = ['m-a', 'm-b', 'm-c', 'm-d', 'm-e', 'm-f'];
  const efforts = ['low', 'medium', 'high', 'xhigh', 'ultra'];
  const selections = {};
  PERSONAS.forEach((persona, pi) => {
    selections[persona] = Object.fromEntries(
      TIERS.map((tier, ti) => [tier, exactSelection(models[pi], efforts[ti], 'auto')])
    );
  });

  const plan = verificationPlan({
    harness: 'codex-app',
    catalog: catalog(models, 'codex-app'),
    selections,
  });

  assert.equal(plan.verification_targets.length, 30, 'the engine must not silently cap probe count');
});

test('a matrix plan produces persona-major assignments and settings', () => {
  const plan = verificationPlan({
    harness: 'codex-app',
    catalog: catalog(['m-top', 'm-cheap'], 'codex-app'),
    selections: matrixSelections({ default: ['m-cheap', 'low'], einstein: ['m-top', 'ultra'] }),
  });

  assert.deepEqual(Object.keys(plan.assignments), PERSONAS);
  assert.equal(plan.assignments.einstein.complex, 'm-top');
  assert.equal(plan.assignments.linus.complex, 'm-cheap');
  assert.equal(plan.dispatch_settings.einstein.complex.reasoning_effort, 'ultra');
  assert.equal(plan.dispatch_settings.linus.complex.reasoning_effort, 'low');
});

test('an unresolved cell names its persona and tier', () => {
  const selections = matrixSelections({ default: ['m-top', 'high'] });
  selections.cobalt.standard_ambiguous = { reasoning_effort: 'high', context_tier: 'auto' };

  assert.throws(
    () => verificationPlan({
      harness: 'codex-app',
      catalog: catalog(['m-top'], 'codex-app'),
      selections,
    }),
    /selection for cobalt\.standard_ambiguous is unresolved/
  );
});

// ---------------------------------------------------------------------------
// Advisory pass-through
// ---------------------------------------------------------------------------

function advisoryRow(candidate, effort) {
  return {
    vivaldi: Object.fromEntries(TIERS.map((tier) => [tier, {
      model: exactIntent(candidate),
      reasoning_effort: effort,
    }])),
  };
}

function buildWithAdvisory(extra) {
  const selections = matrixSelections({ default: ['m-top', 'auto'] });
  const targets = verificationPlan({
    harness: 'codex-app',
    catalog: catalog(['m-top'], 'codex-app'),
    selections,
  }).verification_targets;
  const probes = {};
  for (const target of targets) probes[target.id] = successfulProbe(target);
  return buildResolvedProfile({
    harness: 'codex-app',
    catalog: catalog(['m-top'], 'codex-app'),
    selections,
    probes,
    ...extra,
  });
}

test('an advisory row lands in the profile without a probe or a model check', () => {
  const profile = buildWithAdvisory({
    parent_catalog: catalog(['m-parent'], 'codex-app'),
    advisory: advisoryRow('m-parent', 'ultra'),
  });

  assert.deepEqual(profile.advisory.vivaldi.complex, { model: 'm-parent', reasoning_effort: 'ultra' });
  // The parent model is never dispatched, so it must never be recorded as checked.
  assert.ok(!Object.hasOwn(profile.model_checks, 'm-parent'));
  assert.deepEqual(Object.keys(profile.model_checks), ['m-top']);
});

test('an omitted advisory leaves the field off entirely', () => {
  const profile = buildWithAdvisory({});
  assert.ok(!Object.hasOwn(profile, 'advisory'));
});

test('an advisory resolves against the parent catalog, not the spawn catalog', () => {
  // The spawn set is strictly smaller; resolving a parent model against it would
  // wrongly reject a legitimate recommendation.
  assert.throws(
    () => buildWithAdvisory({ advisory: advisoryRow('m-parent', 'high') }),
    /requires parent_catalog/
  );
  assert.throws(
    () => buildWithAdvisory({
      parent_catalog: catalog(['m-other'], 'codex-app'),
      advisory: advisoryRow('m-parent', 'high'),
    }),
    /not in the active harness parent catalog/
  );
});

test('advisory reasoning effort is capability-gated', () => {
  assert.throws(
    () => buildWithAdvisory({
      parent_catalog: catalog(['m-parent'], 'codex-app'),
      advisory: advisoryRow('m-parent', 'nonsense'),
    }),
    /reasoning_effort must be one of/
  );
});

test('advisory rejects a non-canonical role', () => {
  assert.throws(
    () => buildWithAdvisory({
      parent_catalog: catalog(['m-parent'], 'codex-app'),
      advisory: { ...advisoryRow('m-parent', 'high'), linus: {} },
    }),
    /unknown role/
  );
});
