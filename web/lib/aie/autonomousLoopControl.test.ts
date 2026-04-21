import assert from "node:assert/strict";
import test from "node:test";

import { appendAutonomousStep, createAutonomousSession } from "./autonomousSession";
import {
  getAutonomousStopDecision,
  isNextActionBroaderThanGoal,
  shouldStopBeforeApprovalEscalation,
} from "./autonomousLoopControl";

test("loop control completes when the bounded goal is satisfied", () => {
  const session = appendAutonomousStep(createAutonomousSession({ goal: "Confirm the bounded validation path." }), {
    proposedAction: "Run validation.",
    executionResult: {
      status: "success",
      output: "Validation complete and healthy.",
    },
  });

  const decision = getAutonomousStopDecision({
    session,
    latestExecutionResult: session.latestExecutionResult,
    goalEvaluation: {
      isComplete: true,
      reason: "The bounded goal was satisfied.",
    },
  });

  assert.equal(decision.shouldStop, true);
  assert.equal(decision.status, "completed");
});

test("loop control pauses when the next autonomous step requires approval", () => {
  const session = appendAutonomousStep(createAutonomousSession({ goal: "Confirm the bounded validation path." }), {
    proposedAction: "Apply a broader code change.",
    executionResult: {
      status: "blocked",
      error: "manual approval required",
      output: "AI-E paused this autonomous session because the next action is outside the safe auto-execution boundary and still requires manual approval.",
    },
  });

  const decision = getAutonomousStopDecision({
    session,
    latestExecutionResult: session.latestExecutionResult,
    goalEvaluation: {
      isComplete: false,
      reason: "The goal is not complete yet.",
    },
  });

  assert.equal(decision.shouldStop, true);
  assert.equal(decision.status, "awaiting-approval");
});

test("loop control fails repeated identical autonomous steps", () => {
  const first = appendAutonomousStep(createAutonomousSession({ goal: "Confirm the bounded validation path." }), {
    proposedAction: "Run validation.",
    executionResult: {
      status: "success",
      output: "No change yet.",
    },
  });
  const second = appendAutonomousStep(first, {
    proposedAction: "Run validation.",
    executionResult: {
      status: "success",
      output: "No change yet.",
    },
    repeatedAction: true,
    repeatedOutput: true,
    stallReason: "The autonomous loop repeated the same action with no meaningful output change.",
  });

  const decision = getAutonomousStopDecision({
    session: second,
    latestExecutionResult: second.latestExecutionResult,
    goalEvaluation: {
      isComplete: false,
      reason: "The goal is not complete yet.",
    },
  });

  assert.equal(decision.shouldStop, true);
  assert.equal(decision.status, "failed");
});

test("loop control completes on a high-confidence verification stop for an already-answered small safe goal", () => {
  const session = appendAutonomousStep(createAutonomousSession({ goal: "Validate whether web/lib/aie/types.ts exists before continuing." }), {
    proposedAction: "Validate whether web/lib/aie/types.ts exists before continuing.",
    executionResult: {
      status: "success",
      output: "Confirmed that web/lib/aie/types.ts exists.",
    },
  });

  const decision = getAutonomousStopDecision({
    session,
    latestExecutionResult: session.latestExecutionResult,
    goalEvaluation: {
      status: "needs-verification",
      isComplete: false,
      reason: "The bounded read-only evidence is already strong enough to stop conservatively without a broader follow-up step.",
      confidence: "high",
      safeEvidenceSufficient: true,
      followUpUnnecessary: true,
      outputDirectlyAnswersGoal: true,
    },
  });

  assert.equal(decision.shouldStop, true);
  assert.equal(decision.status, "completed");
});

test("approval-drift helpers treat broader write follow-up as unnecessary after a satisfied small safe goal", () => {
  const session = createAutonomousSession({ goal: "Inspect web/lib/aie/types.ts and summarize the file shape in read-only mode." });
  session.latestCompletion = {
    status: "needs-verification",
    isComplete: false,
    reason: "The bounded read-only evidence is already strong enough to stop conservatively without a broader follow-up step.",
    confidence: "high",
  };

  const nextAction = {
    id: "broader-write",
    type: "file-write" as const,
    scope: "caution" as const,
    description: "Update web/lib/aie/types.ts to add more logging.",
    expectedOutcome: "The write should add diagnostic output.",
    requiresApproval: true as const,
    metadata: {
      sourceActionType: "file-write" as const,
      targetPath: "web/lib/aie/types.ts",
    },
  };

  assert.equal(isNextActionBroaderThanGoal({ goal: session.goal, nextAction }), true);
  assert.equal(shouldStopBeforeApprovalEscalation({ session, nextAction }), true);
});