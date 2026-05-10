import type { AnimeBodyPlan } from "./animeBodyRenderer";
import type { AnimeLowerBodyPlan } from "./animeLowerBodyRenderer";
import type { AnimeSecondaryMotionState } from "./animeSecondaryMotion";
import type { AnimeArticulationPlan } from "./animeArticulationRenderer";
import type { AnimeCharacterProfile } from "./governedAnimeCharacterState";

export type AnimeTorsoStiffnessRisk = "LOW" | "MEDIUM" | "HIGH";
export type AnimeClothingFlatnessRisk = "LOW" | "MEDIUM" | "HIGH";
export type AnimeFabricTensionZone = "ribcage" | "waist-seam" | "hip-line" | "coat-opening" | "sleeve-overlap" | "hem-sway";

export type AnimeTorsoStructurePlan = {
  frameIndex: number;
  ribcageWidth: number;
  waistTaper: number;
  torsoLean: number;
  chestToHipFlow: number;
  shoulderToWaistCurve: number;
  pelvisTilt: number;
  hipShapeWidth: number;
  centerOfGravityX: number;
  fabricTensionZones: AnimeFabricTensionZone[];
  silhouetteCompression: number;
  silhouetteStretch: number;
  outerJacketEdgeOffset: number;
  innerShirtLayerWidth: number;
  trimSeparationWidth: number;
  collarStructureHeight: number;
  sleeveOverlapDepth: number;
  coatOpeningWidth: number;
  waistSeamY: number;
  sleeveFoldStrength: number;
  waistFoldStrength: number;
  coatTensionLineCount: number;
  coatTailLag: number;
  hemSway: number;
  torsoFollowDelay: number;
  torsoStructureScore: number;
  waistFlowScore: number;
  pelvisBalanceScore: number;
  outfitLayeringScore: number;
  fabricMotionScore: number;
  clothingReadabilityScore: number;
  silhouetteMotionScore: number;
  torsoStiffnessRisk: AnimeTorsoStiffnessRisk;
  clothingFlatnessRisk: AnimeClothingFlatnessRisk;
};

export type AnimeTorsoStructureDiagnostics = {
  torso_structure_score: number;
  waist_flow_score: number;
  pelvis_balance_score: number;
  outfit_layering_score: number;
  fabric_motion_score: number;
  clothing_readability_score: number;
  silhouette_motion_score: number;
  torso_stiffness_risk: AnimeTorsoStiffnessRisk;
  clothing_flatness_risk: AnimeClothingFlatnessRisk;
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function riskFromScores(primary: number, secondary: number): AnimeTorsoStiffnessRisk {
  return primary >= 90 && secondary >= 90 ? "LOW" : primary >= 84 && secondary >= 84 ? "MEDIUM" : "HIGH";
}

function clothingRiskFromScores(layering: number, motion: number): AnimeClothingFlatnessRisk {
  return layering >= 90 && motion >= 90 ? "LOW" : layering >= 86 && motion >= 86 ? "MEDIUM" : "HIGH";
}

export function buildAnimeTorsoStructurePlan(input: {
  profile: AnimeCharacterProfile;
  bodyPlan: AnimeBodyPlan;
  lowerBodyPlan: AnimeLowerBodyPlan;
  secondaryMotionState: AnimeSecondaryMotionState;
  articulationPlan: AnimeArticulationPlan;
  frameIndex?: number;
}): AnimeTorsoStructurePlan {
  const solarProfile = input.profile.id === "CHARACTER_005";
  const frameIndex = input.frameIndex ?? 0;
  const motionPhase = Math.sin(frameIndex * 0.72);
  const ribcageWidth = round(input.bodyPlan.shoulderWidth * (solarProfile ? 0.63 : 0.59));
  const waistTaper = round(Math.max(10, (input.bodyPlan.shoulderWidth - input.bodyPlan.waistWidth) * 0.42 + input.articulationPlan.poseAsymmetry * 8));
  const torsoLean = round(input.bodyPlan.torsoAngle + input.articulationPlan.lineOfAction * 0.38 + input.secondaryMotionState.jacketSway * 0.18);
  const chestToHipFlow = clampScore(86 + waistTaper * 0.55 + input.articulationPlan.poseAsymmetry * 10 + (solarProfile ? 2 : 0));
  const shoulderToWaistCurve = round(4.8 + waistTaper * 0.16 + input.articulationPlan.poseAsymmetry * 3.4);
  const pelvisTilt = round(input.articulationPlan.lineOfAction * -0.24 + input.lowerBodyPlan.bodyBalanceCenter * 0.42);
  const hipShapeWidth = round(Math.max(input.lowerBodyPlan.hipWidth, input.bodyPlan.waistWidth + 9 + input.articulationPlan.poseAsymmetry * 5));
  const centerOfGravityX = round(input.lowerBodyPlan.bodyBalanceCenter + torsoLean * 0.22);
  const silhouetteCompression = round(0.08 + Math.abs(input.secondaryMotionState.jacketSway) * 0.012);
  const silhouetteStretch = round(0.12 + Math.abs(input.articulationPlan.lineOfAction) * 0.012 + Math.abs(input.secondaryMotionState.lowerFabricSway) * 0.01);
  const outerJacketEdgeOffset = round(3.4 + input.articulationPlan.poseAsymmetry * 6 + Math.abs(input.secondaryMotionState.jacketSway) * 0.35);
  const innerShirtLayerWidth = round(input.bodyPlan.waistWidth * 0.42 + (solarProfile ? 4 : 2));
  const trimSeparationWidth = round(2.2 + (solarProfile ? 0.7 : 0.2));
  const collarStructureHeight = round(input.bodyPlan.collarHeight + 2 + (solarProfile ? 1 : 0));
  const sleeveOverlapDepth = round(2.8 + Math.abs(input.secondaryMotionState.sleeveSway) * 0.55);
  const coatOpeningWidth = round(input.bodyPlan.jacketPanelWidth * 0.72 + input.articulationPlan.poseAsymmetry * 6);
  const waistSeamY = round(input.bodyPlan.torsoHeight * 0.62);
  const sleeveFoldStrength = round(0.54 + Math.abs(input.secondaryMotionState.sleeveSway) * 0.08);
  const waistFoldStrength = round(0.48 + Math.abs(input.secondaryMotionState.jacketSway) * 0.09);
  const coatTensionLineCount = solarProfile ? 5 : 4;
  const coatTailLag = round(input.secondaryMotionState.lowerFabricSway * 0.72 + input.secondaryMotionState.jacketSway * 0.35);
  const hemSway = round(input.secondaryMotionState.lowerFabricSway * 1.18 + motionPhase * 0.8);
  const torsoFollowDelay = round(input.secondaryMotionState.jacketSway * 0.35 - input.articulationPlan.lineOfAction * 0.06);
  const torsoStructureScore = clampScore(88 + waistTaper * 0.22 + Math.abs(torsoLean) * 0.35 + (solarProfile ? 2 : 0));
  const waistFlowScore = clampScore(86 + shoulderToWaistCurve * 0.85 + Math.abs(pelvisTilt) * 0.3);
  const pelvisBalanceScore = clampScore(88 + input.lowerBodyPlan.stanceGroundingScore * 0.06 - Math.abs(centerOfGravityX) * 0.15);
  const outfitLayeringScore = clampScore(86 + coatTensionLineCount * 1.2 + trimSeparationWidth * 1.1 + (solarProfile ? 2 : 0));
  const fabricMotionScore = clampScore(87 + Math.abs(hemSway) * 1.2 + Math.abs(coatTailLag) * 0.9 + input.secondaryMotionState.clothMotionScore * 0.04);
  const clothingReadabilityScore = clampScore((outfitLayeringScore + fabricMotionScore + input.bodyPlan.outfitFlowScore) / 3 + 2);
  const silhouetteMotionScore = clampScore(88 + Math.abs(hemSway) * 0.8 + input.articulationPlan.silhouetteFlowScore * 0.05 + (solarProfile ? 2 : 0));
  const torsoStiffnessRisk = riskFromScores(torsoStructureScore, waistFlowScore);
  const clothingFlatnessRisk = clothingRiskFromScores(outfitLayeringScore, fabricMotionScore);

  return {
    frameIndex,
    ribcageWidth,
    waistTaper,
    torsoLean,
    chestToHipFlow,
    shoulderToWaistCurve,
    pelvisTilt,
    hipShapeWidth,
    centerOfGravityX,
    fabricTensionZones: ["ribcage", "waist-seam", "hip-line", "coat-opening", "sleeve-overlap", "hem-sway"],
    silhouetteCompression,
    silhouetteStretch,
    outerJacketEdgeOffset,
    innerShirtLayerWidth,
    trimSeparationWidth,
    collarStructureHeight,
    sleeveOverlapDepth,
    coatOpeningWidth,
    waistSeamY,
    sleeveFoldStrength,
    waistFoldStrength,
    coatTensionLineCount,
    coatTailLag,
    hemSway,
    torsoFollowDelay,
    torsoStructureScore,
    waistFlowScore,
    pelvisBalanceScore,
    outfitLayeringScore,
    fabricMotionScore,
    clothingReadabilityScore,
    silhouetteMotionScore,
    torsoStiffnessRisk,
    clothingFlatnessRisk,
  };
}

function average(values: number[]): number {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function summarizeAnimeTorsoStructureDiagnostics(plans: AnimeTorsoStructurePlan[]): AnimeTorsoStructureDiagnostics {
  const torsoRisk: AnimeTorsoStiffnessRisk = plans.some((entry) => entry.torsoStiffnessRisk === "HIGH") ? "HIGH" : plans.some((entry) => entry.torsoStiffnessRisk === "MEDIUM") ? "MEDIUM" : "LOW";
  const clothingRisk: AnimeClothingFlatnessRisk = plans.some((entry) => entry.clothingFlatnessRisk === "HIGH") ? "HIGH" : plans.some((entry) => entry.clothingFlatnessRisk === "MEDIUM") ? "MEDIUM" : "LOW";

  return {
    torso_structure_score: average(plans.map((entry) => entry.torsoStructureScore)),
    waist_flow_score: average(plans.map((entry) => entry.waistFlowScore)),
    pelvis_balance_score: average(plans.map((entry) => entry.pelvisBalanceScore)),
    outfit_layering_score: average(plans.map((entry) => entry.outfitLayeringScore)),
    fabric_motion_score: average(plans.map((entry) => entry.fabricMotionScore)),
    clothing_readability_score: average(plans.map((entry) => entry.clothingReadabilityScore)),
    silhouette_motion_score: average(plans.map((entry) => entry.silhouetteMotionScore)),
    torso_stiffness_risk: torsoRisk,
    clothing_flatness_risk: clothingRisk,
  };
}
