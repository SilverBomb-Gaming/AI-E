export type SafeExecutionOperationKind =
  | "planning_only"
  | "read_only_repo_inspection"
  | "local_browser_state"
  | "repo_file_mutation"
  | "unity_scene_mutation"
  | "shell_command"
  | "external_agent_handoff"
  | "destructive_git_operation"
  | "future_hands_off_autonomy";

export type SafeExecutionDecisionStatus =
  | "allowed_planning_only"
  | "allowed_read_only"
  | "allowed_local_browser_state"
  | "blocked_pending_operator_approval"
  | "blocked_missing_rollback_boundary"
  | "blocked_destructive_operation"
  | "blocked_future_only"
  | "eligible_for_supervised_execution";

export type SafeExecutionAuthority =
  | "planning_only"
  | "read_only"
  | "local_browser_only"
  | "requires_supervised_approval"
  | "blocked";

export type SafeExecutionApproval = {
  approved: boolean;
  approvedBy?: string;
  approvedAt?: string;
  approvalScope: string;
};

export type SafeExecutionRollbackBoundary = {
  available: boolean;
  summary: string;
  rollbackCommand?: string;
};

export type SafeExecutionGuardrailRequest = {
  operationKind: SafeExecutionOperationKind;
  requestedAction: string;
  targetPaths?: string[];
  operatorApproval?: SafeExecutionApproval;
  rollbackBoundary?: SafeExecutionRollbackBoundary;
  destructiveIntent?: boolean;
};

export type SafeExecutionGuardrailDecision = {
  guardrailLayerId: "SAFE_EXECUTION_GUARDRAILS_PHASE1";
  decisionStatus: SafeExecutionDecisionStatus;
  executionAuthority: SafeExecutionAuthority;
  operationKind: SafeExecutionOperationKind;
  approvalRequired: boolean;
  operatorApprovalPresent: boolean;
  rollbackBoundaryRequired: boolean;
  rollbackBoundaryPresent: boolean;
  canProceed: boolean;
  canMutate: boolean;
  blocked: boolean;
  blockedOperationReport: string;
  truthfulnessWarnings: string[];
};

export type SafeExecutionGuardrailInventory = {
  layerId: "SAFE_EXECUTION_GUARDRAILS_PHASE1";
  status: "real";
  allowedWithoutApproval: SafeExecutionOperationKind[];
  requiresApprovalAndRollback: SafeExecutionOperationKind[];
  alwaysBlocked: SafeExecutionOperationKind[];
  truthfulnessBoundary: string;
};

const allowedWithoutApproval = new Set<SafeExecutionOperationKind>([
  "planning_only",
  "read_only_repo_inspection",
  "local_browser_state",
]);

const requiresApprovalAndRollback = new Set<SafeExecutionOperationKind>([
  "repo_file_mutation",
  "unity_scene_mutation",
  "shell_command",
  "external_agent_handoff",
]);

const alwaysBlocked = new Set<SafeExecutionOperationKind>([
  "destructive_git_operation",
  "future_hands_off_autonomy",
]);

function baseDecision(request: SafeExecutionGuardrailRequest): Omit<SafeExecutionGuardrailDecision, "decisionStatus" | "executionAuthority" | "canProceed" | "canMutate" | "blocked" | "blockedOperationReport"> {
  const operatorApprovalPresent = request.operatorApproval?.approved === true;
  const rollbackBoundaryPresent = request.rollbackBoundary?.available === true;

  return {
    guardrailLayerId: "SAFE_EXECUTION_GUARDRAILS_PHASE1",
    operationKind: request.operationKind,
    approvalRequired: requiresApprovalAndRollback.has(request.operationKind) || alwaysBlocked.has(request.operationKind) || request.destructiveIntent === true,
    operatorApprovalPresent,
    rollbackBoundaryRequired: requiresApprovalAndRollback.has(request.operationKind),
    rollbackBoundaryPresent,
    truthfulnessWarnings: [
      "This guardrail evaluates whether an action may proceed; it does not execute the action.",
      "Mutating work remains supervised and must not be described as hands-off autonomy.",
      "Project or Unity changes may only be reported after a separate execution path actually performs and verifies them.",
    ],
  };
}

function decisionReport(request: SafeExecutionGuardrailRequest, reason: string): string {
  const targetText = request.targetPaths?.length ? ` Targets: ${request.targetPaths.join(", ")}.` : "";
  return `${request.operationKind} blocked for '${request.requestedAction}'. ${reason}.${targetText}`;
}

export function evaluateSafeExecutionGuardrail(request: SafeExecutionGuardrailRequest): SafeExecutionGuardrailDecision {
  const base = baseDecision(request);

  if (request.operationKind === "future_hands_off_autonomy") {
    return {
      ...base,
      decisionStatus: "blocked_future_only",
      executionAuthority: "blocked",
      canProceed: false,
      canMutate: false,
      blocked: true,
      blockedOperationReport: decisionReport(request, "Full hands-off operation is future-only and unavailable in Phase 1"),
    };
  }

  if (request.destructiveIntent === true || request.operationKind === "destructive_git_operation") {
    return {
      ...base,
      decisionStatus: "blocked_destructive_operation",
      executionAuthority: "blocked",
      canProceed: false,
      canMutate: false,
      blocked: true,
      blockedOperationReport: decisionReport(request, "Destructive operations are blocked by the safe execution guardrail"),
    };
  }

  if (request.operationKind === "planning_only") {
    return {
      ...base,
      decisionStatus: "allowed_planning_only",
      executionAuthority: "planning_only",
      canProceed: true,
      canMutate: false,
      blocked: false,
      blockedOperationReport: "No operation blocked; planning-only work has no mutation authority.",
    };
  }

  if (request.operationKind === "read_only_repo_inspection") {
    return {
      ...base,
      decisionStatus: "allowed_read_only",
      executionAuthority: "read_only",
      canProceed: true,
      canMutate: false,
      blocked: false,
      blockedOperationReport: "No operation blocked; read-only inspection has no mutation authority.",
    };
  }

  if (request.operationKind === "local_browser_state") {
    return {
      ...base,
      decisionStatus: "allowed_local_browser_state",
      executionAuthority: "local_browser_only",
      canProceed: true,
      canMutate: false,
      blocked: false,
      blockedOperationReport: "No operation blocked; state is limited to the current browser profile.",
    };
  }

  if (requiresApprovalAndRollback.has(request.operationKind) && !base.operatorApprovalPresent) {
    return {
      ...base,
      decisionStatus: "blocked_pending_operator_approval",
      executionAuthority: "requires_supervised_approval",
      canProceed: false,
      canMutate: false,
      blocked: true,
      blockedOperationReport: decisionReport(request, "Explicit operator approval is required before this mutating or delegated action can proceed"),
    };
  }

  if (requiresApprovalAndRollback.has(request.operationKind) && !base.rollbackBoundaryPresent) {
    return {
      ...base,
      decisionStatus: "blocked_missing_rollback_boundary",
      executionAuthority: "requires_supervised_approval",
      canProceed: false,
      canMutate: false,
      blocked: true,
      blockedOperationReport: decisionReport(request, "A rollback boundary is required before this approved action can proceed"),
    };
  }

  return {
    ...base,
    decisionStatus: "eligible_for_supervised_execution",
    executionAuthority: "requires_supervised_approval",
    canProceed: true,
    canMutate: true,
    blocked: false,
    blockedOperationReport: "No operation blocked by the guardrail; a separate supervised execution path must still perform and verify any mutation.",
  };
}

export function buildSafeExecutionGuardrailInventory(): SafeExecutionGuardrailInventory {
  return {
    layerId: "SAFE_EXECUTION_GUARDRAILS_PHASE1",
    status: "real",
    allowedWithoutApproval: [...allowedWithoutApproval],
    requiresApprovalAndRollback: [...requiresApprovalAndRollback],
    alwaysBlocked: [...alwaysBlocked],
    truthfulnessBoundary: "Safe execution guardrails classify approval and rollback readiness only; they do not execute repo, Unity, shell, or agent work.",
  };
}