import { createAutonomousWorkSession } from "./autonomousWorkSession";
import { buildRecoveryReport } from "./failureRecoveryIntelligence";
import { createGoalQueue, createGoalRecord } from "./multiGoalOrchestrator";
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

  return buildOperatorDashboardState({
    goal_queue: goalQueue,
    runtime_result: buildRuntimeResult(approvalSession),
    recovery_reports: [recoveryReport],
    generated_at: DEMO_TIMESTAMP,
  });
}

export async function loadOperatorDashboardState(): Promise<OperatorDashboardState> {
  return createOperatorDashboardDemoState();
}