import assert from "node:assert/strict";
import test from "node:test";

import type { FollowUpVerificationState, StoredActionChainState } from "../../components/AnalysisForm";
import { buildAnalysisTraceRecord, listMissingAnalysisTraceFields } from "./analysisTrace";
import type { AnalysisInput, FreeAnalysisResponse } from "./types";

function makeInput(problemDescription: string, overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    problemDescription,
    sessionId: "test-session",
    stepIndex: 1,
    goal: "Confirm whether the Animator handoff is the leading cause.",
    ...overrides,
  };
}

function makeResult(overrides: Partial<FreeAnalysisResponse> = {}): FreeAnalysisResponse {
  return {
    what_happened: "The Animator state transition is the most likely cause of the symptom.",
    what_matters: ["Animator speed values are changing during the failing transition."],
    what_to_do_next: [
      "Temporarily disable the Animator transition override and compare the behavior before and after.",
    ],
    upgrade_hint: "",
    ...overrides,
  };
}

function buildTrace(params: {
  input: AnalysisInput;
  result: FreeAnalysisResponse;
  isRefined?: boolean;
  lastObservation?: string;
  verificationState?: FollowUpVerificationState;
  previousActionChainState?: StoredActionChainState;
}) {
  return buildAnalysisTraceRecord(params);
}

test("fresh traces include the full required contract", () => {
  const trace = buildTrace({
    input: makeInput("Player movement breaks after changing the Animator speed sync."),
    result: makeResult({
      what_happened: "The Animator speed sync override is the most likely cause of the symptom.",
      what_to_do_next: [
        "Temporarily disable the Animator speed sync override and compare the behavior before and after.",
      ],
    }),
  });

  assert.deepEqual(listMissingAnalysisTraceFields(trace), []);
  assert.equal(trace.actionType, "inspection");
  assert.match(trace.proposedAction, /disable the Animator speed sync override/i);
  assert.match(trace.expectedOutcome, /source of the issue|target/i);
  assert.equal(trace.actionResult, null);
  assert.equal(trace.sessionId, "test-session");
  assert.equal(trace.stepIndex, 1);
  assert.equal(trace.goal, "Confirm whether the Animator handoff is the leading cause.");
  assert.equal(trace.verificationState, null);
  assert.equal(trace.commitmentValidationState, null);
});

test("pending commitment traces expose a pending validation state", () => {
  const trace = buildTrace({
    input: makeInput(
      "Player movement breaks after changing the Animator speed sync. The bad transition happens right when the Animator resume handoff runs, and the symptom seems tied to that handoff rather than the rest of movement.",
      { stepIndex: 2 },
    ),
    isRefined: true,
    verificationState: "inconclusive",
    lastObservation:
      "Disabling the Animator speed sync now cleanly tracks the symptom to the same handoff, and restoring it brings the bad transition back.",
    result: makeResult({
      what_happened: "The Animator speed sync override is now the clearly leading cause of the symptom.",
      what_to_do_next: [
        "Temporarily isolate only the Animator resume handoff and one related variable, then compare whether the symptom changes immediately.",
      ],
    }),
    previousActionChainState: {
      currentStepIndex: 1,
      totalSteps: 3,
      lastStepIntent: "isolation",
      lastStepVerification: "inconclusive",
      lastStepWatchFor:
        "Watch for whether changing animator resume handoff shifts the symptom immediately instead of only producing later side effects.",
      previousConfidenceLevel: "medium",
      confidenceHistory: ["low", "medium"],
    },
  });

  assert.equal(trace.decisionCommitment, "pending");
  assert.equal(trace.commitmentValidationState, "pending");
  assert.match(trace.actionResult ?? "", /cleanly tracks the symptom/i);
});

test("committed traces expose a validated commitment state", () => {
  const trace = buildTrace({
    input: makeInput("Player movement breaks after changing the Animator speed sync.", { stepIndex: 3 }),
    isRefined: true,
    verificationState: "inconclusive",
    lastObservation:
      "The same Animator handoff still cleanly drives the symptom, and the confirm check keeps matching the expected path.",
    result: makeResult({
      what_happened: "The Animator speed sync override remains the clearly leading cause of the symptom.",
      what_to_do_next: [
        "Temporarily isolate only the Animator resume handoff and one related variable, then compare whether the symptom changes immediately.",
      ],
    }),
    previousActionChainState: {
      currentStepIndex: 0,
      totalSteps: 2,
      lastStepIntent: "confirmation",
      isCommitted: false,
      alignedSignalCount: 1,
      lastStepVerification: "inconclusive",
      lastStepWatchFor:
        "Watch for a clean confirm-or-contradict result around animator speed sync: the symptom should track this subsystem directly, not stay unchanged or move to a different cause.",
      previousConfidenceLevel: "high",
      confidenceHistory: ["medium", "high"],
    },
  });

  assert.equal(trace.decisionCommitment, "committed");
  assert.equal(trace.commitmentValidationState, "validated");
  assert.deepEqual(listMissingAnalysisTraceFields(trace), []);
  assert.match(trace.expectedOutcome, /confirm whether|source of the issue|target/i);
  assert.match(trace.actionResult ?? "", /same Animator handoff/i);
});

test("follow-up traces preserve action results for falsified, confirmed, and partial updates", () => {
  const falsified = buildTrace({
    input: makeInput("Sprint speed flickers after I added a stamina limiter.", {
      actionResult: "Disabling the stamina limiter changed nothing, but disabling the second zoom script removed jitter completely.",
      stepIndex: 2,
    }),
    isRefined: true,
    verificationState: "falsified",
    lastObservation:
      "Disabling the stamina limiter changed nothing, but disabling the second zoom script removed jitter completely.",
    result: makeResult({
      what_happened: "The second zoom script is the more likely cause of the jitter.",
    }),
  });
  const confirmed = buildTrace({
    input: makeInput("Player movement breaks after changing the Animator speed sync.", {
      actionResult:
        "Disabling the Animator speed sync now cleanly tracks the symptom to the same handoff, and restoring it brings the bad transition back.",
      stepIndex: 2,
    }),
    isRefined: true,
    verificationState: "confirmed",
    lastObservation:
      "Disabling the Animator speed sync now cleanly tracks the symptom to the same handoff, and restoring it brings the bad transition back.",
    result: makeResult(),
  });
  const partial = buildTrace({
    input: makeInput("Player movement breaks after changing the Animator speed sync.", {
      actionResult:
        "Disabling the Animator speed sync reduced the jitter, but the symptom still appears during the handoff.",
      stepIndex: 3,
    }),
    isRefined: true,
    verificationState: "inconclusive",
    lastObservation:
      "Disabling the Animator speed sync reduced the jitter, but the symptom still appears during the handoff.",
    result: makeResult(),
  });

  assert.equal(falsified.verificationState, "falsified");
  assert.equal(confirmed.verificationState, "confirmed");
  assert.equal(partial.verificationState, "inconclusive");
  assert.match(falsified.actionResult ?? "", /changed nothing/i);
  assert.match(confirmed.actionResult ?? "", /cleanly tracks the symptom/i);
  assert.match(partial.actionResult ?? "", /reduced the jitter/i);
  assert.ok(["high", "medium", "low"].includes(falsified.confidenceLevel));
  assert.ok(["high", "medium", "low"].includes(confirmed.confidenceLevel));
  assert.ok(["high", "medium", "low"].includes(partial.confidenceLevel));
});