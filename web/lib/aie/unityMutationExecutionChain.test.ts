import assert from "node:assert/strict";
import test from "node:test";

import { buildUnityProductionPlanningPacket } from "./productionPipelineFoundation";
import { buildUnityMutationExecutionChainPlan } from "./unityProductionAdapter";

function createSceneObjectCreationPacket() {
  const packet = buildUnityProductionPlanningPacket(
    "prepare a controlled Unity scene object mutation plan for the EnemyAIDemo scene",
    "review",
    ["unity-integration"],
  );

  if (!packet) {
    throw new Error("Expected Unity scene object creation planning packet.");
  }

  return {
    ...packet,
    request_types: ["scene_object_creation_request"] as const,
    requests: packet.requests.filter((request) => request.request_type === "scene_object_creation_request"),
    required_review_artifacts: ["scene object creation preview", "mutation rollback plan", "multi-action chain preview"],
    required_approval_gates: [
      "operator planning approval",
      "review package approval",
      "operator approval",
      "dry-run preview approval",
      "explicit final execute gate",
    ],
  };
}

function createChainInput(
  overrides: Partial<Parameters<typeof buildUnityMutationExecutionChainPlan>[0]> = {},
): Parameters<typeof buildUnityMutationExecutionChainPlan>[0] {
  return {
    adapter_request_id: "unity-chain-plan-1",
    requested_at: "2026-05-02T10:00:00.000Z",
    chain_id: "unity-controlled-chain-1",
    planning_packet: createSceneObjectCreationPacket(),
    requested_actions: [],
    review_state: {
      review_package_id: "chain-review-1",
      review_completed_at: "2026-05-02T10:00:10.000Z",
      approved_by_operator: true,
      operator_approval_id: "chain-approval-1",
      delivery_package_id: "chain-delivery-1",
    },
    actions: [
      {
        action_id: "rollback-probe",
        action_type: "unity_scene_object_rollback",
        target_scene: "EnemyAIDemo",
        target_object_name: "AIE_ControlledMutationProbe",
        depends_on: ["create-probe"],
        required_approvals: ["chain review approval"],
      },
      {
        action_id: "create-probe",
        action_type: "unity_scene_object_creation",
        target_scene: "EnemyAIDemo",
        target_object_name: "AIE_ControlledMutationProbe",
        depends_on: [],
        required_approvals: ["chain review approval"],
      },
    ],
    ...overrides,
  };
}

test("multi-action Unity chain plan validates dependencies and previews rollback order", () => {
  const result = buildUnityMutationExecutionChainPlan(createChainInput());

  assert.equal(result.chain_status, "chain_planned");
  assert.equal(result.execution_kind, "chain_plan_only");
  assert.equal(result.chain_ready, false);
  assert.equal(result.executed, false);
  assert.equal(result.dry_run, true);
  assert.deepEqual(result.ordered_actions.map((action) => action.action_id), ["create-probe", "rollback-probe"]);
  assert.deepEqual(result.action_dependencies, [
    { action_id: "create-probe", depends_on: [] },
    { action_id: "rollback-probe", depends_on: ["create-probe"] },
  ]);
  assert.deepEqual(result.rollback_order, ["rollback-probe", "create-probe"]);
  assert.deepEqual(result.rollback_plan.map((entry) => entry.rollback_action_type), [
    "unity_scene_object_creation",
    "unity_scene_object_rollback",
  ]);
  assert.deepEqual(result.executable_actions, ["create-probe", "rollback-probe"]);
  assert.deepEqual(result.blocked_actions, []);
  assert.ok(result.required_approvals.includes("final mutation switch enablement"));
  assert.ok(result.required_approvals.includes("explicit final rollback authorization"));
  assert.ok(result.review_package);
  assert.ok(result.delivery_package);
  assert.match(result.review_package?.summary ?? "", /CHAIN PLAN ONLY/i);
});

test("multi-action Unity chain plan refuses unsupported action types", () => {
  const result = buildUnityMutationExecutionChainPlan({
    ...createChainInput(),
    actions: [
      {
        action_id: "unsupported-action",
        action_type: "unity_scene_asset_import" as never,
        target_scene: "EnemyAIDemo",
        target_object_name: "AIE_ControlledMutationProbe",
        depends_on: [],
        required_approvals: [],
      },
    ],
  });

  assert.equal(result.chain_status, "chain_blocked");
  assert.equal(result.execution_kind, "chain_plan_blocked");
  assert.match(result.blocked_reason ?? "", /unsupported action type/i);
  assert.equal(result.total_actions, 0);
  assert.equal(result.executed, false);
});

test("multi-action Unity chain plan refuses cyclic dependency graphs", () => {
  const result = buildUnityMutationExecutionChainPlan(createChainInput({
    actions: [
      {
        action_id: "create-probe",
        action_type: "unity_scene_object_creation",
        target_scene: "EnemyAIDemo",
        target_object_name: "AIE_ControlledMutationProbe",
        depends_on: ["rollback-probe"],
        required_approvals: [],
      },
      {
        action_id: "rollback-probe",
        action_type: "unity_scene_object_rollback",
        target_scene: "EnemyAIDemo",
        target_object_name: "AIE_ControlledMutationProbe",
        depends_on: ["create-probe"],
        required_approvals: [],
      },
    ],
  }));

  assert.equal(result.chain_status, "chain_blocked");
  assert.equal(result.execution_kind, "chain_plan_blocked");
  assert.match(result.blocked_reason ?? "", /cyclic dependency graph/i);
  assert.deepEqual(result.rollback_order, []);
});

test("multi-action Unity chain plan stays blocked when review approval is missing", () => {
  const result = buildUnityMutationExecutionChainPlan(createChainInput({
    review_state: {
      review_package_id: null,
      review_completed_at: null,
      approved_by_operator: false,
      operator_approval_id: null,
      delivery_package_id: "chain-delivery-1",
    },
  }));

  assert.equal(result.chain_status, "chain_blocked");
  assert.equal(result.execution_kind, "chain_plan_blocked");
  assert.deepEqual(result.blocked_actions, ["create-probe", "rollback-probe"]);
  assert.match(result.blocked_reason ?? "", /plan-only/i);
  assert.equal(result.review_approval_status, "missing");
  assert.equal(result.operator_approval_status, "missing");
});