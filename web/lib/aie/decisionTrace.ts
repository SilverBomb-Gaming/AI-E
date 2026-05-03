import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  listPlanSelectionOptions,
  type CoreNodePipelineDraftPlan,
  type CoreNodeTaskTranslationPlan,
  type NodeAdvisoryPlan,
  type NodePlanAnnotation,
  type NodePlanOperatorAcknowledgement,
  type NodePlanSelectionOption,
} from "./nodeBoundary";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_DECISION_RECORD_DIRECTORY = path.join(REPO_ROOT, "data", "decision_records");

export type DecisionReplayPlanOption = NodePlanSelectionOption & {
  selected: boolean;
};

export type DecisionReplayInsight = {
  insight_id: string;
  type: NodePlanAnnotation["type"];
  severity: NodePlanAnnotation["severity"];
  message: string;
  suggestion?: string;
  alternative_plan_id?: string;
};

export type DecisionReplayContext = {
  original_plan: DecisionReplayPlanOption;
  available_plans: DecisionReplayPlanOption[];
  selected_plan: DecisionReplayPlanOption;
  insights: DecisionReplayInsight[];
};

export type DecisionRecord = {
  decision_id: string;
  timestamp: string;
  selected_plan_id: string;
  recommended_plan_id?: string;
  ranking_score_gap: number;
  operator_choice_alignment: boolean;
  available_plan_ids: string[];
  insight_summary: string[];
  severity_summary: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  operator_acknowledgement: NodePlanOperatorAcknowledgement;
  decision_context?: DecisionReplayContext;
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

export type DecisionRecordQueryFilters = {
  outputDirectory?: string;
  selected_plan_id?: string;
  available_plan_id?: string;
  acknowledged?: boolean;
  minimum_severity?: keyof DecisionRecord["severity_summary"];
  limit?: number;
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

function cloneDecisionReplayPlanOption(option: DecisionReplayPlanOption): DecisionReplayPlanOption {
  return {
    ...option,
    steps: [...option.steps],
  };
}

function cloneDecisionReplayInsight(insight: DecisionReplayInsight): DecisionReplayInsight {
  return { ...insight };
}

function normalizeDecisionReplayPlanOption(
  option: unknown,
  selectedPlanId: string,
): DecisionReplayPlanOption | null {
  if (!option || typeof option !== "object" || Array.isArray(option)) {
    return null;
  }

  const candidate = option as Record<string, unknown>;
  if (
    !hasNonEmptyString(candidate.plan_id)
    || !hasNonEmptyString(candidate.label)
    || (candidate.source !== "original" && candidate.source !== "alternative")
  ) {
    return null;
  }

  return {
    plan_id: candidate.plan_id.trim(),
    label: candidate.label.trim(),
    source: candidate.source,
    command: hasNonEmptyString(candidate.command) ? candidate.command.trim() : undefined,
    steps: normalizeStringList(candidate.steps),
    selected: candidate.selected === true || candidate.plan_id.trim() === selectedPlanId,
  };
}

function normalizeDecisionReplayInsight(insight: unknown): DecisionReplayInsight | null {
  if (!insight || typeof insight !== "object" || Array.isArray(insight)) {
    return null;
  }

  const candidate = insight as Record<string, unknown>;
  if (
    !hasNonEmptyString(candidate.insight_id)
    || !hasNonEmptyString(candidate.type)
    || !hasNonEmptyString(candidate.severity)
    || !hasNonEmptyString(candidate.message)
  ) {
    return null;
  }

  return {
    insight_id: candidate.insight_id.trim(),
    type: candidate.type as NodePlanAnnotation["type"],
    severity: candidate.severity as NodePlanAnnotation["severity"],
    message: candidate.message.trim(),
    suggestion: hasNonEmptyString(candidate.suggestion) ? candidate.suggestion.trim() : undefined,
    alternative_plan_id: hasNonEmptyString(candidate.alternative_plan_id) ? candidate.alternative_plan_id.trim() : undefined,
  };
}

function buildReplayInsights(annotations: NodePlanAnnotation[] | undefined): DecisionReplayInsight[] {
  if (!Array.isArray(annotations)) {
    return [];
  }

  return annotations.map((annotation) => ({
    insight_id: annotation.insight_id,
    type: annotation.type,
    severity: annotation.severity,
    message: annotation.message,
    suggestion: annotation.suggestion,
    alternative_plan_id: annotation.alternative_plan?.plan_id,
  }));
}

function buildDecisionReplayContext(plan: SelectablePlan, selectedPlanId: string): DecisionReplayContext {
  const availablePlans = listPlanSelectionOptions(plan).map((option) => ({
    ...option,
    steps: [...option.steps],
    selected: option.plan_id === selectedPlanId,
  }));
  const originalPlan = availablePlans.find((option) => option.source === "original") ?? {
    plan_id: plan.plan_id,
    label: "Original plan",
    source: "original" as const,
    command: "command" in plan && hasNonEmptyString(plan.command) ? plan.command : undefined,
    steps: "command" in plan && hasNonEmptyString(plan.command) ? [`run ${plan.command}`] : ["review the current bounded plan"],
    selected: plan.plan_id === selectedPlanId,
  };
  const selectedPlan = availablePlans.find((option) => option.plan_id === selectedPlanId) ?? originalPlan;

  return {
    original_plan: cloneDecisionReplayPlanOption(originalPlan),
    available_plans: availablePlans.map(cloneDecisionReplayPlanOption),
    selected_plan: cloneDecisionReplayPlanOption(selectedPlan),
    insights: buildReplayInsights(plan.annotations).map(cloneDecisionReplayInsight),
  };
}

function normalizeDecisionReplayContext(value: unknown, selectedPlanId: string): DecisionReplayContext | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const availablePlans = Array.isArray(candidate.available_plans)
    ? candidate.available_plans
      .map((option) => normalizeDecisionReplayPlanOption(option, selectedPlanId))
      .filter((option): option is DecisionReplayPlanOption => option !== null)
    : [];
  const originalPlan = normalizeDecisionReplayPlanOption(candidate.original_plan, selectedPlanId);
  const selectedPlan = normalizeDecisionReplayPlanOption(candidate.selected_plan, selectedPlanId);
  const insights = Array.isArray(candidate.insights)
    ? candidate.insights
      .map((insight) => normalizeDecisionReplayInsight(insight))
      .filter((insight): insight is DecisionReplayInsight => insight !== null)
    : [];

  if (!originalPlan || !selectedPlan || availablePlans.length === 0) {
    return undefined;
  }

  return {
    original_plan: cloneDecisionReplayPlanOption(originalPlan),
    available_plans: availablePlans.map(cloneDecisionReplayPlanOption),
    selected_plan: cloneDecisionReplayPlanOption(selectedPlan),
    insights: insights.map(cloneDecisionReplayInsight),
  };
}

function compareSeverity(
  severity: keyof DecisionRecord["severity_summary"],
  minimumSeverity: keyof DecisionRecord["severity_summary"],
): boolean {
  const order: Array<keyof DecisionRecord["severity_summary"]> = ["low", "medium", "high", "critical"];
  return order.indexOf(severity) >= order.indexOf(minimumSeverity);
}

function hasSeverityAtOrAbove(
  summary: DecisionRecord["severity_summary"],
  minimumSeverity: keyof DecisionRecord["severity_summary"],
): boolean {
  return (Object.keys(summary) as Array<keyof DecisionRecord["severity_summary"]>)
    .some((severity) => summary[severity] > 0 && compareSeverity(severity, minimumSeverity));
}

function normalizeRankingScoreGap(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }

  return Math.round(numeric * 1000) / 1000;
}

function buildOperatorFeedbackFields(plan: SelectablePlan, selectedPlanId: string): Pick<DecisionRecord, "recommended_plan_id" | "ranking_score_gap" | "operator_choice_alignment"> {
  if (plan.operator_feedback_capture) {
    return {
      recommended_plan_id: hasNonEmptyString(plan.operator_feedback_capture.recommended_plan_id)
        ? plan.operator_feedback_capture.recommended_plan_id.trim()
        : undefined,
      ranking_score_gap: normalizeRankingScoreGap(plan.operator_feedback_capture.ranking_score_gap),
      operator_choice_alignment: plan.operator_feedback_capture.operator_choice_alignment === true,
    };
  }

  const recommended = plan.plan_rankings?.[0];
  const selectedRanking = plan.plan_rankings?.find((ranking) => ranking.plan_id === selectedPlanId);
  const selectedScore = selectedRanking?.score ?? 0;
  const recommendedScore = recommended?.score ?? 0;

  return {
    recommended_plan_id: hasNonEmptyString(recommended?.plan_id) ? recommended.plan_id.trim() : undefined,
    ranking_score_gap: normalizeRankingScoreGap(recommendedScore - selectedScore),
    operator_choice_alignment: recommended?.plan_id === selectedPlanId,
  };
}

export function buildDecisionRecord(
  plan: SelectablePlan,
  timestamp?: string,
): DecisionRecord {
  if (plan.execution_intent_locked === true && plan.decision_record) {
    return {
      decision_id: plan.decision_record.decision_id,
      timestamp: plan.decision_record.timestamp,
      selected_plan_id: plan.decision_record.selected_plan_id,
      recommended_plan_id: plan.decision_record.recommended_plan_id,
      ranking_score_gap: plan.decision_record.ranking_score_gap,
      operator_choice_alignment: plan.decision_record.operator_choice_alignment,
      available_plan_ids: [...plan.decision_record.available_plan_ids],
      insight_summary: [...plan.decision_record.insight_summary],
      severity_summary: { ...plan.decision_record.severity_summary },
      operator_acknowledgement: { ...plan.decision_record.operator_acknowledgement },
      decision_context: plan.decision_record.decision_context
        ? {
          original_plan: {
            ...plan.decision_record.decision_context.original_plan,
            steps: [...plan.decision_record.decision_context.original_plan.steps],
          },
          available_plans: plan.decision_record.decision_context.available_plans.map((option) => ({
            ...option,
            steps: [...option.steps],
          })),
          selected_plan: {
            ...plan.decision_record.decision_context.selected_plan,
            steps: [...plan.decision_record.decision_context.selected_plan.steps],
          },
          insights: plan.decision_record.decision_context.insights.map((insight) => ({ ...insight })),
        }
        : undefined,
    };
  }

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
  const operatorFeedback = buildOperatorFeedbackFields(plan, selectedPlanId);

  return {
    decision_id: `decision-${sanitizeIdentifier(selectedPlanId)}-${normalizedTimestamp.replace(/[:.]/g, "-")}`,
    timestamp: normalizedTimestamp,
    selected_plan_id: selectedPlanId,
    recommended_plan_id: operatorFeedback.recommended_plan_id,
    ranking_score_gap: operatorFeedback.ranking_score_gap,
    operator_choice_alignment: operatorFeedback.operator_choice_alignment,
    available_plan_ids: availablePlanIds,
    insight_summary: summarizeInsights(plan.annotations),
    severity_summary: summarizeSeverities(plan.annotations),
    operator_acknowledgement: normalizeOperatorAcknowledgement(plan.operator_acknowledgement),
    decision_context: buildDecisionReplayContext(plan, selectedPlanId),
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

  const recommendedPlanId = hasNonEmptyString(candidate.recommended_plan_id) ? candidate.recommended_plan_id.trim() : undefined;
  const rankingScoreGap = normalizeRankingScoreGap(candidate.ranking_score_gap);
  const operatorChoiceAlignment = candidate.operator_choice_alignment === true;

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
      recommended_plan_id: recommendedPlanId,
      ranking_score_gap: rankingScoreGap,
      operator_choice_alignment: operatorChoiceAlignment,
      available_plan_ids: availablePlanIds,
      insight_summary: insightSummary,
      severity_summary: normalizedSeveritySummary,
      operator_acknowledgement: acknowledgement,
      decision_context: normalizeDecisionReplayContext(candidate.decision_context, candidate.selected_plan_id.trim()),
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

export async function queryDecisionRecords(filters: DecisionRecordQueryFilters = {}): Promise<DecisionRecord[]> {
  const outputDirectory = filters.outputDirectory?.trim() || DEFAULT_DECISION_RECORD_DIRECTORY;

  try {
    const entries = await readdir(outputDirectory, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => entry.name)
      .sort();

    const records: DecisionRecord[] = [];
    for (const fileName of files) {
      const payload = await readFile(path.join(outputDirectory, fileName), "utf-8");
      for (const line of payload.split(/\r?\n/)) {
        if (!line.trim()) {
          continue;
        }

        const parsed = JSON.parse(line) as unknown;
        const validation = validateDecisionRecord(parsed);
        if (validation.ok && validation.record) {
          records.push(validation.record);
        }
      }
    }

    let filtered = records.sort((left, right) => right.timestamp.localeCompare(left.timestamp));

    if (hasNonEmptyString(filters.selected_plan_id)) {
      filtered = filtered.filter((record) => record.selected_plan_id === filters.selected_plan_id?.trim());
    }

    if (hasNonEmptyString(filters.available_plan_id)) {
      filtered = filtered.filter((record) => record.available_plan_ids.includes(filters.available_plan_id?.trim() ?? ""));
    }

    if (typeof filters.acknowledged === "boolean") {
      filtered = filtered.filter((record) => record.operator_acknowledgement.acknowledged === filters.acknowledged);
    }

    if (filters.minimum_severity) {
      filtered = filtered.filter((record) => hasSeverityAtOrAbove(record.severity_summary, filters.minimum_severity));
    }

    if (typeof filters.limit === "number" && Number.isFinite(filters.limit) && filters.limit >= 0) {
      filtered = filtered.slice(0, filters.limit);
    }

    return filtered.map((record) => ({
      ...record,
      available_plan_ids: [...record.available_plan_ids],
      insight_summary: [...record.insight_summary],
      severity_summary: { ...record.severity_summary },
      operator_acknowledgement: { ...record.operator_acknowledgement },
      decision_context: record.decision_context
        ? {
          original_plan: cloneDecisionReplayPlanOption(record.decision_context.original_plan),
          available_plans: record.decision_context.available_plans.map(cloneDecisionReplayPlanOption),
          selected_plan: cloneDecisionReplayPlanOption(record.decision_context.selected_plan),
          insights: record.decision_context.insights.map(cloneDecisionReplayInsight),
        }
        : undefined,
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export function renderDecisionReplay(record: DecisionRecord): string {
  const validation = validateDecisionRecord(record);
  if (!validation.ok || !validation.record) {
    throw new Error(validation.reason ?? "Decision record validation failed.");
  }

  const normalizedRecord = validation.record;
  const context = normalizedRecord.decision_context;
  const lines = [
    `Decision replay: ${normalizedRecord.decision_id}`,
    `Timestamp: ${normalizedRecord.timestamp}`,
    `Selected plan id: ${normalizedRecord.selected_plan_id}`,
    `Acknowledged: ${normalizedRecord.operator_acknowledgement.acknowledged ? "yes" : "no"}${normalizedRecord.operator_acknowledgement.acknowledged_at ? ` at ${normalizedRecord.operator_acknowledgement.acknowledged_at}` : ""}`,
    "",
    "Severity summary:",
    `- low: ${normalizedRecord.severity_summary.low}`,
    `- medium: ${normalizedRecord.severity_summary.medium}`,
    `- high: ${normalizedRecord.severity_summary.high}`,
    `- critical: ${normalizedRecord.severity_summary.critical}`,
    "",
    "Original plan:",
  ];

  if (context) {
    lines.push(`- [${context.original_plan.plan_id}] ${context.original_plan.label}${context.original_plan.selected ? " (selected)" : ""}`);
    if (context.original_plan.command) {
      lines.push(`  Command: ${context.original_plan.command}`);
    }
    for (const step of context.original_plan.steps) {
      lines.push(`  Step: ${step}`);
    }
  } else {
    lines.push(`- [${normalizedRecord.available_plan_ids[0] ?? "unknown"}] replay context unavailable in this stored record`);
  }

  lines.push("");
  lines.push("Available alternatives:");
  if (context) {
    for (const option of context.available_plans.filter((option) => option.source === "alternative")) {
      lines.push(`- [${option.plan_id}] ${option.label}${option.selected ? " (selected)" : ""}`);
      if (option.command) {
        lines.push(`  Command: ${option.command}`);
      }
      for (const step of option.steps) {
        lines.push(`  Step: ${step}`);
      }
    }
  } else if (normalizedRecord.available_plan_ids.length > 1) {
    for (const planId of normalizedRecord.available_plan_ids.filter((planId) => planId !== normalizedRecord.available_plan_ids[0])) {
      lines.push(`- [${planId}] context unavailable in this stored record`);
    }
  } else {
    lines.push("- none recorded");
  }

  lines.push("");
  lines.push("Insights at decision time:");
  if (context && context.insights.length > 0) {
    for (const insight of context.insights) {
      lines.push(`- [${insight.severity.toUpperCase()}] ${insight.message}`);
      if (insight.suggestion) {
        lines.push(`  Suggestion: ${insight.suggestion}`);
      }
      if (insight.alternative_plan_id) {
        lines.push(`  Alternative plan id: ${insight.alternative_plan_id}`);
      }
    }
  } else if (normalizedRecord.insight_summary.length > 0) {
    for (const summary of normalizedRecord.insight_summary) {
      lines.push(`- ${summary}`);
    }
  } else {
    lines.push("- none recorded");
  }

  lines.push("");
  lines.push("Selected plan:");
  if (context) {
    lines.push(`- [${context.selected_plan.plan_id}] ${context.selected_plan.label}`);
    if (context.selected_plan.command) {
      lines.push(`  Command: ${context.selected_plan.command}`);
    }
    for (const step of context.selected_plan.steps) {
      lines.push(`  Step: ${step}`);
    }
  } else {
    lines.push(`- [${normalizedRecord.selected_plan_id}] context unavailable in this stored record`);
  }

  lines.push("");
  lines.push("Read-only replay only. No plan mutation, execution, or state updates occur.");
  return lines.join("\n");
}