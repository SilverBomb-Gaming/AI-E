import assert from "node:assert/strict";
import test from "node:test";

import type { AutoRecordOutcomeResult } from "./autoOutcomeRecording";
import { selectPostPlaytestFeature } from "./postPlaytestFeatureSelector";

function createOutcome(
  inferredResult: "pass" | "fail" | "partial",
  feature: string,
): AutoRecordOutcomeResult {
  return {
    status: "recorded",
    projectPath: "proj",
    feature,
    evaluation: {
      session: {
        mode: "marker-session",
        startMarker: `[AIE Playtest Session] START id=${feature}-${inferredResult}`,
        endMarker: `[AIE Playtest Session] END id=${feature}-${inferredResult}`,
        startedAt: null,
        endedAt: null,
        sourceLogPath: `tmp/${feature}.log`,
        lines: [],
      },
      logPath: `tmp/${feature}.log`,
      evaluatedLineCount: 3,
      signals: [],
      parsedResult: {
        inferredResult,
        errors: inferredResult === "fail" ? ["simulated failure"] : [],
        warnings: [],
        gameplayEvents: inferredResult === "pass" ? ["Enemy defeated"] : [],
      },
      reason: [inferredResult],
    } as AutoRecordOutcomeResult["evaluation"],
    recorded: {
      record: { sessionKey: `${feature}-${inferredResult}` },
      duplicate: false,
    } as AutoRecordOutcomeResult["recorded"],
    summary: {
      totalOutcomes: 1,
      passCount: inferredResult === "pass" ? 1 : 0,
      failCount: inferredResult === "fail" ? 1 : 0,
      partialCount: inferredResult === "partial" ? 1 : 0,
      rollbackCount: 0,
      rollbackFrequency: 0,
      runtimeAutoCount: 1,
      manualCount: 0,
      latestRuntimeAutoPattern: `${feature}-${inferredResult}`,
      latestSuccessfulPatterns: inferredResult === "pass" ? [`${feature}-${inferredResult}`] : [],
      latestFailurePatterns: inferredResult === "fail" ? [`${feature}-${inferredResult}`] : [],
      projectPath: "proj",
      logPath: "log",
    } as AutoRecordOutcomeResult["summary"],
  };
}

test("selects failing feature before unseen feature", () => {
  const result = selectPostPlaytestFeature({
    feature_pool: ["feature-fail", "feature-unseen", "feature-pass"],
    feature_evidence: [
      { feature: "feature-fail", latest_outcome: createOutcome("fail", "feature-fail") },
      { feature: "feature-pass", latest_outcome: createOutcome("pass", "feature-pass") },
    ],
  });

  assert.equal(result.status, "feature_selected");
  assert.equal(result.selected_feature, "feature-fail");
});

test("selects unseen before passing feature", () => {
  const result = selectPostPlaytestFeature({
    feature_pool: ["feature-unseen", "feature-pass"],
    feature_evidence: [
      { feature: "feature-pass", latest_outcome: createOutcome("pass", "feature-pass") },
    ],
  });

  assert.equal(result.status, "feature_selected");
  assert.equal(result.selected_feature, "feature-unseen");
});

test("never selects completed feature", () => {
  const result = selectPostPlaytestFeature({
    feature_pool: ["feature-a", "feature-b"],
    completed_features: ["feature-a"],
    feature_evidence: [
      { feature: "feature-a", latest_outcome: createOutcome("fail", "feature-a") },
    ],
  });

  assert.equal(result.status, "feature_selected");
  assert.equal(result.selected_feature, "feature-b");
  assert.ok(result.rejected_features.some((entry) => entry.feature === "feature-a"));
});

test("blocks on empty pool", () => {
  const result = selectPostPlaytestFeature({
    feature_pool: [],
  });

  assert.equal(result.status, "selection_blocked");
  assert.equal(result.selected_feature, null);
});

test("operator review required on conflicting evidence", () => {
  const result = selectPostPlaytestFeature({
    feature_pool: ["feature-a", "feature-b"],
    feature_evidence: [
      { feature: "feature-a", latest_outcome: createOutcome("partial", "feature-a") },
      {
        feature: "feature-b",
        latest_outcome: {
          ...createOutcome("pass", "feature-b"),
          status: "duplicate",
        } as AutoRecordOutcomeResult,
      },
    ],
  });

  assert.equal(result.status, "operator_review_required");
  assert.equal(result.selected_feature, null);
});