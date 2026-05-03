import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutionInsight } from "./executionInsight";
import { rankPlans } from "./planRanking";

test("rankings prefer alternatives with stronger mitigation signals", () => {
  const rankings = rankPlans([
    {
      plan_id: "plan-a",
      label: "Alternative A",
      source: "alternative",
      command: "python diagnostics_smoke.py",
      steps: [
        "run python validate_runtime.py in test mode first",
        "ensure the recovery plan is ready and reviewed",
      ],
    },
    {
      plan_id: "plan-b",
      label: "Alternative B",
      source: "alternative",
      command: "python validate_runtime.py",
      steps: [
        "review the current bounded plan",
      ],
    },
  ], [
    {
      insight_id: "insight-risk-1",
      created_at: "2026-05-02T23:50:00.000Z",
      category: "risk",
      description: "Rollback frequency and failure rate remain high for the current path.",
      supporting_metrics: {
        failure_rate: 0.82,
        rollback_required_rate: 0.71,
        success_rate: 0.18,
      },
      confidence: 0.94,
      severity: "critical",
      suggestion: "Use a safer reviewed alternative.",
    } satisfies ExecutionInsight,
  ], "high");

  assert.equal(rankings.length, 2);
  assert.equal(rankings[0]?.plan_id, "plan-a");
  assert.ok((rankings[0]?.score ?? 0) > (rankings[1]?.score ?? 0));
  assert.equal(typeof rankings[0]?.reasoning.failure_rate, "number");
  assert.equal(typeof rankings[0]?.reasoning.rollback_rate, "number");
  assert.equal(typeof rankings[0]?.reasoning.success_rate, "number");
  assert.ok(["low", "medium"].includes(rankings[0]?.reasoning.risk_level ?? ""));
  assert.ok((rankings[0]?.reasoning.failure_rate ?? 1) < (rankings[1]?.reasoning.failure_rate ?? 1));
  assert.ok((rankings[0]?.reasoning.rollback_rate ?? 1) < (rankings[1]?.reasoning.rollback_rate ?? 1));
  assert.ok((rankings[0]?.reasoning.success_rate ?? 0) > (rankings[1]?.reasoning.success_rate ?? 0));
  const riskOrder = { low: 0, medium: 1, high: 2 } as const;
  assert.ok(
    riskOrder[(rankings[0]?.reasoning.risk_level ?? "high") as keyof typeof riskOrder]
    <= riskOrder[(rankings[1]?.reasoning.risk_level ?? "high") as keyof typeof riskOrder],
  );
});