import type { AnimeCharacterTruthCheck } from "./governedAnimeCharacterState";
import type { AnimeEyeRenderPlan } from "./animeEyeRenderer";
import type { AnimeFaceRenderPlan } from "./animeFaceRenderer";
import type { AnimeHairRenderPlan } from "./animeHairRenderer";
import type { AnimeBodyPlan } from "./animeBodyRenderer";
import type { AnimeLowerBodyPlan } from "./animeLowerBodyRenderer";
import type { AnimeMotionContinuityPlan } from "./animeMotionContinuity";
import type { AnimeExpressionState } from "./animeExpressionRenderer";
import type { AnimeSecondaryMotionState } from "./animeSecondaryMotion";
import type { AnimeCameraFramingDiagnostics, AnimeCameraFramingState, AnimeShotPreset } from "./animeCameraFraming";
import type { AnimeCinematicLightingDiagnostics, AnimeCinematicLightingState, AnimeLightingMood } from "./animeCinematicLighting";
import type { AnimeArticulationDiagnostics, AnimeArticulationPlan } from "./animeArticulationRenderer";
import type { AnimeTorsoStructureDiagnostics, AnimeTorsoStructurePlan } from "./animeTorsoStructure";

export type AnimeVisualFidelityTier = "BLOCKED" | "PRIMITIVE" | "EARLY_ANIME";

export type AnimeVisualFidelityDiagnostics = {
  anime_face_readability: number;
  anime_eye_quality: number;
  layered_hair_quality: number;
  silhouette_readability: number;
  anime_style_strength: number;
  outfit_readability: number;
  background_separation: number;
  pose_readability: number;
  body_silhouette_score: number;
  torso_readability_score: number;
  arm_readability_score: number;
  hand_readability_score: number;
  pose_language_score: number;
  outfit_flow_score: number;
  stance_balance_score: number;
  limb_continuity_score: number;
  hand_position_stability: number;
  pose_frame_consistency: number;
  lower_body_readability: number;
  foot_grounding_score: number;
  stance_grounding_score: number;
  waist_transition_score: number;
  motion_continuity_score: number;
  frame_interpolation_score: number;
  fabric_motion_score: number;
  animation_smoothness_score: number;
  expression_readability_score: number;
  blink_readability_score: number;
  gaze_stability_score: number;
  mouth_readability_score: number;
  eyebrow_readability_score: number;
  expression_frame_consistency: number;
  face_liveliness_score: number;
  hair_motion_score: number;
  bang_motion_readability: number;
  side_lock_continuity: number;
  rear_hair_settle_score: number;
  cloth_motion_score: number;
  jacket_sway_readability: number;
  lower_fabric_motion_score: number;
  secondary_motion_continuity: number;
  motion_jitter_risk: "LOW" | "MEDIUM" | "HIGH";
  shot_preset: AnimeShotPreset;
  camera_framing_score: number;
  face_framing_priority: number;
  eye_visibility_score: number;
  character_dominance_score: number;
  background_depth_score: number;
  parallax_continuity_score: number;
  cinematic_composition_score: number;
  camera_motion_smoothness: number;
  framing_jitter_risk: "LOW" | "MEDIUM" | "HIGH";
  lighting_mood: AnimeLightingMood;
  rim_light_score: number;
  eye_highlight_score: number;
  face_lighting_score: number;
  character_background_contrast: number;
  beacon_glow_control: number;
  atmosphere_depth_score: number;
  color_mood_score: number;
  lighting_continuity_score: number;
  lighting_flicker_risk: "LOW" | "MEDIUM" | "HIGH";
  shoulder_articulation_score: number;
  elbow_readability_score: number;
  wrist_hand_connection_score: number;
  hand_shape_readability_score: number;
  hip_knee_articulation_score: number;
  foot_pose_readability_score: number;
  pose_energy_score: number;
  silhouette_flow_score: number;
  anatomy_primitive_risk: "LOW" | "MEDIUM" | "HIGH";
  torso_structure_score: number;
  waist_flow_score: number;
  pelvis_balance_score: number;
  outfit_layering_score: number;
  clothing_readability_score: number;
  silhouette_motion_score: number;
  torso_stiffness_risk: "LOW" | "MEDIUM" | "HIGH";
  clothing_flatness_risk: "LOW" | "MEDIUM" | "HIGH";
  visual_fidelity_score: number;
  fidelity_tier: AnimeVisualFidelityTier;
};

function average(values: number[]): number {
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

export function classifyAnimeVisualFidelity(score: number, truthCheck: AnimeCharacterTruthCheck): AnimeVisualFidelityTier {
  if (!truthCheck.character_pixels_generated || !truthCheck.character_primary_subject || truthCheck.fallback_primitive_dominance) {
    return "BLOCKED";
  }
  return score >= 88 ? "EARLY_ANIME" : "PRIMITIVE";
}

export function buildAnimeVisualFidelityDiagnostics(input: {
  facePlan: AnimeFaceRenderPlan;
  eyePlan: AnimeEyeRenderPlan;
  hairPlan: AnimeHairRenderPlan;
  bodyPlan?: AnimeBodyPlan;
  lowerBodyPlan?: AnimeLowerBodyPlan;
  motionPlan?: AnimeMotionContinuityPlan;
  expressionState?: AnimeExpressionState;
  secondaryMotionState?: AnimeSecondaryMotionState;
  cameraFramingState?: AnimeCameraFramingState;
  cameraFramingDiagnostics?: AnimeCameraFramingDiagnostics;
  cinematicLightingState?: AnimeCinematicLightingState;
  cinematicLightingDiagnostics?: AnimeCinematicLightingDiagnostics;
  articulationPlan?: AnimeArticulationPlan;
  articulationDiagnostics?: AnimeArticulationDiagnostics;
  torsoStructurePlan?: AnimeTorsoStructurePlan;
  torsoStructureDiagnostics?: AnimeTorsoStructureDiagnostics;
  truthCheck: AnimeCharacterTruthCheck;
  outfitReadability?: number;
  backgroundSeparation?: number;
  poseReadability?: number;
  limbContinuityScore?: number;
  handPositionStability?: number;
  poseFrameConsistency?: number;
}): AnimeVisualFidelityDiagnostics {
  const anime_face_readability = input.facePlan.faceReadabilityScore;
  const anime_eye_quality = input.eyePlan.eyeQualityScore;
  const layered_hair_quality = input.hairPlan.layeredHairQuality;
  const silhouette_readability = average([
    input.facePlan.silhouetteReadabilityScore,
    input.hairPlan.silhouetteContribution,
  ]);
  const anime_style_strength = average([
    anime_face_readability,
    anime_eye_quality,
    layered_hair_quality,
    silhouette_readability,
    input.facePlan.proportionScore,
  ]);
  const outfit_readability = input.outfitReadability ?? 92;
  const background_separation = input.backgroundSeparation ?? 93;
  const body_silhouette_score = input.bodyPlan?.silhouetteScore ?? silhouette_readability;
  const torso_readability_score = input.bodyPlan?.torsoReadabilityScore ?? 84;
  const arm_readability_score = input.bodyPlan?.armReadabilityScore ?? 82;
  const hand_readability_score = input.bodyPlan?.handReadabilityScore ?? 78;
  const pose_language_score = input.bodyPlan ? average([input.bodyPlan.silhouetteScore, input.bodyPlan.stanceBalanceScore, input.bodyPlan.armReadabilityScore]) : input.poseReadability ?? 91;
  const outfit_flow_score = input.bodyPlan?.outfitFlowScore ?? outfit_readability;
  const stance_balance_score = input.bodyPlan?.stanceBalanceScore ?? 90;
  const limb_continuity_score = input.limbContinuityScore ?? 93;
  const hand_position_stability = input.handPositionStability ?? 92;
  const pose_frame_consistency = input.poseFrameConsistency ?? 94;
  const lower_body_readability = input.lowerBodyPlan?.lowerBodyReadability ?? 82;
  const foot_grounding_score = input.lowerBodyPlan?.footGroundingScore ?? 78;
  const stance_grounding_score = input.lowerBodyPlan?.stanceGroundingScore ?? stance_balance_score;
  const waist_transition_score = input.lowerBodyPlan?.waistTransitionScore ?? torso_readability_score;
  const motion_continuity_score = input.motionPlan?.limbContinuityScore ?? limb_continuity_score;
  const frame_interpolation_score = input.motionPlan?.frameInterpolationScore ?? 88;
  const fabric_motion_score = input.torsoStructureDiagnostics?.fabric_motion_score ?? input.torsoStructurePlan?.fabricMotionScore ?? input.lowerBodyPlan?.fabricMotionScore ?? input.motionPlan?.fabricContinuityScore ?? outfit_flow_score;
  const animation_smoothness_score = input.motionPlan?.animationSmoothnessScore ?? 88;
  const expression_readability_score = input.expressionState?.expressionContinuityScore ?? 86;
  const blink_readability_score = input.expressionState?.blinkReadabilityScore ?? 82;
  const gaze_stability_score = input.expressionState?.gazeStabilityScore ?? 88;
  const mouth_readability_score = input.expressionState?.mouthReadabilityScore ?? 84;
  const eyebrow_readability_score = input.expressionState?.eyebrowReadabilityScore ?? 84;
  const expression_frame_consistency = input.expressionState?.eyeFrameConsistency ?? 86;
  const face_liveliness_score = input.expressionState?.faceLivelinessScore ?? 84;
  const hair_motion_score = input.secondaryMotionState?.hairMotionScore ?? 84;
  const bang_motion_readability = input.secondaryMotionState?.bangMotionReadability ?? 84;
  const side_lock_continuity = input.secondaryMotionState?.sideLockContinuity ?? 88;
  const rear_hair_settle_score = input.secondaryMotionState?.rearHairSettleScore ?? 86;
  const cloth_motion_score = input.secondaryMotionState?.clothMotionScore ?? 84;
  const jacket_sway_readability = input.secondaryMotionState?.jacketSwayReadability ?? 84;
  const lower_fabric_motion_score = input.secondaryMotionState?.lowerFabricMotionScore ?? 84;
  const secondary_motion_continuity = input.secondaryMotionState?.secondaryMotionContinuity ?? 88;
  const motion_jitter_risk = input.secondaryMotionState?.motionJitterRisk ?? "LOW";
  const shot_preset = input.cameraFramingDiagnostics?.shot_preset ?? input.cameraFramingState?.shotPreset ?? "CENTERED_HERO_SHOT";
  const camera_framing_score = input.cameraFramingDiagnostics?.camera_framing_score ?? 84;
  const face_framing_priority = input.cameraFramingDiagnostics?.face_framing_priority ?? input.cameraFramingState?.facePriority ?? 86;
  const eye_visibility_score = input.cameraFramingDiagnostics?.eye_visibility_score ?? 88;
  const character_dominance_score = input.cameraFramingDiagnostics?.character_dominance_score ?? 90;
  const background_depth_score = input.cameraFramingDiagnostics?.background_depth_score ?? 84;
  const parallax_continuity_score = input.cameraFramingDiagnostics?.parallax_continuity_score ?? input.cameraFramingState?.framingContinuityScore ?? 86;
  const cinematic_composition_score = input.cameraFramingDiagnostics?.cinematic_composition_score ?? 84;
  const camera_motion_smoothness = input.cameraFramingDiagnostics?.camera_motion_smoothness ?? input.cameraFramingState?.framingContinuityScore ?? 86;
  const framing_jitter_risk = input.cameraFramingDiagnostics?.framing_jitter_risk ?? "LOW";
  const lighting_mood = input.cinematicLightingDiagnostics?.lighting_mood ?? input.cinematicLightingState?.mood ?? "SOFT_BEACON_GLOW";
  const rim_light_score = input.cinematicLightingDiagnostics?.rim_light_score ?? 84;
  const eye_highlight_score = input.cinematicLightingDiagnostics?.eye_highlight_score ?? 88;
  const face_lighting_score = input.cinematicLightingDiagnostics?.face_lighting_score ?? 86;
  const character_background_contrast = input.cinematicLightingDiagnostics?.character_background_contrast ?? 86;
  const beacon_glow_control = input.cinematicLightingDiagnostics?.beacon_glow_control ?? 88;
  const atmosphere_depth_score = input.cinematicLightingDiagnostics?.atmosphere_depth_score ?? 84;
  const color_mood_score = input.cinematicLightingDiagnostics?.color_mood_score ?? 84;
  const lighting_continuity_score = input.cinematicLightingDiagnostics?.lighting_continuity_score ?? input.cinematicLightingState?.lightingContinuityScore ?? 86;
  const lighting_flicker_risk = input.cinematicLightingDiagnostics?.lighting_flicker_risk ?? "LOW";
  const shoulder_articulation_score = input.articulationDiagnostics?.shoulder_articulation_score ?? input.articulationPlan?.shoulderArticulationScore ?? 82;
  const elbow_readability_score = input.articulationDiagnostics?.elbow_readability_score ?? input.articulationPlan?.elbowReadabilityScore ?? 80;
  const wrist_hand_connection_score = input.articulationDiagnostics?.wrist_hand_connection_score ?? input.articulationPlan?.wristHandConnectionScore ?? 80;
  const hand_shape_readability_score = input.articulationDiagnostics?.hand_shape_readability_score ?? input.articulationPlan?.handShapeReadabilityScore ?? 78;
  const hip_knee_articulation_score = input.articulationDiagnostics?.hip_knee_articulation_score ?? input.articulationPlan?.hipKneeArticulationScore ?? 82;
  const foot_pose_readability_score = input.articulationDiagnostics?.foot_pose_readability_score ?? input.articulationPlan?.footPoseReadabilityScore ?? 82;
  const pose_energy_score = input.articulationDiagnostics?.pose_energy_score ?? input.articulationPlan?.poseEnergyScore ?? pose_language_score;
  const silhouette_flow_score = input.articulationDiagnostics?.silhouette_flow_score ?? input.articulationPlan?.silhouetteFlowScore ?? silhouette_readability;
  const anatomy_primitive_risk = input.articulationDiagnostics?.anatomy_primitive_risk ?? input.articulationPlan?.anatomyPrimitiveRisk ?? "MEDIUM";
  const torso_structure_score = input.torsoStructureDiagnostics?.torso_structure_score ?? input.torsoStructurePlan?.torsoStructureScore ?? torso_readability_score;
  const waist_flow_score = input.torsoStructureDiagnostics?.waist_flow_score ?? input.torsoStructurePlan?.waistFlowScore ?? waist_transition_score;
  const pelvis_balance_score = input.torsoStructureDiagnostics?.pelvis_balance_score ?? input.torsoStructurePlan?.pelvisBalanceScore ?? stance_grounding_score;
  const outfit_layering_score = input.torsoStructureDiagnostics?.outfit_layering_score ?? input.torsoStructurePlan?.outfitLayeringScore ?? outfit_flow_score;
  const clothing_readability_score = input.torsoStructureDiagnostics?.clothing_readability_score ?? input.torsoStructurePlan?.clothingReadabilityScore ?? outfit_readability;
  const silhouette_motion_score = input.torsoStructureDiagnostics?.silhouette_motion_score ?? input.torsoStructurePlan?.silhouetteMotionScore ?? silhouette_flow_score;
  const torso_stiffness_risk = input.torsoStructureDiagnostics?.torso_stiffness_risk ?? input.torsoStructurePlan?.torsoStiffnessRisk ?? "MEDIUM";
  const clothing_flatness_risk = input.torsoStructureDiagnostics?.clothing_flatness_risk ?? input.torsoStructurePlan?.clothingFlatnessRisk ?? "MEDIUM";
  const pose_readability = input.poseReadability ?? average([pose_language_score, stance_balance_score, arm_readability_score]);
  const visual_fidelity_score = average([
    anime_face_readability,
    anime_eye_quality,
    layered_hair_quality,
    silhouette_readability,
    anime_style_strength,
    outfit_readability,
    background_separation,
    pose_readability,
    body_silhouette_score,
    torso_readability_score,
    arm_readability_score,
    hand_readability_score,
    pose_language_score,
    outfit_flow_score,
    stance_balance_score,
    limb_continuity_score,
    hand_position_stability,
    pose_frame_consistency,
    lower_body_readability,
    foot_grounding_score,
    stance_grounding_score,
    waist_transition_score,
    motion_continuity_score,
    frame_interpolation_score,
    fabric_motion_score,
    animation_smoothness_score,
    expression_readability_score,
    blink_readability_score,
    gaze_stability_score,
    mouth_readability_score,
    eyebrow_readability_score,
    expression_frame_consistency,
    face_liveliness_score,
    hair_motion_score,
    bang_motion_readability,
    side_lock_continuity,
    rear_hair_settle_score,
    cloth_motion_score,
    jacket_sway_readability,
    lower_fabric_motion_score,
    secondary_motion_continuity,
    camera_framing_score,
    face_framing_priority,
    eye_visibility_score,
    character_dominance_score,
    background_depth_score,
    parallax_continuity_score,
    cinematic_composition_score,
    camera_motion_smoothness,
    rim_light_score,
    eye_highlight_score,
    face_lighting_score,
    character_background_contrast,
    beacon_glow_control,
    atmosphere_depth_score,
    color_mood_score,
    lighting_continuity_score,
    shoulder_articulation_score,
    elbow_readability_score,
    wrist_hand_connection_score,
    hand_shape_readability_score,
    hip_knee_articulation_score,
    foot_pose_readability_score,
    pose_energy_score,
    silhouette_flow_score,
    torso_structure_score,
    waist_flow_score,
    pelvis_balance_score,
    outfit_layering_score,
    clothing_readability_score,
    silhouette_motion_score,
  ]);

  return {
    anime_face_readability,
    anime_eye_quality,
    layered_hair_quality,
    silhouette_readability,
    anime_style_strength,
    outfit_readability,
    background_separation,
    pose_readability,
    body_silhouette_score,
    torso_readability_score,
    arm_readability_score,
    hand_readability_score,
    pose_language_score,
    outfit_flow_score,
    stance_balance_score,
    limb_continuity_score,
    hand_position_stability,
    pose_frame_consistency,
    lower_body_readability,
    foot_grounding_score,
    stance_grounding_score,
    waist_transition_score,
    motion_continuity_score,
    frame_interpolation_score,
    fabric_motion_score,
    animation_smoothness_score,
    expression_readability_score,
    blink_readability_score,
    gaze_stability_score,
    mouth_readability_score,
    eyebrow_readability_score,
    expression_frame_consistency,
    face_liveliness_score,
    hair_motion_score,
    bang_motion_readability,
    side_lock_continuity,
    rear_hair_settle_score,
    cloth_motion_score,
    jacket_sway_readability,
    lower_fabric_motion_score,
    secondary_motion_continuity,
    motion_jitter_risk,
    shot_preset,
    camera_framing_score,
    face_framing_priority,
    eye_visibility_score,
    character_dominance_score,
    background_depth_score,
    parallax_continuity_score,
    cinematic_composition_score,
    camera_motion_smoothness,
    framing_jitter_risk,
    lighting_mood,
    rim_light_score,
    eye_highlight_score,
    face_lighting_score,
    character_background_contrast,
    beacon_glow_control,
    atmosphere_depth_score,
    color_mood_score,
    lighting_continuity_score,
    lighting_flicker_risk,
    shoulder_articulation_score,
    elbow_readability_score,
    wrist_hand_connection_score,
    hand_shape_readability_score,
    hip_knee_articulation_score,
    foot_pose_readability_score,
    pose_energy_score,
    silhouette_flow_score,
    anatomy_primitive_risk,
    torso_structure_score,
    waist_flow_score,
    pelvis_balance_score,
    outfit_layering_score,
    clothing_readability_score,
    silhouette_motion_score,
    torso_stiffness_risk,
    clothing_flatness_risk,
    visual_fidelity_score,
    fidelity_tier: classifyAnimeVisualFidelity(visual_fidelity_score, input.truthCheck),
  };
}
