import assert from "node:assert/strict";
import test from "node:test";

import { listGovernedPromptVariationVariants, buildPromptVariationExecutionPlan, classifyGovernedPromptVariationPrompt, runGovernedPromptVariationVariant, summarizeGovernedPromptVariationReports } from "./governedPromptVariationHarness";
import { buildPromptVariationMetricSnapshot, evaluatePromptVariationThresholds } from "./promptVariationDiagnostics";

function buildPreviewDiagnostics(score: number) {
  return {
    recognizable_object: "segmented drones and beacon",
    object_relationship_summary: "bounded beacon orbit",
    environment_profile: "foggy chamber",
    lighting_profile: "reactive beacon light",
    camera_profile: "governed chamber rig",
    continuity_anchor_visualization: "beacon anchor",
    scene_readability_overlay: "readable governed scene",
    beacon_influence_summary: "bounded pulse",
    environmental_response_summary: "chamber light response",
    reflection_shadow_summary: "stable reflections",
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
    rollback_integrity_status: "PASS" as const,
    continuity_quality_indicators: [],
    artifact_diagnostics: [],
    frame_diagnostics: [],
  };
}

test("approved prompt variants load deterministically", () => {
  const variants = listGovernedPromptVariationVariants();

  assert.equal(variants.length, 4);
  assert.deepEqual(variants.map((entry) => entry.id), ["VARIANT_001", "VARIANT_002", "VARIANT_003", "VARIANT_004"]);
  assert.ok(variants.every((entry) => entry.duration_seconds === 2));
});

test("prompt safety classifier rejects humanoid dialogue long-scene prompts", () => {
  const result = classifyGovernedPromptVariationPrompt("A humanoid character speaks to the drones in a long dialogue scene.");

  assert.equal(result.status, "REJECTED");
  assert.ok(result.blockedTerms.includes("humanoid"));
  assert.ok(result.blockedTerms.includes("dialogue"));
  assert.ok(result.blockedTerms.includes("character"));
  assert.ok(result.blockedTerms.includes("long scene"));
});

test("prompt safety classifier approves governed cinematic prompt domains", () => {
  const result = classifyGovernedPromptVariationPrompt("Two segmented drones orbit a beacon in a foggy chamber and settle into formation.");

  assert.equal(result.status, "APPROVED");
  assert.ok(result.approvedTerms.includes("drone"));
  assert.ok(result.approvedTerms.includes("beacon"));
  assert.ok(result.approvedDomain);
});

test("variant execution plan remains bounded and manual-only", () => {
  const plan = buildPromptVariationExecutionPlan();

  assert.equal(plan.maxVariants, 4);
  assert.equal(plan.bounded, true);
  assert.equal(plan.operatorTriggeredOnly, true);
  assert.equal(plan.manualApprovalRequired, true);
  assert.equal(plan.autonomousContinuationAllowed, false);
  assert.equal(plan.longFormRenderingAllowed, false);
  assert.equal(plan.variantIds.length, 4);
});

test("cross-variant diagnostics aggregate correctly", () => {
  const summary = summarizeGovernedPromptVariationReports([
    {
      variantId: "VARIANT_001",
      variantLabel: "A",
      variantIndex: 1,
      totalVariants: 4,
      domain: "SCI_FI_BEACON_CHAMBER",
      prompt: "a",
      safety: classifyGovernedPromptVariationPrompt("drone beacon chamber settle"),
      safetyStatus: "APPROVED",
      executionStatus: "PASSED",
      pass: true,
      failureReason: null,
      metrics: buildPromptVariationMetricSnapshot(buildPreviewDiagnostics(99)),
      failedThresholds: [],
      recommendedRuntimeLayer: null,
      rollbackVisible: true,
      rollbackRestoredVariant: false,
      rejectedVariantCount: 0,
      diagnostics: buildPreviewDiagnostics(99),
      prerequisiteBefore: null,
      prerequisiteAfter: null,
      microSequence: null,
      previewExecution: null,
      rollback: null,
    },
    {
      variantId: "VARIANT_002",
      variantLabel: "B",
      variantIndex: 2,
      totalVariants: 4,
      domain: "DRONE_FORMATION_REVEAL",
      prompt: "b",
      safety: classifyGovernedPromptVariationPrompt("drone beacon chamber settle"),
      safetyStatus: "APPROVED",
      executionStatus: "FAILED",
      pass: false,
      failureReason: "transition fell below threshold",
      metrics: buildPromptVariationMetricSnapshot(buildPreviewDiagnostics(94)),
      failedThresholds: [],
      recommendedRuntimeLayer: "transition blend",
      rollbackVisible: true,
      rollbackRestoredVariant: true,
      rejectedVariantCount: 0,
      diagnostics: buildPreviewDiagnostics(94),
      prerequisiteBefore: null,
      prerequisiteAfter: null,
      microSequence: null,
      previewExecution: null,
      rollback: null,
    },
  ]);

  assert.equal(summary.variantCount, 2);
  assert.equal(summary.passedVariantCount, 1);
  assert.equal(summary.averageSceneCohesion, 96.5);
  assert.equal(summary.minimumTransitionSmoothness, 94);
  assert.equal(summary.recommendedNextAction, "TUNE_RUNTIME");
});

test("threshold evaluation fails metrics below governed floor", () => {
  const evaluation = evaluatePromptVariationThresholds(buildPromptVariationMetricSnapshot(buildPreviewDiagnostics(94)));

  assert.equal(evaluation.pass, false);
  assert.ok(evaluation.failedThresholds.some((entry) => entry.metric === "sceneCohesion"));
  assert.equal(evaluation.recommendedRuntimeLayer, "scene cohesion");
});

test("unsafe prompts are rejected before preview execution", () => {
  const result = classifyGovernedPromptVariationPrompt("A humanoid character speaks to the drones in a long dialogue scene.");

  assert.equal(result.status, "REJECTED");
  assert.ok(result.blockedTerms.includes("humanoid"));
  assert.ok(result.blockedTerms.includes("dialogue"));
  assert.ok(result.blockedTerms.includes("long scene"));
});

test("failed variants preserve diagnostics and expose rollback state", async () => {
  const diagnostics = buildPreviewDiagnostics(94);
  const report = await runGovernedPromptVariationVariant(
    {
      variantId: "VARIANT_001",
      governanceApproval: true,
      variantIndex: 1,
      totalVariants: 4,
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
  assert.equal(report.rollbackRestoredVariant, true);
  assert.equal(report.diagnostics?.scene_cohesion_score, 94);
});