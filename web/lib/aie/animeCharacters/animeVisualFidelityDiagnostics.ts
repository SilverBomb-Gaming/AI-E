import type { AnimeCharacterTruthCheck } from "./governedAnimeCharacterState";
import type { AnimeEyeRenderPlan } from "./animeEyeRenderer";
import type { AnimeFaceRenderPlan } from "./animeFaceRenderer";
import type { AnimeHairRenderPlan } from "./animeHairRenderer";
import type { AnimeBodyPlan } from "./animeBodyRenderer";

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
    visual_fidelity_score,
    fidelity_tier: classifyAnimeVisualFidelity(visual_fidelity_score, input.truthCheck),
  };
}
