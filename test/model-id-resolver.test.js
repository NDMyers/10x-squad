'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  prepareCatalog,
  resolveModelIntent,
} = require(path.join(
  __dirname,
  '..',
  'assets',
  'skills',
  '10x-squad-configure-tiers',
  'scripts',
  'model-id-resolver.js'
));

function catalog(models) {
  return {
    harness: 'copilot-vscode',
    source: 'harness',
    checked_at: '2026-07-13T00:00:00.000Z',
    models,
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
    () => prepareCatalog(catalog(['GPT-5.5', '   ']), 'copilot-vscode'),
    /non-empty strings/
  );
});
