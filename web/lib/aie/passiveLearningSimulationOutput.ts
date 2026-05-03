import type { SimulatedRankingAdjustment } from "./passiveLearningSimulation";

export type SimulatedRankingAdjustmentDisplay = SimulatedRankingAdjustment & {
  reason: string;
};

export type SimulatedRankingAdjustmentRenderResult = {
  adjustments: SimulatedRankingAdjustmentDisplay[];
  display_only: true;
  applied: false;
  console_output: string;
};

function deriveReason(delta: number): string {
  if (delta > 0) {
    return "Shadow signal suggests historical operator choices would increase confidence in this plan.";
  }

  if (delta < 0) {
    return "Shadow signal suggests historical operator choices would reduce confidence in this plan.";
  }

  return "Shadow signal shows no simulated adjustment for this plan.";
}

function cloneAdjustment(adjustment: SimulatedRankingAdjustment): SimulatedRankingAdjustment {
  return {
    plan_id: adjustment.plan_id,
    current_score: adjustment.current_score,
    simulated_adjusted_score: adjustment.simulated_adjusted_score,
    delta: adjustment.delta,
  };
}

export function renderSimulatedRankingAdjustments(
  adjustments: readonly SimulatedRankingAdjustment[],
): SimulatedRankingAdjustmentRenderResult {
  const normalizedAdjustments = adjustments.map((adjustment) => {
    const cloned = cloneAdjustment(adjustment);
    return {
      ...cloned,
      reason: deriveReason(cloned.delta),
    };
  });

  const lines = [
    "Simulation only - not applied.",
    "",
  ];

  if (normalizedAdjustments.length === 0) {
    lines.push("- No simulated adjustments available.");
  } else {
    for (const adjustment of normalizedAdjustments) {
      lines.push(`Plan ${adjustment.plan_id}`);
      lines.push(`- Current score: ${adjustment.current_score.toFixed(3)}`);
      lines.push(`- Simulated adjusted score: ${adjustment.simulated_adjusted_score.toFixed(3)}`);
      lines.push(`- Delta: ${adjustment.delta >= 0 ? "+" : ""}${adjustment.delta.toFixed(3)}`);
      lines.push(`- Reason: ${adjustment.reason}`);
      lines.push("");
    }
  }

  lines.push("Display only. No ranking modification, plan mutation, execution change, or feedback loop is applied.");

  return {
    adjustments: normalizedAdjustments,
    display_only: true,
    applied: false,
    console_output: lines.join("\n"),
  };
}