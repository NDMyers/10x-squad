'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { extractIds, extractSection, validateHandoff } = require('./handoff-validator');
const { validateReview } = require('./review-validator');
const { partitionFilePlan, verifyBuild } = require('./build-verifier');

const PHASE_ORDER = ['TRIAGE', 'DELIBERATE', 'INTAKE', 'PLAN', 'BUILD', 'REVIEW', 'TEST', 'DELIVER'];

function readOptionalFile(projectDir, relativePath) {
  if (!relativePath || typeof relativePath !== 'string') return undefined;
  const fullPath = path.resolve(projectDir, relativePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return undefined;
  return fs.readFileSync(fullPath, 'utf8');
}

function fileMtimeIso(projectDir, relativePath) {
  if (!relativePath || typeof relativePath !== 'string') return null;
  const fullPath = path.resolve(projectDir, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  try {
    return fs.statSync(fullPath).mtime.toISOString();
  } catch {
    return null;
  }
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function formatBar(score, width = 6) {
  const filled = Math.round(clamp01(score) * width);
  return `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}`;
}

function sharpnessLabel(score) {
  return score >= 0.8 ? 'sharp' : 'split';
}

function computeSharpness({ brief, spec, build, review, sentinelReview, repoRoot }) {
  let specTrace = 1.0;
  let buildScope = 1.0;
  let reviewFilter = 1.0;
  let verifiedCount = 0;
  let submittedBlockingCount = 0;
  let demotedCount = 0;
  let advisoryCount = 0;
  let effectiveVerdict = null;

  if (spec) {
    const handoff = validateHandoff({ brief, spec, build });
    const acCount = handoff.acceptance_criteria.length;
    const kCount = Array.isArray(handoff.constraints) ? handoff.constraints.length : 0;
    const totalContractItems = Math.max(1, acCount + kCount);
    const planErrors = handoff.errors.filter(
      (e) => !e.code.includes('BUILD') && !e.code.includes('CHANGELIST') && !e.code.includes('UNIMPLEMENTED')
    );
    specTrace = clamp01(1 - planErrors.length / totalContractItems);

    if (build) {
      const unimplementedAc =
        handoff.errors.find((e) => e.code === 'UNIMPLEMENTED_ACCEPTANCE_CRITERIA')?.ids.length || 0;
      const unimplementedK =
        handoff.errors.find((e) => e.code === 'UNIMPLEMENTED_CONSTRAINTS')?.ids.length || 0;
      const buildCheck = verifyBuild({ spec, build, repoRoot, enforceFilePlan: false });
      const driftCount = buildCheck.warnings.reduce((acc, w) => acc + (w.files ? w.files.length : 1), 0);
      buildScope = clamp01(1 - (unimplementedAc + unimplementedK + driftCount * 0.25) / totalContractItems);
    }
  }

  if (spec && review) {
    const reviewResult = validateReview({ spec, review, sentinelReview });
    submittedBlockingCount = reviewResult.counts.blocking_submitted;
    verifiedCount = reviewResult.counts.verified_blocking;
    demotedCount = reviewResult.counts.demoted;
    advisoryCount = reviewResult.counts.advisory;
    effectiveVerdict = reviewResult.effective_verdict;
    reviewFilter =
      submittedBlockingCount === 0
        ? 1.0
        : clamp01(1 - verifiedCount / Math.max(1, submittedBlockingCount));
  }

  const overall = Number(((specTrace + buildScope + reviewFilter) / 3).toFixed(2));
  return {
    spec_trace: Number(specTrace.toFixed(2)),
    build_scope: Number(buildScope.toFixed(2)),
    review_filter: Number(reviewFilter.toFixed(2)),
    overall,
    label: sharpnessLabel(overall),
    verified_blocking: verifiedCount,
    submitted_blocking: submittedBlockingCount,
    demoted_blocking: demotedCount,
    advisory_count: advisoryCount,
    effective_verdict: effectiveVerdict,
  };
}

function phaseStatus(currentPhase, projectStatus, cardPhases) {
  if (projectStatus === 'complete' || currentPhase === 'DELIVER') {
    return { state: 'done', pct: 100, badge: '✓ done' };
  }
  const currentIdx = PHASE_ORDER.indexOf(currentPhase);
  const indices = cardPhases.map((p) => PHASE_ORDER.indexOf(p)).filter((i) => i >= 0);
  const minIdx = Math.min(...indices);
  const maxIdx = Math.max(...indices);

  if (currentIdx > maxIdx) {
    return { state: 'done', pct: 100, badge: '✓ done' };
  }
  if (currentIdx >= minIdx && currentIdx <= maxIdx) {
    const span = Math.max(1, maxIdx - minIdx + 1);
    const offset = currentIdx - minIdx + 1;
    const pct = Math.min(90, Math.round((offset / span) * 75));
    return { state: 'active', pct, badge: `● ${currentPhase.toLowerCase()}` };
  }
  return { state: 'queued', pct: 0, badge: '· queued' };
}

function resolvePersonaProfiles({ workspaceRoot, harness, tier }) {
  const effectiveTier = tier || 'standard_ambiguous';
  const defaults = {
    vivaldi: { model: 'claude-opus-5.5', reasoning_effort: 'high', context_tier: 'auto', tier: effectiveTier },
    einstein: { model: 'claude-opus-5.5', reasoning_effort: 'high', context_tier: 'auto', tier: effectiveTier },
    peter: { model: 'claude-opus-5.5', reasoning_effort: 'high', context_tier: 'auto', tier: effectiveTier },
    linus: { model: 'claude-haiku-5.5', reasoning_effort: 'medium', context_tier: 'auto', tier: effectiveTier },
    cobalt: { model: 'gemini-4-argon', reasoning_effort: 'high', context_tier: 'auto', tier: effectiveTier },
    sentinel: { model: 'gemini-4-argon', reasoning_effort: 'high', context_tier: 'auto', tier: effectiveTier },
    ralph: { model: 'claude-haiku-5.5', reasoning_effort: 'medium', context_tier: 'auto', tier: effectiveTier },
  };

  let modelTierConfig;
  try {
    modelTierConfig = require('../skills/10x-squad-configure-tiers/scripts/model-tier-config');
  } catch {
    const candidate = workspaceRoot
      ? path.join(workspaceRoot, '.github', 'skills', '10x-squad-configure-tiers', 'scripts', 'model-tier-config.js')
      : null;
    if (candidate && fs.existsSync(candidate)) {
      modelTierConfig = require(candidate);
    }
  }

  if (
    !modelTierConfig ||
    typeof modelTierConfig.resolve !== 'function' ||
    typeof modelTierConfig.configPaths !== 'function' ||
    typeof modelTierConfig.readConfigFile !== 'function'
  ) {
    return defaults;
  }

  const paths = modelTierConfig.configPaths({ workspaceRoot: workspaceRoot || process.cwd() });
  const wsRes = paths.workspace ? modelTierConfig.readConfigFile(paths.workspace) : { status: 'missing' };
  const globRes = paths.global ? modelTierConfig.readConfigFile(paths.global) : { status: 'missing' };
  const workspaceConfig = wsRes.status === 'ok' ? wsRes.config : null;
  const globalConfig = globRes.status === 'ok' ? globRes.config : null;

  if (!workspaceConfig && !globalConfig) {
    return defaults;
  }

  const harnessesToTry = harness
    ? [harness]
    : ['copilot-cli', 'copilot-vscode', 'codex-cli', 'codex-app'];

  const personas = ['einstein', 'peter', 'linus', 'cobalt', 'sentinel', 'ralph'];
  for (const h of harnessesToTry) {
    const resolvedMap = {};
    let allOk = true;
    for (const persona of personas) {
      const res = modelTierConfig.resolve({
        workspaceConfig,
        globalConfig,
        harness: h,
        tier: effectiveTier,
        persona,
      });
      if (!res || !res.ok) {
        allOk = false;
        break;
      }
      resolvedMap[persona] = {
        model: res.model,
        reasoning_effort: res.reasoning_effort || 'auto',
        context_tier: res.context_tier || 'auto',
        tier: effectiveTier,
        harness: h,
      };
    }
    if (allOk) {
      let vivaldiProfile = null;
      if (typeof modelTierConfig.resolveAdvisory === 'function') {
        for (const advHarness of [h, ...harnessesToTry]) {
          const adv = modelTierConfig.resolveAdvisory({
            workspaceConfig,
            globalConfig,
            harness: advHarness,
            tier: effectiveTier,
          });
          if (adv && adv.ok && adv.advisory && adv.model) {
            vivaldiProfile = {
              model: adv.model,
              reasoning_effort:
                adv.reasoning_effort && adv.reasoning_effort !== 'auto'
                  ? adv.reasoning_effort
                  : resolvedMap.einstein.reasoning_effort,
              context_tier: 'auto',
              tier: effectiveTier,
              harness: advHarness,
            };
            break;
          }
        }
      }
      resolvedMap.vivaldi = vivaldiProfile || {
        model: resolvedMap.einstein.model,
        reasoning_effort: resolvedMap.einstein.reasoning_effort,
        context_tier: resolvedMap.einstein.context_tier,
        tier: effectiveTier,
        harness: h,
      };
      return resolvedMap;
    }
  }

  return defaults;
}

function buildSessionLog(projectDirectory, state, sharpness, profiles, counts, partition) {
  const events = [];
  const artifacts = state.artifacts || {};
  const fmtTime = (iso) => (iso ? iso.slice(11, 19) : state.updated_at.slice(11, 19));

  const contextTime = fileMtimeIso(projectDirectory, artifacts.context || 'CONTEXT.md');
  if (contextTime) {
    events.push({
      time: fmtTime(contextTime),
      actor: 'vivaldi',
      role: 'thinker',
      text: `triage -> tier ${state.tier} · initialized project ${state.slug}`,
    });
  }

  const briefTime = fileMtimeIso(projectDirectory, artifacts.brief || 'brief.md');
  if (briefTime && counts.decisions > 0) {
    events.push({
      time: fmtTime(briefTime),
      actor: 'einstein',
      role: 'thinker',
      text: `brief.md synthesized · ${counts.decisions} decision trace IDs (D1..D${counts.decisions})`,
    });
  }

  const specTime = fileMtimeIso(projectDirectory, artifacts.spec || 'spec.md');
  if (specTime && counts.acceptance_criteria > 0) {
    events.push({
      time: fmtTime(specTime),
      actor: 'peter',
      role: 'thinker',
      text: `spec.md locked · ${counts.acceptance_criteria} AC# · ${counts.constraints} K# negative constraints`,
    });
  }

  const gatePlanTime = fileMtimeIso(projectDirectory, artifacts.gate_plan || 'gate-plan.json');
  if (gatePlanTime) {
    events.push({
      time: fmtTime(gatePlanTime),
      actor: 'control.js',
      role: 'gate',
      text: `spec_trace   -> gate-plan.json p=${sharpness.spec_trace.toFixed(2)} ${sharpnessLabel(sharpness.spec_trace)} -> ${partition.mode}`,
    });
  }

  const buildTime = fileMtimeIso(projectDirectory, artifacts.build || 'build.md');
  if (buildTime) {
    events.push({
      time: fmtTime(buildTime),
      actor: `linus (${profiles.linus.model})`,
      role: 'builder',
      text: `patched ${counts.built_files} file(s) · build_scope p=${sharpness.build_scope.toFixed(2)} ${sharpnessLabel(sharpness.build_scope)}`,
    });
  }

  const reviewTime = fileMtimeIso(projectDirectory, artifacts.review || 'review.md');
  if (reviewTime) {
    const kept = sharpness.verified_blocking;
    const total = sharpness.submitted_blocking;
    const demoted = sharpness.demoted_blocking;
    events.push({
      time: fmtTime(reviewTime),
      actor: 'validate-review',
      role: 'verifier',
      text: `filtered review.md · ${kept} of ${total} blocking kept (${demoted} demoted) -> ${sharpness.effective_verdict || 'APPROVE'}`,
    });
  }

  const testsTime = fileMtimeIso(projectDirectory, artifacts.tests || 'tests.md');
  if (testsTime) {
    events.push({
      time: fmtTime(testsTime),
      actor: 'ralph',
      role: 'verifier',
      text: `executed AC# test suite -> tests.md verified`,
    });
  }

  events.push({
    time: fmtTime(state.updated_at),
    actor: 'vivaldi',
    role: 'thinker',
    text:
      state.phase === 'DELIVER' || state.status === 'complete'
        ? `signs off · verified changes ready for delivery`
        : `${state.phase.toLowerCase()} · ${state.next_action || 'awaiting next transition'}`,
  });

  return events.slice(-7);
}

function inspectProjectBoard(projectDirectory, options = {}) {
  const statePath = path.join(projectDirectory, 'project.json');
  if (!fs.existsSync(statePath)) {
    throw new Error(`Missing project.json in ${projectDirectory}`);
  }
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const artifacts = state.artifacts || {};

  const brief = readOptionalFile(projectDirectory, artifacts.brief || 'brief.md');
  const spec = readOptionalFile(projectDirectory, artifacts.spec || 'spec.md');
  const build = readOptionalFile(projectDirectory, artifacts.build || 'build.md');
  const review = readOptionalFile(projectDirectory, artifacts.review || 'review.md');
  const sentinelReview = readOptionalFile(projectDirectory, artifacts.sentinel_review || 'sentinel-review.md');
  const tests = readOptionalFile(projectDirectory, artifacts.tests || 'tests.md');

  const dIds = brief ? extractIds(extractSection(brief, 'Decision Table'), 'D') : [];
  const acIds = spec ? extractIds(extractSection(spec, 'Acceptance Criteria'), 'AC') : [];
  const kIds = spec ? extractIds(extractSection(spec, 'Constraints'), 'K') : [];
  const sensitiveSurface = spec ? extractSection(spec, 'Sensitive Surface').trim().length > 0 : false;
  const partition = spec
    ? partitionFilePlan({ spec, repoRoot: options.repoRoot })
    : { mode: 'single_builder', file_count: 0, batches: [] };
  const buildVerify = spec && build ? verifyBuild({ spec, build, repoRoot: options.repoRoot }) : null;
  const builtFilesCount = buildVerify ? buildVerify.all_files?.length || buildVerify.cited_files.length : 0;

  const sharpness = computeSharpness({
    brief,
    spec,
    build,
    review,
    sentinelReview,
    repoRoot: options.repoRoot,
  });

  const profiles = resolvePersonaProfiles({
    workspaceRoot: options.workspaceRoot,
    harness: options.harness,
    tier: state.tier,
  });

  const headerBytes = [brief, spec]
    .filter(Boolean)
    .reduce((acc, text) => acc + Buffer.byteLength(text.split(/##\s+Appendix/i)[0], 'utf8'), 0);
  const contextKb = Number(Math.max(0.4, headerBytes / 1024).toFixed(1));

  const totalAgents =
    (state.tier === 'standard_ambiguous' || state.tier === 'complex' ? 1 : 0) + // einstein
    1 + // peter
    Math.max(1, partition.mode === 'parallel_batches' ? partition.batches.length : 1) + // linus
    1 + // cobalt
    (sensitiveSurface || state.tier === 'complex' ? 1 : 0) + // sentinel
    (!['trivial', 'lite'].includes(state.tier) ? 1 : 0); // ralph

  const phaseIdx = PHASE_ORDER.indexOf(state.phase);
  let completedAgents = 0;
  if (phaseIdx > PHASE_ORDER.indexOf('DELIBERATE') && (state.tier === 'standard_ambiguous' || state.tier === 'complex')) {
    completedAgents += 1;
  }
  if (phaseIdx > PHASE_ORDER.indexOf('PLAN')) completedAgents += 1;
  if (phaseIdx > PHASE_ORDER.indexOf('BUILD')) {
    completedAgents += Math.max(1, partition.mode === 'parallel_batches' ? partition.batches.length : 1);
  }
  if (phaseIdx > PHASE_ORDER.indexOf('REVIEW')) {
    completedAgents += 1 + (sensitiveSurface || state.tier === 'complex' ? 1 : 0);
  }
  if (state.phase === 'DELIVER' || state.status === 'complete') {
    completedAgents = totalAgents;
  }

  const cards = [
    {
      id: 'plan',
      title: 'Plan',
      color: 'blue',
      lane: 'Einstein · Peter',
      model: profiles.peter.model,
      effort: profiles.peter.reasoning_effort,
      tier: state.tier,
      detail: `${acIds.length} AC · ${kIds.length} K constraints`,
      subdetail: dIds.length > 0 ? `traces ${dIds.length} D# decisions` : 'spec + K# contract',
      ...phaseStatus(state.phase, state.status, ['DELIBERATE', 'INTAKE', 'PLAN']),
      agents: [
        {
          id: 'einstein',
          name: 'Einstein',
          role: 'Research & Brief',
          model: profiles.einstein.model,
          effort: profiles.einstein.reasoning_effort,
          tier: state.tier,
          pct: brief ? 100 : state.phase === 'DELIBERATE' ? 60 : 0,
          state: brief ? 'done' : state.phase === 'DELIBERATE' ? 'active' : 'queued',
          task: brief
            ? `brief.md · ${dIds.length} decision(s) (${dIds.join(', ') || 'D#'})`
            : 'Synthesizing domain context & decision table',
        },
        {
          id: 'peter',
          name: 'Peter',
          role: 'Spec & Architecture',
          model: profiles.peter.model,
          effort: profiles.peter.reasoning_effort,
          tier: state.tier,
          pct: spec ? 100 : state.phase === 'PLAN' ? 65 : 0,
          state: spec ? 'done' : state.phase === 'PLAN' ? 'active' : 'queued',
          task: spec
            ? `spec.md · ${acIds.length} AC# + ${kIds.length} K# constraints`
            : 'Compiling acceptance criteria & negative constraints',
        },
      ],
    },
    {
      id: 'build',
      title: 'Build',
      color: 'orange',
      lane: 'Linus',
      model: profiles.linus.model,
      effort: profiles.linus.reasoning_effort,
      tier: state.tier,
      detail:
        partition.mode === 'parallel_batches'
          ? `${partition.batches.length} isolated batches`
          : 'isolated implementation',
      subdetail: `${builtFilesCount || partition.file_count} file(s) in scope`,
      ...phaseStatus(state.phase, state.status, ['BUILD']),
      agents: [
        {
          id: 'linus',
          name: 'Linus',
          role:
            partition.mode === 'parallel_batches'
              ? `Builder (${partition.batches.length} batches)`
              : 'Builder (Isolated)',
          model: profiles.linus.model,
          effort: profiles.linus.reasoning_effort,
          tier: state.tier,
          pct: build ? 100 : state.phase === 'BUILD' ? 65 : 0,
          state: build ? 'done' : state.phase === 'BUILD' ? 'active' : 'queued',
          task: build
            ? `build.md · ${builtFilesCount || partition.file_count} file(s) patched & syntax verified`
            : `Implementing ${partition.file_count || 3} planned file(s)`,
        },
      ],
    },
    {
      id: 'verify',
      title: 'Verify',
      color: 'orange',
      lane:
        sensitiveSurface || state.tier === 'complex'
          ? 'Cobalt · Sentinel · Ralph'
          : 'Cobalt · Ralph',
      model: `${profiles.cobalt.model}`,
      effort: profiles.cobalt.reasoning_effort,
      tier: state.tier,
      detail: review
        ? `${sharpness.verified_blocking}/${sharpness.submitted_blocking} blocking kept`
        : tests
          ? 'cross-checks all'
          : 'contract + test gate',
      subdetail:
        sharpness.demoted_blocking > 0
          ? `${sharpness.demoted_blocking} nit(s) demoted`
          : 'cross-checks AC# & K#',
      ...phaseStatus(state.phase, state.status, ['REVIEW', 'TEST']),
      agents: [
        {
          id: 'cobalt',
          name: 'Cobalt',
          role: 'Code Review',
          model: profiles.cobalt.model,
          effort: profiles.cobalt.reasoning_effort,
          tier: state.tier,
          pct: review ? 100 : state.phase === 'REVIEW' ? 75 : 0,
          state: review ? 'done' : state.phase === 'REVIEW' ? 'active' : 'queued',
          task: review
            ? `review.md · ${sharpness.verified_blocking} blocking, ${sharpness.demoted_blocking} demoted`
            : 'Auditing diff against AC# & K# contract',
        },
        {
          id: 'sentinel',
          name: 'Sentinel',
          role: 'Security Audit',
          model: profiles.sentinel.model,
          effort: profiles.sentinel.reasoning_effort,
          tier: state.tier,
          pct: review || sentinelReview ? 100 : state.phase === 'REVIEW' ? 80 : 0,
          state: review || sentinelReview ? 'done' : state.phase === 'REVIEW' ? 'active' : 'queued',
          task: sensitiveSurface
            ? 'Tenant isolation & money-math surface verified'
            : 'Security invariant & boundary check',
        },
        {
          id: 'ralph',
          name: 'Ralph',
          role: 'Test Suite',
          model: profiles.ralph.model,
          effort: profiles.ralph.reasoning_effort,
          tier: state.tier,
          pct: tests ? 100 : ['REVIEW', 'TEST'].includes(state.phase) ? 70 : 0,
          state: tests ? 'done' : ['REVIEW', 'TEST'].includes(state.phase) ? 'active' : 'queued',
          task: tests
            ? 'tests.md · AC# regression suite passing'
            : 'Executing targeted spec & regression suite',
        },
      ],
    },
  ];

  const counts = {
    decisions: dIds.length,
    acceptance_criteria: acIds.length,
    constraints: kIds.length,
    planned_files: partition.file_count,
    built_files: builtFilesCount,
    sensitive_surface: sensitiveSurface,
    completed_agents: completedAgents,
    total_agents: totalAgents,
    context_kb: contextKb,
  };

  const sessionLog = buildSessionLog(projectDirectory, state, sharpness, profiles, counts, partition);

  return {
    state,
    sharpness,
    profiles,
    partition,
    counts,
    cards,
    session_log: sessionLog,
  };
}

function padRight(text, width) {
  const str = String(text);
  return str.length >= width ? str.slice(0, width) : `${str}${' '.repeat(width - str.length)}`;
}

function renderAsciiBoard(board) {
  const { state, sharpness, cards, counts } = board;
  const header = `10X SQUAD WORKFLOW BOARD · ${state.tier.toUpperCase()} · PHASE: ${state.phase} (${state.status})`;
  const lines = [
    '┌──────────────────────────────────────────────────────────────────────────────┐',
    `│ ${padRight(header, 76)} │`,
    '│ ■ Thinker · plans   ■ Builder · ships   ■ Verifier · gates   ■ Runtime · lock│',
    '├──────────────────────────┬───────────────────────────────────────────────────┤',
    '│ VIVALDI · orchestrator   │ CONTRACT SHARPNESS & DETERMINISTIC GATE           │',
    `│ ◆ phase: ${padRight(state.phase, 15)} │ spec_trace   [${formatBar(sharpness.spec_trace)}] ${sharpness.spec_trace.toFixed(2)} ${padRight(sharpnessLabel(sharpness.spec_trace), 6)}              │`,
    `│   tier:  ${padRight(state.tier, 15)} │ build_scope  [${formatBar(sharpness.build_scope)}] ${sharpness.build_scope.toFixed(2)} ${padRight(sharpnessLabel(sharpness.build_scope), 6)}              │`,
    `│   AC/K:  ${padRight(`${counts.acceptance_criteria} AC / ${counts.constraints} K`, 15)} │ review_gate  [${formatBar(sharpness.review_filter)}] ${sharpness.review_filter.toFixed(2)} ${padRight(sharpnessLabel(sharpness.review_filter), 6)}              │`,
    '│   lean header <= 1.5k    │ sharp -> Builder lane (1-pass) | split -> Thinker │',
    '│   script filters first   ├─────────────────┬─────────────────┬───────────────┤',
  ];

  const [c1, c2, c3] = cards;
  lines.push(
    `│ ◇ agents: ${padRight(`${counts.completed_agents}/${counts.total_agents}`, 14)} │ ${padRight(c1.title, 15)} │ ${padRight(c2.title, 15)} │ ${padRight(c3.title, 13)} │`,
    `│   ctx:    ${padRight(`${counts.context_kb}k`, 14)} │ ${padRight(c1.model, 15)} │ ${padRight(c2.model, 15)} │ ${padRight(c3.model, 13)} │`,
    `│                          │ [${formatBar(c1.pct / 100, 5)}] ${padRight(`${c1.pct}%`, 7)} │ [${formatBar(c2.pct / 100, 5)}] ${padRight(`${c2.pct}%`, 7)} │ [${formatBar(c3.pct / 100, 5)}] ${padRight(`${c3.pct}%`, 5)} │`,
    `│ ◇ next:                  │ ${padRight(c1.detail, 15)} │ ${padRight(c2.detail, 15)} │ ${padRight(c3.detail, 13)} │`,
    `│   ${padRight(state.next_action || 'complete', 22)} │ ${padRight(c1.badge, 15)} │ ${padRight(c2.badge, 15)} │ ${padRight(c3.badge, 13)} │`,
    '├──────────────────────────┴─────────────────┴─────────────────┴───────────────┤'
  );

  for (const entry of (board.session_log || []).slice(-4)) {
    const logLine = `${entry.time}  ${padRight(entry.actor, 16)} ${entry.text}`;
    lines.push(`│ ${padRight(logLine, 76)} │`);
  }

  lines.push(
    '├──────────────────────────────────────────────────────────────────────────────┤',
    `│ workflow [${state.phase.toLowerCase()}]   agents [${counts.completed_agents}/${counts.total_agents}]   sharpness [${sharpness.overall.toFixed(2)} ${sharpness.label}]   updated [${state.updated_at.slice(11, 19)}] │`,
    '└──────────────────────────────────────────────────────────────────────────────┘'
  );

  return `${lines.join('\n')}\n`;
}

function renderAnsiBoard(board) {
  const raw = renderAsciiBoard(board);
  return raw
    .replace(/10X SQUAD WORKFLOW BOARD[^\n]*/g, '\x1b[1;38;2;167;139;250m$&\x1b[0m')
    .replace(/■ Thinker/g, '\x1b[38;2;167;139;250m■ Thinker\x1b[0m')
    .replace(/■ Builder/g, '\x1b[38;2;56;189;248m■ Builder\x1b[0m')
    .replace(/■ Verifier/g, '\x1b[38;2;251;146;60m■ Verifier\x1b[0m')
    .replace(/■ Runtime/g, '\x1b[38;2;74;222;128m■ Runtime\x1b[0m')
    .replace(/█+/g, '\x1b[38;2;74;222;128m$&\x1b[0m')
    .replace(/✓ done/g, '\x1b[38;2;74;222;128m✓ done\x1b[0m');
}

function renderMarkdownBoard(board) {
  const { state, sharpness, cards } = board;
  const [planCard, buildCard, verifyCard] = cards;

  return [
    `### 10x Squad Workflow Board — \`${state.slug}\` (\`${state.tier}\` · \`${state.phase}\`)`,
    '',
    '| Layer | Metric / Role | Progress | Status / Sharpness |',
    '|-------|---------------|----------|--------------------|',
    `| **Contract Sharpness** | \`spec_trace\` / \`build_scope\` / \`review_gate\` | \`[${formatBar(sharpness.overall)}]\` | **${sharpness.overall.toFixed(2)} (${sharpness.label})** |`,
    `| **1. Plan** | ${planCard.lane} · \`${planCard.model}\` (${planCard.detail}) | \`[${formatBar(planCard.pct / 100)}]\` ${planCard.pct}% | ${planCard.badge} |`,
    `| **2. Build** | ${buildCard.lane} · \`${buildCard.model}\` (${buildCard.detail}) | \`[${formatBar(buildCard.pct / 100)}]\` ${buildCard.pct}% | ${buildCard.badge} |`,
    `| **3. Verify** | ${verifyCard.lane} · \`${verifyCard.model}\` (${verifyCard.detail}) | \`[${formatBar(verifyCard.pct / 100)}]\` ${verifyCard.pct}% | ${verifyCard.badge} |`,
    '',
    '```mermaid',
    'flowchart TB',
    `  Vivaldi["Vivaldi Orchestrator\\nTier: ${state.tier} | Phase: ${state.phase}"]:::thinker`,
    `  Plan["PLAN · ${planCard.lane} (${planCard.model})\\n${planCard.detail} (${planCard.badge})"]:::scan`,
    `  Gate["CONTROL.JS · CONTRACT & SHARPNESS GATE\\nspec ${sharpness.spec_trace.toFixed(2)} · build ${sharpness.build_scope.toFixed(2)} · review ${sharpness.review_filter.toFixed(2)} (${sharpness.label})"]:::gate`,
    `  Build["BUILD · ${buildCard.lane} (${buildCard.model})\\n${buildCard.detail} (${buildCard.badge})"]:::ship`,
    `  Verify["VERIFY · ${verifyCard.lane}\\n${verifyCard.detail} (${verifyCard.badge})"]:::ship`,
    '  SignOff["DELIVER · Vivaldi Sign-Off\\nVerified findings only"]:::thinker',
    '  Vivaldi --> Plan --> Gate',
    '  Gate --> Build & Verify --> SignOff',
    '  classDef thinker stroke:#a78bfa,fill:#1a162b,color:#ede9fe,stroke-width:2px;',
    '  classDef gate stroke:#4ade80,fill:#12261e,color:#dcfce7,stroke-width:2px;',
    '  classDef scan stroke:#38bdf8,fill:#112233,color:#e0f2fe,stroke-width:2px;',
    '  classDef ship stroke:#fb923c,fill:#2a1b12,color:#ffedd5,stroke-width:2px;',
    '```',
    '',
  ].join('\n');
}

function renderHtmlDashboard(initialBoard) {
  const safeJson = JSON.stringify(initialBoard).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>10x Squad — Workflow Monitor</title>
<style>
  :root {
    --bg-canvas: #0b0d10;
    --bg-surface: #101318;
    --bg-card: #151920;
    --bg-subtle: #1a1f28;
    --border: #242a35;
    --border-active: #3a4456;
    --text-main: #e6edf3;
    --text-secondary: #9ca3af;
    --text-muted: #6b7280;
    --blue: #58a6ff;
    --green: #3fb950;
    --amber: #d29922;
    --slate: #8b949e;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg-canvas);
    color: var(--text-main);
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
    font-size: 12px;
    line-height: 1.45;
    font-variant-numeric: tabular-nums;
    padding: 8px;
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    overflow-x: hidden;
  }
  .mono {
    font-family: "SF Mono", "JetBrains Mono", "Fira Code", Menlo, Consolas, monospace;
  }
  .window {
    width: 100%;
    max-width: 1240px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    transform-origin: top center;
  }

  /* Header Bar */
  .hud-header {
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border);
    padding: 10px 14px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
  }
  .brand-group {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px 10px;
    min-width: 0;
  }
  .brand-tag {
    color: var(--text-muted);
    font-weight: 600;
    font-size: 11px;
    letter-spacing: 0.02em;
  }
  .project-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-main);
  }
  .project-sub {
    font-size: 11px;
    color: var(--text-muted);
  }
  .hud-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .sync-indicator {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 10.5px;
    color: var(--text-secondary);
    padding: 3px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-card);
  }
  .status-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .dot-done { background: var(--green); }
  .dot-active { background: var(--amber); }
  .dot-blue { background: var(--blue); }
  .dot-queued { background: #484f58; }

  .btn {
    background: var(--bg-card);
    color: var(--text-main);
    border: 1px solid var(--border-active);
    border-radius: 5px;
    padding: 4px 9px;
    font-family: inherit;
    font-weight: 500;
    font-size: 11px;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s ease, border-color 0.12s ease;
  }
  .btn:hover {
    background: var(--bg-subtle);
    border-color: #526079;
  }
  .btn:disabled {
    opacity: 0.65;
    cursor: default;
  }

  /* Summary Metrics Bar */
  .metrics-bar {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    border-bottom: 1px solid var(--border);
    background: #0d1015;
  }
  .metric-cell {
    padding: 8px 14px;
    border-right: 1px solid var(--border);
  }
  .metric-cell:last-child { border-right: none; }
  .metric-label {
    font-size: 10px;
    color: var(--text-muted);
    font-weight: 500;
  }
  .metric-val {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-main);
    margin-top: 2px;
  }

  /* Main 2-Column Topology Grid */
  .main-grid {
    display: grid;
    grid-template-columns: minmax(195px, 23%) minmax(0, 1fr);
    gap: 12px;
    padding: 12px 14px;
    align-items: stretch;
  }
  .left-rail {
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-card);
    padding: 10px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-width: 0;
  }
  .left-rail.receiving {
    border-color: var(--blue);
  }
  .rail-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 7px;
    margin-bottom: 7px;
    border-bottom: 1px solid var(--border);
  }
  .rail-title {
    font-weight: 600;
    font-size: 11.5px;
    color: var(--text-main);
  }
  .rail-role-tag {
    font-size: 10px;
    color: var(--text-muted);
  }
  .rail-step {
    padding: 4px 7px;
    margin: 2px 0;
    color: var(--text-muted);
    border-left: 2px solid transparent;
    font-size: 10.5px;
    font-weight: 500;
  }
  .rail-step.active {
    background: var(--bg-subtle);
    border-left-color: var(--blue);
    color: var(--text-main);
  }
  .pipeline-stages-card {
    margin: 6px 0 8px;
    padding: 7px;
    background: #11141a;
    border: 1px solid var(--border);
    border-radius: 5px;
  }
  .stage-card-hdr {
    font-size: 10px;
    color: var(--text-muted);
    margin-bottom: 4px;
    font-weight: 500;
  }
  .code-line {
    padding: 2.5px 5px;
    margin: 1px 0;
    border-radius: 3px;
    font-size: 10px;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .code-line.hl {
    background: var(--bg-subtle);
    color: var(--text-main);
    font-weight: 600;
  }
  .c-blue { color: var(--blue); }
  .c-green { color: var(--green); }
  .c-amber { color: var(--amber); }
  .c-muted { color: var(--text-muted); }

  .rail-telemetry {
    margin: 6px 0;
    padding: 7px;
    background: #11141a;
    border: 1px solid var(--border);
    border-radius: 5px;
    font-size: 10px;
  }
  .stat-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 3px;
  }
  .stat-row:last-child { margin-bottom: 0; }
  .rail-note {
    margin: 4px 0 6px;
    padding: 5px 7px;
    border-left: 2px solid var(--border-active);
    color: var(--text-muted);
    font-size: 10px;
    line-height: 1.35;
  }

  /* Right Stage Topology */
  .right-stage {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
    position: relative;
  }
  .stage-row-with-bridge {
    width: 100%;
    position: relative;
  }
  .bridge-svg {
    position: absolute;
    left: -12px;
    top: 50%;
    transform: translateY(-50%);
    width: 14px;
    height: 20px;
    overflow: visible;
    pointer-events: none;
  }
  .bridge-spacer { display: none; }

  .top-node {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-card);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .bottom-node {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-card);
    padding: 9px 12px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
  }
  .top-node.node-active, .bottom-node.node-active {
    border-color: var(--blue);
  }
  .node-head-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 6px 10px;
    width: 100%;
  }
  .node-main { min-width: 0; width: 100%; }
  .node-title { font-weight: 600; color: var(--text-main); font-size: 12px; line-height: 1.3; }
  .node-sub { color: var(--text-secondary); font-size: 10.5px; line-height: 1.4; }
  .node-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    color: var(--text-muted);
    margin-top: 2px;
  }
  .tag {
    padding: 2px 7px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: #11141a;
    color: var(--text-secondary);
    font-size: 10px;
    white-space: nowrap;
  }

  /* Deterministic Gate Card */
  .gate-node {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-card);
    padding: 9px 12px;
  }
  .gate-node.gate-active {
    border-color: var(--border-active);
  }
  .gate-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: 600;
    font-size: 11px;
    color: var(--text-main);
    margin-bottom: 6px;
  }
  .gate-row {
    display: grid;
    grid-template-columns: 120px 1fr 72px;
    align-items: center;
    gap: 8px;
    margin: 4px 0;
    font-size: 10.5px;
  }
  .meter-track {
    width: 100%;
    height: 6px;
    background: #101318;
    border: 1px solid var(--border);
    border-radius: 3px;
    overflow: hidden;
  }
  .meter-fill {
    height: 100%;
    background: var(--green);
    transition: width 0.12s linear;
  }
  .gate-footer {
    margin-top: 6px;
    padding-top: 5px;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    color: var(--text-muted);
  }

  /* 3 Expandable Stage Group Cards */
  .cards-wrap {
    width: 100%;
    position: relative;
  }
  .bridge-mid-svg {
    position: absolute;
    left: -12px;
    top: 24px;
    width: 14px;
    height: 20px;
    overflow: visible;
    pointer-events: none;
  }
  .cards-row {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    align-items: start;
  }
  .phase-card {
    border: 1px solid var(--border);
    border-top: 2px solid var(--border);
    border-radius: 6px;
    background: var(--bg-card);
    min-width: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .phase-card.done {
    border-top-color: var(--green);
  }
  .phase-card.active {
    border-color: var(--border-active);
    border-top-color: var(--blue);
  }
  .card-head {
    padding: 8px 9px 7px;
    cursor: pointer;
    user-select: none;
    transition: background 0.12s ease;
  }
  .card-head:hover {
    background: var(--bg-subtle);
  }
  .card-top-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
  }
  .card-title-group {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .card-title {
    font-weight: 600;
    color: var(--text-main);
    font-size: 11.5px;
  }
  .agent-count-pill {
    font-size: 9.5px;
    color: var(--text-muted);
    background: #101318;
    border: 1px solid var(--border);
    padding: 0.5px 5px;
    border-radius: 3px;
  }
  .card-right-meta {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 10.5px;
    color: var(--text-secondary);
  }
  .chevron {
    color: var(--text-muted);
    font-size: 10px;
    width: 10px;
    text-align: center;
  }
  .card-bar-track {
    width: 100%;
    height: 3px;
    background: #101318;
    border-radius: 2px;
    overflow: hidden;
    margin: 6px 0 5px;
  }
  .card-bar-fill {
    height: 100%;
    background: var(--blue);
    transition: width 0.12s linear;
  }
  .phase-card.done .card-bar-fill {
    background: var(--green);
  }
  .card-summary-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 10px;
    color: var(--text-muted);
    gap: 4px;
  }
  .card-summary-line span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Expandable Individual Agent Rows */
  .agent-drawer {
    border-top: 1px solid var(--border);
    background: #11141a;
    padding: 6px 7px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    flex: 1;
  }
  .agent-drawer.collapsed {
    display: none;
  }
  .agent-item {
    padding: 5px 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-card);
  }
  .agent-item.active {
    border-color: var(--border-active);
  }
  .agent-item-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 10.5px;
  }
  .agent-name-wrap {
    display: flex;
    align-items: center;
    gap: 5px;
    font-weight: 600;
    color: var(--text-main);
  }
  .agent-role {
    font-size: 9.5px;
    color: var(--text-muted);
    margin-top: 1px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .agent-meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-top: 3px;
  }
  .meta-chip {
    font-size: 8.8px;
    padding: 1px 4.5px;
    border-radius: 3px;
    background: #101318;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    white-space: nowrap;
  }
  .meta-chip.model {
    color: var(--blue);
    border-color: rgba(88, 166, 255, 0.28);
  }
  .card-profile-line {
    font-size: 9.2px;
    color: var(--text-secondary);
    margin-top: 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .vivaldi-profile-box {
    margin-bottom: 7px;
    padding: 6px 7px;
    background: #11141a;
    border: 1px solid var(--border);
    border-radius: 5px;
    font-size: 9.8px;
  }
  .vivaldi-profile-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2.5px;
    gap: 6px;
  }
  .vivaldi-profile-row:last-child {
    margin-bottom: 0;
  }
  .vivaldi-profile-row span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .agent-mini-track {
    width: 100%;
    height: 2px;
    background: #0d1015;
    border-radius: 1px;
    overflow: hidden;
    margin: 4px 0;
  }
  .agent-mini-fill {
    height: 100%;
    background: var(--blue);
    transition: width 0.12s linear;
  }
  .agent-item.done .agent-mini-fill {
    background: var(--green);
  }
  .agent-task {
    font-size: 9.5px;
    color: var(--text-secondary);
    line-height: 1.3;
    word-break: break-word;
  }

  /* Activity Stream Panel */
  .feed-panel {
    margin: 0 14px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-card);
    overflow: hidden;
  }
  .feed-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 10px;
    background: #11141a;
    border-bottom: 1px solid var(--border);
    font-size: 10.5px;
    font-weight: 500;
    color: var(--text-secondary);
  }
  .feed-body {
    padding: 5px 8px;
    min-height: 74px;
  }
  .log-line {
    display: grid;
    grid-template-columns: 56px 96px 1fr;
    gap: 8px;
    font-size: 10.5px;
    padding: 2px 6px;
    align-items: baseline;
    border-radius: 3px;
    color: var(--text-secondary);
  }
  .log-line.latest {
    background: var(--bg-subtle);
    color: var(--text-main);
  }
  .log-line span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  svg.connector { display: block; width: 100%; overflow: visible; }
  .wire-base {
    fill: none;
    stroke: #2a313d;
    stroke-width: 1.25;
  }
  .wire-dashed { stroke-dasharray: 3, 3; }
  .wire-active-blue { stroke: var(--blue); stroke-width: 1.6; }
  .wire-active-green { stroke: var(--green); stroke-width: 1.6; }
  .wire-active-amber { stroke: var(--amber); stroke-width: 1.6; }
  .wire-done { stroke: #3d4758; stroke-width: 1.35; }
  .arrow-head { fill: #3d4758; }

  @media (max-width: 680px) {
    .metrics-bar {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .metric-cell:nth-child(2) {
      border-right: none;
    }
    .metric-cell:nth-child(1), .metric-cell:nth-child(2) {
      border-bottom: 1px solid var(--border);
    }
    .main-grid {
      grid-template-columns: 1fr;
    }
    .bridge-svg, .bridge-spacer, .bridge-mid-svg {
      display: none;
    }
  }
  @media (max-width: 540px) {
    .cards-row {
      grid-template-columns: 1fr;
    }
    #svg-fanout, #svg-fanin {
      height: 22px;
    }
  }
</style>
</head>
<body>
  <div class="window">
    <div class="hud-header">
      <div class="brand-group">
        <span class="brand-tag">10x Squad</span>
        <span class="project-title" id="win-title">payment-settlement-demo</span>
        <span class="project-sub" id="top-banner">Workflow Monitor</span>
      </div>
      <div class="hud-actions">
        <span class="sync-indicator"><span class="status-dot dot-done"></span><span id="conn-label">Live</span></span>
        <button class="btn" id="expand-btn" onclick="toggleAllGroups()">Collapse Agents</button>
        <button class="btn" id="sim-btn" onclick="triggerSimulation()">Simulate Run</button>
      </div>
    </div>

    <div class="metrics-bar">
      <div class="metric-cell">
        <div class="metric-label">Current Stage</div>
        <div class="metric-val" id="kpi-phase">PLAN</div>
      </div>
      <div class="metric-cell">
        <div class="metric-label">Contract Sharpness</div>
        <div class="metric-val" id="kpi-sharpness">1.00 (Sharp)</div>
      </div>
      <div class="metric-cell">
        <div class="metric-label">Completed Agents</div>
        <div class="metric-val" id="kpi-agents">0 / 6</div>
      </div>
      <div class="metric-cell">
        <div class="metric-label">Review Gate</div>
        <div class="metric-val" id="kpi-review">0 Blocking</div>
      </div>
    </div>

    <div class="main-grid">
      <div class="left-rail" id="left-rail">
        <div>
          <div class="rail-header">
            <span class="rail-title">Vivaldi</span>
            <span class="rail-role-tag">Orchestrator</span>
          </div>

          <div class="vivaldi-profile-box">
            <div class="vivaldi-profile-row"><span class="c-muted">Model</span><span class="mono c-blue" id="viv-model">claude-opus-5.5</span></div>
            <div class="vivaldi-profile-row"><span class="c-muted">Reasoning</span><span class="mono" id="viv-effort">high</span></div>
            <div class="vivaldi-profile-row"><span class="c-muted">Tier</span><span class="mono" id="viv-tier">standard_ambiguous</span></div>
          </div>

          <div class="rail-step" id="step-script">1. Compile Contract</div>

          <div class="pipeline-stages-card">
            <div class="stage-card-hdr">Execution Plan</div>
            <div class="code-line" id="cl-plan-1"><span>Plan</span><span class="mono c-muted">Einstein · Peter</span></div>
            <div class="code-line" id="cl-plan-2"><span>Contract</span><span class="mono c-green">D# → AC# + K#</span></div>
            <div class="code-line" id="cl-build-1"><span>Build</span><span class="mono c-blue">Linus</span></div>
            <div class="code-line" id="cl-build-2"><span>Isolation</span><span class="mono c-muted" id="script-mode">isolated</span></div>
            <div class="code-line" id="cl-verify-1"><span>Verify</span><span class="mono c-amber">Parallel (3)</span></div>
            <div class="code-line" id="cl-verify-2"><span>Reviewers</span><span class="mono c-muted">Cobalt · Sentinel</span></div>
            <div class="code-line" id="cl-verify-3"><span>Tests</span><span class="mono c-muted">Ralph</span></div>
            <div class="code-line" id="cl-return"><span>Deliver</span><span class="mono c-green">Sign-Off</span></div>
          </div>

          <div class="rail-telemetry">
            <div class="stat-row"><span class="c-muted">Agents</span><span id="stat-agents" class="mono">0/6</span></div>
            <div class="stat-row"><span class="c-muted">Header Context</span><span id="stat-ctx" class="mono">0.8k / 1.5k</span></div>
          </div>

          <div class="rail-step" id="step-mid">2. Mid-Run Gate</div>
          <div class="rail-note">
            Validates file scope and requires contract citations + proof for blocking review findings.
          </div>
        </div>
        <div class="rail-step" id="step-signoff">3. Sign Off</div>
      </div>

      <div class="right-stage">
        <div class="stage-row-with-bridge">
          <svg class="bridge-svg" viewBox="0 0 14 20">
            <path id="path-bridge-top" class="wire-base wire-dashed" d="M 0 10 L 9 10" />
            <polygon class="arrow-head" points="7,7 13,10 7,13" />
            <g id="comet-bridge-top"></g>
          </svg>
          <div class="top-node" id="top-node">
            <div class="node-head-row">
              <div class="node-title" id="top-node-title">Planning &amp; Spec Compilation</div>
              <span class="tag mono" style="color:var(--text-muted)">Thinker Lane</span>
            </div>
            <div class="node-sub">Einstein (Brief D# Decisions) &rarr; Peter (Spec AC# Criteria + K# Constraints)</div>
            <div class="node-meta">
              <span class="tag mono c-blue" id="top-model-text">claude-opus-5.5</span>
              <span class="tag mono" id="top-effort-text">reasoning: high</span>
              <span class="tag mono" id="top-tier-flag">tier: standard_ambiguous</span>
            </div>
          </div>
        </div>

        <svg class="connector" id="svg-thinker-gate" viewBox="0 0 600 22" height="20">
          <path id="path-thinker-gate" class="wire-base wire-dashed" d="M 300 1 L 300 17" />
          <polygon id="arr-thinker-gate" class="arrow-head" points="296.5,15 300,21 303.5,15" />
          <g id="comet-thinker-gate"></g>
        </svg>

        <div class="gate-node" id="gate-node">
          <div class="gate-header">
            <span>CONTROL.JS · deterministic gate</span>
            <span class="c-muted" style="font-weight:500;font-size:10px">Traces: <b style="color:var(--text-main)" id="gate-traces" class="mono">0</b></span>
          </div>
          <div class="gate-row">
            <span class="c-muted">Spec Traceability</span>
            <div class="meter-track"><div class="meter-fill" id="bar-spec" style="width:0%"></div></div>
            <span id="lbl-spec" class="mono" style="text-align:right"></span>
          </div>
          <div class="gate-row">
            <span class="c-muted">Build Scope</span>
            <div class="meter-track"><div class="meter-fill" id="bar-build" style="width:0%"></div></div>
            <span id="lbl-build" class="mono" style="text-align:right"></span>
          </div>
          <div class="gate-row">
            <span class="c-muted">Review Filter</span>
            <div class="meter-track"><div class="meter-fill" id="bar-review" style="width:0%"></div></div>
            <span id="lbl-review" class="mono" style="text-align:right"></span>
          </div>
          <div class="gate-footer">
            <span>Sharp (&ge;0.80) &rarr; Proceed to Builder</span>
            <span>Split (&lt;0.80) &rarr; Return to Spec</span>
          </div>
        </div>

        <svg class="connector" id="svg-fanout" viewBox="0 0 600 26" height="26">
          <path id="track-fanout-0" class="wire-base" d="M 300 0 L 300 13 L 97 13 L 97 22" />
          <path id="track-fanout-1" class="wire-base" d="M 300 0 L 300 22" />
          <path id="track-fanout-2" class="wire-base" d="M 300 0 L 300 13 L 503 13 L 503 22" />
          <path id="path-fanout-0" class="wire-base" d="M 300 0 L 300 13 L 97 13 L 97 22" />
          <path id="path-fanout-1" class="wire-base" d="M 300 0 L 300 22" />
          <path id="path-fanout-2" class="wire-base" d="M 300 0 L 300 13 L 503 13 L 503 22" />
          <polygon id="arr-fanout-0" class="arrow-head" points="93.5,20 97,26 100.5,20" />
          <polygon id="arr-fanout-1" class="arrow-head" points="296.5,20 300,26 303.5,20" />
          <polygon id="arr-fanout-2" class="arrow-head" points="499.5,20 503,26 506.5,20" />
          <g id="comet-fanout-0"></g>
          <g id="comet-fanout-1"></g>
          <g id="comet-fanout-2"></g>
        </svg>

        <div class="cards-wrap">
          <svg class="bridge-mid-svg" viewBox="0 0 14 20">
            <path id="path-bridge-mid" class="wire-base wire-dashed" d="M 0 10 L 9 10" />
            <polygon class="arrow-head" points="7,7 13,10 7,13" />
            <g id="comet-bridge-mid"></g>
          </svg>
          <div class="cards-row" id="cards-row"></div>
        </div>

        <svg class="connector" id="svg-fanin" viewBox="0 0 600 28" height="28">
          <path id="track-fanin-0" class="wire-base" d="M 97 0 L 97 14 L 300 14 L 300 24" />
          <path id="track-fanin-1" class="wire-base" d="M 300 0 L 300 24" />
          <path id="track-fanin-2" class="wire-base" d="M 503 0 L 503 14 L 300 14 L 300 24" />
          <path id="path-fanin-0" class="wire-base" d="M 97 0 L 97 14 L 300 14 L 300 24" />
          <path id="path-fanin-1" class="wire-base" d="M 300 0 L 300 24" />
          <path id="path-fanin-2" class="wire-base" d="M 503 0 L 503 14 L 300 14 L 300 24" />
          <polygon id="arr-fanin" class="arrow-head" points="296.5,22 300,28 303.5,22" />
          <g id="comet-fanin-0"></g>
          <g id="comet-fanin-1"></g>
          <g id="comet-fanin-2"></g>
        </svg>

        <div class="stage-row-with-bridge">
          <svg class="bridge-svg" viewBox="0 0 14 20">
            <path id="path-bridge-bottom" class="wire-base wire-dashed" d="M 13 10 L 4 10" />
            <polygon class="arrow-head" points="6,7 0,10 6,13" />
            <g id="comet-bridge-bottom"></g>
          </svg>
          <div class="bottom-node" id="bottom-node">
            <div style="min-width:0;flex:1">
              <div class="node-title">Vivaldi · Delivery Sign-Off</div>
              <div class="node-sub" id="bottom-summary">Verified findings only · Ready for delivery</div>
            </div>
            <span class="tag mono" id="verdict-tag">APPROVE</span>
          </div>
        </div>
      </div>
    </div>

    <div class="feed-panel">
      <div class="feed-header">
        <span>Activity Log</span>
        <span id="cmd-line" class="mono"></span>
      </div>
      <div class="feed-body" id="session-log"></div>
    </div>
  </div>

<script>
  let currentBoard = ${safeJson};
  let simActive = false;
  let simRafId = null;
  const expandedGroups = { plan: true, build: true, verify: true };

  function toggleGroup(groupId) {
    expandedGroups[groupId] = !expandedGroups[groupId];
    updateExpandBtnLabel();
    render(currentBoard);
    requestAnimationFrame(syncSvgGeometry);
  }

  function toggleAllGroups() {
    const anyCollapsed = Object.values(expandedGroups).some((v) => !v);
    expandedGroups.plan = anyCollapsed;
    expandedGroups.build = anyCollapsed;
    expandedGroups.verify = anyCollapsed;
    updateExpandBtnLabel();
    render(currentBoard);
    requestAnimationFrame(syncSvgGeometry);
  }

  function updateExpandBtnLabel() {
    const btn = document.getElementById('expand-btn');
    if (!btn) return;
    const allOpen = Object.values(expandedGroups).every(Boolean);
    btn.textContent = allOpen ? 'Collapse Agents' : 'Expand Agents';
  }

  const FLOW_STREAMS = {
    'bridge-top':    { pathId: 'path-bridge-top',    groupId: 'comet-bridge-top',    color: '#58a6ff', speed: 0.95, packets: 1, active: false, u: 0.0 },
    'thinker-gate':  { pathId: 'path-thinker-gate',  groupId: 'comet-thinker-gate',  color: '#58a6ff', speed: 1.15, packets: 1, active: false, u: 0.2 },
    'fanout-0':      { pathId: 'path-fanout-0',      groupId: 'comet-fanout-0',      color: '#58a6ff', speed: 0.85, packets: 2, active: false, u: 0.0 },
    'fanout-1':      { pathId: 'path-fanout-1',      groupId: 'comet-fanout-1',      color: '#58a6ff', speed: 1.05, packets: 1, active: false, u: 0.15 },
    'fanout-2':      { pathId: 'path-fanout-2',      groupId: 'comet-fanout-2',      color: '#d29922', speed: 0.85, packets: 2, active: false, u: 0.0 },
    'bridge-mid':    { pathId: 'path-bridge-mid',    groupId: 'comet-bridge-mid',    color: '#3fb950', speed: 1.30, packets: 1, active: false, u: 0.0 },
    'fanin-0':       { pathId: 'path-fanin-0',       groupId: 'comet-fanin-0',       color: '#3fb950', speed: 0.85, packets: 1, active: false, u: 0.0 },
    'fanin-1':       { pathId: 'path-fanin-1',       groupId: 'comet-fanin-1',       color: '#3fb950', speed: 1.05, packets: 1, active: false, u: 0.25 },
    'fanin-2':       { pathId: 'path-fanin-2',       groupId: 'comet-fanin-2',       color: '#3fb950', speed: 0.85, packets: 1, active: false, u: 0.5 },
    'bridge-bottom': { pathId: 'path-bridge-bottom', groupId: 'comet-bridge-bottom', color: '#58a6ff', speed: 0.95, packets: 1, active: false, u: 0.0 }
  };

  function initCometDom() {
    const ns = 'http://www.w3.org/2000/svg';
    Object.values(FLOW_STREAMS).forEach((st) => {
      const g = document.getElementById(st.groupId);
      if (!g) return;
      g.innerHTML = '';
      const baseSpecs = [
        { r: 2.8, fill: st.color, op: 0.95, lag: 0.00 },
        { r: 1.8, fill: st.color, op: 0.55, lag: 0.065 }
      ];
      const allDots = [];
      const count = st.packets || 1;
      for (let p = 0; p < count; p++) {
        const packetOffset = p / count;
        baseSpecs.forEach((sp) => {
          const c = document.createElementNS(ns, 'circle');
          c.setAttribute('r', String(sp.r));
          c.setAttribute('fill', sp.fill);
          c.setAttribute('opacity', '0');
          g.appendChild(c);
          allDots.push({ el: c, baseOp: sp.op, lag: sp.lag, offset: packetOffset });
        });
      }
      st.dots = allDots;
    });
  }

  let lastFrameTs = performance.now();
  function stepComets(now) {
    const dt = Math.min(0.06, Math.max(0.001, (now - lastFrameTs) / 1000));
    lastFrameTs = now;
    Object.values(FLOW_STREAMS).forEach((st) => {
      const pathEl = document.getElementById(st.pathId);
      if (!pathEl || !st.dots) return;
      const isDashed = st.pathId.includes('bridge') || st.pathId === 'path-thinker-gate';
      if (!st.active) {
        st.wasActive = false;
        st.dots.forEach((d) => d.el.setAttribute('opacity', '0'));
        pathEl.style.strokeDasharray = isDashed ? '3, 3' : '';
        pathEl.style.strokeDashoffset = '';
        return;
      }
      const len = pathEl.getTotalLength ? pathEl.getTotalLength() : 0;
      if (len <= 0) return;

      if (!st.wasActive) {
        st.wasActive = true;
        st.reveal = 0.04;
        st.u = 0.04;
      }

      if (st.reveal < 1) {
        st.reveal = Math.min(1, st.reveal + dt * 1.55);
        if (!isDashed) {
          pathEl.style.strokeDasharray = len.toFixed(1);
          pathEl.style.strokeDashoffset = ((1 - st.reveal) * len).toFixed(1);
        }
        st.u = st.reveal;
      } else {
        if (!isDashed) {
          pathEl.style.strokeDasharray = '';
          pathEl.style.strokeDashoffset = '';
        }
        st.u = (st.u + dt * st.speed) % 1;
      }

      st.dots.forEach((d) => {
        if (st.reveal < 1 && d.offset > 0) {
          d.el.setAttribute('opacity', '0');
          return;
        }
        let uPos = st.reveal < 1 ? Math.max(0, st.u - d.lag) : (st.u + d.offset - d.lag) % 1;
        if (uPos < 0) uPos += 1;
        const pt = pathEl.getPointAtLength(uPos * len);
        d.el.setAttribute('cx', pt.x.toFixed(1));
        d.el.setAttribute('cy', pt.y.toFixed(1));
        const edgeFade = uPos < 0.06 ? uPos / 0.06 : uPos > 0.92 ? (1 - uPos) / 0.08 : 1;
        d.el.setAttribute('opacity', (d.baseOp * Math.max(0, edgeFade)).toFixed(2));
      });
    });
    requestAnimationFrame(stepComets);
  }

  function setHtml(id, html) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el._lastHtml !== html) {
      el.innerHTML = html;
      el._lastHtml = html;
    }
  }

  function setWireState(pathId, cls) {
    const el = document.getElementById(pathId);
    if (!el) return;
    const isDashed = pathId.includes('bridge') || pathId === 'path-thinker-gate';
    el.setAttribute('class', 'wire-base' + (isDashed ? ' wire-dashed' : '') + (cls ? ' ' + cls : ''));
  }

  function highlightCodeLines(ids) {
    const all = ['cl-plan-1', 'cl-plan-2', 'cl-build-1', 'cl-build-2', 'cl-verify-1', 'cl-verify-2', 'cl-verify-3', 'cl-return'];
    all.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.className = 'code-line' + (ids.includes(id) ? ' hl' : '');
    });
  }

  function applyStageVisuals(stageKey) {
    Object.values(FLOW_STREAMS).forEach((s) => { s.active = false; });
    [
      'path-bridge-top', 'path-thinker-gate', 'path-fanout-0', 'path-fanout-1',
      'path-fanout-2', 'path-bridge-mid', 'path-fanin-0', 'path-fanin-1',
      'path-fanin-2', 'path-bridge-bottom'
    ].forEach((id) => setWireState(id, ''));

    const topNode = document.getElementById('top-node');
    const gateNode = document.getElementById('gate-node');
    const bottomNode = document.getElementById('bottom-node');
    const leftRail = document.getElementById('left-rail');
    if (topNode) topNode.className = 'top-node';
    if (gateNode) gateNode.className = 'gate-node';
    if (bottomNode) bottomNode.className = 'bottom-node';
    if (leftRail) leftRail.className = 'left-rail';

    if (stageKey === 'thinker') {
      FLOW_STREAMS['bridge-top'].active = true;
      FLOW_STREAMS['thinker-gate'].active = true;
      setWireState('path-bridge-top', 'wire-active-blue');
      setWireState('path-thinker-gate', 'wire-active-blue');
      if (topNode) topNode.className = 'top-node node-active';
      highlightCodeLines(['cl-plan-1', 'cl-plan-2']);
    } else if (stageKey === 'gate-to-plan') {
      FLOW_STREAMS['thinker-gate'].active = true;
      FLOW_STREAMS['fanout-0'].active = true;
      setWireState('path-thinker-gate', 'wire-active-green');
      setWireState('path-fanout-0', 'wire-active-blue');
      if (gateNode) gateNode.className = 'gate-node gate-active';
      highlightCodeLines(['cl-plan-1', 'cl-plan-2']);
    } else if (stageKey === 'plan-handoff') {
      FLOW_STREAMS['fanin-0'].active = true;
      FLOW_STREAMS['fanout-1'].active = true;
      setWireState('path-fanout-0', 'wire-done');
      setWireState('path-fanin-0', 'wire-active-green');
      setWireState('path-fanout-1', 'wire-active-blue');
      if (gateNode) gateNode.className = 'gate-node gate-active';
      highlightCodeLines(['cl-build-1', 'cl-build-2']);
    } else if (stageKey === 'plan-to-build') {
      FLOW_STREAMS['fanout-1'].active = true;
      FLOW_STREAMS['bridge-mid'].active = true;
      setWireState('path-fanout-0', 'wire-done');
      setWireState('path-fanin-0', 'wire-done');
      setWireState('path-fanout-1', 'wire-active-blue');
      setWireState('path-bridge-mid', 'wire-active-green');
      if (gateNode) gateNode.className = 'gate-node gate-active';
      highlightCodeLines(['cl-build-1', 'cl-build-2']);
    } else if (stageKey === 'build-handoff') {
      FLOW_STREAMS['fanin-1'].active = true;
      FLOW_STREAMS['fanout-2'].active = true;
      setWireState('path-fanout-0', 'wire-done');
      setWireState('path-fanin-0', 'wire-done');
      setWireState('path-fanout-1', 'wire-done');
      setWireState('path-fanin-1', 'wire-active-green');
      setWireState('path-fanout-2', 'wire-active-amber');
      if (gateNode) gateNode.className = 'gate-node gate-active';
      highlightCodeLines(['cl-verify-1', 'cl-verify-2', 'cl-verify-3']);
    } else if (stageKey === 'build-to-verify') {
      FLOW_STREAMS['fanout-2'].active = true;
      FLOW_STREAMS['bridge-mid'].active = true;
      setWireState('path-fanout-0', 'wire-done');
      setWireState('path-fanin-0', 'wire-done');
      setWireState('path-fanout-1', 'wire-done');
      setWireState('path-fanin-1', 'wire-done');
      setWireState('path-fanout-2', 'wire-active-amber');
      setWireState('path-bridge-mid', 'wire-active-green');
      if (gateNode) gateNode.className = 'gate-node gate-active';
      highlightCodeLines(['cl-verify-1', 'cl-verify-2', 'cl-verify-3']);
    } else if (stageKey === 'verify-handoff') {
      FLOW_STREAMS['fanin-2'].active = true;
      setWireState('path-fanout-0', 'wire-done');
      setWireState('path-fanout-1', 'wire-done');
      setWireState('path-fanout-2', 'wire-done');
      setWireState('path-fanin-0', 'wire-done');
      setWireState('path-fanin-1', 'wire-done');
      setWireState('path-fanin-2', 'wire-active-green');
      if (bottomNode) bottomNode.className = 'bottom-node node-active';
      highlightCodeLines(['cl-return']);
    } else if (stageKey === 'signoff') {
      FLOW_STREAMS['bridge-bottom'].active = true;
      setWireState('path-fanout-0', 'wire-done');
      setWireState('path-fanout-1', 'wire-done');
      setWireState('path-fanout-2', 'wire-done');
      setWireState('path-fanin-0', 'wire-done');
      setWireState('path-fanin-1', 'wire-done');
      setWireState('path-fanin-2', 'wire-done');
      setWireState('path-bridge-bottom', 'wire-active-blue');
      if (bottomNode) bottomNode.className = 'bottom-node node-active';
      if (leftRail) leftRail.className = 'left-rail receiving';
      highlightCodeLines(['cl-return']);
    }
  }

  function dotClass(state) {
    if (state === 'done') return 'dot-done';
    if (state === 'active') return 'dot-active';
    return 'dot-queued';
  }

  function stageKeyFromPhase(phase, status) {
    if (phase === 'DELIVER' || status === 'complete') return 'signoff';
    if (phase === 'REVIEW' || phase === 'TEST') return 'build-to-verify';
    if (phase === 'BUILD') return 'plan-to-build';
    if (phase === 'PLAN') return 'gate-to-plan';
    return 'thinker';
  }

  function render(board, overrideStageKey) {
    const { state, sharpness, counts, cards, profiles, partition, session_log } = board;
    document.getElementById('win-title').textContent = state.slug;

    setHtml(
      'top-banner',
      counts.total_agents + ' agents &middot; ' + (counts.acceptance_criteria + counts.constraints) + ' rules'
    );

    const isPlan = ['TRIAGE', 'DELIBERATE', 'INTAKE', 'PLAN'].includes(state.phase);
    const isMid = ['BUILD', 'REVIEW', 'TEST'].includes(state.phase);
    const isDone = state.phase === 'DELIVER' || state.status === 'complete';

    setHtml('kpi-phase', state.phase);
    setHtml('kpi-sharpness', sharpness.overall.toFixed(2) + ' (' + (sharpness.overall >= 0.8 ? 'Sharp' : 'Split') + ')');
    setHtml('kpi-agents', counts.completed_agents + ' / ' + counts.total_agents);
    setHtml(
      'kpi-review',
      sharpness.demoted_blocking > 0
        ? sharpness.verified_blocking + ' Blocking · ' + sharpness.demoted_blocking + ' Demoted'
        : sharpness.verified_blocking + ' Blocking'
    );

    document.getElementById('step-script').className = 'rail-step' + (isPlan ? ' active' : '');
    document.getElementById('step-mid').className = 'rail-step' + (isMid ? ' active' : '');
    document.getElementById('step-signoff').className = 'rail-step' + (isDone ? ' active' : '');

    document.getElementById('script-mode').textContent =
      partition.mode === 'parallel_batches' ? 'parallel' : 'isolated';
    document.getElementById('stat-agents').textContent = counts.completed_agents + '/' + counts.total_agents;
    document.getElementById('stat-ctx').textContent = counts.context_kb + 'k / 1.5k';

    const vivaldiProf = profiles.vivaldi || profiles.einstein || profiles.peter;
    if (vivaldiProf) {
      const vm = document.getElementById('viv-model');
      if (vm) vm.textContent = vivaldiProf.model;
      const ve = document.getElementById('viv-effort');
      if (ve) ve.textContent = vivaldiProf.reasoning_effort;
      const vt = document.getElementById('viv-tier');
      if (vt) vt.textContent = vivaldiProf.tier || state.tier;
    }

    const topModelEl = document.getElementById('top-model-text');
    if (topModelEl) topModelEl.textContent = profiles.peter.model;
    document.getElementById('top-effort-text').textContent = 'reasoning: ' + profiles.peter.reasoning_effort;
    document.getElementById('top-tier-flag').textContent = 'tier: ' + state.tier;

    const totalTraces =
      typeof board._simTraces === 'number'
        ? board._simTraces
        : counts.decisions + counts.acceptance_criteria + counts.constraints;
    document.getElementById('gate-traces').textContent = totalTraces;

    document.getElementById('bar-spec').style.width = Math.round(sharpness.spec_trace * 100) + '%';
    setHtml('lbl-spec', sharpness.spec_trace.toFixed(2) + ' <span class="c-muted">' + (sharpness.spec_trace >= 0.8 ? 'sharp' : 'split') + '</span>');

    document.getElementById('bar-build').style.width = Math.round(sharpness.build_scope * 100) + '%';
    setHtml('lbl-build', sharpness.build_scope.toFixed(2) + ' <span class="c-muted">' + (sharpness.build_scope >= 0.8 ? 'sharp' : 'split') + '</span>');

    document.getElementById('bar-review').style.width = Math.round(sharpness.review_filter * 100) + '%';
    setHtml('lbl-review', sharpness.review_filter.toFixed(2) + ' <span class="c-muted">' + (sharpness.review_filter >= 0.8 ? 'sharp' : 'split') + '</span>');

    const cardsRow = document.getElementById('cards-row');
    if (cardsRow && !cardsRow._mounted) {
      cardsRow._mounted = true;
      cardsRow.innerHTML = cards.map((c) => {
        const agents = c.agents || [];
        const agentRows = agents.map((ag, aIdx) =>
          '<div class="agent-item" id="ag-item-' + c.id + '-' + aIdx + '">' +
            '<div class="agent-item-top">' +
              '<span class="agent-name-wrap"><i class="status-dot" id="ag-dot-' + c.id + '-' + aIdx + '"></i>' + ag.name + '</span>' +
              '<span class="mono c-muted" id="ag-pct-' + c.id + '-' + aIdx + '">0%</span>' +
            '</div>' +
            '<div class="agent-role" id="ag-role-' + c.id + '-' + aIdx + '"></div>' +
            '<div class="agent-meta-row" id="ag-meta-' + c.id + '-' + aIdx + '"></div>' +
            '<div class="agent-mini-track"><div class="agent-mini-fill" id="ag-bar-' + c.id + '-' + aIdx + '" style="width:0%"></div></div>' +
            '<div class="agent-task" id="ag-task-' + c.id + '-' + aIdx + '"></div>' +
          '</div>'
        ).join('');

        return (
          '<div class="phase-card" id="pcard-' + c.id + '">' +
            '<div class="card-head" onclick="toggleGroup(\\'' + c.id + '\\')">' +
              '<div class="card-top-line">' +
                '<div class="card-title-group">' +
                  '<i class="status-dot" id="pcard-dot-' + c.id + '"></i>' +
                  '<span class="card-title">' + c.title + '</span>' +
                  '<span class="agent-count-pill">' + agents.length + (agents.length === 1 ? ' agent' : ' agents') + '</span>' +
                '</div>' +
                '<div class="card-right-meta">' +
                  '<span class="mono" id="pcard-pct-' + c.id + '">0%</span>' +
                  '<span class="chevron" id="pcard-chev-' + c.id + '">▾</span>' +
                '</div>' +
              '</div>' +
              '<div class="card-profile-line mono" id="pcard-prof-' + c.id + '"></div>' +
              '<div class="card-bar-track"><div class="card-bar-fill" id="pcard-bar-' + c.id + '" style="width:0%"></div></div>' +
              '<div class="card-summary-line">' +
                '<span id="pcard-detail-' + c.id + '"></span>' +
                '<span class="mono" id="pcard-badge-' + c.id + '"></span>' +
              '</div>' +
            '</div>' +
            '<div class="agent-drawer" id="pcard-drawer-' + c.id + '">' +
              agentRows +
            '</div>' +
          '</div>'
        );
      }).join('');
    }

    cards.forEach((c) => {
      const stateCls = c.state === 'active' ? ' active' : c.state === 'done' ? ' done' : '';
      const isOpen = Boolean(expandedGroups[c.id]);
      const cardEl = document.getElementById('pcard-' + c.id);
      if (cardEl) cardEl.className = 'phase-card' + stateCls;
      const dotEl = document.getElementById('pcard-dot-' + c.id);
      if (dotEl) dotEl.className = 'status-dot ' + dotClass(c.state);
      const pctEl = document.getElementById('pcard-pct-' + c.id);
      if (pctEl) pctEl.textContent = Math.round(c.pct) + '%';
      const chevEl = document.getElementById('pcard-chev-' + c.id);
      if (chevEl) chevEl.textContent = isOpen ? '▾' : '▸';
      const profEl = document.getElementById('pcard-prof-' + c.id);
      if (profEl) {
        setHtml(
          'pcard-prof-' + c.id,
          '<span class="c-blue">' + c.model + '</span> &middot; ' + c.effort + ' &middot; ' + (c.tier || state.tier)
        );
      }
      const barEl = document.getElementById('pcard-bar-' + c.id);
      if (barEl) barEl.style.width = Math.round(c.pct) + '%';
      const detEl = document.getElementById('pcard-detail-' + c.id);
      if (detEl) detEl.textContent = c.detail;
      const bdgEl = document.getElementById('pcard-badge-' + c.id);
      if (bdgEl) bdgEl.textContent = c.badge;
      const drwEl = document.getElementById('pcard-drawer-' + c.id);
      if (drwEl) drwEl.className = 'agent-drawer' + (isOpen ? '' : ' collapsed');

      (c.agents || []).forEach((ag, aIdx) => {
        const agCls = ag.state === 'active' ? ' active' : ag.state === 'done' ? ' done' : '';
        const agItem = document.getElementById('ag-item-' + c.id + '-' + aIdx);
        if (agItem) agItem.className = 'agent-item' + agCls;
        const agDot = document.getElementById('ag-dot-' + c.id + '-' + aIdx);
        if (agDot) agDot.className = 'status-dot ' + dotClass(ag.state);
        const agPct = document.getElementById('ag-pct-' + c.id + '-' + aIdx);
        if (agPct) agPct.textContent = Math.round(ag.pct) + '%';
        const agRole = document.getElementById('ag-role-' + c.id + '-' + aIdx);
        if (agRole) agRole.textContent = ag.role;
        const agMeta = document.getElementById('ag-meta-' + c.id + '-' + aIdx);
        if (agMeta) {
          setHtml(
            'ag-meta-' + c.id + '-' + aIdx,
            '<span class="meta-chip model mono">' + ag.model + '</span>' +
              '<span class="meta-chip mono">reasoning: ' + ag.effort + '</span>' +
              '<span class="meta-chip mono">tier: ' + (ag.tier || state.tier) + '</span>'
          );
        }
        const agBar = document.getElementById('ag-bar-' + c.id + '-' + aIdx);
        if (agBar) agBar.style.width = Math.round(ag.pct) + '%';
        const agTask = document.getElementById('ag-task-' + c.id + '-' + aIdx);
        if (agTask) agTask.textContent = ag.task;
      });
    });

    if (sharpness.submitted_blocking > 0) {
      setHtml(
        'bottom-summary',
        sharpness.verified_blocking + ' of ' + sharpness.submitted_blocking +
          ' blocking kept (' + sharpness.demoted_blocking + ' demoted)'
      );
    } else {
      setHtml('bottom-summary', state.next_action || 'All checks passed · Ready for review');
    }
    const vTag = document.getElementById('verdict-tag');
    if (vTag) vTag.textContent = sharpness.effective_verdict || 'APPROVE';

    const logs = session_log || [];
    const logHtml = logs.map((row, idx) =>
      '<div class="log-line' + (idx === logs.length - 1 ? ' latest' : '') + '">' +
        '<span class="c-muted mono">' + row.time + '</span>' +
        '<span class="mono" style="color:var(--text-main);font-weight:500">' + row.actor + '</span>' +
        '<span>' + row.text + '</span>' +
      '</div>'
    ).join('');
    setHtml('session-log', logHtml);

    setHtml('cmd-line', state.phase + ' · ' + (sharpness.effective_verdict || 'APPROVE'));

    applyStageVisuals(overrideStageKey || stageKeyFromPhase(state.phase, state.status));
  }

  function triggerSimulation() {
    if (simRafId) cancelAnimationFrame(simRafId);
    simActive = true;
    const btn = document.getElementById('sim-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Running...';
    }
    if (window.location && window.location.protocol.startsWith('http')) {
      fetch('/api/simulate', { method: 'POST' }).catch(() => {});
    }

    const totalAgents = currentBoard.counts.total_agents || 6;
    const allLogs = [
      { at: 0.1, time: '00:00.12', actor: 'vivaldi',    role: 'thinker',  text: 'Routing task to Plan group (Einstein + Peter)' },
      { at: 0.8, time: '00:00.84', actor: 'einstein',   role: 'thinker',  text: 'brief.md complete · synthesized decisions D1..D3' },
      { at: 2.1, time: '00:02.10', actor: 'peter',      role: 'thinker',  text: 'spec.md complete · locked AC1..AC3 + K1..K3 constraints' },
      { at: 3.1, time: '00:03.15', actor: 'control.js', role: 'gate',     text: 'validate-handoff plan=PASS · spec_trace=1.00' },
      { at: 4.1, time: '00:04.10', actor: 'linus',      role: 'builder',  text: 'Implementing 3 planned files in isolated builder lane' },
      { at: 5.5, time: '00:05.50', actor: 'control.js', role: 'gate',     text: 'verify-build PASS · 0 unplanned files · syntax clean' },
      { at: 6.5, time: '00:06.52', actor: 'cobalt',     role: 'verifier', text: 'Code review complete · 2 style notes demoted to minor' },
      { at: 7.3, time: '00:07.30', actor: 'sentinel',   role: 'verifier', text: 'Security audit complete · tenant scope & SQL verified' },
      { at: 8.2, time: '00:08.20', actor: 'ralph',      role: 'verifier', text: 'Test suite complete · 42 specs passing (94.2% coverage)' },
      { at: 9.1, time: '00:09.10', actor: 'vivaldi',    role: 'thinker',  text: 'Delivery sign-off · 0 blocking findings' }
    ];

    const startTs = performance.now();
    const durationSec = 10.2;

    function tickSim(now) {
      const t = (now - startTs) / 1000;
      const clamp01 = (v) => Math.max(0, Math.min(1, v));

      let phase = 'PLAN';
      let status = 'active';
      let stageKey = 'thinker';
      let doneAgents = 0;

      // Individual agent progress timelines
      const einsteinPct = Math.round(clamp01((t - 0.3) / 1.3) * 100);
      const peterPct = Math.round(clamp01((t - 1.5) / 1.7) * 100);
      const p0 = Math.round((einsteinPct + peterPct) / 2);

      const linusPct = Math.round(clamp01((t - 3.9) / 1.9) * 100);
      const p1 = linusPct;

      const cobaltPct = Math.round(clamp01((t - 6.3) / 1.6) * 100);
      const sentinelPct = Math.round(clamp01((t - 6.4) / 1.8) * 100);
      const ralphPct = Math.round(clamp01((t - 6.5) / 2.0) * 100);
      const p2 = Math.round((cobaltPct + sentinelPct + ralphPct) / 3);

      doneAgents =
        (einsteinPct >= 100 ? 1 : 0) +
        (peterPct >= 100 ? 1 : 0) +
        (linusPct >= 100 ? 1 : 0) +
        (cobaltPct >= 100 ? 1 : 0) +
        (sentinelPct >= 100 ? 1 : 0) +
        (ralphPct >= 100 ? 1 : 0);

      const sSpec = Number(clamp01((t - 0.6) / 2.2).toFixed(2));
      const sBuild = Number(clamp01((t - 3.9) / 1.9).toFixed(2));
      const sRev = Number((t < 6.3 ? 0.0 : clamp01((t - 6.3) / 2.1)).toFixed(2));

      if (t < 1.3) {
        phase = 'DELIBERATE';
        stageKey = 'thinker';
      } else if (t < 3.3) {
        phase = 'PLAN';
        stageKey = 'gate-to-plan';
      } else if (t < 3.9) {
        phase = 'BUILD';
        stageKey = 'plan-handoff';
      } else if (t < 5.8) {
        phase = 'BUILD';
        stageKey = 'plan-to-build';
      } else if (t < 6.4) {
        phase = 'REVIEW';
        stageKey = 'build-handoff';
      } else if (t < 8.5) {
        phase = 'REVIEW';
        stageKey = 'build-to-verify';
      } else if (t < 9.0) {
        phase = 'TEST';
        stageKey = 'verify-handoff';
      } else {
        phase = 'DELIVER';
        status = 'complete';
        stageKey = 'signoff';
      }

      currentBoard.state.phase = phase;
      currentBoard.state.status = status;
      currentBoard.counts.completed_agents = doneAgents;
      currentBoard._simTraces = Math.round(clamp01(t / 2.5) * 9);
      currentBoard.sharpness.spec_trace = sSpec;
      currentBoard.sharpness.build_scope = sBuild;
      currentBoard.sharpness.review_filter = sRev;
      currentBoard.sharpness.overall = Number(((sSpec + sBuild + sRev) / 3).toFixed(2));
      currentBoard.sharpness.label = currentBoard.sharpness.overall >= 0.8 ? 'sharp' : 'split';
      currentBoard.sharpness.submitted_blocking = t >= 6.5 ? 2 : 0;
      currentBoard.sharpness.verified_blocking = 0;
      currentBoard.sharpness.demoted_blocking = t >= 7.8 ? 2 : t >= 7.1 ? 1 : 0;

      // Update Plan card + Einstein & Peter
      const planCard = currentBoard.cards[0];
      if (planCard) {
        planCard.pct = p0;
        planCard.state = p0 >= 100 ? 'done' : p0 > 0 ? 'active' : 'queued';
        planCard.badge = p0 >= 100 ? 'Done' : peterPct > 0 ? 'Peter' : 'Einstein';
        if (planCard.agents && planCard.agents[0]) {
          planCard.agents[0].pct = einsteinPct;
          planCard.agents[0].state = einsteinPct >= 100 ? 'done' : einsteinPct > 0 ? 'active' : 'queued';
          planCard.agents[0].task = einsteinPct >= 100
            ? 'brief.md · D1..D3 decisions locked'
            : 'Synthesizing domain context & D1..D3';
        }
        if (planCard.agents && planCard.agents[1]) {
          planCard.agents[1].pct = peterPct;
          planCard.agents[1].state = peterPct >= 100 ? 'done' : peterPct > 0 ? 'active' : 'queued';
          planCard.agents[1].task = peterPct >= 100
            ? 'spec.md · AC1..AC3 + K1..K3 locked'
            : peterPct > 0
              ? 'Compiling AC1..AC3 & K1..K3 constraints'
              : 'Waiting on Einstein brief.md';
        }
      }

      // Update Build card + Linus
      const buildCard = currentBoard.cards[1];
      if (buildCard) {
        const inTransit = t >= 3.4 && t < 3.9;
        buildCard.pct = p1;
        buildCard.state = p1 >= 100 ? 'done' : p1 > 0 || inTransit ? 'active' : 'queued';
        const filesDone = Math.max(1, Math.ceil((p1 / 100) * 3));
        buildCard.badge = p1 >= 100 ? 'Done' : inTransit ? 'Receiving' : p1 > 0 ? filesDone + '/3 files' : 'Queued';
        if (buildCard.agents && buildCard.agents[0]) {
          buildCard.agents[0].pct = linusPct;
          buildCard.agents[0].state = linusPct >= 100 ? 'done' : linusPct > 0 || inTransit ? 'active' : 'queued';
          buildCard.agents[0].task = linusPct >= 100
            ? 'build.md · 3 files patched & syntax clean'
            : linusPct > 0
              ? 'Patching file ' + filesDone + ' of 3 against K1..K3'
              : 'Queued for spec gate';
        }
      }

      // Update Verify card + Cobalt, Sentinel, Ralph
      const verifyCard = currentBoard.cards[2];
      if (verifyCard) {
        const inTransit = t >= 5.9 && t < 6.3;
        verifyCard.pct = p2;
        verifyCard.state = p2 >= 100 ? 'done' : p2 > 0 || inTransit ? 'active' : 'queued';
        const vDone = (cobaltPct >= 100 ? 1 : 0) + (sentinelPct >= 100 ? 1 : 0) + (ralphPct >= 100 ? 1 : 0);
        verifyCard.badge = p2 >= 100 ? 'Done' : inTransit ? 'Receiving' : p2 > 0 ? vDone + '/3 done' : 'Queued';
        if (verifyCard.agents && verifyCard.agents[0]) {
          verifyCard.agents[0].pct = cobaltPct;
          verifyCard.agents[0].state = cobaltPct >= 100 ? 'done' : cobaltPct > 0 ? 'active' : 'queued';
          verifyCard.agents[0].task = cobaltPct >= 100
            ? 'review.md · 0 blocking, 2 style notes demoted'
            : cobaltPct > 0
              ? 'Checking diff against AC1..AC3 & K1..K3'
              : 'Queued';
        }
        if (verifyCard.agents && verifyCard.agents[1]) {
          verifyCard.agents[1].pct = sentinelPct;
          verifyCard.agents[1].state = sentinelPct >= 100 ? 'done' : sentinelPct > 0 ? 'active' : 'queued';
          verifyCard.agents[1].task = sentinelPct >= 100
            ? 'Tenant scope & BigDecimal invariants verified'
            : sentinelPct > 0
              ? 'Auditing sensitive payment surface'
              : 'Queued';
        }
        if (verifyCard.agents && verifyCard.agents[2]) {
          verifyCard.agents[2].pct = ralphPct;
          verifyCard.agents[2].state = ralphPct >= 100 ? 'done' : ralphPct > 0 ? 'active' : 'queued';
          verifyCard.agents[2].task = ralphPct >= 100
            ? 'tests.md · 42 specs passing (94.2%)'
            : ralphPct > 0
              ? 'Running payment_executor_spec.rb'
              : 'Queued';
        }
      }

      currentBoard.session_log = allLogs.filter((l) => l.at <= t).slice(-6);
      render(currentBoard, stageKey);

      if (t < durationSec) {
        simRafId = requestAnimationFrame(tickSim);
      } else {
        simActive = false;
        delete currentBoard._simTraces;
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Simulate Run';
        }
      }
    }

    simRafId = requestAnimationFrame(tickSim);
  }

  function syncSvgGeometry() {
    const svgTop = document.getElementById('svg-thinker-gate');
    const svgOut = document.getElementById('svg-fanout');
    const svgIn = document.getElementById('svg-fanin');
    const cardsRow = document.getElementById('cards-row');
    const cards = ['plan', 'build', 'verify'].map((id) => document.getElementById('pcard-' + id));
    if (!svgOut || !svgIn || !cardsRow || cards.some((c) => !c)) return;

    const W = Math.round(cardsRow.clientWidth || svgOut.clientWidth);
    if (W <= 0) return;

    const cx = Number((W / 2).toFixed(1));

    if (svgTop) {
      svgTop.setAttribute('viewBox', '0 0 ' + W + ' 20');
      const pTop = document.getElementById('path-thinker-gate');
      if (pTop) pTop.setAttribute('d', 'M ' + cx + ' 1 L ' + cx + ' 16');
      const arrTop = document.getElementById('arr-thinker-gate');
      if (arrTop) arrTop.setAttribute('points', (cx - 3.5).toFixed(1) + ',14 ' + cx.toFixed(1) + ',20 ' + (cx + 3.5).toFixed(1) + ',14');
    }

    svgOut.setAttribute('viewBox', '0 0 ' + W + ' 26');
    svgIn.setAttribute('viewBox', '0 0 ' + W + ' 28');

    const rowH = cardsRow.offsetHeight;
    const xs = cards.map((c) => Number((c.offsetLeft + c.offsetWidth / 2).toFixed(1)));
    const ysIn = cards.map((c) => Number(Math.min(0, c.offsetTop + c.offsetHeight - rowH).toFixed(1)));

    const dOut0 = 'M ' + cx + ' 0 L ' + cx + ' 13 L ' + xs[0] + ' 13 L ' + xs[0] + ' 22';
    const dOut1 = 'M ' + cx + ' 0 L ' + cx + ' 13 L ' + xs[1] + ' 13 L ' + xs[1] + ' 22';
    const dOut2 = 'M ' + cx + ' 0 L ' + cx + ' 13 L ' + xs[2] + ' 13 L ' + xs[2] + ' 22';
    ['track-fanout-0', 'path-fanout-0'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.setAttribute('d', dOut0);
    });
    ['track-fanout-1', 'path-fanout-1'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.setAttribute('d', dOut1);
    });
    ['track-fanout-2', 'path-fanout-2'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.setAttribute('d', dOut2);
    });
    xs.forEach((xn, idx) => {
      const arr = document.getElementById('arr-fanout-' + idx);
      if (arr) arr.setAttribute('points', (xn - 3.5).toFixed(1) + ',20 ' + xn.toFixed(1) + ',26 ' + (xn + 3.5).toFixed(1) + ',20');
    });

    const dIn0 = 'M ' + xs[0] + ' ' + ysIn[0] + ' L ' + xs[0] + ' 14 L ' + cx + ' 14 L ' + cx + ' 24';
    const dIn1 = 'M ' + xs[1] + ' ' + ysIn[1] + ' L ' + xs[1] + ' 14 L ' + cx + ' 14 L ' + cx + ' 24';
    const dIn2 = 'M ' + xs[2] + ' ' + ysIn[2] + ' L ' + xs[2] + ' 14 L ' + cx + ' 14 L ' + cx + ' 24';
    ['track-fanin-0', 'path-fanin-0'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.setAttribute('d', dIn0);
    });
    ['track-fanin-1', 'path-fanin-1'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.setAttribute('d', dIn1);
    });
    ['track-fanin-2', 'path-fanin-2'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.setAttribute('d', dIn2);
    });
    const arrIn = document.getElementById('arr-fanin');
    if (arrIn) {
      arrIn.setAttribute('points', (cx - 3.5).toFixed(1) + ',22 ' + cx.toFixed(1) + ',28 ' + (cx + 3.5).toFixed(1) + ',22');
    }
  }

  function fitViewport() {
    const winEl = document.querySelector('.window');
    if (!winEl) return;
    const avail = Math.max(240, window.innerWidth - 16);
    const scale = avail < 460 ? Math.max(0.55, avail / 460) : 1;
    winEl.style.zoom = String(scale);
    requestAnimationFrame(syncSvgGeometry);
  }
  window.addEventListener('resize', fitViewport);
  initCometDom();
  updateExpandBtnLabel();
  render(currentBoard);
  fitViewport();
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => requestAnimationFrame(syncSvgGeometry));
    const cr = document.getElementById('cards-row');
    if (cr) ro.observe(cr);
  }
  requestAnimationFrame(stepComets);

  setTimeout(() => {
    triggerSimulation();
  }, 250);

  if (typeof EventSource !== 'undefined' && window.location && window.location.protocol.startsWith('http')) {
    const es = new EventSource('/api/events');
    es.addEventListener('board', (ev) => {
      if (simActive) return;
      try {
        currentBoard = JSON.parse(ev.data);
        render(currentBoard);
      } catch (e) {}
    });
  }
</script>
</body>
</html>`;
}

function renderBoard(projectDirectory, options = {}) {
  const format = options.format || 'ascii';
  const board = inspectProjectBoard(projectDirectory, options);
  if (format === 'json') {
    return `${JSON.stringify(board)}\n`;
  }
  if (format === 'markdown') {
    return renderMarkdownBoard(board);
  }
  if (format === 'html') {
    return renderHtmlDashboard(board);
  }
  if (format === 'ansi') {
    return renderAnsiBoard(board);
  }
  if (format === 'ascii') {
    return renderAsciiBoard(board);
  }
  throw new Error(`Unknown board format: ${format}`);
}

function runLiveSimulationOnDisk(projectDirectory) {
  const slug = path.basename(projectDirectory);
  const brief = [
    '## Decision Table',
    '| ID | Decision | Rationale |',
    '|----|----------|-----------|',
    '| D1 | Scope payment queries to authenticated tenant. | Prevent cross-tenant IDOR. |',
    '| D2 | Compute monetary totals using BigDecimal. | Eliminate IEEE-754 float drift. |',
    '| D3 | Enforce idempotency keys on payment mutations. | Prevent double-charge on retry. |',
    '',
  ].join('\n');

  const spec = [
    '## Summary',
    'Tenant-scoped, idempotent payment execution service.',
    '',
    '## Architecture',
    'Implements D1, D2, and D3 across the payment controller and service boundaries.',
    '',
    '## File Plan (file path + one-line change description each)',
    '- `app/services/payment_executor.rb` — Tenant-scoped BigDecimal execution',
    '- `app/controllers/payments_controller.rb` — Idempotency key guard',
    '- `spec/services/payment_executor_spec.rb` — Regression coverage for AC1-AC3',
    '',
    '## Acceptance Criteria',
    '1. (AC1 ← D1) Queries scope Payment records by current_tenant.id.',
    '2. (AC2 ← D2) Monetary totals use BigDecimal with bankers rounding.',
    '3. (AC3 ← D3) Duplicate idempotency_key returns cached settlement.',
    '',
    '## Constraints',
    '1. (K1 ← D1) MUST NOT query Payment by bare id without tenant scope.',
    '2. (K2 ← D2) MUST NOT call to_f on invoice or payment amounts.',
    '3. (K3 ← D3) MUST NOT mutate settlement state outside a DB transaction lock.',
    '',
    '## Edge Cases',
    '1. Concurrent retry with identical idempotency_key waits on row lock.',
    '',
    '## Sensitive Surface',
    '- payments/money-math — `app/services/payment_executor.rb`',
    '',
  ].join('\n');

  const build = [
    '## Changelist',
    '- `app/services/payment_executor.rb` (AC1, AC2, K1, K2, K3 ← D1, D2, D3) — Tenant-scoped BigDecimal payment execution.',
    '- `app/controllers/payments_controller.rb` (AC3 ← D3) — Enforces idempotency header.',
    '- `spec/services/payment_executor_spec.rb` (AC1, AC2, AC3) — Covers tenant isolation and idempotency.',
    '',
  ].join('\n');

  const reviewWithNitpicks = [
    '## Lint Check',
    'Reused Linus clean rubocop_changed_lines output.',
    '',
    '## Coverage Check',
    'Delegated to parallel Ralph verification (94.2%).',
    '',
    '## Verdict: REQUEST_CHANGES',
    '',
    '## Findings',
    '1. **[MAJOR]** — Style preference — `app/services/payment_executor.rb`',
    '   Consider renaming `execute_payment` to `perform_payment_settlement` for stylistic consistency.',
    '',
    '2. **[MAJOR]** — Subjective helper extraction — `app/controllers/payments_controller.rb`',
    '   Extract header lookup into a private helper method.',
    '',
    '## Summary',
    'Two ungrounded stylistic suggestions that validate-review deterministically demotes to MINOR -> APPROVE.',
    '',
  ].join('\n');

  const writeState = (phase, status, nextAction, artifacts) => {
    fs.writeFileSync(
      path.join(projectDirectory, 'project.json'),
      `${JSON.stringify(
        {
          schema_version: 1,
          slug,
          title: slug.replaceAll('-', ' '),
          tier: 'standard_ambiguous',
          status,
          phase,
          updated_at: new Date().toISOString(),
          next_action: nextAction,
          unresolved_questions: [],
          artifacts,
        },
        null,
        2
      )}\n`
    );
  };

  fs.mkdirSync(projectDirectory, { recursive: true });
  fs.writeFileSync(path.join(projectDirectory, 'CONTEXT.md'), `# ${slug}\n`);
  fs.writeFileSync(path.join(projectDirectory, 'brief.md'), brief);
  writeState('PLAN', 'active', 'Peter compiling spec.md with AC# and K# constraints', {
    context: 'CONTEXT.md',
    brief: 'brief.md',
  });

  setTimeout(() => {
    fs.writeFileSync(path.join(projectDirectory, 'spec.md'), spec);
    fs.writeFileSync(
      path.join(projectDirectory, 'gate-plan.json'),
      `${JSON.stringify(validateHandoff({ brief, spec }))}\n`
    );
    writeState('BUILD', 'active', 'Linus implementing 3 files in isolated builder lane', {
      context: 'CONTEXT.md',
      brief: 'brief.md',
      spec: 'spec.md',
      gate_plan: 'gate-plan.json',
    });
  }, 1500);

  setTimeout(() => {
    fs.writeFileSync(path.join(projectDirectory, 'build.md'), build);
    fs.writeFileSync(
      path.join(projectDirectory, 'gate-build.json'),
      `${JSON.stringify(validateHandoff({ brief, spec, build }))}\n`
    );
    writeState('REVIEW', 'active', 'Parallel verify wave: Cobalt || Sentinel || Ralph', {
      context: 'CONTEXT.md',
      brief: 'brief.md',
      spec: 'spec.md',
      gate_plan: 'gate-plan.json',
      build: 'build.md',
      gate_build: 'gate-build.json',
    });
  }, 3200);

  setTimeout(() => {
    fs.writeFileSync(path.join(projectDirectory, 'review.md'), reviewWithNitpicks);
    fs.writeFileSync(path.join(projectDirectory, 'tests.md'), '## Verdict: ALL_PASS\n');
    writeState('TEST', 'active', 'validate-review demoted 2/2 unprovable nitpicks -> APPROVE', {
      context: 'CONTEXT.md',
      brief: 'brief.md',
      spec: 'spec.md',
      gate_plan: 'gate-plan.json',
      build: 'build.md',
      gate_build: 'gate-build.json',
      review: 'review.md',
      tests: 'tests.md',
    });
  }, 4800);

  setTimeout(() => {
    writeState('DELIVER', 'complete', null, {
      context: 'CONTEXT.md',
      brief: 'brief.md',
      spec: 'spec.md',
      gate_plan: 'gate-plan.json',
      build: 'build.md',
      gate_build: 'gate-build.json',
      review: 'review.md',
      tests: 'tests.md',
    });
  }, 6200);
}

function serveBoard({ projectDirectory, workspaceRoot, repoRoot, harness, port = 4100 }) {
  const resolvedProjectDir = path.resolve(projectDirectory);
  if (!fs.existsSync(path.join(resolvedProjectDir, 'project.json'))) {
    runLiveSimulationOnDisk(resolvedProjectDir);
  }

  const clients = new Set();
  const broadcast = () => {
    let payload;
    try {
      payload = JSON.stringify(
        inspectProjectBoard(resolvedProjectDir, { workspaceRoot, repoRoot, harness })
      );
    } catch {
      return;
    }
    for (const res of clients) {
      res.write(`event: board\ndata: ${payload}\n\n`);
    }
  };

  let debounceTimer = null;
  const watcher = fs.watch(resolvedProjectDir, () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(broadcast, 25);
  });

  const server = http.createServer((req, res) => {
    if (req.url === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (req.url === '/api/board') {
      const board = inspectProjectBoard(resolvedProjectDir, { workspaceRoot, repoRoot, harness });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(board));
      return;
    }

    if (req.url === '/api/simulate' && req.method === 'POST') {
      runLiveSimulationOnDisk(resolvedProjectDir);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    const board = inspectProjectBoard(resolvedProjectDir, { workspaceRoot, repoRoot, harness });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderHtmlDashboard(board));
  });

  server.on('close', () => watcher.close());
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(Number(port), '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        port: address.port,
        url: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

function uiConfigPaths({ workspaceRoot, env = process.env, homedir = os.homedir() } = {}) {
  const xdg =
    env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim() !== ''
      ? env.XDG_CONFIG_HOME
      : path.join(homedir, '.config');
  return {
    workspace: workspaceRoot ? path.join(workspaceRoot, '.10x-squad', 'ui.json') : null,
    global: path.join(xdg, '10x-squad', 'ui.json'),
  };
}

function readUiConfigFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed && typeof parsed === 'object' && typeof parsed.enabled === 'boolean') {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function getUiConfig({ workspaceRoot, env, homedir } = {}) {
  const paths = uiConfigPaths({ workspaceRoot, env, homedir });
  const wsCfg = readUiConfigFile(paths.workspace);
  if (wsCfg) {
    return {
      ok: true,
      enabled: wsCfg.enabled,
      auto_open: wsCfg.auto_open !== false && wsCfg.enabled,
      scope: 'workspace',
      path: paths.workspace,
      updated_at: wsCfg.updated_at || null,
    };
  }
  const globCfg = readUiConfigFile(paths.global);
  if (globCfg) {
    return {
      ok: true,
      enabled: globCfg.enabled,
      auto_open: globCfg.auto_open !== false && globCfg.enabled,
      scope: 'global',
      path: paths.global,
      updated_at: globCfg.updated_at || null,
    };
  }
  return {
    ok: true,
    enabled: true,
    auto_open: true,
    scope: 'default',
    path: paths.global,
    updated_at: null,
  };
}

function syncProjectDashboard(projectDirectory, options = {}) {
  const ui = getUiConfig({
    workspaceRoot: options.workspaceRoot,
    env: options.env,
    homedir: options.homedir,
  });
  if (!ui.enabled) {
    return {
      enabled: false,
      auto_open: false,
      scope: ui.scope,
      dashboard_path: null,
    };
  }
  const resolvedProjectDir = path.resolve(projectDirectory);
  const statePath = path.join(resolvedProjectDir, 'project.json');
  if (!fs.existsSync(statePath)) {
    return {
      enabled: true,
      auto_open: ui.auto_open,
      scope: ui.scope,
      dashboard_path: null,
    };
  }
  const dashboardPath = path.join(resolvedProjectDir, 'dashboard.html');
  const html = renderBoard(resolvedProjectDir, {
    format: 'html',
    workspaceRoot: options.workspaceRoot,
    repoRoot: options.repoRoot,
    harness: options.harness,
  });
  fs.writeFileSync(dashboardPath, html);
  return {
    enabled: true,
    auto_open: ui.auto_open,
    scope: ui.scope,
    dashboard_path: dashboardPath,
  };
}

function toggleUi({
  mode = 'toggle',
  scope = 'global',
  workspaceRoot,
  projectDirectory,
  harness,
  repoRoot,
  env,
  homedir,
} = {}) {
  const current = getUiConfig({ workspaceRoot, env, homedir });
  if (mode === 'status') {
    const sync = projectDirectory
      ? syncProjectDashboard(projectDirectory, { workspaceRoot, repoRoot, harness, env, homedir })
      : null;
    return {
      ...current,
      dashboard_path: sync ? sync.dashboard_path : null,
    };
  }

  let nextEnabled;
  if (mode === 'on' || mode === 'enable' || mode === 'true') {
    nextEnabled = true;
  } else if (mode === 'off' || mode === 'disable' || mode === 'false') {
    nextEnabled = false;
  } else if (mode === 'toggle') {
    nextEnabled = !current.enabled;
  } else {
    throw new Error(`Invalid toggle-ui mode: ${mode}. Expected on, off, toggle, or status.`);
  }

  const paths = uiConfigPaths({ workspaceRoot, env, homedir });
  const targetScope = scope === 'workspace' ? 'workspace' : 'global';
  const targetPath = targetScope === 'workspace' ? paths.workspace : paths.global;
  if (!targetPath) {
    throw new Error('workspaceRoot is required when scope is "workspace".');
  }

  const updatedAt = new Date().toISOString();
  const payload = {
    schema_version: 1,
    enabled: nextEnabled,
    auto_open: nextEnabled,
    updated_at: updatedAt,
  };
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`);

  let dashboardPath = null;
  if (nextEnabled && projectDirectory) {
    const sync = syncProjectDashboard(projectDirectory, {
      workspaceRoot,
      repoRoot,
      harness,
      env,
      homedir,
    });
    dashboardPath = sync.dashboard_path;
  }

  return {
    ok: true,
    enabled: nextEnabled,
    auto_open: nextEnabled,
    scope: targetScope,
    path: targetPath,
    updated_at: updatedAt,
    dashboard_path: dashboardPath,
  };
}

module.exports = {
  computeSharpness,
  getUiConfig,
  inspectProjectBoard,
  renderAnsiBoard,
  renderAsciiBoard,
  renderBoard,
  renderHtmlDashboard,
  renderMarkdownBoard,
  runLiveSimulationOnDisk,
  serveBoard,
  syncProjectDashboard,
  toggleUi,
  uiConfigPaths,
};
