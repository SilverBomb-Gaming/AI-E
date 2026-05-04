import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { LearningApplicationQueueExecutionResult } from "./learningApplicationQueue";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_LEARNING_QUEUE_EXECUTION_DIRECTORY = path.join(REPO_ROOT, "data", "learning_queue_executions");

export type LearningQueueExecutionRecord = {
  queue_execution_id: string;
  created_at: string;
  queue_id: string;
  recommendation_id: string;
  decision_id: string;
  attempted_status: "applied" | "blocked";
  applied: boolean;
  blocked_reason?: string;
  single_item_execution: true;
};

export type LearningQueueExecutionWriteResult = {
  status: "recorded";
  record: LearningQueueExecutionRecord;
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

export function buildLearningQueueExecutionRecord(
  result: LearningApplicationQueueExecutionResult,
  options?: { createdAt?: string },
): LearningQueueExecutionRecord {
  const createdAt = normalizeCreatedAt(options?.createdAt ?? result.created_at);

  return {
    queue_execution_id: result.queue_execution_id,
    created_at: createdAt,
    queue_id: result.queue_id,
    recommendation_id: result.recommendation_id,
    decision_id: result.decision_id,
    attempted_status: result.status,
    applied: result.applied,
    blocked_reason: result.reason,
    single_item_execution: true,
  };
}

export async function recordLearningQueueExecution(
  record: LearningQueueExecutionRecord,
  options?: { outputDirectory?: string },
): Promise<LearningQueueExecutionWriteResult> {
  const outputDirectory = options?.outputDirectory?.trim() || DEFAULT_LEARNING_QUEUE_EXECUTION_DIRECTORY;
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

export function renderLearningQueueExecution(record: LearningQueueExecutionRecord): string {
  const lines = [
    `Learning queue execution: ${record.queue_execution_id}`,
    `Created at: ${record.created_at}`,
    `Queue id: ${record.queue_id}`,
    `Recommendation id: ${record.recommendation_id}`,
    `Decision id: ${record.decision_id}`,
    `Attempted status: ${record.attempted_status}`,
    `Applied: ${record.applied ? "true" : "false"}`,
    `Single item execution: ${record.single_item_execution ? "true" : "false"}`,
  ];

  if (record.blocked_reason) {
    lines.push(`Blocked reason: ${record.blocked_reason}`);
  }

  lines.push("Queue execution was recorded append-only. No auto-execution, scheduling, loop processing, new learning scope, or autonomy was introduced.");
  return lines.join("\n");
}