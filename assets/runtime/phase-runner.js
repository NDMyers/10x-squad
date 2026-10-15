'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateHandoff } = require('./handoff-validator');
const { validateReview } = require('./review-validator');
const { partitionFilePlan, verifyBuild } = require('./build-verifier');
const { generateRegistry, transitionProject } = require('./project-state');
const { inspectProjectBoard, syncProjectDashboard } = require('./workflow-board');

function nextTimestamp(previousIso) {
  const now = Date.now();
  const prev = Date.parse(previousIso);
  const targetMs = Number.isFinite(prev) && now <= prev ? prev + 1000 : now;
  return new Date(targetMs).toISOString();
}

function defaultNextAction(targetPhase, tier, sensitiveSurface) {
  if (targetPhase === 'PLAN') {
    return 'Dispatch Peter to produce spec.md.';
  }
  if (targetPhase === 'BUILD') {
    return 'Dispatch Linus with the validated spec contract.';
  }
  if (targetPhase === 'REVIEW') {
    const verifiers = sensitiveSurface || tier === 'complex'
      ? 'Cobalt, Sentinel, and Ralph'
      : 'Cobalt and Ralph';
    return `Dispatch ${verifiers} in the verification wave.`;
  }
  if (targetPhase === 'TEST') {
    return 'Verify Ralph test execution results.';
  }
  if (targetPhase === 'DELIVER') {
    return null;
  }
  return `Advance pipeline in ${targetPhase}.`;
}

function readProjectFileIfPresent(projectDirectory, filename) {
  const candidate = path.join(projectDirectory, filename);
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    return undefined;
  }
  return fs.readFileSync(candidate, 'utf8');
}

function personasForPhase(targetPhase, tier, sensitiveSurface) {
  if (targetPhase === 'DELIBERATE') return ['einstein'];
  if (targetPhase === 'PLAN') return ['peter'];
  if (targetPhase === 'BUILD') return ['linus'];
  if (targetPhase === 'REVIEW') {
    const list = ['cobalt'];
    if (sensitiveSurface || tier === 'complex') {
      list.push('sentinel');
    }
    if (!['trivial', 'lite'].includes(tier)) {
      list.push('ralph');
    }
    return list;
  }
  if (targetPhase === 'TEST') return ['ralph'];
  return [];
}

function resolveNextDispatches({ workspaceRoot, harness, tier, personas }) {
  if (!harness || personas.length === 0) {
    return undefined;
  }

  let modelTierConfig;
  try {
    modelTierConfig = require('../skills/10x-squad-configure-tiers/scripts/model-tier-config');
  } catch {
    const fallbackPath = workspaceRoot
      ? path.join(workspaceRoot, '.github', 'skills', '10x-squad-configure-tiers', 'scripts', 'model-tier-config.js')
      : null;
    if (fallbackPath && fs.existsSync(fallbackPath)) {
      modelTierConfig = require(fallbackPath);
    }
  }

  if (!modelTierConfig || typeof modelTierConfig.resolveEffectiveProfile !== 'function') {
    return undefined;
  }

  const dispatches = [];
  for (const persona of personas) {
    const resolved = modelTierConfig.resolveEffectiveProfile({
      workspaceRoot: workspaceRoot || process.cwd(),
      harness,
      tier,
      persona,
    });
    if (!resolved.ok) {
      return {
        ok: false,
        persona,
        code: resolved.code,
        errors: resolved.errors,
      };
    }
    dispatches.push(resolved.result);
  }
  return { ok: true, profiles: dispatches };
}

function advancePhase({
  projectDirectory,
  targetPhase,
  nextAction,
  repoRoot,
  workspaceRoot,
  harness,
  enforceFilePlan = false,
}) {
  const resolvedProjectDir = path.resolve(projectDirectory);
  const statePath = path.join(resolvedProjectDir, 'project.json');
  if (!fs.existsSync(statePath)) {
    return {
      ok: false,
      errors: [{ code: 'MISSING_PROJECT_STATE_FILE' }],
    };
  }

  const currentState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const nextArtifacts = { ...(currentState.artifacts || {}) };
  const usesBrief = ['standard_ambiguous', 'complex'].includes(currentState.tier);
  const brief = usesBrief ? readProjectFileIfPresent(resolvedProjectDir, nextArtifacts.brief || 'brief.md') : undefined;
  const spec = readProjectFileIfPresent(resolvedProjectDir, nextArtifacts.spec || 'spec.md');
  const build = readProjectFileIfPresent(resolvedProjectDir, nextArtifacts.build || 'build.md');
  const review = readProjectFileIfPresent(resolvedProjectDir, nextArtifacts.review || 'review.md');
  const sentinelReview = readProjectFileIfPresent(
    resolvedProjectDir,
    nextArtifacts.sentinel_review || 'sentinel-review.md'
  );
  const previousReview = readProjectFileIfPresent(
    resolvedProjectDir,
    nextArtifacts.previous_review || 'review-cycle1.md'
  );

  let gateResult = null;
  let buildVerification = null;
  let builderPartition = null;
  let reviewValidation = null;

  if (usesBrief && brief !== undefined && !nextArtifacts.brief) {
    nextArtifacts.brief = 'brief.md';
  }

  // Gate 1: PLAN -> BUILD (or re-validating spec)
  if (targetPhase === 'BUILD' && currentState.phase === 'PLAN') {
    if (spec === undefined) {
      return {
        ok: false,
        errors: [{ code: 'MISSING_SPEC_ARTIFACT', message: 'spec.md must exist before advancing PLAN -> BUILD' }],
      };
    }
    nextArtifacts.spec = nextArtifacts.spec || 'spec.md';
    gateResult = validateHandoff({ brief, spec });
    const gatePlanPath = path.join(resolvedProjectDir, nextArtifacts.gate_plan || 'gate-plan.json');
    fs.writeFileSync(gatePlanPath, `${JSON.stringify(gateResult)}\n`);
    nextArtifacts.gate_plan = nextArtifacts.gate_plan || 'gate-plan.json';
    if (!gateResult.ok) {
      return {
        ok: false,
        phase: currentState.phase,
        target_phase: targetPhase,
        gate_result: gateResult,
        errors: gateResult.errors,
      };
    }
    builderPartition = partitionFilePlan({ spec, repoRoot });
  }

  // Gate 2: BUILD -> REVIEW
  if (targetPhase === 'REVIEW' && currentState.phase === 'BUILD') {
    if (spec === undefined || build === undefined) {
      return {
        ok: false,
        errors: [{ code: 'MISSING_BUILD_ARTIFACTS', message: 'spec.md and build.md must exist before advancing BUILD -> REVIEW' }],
      };
    }
    nextArtifacts.spec = nextArtifacts.spec || 'spec.md';
    nextArtifacts.build = nextArtifacts.build || 'build.md';
    gateResult = validateHandoff({ brief, spec, build });
    const gateBuildPath = path.join(resolvedProjectDir, nextArtifacts.gate_build || 'gate-build.json');
    fs.writeFileSync(gateBuildPath, `${JSON.stringify(gateResult)}\n`);
    nextArtifacts.gate_build = nextArtifacts.gate_build || 'gate-build.json';
    if (!gateResult.ok) {
      return {
        ok: false,
        phase: currentState.phase,
        target_phase: targetPhase,
        gate_result: gateResult,
        errors: gateResult.errors,
      };
    }

    buildVerification = verifyBuild({ spec, build, repoRoot, enforceFilePlan });
    fs.writeFileSync(
      path.join(resolvedProjectDir, 'gate-verify-build.json'),
      `${JSON.stringify(buildVerification)}\n`
    );
    if (!buildVerification.ok) {
      return {
        ok: false,
        phase: currentState.phase,
        target_phase: targetPhase,
        gate_result: gateResult,
        build_verification: buildVerification,
        errors: buildVerification.errors,
      };
    }
  }

  // Gate 3: Leaving REVIEW -> TEST / DELIVER / BUILD / PLAN
  if (currentState.phase === 'REVIEW') {
    if (review === undefined) {
      return {
        ok: false,
        errors: [{ code: 'MISSING_REVIEW_ARTIFACT', message: 'review.md must exist before advancing from REVIEW' }],
      };
    }
    nextArtifacts.review = nextArtifacts.review || 'review.md';
    if (spec !== undefined) {
      reviewValidation = validateReview({ spec, review, sentinelReview, previousReview });
      fs.writeFileSync(
        path.join(resolvedProjectDir, 'gate-review.json'),
        `${JSON.stringify(reviewValidation)}\n`
      );
      if (!reviewValidation.ok) {
        return {
          ok: false,
          phase: currentState.phase,
          target_phase: targetPhase,
          review_validation: reviewValidation,
          errors: reviewValidation.errors,
        };
      }
    }
  }

  if (targetPhase === 'DELIVER') {
    if (readProjectFileIfPresent(resolvedProjectDir, nextArtifacts.tests || 'tests.md') !== undefined) {
      nextArtifacts.tests = nextArtifacts.tests || 'tests.md';
    }
  }

  const sensitiveSurface = spec ? /##\s+Sensitive Surface\b/.test(spec) : false;
  const isDeliver = targetPhase === 'DELIVER';
  const proposedState = {
    ...currentState,
    phase: targetPhase,
    status: isDeliver ? 'complete' : 'active',
    updated_at: nextTimestamp(currentState.updated_at),
    next_action: isDeliver
      ? null
      : (nextAction || defaultNextAction(targetPhase, currentState.tier, sensitiveSurface)),
    artifacts: nextArtifacts,
  };

  const transition = transitionProject(resolvedProjectDir, proposedState, currentState.updated_at);
  if (!transition.ok) {
    return transition;
  }

  // Auto-update PROJECTS.md if the project lives inside a standard projects/ directory
  const projectsRoot = path.dirname(resolvedProjectDir);
  const artifactsRoot = path.dirname(projectsRoot);
  let registryUpdated = false;
  if (path.basename(projectsRoot) === 'projects') {
    const registryPath = path.join(artifactsRoot, 'PROJECTS.md');
    const existingRegistry = fs.existsSync(registryPath) ? fs.readFileSync(registryPath, 'utf8') : '';
    fs.writeFileSync(registryPath, generateRegistry(projectsRoot, existingRegistry));
    registryUpdated = true;
  }

  const nextPersonas = personasForPhase(targetPhase, currentState.tier, sensitiveSurface);
  const nextDispatches = resolveNextDispatches({
    workspaceRoot,
    harness,
    tier: currentState.tier,
    personas: nextPersonas,
  });

  let boardSummary = null;
  let uiSync = null;
  try {
    boardSummary = inspectProjectBoard(resolvedProjectDir).sharpness;
    uiSync = syncProjectDashboard(resolvedProjectDir, { workspaceRoot, repoRoot, harness });
  } catch {
    boardSummary = null;
  }

  return {
    ok: true,
    previous_phase: transition.previous_phase,
    phase: transition.state.phase,
    status: transition.state.status,
    updated_at: transition.state.updated_at,
    registry_updated: registryUpdated,
    gate_result: gateResult,
    build_verification: buildVerification,
    builder_partition: builderPartition,
    review_validation: reviewValidation,
    next_personas: nextPersonas,
    next_dispatches: nextDispatches,
    sharpness: boardSummary,
    ui: uiSync,
    state: transition.state,
    errors: [],
  };
}

module.exports = {
  advancePhase,
  personasForPhase,
};
