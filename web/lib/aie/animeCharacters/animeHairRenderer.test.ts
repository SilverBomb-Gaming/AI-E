import assert from "node:assert/strict";
import test from "node:test";

import { getApprovedAnimeCharacterProfileById } from "./animeCharacterProfileRegistry";
import { buildAnimeHairRenderPlan } from "./animeHairRenderer";

test("anime hair renderer builds layered bangs side locks and rear volume", () => {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_001");
  assert.ok(profile);

  const plan = buildAnimeHairRenderPlan({ profile, frameIndex: 0 });

  assert.equal(plan.layers.some((entry) => entry.role === "front-bang"), true);
  assert.equal(plan.layers.some((entry) => entry.role === "side-lock"), true);
  assert.equal(plan.layers.some((entry) => entry.role === "rear-volume"), true);
  assert.equal(plan.layers.some((entry) => entry.role === "highlight-streak"), true);
  assert.equal(plan.layeredHairQuality >= 94, true);
  assert.equal(plan.silhouetteContribution >= 94, true);
  assert.deepEqual(plan.baseColor, [151, 205, 237]);
});

test("anime hair renderer keeps motion deterministic per frame", () => {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_003");
  assert.ok(profile);

  const frameZero = buildAnimeHairRenderPlan({ profile, frameIndex: 0 });
  const frameTwo = buildAnimeHairRenderPlan({ profile, frameIndex: 2 });
  const frameTwoRepeat = buildAnimeHairRenderPlan({ profile, frameIndex: 2 });

  assert.deepEqual(frameTwo, frameTwoRepeat);
  assert.notDeepEqual(frameZero.layers, frameTwo.layers);
  assert.equal(frameTwo.motionConsistency, 96);
});
