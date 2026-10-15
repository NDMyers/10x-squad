'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { extractSection } = require('./handoff-validator');

function parseFilePlan(spec) {
  const section = extractSection(spec, 'File Plan (file path + one-line change description each)')
    || extractSection(spec, 'File Plan');
  const files = [];

  for (const line of section.split(/\r?\n/)) {
    const match = /^\s*-\s+`([^`]+)`\s+(?:—|--|-)\s+\S/.exec(line);
    if (match) {
      files.push(match[1].trim());
    }
  }
  return [...new Set(files)];
}

function parseBuildFiles(build) {
  const section = extractSection(build, 'Changelist');
  const citedFiles = [];
  const supportFiles = [];

  for (const line of section.split(/\r?\n/)) {
    const match = /^\s*-\s+`([^`]+)`\s+\(([^)]+)\)\s+(?:—|--|-)\s+\S/.exec(line);
    if (!match) continue;
    const filePath = match[1].trim();
    const citation = match[2].trim();
    if (citation === 'support') {
      supportFiles.push(filePath);
    } else {
      citedFiles.push(filePath);
    }
  }

  return {
    citedFiles: [...new Set(citedFiles)],
    supportFiles: [...new Set(supportFiles)],
    allFiles: [...new Set([...citedFiles, ...supportFiles])],
  };
}

function checkFileSyntax(fullPath) {
  const ext = path.extname(fullPath).toLowerCase();
  if (ext === '.json') {
    try {
      JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      return { ok: true };
    } catch (error) {
      return { ok: false, check: 'json-parse', message: error.message };
    }
  }

  if (ext === '.js' || ext === '.cjs') {
    const res = spawnSync(process.execPath, ['--check', fullPath], { encoding: 'utf8', timeout: 5000 });
    if (res.status !== 0) {
      return { ok: false, check: 'node-check', message: (res.stderr || res.stdout || 'Syntax error').trim() };
    }
    return { ok: true };
  }

  if (ext === '.rb') {
    const res = spawnSync('ruby', ['-c', fullPath], { encoding: 'utf8', timeout: 5000 });
    if (res.error && res.error.code === 'ENOENT') {
      return { ok: true };
    }
    if (res.status !== 0) {
      return { ok: false, check: 'ruby-c', message: (res.stderr || res.stdout || 'Ruby syntax error').trim() };
    }
    return { ok: true };
  }

  return { ok: true };
}

function verifyBuild({ spec, build, repoRoot, enforceFilePlan = false }) {
  if (typeof spec !== 'string') {
    throw new TypeError('spec must be a string');
  }
  if (typeof build !== 'string') {
    throw new TypeError('build must be a string');
  }

  const plannedFiles = parseFilePlan(spec);
  const { citedFiles, supportFiles, allFiles } = parseBuildFiles(build);
  const errors = [];
  const warnings = [];

  if (plannedFiles.length > 0) {
    const plannedSet = new Set(plannedFiles);
    const builtSet = new Set(allFiles);

    const unplannedFiles = citedFiles.filter((file) => !plannedSet.has(file));
    const untouchedPlanned = plannedFiles.filter((file) => !builtSet.has(file));

    if (unplannedFiles.length > 0) {
      const entry = { code: 'UNPLANNED_BUILD_FILES', files: unplannedFiles };
      if (enforceFilePlan) {
        errors.push(entry);
      } else {
        warnings.push(entry);
      }
    }

    if (untouchedPlanned.length > 0) {
      const entry = { code: 'UNTOUCHED_FILE_PLAN_ENTRIES', files: untouchedPlanned };
      if (enforceFilePlan) {
        errors.push(entry);
      } else {
        warnings.push(entry);
      }
    }
  }

  const syntaxFailures = [];
  if (repoRoot && typeof repoRoot === 'string' && fs.existsSync(repoRoot)) {
    for (const relPath of allFiles) {
      if (path.isAbsolute(relPath) || relPath.split(/[\\/]/).includes('..')) {
        continue;
      }
      const fullPath = path.resolve(repoRoot, relPath);
      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
        continue;
      }
      const check = checkFileSyntax(fullPath);
      if (!check.ok) {
        syntaxFailures.push({ file: relPath, check: check.check, message: check.message });
      }
    }
  }

  if (syntaxFailures.length > 0) {
    errors.push({ code: 'SYNTAX_CHECK_FAILED', failures: syntaxFailures });
  }

  return {
    ok: errors.length === 0,
    planned_files: plannedFiles,
    cited_files: citedFiles,
    support_files: supportFiles,
    errors,
    warnings,
  };
}

function extractLocalReferences(filePath, content, candidateFiles) {
  const refs = new Set();
  const baseNames = new Map();
  for (const candidate of candidateFiles) {
    if (candidate === filePath) continue;
    const parsed = path.parse(candidate);
    baseNames.set(parsed.name.toLowerCase(), candidate);
    baseNames.set(candidate.toLowerCase(), candidate);
  }

  const importPattern = /(?:require\s*\(\s*['"]([^'"]+)['"]\s*\)|from\s+['"]([^'"]+)['"]|require_relative\s+['"]([^'"]+)['"])/g;
  for (const match of content.matchAll(importPattern)) {
    const rawTarget = match[1] || match[2] || match[3];
    if (!rawTarget) continue;
    const resolvedDir = path.posix.normalize(path.posix.join(path.posix.dirname(filePath), rawTarget));
    for (const candidate of candidateFiles) {
      const withoutExt = candidate.replace(/\.[^.]+$/, '');
      if (candidate === resolvedDir || withoutExt === resolvedDir) {
        refs.add(candidate);
      }
    }
  }

  for (const [token, candidate] of baseNames.entries()) {
    if (token.length >= 4 && content.toLowerCase().includes(token)) {
      refs.add(candidate);
    }
  }

  return [...refs];
}

function partitionFilePlan({ spec, repoRoot }) {
  if (typeof spec !== 'string') {
    throw new TypeError('spec must be a string');
  }

  const files = parseFilePlan(spec);
  if (files.length < 4) {
    return {
      mode: 'single_builder',
      file_count: files.length,
      batches: files.length > 0 ? [files] : [],
      reason: 'Fewer than 4 files in File Plan; single Linus dispatch avoids context duplication and seam risk.',
    };
  }

  const parent = new Map(files.map((f) => [f, f]));
  const find = (x) => {
    let root = x;
    while (parent.get(root) !== root) {
      root = parent.get(root);
    }
    let curr = x;
    while (curr !== root) {
      const next = parent.get(curr);
      parent.set(curr, root);
      curr = next;
    }
    return root;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent.set(rootB, rootA);
    }
  };

  // Group files in the same immediate directory or sharing a stem (e.g. foo.rb + foo_spec.rb)
  for (let i = 0; i < files.length; i += 1) {
    for (let j = i + 1; j < files.length; j += 1) {
      const a = files[i];
      const b = files[j];
      const stemA = path.basename(a, path.extname(a)).replace(/(?:_spec|_test|\.test|\.spec)$/, '');
      const stemB = path.basename(b, path.extname(b)).replace(/(?:_spec|_test|\.test|\.spec)$/, '');
      if (stemA === stemB || path.dirname(a) === path.dirname(b)) {
        union(a, b);
      }
    }
  }

  // Also union files with static import/symbol references when repoRoot is available
  if (repoRoot && typeof repoRoot === 'string' && fs.existsSync(repoRoot)) {
    for (const relPath of files) {
      if (path.isAbsolute(relPath) || relPath.split(/[\\/]/).includes('..')) continue;
      const fullPath = path.resolve(repoRoot, relPath);
      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) continue;
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const referenced of extractLocalReferences(relPath, content, files)) {
        union(relPath, referenced);
      }
    }
  }

  const groups = new Map();
  for (const file of files) {
    const root = find(file);
    if (!groups.has(root)) {
      groups.set(root, []);
    }
    groups.get(root).push(file);
  }

  const batches = [...groups.values()];
  if (batches.length < 2) {
    return {
      mode: 'single_builder',
      file_count: files.length,
      batches,
      reason: 'Files share directory, stem, or import coupling; single Linus dispatch preserves seam integrity.',
    };
  }

  return {
    mode: 'parallel_batches',
    file_count: files.length,
    batches,
    reason: `Partitioned ${files.length} files into ${batches.length} disjoint cohesion batches.`,
  };
}

module.exports = {
  parseBuildFiles,
  parseFilePlan,
  partitionFilePlan,
  verifyBuild,
};
