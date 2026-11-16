'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Vivaldi's doctrine has exactly one source: assets/vivaldi/core.md. Each
// harness entrypoint is that core with its own frontmatter and its own dispatch
// section substituted in. Hand-maintaining a second copy is what produced the
// split-brain lineage documented in docs/review/REVIEW.md F1.

const vivaldiRoot = path.resolve(__dirname, '..', 'assets', 'vivaldi');
const skillsRoot = path.resolve(__dirname, '..', 'assets', 'skills');
const DISPATCH_MARKER = '{{DISPATCH}}\n';

const harnessEntrypoints = {
  copilot: { frontmatter: 'frontmatter-copilot.yml', dispatch: 'dispatch-copilot.md' },
  codex: { frontmatter: 'frontmatter-codex.yml', dispatch: 'dispatch-codex.md' },
  claude: { frontmatter: 'frontmatter-claude.yml', dispatch: 'dispatch-claude.md' },
  antigravity: { frontmatter: 'frontmatter-antigravity.yml', dispatch: 'dispatch-antigravity.md' },
};

// Copilot tool categories (PERSONA_AGENTS[*].tools) translated to Claude Code
// tool names, so both harnesses scope each persona from one declaration.
// Optional MCP servers (marrow/*) are left out: a Claude Code agent's tools list
// must name tools that exist, and an absent server would break the agent.
const CLAUDE_TOOL_MAP = Object.freeze({
  read: Object.freeze(['Read']),
  search: Object.freeze(['Grep', 'Glob']),
  edit: Object.freeze(['Edit', 'Write']),
  execute: Object.freeze(['Bash']),
});

const ANTIGRAVITY_TOOL_MAP = Object.freeze({
  read: Object.freeze(['read_file']),
  search: Object.freeze(['read_file']),
  edit: Object.freeze(['edit_file', 'write_file']),
  execute: Object.freeze(['run_command', 'manage_task']),
});

function mapPersonaTools(copilotTools, toolMap, harnessLabel) {
  const tools = [];
  for (const tool of copilotTools) {
    if (tool.endsWith('/*')) continue;
    const mapped = toolMap[tool];
    if (!mapped) {
      throw new Error(`No ${harnessLabel} tool mapping for persona tool "${tool}"`);
    }
    for (const name of mapped) {
      if (!tools.includes(name)) tools.push(name);
    }
  }
  return tools;
}

function claudeToolsFor(copilotTools) {
  return mapPersonaTools(copilotTools, CLAUDE_TOOL_MAP, 'Claude Code');
}

function antigravityToolsFor(copilotTools) {
  return mapPersonaTools(copilotTools, ANTIGRAVITY_TOOL_MAP, 'Antigravity');
}

const PERSONA_AGENTS = Object.freeze({
  einstein: Object.freeze({
    name: '10x-einstein',
    skill: '10x-einstein-deliberation',
    description:
      'Einstein — Deliberation Agent. Structured deliberation, assumption surfacing, and architectural tradeoff analysis. No code, no specs.',
    tools: Object.freeze(['read', 'search', 'marrow/*']),
  }),
  peter: Object.freeze({
    name: '10x-peter',
    skill: '10x-peter-spec',
    description:
      'Peter — Technical Spec Agent. Produces structured technical specs from Einstein briefs or direct task input. No code, no filler, no implementation.',
    tools: Object.freeze(['read', 'search', 'marrow/*']),
  }),
  linus: Object.freeze({
    name: '10x-linus',
    skill: '10x-linus-build',
    description:
      'Linus — Build Agent. Implements specs with clean, minimal, idiomatic code. No spec deviation. No speculative features.',
    tools: Object.freeze(['read', 'edit', 'search', 'execute', 'marrow/*']),
  }),
  cobalt: Object.freeze({
    name: '10x-cobalt',
    skill: '10x-cobalt-review',
    description:
      'Cobalt — Senior Code Review Agent. Reviews code against spec with adversarial mindset. Strict severity calibration, structured output, no implementation.',
    tools: Object.freeze(['read', 'search', 'execute', 'marrow/*']),
  }),
  sentinel: Object.freeze({
    name: '10x-sentinel',
    skill: '10x-sentinel-review',
    description:
      'Sentinel — Security & Data-Integrity Review Agent. Fires in parallel with Cobalt on sensitive-surface or Complex-tier changes. Owns the security/data-integrity domain disjoint from Cobalt. No implementation.',
    tools: Object.freeze(['read', 'search', 'marrow/*']),
  }),
  ralph: Object.freeze({
    name: '10x-ralph',
    skill: '10x-ralph-test',
    description:
      'Ralph — Test Agent. Writes and runs tests against acceptance criteria. Strict output format, no result fabrication, no implementation fixes.',
    tools: Object.freeze(['read', 'edit', 'search', 'execute', 'marrow/*']),
  }),
});

// Normalized to LF: a checkout with core.autocrlf=true (Windows default) or a
// zip download must compose byte-identical entrypoints on every OS.
function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function readPart(name) {
  return readText(path.join(vivaldiRoot, name));
}

function stripLeadingFrontmatter(markdown) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n+/, '');
}

function composeVivaldi(harness) {
  const entrypoint = harnessEntrypoints[harness];
  if (!entrypoint) {
    throw new Error(`Unknown Vivaldi harness: ${harness}`);
  }

  const core = readPart('core.md');
  if (!core.includes(DISPATCH_MARKER)) {
    throw new Error(`assets/vivaldi/core.md is missing the ${DISPATCH_MARKER.trim()} marker`);
  }

  const body = core.replace(DISPATCH_MARKER, readPart(entrypoint.dispatch));
  return `---\n${readPart(entrypoint.frontmatter)}---\n${body}`;
}

function composePersonaAgent(personaKey) {
  const body = personaBody(personaKey);
  const spec = PERSONA_AGENTS[personaKey];
  const toolsYaml = spec.tools.map((tool) => `  - ${JSON.stringify(tool)}`).join('\n');

  const frontmatter = [
    '---',
    `name: ${spec.name}`,
    `description: ${JSON.stringify(spec.description)}`,
    'tools:',
    toolsYaml,
    'user-invocable: false',
    'disable-model-invocation: false',
    'agents: []',
    '---',
  ].join('\n');

  return `${frontmatter}\n\n${body}\n`;
}

function personaBody(personaKey) {
  if (!Object.hasOwn(PERSONA_AGENTS, personaKey)) {
    throw new Error(
      `Unknown persona: ${personaKey}. Expected one of: ${Object.keys(PERSONA_AGENTS).join(', ')}`
    );
  }
  const spec = PERSONA_AGENTS[personaKey];
  return stripLeadingFrontmatter(readText(path.join(skillsRoot, spec.skill, 'SKILL.md'))).trim();
}

// Claude Code subagent (.claude/agents/<name>.md). No `model:` key: the model
// and effort are supplied per dispatch by Vivaldi from the resolved profile,
// and a frontmatter pin would silently win whenever a dispatch omitted one.
// No Agent/Task tool: personas never dispatch subagents of their own.
function composeClaudePersonaAgent(personaKey) {
  const body = personaBody(personaKey);
  const spec = PERSONA_AGENTS[personaKey];
  const frontmatter = [
    '---',
    `name: ${spec.name}`,
    `description: ${JSON.stringify(spec.description)}`,
    `tools: ${claudeToolsFor(spec.tools).join(', ')}`,
    '---',
  ].join('\n');
  return `${frontmatter}\n\n${body}\n`;
}

// Antigravity custom subagent (.agents/agents/<name>.md or
// ~/.gemini/config/agents/<name>.md). No `model:` key: Vivaldi supplies the
// resolved model per dispatch, and no subagent tools are included so personas
// stay at depth 1.
function composeAntigravityPersonaAgent(personaKey) {
  const body = personaBody(personaKey);
  const spec = PERSONA_AGENTS[personaKey];
  const toolsYaml = antigravityToolsFor(spec.tools).map((tool) => `  - ${tool}`).join('\n');
  const frontmatter = [
    '---',
    `name: ${spec.name}`,
    `description: ${JSON.stringify(spec.description)}`,
    'subagent: true',
    'mainAgent: false',
    'tools:',
    toolsYaml,
    '---',
  ].join('\n');
  return `${frontmatter}\n\n${body}\n`;
}

function composePersonaAgents() {
  return Object.keys(PERSONA_AGENTS).map((persona) => ({
    persona,
    name: PERSONA_AGENTS[persona].name,
    content: composePersonaAgent(persona),
    contents: () => composePersonaAgent(persona),
  }));
}

module.exports = {
  ANTIGRAVITY_TOOL_MAP,
  CLAUDE_TOOL_MAP,
  PERSONA_AGENTS,
  antigravityToolsFor,
  claudeToolsFor,
  composeAntigravityPersonaAgent,
  composeClaudePersonaAgent,
  composePersonaAgent,
  composePersonaAgents,
  composePersonaForAntigravity: composeAntigravityPersonaAgent,
  composeVivaldi,
  harnessEntrypoints,
};
