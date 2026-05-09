import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVisualStyleExecutionPlan,
  classifyGovernedVisualStyleProfile,
  listGovernedVisualStyleProfiles,
  runGovernedVisualStyleProfileById,
  summarizeGovernedVisualStyleReports,
} from "./governedVisualStyleProfiles";
import {
  buildVisualStyleMetricSnapshot,
  evaluateVisualStyleCompatibility,
} from "./styleCompatibilityEvaluator";

function buildPreviewDiagnostics(score: number) {
  return {
    recognizable_object: "segmented drones and beacon",
    object_relationship_summary: "bounded cinematic style",
    environment_profile: "foggy chamber",
    lighting_profile: "stable chamber light",
    camera_profile: "governed chamber rig",
    continuity_anchor_visualization: "beacon anchor",
    scene_readability_overlay: "readable governed style",
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
    silhouette_readability_score: score,
    rollback_integrity_status: "PASS" as const,
    continuity_quality_indicators: [],
    artifact_diagnostics: [],
    frame_diagnostics: [],
  };
}

test("approved visual styles load deterministically", () => {
  const styles = listGovernedVisualStyleProfiles();

  assert.equal(styles.length, 5);
  assert.deepEqual(styles.map((entry) => entry.id), ["STYLE_001", "STYLE_002", "STYLE_003", "STYLE_004", "STYLE_005"]);
  assert.ok(styles.every((entry) => entry.duration_seconds === 2));
});

test("visual style execution plan remains bounded", () => {
  const plan = buildVisualStyleExecutionPlan();

  assert.equal(plan.maxStyles, 5);
  assert.equal(plan.bounded, true);
  assert.equal(plan.operatorTriggeredOnly, true);
  assert.equal(plan.manualApprovalRequired, true);
  assert.equal(plan.autonomousContinuationAllowed, false);
  assert.equal(plan.longFormRenderingAllowed, false);
});

test("anime-inspired profile preserves readability", () => {
  const metrics = buildVisualStyleMetricSnapshot(buildPreviewDiagnostics(98));
  const result = evaluateVisualStyleCompatibility("STYLE_003", metrics);

  assert.equal(result.pass, true);
  assert.equal(result.styleCategory, "ANIME_INSPIRED");
  assert.equal(result.silhouetteReadabilityCompatibility >= 95, true);
  assert.equal(result.readabilityScore >= 95, true);
});

test("industrial realism preserves cohesion", () => {
  const metrics = buildVisualStyleMetricSnapshot(buildPreviewDiagnostics(97));
  const result = evaluateVisualStyleCompatibility("STYLE_002", metrics);

  assert.equal(result.pass, true);
  assert.equal(result.styleCategory, "INDUSTRIAL_REALISM");
  assert.equal(result.compatibilityScore >= 95, true);
});

test("neon reflections remain stable", () => {
  const metrics = buildVisualStyleMetricSnapshot(buildPreviewDiagnostics(98));
  const result = evaluateVisualStyleCompatibility("STYLE_004", metrics);

  assert.equal(result.pass, true);
  assert.equal(result.styleCategory, "NEON_DYSTOPIAN");
  assert.equal(result.reflectionContinuityCompatibility >= 94, true);
  assert.equal(result.lightingStabilityCompatibility >= 94, true);
});

test("cross-style diagnostics aggregate correctly", () => {
  const highMetrics = buildVisualStyleMetricSnapshot(buildPreviewDiagnostics(99));
  const lowMetrics = buildVisualStyleMetricSnapshot(buildPreviewDiagnostics(94));
  const summary = summarizeGovernedVisualStyleReports([
    {
      styleId: "STYLE_001",
      styleLabel: "CINEMATIC_SCI_FI",
      styleCategory: "CINEMATIC_SCI_FI",
      styleIndex: 1,
      totalStyles: 5,
      styleCharacteristics: ["stable composition"],
      styleDescription: "a",
      safetyStatus: "APPROVED",
      executionStatus: "PASSED",
      pass: true,
      failureReason: null,
      compatibility: evaluateVisualStyleCompatibility("STYLE_001", highMetrics),
      metrics: highMetrics,
      strongestMetric: "sceneCohesion",
      weakestMetric: "sceneCohesion",
      failedThresholds: [],
      recommendedRuntimeLayer: null,
      rollbackVisible: true,
      rollbackRestoredStyle: false,
      rejectedStyleCount: 0,
      diagnostics: buildPreviewDiagnostics(99),
      prerequisiteBefore: null,
      prerequisiteAfter: null,
      microSequence: null,
      previewExecution: null,
      rollback: null,
    },
    {
      styleId: "STYLE_004",
      styleLabel: "NEON_DYSTOPIAN",
      styleCategory: "NEON_DYSTOPIAN",
      styleIndex: 2,
      totalStyles: 5,
      styleCharacteristics: ["reactive glow layering"],
      styleDescription: "b",
      safetyStatus: "APPROVED",
      executionStatus: "FAILED",
      pass: false,
      failureReason: "lighting stability fell below threshold",
      compatibility: evaluateVisualStyleCompatibility("STYLE_004", lowMetrics),
      metrics: lowMetrics,
      strongestMetric: "sceneCohesion",
      weakestMetric: "lightingStability",
      failedThresholds: [],
      recommendedRuntimeLayer: "lighting layers",
      rollbackVisible: true,
      rollbackRestoredStyle: true,
      rejectedStyleCount: 0,
      diagnostics: buildPreviewDiagnostics(94),
      prerequisiteBefore: null,
      prerequisiteAfter: null,
      microSequence: null,
      previewExecution: null,
      rollback: null,
    },
  ]);

  assert.equal(summary.testedStyleCount, 2);
  assert.equal(summary.passedStyleCount, 1);
  assert.equal(summary.averageSceneCohesion, 96.5);
  assert.equal(summary.averageLightingStability, 96.5);
  assert.equal(summary.recommendedNextAction, "TUNE_VISUAL_LAYERS");
});

test("failed styles do not mutate runtime state and keep rollback visible", async () => {
  const diagnostics = buildPreviewDiagnostics(94);
  const report = await runGovernedVisualStyleProfileById(
    {
      styleId: "STYLE_004",
      governanceApproval: true,
      styleIndex: 1,
      totalStyles: 5,
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
  assert.equal(report.rollbackRestoredStyle, true);
  assert.equal(report.metrics?.lightingStability, 94);
});

test("unknown style profiles are rejected before execution", () => {
  const result = classifyGovernedVisualStyleProfile("STYLE_999");

  assert.equal(result.status, "REJECTED");
  assert.equal(result.styleCategory, null);
});