import assert from "node:assert/strict";
import test from "node:test";

import { buildExecutionAction } from "./executionBridge";
import { advanceExecutionSession, buildExecutionSessionContextBlock, normalizeExecutionGoal } from "./executionSession";

test("execution sessions support a three-step success path that converges and resolves", () => {
  const first = advanceExecutionSession({
    currentStepIndex: 1,
    attemptedStep: "Disable the Animator speed sync override and compare the transition.",
    actionResult: "The bad transition becomes much weaker, but it still appears on some resumes.",
    verificationState: "inconclusive",
    diagnosis: "The Animator handoff is still the leading cause.",
    loopTerminationStatus: "converging",
  });
  const second = advanceExecutionSession({
    currentStepIndex: first.nextStepIndex,
    attemptedStep: "Re-run the same handoff with targeted timestamp logging.",
    actionResult: "The timestamps now cleanly show the symptom only when the Animator handoff runs.",
    verificationState: "confirmed",
    diagnosis: "The Animator handoff is confirmed as the cause.",
    loopTerminationStatus: "converging",
    steps: first.steps,
  });
  const third = advanceExecutionSession({
    currentStepIndex: second.nextStepIndex,
    attemptedStep: "Ship the narrowed fix and replay the transition again.",
    actionResult: "The transition now behaves normally and the symptom does not return.",
    verificationState: "confirmed",
    diagnosis: "The Animator handoff fix resolved the issue.",
    loopTerminationStatus: "resolved",
    steps: second.steps,
  });

  assert.deepEqual(third.steps.map((step) => step.stepIndex), [1, 2, 3]);
  assert.equal(third.steps[2]?.loopTerminationStatus, "resolved");
  assert.match(third.previousOutcome, /Step 3 confirmed \(resolved\)/i);
});

test("execution sessions support a three-step failure path that falsifies and reroutes", () => {
  const first = advanceExecutionSession({
    currentStepIndex: 1,
    attemptedStep: "Disable the stamina limiter and compare the sprint jitter.",
    actionResult: "Disabling the limiter changes nothing, but bypassing the second writer removes the jitter.",
    verificationState: "falsified",
    diagnosis: "The original stamina-limiter hypothesis is contradicted.",
    loopTerminationStatus: "converging",
  });
  const second = advanceExecutionSession({
    currentStepIndex: first.nextStepIndex,
    attemptedStep: "Reroute the investigation to the second speed writer.",
    actionResult: "Disabling only the second writer removes most of the conflict, but one edge case remains.",
    verificationState: "inconclusive",
    diagnosis: "The rerouted writer path is now the leading cause.",
    loopTerminationStatus: "converging",
    steps: first.steps,
  });
  const third = advanceExecutionSession({
    currentStepIndex: second.nextStepIndex,
    attemptedStep: "Repeat the same rerouted check under the edge case.",
    actionResult: "The same second writer still causes the remaining jitter in the edge case.",
    verificationState: "confirmed",
    diagnosis: "The rerouted writer path is confirmed.",
    loopTerminationStatus: "converging",
    steps: second.steps,
  });

  assert.equal(third.steps[0]?.verificationState, "falsified");
  assert.equal(third.steps[1]?.verificationState, "inconclusive");
  assert.equal(third.steps[2]?.verificationState, "confirmed");
  assert.equal(third.nextStepIndex, 4);
});

test("execution sessions support a three-step mixed path with partial success", () => {
  const first = advanceExecutionSession({
    currentStepIndex: 1,
    attemptedStep: "Reduce the coyote window and replay the ledge jump.",
    actionResult: "Takeoff feels cleaner, but one sticky ledge case still remains.",
    verificationState: "inconclusive",
    diagnosis: "The coyote overlap is part of the issue but not the full fix.",
    loopTerminationStatus: "converging",
  });
  const second = advanceExecutionSession({
    currentStepIndex: first.nextStepIndex,
    attemptedStep: "Keep the smaller coyote window and tune only the jump buffer.",
    actionResult: "The sticky ledge case disappears and forgiveness still holds.",
    verificationState: "confirmed",
    diagnosis: "The combined timing pass is now confirmed.",
    loopTerminationStatus: "converging",
    steps: first.steps,
  });
  const third = advanceExecutionSession({
    currentStepIndex: second.nextStepIndex,
    attemptedStep: "Replay the same jump route in the final verification pass.",
    actionResult: "The route stays stable and the missed-input problem does not return.",
    verificationState: "confirmed",
    diagnosis: "The tuning pass resolved the ledge-jump issue.",
    loopTerminationStatus: "resolved",
    steps: second.steps,
  });

  const sessionContext = buildExecutionSessionContextBlock({
    goal: normalizeExecutionGoal("Tune ledge-jump forgiveness without making takeoff sticky."),
    currentStepIndex: third.nextStepIndex,
    previousOutcome: third.previousOutcome,
    steps: third.steps,
  });

  assert.match(sessionContext, /Goal: Tune ledge-jump forgiveness/i);
  assert.match(sessionContext, /Current step to approve: 4/i);
  assert.match(sessionContext, /Recent approved steps/i);
  assert.match(sessionContext, /Execution history:/i);
  assert.match(sessionContext, /step 1: attempted/i);
});

test("execution sessions keep approved execution actions alongside step history", () => {
  const execution = buildExecutionAction({
    proposedAction: "Add one focused timestamp log around the state handoff.",
    actionType: "instrumentation",
    expectedOutcome: "The log should show whether the handoff fires during the failing transition.",
  });

  const session = advanceExecutionSession({
    currentStepIndex: 1,
    attemptedStep: execution.description,
    actionResult: "The log shows the handoff fires only during the failing transition.",
    verificationState: "confirmed",
    diagnosis: "The instrumentation confirms the handoff timing path.",
    loopTerminationStatus: "converging",
    action: execution,
  });

  assert.equal(session.steps[0]?.action?.approved, true);
  assert.equal(session.steps[0]?.action?.type, "write");
  assert.equal(session.steps[0]?.action?.scope, "caution");
});