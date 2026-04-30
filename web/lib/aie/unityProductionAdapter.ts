import type {
  UnityProductionPlanningPacket,
  UnityProductionRequestType,
  UnityValidationExecutionResult,
} from "./productionPipelineFoundation";

export type UnityProductionAdapterAction =
  | "scene_plan_review"
  | "prefab_plan_review"
  | "component_script_plan_review"
  | "validation_playtest_review"
  | "asset_import_review";

export type UnityProductionAdapterReviewState = {
  review_package_id: string | null;
  review_completed_at: string | null;
  approved_by_operator: boolean;
  operator_approval_id: string | null;
  delivery_package_id: string | null;
};

export type UnityProductionAdapterInput = {
  adapter_request_id: string;
  requested_at: string;
  planning_packet: UnityProductionPlanningPacket;
  requested_actions: UnityProductionAdapterAction[];
  review_state: UnityProductionAdapterReviewState;
};

export type UnityProductionAdapterOutput = {
  request_types: UnityProductionRequestType[];
  execution_mode: "reviewed_execution_only";
  review_artifacts: string[];
  approval_gates: string[];
  planned_adapter_actions: UnityProductionAdapterAction[];
  next_step: "request_review" | "request_operator_approval" | "ready_for_reviewed_execution";
};

export type UnityProductionAdapterReadinessStatus =
  | "blocked_missing_review"
  | "blocked_missing_approval"
  | "ready_for_reviewed_execution";

export type UnityProductionAdapterReadinessResult = {
  status: UnityProductionAdapterReadinessStatus;
  can_execute: false | true;
  reason: string;
  output: UnityProductionAdapterOutput;
};

export type UnityValidationExecutionInput = UnityProductionAdapterInput;

function hasCompletedReview(reviewState: UnityProductionAdapterReviewState): boolean {
  return Boolean(reviewState.review_package_id && reviewState.review_completed_at);
}

function hasApproval(reviewState: UnityProductionAdapterReviewState): boolean {
  return Boolean(reviewState.approved_by_operator && reviewState.operator_approval_id);
}

function isValidationOnlyPacket(planningPacket: UnityProductionPlanningPacket): boolean {
  return planningPacket.request_types.length === 1 && planningPacket.request_types[0] === "validation_playtest_request";
}

function buildValidationChecklist(planningPacket: UnityProductionPlanningPacket): string[] {
  return [
    "Confirm reviewed Unity validation scope remains read-only.",
    "Confirm no scene, prefab, asset, or script mutation is permitted.",
    ...planningPacket.required_review_artifacts.map((artifact) => `Review artifact present: ${artifact}.`),
    ...planningPacket.required_approval_gates.map((gate) => `Approval gate satisfied: ${gate}.`),
  ];
}

function buildBlockedValidationResult(
  input: UnityValidationExecutionInput,
  blockedReason: string,
  recommendedNextOperatorAction: string,
): UnityValidationExecutionResult {
  return {
    request_id: input.adapter_request_id,
    domain: "Unity",
    request_type: "validation_playtest_request",
    execution_mode: "read_only_validation_preview",
    review_approval_id: input.review_state.review_package_id,
    review_approval_status: hasCompletedReview(input.review_state) ? "approved" : "missing",
    operator_approval_id: input.review_state.operator_approval_id,
    operator_approval_status: hasApproval(input.review_state) ? "approved" : "missing",
    executed: false,
    blocked_reason: blockedReason,
    validation_checklist: buildValidationChecklist(input.planning_packet),
    delivery_summary: "Unity validation preview was not executed. Adapter remains non-mutating and review-gated.",
    recommended_next_operator_action: recommendedNextOperatorAction,
    artifact_label: "adapter_level_validation_preview",
    mutating: false,
  };
}

export function mapUnityRequestTypeToAdapterAction(requestType: UnityProductionRequestType): UnityProductionAdapterAction {
  switch (requestType) {
    case "scene_request":
      return "scene_plan_review";
    case "prefab_request":
      return "prefab_plan_review";
    case "component_script_request":
      return "component_script_plan_review";
    case "validation_playtest_request":
      return "validation_playtest_review";
    case "asset_import_request":
      return "asset_import_review";
    default:
      return "scene_plan_review";
  }
}

export function createUnityProductionAdapterOutput(input: UnityProductionAdapterInput): UnityProductionAdapterOutput {
  const plannedActions = input.requested_actions.length > 0
    ? input.requested_actions
    : input.planning_packet.request_types.map(mapUnityRequestTypeToAdapterAction);

  const nextStep = !hasCompletedReview(input.review_state)
    ? "request_review"
    : !hasApproval(input.review_state)
      ? "request_operator_approval"
      : "ready_for_reviewed_execution";

  return {
    request_types: input.planning_packet.request_types,
    execution_mode: "reviewed_execution_only",
    review_artifacts: input.planning_packet.required_review_artifacts,
    approval_gates: input.planning_packet.required_approval_gates,
    planned_adapter_actions: plannedActions,
    next_step: nextStep,
  };
}

export function evaluateUnityProductionAdapterReadiness(
  input: UnityProductionAdapterInput,
): UnityProductionAdapterReadinessResult {
  const output = createUnityProductionAdapterOutput(input);

  if (!hasCompletedReview(input.review_state)) {
    return {
      status: "blocked_missing_review",
      can_execute: false,
      reason: "Unity adapter execution stays blocked until a review package is completed.",
      output,
    };
  }

  if (!hasApproval(input.review_state)) {
    return {
      status: "blocked_missing_approval",
      can_execute: false,
      reason: "Unity adapter execution stays blocked until operator approval is recorded.",
      output,
    };
  }

  return {
    status: "ready_for_reviewed_execution",
    can_execute: true,
    reason: "Unity adapter design has the required review and approval metadata for a future reviewed execution path.",
    output,
  };
}

export function executeReviewedUnityValidation(
  input: UnityValidationExecutionInput,
): UnityValidationExecutionResult {
  if (!isValidationOnlyPacket(input.planning_packet)) {
    return buildBlockedValidationResult(
      input,
      "Only validation_playtest_request is executable through the first Unity reviewed execution path.",
      "Narrow the Unity packet to a validation/playtest-only request before invoking the execution adapter.",
    );
  }

  if (!hasCompletedReview(input.review_state)) {
    return buildBlockedValidationResult(
      input,
      "Unity validation execution is blocked until review approval is recorded.",
      "Complete the Unity review package before requesting validation execution.",
    );
  }

  if (!hasApproval(input.review_state)) {
    return buildBlockedValidationResult(
      input,
      "Unity validation execution is blocked until operator approval is recorded.",
      "Record explicit operator approval before invoking the Unity validation adapter.",
    );
  }

  return {
    request_id: input.adapter_request_id,
    domain: "Unity",
    request_type: "validation_playtest_request",
    execution_mode: "read_only_validation_preview",
    review_approval_id: input.review_state.review_package_id,
    review_approval_status: "approved",
    operator_approval_id: input.review_state.operator_approval_id,
    operator_approval_status: "approved",
    executed: true,
    blocked_reason: null,
    validation_checklist: buildValidationChecklist(input.planning_packet),
    delivery_summary: "Adapter-level Unity validation preview completed. No Unity runtime bridge was invoked and no project mutation was performed. Review evidence and delivery notes are ready for operator inspection.",
    recommended_next_operator_action: "Review the validation preview evidence and decide whether to keep the request in delivery prep or connect a future real Unity runtime bridge.",
    artifact_label: "adapter_level_validation_preview",
    mutating: false,
  };
}