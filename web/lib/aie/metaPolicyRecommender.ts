import type { OperatorDashboardState } from "./operatorDashboardState";
import type {
  MetaDetectedPattern,
  MetaOperatorDecisionRecord,
  MetaPolicyAdjustment,
  MetaPolicyState,
} from "./metaIntelligenceState";

export type MetaPolicyRecommenderInput = {
  detected_patterns: MetaDetectedPattern[];
  current_policy_state?: MetaPolicyState | null;
  overnight_policy?: OperatorDashboardState["supervised_session"] extends infer T ? T extends { overnight_policy?: infer P } ? P : never : never;
  recovery_policy?: string | null;
  planning_priority_weights?: string[];
  delivery_gating_rules?: string[];
  operator_decision_history?: MetaOperatorDecisionRecord[];
  timestamp: string;
};

function incrementSetting(value: string, delta: number, fallback: number): string {
  const match = value.match(/(\d+)/);
  const nextValue = (match ? Number(match[1]) : fallback) + delta;
  return value.replace(/(\d+)/, String(nextValue > 0 ? nextValue : fallback));
}

function createRecommendation(
  recommendationId: string,
  target: MetaPolicyAdjustment["target"],
  title: string,
  summary: string,
  evidence: string[],
  requestedPolicyValue: string,
  currentPolicyValue: string,
  impact: MetaPolicyAdjustment["impact"],
  timestamp: string,
): MetaPolicyAdjustment {
  return {
    recommendation_id: recommendationId,
    target,
    title,
    summary,
    evidence,
    impact,
    requires_explicit_approval: impact === "high" || target === "agent_role_pause" || target === "resource_safe_mode",
    status: "pending",
    safe_rationale: "This recommendation only proposes bounded policy-state changes and cannot modify code, broaden autonomy scope, or disable safety gates.",
    requested_policy_value: requestedPolicyValue,
    current_policy_value: currentPolicyValue,
    last_updated_at: timestamp,
  };
}

export function deriveMetaPolicyState(
  state: OperatorDashboardState,
  existingPolicyState?: MetaPolicyState | null,
): MetaPolicyState {
  return {
    concurrency_mode: existingPolicyState?.concurrency_mode ?? `max_concurrent_chains=${state.autonomous_sessions?.max_concurrent_chains ?? 1}`,
    tick_budget_mode: existingPolicyState?.tick_budget_mode ?? `tick_budget=${state.supervised_session?.tick_budget ?? 4}`,
    review_timing_mode: existingPolicyState?.review_timing_mode ?? `review_queue_enabled=${state.supervised_session?.overnight_policy?.review_queue_enabled ?? true}`,
    work_type_priority_mode: existingPolicyState?.work_type_priority_mode ?? `top_priority=${state.planning_recommendations?.[0]?.work_item_id ?? "balanced"}`,
    checkpoint_frequency_mode: existingPolicyState?.checkpoint_frequency_mode ?? `checkpoint_interval_ticks=${state.supervised_session?.overnight_policy?.checkpoint_interval_ticks ?? 1}`,
    paused_agent_roles: [...(existingPolicyState?.paused_agent_roles ?? [])],
    proof_timeout_mode: existingPolicyState?.proof_timeout_mode ?? "proof_timeout=default",
    resource_safe_mode_enabled: existingPolicyState?.resource_safe_mode_enabled ?? false,
    last_updated_at: state.last_updated_at,
  };
}

export function recommendMetaPolicyAdjustments(input: MetaPolicyRecommenderInput): MetaPolicyAdjustment[] {
  const currentPolicy = input.current_policy_state;
  if (!currentPolicy) {
    return [];
  }

  const recommendations: MetaPolicyAdjustment[] = [];
  for (const pattern of input.detected_patterns) {
    switch (pattern.category) {
      case "blocked_sessions":
      case "resource_pressure":
        recommendations.push(createRecommendation(
          "meta-recommendation-lower-concurrency",
          "concurrency",
          "Lower concurrency for noisy runtime windows",
          "Reduce concurrent bounded work to limit repeated session blocking and resource contention.",
          pattern.evidence,
          incrementSetting(currentPolicy.concurrency_mode, -1, 1),
          currentPolicy.concurrency_mode,
          "high",
          input.timestamp,
        ));
        recommendations.push(createRecommendation(
          "meta-recommendation-resource-safe-mode",
          "resource_safe_mode",
          "Enable resource-safe mode",
          "Use a stricter resource-safe mode when pressure spikes repeat in the observed window.",
          pattern.evidence,
          "resource_safe_mode=true",
          `resource_safe_mode=${currentPolicy.resource_safe_mode_enabled}`,
          "high",
          input.timestamp,
        ));
        break;
      case "slow_chains":
        recommendations.push(createRecommendation(
          "meta-recommendation-raise-tick-budget",
          "tick_budget",
          "Raise bounded tick budget slightly",
          "Slow chains indicate the current tick budget may be too tight for the approved workload mix.",
          pattern.evidence,
          incrementSetting(currentPolicy.tick_budget_mode, 2, 4),
          currentPolicy.tick_budget_mode,
          "medium",
          input.timestamp,
        ));
        break;
      case "review_deferrals":
        recommendations.push(createRecommendation(
          "meta-recommendation-earlier-review",
          "review_timing",
          "Require review earlier for repeated deferrals",
          "Repeated review deferrals suggest risky work should hit the review queue sooner.",
          pattern.evidence,
          "review_queue_enabled=true; review_gate=earlier",
          currentPolicy.review_timing_mode,
          "medium",
          input.timestamp,
        ));
        break;
      case "recovery_triggers":
        recommendations.push(createRecommendation(
          "meta-recommendation-checkpoint-frequency",
          "checkpoint_frequency",
          "Increase checkpoint frequency",
          "Frequent recovery events justify denser checkpoints so bounded rollback remains cheaper.",
          pattern.evidence,
          incrementSetting(currentPolicy.checkpoint_frequency_mode, 1, 1),
          currentPolicy.checkpoint_frequency_mode,
          "medium",
          input.timestamp,
        ));
        break;
      case "rejected_high_risk_work":
        recommendations.push(createRecommendation(
          "meta-recommendation-deprioritize-failed-work",
          "work_type_priority",
          "Deprioritize repeatedly rejected high-risk work",
          "High-risk work that keeps getting rejected should be ranked lower until the risk signal improves.",
          pattern.evidence,
          "top_priority=stable_low_risk_first",
          currentPolicy.work_type_priority_mode,
          "medium",
          input.timestamp,
        ));
        break;
      case "proof_failures":
        recommendations.push(createRecommendation(
          "meta-recommendation-proof-timeout",
          "proof_timeout",
          "Suggest proof timeout adjustment",
          "Repeated proof failures justify a bounded proof-timeout review before more autonomous retries occur.",
          pattern.evidence,
          "proof_timeout=review_for_increase",
          currentPolicy.proof_timeout_mode,
          "medium",
          input.timestamp,
        ));
        break;
      case "agent_role_blockers":
      case "agent_role_failures": {
        const targetAgent = pattern.affected_agents[0] ?? "unknown-agent-role";
        recommendations.push(createRecommendation(
          `meta-recommendation-pause-${targetAgent}`,
          "agent_role_pause",
          `Pause noisy agent role: ${targetAgent}`,
          "A noisy or repeatedly blocked agent role should be paused until the operator confirms the policy change.",
          pattern.evidence,
          `paused_agent_role=${targetAgent}`,
          currentPolicy.paused_agent_roles.join(",") || "none",
          "high",
          input.timestamp,
        ));
        break;
      }
      default:
        break;
    }
  }

  const decisionMap = new Map((input.operator_decision_history ?? []).map((item) => [item.recommendation_id, item.decision_type]));
  return recommendations.filter((item, index, all) => all.findIndex((candidate) => candidate.recommendation_id === item.recommendation_id) === index)
    .map((item) => {
      const priorDecision = decisionMap.get(item.recommendation_id);
      if (priorDecision === "approve_policy_recommendation") {
        return { ...item, status: "approved" };
      }
      if (priorDecision === "reject_policy_recommendation") {
        return { ...item, status: "rejected" };
      }
      if (priorDecision === "defer_policy_recommendation") {
        return { ...item, status: "deferred" };
      }
      return item;
    });
}
