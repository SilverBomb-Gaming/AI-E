import type { AnimeCharacterExpressionTemplate, AnimeCharacterProfile } from "./governedAnimeCharacterState";

export type AnimeMouthShape = "neutral" | "small-smile" | "focused-line" | "soft-concern";

export type AnimeEyebrowEmotion = "confident" | "calm" | "focused" | "concerned" | "intense";

export type AnimeExpressionState = {
  expressionId: string;
  eyeOpenAmount: number;
  gazeOffsetX: number;
  gazeOffsetY: number;
  eyebrowTilt: number;
  mouthShape: AnimeMouthShape;
  cheekTone: number;
  expressionContinuityScore: number;
  eyebrowEmotion: AnimeEyebrowEmotion;
  blinkReadabilityScore: number;
  eyeFrameConsistency: number;
  gazeStabilityScore: number;
  mouthReadabilityScore: number;
  eyebrowReadabilityScore: number;
  faceLivelinessScore: number;
  dialogueAllowed: false;
  lipSyncAllowed: false;
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function roundMotion(value: number): number {
  return Number(value.toFixed(2));
}

function mouthShapeForExpression(expression: AnimeCharacterExpressionTemplate, profile: AnimeCharacterProfile): AnimeMouthShape {
  if (expression.id === "SLIGHT_CONCERN") {
    return "soft-concern";
  }
  if (expression.id === "FOCUSED_DETERMINATION") {
    return profile.id === "CHARACTER_005" ? "small-smile" : "focused-line";
  }
  if (expression.id === "QUIET_RESOLVE") {
    return "focused-line";
  }
  return "neutral";
}

function eyebrowEmotionForExpression(expression: AnimeCharacterExpressionTemplate, profile: AnimeCharacterProfile): AnimeEyebrowEmotion {
  if (profile.id === "CHARACTER_005") {
    return "intense";
  }
  if (profile.id === "CHARACTER_001") {
    return expression.id === "FOCUSED_DETERMINATION" ? "focused" : "calm";
  }
  if (expression.id === "SLIGHT_CONCERN") {
    return "concerned";
  }
  if (expression.id === "FOCUSED_DETERMINATION" || expression.id === "QUIET_RESOLVE") {
    return "focused";
  }
  return "calm";
}

function baseEyebrowTilt(emotion: AnimeEyebrowEmotion): number {
  if (emotion === "intense") {
    return -3.2;
  }
  if (emotion === "confident") {
    return -2.2;
  }
  if (emotion === "focused") {
    return -1.8;
  }
  if (emotion === "concerned") {
    return 2.4;
  }
  return -0.8;
}

function blinkOpenAmount(frameIndex: number): number {
  const sequence = [1, 0.42, 0.92, 1, 0.96];
  return sequence[Math.max(0, frameIndex) % sequence.length];
}

export function buildAnimeExpressionState(input: {
  profile: AnimeCharacterProfile;
  expression: AnimeCharacterExpressionTemplate;
  frameIndex: number;
  frameCount: number;
}): AnimeExpressionState {
  const frameCount = Math.max(1, input.frameCount);
  const normalizedFrame = Math.max(0, input.frameIndex) % frameCount;
  const eyeOpenAmount = blinkOpenAmount(normalizedFrame);
  const blinkDepth = 1 - eyeOpenAmount;
  const eyebrowEmotion = eyebrowEmotionForExpression(input.expression, input.profile);
  const expressionIntensity = input.profile.id === "CHARACTER_005" ? 1.15 : input.profile.id === "CHARACTER_001" ? 0.88 : 1;
  const gazeWave = Math.sin((normalizedFrame / Math.max(1, frameCount - 1)) * Math.PI);
  const gazeOffsetX = roundMotion((input.profile.id === "CHARACTER_005" ? 0.55 : 0.35) * gazeWave * expressionIntensity);
  const gazeOffsetY = roundMotion(normalizedFrame === frameCount - 1 ? -0.28 : blinkDepth > 0.3 ? 0.18 : 0);
  const eyebrowTilt = roundMotion(baseEyebrowTilt(eyebrowEmotion) + blinkDepth * 0.7);
  const expressionContinuityScore = clampScore(94 - Math.abs(gazeOffsetX) * 1.5 - blinkDepth * 3);
  const blinkReadabilityScore = clampScore(88 + blinkDepth * 12);
  const eyeFrameConsistency = clampScore(94 - blinkDepth * 4 - Math.abs(gazeOffsetX));
  const gazeStabilityScore = clampScore(94 - Math.abs(gazeOffsetX) * 3 - Math.abs(gazeOffsetY) * 2);
  const mouthReadabilityScore = clampScore(88 + (mouthShapeForExpression(input.expression, input.profile) === "small-smile" ? 4 : 2));
  const eyebrowReadabilityScore = clampScore(89 + Math.abs(eyebrowTilt) * 1.4);
  const faceLivelinessScore = clampScore((blinkReadabilityScore + gazeStabilityScore + mouthReadabilityScore + eyebrowReadabilityScore) / 4);

  return {
    expressionId: input.expression.id,
    eyeOpenAmount,
    gazeOffsetX,
    gazeOffsetY,
    eyebrowTilt,
    mouthShape: mouthShapeForExpression(input.expression, input.profile),
    cheekTone: clampScore(58 + expressionIntensity * 12 + blinkDepth * 8),
    expressionContinuityScore,
    eyebrowEmotion,
    blinkReadabilityScore,
    eyeFrameConsistency,
    gazeStabilityScore,
    mouthReadabilityScore,
    eyebrowReadabilityScore,
    faceLivelinessScore,
    dialogueAllowed: false,
    lipSyncAllowed: false,
  };
}

export function buildAnimeExpressionSequence(input: {
  profile: AnimeCharacterProfile;
  expression: AnimeCharacterExpressionTemplate;
  frameCount: number;
}): AnimeExpressionState[] {
  return Array.from({ length: input.frameCount }, (_, frameIndex) => buildAnimeExpressionState({
    profile: input.profile,
    expression: input.expression,
    frameIndex,
    frameCount: input.frameCount,
  }));
}

function average(values: number[]): number {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function summarizeAnimeExpressionDiagnostics(states: AnimeExpressionState[]) {
  return {
    expression_readability_score: average(states.map((entry) => entry.expressionContinuityScore)),
    blink_readability_score: average(states.map((entry) => entry.blinkReadabilityScore)),
    gaze_stability_score: average(states.map((entry) => entry.gazeStabilityScore)),
    mouth_readability_score: average(states.map((entry) => entry.mouthReadabilityScore)),
    eyebrow_readability_score: average(states.map((entry) => entry.eyebrowReadabilityScore)),
    expression_frame_consistency: average(states.map((entry) => entry.eyeFrameConsistency)),
    face_liveliness_score: average(states.map((entry) => entry.faceLivelinessScore)),
  };
}
