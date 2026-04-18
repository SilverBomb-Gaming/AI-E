import assert from "node:assert/strict";
import test from "node:test";

import type { FollowUpVerificationState, StoredActionChainState } from "../../components/AnalysisForm";
import { buildAnalysisTraceRecord, listMissingAnalysisTraceFields } from "./analysisTrace";
import type { AnalysisInput, FreeAnalysisResponse } from "./types";

function makeInput(problemDescription: string): AnalysisInput {
  return { problemDescription };
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
  assert.equal(trace.verificationState, null);
  assert.equal(trace.commitmentValidationState, null);
});

test("pending commitment traces expose a pending validation state", () => {
  const trace = buildTrace({
    input: makeInput(
      "Player movement breaks after changing the Animator speed sync. The bad transition happens right when the Animator resume handoff runs, and the symptom seems tied to that handoff rather than the rest of movement.",
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
});

test("committed traces expose a validated commitment state", () => {
  const trace = buildTrace({
    input: makeInput("Player movement breaks after changing the Animator speed sync."),
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
});