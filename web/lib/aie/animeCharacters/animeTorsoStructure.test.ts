import assert from "node:assert/strict";
import test from "node:test";

import { getApprovedAnimeCharacterProfileById } from "./animeCharacterProfileRegistry";
import { selectDefaultAnimeCharacterExpression, selectDefaultAnimeCharacterPose } from "./animeCharacterPoseTemplates";
import { buildAnimeBodyPlan } from "./animeBodyRenderer";
import { buildAnimeLowerBodyPlan } from "./animeLowerBodyRenderer";
import { buildAnimeMotionContinuityPlan } from "./animeMotionContinuity";
import { buildAnimeExpressionState } from "./animeExpressionRenderer";
import { buildAnimeSecondaryMotionState } from "./animeSecondaryMotion";
import { resolveAnimePoseLanguagePreset } from "./animePoseLanguage";
import { buildAnimePoseEnergyState } from "./animePoseEnergy";
import { buildAnimeArticulationPlan } from "./animeArticulationRenderer";
import { buildAnimeTorsoStructurePlan, summarizeAnimeTorsoStructureDiagnostics } from "./animeTorsoStructure";

function buildSolarPlan(frameIndex = 2) {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_005");
  assert.ok(profile);
  const poseTemplate = selectDefaultAnimeCharacterPose(profile.poseDefault);
  const expression = selectDefaultAnimeCharacterExpression(profile.expressionDefault);
  const posePreset = resolveAnimePoseLanguagePreset({ profile, poseTemplate });
  const bodyPlan = buildAnimeBodyPlan({ profile, posePreset, frameIndex });
  const motionPlan = buildAnimeMotionContinuityPlan({ frameIndex, frameCount: 5, posePreset });
  const lowerBodyPlan = buildAnimeLowerBodyPlan({ profile, bodyPlan, posePreset, motionPlan });
  const expressionState = buildAnimeExpressionState({ profile, expression, frameIndex, frameCount: 5 });
  const secondaryMotionState = buildAnimeSecondaryMotionState({ profile, frameIndex, frameCount: 5, expressionState, motionPlan });
  const poseEnergyState = buildAnimePoseEnergyState({ profile, posePreset, frameIndex });
  const articulationPlan = buildAnimeArticulationPlan({ profile, posePreset, bodyPlan, lowerBodyPlan, poseEnergyState, frameIndex });
  return buildAnimeTorsoStructurePlan({ profile, bodyPlan, lowerBodyPlan, secondaryMotionState, articulationPlan, frameIndex });
}

test("anime torso structure plan shapes ribcage waist pelvis and clothing layers", () => {
  const plan = buildSolarPlan();

  assert.equal(plan.ribcageWidth > plan.innerShirtLayerWidth, true);
  assert.equal(plan.waistTaper >= 18, true);
  assert.equal(plan.hipShapeWidth >= 54, true);
  assert.equal(plan.fabricTensionZones.includes("coat-opening"), true);
  assert.equal(plan.fabricTensionZones.includes("hem-sway"), true);
  assert.equal(plan.coatTensionLineCount >= 5, true);
  assert.equal(plan.torsoStructureScore >= 90, true);
  assert.equal(plan.outfitLayeringScore >= 88, true);
  assert.equal(plan.silhouetteMotionScore >= 90, true);
  assert.equal(["LOW", "MEDIUM"].includes(plan.clothingFlatnessRisk), true);
});

test("anime torso structure diagnostics summarize bounded clothing motion", () => {
  const sequence = [0, 1, 2, 3, 4].map((frameIndex) => buildSolarPlan(frameIndex));
  const repeated = [0, 1, 2, 3, 4].map((frameIndex) => buildSolarPlan(frameIndex));
  assert.deepEqual(sequence, repeated);

  const diagnostics = summarizeAnimeTorsoStructureDiagnostics(sequence);
  assert.equal(diagnostics.torso_structure_score >= 90, true);
  assert.equal(diagnostics.waist_flow_score >= 88, true);
  assert.equal(diagnostics.pelvis_balance_score >= 88, true);
  assert.equal(diagnostics.outfit_layering_score >= 88, true);
  assert.equal(diagnostics.fabric_motion_score >= 88, true);
  assert.equal(diagnostics.clothing_readability_score >= 88, true);
  assert.equal(diagnostics.silhouette_motion_score >= 90, true);
  assert.equal(["LOW", "MEDIUM"].includes(diagnostics.torso_stiffness_risk), true);
  assert.equal(["LOW", "MEDIUM"].includes(diagnostics.clothing_flatness_risk), true);
});
