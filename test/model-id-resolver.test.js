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

function catalog(models) {
  return {
    harness: 'copilot-vscode',
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

function exactSelection(candidate) {
  return { resolution: { state: 'exact', candidate } };
}

function likelySelection(candidate, confirmed) {
  return { resolution: { state: 'likely', candidate }, confirmed };
}

function fiveSelections(value) {
  return {
    trivial: exactSelection(value),
    lite: exactSelection(value),
    standard_clear: exactSelection(value),
    standard_ambiguous: exactSelection(value),
    complex: exactSelection(value),
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

test('verification plan deduplicates exact candidates after selection validation', () => {
  const mini = 'GPT-5.4 mini (copilot)';
  const advanced = 'GPT-5.5 (copilot)';
  const selections = {
    ...fiveSelections(advanced),
    trivial: exactSelection(mini),
    lite: exactSelection(mini),
  };

  const result = verificationPlan({
    harness: 'copilot-vscode',
    catalog: catalog([mini, advanced]),
    selections,
  });

  assert.deepEqual(result.verification_targets, [mini, advanced]);
});

test('profile builder derives one check per unique successful probe', () => {
  const mini = 'GPT-5.4 mini (copilot)';
  const advanced = 'GPT-5.5 (copilot)';
  const selections = {
    ...fiveSelections(advanced),
    trivial: exactSelection(mini),
    complex: likelySelection(advanced, true),
  };
  const profile = buildResolvedProfile({
    harness: 'copilot-vscode',
    catalog: catalog([mini, advanced]),
    selections,
    probes: {
      [mini]: {
        ok: true,
        requested_model: mini,
        identity_observable: false,
        checked_at: '2026-07-13T01:00:00.000Z',
      },
      [advanced]: {
        ok: true,
        requested_model: advanced,
        identity_observable: true,
        executed_model: advanced,
        checked_at: '2026-07-13T01:01:00.000Z',
      },
    },
    original_input: 'must not be copied',
  });

  assert.equal(profile.assignments.trivial, mini);
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
  const protoProfile = buildResolvedProfile({
    harness: 'copilot-vscode',
    catalog: catalog([protoModel]),
    selections: fiveSelections(protoModel),
    probes: Object.fromEntries([
      [protoModel, {
        ok: true,
        requested_model: protoModel,
        identity_observable: false,
        checked_at: '2026-07-13T01:02:00.000Z',
      }],
    ]),
  });

  assert.equal(
    Object.prototype.hasOwnProperty.call(protoProfile.model_checks, protoModel),
    true
  );
  assert.equal(protoProfile.model_checks[protoModel].method, 'addressability_probe');
  assert.equal(protoProfile.model_checks[protoModel].status, 'unverified');
});

test('profile builder rejects missing failed and mismatched probes', () => {
  const model = 'GPT-5.5 (copilot)';
  const request = {
    harness: 'copilot-vscode',
    catalog: catalog([model]),
    selections: fiveSelections(model),
  };
  const checkedAt = '2026-07-13T01:00:00.000Z';

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
      probes: {
        [model]: {
          ok: false,
          requested_model: model,
          checked_at: checkedAt,
          error: 'model unavailable',
        },
      },
    }),
    /probe failed/
  );
  assert.throws(
    () => buildResolvedProfile({
      ...request,
      probes: {
        [model]: {
          ok: true,
          requested_model: model,
          identity_observable: true,
          executed_model: 'GPT-5.4 (copilot)',
          checked_at: checkedAt,
        },
      },
    }),
    /requested\/executed model mismatch/
  );
  assert.throws(
    () => buildResolvedProfile({
      ...request,
      probes: {
        [model]: {
          ok: true,
          requested_model: model,
          checked_at: checkedAt,
        },
      },
    }),
    /identity_observable is required/
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

test('CLI verification-targets and build-profile use the executable gate', () => {
  const model = 'GPT-5.5 (copilot)';
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
    [model]
  );
  assert.equal(rejectedProfileResult.status, 2);
  assert.equal(rejectedProfileResult.stdout, '');
  assert.match(rejectedProfileResult.stderr, /missing probe/u);
  assert.equal(rejectedProfileResult.stderr.trim().split('\n').length, 1);

  const multilineFailurePath = writeRequest({
    ...session,
    probes: {
      [model]: {
        ok: false,
        requested_model: model,
        error: 'first\nsecond\u0085third\u2028fourth\u2029fifth\u001b[2J',
        checked_at: '2026-07-13T01:00:00.000Z',
      },
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
  for (const encoded of [
    '\\n',
    '\\u0085',
    '\\u2028',
    '\\u2029',
    '\\u001b',
  ]) {
    assert.equal(stderrPayload.includes(encoded), true);
  }

  const successfulPath = writeRequest({
    ...session,
    probes: {
      [model]: {
        ok: true,
        requested_model: model,
        identity_observable: false,
        checked_at: '2026-07-13T01:00:00.000Z',
      },
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
});
