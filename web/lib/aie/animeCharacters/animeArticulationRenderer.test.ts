import assert from "node:assert/strict";
import test from "node:test";

import { getApprovedAnimeCharacterProfileById } from "./animeCharacterProfileRegistry";
import { selectDefaultAnimeCharacterPose } from "./animeCharacterPoseTemplates";
import { buildAnimeBodyPlan } from "./animeBodyRenderer";
import { buildAnimeLowerBodyPlan } from "./animeLowerBodyRenderer";
import { buildAnimeMotionContinuityPlan } from "./animeMotionContinuity";
import { resolveAnimePoseLanguagePreset } from "./animePoseLanguage";
import { buildAnimePoseEnergyState } from "./animePoseEnergy";
import { buildAnimeArticulationPlan, summarizeAnimeArticulationDiagnostics } from "./animeArticulationRenderer";

function buildSolarPlan(frameIndex = 2) {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_005");
  assert.ok(profile);
  const posePreset = resolveAnimePoseLanguagePreset({ profile, poseTemplate: selectDefaultAnimeCharacterPose(profile.poseDefault) });
  const bodyPlan = buildAnimeBodyPlan({ profile, posePreset, frameIndex });
  const motionPlan = buildAnimeMotionContinuityPlan({ frameIndex, frameCount: 5, posePreset });
  const lowerBodyPlan = buildAnimeLowerBodyPlan({ profile, bodyPlan, posePreset, motionPlan });
  const poseEnergyState = buildAnimePoseEnergyState({ profile, posePreset, frameIndex });
  return buildAnimeArticulationPlan({ profile, posePreset, bodyPlan, lowerBodyPlan, poseEnergyState, frameIndex });
}

test("anime articulation plan improves shoulders elbows hands hips knees and feet", () => {
  const plan = buildSolarPlan();

  assert.equal(plan.shoulderArticulationScore >= 88, true);
  assert.equal(plan.elbowReadabilityScore >= 84, true);
  assert.equal(plan.wristHandConnectionScore >= 84, true);
  assert.equal(plan.handShapeReadabilityScore >= 82, true);
  assert.equal(plan.hipKneeArticulationScore >= 88, true);
  assert.equal(plan.footPoseReadabilityScore >= 88, true);
  assert.equal(plan.poseEnergyScore >= 88, true);
  assert.equal(plan.silhouetteFlowScore >= 88, true);
  assert.equal(["LOW", "MEDIUM"].includes(plan.anatomyPrimitiveRisk), true);
  assert.equal(plan.leftArm.fingerGroupCount, 3);
  assert.equal(plan.rightArm.fingerGroupCount, 3);
  assert.equal(plan.leftLeg.weightRole, "weight-bearing");
});

test("anime articulation diagnostics summarize deterministic sequence", () => {
  const sequence = [0, 1, 2, 3, 4].map((frameIndex) => buildSolarPlan(frameIndex));
  const repeated = [0, 1, 2, 3, 4].map((frameIndex) => buildSolarPlan(frameIndex));
  assert.deepEqual(sequence, repeated);

  const diagnostics = summarizeAnimeArticulationDiagnostics(sequence);
  assert.equal(diagnostics.shoulder_articulation_score >= 88, true);
  assert.equal(diagnostics.elbow_readability_score >= 84, true);
  assert.equal(diagnostics.hand_shape_readability_score >= 82, true);
  assert.equal(diagnostics.pose_energy_score >= 88, true);
  assert.equal(diagnostics.silhouette_flow_score >= 88, true);
  assert.equal(["LOW", "MEDIUM"].includes(diagnostics.anatomy_primitive_risk), true);
});
