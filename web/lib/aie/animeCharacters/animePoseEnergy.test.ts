import assert from "node:assert/strict";
import test from "node:test";

import { getApprovedAnimeCharacterProfileById } from "./animeCharacterProfileRegistry";
import { selectDefaultAnimeCharacterPose } from "./animeCharacterPoseTemplates";
import { resolveAnimePoseLanguagePreset } from "./animePoseLanguage";
import { buildAnimePoseEnergySequence, buildAnimePoseEnergyState, resolveAnimePoseEnergyProfile, summarizeAnimePoseEnergy } from "./animePoseEnergy";

test("anime pose energy resolves solar crimson to an intense forward line", () => {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_005");
  assert.ok(profile);
  const posePreset = resolveAnimePoseLanguagePreset({ profile, poseTemplate: selectDefaultAnimeCharacterPose(profile.poseDefault) });

  assert.equal(resolveAnimePoseEnergyProfile({ profile, posePreset }), "INTENSE_FORWARD_FOCUS");

  const state = buildAnimePoseEnergyState({ profile, posePreset, frameIndex: 2 });
  assert.equal(state.profileId, "INTENSE_FORWARD_FOCUS");
  assert.equal(state.forwardDrive >= 0.86, true);
  assert.equal(state.poseAsymmetry >= 0.42, true);
  assert.equal(state.poseEnergyScore >= 92, true);
  assert.equal(state.silhouetteFlowScore >= 92, true);
});

test("anime pose energy sequence is deterministic and bounded", () => {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_001");
  assert.ok(profile);
  const posePreset = resolveAnimePoseLanguagePreset({ profile, poseTemplate: selectDefaultAnimeCharacterPose(profile.poseDefault) });
  const sequence = buildAnimePoseEnergySequence({ profile, posePreset, frameCount: 5 });
  const repeated = buildAnimePoseEnergySequence({ profile, posePreset, frameCount: 5 });

  assert.deepEqual(sequence, repeated);
  assert.equal(sequence.length, 5);
  assert.equal(sequence.every((entry) => entry.poseEnergyScore >= 84), true);
  assert.equal(sequence.every((entry) => Math.abs(entry.lineOfActionAngle) <= 10), true);

  const summary = summarizeAnimePoseEnergy(sequence);
  assert.equal(summary.pose_energy_score >= 84, true);
  assert.equal(summary.silhouette_flow_score >= 86, true);
  assert.equal(summary.pose_asymmetry >= 0.15, true);
});
