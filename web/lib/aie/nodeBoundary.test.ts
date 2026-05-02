import assert from "node:assert/strict";
import test from "node:test";

import { receiveNodeIntent, validateNodeIntentEnvelope, type NodeIntentEnvelope } from "./nodeBoundary";

function createEnvelope(overrides: Partial<NodeIntentEnvelope> = {}): NodeIntentEnvelope {
  return {
    source: "aie_node",
    node_id: "node-alpha",
    intent_id: "intent-001",
    requested_at: "2026-05-02T15:00:00.000Z",
    operator_visible_summary: "Node asks for a reviewed bounded Unity execution request.",
    intent_kind: "execution_request",
    payload: {
      objective: "Request reviewed execution of the bounded verified Unity lane after manual approval.",
      requested_execution_path: "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control",
      requested_stage: "strategy",
    },
    permissions: {
      can_execute: false,
      can_approve: false,
      can_rollback: false,
    },
    ...overrides,
  };
}

test("valid Node execution request is accepted for review only", () => {
  const result = receiveNodeIntent(createEnvelope());

  assert.equal(result.status, "accepted_for_review");
  assert.equal(result.review_status, "pending_review");
  assert.equal(result.node_can_execute, false);
  assert.equal(result.mutating, false);
  assert.equal(result.unity_access, "blocked");
  assert.match(result.reason, /reviewable input only/i);
  assert.deepEqual(result.evidence_labels, [
    "NODE INTENT RECEIVED",
    "NODE BOUNDARY CHECK PASSED",
    "NODE INTENT ACCEPTED FOR REVIEW",
  ]);
});

test("valid Node validation request is accepted for review only", () => {
  const result = receiveNodeIntent(createEnvelope({
    intent_kind: "validation_request",
    operator_visible_summary: "Node asks for bounded validation feedback only.",
    payload: {
      objective: "Request validation feedback for the verified EnemyAIDemo lane.",
      requested_execution_path: "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control",
      requested_stage: "strategy",
    },
  }));

  assert.equal(result.status, "accepted_for_review");
  assert.equal(result.accepted_intent_kind, "validation_request");
  assert.equal(result.node_can_execute, false);
  assert.equal(result.rollback_triggered, false);
});

test("Node direct execution request is rejected", () => {
  const result = receiveNodeIntent(createEnvelope({
    payload: {
      objective: "Execute now.",
      action: "unity_scene_object_creation",
      target_scene: "EnemyAIDemo",
    },
  }));

  assert.equal(result.status, "rejected_boundary_violation");
  assert.equal(result.mutating, false);
  assert.equal(result.node_can_execute, false);
  assert.ok(result.evidence_labels.includes("NODE DIRECT EXECUTION BLOCKED"));
  assert.match(result.reason, /direct execution|unity mutation/i);
});

test("Node direct rollback request is rejected", () => {
  const result = receiveNodeIntent(createEnvelope({
    payload: {
      objective: "Run rollback immediately.",
      action: "manual_rollback",
      rollback_target: "AIE_ControlledMutationProbe",
    },
  }));

  assert.equal(result.status, "rejected_boundary_violation");
  assert.equal(result.rollback_triggered, false);
  assert.ok(result.evidence_labels.includes("NODE DIRECT ROLLBACK BLOCKED"));
  assert.match(result.reason, /direct rollback|manual-only/i);
});

test("Node approval attempt is rejected", () => {
  const validation = validateNodeIntentEnvelope(createEnvelope({
    permissions: {
      can_execute: false,
      can_approve: true as never,
      can_rollback: false,
    },
  }));

  assert.equal(validation.ok, false);
  assert.equal(validation.category, "boundary_violation");
  assert.match(validation.reason ?? "", /cannot execute, approve, or rollback/i);
});

test("Node intent cannot bypass Strategy Planning Review Delivery or Studio Control", () => {
  const result = receiveNodeIntent(createEnvelope({
    payload: {
      objective: "Request a non-standard shortened route.",
      requested_execution_path: "Strategy -> Planning -> Review",
      requested_stage: "execution",
    },
  }));

  assert.equal(result.status, "rejected_boundary_violation");
  assert.match(result.reason, /bypasses the required Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control path/i);
});

test("accepted Node intent does not mutate Unity", () => {
  const result = receiveNodeIntent(createEnvelope());

  assert.equal(result.status, "accepted_for_review");
  assert.equal(result.mutating, false);
  assert.equal(result.unity_access, "blocked");
});

test("accepted Node intent does not trigger rollback", () => {
  const result = receiveNodeIntent(createEnvelope({ intent_kind: "status_request" }));

  assert.equal(result.status, "accepted_for_review");
  assert.equal(result.rollback_triggered, false);
  assert.equal(result.node_can_rollback, false);
});

test("evidence clearly explains accept and reject reason", () => {
  const accepted = receiveNodeIntent(createEnvelope());
  const rejected = receiveNodeIntent(createEnvelope({
    payload: {
      objective: "Run rollback immediately.",
      action: "manual_rollback",
    },
  }));

  assert.match(accepted.reason, /reviewable input only/i);
  assert.deepEqual(accepted.evidence_labels, [
    "NODE INTENT RECEIVED",
    "NODE BOUNDARY CHECK PASSED",
    "NODE INTENT ACCEPTED FOR REVIEW",
  ]);
  assert.match(rejected.reason, /rollback/i);
  assert.ok(rejected.evidence_labels.includes("NODE BOUNDARY CHECK FAILED"));
  assert.ok(rejected.evidence_labels.includes("NODE DIRECT ROLLBACK BLOCKED"));
});