import assert from "node:assert/strict";
import test from "node:test";

import { createDispatchAuthToken } from "./dispatchAuth";
import {
  createTaskDispatchAck,
  createTaskDispatchError,
  createTaskDispatchRequest,
  createTaskDispatchResult,
  summarizeDispatchPayload,
  validateDispatchPayloadShape,
} from "./dispatchMessages";

test("dispatchMessages normalize request payloads and summarize them", () => {
  const authToken = createDispatchAuthToken({
    sourceNodeId: "aie-node-local-default",
    targetNodeId: "aie-node-local-default",
    taskId: "dispatch-action-1",
    sessionId: "session-dispatch-action-1",
  });
  const request = createTaskDispatchRequest({
    action: {
      id: "dispatch-action-1",
      type: "validation-check",
      scope: "safe",
      description: "Validate the bounded dispatch action.",
      expectedOutcome: "The bounded dispatch action should complete successfully.",
      requiresApproval: true,
      metadata: {
        sourceActionType: "validation-check",
      },
    },
    requestedCapabilities: ["validation-check", "repo-scan"],
    assignedNodeId: "aie-node-local-default",
    authToken,
    approvalState: {
      requiresApproval: true,
      approved: true,
    },
    queueStateSummary: "task=dispatch-action-1 status=assigned",
    dispatchAuthSummary: "auth=aie-node-local-default->aie-node-local-default | scope=local-lab | valid=true",
    remoteDispatchPlanned: true,
  });

  assert.equal(validateDispatchPayloadShape("task-dispatch-request", request), true);
  assert.match(summarizeDispatchPayload("task-dispatch-request", request), /type=request/i);
  assert.equal(request.authToken.sourceNodeId, "aie-node-local-default");
  assert.equal(request.remoteDispatchPlanned, true);
});

test("dispatchMessages validate ack result and error payload families", () => {
  const ack = createTaskDispatchAck({ accepted: true, reason: "Accepted locally." });
  const result = createTaskDispatchResult({
    status: "completed",
    linkedTaskId: "task-dispatch-1",
    linkedSessionId: "session-dispatch-1",
    summary: "Completed locally.",
  });
  const error = createTaskDispatchError({ error: "Dispatch rejected.", retryable: false });

  assert.equal(validateDispatchPayloadShape("task-dispatch-ack", ack), true);
  assert.equal(validateDispatchPayloadShape("task-dispatch-result", result), true);
  assert.equal(validateDispatchPayloadShape("task-dispatch-error", error), true);
  assert.match(summarizeDispatchPayload("task-dispatch-result", result), /status=completed/i);
});
