import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPromptDomainExecutionPlan,
  classifyGovernedPromptDomainPrompt,
  listGovernedPromptDomains,
  runGovernedPromptDomainById,
  summarizeGovernedPromptDomainReports,
} from "./governedPromptDomainExpansion";
import {
  buildPromptDomainMetricSnapshot,
  evaluatePromptDomainCompatibility,
} from "./domainCompatibilityEvaluator";

function buildPreviewDiagnostics(score: number) {
  return {
    recognizable_object: "segmented drones and beacon",
    object_relationship_summary: "bounded cinematic domain",
    environment_profile: "foggy chamber",
    lighting_profile: "stable pulse light",
    camera_profile: "governed chamber rig",
    continuity_anchor_visualization: "beacon anchor",
    scene_readability_overlay: "readable governed domain",
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
    rollback_integrity_status: "PASS" as const,
    continuity_quality_indicators: [],
    artifact_diagnostics: [],
    frame_diagnostics: [],
  };
}

test("approved prompt domains load deterministically", () => {
  const domains = listGovernedPromptDomains();

  assert.equal(domains.length, 5);
  assert.deepEqual(domains.map((entry) => entry.id), ["DOMAIN_001", "DOMAIN_002", "DOMAIN_003", "DOMAIN_004", "DOMAIN_005"]);
  assert.ok(domains.every((entry) => entry.duration_seconds === 2));
});

test("prompt domain classifier rejects unsafe vocabulary", () => {
  const result = classifyGovernedPromptDomainPrompt("A human pilot gives spoken orders to armed drones during a long battle sequence.");

  assert.equal(result.status, "REJECTED");
  assert.ok(result.blockedTerms.includes("human"));
  assert.ok(result.blockedTerms.includes("spoken"));
  assert.ok(result.blockedTerms.includes("battle") || result.blockedTerms.includes("combat"));
  assert.ok(result.blockedTerms.includes("long sequence") || result.blockedTerms.includes("extended sequence"));
});

test("prompt domain execution plan remains bounded", () => {
  const plan = buildPromptDomainExecutionPlan();

  assert.equal(plan.maxDomains, 5);
  assert.equal(plan.bounded, true);
  assert.equal(plan.operatorTriggeredOnly, true);
  assert.equal(plan.manualApprovalRequired, true);
  assert.equal(plan.autonomousContinuationAllowed, false);
  assert.equal(plan.longFormRenderingAllowed, false);
});

test("prompt domain compatibility aggregates extended metrics", () => {
  const metrics = buildPromptDomainMetricSnapshot(buildPreviewDiagnostics(98));
  const result = evaluatePromptDomainCompatibility("A reflective floor chamber surrounds a glowing beacon while two drones sweep in synchronized arcs.", metrics);

  assert.equal(result.pass, true);
  assert.equal(result.compatibilityScore >= 95, true);
  assert.equal(result.environmentContinuityScore >= 95, true);
  assert.equal(result.reflectionLightingScore >= 95, true);
});

test("cross-domain diagnostics aggregate correctly", () => {
  const highMetrics = buildPromptDomainMetricSnapshot(buildPreviewDiagnostics(99));
  const lowMetrics = buildPromptDomainMetricSnapshot(buildPreviewDiagnostics(94));
  const summary = summarizeGovernedPromptDomainReports([
    {
      domainId: "DOMAIN_001",
      domainLabel: "ENERGY_PULSE_REACTOR",
      domainCategory: "ENERGY_PULSE",
      domainIndex: 1,
      totalDomains: 5,
      promptTemplate: "a",
      safety: classifyGovernedPromptDomainPrompt("energy core chamber drones"),
      safetyStatus: "APPROVED",
      executionStatus: "PASSED",
      pass: true,
      failureReason: null,
      compatibility: evaluatePromptDomainCompatibility("energy core chamber drones", highMetrics),
      metrics: highMetrics,
      strongestMetric: "sceneCohesion",
      weakestMetric: "sceneCohesion",
      failedThresholds: [],
      recommendedRuntimeLayer: null,
      rollbackVisible: true,
      rollbackRestoredDomain: false,
      rejectedDomainCount: 0,
      diagnostics: buildPreviewDiagnostics(99),
      prerequisiteBefore: null,
      prerequisiteAfter: null,
      microSequence: null,
      previewExecution: null,
      rollback: null,
    },
    {
      domainId: "DOMAIN_002",
      domainLabel: "SENTRY_PLATFORM_REVEAL",
      domainCategory: "SENTRY_FORMATION",
      domainIndex: 2,
      totalDomains: 5,
      promptTemplate: "b",
      safety: classifyGovernedPromptDomainPrompt("sentry platform chamber drones"),
      safetyStatus: "APPROVED",
      executionStatus: "FAILED",
      pass: false,
      failureReason: "scene coherence fell below threshold",
      compatibility: evaluatePromptDomainCompatibility("sentry platform chamber drones", lowMetrics),
      metrics: lowMetrics,
      strongestMetric: "sceneCohesion",
      weakestMetric: "sceneCohesion",
      failedThresholds: [],
      recommendedRuntimeLayer: "scene cohesion",
      rollbackVisible: true,
      rollbackRestoredDomain: true,
      rejectedDomainCount: 0,
      diagnostics: buildPreviewDiagnostics(94),
      prerequisiteBefore: null,
      prerequisiteAfter: null,
      microSequence: null,
      previewExecution: null,
      rollback: null,
    },
  ]);

  assert.equal(summary.testedDomainCount, 2);
  assert.equal(summary.passedDomainCount, 1);
  assert.equal(summary.averageSceneCohesion, 96.5);
  assert.equal(summary.averagePreviewReadability, 96.5);
  assert.equal(summary.recommendedNextAction, "TUNE_COHESION_LAYER");
});

test("failed domains do not mutate runtime state and keep rollback visible", async () => {
  const diagnostics = buildPreviewDiagnostics(94);
  const report = await runGovernedPromptDomainById(
    {
      domainId: "DOMAIN_001",
      governanceApproval: true,
      domainIndex: 1,
      totalDomains: 5,
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
  assert.equal(report.rollbackRestoredDomain, true);
  assert.equal(report.metrics?.sceneCohesion, 94);
});