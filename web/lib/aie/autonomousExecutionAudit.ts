import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AutonomousExecutionResult } from "./autonomousExecution";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_AUTONOMOUS_EXECUTION_AUDIT_DIRECTORY = path.join(REPO_ROOT, "data", "autonomous_execution_audits");

export type AutonomousExecutionAuditRecord = {
  autonomous_execution_id: string;
  created_at: string;
  policy_snapshot: AutonomousExecutionResult["policy_snapshot"];
  simulation_snapshot: AutonomousExecutionResult["simulation"];
  selected_queue_id?: string;
  executed: boolean;
  blocked_reason?: string;
  single_item_execution: true;
  safety_stack_used: AutonomousExecutionResult["safety_stack_used"];
};

export type AutonomousExecutionAuditWriteResult = {
  status: "recorded";
  record: AutonomousExecutionAuditRecord;
  output_path: string;
  append_only: true;
  execution_triggered: false;
  autonomy_triggered: false;
};

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function looksLikeIsoTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function normalizeCreatedAt(value: string | undefined): string {
  if (hasNonEmptyString(value) && looksLikeIsoTimestamp(value)) {
    return value.trim();
  }

  return new Date().toISOString();
}

function buildAutonomousExecutionId(result: AutonomousExecutionResult, createdAt: string): string {
  const normalizedTimestamp = createdAt.replace(/[:.]/g, "-");
  const queueId = result.queue_id ?? "no-queue-selected";
  return `autonomous-execution-${normalizedTimestamp}-${queueId}`;
}

export function buildAutonomousExecutionAuditRecord(
  result: AutonomousExecutionResult,
  options?: { createdAt?: string },
): AutonomousExecutionAuditRecord {
  const createdAt = normalizeCreatedAt(options?.createdAt ?? result.execution_result?.created_at);

  return {
    autonomous_execution_id: buildAutonomousExecutionId(result, createdAt),
    created_at: createdAt,
    policy_snapshot: {
      ...result.policy_snapshot,
      allowed_actions: [...result.policy_snapshot.allowed_actions],
    },
    simulation_snapshot: {
      ...result.simulation,
      execution_plan: [...result.simulation.execution_plan],
      executable_items: [...result.simulation.executable_items],
      blocked_items: result.simulation.blocked_items.map((item) => ({ ...item })),
      reasons: [...result.simulation.reasons],
    },
    selected_queue_id: result.queue_id,
    executed: result.executed,
    blocked_reason: result.reason,
    single_item_execution: true,
    safety_stack_used: [...result.safety_stack_used],
  };
}

export async function recordAutonomousExecutionAudit(
  record: AutonomousExecutionAuditRecord,
  options?: { outputDirectory?: string },
): Promise<AutonomousExecutionAuditWriteResult> {
  const outputDirectory = options?.outputDirectory?.trim() || DEFAULT_AUTONOMOUS_EXECUTION_AUDIT_DIRECTORY;
  const outputPath = path.join(outputDirectory, `${record.created_at.slice(0, 10) || "unknown-date"}.jsonl`);

  await mkdir(outputDirectory, { recursive: true });
  await appendFile(outputPath, `${JSON.stringify(record)}\n`, "utf-8");

  return {
    status: "recorded",
    record,
    output_path: outputPath,
    append_only: true,
    execution_triggered: false,
    autonomy_triggered: false,
  };
}

export function renderAutonomousExecutionAudit(record: AutonomousExecutionAuditRecord): string {
  const lines = [
    `Autonomous execution audit: ${record.autonomous_execution_id}`,
    `Created at: ${record.created_at}`,
    `Selected queue id: ${record.selected_queue_id ?? "none"}`,
    `Executed: ${record.executed ? "true" : "false"}`,
    `Single item execution: ${record.single_item_execution ? "true" : "false"}`,
    `Allowed lane: ${record.policy_snapshot.allowed_lane}`,
    `Autonomy enabled: ${record.policy_snapshot.autonomy_enabled ? "true" : "false"}`,
    `Simulation plan: ${record.simulation_snapshot.execution_plan.join(", ") || "none"}`,
    `Safety stack used: ${record.safety_stack_used.join(", ")}`,
  ];

  if (record.blocked_reason) {
    lines.push(`Blocked reason: ${record.blocked_reason}`);
  }

  lines.push("Autonomous execution audit was recorded append-only. No scheduling, loops, multi-item execution, new learning scope, or uncontrolled autonomy was introduced.");
  return lines.join("\n");
}