import assert from "node:assert/strict";
import test from "node:test";

import {
  activityIconLabel,
  buildAnimeReportActivity,
  buildAnimeSummaryActivity,
  buildDiagnosticsActivity,
  buildRendererOutputActivity,
  statusToneFromActivity,
} from "./activitySections";
import type { AnimeCharacterDiagnosticSummary, AnimeCharacterReport } from "@/lib/aie/animeCharacters/governedAnimeCharacterState";
import type { CinematicGovernedPreviewDiagnostics } from "@/lib/aie/cinematicProductionMemory";

const fallbackTruthCheck = {
  renderer_path: "FALLBACK_PRIMITIVE" as const,
  character_pixels_generated: false,
  character_primary_subject: false,
  fallback_primitive_dominance: true,
  diagnostics_match_rendered_output: false,
  scaffold_status: "SCAFFOLD_ACTIVE" as const,
};

const realTruthCheck = {
  renderer_path: "CHARACTER_FIRST" as const,
  character_pixels_generated: true,
  character_primary_subject: true,
  fallback_primitive_dominance: false,
  diagnostics_match_rendered_output: true,
  scaffold_status: "REAL_OUTPUT_ACTIVE" as const,
};

test("activity icons map blocked and review states to visible header labels", () => {
  assert.equal(activityIconLabel("blocked"), "!");
  assert.equal(activityIconLabel("review"), "*");
  assert.equal(statusToneFromActivity("review"), "warn");
  assert.equal(statusToneFromActivity("blocked"), "blocked");
});

test("renderer output activity blocks scaffold fallback dominance", () => {
  const activity = buildRendererOutputActivity(3, { anime_character_truth_check: fallbackTruthCheck } as CinematicGovernedPreviewDiagnostics);

  assert.equal(activity.tone, "blocked");
  assert.equal(activity.critical, true);
  assert.equal(activity.label, "fallback blocked");
});

test("renderer output activity reports real generated outputs as ready", () => {
  const activity = buildRendererOutputActivity(6, { anime_character_truth_check: realTruthCheck } as CinematicGovernedPreviewDiagnostics);

  assert.equal(activity.tone, "ok");
  assert.equal(activity.critical, false);
  assert.equal(activity.label, "6 outputs ready");
});

test("anime summary activity keeps scaffold and fallback warnings critical", () => {
  const summary = {
    fallbackPrimitiveDominanceCount: 1,
    scaffoldStatus: "SCAFFOLD_ACTIVE",
    failedCharacterCount: 0,
    visualReviewReadyCount: 0,
  } as AnimeCharacterDiagnosticSummary;

  const activity = buildAnimeSummaryActivity(summary);

  assert.equal(activity.tone, "blocked");
  assert.equal(activity.critical, true);
});

test("anime report activity marks user visual review packages", () => {
  const report = {
    pass: true,
    scaffoldStatus: "REAL_OUTPUT_ACTIVE",
    truthCheck: realTruthCheck,
    visualReviewPackage: { reviewLabel: "USER_VISUAL_CHECK_READY" },
  } as AnimeCharacterReport;

  const activity = buildAnimeReportActivity(report);

  assert.equal(activity.tone, "review");
  assert.equal(activity.critical, false);
  assert.equal(activity.label, "review ready");
});

test("diagnostics activity keeps fallback diagnostics visible when collapsed", () => {
  const activity = buildDiagnosticsActivity({ anime_character_truth_check: fallbackTruthCheck } as CinematicGovernedPreviewDiagnostics);

  assert.equal(activity.tone, "blocked");
  assert.equal(activity.critical, true);
  assert.equal(activity.label, "diagnostic fallback");
});
