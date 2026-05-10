export type AnimeFrameSnapRisk = "LOW" | "MEDIUM" | "HIGH";
export type AnimeTemporalJitterRisk = "LOW" | "MEDIUM" | "HIGH";

export type AnimeTemporalMotionPlan = {
  frameIndex: number;
  frameCount: number;
  normalizedTime: number;
  easedTime: number;
  anticipationPhase: number;
  actionPhase: number;
  followThroughPhase: number;
  settlePhase: number;
  bodyMotionWeight: number;
  hairMotionLag: number;
  clothMotionLag: number;
  cameraMotionLag: number;
  expressionMotionLag: number;
  motionArcOffsetX: number;
  motionArcOffsetY: number;
  smoothedBodyOffsetX: number;
  smoothedBodyOffsetY: number;
  smoothedHairOffsetX: number;
  smoothedClothOffsetX: number;
  smoothedCameraOffsetX: number;
  smoothedCameraOffsetY: number;
  temporalContinuityScore: number;
  temporalSmoothingScore: number;
  easingCurveScore: number;
  anticipationReadabilityScore: number;
  followThroughScore: number;
  overlappingActionScore: number;
  frameSnapRisk: AnimeFrameSnapRisk;
  motionArcConsistency: number;
  settleQualityScore: number;
  temporalJitterRisk: AnimeTemporalJitterRisk;
};

export type AnimeTemporalMotionDiagnostics = {
  temporal_smoothing_score: number;
  easing_curve_score: number;
  anticipation_readability_score: number;
  follow_through_score: number;
  overlapping_action_score: number;
  frame_snap_risk: AnimeFrameSnapRisk;
  motion_arc_consistency: number;
  settle_quality_score: number;
  temporal_jitter_risk: AnimeTemporalJitterRisk;
  temporal_continuity_score: number;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function roundMotion(value: number): number {
  return Number(value.toFixed(3));
}

function roundedPixel(value: number): number {
  return Math.max(-6, Math.min(6, Math.round(value)));
}

export function easeInOutSine(value: number): number {
  const t = clamp01(value);
  if (t === 0) {
    return 0;
  }
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

export function easeOutCubic(value: number): number {
  const t = clamp01(value);
  return 1 - (1 - t) ** 3;
}

export function easeInQuad(value: number): number {
  const t = clamp01(value);
  return t * t;
}

export function anticipationCurve(value: number): number {
  const t = clamp01(value);
  return Math.sin(t * Math.PI) ** 2;
}

export function followThroughCurve(value: number): number {
  const t = clamp01(value);
  return Math.sin(t * Math.PI) * (1 - t * 0.28);
}

export function settleCurve(value: number): number {
  const t = clamp01(value);
  return 1 - easeOutCubic(t);
}

function phaseWindow(time: number, start: number, peak: number, end: number): number {
  if (time < start || time > end) {
    return 0;
  }
  if (time <= peak) {
    return easeOutCubic((time - start) / Math.max(0.001, peak - start));
  }
  return settleCurve((time - peak) / Math.max(0.001, end - peak));
}

function laggedSine(time: number, lag: number): number {
  return Math.sin((clamp01(time - lag) * Math.PI * 2) - Math.PI / 2);
}

function scoreRiskFromDelta(delta: number): AnimeFrameSnapRisk {
  return delta <= 2 ? "LOW" : delta <= 4 ? "MEDIUM" : "HIGH";
}

function jitterRiskFromPlans(plans: AnimeTemporalMotionPlan[]): AnimeTemporalJitterRisk {
  const worstSnap = plans.some((entry) => entry.frameSnapRisk === "HIGH") ? "HIGH" : plans.some((entry) => entry.frameSnapRisk === "MEDIUM") ? "MEDIUM" : "LOW";
  const lowArc = plans.some((entry) => entry.motionArcConsistency < 84);
  if (worstSnap === "HIGH" || lowArc) {
    return "HIGH";
  }
  return worstSnap === "MEDIUM" ? "MEDIUM" : "LOW";
}

export function buildAnimeTemporalMotionPlan(input: {
  frameIndex: number;
  frameCount: number;
}): AnimeTemporalMotionPlan {
  const frameCount = Math.max(1, input.frameCount);
  const frameIndex = Math.max(0, input.frameIndex) % frameCount;
  const normalizedTime = frameCount <= 1 ? 0 : frameIndex / (frameCount - 1);
  const easedTime = easeInOutSine(normalizedTime);
  const anticipationPhase = phaseWindow(normalizedTime, 0, 0.25, 0.42);
  const actionPhase = phaseWindow(normalizedTime, 0.18, 0.5, 0.72);
  const followThroughPhase = phaseWindow(normalizedTime, 0.48, 0.75, 0.95);
  const settlePhase = normalizedTime >= 0.72 ? easeOutCubic((normalizedTime - 0.72) / 0.28) : normalizedTime <= 0.12 ? 1 - normalizedTime / 0.12 : 0;
  const bodyMotionWeight = roundMotion(actionPhase - anticipationPhase * 0.34 + followThroughPhase * 0.18);
  const expressionMotionLag = roundMotion(Math.max(0, anticipationPhase * 0.1 - 0.02));
  const hairMotionLag = roundMotion(0.12 + followThroughPhase * 0.08);
  const clothMotionLag = roundMotion(0.18 + followThroughPhase * 0.1);
  const cameraMotionLag = roundMotion(0.24 + settlePhase * 0.08);
  const arcBase = Math.sin(easedTime * Math.PI);
  const motionArcOffsetX = roundedPixel((bodyMotionWeight * 2.4 + followThroughPhase * 1.2 - anticipationPhase * 1.1) * 0.9);
  const motionArcOffsetY = roundedPixel((arcBase * -1.8 + anticipationPhase * 1.2 + settlePhase * 0.4) * 0.9);
  const smoothedBodyOffsetX = roundedPixel(motionArcOffsetX * 0.82);
  const smoothedBodyOffsetY = roundedPixel(motionArcOffsetY * 0.72);
  const smoothedHairOffsetX = roundedPixel(laggedSine(normalizedTime, hairMotionLag) * 2.2 + smoothedBodyOffsetX * 0.35);
  const smoothedClothOffsetX = roundedPixel(laggedSine(normalizedTime, clothMotionLag) * 1.8 + smoothedBodyOffsetX * 0.44);
  const smoothedCameraOffsetX = roundedPixel(laggedSine(normalizedTime, cameraMotionLag) * 1.1);
  const smoothedCameraOffsetY = roundedPixel((easeInOutSine(clamp01(normalizedTime - cameraMotionLag * 0.18)) - 0.5) * -1.6);
  const largestDelta = Math.max(
    Math.abs(smoothedBodyOffsetX),
    Math.abs(smoothedBodyOffsetY),
    Math.abs(smoothedHairOffsetX - smoothedBodyOffsetX),
    Math.abs(smoothedClothOffsetX - smoothedBodyOffsetX),
    Math.abs(smoothedCameraOffsetX),
    Math.abs(smoothedCameraOffsetY),
  );
  const frameSnapRisk = scoreRiskFromDelta(largestDelta);
  const motionArcConsistency = clampScore(94 - Math.abs(smoothedBodyOffsetX - motionArcOffsetX) * 1.2 - Math.abs(smoothedBodyOffsetY - motionArcOffsetY) * 1.2);
  const anticipationReadabilityScore = clampScore(88 + anticipationPhase * 6 + actionPhase * 1.5);
  const followThroughScore = clampScore(88 + followThroughPhase * 7 + Math.max(0, clothMotionLag - hairMotionLag) * 12);
  const overlappingActionScore = clampScore(88 + (clothMotionLag - expressionMotionLag) * 16 + followThroughPhase * 2 - (frameSnapRisk === "HIGH" ? 9 : 0));
  const easingCurveScore = clampScore(91 + easedTime * 3 - Math.abs(easedTime - normalizedTime) * 4);
  const settleQualityScore = clampScore(89 + settlePhase * 7 - Math.abs(smoothedCameraOffsetY) * 0.8);
  const temporalSmoothingScore = clampScore((easingCurveScore + anticipationReadabilityScore + followThroughScore + overlappingActionScore + motionArcConsistency + settleQualityScore) / 6 - (frameSnapRisk === "HIGH" ? 8 : frameSnapRisk === "MEDIUM" ? 2 : 0));
  const temporalContinuityScore = clampScore((temporalSmoothingScore + motionArcConsistency + settleQualityScore) / 3);
  const temporalJitterRisk: AnimeTemporalJitterRisk = frameSnapRisk === "HIGH" ? "HIGH" : frameSnapRisk === "MEDIUM" ? "MEDIUM" : "LOW";

  return {
    frameIndex,
    frameCount,
    normalizedTime: roundMotion(normalizedTime),
    easedTime: roundMotion(easedTime),
    anticipationPhase: roundMotion(anticipationPhase),
    actionPhase: roundMotion(actionPhase),
    followThroughPhase: roundMotion(followThroughPhase),
    settlePhase: roundMotion(settlePhase),
    bodyMotionWeight,
    hairMotionLag,
    clothMotionLag,
    cameraMotionLag,
    expressionMotionLag,
    motionArcOffsetX,
    motionArcOffsetY,
    smoothedBodyOffsetX,
    smoothedBodyOffsetY,
    smoothedHairOffsetX,
    smoothedClothOffsetX,
    smoothedCameraOffsetX,
    smoothedCameraOffsetY,
    temporalContinuityScore,
    temporalSmoothingScore,
    easingCurveScore,
    anticipationReadabilityScore,
    followThroughScore,
    overlappingActionScore,
    frameSnapRisk,
    motionArcConsistency,
    settleQualityScore,
    temporalJitterRisk,
  };
}

export function buildAnimeTemporalMotionSequence(input: {
  frameCount: number;
}): AnimeTemporalMotionPlan[] {
  return Array.from({ length: input.frameCount }, (_, frameIndex) => buildAnimeTemporalMotionPlan({ frameIndex, frameCount: input.frameCount }));
}

function average(values: number[]): number {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function summarizeAnimeTemporalMotionDiagnostics(plans: AnimeTemporalMotionPlan[]): AnimeTemporalMotionDiagnostics {
  const frameSnapRisk: AnimeFrameSnapRisk = plans.some((entry) => entry.frameSnapRisk === "HIGH") ? "HIGH" : plans.some((entry) => entry.frameSnapRisk === "MEDIUM") ? "MEDIUM" : "LOW";
  return {
    temporal_smoothing_score: average(plans.map((entry) => entry.temporalSmoothingScore)),
    easing_curve_score: average(plans.map((entry) => entry.easingCurveScore)),
    anticipation_readability_score: average(plans.map((entry) => entry.anticipationReadabilityScore)),
    follow_through_score: average(plans.map((entry) => entry.followThroughScore)),
    overlapping_action_score: average(plans.map((entry) => entry.overlappingActionScore)),
    frame_snap_risk: frameSnapRisk,
    motion_arc_consistency: average(plans.map((entry) => entry.motionArcConsistency)),
    settle_quality_score: average(plans.map((entry) => entry.settleQualityScore)),
    temporal_jitter_risk: jitterRiskFromPlans(plans),
    temporal_continuity_score: average(plans.map((entry) => entry.temporalContinuityScore)),
  };
}
