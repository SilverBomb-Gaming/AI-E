import assert from "node:assert/strict";
import test from "node:test";

import { getApprovedAnimeCharacterProfileById } from "./animeCharacterProfileRegistry";
import { selectDefaultAnimeCharacterExpression } from "./animeCharacterPoseTemplates";
import { buildAnimeExpressionSequence, buildAnimeExpressionState, summarizeAnimeExpressionDiagnostics } from "./animeExpressionRenderer";

test("anime expression states are deterministic and speech-blocked", () => {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_005");
  assert.ok(profile);
  const expression = selectDefaultAnimeCharacterExpression(profile.expressionDefault);

  const first = buildAnimeExpressionState({ profile, expression, frameIndex: 1, frameCount: 5 });
  const second = buildAnimeExpressionState({ profile, expression, frameIndex: 1, frameCount: 5 });

  assert.deepEqual(first, second);
  assert.equal(first.dialogueAllowed, false);
  assert.equal(first.lipSyncAllowed, false);
  assert.equal(first.mouthShape, "small-smile");
  assert.equal(first.eyebrowEmotion, "intense");
});

test("blink and gaze sequence stays bounded across frames", () => {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_005");
  assert.ok(profile);
  const expression = selectDefaultAnimeCharacterExpression(profile.expressionDefault);
  const sequence = buildAnimeExpressionSequence({ profile, expression, frameCount: 5 });

  assert.equal(sequence.length, 5);
  assert.deepEqual(sequence.map((entry) => entry.eyeOpenAmount), [1, 0.42, 0.92, 1, 0.96]);
  assert.equal(sequence.some((entry) => entry.eyeOpenAmount < 0.65), true);
  assert.equal(sequence.every((entry) => Math.abs(entry.gazeOffsetX) <= 0.7), true);
  assert.equal(sequence.every((entry) => Math.abs(entry.gazeOffsetY) <= 0.3), true);
  assert.equal(sequence.every((entry) => entry.expressionContinuityScore >= 90), true);
});

test("expression diagnostics meet early face animation thresholds", () => {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_005");
  assert.ok(profile);
  const expression = selectDefaultAnimeCharacterExpression(profile.expressionDefault);
  const diagnostics = summarizeAnimeExpressionDiagnostics(buildAnimeExpressionSequence({ profile, expression, frameCount: 5 }));

  assert.equal(diagnostics.expression_readability_score >= 88, true);
  assert.equal(diagnostics.blink_readability_score >= 85, true);
  assert.equal(diagnostics.gaze_stability_score >= 90, true);
  assert.equal(diagnostics.mouth_readability_score >= 85, true);
  assert.equal(diagnostics.eyebrow_readability_score >= 85, true);
  assert.equal(diagnostics.expression_frame_consistency >= 90, true);
  assert.equal(diagnostics.face_liveliness_score >= 85, true);
});
