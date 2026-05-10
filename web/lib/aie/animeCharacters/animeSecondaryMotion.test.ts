import assert from "node:assert/strict";
import test from "node:test";

import { getApprovedAnimeCharacterProfileById } from "./animeCharacterProfileRegistry";
import { selectDefaultAnimeCharacterExpression, selectDefaultAnimeCharacterPose } from "./animeCharacterPoseTemplates";
import { buildAnimeExpressionSequence } from "./animeExpressionRenderer";
import { buildAnimeMotionContinuitySequence } from "./animeMotionContinuity";
import { buildAnimeSecondaryMotionSequence, buildAnimeSecondaryMotionState, summarizeAnimeSecondaryMotionDiagnostics } from "./animeSecondaryMotion";
import { resolveAnimePoseLanguagePreset } from "./animePoseLanguage";

function buildSolarInputs() {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_005");
  assert.ok(profile);
  const expression = selectDefaultAnimeCharacterExpression(profile.expressionDefault);
  const poseTemplate = selectDefaultAnimeCharacterPose(profile.poseDefault);
  const posePreset = resolveAnimePoseLanguagePreset({ profile, poseTemplate });
  const expressionStates = buildAnimeExpressionSequence({ profile, expression, frameCount: 5 });
  const motionPlans = buildAnimeMotionContinuitySequence({ frameCount: 5, posePreset });
  return { profile, expressionStates, motionPlans };
}

test("anime secondary motion states are deterministic", () => {
  const { profile, expressionStates, motionPlans } = buildSolarInputs();
  const first = buildAnimeSecondaryMotionState({ profile, frameIndex: 2, frameCount: 5, expressionState: expressionStates[2], motionPlan: motionPlans[2] });
  const second = buildAnimeSecondaryMotionState({ profile, frameIndex: 2, frameCount: 5, expressionState: expressionStates[2], motionPlan: motionPlans[2] });

  assert.deepEqual(first, second);
  assert.equal(first.motionJitterRisk, "LOW");
  assert.equal(first.frameIndex, 2);
});

test("hair and cloth secondary motion remain bounded but visible", () => {
  const { profile, expressionStates, motionPlans } = buildSolarInputs();
  const sequence = buildAnimeSecondaryMotionSequence({ profile, frameCount: 5, expressionStates, motionPlans });

  assert.equal(sequence.length, 5);
  assert.equal(sequence.some((entry) => Math.abs(entry.hairSwayX) >= 1), true);
  assert.equal(sequence.some((entry) => Math.abs(entry.bangOffset) >= 0.4), true);
  assert.equal(sequence.some((entry) => Math.abs(entry.sideLockOffset) >= 1), true);
  assert.equal(sequence.some((entry) => Math.abs(entry.lowerFabricSway) >= 1), true);
  assert.equal(sequence.every((entry) => Math.abs(entry.hairSwayX) <= 4.2), true);
  assert.equal(sequence.every((entry) => Math.abs(entry.lowerFabricSway) <= 4.2), true);
  assert.equal(sequence.every((entry) => entry.motionJitterRisk === "LOW"), true);
});

test("secondary motion diagnostics meet early anime thresholds", () => {
  const { profile, expressionStates, motionPlans } = buildSolarInputs();
  const diagnostics = summarizeAnimeSecondaryMotionDiagnostics(buildAnimeSecondaryMotionSequence({ profile, frameCount: 5, expressionStates, motionPlans }));

  assert.equal(diagnostics.hair_motion_score >= 88, true);
  assert.equal(diagnostics.bang_motion_readability >= 88, true);
  assert.equal(diagnostics.side_lock_continuity >= 90, true);
  assert.equal(diagnostics.rear_hair_settle_score >= 88, true);
  assert.equal(diagnostics.cloth_motion_score >= 86, true);
  assert.equal(diagnostics.jacket_sway_readability >= 86, true);
  assert.equal(diagnostics.lower_fabric_motion_score >= 88, true);
  assert.equal(diagnostics.secondary_motion_continuity >= 90, true);
  assert.equal(diagnostics.motion_jitter_risk, "LOW");
});
