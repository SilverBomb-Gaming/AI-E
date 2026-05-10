import assert from "node:assert/strict";
import test from "node:test";

import { getApprovedAnimeCharacterProfileById } from "./animeCharacterProfileRegistry";
import { buildAnimeFaceRenderPlan } from "./animeFaceRenderer";
import { selectDefaultAnimeCharacterExpression } from "./animeCharacterPoseTemplates";

test("anime face renderer creates readable soft anime proportions", () => {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_001");
  assert.ok(profile);
  const expression = selectDefaultAnimeCharacterExpression(profile.expressionDefault);

  const plan = buildAnimeFaceRenderPlan({ profile, expression });

  assert.equal(plan.faceRadiusY > plan.faceRadiusX, true);
  assert.equal(plan.chinY > plan.centerY, true);
  assert.equal(plan.eyeLineY < plan.mouthY, true);
  assert.equal(plan.faceReadabilityScore >= 95, true);
  assert.equal(plan.silhouetteReadabilityScore >= 95, true);
  assert.equal(plan.proportionScore >= 94, true);
});

test("anime face renderer keeps skin palettes approved and deterministic", () => {
  const apprentice = getApprovedAnimeCharacterProfileById("CHARACTER_001");
  const sentinel = getApprovedAnimeCharacterProfileById("CHARACTER_004");
  assert.ok(apprentice);
  assert.ok(sentinel);

  const apprenticePlan = buildAnimeFaceRenderPlan({ profile: apprentice, expression: selectDefaultAnimeCharacterExpression(apprentice.expressionDefault) });
  const sentinelPlan = buildAnimeFaceRenderPlan({ profile: sentinel, expression: selectDefaultAnimeCharacterExpression(sentinel.expressionDefault) });

  assert.deepEqual(apprenticePlan, buildAnimeFaceRenderPlan({ profile: apprentice, expression: selectDefaultAnimeCharacterExpression(apprentice.expressionDefault) }));
  assert.notDeepEqual(apprenticePlan.skinBase, sentinelPlan.skinBase);
});
