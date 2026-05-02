import {
  listPlanSelectionOptions,
  type CoreNodePipelineDraftPlan,
  type CoreNodeTaskTranslationPlan,
  type NodeAdvisoryPlan,
  type NodePlanAnnotation,
  type NodePlanExecutionConfirmation,
} from "./nodeBoundary";
import type { DecisionRecord } from "./decisionTrace";

export type ExecutionReadinessStatus =
  | "ready_for_operator_submission"
  | "blocked_missing_selection"
  | "blocked_missing_acknowledgement"
  | "blocked_missing_decision_record"
  | "blocked_missing_confirmation";

export type ExecutionReadinessAcknowledgementStatus = "not_required" | "acknowledged" | "missing";

export type ExecutionReadinessDecisionRecordStatus = "not_required" | "recorded" | "missing";

export type ExecutionReadinessConfirmationStatus = "not_required" | "confirmed" | "missing";

export type ExecutionReadinessReview = {
  readiness_status: ExecutionReadinessStatus;
  selected_plan_id: string | null;
  selected_plan_summary: string;
  highest_severity: NodePlanAnnotation["severity"] | "none";
  acknowledgement_status: ExecutionReadinessAcknowledgementStatus;
  decision_record_status: ExecutionReadinessDecisionRecordStatus;
  confirmation_status: ExecutionReadinessConfirmationStatus;
  required_operator_actions: string[];
  evidence_labels: string[];
};

export type ExecutionReadinessReviewOptions = {
  decisionRecord?: DecisionRecord | null;
  require_acknowledgement?: boolean;
  require_decision_record?: boolean;
  require_confirmation?: boolean;
};

type SelectablePlan = NodeAdvisoryPlan | CoreNodeTaskTranslationPlan | CoreNodePipelineDraftPlan;

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasConfirmedExecutionConfirmation(
  value: NodePlanExecutionConfirmation | undefined,
): boolean {
  if (value?.confirmed !== true) {
    return false;
  }

  return !hasNonEmptyString(value.confirmed_at) || !Number.isNaN(Date.parse(value.confirmed_at));
}

function getHighestSeverity(annotations: NodePlanAnnotation[] | undefined): ExecutionReadinessReview["highest_severity"] {
  if (!Array.isArray(annotations) || annotations.length === 0) {
    return "none";
  }

  const order: Array<NodePlanAnnotation["severity"]> = ["low", "medium", "high", "critical"];
  let highest: NodePlanAnnotation["severity"] = "low";

  for (const annotation of annotations) {
    if (order.indexOf(annotation.severity) > order.indexOf(highest)) {
      highest = annotation.severity;
    }
  }

  return highest;
}

function getSelectedPlanSummary(plan: SelectablePlan, selectedPlanId: string | null): string {
  const options = listPlanSelectionOptions(plan);

  if (selectedPlanId) {
    const selectedOption = options.find((option) => option.plan_id === selectedPlanId);
    if (selectedOption) {
      const summaryParts = [`[${selectedOption.plan_id}] ${selectedOption.label}`];
      if (hasNonEmptyString(selectedOption.command)) {
        summaryParts.push(`command: ${selectedOption.command}`);
      } else if (selectedOption.steps.length > 0) {
        summaryParts.push(`step: ${selectedOption.steps[0]}`);
      }
      return summaryParts.join(" | ");
    }
  }

  if ("command" in plan && hasNonEmptyString(plan.command)) {
    return `[${plan.plan_id}] Original plan | command: ${plan.command}`;
  }

  return `[${plan.plan_id}] Original plan | review the current bounded plan`;
}

export function buildExecutionReadinessReview(
  plan: SelectablePlan,
  options: ExecutionReadinessReviewOptions = {},
): ExecutionReadinessReview {
  const selectionOptions = listPlanSelectionOptions(plan);
  const selectedPlanId = hasNonEmptyString(plan.selected_plan_id) ? plan.selected_plan_id.trim() : null;
  const hasAlternatives = selectionOptions.some((option) => option.source === "alternative");
  const hasAnnotations = Array.isArray(plan.annotations) && plan.annotations.length > 0;
  const requireAcknowledgement = options.require_acknowledgement === true;
  const requireDecisionRecord = options.require_decision_record === true;
  const requireConfirmation = options.require_confirmation === true;
  const acknowledgementStatus: ExecutionReadinessAcknowledgementStatus = !requireAcknowledgement
    ? "not_required"
    : plan.operator_acknowledgement?.acknowledged === true
      ? "acknowledged"
      : "missing";
  const decisionRecordMatchesSelection = Boolean(
    options.decisionRecord
    && selectedPlanId
    && options.decisionRecord.selected_plan_id === selectedPlanId,
  );
  const decisionRecordStatus: ExecutionReadinessDecisionRecordStatus = !requireDecisionRecord
    ? "not_required"
    : decisionRecordMatchesSelection
      ? "recorded"
      : "missing";
  const confirmationStatus: ExecutionReadinessConfirmationStatus = !requireConfirmation
    ? "not_required"
    : hasConfirmedExecutionConfirmation(plan.execution_confirmation)
      ? "confirmed"
      : "missing";

  const requiredOperatorActions: string[] = [];
  const evidenceLabels: string[] = ["EXECUTION READINESS REVIEW GENERATED"];
  let readinessStatus: ExecutionReadinessStatus = "ready_for_operator_submission";

  if (hasAlternatives && !selectedPlanId) {
    readinessStatus = "blocked_missing_selection";
    requiredOperatorActions.push("Select the original plan or one suggested alternative before handoff.");
    evidenceLabels.push("EXECUTION READINESS BLOCKED: MISSING SELECTION");
  } else if (hasAnnotations && acknowledgementStatus === "missing") {
    readinessStatus = "blocked_missing_acknowledgement";
    requiredOperatorActions.push("Acknowledge the visible plan insights before handoff.");
    evidenceLabels.push("EXECUTION READINESS BLOCKED: MISSING ACKNOWLEDGEMENT");
  } else if (decisionRecordStatus === "missing") {
    readinessStatus = "blocked_missing_decision_record";
    requiredOperatorActions.push("Record the operator decision trace before handoff.");
    evidenceLabels.push("EXECUTION READINESS BLOCKED: MISSING DECISION RECORD");
  } else if (confirmationStatus === "missing") {
    readinessStatus = "blocked_missing_confirmation";
    requiredOperatorActions.push("Confirm execution submission? (yes/no)");
    evidenceLabels.push("EXECUTION READINESS BLOCKED: MISSING CONFIRMATION");
  } else {
    evidenceLabels.push("EXECUTION READINESS READY FOR OPERATOR SUBMISSION");
  }

  if (!hasAlternatives) {
    evidenceLabels.push("EXECUTION READINESS NO ALTERNATIVES PRESENT");
  }

  if (!hasAnnotations) {
    evidenceLabels.push("EXECUTION READINESS NO INSIGHT ANNOTATIONS PRESENT");
  }

  return {
    readiness_status: readinessStatus,
    selected_plan_id: selectedPlanId,
    selected_plan_summary: getSelectedPlanSummary(plan, selectedPlanId),
    highest_severity: getHighestSeverity(plan.annotations),
    acknowledgement_status: acknowledgementStatus,
    decision_record_status: decisionRecordStatus,
    confirmation_status: confirmationStatus,
    required_operator_actions: requiredOperatorActions,
    evidence_labels: evidenceLabels,
  };
}

export function renderExecutionReadinessReview(review: ExecutionReadinessReview): string {
  const lines = [
    "Execution readiness review:",
    `- Readiness status: ${review.readiness_status}`,
    `- Selected plan: ${review.selected_plan_summary}`,
    `- Highest severity: ${review.highest_severity}`,
    `- Acknowledgement status: ${review.acknowledgement_status}`,
    `- Decision record status: ${review.decision_record_status}`,
    `- Confirmation status: ${review.confirmation_status}`,
    "",
    "Required operator actions:",
  ];

  if (review.required_operator_actions.length === 0) {
    lines.push("- Operator may proceed to manual submission when ready.");
  } else {
    for (const action of review.required_operator_actions) {
      lines.push(`- ${action}`);
    }
  }

  lines.push("");
  lines.push("Read-only review only. No submission, execution, approval, or plan mutation occurs.");
  return lines.join("\n");
}