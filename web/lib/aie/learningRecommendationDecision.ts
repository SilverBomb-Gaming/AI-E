import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { LearningRecommendation } from "./learningRecommendationReview";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_RECOMMENDATION_DECISION_DIRECTORY = path.join(REPO_ROOT, "data", "learning_recommendation_decisions");

export type LearningRecommendationOperatorDecision = "approved_for_future_application" | "rejected";

export type LearningRecommendationDecisionRecord = {
  recommendation_id: string;
  source_audit_id: string;
  operator_decision: LearningRecommendationOperatorDecision;
  decided_at: string;
  rationale?: string;
  applied: false;
};

export type LearningRecommendationDecisionWriteResult = {
  status: "recorded";
  record: LearningRecommendationDecisionRecord;
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

function normalizeRationale(value: string | undefined): string | undefined {
  if (!hasNonEmptyString(value)) {
    return undefined;
  }

  return value.trim();
}

export async function recordLearningRecommendationDecision(
  recommendation: LearningRecommendation,
  decision: {
    operator_decision: LearningRecommendationOperatorDecision;
    decided_at?: string;
    rationale?: string;
  },
  options?: { outputDirectory?: string },
): Promise<LearningRecommendationDecisionWriteResult> {
  if (recommendation.applied !== false) {
    throw new Error("Learning recommendation decisions require an unapplied recommendation.");
  }

  if (recommendation.requires_operator_review !== true) {
    throw new Error("Learning recommendation decisions require a recommendation marked for operator review.");
  }

  if (decision.operator_decision !== "approved_for_future_application" && decision.operator_decision !== "rejected") {
    throw new Error("Learning recommendation decision must be approved_for_future_application or rejected.");
  }

  const decidedAt = hasNonEmptyString(decision.decided_at) && looksLikeIsoTimestamp(decision.decided_at)
    ? decision.decided_at.trim()
    : new Date().toISOString();
  const record: LearningRecommendationDecisionRecord = {
    recommendation_id: recommendation.recommendation_id,
    source_audit_id: recommendation.source_audit_id,
    operator_decision: decision.operator_decision,
    decided_at: decidedAt,
    rationale: normalizeRationale(decision.rationale),
    applied: false,
  };
  const outputDirectory = options?.outputDirectory?.trim() || DEFAULT_RECOMMENDATION_DECISION_DIRECTORY;
  const outputPath = path.join(outputDirectory, `${record.decided_at.slice(0, 10) || "unknown-date"}.jsonl`);

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

export function renderLearningRecommendationDecision(record: LearningRecommendationDecisionRecord): string {
  const lines = [
    `Learning recommendation decision: ${record.recommendation_id}`,
    `Source audit: ${record.source_audit_id}`,
    `Operator decision: ${record.operator_decision}`,
    `Decided at: ${record.decided_at}`,
    `Applied: ${record.applied ? "true" : "false"}`,
  ];

  if (record.rationale) {
    lines.push(`Rationale: ${record.rationale}`);
  }

  lines.push("Record only. Approval does not apply the recommendation and no ranking, plan, readiness, execution, or autonomy behavior changes occur.");
  return lines.join("\n");
}