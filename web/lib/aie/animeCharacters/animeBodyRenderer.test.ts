import assert from "node:assert/strict";
import test from "node:test";

import { buildAnimeBodyPlan, summarizeAnimeBodyPlanDiagnostics } from "./animeBodyRenderer";
import { getApprovedAnimeCharacterProfileById } from "./animeCharacterProfileRegistry";
import { resolveAnimePoseLanguagePreset } from "./animePoseLanguage";
import { selectDefaultAnimeCharacterPose } from "./animeCharacterPoseTemplates";

test("anime body plans are deterministic for profile and pose", () => {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_005");
  assert.ok(profile);
  const poseTemplate = selectDefaultAnimeCharacterPose(profile.poseDefault);
  const posePreset = resolveAnimePoseLanguagePreset({ profile, poseTemplate });

  const first = buildAnimeBodyPlan({ profile, posePreset, frameIndex: 2 });
  const second = buildAnimeBodyPlan({ profile, posePreset, frameIndex: 2 });

  assert.deepEqual(first, second);
  assert.equal(first.headToBodyRatio > 0.25 && first.headToBodyRatio < 0.34, true);
  assert.equal(first.shoulderWidth >= 88, true);
  assert.equal(first.waistWidth < first.shoulderWidth, true);
  assert.equal(first.stanceWidth >= 52, true);
});

test("arms and hands are planned as separate readable body parts", () => {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_005");
  assert.ok(profile);
  const poseTemplate = selectDefaultAnimeCharacterPose(profile.poseDefault);
  const posePreset = resolveAnimePoseLanguagePreset({ profile, poseTemplate });
  const plan = buildAnimeBodyPlan({ profile, posePreset, frameIndex: 0 });

  assert.notDeepEqual(plan.leftArm, plan.rightArm);
  assert.equal(plan.leftArm.upperArmLength > 0, true);
  assert.equal(plan.leftArm.forearmLength > 0, true);
  assert.equal(plan.leftArm.cuffWidth > 0, true);
  assert.equal(plan.leftArm.palmWidth > 0, true);
  assert.equal(plan.leftArm.handOrientation, "at-hip");
  assert.equal(plan.rightArm.handOrientation, "relaxed-down");
  assert.equal(plan.handReadabilityScore >= 80, true);
});

test("body plan diagnostics expose body pose and outfit flow metrics", () => {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_005");
  assert.ok(profile);
  const poseTemplate = selectDefaultAnimeCharacterPose(profile.poseDefault);
  const posePreset = resolveAnimePoseLanguagePreset({ profile, poseTemplate });
  const diagnostics = summarizeAnimeBodyPlanDiagnostics(buildAnimeBodyPlan({ profile, posePreset, frameIndex: 3 }));

  assert.equal(diagnostics.body_silhouette_score >= 88, true);
  assert.equal(diagnostics.torso_readability_score >= 88, true);
  assert.equal(diagnostics.arm_readability_score >= 85, true);
  assert.equal(diagnostics.hand_readability_score >= 80, true);
  assert.equal(diagnostics.pose_language_score >= 88, true);
  assert.equal(diagnostics.outfit_flow_score >= 88, true);
  assert.equal(diagnostics.stance_balance_score >= 88, true);
});
