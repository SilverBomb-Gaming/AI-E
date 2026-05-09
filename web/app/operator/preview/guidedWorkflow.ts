export type GuidedWorkflowStepId =
  | "start-new-task"
  | "confirm-subject-style"
  | "enable-manual-approval"
  | "generate-micro-sequence"
  | "review-micro-sequence"
  | "generate-preview"
  | "review-preview-output"
  | "check-truth-state"
  | "check-diagnostics-rollback"
  | "final-operator-verdict";

export type GuidedWorkflowStatus = "waiting" | "active" | "completed" | "warning" | "failed" | "blocked" | "needs review";

export type GuidedWorkflowSectionId =
  | "dashboard-controls"
  | "anime-character-report"
  | "execution-controls"
  | "execution-status"
  | "micro-sequence-frames"
  | "preview-outputs"
  | "frame-comparison"
  | "governed-diagnostics"
  | "blockers-rollback";

export type GuidedWorkflowStepDefinition = {
  id: GuidedWorkflowStepId;
  number: number;
  title: string;
  instruction: string;
  sectionId: GuidedWorkflowSectionId;
};

export type GuidedWorkflowFacts = {
  promptReady: boolean;
  subjectStyleAligned: boolean;
  manualApprovalEnabled: boolean;
  microSequenceGenerated: boolean;
  microSequenceReviewed: boolean;
  previewRequestAccepted: boolean;
  previewGenerationCompleted: boolean;
  previewOutputReviewed: boolean;
  truthChecksPassed: boolean;
  scaffoldFallbackInactive: boolean;
  diagnosticsReviewed: boolean;
  diagnosticsClear: boolean;
  rollbackWarningsActive: boolean;
  activeFailureReason?: string | null;
  finalVisualIntentMatched: boolean;
  finalTruthChecksPassed: boolean;
  finalScaffoldFallbackInactive: boolean;
  finalDiagnosticsClear: boolean;
};

export type GuidedWorkflowStepView = GuidedWorkflowStepDefinition & {
  status: GuidedWorkflowStatus;
  reason: string;
  canAdvance: boolean;
  isActive: boolean;
  isPast: boolean;
  hasPersistentWarning: boolean;
};

export type GuidedWorkflowState = {
  activeStepId: GuidedWorkflowStepId;
  warningStepIds: GuidedWorkflowStepId[];
};

export type GuidedWorkflowAdvanceResult = {
  state: GuidedWorkflowState;
  advanced: boolean;
  reason: string;
};

export type FinalOperatorVerdict = "PASS" | "FAIL" | "NEEDS REVIEW";

export const ANIME_GUIDED_WORKFLOW_STEPS: GuidedWorkflowStepDefinition[] = [
  {
    id: "start-new-task",
    number: 1,
    title: "Start New Task",
    instruction: "Review or enter the operator prompt, then press Enter to continue.",
    sectionId: "execution-controls",
  },
  {
    id: "confirm-subject-style",
    number: 2,
    title: "Confirm Subject And Style Alignment",
    instruction: "Confirm the subject and style describe the intended anime-style character before continuing.",
    sectionId: "dashboard-controls",
  },
  {
    id: "enable-manual-approval",
    number: 3,
    title: "Enable Manual Approval",
    instruction: "Enable manual approval for the governed sandbox run.",
    sectionId: "execution-controls",
  },
  {
    id: "generate-micro-sequence",
    number: 4,
    title: "Generate Micro-Sequence First",
    instruction: "Run the prerequisite micro-sequence before generating the full preview.",
    sectionId: "execution-controls",
  },
  {
    id: "review-micro-sequence",
    number: 5,
    title: "Review Micro-Sequence Outputs",
    instruction: "Open the generated micro-sequence frames and confirm they are inspectable.",
    sectionId: "micro-sequence-frames",
  },
  {
    id: "generate-preview",
    number: 6,
    title: "Generate Preview",
    instruction: "Generate the governed preview only after the prerequisite is ready.",
    sectionId: "execution-controls",
  },
  {
    id: "review-preview-output",
    number: 7,
    title: "Review Preview Outputs",
    instruction: "Inspect preview frames or GIF output; request accepted is not success.",
    sectionId: "preview-outputs",
  },
  {
    id: "check-truth-state",
    number: 8,
    title: "Check Truth / Scaffold / Fallback State",
    instruction: "Verify truth checks passed and scaffold/fallback dominance stayed inactive.",
    sectionId: "anime-character-report",
  },
  {
    id: "check-diagnostics-rollback",
    number: 9,
    title: "Check Diagnostics And Rollback Warnings",
    instruction: "Review diagnostics and rollback warnings before making a verdict.",
    sectionId: "governed-diagnostics",
  },
  {
    id: "final-operator-verdict",
    number: 10,
    title: "Final Operator Verdict",
    instruction: "Answer the final validation questions and choose PASS, FAIL, or NEEDS REVIEW.",
    sectionId: "blockers-rollback",
  },
];

export const INITIAL_GUIDED_WORKFLOW_STATE: GuidedWorkflowState = {
  activeStepId: "start-new-task",
  warningStepIds: [],
};

function stepIndex(stepId: GuidedWorkflowStepId): number {
  return ANIME_GUIDED_WORKFLOW_STEPS.findIndex((step) => step.id === stepId);
}

function nextStepId(stepId: GuidedWorkflowStepId): GuidedWorkflowStepId {
  const index = stepIndex(stepId);
  return ANIME_GUIDED_WORKFLOW_STEPS[Math.min(index + 1, ANIME_GUIDED_WORKFLOW_STEPS.length - 1)].id;
}

export function evaluateFinalOperatorVerdict(facts: GuidedWorkflowFacts): FinalOperatorVerdict {
  const reviewedEverything = facts.previewOutputReviewed && facts.diagnosticsReviewed;
  const allPassed = facts.finalVisualIntentMatched
    && facts.finalTruthChecksPassed
    && facts.finalScaffoldFallbackInactive
    && facts.finalDiagnosticsClear;

  if (reviewedEverything && allPassed) {
    return "PASS";
  }
  if (facts.previewOutputReviewed && (!facts.finalVisualIntentMatched || !facts.finalTruthChecksPassed || !facts.finalScaffoldFallbackInactive)) {
    return "FAIL";
  }
  if (facts.diagnosticsReviewed && !facts.finalDiagnosticsClear) {
    return "FAIL";
  }
  return "NEEDS REVIEW";
}

export function evaluateStepAdvance(stepId: GuidedWorkflowStepId, facts: GuidedWorkflowFacts): { canAdvance: boolean; reason: string; status: GuidedWorkflowStatus; warning?: boolean } {
  if (facts.activeFailureReason) {
    return { canAdvance: false, reason: facts.activeFailureReason, status: "failed" };
  }

  switch (stepId) {
    case "start-new-task":
      return facts.promptReady
        ? { canAdvance: true, reason: "Prompt is ready for the guided anime preview task.", status: "completed" }
        : { canAdvance: false, reason: "Enter or review the operator prompt before continuing.", status: "active" };
    case "confirm-subject-style":
      return facts.subjectStyleAligned
        ? { canAdvance: true, reason: "Subject and style are ready for the anime preview task.", status: "completed" }
        : { canAdvance: false, reason: "Add or confirm both the primary subject and anime style before continuing.", status: "active" };
    case "enable-manual-approval":
      return facts.manualApprovalEnabled
        ? { canAdvance: true, reason: "Manual approval is enabled for the sandbox run.", status: "completed" }
        : { canAdvance: false, reason: "Manual approval is required before generation can proceed.", status: "blocked" };
    case "generate-micro-sequence":
      return facts.microSequenceGenerated
        ? { canAdvance: true, reason: "Micro-sequence generated; review the frames next.", status: "completed" }
        : { canAdvance: false, reason: "Generate Micro-Sequence First, then press Enter again.", status: "active" };
    case "review-micro-sequence":
      return facts.microSequenceReviewed
        ? { canAdvance: true, reason: "Micro-sequence review acknowledged.", status: "completed" }
        : facts.microSequenceGenerated
          ? { canAdvance: false, reason: "Inspect the micro-sequence outputs before continuing.", status: "needs review" }
          : { canAdvance: false, reason: "Micro-sequence outputs are not available yet.", status: "blocked" };
    case "generate-preview":
      if (!facts.microSequenceReviewed) {
        return { canAdvance: false, reason: "Review the micro-sequence before generating the preview.", status: "blocked" };
      }
      if (facts.previewGenerationCompleted) {
        return { canAdvance: true, reason: "Preview generation completed; review the output next.", status: "completed" };
      }
      if (facts.previewRequestAccepted) {
        return { canAdvance: false, reason: "Request accepted only means the sandbox received it; generated output is still required.", status: "needs review", warning: true };
      }
      return { canAdvance: false, reason: "Generate Preview after the micro-sequence review is complete.", status: "active" };
    case "review-preview-output":
      if (!facts.previewGenerationCompleted) {
        return { canAdvance: false, reason: "Preview output has not completed yet; accepted is not visual success.", status: "blocked" };
      }
      return facts.previewOutputReviewed
        ? { canAdvance: true, reason: "Preview output review acknowledged.", status: "completed" }
        : { canAdvance: false, reason: "Inspect the preview frames/GIF before continuing.", status: "needs review" };
    case "check-truth-state":
      if (facts.truthChecksPassed && facts.scaffoldFallbackInactive) {
        return { canAdvance: true, reason: "Truth checks passed and scaffold/fallback stayed inactive.", status: "completed" };
      }
      if (!facts.scaffoldFallbackInactive) {
        return { canAdvance: false, reason: "Scaffold or fallback dominance is active; this cannot advance as success.", status: "failed" };
      }
      return { canAdvance: false, reason: "Truth checks must pass before moving to diagnostics.", status: "blocked" };
    case "check-diagnostics-rollback":
      if (!facts.diagnosticsReviewed) {
        return { canAdvance: false, reason: "Review diagnostics and rollback warnings before continuing.", status: "needs review" };
      }
      return facts.diagnosticsClear && !facts.rollbackWarningsActive
        ? { canAdvance: true, reason: "Diagnostics reviewed with no unresolved rollback warnings.", status: "completed" }
        : { canAdvance: true, reason: "Diagnostics review has unresolved warnings; keep them visible for the final verdict.", status: "warning", warning: true };
    case "final-operator-verdict":
      return evaluateFinalOperatorVerdict(facts) === "PASS"
        ? { canAdvance: true, reason: "Final operator verdict passed.", status: "completed" }
        : { canAdvance: false, reason: "Final verdict cannot pass until visual intent, truth checks, scaffold/fallback, and diagnostics all pass.", status: "needs review" };
  }
}

export function buildGuidedWorkflowSteps(state: GuidedWorkflowState, facts: GuidedWorkflowFacts): GuidedWorkflowStepView[] {
  const activeIndex = stepIndex(state.activeStepId);
  return ANIME_GUIDED_WORKFLOW_STEPS.map((step, index) => {
    const evaluation = evaluateStepAdvance(step.id, facts);
    const isActive = step.id === state.activeStepId;
    const isPast = index < activeIndex;
    const hasPersistentWarning = state.warningStepIds.includes(step.id) || (isPast && evaluation.status === "warning");
    const status = isActive
      ? evaluation.status
      : isPast
        ? hasPersistentWarning
          ? "warning"
          : "completed"
        : "waiting";

    return {
      ...step,
      status,
      reason: evaluation.reason,
      canAdvance: evaluation.canAdvance,
      isActive,
      isPast,
      hasPersistentWarning,
    };
  });
}

export function advanceGuidedWorkflow(state: GuidedWorkflowState, facts: GuidedWorkflowFacts): GuidedWorkflowAdvanceResult {
  const evaluation = evaluateStepAdvance(state.activeStepId, facts);
  const nextWarningStepIds = evaluation.warning && !state.warningStepIds.includes(state.activeStepId)
    ? [...state.warningStepIds, state.activeStepId]
    : state.warningStepIds;

  if (!evaluation.canAdvance || state.activeStepId === "final-operator-verdict") {
    return {
      state: { ...state, warningStepIds: nextWarningStepIds },
      advanced: false,
      reason: evaluation.reason,
    };
  }

  return {
    state: {
      activeStepId: nextStepId(state.activeStepId),
      warningStepIds: nextWarningStepIds,
    },
    advanced: true,
    reason: evaluation.reason,
  };
}
