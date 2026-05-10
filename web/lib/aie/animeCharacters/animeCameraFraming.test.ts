import assert from "node:assert/strict";
import test from "node:test";

import { getApprovedAnimeCharacterProfileById } from "./animeCharacterProfileRegistry";
import { selectDefaultAnimeCharacterExpression } from "./animeCharacterPoseTemplates";
import { buildAnimeExpressionSequence } from "./animeExpressionRenderer";
import { buildAnimeCameraFramingSequence, buildAnimeCameraFramingState, resolveAnimeShotPreset, summarizeAnimeCameraFramingDiagnostics } from "./animeCameraFraming";

test("anime camera framing states are deterministic and profile driven", () => {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_005");
  assert.ok(profile);
  const expression = selectDefaultAnimeCharacterExpression(profile.expressionDefault);
  const expressionStates = buildAnimeExpressionSequence({ profile, expression, frameCount: 5 });
  const first = buildAnimeCameraFramingState({ profile, frameIndex: 2, frameCount: 5, expressionState: expressionStates[2] });
  const second = buildAnimeCameraFramingState({ profile, frameIndex: 2, frameCount: 5, expressionState: expressionStates[2] });

  assert.deepEqual(first, second);
  assert.equal(resolveAnimeShotPreset(profile), "SUBTLE_PUSH_IN");
  assert.equal(first.shotPreset, "SUBTLE_PUSH_IN");
  assert.equal(first.facePriority >= 90, true);
});

test("camera push-in and offsets stay bounded", () => {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_005");
  assert.ok(profile);
  const expression = selectDefaultAnimeCharacterExpression(profile.expressionDefault);
  const expressionStates = buildAnimeExpressionSequence({ profile, expression, frameCount: 5 });
  const sequence = buildAnimeCameraFramingSequence({ profile, frameCount: 5, expressionStates });

  assert.equal(sequence.length, 5);
  assert.equal(sequence[4].cameraZoom > sequence[0].cameraZoom, true);
  assert.equal(sequence.every((entry) => entry.cameraZoom >= 1 && entry.cameraZoom <= 1.07), true);
  assert.equal(sequence.every((entry) => Math.abs(entry.cameraOffsetX) <= 9), true);
  assert.equal(sequence.every((entry) => Math.abs(entry.cameraOffsetY) <= 7), true);
  assert.equal(sequence.every((entry) => Math.abs(entry.backgroundParallaxX) <= 5), true);
  assert.equal(sequence.every((entry) => Math.abs(entry.backgroundParallaxY) <= 3), true);
});

test("camera framing diagnostics meet early cinematic framing thresholds", () => {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_005");
  assert.ok(profile);
  const expression = selectDefaultAnimeCharacterExpression(profile.expressionDefault);
  const expressionStates = buildAnimeExpressionSequence({ profile, expression, frameCount: 5 });
  const diagnostics = summarizeAnimeCameraFramingDiagnostics(buildAnimeCameraFramingSequence({ profile, frameCount: 5, expressionStates }));

  assert.equal(diagnostics.shot_preset, "SUBTLE_PUSH_IN");
  assert.equal(diagnostics.camera_framing_score >= 88, true);
  assert.equal(diagnostics.face_framing_priority >= 90, true);
  assert.equal(diagnostics.eye_visibility_score >= 92, true);
  assert.equal(diagnostics.character_dominance_score >= 92, true);
  assert.equal(diagnostics.background_depth_score >= 88, true);
  assert.equal(diagnostics.parallax_continuity_score >= 90, true);
  assert.equal(diagnostics.cinematic_composition_score >= 88, true);
  assert.equal(diagnostics.camera_motion_smoothness >= 90, true);
  assert.equal(diagnostics.framing_jitter_risk, "LOW");
});
