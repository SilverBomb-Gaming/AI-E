import { evaluateSafeExecutionGuardrail, type SafeExecutionApproval, type SafeExecutionGuardrailDecision, type SafeExecutionOperationKind, type SafeExecutionRollbackBoundary } from "./safeExecutionGuardrails";

export type SupervisedExecutionStepStatus =
  | "planned_non_mutating"
  | "awaiting_operator_approval"
  | "blocked_missing_rollback_plan"
  | "eligible_for_supervised_execution"
  | "refused_unsupported_execution";

export type SupervisedExecutionQueueStatus =
  | "empty"
  | "awaiting_operator_approval"
  | "blocked_missing_rollback_plan"
  | "ready_for_supervised_execution"
  | "refused_unsupported_execution";

export type SupervisedExecutionStepInput = {
  stepId: string;
  title: string;
  operationKind: SafeExecutionOperationKind;
  requestedAction: string;
  targetPaths?: string[];
  operatorApproval?: SafeExecutionApproval;
  rollbackPlan?: SafeExecutionRollbackBoundary;
  destructiveIntent?: boolean;
};

export type SupervisedExecutionStep = SupervisedExecutionStepInput & {
  stepStatus: SupervisedExecutionStepStatus;
  guardrailDecision: SafeExecutionGuardrailDecision;
  plannedActionRecorded: true;
  executedActionRecorded: false;
};

export type SupervisedExecutionQueueInput = {
  queueId: string;
  objective: string;
  createdAt: string;
  steps: SupervisedExecutionStepInput[];
};

export type SupervisedExecutionQueue = {
  layerId: "SUPERVISED_MULTI_STEP_EXECUTION_PHASE1";
  queueId: string;
  objective: string;
  createdAt: string;
  queueStatus: SupervisedExecutionQueueStatus;
  boundedStepLimit: number;
  steps: SupervisedExecutionStep[];
  approvalMetadata: {
    approvalRequiredStepIds: string[];
    approvedStepIds: string[];
    missingApprovalStepIds: string[];
  };
  rollbackPlanMetadata: {
    rollbackRequiredStepIds: string[];
    rollbackReadyStepIds: string[];
    missingRollbackStepIds: string[];
  };
  refusalReports: string[];
  executionEligibility: {
    eligibleStepIds: string[];
    blockedStepIds: string[];
    canEnterSupervisedExecution: boolean;
    executionTriggered: false;
    executedStepIds: [];
  };
  truthfulnessSafeguards: string[];
};

const boundedStepLimit = 5;

function stepStatusFromDecision(decision: SafeExecutionGuardrailDecision): SupervisedExecutionStepStatus {
  if (decision.decisionStatus === "blocked_destructive_operation" || decision.decisionStatus === "blocked_future_only") {
    return "refused_unsupported_execution";
  }
  if (decision.decisionStatus === "blocked_pending_operator_approval") {
    return "awaiting_operator_approval";
  }
  if (decision.decisionStatus === "blocked_missing_rollback_boundary") {
    return "blocked_missing_rollback_plan";
  }
  if (decision.decisionStatus === "eligible_for_supervised_execution") {
    return "eligible_for_supervised_execution";
  }
  return "planned_non_mutating";
}

function queueStatusFromSteps(steps: SupervisedExecutionStep[], overLimit: boolean): SupervisedExecutionQueueStatus {
  if (steps.length === 0) {
    return "empty";
  }
  if (overLimit || steps.some((step) => step.stepStatus === "refused_unsupported_execution")) {
    return "refused_unsupported_execution";
  }
  if (steps.some((step) => step.stepStatus === "blocked_missing_rollback_plan")) {
    return "blocked_missing_rollback_plan";
  }
  if (steps.some((step) => step.stepStatus === "awaiting_operator_approval")) {
    return "awaiting_operator_approval";
  }
  return "ready_for_supervised_execution";
}

export function createSupervisedExecutionQueue(input: SupervisedExecutionQueueInput): SupervisedExecutionQueue {
  const overLimit = input.steps.length > boundedStepLimit;
  const boundedInputs = input.steps.slice(0, boundedStepLimit);
  const steps = boundedInputs.map((step): SupervisedExecutionStep => {
    const guardrailDecision = evaluateSafeExecutionGuardrail({
      operationKind: step.operationKind,
      requestedAction: step.requestedAction,
      targetPaths: step.targetPaths,
      operatorApproval: step.operatorApproval,
      rollbackBoundary: step.rollbackPlan,
      destructiveIntent: step.destructiveIntent,
    });

    return {
      ...step,
      stepStatus: stepStatusFromDecision(guardrailDecision),
      guardrailDecision,
      plannedActionRecorded: true,
      executedActionRecorded: false,
    };
  });
  const approvalRequiredStepIds = steps.filter((step) => step.guardrailDecision.approvalRequired).map((step) => step.stepId);
  const approvedStepIds = steps.filter((step) => step.guardrailDecision.operatorApprovalPresent).map((step) => step.stepId);
  const missingApprovalStepIds = steps.filter((step) => step.guardrailDecision.approvalRequired && !step.guardrailDecision.operatorApprovalPresent).map((step) => step.stepId);
  const rollbackRequiredStepIds = steps.filter((step) => step.guardrailDecision.rollbackBoundaryRequired).map((step) => step.stepId);
  const rollbackReadyStepIds = steps.filter((step) => step.guardrailDecision.rollbackBoundaryPresent).map((step) => step.stepId);
  const missingRollbackStepIds = steps.filter((step) => step.guardrailDecision.rollbackBoundaryRequired && !step.guardrailDecision.rollbackBoundaryPresent).map((step) => step.stepId);
  const refusedReports = steps
    .filter((step) => step.stepStatus === "refused_unsupported_execution")
    .map((step) => step.guardrailDecision.blockedOperationReport);
  if (overLimit) {
    refusedReports.push(`Queue '${input.queueId}' refused because ${input.steps.length} steps exceeds the bounded supervised limit of ${boundedStepLimit}.`);
  }
  const eligibleStepIds = steps.filter((step) => step.stepStatus === "planned_non_mutating" || step.stepStatus === "eligible_for_supervised_execution").map((step) => step.stepId);
  const blockedStepIds = steps.filter((step) => step.stepStatus === "awaiting_operator_approval" || step.stepStatus === "blocked_missing_rollback_plan" || step.stepStatus === "refused_unsupported_execution").map((step) => step.stepId);
  const queueStatus = queueStatusFromSteps(steps, overLimit);

  return {
    layerId: "SUPERVISED_MULTI_STEP_EXECUTION_PHASE1",
    queueId: input.queueId,
    objective: input.objective,
    createdAt: input.createdAt,
    queueStatus,
    boundedStepLimit,
    steps,
    approvalMetadata: {
      approvalRequiredStepIds,
      approvedStepIds,
      missingApprovalStepIds,
    },
    rollbackPlanMetadata: {
      rollbackRequiredStepIds,
      rollbackReadyStepIds,
      missingRollbackStepIds,
    },
    refusalReports: refusedReports.length > 0 ? refusedReports : ["No unsupported execution requested."],
    executionEligibility: {
      eligibleStepIds,
      blockedStepIds,
      canEnterSupervisedExecution: queueStatus === "ready_for_supervised_execution",
      executionTriggered: false,
      executedStepIds: [],
    },
    truthfulnessSafeguards: [
      "This queue records planned steps and readiness only; it does not run shell commands, edit files, call Unity, or submit external agents.",
      "Eligible means ready for a separate supervised execution path, not already executed.",
      "Planned actions and executed actions remain separate; this Phase 1 queue records no executed actions.",
      "Unsupported, destructive, or future-only execution requests are refused rather than converted into hidden automation.",
    ],
  };
}