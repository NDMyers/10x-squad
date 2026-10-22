'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { extractSection } = require('./handoff-validator');

function extractSectionByPrefix(markdown, headingPrefix) {
  const lines = markdown.split(/\r?\n/);
  const escaped = headingPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headerRe = new RegExp(`^##\\s+${escaped}\\b`, 'i');
  const start = lines.findIndex((line) => headerRe.test(line.trim()));
  if (start === -1) {
    return '';
  }

  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      break;
    }
    body.push(lines[index]);
  }
  return body.join('\n');
}

function isLikelyRepoFilePath(candidate) {
  if (typeof candidate !== 'string') return false;
  const trimmed = candidate.trim();
  if (!trimmed || /\s/.test(trimmed) || trimmed.includes('://') || trimmed.startsWith('-')) {
    return false;
  }
  if (trimmed.endsWith('/')) {
    return false;
  }
  if (/^(?:AC|D|K|EC|B)\d+$/i.test(trimmed)) {
    return false;
  }
  return trimmed.includes('/') || /^[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,8}$/.test(trimmed);
}

function extractFilesFromBlock(sectionText) {
  const files = [];
  for (const line of sectionText.split(/\r?\n/)) {
    const bulletMatch = /^\s*(?:[-*+]|\d+[.)])\s+(?:\*\*)?`([^`\n]+)`(?:\*\*)?\s*(?:(?:—|–|--|-|:)\s*\S|\([^)]+\))/.exec(line);
    if (bulletMatch && isLikelyRepoFilePath(bulletMatch[1])) {
      files.push(bulletMatch[1].trim());
      continue;
    }

    const tableTrimmed = line.trim();
    if (tableTrimmed.startsWith('|') && tableTrimmed.endsWith('|') && !/^[\s|:-]+$/.test(tableTrimmed)) {
      const cells = tableTrimmed
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());
      for (const cell of cells.slice(0, 3)) {
        const cleaned = cell.replace(/^\*\*|\*\*$/g, '').trim();
        const cellMatch = /^`([^`\n]+)`$/.exec(cleaned);
        if (cellMatch && isLikelyRepoFilePath(cellMatch[1])) {
          files.push(cellMatch[1].trim());
          break;
        }
      }
    }
  }
  return files;
}

function normalizeStem(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  const stripped = base.replace(/(?:_spec|_test|\.test|\.spec|-test|-spec)$/i, '');
  return stripped.toLowerCase().replace(/[-_]/g, '');
}

function parseFilePlan(spec) {
  const section = extractSection(spec, 'File Plan (file path + one-line change description each)')
    || extractSection(spec, 'File Plan')
    || extractSectionByPrefix(spec, 'File Plan');
  const files = extractFilesFromBlock(section);

  if (files.length === 0 || /\bappendix\b/i.test(section)) {
    const appendixSection = extractSectionByPrefix(spec, 'Appendix');
    if (appendixSection) {
      files.push(...extractFilesFromBlock(appendixSection));
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
  const hasFilePlanSection = /^##\s+File Plan\b/im.test(spec);
  const { citedFiles, supportFiles, allFiles } = parseBuildFiles(build);
  const errors = [];
  const warnings = [];
  let scopeClean = plannedFiles.length > 0;

  if (plannedFiles.length === 0 && hasFilePlanSection) {
    const emptyPlanEntry = {
      code: 'EMPTY_FILE_PLAN',
      files: [],
      message: 'Spec contains a ## File Plan section with 0 parseable file paths.',
    };
    if (enforceFilePlan) {
      errors.push(emptyPlanEntry);
    } else {
      warnings.push(emptyPlanEntry);
    }
  }

  if (plannedFiles.length > 0) {
    const plannedSet = new Set(plannedFiles);
    const builtSet = new Set(allFiles);

    const unplannedFiles = citedFiles.filter((file) => !plannedSet.has(file));
    const untouchedPlanned = plannedFiles.filter((file) => !builtSet.has(file));
    scopeClean = unplannedFiles.length === 0 && untouchedPlanned.length === 0;

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
    scope_clean: scopeClean,
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
  const normalizedStems = new Map();
  for (const candidate of candidateFiles) {
    if (candidate === filePath) continue;
    const parsed = path.parse(candidate);
    baseNames.set(parsed.name.toLowerCase(), candidate);
    baseNames.set(candidate.toLowerCase(), candidate);
    const normStem = normalizeStem(candidate);
    if (normStem.length >= 4) {
      normalizedStems.set(normStem, candidate);
    }
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

  const lowerContent = content.toLowerCase();
  for (const [token, candidate] of baseNames.entries()) {
    if (token.length >= 4 && lowerContent.includes(token)) {
      refs.add(candidate);
    }
  }

  const normalizedContent = lowerContent.replace(/[-_]/g, '');
  for (const [normStem, candidate] of normalizedStems.entries()) {
    if (normalizedContent.includes(normStem)) {
      refs.add(candidate);
    }
  }

  return [...refs];
}

function topPrefix(filePath) {
  const parts = path.posix.dirname(filePath).split('/').filter((p) => p && p !== '.');
  const filtered = parts.filter((p) => !['__tests__', 'test', 'tests', 'spec', 'specs'].includes(p.toLowerCase()));
  if (filtered.length === 0) {
    return '';
  }
  const containers = new Set(['frontend', 'backend', 'client', 'server', 'web', 'api', 'src', 'app', 'lib']);
  let idx = 0;
  while (idx < filtered.length - 1 && containers.has(filtered[idx].toLowerCase())) {
    idx += 1;
  }
  return filtered.slice(0, idx + 1).join('/');
}

function coalesceBatches(rawBatches, maxBatches) {
  if (rawBatches.length <= maxBatches) {
    return rawBatches;
  }

  // Step 1: merge batches whose dominant top-level prefix matches
  const byPrefix = new Map();
  for (const batch of rawBatches) {
    const prefix = topPrefix(batch[0]);
    if (!byPrefix.has(prefix)) {
      byPrefix.set(prefix, []);
    }
    byPrefix.get(prefix).push(...batch);
  }

  const merged = [...byPrefix.values()];
  if (merged.length <= maxBatches) {
    return merged;
  }

  // Step 2: greedy smallest-batch bin packing down to maxBatches
  const sorted = merged.slice().sort((a, b) => b.length - a.length);
  const bins = sorted.slice(0, maxBatches).map((b) => [...b]);
  for (let i = maxBatches; i < sorted.length; i += 1) {
    let smallestIdx = 0;
    for (let j = 1; j < bins.length; j += 1) {
      if (bins[j].length < bins[smallestIdx].length) {
        smallestIdx = j;
      }
    }
    bins[smallestIdx].push(...sorted[i]);
  }
  return bins;
}

function partitionFilePlan({ spec, repoRoot, maxBatches }) {
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

  // Group files in the same immediate directory or sharing a normalized stem (e.g. IntakeExperience.tsx + intake-experience.test.tsx)
  for (let i = 0; i < files.length; i += 1) {
    for (let j = i + 1; j < files.length; j += 1) {
      const a = files[i];
      const b = files[j];
      const stemA = normalizeStem(a);
      const stemB = normalizeStem(b);
      if ((stemA.length > 0 && stemA === stemB) || path.dirname(a) === path.dirname(b)) {
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

  const rawBatches = [...groups.values()];
  if (rawBatches.length < 2) {
    return {
      mode: 'single_builder',
      file_count: files.length,
      batches: rawBatches,
      reason: 'Files share directory, stem, or import coupling; single Linus dispatch preserves seam integrity.',
    };
  }

  const effectiveMaxBatches = typeof maxBatches === 'number' && maxBatches >= 1
    ? maxBatches
    : (files.length > 4 ? 3 : 4);
  const batches = coalesceBatches(rawBatches, effectiveMaxBatches);
  if (batches.length < 2) {
    return {
      mode: 'single_builder',
      file_count: files.length,
      batches,
      reason: 'Coalesced batches share top-level module prefix; single Linus dispatch preserves seam integrity.',
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
  normalizeStem,
  parseBuildFiles,
  parseFilePlan,
  partitionFilePlan,
  verifyBuild,
};
