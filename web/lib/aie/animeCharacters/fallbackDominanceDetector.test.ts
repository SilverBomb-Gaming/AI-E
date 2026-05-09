import assert from "node:assert/strict";
import test from "node:test";

import { detectFallbackDominance, validateCharacterRender } from "./fallbackDominanceDetector";

test("cube beacon fallback is detected and invalidates character review", () => {
  const fallbackReport = detectFallbackDominance({
    artifactPaths: [
      ".aie/governed_micro_sequence_sandbox/sequence-governed-micro-preview-001/governed_preview_sequence_frame_001.png",
    ],
    diagnostics: {
      recognizable_object: "anchored cube with secondary sphere beacon and segmented drones",
      active_beat_type: "BEACON_REVEAL",
      active_focus_subject: "BEACON",
      active_formation_type: "DUAL_ORBIT",
      object_relationship_summary: "Cube anchor, beacon, and segmented drones dominate the frame.",
    },
  });
  const validation = validateCharacterRender({ fallbackReport, diagnostics: { recognizable_object: "anchored cube with beacon" } });

  assert.equal(fallbackReport.fallbackDetected, true);
  assert.equal(fallbackReport.dominantFallbackType, "SEGMENTED_DRONES");
  assert.equal(fallbackReport.validCharacterRender, false);
  assert.equal(validation.validationPassed, false);
  assert.match(validation.failureReasons.join(" "), /Fallback prerequisite renderer/i);
});

test("character-first truth check passes fallback dominance validation", () => {
  const fallbackReport = detectFallbackDominance({
    artifactPaths: [
      ".aie/anime_character_sandbox/character-001/anime_character_frame_001.png",
      ".aie/anime_character_sandbox/character-001/anime_character_preview.gif",
    ],
    diagnostics: {
      recognizable_object: "approved anime character profile CELESTIAL_APPRENTICE",
      active_entity_type: "ANIME_CHARACTER",
      active_focus_subject: "CHARACTER_FACE",
      object_relationship_summary: "Anime character is the primary rendered subject.",
      scene_readability_overlay: "anime character visibly dominates the frame; cube/beacon/drone fallback absent",
    },
    truthCheck: {
      renderer_path: "CHARACTER_FIRST",
      character_pixels_generated: true,
      character_primary_subject: true,
      fallback_primitive_dominance: false,
      diagnostics_match_rendered_output: true,
    },
  });
  const validation = validateCharacterRender({
    fallbackReport,
    diagnostics: {
      recognizable_object: "approved anime character profile CELESTIAL_APPRENTICE",
      active_entity_type: "ANIME_CHARACTER",
      active_focus_subject: "CHARACTER_FACE",
      scene_readability_overlay: "anime character visibly dominates the frame with readable silhouette and large teal eyes",
    },
    truthCheck: {
      renderer_path: "CHARACTER_FIRST",
      character_pixels_generated: true,
      character_primary_subject: true,
      fallback_primitive_dominance: false,
      diagnostics_match_rendered_output: true,
    },
  });

  assert.equal(fallbackReport.fallbackDetected, false);
  assert.equal(fallbackReport.validCharacterRender, true);
  assert.equal(validation.validationPassed, true);
});
