import assert from "node:assert/strict";
import test from "node:test";

import { buildCreatorPanelVisibility } from "./animeCreatorWorkflow";

test("anime creator mode hides irrelevant developer harness panels", () => {
  const visibility = buildCreatorPanelVisibility("ANIME_CREATOR_MODE");

  assert.equal(visibility["anime-character-controls"], true);
  assert.equal(visibility["anime-profile-cards"], true);
  assert.equal(visibility["anime-render-actions"], true);
  assert.equal(visibility["anime-diagnostics"], true);
  assert.equal(visibility["audio-roadmap"], true);
  assert.equal(visibility["cinematic-roadmap"], true);
  assert.equal(visibility["prompt-variation-harness"], false);
  assert.equal(visibility["prompt-domain-harness"], false);
  assert.equal(visibility["style-stress-harness"], false);
  assert.equal(visibility["style-intensity-harness"], false);
  assert.equal(visibility["high-probe-harness"], false);
  assert.equal(visibility["frame-comparison"], false);
});

test("general mode keeps governed harness panels available", () => {
  const visibility = buildCreatorPanelVisibility("GENERAL_GOVERNED_MODE");

  assert.equal(visibility["anime-character-controls"], false);
  assert.equal(visibility["prompt-variation-harness"], true);
  assert.equal(visibility["prompt-domain-harness"], true);
  assert.equal(visibility["visual-style-harness"], true);
});
