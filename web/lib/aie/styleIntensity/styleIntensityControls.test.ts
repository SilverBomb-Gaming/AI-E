import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGovernedStyleIntensityControlsState,
  buildStyleIntensityExecutionPlan,
  listGovernedStyleIntensityCells,
  listGovernedStyleIntensityHighProbeCells,
  listGovernedStyleIntensityPresets,
  listGovernedStyleIntensityStarterCells,
  runGovernedStyleIntensityCellById,
  summarizeGovernedStyleIntensityReports,
} from "./governedStyleIntensityControls";
import {
  buildStyleIntensityMetricSnapshot,
  evaluateStyleIntensityCompatibility,
} from "./styleIntensityCompatibilityEvaluator";
import { getStyleIntensityPreset, isStyleIntensityLevel } from "./styleIntensityPresets";

function buildPreviewDiagnostics(score: number, overrides?: Partial<Record<string, number | string | boolean>>) {
  return {
    recognizable_object: "segmented drones and beacon",
    object_relationship_summary: "bounded style intensity scene",
    environment_profile: "foggy chamber",
    lighting_profile: "stable chamber light",
    camera_profile: "governed chamber rig",
    continuity_anchor_visualization: "beacon anchor",
    scene_readability_overlay: "readable intensity scene",
    beacon_influence_summary: "bounded pulse",
    environmental_response_summary: "stable environment response",
    reflection_shadow_summary: "reflection stability",
    scene_believability_summary: "stable cinematic scene",
    frame_coherence_score: score,
    motion_smoothness_score: score,
    environment_coherence_score: score,
    multi_object_coherence_score: score,
    spacing_consistency_score: score,
    depth_ordering_score: score,
    overlap_avoidance_score: score,
    interaction_staging_score: score,
    reactive_lighting_score: score,
    environmental_response_score: score,
    reflection_continuity_score: score,
    interaction_persistence_score: score,
    reactive_coherence_score: score,
    camera_stability_score: score,
    spatial_continuity_score: score,
    lighting_stability_score: score,
    lighting_consistency_score: score,
    readability_score: score,
    object_fidelity_score: score,
    scene_composition_score: score,
    scene_believability_score: score,
    scene_cohesion_score: score,
    phrase_continuity_score: score,
    transition_smoothness_score: score,
    visual_continuity_score: score,
    focus_continuity_score: score,
    tension_continuity_score: score,
    momentum_continuity_score: score,
    final_composition_score: score,
    environment_identity_score: score,
    formation_identity_score: score,
    silhouette_readability_score: score,
    rejected_pose_transition_count: 0,
    rejected_formation_transition_count: 0,
    rejected_staging_transition_count: 0,
    rejected_focus_transition_count: 0,
    rejected_tension_transition_count: 0,
    rejected_momentum_transition_count: 0,
    rejected_blend_transition_count: 0,
    rejected_cohesion_transition_count: 0,
    rollback_integrity_status: "PASS" as const,
    continuity_quality_indicators: [],
    artifact_diagnostics: [],
    frame_diagnostics: [],
    ...overrides,
  };
}

function buildReadyPrerequisiteState(diagnostics: ReturnType<typeof buildPreviewDiagnostics> | null = null) {
  return {
    micro_sequence_exists: true,
    motion_preview_ready: true,
    sandbox_path: null,
    sandbox_output_root: null,
    generated_frame_references: [],
    preview_diagnostics: diagnostics,
    continuity_validation: {
      valid: true,
      blockers: [],
      summary: "ready",
    },
    next_step_action: null,
    next_step_label: null,
  };
}

test("style intensity presets load deterministically and reject unrestricted values", () => {
  const presets = listGovernedStyleIntensityPresets();

  assert.deepEqual(presets.map((entry) => [entry.level, entry.value]), [
    ["LOW", 0.35],
    ["MEDIUM", 0.65],
    ["HIGH", 0.85],
  ]);
  assert.equal(isStyleIntensityLevel("LOW"), true);
  assert.equal(isStyleIntensityLevel("MEDIUM"), true);
  assert.equal(isStyleIntensityLevel("HIGH"), true);
  assert.equal(isStyleIntensityLevel("EXTREME"), false);
  assert.equal(isStyleIntensityLevel("0.95"), false);
  assert.equal(getStyleIntensityPreset("EXTREME"), null);
  assert.equal(presets.every((entry) => entry.unrestricted === false && entry.extremeMode === false), true);
});

test("style-domain-intensity matrix exposes starter cells and guarded HIGH probes", () => {
  const cells = listGovernedStyleIntensityCells();
  const starters = listGovernedStyleIntensityStarterCells();
  const highProbes = listGovernedStyleIntensityHighProbeCells();

  assert.equal(cells.length, 75);
  assert.deepEqual(starters.map((entry) => entry.cellId), [
    "STYLE_001__DOMAIN_001__MEDIUM",
    "STYLE_002__DOMAIN_002__MEDIUM",
    "STYLE_003__DOMAIN_005__LOW",
    "STYLE_003__DOMAIN_005__MEDIUM",
    "STYLE_004__DOMAIN_004__LOW",
    "STYLE_004__DOMAIN_004__MEDIUM",
    "STYLE_005__DOMAIN_003__MEDIUM",
  ]);
  assert.deepEqual(highProbes.map((entry) => entry.cellId), [
    "STYLE_003__DOMAIN_005__HIGH",
    "STYLE_004__DOMAIN_004__HIGH",
  ]);
  assert.equal(highProbes.every((entry) => entry.highProbeApprovalRequired), true);
});

test("style intensity execution plan stays bounded and manual only", () => {
  const plan = buildStyleIntensityExecutionPlan();

  assert.equal(plan.maxCells, 75);
  assert.equal(plan.bounded, true);
  assert.equal(plan.operatorTriggeredOnly, true);
  assert.equal(plan.manualApprovalRequired, true);
  assert.equal(plan.highIntensityExplicitApprovalRequired, true);
  assert.equal(plan.autonomousContinuationAllowed, false);
  assert.equal(plan.autonomousIntensityRampingAllowed, false);
  assert.equal(plan.unrestrictedIntensityAllowed, false);
  assert.equal(plan.extremeModeAllowed, false);
  assert.equal(plan.crossRunPersistenceAllowed, false);
  assert.equal(plan.automaticRetriesAllowed, false);
  assert.equal(plan.longFormRenderingAllowed, false);
});

test("style intensity compatibility passes for medium sci-fi energy pulse cell", () => {
  const metrics = buildStyleIntensityMetricSnapshot(buildPreviewDiagnostics(98));
  const preset = getStyleIntensityPreset("MEDIUM");
  assert.ok(preset);

  const result = evaluateStyleIntensityCompatibility({
    styleProfile: {
      id: "STYLE_001",
      label: "CINEMATIC_SCI_FI",
      category: "CINEMATIC_SCI_FI",
      characteristics: [],
      description: "",
      prompt: "",
      subject: "",
      motion_intent: "",
      style: "",
      duration_seconds: 2,
      resolution: "720p",
      continuity_priority: "high",
      package_gif_preview: true,
    },
    domain: {
      id: "DOMAIN_001",
      label: "ENERGY_PULSE_REACTOR",
      category: "ENERGY_PULSE",
      prompt: "A pulsing energy core glows beneath a suspended platform while two segmented drones maintain mirrored positions in a fog-filled chamber.",
      subject: "",
      motion_intent: "",
      style: "",
      duration_seconds: 2,
      resolution: "720p",
      continuity_priority: "high",
      package_gif_preview: true,
    },
    preset,
    metrics,
    highIntensityApproved: false,
  });

  assert.equal(result.pass, true);
  assert.equal(result.compatibilityScore >= 95, true);
});

test("HIGH anime silhouette collapse is classified as a guarded readability failure", () => {
  const metrics = buildStyleIntensityMetricSnapshot(buildPreviewDiagnostics(98, {
    silhouette_readability_score: 92,
  }));
  const preset = getStyleIntensityPreset("HIGH");
  assert.ok(preset);

  const result = evaluateStyleIntensityCompatibility({
    styleProfile: {
      id: "STYLE_003",
      label: "ANIME_INSPIRED",
      category: "ANIME_INSPIRED",
      characteristics: [],
      description: "",
      prompt: "",
      subject: "",
      motion_intent: "",
      style: "",
      duration_seconds: 2,
      resolution: "720p",
      continuity_priority: "high",
      package_gif_preview: true,
    },
    domain: {
      id: "DOMAIN_005",
      label: "MECHANICAL_RITUAL_ALIGNMENT",
      category: "MECHANICAL_REVEAL",
      prompt: "Segmented drones perform synchronized alignment movements around a hovering beacon in a foggy chamber.",
      subject: "",
      motion_intent: "",
      style: "",
      duration_seconds: 2,
      resolution: "720p",
      continuity_priority: "high",
      package_gif_preview: true,
    },
    preset,
    metrics,
    highIntensityApproved: true,
  });

  assert.equal(result.pass, false);
  assert.equal(result.failedThresholds.some((entry) => entry.metric === "silhouetteReadability"), true);
});

test("HIGH probes require explicit approval before preview execution", async () => {
  let executeCalled = false;
  const report = await runGovernedStyleIntensityCellById(
    {
      cellId: "STYLE_003__DOMAIN_005__HIGH",
      governanceApproval: true,
      highIntensityApproval: false,
      cellIndex: 1,
      totalCells: 75,
    },
    {
      readPrerequisiteState: async () => buildReadyPrerequisiteState(),
      executeMicroSequence: async () => {
        executeCalled = true;
        throw new Error("HIGH probe should not execute without approval.");
      },
    },
  );

  assert.equal(executeCalled, false);
  assert.equal(report.pass, false);
  assert.equal(report.safetyStatus, "REJECTED");
  assert.equal(report.intensityLevel, "HIGH");
  assert.equal(report.highProbeApprovalRequired, true);
  assert.equal(report.failureReason, "HIGH intensity probes require explicit operator approval before preview execution.");
});

test("failed style intensity runs preserve diagnostics and rollback visibility", async () => {
  const diagnostics = buildPreviewDiagnostics(96, {
    lighting_stability_score: 92,
    reflection_continuity_score: 92,
  });

  const report = await runGovernedStyleIntensityCellById(
    {
      cellId: "STYLE_004__DOMAIN_004__MEDIUM",
      governanceApproval: true,
      cellIndex: 1,
      totalCells: 75,
    },
    {
      readPrerequisiteState: async () => buildReadyPrerequisiteState(),
      executeMicroSequence: async () => ({
        status: "generated",
        request: {} as never,
        governance_status: "ok",
        sandbox_path: ".aie/micro",
        sandbox_output_root: ".aie",
        generated_frame_references: [],
        rollback_status: "bounded",
        rollback_enabled: true,
        preview_diagnostics: diagnostics,
        continuity_validation: {
          valid: true,
          blockers: [],
          summary: "ready",
        },
        preview_cleanup_targets: [],
        live_workspace_blocked_output: true,
        errors: [],
        blockers: [],
        prerequisite_state: buildReadyPrerequisiteState(diagnostics),
      }),
      executePreview: async () => ({
        status: "accepted",
        request: {} as never,
        governance_status: "ok",
        sandbox_path: ".aie/preview",
        sandbox_output_root: ".aie",
        generated_preview_references: [],
        manifest_file_path: null,
        rollback_status: "available",
        rollback_enabled: true,
        preview_diagnostics: diagnostics,
        continuity_validation: {
          valid: true,
          blockers: [],
          summary: "ready",
        },
        execution_ledger_state: {
          ledger_id: "ledger-001",
          attempt_count: 1,
        },
        live_workspace_blocked_output: false,
        errors: [],
        blockers: [],
        prerequisite_state: buildReadyPrerequisiteState(diagnostics),
      }),
      rollbackPreviewSandbox: async () => ({
        status: "rolled_back",
        sandbox_path: ".aie/preview",
        deleted_output_targets: [".aie/preview/frame_001.png"],
        rollback_status: "Rollback completed.",
        sandbox_limited: true,
      }),
    },
  );

  assert.equal(report.pass, false);
  assert.equal(report.rollbackVisible, true);
  assert.equal(report.rollbackRestoredIntensityRun, true);
  assert.equal(report.failureClassification?.code, "LIGHTING_OVERLOAD");
  assert.equal(report.diagnostics?.lighting_stability_score, 92);
});

test("cross-intensity diagnostics aggregate correctly", () => {
  const lowDiagnostics = buildPreviewDiagnostics(99);
  const mediumDiagnostics = buildPreviewDiagnostics(97);
  const highDiagnostics = buildPreviewDiagnostics(94, { lighting_stability_score: 92, reflection_continuity_score: 92 });
  const reports = [
    {
      cellId: "STYLE_003__DOMAIN_005__LOW",
      cellIndex: 1,
      totalCells: 75,
      styleId: "STYLE_003",
      styleLabel: "ANIME_INSPIRED",
      styleCategory: "ANIME_INSPIRED",
      domainId: "DOMAIN_005",
      domainLabel: "MECHANICAL_RITUAL_ALIGNMENT",
      domainCategory: "MECHANICAL_REVEAL",
      intensityLevel: "LOW" as const,
      intensityValue: 0.35,
      starter: true,
      guardedHighProbe: false,
      highProbeApprovalRequired: false,
      highProbeApproved: false,
      safetyStatus: "APPROVED" as const,
      executionStatus: "PASSED" as const,
      pass: true,
      failureReason: null,
      compatibility: {
        styleSafetyStatus: "APPROVED" as const,
        domainSafetyStatus: "APPROVED" as const,
        intensitySafetyStatus: "APPROVED" as const,
        styleCategory: "ANIME_INSPIRED" as const,
        domainCategory: "MECHANICAL_REVEAL" as const,
        compatibilityScore: 99,
        intensityValue: 0.35,
        styleReadabilityScore: 99,
        lightingStabilityScore: 99,
        reflectionContinuityScore: 99,
        rollbackCompatibilityScore: 100,
        pass: true,
        failedThresholds: [],
        recommendedRuntimeLayer: null,
        strongestMetric: "sceneCohesion",
        weakestMetric: "sceneCohesion",
        reasons: [],
      },
      metrics: buildStyleIntensityMetricSnapshot(lowDiagnostics),
      strongestMetric: "sceneCohesion",
      weakestMetric: "sceneCohesion",
      strongestMetricScore: 99,
      weakestMetricScore: 99,
      failedThresholds: [],
      failureClassification: null,
      recommendedRuntimeLayer: null,
      rollbackVisible: true,
      rollbackRestoredIntensityRun: false,
      rejectedIntensityCount: 0,
      diagnostics: lowDiagnostics,
      prerequisiteBefore: null,
      prerequisiteAfter: null,
      microSequence: null,
      previewExecution: null,
      rollback: null,
    },
    {
      cellId: "STYLE_003__DOMAIN_005__MEDIUM",
      cellIndex: 2,
      totalCells: 75,
      styleId: "STYLE_003",
      styleLabel: "ANIME_INSPIRED",
      styleCategory: "ANIME_INSPIRED",
      domainId: "DOMAIN_005",
      domainLabel: "MECHANICAL_RITUAL_ALIGNMENT",
      domainCategory: "MECHANICAL_REVEAL",
      intensityLevel: "MEDIUM" as const,
      intensityValue: 0.65,
      starter: true,
      guardedHighProbe: false,
      highProbeApprovalRequired: false,
      highProbeApproved: false,
      safetyStatus: "APPROVED" as const,
      executionStatus: "PASSED" as const,
      pass: true,
      failureReason: null,
      compatibility: {
        styleSafetyStatus: "APPROVED" as const,
        domainSafetyStatus: "APPROVED" as const,
        intensitySafetyStatus: "APPROVED" as const,
        styleCategory: "ANIME_INSPIRED" as const,
        domainCategory: "MECHANICAL_REVEAL" as const,
        compatibilityScore: 97,
        intensityValue: 0.65,
        styleReadabilityScore: 97,
        lightingStabilityScore: 97,
        reflectionContinuityScore: 97,
        rollbackCompatibilityScore: 100,
        pass: true,
        failedThresholds: [],
        recommendedRuntimeLayer: null,
        strongestMetric: "sceneCohesion",
        weakestMetric: "lightingStability",
        reasons: [],
      },
      metrics: buildStyleIntensityMetricSnapshot(mediumDiagnostics),
      strongestMetric: "sceneCohesion",
      weakestMetric: "lightingStability",
      strongestMetricScore: 97,
      weakestMetricScore: 97,
      failedThresholds: [],
      failureClassification: null,
      recommendedRuntimeLayer: null,
      rollbackVisible: true,
      rollbackRestoredIntensityRun: false,
      rejectedIntensityCount: 0,
      diagnostics: mediumDiagnostics,
      prerequisiteBefore: null,
      prerequisiteAfter: null,
      microSequence: null,
      previewExecution: null,
      rollback: null,
    },
    {
      cellId: "STYLE_004__DOMAIN_004__HIGH",
      cellIndex: 3,
      totalCells: 75,
      styleId: "STYLE_004",
      styleLabel: "NEON_DYSTOPIAN",
      styleCategory: "NEON_DYSTOPIAN",
      domainId: "DOMAIN_004",
      domainLabel: "REACTIVE_REFLECTION_SEQUENCE",
      domainCategory: "ENVIRONMENTAL_REACTION",
      intensityLevel: "HIGH" as const,
      intensityValue: 0.85,
      starter: false,
      guardedHighProbe: true,
      highProbeApprovalRequired: true,
      highProbeApproved: true,
      safetyStatus: "APPROVED" as const,
      executionStatus: "FAILED" as const,
      pass: false,
      failureReason: "High neon intensity caused glow overload and destabilized lighting or reflections.",
      compatibility: {
        styleSafetyStatus: "APPROVED" as const,
        domainSafetyStatus: "APPROVED" as const,
        intensitySafetyStatus: "APPROVED" as const,
        styleCategory: "NEON_DYSTOPIAN" as const,
        domainCategory: "ENVIRONMENTAL_REACTION" as const,
        compatibilityScore: 94,
        intensityValue: 0.85,
        styleReadabilityScore: 94,
        lightingStabilityScore: 92,
        reflectionContinuityScore: 92,
        rollbackCompatibilityScore: 100,
        pass: false,
        failedThresholds: [],
        recommendedRuntimeLayer: "lighting layers",
        strongestMetric: "sceneCohesion",
        weakestMetric: "lightingStability",
        reasons: [],
      },
      metrics: buildStyleIntensityMetricSnapshot(highDiagnostics),
      strongestMetric: "sceneCohesion",
      weakestMetric: "lightingStability",
      strongestMetricScore: 94,
      weakestMetricScore: 92,
      failedThresholds: [],
      failureClassification: null,
      recommendedRuntimeLayer: "lighting layers",
      rollbackVisible: true,
      rollbackRestoredIntensityRun: true,
      rejectedIntensityCount: 0,
      diagnostics: highDiagnostics,
      prerequisiteBefore: null,
      prerequisiteAfter: null,
      microSequence: null,
      previewExecution: null,
      rollback: null,
    },
  ];

  const summary = summarizeGovernedStyleIntensityReports(reports);

  assert.equal(summary.testedIntensityCount, 3);
  assert.equal(summary.passedIntensityCount, 2);
  assert.equal(summary.failedIntensityCount, 1);
  assert.equal(summary.strongestIntensityLevelByStyle.STYLE_003, "LOW");
  assert.equal(summary.weakestIntensityLevelByStyle.STYLE_003, "MEDIUM");
  assert.equal(summary.riskiestHighIntensityStyleId, "STYLE_004");
  assert.equal(summary.averageLightingStabilityByIntensity.HIGH, 92);
  assert.equal(summary.rollbackPassRate, 1);
  assert.equal(summary.recommendedNextAction, "BLOCK_HIGH_INTENSITY");
});

test("unknown intensity cells are blocked without mutating runtime", async () => {
  const report = await runGovernedStyleIntensityCellById(
    {
      cellId: "STYLE_003__DOMAIN_005__EXTREME",
      governanceApproval: true,
      cellIndex: 1,
      totalCells: 75,
    },
    {
      readPrerequisiteState: async () => buildReadyPrerequisiteState(),
    },
  );

  assert.equal(report.pass, false);
  assert.equal(report.safetyStatus, "REJECTED");
  assert.equal(report.microSequence, null);
  assert.equal(report.previewExecution, null);
});

test("harness state keeps rollback visibility and weakest intensity", () => {
  const diagnostics = buildPreviewDiagnostics(98);
  const report = {
    cellId: "STYLE_003__DOMAIN_005__MEDIUM",
    cellIndex: 1,
    totalCells: 75,
    styleId: "STYLE_003",
    styleLabel: "ANIME_INSPIRED",
    styleCategory: "ANIME_INSPIRED",
    domainId: "DOMAIN_005",
    domainLabel: "MECHANICAL_RITUAL_ALIGNMENT",
    domainCategory: "MECHANICAL_REVEAL",
    intensityLevel: "MEDIUM" as const,
    intensityValue: 0.65,
    starter: true,
    guardedHighProbe: false,
    highProbeApprovalRequired: false,
    highProbeApproved: false,
    safetyStatus: "APPROVED" as const,
    executionStatus: "PASSED" as const,
    pass: true,
    failureReason: null,
    compatibility: {
      styleSafetyStatus: "APPROVED" as const,
      domainSafetyStatus: "APPROVED" as const,
      intensitySafetyStatus: "APPROVED" as const,
      styleCategory: "ANIME_INSPIRED" as const,
      domainCategory: "MECHANICAL_REVEAL" as const,
      compatibilityScore: 98,
      intensityValue: 0.65,
      styleReadabilityScore: 98,
      lightingStabilityScore: 98,
      reflectionContinuityScore: 98,
      rollbackCompatibilityScore: 100,
      pass: true,
      failedThresholds: [],
      recommendedRuntimeLayer: null,
      strongestMetric: "sceneCohesion",
      weakestMetric: "lightingStability",
      reasons: [],
    },
    metrics: buildStyleIntensityMetricSnapshot(diagnostics),
    strongestMetric: "sceneCohesion",
    weakestMetric: "lightingStability",
    strongestMetricScore: 98,
    weakestMetricScore: 98,
    failedThresholds: [],
    failureClassification: null,
    recommendedRuntimeLayer: null,
    rollbackVisible: true,
    rollbackRestoredIntensityRun: true,
    rejectedIntensityCount: 0,
    diagnostics,
    prerequisiteBefore: null,
    prerequisiteAfter: null,
    microSequence: null,
    previewExecution: null,
    rollback: null,
  };

  const state = buildGovernedStyleIntensityControlsState([report]);

  assert.equal(state?.activeStyleId, "STYLE_003");
  assert.equal(state?.activeDomainId, "DOMAIN_005");
  assert.equal(state?.activeIntensityLevel, "MEDIUM");
  assert.equal(state?.testedIntensityCount, 1);
  assert.equal(state?.passedIntensityCount, 1);
  assert.equal(state?.weakestIntensityLevel, "MEDIUM");
  assert.equal(state?.rollbackRestoredIntensityRun, true);
});
