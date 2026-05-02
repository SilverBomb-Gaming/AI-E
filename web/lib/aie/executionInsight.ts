import { type ExecutionOutcomeRecord } from "./executionOutcome";

export type ExecutionInsight = {
  insight_id: string;
  created_at: string;
  category: "performance" | "risk" | "reliability" | "pattern";
  description: string;
  supporting_metrics: Record<string, number>;
  confidence: number;
};

export type ExecutionOutcomeAnalytics = {
  total_outcomes: number;
  node_performance: Array<{
    node_id: string;
    total: number;
    success_count: number;
    failure_count: number;
    success_rate: number;
  }>;
  command_performance: Array<{
    command_pattern: string;
    total: number;
    success_count: number;
    failure_count: number;
    success_rate: number;
    failure_rate: number;
  }>;
  rollback_frequency: {
    total: number;
    rollback_required_count: number;
    rollback_executed_count: number;
    rollback_required_rate: number;
    rollback_executed_rate: number;
  };
  risk_correlation: Array<{
    risk_level: "low" | "medium" | "high";
    total: number;
    success_count: number;
    failure_count: number;
    success_rate: number;
    failure_rate: number;
    rollback_required_rate: number;
  }>;
};

type AggregateBucket = {
  total: number;
  success_count: number;
  failure_count: number;
  rollback_required_count: number;
  rollback_executed_count: number;
};

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, roundMetric(value)));
}

function percent(value: number): number {
  return Math.round(value * 100);
}

function computeRate(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }

  return numerator / denominator;
}

function normalizeCommandPattern(command: string | undefined): string {
  if (typeof command !== "string" || command.trim().length === 0) {
    return "unknown";
  }

  const tokens = command.trim().split(/\s+/);
  const first = (tokens[0] || "unknown").toLowerCase();
  const second = (tokens[1] || "").toLowerCase();
  const third = (tokens[2] || "").toLowerCase();

  if (["python", "python.exe", "py", "py.exe"].includes(first) && second.length > 0) {
    if (second === "-m" && third.length > 0) {
      return `python-module:${third}`;
    }
    return `python:${second}`;
  }

  return first;
}

function buildInsightId(parts: string[]): string {
  return parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function deriveCreatedAt(outcomes: readonly ExecutionOutcomeRecord[]): string {
  const timestamps = outcomes
    .map((outcome) => outcome.created_at)
    .filter((value) => typeof value === "string" && !Number.isNaN(Date.parse(value)))
    .sort();

  return timestamps[timestamps.length - 1] ?? new Date(0).toISOString();
}

function incrementBucket(bucket: AggregateBucket, outcome: ExecutionOutcomeRecord): void {
  bucket.total += 1;
  if (outcome.success) {
    bucket.success_count += 1;
  } else {
    bucket.failure_count += 1;
  }

  if (outcome.rollback_required) {
    bucket.rollback_required_count += 1;
  }

  if (outcome.rollback_executed) {
    bucket.rollback_executed_count += 1;
  }
}

function createEmptyBucket(): AggregateBucket {
  return {
    total: 0,
    success_count: 0,
    failure_count: 0,
    rollback_required_count: 0,
    rollback_executed_count: 0,
  };
}

function metricConfidence(sampleSize: number, signalStrength: number): number {
  return clampConfidence(0.35 + Math.min(sampleSize, 12) * 0.035 + Math.min(Math.abs(signalStrength), 1) * 0.23);
}

export function analyzeExecutionOutcomes(outcomes: readonly ExecutionOutcomeRecord[]): ExecutionOutcomeAnalytics {
  const nodeBuckets = new Map<string, AggregateBucket>();
  const commandBuckets = new Map<string, AggregateBucket>();
  const riskBuckets = new Map<"low" | "medium" | "high", AggregateBucket>();
  const rollbackBucket = createEmptyBucket();

  for (const outcome of outcomes) {
    incrementBucket(rollbackBucket, outcome);

    const nodeId = outcome.target_node_id || outcome.node_id || "unknown-node";
    const nodeBucket = nodeBuckets.get(nodeId) ?? createEmptyBucket();
    incrementBucket(nodeBucket, outcome);
    nodeBuckets.set(nodeId, nodeBucket);

    const commandPattern = normalizeCommandPattern(outcome.command);
    const commandBucket = commandBuckets.get(commandPattern) ?? createEmptyBucket();
    incrementBucket(commandBucket, outcome);
    commandBuckets.set(commandPattern, commandBucket);

    if (outcome.risk_level === "low" || outcome.risk_level === "medium" || outcome.risk_level === "high") {
      const riskBucket = riskBuckets.get(outcome.risk_level) ?? createEmptyBucket();
      incrementBucket(riskBucket, outcome);
      riskBuckets.set(outcome.risk_level, riskBucket);
    }
  }

  return {
    total_outcomes: outcomes.length,
    node_performance: [...nodeBuckets.entries()]
      .map(([node_id, bucket]) => ({
        node_id,
        total: bucket.total,
        success_count: bucket.success_count,
        failure_count: bucket.failure_count,
        success_rate: roundMetric(computeRate(bucket.success_count, bucket.total)),
      }))
      .sort((left, right) => right.total - left.total || right.success_rate - left.success_rate || left.node_id.localeCompare(right.node_id)),
    command_performance: [...commandBuckets.entries()]
      .map(([command_pattern, bucket]) => ({
        command_pattern,
        total: bucket.total,
        success_count: bucket.success_count,
        failure_count: bucket.failure_count,
        success_rate: roundMetric(computeRate(bucket.success_count, bucket.total)),
        failure_rate: roundMetric(computeRate(bucket.failure_count, bucket.total)),
      }))
      .sort((left, right) => right.total - left.total || right.failure_rate - left.failure_rate || left.command_pattern.localeCompare(right.command_pattern)),
    rollback_frequency: {
      total: rollbackBucket.total,
      rollback_required_count: rollbackBucket.rollback_required_count,
      rollback_executed_count: rollbackBucket.rollback_executed_count,
      rollback_required_rate: roundMetric(computeRate(rollbackBucket.rollback_required_count, rollbackBucket.total)),
      rollback_executed_rate: roundMetric(computeRate(rollbackBucket.rollback_executed_count, rollbackBucket.total)),
    },
    risk_correlation: (["low", "medium", "high"] as const)
      .filter((riskLevel) => riskBuckets.has(riskLevel))
      .map((risk_level) => {
        const bucket = riskBuckets.get(risk_level) ?? createEmptyBucket();
        return {
          risk_level,
          total: bucket.total,
          success_count: bucket.success_count,
          failure_count: bucket.failure_count,
          success_rate: roundMetric(computeRate(bucket.success_count, bucket.total)),
          failure_rate: roundMetric(computeRate(bucket.failure_count, bucket.total)),
          rollback_required_rate: roundMetric(computeRate(bucket.rollback_required_count, bucket.total)),
        };
      }),
  };
}

export function generateExecutionInsights(outcomes: readonly ExecutionOutcomeRecord[]): ExecutionInsight[] {
  if (outcomes.length === 0) {
    return [];
  }

  const analytics = analyzeExecutionOutcomes(outcomes);
  const createdAt = deriveCreatedAt(outcomes);
  const insights: ExecutionInsight[] = [];

  const primaryNode = analytics.node_performance[0];
  if (primaryNode) {
    insights.push({
      insight_id: buildInsightId(["node", "performance", primaryNode.node_id]),
      created_at: createdAt,
      category: "performance",
      description: `Node ${primaryNode.node_id} handled ${primaryNode.total} tasks with a ${percent(primaryNode.success_rate)}% success rate, indicating ${primaryNode.success_rate >= 0.9 ? "high" : primaryNode.success_rate >= 0.7 ? "moderate" : "low"} reliability.`,
      supporting_metrics: {
        total_outcomes: primaryNode.total,
        success_count: primaryNode.success_count,
        failure_count: primaryNode.failure_count,
        success_rate: primaryNode.success_rate,
      },
      confidence: metricConfidence(primaryNode.total, primaryNode.success_rate - 0.5),
    });
  }

  const highestFailurePattern = [...analytics.command_performance].sort((left, right) => right.failure_rate - left.failure_rate || right.total - left.total)[0];
  const lowestFailurePattern = [...analytics.command_performance].sort((left, right) => left.failure_rate - right.failure_rate || right.total - left.total)[0];
  if (highestFailurePattern) {
    const comparisonDelta = lowestFailurePattern
      ? roundMetric(highestFailurePattern.failure_rate - lowestFailurePattern.failure_rate)
      : highestFailurePattern.failure_rate;
    const description = lowestFailurePattern && lowestFailurePattern.command_pattern !== highestFailurePattern.command_pattern
      ? `Tasks using ${highestFailurePattern.command_pattern} fail ${percent(comparisonDelta)} percentage points more often than ${lowestFailurePattern.command_pattern}.`
      : `Tasks using ${highestFailurePattern.command_pattern} currently show a ${percent(highestFailurePattern.failure_rate)}% failure rate across ${highestFailurePattern.total} outcomes.`;
    insights.push({
      insight_id: buildInsightId(["command", "pattern", highestFailurePattern.command_pattern]),
      created_at: createdAt,
      category: "pattern",
      description,
      supporting_metrics: {
        total_outcomes: highestFailurePattern.total,
        failure_count: highestFailurePattern.failure_count,
        failure_rate: highestFailurePattern.failure_rate,
        comparison_failure_rate: lowestFailurePattern?.failure_rate ?? highestFailurePattern.failure_rate,
        failure_rate_delta: comparisonDelta,
      },
      confidence: metricConfidence(highestFailurePattern.total + (lowestFailurePattern?.total ?? 0), comparisonDelta),
    });
  }

  const rollbackMetrics = analytics.risk_correlation.find((entry) => entry.risk_level === "high");
  if (rollbackMetrics) {
    insights.push({
      insight_id: buildInsightId(["rollback", "frequency", rollbackMetrics.risk_level]),
      created_at: createdAt,
      category: "risk",
      description: `Rollback was required in ${percent(rollbackMetrics.rollback_required_rate)}% of high-risk tasks.`,
      supporting_metrics: {
        total_outcomes: rollbackMetrics.total,
        rollback_required_rate: rollbackMetrics.rollback_required_rate,
        failure_rate: rollbackMetrics.failure_rate,
      },
      confidence: metricConfidence(rollbackMetrics.total, rollbackMetrics.rollback_required_rate),
    });
  } else {
    insights.push({
      insight_id: buildInsightId(["rollback", "frequency", "overall"]),
      created_at: createdAt,
      category: "risk",
      description: `Rollback was required in ${percent(analytics.rollback_frequency.rollback_required_rate)}% of observed tasks overall.`,
      supporting_metrics: {
        total_outcomes: analytics.rollback_frequency.total,
        rollback_required_rate: analytics.rollback_frequency.rollback_required_rate,
        rollback_executed_rate: analytics.rollback_frequency.rollback_executed_rate,
      },
      confidence: metricConfidence(analytics.rollback_frequency.total, analytics.rollback_frequency.rollback_required_rate),
    });
  }

  const sortedRiskMetrics = [...analytics.risk_correlation].sort((left, right) => right.failure_rate - left.failure_rate || right.total - left.total);
  const highestRiskFailure = sortedRiskMetrics[0];
  const lowestRiskFailure = [...analytics.risk_correlation].sort((left, right) => left.failure_rate - right.failure_rate || right.total - left.total)[0];
  if (highestRiskFailure && lowestRiskFailure && highestRiskFailure.risk_level !== lowestRiskFailure.risk_level) {
    const failureDelta = roundMetric(highestRiskFailure.failure_rate - lowestRiskFailure.failure_rate);
    insights.push({
      insight_id: buildInsightId(["risk", "correlation", highestRiskFailure.risk_level, lowestRiskFailure.risk_level]),
      created_at: createdAt,
      category: "reliability",
      description: `${highestRiskFailure.risk_level} risk tasks fail ${percent(failureDelta)} percentage points more often than ${lowestRiskFailure.risk_level} risk tasks.`,
      supporting_metrics: {
        highest_failure_rate: highestRiskFailure.failure_rate,
        lowest_failure_rate: lowestRiskFailure.failure_rate,
        failure_rate_delta: failureDelta,
        highest_risk_total: highestRiskFailure.total,
        lowest_risk_total: lowestRiskFailure.total,
      },
      confidence: metricConfidence(highestRiskFailure.total + lowestRiskFailure.total, failureDelta),
    });
  } else if (highestRiskFailure) {
    insights.push({
      insight_id: buildInsightId(["risk", "correlation", highestRiskFailure.risk_level]),
      created_at: createdAt,
      category: "reliability",
      description: `${highestRiskFailure.risk_level} risk tasks currently show a ${percent(highestRiskFailure.failure_rate)}% failure rate across ${highestRiskFailure.total} observed tasks.`,
      supporting_metrics: {
        failure_rate: highestRiskFailure.failure_rate,
        success_rate: highestRiskFailure.success_rate,
        rollback_required_rate: highestRiskFailure.rollback_required_rate,
        total_outcomes: highestRiskFailure.total,
      },
      confidence: metricConfidence(highestRiskFailure.total, highestRiskFailure.failure_rate),
    });
  }

  return insights;
}

export function summarizeExecutionInsights(insights: readonly ExecutionInsight[]): string {
  if (insights.length === 0) {
    return "No execution insights available.";
  }

  return insights
    .map((insight) => `${insight.category.toUpperCase()}: ${insight.description} Confidence ${insight.confidence.toFixed(2)}.`)
    .join("\n");
}