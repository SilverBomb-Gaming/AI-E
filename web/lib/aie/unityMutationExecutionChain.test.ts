import assert from "node:assert/strict";
import test from "node:test";

import { buildUnityProductionPlanningPacket } from "./productionPipelineFoundation";
import {
  buildUnityMutationExecutionChainPlan,
  buildUnitySceneObjectCreationExecutionPlan,
  buildUnitySceneObjectCreationRollbackPlan,
  evaluateUnityMutationExecutionChainReadiness,
  previewUnitySceneObjectCreation,
  simulateUnityMutationExecutionPreflight,
} from "./unityProductionAdapter";

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

function createLiveValidationResult(
  overrides: Partial<NonNullable<Parameters<typeof buildUnitySceneObjectCreationExecutionPlan>[0]["live_validation_result"]>> = {},
) {
  return {
    request_id: "unity-validation-1",
    execution_kind: "real_bridge_read_only" as const,
    bridge_status: "bridge_ready" as const,
    scene_validation_status: "checked_clean" as const,
    checked_scene_name: "EnemyAIDemo",
    missing_script_count: 0,
    console_error_count: 0,
    object_count: 13,
    executed: true,
    ...overrides,
  };
}

function createPreviewInput(actionId: string, targetObjectName: string) {
  return {
    adapter_request_id: `unity-chain-plan-1:${actionId}`,
    requested_at: "2026-05-02T10:00:00.000Z",
    planning_packet: createSceneObjectCreationPacket(),
    requested_actions: [],
    review_state: {
      review_package_id: "chain-review-1",
      review_completed_at: "2026-05-02T10:00:10.000Z",
      approved_by_operator: true,
      operator_approval_id: "chain-approval-1",
      delivery_package_id: "chain-delivery-1",
    },
    dry_run: true,
    requested_object_name: targetObjectName,
    target_scene: "EnemyAIDemo",
    intended_components: ["Transform", "BoxCollider"],
    intended_transform: {
      position: { x: 4, y: 1, z: 0 },
      rotation_euler: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  };
}

function createCreationReadinessAction(
  overrides: Partial<Parameters<typeof evaluateUnityMutationExecutionChainReadiness>[0]["actions"][number]> & {
    action_id: string;
    target_object_name: string;
  },
) {
  const previewInput = createPreviewInput(overrides.action_id, overrides.target_object_name);
  const previewResult = previewUnitySceneObjectCreation(previewInput);
  const authorization = {
    final_execution_authorization_id: `final-auth-${overrides.action_id}`,
    authorized_by_operator: true,
    authorized_at: "2026-05-02T10:05:00.000Z",
    authorization_scope: "scene_object_creation_request" as const,
    target_request_id: previewResult.request_id,
    expires_at: "2026-05-02T11:00:00.000Z",
  };
  const preflightResult = simulateUnityMutationExecutionPreflight({
    ...previewInput,
    authorization,
    known_target_scene_names: ["EnemyAIDemo"],
    known_scene_object_names: ["SpawnAnchor"],
  });
  const executionPlan = buildUnitySceneObjectCreationExecutionPlan({
    ...previewInput,
    preview_result: previewResult,
    preflight_result: preflightResult,
    authorization,
    mutation_switch: {
      mutation_switch_id: `mutation-switch-${overrides.action_id}`,
      switch_enabled: true,
      enabled_by_operator: true,
      enabled_at: "2026-05-02T10:06:00.000Z",
      target_request_id: previewResult.request_id,
      allowed_mutation_type: "scene_object_creation_request",
      expires_at: "2026-05-02T11:00:00.000Z",
    },
    live_validation_result: createLiveValidationResult(),
    mutation_execution_mode_enabled: true,
  });

  return {
    action_id: overrides.action_id,
    action_type: "unity_scene_object_creation" as const,
    target_scene: "EnemyAIDemo",
    target_object_name: overrides.target_object_name,
    depends_on: [],
    required_approvals: ["chain review approval"],
    preview_result: previewResult,
    preflight_result: preflightResult,
    authorization,
    live_validation_result: createLiveValidationResult(),
    execution_plan: executionPlan,
    mutation_switch: {
      mutation_switch_id: `mutation-switch-${overrides.action_id}`,
      switch_enabled: true,
      enabled_by_operator: true,
      enabled_at: "2026-05-02T10:06:00.000Z",
      target_request_id: previewResult.request_id,
      allowed_mutation_type: "scene_object_creation_request" as const,
      expires_at: "2026-05-02T11:00:00.000Z",
    },
    mutation_execution_mode_enabled: true,
    ...overrides,
  };
}

function createRollbackReadinessAction(
  overrides: Partial<Parameters<typeof evaluateUnityMutationExecutionChainReadiness>[0]["actions"][number]> & {
    action_id: string;
    target_object_name: string;
  },
) {
  const requestId = `unity-chain-plan-1:${overrides.action_id}`;
  const authorization = {
    final_rollback_authorization_id: `rollback-auth-${overrides.action_id}`,
    authorized_by_operator: true,
    authorized_at: "2026-05-02T10:05:00.000Z",
    authorization_scope: "scene_object_removal" as const,
    target_request_id: requestId,
    target_scene: "EnemyAIDemo",
    target_object_name: overrides.target_object_name,
    expires_at: "2026-05-02T11:00:00.000Z",
  };
  const executionPlan = buildUnitySceneObjectCreationRollbackPlan({
    adapter_request_id: requestId,
    requested_at: "2026-05-02T10:00:00.000Z",
    planning_packet: createSceneObjectCreationPacket(),
    requested_actions: [],
    review_state: {
      review_package_id: "chain-review-1",
      review_completed_at: "2026-05-02T10:00:10.000Z",
      approved_by_operator: true,
      operator_approval_id: "chain-approval-1",
      delivery_package_id: "chain-delivery-1",
    },
    target_scene: "EnemyAIDemo",
    target_object_name: overrides.target_object_name,
    authorization,
    rollback_switch: {
      rollback_switch_id: `rollback-switch-${overrides.action_id}`,
      switch_enabled: true,
      enabled_by_operator: true,
      enabled_at: "2026-05-02T10:06:00.000Z",
      target_request_id: requestId,
      target_scene: "EnemyAIDemo",
      target_object_name: overrides.target_object_name,
      allowed_rollback_type: "scene_object_removal" as const,
      expires_at: "2026-05-02T11:00:00.000Z",
    },
    live_validation_result: createLiveValidationResult({ object_count: 14 }),
    rollback_execution_mode_enabled: true,
  });

  return {
    action_id: overrides.action_id,
    action_type: "unity_scene_object_rollback" as const,
    target_scene: "EnemyAIDemo",
    target_object_name: overrides.target_object_name,
    depends_on: [],
    required_approvals: ["chain review approval"],
    authorization,
    live_validation_result: createLiveValidationResult({ object_count: 14 }),
    execution_plan: executionPlan,
    rollback_switch: {
      rollback_switch_id: `rollback-switch-${overrides.action_id}`,
      switch_enabled: true,
      enabled_by_operator: true,
      enabled_at: "2026-05-02T10:06:00.000Z",
      target_request_id: requestId,
      target_scene: "EnemyAIDemo",
      target_object_name: overrides.target_object_name,
      allowed_rollback_type: "scene_object_removal" as const,
      expires_at: "2026-05-02T11:00:00.000Z",
    },
    rollback_execution_mode_enabled: true,
    ...overrides,
  };
}

function createChainReadinessInput(
  overrides: Partial<Parameters<typeof evaluateUnityMutationExecutionChainReadiness>[0]> = {},
): Parameters<typeof evaluateUnityMutationExecutionChainReadiness>[0] {
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
      createCreationReadinessAction({
        action_id: "create-probe",
        target_object_name: "AIE_ControlledMutationProbe",
      }),
      createRollbackReadinessAction({
        action_id: "rollback-probe",
        target_object_name: "AIE_ControlledMutationProbe",
        depends_on: ["create-probe"],
      }),
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

test("multi-action Unity chain readiness stays not ready when no gates are present", () => {
  const result = evaluateUnityMutationExecutionChainReadiness(createChainReadinessInput({
    review_state: {
      review_package_id: null,
      review_completed_at: null,
      approved_by_operator: false,
      operator_approval_id: null,
      delivery_package_id: "chain-delivery-1",
    },
    actions: [
      {
        action_id: "create-probe",
        action_type: "unity_scene_object_creation",
        target_scene: "EnemyAIDemo",
        target_object_name: "AIE_ControlledMutationProbe",
        depends_on: [],
        required_approvals: [],
      },
    ],
  }));

  assert.equal(result.chain_readiness, "not_ready");
  assert.equal(result.execution_kind, "chain_readiness_blocked");
  assert.deepEqual(result.ready_actions, []);
  assert.deepEqual(result.blocked_actions, ["create-probe"]);
  assert.ok(result.missing_gates.includes("create-probe:review_approval"));
  assert.ok(result.missing_gates.includes("create-probe:execution_plan"));
  assert.equal(result.executed, false);
});

test("multi-action Unity chain readiness becomes partially ready when one action is eligible and one is blocked", () => {
  const result = evaluateUnityMutationExecutionChainReadiness(createChainReadinessInput({
    actions: [
      createCreationReadinessAction({
        action_id: "create-ready",
        target_object_name: "AIE_ControlledMutationProbe",
      }),
      createCreationReadinessAction({
        action_id: "create-blocked",
        target_object_name: "AIE_ControlledMutationProbe",
        mutation_switch: null,
      }),
    ],
  }));

  assert.equal(result.chain_readiness, "partially_ready");
  assert.deepEqual(result.ready_actions, ["create-ready"]);
  assert.deepEqual(result.blocked_actions, ["create-blocked"]);
  assert.ok(result.missing_gates.includes("create-blocked:final_mutation_switch"));
  assert.equal(result.chain_ready, false);
  assert.equal(result.executed, false);
});

test("multi-action Unity chain readiness marks all actions ready when dependencies and gates are satisfied", () => {
  const result = evaluateUnityMutationExecutionChainReadiness(createChainReadinessInput());

  assert.equal(result.chain_readiness, "ready_for_operator_execution");
  assert.equal(result.execution_kind, "chain_readiness_only");
  assert.equal(result.chain_ready, true);
  assert.deepEqual(result.ready_actions, ["create-probe", "rollback-probe"]);
  assert.deepEqual(result.blocked_actions, []);
  assert.deepEqual(result.dependency_blocked_actions, []);
  assert.equal(result.executed, false);
  assert.match(result.review_package?.summary ?? "", /CHAIN READINESS ONLY/i);
  assert.match(result.review_package?.summary ?? "", /NO ACTIONS EXECUTED/i);
});

test("multi-action Unity chain readiness blocks downstream actions when a dependency is not eligible", () => {
  const result = evaluateUnityMutationExecutionChainReadiness(createChainReadinessInput({
    actions: [
      createCreationReadinessAction({
        action_id: "create-probe",
        target_object_name: "AIE_ControlledMutationProbe",
        mutation_switch: null,
      }),
      createRollbackReadinessAction({
        action_id: "rollback-probe",
        target_object_name: "AIE_ControlledMutationProbe",
        depends_on: ["create-probe"],
      }),
    ],
  }));

  assert.equal(result.chain_readiness, "not_ready");
  assert.deepEqual(result.dependency_blocked_actions, ["rollback-probe"]);
  assert.deepEqual(result.ready_actions, []);
  assert.deepEqual(result.blocked_actions, ["create-probe", "rollback-probe"]);
  assert.ok(result.ordered_actions.find((action) => action.action_id === "rollback-probe")?.gate_statuses.some((gate) => gate.status === "dependency_blocked"));
});

test("multi-action Unity chain readiness keeps unsupported action types blocked", () => {
  const result = evaluateUnityMutationExecutionChainReadiness(createChainReadinessInput({
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
  }));

  assert.equal(result.chain_status, "chain_blocked");
  assert.equal(result.chain_readiness, "not_ready");
  assert.equal(result.execution_kind, "chain_readiness_blocked");
  assert.equal(result.total_actions, 0);
  assert.match(result.blocked_reason ?? "", /unsupported action type/i);
});

test("multi-action Unity chain readiness never executes Unity actions", () => {
  const result = evaluateUnityMutationExecutionChainReadiness(createChainReadinessInput());

  assert.equal(result.executed, false);
  assert.ok(result.ordered_actions.every((action) => action.executed === false));
  assert.equal(result.delivery_package?.proof_results.includes("NO ACTIONS EXECUTED"), true);
});