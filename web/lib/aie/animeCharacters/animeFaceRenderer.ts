import type { AnimeCharacterExpressionTemplate, AnimeCharacterProfile } from "./governedAnimeCharacterState";

export type AnimeFaceRenderPlan = {
  centerX: number;
  centerY: number;
  faceRadiusX: number;
  faceRadiusY: number;
  chinY: number;
  jawWidth: number;
  eyeLineY: number;
  mouthY: number;
  noseY: number;
  skinBase: readonly [number, number, number];
  skinShadow: readonly [number, number, number];
  blush: readonly [number, number, number];
  faceReadabilityScore: number;
  silhouetteReadabilityScore: number;
  proportionScore: number;
};

function skinForProfile(profile: AnimeCharacterProfile): Pick<AnimeFaceRenderPlan, "skinBase" | "skinShadow" | "blush"> {
  if (profile.id === "CHARACTER_004") {
    return { skinBase: [204, 161, 128], skinShadow: [160, 111, 89], blush: [222, 124, 132] };
  }
  if (profile.id === "CHARACTER_003") {
    return { skinBase: [226, 196, 171], skinShadow: [183, 145, 128], blush: [235, 145, 167] };
  }
  return { skinBase: [241, 204, 180], skinShadow: [203, 156, 140], blush: [244, 136, 153] };
}

export function buildAnimeFaceRenderPlan(input: {
  profile: AnimeCharacterProfile;
  expression: AnimeCharacterExpressionTemplate;
}): AnimeFaceRenderPlan {
  const confidentPose = input.profile.poseDefault === "NEUTRAL_HERO_STANCE" || input.profile.poseDefault === "SUBTLE_ACTION_READY_STANCE";
  return {
    centerX: confidentPose ? 120 : 122,
    centerY: 80,
    faceRadiusX: 33,
    faceRadiusY: 42,
    chinY: 125,
    jawWidth: 19,
    eyeLineY: 82,
    mouthY: input.expression.id === "SLIGHT_CONCERN" ? 107 : 109,
    noseY: 96,
    ...skinForProfile(input.profile),
    faceReadabilityScore: 96,
    silhouetteReadabilityScore: 95,
    proportionScore: 94,
  };
}
