import assert from "node:assert/strict";
import test from "node:test";

import { compileGovernedPreviewRequest } from "../governedPreviewGenerationContract";
import { buildInvalidFallbackReviewDecision, CHARACTER_FIRST_FALLBACK_BLOCKER, resolveAnimeCharacterProfileForRequest, resolveCharacterFirstExecutionRoute } from "./characterFirstExecutionRouter";

function animeRequest() {
  return compileGovernedPreviewRequest({
    prompt: "A clearly anime-style young woman with long silver-blue hair and bright teal eyes stands in a glowing sci-fi chamber beside a softly pulsing beacon. Her face is clearly visible and the camera frames her as the primary subject in an unmistakably anime look.",
    subject: "anime-style young woman",
    motion_intent: "small readable pose shift",
    style: "anime cinematic portrait with character-primary framing",
    duration_seconds: 2,
    resolution: "720p",
    continuity_priority: "high",
    governance_approval: true,
    package_gif_preview: true,
  });
}

test("anime requests are blocked from prerequisite renderer", () => {
  const decision = resolveCharacterFirstExecutionRoute({ request: animeRequest(), requestedSurface: "PREREQUISITE_MICRO_SEQUENCE" });

  assert.equal(decision.isAnimeCharacterRequest, true);
  assert.equal(decision.allowExecution, false);
  assert.equal(decision.blockPrerequisiteRenderer, true);
  assert.equal(decision.availability, "AVAILABLE");
  assert.deepEqual(decision.blockers, [CHARACTER_FIRST_FALLBACK_BLOCKER]);
  assert.match(decision.reason, /Character-first render required/i);
});

test("anime character render surface is allowed when renderer is available", () => {
  const decision = resolveCharacterFirstExecutionRoute({ request: animeRequest(), requestedSurface: "ANIME_CHARACTER_RENDER", characterRendererAvailability: "AVAILABLE" });

  assert.equal(decision.isAnimeCharacterRequest, true);
  assert.equal(decision.allowExecution, true);
  assert.equal(decision.blockPrerequisiteRenderer, false);
  assert.match(decision.reason, /character-first renderer/i);
});

test("unavailable character renderer blocks instead of falling back", () => {
  const decision = resolveCharacterFirstExecutionRoute({ request: animeRequest(), requestedSurface: "GOVERNED_PREVIEW", characterRendererAvailability: "NOT_IMPLEMENTED" });

  assert.equal(decision.allowExecution, false);
  assert.equal(decision.availability, "NOT_IMPLEMENTED");
  assert.match(decision.reason, /Character renderer unavailable/i);
});

test("invalid fallback review artifacts are rejected", () => {
  const review = buildInvalidFallbackReviewDecision({
    artifactPaths: [".aie/governed_motion_preview_sandbox/clip-governed-motion-preview-001/governed_motion_preview_frame_001.png"],
    diagnostics: {
      recognizable_object: "anchored cube and beacon",
      active_beat_type: "BEACON_REVEAL",
      active_focus_subject: "BEACON",
      active_formation_type: "DUAL_ORBIT",
    },
  });

  assert.equal(review.reviewAllowed, false);
  assert.equal(review.fallbackReport.fallbackDetected, true);
  assert.match(review.reason, /Invalid review artifact/i);
});

test("anime prompt resolves to CELESTIAL_APPRENTICE approved profile", () => {
  const resolution = resolveAnimeCharacterProfileForRequest({
    prompt: "A clearly anime-style young woman with long silver-blue hair and bright teal eyes stands in a glowing sci-fi chamber beside a softly pulsing beacon.",
    subject: "anime-style young woman",
    style: "unmistakably anime look",
    motionIntent: "small readable pose shift",
  });

  assert.equal(resolution.isAnimeCharacterRequest, true);
  assert.equal(resolution.resolutionStatus, "RESOLVED");
  assert.equal(resolution.resolvedProfileId, "CHARACTER_001");
  assert.equal(resolution.resolvedProfileLabel, "CELESTIAL_APPRENTICE");
});

test("uncertain anime request requires explicit profile selection", () => {
  const resolution = resolveAnimeCharacterProfileForRequest({
    prompt: "A clearly anime-style character with readable face and expressive eyes stands in a sci-fi chamber.",
    subject: "anime character",
    style: "anime character-primary portrait",
    motionIntent: "readable pose",
  });

  assert.equal(resolution.isAnimeCharacterRequest, true);
  assert.equal(resolution.resolutionStatus, "NEEDS_OPERATOR_SELECTION");
  assert.equal(resolution.resolvedProfileId, null);
  assert.match(resolution.reason, /Choose approved anime character profile/i);
});
