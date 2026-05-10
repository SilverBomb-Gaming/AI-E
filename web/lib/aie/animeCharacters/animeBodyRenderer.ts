import type { AnimeCharacterProfile } from "./governedAnimeCharacterState";
import type { AnimePoseLanguagePreset } from "./animePoseLanguage";

export type AnimeBodyArmPlan = {
  upperArmLength: number;
  forearmLength: number;
  sleeveWidth: number;
  cuffWidth: number;
  palmWidth: number;
  palmHeight: number;
  elbowOffsetX: number;
  elbowOffsetY: number;
  handOffsetX: number;
  handOffsetY: number;
  handOrientation: AnimePoseLanguagePreset["leftArm"]["handOrientation"];
};

export type AnimeBodyPlan = {
  headToBodyRatio: number;
  shoulderWidth: number;
  torsoHeight: number;
  waistWidth: number;
  armLength: number;
  handSize: number;
  stanceWidth: number;
  poseAsymmetry: number;
  silhouetteScore: number;
  neckHeight: number;
  shoulderAngle: number;
  torsoAngle: number;
  collarHeight: number;
  jacketPanelWidth: number;
  lowerGarmentLength: number;
  fabricFlow: number;
  leftArm: AnimeBodyArmPlan;
  rightArm: AnimeBodyArmPlan;
  torsoReadabilityScore: number;
  armReadabilityScore: number;
  handReadabilityScore: number;
  outfitFlowScore: number;
  stanceBalanceScore: number;
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function armPlanFromPose(input: {
  arm: AnimePoseLanguagePreset["leftArm"];
  armLength: number;
  profile: AnimeCharacterProfile;
}): AnimeBodyArmPlan {
  const sleeveBonus = input.profile.id === "CHARACTER_005" ? 1.5 : 0;
  return {
    upperArmLength: Math.round(input.armLength * 0.48),
    forearmLength: Math.round(input.armLength * 0.46),
    sleeveWidth: 6 + sleeveBonus,
    cuffWidth: 8 + sleeveBonus,
    palmWidth: input.profile.id === "CHARACTER_005" ? 10 : 8,
    palmHeight: input.arm.handOrientation === "at-hip" ? 11 : input.profile.id === "CHARACTER_005" ? 9 : 8,
    elbowOffsetX: input.arm.elbowOffsetX,
    elbowOffsetY: input.arm.elbowOffsetY,
    handOffsetX: input.arm.handOffsetX,
    handOffsetY: input.arm.handOffsetY,
    handOrientation: input.arm.handOrientation,
  };
}

export function buildAnimeBodyPlan(input: {
  profile: AnimeCharacterProfile;
  posePreset: AnimePoseLanguagePreset;
  frameIndex?: number;
}): AnimeBodyPlan {
  const heroine = input.profile.genderPresentation === "young-adult heroine";
  const solarProfile = input.profile.id === "CHARACTER_005";
  const frameIndex = input.frameIndex ?? 0;
  const fabricFlow = Number((Math.sin(frameIndex * 0.72) * 1.6).toFixed(2));
  const headToBodyRatio = heroine ? 0.31 : 0.29;
  const shoulderWidth = solarProfile ? 90 : heroine ? 84 : 88;
  const torsoHeight = solarProfile ? 82 : 78;
  const waistWidth = solarProfile ? 48 : heroine ? 46 : 52;
  const armLength = solarProfile ? 67 : 63;
  const handSize = solarProfile ? 8.5 : 8;
  const stanceWidth = Math.round((solarProfile ? 52 : 47) * input.posePreset.stanceWidthMultiplier);
  const poseAsymmetry = input.posePreset.poseAsymmetry;
  const silhouetteScore = clampScore(89 + shoulderWidth / 90 + poseAsymmetry * 10 + (solarProfile ? 2 : 0));
  const torsoReadabilityScore = clampScore(88 + (shoulderWidth - waistWidth) / 12 + (solarProfile ? 2 : 0));
  const armReadabilityScore = clampScore(86 + poseAsymmetry * 7 + (solarProfile ? 1 : 0));
  const handReadabilityScore = clampScore(83 + handSize + (input.posePreset.leftArm.handOrientation === "at-hip" ? 2 : 0));
  const outfitFlowScore = clampScore(88 + (solarProfile ? 4 : 1) + Math.abs(fabricFlow));

  return {
    headToBodyRatio,
    shoulderWidth,
    torsoHeight,
    waistWidth,
    armLength,
    handSize,
    stanceWidth,
    poseAsymmetry,
    silhouetteScore,
    neckHeight: 16,
    shoulderAngle: input.posePreset.shoulderAngle,
    torsoAngle: input.posePreset.torsoAngle,
    collarHeight: solarProfile ? 17 : 14,
    jacketPanelWidth: solarProfile ? 25 : 21,
    lowerGarmentLength: solarProfile ? 31 : 27,
    fabricFlow,
    leftArm: armPlanFromPose({ arm: input.posePreset.leftArm, armLength, profile: input.profile }),
    rightArm: armPlanFromPose({ arm: input.posePreset.rightArm, armLength, profile: input.profile }),
    torsoReadabilityScore,
    armReadabilityScore,
    handReadabilityScore,
    outfitFlowScore,
    stanceBalanceScore: clampScore(input.posePreset.stanceBalance + (solarProfile ? 1 : 0)),
  };
}

export function summarizeAnimeBodyPlanDiagnostics(plan: AnimeBodyPlan) {
  return {
    body_silhouette_score: plan.silhouetteScore,
    torso_readability_score: plan.torsoReadabilityScore,
    arm_readability_score: plan.armReadabilityScore,
    hand_readability_score: plan.handReadabilityScore,
    pose_language_score: clampScore((plan.silhouetteScore + plan.stanceBalanceScore + plan.armReadabilityScore) / 3),
    outfit_flow_score: plan.outfitFlowScore,
    stance_balance_score: plan.stanceBalanceScore,
  };
}
