import assert from "node:assert/strict";
import test from "node:test";

import {
  claimTaskEnvelope,
  createTaskExecutionLease,
  assignTaskEnvelope,
  createTaskEnvelope,
  deriveTaskContinuationChainState,
  deriveTaskRecoveryPlanningState,
  markTaskAssigned,
  markTaskBlocked,
  markTaskCompleted,
  markTaskFailed,
  markTaskRunning,
  normalizeTaskEnvelope,
  releaseTaskEnvelope,
  summarizeTaskEnvelope,
  updateTaskEnvelopeStatus,
} from "./taskEnvelope";
import type { ExecutionActionPreview } from "./types";

function makeAction(): ExecutionActionPreview {
  return {
    id: "task-action",
    type: "validation-check",
    scope: "safe",
    description: "Validate the bounded output.",
    expectedOutcome: "The bounded output should be confirmed.",
    requiresApproval: true,
    metadata: {
      sourceActionType: "validation-check",
    },
  };
}

test("task envelopes create serializable queued tasks", () => {
  const envelope = createTaskEnvelope({
    sessionId: "session-123",
    stepIndex: 2,
    priority: 7,
    dependsOnTaskIds: ["task-alpha", "task-alpha", "task-beta"],
    dependsOnFeatureIds: ["feature-registry", "feature-registry", "feature-runtime"],
    featureId: "feature-oversight",
    featureTitle: "Operator Oversight",
    featureDescription: "Related bounded tasks for the operator oversight feature.",
    action: makeAction(),
  });

  assert.equal(envelope.sessionId, "session-123");
  assert.equal(envelope.stepIndex, 2);
  assert.equal(envelope.status, "queued");
  assert.equal(envelope.generatedTask, true);
  assert.equal(envelope.priority, 7);
  assert.deepEqual(envelope.dependsOnTaskIds, ["task-alpha", "task-beta"]);
  assert.deepEqual(envelope.dependsOnFeatureIds, ["feature-registry", "feature-runtime"]);
  assert.equal(envelope.featureId, "feature-oversight");
  assert.equal(envelope.featureTitle, "Operator Oversight");
  assert.match(envelope.featureDescription ?? "", /operator oversight/i);
  assert.equal(envelope.resumability, "restart-required");
  assert.equal(envelope.continuationGeneration, 0);
  assert.equal(envelope.resumeAttemptCount, 0);
  assert.equal(envelope.recoveryPending, false);
  assert.deepEqual(envelope.requestedCapabilities, ["validation-check", "repo-scan"]);
});

test("task envelopes support claim and status updates", () => {
  const envelope = createTaskEnvelope({
    sessionId: "session-123",
    stepIndex: 1,
    action: makeAction(),
    preferredNodeId: "aie-node-web-default",
  });
  const claimed = claimTaskEnvelope(envelope, {
    assignedNodeId: "aie-node-web-default",
    selectedNodeReason: "Preferred capable node matched the task.",
    claimToken: "claim-status-1",
    runnerMode: "web",
  });
  const running = updateTaskEnvelopeStatus(claimed, "executing");
  const completed = updateTaskEnvelopeStatus(running, "completed");

  assert.equal(claimed.assignedNodeId, "aie-node-web-default");
  assert.equal(claimed.selectedNodeId, "aie-node-web-default");
  assert.equal(claimed.status, "dispatching");
  assert.equal(running.status, "executing");
  assert.equal(completed.status, "completed");
  assert.match(summarizeTaskEnvelope(completed), /task=/i);
  assert.match(summarizeTaskEnvelope(completed), /node=aie-node-web-default/i);
  assert.match(summarizeTaskEnvelope(completed), /priority=0/i);
});

test("task envelopes enforce claim and release semantics", () => {
  const envelope = createTaskEnvelope({
    taskId: "task-claim-1",
    sessionId: "session-claim-1",
    stepIndex: 1,
    action: makeAction(),
  });
  const claimed = claimTaskEnvelope(envelope, {
    assignedNodeId: "aie-node-local-default",
    claimToken: "claim-1",
    runnerMode: "local-node",
    statusReason: "Claimed for deterministic execution.",
  });
  const released = releaseTaskEnvelope(claimed, "Released back to the queue.");

  assert.equal(claimed.status, "dispatching");
  assert.equal(claimed.assignedNodeId, "aie-node-local-default");
  assert.equal(claimed.selectedNodeId, "aie-node-local-default");
  assert.equal(claimed.claimToken, "claim-1");
  assert.equal(claimed.runnerMode, "local-node");
  assert.equal(claimed.claimedAt, undefined);
  assert.throws(() => claimTaskEnvelope(claimed, {
    assignedNodeId: "aie-node-local-default",
    claimToken: "claim-2",
    runnerMode: "local-node",
  }));
  assert.equal(released.status, "queued");
  assert.equal(released.claimToken, undefined);
  assert.equal(released.runnerMode, undefined);
  assert.equal(released.assignedNodeId, undefined);
});

test("task lifecycle helpers persist explicit transition metadata", () => {
  const envelope = createTaskEnvelope({
    sessionId: "session-123",
    stepIndex: 3,
    action: makeAction(),
    status: "pending",
  });

  const assigned = markTaskAssigned(envelope, "aie-node-web-default", {
    statusReason: "Assigned to the preferred local node.",
  });
  const running = markTaskRunning(assigned, {
    statusReason: "Executing inside the shared runner.",
  });
  const completed = markTaskCompleted(running, {
    statusReason: "The bounded execution completed successfully.",
  });
  const failed = markTaskFailed(running, {
    statusReason: "The bounded execution failed.",
  });
  const blocked = markTaskBlocked(assigned, {
    statusReason: "Manual approval is still required.",
  });

  assert.equal(assigned.status, "assigned");
  assert.equal(assigned.assignedNodeId, "aie-node-web-default");
  assert.equal(typeof assigned.assignedAt, "string");
  assert.equal(running.status, "running");
  assert.equal(typeof running.startedAt, "string");
  assert.equal(completed.status, "completed");
  assert.equal(completed.statusReason, "The bounded execution completed successfully.");
  assert.equal(typeof completed.completedAt, "string");
  assert.equal(failed.status, "failed");
  assert.equal(blocked.status, "blocked");
});

test("task envelopes normalize from serialized records", () => {
  const envelope = claimTaskEnvelope(createTaskEnvelope({
    taskId: "task-normalize",
    sessionId: "session-123",
    stepIndex: 1,
    action: makeAction(),
  }), {
    assignedNodeId: "aie-node-web-default",
    claimToken: "claim-normalize-1",
    runnerMode: "web",
  });
  const normalized = normalizeTaskEnvelope(JSON.parse(JSON.stringify(envelope)));

  assert.ok(normalized);
  assert.equal(normalized?.taskId, "task-normalize");
  assert.equal(normalized?.status, "dispatching");
});

test("task envelopes preserve dispatch metadata additively", () => {
  const envelope = markTaskCompleted(
    markTaskRunning(
      updateTaskEnvelopeStatus(claimTaskEnvelope(createTaskEnvelope({
        taskId: "task-dispatch-1",
        sessionId: "session-dispatch-1",
        stepIndex: 1,
        action: makeAction(),
      }), {
        assignedNodeId: "aie-node-local-default",
        selectedNodeReason: "Preferred local node selected.",
        claimToken: "claim-dispatch-1",
        runnerMode: "local-node",
      }), "awaiting-ack", {
        dispatchMessageId: "aie-dispatch-1",
        dispatchAckMessageId: "aie-dispatch-ack-1",
        dispatchResultMessageId: "aie-dispatch-result-1",
        dispatchTargetNodeId: "aie-node-local-default",
        dispatchProtocolVersion: "1",
        dispatchStatusSummary: "dispatch=1 | type=request | node=aie-node-local-default",
        dispatchAuthSummary: "auth=aie-node-local-default->aie-node-local-default | scope=local-lab | valid=true",
        dispatchTransportStatus: "accepted",
        dispatchReceivedAt: "2026-04-21T00:00:01.000Z",
        remoteDispatchPlanned: true,
      }),
    ),
    {
      dispatchStatusSummary: "dispatch=1 | type=result | status=completed",
      dispatchTransportStatus: "completed",
      dispatchCompletedAt: "2026-04-21T00:00:02.000Z",
    },
  );

  const normalized = normalizeTaskEnvelope(JSON.parse(JSON.stringify(envelope)));

  assert.equal(normalized?.dispatchMessageId, "aie-dispatch-1");
  assert.equal(normalized?.dispatchAckMessageId, "aie-dispatch-ack-1");
  assert.equal(normalized?.dispatchResultMessageId, "aie-dispatch-result-1");
  assert.equal(normalized?.dispatchTargetNodeId, "aie-node-local-default");
  assert.equal(normalized?.dispatchProtocolVersion, "1");
  assert.equal(normalized?.dispatchTransportStatus, "completed");
  assert.match(normalized?.dispatchAuthSummary ?? "", /scope=local-lab/i);
  assert.equal(normalized?.remoteDispatchPlanned, true);
  assert.equal(normalized?.dispatchReceivedAt, "2026-04-21T00:00:01.000Z");
  assert.equal(normalized?.dispatchCompletedAt, "2026-04-21T00:00:02.000Z");
  assert.match(summarizeTaskEnvelope(envelope), /dispatch=aie-dispatch-1/i);
  assert.match(summarizeTaskEnvelope(envelope), /ack=aie-dispatch-ack-1/i);
  assert.match(summarizeTaskEnvelope(envelope), /result=aie-dispatch-result-1/i);
});

test("task envelopes preserve additive lease and resumable metadata", () => {
  const leaseEnvelope = updateTaskEnvelopeStatus(
    markTaskRunning(
      markTaskAssigned(
        createTaskEnvelope({
          taskId: "task-lease-1",
          sessionId: "session-lease-1",
          stepIndex: 1,
          action: makeAction(),
        }),
        "aie-node-headless-1",
      ),
      {
        resumability: "resumable",
        continuationSourceNodeId: "aie-node-headless-0",
        continuationTargetNodeId: "aie-node-headless-1",
        continuationGeneration: 1,
        continuationReason: "timeout-recovery",
        resumedFromCheckpointReference: "checkpoint://lease-0",
        resumedFromContinuationToken: "continue-lease-0",
        continuationToken: "continue-lease-1",
        checkpointReference: "checkpoint://lease-1",
        resumeAttemptCount: 1,
        lastProgressMarker: "step-1/3",
        recoveryPending: true,
        priorLeaseId: "aie-lease-0",
        lease: {
          leaseId: "aie-lease-1",
          ownerNodeId: "aie-node-headless-1",
          epoch: 2,
          startedAt: "2026-04-21T01:00:00.000Z",
          lastProgressAt: "2026-04-21T01:05:00.000Z",
          status: "active",
          continuationToken: "continue-lease-1",
          checkpointReference: "checkpoint://lease-1",
          progressMarker: "step-1/3",
        },
      },
    ),
    "executing",
    {
      lastProgressMarker: "step-2/3",
    },
  );

  const normalized = normalizeTaskEnvelope(JSON.parse(JSON.stringify(leaseEnvelope)));

  assert.equal(normalized?.resumability, "resumable");
  assert.equal(normalized?.continuationSourceNodeId, "aie-node-headless-0");
  assert.equal(normalized?.continuationTargetNodeId, "aie-node-headless-1");
  assert.equal(normalized?.continuationGeneration, 1);
  assert.equal(normalized?.continuationReason, "timeout-recovery");
  assert.equal(normalized?.resumedFromCheckpointReference, "checkpoint://lease-0");
  assert.equal(normalized?.resumedFromContinuationToken, "continue-lease-0");
  assert.equal(normalized?.continuationToken, "continue-lease-1");
  assert.equal(normalized?.checkpointReference, "checkpoint://lease-1");
  assert.equal(normalized?.resumeAttemptCount, 1);
  assert.equal(normalized?.lastProgressMarker, "step-2/3");
  assert.equal(normalized?.recoveryPending, true);
  assert.equal(normalized?.priorLeaseId, "aie-lease-0");
  assert.equal(normalized?.lease?.leaseId, "aie-lease-1");
  assert.equal(normalized?.lease?.ownerNodeId, "aie-node-headless-1");
  assert.equal(normalized?.lease?.epoch, 2);
  assert.equal(normalized?.lease?.status, "active");
  assert.match(summarizeTaskEnvelope(leaseEnvelope), /lease=aie-lease-1/i);
  assert.match(summarizeTaskEnvelope(leaseEnvelope), /resumability=resumable/i);
  assert.match(summarizeTaskEnvelope(leaseEnvelope), /continuationGen=1/i);
  assert.match(summarizeTaskEnvelope(leaseEnvelope), /continuationSource=aie-node-headless-0/i);
  assert.match(summarizeTaskEnvelope(leaseEnvelope), /continuationTarget=aie-node-headless-1/i);
  assert.match(summarizeTaskEnvelope(leaseEnvelope), /continuationReason=timeout-recovery/i);
  assert.match(summarizeTaskEnvelope(leaseEnvelope), /resumedCheckpoint=checkpoint:\/\/lease-0/i);
  assert.match(summarizeTaskEnvelope(leaseEnvelope), /resumedToken=present/i);
  assert.match(summarizeTaskEnvelope(leaseEnvelope), /continuation=present/i);
  assert.match(summarizeTaskEnvelope(leaseEnvelope), /recovery=pending/i);
});

test("task envelopes reject a second active lease unless the prior lease is explicitly superseded", () => {
  const envelope = markTaskRunning(markTaskAssigned(createTaskEnvelope({
    taskId: "task-lease-guard",
    sessionId: "session-lease-guard",
    stepIndex: 1,
    action: makeAction(),
  }), "aie-node-web-default"), {
    lease: createTaskExecutionLease({
      ownerNodeId: "aie-node-web-default",
      at: "2026-04-21T02:00:00.000Z",
      progressMarker: "initial",
    }),
  });

  assert.throws(() => updateTaskEnvelopeStatus(envelope, "awaiting-ack", {
    lease: createTaskExecutionLease({
      ownerNodeId: "aie-node-headless-default",
      previousLease: envelope.lease,
      at: "2026-04-21T02:05:00.000Z",
      progressMarker: "invalid-second-lease",
    }),
  }));
});

test("task envelopes allow retrying tasks to re-enter awaiting-ack", () => {
  const envelope = createTaskEnvelope({
    taskId: "task-retry-awaiting-ack",
    sessionId: "session-retry-awaiting-ack",
    stepIndex: 1,
    action: makeAction(),
    status: "retrying",
  });

  const updated = updateTaskEnvelopeStatus(envelope, "awaiting-ack", {
    assignedNodeId: "aie-node-local-default",
    selectedNodeId: "aie-node-local-default",
    dispatchMessageId: "aie-dispatch-retry-1",
    dispatchTargetNodeId: "aie-node-local-default",
    dispatchTransportStatus: "pending",
    dispatchRetryCount: 2,
    failureReason: undefined,
  });

  assert.equal(updated.status, "awaiting-ack");
  assert.equal(updated.assignedNodeId, "aie-node-local-default");
  assert.equal(updated.dispatchRetryCount, 2);
  assert.equal(updated.dispatchTransportStatus, "pending");
});

test("task envelopes derive restart-safe-boundary planning for non-resumable recovery", () => {
  const envelope = updateTaskEnvelopeStatus(createTaskEnvelope({
    taskId: "task-recovery-plan-1",
    sessionId: "session-recovery-plan-1",
    stepIndex: 3,
    action: makeAction(),
    status: "retrying",
  }), "retrying", {
    statusReason: "Retrying after timeout while preserving the last safe stop point.",
    failureReason: "Dispatch timed out before the bounded validation completed.",
    lastProgressMarker: "step-3/safe-stop",
    recoveryPending: true,
  });

  const recoveryPlanning = deriveTaskRecoveryPlanningState(envelope);
  const continuationChain = deriveTaskContinuationChainState(envelope);

  assert.equal(recoveryPlanning.strategy, "restart-safe-boundary");
  assert.equal(recoveryPlanning.reasonCategory, "timeout");
  assert.equal(recoveryPlanning.safeStopPoint, "step-3/safe-stop");
  assert.equal(continuationChain.state, "restart-pending");
  assert.equal(continuationChain.depth, 0);
  assert.equal(continuationChain.safeStopPoint, "step-3/safe-stop");
  assert.match(summarizeTaskEnvelope(envelope), /recoveryPlan=restart-safe-boundary/i);
  assert.match(summarizeTaskEnvelope(envelope), /chain=restart-pending/i);
});

test("task envelopes derive continuation-resume planning for resumable recovery", () => {
  const envelope = updateTaskEnvelopeStatus(createTaskEnvelope({
    taskId: "task-recovery-plan-2",
    sessionId: "session-recovery-plan-2",
    stepIndex: 2,
    action: makeAction(),
    status: "retrying",
  }), "retrying", {
    resumability: "resumable",
    continuationGeneration: 1,
    continuationReason: "timeout-recovery",
    continuationToken: "continue-recovery-plan-2",
    checkpointReference: "checkpoint://recovery-plan-2",
    resumedFromContinuationToken: "continue-recovery-plan-1",
    resumedFromCheckpointReference: "checkpoint://recovery-plan-1",
    lastProgressMarker: "step-2/checkpoint",
    recoveryPending: true,
  });

  const recoveryPlanning = deriveTaskRecoveryPlanningState(envelope);
  const continuationChain = deriveTaskContinuationChainState(envelope);

  assert.equal(recoveryPlanning.strategy, "resume-continuation");
  assert.equal(recoveryPlanning.reasonCategory, "timeout");
  assert.equal(continuationChain.state, "safe-stop");
  assert.equal(continuationChain.depth, 1);
});