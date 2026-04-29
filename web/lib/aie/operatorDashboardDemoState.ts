import { createAutonomousWorkSession } from "./autonomousWorkSession";
import { createAutonomousDeliveryPackage, createAutonomousReviewPackage, createAutonomousWorkItem, createAutonomousWorkItemPolicyFeedback } from "./autonomousWorkPlanning";
import { createAutonomousSessionRecord, createAutonomousSessionRegistry } from "./autonomousSessionRegistry";
import { buildRecoveryReport } from "./failureRecoveryIntelligence";
import { createMultiSessionSchedulerState } from "./multiSessionScheduler";
import { createGoalQueue, createGoalRecord } from "./multiGoalOrchestrator";
import { createMetaIntelligenceSummaryPackage } from "./metaIntelligenceSummary";
import { buildMetaIntelligenceState, detectMetaPatterns } from "./metaPatternDetector";
import { deriveMetaPolicyState, recommendMetaPolicyAdjustments } from "./metaPolicyRecommender";
import { buildOperatorDashboardState, type OperatorDashboardState } from "./operatorDashboardState";
import { buildRuntimeResult } from "./sessionRuntime";

const DEMO_TIMESTAMP = "2026-04-26T12:00:00.000Z";

export function createOperatorDashboardDemoState(): OperatorDashboardState {
  const goalQueue = createGoalQueue([
    createGoalRecord({
      id: "stabilize-kbm-input",
      description: "Stabilize KBM input lane",
      priority: "high",
      status: "active",
      created_at: "2026-04-26T11:40:00.000Z",
      last_updated_at: "2026-04-26T11:58:00.000Z",
    }),
    createGoalRecord({
      id: "audit-reload-window",
      description: "Audit reload window timing",
      priority: "medium",
      status: "pending",
      created_at: "2026-04-26T11:45:00.000Z",
      last_updated_at: "2026-04-26T11:56:00.000Z",
    }),
    createGoalRecord({
      id: "verify-grenade-lane",
      description: "Verify grenade launch lane",
      priority: "high",
      status: "pending",
      created_at: "2026-04-26T11:46:00.000Z",
      last_updated_at: "2026-04-26T11:57:00.000Z",
      depends_on_goal_ids: ["stabilize-kbm-input"],
    }),
  ]);

  const approvalSession = createAutonomousWorkSession({
    operatorGoal: "Renew approval for bounded runtime handoff",
    createdAt: "2026-04-26T11:52:00.000Z",
    sessionApproval: false,
    chainInput: {
      maxSteps: 1,
      requestedSteps: [
        {
          title: "Renew approval",
          plannerReadyRequest: "Renew approval",
          requiredGate: "controlled_validation",
          validationRequired: true,
          commitAllowed: false,
          pushAllowed: false,
          stopOnFailure: true,
        },
      ],
    },
  });

  const recoveryReport = buildRecoveryReport({
    created_at: "2026-04-26T11:59:00.000Z",
    source: "controlled_validation",
    status: "validation_failed",
    message: "The expected grenade telemetry file was not written.",
    failures: [
      {
        code: "missing_file",
        message: "Expected grenade telemetry file is missing.",
        file_path: "Logs/grenade-lane.json",
      },
    ],
    validation_status: "validation_failed",
    validation_recommendation: "review_required",
  });

  const autonomousSessionRegistry = createAutonomousSessionRegistry({
    runtime_id: "demo-runtime",
    created_at: "2026-04-26T11:54:00.000Z",
    updated_at: "2026-04-26T11:59:00.000Z",
    global_tick_budget: 8,
    sessions: [
      createAutonomousSessionRecord({
        session_id: "demo-session-feature-ui",
        runtime_id: "demo-runtime",
        session_type: "feature",
        priority: "high",
        status: "running",
        allocated_resources: { logical_cpu_units: 2, tick_budget: 5, chain_slots: 2, agent_assignments_allowed: 2 },
        active_chain_ids: ["chain-ui-runtime"],
        queued_work_item_ids: ["demo-work-proof-summary"],
        assigned_agent_ids: ["planner-agent", "reporter-agent"],
        start_time: "2026-04-26T11:54:00.000Z",
        last_tick: "2026-04-26T11:58:00.000Z",
        coordination_group_id: "demo-group-ui",
      }),
      createAutonomousSessionRecord({
        session_id: "demo-session-bugfix-delivery",
        runtime_id: "demo-runtime",
        session_type: "bugfix",
        priority: "medium",
        status: "pending",
        allocated_resources: { logical_cpu_units: 1, tick_budget: 4, chain_slots: 1, agent_assignments_allowed: 1 },
        active_chain_ids: ["chain-delivery-proof"],
        queued_work_item_ids: ["demo-work-risky-refactor"],
        assigned_agent_ids: ["validator-agent"],
        start_time: "2026-04-26T11:56:00.000Z",
        coordination_group_id: "demo-group-ui",
        parent_session_id: "demo-session-feature-ui",
      }),
    ],
  });

  const state = buildOperatorDashboardState({
    goal_queue: goalQueue,
    runtime_result: buildRuntimeResult(approvalSession),
    recovery_reports: [recoveryReport],
    autonomous_work_items: [
      createAutonomousWorkItem({
        work_item_id: "demo-work-proof-summary",
        title: "Package overnight proof findings",
        summary: "Prepare a concise review packet from the latest overnight proof run.",
        source: "planner-demo",
        proposed_by_agent_id: "planner-agent",
        priority: "medium",
        risk_level: "low",
        estimated_tick_cost: 2,
        required_agent_roles: ["reporter"],
        required_approval_level: "none",
        dependency_ids: [],
        expected_outputs: ["proof-summary.md"],
        safety_scope: "bounded_runtime_only",
        status: "approved_for_planning",
        created_at: "2026-04-26T11:55:00.000Z",
        updated_at: "2026-04-26T11:58:00.000Z",
      }),
      createAutonomousWorkItem({
        work_item_id: "demo-work-risky-refactor",
        title: "Refactor runtime scoring heuristic",
        summary: "High-risk planning work that still requires operator approval.",
        source: "planner-demo",
        proposed_by_agent_id: "planner-agent",
        priority: "high",
        risk_level: "high",
        estimated_tick_cost: 5,
        required_agent_roles: ["planner", "validator"],
        required_approval_level: "operator_approval",
        dependency_ids: [],
        expected_outputs: ["scoring-plan.md"],
        safety_scope: "bounded_multi_agent_runtime",
        status: "proposed",
        created_at: "2026-04-26T11:56:00.000Z",
        updated_at: "2026-04-26T11:59:00.000Z",
      }),
    ],
    review_packages: [
      createAutonomousReviewPackage({
        package_id: "demo-review-package",
        work_item_id: "demo-work-proof-summary",
        chain_id: "demo-chain-proof-summary",
        status: "pending",
        summary: "A bounded proof summary is ready for operator decision.",
        files_changed: ["web/lib/aie/operatorDashboardState.ts"],
        tests_run: ["npm run test:trace:safe"],
        proof_results: ["proof:overnight-autonomy:safe -> proof_passed"],
        risks: ["No runtime mutation changes"],
        recommended_decision: "open_pr",
        rollback_notes: "Review artifact only; no rollback required.",
        operator_actions: ["approve", "reject", "defer", "request_changes", "open_pr", "archive"],
      }),
    ],
    delivery_packages: [
      createAutonomousDeliveryPackage({
        delivery_package_id: "delivery-demo-review-package-approved",
        review_package_id: "demo-review-package-approved",
        work_item_id: "demo-work-delivery-ready",
        chain_id: "demo-chain-delivery-ready",
        branch_name: "autonomy/demo-work-delivery-ready",
        commit_plan: [
          "Stage the approved operator dashboard delivery patch.",
          "Run validation evidence capture before commit approval.",
          "Prepare the PR summary and rollback notes for operator signoff.",
        ],
        files_changed: ["web/app/operator/OperatorDashboardClient.tsx", "web/lib/aie/operatorControlSurface.ts"],
        validation_results: ["npm run test:trace:safe"],
        proof_results: ["proof:autonomous-planning:safe -> proof_passed"],
        risk_summary: "UI handoff still requires operator confirmation before commit.",
        rollback_plan: "Revert the operator dashboard delivery patch and restore the last approved runtime handoff state.",
        release_notes: "Delivery-ready package with validation evidence and rollback notes.",
        recommended_pr_title: "AI-E: deliver demo-work-delivery-ready",
        recommended_pr_body: "Summary: Delivery-ready operator dashboard patch.\n\nValidation evidence: npm run test:trace:safe\n\nProof evidence: proof:autonomous-planning:safe -> proof_passed\n\nRollback notes: Revert the operator dashboard delivery patch and restore the last approved runtime handoff state.",
        operator_decision: null,
        status: "awaiting_operator_approval",
        created_at: "2026-04-26T11:58:00.000Z",
        updated_at: "2026-04-26T11:59:00.000Z",
      }),
    ],
    planning_policy_feedback: createAutonomousWorkItemPolicyFeedback({ approvals_recorded: 2, deferrals_recorded: 1 }),
    planning_budget: 3,
    autonomous_session_registry: autonomousSessionRegistry,
    autonomous_session_scheduler: createMultiSessionSchedulerState({
      global_tick_budget: 8,
      global_ticks_consumed: 2,
      per_session_ticks: {
        "demo-session-feature-ui": 2,
        "demo-session-bugfix-delivery": 1,
      },
    }),
    session_resource_allocator_config: {
      max_logical_cpu_units: 6,
      max_concurrent_chains: 4,
      max_chains_per_session: 2,
    },
    session_file_targets: {
      "demo-session-feature-ui": ["web/app/operator/OperatorDashboardClient.tsx"],
      "demo-session-bugfix-delivery": ["web/app/operator/OperatorDashboardClient.tsx"],
    },
    session_goal_targets: {
      "demo-session-feature-ui": ["goal-operator-dashboard"],
      "demo-session-bugfix-delivery": ["goal-operator-dashboard"],
    },
    session_coordinator: {
      groups: [{ coordination_group_id: "demo-group-ui", session_ids: ["demo-session-feature-ui", "demo-session-bugfix-delivery"], status: "active", shared_goal: "Operator dashboard handoff" }],
      dependencies: [{ source_session_id: "demo-session-feature-ui", target_session_id: "demo-session-bugfix-delivery", relationship: "unlocks", status: "pending", reason: "Bugfix session waits for the feature session to stabilize the dashboard lane." }],
    },
    generated_at: DEMO_TIMESTAMP,
  });

  state.meta_operator_decision_history = [];
  state.meta_policy_state = deriveMetaPolicyState(state);
  state.meta_detected_patterns = detectMetaPatterns({
    studio_operations_state: state.studio_operations,
    runtime_timeline_events: state.runtime_observability?.event_log,
    execution_chains: state.execution_chains,
    review_packages: state.review_packages,
    delivery_packages: state.delivery_packages,
    recovery_events: state.recovery_recommendations,
    operator_decisions: state.meta_operator_decision_history,
    autonomous_sessions: state.autonomous_sessions,
    agent_runtime: state.agent_runtime,
  });
  state.meta_policy_recommendations = recommendMetaPolicyAdjustments({
    detected_patterns: state.meta_detected_patterns,
    current_policy_state: state.meta_policy_state,
    overnight_policy: state.supervised_session?.overnight_policy,
    recovery_policy: state.supervised_session?.recovery_policy ?? null,
    planning_priority_weights: (state.planning_recommendations ?? []).map((item) => `${item.work_item_id}:${item.score}`),
    delivery_gating_rules: (state.delivery_packages ?? []).map((item) => `${item.delivery_package_id}:${item.status}`),
    operator_decision_history: state.meta_operator_decision_history,
    timestamp: state.last_updated_at,
  });
  state.meta_intelligence = buildMetaIntelligenceState(state, state.meta_detected_patterns, state.meta_policy_recommendations);
  state.meta_summary_package = createMetaIntelligenceSummaryPackage(state, state.last_updated_at);
  return state;
}

export async function loadOperatorDashboardState(): Promise<OperatorDashboardState> {
  return createOperatorDashboardDemoState();
}