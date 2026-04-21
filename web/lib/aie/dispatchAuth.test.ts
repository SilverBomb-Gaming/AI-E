import assert from "node:assert/strict";
import test from "node:test";

import {
  createDispatchAuthToken,
  summarizeDispatchAuthContext,
  validateDispatchAuthToken,
} from "./dispatchAuth";

test("dispatchAuth creates deterministic lab auth tokens and summaries", () => {
  const token = createDispatchAuthToken({
    sourceNodeId: "aie-node-local-default",
    targetNodeId: "aie-node-headless-default",
    taskId: "task-auth-1",
    sessionId: "session-auth-1",
    issuedAt: "2026-04-21T00:00:00.000Z",
    ttlSeconds: 60,
  });

  assert.equal(token.scheme, "lab-sha256");
  assert.equal(token.scope, "local-lab");
  assert.match(summarizeDispatchAuthContext({
    sourceNodeId: token.sourceNodeId,
    targetNodeId: token.targetNodeId,
    valid: true,
    expiresAt: token.expiresAt,
  }), /scope=local-lab/i);
});

test("dispatchAuth accepts matching auth tokens", () => {
  const token = createDispatchAuthToken({
    sourceNodeId: "aie-node-local-default",
    targetNodeId: "aie-node-headless-default",
    taskId: "task-auth-2",
    sessionId: "session-auth-2",
    issuedAt: "2026-04-21T00:00:00.000Z",
    ttlSeconds: 60,
  });

  const validation = validateDispatchAuthToken({
    authToken: token,
    envelope: {
      protocolVersion: "1",
      sourceNodeId: "aie-node-local-default",
      targetNodeId: "aie-node-headless-default",
      taskId: "task-auth-2",
      sessionId: "session-auth-2",
    },
    now: "2026-04-21T00:00:30.000Z",
  });

  assert.equal(validation.valid, true);
});

test("dispatchAuth rejects invalid or expired tokens", () => {
  const token = createDispatchAuthToken({
    sourceNodeId: "aie-node-local-default",
    targetNodeId: "aie-node-headless-default",
    taskId: "task-auth-3",
    sessionId: "session-auth-3",
    issuedAt: "2026-04-21T00:00:00.000Z",
    ttlSeconds: 60,
  });

  const expired = validateDispatchAuthToken({
    authToken: token,
    envelope: {
      protocolVersion: "1",
      sourceNodeId: "aie-node-local-default",
      targetNodeId: "aie-node-headless-default",
      taskId: "task-auth-3",
      sessionId: "session-auth-3",
    },
    now: "2026-04-21T00:02:00.000Z",
  });
  const mismatched = validateDispatchAuthToken({
    authToken: token,
    envelope: {
      protocolVersion: "1",
      sourceNodeId: "aie-node-local-default",
      targetNodeId: "aie-node-other-default",
      taskId: "task-auth-3",
      sessionId: "session-auth-3",
    },
  });

  assert.equal(expired.valid, false);
  assert.match(expired.summary, /expired/i);
  assert.equal(mismatched.valid, false);
});