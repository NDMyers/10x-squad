#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateHandoff } = require('./handoff-validator');
const { generateRegistry, loadProjectRecords, transitionProject, validateProject } = require('./project-state');
const { validateReview } = require('./review-validator');
const { renderBoard, serveBoard, syncProjectDashboard, toggleUi } = require('./workflow-board');
const { partitionFilePlan, verifyBuild } = require('./build-verifier');
const { advancePhase } = require('./phase-runner');

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

function parseNamedPaths(args, required, optional = []) {
  const options = {};
  const allowed = new Set([...required, ...optional].map((name) => `--${name}`));

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

function runReviewValidation(paths) {
  return validateReview({
    spec: fs.readFileSync(paths.spec, 'utf8'),
    review: fs.readFileSync(paths.review, 'utf8'),
    sentinelReview: paths['sentinel-review'] === undefined ? undefined : fs.readFileSync(paths['sentinel-review'], 'utf8'),
    previousReview: paths['previous-review'] === undefined ? undefined : fs.readFileSync(paths['previous-review'], 'utf8'),
  });
}

function parseToggleUiOptions(args) {
  const options = { mode: 'toggle', scope: 'global' };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--on' || arg === '--enable') {
      options.mode = 'on';
    } else if (arg === '--off' || arg === '--disable') {
      options.mode = 'off';
    } else if (arg === '--toggle') {
      options.mode = 'toggle';
    } else if (arg === '--status') {
      options.mode = 'status';
    } else if (['--mode', '--scope', '--workspace-root', '--project', '--harness', '--repo-root'].includes(arg)) {
      const val = args[i + 1];
      if (!val) throw new Error(`${arg} requires a value`);
      options[arg.slice(2)] = val;
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function main(argv) {
  const [command, ...args] = argv.slice(2);
  if (![
    'validate-handoff',
    'validate-review',
    'verify-build',
    'partition-plan',
    'advance-phase',
    'validate-project',
    'transition-project',
    'generate-registry',
    'render-board',
    'serve-board',
    'toggle-ui',
  ].includes(command)) {
    console.error(
      'usage: control.js <validate-handoff|validate-review|verify-build|partition-plan|advance-phase|validate-project|transition-project|generate-registry|render-board|serve-board|toggle-ui> [options]'
    );
    return 2;
  }

  try {
    if (command === 'toggle-ui') {
      const opts = parseToggleUiOptions(args);
      const result = toggleUi({
        mode: opts.mode,
        scope: opts.scope,
        workspaceRoot: opts['workspace-root'],
        projectDirectory: opts.project,
        harness: opts.harness,
        repoRoot: opts['repo-root'],
      });
      console.log(JSON.stringify(result));
      return 0;
    }

    if (command === 'validate-handoff') {
      const paths = parseHandoffOptions(args);
      const result = runHandoffValidation(paths);
      try {
        syncProjectDashboard(path.dirname(path.resolve(paths.spec)));
      } catch {}
      console.log(JSON.stringify(result));
      return result.ok ? 0 : 1;
    }

    if (command === 'validate-review') {
      const options = parseNamedPaths(args, ['spec', 'review'], ['sentinel-review', 'previous-review']);
      const result = runReviewValidation(options);
      try {
        syncProjectDashboard(path.dirname(path.resolve(options.spec)));
      } catch {}
      console.log(JSON.stringify(result));
      return result.ok ? 0 : 1;
    }

    if (command === 'verify-build') {
      const options = parseNamedPaths(args, ['spec', 'build'], ['repo-root', 'enforce-file-plan']);
      const result = verifyBuild({
        spec: fs.readFileSync(options.spec, 'utf8'),
        build: fs.readFileSync(options.build, 'utf8'),
        repoRoot: options['repo-root'],
        enforceFilePlan: options['enforce-file-plan'] === 'true',
      });
      try {
        syncProjectDashboard(path.dirname(path.resolve(options.spec)), {
          repoRoot: options['repo-root'],
        });
      } catch {}
      console.log(JSON.stringify(result));
      return result.ok ? 0 : 1;
    }

    if (command === 'partition-plan') {
      const options = parseNamedPaths(args, ['spec'], ['repo-root']);
      const result = partitionFilePlan({
        spec: fs.readFileSync(options.spec, 'utf8'),
        repoRoot: options['repo-root'],
      });
      console.log(JSON.stringify(result));
      return 0;
    }

    if (command === 'advance-phase') {
      const options = parseNamedPaths(
        args,
        ['project', 'to'],
        ['next-action', 'repo-root', 'workspace-root', 'harness', 'enforce-file-plan']
      );
      const result = advancePhase({
        projectDirectory: options.project,
        targetPhase: options.to,
        nextAction: options['next-action'],
        repoRoot: options['repo-root'],
        workspaceRoot: options['workspace-root'],
        harness: options.harness,
        enforceFilePlan: options['enforce-file-plan'] === 'true',
      });
      console.log(JSON.stringify(result));
      return result.ok ? 0 : 1;
    }

    if (command === 'render-board') {
      const options = parseNamedPaths(
        args,
        ['project'],
        ['format', 'workspace-root', 'repo-root', 'harness']
      );
      process.stdout.write(
        renderBoard(options.project, {
          format: options.format || 'ascii',
          workspaceRoot: options['workspace-root'],
          repoRoot: options['repo-root'],
          harness: options.harness,
        })
      );
      return 0;
    }

    if (command === 'serve-board') {
      const options = parseNamedPaths(
        args,
        ['project'],
        ['port', 'workspace-root', 'repo-root', 'harness']
      );
      serveBoard({
        projectDirectory: options.project,
        port: options.port ? Number(options.port) : 4100,
        workspaceRoot: options['workspace-root'],
        repoRoot: options['repo-root'],
        harness: options.harness,
      }).then(({ url, port }) => {
        console.log(JSON.stringify({ ok: true, url, port, project: options.project }));
      });
      return 0;
    }

    if (command === 'validate-project') {
      const options = parseNamedPaths(args, ['project'], ['workspace-root']);
      const result = validateProject(options.project);
      if (result.ok) {
        try {
          result.ui = syncProjectDashboard(options.project, { workspaceRoot: options['workspace-root'] });
        } catch {}
      }
      console.log(JSON.stringify(result));
      return result.ok ? 0 : 1;
    }

    if (command === 'transition-project') {
      const options = parseNamedPaths(args, ['project', 'state', 'expected-updated-at'], ['workspace-root']);
      const nextState = JSON.parse(fs.readFileSync(options.state, 'utf8'));
      const result = transitionProject(options.project, nextState, options['expected-updated-at']);
      if (result.ok) {
        try {
          result.ui = syncProjectDashboard(options.project, { workspaceRoot: options['workspace-root'] });
        } catch {}
      }
      console.log(JSON.stringify(result));
      return result.ok ? 0 : 1;
    }

    const options = parseNamedPaths(args, ['projects-root', 'output']);
    const existingRegistry = fs.existsSync(options.output) ? fs.readFileSync(options.output, 'utf8') : '';
    const projects = loadProjectRecords(options['projects-root'], existingRegistry);
    fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
    fs.writeFileSync(options.output, generateRegistry(options['projects-root'], existingRegistry));
    try {
      for (const entry of fs.readdirSync(options['projects-root'], { withFileTypes: true })) {
        if (entry.isDirectory()) {
          syncProjectDashboard(path.join(options['projects-root'], entry.name));
        }
      }
    } catch {}
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
  runReviewValidation,
};