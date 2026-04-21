import assert from "node:assert/strict";
import test from "node:test";

import {
  assignTaskEnvelope,
  createTaskEnvelope,
  markTaskAssigned,
  markTaskBlocked,
  markTaskCompleted,
  markTaskFailed,
  markTaskRunning,
  normalizeTaskEnvelope,
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
  const assigned = assignTaskEnvelope(envelope, "aie-node-web-default", "running");
  const completed = updateTaskEnvelopeStatus(assigned, "completed");

  assert.equal(assigned.assignedNodeId, "aie-node-web-default");
  assert.equal(assigned.status, "running");
  assert.equal(completed.status, "completed");
  assert.match(summarizeTaskEnvelope(completed), /task=/i);
  assert.match(summarizeTaskEnvelope(completed), /node=aie-node-web-default/i);
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