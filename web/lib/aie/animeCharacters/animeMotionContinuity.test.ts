import assert from "node:assert/strict";
import test from "node:test";

import { getApprovedAnimeCharacterProfileById } from "./animeCharacterProfileRegistry";
import { selectDefaultAnimeCharacterPose } from "./animeCharacterPoseTemplates";
import { buildAnimeMotionContinuityPlan, buildAnimeMotionContinuitySequence, summarizeAnimeMotionContinuity } from "./animeMotionContinuity";
import { resolveAnimePoseLanguagePreset } from "./animePoseLanguage";

function solarPosePreset() {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_005");
  assert.ok(profile);
  return resolveAnimePoseLanguagePreset({ profile, poseTemplate: selectDefaultAnimeCharacterPose(profile.poseDefault) });
}

test("anime motion continuity plans are deterministic", () => {
  const posePreset = solarPosePreset();
  const first = buildAnimeMotionContinuityPlan({ frameIndex: 2, frameCount: 5, posePreset });
  const second = buildAnimeMotionContinuityPlan({ frameIndex: 2, frameCount: 5, posePreset });

  assert.deepEqual(first, second);
  assert.equal(first.frameCount, 5);
  assert.equal(first.interpolationAlpha >= 0 && first.interpolationAlpha <= 1, true);
});

test("motion sequence preserves stance and smooth interpolation", () => {
  const sequence = buildAnimeMotionContinuitySequence({ frameCount: 5, posePreset: solarPosePreset() });

  assert.equal(sequence.length, 5);
  assert.deepEqual(sequence.map((entry) => entry.interpolationAlpha), [0, 0.5, 1, 0.5, 0]);
  assert.equal(sequence.every((entry) => Math.abs(entry.easedWeightShift) <= 3), true);
  assert.equal(sequence.every((entry) => entry.stancePreservation >= 93), true);
  assert.equal(sequence.every((entry) => entry.limbContinuityScore >= 92), true);
  assert.equal(sequence.every((entry) => entry.frameInterpolationScore >= 90), true);
  assert.equal(sequence.every((entry) => entry.animationSmoothnessScore >= 92), true);
});

test("motion continuity summary exposes animation and fabric scores", () => {
  const summary = summarizeAnimeMotionContinuity(buildAnimeMotionContinuitySequence({ frameCount: 5, posePreset: solarPosePreset() }));

  assert.equal(summary.motion_continuity_score >= 92, true);
  assert.equal(summary.frame_interpolation_score >= 91, true);
  assert.equal(summary.fabric_motion_score >= 90, true);
  assert.equal(summary.animation_smoothness_score >= 92, true);
  assert.equal(summary.silhouette_continuity_score >= 94, true);
  assert.equal(summary.stance_preservation_score >= 93, true);
});
