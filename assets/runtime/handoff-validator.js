'use strict';

const crypto = require('node:crypto');

function digestText(value) {
  return value === undefined ? null : crypto.createHash('sha256').update(value).digest('hex');
}

function numericTraceSort(left, right) {
  return Number(left.replace(/\D/g, '')) - Number(right.replace(/\D/g, ''));
}

function uniqueSorted(values) {
  return [...new Set(values)].sort(numericTraceSort);
}

function extractIds(text, prefix) {
  const pattern = new RegExp(String.raw`\b${prefix}(\d+)\b`, 'g');
  return uniqueSorted([...text.matchAll(pattern)].map((match) => `${prefix}${match[1]}`));
}

function extractSection(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
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

function decisionTableIds(brief) {
  const table = extractSection(brief, 'Decision Table');
  return uniqueSorted(
    table
      .split(/\r?\n/)
      .map((line) => /^\s*\|\s*(D\d+)\s*\|/.exec(line))
      .filter(Boolean)
      .map((match) => match[1])
  );
}

function parseIdList(text, prefixes) {
  const allowedPrefixes = Array.isArray(prefixes) ? prefixes : [prefixes];
  const values = text.split(',').map((value) => value.trim());
  const pattern = new RegExp(String.raw`^(?:${allowedPrefixes.join('|')})\d+$`);
  return values.length > 0 && values.every((value) => pattern.test(value)) ? values : null;
}

function splitCitationGroup(group, itemPrefixes = ['AC']) {
  const unicodeArrow = group.indexOf('←');
  const asciiArrow = group.indexOf('<-');
  if (unicodeArrow !== -1 && asciiArrow !== -1) {
    return null;
  }

  const arrowIndex = unicodeArrow !== -1 ? unicodeArrow : asciiArrow;
  const arrowLength = unicodeArrow !== -1 ? 1 : 2;
  if (arrowIndex === -1) {
    const items = parseIdList(group.trim(), itemPrefixes);
    return {
      items,
      acceptanceCriteria: items ? items.filter((id) => id.startsWith('AC')) : null,
      constraints: items ? items.filter((id) => id.startsWith('K')) : null,
      decisions: [],
    };
  }
  const arrow = group.slice(arrowIndex + arrowLength);
  if (arrow.includes('←') || arrow.includes('<-')) {
    return null;
  }
  const items = parseIdList(group.slice(0, arrowIndex).trim(), itemPrefixes);
  return {
    items,
    acceptanceCriteria: items ? items.filter((id) => id.startsWith('AC')) : null,
    constraints: items ? items.filter((id) => id.startsWith('K')) : null,
    decisions: parseIdList(arrow.trim(), ['D']),
  };
}

function parseCitation(citation, itemPrefixes = ['AC']) {
  const groups = [];
  for (const rawGroup of citation.split(';')) {
    const group = splitCitationGroup(rawGroup.trim(), itemPrefixes);
    if (!group?.items || !group?.decisions) {
      return null;
    }
    groups.push(group);
  }
  return groups.length > 0 ? groups : null;
}

function parseAcceptanceCriteria(spec) {
  return parseNumberedCitedSection(spec, 'Acceptance Criteria', 'AC');
}

function parseConstraints(spec) {
  return parseNumberedCitedSection(spec, 'Constraints', 'K');
}

function parseNumberedCitedSection(spec, sectionHeading, itemPrefix) {
  const entries = [];
  const malformedIds = [];

  for (const line of extractSection(spec, sectionHeading).split(/\r?\n/)) {
    const citedIds = extractIds(line, itemPrefix);
    if (citedIds.length === 0) {
      continue;
    }

    const prefix = /^\s*\d+[.)]\s+\(/.exec(line);
    const closingParenthesis = prefix === null ? -1 : line.indexOf(')', prefix[0].length);
    const citation = closingParenthesis === -1 ? '' : line.slice(prefix[0].length, closingParenthesis);
    const citationGroups = parseCitation(citation, [itemPrefix]);
    const itemIds = citationGroups?.flatMap((group) => group.items) || [];
    const decisionIds = citationGroups?.flatMap((group) => group.decisions) || [];
    const hasDescription = closingParenthesis !== -1 && line.slice(closingParenthesis + 1).trim().length > 0;
    if (!citationGroups || !hasDescription || itemIds.length !== 1 || citedIds.length !== 1 || citedIds[0] !== itemIds[0]) {
      malformedIds.push(...citedIds);
      continue;
    }
    entries.push({ id: itemIds[0], decisions: uniqueSorted(decisionIds) });
  }

  return { entries, malformedIds: uniqueSorted(malformedIds) };
}

function parseChangelistLine(line, index) {
  if (line.trim().length === 0) {
    return {
      citedAcceptanceCriteria: [],
      citedConstraints: [],
      citedDecisions: [],
      entry: null,
      malformed: false,
      line: index + 1,
    };
  }

  const citedAcceptanceCriteria = extractIds(line, 'AC');
  const citedConstraints = extractIds(line, 'K');
  const citedDecisions = extractIds(line, 'D');
  const supportEntry = /^\s*-\s+`[^`]+`\s+\(support\)\s+(?:—|--|-)\s+\S/.test(line);
  if (supportEntry) {
    return {
      citedAcceptanceCriteria: [],
      citedConstraints: [],
      citedDecisions: [],
      entry: null,
      malformed: false,
      line: index + 1,
    };
  }
  if (citedAcceptanceCriteria.length === 0 && citedConstraints.length === 0 && citedDecisions.length === 0) {
    return { citedAcceptanceCriteria, citedConstraints, citedDecisions, entry: null, malformed: true, line: index + 1 };
  }

  const prefix = /^\s*-\s+`/.exec(line);
  const closingBacktick = prefix === null ? -1 : line.indexOf('`', prefix[0].length);
  const afterPath = closingBacktick === -1 ? '' : line.slice(closingBacktick + 1).trimStart();
  const closingParenthesis = afterPath.startsWith('(') ? afterPath.indexOf(')') : -1;
  const citation = closingParenthesis === -1 ? '' : afterPath.slice(1, closingParenthesis);
  const summary = closingParenthesis === -1 ? '' : afterPath.slice(closingParenthesis + 1).trimStart();
  const citationGroups = parseCitation(citation, ['AC', 'K']);
  if (!citationGroups || !/^(?:—|--|-)\s+\S/.test(summary)) {
    return { citedAcceptanceCriteria, citedConstraints, citedDecisions, entry: null, malformed: true, line: index + 1 };
  }
  return {
    citedAcceptanceCriteria,
    citedConstraints,
    citedDecisions,
    malformed: false,
    line: index + 1,
    entry: {
      acceptanceCriteria: uniqueSorted(citationGroups.flatMap((group) => group.acceptanceCriteria)),
      constraints: uniqueSorted(citationGroups.flatMap((group) => group.constraints)),
      decisions: uniqueSorted(citationGroups.flatMap((group) => group.decisions)),
    },
  };
}

function parseChangelist(build) {
  const parsedLines = extractSection(build, 'Changelist')
    .split(/\r?\n/)
    .map((line, index) => parseChangelistLine(line, index));
  const entries = parsedLines.flatMap((line) => (line.entry === null ? [] : [line.entry]));
  const malformedIds = parsedLines.filter((line) => line.malformed).flatMap((line) => line.citedAcceptanceCriteria);
  const malformedConstraintIds = parsedLines.filter((line) => line.malformed).flatMap((line) => line.citedConstraints);
  const allAcceptanceCriteria = parsedLines.flatMap((line) => line.citedAcceptanceCriteria);
  const allConstraints = parsedLines.flatMap((line) => line.citedConstraints);
  const allDecisions = parsedLines.flatMap((line) => line.citedDecisions);
  const malformedLines = parsedLines.filter((line) => line.malformed).map((line) => line.line);

  return {
    entries,
    malformedIds: uniqueSorted(malformedIds),
    malformedConstraintIds: uniqueSorted(malformedConstraintIds),
    malformedLines,
    allAcceptanceCriteria: uniqueSorted(allAcceptanceCriteria),
    allConstraints: uniqueSorted(allConstraints),
    allDecisions: uniqueSorted(allDecisions),
  };
}

function difference(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

function duplicateIds(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates].sort(numericTraceSort);
}

function addError(errors, code, ids) {
  if (ids.length > 0) {
    errors.push({ code, ids });
  }
}

function validateHandoff({ brief, spec, build }) {
  if (typeof spec !== 'string') {
    throw new TypeError('spec must be a string');
  }
  if (build !== undefined && typeof build !== 'string') {
    throw new TypeError('build must be a string when provided');
  }
  if (brief !== undefined && typeof brief !== 'string') {
    throw new TypeError('brief must be a string when provided');
  }

  const decisions = brief === undefined ? [] : decisionTableIds(brief);
  const parsedCriteria = parseAcceptanceCriteria(spec);
  const entries = parsedCriteria.entries;
  const acceptanceCriteria = uniqueSorted(entries.map((entry) => entry.id));
  const hasConstraintsSection = extractSection(spec, 'Constraints').trim().length > 0;
  const parsedConstraints = hasConstraintsSection ? parseConstraints(spec) : { entries: [], malformedIds: [] };
  const constraintEntries = parsedConstraints.entries;
  const constraints = uniqueSorted(constraintEntries.map((entry) => entry.id));
  const specDecisionIds = extractIds(spec, 'D');
  const changelist = build === undefined ? null : parseChangelist(build);
  const implementedAcceptanceCriteria = changelist === null
    ? []
    : uniqueSorted(changelist.entries.flatMap((entry) => entry.acceptanceCriteria));
  const implementedConstraints = changelist === null
    ? []
    : uniqueSorted(changelist.entries.flatMap((entry) => entry.constraints));
  const errors = [];

  if (acceptanceCriteria.length === 0) {
    errors.push({ code: 'NO_ACCEPTANCE_CRITERIA', ids: [] });
  }
  addError(errors, 'MALFORMED_ACCEPTANCE_CRITERIA', parsedCriteria.malformedIds);
  addError(errors, 'DUPLICATE_ACCEPTANCE_CRITERIA', duplicateIds(entries.map((entry) => entry.id)));

  if (hasConstraintsSection) {
    addError(errors, 'MALFORMED_CONSTRAINTS', parsedConstraints.malformedIds);
    addError(errors, 'DUPLICATE_CONSTRAINTS', duplicateIds(constraintEntries.map((entry) => entry.id)));
  }

  if (brief !== undefined) {
    const criteriaWithoutDecisions = entries.filter((entry) => entry.decisions.length === 0).map((entry) => entry.id);
    const constraintsWithoutDecisions = constraintEntries
      .filter((entry) => entry.decisions.length === 0)
      .map((entry) => entry.id);
    const consumedDecisions = uniqueSorted([
      ...entries.flatMap((entry) => entry.decisions),
      ...constraintEntries.flatMap((entry) => entry.decisions),
    ]);
    const deferredDecisions = extractIds(extractSection(spec, 'Deferred Decisions'), 'D');

    addError(errors, 'ACCEPTANCE_CRITERIA_WITHOUT_DECISIONS', uniqueSorted(criteriaWithoutDecisions));
    addError(errors, 'CONSTRAINTS_WITHOUT_DECISIONS', uniqueSorted(constraintsWithoutDecisions));
    addError(errors, 'UNKNOWN_SPEC_DECISIONS', difference(specDecisionIds, decisions));
    addError(errors, 'UNCONSUMED_DECISIONS', difference(decisions, [...consumedDecisions, ...deferredDecisions]));
    if (changelist !== null) {
      addError(errors, 'UNKNOWN_BUILD_DECISIONS', difference(changelist.allDecisions, decisions));
    }
  }

  if (changelist !== null) {
    addError(errors, 'MALFORMED_CHANGELIST_CITATIONS', changelist.malformedIds);
    addError(errors, 'MALFORMED_CHANGELIST_CONSTRAINTS', changelist.malformedConstraintIds);
    if (changelist.malformedLines.length > 0) {
      errors.push({ code: 'MALFORMED_CHANGELIST_ENTRIES', lines: changelist.malformedLines });
    }
    addError(
      errors,
      'UNKNOWN_BUILD_ACCEPTANCE_CRITERIA',
      difference(changelist.allAcceptanceCriteria, acceptanceCriteria)
    );
    addError(
      errors,
      'UNIMPLEMENTED_ACCEPTANCE_CRITERIA',
      difference(acceptanceCriteria, implementedAcceptanceCriteria)
    );
    if (hasConstraintsSection || changelist.allConstraints.length > 0) {
      addError(errors, 'UNKNOWN_BUILD_CONSTRAINTS', difference(changelist.allConstraints, constraints));
      addError(errors, 'UNIMPLEMENTED_CONSTRAINTS', difference(constraints, implementedConstraints));
    }
  }

  const result = {
    ok: errors.length === 0,
    decisions,
    acceptance_criteria: acceptanceCriteria,
    input_hashes: {
      brief: digestText(brief),
      spec: digestText(spec),
      build: digestText(build),
    },
    errors,
  };
  if (hasConstraintsSection || (changelist !== null && changelist.allConstraints.length > 0)) {
    result.constraints = constraints;
  }
  return result;
}

module.exports = {
  digestText,
  extractIds,
  extractSection,
  validateHandoff,
};