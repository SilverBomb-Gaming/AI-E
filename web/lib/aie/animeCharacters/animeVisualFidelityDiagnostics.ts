import type { AnimeCharacterTruthCheck } from "./governedAnimeCharacterState";
import type { AnimeEyeRenderPlan } from "./animeEyeRenderer";
import type { AnimeFaceRenderPlan } from "./animeFaceRenderer";
import type { AnimeHairRenderPlan } from "./animeHairRenderer";

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
  truthCheck: AnimeCharacterTruthCheck;
  outfitReadability?: number;
  backgroundSeparation?: number;
  poseReadability?: number;
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
  const pose_readability = input.poseReadability ?? 91;
  const visual_fidelity_score = average([
    anime_face_readability,
    anime_eye_quality,
    layered_hair_quality,
    silhouette_readability,
    anime_style_strength,
    outfit_readability,
    background_separation,
    pose_readability,
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
    visual_fidelity_score,
    fidelity_tier: classifyAnimeVisualFidelity(visual_fidelity_score, input.truthCheck),
  };
}
