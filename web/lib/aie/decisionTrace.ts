import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  listPlanSelectionOptions,
  type CoreNodePipelineDraftPlan,
  type CoreNodeTaskTranslationPlan,
  type NodeAdvisoryPlan,
  type NodePlanAnnotation,
  type NodePlanOperatorAcknowledgement,
} from "./nodeBoundary";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_DECISION_RECORD_DIRECTORY = path.join(REPO_ROOT, "data", "decision_records");

export type DecisionRecord = {
  decision_id: string;
  timestamp: string;
  selected_plan_id: string;
  available_plan_ids: string[];
  insight_summary: string[];
  severity_summary: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  operator_acknowledgement: NodePlanOperatorAcknowledgement;
};

export type DecisionRecordValidationResult = {
  ok: boolean;
  reason: string | null;
  record: DecisionRecord | null;
};

export type DecisionRecordWriteResult = {
  status: "recorded";
  record: DecisionRecord;
  output_path: string;
  append_only: true;
  autonomy_triggered: false;
  execution_triggered: false;
  approval_triggered: false;
};

type SelectablePlan = NodeAdvisoryPlan | CoreNodeTaskTranslationPlan | CoreNodePipelineDraftPlan;

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

function normalizeOperatorAcknowledgement(value: unknown): NodePlanOperatorAcknowledgement {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { acknowledged: false };
  }

  const candidate = value as Record<string, unknown>;
  return {
    acknowledged: candidate.acknowledged === true,
    acknowledged_at: hasNonEmptyString(candidate.acknowledged_at) ? candidate.acknowledged_at.trim() : undefined,
  };
}

function sanitizeIdentifier(value: string): string {
  const sanitized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "decision";
}

function summarizeInsights(annotations: NodePlanAnnotation[] | undefined): string[] {
  if (!Array.isArray(annotations)) {
    return [];
  }

  const summaries: string[] = [];
  for (const annotation of annotations) {
    const summary = annotation.suggestion
      ? `[${annotation.severity.toUpperCase()}] ${annotation.message} | ${annotation.suggestion}`
      : `[${annotation.severity.toUpperCase()}] ${annotation.message}`;

    if (!summaries.includes(summary)) {
      summaries.push(summary);
    }
  }

  return summaries;
}

function summarizeSeverities(annotations: NodePlanAnnotation[] | undefined): DecisionRecord["severity_summary"] {
  const summary: DecisionRecord["severity_summary"] = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };

  if (!Array.isArray(annotations)) {
    return summary;
  }

  for (const annotation of annotations) {
    summary[annotation.severity] += 1;
  }

  return summary;
}

export function buildDecisionRecord(
  plan: SelectablePlan,
  timestamp?: string,
): DecisionRecord {
  const selectedPlanId = hasNonEmptyString(plan.selected_plan_id) ? plan.selected_plan_id.trim() : "";
  if (!selectedPlanId) {
    throw new Error("Decision record requires an explicitly selected plan id.");
  }

  const availablePlanIds = listPlanSelectionOptions(plan).map((option) => option.plan_id);
  if (!availablePlanIds.includes(selectedPlanId)) {
    throw new Error("Decision record selected_plan_id must match the original plan or one suggested alternative.");
  }

  const normalizedTimestamp = hasNonEmptyString(timestamp) && isIsoLikeTimestamp(timestamp)
    ? timestamp.trim()
    : new Date().toISOString();

  return {
    decision_id: `decision-${sanitizeIdentifier(selectedPlanId)}-${normalizedTimestamp.replace(/[:.]/g, "-")}`,
    timestamp: normalizedTimestamp,
    selected_plan_id: selectedPlanId,
    available_plan_ids: availablePlanIds,
    insight_summary: summarizeInsights(plan.annotations),
    severity_summary: summarizeSeverities(plan.annotations),
    operator_acknowledgement: normalizeOperatorAcknowledgement(plan.operator_acknowledgement),
  };
}

export function validateDecisionRecord(record: unknown): DecisionRecordValidationResult {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return {
      ok: false,
      reason: "Decision record must be a JSON object.",
      record: null,
    };
  }

  const candidate = record as Record<string, unknown>;
  const availablePlanIds = normalizeStringList(candidate.available_plan_ids);
  const insightSummary = normalizeStringList(candidate.insight_summary);
  const acknowledgement = normalizeOperatorAcknowledgement(candidate.operator_acknowledgement);
  const severitySummary = candidate.severity_summary && typeof candidate.severity_summary === "object" && !Array.isArray(candidate.severity_summary)
    ? candidate.severity_summary as Record<string, unknown>
    : null;

  if (
    !hasNonEmptyString(candidate.decision_id)
    || !hasNonEmptyString(candidate.timestamp)
    || !isIsoLikeTimestamp(candidate.timestamp)
    || !hasNonEmptyString(candidate.selected_plan_id)
    || availablePlanIds.length === 0
    || !availablePlanIds.includes(candidate.selected_plan_id.trim())
    || !severitySummary
  ) {
    return {
      ok: false,
      reason: "Decision record is missing required durable fields.",
      record: null,
    };
  }

  const normalizedSeveritySummary = {
    low: Number(severitySummary.low),
    medium: Number(severitySummary.medium),
    high: Number(severitySummary.high),
    critical: Number(severitySummary.critical),
  };

  if (Object.values(normalizedSeveritySummary).some((value) => !Number.isInteger(value) || value < 0)) {
    return {
      ok: false,
      reason: "Decision record severity_summary is invalid.",
      record: null,
    };
  }

  return {
    ok: true,
    reason: null,
    record: {
      decision_id: candidate.decision_id.trim(),
      timestamp: candidate.timestamp.trim(),
      selected_plan_id: candidate.selected_plan_id.trim(),
      available_plan_ids: availablePlanIds,
      insight_summary: insightSummary,
      severity_summary: normalizedSeveritySummary,
      operator_acknowledgement: acknowledgement,
    },
  };
}

export function serializeDecisionRecord(record: DecisionRecord): string {
  const validation = validateDecisionRecord(record);
  if (!validation.ok || !validation.record) {
    throw new Error(validation.reason ?? "Decision record validation failed.");
  }

  return JSON.stringify(validation.record, null, 2);
}

export async function recordDecisionTrace(
  record: DecisionRecord,
  options?: { outputDirectory?: string },
): Promise<DecisionRecordWriteResult> {
  const validation = validateDecisionRecord(record);
  if (!validation.ok || !validation.record) {
    throw new Error(validation.reason ?? "Decision record validation failed.");
  }

  const outputDirectory = options?.outputDirectory?.trim() || DEFAULT_DECISION_RECORD_DIRECTORY;
  const outputPath = path.join(outputDirectory, `${validation.record.timestamp.slice(0, 10) || "unknown-date"}.jsonl`);
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