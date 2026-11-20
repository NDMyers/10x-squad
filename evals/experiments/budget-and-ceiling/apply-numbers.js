#!/usr/bin/env node
// Rewrites the three builder budget numbers in a squad checkout, for the budget arms.
//
//   apply-numbers.js --squad-root DIR --calls N --minutes N --no-progress N
//
// Each phrase must appear exactly once. Anything else fails loudly, so a reworded
// prompt cannot silently turn a "budget" arm into a copy of the baseline.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EDITS = [
  {
    file: 'assets/vivaldi/core.md',
    from: 'Start with about 200 calls or 60 minutes, whichever comes first',
    to: ({ calls, minutes }) => `Start with about ${calls} calls or ${minutes} minutes, whichever comes first`,
  },
  {
    file: 'assets/skills/10x-linus-build/SKILL.md',
    from: 'Stop after about 10 calls in a row that neither edit',
    to: ({ noProgress }) => `Stop after about ${noProgress} calls in a row that neither edit`,
  },
];

function applyNumbers(squadRoot, numbers) {
  for (const key of ['calls', 'minutes', 'noProgress']) {
    if (!Number.isInteger(numbers[key]) || numbers[key] < 1) throw new Error(`${key} must be a positive whole number`);
  }
  const written = [];
  for (const edit of EDITS) {
    const file = path.join(squadRoot, edit.file);
    const text = fs.readFileSync(file, 'utf8');
    const count = text.split(edit.from).length - 1;
    if (count !== 1) throw new Error(`${edit.file}: expected the phrase "${edit.from}" exactly once, found ${count}`);
    fs.writeFileSync(file, text.replace(edit.from, () => edit.to(numbers)));
    written.push(edit.file);
  }
  return written;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error('options must be --name value pairs');
    options[key.slice(2)] = value;
  }
  return options;
}

function main(argv) {
  try {
    const options = parseArgs(argv.slice(2));
    if (!options['squad-root'] || !options.calls || !options.minutes || !options['no-progress']) {
      throw new Error('usage: apply-numbers.js --squad-root DIR --calls N --minutes N --no-progress N');
    }
    const written = applyNumbers(options['squad-root'], {
      calls: Number(options.calls),
      minutes: Number(options.minutes),
      noProgress: Number(options['no-progress']),
    });
    console.log(`updated ${written.join(', ')}`);
    return 0;
  } catch (error) {
    console.error(`apply-numbers failed: ${error.message}`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main(process.argv);

module.exports = { applyNumbers };
