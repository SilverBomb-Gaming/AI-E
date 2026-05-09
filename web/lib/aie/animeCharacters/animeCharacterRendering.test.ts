import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAnimeCharacterExecutionPlan,
  buildAnimeCharacterMetricSnapshot,
  buildGovernedAnimeCharacterHarnessState,
  evaluateAnimeCharacterCompatibility,
  listGovernedAnimeCharacterExpressions,
  listGovernedAnimeCharacterPoses,
  listGovernedAnimeCharacterProfiles,
  runGovernedAnimeCharacterRenderById,
  summarizeGovernedAnimeCharacterReports,
} from "./governedAnimeCharacterRendering";
import { classifyAnimeCharacterFailure } from "./animeCharacterFailureAnalyzer";
import { getApprovedAnimeCharacterProfileById, listApprovedAnimeCharacterProfiles } from "./animeCharacterProfileRegistry";
import { selectDefaultAnimeCharacterPose } from "./animeCharacterPoseTemplates";
import { recommendAnimeCharacterRecovery } from "./animeCharacterRecovery";

function buildPreviewDiagnostics(score: number, overrides?: Partial<Record<string, number | string | boolean>>) {
  return {
    recognizable_object: "anime character and beacon",
    object_relationship_summary: "character-centered governed scene",
    environment_profile: "supporting sci-fi chamber",
    lighting_profile: "face-readable chamber light",
    camera_profile: "character-centered framing",
    continuity_anchor_visualization: "character face and silhouette anchor",
    scene_readability_overlay: "readable anime character scene",
    beacon_influence_summary: "supporting beacon pulse",
    environmental_response_summary: "background supports character",
    reflection_shadow_summary: "bounded reflections",
    scene_believability_summary: "stable anime character scene",
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
    pose_readability_score: score,
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
    continuity_validation: { valid: true, blockers: [], summary: "ready" },
    next_step_action: null,
    next_step_label: null,
  };
}

async function runPassingCharacter(profileId: string) {
  const diagnostics = buildPreviewDiagnostics(98);
  return runGovernedAnimeCharacterRenderById(
    { characterProfileId: profileId, governanceApproval: true, characterApproval: true, characterIndex: 1, totalCharacters: 4 },
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
        continuity_validation: { valid: true, blockers: [], summary: "ready" },
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
        continuity_validation: { valid: true, blockers: [], summary: "ready" },
        execution_ledger_state: { ledger_id: "ledger-001", attempt_count: 1 },
        live_workspace_blocked_output: false,
        errors: [],
        blockers: [],
        prerequisite_state: buildReadyPrerequisiteState(diagnostics),
      }),
    },
  );
}

test("approved anime character profiles load deterministically", () => {
  const profiles = listGovernedAnimeCharacterProfiles();

  assert.deepEqual(profiles.map((entry) => entry.id), ["CHARACTER_001", "CHARACTER_002", "CHARACTER_003", "CHARACTER_004"]);
  assert.equal(profiles.every((entry) => entry.maxCastSize === 1 && !entry.dialogueAllowed && !entry.combatChoreographyAllowed), true);
  assert.equal(getApprovedAnimeCharacterProfileById("CHARACTER_001")?.label, "CELESTIAL_APPRENTICE");
});

test("pose and expression templates remain bounded and deterministic", () => {
  const poses = listGovernedAnimeCharacterPoses();
  const expressions = listGovernedAnimeCharacterExpressions();
  const profile = listApprovedAnimeCharacterProfiles()[0];

  assert.equal(poses.length, 6);
  assert.equal(expressions.length, 5);
  assert.equal(poses.every((entry) => !entry.uncontrolledLimbMotionAllowed && !entry.combatChoreographyAllowed), true);
  assert.equal(expressions.every((entry) => !entry.dialogueAllowed && !entry.mouthPerformanceAllowed), true);
  assert.equal(selectDefaultAnimeCharacterPose(profile.poseDefault).id, "NEUTRAL_HERO_STANCE");
});

test("anime character execution plan stays bounded", () => {
  const plan = buildAnimeCharacterExecutionPlan();

  assert.equal(plan.maxProfiles, 4);
  assert.equal(plan.maxCastSize, 1);
  assert.equal(plan.operatorTriggeredOnly, true);
  assert.equal(plan.characterApprovalRequired, true);
  assert.equal(plan.automaticRepeatAllowed, false);
  assert.equal(plan.automaticCastExpansionAllowed, false);
  assert.equal(plan.autonomousCharacterBehaviorAllowed, false);
  assert.equal(plan.dialogueAllowed, false);
  assert.equal(plan.lipSyncAllowed, false);
  assert.equal(plan.combatChoreographyAllowed, false);
  assert.equal(plan.longFormRenderingAllowed, false);
  assert.equal(plan.runtimeMutationAllowed, false);
});

test("character approval is mandatory before execution", async () => {
  let executeCalled = false;
  const report = await runGovernedAnimeCharacterRenderById(
    { characterProfileId: "CHARACTER_001", governanceApproval: true, characterApproval: false, characterIndex: 1, totalCharacters: 4 },
    {
      readPrerequisiteState: async () => buildReadyPrerequisiteState(),
      executeMicroSequence: async () => {
        executeCalled = true;
        throw new Error("character render should not execute without approval");
      },
    },
  );

  assert.equal(executeCalled, false);
  assert.equal(report.pass, false);
  assert.equal(report.safetyStatus, "REJECTED");
  assert.equal(report.microSequence, null);
  assert.equal(report.failureReason, "Anime character rendering requires explicit operator character approval before preview execution.");
});

test("face and silhouette diagnostics compute deterministically", () => {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_001");
  assert.ok(profile);
  const first = buildAnimeCharacterMetricSnapshot({ diagnostics: buildPreviewDiagnostics(98), profile });
  const second = buildAnimeCharacterMetricSnapshot({ diagnostics: buildPreviewDiagnostics(98), profile });

  assert.deepEqual(first, second);
  assert.equal((first?.characterFaceReadability ?? 0) >= 95, true);
  assert.equal((first?.characterSilhouette ?? 0) >= 95, true);
  assert.equal((first?.animeStyleIdentity ?? 0) >= 96, true);
});

test("approved character render executes bounded preview and reports anime diagnostics", async () => {
  const report = await runPassingCharacter("CHARACTER_001");

  assert.equal(report.pass, true);
  assert.equal(report.characterApproved, true);
  assert.equal(report.poseTemplateId, "NEUTRAL_HERO_STANCE");
  assert.equal(report.expressionTemplateId, "FOCUSED_DETERMINATION");
  assert.equal(report.animeCharacterRenderDiagnostics?.active_character_profile_id, "CHARACTER_001");
  assert.equal((report.metrics?.characterFaceReadability ?? 0) >= 95, true);
  assert.equal(report.rollbackVisible, true);
});

test("failed character renders preserve diagnostics and restore rollback", async () => {
  const diagnostics = buildPreviewDiagnostics(98, { readability_score: 92, focus_continuity_score: 90 });
  const report = await runGovernedAnimeCharacterRenderById(
    { characterProfileId: "CHARACTER_002", governanceApproval: true, characterApproval: true, characterIndex: 1, totalCharacters: 4 },
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
        continuity_validation: { valid: true, blockers: [], summary: "ready" },
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
        continuity_validation: { valid: true, blockers: [], summary: "ready" },
        execution_ledger_state: { ledger_id: "ledger-002", attempt_count: 1 },
        live_workspace_blocked_output: false,
        errors: [],
        blockers: [],
        prerequisite_state: buildReadyPrerequisiteState(diagnostics),
      }),
      rollbackPreviewSandbox: async () => ({ status: "rolled_back", sandbox_path: ".aie/preview", deleted_output_targets: [".aie/preview/frame_001.png"], rollback_status: "Rollback completed.", sandbox_limited: true }),
    },
  );

  assert.equal(report.pass, false);
  assert.equal(report.rollbackRestoredCharacterRun, true);
  assert.equal(report.failureAnalysis?.failureType, "FACE_READABILITY_DROP");
  assert.equal(report.recoveryRecommendation?.autonomousTuningAllowed, false);
  assert.equal(report.animeCharacterRenderDiagnostics?.rollback_restored_character_run, true);
});

test("failure analyzer and recovery recommend bounded character framing changes", () => {
  const analysis = classifyAnimeCharacterFailure({
    metrics: null,
    failedThresholds: [{ metric: "animeStyleIdentity", actual: 91, required: ">=96", recommendedRuntimeLayer: "anime identity", reason: "Anime style identity was too weak to be obvious as a character render." }],
  });
  const recovery = recommendAnimeCharacterRecovery(analysis);

  assert.equal(analysis?.failureType, "STYLE_IDENTITY_WEAK");
  assert.equal(recovery?.targetLayer, "anime style identity");
  assert.equal(recovery?.operatorReviewRequired, true);
});

test("character renders cannot auto-repeat from prior reports", async () => {
  const priorReport = { characterProfileId: "CHARACTER_001", microSequence: {} as never, pass: true } as never;
  let executeCalled = false;
  const report = await runGovernedAnimeCharacterRenderById(
    { characterProfileId: "CHARACTER_001", governanceApproval: true, characterApproval: true, characterIndex: 1, totalCharacters: 4, priorReports: [priorReport] },
    {
      readPrerequisiteState: async () => buildReadyPrerequisiteState(),
      executeMicroSequence: async () => {
        executeCalled = true;
        throw new Error("repeat should be blocked");
      },
    },
  );

  assert.equal(executeCalled, false);
  assert.equal(report.pass, false);
  assert.equal(report.failureReason?.includes("cannot auto-repeat"), true);
});

test("cross-character diagnostics summarize strongest and weakest profiles", async () => {
  const first = await runPassingCharacter("CHARACTER_001");
  const second = await runPassingCharacter("CHARACTER_002");
  const summary = summarizeGovernedAnimeCharacterReports([first, second]);
  const state = buildGovernedAnimeCharacterHarnessState([first, second]);

  assert.equal(summary.testedCharacterCount, 2);
  assert.equal(summary.passedCharacterCount, 2);
  assert.equal(summary.rollbackPassRate, 1);
  assert.equal(summary.strongestCharacterProfileId, "CHARACTER_001");
  assert.equal(summary.weakestCharacterProfileId, "CHARACTER_002");
  assert.equal(summary.recommendedNextAction, "CONTINUE_CHARACTER_RENDERS");
  assert.equal(state?.characterRenderExecutionCount, 2);
});

test("anime character compatibility passes when character metrics meet governed floors", () => {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_001");
  assert.ok(profile);
  const metrics = buildAnimeCharacterMetricSnapshot({ diagnostics: buildPreviewDiagnostics(98), profile });

  const result = evaluateAnimeCharacterCompatibility({ profile, metrics, characterApproved: true });

  assert.equal(result.pass, true);
  assert.equal(result.compatibilityScore >= 95, true);
});
