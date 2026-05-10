import assert from "node:assert/strict";
import test from "node:test";

import {
  anticipationCurve,
  buildAnimeTemporalMotionPlan,
  buildAnimeTemporalMotionSequence,
  easeInOutSine,
  easeInQuad,
  easeOutCubic,
  followThroughCurve,
  settleCurve,
  summarizeAnimeTemporalMotionDiagnostics,
} from "./animeTemporalMotion";

test("anime temporal easing helpers are deterministic bounded curves", () => {
  assert.equal(easeInOutSine(0), 0);
  assert.equal(easeInOutSine(1), 1);
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.equal(easeInQuad(0.5), 0.25);
  assert.equal(anticipationCurve(0), 0);
  assert.equal(anticipationCurve(0.5) > anticipationCurve(0.2), true);
  assert.equal(followThroughCurve(0.5) > followThroughCurve(0.95), true);
  assert.equal(settleCurve(0), 1);
  assert.equal(settleCurve(1), 0);
});

test("anime temporal plan stages anticipation action follow-through and settle", () => {
  const sequence = buildAnimeTemporalMotionSequence({ frameCount: 5 });
  const repeated = buildAnimeTemporalMotionSequence({ frameCount: 5 });
  assert.deepEqual(sequence, repeated);

  assert.equal(sequence.length, 5);
  assert.equal(sequence[1].anticipationPhase > sequence[0].anticipationPhase, true);
  assert.equal(sequence[2].actionPhase >= sequence[1].actionPhase, true);
  assert.equal(sequence[3].followThroughPhase > sequence[2].followThroughPhase * 0.5, true);
  assert.equal(sequence[4].settlePhase >= sequence[3].settlePhase, true);
  assert.equal(sequence.every((entry) => Math.abs(entry.smoothedBodyOffsetX) <= 3), true);
  assert.equal(sequence.every((entry) => Math.abs(entry.smoothedHairOffsetX) <= 4), true);
  assert.equal(sequence.every((entry) => Math.abs(entry.smoothedClothOffsetX) <= 4), true);
  assert.equal(sequence.every((entry) => entry.frameSnapRisk === "LOW" || entry.frameSnapRisk === "MEDIUM"), true);
});

test("anime temporal diagnostics meet early smoothing thresholds", () => {
  const sequence = [0, 1, 2, 3, 4].map((frameIndex) => buildAnimeTemporalMotionPlan({ frameIndex, frameCount: 5 }));
  const diagnostics = summarizeAnimeTemporalMotionDiagnostics(sequence);

  assert.equal(diagnostics.temporal_smoothing_score >= 88, true);
  assert.equal(diagnostics.easing_curve_score >= 88, true);
  assert.equal(diagnostics.anticipation_readability_score >= 88, true);
  assert.equal(diagnostics.follow_through_score >= 88, true);
  assert.equal(diagnostics.overlapping_action_score >= 86, true);
  assert.equal(diagnostics.motion_arc_consistency >= 88, true);
  assert.equal(diagnostics.settle_quality_score >= 88, true);
  assert.equal(["LOW", "MEDIUM"].includes(diagnostics.frame_snap_risk), true);
  assert.equal(diagnostics.temporal_jitter_risk, "LOW");
});
