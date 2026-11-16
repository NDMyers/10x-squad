'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  composeVivaldi,
  composeAntigravityPersonaAgent,
  composePersonaForAntigravity,
  ANTIGRAVITY_TOOL_MAP,
  PERSONA_AGENTS,
} = require('../lib/compose');
const {
  TIER_KEYS,
  PERSONA_KEYS,
} = require('../assets/skills/10x-squad-configure-tiers/scripts/routing-constants');

function splitFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  assert.ok(match, 'expected YAML frontmatter');
  return { frontmatter: match[1], body: match[2] };
}

function modelRoutingSection() {
  const { body } = splitFrontmatter(composeVivaldi('antigravity'));
  const start = body.indexOf('## Model Routing');
  assert.notEqual(start, -1, 'expected ## Model Routing section in Antigravity Vivaldi entrypoint');
  const nextHeading = body.indexOf('\n## ', start + '## Model Routing'.length);
  return nextHeading === -1 ? body.slice(start) : body.slice(start, nextHeading);
}

test('Antigravity Vivaldi entrypoint exposes clean skill frontmatter and no hardcoded model', () => {
  const { frontmatter } = splitFrontmatter(composeVivaldi('antigravity'));
  assert.match(frontmatter, /^name: 10x-squad$/m);
  assert.match(frontmatter, /^description: /m);
  assert.doesNotMatch(frontmatter, /^model:/m);
});

test('Antigravity Vivaldi Model Routing detects antigravity surfaces and invokes the per-persona resolver', () => {
  const section = modelRoutingSection();

  assert.match(section, /detect-surface --family antigravity/);
  assert.match(section, /antigravity-cli/);
  assert.match(section, /antigravity-desktop/);
  assert.match(section, /node \.agents\/skills\/10x-squad-configure-tiers\/scripts\/model-tier-config\.js resolve/);
  assert.match(section, /--workspace-root/);
  assert.match(section, /--harness <detected-surface>/);
  assert.match(section, /--tier <canonical-tier-key>/);
  assert.match(section, /--persona <persona-key>/);
  assert.match(section, /--json/);

  for (const tier of TIER_KEYS) {
    assert.ok(section.includes(tier), `expected canonical tier key ${tier}`);
  }
  for (const persona of PERSONA_KEYS) {
    assert.ok(section.includes(`\`${persona}\``), `expected canonical persona key ${persona}`);
  }

  assert.match(section, /Every persona dispatch resolves its own/);
  assert.match(section, /never reuse another persona/);
  assert.match(section, /re-resolve/);
});

test('Antigravity Vivaldi Model Routing documents invoke_subagent/swarm actuation, advisory, override, and failure contract', () => {
  const section = modelRoutingSection();

  assert.match(section, /invoke_subagent/);
  assert.match(section, /swarm/);
  assert.match(section, /Never claim executed-model verification on Antigravity/);
  assert.match(section, /resolve-advisory/);
  assert.match(section, /recommendation/);
  assert.match(section, /never blocks/);
  assert.match(section, /cannot change its own model/);
  assert.match(section, /announce nothing and continue/);
  assert.match(section, /\*\*One-dispatch override:\*\*/);
  assert.match(section, /\*\*Hard failure contract\.\*\*/);

  for (const foreign of ['runSubagent', 'spawn_agent', 'wait_agent', 'copilot-cli', 'codex-app', 'claude-cli', 'claude-desktop']) {
    assert.ok(!section.includes(foreign), `Antigravity routing must not reference foreign token ${foreign}`);
  }
  assert.doesNotMatch(section, /\b(?:claude-(?:opus|sonnet|haiku)|gpt-\d|gemini-\d)/i);
});

test('Antigravity persona subagents map least-privilege tools without hardcoding model', () => {
  assert.equal(composePersonaForAntigravity, composeAntigravityPersonaAgent);

  for (const [persona, spec] of Object.entries(PERSONA_AGENTS)) {
    const raw = composeAntigravityPersonaAgent(persona);
    const { frontmatter, body } = splitFrontmatter(raw);

    assert.match(frontmatter, new RegExp(`^name: ${spec.name}$`, 'm'));
    assert.match(frontmatter, /^subagent: true$/m);
    assert.match(frontmatter, /^mainAgent: false$/m);
    assert.doesNotMatch(frontmatter, /^model:/m);

    const expectedTools = new Set();
    for (const tool of spec.tools) {
      for (const mapped of ANTIGRAVITY_TOOL_MAP[tool] || []) {
        expectedTools.add(mapped);
      }
    }
    for (const expectedTool of expectedTools) {
      assert.match(frontmatter, new RegExp(`^  - ${expectedTool}$`, 'm'));
    }

    assert.ok(body.length > 0, `expected non-empty persona body for ${persona}`);
  }

  const sentinelFm = splitFrontmatter(composeAntigravityPersonaAgent('sentinel')).frontmatter;
  assert.doesNotMatch(sentinelFm, /edit_file/);
  assert.doesNotMatch(sentinelFm, /write_file/);
  assert.doesNotMatch(sentinelFm, /run_command/);
});
