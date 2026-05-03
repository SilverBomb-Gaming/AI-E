import type {
  CoreNodePipelineDraftPlan,
  CoreNodeTaskTranslationPlan,
  NodeAdvisoryPlan,
  NodePlanAnnotation,
} from "./nodeBoundary";
import type { ExecutionReadinessReview } from "./executionReadinessReview";

type SelectablePlan = NodeAdvisoryPlan | CoreNodeTaskTranslationPlan | CoreNodePipelineDraftPlan;

export type PreExecutionSummary = {
  selected_plan_summary: string;
  alternative_summary: string[];
  insight_summary: string[];
  severity_summary: {
    low: number;
    medium: number;
    high: number;
    critical: number;
    highest_severity: ExecutionReadinessReview["highest_severity"];
  };
  acknowledgement_status: ExecutionReadinessReview["acknowledgement_status"];
  decision_record_status: ExecutionReadinessReview["decision_record_status"];
  confirmation_status: ExecutionReadinessReview["confirmation_status"];
  readiness_status: ExecutionReadinessReview["readiness_status"];
};

function summarizeAlternatives(plan: SelectablePlan): string[] {
  const alternatives = Array.isArray(plan.annotations)
    ? plan.annotations
      .filter((annotation) => annotation.type === "plan_adjustment" && annotation.alternative_plan)
      .map((annotation) => {
        const alternativePlan = annotation.alternative_plan!;
        const summaryParts = [`[${alternativePlan.plan_id}] ${alternativePlan.label}`];
        if (typeof alternativePlan.command === "string" && alternativePlan.command.trim().length > 0) {
          summaryParts.push(`command: ${alternativePlan.command.trim()}`);
        } else if (alternativePlan.steps.length > 0) {
          summaryParts.push(`step: ${alternativePlan.steps[0]}`);
        }
        return summaryParts.join(" | ");
      })
    : [];

  return [...new Set(alternatives)];
}

function summarizeInsights(annotations: NodePlanAnnotation[] | undefined): string[] {
  if (!Array.isArray(annotations)) {
    return [];
  }

  const summaries: string[] = [];
  for (const annotation of annotations) {
    if (annotation.type === "plan_adjustment") {
      continue;
    }

    const summary = annotation.suggestion
      ? `[${annotation.severity.toUpperCase()}] ${annotation.message} | ${annotation.suggestion}`
      : `[${annotation.severity.toUpperCase()}] ${annotation.message}`;

    if (!summaries.includes(summary)) {
      summaries.push(summary);
    }
  }

  return summaries;
}

function summarizeSeverities(annotations: NodePlanAnnotation[] | undefined): PreExecutionSummary["severity_summary"] {
  const summary: PreExecutionSummary["severity_summary"] = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
    highest_severity: "none",
  };

  if (!Array.isArray(annotations) || annotations.length === 0) {
    return summary;
  }

  const order: Array<NodePlanAnnotation["severity"]> = ["low", "medium", "high", "critical"];
  let highest: NodePlanAnnotation["severity"] = "low";

  for (const annotation of annotations) {
    summary[annotation.severity] += 1;
    if (order.indexOf(annotation.severity) > order.indexOf(highest)) {
      highest = annotation.severity;
    }
  }

  summary.highest_severity = highest;
  return summary;
}

export function buildPreExecutionSummary(
  plan: SelectablePlan,
  readinessReview: ExecutionReadinessReview,
): PreExecutionSummary {
  return {
    selected_plan_summary: readinessReview.selected_plan_summary,
    alternative_summary: summarizeAlternatives(plan),
    insight_summary: summarizeInsights(plan.annotations),
    severity_summary: summarizeSeverities(plan.annotations),
    acknowledgement_status: readinessReview.acknowledgement_status,
    decision_record_status: readinessReview.decision_record_status,
    confirmation_status: readinessReview.confirmation_status,
    readiness_status: readinessReview.readiness_status,
  };
}

export function renderPreExecutionSummary(summary: PreExecutionSummary): string {
  const lines = [
    "Pre-execution summary review:",
    `- Selected plan: ${summary.selected_plan_summary}`,
    `- Readiness status: ${summary.readiness_status}`,
    `- Acknowledgement status: ${summary.acknowledgement_status}`,
    `- Decision record status: ${summary.decision_record_status}`,
    `- Confirmation status: ${summary.confirmation_status}`,
    `- Severity summary: low=${summary.severity_summary.low}, medium=${summary.severity_summary.medium}, high=${summary.severity_summary.high}, critical=${summary.severity_summary.critical}, highest=${summary.severity_summary.highest_severity}`,
    "",
    "Alternatives considered:",
  ];

  if (summary.alternative_summary.length === 0) {
    lines.push("- No suggested alternatives recorded.");
  } else {
    for (const alternative of summary.alternative_summary) {
      lines.push(`- ${alternative}`);
    }
  }

  lines.push("");
  lines.push("Insight summary:");

  if (summary.insight_summary.length === 0) {
    lines.push("- No insight annotations recorded.");
  } else {
    for (const insight of summary.insight_summary) {
      lines.push(`- ${insight}`);
    }
  }

  lines.push("");
  lines.push("Read-only review only. No submission, execution, plan mutation, or auto-confirmation occurs.");
  return lines.join("\n");
}