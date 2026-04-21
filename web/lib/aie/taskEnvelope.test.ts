import assert from "node:assert/strict";
import test from "node:test";

import { assignTaskEnvelope, createTaskEnvelope, summarizeTaskEnvelope, updateTaskEnvelopeStatus } from "./taskEnvelope";
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