import type { GameDevChatRoute } from "./gameDevChatTypes";

export type SupervisedExecutionRouteType =
  | "READ_ONLY_INSPECTION"
  | "PATCH_PREPARATION"
  | "PATCH_APPLICATION_REQUIRES_APPROVAL"
  | "VALIDATION_ONLY"
  | "CHECKPOINT_RESTORE"
  | "BUILD_VERIFICATION"
  | "CONVERSATIONAL_ONLY"
  | "BLOCKED_CAPABILITY";

export type RuntimeOwnershipLevel = "chat_only" | "contract_prepared" | "approval_required" | "trusted_runtime_required" | "external_dependency_blocked";
export type ExecutionContractStatus = "not_execution_candidate" | "candidate_prepared" | "blocked_requires_approval" | "blocked_external_dependency" | "blocked_unavailable";

export type SupervisedExecutionRouteDefinition = {
  routeType: SupervisedExecutionRouteType;
  allowedMutationScope: string;
  approvalRequirement: string;
  validationRequirement: string;
  persistenceRequirement: string;
  externalDependencyRequirement: string;
  runtimeOwnershipLevel: RuntimeOwnershipLevel;
};

export type SupervisedExecutionContract = {
  executionId: string;
  workflowId: string;
  routeType: SupervisedExecutionRouteType;
  requiresApproval: boolean;
  approvalStatus: "not_required" | "pending" | "blocked_missing_approval" | "blocked_external_dependency";
  allowedPaths: string[];
  mutationAllowed: boolean;
  validationRequired: boolean;
  executionStatus: ExecutionContractStatus;
  rollbackAvailable: boolean;
  externalDependency: string | false;
  truthfulCapabilityBoundary: string;
  runtimeOwnershipLevel: RuntimeOwnershipLevel;
};

export type SupervisedExecutionRouteSelection = {
  phaseId: "SUPERVISED_REAL_EXECUTION_ROUTES_PHASE1_FOUNDATION";
  routeType: SupervisedExecutionRouteType;
  label: string;
  reason: string;
  definition: SupervisedExecutionRouteDefinition;
  contract: SupervisedExecutionContract;
};

type RouteSelectionInput = {
  message: string;
  route: GameDevChatRoute;
  subsystem?: "conversation" | "scoped_execution" | "operator_work_cycle" | "durable_runtime" | "meaningful_long_run" | "development_campaign";
};

const routeDefinitions: Record<SupervisedExecutionRouteType, SupervisedExecutionRouteDefinition> = {
  READ_ONLY_INSPECTION: {
    routeType: "READ_ONLY_INSPECTION",
    allowedMutationScope: "none; inspection routes may read approved project metadata only when a trusted route exists",
    approvalRequirement: "no mutation approval required for planning; trusted read-only runtime approval may be required before real inspection",
    validationRequirement: "inspection evidence must identify source, timestamp, and whether it came from trusted runtime output",
    persistenceRequirement: "optional checkpoint summary only; no durable execution lifecycle is implied",
    externalDependencyRequirement: "trusted read-only repo route required before claiming actual filesystem inspection",
    runtimeOwnershipLevel: "contract_prepared",
  },
  PATCH_PREPARATION: {
    routeType: "PATCH_PREPARATION",
    allowedMutationScope: "patch draft and execution contract only; no repo files may be changed by chat preparation",
    approvalRequirement: "operator review is required before any prepared patch can become an application request",
    validationRequirement: "contract must name validation commands or manual checks before patch application",
    persistenceRequirement: "checkpoint-aware plan should record target paths, rollback notes, and validation intent",
    externalDependencyRequirement: "approved patch runtime required before any real file write",
    runtimeOwnershipLevel: "contract_prepared",
  },
  PATCH_APPLICATION_REQUIRES_APPROVAL: {
    routeType: "PATCH_APPLICATION_REQUIRES_APPROVAL",
    allowedMutationScope: "only explicitly approved paths after trusted runtime re-check; no automatic broad repo mutation",
    approvalRequirement: "explicit operator approval is mandatory before mutation can be attempted",
    validationRequirement: "post-application validation is mandatory and must be captured by the trusted runtime",
    persistenceRequirement: "rollback snapshot and lifecycle checkpoint are mandatory before application",
    externalDependencyRequirement: "trusted scoped patch runtime is required; chat cannot apply the patch directly",
    runtimeOwnershipLevel: "approval_required",
  },
  VALIDATION_ONLY: {
    routeType: "VALIDATION_ONLY",
    allowedMutationScope: "none except approved generated validation artifacts, if any",
    approvalRequirement: "operator approval is required before validation commands or external validators run",
    validationRequirement: "validation route must capture command, working directory, exit code, stdout/stderr summary, and timing",
    persistenceRequirement: "validation result should be attached to the active workflow checkpoint",
    externalDependencyRequirement: "trusted runtime, local dev server, or Unity bridge required depending on target",
    runtimeOwnershipLevel: "trusted_runtime_required",
  },
  CHECKPOINT_RESTORE: {
    routeType: "CHECKPOINT_RESTORE",
    allowedMutationScope: "only approved checkpoint restore files after trusted rollback validation",
    approvalRequirement: "operator approval is required before restoring or mutating state from a checkpoint",
    validationRequirement: "restore must report restored checkpoint id, affected paths, and post-restore validation evidence",
    persistenceRequirement: "durable checkpoint record is mandatory",
    externalDependencyRequirement: "trusted durable runtime store required before claiming a real restore",
    runtimeOwnershipLevel: "trusted_runtime_required",
  },
  BUILD_VERIFICATION: {
    routeType: "BUILD_VERIFICATION",
    allowedMutationScope: "build outputs only; source mutation remains blocked unless separately approved",
    approvalRequirement: "operator approval is required before starting the build route",
    validationRequirement: "build result must capture exit code, timing, and generated-output truthfulness",
    persistenceRequirement: "build report should be linked to the workflow checkpoint",
    externalDependencyRequirement: "trusted server runtime required for real build execution",
    runtimeOwnershipLevel: "trusted_runtime_required",
  },
  CONVERSATIONAL_ONLY: {
    routeType: "CONVERSATIONAL_ONLY",
    allowedMutationScope: "none",
    approvalRequirement: "not required because this is chat-only reasoning",
    validationRequirement: "advisory only; no runtime validation occurred",
    persistenceRequirement: "session context only",
    externalDependencyRequirement: "none for chat-only response",
    runtimeOwnershipLevel: "chat_only",
  },
  BLOCKED_CAPABILITY: {
    routeType: "BLOCKED_CAPABILITY",
    allowedMutationScope: "none",
    approvalRequirement: "no valid approval path exists in the current chat surface",
    validationRequirement: "blocked route must explain missing trusted runtime or external bridge",
    persistenceRequirement: "blocked reason may be recorded in session context only",
    externalDependencyRequirement: "external trusted bridge or future runtime capability required",
    runtimeOwnershipLevel: "external_dependency_blocked",
  },
};

function stableId(prefix: string, message: string, routeType: SupervisedExecutionRouteType): string {
  const source = `${routeType}:${message.toLowerCase()}`;
  const hash = Math.abs(Array.from(source).reduce((value, char) => ((value << 5) - value) + char.charCodeAt(0), 0)).toString(16);
  return `${prefix}-${hash}`;
}

function inferAllowedPaths(message: string, routeType: SupervisedExecutionRouteType): string[] {
  const lower = message.toLowerCase();
  if (routeType === "READ_ONLY_INSPECTION") {
    if (/inventory/.test(lower)) {
      return ["repo inventory-related files after trusted read-only route approval"];
    }
    return ["repo metadata or named subsystem files after trusted read-only route approval"];
  }
  if (routeType === "PATCH_PREPARATION" || routeType === "PATCH_APPLICATION_REQUIRES_APPROVAL") {
    if (/movement|jump|player/.test(lower)) {
      return ["movement-related files explicitly approved by the operator"];
    }
    return ["operator-approved target files only"];
  }
  if (routeType === "BUILD_VERIFICATION") {
    return ["repo-root/web build outputs"];
  }
  if (routeType === "CHECKPOINT_RESTORE") {
    return ["approved checkpoint snapshot paths only"];
  }
  return [];
}

function routeTypeFor(input: RouteSelectionInput): { routeType: SupervisedExecutionRouteType; reason: string } {
  const lower = input.message.toLowerCase();

  if (/run unity|open unity|control unity|playtest in unity|unity editor|unity.*validate physics|validate physics.*unity/.test(lower)) {
    return { routeType: "BLOCKED_CAPABILITY", reason: "Direct Unity runtime validation requires a trusted Unity bridge that this chat surface does not own." };
  }
  if (/without approval|automatically|directly/.test(lower) && /apply|patch|modify|edit|execute repo work|repo work/.test(lower)) {
    return { routeType: "PATCH_APPLICATION_REQUIRES_APPROVAL", reason: "The request asks for mutation or execution without the required approval boundary." };
  }
  if (/apply .*patch|patch.*apply/.test(lower)) {
    return { routeType: "PATCH_APPLICATION_REQUIRES_APPROVAL", reason: "Patch application is a mutation route and must stay approval-gated." };
  }
  if (/prepare .*patch|safe .*patch|patch preparation|movement patch/.test(lower)) {
    return { routeType: "PATCH_PREPARATION", reason: "The request asks AI-E to prepare a bounded patch contract, not apply it." };
  }
  if (/inspect|review|read|look at|inventory system|interaction system/.test(lower)) {
    return { routeType: "READ_ONLY_INSPECTION", reason: "The request maps to read-only subsystem inspection with no mutation permission." };
  }
  if (/restore .*checkpoint|checkpoint restore/.test(lower) || input.route.conversationMode === "DURABLE_RUNTIME_CONTINUITY_REQUEST") {
    return { routeType: "CHECKPOINT_RESTORE", reason: "The request maps to checkpoint-aware runtime continuity planning." };
  }
  if (/build|compile/.test(lower)) {
    return { routeType: "BUILD_VERIFICATION", reason: "The request maps to build verification through an approved trusted runtime route." };
  }
  if (/run .*test|execute .*test|validate|validation/.test(lower)) {
    return { routeType: "VALIDATION_ONLY", reason: "The request maps to validation-only execution planning." };
  }
  if (input.subsystem === "operator_work_cycle" || input.subsystem === "scoped_execution" || input.route.conversationMode === "OPERATOR_WORK_CYCLE_REQUEST" || input.route.conversationMode === "SCOPED_EXECUTION_REQUEST") {
    return { routeType: "PATCH_APPLICATION_REQUIRES_APPROVAL", reason: "The existing supervised runtime route is approval-gated and mutation-limited." };
  }
  if (input.route.safetyStatus === "BLOCKED") {
    return { routeType: "BLOCKED_CAPABILITY", reason: "The route is blocked by the existing safety classifier." };
  }
  return { routeType: "CONVERSATIONAL_ONLY", reason: "The request does not require a supervised execution route." };
}

function contractStatusFor(routeType: SupervisedExecutionRouteType, definition: SupervisedExecutionRouteDefinition, message: string): ExecutionContractStatus {
  const lower = message.toLowerCase();
  if (routeType === "CONVERSATIONAL_ONLY") {
    return "not_execution_candidate";
  }
  if (routeType === "BLOCKED_CAPABILITY") {
    return "blocked_external_dependency";
  }
  if (routeType === "PATCH_APPLICATION_REQUIRES_APPROVAL" && /without approval|automatically|directly/.test(lower)) {
    return "blocked_requires_approval";
  }
  if (definition.runtimeOwnershipLevel === "trusted_runtime_required") {
    return "candidate_prepared";
  }
  return "candidate_prepared";
}

function approvalStatusFor(status: ExecutionContractStatus, requiresApproval: boolean): SupervisedExecutionContract["approvalStatus"] {
  if (status === "blocked_external_dependency") {
    return "blocked_external_dependency";
  }
  if (status === "blocked_requires_approval") {
    return "blocked_missing_approval";
  }
  return requiresApproval ? "pending" : "not_required";
}

export function selectSupervisedExecutionRoute(input: RouteSelectionInput): SupervisedExecutionRouteSelection {
  const { routeType, reason } = routeTypeFor(input);
  const definition = routeDefinitions[routeType];
  const requiresApproval = /required|mandatory|approval-gated/.test(definition.approvalRequirement) || ["PATCH_APPLICATION_REQUIRES_APPROVAL", "VALIDATION_ONLY", "CHECKPOINT_RESTORE", "BUILD_VERIFICATION"].includes(routeType);
  const executionStatus = contractStatusFor(routeType, definition, input.message);
  const externalDependency = routeType === "CONVERSATIONAL_ONLY" ? false : definition.externalDependencyRequirement === "none for chat-only response" ? false : definition.externalDependencyRequirement;
  const contract: SupervisedExecutionContract = {
    executionId: stableId("exec", input.message, routeType),
    workflowId: stableId("workflow", input.message, routeType),
    routeType,
    requiresApproval,
    approvalStatus: approvalStatusFor(executionStatus, requiresApproval),
    allowedPaths: inferAllowedPaths(input.message, routeType),
    mutationAllowed: false,
    validationRequired: ["PATCH_APPLICATION_REQUIRES_APPROVAL", "VALIDATION_ONLY", "BUILD_VERIFICATION", "CHECKPOINT_RESTORE"].includes(routeType),
    executionStatus,
    rollbackAvailable: ["PATCH_APPLICATION_REQUIRES_APPROVAL", "CHECKPOINT_RESTORE", "BUILD_VERIFICATION"].includes(routeType),
    externalDependency,
    truthfulCapabilityBoundary: routeType === "CONVERSATIONAL_ONLY"
      ? "This is conversational reasoning only; no execution route was prepared."
      : "This is supervised execution route architecture only; no mutation, command, Unity run, or validation occurred from chat.",
    runtimeOwnershipLevel: definition.runtimeOwnershipLevel,
  };

  return {
    phaseId: "SUPERVISED_REAL_EXECUTION_ROUTES_PHASE1_FOUNDATION",
    routeType,
    label: routeType.toLowerCase().replace(/_/g, " "),
    reason,
    definition,
    contract,
  };
}