import assert from "node:assert/strict";
import test from "node:test";

import { buildAnimeCreatorWorkflowState } from "./animeCreatorWorkflow";

const animePrompt = "A clearly anime-style blonde-haired young woman with vivid crimson-red eyes stands confidently in a futuristic neon-lit chamber.";

test("anime creator workflow exposes creator-facing stages", () => {
  const workflow = buildAnimeCreatorWorkflowState({
    prompt: animePrompt,
    subject: "anime heroine",
    style: "futuristic anime",
    motionIntent: "confident stance",
    characterApproval: true,
    governanceApproval: true,
    motionPreviewReady: false,
    reviewReady: true,
    previewGenerated: true,
    finalReviewReady: false,
    visualFidelityTier: "EARLY_ANIME",
  });

  assert.equal(workflow.mode, "ANIME_CREATOR_MODE");
  assert.deepEqual(workflow.stages.map((stage) => stage.id), [
    "character-intent-detected",
    "anime-profile-resolved",
    "character-visual-path-prepared",
    "micro-sequence-ready",
    "anime-character-review-ready",
    "motion-preview-ready",
    "final-review-ready",
  ]);
  assert.equal(workflow.scaffoldStatus, "ANIME_CREATOR_WORKFLOW_ACTIVE");
  assert.equal(workflow.guidanceCards.some((entry) => entry.includes("Anime intent detected")), true);
  assert.equal(workflow.guidanceCards.some((entry) => entry.includes("EARLY_ANIME")), true);
});
