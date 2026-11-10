'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Asset targets are POSIX-relative strings on every OS so the manifest, its
// reports and check-sync output are identical everywhere; path.join() resolves
// them against the native target directory at the filesystem boundary.
const posix = path.posix;

function toPosix(relative) {
  return relative.split(path.sep).join('/');
}

const { PERSONA_AGENTS, composeClaudePersonaAgent, composePersonaAgent, composeVivaldi } = require('./compose');

const packageRoot = path.resolve(__dirname, '..');
const sourceRoot = path.join(packageRoot, 'assets');
const runtimeRoot = path.join(sourceRoot, 'runtime');

const skillNames = [
  '10x-einstein-deliberation',
  '10x-peter-spec',
  '10x-linus-build',
  '10x-cobalt-review',
  '10x-sentinel-review',
  '10x-ralph-test',
  '10x-squad-configure-tiers',
  '10x-squad-toggle-ui',
];

const HARNESSES = ['copilot', 'codex', 'claude'];

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
      target: posix.join(skillsRoot, skillName, toPosix(path.relative(skillDir, source))),
    }));
  });
}

function runtimeAssets() {
  return walkFiles(runtimeRoot).map((source) => ({
    source,
    target: posix.join('.10x-squad', 'runtime', toPosix(path.relative(runtimeRoot, source))),
  }));
}

// Vivaldi is composed from assets/vivaldi/ rather than copied, so both harness
// entrypoints stay derived from one body. Codex has no primary-agent selector,
// so Vivaldi ships there as a root-invocable skill; the persona subagents are
// addressed through the spawn message, not through .codex/agents/ definitions,
// which carry no dispatch target (docs/codex-harness-spike.md, C10).
const harnessAssets = {
  copilot: () => [
    { contents: () => composeVivaldi('copilot'), target: posix.join('.github', 'agents', '10x-squad.agent.md') },
    ...Object.keys(PERSONA_AGENTS).map((persona) => ({
      contents: () => composePersonaAgent(persona),
      target: posix.join('.github', 'agents', `${PERSONA_AGENTS[persona].name}.agent.md`),
    })),
    ...skillAssets(posix.join('.github', 'skills')),
  ],
  codex: () => [
    {
      contents: () => composeVivaldi('codex'),
      target: posix.join('.agents', 'skills', '10x-squad-vivaldi', 'SKILL.md'),
    },
    {
      source: path.join(sourceRoot, 'vivaldi', 'openai.yaml'),
      target: posix.join('.agents', 'skills', '10x-squad-vivaldi', 'agents', 'openai.yaml'),
    },
    ...skillAssets(posix.join('.agents', 'skills')),
  ],
  // Claude Code: Vivaldi is the /10x-squad skill (it must run in the main
  // conversation, because subagents cannot dispatch subagents), and each persona
  // is a real subagent definition with a scoped tool set, addressed by
  // subagent_type (docs/claude-code-harness-spike.md, C1/C10). A user-level
  // install (--directory ~) lands in ~/.claude/, Claude Code's own user root,
  // so no separate mirror is needed.
  claude: () => [
    {
      contents: () => composeVivaldi('claude'),
      target: posix.join('.claude', 'skills', '10x-squad', 'SKILL.md'),
    },
    ...Object.keys(PERSONA_AGENTS).map((persona) => ({
      contents: () => composeClaudePersonaAgent(persona),
      target: posix.join('.claude', 'agents', `${PERSONA_AGENTS[persona].name}.md`),
    })),
    ...skillAssets(posix.join('.claude', 'skills')),
  ],
};

function copilotHomeMirrorAssets() {
  return [
    { contents: () => composeVivaldi('copilot'), target: posix.join('.copilot', 'agents', '10x-squad.agent.md') },
    ...Object.keys(PERSONA_AGENTS).map((persona) => ({
      contents: () => composePersonaAgent(persona),
      target: posix.join('.copilot', 'agents', `${PERSONA_AGENTS[persona].name}.agent.md`),
    })),
    ...skillAssets(posix.join('.copilot', 'skills')),
  ];
}

function isHomeInstallTarget(targetDirectory) {
  if (!targetDirectory) {
    return false;
  }
  const home = os.homedir();
  return Boolean(home) && path.resolve(targetDirectory) === path.resolve(home);
}

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

function assetsFor(requested, options = {}) {
  const runtime = options.includeRuntime === false ? [] : runtimeAssets();
  const harnesses = resolveHarnesses(requested);
  const assets = harnesses.flatMap((harness) => harnessAssets[harness]());
  if (harnesses.includes('copilot') && isHomeInstallTarget(options.targetDirectory)) {
    assets.push(...copilotHomeMirrorAssets());
  }
  return [...runtime, ...assets];
}

// Copilot discovers project skills from every one of these roots, not just the
// one matching the active harness. The installer writes the same skill names
// under two of them (.github for copilot, .agents for codex), so a workspace can
// legitimately hold several copies of one skill name; whichever the harness
// loads last silently shadows the rest. Installing all harnesses together keeps
// the copies byte-identical and the shadowing harmless — a single-harness
// install is what lets them drift.
const SKILL_DISCOVERY_ROOTS = [
  '.github/skills',
  '.agents/skills',
  '.claude/skills',
];

// Path-and-content digest: a missing or extra file must differ, not just edited
// bytes, so a partially-copied tree is reported rather than passing as current.
function skillDigest(skillDir) {
  const hash = crypto.createHash('sha256');
  for (const file of walkFiles(skillDir)) {
    hash.update(toPosix(path.relative(skillDir, file)));
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
  const roots = isHomeInstallTarget(targetDirectory)
    ? [...SKILL_DISCOVERY_ROOTS, '.copilot/skills']
    : SKILL_DISCOVERY_ROOTS;

  for (const skillName of names) {
    const canonical = skillDigest(path.join(sourceRoot, 'skills', skillName));
    const copies = [];

    for (const root of roots) {
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

function assertSafeOwnedTarget(targetDirectory, relativeTarget) {
  if (path.isAbsolute(relativeTarget) || path.normalize(relativeTarget).startsWith(`..${path.sep}`)) {
    throw new Error(`Owned asset target escapes the workspace: ${relativeTarget}`);
  }

  const components = path.normalize(relativeTarget).split(path.sep);
  let current = targetDirectory;
  for (let index = 0; index < components.length; index += 1) {
    current = path.join(current, components[index]);
    if (!fs.existsSync(current)) {
      continue;
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`Owned asset target contains a symbolic link: ${current}`);
    }
    if (index < components.length - 1 && !stat.isDirectory()) {
      throw new Error(`Owned asset parent is not a directory: ${current}`);
    }
  }
}

function writeOwnedFile(target, content) {
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(target, flags, 0o666);
  try {
    fs.writeFileSync(descriptor, content);
  } finally {
    fs.closeSync(descriptor);
  }
}

function installTenXSquad(options = {}) {
  const targetDirectory = resolveTargetDirectory(options.directory, options.cwd);
  assertTargetDirectory(targetDirectory);

  const selected = assetsFor(options.harness, { targetDirectory });

  for (const asset of selected) {
    assertSafeOwnedTarget(targetDirectory, asset.target);
  }

  for (const asset of selected) {
    const target = path.join(targetDirectory, asset.target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    assertSafeOwnedTarget(targetDirectory, asset.target);
    if (asset.contents) {
      writeOwnedFile(target, asset.contents());
    } else {
      writeOwnedFile(target, fs.readFileSync(asset.source));
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
    let dir = posix.dirname(asset.target);
    while (dir && dir !== '.' && dir !== '/') {
      directories.add(dir);
      dir = posix.dirname(dir);
    }
  }

  // Deepest first, so a parent is only reconsidered once its children are gone.
  const deepestFirst = [...directories].sort(
    (a, b) => b.split('/').length - a.split('/').length
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

  const selected = assetsFor(options.harness, { includeRuntime: false, targetDirectory });
  const removed = [];

  for (const asset of [...selected, ...runtimeAssets()]) {
    assertSafeOwnedTarget(targetDirectory, asset.target);
  }

  for (const asset of selected) {
    const target = path.join(targetDirectory, asset.target);
    if (!fs.existsSync(target)) {
      continue;
    }
    fs.rmSync(target, { force: true });
    removed.push(asset.target);
  }

  const anotherHarnessRemains = HARNESSES.some((harness) => {
    const entrypoint = harnessAssets[harness]()[0];
    return fs.existsSync(path.join(targetDirectory, entrypoint.target));
  });
  if (!anotherHarnessRemains) {
    for (const asset of runtimeAssets()) {
      const target = path.join(targetDirectory, asset.target);
      if (!fs.existsSync(target)) {
        continue;
      }
      fs.rmSync(target, { force: true });
      removed.push(asset.target);
      selected.push(asset);
    }
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
  PERSONA_AGENTS,
  SKILL_DISCOVERY_ROOTS,
  assertTargetDirectory,
  assertSafeOwnedTarget,
  assetsFor,
  copilotHomeMirrorAssets,
  detectShadowedSkills,
  installTenXSquad,
  resolveHarnesses,
  resolveTargetDirectory,
  skillNames,
  uninstallTenXSquad,
};
