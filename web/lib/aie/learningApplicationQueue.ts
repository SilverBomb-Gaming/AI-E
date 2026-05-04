import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { LearningApplicationScope } from "./learningApplicationState";
import type { LearningRecommendationDecisionRecord } from "./learningRecommendationDecision";
import type { LearningRecommendation } from "./learningRecommendationReview";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_LEARNING_APPLICATION_QUEUE_DIRECTORY = path.join(REPO_ROOT, "data", "learning_application_queue");

export type LearningApplicationQueueStatus = "queued" | "blocked" | "applied" | "reverted";

export type LearningApplicationQueueRecord = {
  queue_id: string;
  created_at: string;
  recommendation_id: string;
  decision_id: string;
  scope: LearningApplicationScope;
  status: LearningApplicationQueueStatus;
  applied: false;
  blocked_reason?: "learning recommendation not approved" | "learning scope not allowed";
};

export type LearningApplicationQueueWriteResult = {
  status: "recorded";
  record: LearningApplicationQueueRecord;
  output_path: string;
  append_only: true;
  applied: false;
  execution_triggered: false;
  autonomy_triggered: false;
};

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isQueueRecord(value: unknown): value is LearningApplicationQueueRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<LearningApplicationQueueRecord>;
  return hasNonEmptyString(candidate.queue_id)
    && hasNonEmptyString(candidate.created_at)
    && hasNonEmptyString(candidate.recommendation_id)
    && hasNonEmptyString(candidate.decision_id)
    && candidate.scope === "ranking_weight_adjustment"
    && (candidate.status === "queued"
      || candidate.status === "blocked"
      || candidate.status === "applied"
      || candidate.status === "reverted")
    && candidate.applied === false;
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

function buildDecisionId(decision: LearningRecommendationDecisionRecord): string {
  return `${decision.recommendation_id}-${decision.operator_decision}-${decision.decided_at.replace(/[:.]/g, "-")}`;
}

function buildQueueId(record: {
  created_at: string;
  decision_id: string;
  recommendation_id: string;
}): string {
  return `learning-queue-${record.created_at.replace(/[:.]/g, "-")}-${record.decision_id}-${record.recommendation_id}`;
}

function toQueueRecord(input: {
  recommendation: LearningRecommendation;
  decision: LearningRecommendationDecisionRecord;
  createdAt: string;
  scope: LearningApplicationScope;
}): LearningApplicationQueueRecord {
  const supportedScope = input.scope === "ranking_weight_adjustment";
  const approved = input.decision.operator_decision === "approved_for_future_application";
  const status: LearningApplicationQueueStatus = approved && supportedScope ? "queued" : "blocked";
  const blockedReason = !approved
    ? "learning recommendation not approved"
    : !supportedScope
      ? "learning scope not allowed"
      : undefined;
  const decisionId = buildDecisionId(input.decision);

  return {
    queue_id: buildQueueId({
      created_at: input.createdAt,
      decision_id: decisionId,
      recommendation_id: input.recommendation.recommendation_id,
    }),
    created_at: input.createdAt,
    recommendation_id: input.recommendation.recommendation_id,
    decision_id: decisionId,
    scope: "ranking_weight_adjustment",
    status,
    applied: false,
    blocked_reason: blockedReason,
  };
}

export async function enqueueLearningApplication(
  recommendation: LearningRecommendation,
  decision: LearningRecommendationDecisionRecord,
  options?: {
    createdAt?: string;
    outputDirectory?: string;
    scope?: LearningApplicationScope;
  },
): Promise<LearningApplicationQueueWriteResult> {
  if (recommendation.applied !== false) {
    throw new Error("Learning application queue requires an unapplied recommendation.");
  }

  if (recommendation.requires_operator_review !== true) {
    throw new Error("Learning application queue requires an operator-reviewed recommendation.");
  }

  if (recommendation.recommendation_id !== decision.recommendation_id) {
    throw new Error("Learning application queue requires a matching recommendation and decision.");
  }

  const createdAt = normalizeCreatedAt(options?.createdAt);
  const scope = options?.scope ?? "ranking_weight_adjustment";
  const record = toQueueRecord({
    recommendation,
    decision,
    createdAt,
    scope,
  });
  const outputDirectory = options?.outputDirectory?.trim() || DEFAULT_LEARNING_APPLICATION_QUEUE_DIRECTORY;
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

export async function queryLearningApplicationQueue(
  filters?: {
    outputDirectory?: string;
    status?: LearningApplicationQueueStatus;
    recommendationId?: string;
    scope?: LearningApplicationScope;
  },
): Promise<LearningApplicationQueueRecord[]> {
  const outputDirectory = filters?.outputDirectory?.trim() || DEFAULT_LEARNING_APPLICATION_QUEUE_DIRECTORY;
  let fileNames: string[] = [];

  try {
    fileNames = (await readdir(outputDirectory)).filter((fileName) => fileName.endsWith(".jsonl"));
  } catch {
    return [];
  }

  const records = (await Promise.all(fileNames.sort().map(async (fileName) => {
    const payload = await readFile(path.join(outputDirectory, fileName), "utf-8");
    return payload
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line))
      .filter(isQueueRecord);
  }))).flat();

  return records.filter((record) => {
    if (filters?.status && record.status !== filters.status) {
      return false;
    }

    if (filters?.recommendationId && record.recommendation_id !== filters.recommendationId) {
      return false;
    }

    if (filters?.scope && record.scope !== filters.scope) {
      return false;
    }

    return true;
  });
}

export function renderLearningApplicationQueue(items: readonly LearningApplicationQueueRecord[]): string {
  const lines = ["Learning application queue is non-executing.", ""];

  if (items.length === 0) {
    lines.push("- No queued learning application records found.");
  } else {
    for (const item of items) {
      lines.push(`${item.status}: ${item.recommendation_id}`);
      lines.push(`- Queue id: ${item.queue_id}`);
      lines.push(`- Created at: ${item.created_at}`);
      lines.push(`- Decision id: ${item.decision_id}`);
      lines.push(`- Scope: ${item.scope}`);
      lines.push(`- Applied: ${item.applied ? "true" : "false"}`);
      if (item.blocked_reason) {
        lines.push(`- Blocked reason: ${item.blocked_reason}`);
      }
      lines.push("");
    }
  }

  lines.push("Queued items remain unapplied until an explicit learning application gate call. No execution or autonomy is triggered.");
  return lines.join("\n");
}