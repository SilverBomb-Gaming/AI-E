import type { AnimeCharacterProfile } from "./governedAnimeCharacterState";
import type { AnimeExpressionState } from "./animeExpressionRenderer";

export type AnimeShotPreset =
  | "CENTERED_HERO_SHOT"
  | "SLIGHT_LOW_ANGLE_HERO"
  | "FACE_PRIORITY_MEDIUM_SHOT"
  | "THREE_QUARTER_ANIME_REVEAL"
  | "SUBTLE_PUSH_IN";

export type AnimeFramingJitterRisk = "LOW" | "MEDIUM" | "HIGH";

export type AnimeCameraFramingState = {
  frameIndex: number;
  shotPreset: AnimeShotPreset;
  cameraOffsetX: number;
  cameraOffsetY: number;
  cameraZoom: number;
  characterAnchorX: number;
  characterAnchorY: number;
  facePriority: number;
  backgroundParallaxX: number;
  backgroundParallaxY: number;
  framingContinuityScore: number;
};

export type AnimeCameraFramingDiagnostics = {
  shot_preset: AnimeShotPreset;
  camera_framing_score: number;
  face_framing_priority: number;
  eye_visibility_score: number;
  character_dominance_score: number;
  background_depth_score: number;
  parallax_continuity_score: number;
  cinematic_composition_score: number;
  camera_motion_smoothness: number;
  framing_jitter_risk: AnimeFramingJitterRisk;
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function roundMotion(value: number): number {
  return Number(value.toFixed(3));
}

function smoothStep(value: number): number {
  return value * value * (3 - 2 * value);
}

function normalizedFrame(frameIndex: number, frameCount: number): number {
  if (frameCount <= 1) {
    return 0;
  }
  return Math.max(0, Math.min(1, frameIndex / (frameCount - 1)));
}

export function resolveAnimeShotPreset(profile: AnimeCharacterProfile): AnimeShotPreset {
  if (profile.id === "CHARACTER_005") {
    return "SUBTLE_PUSH_IN";
  }
  if (profile.id === "CHARACTER_003") {
    return "THREE_QUARTER_ANIME_REVEAL";
  }
  if (profile.id === "CHARACTER_004") {
    return "SLIGHT_LOW_ANGLE_HERO";
  }
  if (profile.id === "CHARACTER_002") {
    return "FACE_PRIORITY_MEDIUM_SHOT";
  }
  return "CENTERED_HERO_SHOT";
}

function presetBase(input: { preset: AnimeShotPreset; profile: AnimeCharacterProfile }) {
  switch (input.preset) {
    case "SUBTLE_PUSH_IN":
      return { offsetX: input.profile.id === "CHARACTER_005" ? -5.2 : -2.8, offsetY: -3.2, zoom: 1.022, facePriority: 93, anchorX: 120, anchorY: 104 };
    case "FACE_PRIORITY_MEDIUM_SHOT":
      return { offsetX: -2.2, offsetY: -4.2, zoom: 1.032, facePriority: 94, anchorX: 120, anchorY: 101 };
    case "THREE_QUARTER_ANIME_REVEAL":
      return { offsetX: -7.2, offsetY: -1.4, zoom: 1.018, facePriority: 91, anchorX: 118, anchorY: 106 };
    case "SLIGHT_LOW_ANGLE_HERO":
      return { offsetX: -1.6, offsetY: 2.2, zoom: 1.016, facePriority: 90, anchorX: 120, anchorY: 109 };
    case "CENTERED_HERO_SHOT":
    default:
      return { offsetX: -1.8, offsetY: -1.2, zoom: 1.012, facePriority: 90, anchorX: 120, anchorY: 106 };
  }
}

export function buildAnimeCameraFramingState(input: {
  profile: AnimeCharacterProfile;
  frameIndex: number;
  frameCount: number;
  expressionState?: AnimeExpressionState;
  shotPreset?: AnimeShotPreset;
}): AnimeCameraFramingState {
  const frameCount = Math.max(1, input.frameCount);
  const frameIndex = Math.max(0, input.frameIndex) % frameCount;
  const progress = smoothStep(normalizedFrame(frameIndex, frameCount));
  const preset = input.shotPreset ?? resolveAnimeShotPreset(input.profile);
  const base = presetBase({ preset, profile: input.profile });
  const pushIn = preset === "SUBTLE_PUSH_IN" ? progress * 0.026 : preset === "FACE_PRIORITY_MEDIUM_SHOT" ? progress * 0.012 : progress * 0.006;
  const drift = Math.sin(progress * Math.PI) * 1.1;
  const blinkHold = input.expressionState && input.expressionState.eyeOpenAmount < 0.65 ? -0.8 : 0;
  const cameraOffsetX = roundMotion(base.offsetX + (preset === "THREE_QUARTER_ANIME_REVEAL" ? drift * 0.8 : drift * 0.45));
  const cameraOffsetY = roundMotion(base.offsetY + blinkHold - progress * 1.1);
  const cameraZoom = roundMotion(Math.min(1.065, base.zoom + pushIn));
  const characterAnchorX = roundMotion(base.anchorX + cameraOffsetX * 0.2);
  const characterAnchorY = roundMotion(base.anchorY + cameraOffsetY * 0.25);
  const backgroundParallaxX = roundMotion(-cameraOffsetX * 0.42 - progress * 1.4);
  const backgroundParallaxY = roundMotion(-cameraOffsetY * 0.28 + progress * 0.7);
  const largestMotion = Math.max(Math.abs(cameraOffsetX), Math.abs(cameraOffsetY), Math.abs((cameraZoom - 1) * 100));
  const framingContinuityScore = clampScore(96 - largestMotion * 0.55);
  const eyeOpenBonus = input.expressionState && input.expressionState.eyeOpenAmount < 0.65 ? -1 : 1;
  const facePriority = clampScore(base.facePriority + Math.round((cameraZoom - 1) * 95) + eyeOpenBonus);

  return {
    frameIndex,
    shotPreset: preset,
    cameraOffsetX,
    cameraOffsetY,
    cameraZoom,
    characterAnchorX,
    characterAnchorY,
    facePriority,
    backgroundParallaxX,
    backgroundParallaxY,
    framingContinuityScore,
  };
}

export function buildAnimeCameraFramingSequence(input: {
  profile: AnimeCharacterProfile;
  frameCount: number;
  expressionStates?: AnimeExpressionState[];
  shotPreset?: AnimeShotPreset;
}): AnimeCameraFramingState[] {
  return Array.from({ length: input.frameCount }, (_, frameIndex) => buildAnimeCameraFramingState({
    profile: input.profile,
    frameIndex,
    frameCount: input.frameCount,
    expressionState: input.expressionStates?.[frameIndex],
    shotPreset: input.shotPreset,
  }));
}

function average(values: number[]): number {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function summarizeAnimeCameraFramingDiagnostics(states: AnimeCameraFramingState[]): AnimeCameraFramingDiagnostics {
  const zoomRange = Math.max(...states.map((entry) => entry.cameraZoom)) - Math.min(...states.map((entry) => entry.cameraZoom));
  const offsetRange = Math.max(...states.map((entry) => entry.cameraOffsetX)) - Math.min(...states.map((entry) => entry.cameraOffsetX));
  const largestOffset = Math.max(...states.map((entry) => Math.max(Math.abs(entry.cameraOffsetX), Math.abs(entry.cameraOffsetY))));
  const jitterRisk: AnimeFramingJitterRisk = zoomRange <= 0.06 && offsetRange <= 4.5 && largestOffset <= 9 ? "LOW" : zoomRange <= 0.09 && offsetRange <= 7 ? "MEDIUM" : "HIGH";
  const facePriority = average(states.map((entry) => entry.facePriority));
  const continuity = average(states.map((entry) => entry.framingContinuityScore));
  const cameraMotionSmoothness = clampScore(continuity + (jitterRisk === "LOW" ? 2 : -6));
  const backgroundDepthScore = clampScore(88 + Math.round(Math.min(6, Math.abs(states[states.length - 1]?.backgroundParallaxX ?? 0))));
  const parallaxContinuityScore = clampScore(92 - offsetRange * 0.4 + (jitterRisk === "LOW" ? 2 : -4));
  const cameraFramingScore = clampScore(89 + Math.round((facePriority - 90) * 0.45) + (jitterRisk === "LOW" ? 2 : -5));
  const eyeVisibilityScore = clampScore(93 + Math.round((facePriority - 90) * 0.25));
  const characterDominanceScore = clampScore(93 + Math.round((cameraFramingScore - 88) * 0.25));
  const cinematicCompositionScore = clampScore(average([cameraFramingScore, facePriority, backgroundDepthScore, parallaxContinuityScore, cameraMotionSmoothness]));

  return {
    shot_preset: states[0]?.shotPreset ?? "CENTERED_HERO_SHOT",
    camera_framing_score: cameraFramingScore,
    face_framing_priority: facePriority,
    eye_visibility_score: eyeVisibilityScore,
    character_dominance_score: characterDominanceScore,
    background_depth_score: backgroundDepthScore,
    parallax_continuity_score: parallaxContinuityScore,
    cinematic_composition_score: cinematicCompositionScore,
    camera_motion_smoothness: cameraMotionSmoothness,
    framing_jitter_risk: jitterRisk,
  };
}
