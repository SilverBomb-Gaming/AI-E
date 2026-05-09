import assert from "node:assert/strict";
import test from "node:test";

import { classifyAnimeRequest } from "./animeRequestClassifier";

test("anime character requests classify deterministically", () => {
  const request = {
    prompt: "A clearly anime-style young woman with long silver-blue hair and bright teal eyes stands in a glowing sci-fi chamber.",
    subject: "anime character protagonist",
    style: "unmistakably anime cinematic portrait",
    motionIntent: "small readable pose shift",
  };

  const first = classifyAnimeRequest(request);
  const second = classifyAnimeRequest(request);

  assert.deepEqual(first, second);
  assert.equal(first.isAnimeCharacterRequest, true);
  assert.equal(first.confidence >= 0.45, true);
  assert.ok(first.matchedSignals.includes("anime-style"));
  assert.ok(first.matchedSignals.some((signal) => signal.includes("character")));
});

test("non-character cinematic primitive requests do not classify as anime character", () => {
  const result = classifyAnimeRequest({
    prompt: "Preview a cube and beacon orbit in a foggy sci-fi chamber.",
    subject: "beacon cube",
    style: "cinematic primitive lighting",
    motionIntent: "slow dual orbit",
  });

  assert.equal(result.isAnimeCharacterRequest, false);
  assert.equal(result.matchedSignals.includes("anime-style"), false);
});
