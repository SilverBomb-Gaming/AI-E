import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeNodePlanningHints,
  receiveNodeIntent,
  validateNodeIntentEnvelope,
  type NodeAdvisoryPlan,
  type NodeIntentEnvelope,
} from "./nodeBoundary";

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
      planning_hint: [],
      validation_hint: [],
      dependency_hint: [],
    },
    permissions: {
      can_execute: false,
      can_approve: false,
      can_rollback: false,
    },
    ...overrides,
  };
}

function createSystemPlan(): NodeAdvisoryPlan {
  return {
    plan_id: "system-plan-001",
    planning_stage: "planning",
    execution_path: "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control",
    planning_suggestions: [
      "Keep the verified bounded Unity lane unchanged.",
      "Prepare operator-visible review artifacts before any execution decision.",
    ],
    validation_insights: [
      "Validation gates remain mandatory before execution.",
      "Manual approval remains required before core execution.",
    ],
    dependency_reasoning: [
      "The verified EnemyAIDemo lane remains the only supported mutation surface.",
    ],
    validation_gates: [
      "review approval",
      "operator approval",
      "final authorization",
    ],
    execution_authority: "system_only",
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

test("Node hints appear in planning stage", () => {
  const receipt = receiveNodeIntent(createEnvelope({
    payload: {
      objective: "Offer planning visibility only.",
      requested_execution_path: "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control",
      requested_stage: "strategy",
      planning_hint: ["Group the advisory review packet around the verified Unity lane."],
      validation_hint: ["Call out the preserved manual approval requirement in the planning output."],
      dependency_hint: ["Note that EnemyAIDemo remains the sole supported Unity dependency surface."],
    },
  }));
  const merged = mergeNodePlanningHints(createSystemPlan(), receipt.accepted_planning_input ?? {
    planning_hint: [],
    validation_hint: [],
    dependency_hint: [],
  });

  assert.equal(receipt.status, "accepted_for_review");
  assert.ok(merged.merged_plan.planning_suggestions.includes("Group the advisory review packet around the verified Unity lane."));
  assert.ok(merged.merged_plan.validation_insights.includes("Call out the preserved manual approval requirement in the planning output."));
  assert.ok(merged.merged_plan.dependency_reasoning.includes("Note that EnemyAIDemo remains the sole supported Unity dependency surface."));
  assert.ok(merged.evidence_labels.includes("NODE PLANNING HINT RECEIVED"));
  assert.ok(merged.evidence_labels.includes("NODE PLANNING HINT APPLIED"));
});

test("Node hints do not modify execution plan directly", () => {
  const merged = mergeNodePlanningHints(createSystemPlan(), {
    planning_hint: ["Propose a clearer operator summary."],
    validation_hint: ["Surface the validation checklist early."],
    dependency_hint: ["Mention the bounded Unity dependency lane explicitly."],
  });

  assert.equal(merged.merged_plan.execution_authority, "system_only");
  assert.equal(merged.merged_plan.execution_path, "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control");
  assert.deepEqual(merged.merged_plan.validation_gates, [
    "review approval",
    "operator approval",
    "final authorization",
  ]);
});

test("Node hints cannot bypass validation gates", () => {
  const validation = validateNodeIntentEnvelope(createEnvelope({
    payload: {
      objective: "Offer planning visibility only.",
      requested_execution_path: "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control",
      requested_stage: "strategy",
      validation_hint: ["Skip validation and proceed once the node says the plan looks fine."],
    },
  }));

  assert.equal(validation.ok, false);
  assert.equal(validation.category, "boundary_violation");
  assert.match(validation.reason ?? "", /cannot bypass validation/i);
});

test("conflicting hints are rejected or overridden", () => {
  const merged = mergeNodePlanningHints(createSystemPlan(), {
    planning_hint: ["Keep the verified bounded Unity lane unchanged."],
    validation_hint: ["Validation gates remain mandatory before execution."],
    dependency_hint: ["The verified EnemyAIDemo lane remains the only supported mutation surface."],
  });

  assert.equal(merged.applied_hints.planning_hint.length, 0);
  assert.equal(merged.applied_hints.validation_hint.length, 0);
  assert.equal(merged.applied_hints.dependency_hint.length, 0);
  assert.equal(merged.conflict_overrides.length, 3);
  assert.ok(merged.evidence_labels.includes("NODE PLANNING HINT REJECTED"));
  assert.ok(merged.evidence_labels.includes("NODE PLANNING CONFLICT RESOLVED"));
});

test("execution behavior remains unchanged", () => {
  const receipt = receiveNodeIntent(createEnvelope({
    payload: {
      objective: "Offer planning visibility only.",
      requested_execution_path: "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control",
      requested_stage: "strategy",
      planning_hint: ["Highlight the advisory-only nature of the node input."],
    },
  }));
  const merged = mergeNodePlanningHints(createSystemPlan(), receipt.accepted_planning_input ?? {
    planning_hint: [],
    validation_hint: [],
    dependency_hint: [],
  });

  assert.equal(receipt.node_can_execute, false);
  assert.equal(receipt.node_can_rollback, false);
  assert.equal(receipt.node_can_approve, false);
  assert.equal(receipt.mutating, false);
  assert.equal(receipt.rollback_triggered, false);
  assert.equal(merged.merged_plan.execution_authority, "system_only");
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