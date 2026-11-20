#!/usr/bin/env node
// Blind-judging helper for eval runs that saved a final.patch.
//
//   blind.js pack   --csv results.csv --task NAME --out DIR [--seed N]
//   blind.js reveal --out DIR
//
// pack shuffles every run of one task under letters, copies each patch to
// DIR/packet/<letter>.patch, and writes DIR/blind-key.json (the only file that names the
// arm), DIR/JUDGE.md (the rubric to give the judge) and DIR/scores.csv (to fill in).
// Give the judge DIR/packet and DIR/JUDGE.md only. reveal joins the filled-in scores
// with the key and prints a per-arm summary.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RUBRIC_FIELDS = ['correctness', 'completeness', 'repo_fit'];
const JUDGE_BRIEF = `# Blind review

Each file in \`packet/\` is one attempt at the same task, shown as a unified diff against the same starting repo. You do not know which approach produced which attempt, and it must not influence you.

For every attempt, score 1 to 5 (5 is best) on:

- **correctness**: does the change do what the task asked, with no bugs you can find by reading it?
- **completeness**: is every part of the request handled, including edge cases it implies?
- **repo_fit**: does it follow the conventions and structure already in the repo, without unrelated changes?

Also say whether you would merge it as is (\`yes\` or \`no\`), and note the single biggest problem. Fill in \`scores.csv\`, one row per letter. Do not run a comparison between letters until every row is scored.
`;

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

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body.map((values) => Object.fromEntries(header.map((name, index) => [name, values[index] ?? ''])));
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function letterFor(index) {
  let name = '';
  let value = index;
  do {
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return name;
}

function pack({ csv, task, out, seed = 1, evalsRoot }) {
  const root = evalsRoot || path.dirname(path.resolve(csv));
  const rows = parseCsv(fs.readFileSync(csv, 'utf8')).filter((row) => row.task === task);
  const candidates = [];
  const skipped = [];
  for (const row of rows) {
    const runDir = path.resolve(root, path.dirname(row.raw_events));
    const patch = path.join(runDir, 'final.patch');
    if (fs.existsSync(patch) && fs.statSync(patch).size > 0) candidates.push({ row, patch });
    else skipped.push(`${row.variant} rep ${row.rep}`);
  }
  if (candidates.length === 0) throw new Error(`no runs of task ${task} have a non-empty final.patch`);

  const ordered = shuffle(candidates, seededRandom(seed));
  fs.mkdirSync(path.join(out, 'packet'), { recursive: true });
  const key = {};
  ordered.forEach(({ row, patch }, index) => {
    const letter = letterFor(index);
    fs.copyFileSync(patch, path.join(out, 'packet', `${letter}.patch`));
    key[letter] = {
      variant: row.variant,
      rep: Number(row.rep),
      credits: row.credits === '' ? null : Number(row.credits),
      hidden_tests_fraction: row.quality === '' ? null : Number(row.quality),
      pass: Number(row.pass),
      source: path.relative(root, patch),
    };
  });
  fs.writeFileSync(path.join(out, 'blind-key.json'), `${JSON.stringify({ task, seed, key }, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'JUDGE.md'), JUDGE_BRIEF);
  const header = ['letter', ...RUBRIC_FIELDS, 'would_merge', 'biggest_problem'].join(',');
  const body = Object.keys(key).map((letter) => `${letter},,,,,`).join('\n');
  fs.writeFileSync(path.join(out, 'scores.csv'), `${header}\n${body}\n`);
  return { packed: ordered.length, skipped };
}

function reveal({ out }) {
  const { key } = JSON.parse(fs.readFileSync(path.join(out, 'blind-key.json'), 'utf8'));
  const scores = parseCsv(fs.readFileSync(path.join(out, 'scores.csv'), 'utf8'));
  const byVariant = new Map();
  for (const score of scores) {
    const entry = key[score.letter];
    if (!entry || RUBRIC_FIELDS.some((field) => score[field] === '')) continue;
    const group = byVariant.get(entry.variant) || { n: 0, merge: 0, credits: [], hidden: [], ...Object.fromEntries(RUBRIC_FIELDS.map((f) => [f, 0])) };
    group.n += 1;
    for (const field of RUBRIC_FIELDS) group[field] += Number(score[field]);
    if (/^y/i.test(score.would_merge)) group.merge += 1;
    if (entry.credits !== null) group.credits.push(entry.credits);
    if (entry.hidden_tests_fraction !== null) group.hidden.push(entry.hidden_tests_fraction);
    byVariant.set(entry.variant, group);
  }
  const average = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
  return [...byVariant.entries()].map(([variant, group]) => ({
    variant,
    scored: group.n,
    ...Object.fromEntries(RUBRIC_FIELDS.map((field) => [field, Number((group[field] / group.n).toFixed(2))])),
    would_merge: `${group.merge}/${group.n}`,
    mean_credits: average(group.credits) === null ? null : Number(average(group.credits).toFixed(1)),
    mean_hidden_tests: average(group.hidden) === null ? null : Number(average(group.hidden).toFixed(2)),
  }));
}

function main(argv) {
  try {
    const [command, ...rest] = argv.slice(2);
    const options = parseArgs(rest);
    if (command === 'pack') {
      if (!options.csv || !options.task || !options.out) throw new Error('pack needs --csv, --task and --out');
      const result = pack({ csv: options.csv, task: options.task, out: options.out, seed: options.seed ? Number(options.seed) : 1 });
      console.log(`packed ${result.packed} attempts into ${options.out}/packet`);
      if (result.skipped.length) console.log(`skipped (no final.patch): ${result.skipped.join(', ')}`);
      return 0;
    }
    if (command === 'reveal') {
      if (!options.out) throw new Error('reveal needs --out');
      console.log(JSON.stringify(reveal({ out: options.out }), null, 2));
      return 0;
    }
    throw new Error('usage: blind.js <pack|reveal> [options]');
  } catch (error) {
    console.error(`blind failed: ${error.message}`);
    return 2;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv);
}

module.exports = { letterFor, pack, parseCsv, reveal, seededRandom, shuffle };
