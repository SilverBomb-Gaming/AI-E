import type { AnimeCharacterProfile } from "./governedAnimeCharacterState";

export type AnimeLightingMood =
  | "NEON_CHAMBER_DRAMA"
  | "SOFT_BEACON_GLOW"
  | "CRIMSON_HERO_CONTRAST"
  | "COOL_SCI_FI_BACKLIGHT"
  | "GOLDEN_ANIME_RIM";

export type AnimeLightingFlickerRisk = "LOW" | "MEDIUM" | "HIGH";

export type AnimeCinematicLightingState = {
  frameIndex: number;
  mood: AnimeLightingMood;
  keyLightStrength: number;
  rimLightStrength: number;
  eyeHighlightStrength: number;
  beaconGlowStrength: number;
  backgroundAtmosphereStrength: number;
  shadowStrength: number;
  colorContrastScore: number;
  lightingContinuityScore: number;
};

export type AnimeMoodPalette = {
  mood: AnimeLightingMood;
  keyLightColor: readonly [number, number, number];
  rimLightColor: readonly [number, number, number];
  eyeGlowColor: readonly [number, number, number];
  beaconGlowColor: readonly [number, number, number];
  atmosphereColor: readonly [number, number, number];
  shadowColor: readonly [number, number, number];
};

export type AnimeCinematicLightingDiagnostics = {
  lighting_mood: AnimeLightingMood;
  rim_light_score: number;
  eye_highlight_score: number;
  face_lighting_score: number;
  character_background_contrast: number;
  beacon_glow_control: number;
  atmosphere_depth_score: number;
  color_mood_score: number;
  lighting_continuity_score: number;
  lighting_flicker_risk: AnimeLightingFlickerRisk;
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function roundStrength(value: number): number {
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

export function resolveAnimeLightingMood(profile: AnimeCharacterProfile): AnimeLightingMood {
  if (profile.id === "CHARACTER_005") {
    return "CRIMSON_HERO_CONTRAST";
  }
  if (profile.id === "CHARACTER_001") {
    return "COOL_SCI_FI_BACKLIGHT";
  }
  if (profile.id === "CHARACTER_002") {
    return "NEON_CHAMBER_DRAMA";
  }
  if (profile.id === "CHARACTER_003") {
    return "SOFT_BEACON_GLOW";
  }
  return "GOLDEN_ANIME_RIM";
}

export function buildAnimeMoodPalette(mood: AnimeLightingMood): AnimeMoodPalette {
  if (mood === "CRIMSON_HERO_CONTRAST") {
    return {
      mood,
      keyLightColor: [255, 218, 174],
      rimLightColor: [255, 196, 62],
      eyeGlowColor: [255, 52, 68],
      beaconGlowColor: [72, 221, 240],
      atmosphereColor: [19, 29, 60],
      shadowColor: [8, 10, 22],
    };
  }
  if (mood === "COOL_SCI_FI_BACKLIGHT") {
    return {
      mood,
      keyLightColor: [202, 232, 255],
      rimLightColor: [92, 225, 255],
      eyeGlowColor: [126, 246, 255],
      beaconGlowColor: [66, 219, 246],
      atmosphereColor: [17, 31, 67],
      shadowColor: [8, 14, 29],
    };
  }
  if (mood === "SOFT_BEACON_GLOW") {
    return {
      mood,
      keyLightColor: [226, 238, 255],
      rimLightColor: [138, 229, 255],
      eyeGlowColor: [206, 247, 255],
      beaconGlowColor: [94, 227, 244],
      atmosphereColor: [24, 35, 72],
      shadowColor: [10, 15, 30],
    };
  }
  if (mood === "GOLDEN_ANIME_RIM") {
    return {
      mood,
      keyLightColor: [255, 229, 184],
      rimLightColor: [255, 209, 92],
      eyeGlowColor: [244, 250, 255],
      beaconGlowColor: [78, 213, 236],
      atmosphereColor: [22, 29, 56],
      shadowColor: [9, 11, 23],
    };
  }
  return {
    mood,
    keyLightColor: [226, 218, 255],
    rimLightColor: [255, 86, 202],
    eyeGlowColor: [255, 116, 218],
    beaconGlowColor: [62, 232, 244],
    atmosphereColor: [21, 22, 58],
    shadowColor: [8, 9, 24],
  };
}

export function buildAnimeCinematicLightingState(input: {
  profile: AnimeCharacterProfile;
  frameIndex: number;
  frameCount: number;
  mood?: AnimeLightingMood;
}): AnimeCinematicLightingState {
  const frameCount = Math.max(1, input.frameCount);
  const frameIndex = Math.max(0, input.frameIndex) % frameCount;
  const mood = input.mood ?? resolveAnimeLightingMood(input.profile);
  const progress = smoothStep(normalizedFrame(frameIndex, frameCount));
  const pulse = Math.sin(progress * Math.PI) * 0.018;
  const moodBoost = mood === "CRIMSON_HERO_CONTRAST" ? 0.06 : mood === "GOLDEN_ANIME_RIM" ? 0.04 : 0.02;
  const rimLightStrength = roundStrength(0.56 + moodBoost + pulse);
  const eyeHighlightStrength = roundStrength(0.7 + (mood === "CRIMSON_HERO_CONTRAST" ? 0.08 : 0.04) + pulse * 0.6);
  const beaconGlowStrength = roundStrength(0.42 + (mood === "SOFT_BEACON_GLOW" ? 0.07 : 0.02) + pulse * 0.4);
  const backgroundAtmosphereStrength = roundStrength(0.5 + (mood === "CRIMSON_HERO_CONTRAST" || mood === "COOL_SCI_FI_BACKLIGHT" ? 0.07 : 0.03));
  const shadowStrength = roundStrength(0.4 + (mood === "CRIMSON_HERO_CONTRAST" ? 0.08 : 0.04));
  const keyLightStrength = roundStrength(0.54 + (mood === "SOFT_BEACON_GLOW" ? 0.04 : 0.02));
  const largestStrength = Math.max(rimLightStrength, eyeHighlightStrength, beaconGlowStrength, backgroundAtmosphereStrength, shadowStrength, keyLightStrength);
  const colorContrastScore = clampScore(88 + moodBoost * 70 + shadowStrength * 5);
  const lightingContinuityScore = clampScore(96 - Math.abs(pulse) * 90 - Math.max(0, largestStrength - 0.82) * 18);

  return {
    frameIndex,
    mood,
    keyLightStrength,
    rimLightStrength,
    eyeHighlightStrength,
    beaconGlowStrength,
    backgroundAtmosphereStrength,
    shadowStrength,
    colorContrastScore,
    lightingContinuityScore,
  };
}

export function buildAnimeCinematicLightingSequence(input: {
  profile: AnimeCharacterProfile;
  frameCount: number;
  mood?: AnimeLightingMood;
}): AnimeCinematicLightingState[] {
  return Array.from({ length: input.frameCount }, (_, frameIndex) => buildAnimeCinematicLightingState({
    profile: input.profile,
    frameIndex,
    frameCount: input.frameCount,
    mood: input.mood,
  }));
}

function average(values: number[]): number {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function summarizeAnimeCinematicLightingDiagnostics(states: AnimeCinematicLightingState[]): AnimeCinematicLightingDiagnostics {
  const rimAverage = average(states.map((entry) => entry.rimLightStrength * 100));
  const eyeAverage = average(states.map((entry) => entry.eyeHighlightStrength * 100));
  const atmosphereAverage = average(states.map((entry) => entry.backgroundAtmosphereStrength * 100));
  const continuityAverage = average(states.map((entry) => entry.lightingContinuityScore));
  const contrastAverage = average(states.map((entry) => entry.colorContrastScore));
  const rimRange = Math.max(...states.map((entry) => entry.rimLightStrength)) - Math.min(...states.map((entry) => entry.rimLightStrength));
  const eyeRange = Math.max(...states.map((entry) => entry.eyeHighlightStrength)) - Math.min(...states.map((entry) => entry.eyeHighlightStrength));
  const lightingFlickerRisk: AnimeLightingFlickerRisk = rimRange <= 0.04 && eyeRange <= 0.04 ? "LOW" : rimRange <= 0.07 && eyeRange <= 0.07 ? "MEDIUM" : "HIGH";
  const rimLightScore = clampScore(86 + rimAverage * 0.1 + (lightingFlickerRisk === "LOW" ? 2 : -5));
  const eyeHighlightScore = clampScore(88 + eyeAverage * 0.08 + (lightingFlickerRisk === "LOW" ? 2 : -5));
  const faceLightingScore = clampScore(89 + eyeAverage * 0.04 + contrastAverage * 0.03);
  const characterBackgroundContrast = clampScore(88 + contrastAverage * 0.05 + rimAverage * 0.04);
  const beaconGlowControl = clampScore(92 - Math.max(0, average(states.map((entry) => entry.beaconGlowStrength * 100)) - 54) * 0.4);
  const atmosphereDepthScore = clampScore(86 + atmosphereAverage * 0.1);
  const colorMoodScore = clampScore(87 + contrastAverage * 0.07);

  return {
    lighting_mood: states[0]?.mood ?? "SOFT_BEACON_GLOW",
    rim_light_score: rimLightScore,
    eye_highlight_score: eyeHighlightScore,
    face_lighting_score: faceLightingScore,
    character_background_contrast: characterBackgroundContrast,
    beacon_glow_control: beaconGlowControl,
    atmosphere_depth_score: atmosphereDepthScore,
    color_mood_score: colorMoodScore,
    lighting_continuity_score: continuityAverage,
    lighting_flicker_risk: lightingFlickerRisk,
  };
}
