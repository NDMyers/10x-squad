#!/usr/bin/env node

'use strict';

const packageJson = require('../package.json');
const { SKILL_DISCOVERY_ROOTS, installTenXSquad, uninstallTenXSquad } = require('../lib/installer');
const { main: runControl } = require('../assets/runtime/control');

const CONTROL_COMMANDS = ['validate-handoff', 'validate-project', 'transition-project', 'generate-registry'];

function printHelp() {
  console.log(`Usage: 10x-squad <command> [options]

Commands:
  install                 Install 10x Squad workspace customization assets
  uninstall               Remove the assets install writes, leaving
                          .10x-squad/model-routing.json untouched
  validate-handoff        Validate D#/AC# traceability across Markdown artifacts
  validate-project        Validate one project.json and its artifact pointers
  transition-project      Atomically apply an allowed project state transition
  generate-registry       Generate PROJECTS.md from validated project states

Options:
  -d, --directory <path>  Target project directory
  --harness <name>        copilot | codex | all (default: all)
  --brief <path>          Optional deliberation brief for validate-handoff
  --spec <path>           Technical spec for validate-handoff
  --build <path>          Optional build changelist for validate-handoff
  --project <path>        Project directory for state validation/transition
  --state <path>          Proposed project.json for transition-project
  --expected-updated-at <timestamp>
                          Current project.json version for transition-project
  --projects-root <path>  Project directories for generate-registry
  --output <path>         PROJECTS.md destination for generate-registry
  -h, --help              Show help
  -v, --version           Show version`);
}

// A shadowed skill reads on disk as correct while the harness runs an older
// copy, and reloading never helps because nothing is cached. Name the stale
// paths explicitly so the symptom is not mistaken for a caching problem.
function printShadowWarning(shadowed = []) {
  if (shadowed.length === 0) {
    return;
  }

  console.error('');
  console.error('warning: skills installed in multiple discovery roots at different revisions');

  for (const { skillName, copies } of shadowed) {
    console.error(`  ${skillName}`);
    for (const { root, current } of copies) {
      console.error(`    ${root}/${skillName}  ${current ? '(current)' : '(STALE)'}`);
    }
  }

  console.error('');
  console.error(`Copilot loads skills from all of ${SKILL_DISCOVERY_ROOTS.join(', ')}, so a stale`);
  console.error('copy can shadow the current one and reloading will not clear it.');
  console.error('Fix: run `10x-squad install` with no --harness flag to sync every tree.');
}

function parseInstallOptions(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '-d' || arg === '--directory') {
      const directory = args[index + 1];
      if (!directory) {
        throw new Error(`${arg} requires a path`);
      }
      options.directory = directory;
      index += 1;
      continue;
    }

    if (arg === '--harness') {
      const harness = args[index + 1];
      if (!harness) {
        throw new Error(`${arg} requires a name`);
      }
      options.harness = harness;
      index += 1;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function main(argv) {
  const args = argv.slice(2);
  const command = args[0];

  if (!command || command === '-h' || command === '--help') {
    printHelp();
    return 0;
  }

  if (command === '-v' || command === '--version') {
    console.log(packageJson.version);
    return 0;
  }

  if (!['install', 'uninstall', ...CONTROL_COMMANDS].includes(command)) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    return 1;
  }

  if (CONTROL_COMMANDS.includes(command)) {
    return runControl([process.execPath, 'control.js', command, ...args.slice(1)]);
  }

  try {
    const options = parseInstallOptions(args.slice(1));
    if (options.help) {
      printHelp();
      return 0;
    }

    if (command === 'uninstall') {
      const result = uninstallTenXSquad({ directory: options.directory, harness: options.harness });
      console.log(
        `Removed ${result.removed.length} 10x Squad asset(s) (${result.harnesses.join(', ')}) from ${result.targetDirectory}`
      );
      return 0;
    }

    const result = installTenXSquad({ directory: options.directory, harness: options.harness });
    console.log(`Installed 10x Squad assets (${result.harnesses.join(', ')}) into ${result.targetDirectory}`);
    printShadowWarning(result.shadowed);
    return 0;
  } catch (err) {
    console.error(`10x-squad ${command} failed: ${err.message}`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv);
}

module.exports = {
  CONTROL_COMMANDS,
  main,
  parseInstallOptions,
};
