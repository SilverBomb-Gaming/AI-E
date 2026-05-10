import type { AnimeCharacterProfile } from "./governedAnimeCharacterState";
import type { AnimeBodyPlan } from "./animeBodyRenderer";
import type { AnimePoseLanguagePreset } from "./animePoseLanguage";
import type { AnimeMotionContinuityPlan } from "./animeMotionContinuity";

export type AnimeLowerBodyFootPlan = {
  anchorX: number;
  anchorY: number;
  width: number;
  height: number;
  toeDirection: -1 | 1;
  contactShadowWidth: number;
};

export type AnimeLowerBodyLegPlan = {
  hipX: number;
  hipY: number;
  kneeX: number;
  kneeY: number;
  ankleX: number;
  ankleY: number;
  thighWidth: number;
  calfWidth: number;
  kneeWidth: number;
};

export type AnimeLowerBodyPlan = {
  hipWidth: number;
  upperLegLength: number;
  lowerLegLength: number;
  stanceWidth: number;
  bodyBalanceCenter: number;
  waistTransitionWidth: number;
  lowerJacketOverlap: number;
  clothOverlapZones: Array<"front-panel" | "left-flap" | "right-flap" | "boot-clearance">;
  leftLeg: AnimeLowerBodyLegPlan;
  rightLeg: AnimeLowerBodyLegPlan;
  leftFoot: AnimeLowerBodyFootPlan;
  rightFoot: AnimeLowerBodyFootPlan;
  lowerBodyReadability: number;
  footGroundingScore: number;
  stanceGroundingScore: number;
  waistTransitionScore: number;
  fabricMotionScore: number;
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function legPlan(input: {
  side: -1 | 1;
  hipWidth: number;
  stanceWidth: number;
  upperLegLength: number;
  lowerLegLength: number;
  hipY: number;
  balanceShift: number;
  posePreset: AnimePoseLanguagePreset;
}): AnimeLowerBodyLegPlan {
  const hipX = input.side * input.hipWidth * 0.34 + input.balanceShift * 0.24;
  const kneeX = input.side * input.stanceWidth * 0.24 + input.balanceShift * 0.5 + input.side * input.posePreset.poseAsymmetry * 5;
  const kneeY = input.hipY + input.upperLegLength;
  const ankleX = input.side * input.stanceWidth * 0.5 + input.balanceShift * 0.2;
  const ankleY = kneeY + input.lowerLegLength;

  return {
    hipX: Number(hipX.toFixed(2)),
    hipY: input.hipY,
    kneeX: Number(kneeX.toFixed(2)),
    kneeY: Number(kneeY.toFixed(2)),
    ankleX: Number(ankleX.toFixed(2)),
    ankleY: Number(ankleY.toFixed(2)),
    thighWidth: 7.8,
    calfWidth: 5.8,
    kneeWidth: 6.8,
  };
}

export function buildAnimeLowerBodyPlan(input: {
  profile: AnimeCharacterProfile;
  bodyPlan: AnimeBodyPlan;
  posePreset: AnimePoseLanguagePreset;
  motionPlan: AnimeMotionContinuityPlan;
}): AnimeLowerBodyPlan {
  const solarProfile = input.profile.id === "CHARACTER_005";
  const hipWidth = solarProfile ? 54 : 50;
  const upperLegLength = solarProfile ? 17 : 16;
  const lowerLegLength = solarProfile ? 20 : 19;
  const stanceWidth = Math.max(input.bodyPlan.stanceWidth + 6, solarProfile ? 62 : 54);
  const hipY = 0;
  const balanceShift = input.motionPlan.easedWeightShift;
  const leftLeg = legPlan({ side: -1, hipWidth, stanceWidth, upperLegLength, lowerLegLength, hipY, balanceShift, posePreset: input.posePreset });
  const rightLeg = legPlan({ side: 1, hipWidth, stanceWidth, upperLegLength, lowerLegLength, hipY: hipY - 1, balanceShift, posePreset: input.posePreset });
  const groundY = Math.max(leftLeg.ankleY, rightLeg.ankleY) + 5;
  const leftFoot: AnimeLowerBodyFootPlan = {
    anchorX: leftLeg.ankleX - 5,
    anchorY: groundY,
    width: solarProfile ? 19 : 16,
    height: 5.4,
    toeDirection: -1,
    contactShadowWidth: solarProfile ? 24 : 20,
  };
  const rightFoot: AnimeLowerBodyFootPlan = {
    anchorX: rightLeg.ankleX + 6,
    anchorY: groundY,
    width: solarProfile ? 20 : 17,
    height: 5.4,
    toeDirection: 1,
    contactShadowWidth: solarProfile ? 25 : 21,
  };
  const lowerBodyReadability = clampScore(88 + (stanceWidth - 54) / 4 + (solarProfile ? 1 : 0));
  const footGroundingScore = clampScore(83 + leftFoot.width / 6 + rightFoot.width / 6 + input.motionPlan.stancePreservation / 20);
  const stanceGroundingScore = clampScore(90 + stanceWidth / 24 - Math.abs(balanceShift) * 0.6);
  const waistTransitionScore = clampScore(88 + (hipWidth - input.bodyPlan.waistWidth) / 3 + (solarProfile ? 2 : 0));
  const fabricMotionScore = clampScore(input.motionPlan.fabricContinuityScore + (solarProfile ? 2 : 0));

  return {
    hipWidth,
    upperLegLength,
    lowerLegLength,
    stanceWidth,
    bodyBalanceCenter: Number(balanceShift.toFixed(2)),
    waistTransitionWidth: Math.max(input.bodyPlan.waistWidth + 7, hipWidth),
    lowerJacketOverlap: solarProfile ? 18 : 15,
    clothOverlapZones: ["front-panel", "left-flap", "right-flap", "boot-clearance"],
    leftLeg,
    rightLeg,
    leftFoot,
    rightFoot,
    lowerBodyReadability,
    footGroundingScore,
    stanceGroundingScore,
    waistTransitionScore,
    fabricMotionScore,
  };
}

export function summarizeAnimeLowerBodyDiagnostics(plan: AnimeLowerBodyPlan) {
  return {
    lower_body_readability: plan.lowerBodyReadability,
    foot_grounding_score: plan.footGroundingScore,
    stance_grounding_score: plan.stanceGroundingScore,
    waist_transition_score: plan.waistTransitionScore,
    fabric_motion_score: plan.fabricMotionScore,
  };
}
