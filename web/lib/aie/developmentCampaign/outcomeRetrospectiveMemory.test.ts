import assert from "node:assert/strict";
import test from "node:test";

import { summarizeDevelopmentOutcomes, type DevelopmentOutcomeRecord } from "./outcomeRetrospectiveMemory";

const outcomes: DevelopmentOutcomeRecord[] = [
  {
    outcomeId: "outcome-1",
    layerId: "SAFE_EXECUTION_GUARDRAILS_PHASE1",
    taskSummary: "added guardrail classification",
    status: "completed",
    validationSummary: "focused tests passed",
    lessons: ["approval and rollback readiness should stay separate from execution"],
    reviewed: true,
    createdAt: "2026-05-11T00:00:00.000Z",
  },
  {
    outcomeId: "outcome-2",
    layerId: "SUPERVISED_MULTI_STEP_EXECUTION_PHASE1",
    taskSummary: "planned queue follow-up",
    status: "blocked",
    validationSummary: "operator review pending",
    lessons: ["unreviewed blockers are not policy changes"],
    reviewed: false,
    createdAt: "2026-05-11T00:05:00.000Z",
  },
];

test("retrospective summary counts reviewed and unreviewed outcomes", () => {
  const summary = summarizeDevelopmentOutcomes(outcomes);

  assert.equal(summary.totalOutcomes, 2);
  assert.equal(summary.reviewedOutcomeCount, 1);
  assert.equal(summary.unreviewedOutcomeCount, 1);
  assert.equal(summary.statusCounts.completed, 1);
  assert.equal(summary.statusCounts.blocked, 1);
});

test("retrospective summary uses only reviewed lessons as advisory signals", () => {
  const summary = summarizeDevelopmentOutcomes(outcomes);

  assert.deepEqual(summary.advisoryLessons, ["SAFE_EXECUTION_GUARDRAILS_PHASE1: approval and rollback readiness should stay separate from execution"]);
  assert.match(summary.unreviewedOutcomeWarnings.join("\n"), /outcome-2 is unreviewed/);
});

test("retrospective summary never mutates behavior or triggers execution", () => {
  const summary = summarizeDevelopmentOutcomes(outcomes);

  assert.equal(summary.behaviorMutationAllowed, false);
  assert.equal(summary.executionTriggered, false);
  assert.match(summary.truthfulnessWarnings.join("\n"), /does not execute tasks or alter code/);
});