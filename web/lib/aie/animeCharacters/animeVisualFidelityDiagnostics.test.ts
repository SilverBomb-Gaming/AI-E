import assert from "node:assert/strict";
import test from "node:test";

import { getApprovedAnimeCharacterProfileById } from "./animeCharacterProfileRegistry";
import { selectDefaultAnimeCharacterExpression, selectDefaultAnimeCharacterPose } from "./animeCharacterPoseTemplates";
import { buildAnimeEyeRenderPlan } from "./animeEyeRenderer";
import { buildAnimeFaceRenderPlan } from "./animeFaceRenderer";
import { buildAnimeHairRenderPlan } from "./animeHairRenderer";
import { buildAnimeBodyPlan } from "./animeBodyRenderer";
import { buildAnimeLowerBodyPlan } from "./animeLowerBodyRenderer";
import { buildAnimeMotionContinuityPlan } from "./animeMotionContinuity";
import { buildAnimeExpressionState } from "./animeExpressionRenderer";
import { buildAnimeSecondaryMotionState } from "./animeSecondaryMotion";
import { buildAnimeCameraFramingSequence, buildAnimeCameraFramingState, summarizeAnimeCameraFramingDiagnostics } from "./animeCameraFraming";
import { buildAnimeCinematicLightingSequence, buildAnimeCinematicLightingState, summarizeAnimeCinematicLightingDiagnostics } from "./animeCinematicLighting";
import { buildAnimePoseEnergyState } from "./animePoseEnergy";
import { buildAnimeArticulationPlan, summarizeAnimeArticulationDiagnostics } from "./animeArticulationRenderer";
import { buildAnimeTorsoStructurePlan, summarizeAnimeTorsoStructureDiagnostics } from "./animeTorsoStructure";
import { buildAnimeTemporalMotionPlan, summarizeAnimeTemporalMotionDiagnostics } from "./animeTemporalMotion";
import { resolveAnimePoseLanguagePreset } from "./animePoseLanguage";
import { buildAnimeVisualFidelityDiagnostics, classifyAnimeVisualFidelity } from "./animeVisualFidelityDiagnostics";
import type { AnimeCharacterTruthCheck } from "./governedAnimeCharacterState";

function truthCheck(overrides?: Partial<AnimeCharacterTruthCheck>): AnimeCharacterTruthCheck {
  return {
    renderer_path: "CHARACTER_FIRST",
    character_pixels_generated: true,
    character_primary_subject: true,
    fallback_primitive_dominance: false,
    diagnostics_match_rendered_output: true,
    scaffold_status: "REAL_OUTPUT_ACTIVE",
    ...overrides,
  };
}

test("anime visual fidelity diagnostics classify early anime tier", () => {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_005");
  assert.ok(profile);
  const expression = selectDefaultAnimeCharacterExpression(profile.expressionDefault);
  const poseTemplate = selectDefaultAnimeCharacterPose(profile.poseDefault);
  const posePreset = resolveAnimePoseLanguagePreset({ profile, poseTemplate });
  const temporalMotionPlan = buildAnimeTemporalMotionPlan({ frameIndex: 2, frameCount: 5 });
  const temporalMotionDiagnostics = summarizeAnimeTemporalMotionDiagnostics([0, 1, 2, 3, 4].map((frameIndex) => buildAnimeTemporalMotionPlan({ frameIndex, frameCount: 5 })));
  const bodyPlan = buildAnimeBodyPlan({
    profile,
    posePreset,
    frameIndex: 2,
  });
  const motionPlan = buildAnimeMotionContinuityPlan({ frameIndex: 2, frameCount: 5, posePreset, temporalPlan: temporalMotionPlan });
  const lowerBodyPlan = buildAnimeLowerBodyPlan({ profile, bodyPlan, posePreset, motionPlan });
  const expressionState = buildAnimeExpressionState({ profile, expression, frameIndex: 1, frameCount: 5, temporalPlan: buildAnimeTemporalMotionPlan({ frameIndex: 1, frameCount: 5 }) });
  const secondaryMotionState = buildAnimeSecondaryMotionState({ profile, frameIndex: 2, frameCount: 5, expressionState, motionPlan, temporalPlan: temporalMotionPlan });
  const cameraFramingState = buildAnimeCameraFramingState({ profile, frameIndex: 2, frameCount: 5, expressionState, temporalPlan: temporalMotionPlan });
  const cameraFramingDiagnostics = summarizeAnimeCameraFramingDiagnostics(buildAnimeCameraFramingSequence({ profile, frameCount: 5, expressionStates: [expressionState, expressionState, expressionState, expressionState, expressionState], temporalPlans: [0, 1, 2, 3, 4].map((frameIndex) => buildAnimeTemporalMotionPlan({ frameIndex, frameCount: 5 })) }));
  const cinematicLightingState = buildAnimeCinematicLightingState({ profile, frameIndex: 2, frameCount: 5 });
  const cinematicLightingDiagnostics = summarizeAnimeCinematicLightingDiagnostics(buildAnimeCinematicLightingSequence({ profile, frameCount: 5 }));
  const poseEnergyState = buildAnimePoseEnergyState({ profile, posePreset, frameIndex: 2 });
  const articulationPlan = buildAnimeArticulationPlan({ profile, posePreset, bodyPlan, lowerBodyPlan, poseEnergyState, frameIndex: 2 });
  const articulationDiagnostics = summarizeAnimeArticulationDiagnostics([articulationPlan]);
  const torsoStructurePlan = buildAnimeTorsoStructurePlan({ profile, bodyPlan, lowerBodyPlan, secondaryMotionState, articulationPlan, frameIndex: 2 });
  const torsoStructureDiagnostics = summarizeAnimeTorsoStructureDiagnostics([torsoStructurePlan]);

  const diagnostics = buildAnimeVisualFidelityDiagnostics({
    facePlan: buildAnimeFaceRenderPlan({ profile, expression }),
    eyePlan: buildAnimeEyeRenderPlan({ profile, expression }),
    hairPlan: buildAnimeHairRenderPlan({ profile, frameIndex: 2 }),
    bodyPlan,
    lowerBodyPlan,
    motionPlan,
    expressionState,
    secondaryMotionState,
    cameraFramingState,
    cameraFramingDiagnostics,
    cinematicLightingState,
    cinematicLightingDiagnostics,
    articulationPlan,
    articulationDiagnostics,
    torsoStructurePlan,
    torsoStructureDiagnostics,
    temporalMotionPlan,
    temporalMotionDiagnostics,
    truthCheck: truthCheck(),
    outfitReadability: bodyPlan.outfitFlowScore,
    backgroundSeparation: 94,
    poseReadability: bodyPlan.stanceBalanceScore,
    limbContinuityScore: 94,
    handPositionStability: 93,
    poseFrameConsistency: 95,
  });

  assert.equal(diagnostics.fidelity_tier, "EARLY_ANIME");
  assert.equal(diagnostics.visual_fidelity_score >= 90, true);
  assert.equal(diagnostics.anime_face_readability >= 95, true);
  assert.equal(diagnostics.anime_eye_quality >= 95, true);
  assert.equal(diagnostics.layered_hair_quality >= 94, true);
  assert.equal(diagnostics.body_silhouette_score >= 88, true);
  assert.equal(diagnostics.torso_readability_score >= 88, true);
  assert.equal(diagnostics.arm_readability_score >= 85, true);
  assert.equal(diagnostics.hand_readability_score >= 80, true);
  assert.equal(diagnostics.pose_language_score >= 88, true);
  assert.equal(diagnostics.outfit_flow_score >= 88, true);
  assert.equal(diagnostics.limb_continuity_score >= 90, true);
  assert.equal(diagnostics.hand_position_stability >= 90, true);
  assert.equal(diagnostics.pose_frame_consistency >= 90, true);
  assert.equal(diagnostics.lower_body_readability >= 88, true);
  assert.equal(diagnostics.foot_grounding_score >= 82, true);
  assert.equal(diagnostics.stance_grounding_score >= 90, true);
  assert.equal(diagnostics.waist_transition_score >= 88, true);
  assert.equal(diagnostics.motion_continuity_score >= 90, true);
  assert.equal(diagnostics.frame_interpolation_score >= 90, true);
  assert.equal(diagnostics.fabric_motion_score >= 90, true);
  assert.equal(diagnostics.animation_smoothness_score >= 90, true);
  assert.equal(diagnostics.expression_readability_score >= 88, true);
  assert.equal(diagnostics.blink_readability_score >= 85, true);
  assert.equal(diagnostics.gaze_stability_score >= 90, true);
  assert.equal(diagnostics.mouth_readability_score >= 85, true);
  assert.equal(diagnostics.eyebrow_readability_score >= 85, true);
  assert.equal(diagnostics.expression_frame_consistency >= 90, true);
  assert.equal(diagnostics.face_liveliness_score >= 85, true);
  assert.equal(diagnostics.hair_motion_score >= 88, true);
  assert.equal(diagnostics.bang_motion_readability >= 88, true);
  assert.equal(diagnostics.side_lock_continuity >= 90, true);
  assert.equal(diagnostics.rear_hair_settle_score >= 88, true);
  assert.equal(diagnostics.cloth_motion_score >= 86, true);
  assert.equal(diagnostics.jacket_sway_readability >= 86, true);
  assert.equal(diagnostics.lower_fabric_motion_score >= 88, true);
  assert.equal(diagnostics.secondary_motion_continuity >= 90, true);
  assert.equal(diagnostics.motion_jitter_risk, "LOW");
  assert.equal(diagnostics.shot_preset, "SUBTLE_PUSH_IN");
  assert.equal(diagnostics.camera_framing_score >= 88, true);
  assert.equal(diagnostics.face_framing_priority >= 90, true);
  assert.equal(diagnostics.eye_visibility_score >= 92, true);
  assert.equal(diagnostics.character_dominance_score >= 92, true);
  assert.equal(diagnostics.background_depth_score >= 88, true);
  assert.equal(diagnostics.parallax_continuity_score >= 90, true);
  assert.equal(diagnostics.cinematic_composition_score >= 88, true);
  assert.equal(diagnostics.camera_motion_smoothness >= 90, true);
  assert.equal(diagnostics.framing_jitter_risk, "LOW");
  assert.equal(diagnostics.lighting_mood, "CRIMSON_HERO_CONTRAST");
  assert.equal(diagnostics.rim_light_score >= 92, true);
  assert.equal(diagnostics.eye_highlight_score >= 94, true);
  assert.equal(diagnostics.face_lighting_score >= 94, true);
  assert.equal(diagnostics.character_background_contrast >= 94, true);
  assert.equal(diagnostics.beacon_glow_control >= 90, true);
  assert.equal(diagnostics.atmosphere_depth_score >= 92, true);
  assert.equal(diagnostics.color_mood_score >= 93, true);
  assert.equal(diagnostics.lighting_continuity_score >= 94, true);
  assert.equal(diagnostics.lighting_flicker_risk, "LOW");
  assert.equal(diagnostics.shoulder_articulation_score >= 88, true);
  assert.equal(diagnostics.elbow_readability_score >= 84, true);
  assert.equal(diagnostics.wrist_hand_connection_score >= 84, true);
  assert.equal(diagnostics.hand_shape_readability_score >= 82, true);
  assert.equal(diagnostics.hip_knee_articulation_score >= 88, true);
  assert.equal(diagnostics.foot_pose_readability_score >= 88, true);
  assert.equal(diagnostics.pose_energy_score >= 88, true);
  assert.equal(diagnostics.silhouette_flow_score >= 88, true);
  assert.equal(["LOW", "MEDIUM"].includes(diagnostics.anatomy_primitive_risk), true);
  assert.equal(diagnostics.torso_structure_score >= 90, true);
  assert.equal(diagnostics.waist_flow_score >= 88, true);
  assert.equal(diagnostics.pelvis_balance_score >= 88, true);
  assert.equal(diagnostics.outfit_layering_score >= 88, true);
  assert.equal(diagnostics.clothing_readability_score >= 88, true);
  assert.equal(diagnostics.silhouette_motion_score >= 90, true);
  assert.equal(["LOW", "MEDIUM"].includes(diagnostics.torso_stiffness_risk), true);
  assert.equal(["LOW", "MEDIUM"].includes(diagnostics.clothing_flatness_risk), true);
  assert.equal(diagnostics.temporal_smoothing_score >= 88, true);
  assert.equal(diagnostics.easing_curve_score >= 88, true);
  assert.equal(diagnostics.anticipation_readability_score >= 88, true);
  assert.equal(diagnostics.follow_through_score >= 88, true);
  assert.equal(diagnostics.overlapping_action_score >= 86, true);
  assert.equal(["LOW", "MEDIUM"].includes(diagnostics.frame_snap_risk), true);
  assert.equal(diagnostics.motion_arc_consistency >= 88, true);
  assert.equal(diagnostics.settle_quality_score >= 88, true);
  assert.equal(diagnostics.temporal_jitter_risk, "LOW");
});

test("anime visual fidelity diagnostics block fallback dominance", () => {
  assert.equal(classifyAnimeVisualFidelity(99, truthCheck({ fallback_primitive_dominance: true })), "BLOCKED");
  assert.equal(classifyAnimeVisualFidelity(87, truthCheck()), "PRIMITIVE");
});
