import assert from "node:assert/strict";
import test from "node:test";

import {
  claimTaskEnvelope,
  assignTaskEnvelope,
  createTaskEnvelope,
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

test("task envelopes create serializable pending tasks", () => {
  const envelope = createTaskEnvelope({
    sessionId: "session-123",
    stepIndex: 2,
    action: makeAction(),
  });

  assert.equal(envelope.sessionId, "session-123");
  assert.equal(envelope.stepIndex, 2);
  assert.equal(envelope.status, "pending");
  assert.deepEqual(envelope.requestedCapabilities, ["validation-check", "repo-scan"]);
});

test("task envelopes support assignment and status updates", () => {
  const envelope = createTaskEnvelope({
    sessionId: "session-123",
    stepIndex: 1,
    action: makeAction(),
    preferredNodeId: "aie-node-web-default",
  });
  const assigned = assignTaskEnvelope(envelope, "aie-node-web-default");
  const running = updateTaskEnvelopeStatus(assigned, "running");
  const completed = updateTaskEnvelopeStatus(assigned, "completed");

  assert.equal(assigned.assignedNodeId, "aie-node-web-default");
  assert.equal(assigned.status, "assigned");
  assert.equal(running.status, "running");
  assert.equal(completed.status, "completed");
  assert.match(summarizeTaskEnvelope(completed), /task=/i);
  assert.match(summarizeTaskEnvelope(completed), /node=aie-node-web-default/i);
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

  assert.equal(claimed.status, "assigned");
  assert.equal(claimed.assignedNodeId, "aie-node-local-default");
  assert.equal(claimed.claimToken, "claim-1");
  assert.equal(claimed.runnerMode, "local-node");
  assert.equal(typeof claimed.claimedAt, "string");
  assert.throws(() => claimTaskEnvelope(claimed, {
    assignedNodeId: "aie-node-local-default",
    claimToken: "claim-2",
    runnerMode: "local-node",
  }));
  assert.equal(released.status, "pending");
  assert.equal(released.claimToken, undefined);
  assert.equal(released.runnerMode, undefined);
  assert.equal(released.assignedNodeId, undefined);
});

test("task lifecycle helpers persist explicit transition metadata", () => {
  const envelope = createTaskEnvelope({
    sessionId: "session-123",
    stepIndex: 3,
    action: makeAction(),
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
  const envelope = assignTaskEnvelope(
    createTaskEnvelope({
      taskId: "task-normalize",
      sessionId: "session-123",
      stepIndex: 1,
      action: makeAction(),
    }),
    "aie-node-web-default",
  );
  const normalized = normalizeTaskEnvelope(JSON.parse(JSON.stringify(envelope)));

  assert.ok(normalized);
  assert.equal(normalized?.taskId, "task-normalize");
  assert.equal(normalized?.status, "assigned");
});

test("task envelopes preserve dispatch metadata additively", () => {
  const envelope = markTaskCompleted(
    markTaskRunning(
      markTaskAssigned(createTaskEnvelope({
        taskId: "task-dispatch-1",
        sessionId: "session-dispatch-1",
        stepIndex: 1,
        action: makeAction(),
      }), "aie-node-local-default", {
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