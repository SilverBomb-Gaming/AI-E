import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { LearningApplicationAttemptResult } from "./learningApplicationGate";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_LEARNING_APPLICATION_ATTEMPT_DIRECTORY = path.join(REPO_ROOT, "data", "learning_application_attempts");

export type LearningApplicationAttemptRecord = {
  attempt_id: string;
  created_at: string;
  recommendation_id: string;
  decision_id: string;
  source_audit_id: string;
  operator_decision: LearningApplicationAttemptResult["operator_decision"];
  gate_enabled: false;
  attempted_application: true;
  applied: false;
  blocked_reason: "learning application disabled";
};

export type LearningApplicationAttemptWriteResult = {
  status: "recorded";
  record: LearningApplicationAttemptRecord;
  output_path: string;
  append_only: true;
  applied: false;
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

function buildAttemptId(result: LearningApplicationAttemptResult, createdAt: string): string {
  const normalizedCreatedAt = createdAt.replace(/[:.]/g, "-");
  return `learning-application-attempt-${normalizedCreatedAt}-${result.decision_id}`;
}

export function buildLearningApplicationAttemptRecord(
  result: LearningApplicationAttemptResult,
  options?: { createdAt?: string },
): LearningApplicationAttemptRecord {
  const createdAt = normalizeCreatedAt(options?.createdAt);

  return {
    attempt_id: buildAttemptId(result, createdAt),
    created_at: createdAt,
    recommendation_id: result.recommendation_id,
    decision_id: result.decision_id,
    source_audit_id: result.source_audit_id,
    operator_decision: result.operator_decision,
    gate_enabled: false,
    attempted_application: true,
    applied: false,
    blocked_reason: result.blocked_reason,
  };
}

export async function recordLearningApplicationAttempt(
  record: LearningApplicationAttemptRecord,
  options?: { outputDirectory?: string },
): Promise<LearningApplicationAttemptWriteResult> {
  const outputDirectory = options?.outputDirectory?.trim() || DEFAULT_LEARNING_APPLICATION_ATTEMPT_DIRECTORY;
  const outputPath = path.join(outputDirectory, `${record.created_at.slice(0, 10) || "unknown-date"}.jsonl`);

  await mkdir(outputDirectory, { recursive: true });
  await appendFile(outputPath, `${JSON.stringify(record)}\n`, "utf-8");

  return {
    status: "recorded",
    record,
    output_path: outputPath,
    append_only: true,
    applied: false,
    execution_triggered: false,
    autonomy_triggered: false,
  };
}

export function renderLearningApplicationAttempt(record: LearningApplicationAttemptRecord): string {
  return [
    `Learning application attempt: ${record.attempt_id}`,
    `Created at: ${record.created_at}`,
    `Recommendation id: ${record.recommendation_id}`,
    `Decision id: ${record.decision_id}`,
    `Source audit: ${record.source_audit_id}`,
    `Operator decision: ${record.operator_decision}`,
    `Gate enabled: ${record.gate_enabled ? "true" : "false"}`,
    `Attempted application: ${record.attempted_application ? "true" : "false"}`,
    `Applied: ${record.applied ? "true" : "false"}`,
    `Blocked reason: ${record.blocked_reason}`,
    "Application was blocked. Audit only. No learning, ranking, plan, readiness, selection, execution, or autonomy behavior changed.",
  ].join("\n");
}