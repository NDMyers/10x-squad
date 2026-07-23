#!/usr/bin/env node

'use strict';

const packageJson = require('../package.json');
const { installTenXSquad } = require('../lib/installer');

function printHelp() {
  console.log(`Usage: 10x-squad <command> [options]

Commands:
  install                 Install 10x Squad workspace customization assets

Options:
  -d, --directory <path>  Target project directory
  --harness <name>        copilot | codex | all (default: all)
  -h, --help              Show help
  -v, --version           Show version`);
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

  if (command !== 'install') {
    console.error(`Unknown command: ${command}`);
    printHelp();
    return 1;
  }

  try {
    const options = parseInstallOptions(args.slice(1));
    if (options.help) {
      printHelp();
      return 0;
    }

    const result = installTenXSquad({ directory: options.directory, harness: options.harness });
    console.log(`Installed 10x Squad assets (${result.harnesses.join(', ')}) into ${result.targetDirectory}`);
    return 0;
  } catch (err) {
    console.error(`10x-squad install failed: ${err.message}`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv);
}

module.exports = {
  main,
  parseInstallOptions,
};
