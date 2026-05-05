import assert from "node:assert/strict";
import test from "node:test";

import type { AutoRecordOutcomeResult } from "./autoOutcomeRecording";
import { decidePostPlaytestNextAction } from "./postPlaytestDecisionEngine";

function createOutcomeResult(
  status: "recorded" | "duplicate",
  inferredResult: "pass" | "fail" | "partial",
): AutoRecordOutcomeResult {
  return {
    status,
    projectPath: "E:/AI projects 2025/AI-E/orchestrator_lane/Tools/EnemyAIDemoStandalone",
    feature: "enemy-health",
    ...(status === "duplicate" ? { message: "Outcome already recorded for this session." } : {}),
    evaluation: {
      logPath: "E:/logs/Editor.log",
      evaluatedLineCount: 12,
      session: {
        mode: "marker-window",
        startMarker: "[AIE Playtest Session] START id=session-123",
        endMarker: "[AIE Playtest Session] END id=session-123",
      },
      parsedResult: {
        errors: inferredResult === "fail" ? ["NullReferenceException"] : [],
        warnings: [],
        gameplayEvents: inferredResult === "pass" ? ["Enemy defeated"] : [],
        inferredResult,
      },
    },
    recorded: {
      duplicate: status === "duplicate",
      logPath: "E:/AI projects 2025/AI-E/orchestrator_lane/Tools/EnemyAIDemoStandalone/.aie/outcomes.jsonl",
      record: {
        id: "outcome-1",
        timestamp: "2026-05-05T10:00:00.000Z",
        projectPath: "E:/AI projects 2025/AI-E/orchestrator_lane/Tools/EnemyAIDemoStandalone",
        feature: "enemy-health",
        action: "runtime signal extraction",
        result: inferredResult,
        userObservation: "runtime-auto observation",
        consoleSignals: [],
        filesChanged: [],
        rollbackUsed: false,
        evaluationSource: "runtime-auto",
        sessionKey: "enemy-health|e:/logs/editor.log|marker|12",
        sessionMode: "marker-window",
        selectedLogPath: "E:/logs/Editor.log",
        evaluatedLineCount: 12,
        inferredResult,
        gameplayEvents: inferredResult === "pass" ? ["Enemy defeated"] : [],
        errors: inferredResult === "fail" ? ["NullReferenceException"] : [],
      },
    },
    summary: {
      projectPath: "E:/AI projects 2025/AI-E/orchestrator_lane/Tools/EnemyAIDemoStandalone",
      logPath: "E:/AI projects 2025/AI-E/orchestrator_lane/Tools/EnemyAIDemoStandalone/.aie/outcomes.jsonl",
      totalOutcomes: 1,
      passCount: inferredResult === "pass" ? 1 : 0,
      failCount: inferredResult === "fail" ? 1 : 0,
      partialCount: inferredResult === "partial" ? 1 : 0,
      rollbackCount: 0,
      rollbackFrequency: 0,
      runtimeAutoCount: 1,
      manualCount: 0,
      latestRuntimeAutoPattern: null,
      latestSuccessfulPatterns: [],
      latestFailurePatterns: [],
    },
  } as AutoRecordOutcomeResult;
}

test("pass outcome recommends the next feature", () => {
  const result = decidePostPlaytestNextAction(createOutcomeResult("recorded", "pass"));

  assert.equal(result.status, "ready_for_next_feature");
  assert.equal(result.recommended_next_action, "Mark the feature stable and select the next validation target.");
  assert.equal(result.confidence, "high");
  assert.equal(result.source_feature, "enemy-health");
});

test("fail outcome recommends a bounded retry", () => {
  const result = decidePostPlaytestNextAction(createOutcomeResult("recorded", "fail"));

  assert.equal(result.status, "retry_recommended");
  assert.equal(result.recommended_next_action, "Review failure evidence, apply the smallest safe fix, then rerun the reviewed Unity playtest.");
  assert.equal(result.confidence, "high");
});

test("blocked recording yields a blocked decision", () => {
  const result = decidePostPlaytestNextAction({
    status: "blocked",
    projectPath: "E:/AI projects 2025/AI-E/orchestrator_lane/Tools/EnemyAIDemoStandalone",
    reason: "--feature is required so the outcome can be tied to a specific game feature.",
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.recommended_next_action, "Provide explicit feature context before recording or deciding.");
  assert.equal(result.confidence, "high");
});

test("ambiguous or no-write outcomes escalate to operator review", () => {
  const partial = decidePostPlaytestNextAction(createOutcomeResult("recorded", "partial"));
  const duplicate = decidePostPlaytestNextAction(createOutcomeResult("duplicate", "pass"));
  const missing = decidePostPlaytestNextAction(null);

  assert.equal(partial.status, "escalation_recommended");
  assert.equal(partial.recommended_next_action, "Ask the operator to inspect the playtest evidence before retrying.");
  assert.equal(duplicate.status, "escalation_recommended");
  assert.equal(missing.status, "escalation_recommended");
});