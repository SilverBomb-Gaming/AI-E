import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { DecisionRecord } from "./decisionTrace";
import type { ExecutionInsight } from "./executionInsight";
import {
  buildExecutionReadinessReview,
  type ExecutionReadinessReview,
} from "./executionReadinessReview";

const EXECUTION_PATH = "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control" as const;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_CORE_NODE_DRAFT_DIRECTORY = path.join(REPO_ROOT, "drafts", "tasks");
const BLOCKED_COMMAND_OPERATOR_TOKENS = ["&&", "||", ";", "&", ">>", ">", "<", "|"] as const;
const ALLOWED_PYTHON_SCRIPTS = new Set(["validate_runtime.py", "diagnostics_smoke.py", "daily_use_smoke.py"]);

export type NodeDispatchCommandLabel = "/run" | "/test";
export type NodeDispatchTargetRole = "controller" | "executor" | "validator" | "sandbox";
export type NodeDispatchCommandKind = "run" | "test" | "build";
export type NodeDispatchCommandFamily = "generic" | "unittest" | "pytest" | "python_script";
export type NodeDispatchSelectionMode = "node_id";

export type NodeIntentKind = "execution_request" | "validation_request" | "status_request";

export type NodeIntentEnvelope = {
  source: "aie_node";
  node_id: string;
  intent_id: string;
  requested_at: string;
  operator_visible_summary: string;
  intent_kind: NodeIntentKind;
  payload: unknown;
  permissions: {
    can_execute: false;
    can_approve: false;
    can_rollback: false;
  };
};

export type NodePlanningInput = {
  planning_hint: string[];
  validation_hint: string[];
  dependency_hint: string[];
};

export type NodeBoundaryEvidenceLabel =
  | "NODE INTENT RECEIVED"
  | "NODE BOUNDARY CHECK PASSED"
  | "NODE BOUNDARY CHECK FAILED"
  | "NODE INTENT ACCEPTED FOR REVIEW"
  | "NODE DIRECT EXECUTION BLOCKED"
  | "NODE DIRECT ROLLBACK BLOCKED"
  | "NODE PLANNING HINT RECEIVED"
  | "NODE PLANNING HINT APPLIED"
  | "NODE PLANNING HINT REJECTED"
  | "NODE PLANNING CONFLICT RESOLVED"
  | "CORE TASK TRANSLATION GENERATED"
  | "TASK STORED AS DRAFT ONLY"
  | "NODE EXECUTION NOT TRIGGERED";

export type NodeIntentReceiptStatus = "accepted_for_review" | "rejected_boundary_violation" | "rejected_invalid_envelope";

export type NodeIntentValidationResult = {
  ok: boolean;
  category: "passed" | "invalid_envelope" | "boundary_violation";
  reason: string | null;
  evidence_labels: NodeBoundaryEvidenceLabel[];
  envelope: NodeIntentEnvelope | null;
};

export type NodeIntentReceipt = {
  status: NodeIntentReceiptStatus;
  reason: string;
  evidence_labels: NodeBoundaryEvidenceLabel[];
  execution_path: typeof EXECUTION_PATH;
  review_status: "pending_review" | "blocked";
  mutating: false;
  rollback_triggered: false;
  node_can_execute: false;
  node_can_approve: false;
  node_can_rollback: false;
  unity_access: "blocked";
  accepted_intent_kind: NodeIntentKind | null;
  accepted_planning_input: NodePlanningInput | null;
};

export type NodeAdvisoryPlanningStage = "strategy" | "planning";

export type NodePlanAnnotationType = "risk_warning" | "reliability_note" | "pattern_note" | "plan_adjustment";

export type NodePlanAlternative = {
  plan_id: string;
  label: string;
  steps: string[];
  command?: string;
  validation_gates?: string[];
};

export type NodePlanAnnotation = {
  type: NodePlanAnnotationType;
  message: string;
  confidence: number;
  severity: ExecutionInsight["severity"];
  suggestion?: string;
  alternative_plan?: NodePlanAlternative;
  insight_id: string;
  informational_only: true;
};

export type NodePlanOperatorAcknowledgement = {
  acknowledged: boolean;
  acknowledged_at?: string;
};

export type NodeAdvisoryPlan = {
  plan_id: string;
  selected_plan_id?: string;
  planning_stage: NodeAdvisoryPlanningStage;
  execution_path: typeof EXECUTION_PATH;
  planning_suggestions: string[];
  validation_insights: string[];
  dependency_reasoning: string[];
  validation_gates: string[];
  execution_authority: "system_only";
  annotations?: NodePlanAnnotation[];
  operator_acknowledgement?: NodePlanOperatorAcknowledgement;
};

export type NodePlanningMergeResult = {
  merged_plan: NodeAdvisoryPlan;
  node_hints_visible: NodePlanningInput;
  applied_hints: NodePlanningInput;
  rejected_hints: NodePlanningInput;
  conflict_overrides: Array<{
    hint_type: keyof NodePlanningInput;
    hint: string;
    system_reason: string;
  }>;
  evidence_labels: NodeBoundaryEvidenceLabel[];
};

export type NodeTaskRiskLevel = "low" | "medium" | "high";

export type CoreNodeTaskTranslationPlan = NodeAdvisoryPlan & {
  node_id: string;
  target_node_id: string;
  command: string;
  requires_sudo?: false;
  risk_level?: NodeTaskRiskLevel;
};

export type NodeTaskDraft = {
  task_id: string;
  node_id: string;
  target_node_id: string;
  command: string;
  requires_sudo: false;
  risk_level: NodeTaskRiskLevel;
  approval_status: "pending";
  signature: null;
};

export type NodeTaskDraftValidationResult = {
  ok: boolean;
  reason: string | null;
  evidence_labels: NodeBoundaryEvidenceLabel[];
  draft: NodeTaskDraft | null;
};

export type NodeTaskTranslationResult = {
  status: "draft_generated" | "draft_rejected";
  reason: string;
  evidence_labels: NodeBoundaryEvidenceLabel[];
  draft: NodeTaskDraft | null;
  stored_as_draft_only: true;
  submitted_to_node: false;
  node_intake_triggered: false;
  execution_triggered: false;
};

export type CoreNodePipelineDraftPlan = CoreNodeTaskTranslationPlan & {
  requested_command_label?: NodeDispatchCommandLabel;
  requested_capability_id?: string;
  command_kind?: NodeDispatchCommandKind;
  command_family?: NodeDispatchCommandFamily;
  working_directory?: string;
  timeout_seconds?: number;
  operator_reason?: string;
  expected_scope?: string;
  argv?: string[];
  requester_label?: string;
  chat_id?: string;
  request_source?: string;
  target_node_role?: NodeDispatchTargetRole;
  target_node_name?: string;
  routing_reason?: string;
};

export type NodePlanSelectionOption = {
  plan_id: string;
  label: string;
  source: "original" | "alternative";
  command?: string;
  steps: string[];
};

export type NodeDispatchExecutionPayloadDraft = {
  capability_id: string;
  command_kind: NodeDispatchCommandKind;
  command_family: NodeDispatchCommandFamily;
  command_text: string;
  command_summary: string;
  working_directory: string;
  timeout_seconds: number;
  operator_reason: string;
  expected_scope: string;
  argv: string[];
  workflow_id?: string;
  task_id?: string;
  plan_id?: string;
  risk_level?: NodeTaskRiskLevel;
  approval_path?: string[];
  execution_path?: string;
  evidence_labels?: string[];
  rollback_required?: boolean;
  rollback_executed?: boolean;
  recovery_status?: "not_required" | "planned" | "executed" | "idempotent" | "failed";
};

export type NodeDispatchDraftRecord = {
  job_id: string;
  status: "queued";
  requested_capability_id: string;
  requested_command_label: NodeDispatchCommandLabel;
  requested_command_text: string;
  requested_command_summary: string;
  target_selection_mode: NodeDispatchSelectionMode;
  target_selector: string;
  target_node_id: string;
  target_node_role: NodeDispatchTargetRole;
  target_node_name: string;
  routing_reason: string;
  request_source: string;
  requester_label: string;
  chat_id: string;
  confirmation_required: true;
  confirmation_id: string;
  queued_at: string;
  started_at: string;
  finished_at: string;
  result_summary: string;
  failure_reason: string;
  current_job_state: "queued";
  execution_payload: NodeDispatchExecutionPayloadDraft;
};

export type NodeDispatchDraftValidationResult = {
  ok: boolean;
  reason: string | null;
  draft_record: NodeDispatchDraftRecord | null;
};

export type NodeTaskDraftExportResult = {
  status: "draft_exported" | "draft_export_rejected";
  reason: string;
  evidence_labels: NodeBoundaryEvidenceLabel[];
  readiness_review: ExecutionReadinessReview;
  draft: NodeTaskDraft | null;
  dispatch_draft: NodeDispatchDraftRecord | null;
  draft_file_path: string | null;
  stored_as_draft_only: true;
  submitted_to_node: false;
  node_intake_triggered: false;
  execution_triggered: false;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function looksLikeIsoTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function flattenStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value.toLowerCase()];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenStrings(item));
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, nested]) => [key.toLowerCase(), ...flattenStrings(nested)]);
  }
  return [];
}

function normalizeHintList(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeNodePlanningInput(payload: unknown): NodePlanningInput {
  if (!isRecord(payload)) {
    return {
      planning_hint: [],
      validation_hint: [],
      dependency_hint: [],
    };
  }

  return {
    planning_hint: normalizeHintList(payload.planning_hint),
    validation_hint: normalizeHintList(payload.validation_hint),
    dependency_hint: normalizeHintList(payload.dependency_hint),
  };
}

function hasAnyNodePlanningHint(input: NodePlanningInput): boolean {
  return input.planning_hint.length > 0 || input.validation_hint.length > 0 || input.dependency_hint.length > 0;
}

function containsAny(text: string, candidates: string[]): boolean {
  return candidates.some((candidate) => text.includes(candidate));
}

function uniqueEvidenceLabels(labels: NodeBoundaryEvidenceLabel[]): NodeBoundaryEvidenceLabel[] {
  return [...new Set(labels)];
}

function hintRequestsGateBypass(hint: string): boolean {
  const normalized = hint.toLowerCase();

  return containsAny(normalized, [
    "skip validation",
    "bypass validation",
    "skip gate",
    "bypass gate",
    "ignore review",
    "skip review",
    "skip studio control",
    "bypass studio control",
    "approve automatically",
    "execute automatically",
    "run without approval",
  ]);
}

function hintConflictsWithSystemPlan(hint: string, systemValues: string[]): boolean {
  const normalizedHint = hint.toLowerCase();
  return systemValues.some((value) => normalizedHint === value.toLowerCase());
}

function inferNodeTaskRiskLevel(command: string): NodeTaskRiskLevel {
  const normalized = command.toLowerCase();

  if (containsAny(normalized, ["inspect", "summarize", "check", "validate", "verify", "review"])) {
    return "low";
  }

  if (containsAny(normalized, ["build", "compile", "test", "trace", "analyze"])) {
    return "medium";
  }

  return "high";
}

function hasBlockedCommandOperator(command: string): boolean {
  return BLOCKED_COMMAND_OPERATOR_TOKENS.some((token) => command.includes(token));
}

function commandLooksUnsafe(command: string): boolean {
  const normalized = command.toLowerCase();

  return hasBlockedCommandOperator(command) || containsAny(normalized, [
    "sudo",
    "runas",
    "chmod 777",
    "rm -rf",
    "del /f",
    "format ",
    "shutdown",
    "restart-computer",
    "invoke-expression",
    "powershell -encodedcommand",
    "curl ",
    "wget ",
    "| bash",
    "| sh",
    "git push",
    "npm publish",
    "unity.exe",
    "start-process",
  ]);
}

function splitCommandTokens(command: string): string[] {
  return command
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function buildDispatchJobId(taskId: string): string {
  const normalized = taskId
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

  return `JOB-${normalized || "CORE-DRAFT"}`;
}

function parsedSafeIdentifier(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function defaultWorkingDirectory(): string {
  return REPO_ROOT;
}

function parseCoreNodePipelineDraftPlan(plan: unknown): CoreNodePipelineDraftPlan | null {
  const parsedBasePlan = parseCoreNodeTaskTranslationPlan(plan);
  if (!parsedBasePlan || !isRecord(plan)) {
    return null;
  }

  return {
    ...parsedBasePlan,
    requested_command_label: plan.requested_command_label === "/run" || plan.requested_command_label === "/test"
      ? plan.requested_command_label
      : undefined,
    requested_capability_id: hasNonEmptyString(plan.requested_capability_id) ? plan.requested_capability_id.trim() : undefined,
    command_kind: plan.command_kind === "run" || plan.command_kind === "test" || plan.command_kind === "build"
      ? plan.command_kind
      : undefined,
    command_family: plan.command_family === "generic"
      || plan.command_family === "unittest"
      || plan.command_family === "pytest"
      || plan.command_family === "python_script"
      ? plan.command_family
      : undefined,
    working_directory: hasNonEmptyString(plan.working_directory) ? plan.working_directory.trim() : undefined,
    timeout_seconds: typeof plan.timeout_seconds === "number" && Number.isFinite(plan.timeout_seconds) ? plan.timeout_seconds : undefined,
    operator_reason: hasNonEmptyString(plan.operator_reason) ? plan.operator_reason.trim() : undefined,
    expected_scope: hasNonEmptyString(plan.expected_scope) ? plan.expected_scope.trim() : undefined,
    argv: Array.isArray(plan.argv)
      ? plan.argv.map((item) => String(item).trim()).filter((item) => item.length > 0)
      : undefined,
    requester_label: hasNonEmptyString(plan.requester_label) ? plan.requester_label.trim() : undefined,
    chat_id: hasNonEmptyString(plan.chat_id) ? plan.chat_id.trim() : undefined,
    request_source: hasNonEmptyString(plan.request_source) ? plan.request_source.trim() : undefined,
    target_node_role: plan.target_node_role === "controller"
      || plan.target_node_role === "executor"
      || plan.target_node_role === "validator"
      || plan.target_node_role === "sandbox"
      ? plan.target_node_role
      : undefined,
    target_node_name: hasNonEmptyString(plan.target_node_name) ? plan.target_node_name.trim() : undefined,
    routing_reason: hasNonEmptyString(plan.routing_reason) ? plan.routing_reason.trim() : undefined,
  };
}

function buildExecutionPayloadDraft(plan: CoreNodePipelineDraftPlan): NodeDispatchExecutionPayloadDraft | null {
  if (commandLooksUnsafe(plan.command)) {
    return null;
  }

  const outcomeMetadata = {
    workflow_id: `workflow-${parsedSafeIdentifier(plan.plan_id)}`,
    task_id: `node-task-${plan.plan_id}`,
    plan_id: plan.plan_id,
    risk_level: plan.risk_level ?? inferNodeTaskRiskLevel(plan.command),
    approval_path: ["operator_confirm_submit", "node_intake_review", "node_worker_execution"],
    execution_path: EXECUTION_PATH,
    evidence_labels: ["CORE TASK TRANSLATION GENERATED", "TASK STORED AS DRAFT ONLY", "NODE EXECUTION NOT TRIGGERED"],
    rollback_required: false,
    rollback_executed: false,
    recovery_status: "not_required" as const,
  };

  const explicitWorkingDirectory = typeof plan.working_directory === "string" && plan.working_directory.trim()
    ? plan.working_directory.trim()
    : defaultWorkingDirectory();

  if (Array.isArray(plan.argv) && plan.argv.length > 0) {
    const requestedCommandLabel = plan.requested_command_label;
    const commandKind = plan.command_kind;
    const commandFamily = plan.command_family;
    const capabilityId = typeof plan.requested_capability_id === "string" && plan.requested_capability_id.trim()
      ? plan.requested_capability_id.trim()
      : requestedCommandLabel === "/test"
        ? "core.node.dispatch.test"
        : "core.node.dispatch.run";

    if (!requestedCommandLabel || !commandKind || !commandFamily) {
      return null;
    }

    return {
      capability_id: capabilityId,
      command_kind: commandKind,
      command_family: commandFamily,
      command_text: plan.command,
      command_summary: plan.command,
      working_directory: explicitWorkingDirectory,
      timeout_seconds: typeof plan.timeout_seconds === "number" && Number.isFinite(plan.timeout_seconds)
        ? Math.max(5, plan.timeout_seconds)
        : 20,
      operator_reason: typeof plan.operator_reason === "string" ? plan.operator_reason.trim() : "Core-generated Node draft pending operator submission.",
      expected_scope: typeof plan.expected_scope === "string" ? plan.expected_scope.trim() : "bounded node draft",
      argv: plan.argv.map((item) => String(item).trim()).filter((item) => item.length > 0),
      ...outcomeMetadata,
    };
  }

  const tokens = splitCommandTokens(plan.command);
  if (tokens.length === 0) {
    return null;
  }

  const [first, second, third, ...rest] = tokens;
  const normalizedFirst = first.toLowerCase();
  const normalizedSecond = (second ?? "").toLowerCase();
  const normalizedThird = (third ?? "").toLowerCase();

  if (["python", "python.exe", "py", "py.exe"].includes(normalizedFirst) && normalizedSecond === "-m" && normalizedThird === "unittest") {
    return {
      capability_id: "core.node.dispatch.test",
      command_kind: "test",
      command_family: "unittest",
      command_text: plan.command,
      command_summary: plan.command,
      working_directory: explicitWorkingDirectory,
      timeout_seconds: typeof plan.timeout_seconds === "number" && Number.isFinite(plan.timeout_seconds)
        ? Math.max(5, plan.timeout_seconds)
        : 20,
      operator_reason: typeof plan.operator_reason === "string" ? plan.operator_reason.trim() : "Core-generated unittest draft pending operator submission.",
      expected_scope: typeof plan.expected_scope === "string" ? plan.expected_scope.trim() : "bounded node test draft",
      argv: tokens,
      ...outcomeMetadata,
    };
  }

  if (["python", "python.exe", "py", "py.exe"].includes(normalizedFirst) && hasNonEmptyString(second) && ALLOWED_PYTHON_SCRIPTS.has(second)) {
    return {
      capability_id: "core.node.dispatch.run",
      command_kind: "run",
      command_family: "python_script",
      command_text: plan.command,
      command_summary: plan.command,
      working_directory: explicitWorkingDirectory,
      timeout_seconds: typeof plan.timeout_seconds === "number" && Number.isFinite(plan.timeout_seconds)
        ? Math.max(5, plan.timeout_seconds)
        : 20,
      operator_reason: typeof plan.operator_reason === "string" ? plan.operator_reason.trim() : "Core-generated bounded run draft pending operator submission.",
      expected_scope: typeof plan.expected_scope === "string" ? plan.expected_scope.trim() : "bounded node run draft",
      argv: tokens,
      ...outcomeMetadata,
    };
  }

  if (normalizedFirst === "pytest") {
    return {
      capability_id: "core.node.dispatch.run",
      command_kind: "run",
      command_family: "pytest",
      command_text: plan.command,
      command_summary: plan.command,
      working_directory: explicitWorkingDirectory,
      timeout_seconds: typeof plan.timeout_seconds === "number" && Number.isFinite(plan.timeout_seconds)
        ? Math.max(5, plan.timeout_seconds)
        : 20,
      operator_reason: typeof plan.operator_reason === "string" ? plan.operator_reason.trim() : "Core-generated pytest draft pending operator submission.",
      expected_scope: typeof plan.expected_scope === "string" ? plan.expected_scope.trim() : "bounded node pytest draft",
      argv: tokens,
      ...outcomeMetadata,
    };
  }

  return null;
}

function buildNodeDispatchDraftRecord(plan: CoreNodePipelineDraftPlan, draft: NodeTaskDraft): NodeDispatchDraftRecord | null {
  const executionPayload = buildExecutionPayloadDraft(plan);
  if (!executionPayload) {
    return null;
  }

  const requestedCommandLabel: NodeDispatchCommandLabel = executionPayload.command_kind === "test" ? "/test" : "/run";

  return {
    job_id: buildDispatchJobId(draft.task_id),
    status: "queued",
    requested_capability_id: executionPayload.capability_id,
    requested_command_label: requestedCommandLabel,
    requested_command_text: draft.command,
    requested_command_summary: executionPayload.command_summary,
    target_selection_mode: "node_id",
    target_selector: draft.target_node_id,
    target_node_id: draft.target_node_id,
    target_node_role: plan.target_node_role ?? "executor",
    target_node_name: (typeof plan.target_node_name === "string" && plan.target_node_name.trim()) || draft.target_node_id,
    routing_reason: (typeof plan.routing_reason === "string" && plan.routing_reason.trim()) || `core draft routed to node ${draft.target_node_id}`,
    request_source: (typeof plan.request_source === "string" && plan.request_source.trim()) || "core-draft-export",
    requester_label: (typeof plan.requester_label === "string" && plan.requester_label.trim()) || draft.node_id,
    chat_id: (typeof plan.chat_id === "string" && plan.chat_id.trim()) || "core-draft",
    confirmation_required: true,
    confirmation_id: "",
    queued_at: "",
    started_at: "",
    finished_at: "",
    result_summary: "",
    failure_reason: "",
    current_job_state: "queued",
    execution_payload: executionPayload,
  };
}

export function validateNodeDispatchDraft(record: unknown): NodeDispatchDraftValidationResult {
  if (!isRecord(record)) {
    return {
      ok: false,
      reason: "Node dispatch draft is invalid. Expected a structured shared-directory dispatch record.",
      draft_record: null,
    };
  }

  if (
    !hasNonEmptyString(record.job_id)
    || record.status !== "queued"
    || !hasNonEmptyString(record.requested_capability_id)
    || (record.requested_command_label !== "/run" && record.requested_command_label !== "/test")
    || !hasNonEmptyString(record.requested_command_text)
    || !hasNonEmptyString(record.requested_command_summary)
    || record.target_selection_mode !== "node_id"
    || !hasNonEmptyString(record.target_selector)
    || !hasNonEmptyString(record.target_node_id)
    || !hasNonEmptyString(record.target_node_role)
    || !hasNonEmptyString(record.target_node_name)
    || !hasNonEmptyString(record.routing_reason)
    || !hasNonEmptyString(record.request_source)
    || !hasNonEmptyString(record.requester_label)
    || !hasNonEmptyString(record.chat_id)
    || record.confirmation_required !== true
    || typeof record.confirmation_id !== "string"
    || typeof record.queued_at !== "string"
    || typeof record.started_at !== "string"
    || typeof record.finished_at !== "string"
    || typeof record.result_summary !== "string"
    || typeof record.failure_reason !== "string"
    || record.current_job_state !== "queued"
    || !isRecord(record.execution_payload)
  ) {
    return {
      ok: false,
      reason: "Node dispatch draft schema does not match the shared-directory NodeDispatchRecord contract.",
      draft_record: null,
    };
  }

  const payload = record.execution_payload;
  const argv = payload.argv;
  if (
    !hasNonEmptyString(payload.capability_id)
    || (payload.command_kind !== "run" && payload.command_kind !== "test" && payload.command_kind !== "build")
    || (payload.command_family !== "generic" && payload.command_family !== "unittest" && payload.command_family !== "pytest" && payload.command_family !== "python_script")
    || !hasNonEmptyString(payload.command_text)
    || !hasNonEmptyString(payload.command_summary)
    || !hasNonEmptyString(payload.working_directory)
    || typeof payload.timeout_seconds !== "number"
    || !Array.isArray(argv)
    || argv.some((item) => typeof item !== "string" || item.trim().length === 0)
    || commandLooksUnsafe(payload.command_text)
  ) {
    return {
      ok: false,
      reason: "Node dispatch draft execution payload is invalid or unsafe for bounded submission.",
      draft_record: null,
    };
  }

  return {
    ok: true,
    reason: null,
    draft_record: record as NodeDispatchDraftRecord,
  };
}

function parseCoreNodeTaskTranslationPlan(plan: unknown): CoreNodeTaskTranslationPlan | null {
  if (!isRecord(plan)) {
    return null;
  }

  if (
    !hasNonEmptyString(plan.plan_id)
    || (plan.planning_stage !== "strategy" && plan.planning_stage !== "planning")
    || plan.execution_path !== EXECUTION_PATH
    || !Array.isArray(plan.planning_suggestions)
    || !Array.isArray(plan.validation_insights)
    || !Array.isArray(plan.dependency_reasoning)
    || !Array.isArray(plan.validation_gates)
    || plan.execution_authority !== "system_only"
    || !hasNonEmptyString(plan.node_id)
    || !hasNonEmptyString(plan.target_node_id)
    || !hasNonEmptyString(plan.command)
  ) {
    return null;
  }

  if (plan.requires_sudo !== undefined && plan.requires_sudo !== false) {
    return null;
  }

  if (
    plan.risk_level !== undefined
    && plan.risk_level !== "low"
    && plan.risk_level !== "medium"
    && plan.risk_level !== "high"
  ) {
    return null;
  }

  return {
    plan_id: plan.plan_id,
    selected_plan_id: hasNonEmptyString(plan.selected_plan_id) ? plan.selected_plan_id.trim() : undefined,
    planning_stage: plan.planning_stage,
    execution_path: EXECUTION_PATH,
    planning_suggestions: (plan.planning_suggestions as unknown[]).filter((item): item is string => typeof item === "string"),
    validation_insights: (plan.validation_insights as unknown[]).filter((item): item is string => typeof item === "string"),
    dependency_reasoning: (plan.dependency_reasoning as unknown[]).filter((item): item is string => typeof item === "string"),
    validation_gates: (plan.validation_gates as unknown[]).filter((item): item is string => typeof item === "string"),
    execution_authority: "system_only",
    node_id: plan.node_id,
    target_node_id: plan.target_node_id,
    command: plan.command.trim(),
    requires_sudo: false,
    risk_level: plan.risk_level,
  };
}

function uniqueStrings(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    if (!hasNonEmptyString(item)) {
      continue;
    }

    const trimmed = item.trim();
    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(trimmed);
  }

  return result;
}

function clonePlanAnnotations(annotations: NodePlanAnnotation[] | undefined): NodePlanAnnotation[] | undefined {
  if (!Array.isArray(annotations)) {
    return annotations;
  }

  return annotations.map((annotation) => ({
    ...annotation,
    alternative_plan: annotation.alternative_plan
      ? {
        ...annotation.alternative_plan,
        steps: [...annotation.alternative_plan.steps],
        validation_gates: annotation.alternative_plan.validation_gates
          ? [...annotation.alternative_plan.validation_gates]
          : undefined,
      }
      : undefined,
  }));
}

function cloneSelectablePlan<T extends NodeAdvisoryPlan | CoreNodeTaskTranslationPlan | CoreNodePipelineDraftPlan>(plan: T): T {
  const pipelinePlan = plan as CoreNodePipelineDraftPlan;

  return {
    ...plan,
    planning_suggestions: [...plan.planning_suggestions],
    validation_insights: [...plan.validation_insights],
    dependency_reasoning: [...plan.dependency_reasoning],
    validation_gates: [...plan.validation_gates],
    annotations: clonePlanAnnotations(plan.annotations),
    operator_acknowledgement: plan.operator_acknowledgement ? { ...plan.operator_acknowledgement } : plan.operator_acknowledgement,
    argv: Array.isArray(pipelinePlan.argv) ? [...pipelinePlan.argv] : pipelinePlan.argv,
  };
}

function deriveAlternativeCommand(command: string | undefined, insight: ExecutionInsight): string | undefined {
  if (!hasNonEmptyString(command)) {
    return undefined;
  }

  const normalized = command.trim().toLowerCase();
  if (normalized === "python validate_runtime.py") {
    return "python diagnostics_smoke.py";
  }

  if (normalized === "python diagnostics_smoke.py") {
    return "python daily_use_smoke.py";
  }

  if (normalized === "python daily_use_smoke.py" || normalized.startsWith("pytest ")) {
    return "python diagnostics_smoke.py";
  }

  if (insight.category === "pattern") {
    return `review ${command.trim()} in test mode before any full execution decision`;
  }

  if (insight.category === "risk") {
    return `review ${command.trim()} with an added validation checkpoint before execution`;
  }

  return `break ${command.trim()} into smaller reviewed steps before execution`;
}

function deriveAlternativeValidationGates(insight: ExecutionInsight): string[] {
  if (insight.category === "risk") {
    return ["pre-execution validation checkpoint"];
  }

  if (insight.category === "pattern") {
    return ["test-mode review checkpoint"];
  }

  return ["step-by-step environment review checkpoint"];
}

function getPlanAlternatives(plan: Pick<NodeAdvisoryPlan, "annotations">): NodePlanAlternative[] {
  if (!Array.isArray(plan.annotations)) {
    return [];
  }

  const alternatives: NodePlanAlternative[] = [];
  for (const annotation of plan.annotations) {
    if (annotation.type !== "plan_adjustment" || !annotation.alternative_plan) {
      continue;
    }

    if (!alternatives.some((candidate) => candidate.plan_id === annotation.alternative_plan?.plan_id)) {
      alternatives.push({
        ...annotation.alternative_plan,
        steps: [...annotation.alternative_plan.steps],
        validation_gates: annotation.alternative_plan.validation_gates
          ? [...annotation.alternative_plan.validation_gates]
          : undefined,
      });
    }
  }

  return alternatives;
}

export function listPlanSelectionOptions(
  plan: Pick<NodeAdvisoryPlan, "plan_id" | "planning_suggestions" | "annotations"> & Partial<CoreNodeTaskTranslationPlan>,
): NodePlanSelectionOption[] {
  const options: NodePlanSelectionOption[] = [{
    plan_id: plan.plan_id,
    label: "Original plan",
    source: "original",
    command: "command" in plan && hasNonEmptyString(plan.command) ? plan.command : undefined,
    steps: "command" in plan && hasNonEmptyString(plan.command)
      ? [`run ${plan.command}`]
      : plan.planning_suggestions.length > 0
        ? [plan.planning_suggestions[0]]
        : ["review the current bounded plan"],
  }];

  for (const alternative of getPlanAlternatives(plan)) {
    options.push({
      plan_id: alternative.plan_id,
      label: alternative.label,
      source: "alternative",
      command: alternative.command,
      steps: [...alternative.steps],
    });
  }

  return options;
}

export function selectOperatorPlan<T extends NodeAdvisoryPlan | CoreNodeTaskTranslationPlan | CoreNodePipelineDraftPlan>(
  plan: T,
  selectedPlanId: string,
): T & { selected_plan_id: string } {
  const normalizedPlanId = hasNonEmptyString(selectedPlanId) ? selectedPlanId.trim() : "";
  if (!normalizedPlanId) {
    throw new Error("Operator plan selection requires a non-empty plan id.");
  }

  const validPlanIds = new Set(listPlanSelectionOptions(plan).map((option) => option.plan_id));
  if (!validPlanIds.has(normalizedPlanId)) {
    throw new Error(`Operator plan selection must reference the original plan or a suggested alternative. Received: ${selectedPlanId}`);
  }

  return {
    ...cloneSelectablePlan(plan),
    selected_plan_id: normalizedPlanId,
  };
}

function resolveSelectedPlanForExecution<T extends NodeAdvisoryPlan | CoreNodeTaskTranslationPlan | CoreNodePipelineDraftPlan>(
  plan: T,
): { ok: true; plan: T } | { ok: false; reason: string } {
  const selectedPlanId = hasNonEmptyString(plan.selected_plan_id) ? plan.selected_plan_id.trim() : null;
  const alternatives = getPlanAlternatives(plan);

  if (alternatives.length === 0) {
    if (selectedPlanId && selectedPlanId !== plan.plan_id) {
      return {
        ok: false,
        reason: "Selected plan id does not match the original plan and no suggested alternatives are available.",
      };
    }

    return {
      ok: true,
      plan: cloneSelectablePlan({
        ...plan,
        selected_plan_id: selectedPlanId ?? plan.selected_plan_id,
      }),
    };
  }

  if (!selectedPlanId) {
    return {
      ok: false,
      reason: "Operator plan selection is required before translation. Choose the original plan or one suggested alternative explicitly.",
    };
  }

  if (selectedPlanId === plan.plan_id) {
    return {
      ok: true,
      plan: cloneSelectablePlan({
        ...plan,
        selected_plan_id: selectedPlanId,
      }),
    };
  }

  const selectedAlternative = alternatives.find((alternative) => alternative.plan_id === selectedPlanId);
  if (!selectedAlternative) {
    return {
      ok: false,
      reason: "Selected plan id does not match the original plan or any suggested alternative.",
    };
  }

  const resolvedPlan = cloneSelectablePlan(plan);
  return {
    ok: true,
    plan: {
      ...resolvedPlan,
      plan_id: selectedAlternative.plan_id,
      selected_plan_id: selectedPlanId,
      planning_suggestions: uniqueStrings([...resolvedPlan.planning_suggestions, ...selectedAlternative.steps]),
      validation_gates: uniqueStrings([...resolvedPlan.validation_gates, ...(selectedAlternative.validation_gates ?? [])]),
      command: "command" in resolvedPlan && hasNonEmptyString(selectedAlternative.command)
        ? selectedAlternative.command
        : (resolvedPlan as CoreNodeTaskTranslationPlan).command,
    },
  };
}

export function validateNodeTaskDraft(draft: unknown): NodeTaskDraftValidationResult {
  const evidenceLabels: NodeBoundaryEvidenceLabel[] = [];

  if (!isRecord(draft)) {
    return {
      ok: false,
      reason: "Node task draft is invalid. Expected a structured unsigned draft object.",
      evidence_labels: evidenceLabels,
      draft: null,
    };
  }

  if (
    !hasNonEmptyString(draft.task_id)
    || !hasNonEmptyString(draft.node_id)
    || !hasNonEmptyString(draft.target_node_id)
    || !hasNonEmptyString(draft.command)
    || draft.requires_sudo !== false
    || (draft.risk_level !== "low" && draft.risk_level !== "medium" && draft.risk_level !== "high")
    || draft.approval_status !== "pending"
    || draft.signature !== null
  ) {
    return {
      ok: false,
      reason: "Node task draft schema does not match the unsigned pending Node contract.",
      evidence_labels: evidenceLabels,
      draft: null,
    };
  }

  if (commandLooksUnsafe(draft.command)) {
    return {
      ok: false,
      reason: "Node task draft command is unsafe. Core can only generate bounded safe drafts and cannot encode privileged or execution-triggering commands.",
      evidence_labels: evidenceLabels,
      draft: null,
    };
  }

  return {
    ok: true,
    reason: null,
    evidence_labels: evidenceLabels,
    draft: {
      task_id: draft.task_id,
      node_id: draft.node_id,
      target_node_id: draft.target_node_id,
      command: draft.command,
      requires_sudo: false,
      risk_level: draft.risk_level,
      approval_status: "pending",
      signature: null,
    },
  };
}

function payloadRequestsDirectRollback(payload: unknown): boolean {
  const flattened = flattenStrings(payload);
  const joined = flattened.join(" ");

  return containsAny(joined, [
    "rollback",
    "roll back",
    "manual_rollback",
    "execute rollback",
    "direct rollback",
    "unity_scene_object_removal",
    "controlled_rollback",
  ]);
}

function payloadRequestsDirectMutation(payload: unknown): boolean {
  const flattened = flattenStrings(payload);
  const joined = flattened.join(" ");

  return containsAny(joined, [
    "execute now",
    "direct execute",
    "run immediately",
    "mutate unity",
    "unity mutation",
    "create object",
    "spawn object",
    "scene_object_creation",
    "unity_scene_object_creation",
  ]);
}

function payloadBypassesExecutionPath(payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }

  for (const [key, value] of Object.entries(payload)) {
    const normalizedKey = key.toLowerCase();

    if (["execution_path", "requested_execution_path", "route_path", "approval_path"].includes(normalizedKey)) {
      if (!hasNonEmptyString(value) || value !== EXECUTION_PATH) {
        return true;
      }
      continue;
    }

    if (["next_stage", "target_stage", "direct_stage", "bypass_stage"].includes(normalizedKey)) {
      if (typeof value === "string" && value.toLowerCase() !== "strategy") {
        return true;
      }
    }

    if (normalizedKey.includes("skip_") || normalizedKey.includes("bypass")) {
      return true;
    }

    if (typeof value === "string") {
      const normalizedValue = value.toLowerCase();
      if (containsAny(normalizedValue, [
        "skip strategy",
        "skip planning",
        "skip review",
        "skip delivery",
        "skip studio control",
        "bypass strategy",
        "bypass planning",
        "bypass review",
        "bypass delivery",
        "bypass studio control",
        "direct to execution",
        "direct to unity",
      ])) {
        return true;
      }
    }

    if (isRecord(value) && payloadBypassesExecutionPath(value)) {
      return true;
    }

    if (Array.isArray(value) && value.some((item) => payloadBypassesExecutionPath(item))) {
      return true;
    }
  }

  return false;
}

function parseNodeIntentEnvelope(envelope: unknown): NodeIntentEnvelope | null {
  if (!isRecord(envelope)) {
    return null;
  }

  const permissions = envelope.permissions;
  if (!isRecord(permissions)) {
    return null;
  }

  if (
    envelope.source !== "aie_node"
    || !hasNonEmptyString(envelope.node_id)
    || !hasNonEmptyString(envelope.intent_id)
    || !hasNonEmptyString(envelope.requested_at)
    || !looksLikeIsoTimestamp(envelope.requested_at)
    || !hasNonEmptyString(envelope.operator_visible_summary)
    || !["execution_request", "validation_request", "status_request"].includes(String(envelope.intent_kind))
    || typeof permissions.can_execute !== "boolean"
    || typeof permissions.can_approve !== "boolean"
    || typeof permissions.can_rollback !== "boolean"
  ) {
    return null;
  }

  return {
    source: "aie_node",
    node_id: envelope.node_id,
    intent_id: envelope.intent_id,
    requested_at: envelope.requested_at,
    operator_visible_summary: envelope.operator_visible_summary,
    intent_kind: envelope.intent_kind as NodeIntentKind,
    payload: envelope.payload,
    permissions: {
      can_execute: permissions.can_execute as false,
      can_approve: permissions.can_approve as false,
      can_rollback: permissions.can_rollback as false,
    },
  };
}

export function validateNodeIntentEnvelope(envelope: unknown): NodeIntentValidationResult {
  const evidenceLabels: NodeBoundaryEvidenceLabel[] = ["NODE INTENT RECEIVED"];
  const parsed = parseNodeIntentEnvelope(envelope);

  if (!parsed) {
    evidenceLabels.push("NODE BOUNDARY CHECK FAILED");
    return {
      ok: false,
      category: "invalid_envelope",
      reason: "Node intent envelope is invalid. Review-only intake requires the typed aie_node envelope.",
      evidence_labels: evidenceLabels,
      envelope: null,
    };
  }

  if (parsed.permissions.can_execute || parsed.permissions.can_approve || parsed.permissions.can_rollback) {
    evidenceLabels.push("NODE BOUNDARY CHECK FAILED");
    return {
      ok: false,
      category: "boundary_violation",
      reason: "Node intent permissions exceed the review-only boundary. Node cannot execute, approve, or rollback.",
      evidence_labels: evidenceLabels,
      envelope: parsed,
    };
  }

  if (payloadRequestsDirectRollback(parsed.payload)) {
    evidenceLabels.push("NODE BOUNDARY CHECK FAILED", "NODE DIRECT ROLLBACK BLOCKED");
    return {
      ok: false,
      category: "boundary_violation",
      reason: "Node requested direct rollback. Rollback stays manual-only through Studio Control and cannot be triggered by Node.",
      evidence_labels: evidenceLabels,
      envelope: parsed,
    };
  }

  if (payloadRequestsDirectMutation(parsed.payload)) {
    evidenceLabels.push("NODE BOUNDARY CHECK FAILED", "NODE DIRECT EXECUTION BLOCKED");
    return {
      ok: false,
      category: "boundary_violation",
      reason: "Node requested direct execution or Unity mutation. Node can submit reviewable intent only.",
      evidence_labels: evidenceLabels,
      envelope: parsed,
    };
  }

  if (payloadBypassesExecutionPath(parsed.payload)) {
    evidenceLabels.push("NODE BOUNDARY CHECK FAILED");
    return {
      ok: false,
      category: "boundary_violation",
      reason: "Node intent bypasses the required Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control path.",
      evidence_labels: evidenceLabels,
      envelope: parsed,
    };
  }

  const planningInput = normalizeNodePlanningInput(parsed.payload);
  if (hasAnyNodePlanningHint(planningInput)) {
    evidenceLabels.push("NODE PLANNING HINT RECEIVED");
  }

  const allHints = [...planningInput.planning_hint, ...planningInput.validation_hint, ...planningInput.dependency_hint];
  if (allHints.some((hint) => hintRequestsGateBypass(hint))) {
    evidenceLabels.push("NODE BOUNDARY CHECK FAILED", "NODE PLANNING HINT REJECTED");
    return {
      ok: false,
      category: "boundary_violation",
      reason: "Node planning hints cannot bypass validation, review, delivery, or Studio Control gates.",
      evidence_labels: evidenceLabels,
      envelope: parsed,
    };
  }

  evidenceLabels.push("NODE BOUNDARY CHECK PASSED");
  return {
    ok: true,
    category: "passed",
    reason: null,
    evidence_labels: evidenceLabels,
    envelope: parsed,
  };
}

export function receiveNodeIntent(envelope: unknown): NodeIntentReceipt {
  const validation = validateNodeIntentEnvelope(envelope);

  if (!validation.ok) {
    return {
      status: validation.category === "invalid_envelope" ? "rejected_invalid_envelope" : "rejected_boundary_violation",
      reason: validation.reason ?? "Node boundary validation failed.",
      evidence_labels: validation.evidence_labels,
      execution_path: EXECUTION_PATH,
      review_status: "blocked",
      mutating: false,
      rollback_triggered: false,
      node_can_execute: false,
      node_can_approve: false,
      node_can_rollback: false,
      unity_access: "blocked",
      accepted_intent_kind: null,
      accepted_planning_input: null,
    };
  }

  const acceptedPlanningInput = normalizeNodePlanningInput(validation.envelope?.payload);

  return {
    status: "accepted_for_review",
    reason: "Node intent was accepted as reviewable input only. Strategy, Planning, Review, Delivery, Studio Control, and manual approval still gate any future core execution.",
    evidence_labels: [...validation.evidence_labels, "NODE INTENT ACCEPTED FOR REVIEW"],
    execution_path: EXECUTION_PATH,
    review_status: "pending_review",
    mutating: false,
    rollback_triggered: false,
    node_can_execute: false,
    node_can_approve: false,
    node_can_rollback: false,
    unity_access: "blocked",
    accepted_intent_kind: validation.envelope?.intent_kind ?? null,
    accepted_planning_input: acceptedPlanningInput,
  };
}

export function mergeNodePlanningHints(systemPlan: NodeAdvisoryPlan, nodeHints: NodePlanningInput): NodePlanningMergeResult {
  const evidenceLabels: NodeBoundaryEvidenceLabel[] = [];

  if (hasAnyNodePlanningHint(nodeHints)) {
    evidenceLabels.push("NODE PLANNING HINT RECEIVED");
  }

  const appliedHints: NodePlanningInput = {
    planning_hint: [],
    validation_hint: [],
    dependency_hint: [],
  };

  const rejectedHints: NodePlanningInput = {
    planning_hint: [],
    validation_hint: [],
    dependency_hint: [],
  };

  const conflictOverrides: NodePlanningMergeResult["conflict_overrides"] = [];

  const mergedPlan: NodeAdvisoryPlan = {
    ...systemPlan,
    planning_suggestions: [...systemPlan.planning_suggestions],
    validation_insights: [...systemPlan.validation_insights],
    dependency_reasoning: [...systemPlan.dependency_reasoning],
    validation_gates: [...systemPlan.validation_gates],
    execution_authority: "system_only",
    execution_path: EXECUTION_PATH,
  };

  const applyHint = (
    hintType: keyof NodePlanningInput,
    target: "planning_suggestions" | "validation_insights" | "dependency_reasoning",
    systemReason: string,
  ) => {
    for (const hint of nodeHints[hintType]) {
      if (hintRequestsGateBypass(hint)) {
        rejectedHints[hintType].push(hint);
        continue;
      }

      if (hintConflictsWithSystemPlan(hint, mergedPlan[target])) {
        rejectedHints[hintType].push(hint);
        conflictOverrides.push({
          hint_type: hintType,
          hint,
          system_reason: systemReason,
        });
        continue;
      }

      if (!mergedPlan[target].some((item) => item.toLowerCase() === hint.toLowerCase())) {
        mergedPlan[target].push(hint);
      }
      appliedHints[hintType].push(hint);
    }
  };

  applyHint("planning_hint", "planning_suggestions", "System planning suggestions remain authoritative.");
  applyHint("validation_hint", "validation_insights", "System validation gates and insights remain authoritative.");
  applyHint("dependency_hint", "dependency_reasoning", "System dependency reasoning remains authoritative.");

  if (appliedHints.planning_hint.length || appliedHints.validation_hint.length || appliedHints.dependency_hint.length) {
    evidenceLabels.push("NODE PLANNING HINT APPLIED");
  }

  if (rejectedHints.planning_hint.length || rejectedHints.validation_hint.length || rejectedHints.dependency_hint.length) {
    evidenceLabels.push("NODE PLANNING HINT REJECTED");
  }

  if (conflictOverrides.length > 0) {
    evidenceLabels.push("NODE PLANNING CONFLICT RESOLVED");
  }

  return {
    merged_plan: mergedPlan,
    node_hints_visible: {
      planning_hint: [...nodeHints.planning_hint],
      validation_hint: [...nodeHints.validation_hint],
      dependency_hint: [...nodeHints.dependency_hint],
    },
    applied_hints: appliedHints,
    rejected_hints: rejectedHints,
    conflict_overrides: conflictOverrides,
    evidence_labels: evidenceLabels,
  };
}

export function translatePlanToNodeTask(plan: unknown): NodeTaskTranslationResult {
  const resolvedPlan = isRecord(plan)
    ? resolveSelectedPlanForExecution(plan as CoreNodeTaskTranslationPlan | CoreNodePipelineDraftPlan)
    : { ok: true as const, plan };

  if (!resolvedPlan.ok) {
    return {
      status: "draft_rejected",
      reason: resolvedPlan.reason,
      evidence_labels: [],
      draft: null,
      stored_as_draft_only: true,
      submitted_to_node: false,
      node_intake_triggered: false,
      execution_triggered: false,
    };
  }

  const parsedPlan = parseCoreNodeTaskTranslationPlan(resolvedPlan.plan);

  if (!parsedPlan) {
    return {
      status: "draft_rejected",
      reason: "Core plan cannot be translated into a Node task draft. The plan must include explicit node routing, the bounded execution path, and a safe command.",
      evidence_labels: [],
      draft: null,
      stored_as_draft_only: true,
      submitted_to_node: false,
      node_intake_triggered: false,
      execution_triggered: false,
    };
  }

  const draft: NodeTaskDraft = {
    task_id: `node-task-${parsedPlan.plan_id}`,
    node_id: parsedPlan.node_id,
    target_node_id: parsedPlan.target_node_id,
    command: parsedPlan.command,
    requires_sudo: false,
    risk_level: parsedPlan.risk_level ?? inferNodeTaskRiskLevel(parsedPlan.command),
    approval_status: "pending",
    signature: null,
  };

  const validation = validateNodeTaskDraft(draft);
  if (!validation.ok) {
    return {
      status: "draft_rejected",
      reason: validation.reason ?? "Node task draft validation failed.",
      evidence_labels: validation.evidence_labels,
      draft: null,
      stored_as_draft_only: true,
      submitted_to_node: false,
      node_intake_triggered: false,
      execution_triggered: false,
    };
  }

  return {
    status: "draft_generated",
    reason: "Core translated the advisory plan into a Node-compatible draft only. Signature, submission, intake, and execution remain blocked pending operator-gated Node intake.",
    evidence_labels: [
      "CORE TASK TRANSLATION GENERATED",
      "TASK STORED AS DRAFT ONLY",
      "NODE EXECUTION NOT TRIGGERED",
    ],
    draft: validation.draft,
    stored_as_draft_only: true,
    submitted_to_node: false,
    node_intake_triggered: false,
    execution_triggered: false,
  };
}

export async function exportNodeTaskDraftToPipeline(
  plan: unknown,
  options?: {
    draftDirectory?: string;
    decisionRecord?: DecisionRecord | null;
    requireAcknowledgement?: boolean;
    requireDecisionRecord?: boolean;
  },
): Promise<NodeTaskDraftExportResult> {
  const readinessReview = isRecord(plan)
    ? buildExecutionReadinessReview(plan as CoreNodeTaskTranslationPlan | CoreNodePipelineDraftPlan, {
      decisionRecord: options?.decisionRecord,
      require_acknowledgement: options?.requireAcknowledgement ?? true,
      require_decision_record: options?.requireDecisionRecord ?? true,
    })
    : buildExecutionReadinessReview({
      plan_id: "unknown-plan",
      planning_stage: "planning",
      execution_path: EXECUTION_PATH,
      planning_suggestions: [],
      validation_insights: [],
      dependency_reasoning: [],
      validation_gates: [],
      execution_authority: "system_only",
    }, {
      decisionRecord: options?.decisionRecord,
      require_acknowledgement: options?.requireAcknowledgement ?? true,
      require_decision_record: options?.requireDecisionRecord ?? true,
    });

  if (readinessReview.readiness_status !== "ready_for_operator_submission") {
    return {
      status: "draft_export_rejected",
      reason: readinessReview.required_operator_actions[0]
        ?? `Execution readiness review blocked draft export: ${readinessReview.readiness_status}.`,
      evidence_labels: [],
      readiness_review: readinessReview,
      draft: null,
      dispatch_draft: null,
      draft_file_path: null,
      stored_as_draft_only: true,
      submitted_to_node: false,
      node_intake_triggered: false,
      execution_triggered: false,
    };
  }

  const resolvedPlan = isRecord(plan)
    ? resolveSelectedPlanForExecution(plan as CoreNodeTaskTranslationPlan | CoreNodePipelineDraftPlan)
    : { ok: true as const, plan };

  if (!resolvedPlan.ok) {
    return {
      status: "draft_export_rejected",
      reason: resolvedPlan.reason,
      evidence_labels: [],
      readiness_review: readinessReview,
      draft: null,
      dispatch_draft: null,
      draft_file_path: null,
      stored_as_draft_only: true,
      submitted_to_node: false,
      node_intake_triggered: false,
      execution_triggered: false,
    };
  }

  const translation = translatePlanToNodeTask(resolvedPlan.plan);

  if (translation.status !== "draft_generated" || !translation.draft) {
    return {
      status: "draft_export_rejected",
      reason: translation.reason,
      evidence_labels: translation.evidence_labels,
      readiness_review: readinessReview,
      draft: null,
      dispatch_draft: null,
      draft_file_path: null,
      stored_as_draft_only: true,
      submitted_to_node: false,
      node_intake_triggered: false,
      execution_triggered: false,
    };
  }

  const pipelinePlan = parseCoreNodePipelineDraftPlan(resolvedPlan.plan);
  if (!pipelinePlan) {
    return {
      status: "draft_export_rejected",
      reason: "Core task draft cannot be exported to the Node draft pipeline because the bounded pipeline metadata is incomplete.",
      evidence_labels: translation.evidence_labels,
      readiness_review: readinessReview,
      draft: translation.draft,
      dispatch_draft: null,
      draft_file_path: null,
      stored_as_draft_only: true,
      submitted_to_node: false,
      node_intake_triggered: false,
      execution_triggered: false,
    };
  }

  const dispatchDraft = buildNodeDispatchDraftRecord(pipelinePlan, translation.draft);
  const dispatchValidation = validateNodeDispatchDraft(dispatchDraft);

  if (!dispatchDraft || !dispatchValidation.ok || !dispatchValidation.draft_record) {
    return {
      status: "draft_export_rejected",
      reason: dispatchValidation.reason ?? "Core task draft cannot be exported to the Node draft pipeline. Provide a bounded executable command that matches the existing Node dispatch contract.",
      evidence_labels: translation.evidence_labels,
      readiness_review: readinessReview,
      draft: translation.draft,
      dispatch_draft: null,
      draft_file_path: null,
      stored_as_draft_only: true,
      submitted_to_node: false,
      node_intake_triggered: false,
      execution_triggered: false,
    };
  }

  const draftDirectory = options?.draftDirectory?.trim() || DEFAULT_CORE_NODE_DRAFT_DIRECTORY;
  const draftFilePath = path.join(draftDirectory, `${translation.draft.task_id}.json`);

  await mkdir(draftDirectory, { recursive: true });
  await writeFile(draftFilePath, `${JSON.stringify(dispatchValidation.draft_record, null, 2)}\n`, "utf-8");

  return {
    status: "draft_exported",
    reason: "Core exported the Node dispatch draft into the operator-reviewed draft folder only. Submission still requires explicit operator confirmation through the Node draft pipeline.",
    evidence_labels: uniqueEvidenceLabels([
      ...translation.evidence_labels,
      "TASK STORED AS DRAFT ONLY",
      "NODE EXECUTION NOT TRIGGERED",
    ]),
    readiness_review: readinessReview,
    draft: translation.draft,
    dispatch_draft: dispatchValidation.draft_record,
    draft_file_path: draftFilePath,
    stored_as_draft_only: true,
    submitted_to_node: false,
    node_intake_triggered: false,
    execution_triggered: false,
  };
}

function clampAnnotationConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
}

function normalizeOperatorAcknowledgement(
  value: NodePlanOperatorAcknowledgement | undefined,
): NodePlanOperatorAcknowledgement {
  if (!value) {
    return { acknowledged: false };
  }

  if (value.acknowledged !== true) {
    return { acknowledged: false };
  }

  if (hasNonEmptyString(value.acknowledged_at) && looksLikeIsoTimestamp(value.acknowledged_at)) {
    return {
      acknowledged: true,
      acknowledged_at: value.acknowledged_at.trim(),
    };
  }

  return { acknowledged: true };
}

function normalizeCommandTokens(command: string | undefined): string[] {
  if (!hasNonEmptyString(command)) {
    return [];
  }

  return command
    .toLowerCase()
    .split(/[^a-z0-9._:-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && token !== "python" && token !== "python.exe" && token !== "pytest");
}

function insightMatchesPlan(plan: NodeAdvisoryPlan | CoreNodeTaskTranslationPlan | CoreNodePipelineDraftPlan, insight: ExecutionInsight): boolean {
  const description = insight.description.toLowerCase();

  if (("target_node_id" in plan && hasNonEmptyString(plan.target_node_id) && description.includes(plan.target_node_id.toLowerCase()))
    || ("node_id" in plan && hasNonEmptyString(plan.node_id) && description.includes(plan.node_id.toLowerCase()))) {
    return true;
  }

  if ("risk_level" in plan && typeof plan.risk_level === "string" && plan.risk_level.trim()) {
    const riskLevel = plan.risk_level.toLowerCase();
    if (description.includes(`${riskLevel} risk`) || description.includes(`${riskLevel}-risk`)) {
      return true;
    }
  }

  if ("command" in plan) {
    const commandTokens = normalizeCommandTokens(plan.command);
    if (commandTokens.some((token) => description.includes(token))) {
      return true;
    }
  }

  return insight.category === "risk";
}

function buildPlanAnnotation(insight: ExecutionInsight): NodePlanAnnotation {
  return {
    type: insight.category === "risk"
      ? "risk_warning"
      : insight.category === "pattern"
        ? "pattern_note"
        : "reliability_note",
    message: insight.description,
    confidence: clampAnnotationConfidence(insight.confidence),
    severity: insight.severity,
    suggestion: insight.suggestion,
    insight_id: insight.insight_id,
    informational_only: true,
  };
}

function buildPlanAdjustmentAlternative(
  plan: NodeAdvisoryPlan | CoreNodeTaskTranslationPlan | CoreNodePipelineDraftPlan,
  insight: ExecutionInsight,
): NodePlanAlternative | null {
  if ((insight.severity !== "high" && insight.severity !== "critical") || !insight.suggestion) {
    return null;
  }

  const steps: string[] = [];
  const command = "command" in plan && hasNonEmptyString(plan.command) ? plan.command : "the planned command";

  if (insight.category === "pattern") {
    steps.push(`run ${command} in test mode first`);
    steps.push("review the test output before any full execution decision");
  } else if (insight.category === "risk") {
    steps.push("add a validation step before execution");
    steps.push("ensure the recovery plan is ready and reviewed");
  } else {
    steps.push("split the plan into smaller reviewed steps");
    steps.push("verify the environment before each step");
  }

  return {
    plan_id: `${plan.plan_id}-alternative-${parsedSafeIdentifier(insight.insight_id)}`,
    label: `${insight.severity.charAt(0).toUpperCase()}${insight.severity.slice(1)} alternative for ${insight.category}`,
    steps,
    command: deriveAlternativeCommand("command" in plan && hasNonEmptyString(plan.command) ? plan.command : undefined, insight),
    validation_gates: deriveAlternativeValidationGates(insight),
  };
}

function buildPlanAdjustmentAnnotation(
  plan: NodeAdvisoryPlan | CoreNodeTaskTranslationPlan | CoreNodePipelineDraftPlan,
  insight: ExecutionInsight,
): NodePlanAnnotation | null {
  const alternativePlan = buildPlanAdjustmentAlternative(plan, insight);
  if (!alternativePlan) {
    return null;
  }

  return {
    type: "plan_adjustment",
    message: insight.suggestion ?? "Consider an alternative reviewed plan.",
    confidence: clampAnnotationConfidence(insight.confidence),
    severity: insight.severity,
    suggestion: insight.suggestion,
    alternative_plan: alternativePlan,
    insight_id: `${insight.insight_id}-plan-adjustment`,
    informational_only: true,
  };
}

export function attachInsightsToPlan<T extends NodeAdvisoryPlan | CoreNodeTaskTranslationPlan | CoreNodePipelineDraftPlan>(
  plan: T,
  insights: readonly ExecutionInsight[],
): T & { annotations: NodePlanAnnotation[]; operator_acknowledgement: NodePlanOperatorAcknowledgement } {
  const existingAnnotations = Array.isArray(plan.annotations)
    ? plan.annotations.map((annotation) => ({ ...annotation, informational_only: true as const }))
    : [];
  const matchedInsights = insights
    .filter((insight) => insightMatchesPlan(plan, insight))
    .flatMap((insight) => {
      const annotations: NodePlanAnnotation[] = [buildPlanAnnotation(insight)];
      const adjustment = buildPlanAdjustmentAnnotation(plan, insight);
      if (adjustment) {
        annotations.push(adjustment);
      }
      return annotations;
    });

  const mergedAnnotations = [...existingAnnotations];
  for (const annotation of matchedInsights) {
    if (!mergedAnnotations.some((candidate) => candidate.insight_id === annotation.insight_id)) {
      mergedAnnotations.push(annotation);
    }
  }

  return {
    ...plan,
    planning_suggestions: [...plan.planning_suggestions],
    validation_insights: [...plan.validation_insights],
    dependency_reasoning: [...plan.dependency_reasoning],
    validation_gates: [...plan.validation_gates],
    selected_plan_id: plan.selected_plan_id,
    annotations: mergedAnnotations,
    operator_acknowledgement: normalizeOperatorAcknowledgement(plan.operator_acknowledgement),
  };
}

export function acknowledgePlanInsights<T extends NodeAdvisoryPlan | CoreNodeTaskTranslationPlan | CoreNodePipelineDraftPlan>(
  plan: T,
  acknowledgedAt?: string,
): T & { operator_acknowledgement: NodePlanOperatorAcknowledgement } {
  const normalizedTimestamp = hasNonEmptyString(acknowledgedAt) && looksLikeIsoTimestamp(acknowledgedAt)
    ? acknowledgedAt.trim()
    : new Date().toISOString();

  return {
    ...plan,
    planning_suggestions: [...plan.planning_suggestions],
    validation_insights: [...plan.validation_insights],
    dependency_reasoning: [...plan.dependency_reasoning],
    validation_gates: [...plan.validation_gates],
    selected_plan_id: plan.selected_plan_id,
    annotations: Array.isArray(plan.annotations)
      ? plan.annotations.map((annotation) => ({ ...annotation, informational_only: true as const }))
      : plan.annotations,
    operator_acknowledgement: {
      acknowledged: true,
      acknowledged_at: normalizedTimestamp,
    },
  };
}

export function buildInsightAcknowledgementPrompt(
  plan: Pick<NodeAdvisoryPlan, "plan_id" | "selected_plan_id" | "annotations" | "operator_acknowledgement" | "planning_suggestions" | "validation_gates" | "execution_path"> & Partial<CoreNodeTaskTranslationPlan>,
): string | null {
  if (!Array.isArray(plan.annotations) || plan.annotations.length === 0) {
    return null;
  }

  if (plan.operator_acknowledgement?.acknowledged === true) {
    return null;
  }

  const lines = ["Original plan:"];
  lines.push(`- [${plan.plan_id}] ${plan.selected_plan_id === plan.plan_id ? "selected" : "available"}`);
  if ("command" in plan && hasNonEmptyString(plan.command)) {
    lines.push(`- run ${plan.command}`);
  } else if (Array.isArray(plan.planning_suggestions) && plan.planning_suggestions.length > 0) {
    lines.push(`- ${plan.planning_suggestions[0]}`);
  } else {
    lines.push("- review the current bounded plan");
  }

  const coreAnnotations = plan.annotations.filter((annotation) => annotation.type !== "plan_adjustment");
  const adjustmentAnnotations = plan.annotations.filter((annotation) => annotation.type === "plan_adjustment");

  lines.push("");
  lines.push("Insights detected:");
  for (const annotation of coreAnnotations) {
    lines.push(`- [${annotation.severity.toUpperCase()}] ${annotation.message} (confidence ${annotation.confidence.toFixed(2)})`);
    if (annotation.suggestion) {
      lines.push(`  Suggestion: ${annotation.suggestion}`);
    }
  }

  if (adjustmentAnnotations.length > 0) {
    lines.push("");
    lines.push("Suggested alternatives:");
    for (const annotation of adjustmentAnnotations) {
      lines.push(`- [${annotation.severity.toUpperCase()}] ${annotation.message}`);
      if (annotation.alternative_plan) {
        lines.push(`  Plan id: ${annotation.alternative_plan.plan_id}${plan.selected_plan_id === annotation.alternative_plan.plan_id ? " (selected)" : ""}`);
      }
      if (annotation.alternative_plan?.steps.length) {
        lines.push("  Alternative plan:");
        for (const step of annotation.alternative_plan.steps) {
          lines.push(`  - ${step}`);
        }
      }
    }
  }
  lines.push("");
  if (adjustmentAnnotations.length > 0) {
    lines.push("Select plan id before proceeding.");
  }
  lines.push("Acknowledge before proceeding? (yes/no)");
  return lines.join("\n");
}