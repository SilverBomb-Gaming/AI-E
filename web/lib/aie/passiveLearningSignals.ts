import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { DecisionRecord } from "./decisionTrace";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_LEARNING_SIGNAL_DIRECTORY = path.join(REPO_ROOT, "data", "learning_signals");

export type LearningSignalMisalignmentPattern = {
  recommended_plan_id: string;
  selected_plan_id: string;
  occurrence_count: number;
  average_error_margin: number;
  last_seen_at: string;
};

export type PassiveLearningSignals = {
  generated_at: string;
  total_records: number;
  recommendation_accuracy: number;
  average_error_margin: number;
  misalignment_patterns: LearningSignalMisalignmentPattern[];
  data_only: true;
  execution_triggered: false;
  autonomy_triggered: false;
};

export type LearningSignalWriteResult = {
  status: "recorded";
  signals: PassiveLearningSignals;
  output_path: string;
  append_only: true;
  data_only: true;
  execution_triggered: false;
  autonomy_triggered: false;
};

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function roundToThree(value: number): number {
  return Math.round(Math.max(0, value) * 1000) / 1000;
}

function cloneSignals(signals: PassiveLearningSignals): PassiveLearningSignals {
  return {
    ...signals,
    misalignment_patterns: signals.misalignment_patterns.map((pattern) => ({ ...pattern })),
  };
}

export function computeLearningSignals(
  decisionRecords: readonly DecisionRecord[],
  generatedAt?: string,
): PassiveLearningSignals {
  const eligibleRecords = decisionRecords.filter((record) => hasNonEmptyString(record.recommended_plan_id));
  const alignedCount = eligibleRecords.filter((record) => record.operator_choice_alignment).length;
  const totalErrorMargin = eligibleRecords.reduce((total, record) => total + Math.max(0, record.ranking_score_gap), 0);
  const misalignmentBuckets = new Map<string, {
    recommended_plan_id: string;
    selected_plan_id: string;
    occurrence_count: number;
    total_error_margin: number;
    last_seen_at: string;
  }>();

  for (const record of eligibleRecords) {
    if (record.operator_choice_alignment) {
      continue;
    }

    const recommendedPlanId = record.recommended_plan_id!.trim();
    const bucketKey = `${recommendedPlanId}=>${record.selected_plan_id}`;
    const existing = misalignmentBuckets.get(bucketKey);
    if (existing) {
      existing.occurrence_count += 1;
      existing.total_error_margin += Math.max(0, record.ranking_score_gap);
      if (record.timestamp.localeCompare(existing.last_seen_at) > 0) {
        existing.last_seen_at = record.timestamp;
      }
      continue;
    }

    misalignmentBuckets.set(bucketKey, {
      recommended_plan_id: recommendedPlanId,
      selected_plan_id: record.selected_plan_id,
      occurrence_count: 1,
      total_error_margin: Math.max(0, record.ranking_score_gap),
      last_seen_at: record.timestamp,
    });
  }

  return {
    generated_at: hasNonEmptyString(generatedAt) ? generatedAt.trim() : new Date().toISOString(),
    total_records: eligibleRecords.length,
    recommendation_accuracy: eligibleRecords.length === 0 ? 0 : roundToThree(alignedCount / eligibleRecords.length),
    average_error_margin: eligibleRecords.length === 0 ? 0 : roundToThree(totalErrorMargin / eligibleRecords.length),
    misalignment_patterns: [...misalignmentBuckets.values()]
      .map((pattern) => ({
        recommended_plan_id: pattern.recommended_plan_id,
        selected_plan_id: pattern.selected_plan_id,
        occurrence_count: pattern.occurrence_count,
        average_error_margin: roundToThree(pattern.total_error_margin / pattern.occurrence_count),
        last_seen_at: pattern.last_seen_at,
      }))
      .sort((left, right) => right.occurrence_count - left.occurrence_count || right.last_seen_at.localeCompare(left.last_seen_at)),
    data_only: true,
    execution_triggered: false,
    autonomy_triggered: false,
  };
}

export async function recordLearningSignals(
  signals: PassiveLearningSignals,
  options?: { outputDirectory?: string },
): Promise<LearningSignalWriteResult> {
  const normalizedSignals = cloneSignals(signals);
  const outputDirectory = options?.outputDirectory?.trim() || DEFAULT_LEARNING_SIGNAL_DIRECTORY;
  const outputPath = path.join(outputDirectory, `${normalizedSignals.generated_at.slice(0, 10) || "unknown-date"}.jsonl`);

  await mkdir(outputDirectory, { recursive: true });
  await appendFile(outputPath, `${JSON.stringify(normalizedSignals)}\n`, "utf-8");

  return {
    status: "recorded",
    signals: normalizedSignals,
    output_path: outputPath,
    append_only: true,
    data_only: true,
    execution_triggered: false,
    autonomy_triggered: false,
  };
}