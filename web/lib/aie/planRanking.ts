import type { ExecutionInsight } from "./executionInsight";
import type { NodePlanSelectionOption, NodeTaskRiskLevel } from "./nodeBoundary";

export type NodePlanRanking = {
  plan_id: string;
  score: number;
  reasoning: {
    failure_rate: number;
    rollback_rate: number;
    risk_level: NodeTaskRiskLevel;
    success_rate: number;
  };
};

function roundScore(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function riskPenaltyForLevel(riskLevel: NodeTaskRiskLevel | undefined): number {
  switch (riskLevel) {
    case "low":
      return 0.18;
    case "medium":
      return 0.36;
    case "high":
      return 0.62;
    default:
      return 0.34;
  }
}

function riskLevelFromPenalty(riskPenalty: number): NodeTaskRiskLevel {
  if (riskPenalty <= 0.24) {
    return "low";
  }

  if (riskPenalty <= 0.46) {
    return "medium";
  }

  return "high";
}

function deriveBaseMetrics(insights: readonly ExecutionInsight[], riskLevel: NodeTaskRiskLevel | undefined): {
  failureRate: number;
  rollbackRate: number;
  historicalSuccess: number;
  riskPenalty: number;
} {
  const failureCandidates: number[] = [];
  const rollbackCandidates: number[] = [];
  const successCandidates: number[] = [];

  for (const insight of insights) {
    const metrics = insight.supporting_metrics;
    if (Number.isFinite(metrics.failure_rate)) {
      failureCandidates.push(Math.max(0, Math.min(1, metrics.failure_rate)));
      successCandidates.push(Math.max(0, Math.min(1, 1 - metrics.failure_rate)));
    }
    if (Number.isFinite(metrics.success_rate)) {
      successCandidates.push(Math.max(0, Math.min(1, metrics.success_rate)));
      failureCandidates.push(Math.max(0, Math.min(1, 1 - metrics.success_rate)));
    }
    if (Number.isFinite(metrics.rollback_required_rate)) {
      rollbackCandidates.push(Math.max(0, Math.min(1, metrics.rollback_required_rate)));
    }
    if (Number.isFinite(metrics.rollback_executed_rate)) {
      rollbackCandidates.push(Math.max(0, Math.min(1, metrics.rollback_executed_rate)));
    }
  }

  const defaultFailureRate = riskLevel === "high" ? 0.68 : riskLevel === "medium" ? 0.44 : 0.24;
  const defaultRollbackRate = riskLevel === "high" ? 0.42 : riskLevel === "medium" ? 0.24 : 0.12;
  const failureRate = average(failureCandidates) ?? defaultFailureRate;
  const historicalSuccess = average(successCandidates) ?? Math.max(0.2, 1 - failureRate);

  return {
    failureRate,
    rollbackRate: average(rollbackCandidates) ?? defaultRollbackRate,
    historicalSuccess,
    riskPenalty: riskPenaltyForLevel(riskLevel),
  };
}

function deriveMitigation(option: NodePlanSelectionOption): {
  failureMitigation: number;
  rollbackMitigation: number;
  riskMitigation: number;
  successBoost: number;
  reasons: string[];
} {
  const normalizedText = `${option.label} ${option.command ?? ""} ${option.steps.join(" ")}`.toLowerCase();
  let failureMitigation = 0;
  let rollbackMitigation = 0;
  let riskMitigation = 0;
  let successBoost = 0;
  const reasons: string[] = [];

  if (normalizedText.includes("test mode") || normalizedText.includes("diagnostics_smoke")) {
    failureMitigation += 0.22;
    riskMitigation += 0.12;
    reasons.push("Lower failure rate");
  }

  if (normalizedText.includes("validation") || normalizedText.includes("diagnostics")) {
    failureMitigation += 0.08;
    riskMitigation += 0.16;
    if (!reasons.includes("Lower risk level")) {
      reasons.push("Lower risk level");
    }
  }

  if (normalizedText.includes("recovery") || normalizedText.includes("rollback")) {
    rollbackMitigation += 0.18;
    riskMitigation += 0.08;
    reasons.push("Fewer rollbacks");
  }

  if (normalizedText.includes("smaller reviewed steps") || normalizedText.includes("before each step") || normalizedText.includes("smaller")) {
    failureMitigation += 0.08;
    riskMitigation += 0.1;
    successBoost += 0.06;
  }

  if (normalizedText.includes("daily_use_smoke")) {
    successBoost += 0.16;
    if (!reasons.includes("Stronger historical success")) {
      reasons.push("Stronger historical success");
    }
  }

  return {
    failureMitigation: Math.min(failureMitigation, 0.4),
    rollbackMitigation: Math.min(rollbackMitigation, 0.3),
    riskMitigation: Math.min(riskMitigation, 0.35),
    successBoost: Math.min(successBoost, 0.2),
    reasons,
  };
}

export function rankPlans(
  plans: readonly NodePlanSelectionOption[],
  insights: readonly ExecutionInsight[],
  riskLevel?: NodeTaskRiskLevel,
): NodePlanRanking[] {
  const base = deriveBaseMetrics(insights, riskLevel);

  return plans
    .map((plan) => {
      const mitigation = deriveMitigation(plan);
      const failureRate = Math.max(0, base.failureRate - mitigation.failureMitigation);
      const rollbackRate = Math.max(0, base.rollbackRate - mitigation.rollbackMitigation);
      const riskPenalty = Math.max(0, base.riskPenalty - mitigation.riskMitigation);
      const historicalSuccess = Math.min(
        1,
        base.historicalSuccess + mitigation.successBoost + ((mitigation.failureMitigation + mitigation.rollbackMitigation + mitigation.riskMitigation) * 0.12),
      );

      return {
        plan_id: plan.plan_id,
        score: roundScore(
          (historicalSuccess * 0.35)
          + ((1 - failureRate) * 0.25)
          + ((1 - rollbackRate) * 0.2)
          + ((1 - riskPenalty) * 0.2)
        ),
        reasoning: {
          failure_rate: roundScore(failureRate),
          rollback_rate: roundScore(rollbackRate),
          risk_level: riskLevelFromPenalty(riskPenalty),
          success_rate: roundScore(historicalSuccess),
        },
      };
    })
    .sort((left, right) => right.score - left.score || left.plan_id.localeCompare(right.plan_id));
}