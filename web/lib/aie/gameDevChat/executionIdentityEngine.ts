import type { GameDevChatRoute } from "./gameDevChatTypes";

export type ExecutionOwnershipKind = "bounded_internal_workflow" | "blocked_capability" | "external_dependency";
export type ExecutionWorkflowType = "chat_reasoning" | "supervised_repo_workflow" | "scoped_execution_request" | "durable_runtime_request" | "long_run_request" | "execution_brief" | "blocked_unity_runtime" | "external_tooling_status";

export type ExecutionOwnershipMetadata = {
  phaseId: "INTERNAL_EXECUTION_AND_OPERATOR_OWNERSHIP_PHASE1";
  kind: ExecutionOwnershipKind;
  ownerLabel: "AI-E Supervised Runtime";
  workflowType: ExecutionWorkflowType;
  approvalRequirement: string;
  mutationScope: string;
  validationScope: string;
  externalToolingRequired: string[];
  dependencyExplanation: string;
  operatorFacingSummary: string;
};

type ExecutionOwnershipInput = {
  message: string;
  route: GameDevChatRoute;
  subsystem?: "conversation" | "scoped_execution" | "operator_work_cycle" | "durable_runtime" | "meaningful_long_run" | "development_campaign";
  runtimeIntrospectionKind?: "capability_status_query" | "external_dependency_query" | "blocked_capability_query" | "general_runtime_query";
};

function workflowTypeFor(input: ExecutionOwnershipInput): ExecutionWorkflowType {
  if (input.subsystem === "operator_work_cycle" || input.route.conversationMode === "OPERATOR_WORK_CYCLE_REQUEST") {
    return "supervised_repo_workflow";
  }
  if (input.subsystem === "scoped_execution" || input.route.conversationMode === "SCOPED_EXECUTION_REQUEST") {
    return "scoped_execution_request";
  }
  if (input.subsystem === "durable_runtime" || input.route.conversationMode === "DURABLE_RUNTIME_CONTINUITY_REQUEST") {
    return "durable_runtime_request";
  }
  if (input.subsystem === "meaningful_long_run" || input.route.conversationMode === "MEANINGFUL_LONG_RUN_REQUEST") {
    return "long_run_request";
  }
  if (input.route.mode === "CODEX_HANDOFF_REQUEST" || input.route.taskMode === "CODEX_HANDOFF_REQUEST") {
    return "execution_brief";
  }
  if (/unity editor|run unity|open unity|control unity|playtest in unity/i.test(input.message) || input.route.safetyStatus === "BLOCKED") {
    return "blocked_unity_runtime";
  }
  if (input.runtimeIntrospectionKind === "external_dependency_query") {
    return "external_tooling_status";
  }
  return "chat_reasoning";
}

function ownershipKindFor(workflowType: ExecutionWorkflowType, runtimeIntrospectionKind?: ExecutionOwnershipInput["runtimeIntrospectionKind"]): ExecutionOwnershipKind {
  if (workflowType === "blocked_unity_runtime") {
    return "blocked_capability";
  }
  if (workflowType === "external_tooling_status" || runtimeIntrospectionKind === "external_dependency_query") {
    return "external_dependency";
  }
  return "bounded_internal_workflow";
}

export function buildExecutionOwnershipMetadata(input: ExecutionOwnershipInput): ExecutionOwnershipMetadata {
  const workflowType = workflowTypeFor(input);
  const kind = ownershipKindFor(workflowType, input.runtimeIntrospectionKind);
  const base = {
    phaseId: "INTERNAL_EXECUTION_AND_OPERATOR_OWNERSHIP_PHASE1" as const,
    kind,
    ownerLabel: "AI-E Supervised Runtime" as const,
    workflowType,
  };

  if (workflowType === "supervised_repo_workflow") {
    return {
      ...base,
      approvalRequirement: "Explicit operator approval is required before the trusted AI-E runtime may launch the bounded workflow.",
      mutationScope: "Only approved workflow artifacts and scoped mutation lanes may change; unrestricted repo edits remain blocked.",
      validationScope: "Validation is limited to allowlisted commands and runtime-captured evidence.",
      externalToolingRequired: [],
      dependencyExplanation: "AI-E owns the prepared supervised workflow, but real mutation still depends on the trusted server runtime and operator approval.",
      operatorFacingSummary: "AI-E prepared a bounded supervised repo workflow for approval; no hidden execution occurred from chat.",
    };
  }

  if (workflowType === "scoped_execution_request") {
    return {
      ...base,
      approvalRequirement: "Explicit operator approval and allowlist re-check are required before execution.",
      mutationScope: "Command effects are constrained by approved working directories, timeout, risk level, and rollback boundary.",
      validationScope: "The trusted runtime must report stdout, stderr, exit code, timing, and truthfulness label.",
      externalToolingRequired: [],
      dependencyExplanation: "AI-E owns request preparation and policy metadata; the trusted server runtime owns any real command dispatch.",
      operatorFacingSummary: "AI-E prepared a scoped execution request that can run only through the approved supervised runtime.",
    };
  }

  if (workflowType === "blocked_unity_runtime") {
    return {
      ...base,
      approvalRequirement: "No approval path is available yet because direct Unity Editor control is not implemented here.",
      mutationScope: "No Unity scene, prefab, script, or editor state can be mutated from this chat workflow.",
      validationScope: "Unity playmode validation remains external until a trusted editor bridge exists.",
      externalToolingRequired: ["trusted Unity Editor automation bridge", "project-lock-safe playmode validation hooks"],
      dependencyExplanation: "Direct Unity control is outside the current AI-E supervised runtime boundary.",
      operatorFacingSummary: "AI-E blocked the direct Unity runtime request and surfaced the bridge dependency instead of claiming execution.",
    };
  }

  if (workflowType === "external_tooling_status") {
    return {
      ...base,
      approvalRequirement: "Operator approval is required before any external tool or trusted runtime performs work.",
      mutationScope: "Broad repo editing, Unity control, browser verification, and arbitrary shell access remain outside chat-only mutation scope.",
      validationScope: "Evidence must come from the trusted runtime, local dev server checks, Unity bridge, or another approved execution surface.",
      externalToolingRequired: ["trusted runtime for broad repo work", "Unity bridge for editor control", "local dev server for browser UI checks"],
      dependencyExplanation: "AI-E can explain and prepare bounded workflows, but broad external execution still requires approved tooling outside chat-only planning.",
      operatorFacingSummary: "AI-E identified which work it owns internally and which work still depends on external execution surfaces.",
    };
  }

  if (workflowType === "execution_brief") {
    return {
      ...base,
      approvalRequirement: "The brief is planning-only until the operator approves an implementation path.",
      mutationScope: "No files are changed by generating the brief.",
      validationScope: "The brief names validation steps; it does not run them.",
      externalToolingRequired: ["approved implementation path for actual edits", "Unity or test runtime for validation when applicable"],
      dependencyExplanation: "AI-E owns the supervised execution brief, while real edits and validation require a later approved runtime or implementation pass.",
      operatorFacingSummary: "AI-E prepared a supervised execution brief that is ready for review without claiming implementation.",
    };
  }

  return {
    ...base,
    approvalRequirement: "Chat reasoning requires no mutation approval; any execution step must be separately approved.",
    mutationScope: "No mutation occurs in chat-only reasoning.",
    validationScope: "Validation is advisory unless a trusted runtime route actually executes it.",
    externalToolingRequired: [],
    dependencyExplanation: "AI-E owns the reasoning and workflow framing while keeping execution claims tied to approved runtime evidence.",
    operatorFacingSummary: "AI-E is operating as the supervised runtime coordinator for this bounded chat response.",
  };
}