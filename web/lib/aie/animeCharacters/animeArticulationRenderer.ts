import type { AnimeBodyPlan } from "./animeBodyRenderer";
import type { AnimeLowerBodyPlan } from "./animeLowerBodyRenderer";
import type { AnimePoseLanguagePreset } from "./animePoseLanguage";
import type { AnimePoseEnergyState } from "./animePoseEnergy";
import type { AnimeCharacterProfile } from "./governedAnimeCharacterState";

export type AnimeAnatomyPrimitiveRisk = "LOW" | "MEDIUM" | "HIGH";

export type AnimeArticulatedArmPlan = {
  shoulderAngle: number;
  elbowBend: number;
  wristAngle: number;
  upperArmWidth: number;
  forearmWidth: number;
  elbowCueRadius: number;
  palmWidth: number;
  palmHeight: number;
  thumbCueDirection: -1 | 1;
  fingerGroupCount: number;
  handShapeReadabilityScore: number;
};

export type AnimeArticulatedLegPlan = {
  hipAngle: number;
  kneeBend: number;
  footAngle: number;
  thighWidth: number;
  calfWidth: number;
  kneeCueRadius: number;
  footStanceDirection: -1 | 1;
  weightRole: "weight-bearing" | "relaxed";
};

export type AnimeArticulationPlan = {
  frameIndex: number;
  shoulderAngle: number;
  elbowBend: number;
  wristAngle: number;
  hipAngle: number;
  kneeBend: number;
  footAngle: number;
  lineOfAction: number;
  poseAsymmetry: number;
  silhouetteFlowScore: number;
  leftArm: AnimeArticulatedArmPlan;
  rightArm: AnimeArticulatedArmPlan;
  leftLeg: AnimeArticulatedLegPlan;
  rightLeg: AnimeArticulatedLegPlan;
  shoulderArticulationScore: number;
  elbowReadabilityScore: number;
  wristHandConnectionScore: number;
  handShapeReadabilityScore: number;
  hipKneeArticulationScore: number;
  footPoseReadabilityScore: number;
  poseEnergyScore: number;
  anatomyPrimitiveRisk: AnimeAnatomyPrimitiveRisk;
};

export type AnimeArticulationDiagnostics = {
  shoulder_articulation_score: number;
  elbow_readability_score: number;
  wrist_hand_connection_score: number;
  hand_shape_readability_score: number;
  hip_knee_articulation_score: number;
  foot_pose_readability_score: number;
  pose_energy_score: number;
  silhouette_flow_score: number;
  anatomy_primitive_risk: AnimeAnatomyPrimitiveRisk;
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function angleDelta(first: number, second: number): number {
  const raw = Math.abs(first - second) % 360;
  return raw > 180 ? 360 - raw : raw;
}

function buildArm(input: {
  side: -1 | 1;
  bodyPlan: AnimeBodyPlan;
  posePreset: AnimePoseLanguagePreset;
  poseEnergyState: AnimePoseEnergyState;
  profile: AnimeCharacterProfile;
}): AnimeArticulatedArmPlan {
  const poseArm = input.side === -1 ? input.posePreset.leftArm : input.posePreset.rightArm;
  const bodyArm = input.side === -1 ? input.bodyPlan.leftArm : input.bodyPlan.rightArm;
  const elbowBend = clampScore(54 + angleDelta(poseArm.upperArmAngle, poseArm.forearmAngle) * 0.42 + input.poseEnergyState.forwardDrive * 12);
  const solarBoost = input.profile.id === "CHARACTER_005" ? 1.2 : 0;
  const palmWidth = bodyArm.palmWidth + 2.8 + input.poseEnergyState.poseAsymmetry * 2 + solarBoost;
  const palmHeight = bodyArm.palmHeight + 1.2 + (poseArm.handOrientation === "forward-ready" ? 1.6 : 0.6);
  const wristAngle = round(poseArm.forearmAngle + input.side * (8 + input.poseEnergyState.poseAsymmetry * 11));

  return {
    shoulderAngle: round(poseArm.upperArmAngle + input.side * input.poseEnergyState.shoulderHipCounterTilt * 0.35),
    elbowBend,
    wristAngle,
    upperArmWidth: round(bodyArm.sleeveWidth + 1.2 + solarBoost),
    forearmWidth: round(Math.max(4.8, bodyArm.sleeveWidth - 0.6 + solarBoost * 0.4)),
    elbowCueRadius: round(3.2 + elbowBend / 48),
    palmWidth: round(palmWidth),
    palmHeight: round(palmHeight),
    thumbCueDirection: input.side === -1 ? 1 : -1,
    fingerGroupCount: 3,
    handShapeReadabilityScore: clampScore(78 + palmWidth * 0.9 + elbowBend * 0.06 + (poseArm.handOrientation === "forward-ready" ? 2 : 0)),
  };
}

function buildLeg(input: {
  side: -1 | 1;
  lowerBodyPlan: AnimeLowerBodyPlan;
  poseEnergyState: AnimePoseEnergyState;
}): AnimeArticulatedLegPlan {
  const leg = input.side === -1 ? input.lowerBodyPlan.leftLeg : input.lowerBodyPlan.rightLeg;
  const foot = input.side === -1 ? input.lowerBodyPlan.leftFoot : input.lowerBodyPlan.rightFoot;
  const thighLean = leg.kneeX - leg.hipX;
  const calfLean = leg.ankleX - leg.kneeX;
  const kneeBend = clampScore(52 + Math.abs(thighLean - calfLean) * 1.8 + input.poseEnergyState.forwardDrive * 18);
  const weightBearing = input.side === -1 ? input.poseEnergyState.weightShift <= 0 : input.poseEnergyState.weightShift > 0;

  return {
    hipAngle: round(thighLean * 2.2 + input.poseEnergyState.shoulderHipCounterTilt * input.side),
    kneeBend,
    footAngle: round(foot.toeDirection * (7 + input.poseEnergyState.poseAsymmetry * 13)),
    thighWidth: round(leg.thighWidth + (weightBearing ? 1.1 : 0.5)),
    calfWidth: round(leg.calfWidth + (weightBearing ? 0.8 : 0.4)),
    kneeCueRadius: round(leg.kneeWidth + kneeBend / 42),
    footStanceDirection: foot.toeDirection,
    weightRole: weightBearing ? "weight-bearing" : "relaxed",
  };
}

export function buildAnimeArticulationPlan(input: {
  profile: AnimeCharacterProfile;
  posePreset: AnimePoseLanguagePreset;
  bodyPlan: AnimeBodyPlan;
  lowerBodyPlan: AnimeLowerBodyPlan;
  poseEnergyState: AnimePoseEnergyState;
  frameIndex?: number;
}): AnimeArticulationPlan {
  const leftArm = buildArm({ side: -1, bodyPlan: input.bodyPlan, posePreset: input.posePreset, poseEnergyState: input.poseEnergyState, profile: input.profile });
  const rightArm = buildArm({ side: 1, bodyPlan: input.bodyPlan, posePreset: input.posePreset, poseEnergyState: input.poseEnergyState, profile: input.profile });
  const leftLeg = buildLeg({ side: -1, lowerBodyPlan: input.lowerBodyPlan, poseEnergyState: input.poseEnergyState });
  const rightLeg = buildLeg({ side: 1, lowerBodyPlan: input.lowerBodyPlan, poseEnergyState: input.poseEnergyState });
  const averageElbow = (leftArm.elbowBend + rightArm.elbowBend) / 2;
  const averageKnee = (leftLeg.kneeBend + rightLeg.kneeBend) / 2;
  const shoulderArticulationScore = clampScore(86 + Math.abs(input.posePreset.shoulderAngle) * 0.7 + input.poseEnergyState.poseAsymmetry * 9);
  const elbowReadabilityScore = clampScore(80 + averageElbow * 0.12 + input.poseEnergyState.forwardDrive * 6);
  const wristHandConnectionScore = clampScore(80 + (leftArm.handShapeReadabilityScore + rightArm.handShapeReadabilityScore) * 0.045 + input.poseEnergyState.poseAsymmetry * 5);
  const handShapeReadabilityScore = clampScore((leftArm.handShapeReadabilityScore + rightArm.handShapeReadabilityScore) / 2);
  const hipKneeArticulationScore = clampScore(84 + averageKnee * 0.1 + input.poseEnergyState.poseAsymmetry * 7);
  const footPoseReadabilityScore = clampScore(84 + input.lowerBodyPlan.footGroundingScore * 0.08 + input.poseEnergyState.forwardDrive * 4);
  const silhouetteFlowScore = clampScore(input.poseEnergyState.silhouetteFlowScore + input.bodyPlan.poseAsymmetry * 4);
  const poseEnergyScore = clampScore(input.poseEnergyState.poseEnergyScore);
  const anatomyPrimitiveRisk: AnimeAnatomyPrimitiveRisk = handShapeReadabilityScore >= 86 && elbowReadabilityScore >= 88 && silhouetteFlowScore >= 90 ? "LOW" : handShapeReadabilityScore >= 82 && elbowReadabilityScore >= 84 ? "MEDIUM" : "HIGH";

  return {
    frameIndex: input.frameIndex ?? 0,
    shoulderAngle: round(input.posePreset.shoulderAngle + input.poseEnergyState.shoulderHipCounterTilt * 0.32),
    elbowBend: round(averageElbow),
    wristAngle: round((leftArm.wristAngle + rightArm.wristAngle) / 2),
    hipAngle: round((leftLeg.hipAngle + rightLeg.hipAngle) / 2),
    kneeBend: round(averageKnee),
    footAngle: round((Math.abs(leftLeg.footAngle) + Math.abs(rightLeg.footAngle)) / 2),
    lineOfAction: input.poseEnergyState.lineOfActionAngle,
    poseAsymmetry: input.poseEnergyState.poseAsymmetry,
    silhouetteFlowScore,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    shoulderArticulationScore,
    elbowReadabilityScore,
    wristHandConnectionScore,
    handShapeReadabilityScore,
    hipKneeArticulationScore,
    footPoseReadabilityScore,
    poseEnergyScore,
    anatomyPrimitiveRisk,
  };
}

export function summarizeAnimeArticulationDiagnostics(plans: AnimeArticulationPlan[]): AnimeArticulationDiagnostics {
  const average = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  const worstRisk = plans.some((entry) => entry.anatomyPrimitiveRisk === "HIGH") ? "HIGH" : plans.some((entry) => entry.anatomyPrimitiveRisk === "MEDIUM") ? "MEDIUM" : "LOW";

  return {
    shoulder_articulation_score: average(plans.map((entry) => entry.shoulderArticulationScore)),
    elbow_readability_score: average(plans.map((entry) => entry.elbowReadabilityScore)),
    wrist_hand_connection_score: average(plans.map((entry) => entry.wristHandConnectionScore)),
    hand_shape_readability_score: average(plans.map((entry) => entry.handShapeReadabilityScore)),
    hip_knee_articulation_score: average(plans.map((entry) => entry.hipKneeArticulationScore)),
    foot_pose_readability_score: average(plans.map((entry) => entry.footPoseReadabilityScore)),
    pose_energy_score: average(plans.map((entry) => entry.poseEnergyScore)),
    silhouette_flow_score: average(plans.map((entry) => entry.silhouetteFlowScore)),
    anatomy_primitive_risk: worstRisk,
  };
}
