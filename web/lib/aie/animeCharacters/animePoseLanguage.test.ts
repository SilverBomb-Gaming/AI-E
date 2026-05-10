import assert from "node:assert/strict";
import test from "node:test";

import { getApprovedAnimeCharacterProfileById } from "./animeCharacterProfileRegistry";
import { selectDefaultAnimeCharacterPose } from "./animeCharacterPoseTemplates";
import { getAnimePoseLanguagePresetById, listAnimePoseLanguagePresets, resolveAnimePoseLanguagePreset } from "./animePoseLanguage";

test("anime pose language presets are deterministic and bounded", () => {
  const presets = listAnimePoseLanguagePresets();
  const ids = presets.map((entry) => entry.id);

  assert.deepEqual(ids, ["CONFIDENT_FRONT_STANCE", "CALM_HERO_STANCE", "SLIGHT_HALF_TURN", "BEACON_SIDE_GLANCE", "FOCUSED_READY_POSE"]);
  assert.equal(presets.every((entry) => entry.stanceBalance >= 89), true);
  assert.equal(presets.every((entry) => entry.leftArm.handOffsetY > 0 && entry.rightArm.handOffsetY > 0), true);
  assert.deepEqual(getAnimePoseLanguagePresetById("CONFIDENT_FRONT_STANCE"), getAnimePoseLanguagePresetById("confident_front_stance"));
});

test("solar crimson sentinel resolves to confident front stance", () => {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_005");
  assert.ok(profile);
  const poseTemplate = selectDefaultAnimeCharacterPose(profile.poseDefault);
  const preset = resolveAnimePoseLanguagePreset({ profile, poseTemplate });

  assert.equal(preset.id, "CONFIDENT_FRONT_STANCE");
  assert.equal(preset.leftArm.handOrientation, "at-hip");
  assert.equal(preset.poseAsymmetry > 0.1, true);
  assert.equal(preset.stanceWidthMultiplier > 1, true);
});

test("existing governed pose templates map to readable pose language", () => {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_003");
  assert.ok(profile);
  const poseTemplate = selectDefaultAnimeCharacterPose(profile.poseDefault);
  const preset = resolveAnimePoseLanguagePreset({ profile, poseTemplate });

  assert.equal(preset.id, "BEACON_SIDE_GLANCE");
  assert.equal(preset.headTilt !== 0, true);
  assert.equal(preset.leftArm.handOrientation, "soft-profile");
});
