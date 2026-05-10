import assert from "node:assert/strict";
import test from "node:test";

import { buildAnimeBodyPlan } from "./animeBodyRenderer";
import { getApprovedAnimeCharacterProfileById } from "./animeCharacterProfileRegistry";
import { selectDefaultAnimeCharacterPose } from "./animeCharacterPoseTemplates";
import { buildAnimeLowerBodyPlan, summarizeAnimeLowerBodyDiagnostics } from "./animeLowerBodyRenderer";
import { buildAnimeMotionContinuityPlan } from "./animeMotionContinuity";
import { resolveAnimePoseLanguagePreset } from "./animePoseLanguage";

function buildSolarLowerBodyPlan(frameIndex = 2) {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_005");
  assert.ok(profile);
  const poseTemplate = selectDefaultAnimeCharacterPose(profile.poseDefault);
  const posePreset = resolveAnimePoseLanguagePreset({ profile, poseTemplate });
  const bodyPlan = buildAnimeBodyPlan({ profile, posePreset, frameIndex });
  const motionPlan = buildAnimeMotionContinuityPlan({ frameIndex, frameCount: 5, posePreset });
  return buildAnimeLowerBodyPlan({ profile, bodyPlan, posePreset, motionPlan });
}

test("anime lower-body plans are deterministic", () => {
  const first = buildSolarLowerBodyPlan(2);
  const second = buildSolarLowerBodyPlan(2);

  assert.deepEqual(first, second);
  assert.equal(first.hipWidth >= 54, true);
  assert.equal(first.stanceWidth >= 62, true);
  assert.equal(first.waistTransitionWidth >= first.hipWidth, true);
});

test("lower-body plan separates hips knees ankles and grounded feet", () => {
  const plan = buildSolarLowerBodyPlan(2);

  assert.equal(plan.leftLeg.hipX < 0, true);
  assert.equal(plan.rightLeg.hipX > 0, true);
  assert.equal(plan.leftLeg.kneeY > plan.leftLeg.hipY, true);
  assert.equal(plan.leftLeg.ankleY > plan.leftLeg.kneeY, true);
  assert.equal(plan.rightLeg.ankleY > plan.rightLeg.kneeY, true);
  assert.equal(plan.leftFoot.anchorY, plan.rightFoot.anchorY);
  assert.equal(plan.leftFoot.toeDirection, -1);
  assert.equal(plan.rightFoot.toeDirection, 1);
  assert.equal(plan.leftFoot.contactShadowWidth >= plan.leftFoot.width, true);
  assert.equal(plan.rightFoot.contactShadowWidth >= plan.rightFoot.width, true);
});

test("lower-body diagnostics meet early grounded anime thresholds", () => {
  const diagnostics = summarizeAnimeLowerBodyDiagnostics(buildSolarLowerBodyPlan(2));

  assert.equal(diagnostics.lower_body_readability >= 88, true);
  assert.equal(diagnostics.foot_grounding_score >= 82, true);
  assert.equal(diagnostics.stance_grounding_score >= 90, true);
  assert.equal(diagnostics.waist_transition_score >= 88, true);
  assert.equal(diagnostics.fabric_motion_score >= 90, true);
});
