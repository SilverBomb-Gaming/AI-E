import assert from "node:assert/strict";
import test from "node:test";

import { createDispatchEnvelope } from "./dispatchProtocol";
import { createTaskDispatchRequest } from "./dispatchMessages";
import {
  receiveDispatchMessage,
  sendDispatchMessage,
  simulateLocalDispatchRoundTrip,
} from "./dispatchTransport";

test("dispatchTransport serializes and rehydrates validated messages", async () => {
  const envelope = createDispatchEnvelope({
    messageType: "task-dispatch-request",
    sourceNodeId: "aie-node-local-default",
    targetNodeId: "aie-node-headless-default",
    taskId: "task-dispatch-transport-1",
    sessionId: "session-dispatch-transport-1",
    payload: createTaskDispatchRequest({
      action: {
        id: "dispatch-transport-action-1",
        type: "validation-check",
        scope: "safe",
        description: "Validate the transport payload.",
        expectedOutcome: "The transport payload should remain valid.",
        requiresApproval: true,
        metadata: {
          sourceActionType: "validation-check",
        },
      },
      requestedCapabilities: ["validation-check", "repo-scan"],
      assignedNodeId: "aie-node-headless-default",
      remoteDispatchPlanned: true,
    }),
  });

  const serialized = await sendDispatchMessage(envelope);
  const received = await receiveDispatchMessage(serialized);

  assert.equal(received?.messageId, envelope.messageId);
  assert.equal(received?.messageType, "task-dispatch-request");
});

test("dispatchTransport simulates local ack and result messages without executing remotely", () => {
  const request = createDispatchEnvelope({
    messageType: "task-dispatch-request",
    sourceNodeId: "aie-node-local-default",
    targetNodeId: "aie-node-headless-default",
    taskId: "task-dispatch-transport-2",
    sessionId: "session-dispatch-transport-2",
    payload: createTaskDispatchRequest({
      action: {
        id: "dispatch-transport-action-2",
        type: "validation-check",
        scope: "safe",
        description: "Validate the simulated round trip.",
        expectedOutcome: "The simulated round trip should return a result envelope.",
        requiresApproval: true,
        metadata: {
          sourceActionType: "validation-check",
        },
      },
      requestedCapabilities: ["validation-check", "repo-scan"],
      assignedNodeId: "aie-node-headless-default",
      remoteDispatchPlanned: true,
    }),
  });

  const roundTrip = simulateLocalDispatchRoundTrip({
    request,
    accepted: true,
    resultPayload: {
      status: "completed",
      linkedTaskId: request.taskId,
      linkedSessionId: request.sessionId,
      summary: "Completed through the shared local runner.",
    },
  });

  assert.equal(roundTrip.ack.payload.accepted, true);
  assert.equal(roundTrip.result?.payload.status, "completed");
  assert.equal(roundTrip.error, undefined);
});
