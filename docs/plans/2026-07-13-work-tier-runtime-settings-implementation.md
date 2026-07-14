# Work-Tier Runtime Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let each 10x Squad work tier configure an exact model, reasoning effort, and context tier, with `auto` available for the latter two settings.

**Architecture:** Keep the existing tier-to-model `assignments` map and add a parallel optional `dispatch_settings` map in schema v2. Continue reading schema-v1 profiles as all-`auto`, resolve all three values additively, and verify unique execution tuples before writes. Gate explicit runtime settings to harnesses whose child-dispatch contract proves those parameters.

**Tech Stack:** Dependency-free Node.js 20, `node:test`, Markdown skill/reference contracts, GitHub Copilot CLI `task`, VS Code `runSubagent`.

---

### Task 1: Add schema-v2 runtime settings without breaking schema-v1 reads

**Files:**
- Modify: `test/model-tier-config.test.js`
- Modify: `assets/skills/10x-squad-configure-tiers/scripts/model-tier-config.js`

**Step 1: Write failing engine tests**

Add fixtures and assertions equivalent to:

```js
const AUTO_SETTINGS = { reasoning_effort: 'auto', context_tier: 'auto' };

function mkDispatchSettings(reasoningEffort = 'auto', contextTier = 'auto') {
  return Object.fromEntries(CANONICAL.map((tier) => [tier, {
    reasoning_effort: reasoningEffort,
    context_tier: contextTier,
  }]));
}

test('schema-v1 profiles resolve omitted runtime settings as auto', () => {
  const cfg = mkConfig({ 'copilot-cli': 'gpt-5.4' });
  const result = resolve({ workspaceConfig: cfg, globalConfig: null,
    harness: 'copilot-cli', tier: 'complex' });
  assert.equal(result.schema_version, 1);
  assert.deepEqual(
    { reasoning_effort: result.reasoning_effort, context_tier: result.context_tier },
    AUTO_SETTINGS
  );
});

test('schema-v2 profiles resolve explicit per-tier runtime settings', () => {
  const profile = mkProfile('gpt-5.4', {
    dispatch_settings: mkDispatchSettings('medium', 'long_context'),
  });
  const cfg = { schema_version: 2, updated_at: NOW,
    harnesses: { 'copilot-cli': profile } };
  const result = resolve({ workspaceConfig: cfg, globalConfig: null,
    harness: 'copilot-cli', tier: 'standard_clear' });
  assert.equal(result.reasoning_effort, 'medium');
  assert.equal(result.context_tier, 'long_context');
});
```

Also test:

- latest `SCHEMA_VERSION` is `2`, while versions `1` and `2` are readable;
- all five settings keys are required whenever `dispatch_settings` exists;
- only `auto|low|medium|high|xhigh` and `auto|default|long_context` are valid;
- unknown nested fields and credential-shaped fields fail;
- schema v1 rejects `dispatch_settings`;
- schema v2 accepts omission for compatibility, while targeted upserts materialize it and unrelated retained legacy profiles may remain omitted;
- explicit settings fail validation for `copilot-vscode` and an unknown harness;
- `upsertProfile` upgrades to v2 and preserves unrelated profile objects;
- `diff-profile` and `upsert-profile` retain their existing fields and add `effective_dispatch_settings_after`.

**Step 2: Run the focused tests and confirm RED**

Run: `node --test test/model-tier-config.test.js`

Expected: failures for schema version, unknown `dispatch_settings`, and absent resolver fields.

**Step 3: Implement minimal schema support**

Add constants and helpers:

```js
const SCHEMA_VERSION = 2;
const READABLE_SCHEMA_VERSIONS = new Set([1, 2]);
const PROFILE_FIELDS = new Set(['assignments', 'dispatch_settings', 'model_checks']);
const REASONING_EFFORTS = new Set(['auto', 'low', 'medium', 'high', 'xhigh']);
const CONTEXT_TIERS = new Set(['auto', 'default', 'long_context']);

function automaticDispatchSetting() {
  return { reasoning_effort: 'auto', context_tier: 'auto' };
}

function dispatchSettingFor(profile, tier) {
  return profile.dispatch_settings?.[tier]
    ? { ...profile.dispatch_settings[tier] }
    : automaticDispatchSetting();
}
```

Validate the complete nested map, enforce the active harness capability boundary, clone it in `normalizeProfile`, preserve the selected file's schema version in `effectiveProfile`, and add the two values to `resolve`. Pass `harness` into every proposal validation path. Add the effective settings map to preview/write JSON without changing the existing effective model map.

**Step 4: Run focused tests and confirm GREEN**

Run: `node --test test/model-tier-config.test.js`

Expected: all engine tests pass.

**Step 5: Commit**

```bash
git add test/model-tier-config.test.js \
  assets/skills/10x-squad-configure-tiers/scripts/model-tier-config.js
git commit -m "feat: add work-tier runtime settings schema"
```

### Task 2: Resolve and probe complete execution tuples

**Files:**
- Modify: `test/model-id-resolver.test.js`
- Modify: `assets/skills/10x-squad-configure-tiers/scripts/model-id-resolver.js`

**Step 1: Write failing tuple tests**

Extend selection fixtures with sibling fields:

```js
{
  resolution: exactResolution('gpt-5.4'),
  reasoning_effort: 'medium',
  context_tier: 'long_context'
}
```

Assert that `verificationPlan` returns `dispatch_settings` plus targets shaped like:

```js
{
  id: JSON.stringify(['gpt-5.4', 'medium', 'long_context']),
  model: 'gpt-5.4',
  reasoning_effort: 'medium',
  context_tier: 'long_context',
  dispatch_arguments: {
    model: 'gpt-5.4',
    reasoning_effort: 'medium',
    context_tier: 'long_context'
  }
}
```

Add cases proving that:

- omitted selection settings become `auto`;
- `auto` fields are absent from `dispatch_arguments`;
- identical tuples deduplicate;
- the same model with different settings produces distinct targets;
- invalid settings fail before any profile can be built;
- every target needs one matching probe keyed by target `id`;
- unexpected, failed, model-mismatched, or argument-mismatched probes fail;
- model checks aggregate conservatively when one model has several tuple probes;
- `buildResolvedProfile` returns `assignments`, `dispatch_settings`, and `model_checks`.

**Step 2: Run the focused tests and confirm RED**

Run: `node --test test/model-id-resolver.test.js`

Expected: failures because targets are still model strings and profiles have no settings map.

**Step 3: Implement tuple planning and profile construction**

Add canonical setting validation, `resolvedDispatchSettings`, a deterministic tuple ID, and a target builder that omits `auto` arguments. Change probe validation from model keys to tuple IDs and compare the recorded requested arguments to the target arguments. Aggregate `model_checks` so any addressability-only probe keeps that model `unverified`; all observable byte-equal probes may remain `verified`.

Keep `resolveModelIntent` focused only on model matching. Thinking words in free-form model descriptions remain removable for model candidate matching, but separately collected setting fields now survive into the profile.

**Step 4: Run focused tests and confirm GREEN**

Run: `node --test test/model-id-resolver.test.js`

Expected: all resolver tests pass.

**Step 5: Commit**

```bash
git add test/model-id-resolver.test.js \
  assets/skills/10x-squad-configure-tiers/scripts/model-id-resolver.js
git commit -m "feat: verify model reasoning and context tuples"
```

### Task 3: Update the configuration skill and public contract

**Files:**
- Modify: `test/configure-tiers-skill.test.js`
- Modify: `assets/skills/10x-squad-configure-tiers/SKILL.md`
- Modify: `assets/skills/10x-squad-configure-tiers/references/config-format.md`
- Modify: `assets/skills/10x-squad-configure-tiers/references/model-resolution.md`
- Modify: `assets/skills/10x-squad-configure-tiers/agents/openai.yaml`
- Modify: `docs/model-tier-configuration.md`
- Modify: `README.md`

**Step 1: Write failing skill-contract tests**

Assert that the skill and references:

- describe one work-tier profile as model + reasoning + context;
- offer explicit or `auto` reasoning/context choices;
- define `auto` as omission, not model Auto or parent inheritance;
- list the canonical values;
- require all five settings entries in new proposals;
- deduplicate and probe complete tuples;
- pass only `dispatch_arguments` returned by the resolver;
- allow explicit values on `copilot-cli` only;
- stop before preview/write for unsupported explicit values on VS Code/unknown harnesses;
- document schema-v1 read compatibility and schema-v2 writes;
- include an executable SESSION example with mixed explicit/automatic settings.

**Step 2: Run the focused tests and confirm RED**

Run: `node --test test/configure-tiers-skill.test.js`

Expected: failures because the current prose explicitly excludes reasoning from the schema.

**Step 3: Rewrite the low-freedom workflow**

Keep model catalog discovery unchanged. Collect the two runtime choices after each model choice, store them as selection siblings, and call `verification-targets`. For each returned target, invoke the harmless probe with exactly its `dispatch_arguments`; never reconstruct or add omitted `auto` fields. Record the requested arguments with raw probe observations and let `build-profile` construct the complete proposal.

Document the CLI capability and the VS Code/unknown-harness hard stop. Update UI metadata and operator docs without hardcoding model names or making numeric context promises beyond the harness's `long_context` label.

**Step 4: Validate and run focused tests**

Run:

```bash
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  assets/skills/10x-squad-configure-tiers
node --test test/configure-tiers-skill.test.js
```

Expected: validation and tests pass.

**Step 5: Commit**

```bash
git add test/configure-tiers-skill.test.js \
  assets/skills/10x-squad-configure-tiers \
  docs/model-tier-configuration.md README.md
git commit -m "feat: configure tier thinking and context"
```

### Task 4: Make Vivaldi dispatch the resolved settings

**Files:**
- Modify: `test/agent-model-routing.test.js`
- Modify: `assets/agents/10x-squad.agent.md`

**Step 1: Write failing dispatch-contract tests**

Assert that the Model Routing section:

- consumes `reasoning_effort` and `context_tier` from resolver JSON;
- passes non-`auto` values explicitly;
- omits each `auto` argument independently;
- never replaces `auto` with “highest supported”;
- announces all three resolved choices;
- re-resolves all three after tier reclassification;
- hard-blocks unsupported arguments and observed model mismatch.

**Step 2: Run the focused test and confirm RED**

Run: `node --test test/agent-model-routing.test.js`

Expected: failure because Vivaldi still hardcodes highest reasoning and omits context policy.

**Step 3: Update the operative routing instructions**

Replace the hardcoded reasoning sentence with exact parameter behavior. Keep model identity confirmation unchanged. State that `auto` is reported but not supplied to the tool. Extend the one-dispatch override to reasoning/context only when the active dispatch contract supports them.

**Step 4: Run focused tests and confirm GREEN**

Run: `node --test test/agent-model-routing.test.js`

Expected: all routing tests pass.

**Step 5: Commit**

```bash
git add test/agent-model-routing.test.js assets/agents/10x-squad.agent.md
git commit -m "feat: dispatch configured tier runtime settings"
```

### Task 5: Forward-test, package, install, and verify

**Files:**
- Verify: all changed files
- Update installed copies through: `bin/10x-squad.js`

**Step 1: Run the same forward scenario with the revised skill**

Use a fresh subagent with only the revised skill and this request:

```text
For copilot-cli, configure every 10x Squad work tier to use gpt-5.4,
medium thinking/reasoning, and long context. Do not write files; show the
proposal and exact dispatch arguments.
```

Expected: the proposal retains all three settings and the dispatch arguments contain `model`, `reasoning_effort: medium`, and `context_tier: long_context`.

**Step 2: Run complete verification**

Run:

```bash
npm test
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  assets/skills/10x-squad-configure-tiers
git diff --check HEAD~4
```

Expected: zero failures and no whitespace errors.

**Step 3: Verify a disposable install**

Create a temporary directory, run `node bin/10x-squad.js install --directory <temp>`, and compare the installed agent and skill package byte-for-byte with `assets/`.

**Step 4: Request independent code review and fix important findings**

Give the reviewer the design, this plan, and the branch diff. Re-run the focused tests for any fixes and then the complete verification command.

**Step 5: Install accepted assets into the active workspace**

Run:

```bash
node bin/10x-squad.js install --directory <workspace-root>
```

Verify source and installed copies are byte-identical and that `<workspace-root>/.10x-squad/model-routing.json` is unchanged.

**Step 6: Commit final review fixes, if any**

```bash
git add -A
git commit -m "test: validate work-tier runtime settings"
```

Skip this commit when review required no tracked changes.
