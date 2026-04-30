import {
  createBackgroundRuntimeService,
  stopBackgroundRuntimeService,
} from "../lib/aie/backgroundRuntimeService";
import {
  createAutonomousDeliveryPackage,
  createAutonomousReviewPackage,
  createAutonomousWorkItem,
  createAutonomousWorkItemPolicyFeedback,
} from "../lib/aie/autonomousWorkPlanning";
import type { OperatorDashboardState } from "../lib/aie/operatorDashboardState";
import {
  createRuntimeStateStore,
  loadRuntimeState,
  persistRuntimeStateRecord,
  saveRuntimeState,
  type RuntimeStateStore,
} from "../lib/aie/runtimeStateStore";
import {
  createOvernightAutonomyPolicyId,
  createOvernightAutonomyReviewId,
  createSupervisedAutonomySessionId,
} from "../lib/aie/supervisedAutonomySession";
import { createOperatorDashboardDemoState } from "../lib/aie/operatorDashboardDemoState";

export type ContinuousRuntimeProofSeedPayload = {
  runtimeId: string;
  store: RuntimeStateStore;
};

export type ContinuousRuntimeProofSeedMode = "continuous-runtime" | "supervised-autonomy" | "overnight-autonomy" | "autonomous-planning" | "delivery-pipeline" | "multi-session" | "studio-command-center" | "meta-intelligence" | "strategy-engine";

export type ContinuousRuntimeProofSeedOptions = {
  runtimeId?: string;
  mode?: ContinuousRuntimeProofSeedMode;
};

function isoOffset(baseMs: number, offsetMs: number): string {
  return new Date(baseMs + offsetMs).toISOString();
}

function createGoal(
  overrides: Partial<OperatorDashboardState["queued_goals"][number]> & {
    goal_id: string;
    description: string;
  },
) {
  return {
    goal_id: overrides.goal_id,
    description: overrides.description,
    priority: overrides.priority ?? "medium",
    status: overrides.status ?? "pending",
    explanation: overrides.explanation ?? `${overrides.description} is ready.`,
    recommended_action: overrides.recommended_action ?? null,
    depends_on_goal_ids: [...(overrides.depends_on_goal_ids ?? [])],
    blocking_goal_ids: [...(overrides.blocking_goal_ids ?? [])],
    conflict_goal_ids: [...(overrides.conflict_goal_ids ?? [])],
    last_updated_at: overrides.last_updated_at ?? new Date().toISOString(),
  };
}

function createStoppedService(runtimeId: string, nowMs: number) {
  const service = createBackgroundRuntimeService({
    tick_interval_ms: 60_000,
    max_ticks_per_run: 3,
    max_runs_per_invocation: 1,
    operator_away_mode: true,
    require_supervised_scope: true,
    require_fresh_approvals: true,
    require_fresh_context: true,
  });

  return stopBackgroundRuntimeService({
    ...service,
    service_id: runtimeId,
    started_at: isoOffset(nowMs, -120_000),
    stopped_at: isoOffset(nowMs, -30_000),
    last_tick_at: isoOffset(nowMs, -30_000),
    status: "service_completed",
    ticks_attempted: 1,
    ticks_completed: 1,
  }, "max_ticks_reached");
}

export function createContinuousRuntimeProofSeedPayload(options: ContinuousRuntimeProofSeedOptions = {}): ContinuousRuntimeProofSeedPayload {
  const nowMs = Date.now();
  const mode = options.mode ?? "continuous-runtime";
  const freshRuntimeId = options.runtimeId?.trim() || `live-semantic-proof-${nowMs}`;
  const store = createRuntimeStateStore({ stale_after_ms: 10 * 60 * 1000 });
  const service = {
    ...createStoppedService(freshRuntimeId, nowMs),
    status: "service_blocked" as const,
    stop_reason: "blocker_detected" as const,
    blockers: [{ code: "approval_required", message: "Fresh approval is required." }],
  };
  const record = saveRuntimeState(store, service, "operator_away_safe");
  const currentRecord = loadRuntimeState(store, record.runtime_id);

  if (!currentRecord) {
    throw new Error("Expected a persisted runtime record.");
  }

  currentRecord.continuous_loop = {
    status: "loop_paused",
    started_at: null,
    stopped_at: null,
    last_tick_at: null,
    ticks_attempted: 0,
    ticks_completed: 0,
    last_trigger_result: null,
    reason: "Continuous runtime loop is waiting for fresh operator approval.",
    tick_history: [],
  };
  currentRecord.continuous_loop_config = {
    tick_interval_ms: mode === "continuous-runtime"
      ? 1_000
      : mode === "autonomous-planning"
        || mode === "multi-session"
        || mode === "studio-command-center"
        || mode === "meta-intelligence"
        || mode === "strategy-engine"
        || mode === "delivery-pipeline"
        ? 250
        : 10_000,
    max_ticks_per_run: mode === "continuous-runtime"
      ? 3
      : mode === "autonomous-planning"
        || mode === "multi-session"
        || mode === "studio-command-center"
        || mode === "meta-intelligence"
        || mode === "strategy-engine"
        || mode === "delivery-pipeline"
        ? 4
        : 1,
    max_runs_per_invocation: 1,
    require_fresh_approvals: true,
    require_fresh_context: true,
    stop_on_blocker: true,
    stop_on_error: true,
  };

  currentRecord.operator_dashboard_state = {
    active_goal: createGoal({
      goal_id: "goal-approval-gate",
      description: "Complete live runtime approval gate",
      priority: "high",
      status: "active",
      explanation: "The active goal is ready once approval clears.",
      recommended_action: "Approve the active goal to let runtime continue.",
    }),
    queued_goals: [
      createGoal({
        goal_id: "goal-queued-prereq",
        description: "Complete queued prerequisite cycle",
        priority: "medium",
        status: "pending",
        explanation: "This queued goal should run after the active approval gate clears.",
      }),
      createGoal({
        goal_id: "goal-dependent",
        description: "Complete dependent follow-up cycle",
        priority: "medium",
        status: "pending",
        explanation: "This goal depends on the queued prerequisite.",
        depends_on_goal_ids: ["goal-queued-prereq"],
      }),
    ],
    blocked_goals: [],
    completed_goals: [],
    paused_goals: [],
    dependency_blockers: [],
    conflict_blockers: [],
    recent_failures: [],
    recovery_recommendations: [],
    approvals_required: [{
      goal_id: "goal-approval-gate",
      approvals_needed: ["session"],
      reason: "Session approval required for live runtime continuation.",
      recommended_action: "Approve the active goal.",
    }],
    validation_issues: [],
    runtime_status: {
      status: "runtime_blocked",
      explanation: "The runtime is waiting for operator action.",
    },
    session_status: {
      status: "session_waiting_for_approval",
      explanation: "The session is blocked pending approval.",
    },
    queue_status: {
      status: "queue_running",
      explanation: "Queued work is available.",
    },
    scheduler_status: {
      status: "goal_selected",
      explanation: "An active goal is selected.",
    },
    runtime_observability: {
      current_tick: 0,
      last_tick_at: null,
      last_mutation: null,
      last_semantic_transition: null,
      latest_safety_gate_decision: null,
      next_scheduled_action: "Await operator approval before the next bounded runtime tick.",
      next_scheduled_tick_at: null,
      event_log: [],
    },
    supervised_session: undefined,
    supervised_checkpoints: [],
    last_updated_at: new Date(nowMs).toISOString(),
  };

  if (mode === "autonomous-planning") {
    const planningStartedAt = new Date(nowMs).toISOString();
    const sessionId = createSupervisedAutonomySessionId(record.runtime_id, planningStartedAt);
    const seededLowRiskItem = createAutonomousWorkItem({
      work_item_id: "planning-goal-1",
      title: "Deterministic planning candidate",
      summary: "A bounded planning work item that should schedule into the runtime queue after operator approval.",
      source: "proof_seed",
      proposed_by_agent_id: "planner-agent",
      priority: "high",
      risk_level: "low",
      estimated_tick_cost: 1,
      required_agent_roles: ["planner"],
      required_approval_level: "none",
      dependency_ids: [],
      expected_outputs: ["runner_artifacts/planning-goal-1-summary.json"],
      safety_scope: "bounded_runtime_only",
      status: "proposed",
      created_at: planningStartedAt,
      updated_at: planningStartedAt,
    });
    const seededHighRiskItem = createAutonomousWorkItem({
      work_item_id: "planning-high-risk-1",
      title: "High-risk planning escalation",
      summary: "A high-risk planning work item that must remain gated for explicit operator review.",
      source: "proof_seed",
      proposed_by_agent_id: "planner-agent",
      priority: "medium",
      risk_level: "high",
      estimated_tick_cost: 1,
      required_agent_roles: ["planner", "validator"],
      required_approval_level: "operator_approval",
      dependency_ids: [],
      expected_outputs: ["runner_artifacts/high-risk-planning-summary.json"],
      safety_scope: "bounded_multi_agent_runtime",
      status: "proposed",
      created_at: planningStartedAt,
      updated_at: planningStartedAt,
    });
    const supervisedSession = {
      session_id: sessionId,
      runtime_id: record.runtime_id,
      status: "running" as const,
      started_at: planningStartedAt,
      stopped_at: null,
      duration_ms: 0,
      max_duration_ms: 60 * 60 * 1000,
      tick_budget: 6,
      ticks_completed: 0,
      max_chain_count: 4,
      agent_ids: ["planner-agent", "executor-agent", "validator-agent", "reporter-agent"],
      active_chain_ids: [],
      completed_chain_ids: [],
      failed_chain_ids: [],
      safety_scope: "bounded_multi_agent_runtime" as const,
      approval_policy: "operator_must_approve_start" as const,
      recovery_policy: "request_operator_review" as const,
      last_checkpoint_at: null,
      stop_reason: null,
      last_recovery_action: "none" as const,
      next_scheduled_tick_at: null,
      latest_timeline_event_id: null,
      pending_operator_review: false,
      overnight_policy: null,
      review_queue: [],
      active_recovery: null,
      resume_state: null,
      failure_count: 0,
    };

    currentRecord.last_status = "service_idle";
    currentRecord.stop_reason = "not_started";
    currentRecord.blockers = [];
    currentRecord.continuous_loop.reason = "Continuous runtime loop is ready to execute approved autonomous planning work.";
    currentRecord.operator_dashboard_state = {
      ...currentRecord.operator_dashboard_state,
      active_goal: null,
      queued_goals: [],
      blocked_goals: [],
      completed_goals: [],
      paused_goals: [],
      approvals_required: [],
      runtime_status: {
        status: "runtime_ready",
        explanation: "The runtime is ready to execute approved autonomous work items.",
      },
      session_status: {
        status: "session_running",
        explanation: "The supervised session is active and ready for bounded planning execution.",
      },
      queue_status: {
        status: "queue_running",
        explanation: "Approved autonomous work will be scheduled into the existing bounded runtime queue.",
      },
      scheduler_status: {
        status: "goal_selected",
        explanation: "Deterministic planning recommendations are ready for operator approval.",
      },
      runtime_observability: {
        ...currentRecord.operator_dashboard_state.runtime_observability,
        next_scheduled_action: "Approve the top-ranked autonomous work item to start the bounded planning execution chain.",
      },
      proposed_work_items: [seededLowRiskItem, seededHighRiskItem],
      scheduled_work_items: [],
      running_work_items: [],
      review_packages: [],
      planning_recommendations: [
        {
          work_item_id: seededLowRiskItem.work_item_id,
          title: seededLowRiskItem.title,
          score: 42,
          explanation: "Top-ranked bounded candidate with low risk and immediate runtime budget fit.",
          requires_operator_review: false,
        },
        {
          work_item_id: seededHighRiskItem.work_item_id,
          title: seededHighRiskItem.title,
          score: 11,
          explanation: "Lower-ranked because high-risk work remains gated behind explicit operator approval.",
          requires_operator_review: true,
        },
      ],
      planning_policy_feedback: createAutonomousWorkItemPolicyFeedback(),
      supervised_session: { ...supervisedSession },
      supervised_checkpoints: [],
      last_updated_at: planningStartedAt,
    };
    currentRecord.supervised_session = supervisedSession;
    currentRecord.supervised_checkpoints = [];
  }

  if (mode === "delivery-pipeline") {
    const seededAt = new Date(nowMs).toISOString();
    const reviewPackage = createAutonomousReviewPackage({
      package_id: "delivery-proof-review-package",
      work_item_id: "delivery-proof-work-item",
      chain_id: "delivery-proof-chain",
      status: "approved",
      summary: "A reviewed bounded change set is ready for delivery packaging.",
      files_changed: ["web/lib/aie/operatorControlSurface.ts", "web/app/operator/OperatorDashboardClient.tsx"],
      tests_run: ["npm run test:trace:safe"],
      proof_results: ["proof:autonomous-planning:safe -> proof_passed"],
      risks: ["Operator approval is still required before commit."],
      recommended_decision: "open_pr",
      rollback_notes: "Revert the bounded change set and restore the last approved dashboard state.",
      operator_actions: ["approve", "reject", "request_changes", "open_pr", "archive"],
    });
    const deliveryPackage = createAutonomousDeliveryPackage({
      delivery_package_id: "delivery-delivery-proof-review-package",
      review_package_id: reviewPackage.package_id,
      work_item_id: reviewPackage.work_item_id,
      chain_id: reviewPackage.chain_id,
      branch_name: "autonomy/delivery-proof-work-item",
      commit_plan: [
        "Stage the reviewed delivery pipeline changes.",
        "Capture validation and proof evidence before commit approval.",
        "Prepare PR summary and rollback notes for operator signoff.",
      ],
      files_changed: [...reviewPackage.files_changed],
      validation_results: [...reviewPackage.tests_run],
      proof_results: [...reviewPackage.proof_results],
      risk_summary: "Operator approval is still required before commit.",
      rollback_plan: reviewPackage.rollback_notes,
      release_notes: "Delivery-ready package seeded for the bounded operator approval proof.",
      recommended_pr_title: "AI-E: deliver delivery-proof-work-item",
      recommended_pr_body: "Summary: Delivery-ready package seeded for the bounded operator approval proof.\n\nValidation evidence: npm run test:trace:safe\n\nProof evidence: proof:autonomous-planning:safe -> proof_passed\n\nRollback notes: Revert the bounded change set and restore the last approved dashboard state.",
      operator_decision: null,
      status: "awaiting_operator_approval",
      created_at: seededAt,
      updated_at: seededAt,
    });

    currentRecord.last_status = "service_idle";
    currentRecord.stop_reason = "not_started";
    currentRecord.blockers = [];
    currentRecord.continuous_loop.reason = "Continuous runtime loop is ready for bounded delivery-package approval.";
    currentRecord.operator_dashboard_state = {
      ...currentRecord.operator_dashboard_state,
      active_goal: null,
      queued_goals: [],
      blocked_goals: [],
      completed_goals: [],
      paused_goals: [],
      approvals_required: [],
      runtime_status: {
        status: "runtime_ready",
        explanation: "The runtime is ready for bounded delivery approval handling.",
      },
      session_status: {
        status: "session_idle",
        explanation: "No supervised session is required for this delivery approval proof.",
      },
      queue_status: {
        status: "queue_idle",
        explanation: "No queued runtime work is pending; the operator is reviewing a delivery package.",
      },
      scheduler_status: {
        status: "scheduler_idle",
        explanation: "The bounded scheduler is waiting for an operator delivery decision.",
      },
      runtime_observability: {
        ...currentRecord.operator_dashboard_state.runtime_observability,
        next_scheduled_action: "Approve the delivery package to record bounded commit authorization.",
        latest_safety_gate_decision: "passed",
      },
      proposed_work_items: [],
      scheduled_work_items: [],
      running_work_items: [],
      review_packages: [reviewPackage],
      delivery_packages: [deliveryPackage],
      planning_recommendations: [],
      planning_policy_feedback: createAutonomousWorkItemPolicyFeedback(),
      supervised_session: undefined,
      supervised_checkpoints: [],
      last_updated_at: seededAt,
    };
    currentRecord.supervised_session = null;
    currentRecord.supervised_checkpoints = [];
  }

  if (mode === "multi-session") {
    const seededAt = new Date(nowMs).toISOString();
    const demoState = createOperatorDashboardDemoState();

    currentRecord.last_status = "service_idle";
    currentRecord.stop_reason = "not_started";
    currentRecord.blockers = [];
    currentRecord.continuous_loop.reason = "Continuous runtime loop is ready for bounded multi-session orchestration review.";
    currentRecord.operator_dashboard_state = {
      ...currentRecord.operator_dashboard_state,
      active_goal: null,
      queued_goals: [],
      blocked_goals: [],
      completed_goals: [],
      paused_goals: [],
      dependency_blockers: [],
      conflict_blockers: [],
      recent_failures: [],
      recovery_recommendations: [],
      approvals_required: [],
      validation_issues: [],
      runtime_status: {
        status: "runtime_ready",
        explanation: "The runtime is ready to coordinate multiple bounded autonomous sessions.",
      },
      session_status: {
        status: "session_running",
        explanation: "Multiple autonomous sessions are active under shared safety constraints.",
      },
      queue_status: {
        status: "queue_running",
        explanation: "Session work remains bounded by scheduler, resource, and conflict gates.",
      },
      scheduler_status: {
        status: "goal_selected",
        explanation: "The bounded scheduler is coordinating runnable autonomous sessions.",
      },
      runtime_observability: {
        ...currentRecord.operator_dashboard_state.runtime_observability,
        next_scheduled_action: "Review or adjust the bounded autonomous session schedule.",
        latest_safety_gate_decision: "passed",
      },
      proposed_work_items: [],
      scheduled_work_items: [],
      running_work_items: [],
      review_packages: [],
      delivery_packages: [],
      planning_recommendations: [],
      planning_policy_feedback: createAutonomousWorkItemPolicyFeedback(),
      autonomous_sessions: demoState.autonomous_sessions,
      supervised_session: undefined,
      supervised_checkpoints: [],
      last_updated_at: seededAt,
    };
    currentRecord.supervised_session = null;
    currentRecord.supervised_checkpoints = [];
  }

  if (mode === "studio-command-center") {
    const seededAt = new Date(nowMs).toISOString();
    const demoState = createOperatorDashboardDemoState();
    const reviewPackage = createAutonomousReviewPackage({
      package_id: "studio-review-package-1",
      work_item_id: "studio-review-work-item",
      chain_id: "studio-review-chain",
      status: "pending",
      summary: "A bounded review package is waiting behind a blocked studio lane.",
      files_changed: ["web/app/operator/OperatorDashboardClient.tsx"],
      tests_run: ["npx tsx --test lib/aie/studioHealthAggregator.test.ts"],
      proof_results: ["proof:multi-session:safe -> proof_passed"],
      risks: ["A blocked bugfix session still needs operator attention."],
      recommended_decision: "approve",
      rollback_notes: "Revert the bounded studio dashboard patch and restore the last approved runtime state.",
      operator_actions: ["approve", "reject", "defer", "request_changes", "open_pr", "archive"],
    });
    const deliveryPackage = createAutonomousDeliveryPackage({
      delivery_package_id: "studio-delivery-package-1",
      review_package_id: reviewPackage.package_id,
      work_item_id: "studio-delivery-work-item",
      chain_id: "studio-delivery-chain",
      branch_name: "autonomy/studio-delivery-work-item",
      commit_plan: [
        "Stage the bounded studio command-center changes.",
        "Capture trace and proof evidence before delivery approval.",
        "Prepare rollback notes for operator signoff.",
      ],
      files_changed: ["web/app/operator/OperatorDashboardClient.tsx", "web/lib/aie/studioHealthAggregator.ts"],
      validation_results: ["npx tsx --test lib/aie/runtimeMutationExecutor.test.ts lib/aie/safeRuntimeActionBridge.test.ts"],
      proof_results: ["proof:delivery-pipeline:safe -> proof_passed"],
      risk_summary: "Delivery is pending while the studio command center still shows blocked runtime work.",
      rollback_plan: "Revert the studio command-center patch and restore the last approved runtime state.",
      release_notes: "Delivery-ready bounded studio command-center patch awaiting operator approval.",
      recommended_pr_title: "AI-E: deliver studio command center",
      recommended_pr_body: "Summary: Delivery-ready bounded studio command-center patch awaiting operator approval.",
      operator_decision: null,
      status: "awaiting_operator_approval",
      created_at: seededAt,
      updated_at: seededAt,
    });

    currentRecord.last_status = "service_idle";
    currentRecord.stop_reason = "not_started";
    currentRecord.blockers = [];
    currentRecord.continuous_loop.reason = "Continuous runtime loop is ready for bounded studio command-center operator supervision.";
    currentRecord.operator_dashboard_state = {
      ...currentRecord.operator_dashboard_state,
      active_goal: null,
      queued_goals: demoState.queued_goals,
      blocked_goals: demoState.blocked_goals,
      completed_goals: demoState.completed_goals,
      paused_goals: [],
      dependency_blockers: demoState.dependency_blockers,
      conflict_blockers: demoState.conflict_blockers,
      recent_failures: demoState.recent_failures,
      recovery_recommendations: demoState.recovery_recommendations,
      approvals_required: [],
      validation_issues: [],
      runtime_status: {
        status: "runtime_ready",
        explanation: "The studio command center is supervising the bounded runtime from live persisted state.",
      },
      session_status: {
        status: "session_running",
        explanation: "One autonomous session is runnable while another is blocked for operator attention.",
      },
      queue_status: {
        status: "queue_running",
        explanation: "Studio work is bounded by review, delivery, and multi-session safety gates.",
      },
      scheduler_status: {
        status: "goal_selected",
        explanation: "The studio command center is highlighting the next operator-safe decision.",
      },
      runtime_observability: {
        ...currentRecord.operator_dashboard_state.runtime_observability,
        current_tick: 0,
        next_scheduled_action: "Review the blocked session, the pending review package, and the pending delivery queue before resuming safe work.",
        latest_safety_gate_decision: "passed",
      },
      proposed_work_items: demoState.proposed_work_items,
      scheduled_work_items: demoState.scheduled_work_items,
      running_work_items: demoState.running_work_items,
      review_packages: [reviewPackage],
      delivery_packages: [deliveryPackage],
      planning_recommendations: demoState.planning_recommendations,
      planning_policy_feedback: demoState.planning_policy_feedback ?? createAutonomousWorkItemPolicyFeedback(),
      autonomous_sessions: demoState.autonomous_sessions ? {
        ...demoState.autonomous_sessions,
        sessions: demoState.autonomous_sessions.sessions.map((session) => session.session_id === "demo-session-feature-ui"
          ? {
            ...session,
            status: "running",
            blocked_by_conflict: false,
            ready_on_dependency: true,
          }
          : {
            ...session,
            status: "blocked",
            blocked_by_conflict: true,
            ready_on_dependency: false,
          }),
        blocked_session_ids: ["demo-session-bugfix-delivery"],
        runnable_session_ids: ["demo-session-feature-ui"],
        ready_session_ids: ["demo-session-feature-ui"],
      } : undefined,
      supervised_session: undefined,
      supervised_checkpoints: [],
      studio_risk_acknowledgements: [],
      studio_summary_package: null,
      last_updated_at: seededAt,
    };
    currentRecord.supervised_session = null;
    currentRecord.supervised_checkpoints = [];
  }

  if (mode === "meta-intelligence") {
    const seededAt = new Date(nowMs).toISOString();
    const demoState = createOperatorDashboardDemoState();

    currentRecord.last_status = "service_paused";
    currentRecord.stop_reason = "operator_pause";
    currentRecord.blockers = [];
    currentRecord.continuous_loop.reason = "Continuous runtime loop is paused while the operator reviews bounded meta-intelligence evidence.";
    currentRecord.operator_dashboard_state = {
      ...currentRecord.operator_dashboard_state,
      active_goal: null,
      queued_goals: demoState.queued_goals,
      blocked_goals: demoState.blocked_goals,
      completed_goals: demoState.completed_goals,
      paused_goals: demoState.paused_goals,
      dependency_blockers: demoState.dependency_blockers,
      conflict_blockers: demoState.conflict_blockers,
      recent_failures: demoState.recent_failures,
      recovery_recommendations: demoState.recovery_recommendations,
      approvals_required: [],
      validation_issues: [],
      runtime_status: {
        status: "runtime_paused",
        explanation: "The meta-intelligence layer is paused for operator review of bounded live runtime evidence.",
      },
      session_status: {
        status: "session_paused",
        explanation: "The bounded runtime history is available for meta-intelligence review without active autonomous execution.",
      },
      queue_status: {
        status: "queue_idle",
        explanation: "Meta-intelligence recommendations remain advisory and operator-gated while execution is paused.",
      },
      scheduler_status: {
        status: "scheduler_idle",
        explanation: "The next safe operator action is to review bounded meta-intelligence recommendations.",
      },
      runtime_observability: {
        ...currentRecord.operator_dashboard_state.runtime_observability,
        current_tick: 0,
        next_scheduled_action: "Review a detected pattern, decide whether to approve a bounded policy recommendation, and optionally request a fresh meta summary.",
        latest_safety_gate_decision: "passed",
      },
      proposed_work_items: demoState.proposed_work_items,
      scheduled_work_items: demoState.scheduled_work_items,
      running_work_items: demoState.running_work_items,
      review_packages: demoState.review_packages,
      delivery_packages: demoState.delivery_packages,
      planning_recommendations: demoState.planning_recommendations,
      planning_policy_feedback: demoState.planning_policy_feedback ?? createAutonomousWorkItemPolicyFeedback(),
      autonomous_sessions: demoState.autonomous_sessions ? {
        ...demoState.autonomous_sessions,
        sessions: demoState.autonomous_sessions.sessions.map((session, index) => ({
          ...session,
          status: index === 0 ? "paused" : "blocked",
          blocked_by_conflict: index !== 0,
          ready_on_dependency: index === 0,
        })),
        runnable_session_ids: [],
        ready_session_ids: [],
        blocked_session_ids: demoState.autonomous_sessions.sessions.filter((_, index) => index !== 0).map((session) => session.session_id),
        scheduler_status: {
          status: "no_runnable_sessions",
          explanation: "No autonomous session is runnable while the operator reviews meta-intelligence recommendations.",
        },
        resource_status: {
          status: "resource_idle",
          explanation: "The meta-intelligence proof keeps all autonomous execution paused or blocked.",
        },
      } : undefined,
      supervised_session: demoState.supervised_session,
      supervised_checkpoints: demoState.supervised_checkpoints,
      studio_risk_acknowledgements: demoState.studio_risk_acknowledgements,
      studio_summary_package: demoState.studio_summary_package,
      meta_intelligence: demoState.meta_intelligence,
      meta_detected_patterns: demoState.meta_detected_patterns,
      meta_policy_recommendations: demoState.meta_policy_recommendations,
      meta_policy_state: demoState.meta_policy_state,
      meta_operator_decision_history: [],
      meta_summary_package: null,
      last_updated_at: seededAt,
    };
    currentRecord.supervised_session = demoState.supervised_session ?? null;
    currentRecord.supervised_checkpoints = demoState.supervised_checkpoints ?? [];
  }

  if (mode === "strategy-engine") {
    const seededAt = new Date(nowMs).toISOString();
    const demoState = createOperatorDashboardDemoState();

    currentRecord.last_status = "service_paused";
    currentRecord.stop_reason = "operator_pause";
    currentRecord.blockers = [];
    currentRecord.continuous_loop.reason = "Continuous runtime loop is paused while the operator reviews bounded strategy portfolio actions.";
    currentRecord.operator_dashboard_state = {
      ...currentRecord.operator_dashboard_state,
      active_goal: null,
      queued_goals: demoState.queued_goals,
      blocked_goals: demoState.blocked_goals,
      completed_goals: demoState.completed_goals,
      paused_goals: demoState.paused_goals,
      dependency_blockers: demoState.dependency_blockers,
      conflict_blockers: demoState.conflict_blockers,
      recent_failures: demoState.recent_failures,
      recovery_recommendations: demoState.recovery_recommendations,
      approvals_required: [],
      validation_issues: [],
      runtime_status: {
        status: "runtime_paused",
        explanation: "The strategy engine layer is paused for operator review of bounded strategic objectives.",
      },
      session_status: {
        status: "session_paused",
        explanation: "The bounded runtime is paused while the operator manages strategic goals and advisory decompositions.",
      },
      queue_status: {
        status: "queue_idle",
        explanation: "Strategy portfolio actions stay advisory and do not start runtime execution automatically.",
      },
      scheduler_status: {
        status: "scheduler_idle",
        explanation: "The next safe operator action is to review, activate, or decompose a strategic goal.",
      },
      runtime_observability: {
        ...currentRecord.operator_dashboard_state.runtime_observability,
        current_tick: 0,
        next_scheduled_action: "Review a proposed strategic goal, activate an approved goal, decompose bounded work, and request a fresh strategy summary.",
        latest_safety_gate_decision: "passed",
      },
      proposed_work_items: demoState.proposed_work_items,
      scheduled_work_items: demoState.scheduled_work_items,
      running_work_items: demoState.running_work_items,
      review_packages: demoState.review_packages,
      delivery_packages: demoState.delivery_packages,
      planning_recommendations: demoState.planning_recommendations,
      planning_policy_feedback: demoState.planning_policy_feedback ?? createAutonomousWorkItemPolicyFeedback(),
      autonomous_sessions: demoState.autonomous_sessions ? {
        ...demoState.autonomous_sessions,
        sessions: demoState.autonomous_sessions.sessions.map((session, index) => ({
          ...session,
          status: index === 0 ? "paused" : "blocked",
          blocked_by_conflict: index !== 0,
          ready_on_dependency: false,
        })),
        runnable_session_ids: [],
        ready_session_ids: [],
        blocked_session_ids: demoState.autonomous_sessions.sessions.map((session) => session.session_id),
        scheduler_status: {
          status: "no_runnable_sessions",
          explanation: "No autonomous session is runnable while the operator manages strategy portfolio state.",
        },
        resource_status: {
          status: "resource_idle",
          explanation: "The strategy engine proof keeps all autonomous execution paused or blocked.",
        },
      } : undefined,
      supervised_session: demoState.supervised_session,
      supervised_checkpoints: demoState.supervised_checkpoints,
      studio_risk_acknowledgements: demoState.studio_risk_acknowledgements,
      studio_summary_package: demoState.studio_summary_package,
      meta_intelligence: demoState.meta_intelligence,
      meta_detected_patterns: demoState.meta_detected_patterns,
      meta_policy_recommendations: demoState.meta_policy_recommendations,
      meta_policy_state: demoState.meta_policy_state,
      meta_operator_decision_history: demoState.meta_operator_decision_history,
      meta_summary_package: demoState.meta_summary_package,
      strategy_goals: demoState.strategy_goals,
      strategy_portfolio_scores: demoState.strategy_portfolio_scores,
      strategy_decision_history: [],
      strategy_decompositions: [],
      strategy_summary_package: null,
      last_updated_at: seededAt,
    };
    currentRecord.supervised_session = demoState.supervised_session ?? null;
    currentRecord.supervised_checkpoints = demoState.supervised_checkpoints ?? [];
  }

  if (mode === "supervised-autonomy" || mode === "overnight-autonomy") {
    const startedAt = new Date(nowMs).toISOString();
    const sessionId = createSupervisedAutonomySessionId(record.runtime_id, startedAt);
    const supervisedSession = {
      session_id: sessionId,
      runtime_id: record.runtime_id,
      status: mode === "overnight-autonomy" ? "waiting_for_operator" as const : "pending_approval" as const,
      started_at: startedAt,
      stopped_at: null,
      duration_ms: 0,
      max_duration_ms: 8 * 60 * 60 * 1000,
      tick_budget: 6,
      ticks_completed: 0,
      max_chain_count: 4,
      agent_ids: [],
      active_chain_ids: [],
      completed_chain_ids: [],
      failed_chain_ids: [],
      safety_scope: "bounded_multi_agent_runtime" as const,
      approval_policy: "operator_must_approve_start" as const,
      recovery_policy: "request_operator_review" as const,
      last_checkpoint_at: null,
      stop_reason: null,
      last_recovery_action: "none" as const,
      next_scheduled_tick_at: null,
      latest_timeline_event_id: null,
      pending_operator_review: mode === "overnight-autonomy",
      overnight_policy: mode === "overnight-autonomy"
        ? {
          policy_id: createOvernightAutonomyPolicyId(sessionId, startedAt),
          session_id: sessionId,
          max_runtime_hours: 8,
          allowed_time_window: {
            start_time: "22:00",
            end_time: "06:00",
          },
          max_tick_count: 6,
          max_chain_count: 4,
          max_retries_per_chain: 1,
          max_recovery_attempts: 2,
          requires_operator_review_before_commit: true,
          allowed_agent_roles: ["planner", "executor", "validator"],
          disallowed_actions: ["commit_changes", "push_branch"],
          shutdown_on_failure_count: 2,
          checkpoint_interval_ticks: 1,
          review_queue_enabled: true,
        }
        : null,
      review_queue: mode === "overnight-autonomy"
        ? [{
          review_id: createOvernightAutonomyReviewId(sessionId, startedAt),
          session_id: sessionId,
          source_event_id: `overnight-proof-review-${nowMs}`,
          source_chain_id: "execution-chain-proof",
          source_agent_id: "validator-agent",
          severity: "high" as const,
          title: "Review bounded overnight recovery",
          summary: "The overnight session paused after a bounded recovery event and needs an operator decision.",
          recommended_action: "Approve the queued overnight recovery item to clear the review gate.",
          required_operator_decision: "approve" as const,
          created_at: startedAt,
          status: "pending" as const,
        }]
        : [],
      active_recovery: mode === "overnight-autonomy"
        ? {
          recovery_id: `overnight-proof-recovery-${nowMs}`,
          session_id: sessionId,
          source_event_id: `overnight-proof-review-${nowMs}`,
          source_chain_id: "execution-chain-proof",
          source_agent_id: "validator-agent",
          selected_outcome: "request_operator_review" as const,
          retry_count_for_chain: 1,
          recovery_attempt_count: 1,
          rollback_checkpoint_id: `supervised-checkpoint-${sessionId}-seeded-1`,
          summary: "A bounded overnight recovery decision was escalated for operator review.",
          created_at: startedAt,
        }
        : null,
      resume_state: mode === "overnight-autonomy"
        ? {
          resume_status: "resumed_from_checkpoint" as const,
          restart_count: 1,
          resumed_from_checkpoint_id: `supervised-checkpoint-${sessionId}-seeded-1`,
          resumed_at: startedAt,
          preserved_review_queue_count: 1,
          shutdown_reason: null,
        }
        : null,
      failure_count: mode === "overnight-autonomy" ? 1 : 0,
    };

    currentRecord.supervised_session = supervisedSession;
    currentRecord.supervised_checkpoints = mode === "overnight-autonomy"
      ? [{
        checkpoint_id: `supervised-checkpoint-${sessionId}-seeded-1`,
        session_id: sessionId,
        timestamp: startedAt,
        tick_index: 1,
        agent_states: [],
        active_chains: ["execution-chain-proof"],
        queued_goals: currentRecord.operator_dashboard_state.queued_goals.map((goal) => goal.goal_id),
        completed_goals: [],
        safety_status: "review_required" as const,
        latest_timeline_event_id: `overnight-proof-review-${nowMs}`,
      }]
      : [];
    currentRecord.operator_dashboard_state.supervised_session = { ...supervisedSession };
    currentRecord.operator_dashboard_state.supervised_checkpoints = [...currentRecord.supervised_checkpoints];
    currentRecord.operator_dashboard_state.session_status = {
      status: "session_waiting_for_approval",
      explanation: mode === "overnight-autonomy"
        ? "The overnight autonomy session is waiting for operator review."
        : "The supervised autonomy session is pending operator approval.",
    };
    currentRecord.operator_dashboard_state.runtime_observability = {
      ...currentRecord.operator_dashboard_state.runtime_observability,
      next_scheduled_action: mode === "overnight-autonomy"
        ? "Resolve the overnight review queue item before the next bounded resume."
        : "Approve the pending supervised session to start bounded autonomous ticks.",
    };
  }

  persistRuntimeStateRecord(store, currentRecord);

  return {
    runtimeId: record.runtime_id,
    store,
  };
}