'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Vivaldi's doctrine has exactly one source: assets/vivaldi/core.md. Each
// harness entrypoint is that core with its own frontmatter and its own dispatch
// section substituted in. Hand-maintaining a second copy is what produced the
// split-brain lineage documented in docs/review/REVIEW.md F1.

const vivaldiRoot = path.resolve(__dirname, '..', 'assets', 'vivaldi');
const DISPATCH_MARKER = '{{DISPATCH}}\n';

const harnessEntrypoints = {
  copilot: { frontmatter: 'frontmatter-copilot.yml', dispatch: 'dispatch-copilot.md' },
  codex: { frontmatter: 'frontmatter-codex.yml', dispatch: 'dispatch-codex.md' },
};

function readPart(name) {
  return fs.readFileSync(path.join(vivaldiRoot, name), 'utf8');
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

module.exports = {
  composeVivaldi,
  harnessEntrypoints,
};
