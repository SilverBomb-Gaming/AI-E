import type { AnimeCharacterExpressionTemplate, AnimeCharacterProfile } from "./governedAnimeCharacterState";

export type AnimeEyePreset = "calm" | "focused" | "energetic" | "curious";

export type AnimeEyeRenderPlan = {
  preset: AnimeEyePreset;
  irisColor: readonly [number, number, number];
  outlineThickness: number;
  irisRadiusX: number;
  irisRadiusY: number;
  pupilRadius: number;
  highlightRadius: number;
  highlightOffsetX: number;
  highlightOffsetY: number;
  eyelashLength: number;
  symmetryCorrection: number;
  emotionalReadability: number;
  eyeQualityScore: number;
};

function presetForExpression(expression: AnimeCharacterExpressionTemplate): AnimeEyePreset {
  if (expression.id === "FOCUSED_DETERMINATION" || expression.id === "QUIET_RESOLVE") {
    return "focused";
  }
  if (expression.id === "MILD_WONDER") {
    return "curious";
  }
  if (expression.id === "SLIGHT_CONCERN") {
    return "energetic";
  }
  return "calm";
}

function irisColorForProfile(profile: AnimeCharacterProfile): readonly [number, number, number] {
  if (profile.id === "CHARACTER_002") {
    return [30, 238, 232];
  }
  if (profile.id === "CHARACTER_003") {
    return [168, 138, 245];
  }
  if (profile.id === "CHARACTER_004") {
    return [130, 226, 217];
  }
  return [20, 232, 224];
}

export function buildAnimeEyeRenderPlan(input: {
  profile: AnimeCharacterProfile;
  expression: AnimeCharacterExpressionTemplate;
}): AnimeEyeRenderPlan {
  const preset = presetForExpression(input.expression);
  const focused = preset === "focused";
  const curious = preset === "curious";
  const energetic = preset === "energetic";

  return {
    preset,
    irisColor: irisColorForProfile(input.profile),
    outlineThickness: focused ? 2.35 : 2.05,
    irisRadiusX: curious ? 6.7 : 6.2,
    irisRadiusY: energetic ? 11.6 : 10.8,
    pupilRadius: focused ? 2.8 : 2.4,
    highlightRadius: curious ? 2.4 : 2.1,
    highlightOffsetX: -2.2,
    highlightOffsetY: -4.2,
    eyelashLength: input.profile.genderPresentation === "young-adult heroine" ? 5.6 : 3.8,
    symmetryCorrection: input.profile.id === "CHARACTER_001" ? 0.25 : 0,
    emotionalReadability: focused ? 98 : energetic ? 96 : curious ? 97 : 95,
    eyeQualityScore: focused ? 98 : energetic ? 96 : curious ? 97 : 95,
  };
}
