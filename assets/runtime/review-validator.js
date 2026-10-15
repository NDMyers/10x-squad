'use strict';

const { digestText, extractIds, extractSection } = require('./handoff-validator');

const VALID_VERDICTS = new Set(['APPROVE', 'REQUEST_CHANGES', 'SPEC_DISPUTE']);
const SEVERITIES = new Set(['CRITICAL', 'MAJOR', 'MINOR']);

function parseEdgeCaseIds(spec) {
  const section = extractSection(spec, 'Edge Cases');
  const ids = [];
  for (const line of section.split(/\r?\n/)) {
    const match = /^\s*(\d+)[.)]\s+\S/.exec(line);
    if (match) {
      ids.push(`EC${match[1]}`);
    }
  }
  return [...new Set(ids)];
}

function parseVerdict(reviewText) {
  const match = /^##\s+Verdict:\s*\[?\s*(APPROVE|REQUEST_CHANGES|SPEC_DISPUTE)\s*\]?\s*$/m.exec(reviewText);
  return match ? match[1] : null;
}

function parseFindingBlocks(reviewText, source = 'cobalt') {
  const section = extractSection(reviewText, 'Findings');
  if (!section.trim() || /^\s*(?:none\.?|no findings\.?|n\/a)\s*$/i.test(section.trim())) {
    return [];
  }

  const lines = section.split(/\r?\n/);
  const blocks = [];
  let current = null;

  for (const line of lines) {
    const startMatch = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (startMatch) {
      if (current) {
        blocks.push(current);
      }
      current = {
        index: Number(startMatch[1]),
        source,
        header: startMatch[2].trim(),
        bodyLines: [],
      };
    } else if (current) {
      current.bodyLines.push(line);
    }
  }
  if (current) {
    blocks.push(current);
  }

  return blocks.map((block) => parseFindingBlock(block));
}

function parseFindingBlock(block) {
  const severityMatch = /\*\*\[(CRITICAL|MAJOR|MINOR)\]\*\*|\[(CRITICAL|MAJOR|MINOR)\]|\b(CRITICAL|MAJOR|MINOR)\b/.exec(
    block.header
  );
  const severity = severityMatch ? (severityMatch[1] || severityMatch[2] || severityMatch[3]) : null;
  const fileMatch = /`([^`]+\.[a-zA-Z0-9]+(?::\d+)?)`/.exec(block.header)
    || /`([^`]+)`/.exec(block.header);
  const rawLocation = fileMatch ? fileMatch[1] : null;
  const file = rawLocation ? rawLocation.split(':')[0] : null;

  const fullText = `${block.header}\n${block.bodyLines.join('\n')}`;
  const citedAc = extractIds(fullText, 'AC');
  const citedK = extractIds(fullText, 'K');
  const citedEc = extractIds(fullText, 'EC');
  const isDeterministicBug = /\bDETERMINISTIC_BUG\b/i.test(fullText);

  const proofLineMatch = /^\s*(?:-\s*)?\*\*?Proof:?\*\*?:?\s*(.+)$/im.exec(fullText)
    || /^\s*Proof:\s*(.+)$/im.exec(fullText);
  const hasInlineLineRef = /`[^`\s]+:\d+`|\b[a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+:\d+\b/.test(fullText);
  const proof = proofLineMatch
    ? proofLineMatch[1].trim()
    : (hasInlineLineRef ? 'inline-file-line-reference' : null);

  return {
    id: `${block.source.toUpperCase()}-F${block.index}`,
    source: block.source,
    index: block.index,
    severity: SEVERITIES.has(severity) ? severity : 'UNKNOWN',
    file,
    citations: {
      acceptance_criteria: citedAc,
      constraints: citedK,
      edge_cases: citedEc,
      deterministic_bug: isDeterministicBug,
    },
    proof,
    header: block.header,
  };
}

function validateSingleReview({
  spec,
  reviewText,
  source,
  validAc,
  validK,
  validEc,
  allowedCycleFiles,
}) {
  const statedVerdict = parseVerdict(reviewText);
  const errors = [];
  if (!statedVerdict || !VALID_VERDICTS.has(statedVerdict)) {
    errors.push({ code: 'INVALID_REVIEW_VERDICT', source });
  }

  const rawFindings = parseFindingBlocks(reviewText, source);
  const findings = [];

  for (const finding of rawFindings) {
    if (finding.severity === 'UNKNOWN') {
      errors.push({ code: 'INVALID_FINDING_SEVERITY', source, index: finding.index });
      continue;
    }

    if (finding.severity === 'MINOR') {
      findings.push({
        ...finding,
        effective_severity: 'MINOR',
        status: 'advisory',
        demotion_reasons: [],
      });
      continue;
    }

    const demotionReasons = [];
    const allCitedAc = finding.citations.acceptance_criteria;
    const allCitedK = finding.citations.constraints;
    const allCitedEc = finding.citations.edge_cases;
    const hasAnyContractCitation =
      allCitedAc.length > 0
      || allCitedK.length > 0
      || allCitedEc.length > 0
      || finding.citations.deterministic_bug;

    if (!hasAnyContractCitation) {
      demotionReasons.push('MISSING_CONTRACT_CITATION');
    }

    const unknownAc = allCitedAc.filter((id) => !validAc.has(id));
    const unknownK = allCitedK.filter((id) => !validK.has(id));
    const unknownEc = allCitedEc.filter((id) => !validEc.has(id));
    if (unknownAc.length > 0 || unknownK.length > 0 || unknownEc.length > 0) {
      demotionReasons.push('UNKNOWN_CONTRACT_ID');
    }

    if (!finding.file) {
      demotionReasons.push('MISSING_FILE_PATH');
    }

    if (!finding.proof || finding.proof.length < 3) {
      demotionReasons.push('MISSING_FALSIFIABLE_PROOF');
    }

    if (allowedCycleFiles !== null && finding.file && !allowedCycleFiles.has(finding.file)) {
      demotionReasons.push('OUT_OF_CYCLE_SCOPE');
    }

    if (demotionReasons.length > 0) {
      findings.push({
        ...finding,
        effective_severity: 'MINOR',
        status: 'demoted',
        demotion_reasons: demotionReasons,
      });
    } else {
      findings.push({
        ...finding,
        effective_severity: finding.severity,
        status: 'verified',
        demotion_reasons: [],
      });
    }
  }

  return {
    source,
    stated_verdict: statedVerdict,
    findings,
    errors,
  };
}

function validateReview({ spec, review, sentinelReview, previousReview }) {
  if (typeof spec !== 'string') {
    throw new TypeError('spec must be a string');
  }
  if (typeof review !== 'string') {
    throw new TypeError('review must be a string');
  }
  if (sentinelReview !== undefined && typeof sentinelReview !== 'string') {
    throw new TypeError('sentinelReview must be a string when provided');
  }
  if (previousReview !== undefined && typeof previousReview !== 'string') {
    throw new TypeError('previousReview must be a string when provided');
  }

  const validAc = new Set(extractIds(extractSection(spec, 'Acceptance Criteria'), 'AC'));
  const validK = new Set(extractIds(extractSection(spec, 'Constraints'), 'K'));
  const validEc = new Set(parseEdgeCaseIds(spec));

  let allowedCycleFiles = null;
  if (previousReview !== undefined) {
    const prevFindings = parseFindingBlocks(previousReview, 'previous').filter(
      (f) => f.severity === 'CRITICAL' || f.severity === 'MAJOR'
    );
    allowedCycleFiles = new Set(prevFindings.map((f) => f.file).filter(Boolean));
  }

  const reviews = [
    validateSingleReview({
      spec,
      reviewText: review,
      source: 'cobalt',
      validAc,
      validK,
      validEc,
      allowedCycleFiles,
    }),
  ];

  if (sentinelReview !== undefined) {
    reviews.push(
      validateSingleReview({
        spec,
        reviewText: sentinelReview,
        source: 'sentinel',
        validAc,
        validK,
        validEc,
        allowedCycleFiles,
      })
    );
  }

  const errors = reviews.flatMap((r) => r.errors);
  const allFindings = reviews.flatMap((r) => r.findings);
  const blockingSubmitted = allFindings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'MAJOR');
  const verifiedBlocking = allFindings.filter((f) => f.status === 'verified');
  const demotedFindings = allFindings.filter((f) => f.status === 'demoted');
  const advisoryFindings = allFindings.filter((f) => f.status === 'advisory');

  let effectiveVerdict = 'APPROVE';
  if (reviews.some((r) => r.stated_verdict === 'SPEC_DISPUTE')) {
    effectiveVerdict = 'SPEC_DISPUTE';
  } else if (verifiedBlocking.length > 0) {
    effectiveVerdict = 'REQUEST_CHANGES';
  }

  return {
    ok: errors.length === 0,
    effective_verdict: effectiveVerdict,
    stated_verdicts: Object.fromEntries(reviews.map((r) => [r.source, r.stated_verdict])),
    counts: {
      total: allFindings.length,
      blocking_submitted: blockingSubmitted.length,
      verified_blocking: verifiedBlocking.length,
      demoted: demotedFindings.length,
      advisory: advisoryFindings.length,
    },
    verified_findings: verifiedBlocking,
    demoted_findings: demotedFindings,
    advisory_findings: advisoryFindings,
    input_hashes: {
      spec: digestText(spec),
      review: digestText(review),
      sentinel_review: digestText(sentinelReview),
      previous_review: digestText(previousReview),
    },
    errors,
  };
}

module.exports = {
  parseEdgeCaseIds,
  parseFindingBlocks,
  parseVerdict,
  validateReview,
};
