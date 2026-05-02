import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_EXECUTION_OUTCOME_DIRECTORY = path.join(REPO_ROOT, "data", "execution_outcomes");

export type ExecutionOutcomeRecord = {
  outcome_id: string;
  created_at: string;
  source_layer: "core" | "node" | "unity" | "manual";
  workflow_id?: string;
  task_id?: string;
  plan_id?: string;
  node_id?: string;
  target_node_id?: string;
  command?: string;
  status: "completed" | "failed" | "blocked" | "rolled_back";
  success: boolean;
  risk_level?: "low" | "medium" | "high";
  approval_path: string[];
  execution_path: string;
  evidence_labels: string[];
  result_summary?: string;
  error_summary?: string;
  rollback_required: boolean;
  rollback_executed: boolean;
  recovery_status?: "not_required" | "planned" | "executed" | "idempotent" | "failed";
};

export type ExecutionOutcomeRecordValidationResult = {
  ok: boolean;
  reason: string | null;
  record: ExecutionOutcomeRecord | null;
};

export type ExecutionOutcomeRecordWriteResult = {
  status: "recorded";
  record: ExecutionOutcomeRecord;
  output_path: string;
  append_only: true;
  autonomy_triggered: false;
  execution_triggered: false;
  approval_triggered: false;
};

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoLikeTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0);
}

export function validateExecutionOutcomeRecord(record: unknown): ExecutionOutcomeRecordValidationResult {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return {
      ok: false,
      reason: "Execution outcome record must be a JSON object.",
      record: null,
    };
  }

  const candidate = record as Record<string, unknown>;
  const approvalPath = normalizeStringList(candidate.approval_path);
  const evidenceLabels = normalizeStringList(candidate.evidence_labels);

  if (
    !hasNonEmptyString(candidate.outcome_id)
    || !hasNonEmptyString(candidate.created_at)
    || !isIsoLikeTimestamp(candidate.created_at)
    || !["core", "node", "unity", "manual"].includes(String(candidate.source_layer))
    || !["completed", "failed", "blocked", "rolled_back"].includes(String(candidate.status))
    || typeof candidate.success !== "boolean"
    || approvalPath.length === 0
    || !hasNonEmptyString(candidate.execution_path)
    || evidenceLabels.length === 0
    || typeof candidate.rollback_required !== "boolean"
    || typeof candidate.rollback_executed !== "boolean"
  ) {
    return {
      ok: false,
      reason: "Execution outcome record is missing required durable fields.",
      record: null,
    };
  }

  const riskLevel = typeof candidate.risk_level === "string" ? candidate.risk_level.trim() : "";
  if (riskLevel && !["low", "medium", "high"].includes(riskLevel)) {
    return {
      ok: false,
      reason: "Execution outcome record risk_level is invalid.",
      record: null,
    };
  }

  const recoveryStatus = typeof candidate.recovery_status === "string" ? candidate.recovery_status.trim() : "";
  if (recoveryStatus && !["not_required", "planned", "executed", "idempotent", "failed"].includes(recoveryStatus)) {
    return {
      ok: false,
      reason: "Execution outcome record recovery_status is invalid.",
      record: null,
    };
  }

  return {
    ok: true,
    reason: null,
    record: {
      outcome_id: candidate.outcome_id.trim(),
      created_at: candidate.created_at.trim(),
      source_layer: candidate.source_layer as ExecutionOutcomeRecord["source_layer"],
      workflow_id: hasNonEmptyString(candidate.workflow_id) ? candidate.workflow_id.trim() : undefined,
      task_id: hasNonEmptyString(candidate.task_id) ? candidate.task_id.trim() : undefined,
      plan_id: hasNonEmptyString(candidate.plan_id) ? candidate.plan_id.trim() : undefined,
      node_id: hasNonEmptyString(candidate.node_id) ? candidate.node_id.trim() : undefined,
      target_node_id: hasNonEmptyString(candidate.target_node_id) ? candidate.target_node_id.trim() : undefined,
      command: hasNonEmptyString(candidate.command) ? candidate.command.trim() : undefined,
      status: candidate.status as ExecutionOutcomeRecord["status"],
      success: candidate.success,
      risk_level: riskLevel ? riskLevel as ExecutionOutcomeRecord["risk_level"] : undefined,
      approval_path: approvalPath,
      execution_path: candidate.execution_path.trim(),
      evidence_labels: evidenceLabels,
      result_summary: hasNonEmptyString(candidate.result_summary) ? candidate.result_summary.trim() : undefined,
      error_summary: hasNonEmptyString(candidate.error_summary) ? candidate.error_summary.trim() : undefined,
      rollback_required: candidate.rollback_required,
      rollback_executed: candidate.rollback_executed,
      recovery_status: recoveryStatus ? recoveryStatus as ExecutionOutcomeRecord["recovery_status"] : undefined,
    },
  };
}

export function serializeExecutionOutcomeRecord(record: ExecutionOutcomeRecord): string {
  const validation = validateExecutionOutcomeRecord(record);
  if (!validation.ok || !validation.record) {
    throw new Error(validation.reason ?? "Execution outcome record validation failed.");
  }

  return JSON.stringify(validation.record, null, 2);
}

export async function recordExecutionOutcome(
  record: ExecutionOutcomeRecord,
  options?: { outputDirectory?: string },
): Promise<ExecutionOutcomeRecordWriteResult> {
  const validation = validateExecutionOutcomeRecord(record);
  if (!validation.ok || !validation.record) {
    throw new Error(validation.reason ?? "Execution outcome record validation failed.");
  }

  const outputDirectory = options?.outputDirectory?.trim() || DEFAULT_EXECUTION_OUTCOME_DIRECTORY;
  const outputPath = path.join(outputDirectory, `${validation.record.created_at.slice(0, 10) || "unknown-date"}.jsonl`);
  await mkdir(outputDirectory, { recursive: true });
  await appendFile(outputPath, `${JSON.stringify(validation.record)}\n`, "utf-8");

  return {
    status: "recorded",
    record: validation.record,
    output_path: outputPath,
    append_only: true,
    autonomy_triggered: false,
    execution_triggered: false,
    approval_triggered: false,
  };
}