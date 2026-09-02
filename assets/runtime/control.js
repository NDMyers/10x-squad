#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateHandoff } = require('./handoff-validator');
const { generateRegistry, loadProjectRecords, transitionProject, validateProject } = require('./project-state');

function parseHandoffOptions(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!['--brief', '--spec', '--build'].includes(arg)) {
      throw new Error(`Unknown option: ${arg}`);
    }

    const value = args[index + 1];
    if (!value) {
      throw new Error(`${arg} requires a path`);
    }
    options[arg.slice(2)] = value;
    index += 1;
  }

  if (!options.spec) {
    throw new Error('validate-handoff requires --spec');
  }
  return options;
}

function runHandoffValidation(paths) {
  return validateHandoff({
    brief: paths.brief === undefined ? undefined : fs.readFileSync(paths.brief, 'utf8'),
    spec: fs.readFileSync(paths.spec, 'utf8'),
    build: paths.build === undefined ? undefined : fs.readFileSync(paths.build, 'utf8'),
  });
}

function parseNamedPaths(args, required) {
  const options = {};
  const allowed = new Set(required.map((name) => `--${name}`));

  for (let index = 0; index < args.length; index += 2) {
    const arg = args[index];
    const value = args[index + 1];
    if (!allowed.has(arg)) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (!value) {
      throw new Error(`${arg} requires a path`);
    }
    options[arg.slice(2)] = value;
  }

  for (const name of required) {
    if (!options[name]) {
      throw new Error(`--${name} is required`);
    }
  }
  return options;
}

function main(argv) {
  const [command, ...args] = argv.slice(2);
  if (!['validate-handoff', 'validate-project', 'transition-project', 'generate-registry'].includes(command)) {
    console.error('usage: control.js <validate-handoff|validate-project|transition-project|generate-registry> [options]');
    return 2;
  }

  try {
    if (command === 'validate-handoff') {
      const result = runHandoffValidation(parseHandoffOptions(args));
      console.log(JSON.stringify(result));
      return result.ok ? 0 : 1;
    }

    if (command === 'validate-project') {
      const options = parseNamedPaths(args, ['project']);
      const result = validateProject(options.project);
      console.log(JSON.stringify(result));
      return result.ok ? 0 : 1;
    }

    if (command === 'transition-project') {
      const options = parseNamedPaths(args, ['project', 'state', 'expected-updated-at']);
      const nextState = JSON.parse(fs.readFileSync(options.state, 'utf8'));
      const result = transitionProject(options.project, nextState, options['expected-updated-at']);
      console.log(JSON.stringify(result));
      return result.ok ? 0 : 1;
    }

    const options = parseNamedPaths(args, ['projects-root', 'output']);
    const existingRegistry = fs.existsSync(options.output) ? fs.readFileSync(options.output, 'utf8') : '';
    const projects = loadProjectRecords(options['projects-root'], existingRegistry);
    fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
    fs.writeFileSync(options.output, generateRegistry(options['projects-root'], existingRegistry));
    console.log(JSON.stringify({ ok: true, projects: projects.length, output: options.output }));
    return 0;
  } catch (error) {
    console.error(`10x-squad ${command} failed: ${error.message}`);
    return 2;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv);
}

module.exports = {
  main,
  parseHandoffOptions,
  parseNamedPaths,
  runHandoffValidation,
};