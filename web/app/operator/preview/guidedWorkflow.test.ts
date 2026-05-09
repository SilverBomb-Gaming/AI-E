import assert from "node:assert/strict";
import test from "node:test";

import {
  INITIAL_GUIDED_WORKFLOW_STATE,
  advanceGuidedWorkflow,
  buildGuidedWorkflowSteps,
  evaluateFinalOperatorVerdict,
  getGuidedStepTarget,
  resolveGuidedStepNavigationTarget,
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

test("Start New Task maps to the stable Request Form target", () => {
  const target = getGuidedStepTarget("start-new-task");

  assert.equal(target.sectionId, "request-form-section");
  assert.equal(target.workflowSectionId, "execution-controls");
  assert.equal(target.focusSelector, "[data-guided-focus='prompt-input']");
  assert.equal(target.highlightSelector, "[data-guided-highlight='request-form']");
  assert.match(target.instruction, /Start here/i);
});

test("target registry returns stable section IDs and non-empty instructions", () => {
  const expectedTargets = [
    ["generate-preview", "execution-controls-section"],
    ["review-preview-output", "preview-outputs-section"],
    ["check-diagnostics-rollback", "diagnostics-section"],
    ["final-operator-verdict", "final-verdict-section"],
  ] as const;

  for (const [stepId, sectionId] of expectedTargets) {
    const target = getGuidedStepTarget(stepId);
    assert.equal(target.sectionId, sectionId);
    assert.ok(target.instruction.length > 20);
    assert.ok(target.calloutLabel.length > 0);
  }
});

test("missing focus targets fall back gracefully to the section", () => {
  const target = resolveGuidedStepNavigationTarget("review-preview-output", (selector) => selector === "#preview-outputs-section");

  assert.equal(target.missing, true);
  assert.equal(target.focusSelector, "#preview-outputs-section");
  assert.match(target.reason, /Primary control is not available yet/i);
});

test("workflow copy includes explicit destinations", () => {
  const steps = buildGuidedWorkflowSteps(INITIAL_GUIDED_WORKFLOW_STATE, baseFacts);

  assert.match(steps[0].title, /Go To Request Form/i);
  assert.match(steps.find((step) => step.id === "review-preview-output")?.title ?? "", /Actual PNG\/GIF/i);
  assert.match(steps.find((step) => step.id === "check-diagnostics-rollback")?.title ?? "", /After Visual Check/i);
  assert.match(steps.find((step) => step.id === "final-operator-verdict")?.title ?? "", /Set Final/i);
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
    previewGenerationCompleted: true,
    truthChecksPassed: true,
    scaffoldFallbackInactive: true,
    finalVisualIntentMatched: true,
    finalTruthChecksPassed: true,
    finalScaffoldFallbackInactive: true,
    finalDiagnosticsClear: true,
  })), "PASS");

  assert.equal(evaluateFinalOperatorVerdict(facts({
    previewOutputReviewed: true,
    diagnosticsReviewed: true,
    previewGenerationCompleted: true,
    truthChecksPassed: false,
    scaffoldFallbackInactive: true,
    finalVisualIntentMatched: true,
    finalTruthChecksPassed: true,
    finalScaffoldFallbackInactive: true,
    finalDiagnosticsClear: true,
  })), "NEEDS REVIEW");
});

test("completed execution still requires visual review before final verdict", () => {
  const reviewState: GuidedWorkflowState = { activeStepId: "review-preview-output", warningStepIds: [] };
  const result = advanceGuidedWorkflow(reviewState, facts({
    promptReady: true,
    subjectStyleAligned: true,
    manualApprovalEnabled: true,
    microSequenceGenerated: true,
    microSequenceReviewed: true,
    previewRequestAccepted: true,
    previewGenerationCompleted: true,
    previewOutputReviewed: false,
    truthChecksPassed: true,
    scaffoldFallbackInactive: true,
  }));

  assert.equal(result.advanced, false);
  assert.match(result.reason, /Inspect the preview frames/i);
  assert.equal(evaluateFinalOperatorVerdict(facts({
    previewGenerationCompleted: true,
    truthChecksPassed: true,
    scaffoldFallbackInactive: true,
    diagnosticsReviewed: true,
    diagnosticsClear: true,
    finalVisualIntentMatched: true,
    finalTruthChecksPassed: true,
    finalScaffoldFallbackInactive: true,
    finalDiagnosticsClear: true,
  })), "NEEDS REVIEW");
});
