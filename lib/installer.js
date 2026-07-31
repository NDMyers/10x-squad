'use strict';

const crypto = require('node:crypto');
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

// Copilot discovers project skills from every one of these roots, not just the
// one matching the active harness. The installer writes the same skill names
// under two of them (.github for copilot, .agents for codex), so a workspace can
// legitimately hold several copies of one skill name; whichever the harness
// loads last silently shadows the rest. Installing all harnesses together keeps
// the copies byte-identical and the shadowing harmless — a single-harness
// install is what lets them drift.
const SKILL_DISCOVERY_ROOTS = [
  path.join('.github', 'skills'),
  path.join('.agents', 'skills'),
  path.join('.claude', 'skills'),
];

// Path-and-content digest: a missing or extra file must differ, not just edited
// bytes, so a partially-copied tree is reported rather than passing as current.
function skillDigest(skillDir) {
  const hash = crypto.createHash('sha256');
  for (const file of walkFiles(skillDir)) {
    hash.update(path.relative(skillDir, file));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

// Reports skills present in more than one discovery root where at least one copy
// no longer matches the shipped assets. One stale copy on its own shadows
// nothing, so it is deliberately not reported here.
function detectShadowedSkills(targetDirectory, names = skillNames) {
  const shadowed = [];

  for (const skillName of names) {
    const canonical = skillDigest(path.join(sourceRoot, 'skills', skillName));
    const copies = [];

    for (const root of SKILL_DISCOVERY_ROOTS) {
      const skillDir = path.join(targetDirectory, root, skillName);
      if (!fs.existsSync(skillDir)) {
        continue;
      }
      copies.push({ root, current: skillDigest(skillDir) === canonical });
    }

    if (copies.length < 2 || copies.every((copy) => copy.current)) {
      continue;
    }

    shadowed.push({
      skillName,
      copies,
      staleRoots: copies.filter((copy) => !copy.current).map((copy) => copy.root),
    });
  }

  return shadowed;
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
    shadowed: detectShadowedSkills(targetDirectory),
  };
}

// Only directories the manifest itself created are candidates, and only while
// empty — a shared root such as .github/skills usually still holds skills from
// other bundles, and .10x-squad/model-routing.json is never in the manifest at
// all, so a user's routing configuration survives uninstall.
function pruneEmptyDirectories(targetDirectory, assets) {
  const directories = new Set();

  for (const asset of assets) {
    let dir = path.dirname(asset.target);
    while (dir && dir !== '.' && dir !== path.sep) {
      directories.add(dir);
      dir = path.dirname(dir);
    }
  }

  // Deepest first, so a parent is only reconsidered once its children are gone.
  const deepestFirst = [...directories].sort(
    (a, b) => b.split(path.sep).length - a.split(path.sep).length
  );

  for (const relative of deepestFirst) {
    const full = path.join(targetDirectory, relative);
    try {
      if (fs.readdirSync(full).length === 0) {
        fs.rmdirSync(full);
      }
    } catch {
      // Missing or non-empty: nothing to prune.
    }
  }
}

// Removes exactly what `install` writes for the selected harnesses, so the
// manifest stays the single description of what this package owns.
function uninstallTenXSquad(options = {}) {
  const targetDirectory = resolveTargetDirectory(options.directory, options.cwd);
  assertTargetDirectory(targetDirectory);

  const selected = assetsFor(options.harness);
  const removed = [];

  for (const asset of selected) {
    const target = path.join(targetDirectory, asset.target);
    if (!fs.existsSync(target)) {
      continue;
    }
    fs.rmSync(target, { force: true });
    removed.push(asset.target);
  }

  pruneEmptyDirectories(targetDirectory, selected);

  return {
    targetDirectory,
    harnesses: resolveHarnesses(options.harness),
    removed,
  };
}

module.exports = {
  HARNESSES,
  SKILL_DISCOVERY_ROOTS,
  assertTargetDirectory,
  assetsFor,
  detectShadowedSkills,
  installTenXSquad,
  resolveHarnesses,
  resolveTargetDirectory,
  skillNames,
  uninstallTenXSquad,
};
