import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGovernedStyleStressHarnessState,
  buildStyleStressExecutionPlan,
  listGovernedStyleStressCells,
  listGovernedStyleStressStarterCells,
  runGovernedStyleStressCellById,
  summarizeGovernedStyleStressReports,
} from "./governedStyleStressHarness";
import {
  buildStyleStressMetricSnapshot,
  evaluateStyleDomainCompatibility,
} from "./styleDomainCompatibilityEvaluator";

function buildPreviewDiagnostics(score: number, overrides?: Partial<Record<string, number | string | boolean>>) {
  return {
    recognizable_object: "segmented drones and beacon",
    object_relationship_summary: "bounded style stress scene",
    environment_profile: "foggy chamber",
    lighting_profile: "stable chamber light",
    camera_profile: "governed chamber rig",
    continuity_anchor_visualization: "beacon anchor",
    scene_readability_overlay: "readable stress scene",
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

test("style-domain matrix loads deterministically and includes starter combinations", () => {
  const cells = listGovernedStyleStressCells();
  const starters = listGovernedStyleStressStarterCells();

  assert.equal(cells.length, 25);
  assert.deepEqual(starters.map((entry) => entry.cellId), [
    "STYLE_001__DOMAIN_001",
    "STYLE_002__DOMAIN_002",
    "STYLE_003__DOMAIN_005",
    "STYLE_004__DOMAIN_004",
    "STYLE_005__DOMAIN_003",
  ]);
});

test("style stress execution plan stays bounded and manual only", () => {
  const plan = buildStyleStressExecutionPlan();

  assert.equal(plan.maxCells, 25);
  assert.equal(plan.bounded, true);
  assert.equal(plan.operatorTriggeredOnly, true);
  assert.equal(plan.manualApprovalRequired, true);
  assert.equal(plan.fullMatrixAutoplayAllowed, false);
  assert.equal(plan.automaticRetriesAllowed, false);
  assert.equal(plan.autonomousContinuationAllowed, false);
  assert.equal(plan.longFormRenderingAllowed, false);
});

test("style-domain compatibility passes for starter sci-fi energy pulse cell", () => {
  const metrics = buildStyleStressMetricSnapshot(buildPreviewDiagnostics(98));
  const result = evaluateStyleDomainCompatibility(
    {
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
    {
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
    metrics,
  );

  assert.equal(result.pass, true);
  assert.equal(result.compatibilityScore >= 95, true);
});

test("anime silhouette collapse is classified correctly", () => {
  const metrics = buildStyleStressMetricSnapshot(buildPreviewDiagnostics(98, {
    silhouette_readability_score: 92,
  }));
  const result = evaluateStyleDomainCompatibility(
    {
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
    {
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
    metrics,
  );

  assert.equal(result.pass, false);
  assert.equal(result.failedThresholds[0]?.metric, "silhouetteReadability");
});

test("failed style stress runs preserve diagnostics and rollback visibility", async () => {
  const diagnostics = buildPreviewDiagnostics(94, {
    lighting_stability_score: 92,
    reflection_continuity_score: 92,
  });

  const report = await runGovernedStyleStressCellById(
    {
      cellId: "STYLE_004__DOMAIN_004",
      governanceApproval: true,
      cellIndex: 1,
      totalCells: 5,
    },
    {
      readPrerequisiteState: async () => ({
        micro_sequence_exists: true,
        motion_preview_ready: true,
        sandbox_path: null,
        sandbox_output_root: null,
        generated_frame_references: [],
        preview_diagnostics: null,
        continuity_validation: {
          valid: true,
          blockers: [],
          summary: "ready",
        },
        next_step_action: null,
        next_step_label: null,
      }),
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
        prerequisite_state: {
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
        },
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
        prerequisite_state: {
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
        },
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
  assert.equal(report.rollbackRestoredStressRun, true);
  assert.equal(report.failureClassification?.code, "LIGHTING_OVERLOAD");
  assert.equal(report.diagnostics?.lighting_stability_score, 92);
});

test("cross-style stress diagnostics aggregate correctly", () => {
  const strongDiagnostics = buildPreviewDiagnostics(99);
  const weakDiagnostics = buildPreviewDiagnostics(94, { lighting_stability_score: 92, reflection_continuity_score: 92 });
  const summary = summarizeGovernedStyleStressReports([
    {
      cellId: "STYLE_001__DOMAIN_001",
      cellIndex: 1,
      totalCells: 5,
      styleId: "STYLE_001",
      styleLabel: "CINEMATIC_SCI_FI",
      styleCategory: "CINEMATIC_SCI_FI",
      domainId: "DOMAIN_001",
      domainLabel: "ENERGY_PULSE_REACTOR",
      domainCategory: "ENERGY_PULSE",
      starter: true,
      safetyStatus: "APPROVED",
      executionStatus: "PASSED",
      pass: true,
      failureReason: null,
      compatibility: {
        styleSafetyStatus: "APPROVED",
        domainSafetyStatus: "APPROVED",
        styleCategory: "CINEMATIC_SCI_FI",
        domainCategory: "ENERGY_PULSE",
        compatibilityScore: 99,
        styleConsistencyScore: 99,
        domainCompatibilityScore: 99,
        readabilityScore: 99,
        rollbackCompatibilityScore: 100,
        pass: true,
        failedThresholds: [],
        recommendedRuntimeLayer: null,
        strongestMetric: "sceneCohesion",
        weakestMetric: "sceneCohesion",
        reasons: [],
      },
      metrics: buildStyleStressMetricSnapshot(strongDiagnostics),
      strongestMetric: "sceneCohesion",
      weakestMetric: "sceneCohesion",
      strongestMetricScore: 99,
      weakestMetricScore: 99,
      failedThresholds: [],
      failureClassification: null,
      recommendedRuntimeLayer: null,
      rollbackVisible: true,
      rollbackRestoredStressRun: false,
      rejectedCellCount: 0,
      diagnostics: strongDiagnostics,
      prerequisiteBefore: null,
      prerequisiteAfter: null,
      microSequence: null,
      previewExecution: null,
      rollback: null,
    },
    {
      cellId: "STYLE_004__DOMAIN_004",
      cellIndex: 2,
      totalCells: 5,
      styleId: "STYLE_004",
      styleLabel: "NEON_DYSTOPIAN",
      styleCategory: "NEON_DYSTOPIAN",
      domainId: "DOMAIN_004",
      domainLabel: "REACTIVE_REFLECTION_SEQUENCE",
      domainCategory: "ENVIRONMENTAL_REACTION",
      starter: true,
      safetyStatus: "APPROVED",
      executionStatus: "FAILED",
      pass: false,
      failureReason: "Neon dystopian glow overload destabilized lighting and reflection continuity.",
      compatibility: {
        styleSafetyStatus: "APPROVED",
        domainSafetyStatus: "APPROVED",
        styleCategory: "NEON_DYSTOPIAN",
        domainCategory: "ENVIRONMENTAL_REACTION",
        compatibilityScore: 94.57,
        styleConsistencyScore: 93.33,
        domainCompatibilityScore: 94,
        readabilityScore: 94,
        rollbackCompatibilityScore: 100,
        pass: false,
        failedThresholds: [],
        recommendedRuntimeLayer: "lighting layers",
        strongestMetric: "sceneCohesion",
        weakestMetric: "lightingStability",
        reasons: [],
      },
      metrics: buildStyleStressMetricSnapshot(weakDiagnostics),
      strongestMetric: "sceneCohesion",
      weakestMetric: "lightingStability",
      strongestMetricScore: 94,
      weakestMetricScore: 92,
      failedThresholds: [],
      failureClassification: {
        code: "LIGHTING_OVERLOAD",
        reason: "Neon dystopian glow overload destabilized lighting and reflection continuity.",
        inspectLayer: "lighting layers",
      },
      recommendedRuntimeLayer: "lighting layers",
      rollbackVisible: true,
      rollbackRestoredStressRun: true,
      rejectedCellCount: 0,
      diagnostics: weakDiagnostics,
      prerequisiteBefore: null,
      prerequisiteAfter: null,
      microSequence: null,
      previewExecution: null,
      rollback: null,
    },
  ]);

  assert.equal(summary.testedCellCount, 2);
  assert.equal(summary.passedCellCount, 1);
  assert.equal(summary.failedCellCount, 1);
  assert.equal(summary.averageSceneCohesion, 96.5);
  assert.equal(summary.rollbackPassRate, 1);
  assert.equal(summary.recommendedNextAction, "TUNE_STYLE_PROFILE");
});

test("harness state keeps rollback visibility and weakest dimensions", () => {
  const state = buildGovernedStyleStressHarnessState([
    {
      cellId: "STYLE_001__DOMAIN_001",
      cellIndex: 1,
      totalCells: 5,
      styleId: "STYLE_001",
      styleLabel: "CINEMATIC_SCI_FI",
      styleCategory: "CINEMATIC_SCI_FI",
      domainId: "DOMAIN_001",
      domainLabel: "ENERGY_PULSE_REACTOR",
      domainCategory: "ENERGY_PULSE",
      starter: true,
      safetyStatus: "APPROVED",
      executionStatus: "PASSED",
      pass: true,
      failureReason: null,
      compatibility: {
        styleSafetyStatus: "APPROVED",
        domainSafetyStatus: "APPROVED",
        styleCategory: "CINEMATIC_SCI_FI",
        domainCategory: "ENERGY_PULSE",
        compatibilityScore: 99,
        styleConsistencyScore: 99,
        domainCompatibilityScore: 99,
        readabilityScore: 99,
        rollbackCompatibilityScore: 100,
        pass: true,
        failedThresholds: [],
        recommendedRuntimeLayer: null,
        strongestMetric: "sceneCohesion",
        weakestMetric: "sceneCohesion",
        reasons: [],
      },
      metrics: buildStyleStressMetricSnapshot(buildPreviewDiagnostics(99)),
      strongestMetric: "sceneCohesion",
      weakestMetric: "sceneCohesion",
      strongestMetricScore: 99,
      weakestMetricScore: 99,
      failedThresholds: [],
      failureClassification: null,
      recommendedRuntimeLayer: null,
      rollbackVisible: true,
      rollbackRestoredStressRun: false,
      rejectedCellCount: 0,
      diagnostics: null,
      prerequisiteBefore: null,
      prerequisiteAfter: null,
      microSequence: null,
      previewExecution: null,
      rollback: null,
    },
    {
      cellId: "STYLE_004__DOMAIN_004",
      cellIndex: 2,
      totalCells: 5,
      styleId: "STYLE_004",
      styleLabel: "NEON_DYSTOPIAN",
      styleCategory: "NEON_DYSTOPIAN",
      domainId: "DOMAIN_004",
      domainLabel: "REACTIVE_REFLECTION_SEQUENCE",
      domainCategory: "ENVIRONMENTAL_REACTION",
      starter: true,
      safetyStatus: "APPROVED",
      executionStatus: "FAILED",
      pass: false,
      failureReason: "Neon dystopian glow overload destabilized lighting and reflection continuity.",
      compatibility: {
        styleSafetyStatus: "APPROVED",
        domainSafetyStatus: "APPROVED",
        styleCategory: "NEON_DYSTOPIAN",
        domainCategory: "ENVIRONMENTAL_REACTION",
        compatibilityScore: 90,
        styleConsistencyScore: 90,
        domainCompatibilityScore: 90,
        readabilityScore: 90,
        rollbackCompatibilityScore: 100,
        pass: false,
        failedThresholds: [],
        recommendedRuntimeLayer: "lighting layers",
        strongestMetric: "sceneCohesion",
        weakestMetric: "lightingStability",
        reasons: [],
      },
      metrics: buildStyleStressMetricSnapshot(buildPreviewDiagnostics(90, { lighting_stability_score: 88, reflection_continuity_score: 88 })),
      strongestMetric: "sceneCohesion",
      weakestMetric: "lightingStability",
      strongestMetricScore: 90,
      weakestMetricScore: 88,
      failedThresholds: [],
      failureClassification: {
        code: "LIGHTING_OVERLOAD",
        reason: "Neon dystopian glow overload destabilized lighting and reflection continuity.",
        inspectLayer: "lighting layers",
      },
      recommendedRuntimeLayer: "lighting layers",
      rollbackVisible: true,
      rollbackRestoredStressRun: true,
      rejectedCellCount: 0,
      diagnostics: null,
      prerequisiteBefore: null,
      prerequisiteAfter: null,
      microSequence: null,
      previewExecution: null,
      rollback: null,
    },
  ]);

  assert.equal(state?.testedCellCount, 2);
  assert.equal(state?.passedCellCount, 1);
  assert.equal(state?.failedCellCount, 1);
  assert.equal(state?.weakestStyleId, "STYLE_004");
  assert.equal(state?.weakestDomainId, "DOMAIN_004");
  assert.equal(state?.rollbackRestoredStressRun, true);
});