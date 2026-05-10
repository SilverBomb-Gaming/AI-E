import assert from "node:assert/strict";
import test from "node:test";

import { resolveActiveRenderPathLabel } from "./animeCreatorWorkflow";
import type { AnimeCharacterTruthCheck } from "@/lib/aie/animeCharacters/governedAnimeCharacterState";

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

test("character-first truth check labels active render path truthfully", () => {
  assert.equal(resolveActiveRenderPathLabel({ mode: "ANIME_CREATOR_MODE", truthCheck: truthCheck() }), "CHARACTER_FIRST_RENDERER");
});

test("fallback dominance cannot masquerade as character-first output", () => {
  assert.equal(resolveActiveRenderPathLabel({ mode: "ANIME_CREATOR_MODE", truthCheck: truthCheck({ renderer_path: "FALLBACK_PRIMITIVE", fallback_primitive_dominance: true }) }), "PRIMITIVE_FALLBACK");
});

test("general preview mode keeps governed preview label", () => {
  assert.equal(resolveActiveRenderPathLabel({ mode: "GENERAL_GOVERNED_MODE", previewGenerated: true }), "GOVERNED_PREVIEW");
});
