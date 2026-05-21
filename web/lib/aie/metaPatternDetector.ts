import type { AutonomousDeliveryPackage, AutonomousReviewPackage } from "./autonomousWorkPlanning";
import type { ExecutionChainRecord } from "./executionChainState";
import type { OperatorDashboardState } from "./operatorDashboardState";
import type {
  MetaDetectedPattern,
  MetaIntelligenceState,
  MetaOperatorDecisionRecord,
  MetaPolicyAdjustment,
} from "./metaIntelligenceState";

export type MetaPatternDetectorInput = {
  studio_operations_state?: OperatorDashboardState["studio_operations"];
  runtime_timeline_events?: NonNullable<OperatorDashboardState["runtime_observability"]>["event_log"];
  execution_chains?: ExecutionChainRecord[];
  review_packages?: AutonomousReviewPackage[];
  delivery_packages?: AutonomousDeliveryPackage[];
  recovery_events?: OperatorDashboardState["recovery_recommendations"];
  proof_results?: string[];
  trace_results?: string[];
  operator_decisions?: MetaOperatorDecisionRecord[];
  autonomous_sessions?: OperatorDashboardState["governed_runtime_lanes"];
  agent_runtime?: OperatorDashboardState["agent_runtime"];
};

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function hoursBetween(start: string, end: string): number {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return 0;
  }
  return Number(((endMs - startMs) / 3_600_000).toFixed(2));
}

function extractProofFailures(packages: AutonomousReviewPackage[] | AutonomousDeliveryPackage[] | undefined): string[] {
  return (packages ?? []).flatMap((item) => item.proof_results.filter((result) => /fail|error/i.test(result)));
}

function extractTraceFailures(reviewPackages: AutonomousReviewPackage[] | undefined, deliveryPackages: AutonomousDeliveryPackage[] | undefined): string[] {
  return [
    ...(reviewPackages ?? []).flatMap((item) => item.tests_run.filter((result) => /trace/i.test(result) && /fail|error/i.test(result))),
    ...(deliveryPackages ?? []).flatMap((item) => item.validation_results.filter((result) => /trace/i.test(result) && /fail|error/i.test(result))),
  ];
}

export function detectMetaPatterns(input: MetaPatternDetectorInput): MetaDetectedPattern[] {
  const patterns: MetaDetectedPattern[] = [];
  const sessions = input.autonomous_sessions?.sessions ?? [];
  const blockedSessions = sessions.filter((session) => session.blocked_by_conflict || session.status === "blocked" || session.status === "failed");
  if (blockedSessions.length >= 2) {
    patterns.push({
      pattern_id: "meta-pattern-blocked-sessions",
      severity: blockedSessions.length >= 3 ? "high" : "medium",
      category: "blocked_sessions",
      summary: `${blockedSessions.length} autonomous sessions are repeatedly blocked or failed in the observed window.`,
      evidence: blockedSessions.map((session) => `${session.session_id} is ${session.status} with ${session.tick_budget_remaining} ticks remaining.`),
      affected_sessions: blockedSessions.map((session) => session.session_id),
      affected_agents: dedupe(blockedSessions.flatMap((session) => session.assigned_agent_ids)),
      recommended_action: "lower_concurrency",
    });
  }

  const deferredReviews = (input.review_packages ?? []).filter((item) => item.status === "deferred" || item.status === "request_changes");
  if (deferredReviews.length >= 2) {
    patterns.push({
      pattern_id: "meta-pattern-review-deferrals",
      severity: deferredReviews.length >= 3 ? "high" : "medium",
      category: "review_deferrals",
      summary: `${deferredReviews.length} review packages were deferred or sent back for changes repeatedly.`,
      evidence: deferredReviews.map((item) => `${item.package_id} stayed in ${item.status}: ${item.summary}`),
      affected_sessions: [],
      affected_agents: [],
      recommended_action: "require_review_earlier",
    });
  }

  const recoveryEvents = input.recovery_events ?? [];
  if (recoveryEvents.length >= 2) {
    patterns.push({
      pattern_id: "meta-pattern-recovery-triggers",
      severity: recoveryEvents.some((item) => item.severity === "high") ? "high" : "medium",
      category: "recovery_triggers",
      summary: `${recoveryEvents.length} recovery-trigger events occurred during the observed window.`,
      evidence: recoveryEvents.map((item) => `${item.source}: ${item.reason}`),
      affected_sessions: [],
      affected_agents: [],
      recommended_action: "increase_checkpoint_frequency",
    });
  }

  const slowChains = (input.execution_chains ?? []).filter((chain) => chain.status !== "completed" && chain.current_step >= Math.max(2, chain.total_steps - 1));
  if (slowChains.length > 0) {
    patterns.push({
      pattern_id: "meta-pattern-slow-chains",
      severity: slowChains.length >= 2 ? "medium" : "low",
      category: "slow_chains",
      summary: `${slowChains.length} execution chain${slowChains.length === 1 ? " is" : "s are"} progressing slowly near the end of the chain budget.`,
      evidence: slowChains.map((chain) => `${chain.chain_id} is ${chain.status} at step ${chain.current_step}/${chain.total_steps}.`),
      affected_sessions: dedupe(slowChains.map((chain) => chain.parent_goal_id ?? "runtime")),
      affected_agents: dedupe(slowChains.flatMap((chain) => chain.agent_ids)),
      recommended_action: "raise_tick_budget",
    });
  }

  const rejectedHighRisk = (input.review_packages ?? []).filter((item) => item.risks.some((risk) => /high-risk|high risk|unsafe/i.test(risk)) && /reject|request_changes/i.test(item.status));
  if (rejectedHighRisk.length > 0) {
    patterns.push({
      pattern_id: "meta-pattern-high-risk-rejections",
      severity: rejectedHighRisk.length >= 2 ? "high" : "medium",
      category: "rejected_high_risk_work",
      summary: `${rejectedHighRisk.length} high-risk work package${rejectedHighRisk.length === 1 ? " was" : "s were"} repeatedly rejected or sent back.`,
      evidence: rejectedHighRisk.map((item) => `${item.package_id} carried risks [${item.risks.join(", ")}] and ended as ${item.status}.`),
      affected_sessions: rejectedHighRisk.map((item) => item.work_item_id),
      affected_agents: [],
      recommended_action: "deprioritize_failed_work_type",
    });
  }

  if (input.studio_operations_state && ["high", "critical"].includes(input.studio_operations_state.resource_pressure)) {
    patterns.push({
      pattern_id: "meta-pattern-resource-pressure",
      severity: input.studio_operations_state.resource_pressure === "critical" ? "high" : "medium",
      category: "resource_pressure",
      summary: `Resource pressure is ${input.studio_operations_state.resource_pressure} across the studio runtime pool.`,
      evidence: [
        `Health score ${input.studio_operations_state.health_score}.`,
        `${input.studio_operations_state.active_session_count} active sessions against pressure ${input.studio_operations_state.resource_pressure}.`,
      ],
      affected_sessions: sessions.filter((session) => session.status === "running" || session.status === "pending").map((session) => session.session_id),
      affected_agents: dedupe(sessions.flatMap((session) => session.assigned_agent_ids)),
      recommended_action: "resource_safe_mode",
    });
  }

  const proofFailures = dedupe([
    ...extractProofFailures(input.review_packages),
    ...extractProofFailures(input.delivery_packages),
    ...(input.proof_results ?? []).filter((result) => /fail|error/i.test(result)),
  ]);
  if (proofFailures.length >= 2) {
    patterns.push({
      pattern_id: "meta-pattern-proof-failures",
      severity: "high",
      category: "proof_failures",
      summary: `${proofFailures.length} proof failures were observed repeatedly.`,
      evidence: proofFailures,
      affected_sessions: [],
      affected_agents: [],
      recommended_action: "suggest_proof_timeout_adjustment",
    });
  }

  const traceFailures = dedupe([
    ...extractTraceFailures(input.review_packages, input.delivery_packages),
    ...(input.trace_results ?? []).filter((result) => /fail|error/i.test(result)),
  ]);
  if (traceFailures.length > 0) {
    patterns.push({
      pattern_id: "meta-pattern-trace-failures",
      severity: traceFailures.length >= 2 ? "high" : "medium",
      category: "trace_failures",
      summary: `${traceFailures.length} trace validation failure${traceFailures.length === 1 ? " was" : "s were"} observed.`,
      evidence: traceFailures,
      affected_sessions: [],
      affected_agents: [],
      recommended_action: "resource_safe_mode",
    });
  }

  const blockedAgents = input.agent_runtime?.blocked_agents ?? [];
  if (blockedAgents.length > 0 || blockedSessions.length > 0) {
    const affectedAgents = dedupe([
      ...blockedAgents.map((agent) => agent.agent_id),
      ...blockedSessions.flatMap((session) => session.assigned_agent_ids),
    ]);
    if (affectedAgents.length > 0) {
      patterns.push({
        pattern_id: "meta-pattern-agent-role-blockers",
        severity: affectedAgents.length >= 2 ? "medium" : "low",
        category: blockedAgents.length > 0 ? "agent_role_blockers" : "agent_role_failures",
        summary: `${affectedAgents.length} agent assignment${affectedAgents.length === 1 ? " is" : "s are"} repeatedly associated with blocked work.`,
        evidence: affectedAgents.map((agentId) => `${agentId} is attached to blocked or failed execution.`),
        affected_sessions: blockedSessions.map((session) => session.session_id),
        affected_agents: affectedAgents,
        recommended_action: "pause_noisy_agent_role",
      });
    }
  }

  const successSignals = [
    ...(input.delivery_packages ?? []).filter((item) => /approved_for_commit|pr_ready|pr_opened|pushed/i.test(item.status)).map((item) => item.work_item_id),
    ...sessions.filter((session) => session.status === "completed").map((session) => session.session_id),
  ];
  if (successSignals.length > 0) {
    patterns.push({
      pattern_id: "meta-pattern-success-cluster",
      severity: "low",
      category: "success_cluster",
      summary: `${successSignals.length} successful execution signal${successSignals.length === 1 ? " was" : "s were"} recorded in the observed window.`,
      evidence: successSignals.map((item) => `${item} completed without widening autonomy scope.`),
      affected_sessions: successSignals,
      affected_agents: [],
      recommended_action: "preserve_current_safe_policy",
    });
  }

  return patterns;
}

export function buildMetaIntelligenceState(
  state: OperatorDashboardState,
  patterns: MetaDetectedPattern[],
  recommendations: MetaPolicyAdjustment[],
): MetaIntelligenceState {
  const sessions = state.governed_runtime_lanes?.sessions ?? [];
  const totalSessions = sessions.length + (state.supervised_session ? 1 : 0);
  const successfulSessions = sessions.filter((session) => session.status === "completed").length + (state.supervised_session?.status === "completed" ? 1 : 0);
  const failedSessions = sessions.filter((session) => session.status === "failed").length + (state.supervised_session?.status === "failed" ? 1 : 0);
  const blockedSessions = sessions.filter((session) => session.status === "blocked" || session.blocked_by_conflict).length;
  const completedTicks = sessions.filter((session) => session.status === "completed");
  const averageTicksToCompletion = completedTicks.length > 0
    ? Number((completedTicks.reduce((sum, session) => sum + session.consumed_ticks, 0) / completedTicks.length).toFixed(2))
    : Number((state.supervised_session?.ticks_completed ?? 0).toFixed(2));

  const averageReviewDelay = 0;

  const proofFailureCount = patterns.filter((pattern) => pattern.category === "proof_failures").reduce((sum, pattern) => sum + pattern.evidence.length, 0);
  const traceFailureCount = patterns.filter((pattern) => pattern.category === "trace_failures").reduce((sum, pattern) => sum + pattern.evidence.length, 0);
  const recoveryEventCount = state.recovery_recommendations.length + (state.supervised_session?.failure_count ?? 0);
  const operatorInterventionCount = (state.meta_operator_decision_history?.length ?? 0) + state.approvals_required.length;
  const resourcePressureEvents = (state.runtime_observability?.event_log ?? []).filter((event) => /resource/i.test(event.reason) || /resource/i.test(event.mutation_summary ?? "")).length
    + ((state.studio_operations?.resource_pressure === "high" || state.studio_operations?.resource_pressure === "critical") ? 1 : 0);

  return {
    meta_cycle_id: `meta-cycle-${state.last_updated_at.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000"}`,
    observed_window_start: state.runtime_observability?.event_log[0]?.timestamp ?? state.last_updated_at,
    observed_window_end: state.last_updated_at,
    total_sessions: totalSessions,
    successful_sessions: successfulSessions,
    failed_sessions: failedSessions,
    blocked_sessions: blockedSessions,
    average_ticks_to_completion: averageTicksToCompletion,
    average_review_delay: averageReviewDelay,
    proof_failure_count: proofFailureCount,
    trace_failure_count: traceFailureCount,
    recovery_event_count: recoveryEventCount,
    operator_intervention_count: operatorInterventionCount,
    resource_pressure_events: resourcePressureEvents,
    top_failure_patterns: patterns.filter((pattern) => pattern.category !== "success_cluster").slice(0, 3).map((pattern) => pattern.summary),
    top_success_patterns: patterns.filter((pattern) => pattern.category === "success_cluster").slice(0, 3).map((pattern) => pattern.summary),
    recommended_policy_adjustments: recommendations.slice(0, 5).map((item) => item.title),
    safety_notes: [
      "Recommendations remain advisory until an operator approves them.",
      "No code self-modification or silent safety weakening is allowed.",
      "Autonomy scope remains bounded to existing operator-approved runtime policy.",
    ],
    last_updated_at: state.last_updated_at,
  };
}
