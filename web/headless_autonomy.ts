import { loadAutonomousSession } from "./lib/aie/autonomousSessionStore";
import { runSingleQueuedTask, type QueueExecutionSummary } from "./lib/aie/queueOrchestrator";
import { createRuntimeExecutionNodeDescriptor } from "./lib/aie/executionNode";
import {
  getExecutionNodeEligibility,
  listExecutionNodes,
  registerExecutionNode,
} from "./lib/aie/executionNodeRegistry";
import { resolveRepoRoot } from "./lib/aie/repoContext";
import { runAutonomousSession } from "./lib/aie/runAutonomousSession";
import type { AutonomousOperatorSteeringAction, AutonomousSession } from "./lib/aie/autonomousSession";
import {
  deriveTaskContinuationChainState,
  deriveTaskDispatchHardeningState,
  deriveTaskRecoveryPlanningState,
  type TaskEnvelope,
} from "./lib/aie/taskEnvelope";
import { getTask, listTasks } from "./lib/aie/taskQueueStore";
import type { runAnalysis } from "./lib/aie/run-analysis";
import type { saveAutonomousSession } from "./lib/aie/autonomousSessionStore";
import type { executeAction } from "./lib/aie/executionRuntime";

type HeadlessAutonomyOptions = {
  goal: string;
  maxSteps?: number;
  sessionId?: string;
  approved?: boolean;
  steeringAction?: AutonomousOperatorSteeringAction;
  operatorNote?: string;
  overrideReason?: string;
  stopReason?: string;
  restartReason?: string;
  clearSteering?: boolean;
  allowedRoots?: string[];
  cwd?: string;
  verbose?: boolean;
  json?: boolean;
  listTasks?: boolean;
  listNodes?: boolean;
  runNextTask?: boolean;
  runTask?: boolean;
  taskId?: string;
};

type HeadlessAutonomyDependencies = {
  runAnalysis: typeof runAnalysis;
  executeAction: typeof executeAction;
  saveAutonomousSession: typeof saveAutonomousSession;
  runSingleQueuedTask: typeof runSingleQueuedTask;
};

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampMaxSteps(value: unknown): number | undefined {
  const normalized = normalizeText(value);
  if (!normalized) {
    return undefined;
  }

  const numericValue = Number(normalized);
  if (!Number.isFinite(numericValue)) {
    return undefined;
  }

  return Math.max(1, Math.min(5, Math.floor(numericValue)));
}

export function parseArgs(argv: string[]): HeadlessAutonomyOptions {
  const options: HeadlessAutonomyOptions = {
    goal: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    switch (current) {
      case "--goal":
        options.goal = normalizeText(next);
        index += 1;
        break;
      case "--maxSteps":
        options.maxSteps = clampMaxSteps(next);
        index += 1;
        break;
      case "--sessionId":
        options.sessionId = normalizeText(next) || undefined;
        index += 1;
        break;
      case "--approved":
        options.approved = true;
        break;
      case "--steering":
        options.steeringAction = normalizeText(next) as AutonomousOperatorSteeringAction;
        index += 1;
        break;
      case "--operatorNote":
        options.operatorNote = normalizeText(next) || undefined;
        index += 1;
        break;
      case "--overrideReason":
        options.overrideReason = normalizeText(next) || undefined;
        index += 1;
        break;
      case "--stopReason":
        options.stopReason = normalizeText(next) || undefined;
        index += 1;
        break;
      case "--restartReason":
        options.restartReason = normalizeText(next) || undefined;
        index += 1;
        break;
      case "--clearSteering":
        options.clearSteering = true;
        break;
      case "--allowedRoot":
        options.allowedRoots = [...(options.allowedRoots ?? []), normalizeText(next)].filter(Boolean);
        index += 1;
        break;
      case "--cwd":
        options.cwd = normalizeText(next) || undefined;
        index += 1;
        break;
      case "--verbose":
        options.verbose = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--listTasks":
        options.listTasks = true;
        break;
      case "--listNodes":
        options.listNodes = true;
        break;
      case "--runNextTask":
        options.runNextTask = true;
        break;
      case "--runTask":
        options.runTask = true;
        break;
      case "--taskId":
        options.taskId = normalizeText(next) || undefined;
        index += 1;
        break;
      default:
        break;
    }
  }

  return options;
}

export function formatHeadlessSessionSummary(session: AutonomousSession): string {
  const lastStep = session.steps.at(-1);

  return JSON.stringify(
    {
      ok: session.status !== "failed" && session.status !== "blocked",
      sessionId: session.sessionId,
      status: session.status,
      steps: session.steps.length,
      adapter: session.executionAdapterId ?? null,
      adapterContextSummary: session.adapterContextSummary ?? null,
      executionNodeId: session.executionNodeId ?? null,
      executionNodeMode: session.executionNodeMode ?? null,
      nodeCapabilitySummary: session.nodeCapabilitySummary ?? null,
      selectedNodeId: session.selectedNodeId ?? null,
      selectedNodeReason: session.selectedNodeReason ?? null,
      taskId: session.taskId ?? null,
      taskStatus: session.taskStatus ?? null,
      assignedNodeId: session.assignedNodeId ?? null,
      queueStateSummary: session.queueStateSummary ?? null,
      dispatchMessageId: session.dispatchMessageId ?? null,
      dispatchAckMessageId: session.dispatchAckMessageId ?? null,
      dispatchResultMessageId: session.dispatchResultMessageId ?? null,
      dispatchTargetNodeId: session.dispatchTargetNodeId ?? null,
      dispatchProtocolVersion: session.dispatchProtocolVersion ?? null,
      dispatchStatusSummary: session.dispatchStatusSummary ?? null,
      dispatchAuthSummary: session.dispatchAuthSummary ?? null,
      dispatchTransportStatus: session.dispatchTransportStatus ?? null,
      remoteDispatchPlanned: session.remoteDispatchPlanned ?? null,
      planningHintSummary: session.planningHintSummary ?? null,
      failureReason: session.failureReason ?? null,
      retryCount: session.latestRecoveryState?.retryCount ?? null,
      lastActionFamily: lastStep?.actionFamily ?? null,
      completionStatus: session.latestCompletion?.status ?? null,
      completedReason: session.completedReason ?? session.stateReason ?? null,
      pendingAction: session.pendingAction?.description ?? null,
      workflowContinuity: session.workflowContinuity,
    },
    null,
    2,
  );
}

export function formatHeadlessStepSummaries(session: AutonomousSession): string {
  if (!session.steps.length) {
    return "No autonomous steps were recorded.";
  }

  return session.steps.map((step) => {
    const summaryParts = [
      `Step ${step.index}`,
      `lane=${step.actionFamily ?? "unknown"}`,
      `adapter=${step.executionAdapterId ?? "unknown"}`,
      `node=${step.executionNodeId ?? "unknown"}`,
      `selectedNode=${step.selectedNodeId ?? step.assignedNodeId ?? "unknown"}`,
      `task=${step.taskId ?? "unknown"}`,
      `taskStatus=${step.taskStatus ?? "unknown"}`,
      `goal=${step.goalStatus ?? "unknown"}`,
      `decision=${step.nextDecision ?? "unknown"}`,
      `runtime=${step.executionResult?.status ?? "unknown"}`,
    ];
    const detailParts = [
      step.proposedAction ? `action=${step.proposedAction}` : "",
      step.adapterContextSummary ? `adapterContext=${step.adapterContextSummary}` : "",
      step.nodeCapabilitySummary ? `nodeCaps=${step.nodeCapabilitySummary}` : "",
      step.selectedNodeReason ? `selection=${step.selectedNodeReason}` : "",
      step.assignedNodeId ? `assignedNode=${step.assignedNodeId}` : "",
      step.queueStateSummary ? `queue=${step.queueStateSummary}` : "",
      step.dispatchStatusSummary ? `dispatch=${step.dispatchStatusSummary}` : "",
      step.dispatchTransportStatus ? `dispatchTransport=${step.dispatchTransportStatus}` : "",
      step.dispatchAuthSummary ? `dispatchAuth=${step.dispatchAuthSummary}` : "",
      typeof step.retryCount === "number" ? `retryCount=${step.retryCount}` : "",
      step.failureReason ? `failure=${step.failureReason}` : "",
      step.planningHintSummary ? `planning=${step.planningHintSummary}` : "",
      step.diagnosis ? `diagnosis=${step.diagnosis}` : "",
    ].filter(Boolean);
    return [summaryParts.join(" | "), detailParts.join(" | ")].filter(Boolean).join("\n");
  }).join("\n\n");
}

export function formatHeadlessSessionReport(session: AutonomousSession, options?: { json?: boolean; verbose?: boolean }): string {
  if (options?.json) {
    return JSON.stringify(
      {
        sessionId: session.sessionId,
        status: session.status,
        goal: session.goal,
        adapter: session.executionAdapterId ?? null,
        adapterContextSummary: session.adapterContextSummary ?? null,
        executionNodeId: session.executionNodeId ?? null,
        executionNodeMode: session.executionNodeMode ?? null,
        nodeCapabilitySummary: session.nodeCapabilitySummary ?? null,
        selectedNodeId: session.selectedNodeId ?? null,
        selectedNodeReason: session.selectedNodeReason ?? null,
        taskId: session.taskId ?? null,
        taskStatus: session.taskStatus ?? null,
        assignedNodeId: session.assignedNodeId ?? null,
        queueStateSummary: session.queueStateSummary ?? null,
        dispatchMessageId: session.dispatchMessageId ?? null,
        dispatchAckMessageId: session.dispatchAckMessageId ?? null,
        dispatchResultMessageId: session.dispatchResultMessageId ?? null,
        dispatchTargetNodeId: session.dispatchTargetNodeId ?? null,
        dispatchProtocolVersion: session.dispatchProtocolVersion ?? null,
        dispatchStatusSummary: session.dispatchStatusSummary ?? null,
        dispatchAuthSummary: session.dispatchAuthSummary ?? null,
        dispatchTransportStatus: session.dispatchTransportStatus ?? null,
        remoteDispatchPlanned: session.remoteDispatchPlanned ?? null,
        planningHintSummary: session.planningHintSummary ?? null,
        workflowContinuity: session.workflowContinuity,
        failureReason: session.failureReason ?? null,
        retryCount: session.latestRecoveryState?.retryCount ?? null,
        completion: session.latestCompletion ?? null,
        completedReason: session.completedReason ?? session.stateReason ?? null,
        steps: options.verbose ? session.steps : session.steps.map((step) => ({
          index: step.index,
          actionFamily: step.actionFamily ?? null,
          executionAdapterId: step.executionAdapterId ?? null,
          executionNodeId: step.executionNodeId ?? null,
          executionNodeMode: step.executionNodeMode ?? null,
          nodeCapabilitySummary: step.nodeCapabilitySummary ?? null,
          selectedNodeId: step.selectedNodeId ?? null,
          selectedNodeReason: step.selectedNodeReason ?? null,
          taskId: step.taskId ?? null,
          taskStatus: step.taskStatus ?? null,
          assignedNodeId: step.assignedNodeId ?? null,
          queueStateSummary: step.queueStateSummary ?? null,
          dispatchMessageId: step.dispatchMessageId ?? null,
          dispatchAckMessageId: step.dispatchAckMessageId ?? null,
          dispatchResultMessageId: step.dispatchResultMessageId ?? null,
          dispatchTargetNodeId: step.dispatchTargetNodeId ?? null,
          dispatchProtocolVersion: step.dispatchProtocolVersion ?? null,
          dispatchStatusSummary: step.dispatchStatusSummary ?? null,
          dispatchAuthSummary: step.dispatchAuthSummary ?? null,
          dispatchTransportStatus: step.dispatchTransportStatus ?? null,
          remoteDispatchPlanned: step.remoteDispatchPlanned ?? null,
          failureReason: step.failureReason ?? null,
          retryCount: step.retryCount ?? null,
          goalStatus: step.goalStatus ?? null,
          nextDecision: step.nextDecision ?? null,
          runtimeStatus: step.executionResult?.status ?? null,
        })),
      },
      null,
      2,
    );
  }

  const lines = [
    `Session ID: ${session.sessionId}`,
    `Status: ${session.status}`,
    `Goal: ${session.goal}`,
    `Latest adapter: ${session.executionAdapterId ?? "unknown"}`,
    `Execution node: ${session.executionNodeId ?? "unknown"} (${session.executionNodeMode ?? "unknown"})`,
    `Node capabilities: ${session.nodeCapabilitySummary ?? "No node capabilities recorded."}`,
    `Selected node: ${session.selectedNodeId ?? session.assignedNodeId ?? "No node selection recorded."}`,
    `Selection reason: ${session.selectedNodeReason ?? "No node selection reason recorded."}`,
    `Latest task: ${session.taskId ?? "No task recorded."}`,
    `Task status: ${session.taskStatus ?? "No task status recorded."}`,
    `Assigned node: ${session.assignedNodeId ?? "No node assignment recorded."}`,
    `Queue summary: ${session.queueStateSummary ?? "No queue summary recorded."}`,
    `Dispatch summary: ${session.dispatchStatusSummary ?? "No dispatch summary recorded."}`,
    `Dispatch transport: ${session.dispatchTransportStatus ?? "No dispatch transport status recorded."}`,
    `Dispatch auth: ${session.dispatchAuthSummary ?? "No dispatch auth summary recorded."}`,
    `Retry count: ${typeof session.latestRecoveryState?.retryCount === "number" ? session.latestRecoveryState.retryCount : "No retry count recorded."}`,
    `Failure reason: ${session.failureReason ?? "No failure reason recorded."}`,
    `Adapter context: ${session.adapterContextSummary ?? "No adapter context recorded."}`,
    `Planning hints: ${session.planningHintSummary ?? "No planning hints recorded."}`,
    `Production-loop phase: ${session.workflowContinuity.progress.chainPhase}`,
    `Current chain step: ${session.workflowContinuity.progress.currentChainStep}`,
    `Total known steps: ${session.workflowContinuity.progress.totalKnownSteps}`,
    `Last safe step: ${typeof session.workflowContinuity.progress.lastCompletedSafeStep === "number" ? session.workflowContinuity.progress.lastCompletedSafeStep : "No safe step recorded."}`,
    `Recovery target: ${session.workflowContinuity.progress.currentRecoveryTarget ?? "No recovery target recorded."}`,
    `Next intended step: ${session.workflowContinuity.progress.nextIntendedStep ?? "No next step recorded."}`,
    `Chain summary: ${session.workflowContinuity.memory.chainSummary ?? "No chain summary recorded."}`,
    `Current objective: ${session.workflowContinuity.memory.currentObjectiveSummary ?? "No current objective summary recorded."}`,
    `Last validation outcome: ${session.workflowContinuity.memory.lastValidationOutcome ?? "No validation outcome recorded."}`,
    `Last failure summary: ${session.workflowContinuity.memory.lastFailureSummary ?? "No failure summary recorded."}`,
    `Last fix attempt: ${session.workflowContinuity.memory.lastFixAttemptSummary ?? "No fix attempt recorded."}`,
    `Pending next action: ${session.workflowContinuity.memory.pendingNextActionSummary ?? "No pending next action recorded."}`,
    `Operator blockers: ${session.workflowContinuity.memory.operatorBlockers ?? "No operator blockers recorded."}`,
    `Current phase repeat count: ${session.workflowContinuity.loopHealth.currentPhaseRepeatCount}`,
    `Stalled loop: ${String(session.workflowContinuity.loopHealth.stalledLoop)}`,
    `Operator intervention preferred: ${String(session.workflowContinuity.loopHealth.operatorInterventionPreferred)}`,
    `Recommendation confidence: ${session.workflowContinuity.loopHealth.recommendationConfidence}`,
    `Likely needs operator input: ${String(session.workflowContinuity.loopHealth.likelyNeedsOperatorInput)}`,
    `Operator override status: ${session.workflowContinuity.steering.status}`,
    `Operator override request: ${session.workflowContinuity.steering.requestedAction ?? "none"}`,
    `Operator override reason: ${session.workflowContinuity.steering.overrideReason ?? "No override reason recorded."}`,
    `Operator override blocked reason: ${session.workflowContinuity.steering.blockedReason ?? "No override block recorded."}`,
    `Operator note: ${session.workflowContinuity.steering.operatorNote ?? "No operator note recorded."}`,
    `Recommendation review summary: ${session.workflowContinuity.review.reviewSummary ?? "No recommendation review recorded."}`,
    `Last reviewed recommendation: ${session.workflowContinuity.review.lastReviewedRecommendation ?? "No reviewed recommendation recorded."}`,
    `Last operator review response: ${session.workflowContinuity.review.lastOperatorResponse ?? "No operator review response recorded."}`,
    `Last recommendation review outcome: ${session.workflowContinuity.review.lastRecommendationOutcome ?? "No recommendation review outcome recorded."}`,
    `Last recommendation follow-through status: ${session.workflowContinuity.review.lastFollowThroughStatus ?? "No follow-through status recorded."}`,
    `Last recommendation follow-through summary: ${session.workflowContinuity.review.lastFollowThroughSummary ?? "No follow-through summary recorded."}`,
    `Last accepted recommendation outcome: ${session.workflowContinuity.review.lastAcceptedRecommendationOutcome ?? "No accepted recommendation outcome recorded."}`,
    `Last redirected recommendation outcome: ${session.workflowContinuity.review.lastRedirectedRecommendationOutcome ?? "No redirected recommendation outcome recorded."}`,
    `Last review improved progress: ${String(session.workflowContinuity.review.lastReviewImprovedProgress)}`,
    `Last review needed correction: ${String(session.workflowContinuity.review.lastRecommendationNeededCorrection)}`,
    `Follow-through helped: ${String(session.workflowContinuity.review.followThroughLedUsefulProgress)}`,
    `Follow-through required correction: ${String(session.workflowContinuity.review.followThroughRequiredCorrection)}`,
    `Returned to same recommendation again: ${String(session.workflowContinuity.review.returnedToSameRecommendationAgain)}`,
    `Repeated review without progress: ${String(session.workflowContinuity.review.repeatedReviewWithoutProgress)}`,
    `Recommendation frequently overridden: ${String(session.workflowContinuity.review.frequentlyOverridden)}`,
    `Recommendation escalation status: ${session.workflowContinuity.escalation.escalationStatus}`,
    `Recommendation recovery guidance: ${session.workflowContinuity.escalation.recoveryRecommendation}`,
    `Likely needs operator intervention now: ${String(session.workflowContinuity.escalation.likelyNeedsOperatorInterventionNow)}`,
    `Repeated ineffective review cycles: ${String(session.workflowContinuity.escalation.repeatedIneffectiveReviewCycles)}`,
    `Accepted recommendations repeatedly requiring correction: ${String(session.workflowContinuity.escalation.acceptedRecommendationsRepeatedlyRequiringCorrection)}`,
    `Redirected recommendations outperforming system: ${String(session.workflowContinuity.escalation.redirectedRecommendationsOutperformSystem)}`,
    `Returned to same ineffective recommendation state: ${String(session.workflowContinuity.escalation.returnedToSameIneffectiveState)}`,
    `Recommendation escalation summary: ${session.workflowContinuity.escalation.escalationSummary ?? "No escalation summary recorded."}`,
    `Recommendation recovery summary: ${session.workflowContinuity.escalation.recoverySummary ?? "No recovery summary recorded."}`,
    `Recommendation handoff status: ${session.workflowContinuity.handoff.handoffStatus}`,
    `Waiting on operator recovery decision: ${String(session.workflowContinuity.handoff.waitingOnOperatorDecision)}`,
    `Recovery execution in progress: ${String(session.workflowContinuity.handoff.recoveryExecutionInProgress)}`,
    `Recovery execution completed: ${String(session.workflowContinuity.handoff.recoveryExecutionCompleted)}`,
    `Recovery improved progress: ${String(session.workflowContinuity.handoff.recoveryImprovedProgress)}`,
    `Second escalation needed: ${String(session.workflowContinuity.handoff.secondEscalationNeeded)}`,
    `Selected recovery action: ${session.workflowContinuity.handoff.selectedRecoveryAction ?? "No recovery action selected."}`,
    `Selected recovery mode: ${session.workflowContinuity.handoff.selectedRecoveryMode ?? "No recovery mode selected."}`,
    `Selected recovery reason: ${session.workflowContinuity.handoff.selectedRecoveryReason ?? "No recovery reason recorded."}`,
    `Recommendation handoff summary: ${session.workflowContinuity.handoff.handoffSummary ?? "No handoff summary recorded."}`,
    `Recovery execution summary: ${session.workflowContinuity.handoff.recoveryExecutionSummary ?? "No recovery execution summary recorded."}`,
    `Last operator refinement note: ${session.workflowContinuity.refinement.lastOperatorRefinementNote ?? "No refinement note recorded."}`,
    `Last override reason: ${session.workflowContinuity.refinement.lastOverrideReason ?? "No override reason recorded."}`,
    `Recent overrides improved progress: ${String(session.workflowContinuity.refinement.recentOverridesImprovedProgress)}`,
    `Similar future preference: ${session.workflowContinuity.refinement.similarFuturePreference ?? "No preference recorded."}`,
    `Recommendation influenced by recent guidance: ${String(session.workflowContinuity.refinement.recommendationInfluencedByRecentGuidance)}`,
    `Refinement influence reason: ${session.workflowContinuity.refinement.influenceReason ?? "No refinement influence reason recorded."}`,
    `Refinement summary: ${session.workflowContinuity.refinement.refinementSummary ?? "No refinement summary recorded."}`,
    `System recommended next phase: ${session.workflowContinuity.loopHealth.systemRecommendedNextPhase ?? "No system recommendation recorded."}`,
    `Recommended next phase: ${session.workflowContinuity.loopHealth.recommendedNextPhase}`,
    `Recommendation rationale: ${session.workflowContinuity.loopHealth.recommendationRationaleSummary ?? "No recommendation rationale recorded."}`,
    `Top recommendation signals: ${session.workflowContinuity.loopHealth.topContributingSignals.join(" | ") || "No recommendation signals recorded."}`,
    `Recommended next action: ${session.workflowContinuity.loopHealth.recommendedNextActionSummary ?? "No recommended next action recorded."}`,
    `Loop health reason: ${session.workflowContinuity.loopHealth.loopHealthReason ?? "No loop health reason recorded."}`,
    `System loop health reason: ${session.workflowContinuity.loopHealth.systemLoopHealthReason ?? "No system loop health reason recorded."}`,
    `Recent phase outcomes: ${session.workflowContinuity.loopHealth.recentPhaseOutcomes.join(" | ") || "No recent phase outcomes recorded."}`,
    `Pending context: ${session.workflowContinuity.memory.pendingOperatorContext ?? "No pending operator context recorded."}`,
    `Recent decisions: ${session.workflowContinuity.memory.recentDecisions.join(" | ") || "No recent decisions recorded."}`,
    `Recovery outcomes: ${session.workflowContinuity.memory.priorRecoveryOutcomes.join(" | ") || "No recovery outcomes recorded."}`,
    `Completion: ${session.latestCompletion ? `${session.latestCompletion.status} (${session.latestCompletion.confidence})` : "No completion state recorded."}`,
    `Reason: ${session.completedReason ?? session.stateReason ?? "No stop reason recorded."}`,
  ];

  if (options?.verbose) {
    lines.push("", "Step summary:", formatHeadlessStepSummaries(session));
  }

  return lines.join("\n");
}

export function formatHeadlessTaskReport(task: TaskEnvelope, options?: { json?: boolean }): string {
  if (options?.json) {
    return JSON.stringify(task, null, 2);
  }

  const hardening = deriveTaskDispatchHardeningState(task);
  const recovery = deriveTaskRecoveryPlanningState(task);
  const chain = deriveTaskContinuationChainState(task);

  return [
    `Task ID: ${task.taskId}`,
    `Session ID: ${task.sessionId}`,
    `Step: ${task.stepIndex}`,
    `Status: ${task.status}`,
    `Selected node: ${task.selectedNodeId ?? task.assignedNodeId ?? "unassigned"}`,
    `Selection reason: ${task.selectedNodeReason ?? "none"}`,
    `Assigned node: ${task.assignedNodeId ?? "unassigned"}`,
    `Resumability: ${task.resumability}`,
    `Continuation mode: ${task.continuationGeneration > 0 ? "resumed" : "fresh"}`,
    `Continuation generation: ${task.continuationGeneration}`,
    `Continuation source: ${task.continuationSourceNodeId ?? "none"}`,
    `Continuation target: ${task.continuationTargetNodeId ?? "none"}`,
    `Continuation reason: ${task.continuationReason ?? "none"}`,
    `Prior lease: ${task.priorLeaseId ?? "none"}`,
    `Resume attempts: ${task.resumeAttemptCount}`,
    `Recovery pending: ${String(task.recoveryPending)}`,
    `Recovery plan: ${recovery.strategy}`,
    `Recovery reason: ${recovery.reasonCategory}`,
    `Safe-stop point: ${recovery.safeStopPoint ?? "none"}`,
    `Chain state: ${chain.state}`,
    `Chain depth: ${chain.depth}`,
    `Lease: ${task.lease?.leaseId ?? "none"}`,
    `Lease owner: ${task.lease?.ownerNodeId ?? "none"}`,
    `Lease epoch: ${typeof task.lease?.epoch === "number" ? task.lease.epoch : "none"}`,
    `Lease status: ${task.lease?.status ?? "none"}`,
    `Lease last progress: ${task.lease?.lastProgressAt ?? "none"}`,
    `Progress marker: ${task.lastProgressMarker ?? "none"}`,
    `Resumed checkpoint: ${task.resumedFromCheckpointReference ?? "none"}`,
    `Resumed token: ${task.resumedFromContinuationToken ? "present" : "none"}`,
    `Continuation token: ${task.continuationToken ? "present" : "none"}`,
    `Checkpoint reference: ${task.checkpointReference ?? "none"}`,
    `Runner mode: ${task.runnerMode ?? "unknown"}`,
    `Claim token: ${task.claimToken ?? "none"}`,
    `Dispatch message: ${task.dispatchMessageId ?? "none"}`,
    `Dispatch ack: ${task.dispatchAckMessageId ?? "none"}`,
    `Dispatch result: ${task.dispatchResultMessageId ?? "none"}`,
    `Dispatch target: ${task.dispatchTargetNodeId ?? "none"}`,
    `Dispatch protocol: ${task.dispatchProtocolVersion ?? "none"}`,
    `Dispatch transport: ${task.dispatchTransportStatus ?? "none"}`,
    `Dispatch retry count: ${typeof task.dispatchRetryCount === "number" ? task.dispatchRetryCount : "none"}`,
    `Dispatch last attempt: ${task.dispatchLastAttemptAt ?? "none"}`,
    `Dispatch timeout: ${typeof task.dispatchTimeoutMs === "number" ? task.dispatchTimeoutMs : "none"}`,
    `Dispatch hardening: ${hardening.state}/${hardening.category}`,
    `Dispatch hardening reason: ${hardening.reason ?? "none"}`,
    `Dispatch auth: ${task.dispatchAuthSummary ?? "none"}`,
    `Dispatch summary: ${task.dispatchStatusSummary ?? "No dispatch summary recorded."}`,
    `Capabilities: ${task.requestedCapabilities.join(",") || "none"}`,
    `Reason: ${task.statusReason ?? "No status reason recorded."}`,
    `Failure reason: ${task.failureReason ?? "No failure reason recorded."}`,
    `Claimed: ${task.claimedAt ?? "not claimed"}`,
    `Dispatch received: ${task.dispatchReceivedAt ?? "not received"}`,
    `Dispatch completed: ${task.dispatchCompletedAt ?? "not completed"}`,
    `Started: ${task.startedAt ?? "not started"}`,
    `Completed: ${task.completedAt ?? "not completed"}`,
    `Failed: ${task.failedAt ?? "not failed"}`,
    `Blocked: ${task.blockedAt ?? "not blocked"}`,
  ].join("\n");
}

export function formatHeadlessQueueRunReport(summary: QueueExecutionSummary, options?: { json?: boolean }): string {
  if (options?.json) {
    return JSON.stringify(summary, null, 2);
  }

  if (summary.status === "no-runnable-task") {
    return "No runnable safe queued task was available for controlled execution.";
  }

  const recovery = summary.task ? deriveTaskRecoveryPlanningState(summary.task) : null;
  const chain = summary.task ? deriveTaskContinuationChainState(summary.task) : null;

  return [
    `Queue run: ${summary.status}`,
    `Task ID: ${summary.task?.taskId ?? "unknown"}`,
    `Session ID: ${summary.session?.sessionId ?? summary.task?.sessionId ?? "unknown"}`,
    `Task status: ${summary.task?.status ?? "unknown"}`,
    `Selected node: ${summary.selectedNodeId ?? summary.task?.selectedNodeId ?? summary.task?.assignedNodeId ?? "unknown"}`,
    `Selection reason: ${summary.selectedNodeReason ?? summary.task?.selectedNodeReason ?? "unknown"}`,
    `Assigned node: ${summary.nodeId ?? summary.task?.assignedNodeId ?? "unknown"}`,
    `Resumability: ${summary.task?.resumability ?? "unknown"}`,
    `Continuation mode: ${summary.task?.continuationGeneration && summary.task.continuationGeneration > 0 ? "resumed" : "fresh"}`,
    `Continuation generation: ${summary.task?.continuationGeneration ?? "unknown"}`,
    `Continuation source: ${summary.task?.continuationSourceNodeId ?? "unknown"}`,
    `Continuation target: ${summary.task?.continuationTargetNodeId ?? "unknown"}`,
    `Continuation reason: ${summary.task?.continuationReason ?? "unknown"}`,
    `Prior lease: ${summary.task?.priorLeaseId ?? "unknown"}`,
    `Resume attempts: ${summary.task?.resumeAttemptCount ?? "unknown"}`,
    `Recovery pending: ${typeof summary.task?.recoveryPending === "boolean" ? String(summary.task.recoveryPending) : "unknown"}`,
    `Recovery plan: ${recovery?.strategy ?? "unknown"}`,
    `Recovery reason: ${recovery?.reasonCategory ?? "unknown"}`,
    `Safe-stop point: ${recovery?.safeStopPoint ?? "unknown"}`,
    `Chain state: ${chain?.state ?? "unknown"}`,
    `Chain depth: ${chain?.depth ?? "unknown"}`,
    `Production-loop phase: ${summary.session?.workflowContinuity?.progress.chainPhase ?? "unknown"}`,
    `Last safe step: ${typeof summary.session?.workflowContinuity?.progress.lastCompletedSafeStep === "number" ? summary.session.workflowContinuity.progress.lastCompletedSafeStep : "unknown"}`,
    `Next intended step: ${summary.session?.workflowContinuity?.progress.nextIntendedStep ?? "unknown"}`,
    `Chain summary: ${summary.session?.workflowContinuity?.memory.chainSummary ?? "unknown"}`,
    `Last validation outcome: ${summary.session?.workflowContinuity?.memory.lastValidationOutcome ?? "unknown"}`,
    `Last fix attempt: ${summary.session?.workflowContinuity?.memory.lastFixAttemptSummary ?? "unknown"}`,
    `Operator blockers: ${summary.session?.workflowContinuity?.memory.operatorBlockers ?? "unknown"}`,
    `Phase repeat count: ${summary.session?.workflowContinuity?.loopHealth.currentPhaseRepeatCount ?? "unknown"}`,
    `Stalled loop: ${typeof summary.session?.workflowContinuity?.loopHealth.stalledLoop === "boolean" ? String(summary.session.workflowContinuity.loopHealth.stalledLoop) : "unknown"}`,
    `Recommendation confidence: ${summary.session?.workflowContinuity?.loopHealth.recommendationConfidence ?? "unknown"}`,
    `Likely needs operator input: ${typeof summary.session?.workflowContinuity?.loopHealth.likelyNeedsOperatorInput === "boolean" ? String(summary.session.workflowContinuity.loopHealth.likelyNeedsOperatorInput) : "unknown"}`,
    `Operator override status: ${summary.session?.workflowContinuity?.steering?.status ?? "unknown"}`,
    `Operator override request: ${summary.session?.workflowContinuity?.steering?.requestedAction ?? "unknown"}`,
    `Operator override reason: ${summary.session?.workflowContinuity?.steering?.overrideReason ?? "unknown"}`,
    `Operator note: ${summary.session?.workflowContinuity?.steering?.operatorNote ?? "unknown"}`,
    `Recommendation review summary: ${summary.session?.workflowContinuity?.review?.reviewSummary ?? "unknown"}`,
    `Last reviewed recommendation: ${summary.session?.workflowContinuity?.review?.lastReviewedRecommendation ?? "unknown"}`,
    `Last operator review response: ${summary.session?.workflowContinuity?.review?.lastOperatorResponse ?? "unknown"}`,
    `Last recommendation review outcome: ${summary.session?.workflowContinuity?.review?.lastRecommendationOutcome ?? "unknown"}`,
    `Last recommendation follow-through status: ${summary.session?.workflowContinuity?.review?.lastFollowThroughStatus ?? "unknown"}`,
    `Last recommendation follow-through summary: ${summary.session?.workflowContinuity?.review?.lastFollowThroughSummary ?? "unknown"}`,
    `Last accepted recommendation outcome: ${summary.session?.workflowContinuity?.review?.lastAcceptedRecommendationOutcome ?? "unknown"}`,
    `Last redirected recommendation outcome: ${summary.session?.workflowContinuity?.review?.lastRedirectedRecommendationOutcome ?? "unknown"}`,
    `Last review improved progress: ${typeof summary.session?.workflowContinuity?.review?.lastReviewImprovedProgress === "boolean" ? String(summary.session.workflowContinuity.review.lastReviewImprovedProgress) : "unknown"}`,
    `Last review needed correction: ${typeof summary.session?.workflowContinuity?.review?.lastRecommendationNeededCorrection === "boolean" ? String(summary.session.workflowContinuity.review.lastRecommendationNeededCorrection) : "unknown"}`,
    `Follow-through helped: ${typeof summary.session?.workflowContinuity?.review?.followThroughLedUsefulProgress === "boolean" ? String(summary.session.workflowContinuity.review.followThroughLedUsefulProgress) : "unknown"}`,
    `Follow-through required correction: ${typeof summary.session?.workflowContinuity?.review?.followThroughRequiredCorrection === "boolean" ? String(summary.session.workflowContinuity.review.followThroughRequiredCorrection) : "unknown"}`,
    `Returned to same recommendation again: ${typeof summary.session?.workflowContinuity?.review?.returnedToSameRecommendationAgain === "boolean" ? String(summary.session.workflowContinuity.review.returnedToSameRecommendationAgain) : "unknown"}`,
    `Repeated review without progress: ${typeof summary.session?.workflowContinuity?.review?.repeatedReviewWithoutProgress === "boolean" ? String(summary.session.workflowContinuity.review.repeatedReviewWithoutProgress) : "unknown"}`,
    `Recommendation frequently overridden: ${typeof summary.session?.workflowContinuity?.review?.frequentlyOverridden === "boolean" ? String(summary.session.workflowContinuity.review.frequentlyOverridden) : "unknown"}`,
    `Recommendation escalation status: ${summary.session?.workflowContinuity?.escalation?.escalationStatus ?? "unknown"}`,
    `Recommendation recovery guidance: ${summary.session?.workflowContinuity?.escalation?.recoveryRecommendation ?? "unknown"}`,
    `Recommendation handoff status: ${summary.session?.workflowContinuity?.handoff?.handoffStatus ?? "unknown"}`,
    `Recovery execution summary: ${summary.session?.workflowContinuity?.handoff?.recoveryExecutionSummary ?? "unknown"}`,
    `Likely needs operator intervention now: ${typeof summary.session?.workflowContinuity?.escalation?.likelyNeedsOperatorInterventionNow === "boolean" ? String(summary.session.workflowContinuity.escalation.likelyNeedsOperatorInterventionNow) : "unknown"}`,
    `Repeated ineffective review cycles: ${typeof summary.session?.workflowContinuity?.escalation?.repeatedIneffectiveReviewCycles === "boolean" ? String(summary.session.workflowContinuity.escalation.repeatedIneffectiveReviewCycles) : "unknown"}`,
    `Accepted recommendations repeatedly requiring correction: ${typeof summary.session?.workflowContinuity?.escalation?.acceptedRecommendationsRepeatedlyRequiringCorrection === "boolean" ? String(summary.session.workflowContinuity.escalation.acceptedRecommendationsRepeatedlyRequiringCorrection) : "unknown"}`,
    `Redirected recommendations outperforming system: ${typeof summary.session?.workflowContinuity?.escalation?.redirectedRecommendationsOutperformSystem === "boolean" ? String(summary.session.workflowContinuity.escalation.redirectedRecommendationsOutperformSystem) : "unknown"}`,
    `Returned to same ineffective recommendation state: ${typeof summary.session?.workflowContinuity?.escalation?.returnedToSameIneffectiveState === "boolean" ? String(summary.session.workflowContinuity.escalation.returnedToSameIneffectiveState) : "unknown"}`,
    `Recommendation escalation summary: ${summary.session?.workflowContinuity?.escalation?.escalationSummary ?? "unknown"}`,
    `Recommendation recovery summary: ${summary.session?.workflowContinuity?.escalation?.recoverySummary ?? "unknown"}`,
    `Last operator refinement note: ${summary.session?.workflowContinuity?.refinement?.lastOperatorRefinementNote ?? "unknown"}`,
    `Recent overrides improved progress: ${typeof summary.session?.workflowContinuity?.refinement?.recentOverridesImprovedProgress === "boolean" ? String(summary.session.workflowContinuity.refinement.recentOverridesImprovedProgress) : "unknown"}`,
    `Recommendation influenced by recent guidance: ${typeof summary.session?.workflowContinuity?.refinement?.recommendationInfluencedByRecentGuidance === "boolean" ? String(summary.session.workflowContinuity.refinement.recommendationInfluencedByRecentGuidance) : "unknown"}`,
    `Refinement summary: ${summary.session?.workflowContinuity?.refinement?.refinementSummary ?? "unknown"}`,
    `System recommended next phase: ${summary.session?.workflowContinuity?.loopHealth.systemRecommendedNextPhase ?? "unknown"}`,
    `Recommended next phase: ${summary.session?.workflowContinuity?.loopHealth.recommendedNextPhase ?? "unknown"}`,
    `Recommendation rationale: ${summary.session?.workflowContinuity?.loopHealth.recommendationRationaleSummary ?? "unknown"}`,
    `Top recommendation signals: ${summary.session?.workflowContinuity?.loopHealth.topContributingSignals?.join(" | ") || "unknown"}`,
    `Loop health reason: ${summary.session?.workflowContinuity?.loopHealth.loopHealthReason ?? "unknown"}`,
    `System loop health reason: ${summary.session?.workflowContinuity?.loopHealth.systemLoopHealthReason ?? "unknown"}`,
    `Lease: ${summary.task?.lease?.leaseId ?? "unknown"}`,
    `Lease owner: ${summary.task?.lease?.ownerNodeId ?? "unknown"}`,
    `Lease epoch: ${typeof summary.task?.lease?.epoch === "number" ? summary.task.lease.epoch : "unknown"}`,
    `Lease status: ${summary.task?.lease?.status ?? "unknown"}`,
    `Lease last progress: ${summary.task?.lease?.lastProgressAt ?? "unknown"}`,
    `Progress marker: ${summary.task?.lastProgressMarker ?? "unknown"}`,
    `Resumed checkpoint: ${summary.task?.resumedFromCheckpointReference ?? "none"}`,
    `Resumed token: ${summary.task?.resumedFromContinuationToken ? "present" : "none"}`,
    `Continuation token: ${summary.task?.continuationToken ? "present" : "none"}`,
    `Checkpoint reference: ${summary.task?.checkpointReference ?? "none"}`,
    `Runner mode: ${summary.runnerMode ?? summary.task?.runnerMode ?? "unknown"}`,
    `Claim token: ${summary.claimToken ?? summary.task?.claimToken ?? "unknown"}`,
    `Dispatch message: ${summary.dispatchMessageId ?? summary.task?.dispatchMessageId ?? "unknown"}`,
    `Dispatch ack: ${summary.dispatchAckMessageId ?? summary.task?.dispatchAckMessageId ?? "unknown"}`,
    `Dispatch result: ${summary.dispatchResultMessageId ?? summary.task?.dispatchResultMessageId ?? "unknown"}`,
    `Dispatch target: ${summary.dispatchTargetNodeId ?? summary.task?.dispatchTargetNodeId ?? "unknown"}`,
    `Dispatch protocol: ${summary.dispatchProtocolVersion ?? summary.task?.dispatchProtocolVersion ?? "unknown"}`,
    `Dispatch transport: ${summary.dispatchTransportStatus ?? summary.task?.dispatchTransportStatus ?? "unknown"}`,
    `Dispatch retry count: ${summary.dispatchRetryCount ?? summary.task?.dispatchRetryCount ?? "unknown"}`,
    `Dispatch last attempt: ${summary.dispatchLastAttemptAt ?? summary.task?.dispatchLastAttemptAt ?? "unknown"}`,
    `Dispatch timeout: ${summary.dispatchTimeoutMs ?? summary.task?.dispatchTimeoutMs ?? "unknown"}`,
    `Dispatch auth: ${summary.dispatchAuthSummary ?? summary.task?.dispatchAuthSummary ?? "unknown"}`,
    `Dispatch summary: ${summary.dispatchStatusSummary ?? summary.task?.dispatchStatusSummary ?? "No dispatch summary recorded."}`,
    `Queue summary: ${summary.queueStateSummary ?? "No queue summary recorded."}`,
    `Session status: ${summary.session?.status ?? "no session"}`,
    `Reason: ${summary.failureReason ?? summary.task?.failureReason ?? summary.task?.statusReason ?? summary.session?.completedReason ?? summary.session?.stateReason ?? "No status reason recorded."}`,
  ].join("\n");
}

export async function formatHeadlessTaskList(options?: { json?: boolean }): Promise<string> {
  const tasks = await listTasks();

  if (options?.json) {
    return JSON.stringify({ tasks }, null, 2);
  }

  if (!tasks.length) {
    return "No persisted autonomous tasks found.";
  }

  const taskLines = await Promise.all(
    tasks.slice(0, 20).map(async (task) => {
      const session = await loadAutonomousSession(task.sessionId);
      return `${task.taskId} | ${task.status} | ${task.selectedNodeId ?? task.assignedNodeId ?? "unassigned"} | lease=${task.lease?.ownerNodeId ?? "none"}:${task.lease?.status ?? "none"} | continuation=${task.continuationGeneration > 0 ? `gen-${task.continuationGeneration}:${task.continuationSourceNodeId ?? "unknown"}->${task.continuationTargetNodeId ?? "pending"}` : "fresh"} | chain=${deriveTaskContinuationChainState(task).state}:${deriveTaskContinuationChainState(task).depth} | phase=${session?.workflowContinuity.progress.chainPhase ?? "unknown"} | repeat=${session?.workflowContinuity.loopHealth.currentPhaseRepeatCount ?? "unknown"} | stalled=${typeof session?.workflowContinuity.loopHealth.stalledLoop === "boolean" ? String(session.workflowContinuity.loopHealth.stalledLoop) : "unknown"} | recommended=${session?.workflowContinuity.loopHealth.recommendedNextPhase ?? "unknown"} | safeStep=${typeof session?.workflowContinuity.progress.lastCompletedSafeStep === "number" ? session.workflowContinuity.progress.lastCompletedSafeStep : "none"} | next=${session?.workflowContinuity.loopHealth.recommendedNextActionSummary ?? session?.workflowContinuity.progress.nextIntendedStep ?? "none"} | plan=${deriveTaskRecoveryPlanningState(task).strategy}:${deriveTaskRecoveryPlanningState(task).reasonCategory} | safeStop=${deriveTaskRecoveryPlanningState(task).safeStopPoint ?? "none"} | resumability=${task.resumability} | recovery=${task.recoveryPending} | transport=${task.dispatchTransportStatus ?? "none"} | hardening=${deriveTaskDispatchHardeningState(task).state}:${deriveTaskDispatchHardeningState(task).category} | retries=${task.dispatchRetryCount ?? 0} | failure=${task.failureReason ?? "none"} | ${task.sessionId}`;
    }),
  );

  return taskLines.join("\n");
}

export function formatHeadlessNodeList(options?: { json?: boolean }): string {
  const nodes = listExecutionNodes();

  if (options?.json) {
    return JSON.stringify({
      nodes: nodes.map((node) => ({
        ...node,
        eligibility: getExecutionNodeEligibility(node),
      })),
    }, null, 2);
  }

  if (!nodes.length) {
    return "No registered execution nodes found.";
  }

  return nodes
    .map((node) => {
      const eligibility = getExecutionNodeEligibility(node);
      return `${node.id} | ${node.mode} | status=${node.status} | busy=${node.busy} | task=${node.activeTaskId ?? "none"} | heartbeat=${node.lastHeartbeatAt ?? "none"} | eligible=${eligibility.eligible} | ${eligibility.reason}`;
    })
    .join("\n");
}

export async function runHeadlessAutonomy(
  options: HeadlessAutonomyOptions,
  dependencies?: Partial<HeadlessAutonomyDependencies>,
): Promise<AutonomousSession> {
  const existingSession = options.sessionId ? await loadAutonomousSession(options.sessionId) : null;
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = await resolveRepoRoot(cwd);
  registerExecutionNode(createRuntimeExecutionNodeDescriptor({
    runtimeMode: "headless",
    cwd,
    allowedRoots: options.allowedRoots,
  }));

  return runAutonomousSession({
    goal: options.goal || existingSession?.goal || "Confirm the bounded autonomous path reaches a healthy result.",
    maxSteps: options.maxSteps,
    approved: options.approved,
    steering: options.steeringAction || options.operatorNote || options.stopReason || options.restartReason
      ? {
          action: options.steeringAction,
          operatorNote: options.operatorNote,
          overrideReason: options.overrideReason,
          stopReason: options.stopReason,
          restartReason: options.restartReason,
        }
      : undefined,
    clearSteering: options.clearSteering,
    existingSession: existingSession ?? undefined,
    executionContext: {
      cwd,
      repoRoot,
      allowedRoots: options.allowedRoots,
      runtimeMode: "headless",
    },
    dependencies,
  });
}

export async function runHeadlessQueuedTask(
  options: HeadlessAutonomyOptions,
  dependencies?: Partial<HeadlessAutonomyDependencies>,
): Promise<QueueExecutionSummary> {
  return (dependencies?.runSingleQueuedTask ?? runSingleQueuedTask)({
    taskId: options.runTask ? options.taskId : undefined,
    runtimeMode: "headless",
    cwd: options.cwd ?? process.cwd(),
    allowedRoots: options.allowedRoots,
    maxSteps: options.maxSteps ?? 1,
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.listTasks) {
    process.stdout.write(`${await formatHeadlessTaskList({ json: options.json })}\n`);
    return;
  }

  if (options.listNodes) {
    process.stdout.write(`${formatHeadlessNodeList({ json: options.json })}\n`);
    return;
  }

  if (options.taskId) {
    if (options.runTask) {
      const summary = await runHeadlessQueuedTask(options);
      process.stdout.write(`${formatHeadlessQueueRunReport(summary, { json: options.json })}\n`);
      return;
    }

    const task = await getTask(options.taskId);
    if (!task) {
      console.error("Autonomous task not found.");
      process.exitCode = 1;
      return;
    }

    process.stdout.write(`${formatHeadlessTaskReport(task, { json: options.json })}\n`);
    return;
  }

  if (options.runNextTask) {
    const summary = await runHeadlessQueuedTask(options);
    process.stdout.write(`${formatHeadlessQueueRunReport(summary, { json: options.json })}\n`);
    return;
  }

  if (!options.goal && !options.sessionId) {
    console.error("A goal or existing sessionId is required.");
    process.exitCode = 1;
    return;
  }

  const session = await runHeadlessAutonomy(options);
  process.stdout.write(`${formatHeadlessSessionReport(session, { json: options.json, verbose: options.verbose })}\n`);
}

if (process.argv[1]?.endsWith("headless_autonomy.ts")) {
  void main();
}