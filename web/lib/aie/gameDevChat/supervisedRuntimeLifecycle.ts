import type { SupervisedExecutionRouteSelection, SupervisedExecutionRouteType } from "./supervisedExecutionRoutes";

export type RuntimeLifecycleStage =
  | "INTAKE_CLASSIFIED"
  | "CONTRACT_PREPARED"
  | "AWAITING_APPROVAL"
  | "APPROVAL_BLOCKED"
  | "TRUSTED_RUNTIME_REQUIRED"
  | "MUTATION_NOT_STARTED"
  | "VALIDATION_NOT_STARTED"
  | "CHECKPOINT_NOT_WRITTEN"
  | "EXTERNAL_DEPENDENCY_BLOCKED"
  | "CONVERSATIONAL_ONLY";

export type RuntimeLifecycleStatus = "planned_only" | "approval_required" | "blocked" | "external_dependency" | "not_execution_candidate";

export type SupervisedRuntimeLifecycle = {
  phaseId: "RUNTIME_LIFECYCLE_ARCHITECTURE_PHASE1";
  currentStage: RuntimeLifecycleStage;
  lifecycleStatus: RuntimeLifecycleStatus;
  nextGate: string;
  allowedTransitions: RuntimeLifecycleStage[];
  approvalGate: string;
  mutationGate: string;
  validationGate: string;
  checkpointPolicy: string;
  persistencePlan: string;
  rollbackPolicy: string;
  retryPolicy: string;
  terminalCondition: string;
  truthfulnessBoundary: string;
};

function lifecycleStageFor(route: SupervisedExecutionRouteSelection): RuntimeLifecycleStage {
  if (route.routeType === "CONVERSATIONAL_ONLY") {
    return "CONVERSATIONAL_ONLY";
  }
  if (route.contract.approvalStatus === "blocked_external_dependency") {
    return "EXTERNAL_DEPENDENCY_BLOCKED";
  }
  if (route.contract.approvalStatus === "blocked_missing_approval") {
    return "APPROVAL_BLOCKED";
  }
  if (route.contract.requiresApproval) {
    return "AWAITING_APPROVAL";
  }
  return "CONTRACT_PREPARED";
}

function lifecycleStatusFor(stage: RuntimeLifecycleStage): RuntimeLifecycleStatus {
  if (stage === "CONVERSATIONAL_ONLY") {
    return "not_execution_candidate";
  }
  if (stage === "APPROVAL_BLOCKED") {
    return "blocked";
  }
  if (stage === "EXTERNAL_DEPENDENCY_BLOCKED") {
    return "external_dependency";
  }
  if (stage === "AWAITING_APPROVAL") {
    return "approval_required";
  }
  return "planned_only";
}

function transitionsFor(routeType: SupervisedExecutionRouteType, stage: RuntimeLifecycleStage): RuntimeLifecycleStage[] {
  if (stage === "CONVERSATIONAL_ONLY" || stage === "EXTERNAL_DEPENDENCY_BLOCKED") {
    return [];
  }
  if (stage === "APPROVAL_BLOCKED") {
    return ["AWAITING_APPROVAL"];
  }
  if (routeType === "READ_ONLY_INSPECTION" || routeType === "PATCH_PREPARATION") {
    return ["CONTRACT_PREPARED", "CHECKPOINT_NOT_WRITTEN"];
  }
  if (routeType === "VALIDATION_ONLY" || routeType === "BUILD_VERIFICATION") {
    return ["AWAITING_APPROVAL", "TRUSTED_RUNTIME_REQUIRED", "VALIDATION_NOT_STARTED", "CHECKPOINT_NOT_WRITTEN"];
  }
  return ["AWAITING_APPROVAL", "TRUSTED_RUNTIME_REQUIRED", "MUTATION_NOT_STARTED", "VALIDATION_NOT_STARTED", "CHECKPOINT_NOT_WRITTEN"];
}

function nextGateFor(stage: RuntimeLifecycleStage, route: SupervisedExecutionRouteSelection): string {
  if (stage === "CONVERSATIONAL_ONLY") {
    return "No runtime gate: this is chat-only reasoning.";
  }
  if (stage === "EXTERNAL_DEPENDENCY_BLOCKED") {
    return "External bridge or trusted runtime must exist before lifecycle can advance.";
  }
  if (stage === "APPROVAL_BLOCKED") {
    return "Operator approval is missing; mutation and runtime dispatch stay blocked.";
  }
  if (stage === "AWAITING_APPROVAL") {
    return "Operator must approve the contract before trusted runtime dispatch.";
  }
  if (route.routeType === "READ_ONLY_INSPECTION" || route.routeType === "PATCH_PREPARATION") {
    return "Operator review can promote this plan into an approved runtime route later.";
  }
  return "Trusted runtime dispatch is the next gate, but no dispatch occurred from chat.";
}

export function buildSupervisedRuntimeLifecycle(route: SupervisedExecutionRouteSelection): SupervisedRuntimeLifecycle {
  const currentStage = lifecycleStageFor(route);
  const lifecycleStatus = lifecycleStatusFor(currentStage);
  const routeLabel = route.routeType.toLowerCase().replace(/_/g, " ");

  return {
    phaseId: "RUNTIME_LIFECYCLE_ARCHITECTURE_PHASE1",
    currentStage,
    lifecycleStatus,
    nextGate: nextGateFor(currentStage, route),
    allowedTransitions: transitionsFor(route.routeType, currentStage),
    approvalGate: route.contract.requiresApproval
      ? "Explicit operator approval is required before trusted runtime dispatch."
      : "No mutation approval is required for this planning-only contract, but real runtime inspection may still require a trusted route.",
    mutationGate: route.contract.mutationAllowed
      ? "Mutation may only occur through approved scoped runtime execution."
      : "Mutation is not allowed at the current lifecycle stage.",
    validationGate: route.contract.validationRequired
      ? "Validation is required after trusted runtime action and must record evidence before completion."
      : "Validation is advisory only until this becomes an approved runtime route.",
    checkpointPolicy: route.contract.rollbackAvailable
      ? "Checkpoint and rollback snapshot must exist before mutation or restore proceeds."
      : "Checkpoint is optional summary metadata; no rollback snapshot is available yet.",
    persistencePlan: route.routeType === "CONVERSATIONAL_ONLY"
      ? "Session context only; no lifecycle persistence required."
      : `Persist ${routeLabel} contract metadata, approval state, validation intent, and terminal truthfulness label when a trusted runtime later acts.`,
    rollbackPolicy: route.contract.rollbackAvailable
      ? "Rollback is architecture-required before mutating routes can advance beyond approval."
      : "Rollback is not available because no mutation-capable lifecycle stage has started.",
    retryPolicy: "Retry is supervised only; no automatic retry or unattended loop is authorized by this lifecycle architecture.",
    terminalCondition: route.contract.executionStatus.startsWith("blocked")
      ? "Terminal for now: blocked until approval or external dependency changes."
      : "Terminal state can be reached only after trusted runtime evidence or explicit planning-only closeout.",
    truthfulnessBoundary: "Lifecycle metadata is architectural planning. It does not prove mutation, validation, checkpoint persistence, command execution, Unity execution, or supervised_real by itself.",
  };
}