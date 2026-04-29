import type { OperatorDashboardState } from "./operatorDashboardState";

export type MetaIntelligenceSummaryPackage = {
  requested_at: string;
  generated_at: string;
  what_improved: string[];
  what_degraded: string[];
  what_patterns_emerged: string[];
  recommended_changes: string[];
  safe_change_reasons: string[];
  requires_operator_approval: string[];
  should_not_change: string[];
  narrative: string;
};

function withFallback(values: string[], fallback: string): string[] {
  return values.length > 0 ? values : [fallback];
}

export function createMetaIntelligenceSummaryPackage(
  state: OperatorDashboardState,
  requestedAt = state.last_updated_at,
): MetaIntelligenceSummaryPackage {
  const improved = [
    ...(state.meta_intelligence?.top_success_patterns ?? []),
    ...((state.delivery_packages ?? []).filter((item) => /approved_for_commit|pr_ready|pr_opened|pushed/i.test(item.status)).map((item) => `Delivery flow improved for ${item.work_item_id}.`)),
  ];
  const degraded = [
    ...(state.meta_intelligence?.top_failure_patterns ?? []),
    ...((state.review_packages ?? []).filter((item) => item.status === "deferred" || item.status === "request_changes").map((item) => `Review friction increased for ${item.work_item_id}.`)),
  ];
  const patterns = (state.meta_detected_patterns ?? []).map((item) => item.summary);
  const recommendedChanges = (state.meta_policy_recommendations ?? []).map((item) => `${item.title}: ${item.summary}`);
  const safeReasons = (state.meta_policy_recommendations ?? []).map((item) => item.safe_rationale);
  const requiresApproval = (state.meta_policy_recommendations ?? []).filter((item) => item.requires_explicit_approval).map((item) => item.title);

  return {
    requested_at: requestedAt,
    generated_at: state.last_updated_at,
    what_improved: withFallback(improved.slice(0, 4), "No meaningful improvement signal was recorded in the current bounded observation window."),
    what_degraded: withFallback(degraded.slice(0, 4), "No new degradation signal was recorded in the current bounded observation window."),
    what_patterns_emerged: withFallback(patterns.slice(0, 5), "No recurring pattern emerged strongly enough to justify a policy recommendation."),
    recommended_changes: withFallback(recommendedChanges.slice(0, 5), "No policy adjustment is recommended at this time."),
    safe_change_reasons: withFallback(safeReasons.slice(0, 5), "Safety gates remain unchanged; any future policy adjustment stays operator-approved and bounded."),
    requires_operator_approval: withFallback(requiresApproval.slice(0, 5), "No high-impact recommendation is currently waiting for operator approval."),
    should_not_change: [
      "Do not modify code automatically.",
      "Do not weaken existing safety gates.",
      "Do not expand autonomy scope without explicit operator approval.",
      "Do not apply policy mutations silently.",
    ],
    narrative: [
      `Meta-intelligence observed ${state.meta_intelligence?.total_sessions ?? 0} total sessions in the current window.`,
      `Top emerging patterns: ${(patterns.slice(0, 2).join(" ") || "none detected")}.`,
      `Recommended changes remain advisory until approved by the operator.`,
    ].join(" "),
  };
}
