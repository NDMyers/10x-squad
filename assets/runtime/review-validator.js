'use strict';

const { digestText, extractIds, extractSection, parseExperienceCriteria } = require('./handoff-validator');

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
  const citedQ = extractIds(fullText, 'Q');
  const isProductDefect = /\bPRODUCT_DEFECT\b/.test(fullText);
  const isDeterministicBug = /\bDETERMINISTIC_BUG\b/i.test(fullText);
  const isCoverageGate = /\bCOVERAGE_GATE\b/i.test(fullText);

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
      experience_criteria: citedQ,
      product_defect: isProductDefect,
      deterministic_bug: isDeterministicBug,
      coverage_gate: isCoverageGate,
    },
    proof,
    // Only an explicit `Proof:` line can carry an observation; an inline
    // `file:line` reference says where code is, not what the product did.
    stated_proof: proofLineMatch ? proofLineMatch[1].trim() : null,
    header: block.header,
  };
}

// The reviewer's account of using the running product. `RUN` or `NOT_RUN` on
// the first line, then one grade per experience criterion:
//   - (Q1) 3/5, threshold 4 — FAIL — sprites read as noise at 1x
function parseProductCheck(reviewText) {
  const declared = /^##\s+Product Check\s*$/m.test(reviewText);
  const section = extractSection(reviewText, 'Product Check');
  const statusMatch = /^\s*(?:-\s*)?(?:\*\*)?(NOT_RUN|RUN)\b/m.exec(section);
  const grades = {};
  for (const line of section.split(/\r?\n/)) {
    // Reviewers decorate: `- **(Q1) 4/5, threshold 4 — PASS.**` is the same
    // grade as `- (Q1) 4/5, threshold 4 — PASS`. Parse what was meant.
    const match = /^\s*[-*]\s+[*_`]*\(?(Q\d+)\)?[*_`]*[\s:—–-]+.*?\b(PASS|FAIL|NOT_GRADED)\b/.exec(line);
    if (match) {
      grades[match[1]] = match[2];
    }
  }
  return { declared, status: statusMatch ? statusMatch[1] : null, grades };
}

function validateSingleReview({
  spec,
  reviewText,
  source,
  validAc,
  validK,
  validEc,
  validQ,
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
    // `Q<n>` is only a citation when the spec names experience criteria;
    // otherwise it is ordinary prose ("since Q3") and must not demote a finding.
    const allCitedQ = validQ.size > 0 ? finding.citations.experience_criteria : [];
    // A product finding is about what the running product did, so it is proved
    // by an observation and need not name a file. Without this route a reviewer
    // who used the product and found it wanting could only file a MINOR.
    const citesProduct = finding.citations.product_defect || allCitedQ.length > 0;
    const citesContract =
      allCitedAc.length > 0
      || allCitedK.length > 0
      || allCitedEc.length > 0
      || finding.citations.deterministic_bug
      || finding.citations.coverage_gate;
    // A finding that cites the contract is judged by the contract rules even
    // when it also names an experience criterion: `(AC9, Q4)` with a file and a
    // proof is a contract finding, and must not be demoted for lacking the
    // product-finding form. Only a finding that rests on the product alone is
    // held to the observation rule.
    const isProductFinding = citesProduct && !citesContract;
    const hasAnyContractCitation =
      allCitedAc.length > 0
      || allCitedK.length > 0
      || allCitedEc.length > 0
      || citesProduct
      || finding.citations.deterministic_bug
      || finding.citations.coverage_gate;

    if (!hasAnyContractCitation) {
      demotionReasons.push('MISSING_CONTRACT_CITATION');
    }

    const unknownAc = allCitedAc.filter((id) => !validAc.has(id));
    const unknownK = allCitedK.filter((id) => !validK.has(id));
    const unknownEc = allCitedEc.filter((id) => !validEc.has(id));
    const unknownQ = allCitedQ.filter((id) => !validQ.has(id));
    if (unknownAc.length > 0 || unknownK.length > 0 || unknownEc.length > 0 || unknownQ.length > 0) {
      demotionReasons.push('UNKNOWN_CONTRACT_ID');
    }

    if (isProductFinding) {
      // The proof must be stated outright — an inline `file:line` says where
      // code is, not what the product did — but its wording is the reviewer's.
      // Requiring a keyword here once turned a real MAJOR into an APPROVE.
      if (!finding.stated_proof || finding.stated_proof.length < 12) {
        demotionReasons.push('MISSING_OBSERVATION_PROOF');
      }
    } else {
      if (!finding.file) {
        demotionReasons.push('MISSING_FILE_PATH');
      }

      if (!finding.proof || finding.proof.length < 3) {
        demotionReasons.push('MISSING_FALSIFIABLE_PROOF');
      }
    }

    if (finding.citations.coverage_gate) {
      const coverage = /\bchanged-file coverage:\s*(\d+(?:\.\d+)?)%/i.exec(finding.proof || '');
      if (!coverage || Number(coverage[1]) > 80 || !/\bSonarQube\b/i.test(finding.proof || '')) {
        demotionReasons.push('INVALID_COVERAGE_EVIDENCE');
        errors.push({ code: 'INVALID_COVERAGE_EVIDENCE', source, index: finding.index });
      }
    }

    if (
      allowedCycleFiles !== null
      && finding.file
      && !isProductFinding
      && !finding.citations.coverage_gate
      && !allowedCycleFiles.has(finding.file)
    ) {
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
  const experienceCriteria = [...new Set(parseExperienceCriteria(spec))];
  const validQ = new Set(experienceCriteria);

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
      validQ,
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
        validQ,
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

  // Product check: Cobalt's alone (Sentinel reviews the diff, not the product).
  // It is evaluated only when the spec names experience criteria or the review
  // declares the section, so reviews that predate it validate unchanged.
  const parsedProductCheck = parseProductCheck(review);
  let productCheck = null;
  if (experienceCriteria.length > 0 || parsedProductCheck.declared) {
    const grades = Object.fromEntries(
      Object.entries(parsedProductCheck.grades).filter(([id]) => validQ.has(id))
    );
    const ungraded = experienceCriteria.filter((id) => !(id in grades));
    const failed = experienceCriteria.filter((id) => grades[id] === 'FAIL');
    const notGraded = experienceCriteria.filter((id) => grades[id] === 'NOT_GRADED');
    if (parsedProductCheck.status === null) {
      errors.push({ code: 'MISSING_PRODUCT_CHECK_STATUS', source: 'cobalt' });
    }
    if (ungraded.length > 0) {
      errors.push({ code: 'UNGRADED_EXPERIENCE_CRITERIA', source: 'cobalt', ids: ungraded });
    }
    // A reviewer who did not run the product cannot have passed a criterion
    // that is only decidable by using it.
    const passedUnseen = parsedProductCheck.status === 'NOT_RUN'
      ? experienceCriteria.filter((id) => grades[id] === 'PASS')
      : [];
    if (passedUnseen.length > 0) {
      errors.push({ code: 'GRADED_WITHOUT_RUNNING', source: 'cobalt', ids: passedUnseen });
    }
    productCheck = {
      status: parsedProductCheck.status,
      grades,
      failed,
      not_graded: notGraded,
      // True whenever the review cannot vouch for the running product. DELIVER
      // must carry this forward instead of reporting the approval as coverage.
      unverified: parsedProductCheck.status !== 'RUN' || notGraded.length > 0,
    };
  }

  let effectiveVerdict = 'APPROVE';
  if (reviews.some((r) => r.stated_verdict === 'SPEC_DISPUTE')) {
    effectiveVerdict = 'SPEC_DISPUTE';
  } else if (verifiedBlocking.length > 0 || (productCheck !== null && productCheck.failed.length > 0)) {
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
    ...(productCheck === null ? {} : { product_check: productCheck }),
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
  parseProductCheck,
  parseVerdict,
  validateReview,
};
