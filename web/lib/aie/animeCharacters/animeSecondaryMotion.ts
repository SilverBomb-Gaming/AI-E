import type { AnimeCharacterProfile } from "./governedAnimeCharacterState";
import type { AnimeExpressionState } from "./animeExpressionRenderer";
import type { AnimeMotionContinuityPlan } from "./animeMotionContinuity";

export type AnimeMotionJitterRisk = "LOW" | "MEDIUM" | "HIGH";

export type AnimeSecondaryMotionState = {
  frameIndex: number;
  hairSwayX: number;
  hairSwayY: number;
  bangOffset: number;
  sideLockOffset: number;
  rearHairSettle: number;
  jacketSway: number;
  sleeveSway: number;
  lowerFabricSway: number;
  motionContinuityScore: number;
  hairMotionScore: number;
  bangMotionReadability: number;
  sideLockContinuity: number;
  rearHairSettleScore: number;
  clothMotionScore: number;
  jacketSwayReadability: number;
  lowerFabricMotionScore: number;
  secondaryMotionContinuity: number;
  motionJitterRisk: AnimeMotionJitterRisk;
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function roundMotion(value: number): number {
  return Number(value.toFixed(2));
}

function smoothStep(value: number): number {
  return value * value * (3 - 2 * value);
}

function secondaryPhase(frameIndex: number, frameCount: number): number {
  if (frameCount <= 1) {
    return 0;
  }
  const normalized = frameIndex / (frameCount - 1);
  const pingPong = normalized <= 0.5 ? normalized * 2 : (1 - normalized) * 2;
  return smoothStep(pingPong);
}

function profileMotionScale(profile: AnimeCharacterProfile): number {
  if (profile.id === "CHARACTER_005") {
    return 1.18;
  }
  if (profile.id === "CHARACTER_001") {
    return 1.08;
  }
  if (profile.id === "CHARACTER_004") {
    return 0.72;
  }
  return 0.92;
}

export function buildAnimeSecondaryMotionState(input: {
  profile: AnimeCharacterProfile;
  frameIndex: number;
  frameCount: number;
  expressionState?: AnimeExpressionState;
  motionPlan?: AnimeMotionContinuityPlan;
}): AnimeSecondaryMotionState {
  const frameCount = Math.max(1, input.frameCount);
  const frameIndex = Math.max(0, input.frameIndex) % frameCount;
  const phase = secondaryPhase(frameIndex, frameCount);
  const settlePhase = Math.sin((frameIndex / Math.max(1, frameCount - 1)) * Math.PI);
  const direction = input.profile.id === "CHARACTER_005" ? 1 : -1;
  const scale = profileMotionScale(input.profile);
  const blinkDampening = input.expressionState && input.expressionState.eyeOpenAmount < 0.65 ? 0.72 : 1;
  const bodyCarry = input.motionPlan ? input.motionPlan.fabricSway * 0.28 : 0;
  const hairSwayX = roundMotion(((phase - 0.5) * 5.1 * scale + bodyCarry) * direction * blinkDampening);
  const hairSwayY = roundMotion(settlePhase * 1.15 * scale);
  const bangOffset = roundMotion(hairSwayX * 0.42 + (input.expressionState?.gazeOffsetX ?? 0) * 0.35);
  const sideLockOffset = roundMotion(hairSwayX * 0.86);
  const rearHairSettle = roundMotion((0.5 - phase) * 2.2 * scale + (input.motionPlan?.verticalSettle ?? 0) * 0.35);
  const jacketSway = roundMotion((phase - 0.5) * 2.5 * scale + bodyCarry * 0.55);
  const sleeveSway = roundMotion(jacketSway * 0.65 + hairSwayX * 0.14);
  const lowerFabricSway = roundMotion(jacketSway * 1.16 + (input.motionPlan?.fabricSway ?? 0) * 0.38);
  const largestDelta = Math.max(Math.abs(hairSwayX), Math.abs(sideLockOffset), Math.abs(lowerFabricSway));
  const motionJitterRisk: AnimeMotionJitterRisk = largestDelta <= 4.2 ? "LOW" : largestDelta <= 6 ? "MEDIUM" : "HIGH";
  const motionContinuityScore = clampScore(94 - largestDelta * 0.65);
  const hairMotionScore = clampScore(89 + Math.min(5, Math.abs(hairSwayX) + Math.abs(hairSwayY)) - (motionJitterRisk === "LOW" ? 0 : 5));
  const bangMotionReadability = clampScore(88 + Math.abs(bangOffset) * 1.4);
  const sideLockContinuity = clampScore(93 - Math.abs(sideLockOffset) * 0.7);
  const rearHairSettleScore = clampScore(90 + Math.abs(rearHairSettle) * 0.9);
  const clothMotionScore = clampScore(87 + Math.abs(jacketSway) + Math.abs(lowerFabricSway) * 0.7 - (motionJitterRisk === "LOW" ? 0 : 6));
  const jacketSwayReadability = clampScore(87 + Math.abs(jacketSway) * 1.5);
  const lowerFabricMotionScore = clampScore(88 + Math.abs(lowerFabricSway) * 1.2);
  const secondaryMotionContinuity = clampScore((motionContinuityScore + sideLockContinuity + rearHairSettleScore) / 3);

  return {
    frameIndex,
    hairSwayX,
    hairSwayY,
    bangOffset,
    sideLockOffset,
    rearHairSettle,
    jacketSway,
    sleeveSway,
    lowerFabricSway,
    motionContinuityScore,
    hairMotionScore,
    bangMotionReadability,
    sideLockContinuity,
    rearHairSettleScore,
    clothMotionScore,
    jacketSwayReadability,
    lowerFabricMotionScore,
    secondaryMotionContinuity,
    motionJitterRisk,
  };
}

export function buildAnimeSecondaryMotionSequence(input: {
  profile: AnimeCharacterProfile;
  frameCount: number;
  expressionStates?: AnimeExpressionState[];
  motionPlans?: AnimeMotionContinuityPlan[];
}): AnimeSecondaryMotionState[] {
  return Array.from({ length: input.frameCount }, (_, frameIndex) => buildAnimeSecondaryMotionState({
    profile: input.profile,
    frameIndex,
    frameCount: input.frameCount,
    expressionState: input.expressionStates?.[frameIndex],
    motionPlan: input.motionPlans?.[frameIndex],
  }));
}

function average(values: number[]): number {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function summarizeAnimeSecondaryMotionDiagnostics(states: AnimeSecondaryMotionState[]) {
  const jitterRisk: AnimeMotionJitterRisk = states.some((entry) => entry.motionJitterRisk === "HIGH") ? "HIGH" : states.some((entry) => entry.motionJitterRisk === "MEDIUM") ? "MEDIUM" : "LOW";
  return {
    hair_motion_score: average(states.map((entry) => entry.hairMotionScore)),
    bang_motion_readability: average(states.map((entry) => entry.bangMotionReadability)),
    side_lock_continuity: average(states.map((entry) => entry.sideLockContinuity)),
    rear_hair_settle_score: average(states.map((entry) => entry.rearHairSettleScore)),
    cloth_motion_score: average(states.map((entry) => entry.clothMotionScore)),
    jacket_sway_readability: average(states.map((entry) => entry.jacketSwayReadability)),
    lower_fabric_motion_score: average(states.map((entry) => entry.lowerFabricMotionScore)),
    secondary_motion_continuity: average(states.map((entry) => entry.secondaryMotionContinuity)),
    motion_jitter_risk: jitterRisk,
  };
}
