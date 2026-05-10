import type { AnimeCharacterProfile } from "./governedAnimeCharacterState";
import type { AnimePoseLanguagePreset } from "./animePoseLanguage";

export type AnimePoseEnergyProfileId =
  | "CONFIDENT_HERO_LINE"
  | "CALM_READY_LINE"
  | "INTENSE_FORWARD_FOCUS"
  | "SOFT_BALANCED_STANCE";

export type AnimePoseEnergyState = {
  profileId: AnimePoseEnergyProfileId;
  lineOfActionAngle: number;
  shoulderHipCounterTilt: number;
  forwardDrive: number;
  weightShift: number;
  poseAsymmetry: number;
  silhouetteFlowScore: number;
  poseEnergyScore: number;
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

export function resolveAnimePoseEnergyProfile(input: {
  profile: AnimeCharacterProfile;
  posePreset: AnimePoseLanguagePreset;
}): AnimePoseEnergyProfileId {
  if (input.profile.id === "CHARACTER_005") {
    return input.posePreset.id === "CONFIDENT_FRONT_STANCE" ? "INTENSE_FORWARD_FOCUS" : "CONFIDENT_HERO_LINE";
  }
  if (input.posePreset.id === "FOCUSED_READY_POSE") {
    return "INTENSE_FORWARD_FOCUS";
  }
  if (input.posePreset.id === "SLIGHT_HALF_TURN" || input.posePreset.id === "BEACON_SIDE_GLANCE") {
    return "CONFIDENT_HERO_LINE";
  }
  if (input.profile.id === "CHARACTER_003") {
    return "SOFT_BALANCED_STANCE";
  }
  return "CALM_READY_LINE";
}

export function buildAnimePoseEnergyState(input: {
  profile: AnimeCharacterProfile;
  posePreset: AnimePoseLanguagePreset;
  frameIndex?: number;
  profileId?: AnimePoseEnergyProfileId;
}): AnimePoseEnergyState {
  const profileId = input.profileId ?? resolveAnimePoseEnergyProfile({ profile: input.profile, posePreset: input.posePreset });
  const frameIndex = input.frameIndex ?? 0;
  const breath = Math.sin(frameIndex * 0.64) * 0.35;
  const base = profileId === "INTENSE_FORWARD_FOCUS"
    ? { line: -7.5, counter: 6.8, drive: 0.86, shift: -3.8, asymmetry: 0.36, flow: 91, energy: 92 }
    : profileId === "CONFIDENT_HERO_LINE"
      ? { line: -5.4, counter: 5.2, drive: 0.72, shift: -2.6, asymmetry: 0.3, flow: 90, energy: 90 }
      : profileId === "SOFT_BALANCED_STANCE"
        ? { line: -2.2, counter: 2.8, drive: 0.45, shift: -1.2, asymmetry: 0.18, flow: 88, energy: 86 }
        : { line: -1.6, counter: 2.2, drive: 0.38, shift: -0.8, asymmetry: 0.14, flow: 87, energy: 85 };
  const presetAsymmetry = input.posePreset.poseAsymmetry * 0.4;

  return {
    profileId,
    lineOfActionAngle: round(base.line + input.posePreset.torsoAngle * 0.35 + breath),
    shoulderHipCounterTilt: round(base.counter + Math.abs(input.posePreset.shoulderAngle) * 0.25),
    forwardDrive: round(Math.min(0.95, base.drive + Math.abs(input.posePreset.torsoAngle) * 0.015)),
    weightShift: round(base.shift + input.posePreset.poseAsymmetry * -2 + breath),
    poseAsymmetry: round(Math.min(0.48, base.asymmetry + presetAsymmetry)),
    silhouetteFlowScore: clampScore(base.flow + input.posePreset.poseAsymmetry * 8 + (input.profile.id === "CHARACTER_005" ? 2 : 0)),
    poseEnergyScore: clampScore(base.energy + input.posePreset.poseAsymmetry * 8 + (input.profile.id === "CHARACTER_005" ? 2 : 0)),
  };
}

export function buildAnimePoseEnergySequence(input: {
  profile: AnimeCharacterProfile;
  posePreset: AnimePoseLanguagePreset;
  frameCount: number;
  profileId?: AnimePoseEnergyProfileId;
}): AnimePoseEnergyState[] {
  return Array.from({ length: input.frameCount }, (_, frameIndex) => buildAnimePoseEnergyState({
    profile: input.profile,
    posePreset: input.posePreset,
    frameIndex,
    profileId: input.profileId,
  }));
}

function average(values: number[]): number {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function summarizeAnimePoseEnergy(states: AnimePoseEnergyState[]) {
  return {
    pose_energy_profile: states[0]?.profileId ?? "CALM_READY_LINE",
    pose_energy_score: average(states.map((entry) => entry.poseEnergyScore)),
    silhouette_flow_score: average(states.map((entry) => entry.silhouetteFlowScore)),
    line_of_action_angle: round(average(states.map((entry) => entry.lineOfActionAngle * 10)) / 10),
    pose_asymmetry: round(average(states.map((entry) => entry.poseAsymmetry * 100)) / 100),
  };
}
