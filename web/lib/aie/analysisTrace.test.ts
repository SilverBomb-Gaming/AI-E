import assert from "node:assert/strict";
import test from "node:test";

import type { FollowUpVerificationState, StoredActionChainState } from "../../components/AnalysisForm";
import { buildAnalysisTraceRecord, listMissingAnalysisTraceFields } from "./analysisTrace";
import {
  advanceExecutionSelfDirection,
  initializeExecutionSelfDirection,
  advanceExecutionOrchestration,
  createExecutionOrchestrationState,
  recordExecutorOutcome,
  recordPlannerHandoff,
} from "./orchestrationSession";
import type { AnalysisInput, ExecutionRuntimeResult, FreeAnalysisResponse } from "./types";

function makeInput(problemDescription: string, overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    problemDescription,
    sessionId: "test-session",
    stepIndex: 1,
    goal: "Confirm whether the Animator handoff is the leading cause.",
    ...overrides,
  };
}

function makeResult(overrides: Partial<FreeAnalysisResponse> = {}): FreeAnalysisResponse {
  return {
    what_happened: "The Animator state transition is the most likely cause of the symptom.",
    what_matters: ["Animator speed values are changing during the failing transition."],
    what_to_do_next: [
      "Temporarily disable the Animator transition override and compare the behavior before and after.",
    ],
    upgrade_hint: "",
    ...overrides,
  };
}

function buildTrace(params: {
  input: AnalysisInput;
  result: FreeAnalysisResponse;
  isRefined?: boolean;
  lastObservation?: string;
  verificationState?: FollowUpVerificationState;
  previousActionChainState?: StoredActionChainState;
  executedAction?: string;
  orchestrationState?: ReturnType<typeof createExecutionOrchestrationState>;
  executionNodeId?: string;
  executionNodeMode?: "web" | "headless" | "local-node";
  nodeCapabilitySummary?: string;
  taskId?: string;
}) {
  return buildAnalysisTraceRecord(params);
}

function makeExecutionResult(overrides: Partial<ExecutionRuntimeResult> = {}): ExecutionRuntimeResult {
  return {
    status: "success",
    output: "Sandbox file write completed.",
    changedPaths: ["web/sandbox/trace-note.txt"],
    diffSummary: "Created new file with 1 lines.",
    rollback: {
      type: "restore-file",
      targetPath: "web/sandbox/trace-note.txt",
      previousContent: "before",
      snapshotId: "rollback-123",
      createdAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

test("fresh traces include the full required contract", () => {
  const trace = buildTrace({
    input: makeInput("Player movement breaks after changing the Animator speed sync."),
    result: makeResult({
      what_happened: "The Animator speed sync override is the most likely cause of the symptom.",
      what_to_do_next: [
        "Temporarily disable the Animator speed sync override and compare the behavior before and after.",
      ],
    }),
  });

  assert.deepEqual(listMissingAnalysisTraceFields(trace), []);
  assert.equal(trace.actionType, "inspection");
  assert.match(trace.proposedAction, /disable the Animator speed sync override/i);
  assert.match(trace.expectedOutcome, /source of the issue|target/i);
  assert.equal(trace.executedAction, null);
  assert.equal(trace.actionResult, null);
  assert.equal(trace.sessionId, "test-session");
  assert.equal(trace.stepIndex, 1);
  assert.equal(trace.goal, "Confirm whether the Animator handoff is the leading cause.");
  assert.equal(trace.autonomousSessionId, null);
  assert.equal(trace.autonomousStepIndex, null);
  assert.equal(trace.autonomousStatus, null);
  assert.equal(trace.autonomousCompletedReason, null);
  assert.equal(trace.autonomousGoalStatus, null);
  assert.equal(trace.autonomousCompletionConfidence, null);
  assert.equal(trace.autonomousPauseReason, null);
  assert.equal(trace.autonomousAwaitingApproval, null);
  assert.equal(trace.autonomousPendingActionType, null);
  assert.equal(trace.executionAdapterId, null);
  assert.equal(trace.adapterContextSummary, null);
  assert.equal(trace.executionNodeId, null);
  assert.equal(trace.executionNodeMode, null);
  assert.equal(trace.nodeCapabilitySummary, null);
  assert.equal(trace.taskId, null);
  assert.equal(trace.autonomousPlanningHintSummary, null);
  assert.equal(trace.autonomousRecentActionFamily, null);
  assert.equal(trace.orchestrationId, null);
  assert.equal(trace.multiAgentSessionId, null);
  assert.equal(trace.selfDirectionId, null);
  assert.equal(trace.topLevelGoal, null);
  assert.equal(trace.selfDirectionStatus, null);
  assert.equal(trace.currentSubgoal, null);
  assert.deepEqual(trace.subgoalQueueSnapshot, []);
  assert.equal(trace.subgoalSelectionReason, null);
  assert.equal(trace.subgoalRerouteReason, null);
  assert.equal(trace.selfStopReason, null);
  assert.equal(trace.selfBlockReason, null);
  assert.equal(trace.selfPauseReason, null);
  assert.equal(trace.orchestrationStatus, null);
  assert.equal(trace.verificationState, null);
  assert.equal(trace.validationResult, null);
  assert.equal(trace.plannerDecision, null);
  assert.equal(trace.commitmentValidationState, null);
});

test("orchestrated traces capture orchestration identifiers, handoffs, and planner/executor state", () => {
  const initialOrchestration = createExecutionOrchestrationState({
    goal: "Restore CLI startup and confirm the banner output.",
    currentPhase: "apply-fix",
  });
  const primedOrchestration = {
    ...initialOrchestration,
    selfDirectionState: initializeExecutionSelfDirection({
      state: initialOrchestration.selfDirectionState,
      currentPhase: initialOrchestration.currentPhase,
      diagnosis: "The planner wants the executor to patch the controller startup path and rerun the CLI.",
      proposedAction: "Patch the controller startup path and rerun the CLI.",
      expectedOutcome: "The CLI should print the expected banner output in both modes.",
    }),
  };
  const planned = recordPlannerHandoff({
    state: primedOrchestration,
    stepNumber: 1,
    diagnosis: "The planner wants the executor to patch the controller startup path and rerun the CLI.",
    proposedAction: "Patch the controller startup path and rerun the CLI.",
    expectedOutcome: "The CLI should print the expected banner output in both modes.",
    plannerDecision: "continue",
  });
  const executed = recordExecutorOutcome({
    state: planned.state,
    stepNumber: 1,
    executedAction: "Patch the controller startup path and rerun the CLI.",
    actionResult: "The CLI now starts and prints the expected banner output in both modes.",
    validationResult: "confirmed",
    executionNotes: "The executor confirmed the bounded fix path.",
  });
  const advanced = advanceExecutionOrchestration({
    state: executed.state,
    phase: executed.state.currentPhase,
    proposedAction: "Apply the smallest import compatibility fix.",
    executedAction: "Patch the controller startup path and rerun the CLI.",
    actionResult: "The CLI now starts and prints the expected banner output in both modes.",
    verificationState: "confirmed",
    diagnosis: "The startup validation is complete.",
    loopTerminationStatus: "resolved",
    nextSafeAction: "",
    nextPhase: "complete",
  });
  const completedSelfDirection = advanceExecutionSelfDirection({
    state: advanced.state.selfDirectionState,
    verificationState: "confirmed",
    loopTerminationStatus: "resolved",
    plannerDecision: "complete",
    stopReason: "The executor result satisfied the bounded top-level goal.",
  });
  const orchestration = recordPlannerHandoff({
    state: {
      ...advanced.state,
      selfDirectionState: completedSelfDirection,
    },
    stepNumber: 1,
    diagnosis: "The planner marks the bounded goal as complete after the executor result.",
    proposedAction: "Stop the orchestration.",
    expectedOutcome: "No additional bounded step is required.",
    plannerDecision: "complete",
    handoffTo: null,
  }).state;
  const trace = buildTrace({
    input: makeInput("CLI startup should expose the debug routing state in both normal and --debug modes.", {
      stepIndex: 2,
      actionResult: "The CLI now starts and prints the expected banner output in both modes.",
    }),
    isRefined: true,
    verificationState: "confirmed",
    lastObservation: "The CLI now starts and prints the expected banner output in both modes.",
    executedAction: "Patch the controller startup path and rerun the CLI.",
    orchestrationState: orchestration,
    result: makeResult({
      what_happened: "The CLI startup validation completed successfully.",
      what_to_do_next: ["Treat the bounded orchestration as complete."],
    }),
  });

  assert.equal(trace.orchestrationId, orchestration.orchestrationId);
  assert.equal(trace.multiAgentSessionId, orchestration.multiAgentSessionId);
  assert.equal(trace.selfDirectionId, orchestration.selfDirectionState.selfDirectionId);
  assert.equal(trace.topLevelGoal, orchestration.selfDirectionState.topLevelGoal);
  assert.equal(trace.selfDirectionStatus, "complete");
  assert.equal(trace.currentSubgoal, null);
  assert.deepEqual(trace.subgoalQueueSnapshot, []);
  assert.ok((trace.subgoalSelectionReason ?? "").length > 0);
  assert.match(trace.selfStopReason ?? "", /top-level goal|bounded goal/i);
  assert.equal(trace.orchestrationStepNumber, 1);
  assert.equal(trace.orchestrationStatus, "complete");
  assert.equal(trace.orchestrationPhase, "complete");
  assert.equal(trace.agentId, "planner-agent");
  assert.equal(trace.agentRole, "planner");
  assert.equal(trace.handoffFrom, "planner");
  assert.equal(trace.handoffTo, null);
  assert.match(trace.handoffPayloadSummary ?? "", /bounded goal as complete|no additional bounded step/i);
  assert.equal(trace.executedAction, "Patch the controller startup path and rerun the CLI.");
  assert.equal(trace.executionNotes, "The executor confirmed the bounded fix path.");
  assert.equal(trace.validationResult, "confirmed");
  assert.equal(trace.plannerDecision, "complete");
  assert.deepEqual(listMissingAnalysisTraceFields(trace), []);
});

test("autonomous traces preserve optional autonomous metadata without changing the required contract", () => {
  const trace = buildTrace({
    input: makeInput("Confirm the safe bounded validation output for the autonomous loop.", {
      sessionId: "autonomous-session-input",
      stepIndex: 2,
      actionResult: "Validation now passes and the status banner is healthy.",
    }),
    result: makeResult({
      what_happened: "The autonomous step matched the expected validation output and satisfied the bounded goal.",
      what_to_do_next: ["Treat the bounded autonomous session as complete."],
    }),
    autonomousSessionId: "autonomous-session-123",
    autonomousStepIndex: 2,
    autonomousStatus: "completed",
    autonomousCompletedReason: "The latest bounded validation satisfied the autonomous goal.",
    autonomousGoalStatus: "complete",
    autonomousCompletionConfidence: "high",
    executionAdapterId: "web-sandbox",
    adapterContextSummary: "adapter=web-sandbox | mode=web",
    executionNodeId: "aie-node-web-web",
    executionNodeMode: "web",
    nodeCapabilitySummary: "inspection, validation-check, file-write, test-run, repo-scan",
    taskId: "task-autonomous-123",
    autonomousPlanningHintSummary: "Recent lane summary: validate:healthy result. Preferred next lane: validate.",
    autonomousRecentActionFamily: "validate",
  });

  assert.equal(trace.autonomousSessionId, "autonomous-session-123");
  assert.equal(trace.autonomousStepIndex, 2);
  assert.equal(trace.autonomousStatus, "completed");
  assert.match(trace.autonomousCompletedReason ?? "", /satisfied the autonomous goal/i);
  assert.equal(trace.autonomousGoalStatus, "complete");
  assert.equal(trace.autonomousCompletionConfidence, "high");
  assert.equal(trace.executionAdapterId, "web-sandbox");
  assert.match(trace.adapterContextSummary ?? "", /adapter=web-sandbox/i);
  assert.equal(trace.executionNodeId, "aie-node-web-web");
  assert.equal(trace.executionNodeMode, "web");
  assert.match(trace.nodeCapabilitySummary ?? "", /validation-check/i);
  assert.equal(trace.taskId, "task-autonomous-123");
  assert.match(trace.autonomousPlanningHintSummary ?? "", /Preferred next lane/i);
  assert.equal(trace.autonomousRecentActionFamily, "validate");
  assert.deepEqual(listMissingAnalysisTraceFields(trace), []);
});

test("autonomous traces preserve pause and pending-approval metadata additively", () => {
  const trace = buildTrace({
    input: makeInput("Pause the bounded autonomous session until approval is granted."),
    result: makeResult({
      what_happened: "The autonomous session paused awaiting approval for the pending caution write.",
    }),
    autonomousSessionId: "autonomous-session-awaiting-approval",
    autonomousStepIndex: 1,
    autonomousStatus: "awaiting-approval",
    autonomousPauseReason: "Explicit approval is required for the pending caution write.",
    autonomousAwaitingApproval: true,
    autonomousPendingActionType: "file-write",
    autonomousGoalStatus: "blocked",
    autonomousCompletionConfidence: "low",
  });

  assert.equal(trace.autonomousStatus, "awaiting-approval");
  assert.equal(trace.autonomousPauseReason, "Explicit approval is required for the pending caution write.");
  assert.equal(trace.autonomousAwaitingApproval, true);
  assert.equal(trace.autonomousPendingActionType, "file-write");
  assert.equal(trace.autonomousGoalStatus, "blocked");
});

test("trace records preserve bounded execution result metadata additively", () => {
  const trace = buildTrace({
    input: makeInput("Confirm the sandbox write metadata reaches the trace.", {
      actionResult: "Sandbox file write completed.",
    }),
    result: makeResult({
      what_happened: "The sandbox write completed successfully.",
      what_to_do_next: ["Run the bounded trace validation next."],
    }),
    executionResult: makeExecutionResult(),
    failureClassification: {
      kind: "logic",
      retryable: false,
      severity: "medium",
      reason: "The bounded validation still failed.",
    },
    recoveryStrategy: "reroute-analysis",
    retryCount: 1,
    repeatedAction: false,
    repeatedOutput: true,
    autonomousStopReason: "The loop repeated the same output and stopped.",
  });

  assert.deepEqual(trace.executionResult?.changedPaths, ["web/sandbox/trace-note.txt"]);
  assert.match(trace.executionResult?.diffSummary ?? "", /Created new file/i);
  assert.equal(trace.executionResult?.rollback?.snapshotId, "rollback-123");
  assert.equal(trace.failureClass, "logic");
  assert.equal(trace.recoveryStrategy, "reroute-analysis");
  assert.equal(trace.retryCount, 1);
  assert.equal(trace.repeatedOutput, true);
  assert.match(trace.autonomousStopReason ?? "", /same output/i);
});

test("pending commitment traces expose a pending validation state", () => {
  const trace = buildTrace({
    input: makeInput(
      "Player movement breaks after changing the Animator speed sync. The bad transition happens right when the Animator resume handoff runs, and the symptom seems tied to that handoff rather than the rest of movement.",
      { stepIndex: 2 },
    ),
    isRefined: true,
    verificationState: "inconclusive",
    lastObservation:
      "Disabling the Animator speed sync now cleanly tracks the symptom to the same handoff, and restoring it brings the bad transition back.",
    result: makeResult({
      what_happened: "The Animator speed sync override is now the clearly leading cause of the symptom.",
      what_to_do_next: [
        "Temporarily isolate only the Animator resume handoff and one related variable, then compare whether the symptom changes immediately.",
      ],
    }),
    previousActionChainState: {
      currentStepIndex: 1,
      totalSteps: 3,
      lastStepIntent: "isolation",
      lastStepVerification: "inconclusive",
      lastStepWatchFor:
        "Watch for whether changing animator resume handoff shifts the symptom immediately instead of only producing later side effects.",
      previousConfidenceLevel: "medium",
      confidenceHistory: ["low", "medium"],
    },
  });

  assert.equal(trace.decisionCommitment, "pending");
  assert.equal(trace.commitmentValidationState, "pending");
  assert.match(trace.actionResult ?? "", /cleanly tracks the symptom/i);
});

test("committed traces expose a validated commitment state", () => {
  const trace = buildTrace({
    input: makeInput("Player movement breaks after changing the Animator speed sync.", { stepIndex: 3 }),
    isRefined: true,
    verificationState: "inconclusive",
    lastObservation:
      "The same Animator handoff still cleanly drives the symptom, and the confirm check keeps matching the expected path.",
    result: makeResult({
      what_happened: "The Animator speed sync override remains the clearly leading cause of the symptom.",
      what_to_do_next: [
        "Temporarily isolate only the Animator resume handoff and one related variable, then compare whether the symptom changes immediately.",
      ],
    }),
    previousActionChainState: {
      currentStepIndex: 0,
      totalSteps: 2,
      lastStepIntent: "confirmation",
      isCommitted: false,
      alignedSignalCount: 1,
      lastStepVerification: "inconclusive",
      lastStepWatchFor:
        "Watch for a clean confirm-or-contradict result around animator speed sync: the symptom should track this subsystem directly, not stay unchanged or move to a different cause.",
      previousConfidenceLevel: "high",
      confidenceHistory: ["medium", "high"],
    },
  });

  assert.equal(trace.decisionCommitment, "committed");
  assert.equal(trace.commitmentValidationState, "validated");
  assert.deepEqual(listMissingAnalysisTraceFields(trace), []);
  assert.match(trace.expectedOutcome, /confirm whether|source of the issue|target/i);
  assert.match(trace.actionResult ?? "", /same Animator handoff/i);
});

test("follow-up traces preserve action results for falsified, confirmed, and partial updates", () => {
  const falsified = buildTrace({
    input: makeInput("Sprint speed flickers after I added a stamina limiter.", {
      actionResult: "Disabling the stamina limiter changed nothing, but disabling the second zoom script removed jitter completely.",
      stepIndex: 2,
    }),
    isRefined: true,
    verificationState: "falsified",
    lastObservation:
      "Disabling the stamina limiter changed nothing, but disabling the second zoom script removed jitter completely.",
    result: makeResult({
      what_happened: "The second zoom script is the more likely cause of the jitter.",
    }),
  });
  const confirmed = buildTrace({
    input: makeInput("Player movement breaks after changing the Animator speed sync.", {
      actionResult:
        "Disabling the Animator speed sync now cleanly tracks the symptom to the same handoff, and restoring it brings the bad transition back.",
      stepIndex: 2,
    }),
    isRefined: true,
    verificationState: "confirmed",
    lastObservation:
      "Disabling the Animator speed sync now cleanly tracks the symptom to the same handoff, and restoring it brings the bad transition back.",
    result: makeResult(),
  });
  const partial = buildTrace({
    input: makeInput("Player movement breaks after changing the Animator speed sync.", {
      actionResult:
        "Disabling the Animator speed sync reduced the jitter, but the symptom still appears during the handoff.",
      stepIndex: 3,
    }),
    isRefined: true,
    verificationState: "inconclusive",
    lastObservation:
      "Disabling the Animator speed sync reduced the jitter, but the symptom still appears during the handoff.",
    result: makeResult(),
  });

  assert.equal(falsified.verificationState, "falsified");
  assert.equal(confirmed.verificationState, "confirmed");
  assert.equal(partial.verificationState, "inconclusive");
  assert.match(falsified.actionResult ?? "", /changed nothing/i);
  assert.match(confirmed.actionResult ?? "", /cleanly tracks the symptom/i);
  assert.match(partial.actionResult ?? "", /reduced the jitter/i);
  assert.ok(["high", "medium", "low"].includes(falsified.confidenceLevel));
  assert.ok(["high", "medium", "low"].includes(confirmed.confidenceLevel));
  assert.ok(["high", "medium", "low"].includes(partial.confidenceLevel));
});

test("traces retain optional execution results without changing the required contract", () => {
  const trace = buildTrace({
    input: makeInput("Validate whether the previewed safe inspection can populate the next follow-up loop.", {
      actionResult: "Inspection completed in read-only mode. Filesystem findings: web/components/AnalysisResult.tsx (file)",
      stepIndex: 2,
    }),
    isRefined: true,
    verificationState: "confirmed",
    lastObservation: "Inspection completed in read-only mode. Filesystem findings: web/components/AnalysisResult.tsx (file)",
    executionResult: {
      status: "success",
      output: "Inspection completed in read-only mode. Filesystem findings: web/components/AnalysisResult.tsx (file)",
    },
    result: makeResult({
      what_happened: "The bounded inspection found the target file and returned a safe execution result.",
    }),
  });

  assert.deepEqual(listMissingAnalysisTraceFields(trace), []);
  assert.equal(trace.executionResult?.status, "success");
  assert.match(trace.executionResult?.output ?? "", /AnalysisResult\.tsx/i);
});