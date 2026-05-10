import assert from "node:assert/strict";
import test from "node:test";

import { getApprovedAnimeCharacterProfileById } from "./animeCharacterProfileRegistry";
import { selectDefaultAnimeCharacterExpression } from "./animeCharacterPoseTemplates";
import { buildAnimeEyeRenderPlan } from "./animeEyeRenderer";
import { buildAnimeFaceRenderPlan } from "./animeFaceRenderer";
import { buildAnimeHairRenderPlan } from "./animeHairRenderer";
import { buildAnimeVisualFidelityDiagnostics, classifyAnimeVisualFidelity } from "./animeVisualFidelityDiagnostics";
import type { AnimeCharacterTruthCheck } from "./governedAnimeCharacterState";

function truthCheck(overrides?: Partial<AnimeCharacterTruthCheck>): AnimeCharacterTruthCheck {
  return {
    renderer_path: "CHARACTER_FIRST",
    character_pixels_generated: true,
    character_primary_subject: true,
    fallback_primitive_dominance: false,
    diagnostics_match_rendered_output: true,
    scaffold_status: "REAL_OUTPUT_ACTIVE",
    ...overrides,
  };
}

test("anime visual fidelity diagnostics classify early anime tier", () => {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_001");
  assert.ok(profile);
  const expression = selectDefaultAnimeCharacterExpression(profile.expressionDefault);

  const diagnostics = buildAnimeVisualFidelityDiagnostics({
    facePlan: buildAnimeFaceRenderPlan({ profile, expression }),
    eyePlan: buildAnimeEyeRenderPlan({ profile, expression }),
    hairPlan: buildAnimeHairRenderPlan({ profile, frameIndex: 2 }),
    truthCheck: truthCheck(),
    outfitReadability: 94,
    backgroundSeparation: 94,
    poseReadability: 92,
  });

  assert.equal(diagnostics.fidelity_tier, "EARLY_ANIME");
  assert.equal(diagnostics.visual_fidelity_score >= 90, true);
  assert.equal(diagnostics.anime_face_readability >= 95, true);
  assert.equal(diagnostics.anime_eye_quality >= 95, true);
  assert.equal(diagnostics.layered_hair_quality >= 94, true);
});

test("anime visual fidelity diagnostics block fallback dominance", () => {
  assert.equal(classifyAnimeVisualFidelity(99, truthCheck({ fallback_primitive_dominance: true })), "BLOCKED");
  assert.equal(classifyAnimeVisualFidelity(87, truthCheck()), "PRIMITIVE");
});
