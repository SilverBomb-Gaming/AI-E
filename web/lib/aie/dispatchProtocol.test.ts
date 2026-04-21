import assert from "node:assert/strict";
import test from "node:test";

import {
  createDispatchEnvelope,
  deserializeDispatchEnvelope,
  isDispatchEnvelope,
  serializeDispatchEnvelope,
  summarizeDispatchEnvelope,
} from "./dispatchProtocol";

test("dispatchProtocol creates serializable versioned envelopes", () => {
  const envelope = createDispatchEnvelope({
    messageType: "task-dispatch-request",
    sourceNodeId: "aie-node-local-default",
    targetNodeId: "aie-node-headless-default",
    taskId: "task-dispatch-1",
    sessionId: "session-dispatch-1",
    payload: {
      ok: true,
      nested: ["inspection", 1],
    },
  });

  const serialized = serializeDispatchEnvelope(envelope);
  const parsed = deserializeDispatchEnvelope(serialized);

  assert.equal(envelope.protocolVersion, "1");
  assert.equal(isDispatchEnvelope(envelope), true);
  assert.equal(parsed?.messageId, envelope.messageId);
  assert.match(summarizeDispatchEnvelope(envelope), /type=task-dispatch-request/i);
});

test("dispatchProtocol rejects malformed envelopes during deserialization", () => {
  const parsed = deserializeDispatchEnvelope(JSON.stringify({
    protocolVersion: "2",
    messageType: "task-dispatch-request",
    messageId: "aie-dispatch-bad",
    createdAt: new Date().toISOString(),
    sourceNodeId: "aie-node-local-default",
    targetNodeId: "aie-node-headless-default",
    taskId: "task-dispatch-bad",
    sessionId: "session-dispatch-bad",
    payload: {},
  }));

  assert.equal(parsed, null);
});
