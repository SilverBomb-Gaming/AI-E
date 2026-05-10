import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
import { selectDefaultAnimeCharacterExpression, selectDefaultAnimeCharacterPose } from "./animeCharacterPoseTemplates";
import { recommendAnimeCharacterRecovery } from "./animeCharacterRecovery";
import { buildFallbackPrimitiveTruthCheck, executeAnimeCharacterPrimitiveRender } from "./animeCharacterPrimitiveRenderer";

async function createTempRoot() {
  return mkdtemp(path.join(tmpdir(), "aie-anime-character-"));
}

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
  const root = await createTempRoot();
  return runGovernedAnimeCharacterRenderById(
    { root, characterProfileId: profileId, governanceApproval: true, characterApproval: true, characterIndex: 1, totalCharacters: 4 },
    {
      readPrerequisiteState: async () => buildReadyPrerequisiteState(),
    },
  );
}

test("approved anime character profiles load deterministically", () => {
  const profiles = listGovernedAnimeCharacterProfiles();

  assert.deepEqual(profiles.map((entry) => entry.id), ["CHARACTER_001", "CHARACTER_002", "CHARACTER_003", "CHARACTER_004", "CHARACTER_005"]);
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

  assert.equal(plan.maxProfiles, 5);
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
  assert.equal(report.scaffoldStatus, "REAL_OUTPUT_ACTIVE");
  assert.equal(report.truthCheck.renderer_path, "CHARACTER_FIRST");
  assert.equal(report.truthCheck.character_pixels_generated, true);
  assert.equal(report.truthCheck.character_primary_subject, true);
  assert.equal(report.truthCheck.fallback_primitive_dominance, false);
  assert.equal(report.truthCheck.diagnostics_match_rendered_output, true);
  assert.notEqual(report.diagnostics?.active_beat_type, "BEACON_REVEAL");
  assert.equal(report.diagnostics?.active_focus_subject, "CHARACTER_FACE");
  assert.equal(report.diagnostics?.anime_visual_fidelity_diagnostics?.fidelity_tier, "EARLY_ANIME");
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.visual_fidelity_score ?? 0) >= 90, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.body_silhouette_score ?? 0) >= 88, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.torso_readability_score ?? 0) >= 88, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.arm_readability_score ?? 0) >= 85, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.hand_readability_score ?? 0) >= 80, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.outfit_flow_score ?? 0) >= 88, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.pose_frame_consistency ?? 0) >= 90, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.lower_body_readability ?? 0) >= 88, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.foot_grounding_score ?? 0) >= 82, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.stance_grounding_score ?? 0) >= 90, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.motion_continuity_score ?? 0) >= 90, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.animation_smoothness_score ?? 0) >= 90, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.expression_readability_score ?? 0) >= 88, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.blink_readability_score ?? 0) >= 85, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.gaze_stability_score ?? 0) >= 90, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.face_liveliness_score ?? 0) >= 85, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.hair_motion_score ?? 0) >= 88, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.cloth_motion_score ?? 0) >= 86, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.secondary_motion_continuity ?? 0) >= 90, true);
  assert.equal(report.diagnostics?.anime_visual_fidelity_diagnostics?.motion_jitter_risk, "LOW");
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.camera_framing_score ?? 0) >= 88, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.face_framing_priority ?? 0) >= 90, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.eye_visibility_score ?? 0) >= 92, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.character_dominance_score ?? 0) >= 92, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.cinematic_composition_score ?? 0) >= 88, true);
  assert.equal(report.diagnostics?.anime_visual_fidelity_diagnostics?.framing_jitter_risk, "LOW");
  assert.equal(report.diagnostics?.anime_visual_fidelity_diagnostics?.lighting_mood, "COOL_SCI_FI_BACKLIGHT");
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.rim_light_score ?? 0) >= 90, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.eye_highlight_score ?? 0) >= 92, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.face_lighting_score ?? 0) >= 92, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.character_background_contrast ?? 0) >= 92, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.beacon_glow_control ?? 0) >= 90, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.atmosphere_depth_score ?? 0) >= 92, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.color_mood_score ?? 0) >= 92, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.lighting_continuity_score ?? 0) >= 94, true);
  assert.equal(report.diagnostics?.anime_visual_fidelity_diagnostics?.lighting_flicker_risk, "LOW");
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.shoulder_articulation_score ?? 0) >= 86, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.elbow_readability_score ?? 0) >= 84, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.hand_shape_readability_score ?? 0) >= 82, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.pose_energy_score ?? 0) >= 84, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.silhouette_flow_score ?? 0) >= 86, true);
  assert.equal(["LOW", "MEDIUM"].includes(report.diagnostics?.anime_visual_fidelity_diagnostics?.anatomy_primitive_risk ?? "HIGH"), true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.torso_structure_score ?? 0) >= 88, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.outfit_layering_score ?? 0) >= 88, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.clothing_readability_score ?? 0) >= 88, true);
  assert.equal(["LOW", "MEDIUM"].includes(report.diagnostics?.anime_visual_fidelity_diagnostics?.clothing_flatness_risk ?? "HIGH"), true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.temporal_smoothing_score ?? 0) >= 88, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.overlapping_action_score ?? 0) >= 86, true);
  assert.equal((report.diagnostics?.anime_visual_fidelity_diagnostics?.motion_arc_consistency ?? 0) >= 88, true);
  assert.equal(["LOW", "MEDIUM"].includes(report.diagnostics?.anime_visual_fidelity_diagnostics?.frame_snap_risk ?? "HIGH"), true);
  assert.equal(report.diagnostics?.anime_visual_fidelity_diagnostics?.temporal_jitter_risk, "LOW");
  assert.equal(report.diagnostics?.artifact_diagnostics.some((entry) => entry === "fidelity_tier=EARLY_ANIME"), true);
  assert.equal(report.diagnostics?.artifact_diagnostics.some((entry) => entry === "motion_jitter_risk=LOW"), true);
  assert.equal(report.diagnostics?.artifact_diagnostics.some((entry) => entry === "framing_jitter_risk=LOW"), true);
  assert.equal(report.diagnostics?.artifact_diagnostics.some((entry) => entry === "lighting_flicker_risk=LOW"), true);
  assert.equal(report.diagnostics?.artifact_diagnostics.some((entry) => entry.startsWith("anatomy_primitive_risk=")), true);
  assert.equal(report.diagnostics?.artifact_diagnostics.some((entry) => entry.startsWith("torso_structure_score=")), true);
  assert.equal(report.diagnostics?.artifact_diagnostics.some((entry) => entry.startsWith("clothing_flatness_risk=")), true);
  assert.equal(report.diagnostics?.artifact_diagnostics.some((entry) => entry.startsWith("temporal_smoothing_score=")), true);
  assert.equal(report.diagnostics?.artifact_diagnostics.some((entry) => entry === "temporal_jitter_risk=LOW"), true);
  assert.equal(report.visualReviewPackage?.reviewLabel, "USER_VISUAL_CHECK_READY");
  assert.equal(report.characterApproved, true);
  assert.equal(report.poseTemplateId, "NEUTRAL_HERO_STANCE");
  assert.equal(report.expressionTemplateId, "FOCUSED_DETERMINATION");
  assert.equal(report.animeCharacterRenderDiagnostics?.active_character_profile_id, "CHARACTER_001");
  assert.equal(report.animeCharacterRenderDiagnostics?.anime_character_truth_check.renderer_path, "CHARACTER_FIRST");
  assert.equal((report.metrics?.characterFaceReadability ?? 0) >= 95, true);
  assert.equal(report.rollbackVisible, true);
  assert.ok(report.visualReviewPackage?.firstPngToInspect?.endsWith("anime_character_frame_001.png"));
  assert.ok(report.visualReviewPackage?.gifToInspect?.endsWith("anime_character_preview.gif"));
  assert.ok(report.visualReviewPackage?.manifestPath?.endsWith("anime_character_manifest.json"));
  assert.ok(report.visualReviewPackage?.diagnosticsPath?.endsWith("anime_character_diagnostics.json"));
  assert.ok(report.visualReviewPackage?.operatorSummaryPath?.endsWith("operator_visual_review_summary.md"));
  assert.ok(report.previewExecution?.generated_preview_references.some((entry) => entry.endsWith("anime_character_frame_001.png")));
  assert.equal(report.previewExecution?.generated_preview_references.some((entry) => entry.includes("governed_motion_preview_frame")), false);
});

test("character-first renderer writes inspectable PNG GIF manifest diagnostics and summary", async () => {
  const root = await createTempRoot();
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_001");
  assert.ok(profile);
  const result = await executeAnimeCharacterPrimitiveRender({
    root,
    profile,
    poseTemplate: selectDefaultAnimeCharacterPose(profile.poseDefault),
    expressionTemplate: selectDefaultAnimeCharacterExpression(profile.expressionDefault),
    packageGifPreview: true,
  });

  assert.equal(result.truthCheck.scaffold_status, "REAL_OUTPUT_ACTIVE");
  assert.equal(result.visualReviewPackage.reviewLabel, "USER_VISUAL_CHECK_READY");
  assert.equal(result.framePaths.length, 5);
  assert.ok(result.firstPngPath);
  assert.ok(result.gifPath);
  assert.ok(result.manifestPath);
  assert.ok(result.diagnosticsPath);
  assert.ok(result.operatorSummaryPath);

  for (const artifactPath of [result.firstPngPath, result.gifPath, result.manifestPath, result.diagnosticsPath, result.operatorSummaryPath]) {
    assert.ok(artifactPath);
    const artifact = await stat(path.join(root, artifactPath));
    assert.equal(artifact.size > 0, true);
  }

  const manifest = JSON.parse(await readFile(path.join(root, result.manifestPath), "utf8"));
  assert.equal(manifest.primary_subject, "ANIME_CHARACTER");
  assert.equal(manifest.focus_subject, "CHARACTER_FACE");
  assert.equal(manifest.anime_character_truth_check.renderer_path, "CHARACTER_FIRST");
  assert.equal(manifest.anime_character_truth_check.fallback_primitive_dominance, false);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.fidelity_tier, "EARLY_ANIME");
  assert.equal(manifest.anime_visual_fidelity_diagnostics.visual_fidelity_score >= 90, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.body_silhouette_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.torso_readability_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.arm_readability_score >= 85, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.hand_readability_score >= 80, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.pose_language_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.outfit_flow_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.limb_continuity_score >= 90, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.hand_position_stability >= 90, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.pose_frame_consistency >= 90, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.lower_body_readability >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.foot_grounding_score >= 82, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.stance_grounding_score >= 90, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.waist_transition_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.motion_continuity_score >= 90, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.frame_interpolation_score >= 90, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.fabric_motion_score >= 90, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.animation_smoothness_score >= 90, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.expression_readability_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.blink_readability_score >= 85, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.gaze_stability_score >= 90, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.mouth_readability_score >= 85, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.eyebrow_readability_score >= 85, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.expression_frame_consistency >= 90, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.face_liveliness_score >= 85, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.hair_motion_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.bang_motion_readability >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.side_lock_continuity >= 90, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.cloth_motion_score >= 86, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.jacket_sway_readability >= 86, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.secondary_motion_continuity >= 90, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.motion_jitter_risk, "LOW");
  assert.equal(manifest.anime_visual_fidelity_diagnostics.camera_framing_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.face_framing_priority >= 90, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.eye_visibility_score >= 92, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.character_dominance_score >= 92, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.cinematic_composition_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.framing_jitter_risk, "LOW");
  assert.equal(manifest.anime_visual_fidelity_diagnostics.lighting_mood, "COOL_SCI_FI_BACKLIGHT");
  assert.equal(manifest.anime_visual_fidelity_diagnostics.rim_light_score >= 90, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.eye_highlight_score >= 92, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.face_lighting_score >= 92, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.character_background_contrast >= 92, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.beacon_glow_control >= 90, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.atmosphere_depth_score >= 92, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.color_mood_score >= 92, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.lighting_continuity_score >= 94, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.lighting_flicker_risk, "LOW");
  assert.equal(manifest.anime_visual_fidelity_diagnostics.shoulder_articulation_score >= 86, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.elbow_readability_score >= 84, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.hand_shape_readability_score >= 82, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.pose_energy_score >= 84, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.silhouette_flow_score >= 86, true);
  assert.equal(["LOW", "MEDIUM"].includes(manifest.anime_visual_fidelity_diagnostics.anatomy_primitive_risk), true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.torso_structure_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.waist_flow_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.outfit_layering_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.clothing_readability_score >= 88, true);
  assert.equal(["LOW", "MEDIUM"].includes(manifest.anime_visual_fidelity_diagnostics.clothing_flatness_risk), true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.temporal_smoothing_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.overlapping_action_score >= 86, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.motion_arc_consistency >= 88, true);
  assert.equal(["LOW", "MEDIUM"].includes(manifest.anime_visual_fidelity_diagnostics.frame_snap_risk), true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.temporal_jitter_risk, "LOW");
  assert.equal(manifest.first_png_to_inspect.endsWith("anime_character_frame_001.png"), true);
});

test("solar crimson render exports confident body pose polish diagnostics", async () => {
  const root = await createTempRoot();
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_005");
  assert.ok(profile);
  const result = await executeAnimeCharacterPrimitiveRender({
    root,
    profile,
    poseTemplate: selectDefaultAnimeCharacterPose(profile.poseDefault),
    expressionTemplate: selectDefaultAnimeCharacterExpression(profile.expressionDefault),
    packageGifPreview: true,
  });

  const manifest = JSON.parse(await readFile(path.join(root, result.manifestPath ?? ""), "utf8"));
  assert.equal(manifest.character_profile_id, "CHARACTER_005");
  assert.equal(manifest.character_label, "SOLAR_CRIMSON_SENTINEL");
  assert.equal(manifest.anime_character_truth_check.fallback_primitive_dominance, false);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.body_silhouette_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.torso_readability_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.arm_readability_score >= 85, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.hand_readability_score >= 80, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.outfit_flow_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.lower_body_readability >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.foot_grounding_score >= 82, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.motion_continuity_score >= 90, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.animation_smoothness_score >= 90, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.expression_readability_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.blink_readability_score >= 85, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.face_liveliness_score >= 85, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.hair_motion_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.cloth_motion_score >= 86, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.secondary_motion_continuity >= 90, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.motion_jitter_risk, "LOW");
  assert.equal(manifest.anime_visual_fidelity_diagnostics.shot_preset, "SUBTLE_PUSH_IN");
  assert.equal(manifest.anime_visual_fidelity_diagnostics.camera_framing_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.face_framing_priority >= 90, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.eye_visibility_score >= 92, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.character_dominance_score >= 92, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.background_depth_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.cinematic_composition_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.framing_jitter_risk, "LOW");
  assert.equal(manifest.anime_visual_fidelity_diagnostics.lighting_mood, "CRIMSON_HERO_CONTRAST");
  assert.equal(manifest.anime_visual_fidelity_diagnostics.rim_light_score >= 92, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.eye_highlight_score >= 94, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.face_lighting_score >= 94, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.character_background_contrast >= 94, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.beacon_glow_control >= 90, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.atmosphere_depth_score >= 92, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.color_mood_score >= 93, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.lighting_continuity_score >= 94, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.lighting_flicker_risk, "LOW");
  assert.equal(manifest.anime_visual_fidelity_diagnostics.shoulder_articulation_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.elbow_readability_score >= 84, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.wrist_hand_connection_score >= 84, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.hand_shape_readability_score >= 82, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.hip_knee_articulation_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.foot_pose_readability_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.pose_energy_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.silhouette_flow_score >= 88, true);
  assert.equal(["LOW", "MEDIUM"].includes(manifest.anime_visual_fidelity_diagnostics.anatomy_primitive_risk), true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.torso_structure_score >= 90, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.waist_flow_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.pelvis_balance_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.outfit_layering_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.clothing_readability_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.silhouette_motion_score >= 90, true);
  assert.equal(["LOW", "MEDIUM"].includes(manifest.anime_visual_fidelity_diagnostics.torso_stiffness_risk), true);
  assert.equal(["LOW", "MEDIUM"].includes(manifest.anime_visual_fidelity_diagnostics.clothing_flatness_risk), true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.temporal_smoothing_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.easing_curve_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.anticipation_readability_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.follow_through_score >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.overlapping_action_score >= 86, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.motion_arc_consistency >= 88, true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.settle_quality_score >= 88, true);
  assert.equal(["LOW", "MEDIUM"].includes(manifest.anime_visual_fidelity_diagnostics.frame_snap_risk), true);
  assert.equal(manifest.anime_visual_fidelity_diagnostics.temporal_jitter_risk, "LOW");
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => (entry.pose_frame_consistency ?? 0) >= 90), true);
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => (entry.foot_grounding_score ?? 0) >= 82), true);
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => (entry.animation_smoothness_score ?? 0) >= 90), true);
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => (entry.blink_readability_score ?? 0) >= 85), true);
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => (entry.face_liveliness_score ?? 0) >= 85), true);
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => entry.lighting_mood === "CRIMSON_HERO_CONTRAST"), true);
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => (entry.rim_light_score ?? 0) >= 92), true);
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => (entry.eye_highlight_score ?? 0) >= 94), true);
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => entry.lighting_flicker_risk === "LOW"), true);
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => (entry.shoulder_articulation_score ?? 0) >= 88), true);
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => (entry.hand_shape_readability_score ?? 0) >= 82), true);
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => ["LOW", "MEDIUM"].includes(entry.anatomy_primitive_risk ?? "HIGH")), true);
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => (entry.torso_structure_score ?? 0) >= 90), true);
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => (entry.outfit_layering_score ?? 0) >= 88), true);
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => (entry.silhouette_motion_score ?? 0) >= 90), true);
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => ["LOW", "MEDIUM"].includes(entry.clothing_flatness_risk ?? "HIGH")), true);
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => (entry.temporal_smoothing_score ?? 0) >= 88), true);
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => (entry.overlapping_action_score ?? 0) >= 86), true);
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => (entry.motion_arc_consistency ?? 0) >= 88), true);
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => entry.temporal_jitter_risk === "LOW"), true);
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => (entry.hair_motion_score ?? 0) >= 88), true);
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => (entry.cloth_motion_score ?? 0) >= 86), true);
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => entry.motion_jitter_risk === "LOW"), true);
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => (entry.camera_framing_score ?? 0) >= 88), true);
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => (entry.eye_visibility_score ?? 0) >= 92), true);
  assert.equal(result.diagnostics.frame_diagnostics.every((entry) => entry.framing_jitter_risk === "LOW"), true);
  assert.equal(result.visualReviewPackage.visualReviewNotes.some((entry) => entry.includes("planned shoulders")), true);
  assert.equal(result.visualReviewPackage.visualReviewNotes.some((entry) => entry.includes("grounded boots")), true);
  assert.equal(result.visualReviewPackage.visualReviewNotes.some((entry) => entry.includes("partial blink")), true);
  assert.equal(result.visualReviewPackage.visualReviewNotes.some((entry) => entry.includes("coordinated hair sway")), true);
  assert.equal(result.visualReviewPackage.visualReviewNotes.some((entry) => entry.includes("face-priority framing")), true);
  assert.equal(result.visualReviewPackage.visualReviewNotes.some((entry) => entry.includes("waist seam")), true);
  assert.equal(result.visualReviewPackage.visualReviewNotes.some((entry) => entry.includes("EARLY_ANIME_TORSO_CLOTHING_STRUCTURE_ACTIVE")), true);
  assert.equal(result.visualReviewPackage.visualReviewNotes.some((entry) => entry.includes("anticipation into the pose shift")), true);
  assert.equal(result.visualReviewPackage.visualReviewNotes.some((entry) => entry.includes("EARLY_ANIME_TEMPORAL_SMOOTHING_ACTIVE")), true);
});

test("fallback primitive truth check cannot pass anime character compatibility", () => {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_001");
  assert.ok(profile);
  const metrics = buildAnimeCharacterMetricSnapshot({ diagnostics: buildPreviewDiagnostics(98), profile });
  const truthCheck = buildFallbackPrimitiveTruthCheck({ generatedPaths: [".aie/governed_motion_preview_sandbox/governed_motion_preview_frame_001.png"], recognizableObject: "cube and beacon", focusSubject: "cube" });

  const result = evaluateAnimeCharacterCompatibility({ profile, metrics, characterApproved: true, truthCheck });

  assert.equal(result.pass, false);
  assert.equal(result.truthCheck.fallback_primitive_dominance, true);
  assert.equal(result.recommendedRuntimeLayer, "character-first renderer truth check");
  assert.equal(result.reasons.some((entry) => entry.includes("Fallback cube/beacon/drone")), true);
});

test("failed character renders preserve diagnostics and restore rollback", async () => {
  const root = await createTempRoot();
  const fallbackTruthCheck = buildFallbackPrimitiveTruthCheck({ generatedPaths: [".aie/governed_motion_preview_sandbox/governed_motion_preview_frame_001.png"], recognizableObject: "cube beacon drone", focusSubject: "cube" });
  const report = await runGovernedAnimeCharacterRenderById(
    { root, characterProfileId: "CHARACTER_002", governanceApproval: true, characterApproval: true, characterIndex: 1, totalCharacters: 4 },
    {
      readPrerequisiteState: async () => buildReadyPrerequisiteState(),
      executeCharacterRenderer: async (renderInput) => {
        const result = await executeAnimeCharacterPrimitiveRender(renderInput);
        return {
          ...result,
          metrics: { ...result.metrics, characterFaceReadability: 92, characterSilhouette: 92, animeStyleIdentity: 91 },
          truthCheck: fallbackTruthCheck,
          diagnostics: { ...result.diagnostics, recognizable_object: "cube beacon drone fallback", anime_character_truth_check: fallbackTruthCheck },
          visualReviewPackage: {
            ...result.visualReviewPackage,
            reviewLabel: "NOT_READY_SCAFFOLD_FALLBACK_STILL_ACTIVE",
            characterVisible: false,
            characterPrimarySubject: false,
            fallbackPrimitiveDominance: true,
          },
        };
      },
      rollbackPreviewSandbox: async () => ({ status: "rolled_back", sandbox_path: ".aie/preview", deleted_output_targets: [".aie/preview/frame_001.png"], rollback_status: "Rollback completed.", sandbox_limited: true }),
    },
  );

  assert.equal(report.pass, false);
  assert.equal(report.scaffoldStatus, "SCAFFOLD_ACTIVE");
  assert.equal(report.truthCheck.renderer_path, "FALLBACK_PRIMITIVE");
  assert.equal(report.truthCheck.fallback_primitive_dominance, true);
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
  assert.equal(summary.scaffoldStatus, "REAL_OUTPUT_ACTIVE");
  assert.equal(summary.visualReviewReadyCount, 2);
  assert.equal(summary.fallbackPrimitiveDominanceCount, 0);
  assert.equal(summary.strongestCharacterProfileId, "CHARACTER_001");
  assert.equal(summary.weakestCharacterProfileId, "CHARACTER_002");
  assert.equal(summary.recommendedNextAction, "CONTINUE_CHARACTER_RENDERS");
  assert.equal(state?.characterRenderExecutionCount, 2);
  assert.equal(state?.scaffoldStatus, "REAL_OUTPUT_ACTIVE");
  assert.equal(state?.visualReviewReady, true);
});

test("anime character compatibility passes when character metrics meet governed floors", () => {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_001");
  assert.ok(profile);
  const metrics = buildAnimeCharacterMetricSnapshot({ diagnostics: buildPreviewDiagnostics(98), profile });
  const truthCheck = {
    renderer_path: "CHARACTER_FIRST" as const,
    character_pixels_generated: true,
    character_primary_subject: true,
    fallback_primitive_dominance: false,
    diagnostics_match_rendered_output: true,
    scaffold_status: "REAL_OUTPUT_ACTIVE" as const,
  };

  const result = evaluateAnimeCharacterCompatibility({ profile, metrics, characterApproved: true, truthCheck });

  assert.equal(result.pass, true);
  assert.equal(result.compatibilityScore >= 95, true);
});
