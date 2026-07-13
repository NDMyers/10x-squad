'use strict';

const fs = require('node:fs');
const path = require('node:path');

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

const assets = [
  {
    source: path.join(sourceRoot, 'agents', '10x-squad.agent.md'),
    target: path.join('.github', 'agents', '10x-squad.agent.md'),
  },
  ...skillNames.flatMap((skillName) => {
    const skillDir = path.join(sourceRoot, 'skills', skillName);
    return walkFiles(skillDir).map((source) => ({
      source,
      target: path.join('.github', 'skills', skillName, path.relative(skillDir, source)),
    }));
  }),
];

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

  for (const asset of assets) {
    const target = path.join(targetDirectory, asset.target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(asset.source, target);
  }

  return {
    targetDirectory,
    installed: assets.map((asset) => asset.target),
  };
}

module.exports = {
  assertTargetDirectory,
  assets,
  installTenXSquad,
  resolveTargetDirectory,
};
