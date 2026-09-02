#!/usr/bin/env node

'use strict';

const fs = require('node:fs');

const COLUMNS = [
  'timestamp',
  'variant',
  'prompt_sha',
  'harness',
  'requested_model',
  'requested_reasoning',
  'observed_models',
  'task',
  'rep',
  'pass',
  'agent_exit',
  'input_tokens',
  'cached_input_tokens',
  'output_tokens',
  'duration_ms',
  'model_calls',
  'subagent_calls',
  'tool_calls',
  'cost_usd',
  'event_parse_errors',
  'raw_events',
];
const HEADER = COLUMNS.join(',');

function encodeCell(value) {
  const text = value === undefined || value === null ? '' : String(value);
  if (!/[",\r\n]/.test(text)) {
    return text;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

function initialize(csvPath) {
  if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(csvPath, `${HEADER}\r\n`, { flag: 'wx' });
    return;
  }

  const firstLine = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/, 1)[0];
  if (firstLine !== HEADER) {
    throw new Error(`incompatible results CSV schema in ${csvPath}`);
  }
}

function append(csvPath, values) {
  initialize(csvPath);
  if (values.length !== COLUMNS.length) {
    throw new Error(`expected ${COLUMNS.length} result fields, received ${values.length}`);
  }
  fs.appendFileSync(csvPath, `${values.map(encodeCell).join(',')}\r\n`);
}

function main(argv) {
  const [command, csvPath, ...values] = argv.slice(2);
  try {
    if (command === 'init' && csvPath && values.length === 0) {
      initialize(csvPath);
      return 0;
    }
    if (command === 'append' && csvPath) {
      append(csvPath, values);
      return 0;
    }
    throw new Error('usage: result-csv.js <init|append> <csv-path> [result fields]');
  } catch (error) {
    console.error(`result-csv failed: ${error.message}`);
    return 2;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv);
}

module.exports = {
  COLUMNS,
  HEADER,
  append,
  encodeCell,
  initialize,
};