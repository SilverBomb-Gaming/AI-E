import { type ExecutionInsight, summarizeExecutionInsights } from "./executionInsight";

export type ExecutionInsightRenderResult = {
  console_output: string;
  summary: string;
  display_only: true;
  execution_triggered: false;
  approval_triggered: false;
  autonomy_triggered: false;
};

function toTitleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function categoryHeading(category: ExecutionInsight["category"]): string {
  switch (category) {
    case "performance":
      return "Node Reliability Summary";
    case "pattern":
      return "Failure Pattern Summary";
    case "risk":
      return "Rollback Frequency Summary";
    case "reliability":
      return "Risk-Level Insights";
    default:
      return "Execution Insights";
  }
}

function formatMetrics(metrics: Record<string, number>): string[] {
  return Object.entries(metrics)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `  - ${toTitleCase(key)}: ${value}`);
}

function renderSeverity(severity: ExecutionInsight["severity"]): string {
  return `[${severity.toUpperCase()}]`;
}

export function renderExecutionInsights(insights: readonly ExecutionInsight[]): ExecutionInsightRenderResult {
  const summary = summarizeExecutionInsights(insights);

  if (insights.length === 0) {
    return {
      console_output: [
        "AI-E Execution Insights",
        "=======================",
        "No execution insights available.",
      ].join("\n"),
      summary,
      display_only: true,
      execution_triggered: false,
      approval_triggered: false,
      autonomy_triggered: false,
    };
  }

  const headings = new Map<ExecutionInsight["category"], string>([
    ["performance", categoryHeading("performance")],
    ["pattern", categoryHeading("pattern")],
    ["risk", categoryHeading("risk")],
    ["reliability", categoryHeading("reliability")],
  ]);

  const lines: string[] = [
    "AI-E Execution Insights",
    "=======================",
    `Generated from ${insights.length} insight${insights.length === 1 ? "" : "s"}.`,
    "",
  ];

  for (const category of ["performance", "pattern", "risk", "reliability"] as const) {
    const matchingInsights = insights.filter((insight) => insight.category === category);
    if (matchingInsights.length === 0) {
      continue;
    }

    lines.push(headings.get(category) ?? "Execution Insights");
    lines.push("-".repeat((headings.get(category) ?? "Execution Insights").length));
    for (const insight of matchingInsights) {
      lines.push(`- ${renderSeverity(insight.severity)} ${insight.description}`);
      lines.push(`  Confidence: ${insight.confidence.toFixed(2)}`);
      lines.push(...formatMetrics(insight.supporting_metrics));
    }
    lines.push("");
  }

  lines.push("Readable Summary");
  lines.push("----------------");
  lines.push(summary);

  return {
    console_output: lines.join("\n"),
    summary,
    display_only: true,
    execution_triggered: false,
    approval_triggered: false,
    autonomy_triggered: false,
  };
}