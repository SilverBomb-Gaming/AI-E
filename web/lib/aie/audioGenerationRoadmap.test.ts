import assert from "node:assert/strict";
import test from "node:test";

import { buildAudioGenerationRoadmap } from "./audioGenerationRoadmap";

test("audio generation roadmap is explicit groundwork without fake audio", () => {
  const roadmap = buildAudioGenerationRoadmap();

  assert.equal(roadmap.status, "NOT_YET_IMPLEMENTED");
  assert.equal(roadmap.fakeAudioGenerationAllowed, false);
  assert.equal(roadmap.plannedCapabilities.includes("ambient sci-fi audio"), true);
  assert.equal(roadmap.plannedCapabilities.includes("cinematic soundtrack layers"), true);
  assert.equal(roadmap.plannedCapabilities.includes("anime vocal themes"), true);
  assert.equal(roadmap.plannedCapabilities.includes("motion-sync audio timing"), true);
  assert.equal(roadmap.plannedCapabilities.includes("dialogue routing"), true);
  assert.equal(roadmap.voiceDialogueFutureRouting.some((entry) => entry.includes("disabled")), true);
  assert.equal(roadmap.audioReviewPipelinePlanning.length > 0, true);
});
