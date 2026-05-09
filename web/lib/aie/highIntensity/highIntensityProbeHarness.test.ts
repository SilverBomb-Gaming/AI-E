import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGovernedHighIntensityHarnessState,
  buildHighIntensityExecutionPlan,
  buildHighIntensityMetricSnapshot,
  evaluateHighIntensityCompatibility,
  listGovernedHighIntensityProbeCells,
  runGovernedHighIntensityProbeById,
  summarizeGovernedHighIntensityReports,
} from "./governedHighProbeHarness";
import { buildHighIntensityVisualCaps } from "./highIntensityVisualCaps";
import { classifyHighIntensityFailure } from "./highIntensityFailureAnalyzer";
import { recommendHighIntensityRecovery } from "./highIntensityRecovery";

function buildPreviewDiagnostics(score: number, overrides?: Partial<Record<string, number | string | boolean>>) {
  return {
    recognizable_object: "segmented drones and beacon",
    object_relationship_summary: "bounded high probe scene",
    environment_profile: "foggy chamber",
    lighting_profile: "stable chamber light",
    camera_profile: "governed chamber rig",
    continuity_anchor_visualization: "beacon anchor",
    scene_readability_overlay: "readable high intensity scene",
    beacon_influence_summary: "bounded high pulse",
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

function buildStyle(styleId: string) {
  return {
    id: styleId,
    label: styleId === "STYLE_003" ? "ANIME_INSPIRED" : styleId,
    category: styleId === "STYLE_003" ? "ANIME_INSPIRED" as const : "CINEMATIC_SCI_FI" as const,
    characteristics: [],
    description: "",
    prompt: "",
    subject: "",
    motion_intent: "",
    style: "",
    duration_seconds: 2,
    resolution: "720p" as const,
    continuity_priority: "high" as const,
    package_gif_preview: true,
  };
}

test("HIGH probe matrix exposes exactly the approved four HIGH styles", () => {
  const cells = listGovernedHighIntensityProbeCells();

  assert.deepEqual(cells.map((entry) => entry.probeId), [
    "ANIME_INSPIRED_HIGH",
    "NEON_DYSTOPIAN_HIGH",
    "ATMOSPHERIC_PAINTERLY_HIGH",
    "INDUSTRIAL_REALISM_HIGH",
  ]);
  assert.equal(cells.every((entry) => entry.intensityLevel === "HIGH" && entry.approvalRequired), true);
});

test("HIGH execution plan stays bounded and disables escalation", () => {
  const plan = buildHighIntensityExecutionPlan();

  assert.equal(plan.maxHighProbes, 4);
  assert.equal(plan.operatorTriggeredOnly, true);
  assert.equal(plan.highApprovalRequired, true);
  assert.equal(plan.automaticRepeatAllowed, false);
  assert.equal(plan.automaticEscalationAllowed, false);
  assert.equal(plan.unrestrictedHighGenerationAllowed, false);
  assert.equal(plan.extremeModeAllowed, false);
  assert.equal(plan.humanoidsAllowed, false);
  assert.equal(plan.dialogueAllowed, false);
  assert.equal(plan.longFormRenderingAllowed, false);
  assert.equal(plan.runtimeMutationAllowed, false);
  assert.equal(plan.recoveryAutoTuningAllowed, false);
});

test("visual safety caps apply deterministically and remain operator visible", () => {
  const caps = buildHighIntensityVisualCaps(buildStyle("STYLE_003"));
  const secondCaps = buildHighIntensityVisualCaps(buildStyle("STYLE_003"));

  assert.deepEqual(caps, secondCaps);
  assert.equal(caps.capProfileId, "anime-inspired-high-caps");
  assert.equal(caps.deterministic, true);
  assert.equal(caps.operatorVisible, true);
  assert.equal(caps.mutationAllowed, false);
  assert.equal(caps.visibleCaps.includes("preserve silhouette readability"), true);
});

test("HIGH approval is mandatory before execution", async () => {
  let executeCalled = false;
  const report = await runGovernedHighIntensityProbeById(
    {
      probeId: "ANIME_INSPIRED_HIGH",
      governanceApproval: true,
      highProbeApproval: false,
      probeIndex: 1,
      totalProbes: 4,
    },
    {
      readPrerequisiteState: async () => buildReadyPrerequisiteState(),
      executeMicroSequence: async () => {
        executeCalled = true;
        throw new Error("HIGH probe should not execute without explicit approval.");
      },
    },
  );

  assert.equal(executeCalled, false);
  assert.equal(report.pass, false);
  assert.equal(report.safetyStatus, "REJECTED");
  assert.equal(report.microSequence, null);
  assert.equal(report.failureReason, "HIGH probes require explicit operator HIGH approval before preview execution.");
});

test("approved HIGH probe executes bounded preview and preserves rollback visibility", async () => {
  const diagnostics = buildPreviewDiagnostics(98);
  const report = await runGovernedHighIntensityProbeById(
    {
      probeId: "NEON_DYSTOPIAN_HIGH",
      governanceApproval: true,
      highProbeApproval: true,
      probeIndex: 1,
      totalProbes: 4,
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
    },
  );

  assert.equal(report.pass, true);
  assert.equal(report.highProbeApproved, true);
  assert.equal(report.visualCaps.capProfileId, "neon-dystopian-high-caps");
  assert.equal(report.rollbackSnapshot?.approvalState.automaticEscalationAllowed, false);
  assert.equal(report.rollbackVisible, true);
  assert.equal(report.metrics?.rollbackIntegrityStatus, "PASS");
});

test("failed HIGH probes preserve diagnostics and restore rollback", async () => {
  const diagnostics = buildPreviewDiagnostics(98, {
    silhouette_readability_score: 91,
  });
  const report = await runGovernedHighIntensityProbeById(
    {
      probeId: "ANIME_INSPIRED_HIGH",
      governanceApproval: true,
      highProbeApproval: true,
      probeIndex: 1,
      totalProbes: 4,
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
  assert.equal(report.rollbackRestoredHighProbe, true);
  assert.equal(report.failureAnalysis?.failureType, "SILHOUETTE_COLLAPSE");
  assert.equal(report.recoveryRecommendation?.autonomousTuningAllowed, false);
  assert.equal(report.diagnostics?.silhouette_readability_score, 91);
});

test("failure analyzer and recovery recommendations classify aggressive HIGH failures", () => {
  const metrics = buildHighIntensityMetricSnapshot(buildPreviewDiagnostics(98, {
    reflection_continuity_score: 90,
  }));
  assert.ok(metrics);
  const analysis = classifyHighIntensityFailure({
    styleId: "STYLE_004",
    domainId: "DOMAIN_004",
    metrics,
    failedThresholds: [
      {
        metric: "reflectionContinuity",
        actual: 90,
        required: ">=94",
        recommendedRuntimeLayer: "reflection continuity",
        reason: "HIGH probe reflection continuity became noisy below the governed floor.",
      },
    ],
  });
  const recommendation = recommendHighIntensityRecovery(analysis);

  assert.equal(analysis?.failureType, "REFLECTION_NOISE");
  assert.equal(recommendation?.targetCap, "reflectionAmplificationCap");
  assert.equal(recommendation?.operatorReviewRequired, true);
});

test("HIGH probes cannot auto-repeat from prior reports", async () => {
  const priorReport = {
    probeId: "ANIME_INSPIRED_HIGH" as const,
    microSequence: {} as never,
    pass: true,
  } as never;
  let executeCalled = false;
  const report = await runGovernedHighIntensityProbeById(
    {
      probeId: "ANIME_INSPIRED_HIGH",
      governanceApproval: true,
      highProbeApproval: true,
      probeIndex: 1,
      totalProbes: 4,
      priorReports: [priorReport],
    },
    {
      readPrerequisiteState: async () => buildReadyPrerequisiteState(),
      executeMicroSequence: async () => {
        executeCalled = true;
        throw new Error("repeats are blocked before execution");
      },
    },
  );

  assert.equal(executeCalled, false);
  assert.equal(report.pass, false);
  assert.equal(report.failureReason?.includes("cannot auto-repeat"), true);
});

test("cross-HIGH diagnostics summarize safest and riskiest probes", async () => {
  const passDiagnostics = buildPreviewDiagnostics(98);
  const failDiagnostics = buildPreviewDiagnostics(96, { lighting_stability_score: 92 });
  const passed = await runGovernedHighIntensityProbeById(
    {
      probeId: "ANIME_INSPIRED_HIGH",
      governanceApproval: true,
      highProbeApproval: true,
      probeIndex: 1,
      totalProbes: 4,
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
        preview_diagnostics: passDiagnostics,
        continuity_validation: { valid: true, blockers: [], summary: "ready" },
        preview_cleanup_targets: [],
        live_workspace_blocked_output: true,
        errors: [],
        blockers: [],
        prerequisite_state: buildReadyPrerequisiteState(passDiagnostics),
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
        preview_diagnostics: passDiagnostics,
        continuity_validation: { valid: true, blockers: [], summary: "ready" },
        execution_ledger_state: { ledger_id: "ledger-001", attempt_count: 1 },
        live_workspace_blocked_output: false,
        errors: [],
        blockers: [],
        prerequisite_state: buildReadyPrerequisiteState(passDiagnostics),
      }),
    },
  );
  const failed = await runGovernedHighIntensityProbeById(
    {
      probeId: "NEON_DYSTOPIAN_HIGH",
      governanceApproval: true,
      highProbeApproval: true,
      probeIndex: 2,
      totalProbes: 4,
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
        preview_diagnostics: failDiagnostics,
        continuity_validation: { valid: true, blockers: [], summary: "ready" },
        preview_cleanup_targets: [],
        live_workspace_blocked_output: true,
        errors: [],
        blockers: [],
        prerequisite_state: buildReadyPrerequisiteState(failDiagnostics),
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
        preview_diagnostics: failDiagnostics,
        continuity_validation: { valid: true, blockers: [], summary: "ready" },
        execution_ledger_state: { ledger_id: "ledger-002", attempt_count: 1 },
        live_workspace_blocked_output: false,
        errors: [],
        blockers: [],
        prerequisite_state: buildReadyPrerequisiteState(failDiagnostics),
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

  const summary = summarizeGovernedHighIntensityReports([passed, failed]);
  const state = buildGovernedHighIntensityHarnessState([passed, failed]);

  assert.equal(summary.testedHighProbeCount, 2);
  assert.equal(summary.passedHighProbeCount, 1);
  assert.equal(summary.failedHighProbeCount, 1);
  assert.equal(summary.safestHighStyleId, "STYLE_003");
  assert.equal(summary.riskiestHighStyleId, "STYLE_004");
  assert.equal(summary.recommendedNextAction, "TUNE_VISUAL_CAPS");
  assert.equal(state?.failedHighProbeCount, 1);
  assert.equal(state?.lastFailureType, "LIGHTING_OVERLOAD");
});

test("approved HIGH compatibility passes when all success metrics meet governed floors", () => {
  const cell = listGovernedHighIntensityProbeCells()[0];
  const metrics = buildHighIntensityMetricSnapshot(buildPreviewDiagnostics(98));
  assert.ok(metrics);

  const result = evaluateHighIntensityCompatibility({
    cell,
    metrics,
    highProbeApproved: true,
  });

  assert.equal(result.pass, true);
  assert.equal(result.compatibilityScore >= 95, true);
});
