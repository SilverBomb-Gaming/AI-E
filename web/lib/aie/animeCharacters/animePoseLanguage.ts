import type { AnimeCharacterPoseTemplate, AnimeCharacterProfile } from "./governedAnimeCharacterState";

export type AnimePoseLanguagePresetId =
  | "CONFIDENT_FRONT_STANCE"
  | "CALM_HERO_STANCE"
  | "SLIGHT_HALF_TURN"
  | "BEACON_SIDE_GLANCE"
  | "FOCUSED_READY_POSE";

export type AnimeArmPose = {
  upperArmAngle: number;
  forearmAngle: number;
  elbowOffsetX: number;
  elbowOffsetY: number;
  handOffsetX: number;
  handOffsetY: number;
  handOrientation: "relaxed-down" | "at-hip" | "forward-ready" | "soft-profile";
};

export type AnimePoseLanguagePreset = {
  id: AnimePoseLanguagePresetId;
  label: string;
  headTilt: number;
  shoulderAngle: number;
  torsoAngle: number;
  leftArm: AnimeArmPose;
  rightArm: AnimeArmPose;
  stanceBalance: number;
  stanceWidthMultiplier: number;
  poseAsymmetry: number;
};

const PRESETS: readonly AnimePoseLanguagePreset[] = [
  {
    id: "CONFIDENT_FRONT_STANCE",
    label: "Confident front stance",
    headTilt: -1.5,
    shoulderAngle: -2.4,
    torsoAngle: 1.2,
    leftArm: { upperArmAngle: 104, forearmAngle: 74, elbowOffsetX: -26, elbowOffsetY: 32, handOffsetX: -20, handOffsetY: 62, handOrientation: "at-hip" },
    rightArm: { upperArmAngle: 72, forearmAngle: 92, elbowOffsetX: 28, elbowOffsetY: 31, handOffsetX: 42, handOffsetY: 55, handOrientation: "relaxed-down" },
    stanceBalance: 94,
    stanceWidthMultiplier: 1.08,
    poseAsymmetry: 0.18,
  },
  {
    id: "CALM_HERO_STANCE",
    label: "Calm hero stance",
    headTilt: 0,
    shoulderAngle: 0.8,
    torsoAngle: 0,
    leftArm: { upperArmAngle: 100, forearmAngle: 86, elbowOffsetX: -30, elbowOffsetY: 34, handOffsetX: -34, handOffsetY: 60, handOrientation: "relaxed-down" },
    rightArm: { upperArmAngle: 80, forearmAngle: 94, elbowOffsetX: 30, elbowOffsetY: 34, handOffsetX: 35, handOffsetY: 60, handOrientation: "relaxed-down" },
    stanceBalance: 96,
    stanceWidthMultiplier: 1,
    poseAsymmetry: 0.08,
  },
  {
    id: "SLIGHT_HALF_TURN",
    label: "Slight half turn",
    headTilt: -2,
    shoulderAngle: -5.5,
    torsoAngle: -4,
    leftArm: { upperArmAngle: 108, forearmAngle: 86, elbowOffsetX: -24, elbowOffsetY: 33, handOffsetX: -28, handOffsetY: 58, handOrientation: "soft-profile" },
    rightArm: { upperArmAngle: 72, forearmAngle: 84, elbowOffsetX: 34, elbowOffsetY: 29, handOffsetX: 31, handOffsetY: 54, handOrientation: "relaxed-down" },
    stanceBalance: 91,
    stanceWidthMultiplier: 0.94,
    poseAsymmetry: 0.24,
  },
  {
    id: "BEACON_SIDE_GLANCE",
    label: "Beacon side glance",
    headTilt: 3,
    shoulderAngle: 4.5,
    torsoAngle: 5,
    leftArm: { upperArmAngle: 96, forearmAngle: 68, elbowOffsetX: -31, elbowOffsetY: 31, handOffsetX: -20, handOffsetY: 50, handOrientation: "soft-profile" },
    rightArm: { upperArmAngle: 76, forearmAngle: 98, elbowOffsetX: 27, elbowOffsetY: 34, handOffsetX: 38, handOffsetY: 62, handOrientation: "relaxed-down" },
    stanceBalance: 90,
    stanceWidthMultiplier: 0.96,
    poseAsymmetry: 0.28,
  },
  {
    id: "FOCUSED_READY_POSE",
    label: "Focused ready pose",
    headTilt: -1,
    shoulderAngle: -3.5,
    torsoAngle: -2,
    leftArm: { upperArmAngle: 112, forearmAngle: 58, elbowOffsetX: -30, elbowOffsetY: 30, handOffsetX: -11, handOffsetY: 47, handOrientation: "forward-ready" },
    rightArm: { upperArmAngle: 66, forearmAngle: 112, elbowOffsetX: 34, elbowOffsetY: 32, handOffsetX: 47, handOffsetY: 58, handOrientation: "forward-ready" },
    stanceBalance: 89,
    stanceWidthMultiplier: 1.12,
    poseAsymmetry: 0.32,
  },
] as const;

export function listAnimePoseLanguagePresets(): AnimePoseLanguagePreset[] {
  return PRESETS.map((entry) => ({ ...entry, leftArm: { ...entry.leftArm }, rightArm: { ...entry.rightArm } }));
}

export function getAnimePoseLanguagePresetById(presetId: string): AnimePoseLanguagePreset | null {
  const normalized = presetId.trim().toUpperCase() as AnimePoseLanguagePresetId;
  const preset = PRESETS.find((entry) => entry.id === normalized);
  return preset ? { ...preset, leftArm: { ...preset.leftArm }, rightArm: { ...preset.rightArm } } : null;
}

export function resolveAnimePoseLanguagePreset(input: {
  profile: AnimeCharacterProfile;
  poseTemplate: AnimeCharacterPoseTemplate;
}): AnimePoseLanguagePreset {
  if (input.profile.id === "CHARACTER_005") {
    return getAnimePoseLanguagePresetById("CONFIDENT_FRONT_STANCE") ?? listAnimePoseLanguagePresets()[0];
  }

  const mappedPreset: Record<string, AnimePoseLanguagePresetId> = {
    NEUTRAL_HERO_STANCE: "CALM_HERO_STANCE",
    HALF_TURN_REVEAL_STANCE: "SLIGHT_HALF_TURN",
    BEACON_FACING_CONTEMPLATIVE_STANCE: "BEACON_SIDE_GLANCE",
    SUBTLE_ACTION_READY_STANCE: "FOCUSED_READY_POSE",
    GENTLE_WALKING_APPROACH_STANCE: "SLIGHT_HALF_TURN",
    AFTERMATH_HOLD_STANCE: "CALM_HERO_STANCE",
  };

  return getAnimePoseLanguagePresetById(mappedPreset[input.poseTemplate.id] ?? "CALM_HERO_STANCE") ?? listAnimePoseLanguagePresets()[0];
}
