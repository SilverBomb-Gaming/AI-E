import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { LearningApplicationReversionResult, LearningApplicationScope } from "./learningApplicationState";
import type { LearningStabilityGuardStatus } from "./learningStabilityGuard";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_LEARNING_REVERSION_DIRECTORY = path.join(REPO_ROOT, "data", "learning_reversions");

export type LearningReversionRecord = {
  reversion_id: string;
  created_at: string;
  reverted_application_id: string;
  scope: LearningApplicationScope;
  previous_value: number;
  restored_value: number;
  drift_state_before: LearningStabilityGuardStatus;
  drift_state_after: LearningStabilityGuardStatus;
  reverted: true;
};

export type LearningReversionWriteResult = {
  status: "recorded";
  record: LearningReversionRecord;
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

function buildReversionId(revertedApplicationId: string, createdAt: string): string {
  return `learning-reversion-${createdAt.replace(/[:.]/g, "-")}-${revertedApplicationId}`;
}

export function buildLearningReversionRecord(
  input: LearningApplicationReversionResult,
  options?: { createdAt?: string },
): LearningReversionRecord {
  if (input.reverted !== true || !hasNonEmptyString(input.reverted_application_id)) {
    throw new Error("Only completed learning reversions can be recorded.");
  }

  const createdAt = normalizeCreatedAt(options?.createdAt);

  return {
    reversion_id: buildReversionId(input.reverted_application_id, createdAt),
    created_at: createdAt,
    reverted_application_id: input.reverted_application_id,
    scope: input.scope,
    previous_value: input.previous_value,
    restored_value: input.restored_value,
    drift_state_before: input.drift_state_before,
    drift_state_after: input.drift_state_after,
    reverted: true,
  };
}

export async function recordLearningReversion(
  record: LearningReversionRecord,
  options?: { outputDirectory?: string },
): Promise<LearningReversionWriteResult> {
  const outputDirectory = options?.outputDirectory?.trim() || DEFAULT_LEARNING_REVERSION_DIRECTORY;
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

export function renderLearningReversion(record: LearningReversionRecord): string {
  return [
    `Learning reversion: ${record.reversion_id}`,
    `Created at: ${record.created_at}`,
    `Reverted application id: ${record.reverted_application_id}`,
    `Scope: ${record.scope}`,
    `Previous value: ${record.previous_value}`,
    `Restored value: ${record.restored_value}`,
    `Drift before: detected=${record.drift_state_before.drift_detected} cumulative=${record.drift_state_before.cumulative_adjustment_magnitude}`,
    `Drift after: detected=${record.drift_state_after.drift_detected} cumulative=${record.drift_state_after.cumulative_adjustment_magnitude}`,
    "Reverted: true",
    "Reversion was recorded append-only. No new learning scope, execution behavior, plan mutation, readiness change, or autonomy was introduced.",
  ].join("\n");
}