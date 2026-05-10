import type { AnimePoseLanguagePreset } from "./animePoseLanguage";
import type { AnimeTemporalMotionPlan } from "./animeTemporalMotion";

export type AnimeMotionContinuityPlan = {
  frameIndex: number;
  frameCount: number;
  interpolationAlpha: number;
  easedWeightShift: number;
  verticalSettle: number;
  fabricSway: number;
  hairFabricSyncOffset: number;
  stancePreservation: number;
  limbContinuityScore: number;
  silhouetteContinuityScore: number;
  frameInterpolationScore: number;
  fabricContinuityScore: number;
  animationSmoothnessScore: number;
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function smoothStep(value: number): number {
  return value * value * (3 - 2 * value);
}

function pingPongPhase(frameIndex: number, frameCount: number): number {
  if (frameCount <= 1) {
    return 0;
  }
  const normalized = frameIndex / (frameCount - 1);
  return normalized <= 0.5 ? normalized * 2 : (1 - normalized) * 2;
}

export function buildAnimeMotionContinuityPlan(input: {
  frameIndex: number;
  frameCount: number;
  posePreset: AnimePoseLanguagePreset;
  temporalPlan?: AnimeTemporalMotionPlan;
}): AnimeMotionContinuityPlan {
  const frameCount = Math.max(1, input.frameCount);
  const phase = input.temporalPlan ? input.temporalPlan.easedTime : smoothStep(pingPongPhase(input.frameIndex, frameCount));
  const asymmetryDirection = input.posePreset.torsoAngle >= 0 ? 1 : -1;
  const temporalBody = input.temporalPlan?.bodyMotionWeight ?? 0;
  const easedWeightShift = Number(((((phase - 0.5) * input.posePreset.poseAsymmetry * 4.4) + temporalBody * 1.15) * asymmetryDirection).toFixed(2));
  const verticalSettle = Number(((Math.sin(phase * Math.PI) * 0.62) + (input.temporalPlan?.smoothedBodyOffsetY ?? 0) * 0.22).toFixed(2));
  const fabricSway = Number(((phase - 0.5) * 2.35 + easedWeightShift * 0.14 + (input.temporalPlan?.smoothedClothOffsetX ?? 0) * 0.55).toFixed(2));
  const hairFabricSyncOffset = Number((fabricSway * 0.46 + (input.temporalPlan?.smoothedHairOffsetX ?? 0) * 0.22).toFixed(2));
  const stancePreservation = clampScore(96 - Math.abs(easedWeightShift) * 1.2);
  const limbContinuityScore = clampScore(94 - Math.abs(easedWeightShift) * 0.8);
  const silhouetteContinuityScore = clampScore(95 - Math.abs(fabricSway) * 0.55);
  const frameInterpolationScore = clampScore(91 + phase * 4 - Math.abs(easedWeightShift) * 0.4);
  const fabricContinuityScore = clampScore(90 + phase * 5 - Math.abs(fabricSway) * 0.3);
  const animationSmoothnessScore = clampScore((limbContinuityScore + silhouetteContinuityScore + frameInterpolationScore + fabricContinuityScore) / 4);

  return {
    frameIndex: input.frameIndex,
    frameCount,
    interpolationAlpha: Number(phase.toFixed(2)),
    easedWeightShift,
    verticalSettle,
    fabricSway,
    hairFabricSyncOffset,
    stancePreservation,
    limbContinuityScore,
    silhouetteContinuityScore,
    frameInterpolationScore,
    fabricContinuityScore,
    animationSmoothnessScore,
  };
}

export function buildAnimeMotionContinuitySequence(input: {
  frameCount: number;
  posePreset: AnimePoseLanguagePreset;
  temporalPlans?: AnimeTemporalMotionPlan[];
}): AnimeMotionContinuityPlan[] {
  return Array.from({ length: input.frameCount }, (_, frameIndex) => buildAnimeMotionContinuityPlan({
    frameIndex,
    frameCount: input.frameCount,
    posePreset: input.posePreset,
    temporalPlan: input.temporalPlans?.[frameIndex],
  }));
}

function average(values: number[]): number {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function summarizeAnimeMotionContinuity(plans: AnimeMotionContinuityPlan[]) {
  return {
    motion_continuity_score: average(plans.map((entry) => entry.limbContinuityScore)),
    frame_interpolation_score: average(plans.map((entry) => entry.frameInterpolationScore)),
    fabric_motion_score: average(plans.map((entry) => entry.fabricContinuityScore)),
    animation_smoothness_score: average(plans.map((entry) => entry.animationSmoothnessScore)),
    silhouette_continuity_score: average(plans.map((entry) => entry.silhouetteContinuityScore)),
    stance_preservation_score: average(plans.map((entry) => entry.stancePreservation)),
  };
}
