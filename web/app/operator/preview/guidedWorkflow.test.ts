import assert from "node:assert/strict";
import test from "node:test";

import {
  INITIAL_GUIDED_WORKFLOW_STATE,
  advanceGuidedWorkflow,
  buildGuidedWorkflowSteps,
  evaluateFinalOperatorVerdict,
  type GuidedWorkflowFacts,
  type GuidedWorkflowState,
} from "./guidedWorkflow";

const baseFacts: GuidedWorkflowFacts = {
  promptReady: false,
  subjectStyleAligned: false,
  manualApprovalEnabled: false,
  microSequenceGenerated: false,
  microSequenceReviewed: false,
  previewRequestAccepted: false,
  previewGenerationCompleted: false,
  previewOutputReviewed: false,
  truthChecksPassed: false,
  scaffoldFallbackInactive: true,
  diagnosticsReviewed: false,
  diagnosticsClear: false,
  rollbackWarningsActive: false,
  activeFailureReason: null,
  finalVisualIntentMatched: false,
  finalTruthChecksPassed: false,
  finalScaffoldFallbackInactive: false,
  finalDiagnosticsClear: false,
};

function facts(overrides: Partial<GuidedWorkflowFacts>): GuidedWorkflowFacts {
  return { ...baseFacts, ...overrides };
}

test("Step 1 starts active", () => {
  const steps = buildGuidedWorkflowSteps(INITIAL_GUIDED_WORKFLOW_STATE, baseFacts);

  assert.equal(steps[0].id, "start-new-task");
  assert.equal(steps[0].status, "active");
  assert.equal(steps[0].isActive, true);
  assert.equal(steps.filter((step) => step.isActive).length, 1);
});

test("Enter advances only when current step is complete", () => {
  const blocked = advanceGuidedWorkflow(INITIAL_GUIDED_WORKFLOW_STATE, baseFacts);
  assert.equal(blocked.advanced, false);
  assert.equal(blocked.state.activeStepId, "start-new-task");

  const advanced = advanceGuidedWorkflow(INITIAL_GUIDED_WORKFLOW_STATE, facts({ promptReady: true }));
  assert.equal(advanced.advanced, true);
  assert.equal(advanced.state.activeStepId, "confirm-subject-style");
});

test("blocked and failed steps do not advance", () => {
  const blockedApproval: GuidedWorkflowState = { activeStepId: "enable-manual-approval", warningStepIds: [] };
  const blockedResult = advanceGuidedWorkflow(blockedApproval, facts({ promptReady: true, subjectStyleAligned: true }));
  assert.equal(blockedResult.advanced, false);
  assert.equal(blockedResult.state.activeStepId, "enable-manual-approval");

  const failedTruth: GuidedWorkflowState = { activeStepId: "check-truth-state", warningStepIds: [] };
  const failedResult = advanceGuidedWorkflow(failedTruth, facts({ truthChecksPassed: true, scaffoldFallbackInactive: false }));
  assert.equal(failedResult.advanced, false);
  assert.equal(failedResult.state.activeStepId, "check-truth-state");
});

test("warnings persist after advancing", () => {
  const diagnosticsState: GuidedWorkflowState = { activeStepId: "check-diagnostics-rollback", warningStepIds: [] };
  const result = advanceGuidedWorkflow(diagnosticsState, facts({ diagnosticsReviewed: true, diagnosticsClear: false, rollbackWarningsActive: true }));
  const steps = buildGuidedWorkflowSteps(result.state, facts({ diagnosticsReviewed: true, diagnosticsClear: false, rollbackWarningsActive: true }));
  const diagnosticsStep = steps.find((step) => step.id === "check-diagnostics-rollback");

  assert.equal(result.advanced, true);
  assert.equal(result.state.activeStepId, "final-operator-verdict");
  assert.equal(diagnosticsStep?.status, "warning");
  assert.equal(diagnosticsStep?.hasPersistentWarning, true);
});

test("accepted request does not equal successful final output", () => {
  const previewState: GuidedWorkflowState = { activeStepId: "generate-preview", warningStepIds: [] };
  const result = advanceGuidedWorkflow(previewState, facts({
    promptReady: true,
    subjectStyleAligned: true,
    manualApprovalEnabled: true,
    microSequenceGenerated: true,
    microSequenceReviewed: true,
    previewRequestAccepted: true,
    previewGenerationCompleted: false,
  }));

  assert.equal(result.advanced, false);
  assert.match(result.reason, /accepted only means/i);
});

test("final verdict cannot pass without output review and truth-check confirmation", () => {
  assert.equal(evaluateFinalOperatorVerdict(facts({
    finalVisualIntentMatched: true,
    finalTruthChecksPassed: true,
    finalScaffoldFallbackInactive: true,
    finalDiagnosticsClear: true,
  })), "NEEDS REVIEW");

  assert.equal(evaluateFinalOperatorVerdict(facts({
    previewOutputReviewed: true,
    diagnosticsReviewed: true,
    finalVisualIntentMatched: true,
    finalTruthChecksPassed: false,
    finalScaffoldFallbackInactive: true,
    finalDiagnosticsClear: true,
  })), "FAIL");

  assert.equal(evaluateFinalOperatorVerdict(facts({
    previewOutputReviewed: true,
    diagnosticsReviewed: true,
    finalVisualIntentMatched: true,
    finalTruthChecksPassed: true,
    finalScaffoldFallbackInactive: true,
    finalDiagnosticsClear: true,
  })), "PASS");
});
