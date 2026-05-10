import assert from "node:assert/strict";
import test from "node:test";

import { buildAnimeEyeRenderPlan } from "./animeEyeRenderer";
import { getApprovedAnimeCharacterProfileById } from "./animeCharacterProfileRegistry";
import { selectDefaultAnimeCharacterExpression } from "./animeCharacterPoseTemplates";

test("anime eye renderer creates deterministic expressive eye plans", () => {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_001");
  assert.ok(profile);
  const expression = selectDefaultAnimeCharacterExpression(profile.expressionDefault);

  const first = buildAnimeEyeRenderPlan({ profile, expression });
  const second = buildAnimeEyeRenderPlan({ profile, expression });

  assert.deepEqual(first, second);
  assert.equal(first.preset, "focused");
  assert.deepEqual(first.irisColor, [20, 232, 224]);
  assert.equal(first.irisRadiusY > first.irisRadiusX, true);
  assert.equal(first.eyeQualityScore >= 95, true);
  assert.equal(first.highlightRadius > 0, true);
});

test("anime eye renderer varies palettes by approved character profile", () => {
  const courier = getApprovedAnimeCharacterProfileById("CHARACTER_002");
  const sentinel = getApprovedAnimeCharacterProfileById("CHARACTER_004");
  assert.ok(courier);
  assert.ok(sentinel);

  const courierPlan = buildAnimeEyeRenderPlan({ profile: courier, expression: selectDefaultAnimeCharacterExpression(courier.expressionDefault) });
  const sentinelPlan = buildAnimeEyeRenderPlan({ profile: sentinel, expression: selectDefaultAnimeCharacterExpression(sentinel.expressionDefault) });

  assert.notDeepEqual(courierPlan.irisColor, sentinelPlan.irisColor);
  assert.equal(courierPlan.eyeQualityScore >= 95, true);
  assert.equal(sentinelPlan.eyeQualityScore >= 95, true);
});
