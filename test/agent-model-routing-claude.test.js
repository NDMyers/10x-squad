'use strict';

// Machine contract for Vivaldi's Claude Code routing section and the Claude
// persona agents. Anchors on load-bearing tokens, not editorial phrasing,
// mirroring agent-model-routing-codex.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  PERSONA_AGENTS,
  claudeToolsFor,
  composeClaudePersonaAgent,
  composeVivaldi,
} = require('../lib/compose');
const { HARNESS_DISPATCH_CAPABILITIES } = require(
  '../assets/skills/10x-squad-configure-tiers/scripts/routing-constants'
);

const RESOLVER_PATH = '.claude/skills/10x-squad-configure-tiers/scripts/model-tier-config.js';
const CANONICAL = ['trivial', 'lite', 'standard_clear', 'standard_ambiguous', 'complex'];
const PERSONAS = ['einstein', 'peter', 'linus', 'cobalt', 'sentinel', 'ralph'];

function split(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, 'composed file must have YAML frontmatter');
  return { frontmatter: m[1], body: m[2] };
}

function routingSection() {
  const { body } = split(composeVivaldi('claude'));
  const section = body.match(/## Model Routing\n([\s\S]*?)(?:\n---|\n## [A-Z])/);
  assert.ok(section, 'claude entrypoint must contain a ## Model Routing section');
  return section[1];
}

test('the claude entrypoint is the /10x-squad skill, invoked only by name', () => {
  const { frontmatter } = split(composeVivaldi('claude'));
  assert.match(frontmatter, /^name: 10x-squad$/m);
  assert.match(frontmatter, /^disable-model-invocation: true$/m);
  assert.doesNotMatch(frontmatter, /^model\s*:/m, 'the parent model stays user-selected');
});

test('the claude entrypoint pre-approves exactly the runtime and resolver commands', () => {
  const { frontmatter } = split(composeVivaldi('claude'));
  const line = frontmatter.split('\n').find((candidate) => candidate.startsWith('allowed-tools:'));
  assert.ok(line, 'allowed-tools must be declared so routing runs unattended (C5)');
  assert.ok(line.includes('Bash(node .10x-squad/runtime/control.js *)'));
  assert.ok(line.includes(`Bash(node ${RESOLVER_PATH} *)`));
  // Nothing broader than those two command prefixes.
  assert.doesNotMatch(line, /Bash\(node:\*\)|Bash\(\*\)|Bash\(node \*\)|\bEdit\b|\bWrite\b/);
});

test('the claude resolver invocation carries both routing coordinates', () => {
  const section = routingSection();
  assert.ok(section.includes(RESOLVER_PATH), 'must invoke the Claude-installed resolver path');
  assert.ok(section.includes('node ~/.claude/skills/10x-squad-configure-tiers/scripts/model-tier-config.js'),
    'user-level installs must resolve through ~/.claude');
  for (const flag of ['--workspace-root', '--harness', '--tier', '--persona', '--json']) {
    assert.ok(section.includes(flag), `resolver invocation must pass ${flag}`);
  }
  for (const key of CANONICAL) assert.ok(section.includes(key), `tier key ${key} must be listed`);
  for (const persona of PERSONAS) assert.ok(section.includes(`\`${persona}\``), `persona ${persona} must be listed`);
});

test('surface detection is the runtime command and an unknown surface hard-stops', () => {
  const section = routingSection();
  assert.ok(section.includes('node .10x-squad/runtime/control.js detect-surface'));
  assert.ok(section.includes('`claude-cli`') && section.includes('`claude-desktop`'));
  assert.match(section, /Do not guess a surface/);
  // OS-neutral: no macOS app paths or PATH sniffing.
  assert.doesNotMatch(section, /\/Applications\/|case "\$PATH"/);
});

test('every command runs through the Bash tool so it is valid on Windows too', () => {
  const section = routingSection();
  // Probe E: Claude Code will not pre-approve quoted text, $VARS, or chains.
  assert.match(section, /one command per Bash call/);
  assert.match(section, /write `--workspace-root \.`/);
  // The only $PWD / $HOME mentions left are the translation rule itself.
  const commands = section.split('\n').filter((line) => line.includes('node '));
  for (const line of commands) {
    if (line.includes('wherever')) continue;
    assert.doesNotMatch(line, /"\$PWD"|\$HOME/, `command line must be pre-approvable: ${line}`);
  }
  assert.match(section, /Run every command in this section with the Bash tool/);
  assert.match(section, /Windows \(Git Bash\), macOS, and Linux/);
});

test('dispatch passes subagent_type, model, and effort, and auto omits only effort', () => {
  const section = routingSection();
  assert.match(section, /`subagent_type`: `10x-<persona>`, built from the resolver's `persona` value/);
  // `resolve --json` prints no `agent` field, so the contract must not consume one.
  assert.match(section, /Consume `persona`, `model`, `reasoning_effort`, and `check_status`/);
  assert.match(section, /`model`: the profile's resolved model, always passed explicitly/);
  assert.match(section, /`effort`: the resolved `reasoning_effort` when it is non-`auto`; if it is `auto`, omit only that argument/);
  assert.match(section, /Never use the `fork` subagent type/);
  assert.match(section, /`context_tier` .*always `auto` and is never passed/);
  assert.match(section, /do NOT invoke the persona skill with the `Skill` tool/);
});

test('the dispatch tool is accepted under both of its names', () => {
  const section = routingSection();
  assert.match(section, /named `Agent` \(some builds and SDK hosts list it as `Task`/);
});

test('results are collected before any gate advances and are never predicted', () => {
  const section = routingSection();
  assert.match(section, /background-launch acknowledgement/);
  assert.match(section, /never predict or fabricate a pending result/);
});

test('cobalt and sentinel are dispatched in the same message', () => {
  const section = routingSection();
  assert.match(section, /issue both dispatch-tool calls \*\*in the same message\*\*/);
});

test('claude never claims in-session executed-model verification', () => {
  const section = routingSection();
  assert.match(section, /Do not claim executed-model verification/);
});

test('a missing persona agent hard-blocks instead of falling back to a generic agent', () => {
  const section = routingSection();
  assert.match(section, /Never substitute `general-purpose` or `Explore` for a missing persona/);
});

test('claude routing carries no Copilot or Codex actuators', () => {
  const section = routingSection();
  for (const foreign of ['runSubagent', 'spawn_agent', 'wait_agent', 'copilot-cli', 'codex-app', '.agents/skills', '.github/skills']) {
    assert.ok(!section.includes(foreign), `claude routing must not reference ${foreign}`);
  }
  // Copilot CLI's `agent_type` parameter (distinct from Claude's `subagent_type`).
  assert.doesNotMatch(section, /(?<!sub)agent_type/);
});

test('claude surfaces declare effort but no context vocabulary', () => {
  for (const surface of ['claude-cli', 'claude-desktop']) {
    const caps = HARNESS_DISPATCH_CAPABILITIES[surface];
    assert.ok(caps, `${surface} must have dispatch capabilities`);
    assert.deepEqual([...caps.reasoning_effort], ['auto', 'low', 'medium', 'high', 'xhigh', 'max']);
    assert.deepEqual([...caps.context_tier], ['auto']);
  }
});

test('each claude persona agent is a scoped subagent with no model pin and no dispatch tool', () => {
  for (const persona of Object.keys(PERSONA_AGENTS)) {
    const { frontmatter, body } = split(composeClaudePersonaAgent(persona));
    assert.match(frontmatter, new RegExp(`^name: 10x-${persona}$`, 'm'));
    assert.match(frontmatter, /^description: ".+"$/m);
    assert.doesNotMatch(frontmatter, /^model\s*:/m, `${persona} must not pin a model`);
    const tools = frontmatter.match(/^tools: (.+)$/m)[1].split(', ');
    assert.ok(tools.length > 0);
    for (const forbidden of ['Agent', 'Task']) {
      assert.ok(!tools.includes(forbidden), `${persona} must not be able to dispatch subagents`);
    }
    assert.ok(body.trim().length > 0, `${persona} must carry its persona instructions`);
    assert.doesNotMatch(body, /^name: 10x-/m, 'the skill frontmatter must be stripped');
  }
});

test('read-only personas cannot edit and only builders can', () => {
  const tools = (persona) => split(composeClaudePersonaAgent(persona)).frontmatter.match(/^tools: (.+)$/m)[1].split(', ');
  for (const persona of ['einstein', 'peter', 'sentinel', 'cobalt']) {
    assert.ok(!tools(persona).includes('Edit') && !tools(persona).includes('Write'), `${persona} must be read-only`);
  }
  for (const persona of ['linus', 'ralph']) {
    assert.ok(tools(persona).includes('Edit') && tools(persona).includes('Write'), `${persona} must be able to edit`);
    assert.ok(tools(persona).includes('Bash'), `${persona} must be able to run commands`);
  }
});

test('Claude tool mapping rejects unknown categories and drops optional MCP servers', () => {
  assert.deepEqual(claudeToolsFor(['read', 'search', 'marrow/*']), ['Read', 'Grep', 'Glob']);
  assert.throws(() => claudeToolsFor(['teleport']), /No Claude Code tool mapping/);
});
