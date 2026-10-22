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
};

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

function readPart(name) {
  return fs.readFileSync(path.join(vivaldiRoot, name), 'utf8');
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
  if (!Object.hasOwn(PERSONA_AGENTS, personaKey)) {
    throw new Error(
      `Unknown persona: ${personaKey}. Expected one of: ${Object.keys(PERSONA_AGENTS).join(', ')}`
    );
  }

  const spec = PERSONA_AGENTS[personaKey];
  const skillPath = path.join(skillsRoot, spec.skill, 'SKILL.md');
  const rawSkill = fs.readFileSync(skillPath, 'utf8').replace(/\r\n/g, '\n');
  const body = stripLeadingFrontmatter(rawSkill).trim();
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

function composePersonaAgents() {
  return Object.keys(PERSONA_AGENTS).map((persona) => ({
    persona,
    name: PERSONA_AGENTS[persona].name,
    content: composePersonaAgent(persona),
    contents: () => composePersonaAgent(persona),
  }));
}

module.exports = {
  PERSONA_AGENTS,
  composePersonaAgent,
  composePersonaAgents,
  composeVivaldi,
  harnessEntrypoints,
};
