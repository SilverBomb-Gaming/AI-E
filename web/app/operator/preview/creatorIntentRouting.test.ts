import assert from "node:assert/strict";
import test from "node:test";

import { resolveCreatorIntentRoute } from "./animeCreatorWorkflow";

const blondeRedEyesPrompt = "A clearly anime-style blonde-haired young woman with vivid crimson-red eyes stands confidently in a futuristic neon-lit chamber. Her black-and-gold futuristic outfit contains glowing anime-inspired accents while the camera frames her as the unmistakable primary anime-style subject.";

test("anime prompts activate creator mode and resolve blonde red-eyes profile", () => {
  const route = resolveCreatorIntentRoute({ prompt: blondeRedEyesPrompt, subject: "anime heroine", style: "futuristic anime" });

  assert.equal(route.mode, "ANIME_CREATOR_MODE");
  assert.equal(route.profileResolution.isAnimeCharacterRequest, true);
  assert.equal(route.profileResolution.resolutionStatus, "RESOLVED");
  assert.equal(route.profileResolution.resolvedProfileId, "CHARACTER_005");
  assert.equal(route.profileResolution.resolvedProfileLabel, "SOLAR_CRIMSON_SENTINEL");
});

test("non-anime governed requests remain in general mode", () => {
  const route = resolveCreatorIntentRoute({ prompt: "A cube rotates beside a beacon in a bounded chamber.", subject: "cube", style: "simple sci-fi" });

  assert.equal(route.mode, "GENERAL_GOVERNED_MODE");
  assert.equal(route.profileResolution.isAnimeCharacterRequest, false);
});
