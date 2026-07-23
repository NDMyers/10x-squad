'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { composeVivaldi } = require('./compose');

const packageRoot = path.resolve(__dirname, '..');
const sourceRoot = path.join(packageRoot, 'assets');

const skillNames = [
  '10x-einstein-deliberation',
  '10x-peter-spec',
  '10x-linus-build',
  '10x-cobalt-review',
  '10x-sentinel-review',
  '10x-ralph-test',
  '10x-squad-configure-tiers',
];

const HARNESSES = ['copilot', 'codex'];

// Sorted recursive walk so asset enumeration is deterministic across
// filesystems (plain code-unit order, no locale dependence).
function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function skillAssets(skillsRoot) {
  return skillNames.flatMap((skillName) => {
    const skillDir = path.join(sourceRoot, 'skills', skillName);
    return walkFiles(skillDir).map((source) => ({
      source,
      target: path.join(skillsRoot, skillName, path.relative(skillDir, source)),
    }));
  });
}

// Vivaldi is composed from assets/vivaldi/ rather than copied, so both harness
// entrypoints stay derived from one body. Codex has no primary-agent selector,
// so Vivaldi ships there as a root-invocable skill; the persona subagents are
// addressed through the spawn message, not through .codex/agents/ definitions,
// which carry no dispatch target (docs/codex-harness-spike.md, C10).
const harnessAssets = {
  copilot: () => [
    { contents: () => composeVivaldi('copilot'), target: path.join('.github', 'agents', '10x-squad.agent.md') },
    ...skillAssets(path.join('.github', 'skills')),
  ],
  codex: () => [
    {
      contents: () => composeVivaldi('codex'),
      target: path.join('.agents', 'skills', '10x-squad-vivaldi', 'SKILL.md'),
    },
    {
      source: path.join(sourceRoot, 'vivaldi', 'openai.yaml'),
      target: path.join('.agents', 'skills', '10x-squad-vivaldi', 'agents', 'openai.yaml'),
    },
    ...skillAssets(path.join('.agents', 'skills')),
  ],
};

function resolveHarnesses(requested) {
  if (!requested || requested === 'all') {
    return [...HARNESSES];
  }

  const selected = Array.isArray(requested) ? requested : [requested];
  for (const harness of selected) {
    if (!HARNESSES.includes(harness)) {
      throw new Error(`Unknown harness: ${harness}. Expected one of ${HARNESSES.join(', ')}, or all.`);
    }
  }

  return selected;
}

function assetsFor(requested) {
  return resolveHarnesses(requested).flatMap((harness) => harnessAssets[harness]());
}

function resolveTargetDirectory(directory, cwd = process.cwd()) {
  if (!directory) {
    return cwd;
  }

  return path.resolve(cwd, directory);
}

function assertTargetDirectory(targetDirectory) {
  let stat;

  try {
    stat = fs.statSync(targetDirectory);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Target directory does not exist: ${targetDirectory}`);
    }

    throw err;
  }

  if (!stat.isDirectory()) {
    throw new Error(`Target path is not a directory: ${targetDirectory}`);
  }

  try {
    fs.accessSync(targetDirectory, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    throw new Error(`Target directory is not writable: ${targetDirectory}`);
  }
}

function installTenXSquad(options = {}) {
  const targetDirectory = resolveTargetDirectory(options.directory, options.cwd);
  assertTargetDirectory(targetDirectory);

  const selected = assetsFor(options.harness);

  for (const asset of selected) {
    const target = path.join(targetDirectory, asset.target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (asset.contents) {
      fs.writeFileSync(target, asset.contents());
    } else {
      fs.copyFileSync(asset.source, target);
    }
  }

  return {
    targetDirectory,
    harnesses: resolveHarnesses(options.harness),
    installed: selected.map((asset) => asset.target),
  };
}

module.exports = {
  HARNESSES,
  assertTargetDirectory,
  assetsFor,
  installTenXSquad,
  resolveHarnesses,
  resolveTargetDirectory,
  skillNames,
};
