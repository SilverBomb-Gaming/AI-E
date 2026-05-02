import assert from "node:assert/strict";
import test from "node:test";

import { buildUnityProductionPlanningPacket } from "./productionPipelineFoundation";
import {
  buildUnityMutationExecutionChainPlan,
  buildUnitySceneObjectCreationExecutionPlan,
  buildUnitySceneObjectCreationRollbackPlan,
  classifyUnityChainFailureEvidence,
  evaluateUnityMutationExecutionChainReadiness,
  executePlannedUnityRollbackFromChain,
  executeUnityMutationExecutionChain,
  previewUnitySceneObjectCreation,
  simulateUnityMutationExecutionPreflight,
} from "./unityProductionAdapter";
import type { UnityReadOnlyRuntimeBridge } from "./unityReadOnlyRuntimeBridge";

const PRIMARY_CHAIN_OBJECT_NAME = "AIE_ControlledMutationProbe";
const COMPANION_CHAIN_OBJECT_NAME = "AIE_ControlledMutationProbe_Companion";

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

function createTrackedStateSnapshot(input: {
  objectCount: number;
  targetExists?: boolean;
  missingScripts?: number;
  consoleErrors?: number;
  timestamp?: string;
  trackedObjects?: Array<{
    name: string;
    exists: boolean;
    type?: string;
  }>;
}) {
  return {
    bridge_status: "bridge_ready" as const,
    source: "command_probe" as const,
    scene_validation_status: (input.missingScripts ?? 0) > 0 || (input.consoleErrors ?? 0) > 0
      ? "checked_with_findings" as const
      : "checked_clean" as const,
    missing_script_count: input.missingScripts ?? 0,
    console_error_count: input.consoleErrors ?? 0,
    object_count: input.objectCount,
    checked_scene_name: "EnemyAIDemo",
    tracked_objects: (input.trackedObjects ?? [
      {
        name: PRIMARY_CHAIN_OBJECT_NAME,
        type: "GameObject",
        exists: input.targetExists ?? false,
      },
    ]).map((trackedObject) => ({
      name: trackedObject.name,
      type: trackedObject.type ?? "GameObject",
      exists: trackedObject.exists,
    })),
    evidence_timestamp: input.timestamp ?? "2026-05-05T10:00:00.000Z",
    raw_evidence_summary: null,
    summary: "Tracked state snapshot.",
    recommended_next_operator_action: "Review tracked state.",
  };
}

function createSequencedRuntimeBridge(states: Array<ReturnType<typeof createTrackedStateSnapshot>>): UnityReadOnlyRuntimeBridge {
  let index = 0;

  return {
    async probeValidation() {
      const state = states[Math.min(index, states.length - 1)]!;
      index += 1;
      return state;
    },
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

function createChainExecutionInput(
  overrides: Partial<Parameters<typeof executeUnityMutationExecutionChain>[0]> = {},
): Parameters<typeof executeUnityMutationExecutionChain>[0] {
  const readinessInput = createChainReadinessInput(overrides);
  const readinessResult = overrides.readiness_result ?? evaluateUnityMutationExecutionChainReadiness(readinessInput);

  return {
    adapter_request_id: "unity-chain-execution-1",
    requested_at: "2026-05-02T10:30:00.000Z",
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
    actions: readinessInput.actions,
    readiness_result: readinessResult,
    ...overrides,
  };
}

function createMultiCreateChainReadinessInput(
  overrides: Partial<Parameters<typeof evaluateUnityMutationExecutionChainReadiness>[0]> = {},
): Parameters<typeof evaluateUnityMutationExecutionChainReadiness>[0] {
  return createChainReadinessInput({
    actions: [
      createCreationReadinessAction({
        action_id: "create-probe",
        target_object_name: PRIMARY_CHAIN_OBJECT_NAME,
      }),
      createCreationReadinessAction({
        action_id: "create-probe-companion",
        target_object_name: COMPANION_CHAIN_OBJECT_NAME,
        depends_on: ["create-probe"],
      }),
    ],
    ...overrides,
  });
}

function createMultiCreateChainExecutionInput(
  overrides: Partial<Parameters<typeof executeUnityMutationExecutionChain>[0]> = {},
): Parameters<typeof executeUnityMutationExecutionChain>[0] {
  const readinessInput = createMultiCreateChainReadinessInput(overrides);
  const readinessResult = overrides.readiness_result ?? evaluateUnityMutationExecutionChainReadiness(readinessInput);

  return {
    adapter_request_id: "unity-chain-execution-multi-create-1",
    requested_at: "2026-05-02T10:30:00.000Z",
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
    actions: readinessInput.actions,
    readiness_result: readinessResult,
    ...overrides,
  };
}

function createFailureSimulation(
  overrides: Partial<NonNullable<Parameters<typeof executeUnityMutationExecutionChain>[0]["failure_simulation"]>> & {
    target_action_id: string;
    failure_kind: NonNullable<Parameters<typeof executeUnityMutationExecutionChain>[0]["failure_simulation"]>["failure_kind"];
  },
) {
  return {
    failure_simulation_id: `failure-simulation-${overrides.target_action_id}`,
    enabled: true,
    target_action_id: overrides.target_action_id,
    failure_kind: overrides.failure_kind,
    enabled_by_operator: true,
    enabled_at: "2026-05-04T10:00:00.000Z",
    expires_at: "2026-05-04T11:00:00.000Z",
    ...overrides,
  };
}

function createRollbackExecutionReviewState(
  overrides: Partial<Parameters<typeof executePlannedUnityRollbackFromChain>[0]["review_state"]> = {},
): Parameters<typeof executePlannedUnityRollbackFromChain>[0]["review_state"] {
  return {
    review_package_id: "rollback-review-1",
    review_completed_at: "2026-05-03T12:15:00.000Z",
    approved_by_operator: true,
    operator_approval_id: "rollback-approval-1",
    delivery_package_id: "rollback-delivery-1",
    ...overrides,
  };
}

function createPlannedRollbackActionInput(
  overrides: Partial<Parameters<typeof executePlannedUnityRollbackFromChain>[0]["rollback_actions"][number]> & {
    source_action_id: string;
  },
) {
  const rollbackRequestId = overrides.rollback_request_id ?? `unity-chain-rollback-1:${overrides.source_action_id}`;
  const reviewState = createRollbackExecutionReviewState();
  const authorization = overrides.authorization ?? {
    final_rollback_authorization_id: `manual-rollback-auth-${overrides.source_action_id}`,
    authorized_by_operator: true,
    authorized_at: "2026-05-03T12:16:00.000Z",
    authorization_scope: "scene_object_removal" as const,
    target_request_id: rollbackRequestId,
    target_scene: overrides.target_scene ?? "EnemyAIDemo",
    target_object_name: overrides.target_object_name ?? "AIE_ControlledMutationProbe",
    expires_at: "2026-05-03T13:00:00.000Z",
  };
  const rollbackSwitch = overrides.rollback_switch ?? {
    rollback_switch_id: `manual-rollback-switch-${overrides.source_action_id}`,
    switch_enabled: true,
    enabled_by_operator: true,
    enabled_at: "2026-05-03T12:17:00.000Z",
    target_request_id: rollbackRequestId,
    target_scene: overrides.target_scene ?? "EnemyAIDemo",
    target_object_name: overrides.target_object_name ?? "AIE_ControlledMutationProbe",
    allowed_rollback_type: "scene_object_removal" as const,
    expires_at: "2026-05-03T13:00:00.000Z",
  };
  const executionPlan = overrides.execution_plan ?? buildUnitySceneObjectCreationRollbackPlan({
    adapter_request_id: rollbackRequestId,
    requested_at: "2026-05-03T12:18:00.000Z",
    planning_packet: createSceneObjectCreationPacket(),
    requested_actions: [],
    review_state: reviewState,
    target_scene: overrides.target_scene ?? "EnemyAIDemo",
    target_object_name: overrides.target_object_name ?? "AIE_ControlledMutationProbe",
    authorization,
    rollback_switch: rollbackSwitch,
    live_validation_result: overrides.live_validation_result ?? createLiveValidationResult({ object_count: 14 }),
    rollback_execution_mode_enabled: overrides.rollback_execution_mode_enabled ?? true,
  });

  return {
    source_action_id: overrides.source_action_id,
    rollback_request_id: rollbackRequestId,
    rollback_action_type: "unity_scene_object_removal" as const,
    target_scene: overrides.target_scene ?? "EnemyAIDemo",
    target_object_name: overrides.target_object_name ?? "AIE_ControlledMutationProbe",
    authorization,
    live_validation_result: overrides.live_validation_result ?? createLiveValidationResult({ object_count: 14 }),
    execution_plan: executionPlan,
    rollback_switch: rollbackSwitch,
    rollback_execution_mode_enabled: overrides.rollback_execution_mode_enabled ?? true,
    ...overrides,
  };
}

function createPlannedRollbackExecutionInput(
  sourceExecutionResult: Awaited<ReturnType<typeof executeUnityMutationExecutionChain>>,
  overrides: Partial<Parameters<typeof executePlannedUnityRollbackFromChain>[0]> = {},
): Parameters<typeof executePlannedUnityRollbackFromChain>[0] {
  return {
    adapter_request_id: "unity-chain-manual-rollback-1",
    requested_at: "2026-05-03T12:20:00.000Z",
    planning_packet: createSceneObjectCreationPacket(),
    requested_actions: [],
    review_state: createRollbackExecutionReviewState(),
    chain_id: sourceExecutionResult.chain_id,
    rollback_plan: sourceExecutionResult.rollback_plan,
    source_execution_result: sourceExecutionResult,
    rollback_actions: [
      createPlannedRollbackActionInput({ source_action_id: "create-probe" }),
    ],
    ...overrides,
  };
}

async function createPartialFailureChainExecutionResult() {
  return executeUnityMutationExecutionChain(createChainExecutionInput(), {
    runtime_bridge: createSequencedRuntimeBridge([
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 14, targetExists: true }),
      createTrackedStateSnapshot({ objectCount: 14, targetExists: true }),
      createTrackedStateSnapshot({ objectCount: 14, targetExists: true }),
    ]),
    mutation_bridge: {
      async executeSceneObjectCreation(input) {
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          mutation_status: "mutation_executed" as const,
          mutation_type: "scene_object_creation_request" as const,
          target_scene: input.target_scene,
          object_name: input.object_name,
          created_object_name: input.object_name,
          scene_saved: true,
          duplicate_handling: "created" as const,
          evidence_timestamp: "2026-05-03T12:21:00.000Z",
          raw_evidence_summary: "Controlled Unity mutation created the probe object.",
          summary: "Controlled Unity mutation created object AIE_ControlledMutationProbe in EnemyAIDemo with scene_saved true.",
          rollback_hint: "Rollback requires separate approval.",
          recommended_next_operator_action: "Review controlled mutation evidence.",
        };
      },
      async executeSceneObjectRemoval() {
        return {
          bridge_status: "bridge_failure" as const,
          source: "command_probe" as const,
          reason: "Unity rollback bridge reported a controlled failure.",
          evidence_timestamp: "2026-05-03T12:22:00.000Z",
          raw_evidence_summary: "Controlled Unity rollback failed.",
          recommended_next_operator_action: "Investigate the rollback failure.",
        };
      },
    },
  });
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

test("controlled Unity chain execution runs the bounded create then rollback sequence", async () => {
  const calls: string[] = [];
  const result = await executeUnityMutationExecutionChain(createChainExecutionInput(), {
    runtime_bridge: createSequencedRuntimeBridge([
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false, timestamp: "2026-05-03T12:00:00.000Z" }),
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false, timestamp: "2026-05-03T12:00:10.000Z" }),
      createTrackedStateSnapshot({ objectCount: 14, targetExists: true, timestamp: "2026-05-03T12:01:10.000Z" }),
      createTrackedStateSnapshot({ objectCount: 14, targetExists: true, timestamp: "2026-05-03T12:01:20.000Z" }),
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false, timestamp: "2026-05-03T12:02:10.000Z" }),
    ]),
    mutation_bridge: {
      async executeSceneObjectCreation(input) {
        calls.push(`create:${input.object_name}`);
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          mutation_status: "mutation_executed" as const,
          mutation_type: "scene_object_creation_request" as const,
          target_scene: input.target_scene,
          object_name: input.object_name,
          created_object_name: input.object_name,
          scene_saved: true,
          duplicate_handling: "created" as const,
          evidence_timestamp: "2026-05-03T12:01:00.000Z",
          raw_evidence_summary: "Controlled Unity mutation created the probe object.",
          summary: "Controlled Unity mutation created object AIE_ControlledMutationProbe in EnemyAIDemo with scene_saved true.",
          rollback_hint: "Rollback requires separate approval.",
          recommended_next_operator_action: "Review controlled mutation evidence.",
        };
      },
      async executeSceneObjectRemoval(input) {
        calls.push(`rollback:${input.object_name}`);
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          rollback_status: "rollback_executed" as const,
          rollback_type: "scene_object_removal" as const,
          target_scene: input.target_scene,
          object_name: input.object_name,
          removed_object_name: input.object_name,
          scene_saved: true,
          target_missing_handling: "removed" as const,
          evidence_timestamp: "2026-05-03T12:02:00.000Z",
          raw_evidence_summary: "Controlled Unity rollback removed the probe object.",
          summary: "Controlled Unity rollback removed target AIE_ControlledMutationProbe in EnemyAIDemo with scene_saved true.",
          recommended_next_operator_action: "Review controlled rollback evidence.",
        };
      },
    },
  });

  assert.deepEqual(calls, ["create:AIE_ControlledMutationProbe", "rollback:AIE_ControlledMutationProbe"]);
  assert.equal(result.execution_status, "success");
  assert.equal(result.execution_kind, "chain_execution_executed");
  assert.equal(result.actions_executed_count, 2);
  assert.equal(result.actions_failed_count, 0);
  assert.equal(result.executed, true);
  assert.equal(result.per_action_results.length, 2);
  assert.equal(result.state_snapshots.length, 5);
  assert.equal(result.failure_handling_status, "none_required");
  assert.equal(result.failure_classification, "none");
  assert.equal(result.failed_action_id, null);
  assert.deepEqual(result.successful_action_ids, ["create-probe", "rollback-probe"]);
  assert.equal(result.rollback_plan_required, false);
  assert.equal(result.rollback_plan, null);
  assert.equal(result.manual_review_required, false);
  assert.equal(result.final_scene_state.object_count_before, 13);
  assert.equal(result.final_scene_state.object_count_after, 13);
  assert.equal(result.final_scene_state.object_count_delta, 0);
  assert.match(result.final_scene_state.summary, /13 to 13/i);
  assert.ok(result.delivery_package?.proof_results.includes("STATE SNAPSHOT CAPTURED"));
  assert.ok(result.delivery_package?.proof_results.includes("PRE-ACTION STATE GATE PASSED"));
  assert.ok(result.delivery_package?.proof_results.includes("POST-ACTION STATE VERIFIED"));
});

test("controlled Unity chain execution runs the bounded create then create sequence", async () => {
  const calls: string[] = [];
  const result = await executeUnityMutationExecutionChain(createMultiCreateChainExecutionInput(), {
    runtime_bridge: createSequencedRuntimeBridge([
      createTrackedStateSnapshot({
        objectCount: 13,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: false },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 13,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: false },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 14,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: true },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 14,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: true },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 15,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: true },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: true },
        ],
      }),
    ]),
    mutation_bridge: {
      async executeSceneObjectCreation(input) {
        calls.push(`create:${input.object_name}`);
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          mutation_status: "mutation_executed" as const,
          mutation_type: "scene_object_creation_request" as const,
          target_scene: input.target_scene,
          object_name: input.object_name,
          created_object_name: input.object_name,
          scene_saved: true,
          duplicate_handling: "created" as const,
          evidence_timestamp: "2026-05-04T10:01:00.000Z",
          raw_evidence_summary: `Controlled Unity mutation created ${input.object_name}.`,
          summary: `Controlled Unity mutation created object ${input.object_name} in EnemyAIDemo with scene_saved true.`,
          rollback_hint: "Rollback requires separate approval.",
          recommended_next_operator_action: "Review controlled mutation evidence.",
        };
      },
      async executeSceneObjectRemoval() {
        throw new Error("should not execute rollback during the bounded create/create sequence");
      },
    },
  });

  assert.deepEqual(calls, [
    `create:${PRIMARY_CHAIN_OBJECT_NAME}`,
    `create:${COMPANION_CHAIN_OBJECT_NAME}`,
  ]);
  assert.equal(result.execution_status, "success");
  assert.equal(result.actions_executed_count, 2);
  assert.equal(result.actions_failed_count, 0);
  assert.deepEqual(result.successful_action_ids, ["create-probe", "create-probe-companion"]);
  assert.equal(result.failure_classification, "none");
  assert.equal(result.rollback_plan_required, false);
  assert.equal(result.final_scene_state.object_count_before, 13);
  assert.equal(result.final_scene_state.object_count_after, 15);
  assert.equal(result.final_scene_state.object_count_delta, 2);
  assert.equal(result.state_snapshots.filter((snapshot) => snapshot.stage === "after_action").length, 2);
});

test("terminal stop after two successful creates generates a reverse-ordered rollback plan for both objects", async () => {
  const calls: string[] = [];
  const result = await executeUnityMutationExecutionChain(createMultiCreateChainExecutionInput({
    failure_simulation: createFailureSimulation({
      target_action_id: "create-probe-companion",
      failure_kind: "simulated_terminal_stop",
    }),
  }), {
    runtime_bridge: createSequencedRuntimeBridge([
      createTrackedStateSnapshot({
        objectCount: 13,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: false },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 13,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: false },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 14,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: true },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 14,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: true },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 15,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: true },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: true },
        ],
      }),
    ]),
    mutation_bridge: {
      async executeSceneObjectCreation(input) {
        calls.push(`create:${input.object_name}`);
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          mutation_status: "mutation_executed" as const,
          mutation_type: "scene_object_creation_request" as const,
          target_scene: input.target_scene,
          object_name: input.object_name,
          created_object_name: input.object_name,
          scene_saved: true,
          duplicate_handling: "created" as const,
          evidence_timestamp: "2026-05-05T10:07:00.000Z",
          raw_evidence_summary: `Controlled Unity mutation created ${input.object_name}.`,
          summary: `Controlled Unity mutation created object ${input.object_name} in EnemyAIDemo with scene_saved true.`,
          rollback_hint: "Rollback requires separate approval.",
          recommended_next_operator_action: "Review controlled mutation evidence.",
        };
      },
      async executeSceneObjectRemoval() {
        throw new Error("should not execute rollback during the chain run");
      },
    },
  });

  assert.deepEqual(calls, [
    `create:${PRIMARY_CHAIN_OBJECT_NAME}`,
    `create:${COMPANION_CHAIN_OBJECT_NAME}`,
  ]);
  assert.equal(result.execution_status, "partial_failure");
  assert.equal(result.actions_executed_count, 2);
  assert.equal(result.actions_failed_count, 0);
  assert.equal(result.failure_classification, "simulated_terminal_stop");
  assert.equal(result.rollback_plan_required, true);
  assert.deepEqual(result.rollback_plan?.rollback_order, ["create-probe-companion", "create-probe"]);
  assert.equal(result.rollback_plan?.rollback_target_count, 2);
  assert.deepEqual(result.rollback_plan?.rollback_targets.map((target) => target.target_object_name), [
    COMPANION_CHAIN_OBJECT_NAME,
    PRIMARY_CHAIN_OBJECT_NAME,
  ]);
  assert.match(result.rollback_plan?.rollback_reason ?? "", /terminal stop/i);
  assert.ok(result.review_package?.proof_results.includes(`Rollback target 1: ${COMPANION_CHAIN_OBJECT_NAME} from create-probe-companion`));
  assert.ok(result.review_package?.proof_results.includes(`Rollback target 2: ${PRIMARY_CHAIN_OBJECT_NAME} from create-probe`));
  assert.equal(result.final_scene_state.object_count_before, 13);
  assert.equal(result.final_scene_state.object_count_after, 15);
});

test("dependency failure blocks step 2 when the first create result is missing from live state", async () => {
  const calls: string[] = [];
  const result = await executeUnityMutationExecutionChain(createMultiCreateChainExecutionInput(), {
    runtime_bridge: createSequencedRuntimeBridge([
      createTrackedStateSnapshot({
        objectCount: 13,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: false },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 13,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: false },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 14,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: true },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 14,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: false },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
    ]),
    mutation_bridge: {
      async executeSceneObjectCreation(input) {
        calls.push(`create:${input.object_name}`);
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          mutation_status: "mutation_executed" as const,
          mutation_type: "scene_object_creation_request" as const,
          target_scene: input.target_scene,
          object_name: input.object_name,
          created_object_name: input.object_name,
          scene_saved: true,
          duplicate_handling: "created" as const,
          evidence_timestamp: "2026-05-04T10:02:00.000Z",
          raw_evidence_summary: `Controlled Unity mutation created ${input.object_name}.`,
          summary: `Controlled Unity mutation created object ${input.object_name} in EnemyAIDemo with scene_saved true.`,
          rollback_hint: "Rollback requires separate approval.",
          recommended_next_operator_action: "Review controlled mutation evidence.",
        };
      },
      async executeSceneObjectRemoval() {
        throw new Error("should not execute rollback during dependency failure");
      },
    },
  });

  assert.deepEqual(calls, [`create:${PRIMARY_CHAIN_OBJECT_NAME}`]);
  assert.equal(result.execution_status, "partial_failure");
  assert.equal(result.actions_executed_count, 1);
  assert.equal(result.actions_failed_count, 1);
  assert.equal(result.failed_action_id, "create-probe-companion");
  assert.equal(result.failure_classification, "dependency_failed");
  assert.equal(result.rollback_plan_required, true);
  assert.deepEqual(result.rollback_plan?.rollback_order, ["create-probe"]);
  assert.equal(result.final_scene_state.object_count_before, 13);
  assert.equal(result.final_scene_state.object_count_after, 14);
  assert.match(result.per_action_results[1]?.failure_reason ?? "", /Dependency gate blocked/i);
});

test("post-action verification holds for both steps in the bounded create/create chain", async () => {
  const result = await executeUnityMutationExecutionChain(createMultiCreateChainExecutionInput(), {
    runtime_bridge: createSequencedRuntimeBridge([
      createTrackedStateSnapshot({
        objectCount: 13,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: false },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 13,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: false },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 14,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: true },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 14,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: true },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 15,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: true },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: true },
        ],
      }),
    ]),
    mutation_bridge: {
      async executeSceneObjectCreation(input) {
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          mutation_status: "mutation_executed" as const,
          mutation_type: "scene_object_creation_request" as const,
          target_scene: input.target_scene,
          object_name: input.object_name,
          created_object_name: input.object_name,
          scene_saved: true,
          duplicate_handling: "created" as const,
          evidence_timestamp: "2026-05-04T10:03:00.000Z",
          raw_evidence_summary: `Controlled Unity mutation created ${input.object_name}.`,
          summary: `Controlled Unity mutation created object ${input.object_name} in EnemyAIDemo with scene_saved true.`,
          rollback_hint: "Rollback requires separate approval.",
          recommended_next_operator_action: "Review controlled mutation evidence.",
        };
      },
      async executeSceneObjectRemoval() {
        throw new Error("should not execute rollback during create/create verification");
      },
    },
  });

  const afterActionSnapshots = result.state_snapshots.filter((snapshot) => snapshot.stage === "after_action");
  assert.equal(afterActionSnapshots.length, 2);
  assert.ok(afterActionSnapshots.every((snapshot) => snapshot.decision === "continue"));
  assert.equal(afterActionSnapshots[0]?.snapshot.objectCount, 14);
  assert.equal(afterActionSnapshots[1]?.snapshot.objectCount, 15);
});

test("chain captures baseline state before execution", async () => {
  const result = await executeUnityMutationExecutionChain(createChainExecutionInput(), {
    runtime_bridge: createSequencedRuntimeBridge([
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 14, targetExists: true }),
      createTrackedStateSnapshot({ objectCount: 14, targetExists: true }),
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
    ]),
    mutation_bridge: {
      async executeSceneObjectCreation(input) {
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          mutation_status: "mutation_executed" as const,
          mutation_type: "scene_object_creation_request" as const,
          target_scene: input.target_scene,
          object_name: input.object_name,
          created_object_name: input.object_name,
          scene_saved: true,
          duplicate_handling: "created" as const,
          evidence_timestamp: "2026-05-03T12:01:00.000Z",
          raw_evidence_summary: "Controlled Unity mutation created the probe object.",
          summary: "Controlled Unity mutation created object AIE_ControlledMutationProbe in EnemyAIDemo with scene_saved true.",
          rollback_hint: "Rollback requires separate approval.",
          recommended_next_operator_action: "Review controlled mutation evidence.",
        };
      },
      async executeSceneObjectRemoval(input) {
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          rollback_status: "rollback_executed" as const,
          rollback_type: "scene_object_removal" as const,
          target_scene: input.target_scene,
          object_name: input.object_name,
          removed_object_name: input.object_name,
          scene_saved: true,
          target_missing_handling: "removed" as const,
          evidence_timestamp: "2026-05-03T12:02:00.000Z",
          raw_evidence_summary: "Controlled Unity rollback removed the probe object.",
          summary: "Controlled Unity rollback removed target AIE_ControlledMutationProbe in EnemyAIDemo with scene_saved true.",
          recommended_next_operator_action: "Review controlled rollback evidence.",
        };
      },
    },
  });

  assert.equal(result.state_snapshots[0]?.stage, "chain_start");
  assert.equal(result.state_snapshots[0]?.snapshot.objectCount, 13);
  assert.equal(result.state_snapshots[0]?.snapshot.objects[0]?.exists, false);
});

test("pre-action gate blocks mutation when target already exists", async () => {
  let mutationCalls = 0;
  const result = await executeUnityMutationExecutionChain(createChainExecutionInput(), {
    runtime_bridge: createSequencedRuntimeBridge([
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 13, targetExists: true }),
    ]),
    mutation_bridge: {
      async executeSceneObjectCreation() {
        mutationCalls += 1;
        throw new Error("should not mutate when target already exists");
      },
      async executeSceneObjectRemoval() {
        mutationCalls += 1;
        throw new Error("should not rollback when state gate blocks first action");
      },
    },
  });

  assert.equal(mutationCalls, 0);
  assert.equal(result.failure_classification, "state_gate_failed");
  assert.equal(result.executed, false);
  assert.match(result.blocked_reason ?? "", /already exists before mutation/i);
  assert.ok(result.review_package?.risks.includes("PRE-ACTION STATE GATE FAILED"));
  assert.ok(result.delivery_package?.proof_results.includes("CHAIN STOPPED BEFORE MUTATION"));
});

test("pre-action gate blocks mutation when missing scripts are present", async () => {
  let mutationCalls = 0;
  const result = await executeUnityMutationExecutionChain(createChainExecutionInput(), {
    runtime_bridge: createSequencedRuntimeBridge([
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false, missingScripts: 1 }),
    ]),
    mutation_bridge: {
      async executeSceneObjectCreation() {
        mutationCalls += 1;
        throw new Error("should not mutate when missing scripts exist");
      },
      async executeSceneObjectRemoval() {
        mutationCalls += 1;
        throw new Error("should not rollback when state gate blocks first action");
      },
    },
  });

  assert.equal(mutationCalls, 0);
  assert.equal(result.failure_classification, "state_gate_failed");
  assert.match(result.blocked_reason ?? "", /missing scripts were detected/i);
});

test("post-action verification confirms expected object count delta", async () => {
  const result = await executeUnityMutationExecutionChain(createChainExecutionInput(), {
    runtime_bridge: createSequencedRuntimeBridge([
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 14, targetExists: true }),
      createTrackedStateSnapshot({ objectCount: 14, targetExists: true }),
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
    ]),
    mutation_bridge: {
      async executeSceneObjectCreation(input) {
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          mutation_status: "mutation_executed" as const,
          mutation_type: "scene_object_creation_request" as const,
          target_scene: input.target_scene,
          object_name: input.object_name,
          created_object_name: input.object_name,
          scene_saved: true,
          duplicate_handling: "created" as const,
          evidence_timestamp: "2026-05-03T12:01:00.000Z",
          raw_evidence_summary: null,
          summary: "mutation ok",
          rollback_hint: "Rollback requires separate approval.",
          recommended_next_operator_action: "Review controlled mutation evidence.",
        };
      },
      async executeSceneObjectRemoval(input) {
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          rollback_status: "rollback_executed" as const,
          rollback_type: "scene_object_removal" as const,
          target_scene: input.target_scene,
          object_name: input.object_name,
          removed_object_name: input.object_name,
          scene_saved: true,
          target_missing_handling: "removed" as const,
          evidence_timestamp: "2026-05-03T12:02:00.000Z",
          raw_evidence_summary: null,
          summary: "rollback ok",
          recommended_next_operator_action: "Review controlled rollback evidence.",
        };
      },
    },
  });

  assert.equal(result.failure_classification, "none");
  assert.equal(result.state_snapshots[2]?.snapshot.objectCount, 14);
  assert.equal(result.state_snapshots[4]?.snapshot.objectCount, 13);
});

test("state gate failure does not mutate scene and produces evidence", async () => {
  let creationCalls = 0;
  const result = await executeUnityMutationExecutionChain(createChainExecutionInput(), {
    runtime_bridge: createSequencedRuntimeBridge([
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 13, targetExists: true }),
    ]),
    mutation_bridge: {
      async executeSceneObjectCreation() {
        creationCalls += 1;
        throw new Error("should not run");
      },
      async executeSceneObjectRemoval() {
        throw new Error("should not run");
      },
    },
  });

  assert.equal(creationCalls, 0);
  assert.equal(result.executed, false);
  assert.ok(result.delivery_package?.proof_results.includes("PRE-ACTION STATE GATE FAILED"));
  assert.ok(result.review_package?.risks.includes("CHAIN STOPPED BEFORE MUTATION"));
});

test("recovery from state-verification failure still uses Layer 17 manual rollback path", async () => {
  const sourceResult = await executeUnityMutationExecutionChain(createChainExecutionInput(), {
    runtime_bridge: createSequencedRuntimeBridge([
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
    ]),
    mutation_bridge: {
      async executeSceneObjectCreation(input) {
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          mutation_status: "mutation_executed" as const,
          mutation_type: "scene_object_creation_request" as const,
          target_scene: input.target_scene,
          object_name: input.object_name,
          created_object_name: input.object_name,
          scene_saved: true,
          duplicate_handling: "created" as const,
          evidence_timestamp: "2026-05-03T12:01:00.000Z",
          raw_evidence_summary: null,
          summary: "mutation ok",
          rollback_hint: "Rollback requires separate approval.",
          recommended_next_operator_action: "Review controlled mutation evidence.",
        };
      },
      async executeSceneObjectRemoval() {
        throw new Error("rollback should not execute after state verification failure on action 1");
      },
    },
  });

  assert.equal(sourceResult.execution_status, "partial_failure");
  assert.equal(sourceResult.failure_classification, "state_verification_failed");
  assert.equal(sourceResult.rollback_plan_required, true);

  const rollbackResult = await executePlannedUnityRollbackFromChain(createPlannedRollbackExecutionInput(sourceResult), {
    mutation_bridge: {
      async executeSceneObjectCreation() {
        throw new Error("should not create during manual rollback");
      },
      async executeSceneObjectRemoval(input) {
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          rollback_status: "rollback_executed" as const,
          rollback_type: "scene_object_removal" as const,
          target_scene: input.target_scene,
          object_name: input.object_name,
          removed_object_name: input.object_name,
          scene_saved: true,
          target_missing_handling: "removed" as const,
          evidence_timestamp: "2026-05-03T12:02:00.000Z",
          raw_evidence_summary: null,
          summary: "rollback ok",
          recommended_next_operator_action: "Review controlled rollback evidence.",
        };
      },
    },
  });

  assert.equal(rollbackResult.execution_status, "success");
  assert.ok(rollbackResult.delivery_package?.proof_results.includes("MANUAL ROLLBACK EXECUTED"));
});

test("controlled Unity chain execution refuses non-ready chains without touching Unity", async () => {
  let callCount = 0;
  const result = await executeUnityMutationExecutionChain(createChainExecutionInput({
    readiness_result: evaluateUnityMutationExecutionChainReadiness(createChainReadinessInput({
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
    })),
  }), {
    mutation_bridge: {
      async executeSceneObjectCreation() {
        callCount += 1;
        throw new Error("should not execute mutation");
      },
      async executeSceneObjectRemoval() {
        callCount += 1;
        throw new Error("should not execute rollback");
      },
    },
  });

  assert.equal(result.execution_kind, "chain_execution_blocked");
  assert.equal(result.execution_status, "failed");
  assert.equal(result.executed, false);
  assert.equal(result.actions_executed_count, 0);
  assert.equal(callCount, 0);
  assert.match(result.blocked_reason ?? "", /ready_for_operator_execution|blocked/i);
});

test("controlled Unity chain execution stops on the first failed action and reports partial failure", async () => {
  const calls: string[] = [];
  const result = await executeUnityMutationExecutionChain(createChainExecutionInput(), {
    runtime_bridge: createSequencedRuntimeBridge([
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 14, targetExists: true }),
      createTrackedStateSnapshot({ objectCount: 14, targetExists: true }),
      createTrackedStateSnapshot({ objectCount: 14, targetExists: true }),
    ]),
    mutation_bridge: {
      async executeSceneObjectCreation(input) {
        calls.push(`create:${input.object_name}`);
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          mutation_status: "mutation_executed" as const,
          mutation_type: "scene_object_creation_request" as const,
          target_scene: input.target_scene,
          object_name: input.object_name,
          created_object_name: input.object_name,
          scene_saved: true,
          duplicate_handling: "created" as const,
          evidence_timestamp: "2026-05-03T12:03:00.000Z",
          raw_evidence_summary: "Controlled Unity mutation created the probe object.",
          summary: "Controlled Unity mutation created object AIE_ControlledMutationProbe in EnemyAIDemo with scene_saved true.",
          rollback_hint: "Rollback requires separate approval.",
          recommended_next_operator_action: "Review controlled mutation evidence.",
        };
      },
      async executeSceneObjectRemoval(input) {
        calls.push(`rollback:${input.object_name}`);
        return {
          bridge_status: "bridge_failure" as const,
          source: "command_probe" as const,
          reason: "Unity rollback bridge reported a controlled failure.",
          evidence_timestamp: "2026-05-03T12:04:00.000Z",
          raw_evidence_summary: "Controlled Unity rollback failed.",
          recommended_next_operator_action: "Investigate the rollback failure.",
        };
      },
    },
  });

  assert.deepEqual(calls, ["create:AIE_ControlledMutationProbe", "rollback:AIE_ControlledMutationProbe"]);
  assert.equal(result.execution_status, "partial_failure");
  assert.equal(result.execution_kind, "chain_execution_partial_failure");
  assert.equal(result.actions_executed_count, 1);
  assert.equal(result.actions_failed_count, 1);
  assert.equal(result.failure_handling_status, "rollback_recommended");
  assert.equal(result.failure_classification, "rollback_failed");
  assert.equal(result.failure_source, "rollback");
  assert.equal(result.failed_action_id, "rollback-probe");
  assert.deepEqual(result.successful_action_ids, ["create-probe"]);
  assert.equal(result.rollback_plan_required, true);
  assert.equal(result.rollback_plan?.auto_execute, false);
  assert.equal(result.rollback_plan?.executed, false);
  assert.deepEqual(result.rollback_plan?.actions_to_rollback, ["create-probe"]);
  assert.deepEqual(result.rollback_plan?.rollback_order, ["create-probe"]);
  assert.equal(result.manual_review_required, true);
  assert.equal(result.per_action_results[0]?.status, "executed");
  assert.equal(result.per_action_results[1]?.status, "failed");
  assert.match(result.blocked_reason ?? "", /controlled failure/i);
});

test("controlled Unity chain execution does not require rollback planning when the first action fails", async () => {
  const result = await executeUnityMutationExecutionChain(createChainExecutionInput(), {
    runtime_bridge: createSequencedRuntimeBridge([
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
    ]),
    mutation_bridge: {
      async executeSceneObjectCreation() {
        return {
          bridge_status: "bridge_failure" as const,
          source: "command_probe" as const,
          reason: "Unity mutation bridge reported a controlled failure.",
          evidence_timestamp: "2026-05-03T12:05:00.000Z",
          raw_evidence_summary: "Controlled Unity mutation failed.",
          recommended_next_operator_action: "Investigate the mutation failure.",
        };
      },
      async executeSceneObjectRemoval() {
        throw new Error("should not execute rollback");
      },
    },
  });

  assert.equal(result.execution_status, "failed");
  assert.equal(result.actions_executed_count, 0);
  assert.equal(result.actions_failed_count, 1);
  assert.equal(result.failure_handling_status, "manual_review_required");
  assert.equal(result.failure_classification, "action_failed");
  assert.equal(result.failed_action_id, "create-probe");
  assert.deepEqual(result.successful_action_ids, []);
  assert.equal(result.rollback_plan_required, false);
  assert.equal(result.rollback_plan, null);
  assert.equal(result.manual_review_required, true);
});

test("controlled Unity chain execution classifies runtime unavailable failures and still avoids auto rollback", async () => {
  const result = await executeUnityMutationExecutionChain(createChainExecutionInput(), {
    runtime_bridge: createSequencedRuntimeBridge([
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 14, targetExists: true }),
      createTrackedStateSnapshot({ objectCount: 14, targetExists: true }),
      createTrackedStateSnapshot({ objectCount: 14, targetExists: true }),
    ]),
    mutation_bridge: {
      async executeSceneObjectCreation(input) {
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          mutation_status: "mutation_executed" as const,
          mutation_type: "scene_object_creation_request" as const,
          target_scene: input.target_scene,
          object_name: input.object_name,
          created_object_name: input.object_name,
          scene_saved: true,
          duplicate_handling: "created" as const,
          evidence_timestamp: "2026-05-03T12:06:00.000Z",
          raw_evidence_summary: "Controlled Unity mutation created the probe object.",
          summary: "Controlled Unity mutation created object AIE_ControlledMutationProbe in EnemyAIDemo with scene_saved true.",
          rollback_hint: "Rollback requires separate approval.",
          recommended_next_operator_action: "Review controlled mutation evidence.",
        };
      },
      async executeSceneObjectRemoval() {
        return {
          bridge_status: "bridge_unavailable" as const,
          source: "command_probe" as const,
          reason: "Unity rollback bridge is unavailable.",
          evidence_timestamp: "2026-05-03T12:07:00.000Z",
          raw_evidence_summary: "Controlled Unity rollback bridge unavailable.",
          recommended_next_operator_action: "Keep rollback disabled until the verified rollback bridge is available.",
        };
      },
    },
  });

  assert.equal(result.execution_status, "partial_failure");
  assert.equal(result.failure_handling_status, "rollback_recommended");
  assert.equal(result.failure_classification, "rollback_failed");
  assert.equal(result.failure_source, "rollback");
  assert.equal(result.failure_is_simulated, false);
  assert.equal(result.failure_is_recoverable, true);
  assert.equal(result.failure_requires_manual_review, true);
  assert.equal(result.failed_action_id, "rollback-probe");
  assert.deepEqual(result.rollback_plan?.rollback_order, ["create-probe"]);
  assert.equal(result.rollback_plan?.auto_execute, false);
});

test("controlled Unity chain execution classifies real runtime unavailable failures on the mutation lane", async () => {
  const result = await executeUnityMutationExecutionChain(createChainExecutionInput(), {
    runtime_bridge: createSequencedRuntimeBridge([
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
    ]),
    mutation_bridge: {
      async executeSceneObjectCreation() {
        return {
          bridge_status: "bridge_unavailable" as const,
          source: "command_probe" as const,
          reason: "Unity mutation bridge is unavailable.",
          evidence_timestamp: "2026-05-03T12:06:00.000Z",
          raw_evidence_summary: "Controlled Unity mutation bridge unavailable.",
          recommended_next_operator_action: "Keep mutation disabled until the verified mutation bridge is available.",
        };
      },
      async executeSceneObjectRemoval() {
        throw new Error("should not execute rollback after a mutation-lane runtime outage");
      },
    },
  });

  assert.equal(result.execution_status, "failed");
  assert.equal(result.failure_classification, "runtime_unavailable");
  assert.equal(result.failure_source, "runtime");
  assert.equal(result.failure_is_simulated, false);
  assert.equal(result.failed_action_id, "create-probe");
  assert.equal(result.rollback_plan_required, false);
});

test("controlled Unity chain execution refuses unsupported chain shapes", async () => {
  const readinessInput = createChainReadinessInput({
    actions: [
      createCreationReadinessAction({
        action_id: "create-one",
        target_object_name: "AIE_ControlledMutationProbe",
      }),
    ],
  });
  const result = await executeUnityMutationExecutionChain(createChainExecutionInput({
    actions: readinessInput.actions,
    readiness_result: {
      ...evaluateUnityMutationExecutionChainReadiness(readinessInput),
      chain_readiness: "ready_for_operator_execution",
      chain_ready: true,
      blocked_reason: null,
      executable_actions: ["create-one"],
      blocked_actions: [],
      dependency_blocked_actions: [],
      missing_gates: [],
      ordered_actions: [
        {
          ...createCreationReadinessAction({
            action_id: "create-one",
            target_object_name: "AIE_ControlledMutationProbe",
          }),
          ready_for_operator_execution: true,
          blocked_reason: null,
        },
      ],
    },
  }));

  assert.equal(result.execution_kind, "chain_execution_blocked");
  assert.equal(result.executed, false);
  assert.equal(result.failure_classification, "unsupported_action");
  assert.equal(result.failure_source, "adapter");
  assert.equal(result.failure_handling_status, "manual_review_required");
  assert.equal(result.rollback_plan_required, false);
  assert.match(result.blocked_reason ?? "", /bounded two-action dependency pair/i);
});

test("disabled failure simulation does not alter controlled Unity chain execution", async () => {
  const calls: string[] = [];
  const result = await executeUnityMutationExecutionChain(createChainExecutionInput({
    failure_simulation: createFailureSimulation({
      target_action_id: "rollback-probe",
      failure_kind: "simulated_action_failure",
      enabled: false,
    }),
  }), {
    runtime_bridge: createSequencedRuntimeBridge([
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 14, targetExists: true }),
      createTrackedStateSnapshot({ objectCount: 14, targetExists: true }),
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
    ]),
    mutation_bridge: {
      async executeSceneObjectCreation(input) {
        calls.push(`create:${input.object_name}`);
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          mutation_status: "mutation_executed" as const,
          mutation_type: "scene_object_creation_request" as const,
          target_scene: input.target_scene,
          object_name: input.object_name,
          created_object_name: input.object_name,
          scene_saved: true,
          duplicate_handling: "created" as const,
          evidence_timestamp: "2026-05-04T10:01:00.000Z",
          raw_evidence_summary: "Controlled Unity mutation created the probe object.",
          summary: "Controlled Unity mutation created object AIE_ControlledMutationProbe in EnemyAIDemo with scene_saved true.",
          rollback_hint: "Rollback requires separate approval.",
          recommended_next_operator_action: "Review controlled mutation evidence.",
        };
      },
      async executeSceneObjectRemoval(input) {
        calls.push(`rollback:${input.object_name}`);
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          rollback_status: "rollback_executed" as const,
          rollback_type: "scene_object_removal" as const,
          target_scene: input.target_scene,
          object_name: input.object_name,
          removed_object_name: input.object_name,
          scene_saved: true,
          target_missing_handling: "removed" as const,
          evidence_timestamp: "2026-05-04T10:02:00.000Z",
          raw_evidence_summary: "Controlled Unity rollback removed the probe object.",
          summary: "Controlled Unity rollback removed target AIE_ControlledMutationProbe in EnemyAIDemo with scene_saved true.",
          recommended_next_operator_action: "Review controlled rollback evidence.",
        };
      },
    },
  });

  assert.deepEqual(calls, ["create:AIE_ControlledMutationProbe", "rollback:AIE_ControlledMutationProbe"]);
  assert.equal(result.execution_status, "success");
  assert.equal(result.failure_simulated, false);
  assert.equal(result.failure_simulation_id, null);
  assert.equal(result.simulated_failure_kind, null);
});

test("expired failure simulation blocks chain execution safely before Unity calls", async () => {
  let callCount = 0;
  const result = await executeUnityMutationExecutionChain(createChainExecutionInput({
    requested_at: "2026-05-04T10:30:00.000Z",
    failure_simulation: createFailureSimulation({
      target_action_id: "create-probe",
      failure_kind: "simulated_gate_mismatch",
      expires_at: "2026-05-04T09:59:59.000Z",
    }),
  }), {
    mutation_bridge: {
      async executeSceneObjectCreation() {
        callCount += 1;
        throw new Error("should not execute mutation when simulation is expired");
      },
      async executeSceneObjectRemoval() {
        callCount += 1;
        throw new Error("should not execute rollback when simulation is expired");
      },
    },
  });

  assert.equal(result.execution_status, "failed");
  assert.equal(result.failure_classification, "gate_mismatch");
  assert.equal(result.failure_source, "gate");
  assert.equal(result.failure_is_recoverable, true);
  assert.equal(result.executed, false);
  assert.equal(callCount, 0);
  assert.match(result.blocked_reason ?? "", /expired/i);
});

test("failure simulation on the first action fails without generating a rollback plan", async () => {
  let callCount = 0;
  const result = await executeUnityMutationExecutionChain(createChainExecutionInput({
    failure_simulation: createFailureSimulation({
      target_action_id: "create-probe",
      failure_kind: "simulated_action_failure",
    }),
  }), {
    runtime_bridge: createSequencedRuntimeBridge([
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
    ]),
    mutation_bridge: {
      async executeSceneObjectCreation() {
        callCount += 1;
        throw new Error("should not execute mutation when first action is simulated");
      },
      async executeSceneObjectRemoval() {
        callCount += 1;
        throw new Error("should not execute rollback when first action is simulated");
      },
    },
  });

  assert.equal(result.execution_status, "failed");
  assert.equal(result.actions_executed_count, 0);
  assert.equal(result.actions_failed_count, 1);
  assert.equal(result.failure_classification, "simulated_action_failure");
  assert.equal(result.failure_source, "simulation");
  assert.equal(result.failure_is_simulated, true);
  assert.equal(result.failure_is_recoverable, true);
  assert.equal(result.failure_simulated, true);
  assert.equal(result.failure_simulation_id, "failure-simulation-create-probe");
  assert.equal(result.simulated_failure_kind, "simulated_action_failure");
  assert.equal(result.simulation_target_action_id, "create-probe");
  assert.equal(result.rollback_plan_required, false);
  assert.equal(result.rollback_plan, null);
  assert.equal(result.manual_review_required, true);
  assert.equal(result.per_action_results[0]?.status, "failed");
  assert.equal(callCount, 0);
});

test("failure simulation on the second action generates a manual rollback plan after the first success", async () => {
  const calls: string[] = [];
  const result = await executeUnityMutationExecutionChain(createChainExecutionInput({
    failure_simulation: createFailureSimulation({
      target_action_id: "rollback-probe",
      failure_kind: "simulated_action_failure",
    }),
  }), {
    runtime_bridge: createSequencedRuntimeBridge([
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 14, targetExists: true }),
      createTrackedStateSnapshot({ objectCount: 14, targetExists: true }),
    ]),
    mutation_bridge: {
      async executeSceneObjectCreation(input) {
        calls.push(`create:${input.object_name}`);
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          mutation_status: "mutation_executed" as const,
          mutation_type: "scene_object_creation_request" as const,
          target_scene: input.target_scene,
          object_name: input.object_name,
          created_object_name: input.object_name,
          scene_saved: true,
          duplicate_handling: "created" as const,
          evidence_timestamp: "2026-05-04T10:03:00.000Z",
          raw_evidence_summary: "Controlled Unity mutation created the probe object.",
          summary: "Controlled Unity mutation created object AIE_ControlledMutationProbe in EnemyAIDemo with scene_saved true.",
          rollback_hint: "Rollback requires separate approval.",
          recommended_next_operator_action: "Review controlled mutation evidence.",
        };
      },
      async executeSceneObjectRemoval() {
        calls.push("rollback:should-not-run");
        throw new Error("should not execute rollback when second action is simulated");
      },
    },
  });

  assert.deepEqual(calls, ["create:AIE_ControlledMutationProbe"]);
  assert.equal(result.execution_status, "partial_failure");
  assert.equal(result.actions_executed_count, 1);
  assert.equal(result.actions_failed_count, 1);
  assert.equal(result.failure_classification, "simulated_action_failure");
  assert.equal(result.failure_source, "simulation");
  assert.equal(result.failure_is_simulated, true);
  assert.equal(result.failure_simulated, true);
  assert.equal(result.simulated_failure_kind, "simulated_action_failure");
  assert.equal(result.rollback_plan_required, true);
  assert.deepEqual(result.rollback_plan?.rollback_order, ["create-probe"]);
  assert.equal(result.rollback_plan?.auto_execute, false);
});

test("simulated second-action failure can feed manual rollback execution and restore the clean final state", async () => {
  const chainCalls: string[] = [];
  const sourceResult = await executeUnityMutationExecutionChain(createChainExecutionInput({
    failure_simulation: createFailureSimulation({
      target_action_id: "rollback-probe",
      failure_kind: "simulated_action_failure",
    }),
  }), {
    runtime_bridge: createSequencedRuntimeBridge([
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 14, targetExists: true }),
      createTrackedStateSnapshot({ objectCount: 14, targetExists: true }),
    ]),
    mutation_bridge: {
      async executeSceneObjectCreation(input) {
        chainCalls.push(`create:${input.object_name}`);
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          mutation_status: "mutation_executed" as const,
          mutation_type: "scene_object_creation_request" as const,
          target_scene: input.target_scene,
          object_name: input.object_name,
          created_object_name: input.object_name,
          scene_saved: true,
          duplicate_handling: "created" as const,
          evidence_timestamp: "2026-05-05T10:03:00.000Z",
          raw_evidence_summary: "Controlled Unity mutation created the probe object.",
          summary: "Controlled Unity mutation created object AIE_ControlledMutationProbe in EnemyAIDemo with scene_saved true.",
          rollback_hint: "Rollback requires separate approval.",
          recommended_next_operator_action: "Review controlled mutation evidence.",
        };
      },
      async executeSceneObjectRemoval() {
        chainCalls.push("rollback:should-not-run");
        throw new Error("should not execute rollback when the second chain action is simulated");
      },
    },
  });

  assert.deepEqual(chainCalls, ["create:AIE_ControlledMutationProbe"]);
  assert.equal(sourceResult.execution_status, "partial_failure");
  assert.equal(sourceResult.failure_classification, "simulated_action_failure");
  assert.equal(sourceResult.failure_source, "simulation");
  assert.equal(sourceResult.failure_is_simulated, true);
  assert.equal(sourceResult.rollback_plan_required, true);
  assert.equal(sourceResult.rollback_plan?.auto_execute, false);
  assert.equal(sourceResult.rollback_plan?.executed, false);
  assert.equal(sourceResult.final_scene_state.object_count_before, 13);
  assert.equal(sourceResult.final_scene_state.object_count_after, 14);
  assert.ok(sourceResult.review_package?.risks.includes("SIMULATED FAILURE"));
  assert.ok(sourceResult.review_package?.risks.includes("ROLLBACK PLAN GENERATED"));
  assert.ok(sourceResult.review_package?.risks.includes("ROLLBACK NOT AUTO-EXECUTED"));
  assert.ok(sourceResult.delivery_package?.proof_results.includes("ROLLBACK PLAN GENERATED"));

  const rollbackCalls: string[] = [];
  const rollbackResult = await executePlannedUnityRollbackFromChain(
    createPlannedRollbackExecutionInput(sourceResult),
    {
      mutation_bridge: {
        async executeSceneObjectCreation() {
          throw new Error("should not execute creation during manual rollback");
        },
        async executeSceneObjectRemoval(input) {
          rollbackCalls.push(`rollback:${input.object_name}`);
          return {
            bridge_status: "bridge_ready" as const,
            source: "command_probe" as const,
            rollback_status: "rollback_executed" as const,
            rollback_type: "scene_object_removal" as const,
            target_scene: input.target_scene,
            object_name: input.object_name,
            removed_object_name: input.object_name,
            scene_saved: true,
            target_missing_handling: "removed" as const,
            evidence_timestamp: "2026-05-05T10:05:00.000Z",
            raw_evidence_summary: "Controlled Unity rollback removed the probe object.",
            summary: "Controlled Unity rollback removed target AIE_ControlledMutationProbe in EnemyAIDemo with scene_saved true.",
            recommended_next_operator_action: "Review controlled rollback evidence.",
          };
        },
      },
    },
  );

  assert.deepEqual(rollbackCalls, ["rollback:AIE_ControlledMutationProbe"]);
  assert.equal(rollbackResult.execution_status, "success");
  assert.equal(rollbackResult.execution_kind, "planned_chain_rollback_executed");
  assert.equal(rollbackResult.executed, true);
  assert.equal(rollbackResult.auto_execute, false);
  assert.equal(rollbackResult.manual_trigger, true);
  assert.equal(rollbackResult.actions_executed_count, 1);
  assert.equal(rollbackResult.actions_failed_count, 0);
  assert.equal(rollbackResult.failure_classification, "none");
  assert.equal(rollbackResult.final_scene_state.object_count_before, 14);
  assert.equal(rollbackResult.final_scene_state.object_count_after, 13);
  assert.equal(rollbackResult.final_scene_state.object_count_delta, -1);
  assert.deepEqual(rollbackResult.remaining_actions_not_executed, []);
  assert.ok(rollbackResult.review_package?.proof_results.includes("MANUAL ROLLBACK EXECUTED"));
  assert.ok(rollbackResult.delivery_package?.proof_results.includes("MANUAL ROLLBACK EXECUTED"));
});

test("failure simulation on the second create action generates a rollback plan for the first successful create", async () => {
  const calls: string[] = [];
  const result = await executeUnityMutationExecutionChain(createMultiCreateChainExecutionInput({
    failure_simulation: createFailureSimulation({
      target_action_id: "create-probe-companion",
      failure_kind: "simulated_action_failure",
    }),
  }), {
    runtime_bridge: createSequencedRuntimeBridge([
      createTrackedStateSnapshot({
        objectCount: 13,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: false },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 13,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: false },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 14,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: true },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 14,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: true },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
    ]),
    mutation_bridge: {
      async executeSceneObjectCreation(input) {
        calls.push(`create:${input.object_name}`);
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          mutation_status: "mutation_executed" as const,
          mutation_type: "scene_object_creation_request" as const,
          target_scene: input.target_scene,
          object_name: input.object_name,
          created_object_name: input.object_name,
          scene_saved: true,
          duplicate_handling: "created" as const,
          evidence_timestamp: "2026-05-05T10:03:00.000Z",
          raw_evidence_summary: `Controlled Unity mutation created ${input.object_name}.`,
          summary: `Controlled Unity mutation created object ${input.object_name} in EnemyAIDemo with scene_saved true.`,
          rollback_hint: "Rollback requires separate approval.",
          recommended_next_operator_action: "Review controlled mutation evidence.",
        };
      },
      async executeSceneObjectRemoval() {
        throw new Error("should not execute rollback when the second create action is simulated");
      },
    },
  });

  assert.deepEqual(calls, [`create:${PRIMARY_CHAIN_OBJECT_NAME}`]);
  assert.equal(result.execution_status, "partial_failure");
  assert.equal(result.actions_executed_count, 1);
  assert.equal(result.actions_failed_count, 1);
  assert.equal(result.failure_classification, "simulated_action_failure");
  assert.equal(result.failure_source, "simulation");
  assert.equal(result.failure_is_simulated, true);
  assert.equal(result.rollback_plan_required, true);
  assert.deepEqual(result.rollback_plan?.rollback_order, ["create-probe"]);
  assert.equal(result.rollback_plan?.rollback_target_count, 1);
  assert.deepEqual(result.rollback_plan?.rollback_targets.map((target) => target.target_object_name), [PRIMARY_CHAIN_OBJECT_NAME]);
  assert.equal(result.final_scene_state.object_count_before, 13);
  assert.equal(result.final_scene_state.object_count_after, 14);
});

test("manual rollback after a two-step create-chain failure restores the clean 13-object baseline", async () => {
  const sourceResult = await executeUnityMutationExecutionChain(createMultiCreateChainExecutionInput({
    failure_simulation: createFailureSimulation({
      target_action_id: "create-probe-companion",
      failure_kind: "simulated_action_failure",
    }),
  }), {
    runtime_bridge: createSequencedRuntimeBridge([
      createTrackedStateSnapshot({
        objectCount: 13,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: false },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 13,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: false },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 14,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: true },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 14,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: true },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
    ]),
    mutation_bridge: {
      async executeSceneObjectCreation(input) {
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          mutation_status: "mutation_executed" as const,
          mutation_type: "scene_object_creation_request" as const,
          target_scene: input.target_scene,
          object_name: input.object_name,
          created_object_name: input.object_name,
          scene_saved: true,
          duplicate_handling: "created" as const,
          evidence_timestamp: "2026-05-05T10:04:00.000Z",
          raw_evidence_summary: `Controlled Unity mutation created ${input.object_name}.`,
          summary: `Controlled Unity mutation created object ${input.object_name} in EnemyAIDemo with scene_saved true.`,
          rollback_hint: "Rollback requires separate approval.",
          recommended_next_operator_action: "Review controlled mutation evidence.",
        };
      },
      async executeSceneObjectRemoval() {
        throw new Error("should not execute rollback during the chain run");
      },
    },
  });

  assert.equal(sourceResult.execution_status, "partial_failure");
  assert.equal(sourceResult.rollback_plan_required, true);
  assert.deepEqual(sourceResult.rollback_plan?.rollback_order, ["create-probe"]);

  const rollbackCalls: string[] = [];
  const rollbackResult = await executePlannedUnityRollbackFromChain(
    createPlannedRollbackExecutionInput(sourceResult),
    {
      mutation_bridge: {
        async executeSceneObjectCreation() {
          throw new Error("should not execute creation during manual rollback");
        },
        async executeSceneObjectRemoval(input) {
          rollbackCalls.push(`rollback:${input.object_name}`);
          return {
            bridge_status: "bridge_ready" as const,
            source: "command_probe" as const,
            rollback_status: "rollback_executed" as const,
            rollback_type: "scene_object_removal" as const,
            target_scene: input.target_scene,
            object_name: input.object_name,
            removed_object_name: input.object_name,
            scene_saved: true,
            target_missing_handling: "removed" as const,
            evidence_timestamp: "2026-05-05T10:06:00.000Z",
            raw_evidence_summary: `Controlled Unity rollback removed ${input.object_name}.`,
            summary: `Controlled Unity rollback removed target ${input.object_name} in EnemyAIDemo with scene_saved true.`,
            recommended_next_operator_action: "Review controlled rollback evidence.",
          };
        },
      },
    },
  );

  assert.deepEqual(rollbackCalls, [`rollback:${PRIMARY_CHAIN_OBJECT_NAME}`]);
  assert.equal(rollbackResult.execution_status, "success");
  assert.equal(rollbackResult.failure_classification, "none");
  assert.equal(rollbackResult.actions_executed_count, 1);
  assert.equal(rollbackResult.actions_failed_count, 0);
  assert.equal(rollbackResult.final_scene_state.object_count_before, 14);
  assert.equal(rollbackResult.final_scene_state.object_count_after, 13);
  assert.equal(rollbackResult.final_scene_state.object_count_delta, -1);
  assert.ok(rollbackResult.review_package?.proof_results.includes("MANUAL ROLLBACK EXECUTED"));
  assert.ok(rollbackResult.delivery_package?.proof_results.includes("MANUAL ROLLBACK EXECUTED"));
});

test("manual rollback after a two-step terminal stop removes both objects in reverse order and restores 15 to 13", async () => {
  const sourceResult = await executeUnityMutationExecutionChain(createMultiCreateChainExecutionInput({
    failure_simulation: createFailureSimulation({
      target_action_id: "create-probe-companion",
      failure_kind: "simulated_terminal_stop",
    }),
  }), {
    runtime_bridge: createSequencedRuntimeBridge([
      createTrackedStateSnapshot({
        objectCount: 13,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: false },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 13,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: false },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 14,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: true },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 14,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: true },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 15,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: true },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: true },
        ],
      }),
    ]),
    mutation_bridge: {
      async executeSceneObjectCreation(input) {
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          mutation_status: "mutation_executed" as const,
          mutation_type: "scene_object_creation_request" as const,
          target_scene: input.target_scene,
          object_name: input.object_name,
          created_object_name: input.object_name,
          scene_saved: true,
          duplicate_handling: "created" as const,
          evidence_timestamp: "2026-05-05T10:08:00.000Z",
          raw_evidence_summary: `Controlled Unity mutation created ${input.object_name}.`,
          summary: `Controlled Unity mutation created object ${input.object_name} in EnemyAIDemo with scene_saved true.`,
          rollback_hint: "Rollback requires separate approval.",
          recommended_next_operator_action: "Review controlled mutation evidence.",
        };
      },
      async executeSceneObjectRemoval() {
        throw new Error("should not execute rollback during the chain run");
      },
    },
  });

  const rollbackCalls: string[] = [];
  const rollbackResult = await executePlannedUnityRollbackFromChain(
    createPlannedRollbackExecutionInput(sourceResult, {
      rollback_actions: [
        createPlannedRollbackActionInput({
          source_action_id: "create-probe-companion",
          target_object_name: COMPANION_CHAIN_OBJECT_NAME,
          live_validation_result: createLiveValidationResult({ object_count: 15 }),
        }),
        createPlannedRollbackActionInput({
          source_action_id: "create-probe",
          target_object_name: PRIMARY_CHAIN_OBJECT_NAME,
          live_validation_result: createLiveValidationResult({ object_count: 15 }),
        }),
      ],
    }),
    {
      mutation_bridge: {
        async executeSceneObjectCreation() {
          throw new Error("should not execute creation during manual rollback");
        },
        async executeSceneObjectRemoval(input) {
          rollbackCalls.push(`rollback:${input.object_name}`);
          return {
            bridge_status: "bridge_ready" as const,
            source: "command_probe" as const,
            rollback_status: "rollback_executed" as const,
            rollback_type: "scene_object_removal" as const,
            target_scene: input.target_scene,
            object_name: input.object_name,
            removed_object_name: input.object_name,
            scene_saved: true,
            target_missing_handling: "removed" as const,
            evidence_timestamp: "2026-05-05T10:09:00.000Z",
            raw_evidence_summary: `Controlled Unity rollback removed ${input.object_name}.`,
            summary: `Controlled Unity rollback removed target ${input.object_name} in EnemyAIDemo with scene_saved true.`,
            recommended_next_operator_action: "Review controlled rollback evidence.",
          };
        },
      },
    },
  );

  assert.deepEqual(rollbackCalls, [
    `rollback:${COMPANION_CHAIN_OBJECT_NAME}`,
    `rollback:${PRIMARY_CHAIN_OBJECT_NAME}`,
  ]);
  assert.equal(rollbackResult.execution_status, "success");
  assert.equal(rollbackResult.actions_executed_count, 2);
  assert.equal(rollbackResult.actions_failed_count, 0);
  assert.equal(rollbackResult.final_scene_state.object_count_before, 15);
  assert.equal(rollbackResult.final_scene_state.object_count_after, 13);
  assert.equal(rollbackResult.final_scene_state.object_count_delta, -2);
});

test("repeated manual rollback after a two-step terminal stop remains idempotent", async () => {
  const sourceResult = await executeUnityMutationExecutionChain(createMultiCreateChainExecutionInput({
    failure_simulation: createFailureSimulation({
      target_action_id: "create-probe-companion",
      failure_kind: "simulated_terminal_stop",
    }),
  }), {
    runtime_bridge: createSequencedRuntimeBridge([
      createTrackedStateSnapshot({
        objectCount: 13,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: false },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 13,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: false },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 14,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: true },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 14,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: true },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: false },
        ],
      }),
      createTrackedStateSnapshot({
        objectCount: 15,
        trackedObjects: [
          { name: PRIMARY_CHAIN_OBJECT_NAME, exists: true },
          { name: COMPANION_CHAIN_OBJECT_NAME, exists: true },
        ],
      }),
    ]),
    mutation_bridge: {
      async executeSceneObjectCreation(input) {
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          mutation_status: "mutation_executed" as const,
          mutation_type: "scene_object_creation_request" as const,
          target_scene: input.target_scene,
          object_name: input.object_name,
          created_object_name: input.object_name,
          scene_saved: true,
          duplicate_handling: "created" as const,
          evidence_timestamp: "2026-05-05T10:10:00.000Z",
          raw_evidence_summary: `Controlled Unity mutation created ${input.object_name}.`,
          summary: `Controlled Unity mutation created object ${input.object_name} in EnemyAIDemo with scene_saved true.`,
          rollback_hint: "Rollback requires separate approval.",
          recommended_next_operator_action: "Review controlled mutation evidence.",
        };
      },
      async executeSceneObjectRemoval() {
        throw new Error("should not execute rollback during the chain run");
      },
    },
  });

  const result = await executePlannedUnityRollbackFromChain(
    createPlannedRollbackExecutionInput(sourceResult, {
      rollback_actions: [
        createPlannedRollbackActionInput({
          source_action_id: "create-probe-companion",
          target_object_name: COMPANION_CHAIN_OBJECT_NAME,
          live_validation_result: createLiveValidationResult({ object_count: 13 }),
        }),
        createPlannedRollbackActionInput({
          source_action_id: "create-probe",
          target_object_name: PRIMARY_CHAIN_OBJECT_NAME,
          live_validation_result: createLiveValidationResult({ object_count: 13 }),
        }),
      ],
    }),
    {
      mutation_bridge: {
        async executeSceneObjectCreation() {
          throw new Error("should not execute creation during manual rollback");
        },
        async executeSceneObjectRemoval(input) {
          return {
            bridge_status: "bridge_ready" as const,
            source: "command_probe" as const,
            rollback_status: "rollback_idempotent" as const,
            rollback_type: "scene_object_removal" as const,
            target_scene: input.target_scene,
            object_name: input.object_name,
            removed_object_name: null,
            scene_saved: false,
            target_missing_handling: "already_missing_idempotent" as const,
            evidence_timestamp: "2026-05-05T10:11:00.000Z",
            raw_evidence_summary: `Controlled Unity rollback found ${input.object_name} already missing.`,
            summary: `Controlled Unity rollback found target ${input.object_name} already missing in EnemyAIDemo.`,
            recommended_next_operator_action: "Review controlled rollback evidence.",
          };
        },
      },
    },
  );

  assert.equal(result.execution_status, "success");
  assert.equal(result.actions_executed_count, 2);
  assert.equal(result.final_scene_state.object_count_before, 13);
  assert.equal(result.final_scene_state.object_count_after, 13);
  assert.equal(result.per_action_results[0]?.result?.execution_kind, "controlled_rollback_idempotent");
  assert.equal(result.per_action_results[1]?.result?.execution_kind, "controlled_rollback_idempotent");
});

test("simulated recovery loop remains repeatable across two bounded runs", async () => {
  let objectPresent = false;
  let objectCount = 13;

  const runRecoveryLoop = async () => {
    const chainResult = await executeUnityMutationExecutionChain(createChainExecutionInput({
      failure_simulation: createFailureSimulation({
        target_action_id: "rollback-probe",
        failure_kind: "simulated_action_failure",
      }),
      actions: [
        createCreationReadinessAction({
          action_id: "create-probe",
          target_object_name: "AIE_ControlledMutationProbe",
          live_validation_result: createLiveValidationResult({ object_count: objectCount }),
        }),
        createRollbackReadinessAction({
          action_id: "rollback-probe",
          target_object_name: "AIE_ControlledMutationProbe",
          depends_on: ["create-probe"],
          live_validation_result: createLiveValidationResult({ object_count: objectCount + 1 }),
        }),
      ],
    }), {
      runtime_bridge: {
        async probeValidation() {
          return createTrackedStateSnapshot({
            objectCount,
            targetExists: objectPresent,
            timestamp: new Date().toISOString(),
          });
        },
      },
      mutation_bridge: {
        async executeSceneObjectCreation(input) {
          assert.equal(objectPresent, false);
          objectPresent = true;
          objectCount += 1;
          return {
            bridge_status: "bridge_ready" as const,
            source: "command_probe" as const,
            mutation_status: "mutation_executed" as const,
            mutation_type: "scene_object_creation_request" as const,
            target_scene: input.target_scene,
            object_name: input.object_name,
            created_object_name: input.object_name,
            scene_saved: true,
            duplicate_handling: "created" as const,
            evidence_timestamp: new Date().toISOString(),
            raw_evidence_summary: "Controlled Unity mutation created the probe object.",
            summary: `Controlled Unity mutation created object ${input.object_name} in ${input.target_scene} with scene_saved true.`,
            rollback_hint: "Rollback requires separate approval.",
            recommended_next_operator_action: "Review controlled mutation evidence.",
          };
        },
        async executeSceneObjectRemoval() {
          throw new Error("the simulated second action must not execute during the chain run");
        },
      },
    });

    assert.equal(chainResult.execution_status, "partial_failure");
    assert.equal(chainResult.final_scene_state.object_count_before, 13);
    assert.equal(chainResult.final_scene_state.object_count_after, 14);
    assert.equal(objectCount, 14);
    assert.equal(objectPresent, true);
    assert.ok(chainResult.review_package?.risks.includes("SIMULATED FAILURE"));
    assert.ok(chainResult.review_package?.risks.includes("ROLLBACK PLAN GENERATED"));
    assert.ok(chainResult.review_package?.risks.includes("ROLLBACK NOT AUTO-EXECUTED"));

    const rollbackResult = await executePlannedUnityRollbackFromChain(
      createPlannedRollbackExecutionInput(chainResult, {
        rollback_actions: [
          createPlannedRollbackActionInput({
            source_action_id: "create-probe",
            live_validation_result: createLiveValidationResult({ object_count: objectCount }),
          }),
        ],
      }),
      {
        mutation_bridge: {
          async executeSceneObjectCreation() {
            throw new Error("should not execute creation during manual rollback");
          },
          async executeSceneObjectRemoval(input) {
            assert.equal(objectPresent, true);
            objectPresent = false;
            objectCount -= 1;
            return {
              bridge_status: "bridge_ready" as const,
              source: "command_probe" as const,
              rollback_status: "rollback_executed" as const,
              rollback_type: "scene_object_removal" as const,
              target_scene: input.target_scene,
              object_name: input.object_name,
              removed_object_name: input.object_name,
              scene_saved: true,
              target_missing_handling: "removed" as const,
              evidence_timestamp: new Date().toISOString(),
              raw_evidence_summary: "Controlled Unity rollback removed the probe object.",
              summary: `Controlled Unity rollback removed target ${input.object_name} in ${input.target_scene} with scene_saved true.`,
              recommended_next_operator_action: "Review controlled rollback evidence.",
            };
          },
        },
      },
    );

    assert.equal(rollbackResult.execution_status, "success");
    assert.equal(rollbackResult.auto_execute, false);
    assert.equal(rollbackResult.manual_trigger, true);
    assert.equal(rollbackResult.final_scene_state.object_count_before, 14);
    assert.equal(rollbackResult.final_scene_state.object_count_after, 13);
    assert.equal(objectCount, 13);
    assert.equal(objectPresent, false);
    assert.ok(rollbackResult.review_package?.proof_results.includes("MANUAL ROLLBACK EXECUTED"));
  };

  await runRecoveryLoop();
  await runRecoveryLoop();

  assert.equal(objectCount, 13);
  assert.equal(objectPresent, false);
});

test("manual Unity rollback from a reviewed chain plan reports missing-target idempotency explicitly", async () => {
  const sourceExecutionResult = await createPartialFailureChainExecutionResult();

  const result = await executePlannedUnityRollbackFromChain(
    createPlannedRollbackExecutionInput(sourceExecutionResult),
    {
      mutation_bridge: {
        async executeSceneObjectCreation() {
          throw new Error("should not execute creation during manual rollback");
        },
        async executeSceneObjectRemoval(input) {
          return {
            bridge_status: "bridge_ready" as const,
            source: "command_probe" as const,
            rollback_status: "rollback_idempotent" as const,
            rollback_type: "scene_object_removal" as const,
            target_scene: input.target_scene,
            object_name: input.object_name,
            removed_object_name: null,
            scene_saved: true,
            target_missing_handling: "already_missing_idempotent" as const,
            evidence_timestamp: "2026-05-06T10:05:00.000Z",
            raw_evidence_summary: "Controlled Unity rollback confirmed the target was already absent.",
            summary: "Controlled Unity rollback confirmed the target was already missing in EnemyAIDemo with scene_saved true.",
            recommended_next_operator_action: "Review controlled rollback idempotency evidence.",
          };
        },
      },
    },
  );

  assert.equal(result.execution_status, "success");
  assert.equal(result.auto_execute, false);
  assert.equal(result.manual_trigger, true);
  assert.equal(result.final_scene_state.object_count_before, 14);
  assert.equal(result.final_scene_state.object_count_after, 14);
  assert.equal(result.final_scene_state.object_count_delta, 0);
  assert.equal(result.per_action_results[0]?.result?.execution_kind, "controlled_rollback_idempotent");
  assert.equal(result.per_action_results[0]?.result?.target_missing_handling, "already_missing_idempotent");
  assert.ok(result.review_package?.proof_results.includes("Target missing handling: already_missing_idempotent"));
  assert.ok(result.review_package?.risks.includes("TARGET ALREADY MISSING"));
  assert.ok(result.delivery_package?.proof_results.includes("TARGET ALREADY MISSING"));
});

test("simulated runtime unavailable is classified distinctly and rollback remains manual", async () => {
  const result = await executeUnityMutationExecutionChain(createChainExecutionInput({
    failure_simulation: createFailureSimulation({
      target_action_id: "rollback-probe",
      failure_kind: "simulated_runtime_unavailable",
    }),
  }), {
    runtime_bridge: createSequencedRuntimeBridge([
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 13, targetExists: false }),
      createTrackedStateSnapshot({ objectCount: 14, targetExists: true }),
      createTrackedStateSnapshot({ objectCount: 14, targetExists: true }),
    ]),
    mutation_bridge: {
      async executeSceneObjectCreation(input) {
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          mutation_status: "mutation_executed" as const,
          mutation_type: "scene_object_creation_request" as const,
          target_scene: input.target_scene,
          object_name: input.object_name,
          created_object_name: input.object_name,
          scene_saved: true,
          duplicate_handling: "created" as const,
          evidence_timestamp: "2026-05-04T10:04:00.000Z",
          raw_evidence_summary: "Controlled Unity mutation created the probe object.",
          summary: "Controlled Unity mutation created object AIE_ControlledMutationProbe in EnemyAIDemo with scene_saved true.",
          rollback_hint: "Rollback requires separate approval.",
          recommended_next_operator_action: "Review controlled mutation evidence.",
        };
      },
      async executeSceneObjectRemoval() {
        throw new Error("should not execute rollback when runtime unavailable is simulated");
      },
    },
  });

  assert.equal(result.execution_status, "partial_failure");
  assert.equal(result.failure_classification, "simulated_runtime_unavailable");
  assert.equal(result.failure_source, "simulation");
  assert.equal(result.failure_is_simulated, true);
  assert.equal(result.failure_simulated, true);
  assert.equal(result.rollback_plan_required, true);
  assert.equal(result.rollback_plan?.auto_execute, false);
  assert.equal(result.rollback_plan?.executed, false);
});

test("controlled Unity chain failure evidence classifies dependency failures distinctly", () => {
  const evidence = classifyUnityChainFailureEvidence({
    context: "chain",
    blockedReason: "Controlled Unity chain action rollback-probe cannot run until dependencies succeed: create-probe.",
    failedActionResult: null,
    simulatedFailureKind: null,
  });

  assert.equal(evidence.classification, "dependency_failed");
  assert.equal(evidence.source, "dependency");
  assert.equal(evidence.is_simulated, false);
  assert.equal(evidence.is_recoverable, true);
  assert.equal(evidence.requires_manual_review, false);
});

test("controlled Unity chain execution classifies ambiguous blocked evidence as unknown failure", async () => {
  const evidence = classifyUnityChainFailureEvidence({
    context: "chain",
    blockedReason: "Unexpected executor interruption without a classified failure reason.",
    failedActionResult: null,
    simulatedFailureKind: null,
  });

  assert.equal(evidence.classification, "unknown_failure");
  assert.equal(evidence.source, "unknown");
  assert.equal(evidence.requires_manual_review, true);
  assert.match(evidence.summary, /Ambiguous failure evidence/i);
});

test("manual Unity rollback from a reviewed chain plan executes successfully", async () => {
  const sourceExecutionResult = await createPartialFailureChainExecutionResult();
  const calls: string[] = [];

  const result = await executePlannedUnityRollbackFromChain(
    createPlannedRollbackExecutionInput(sourceExecutionResult),
    {
      mutation_bridge: {
        async executeSceneObjectCreation() {
          throw new Error("should not execute creation during manual rollback");
        },
        async executeSceneObjectRemoval(input) {
          calls.push(`rollback:${input.object_name}`);
          return {
            bridge_status: "bridge_ready" as const,
            source: "command_probe" as const,
            rollback_status: "rollback_executed" as const,
            rollback_type: "scene_object_removal" as const,
            target_scene: input.target_scene,
            object_name: input.object_name,
            removed_object_name: input.object_name,
            scene_saved: true,
            target_missing_handling: "removed" as const,
            evidence_timestamp: "2026-05-03T12:23:00.000Z",
            raw_evidence_summary: "Controlled Unity rollback removed the probe object.",
            summary: "Controlled Unity rollback removed target AIE_ControlledMutationProbe in EnemyAIDemo with scene_saved true.",
            recommended_next_operator_action: "Review controlled rollback evidence.",
          };
        },
      },
    },
  );

  assert.deepEqual(calls, ["rollback:AIE_ControlledMutationProbe"]);
  assert.equal(result.rollback_plan_id, sourceExecutionResult.rollback_plan?.rollback_plan_id ?? null);
  assert.equal(result.execution_status, "success");
  assert.equal(result.execution_kind, "planned_chain_rollback_executed");
  assert.equal(result.executed, true);
  assert.equal(result.actions_executed_count, 1);
  assert.equal(result.actions_failed_count, 0);
  assert.equal(result.failure_classification, "none");
  assert.deepEqual(result.remaining_actions_not_executed, []);
  assert.equal(result.final_scene_state.object_count_before, 14);
  assert.equal(result.final_scene_state.object_count_after, 13);
  assert.equal(result.final_scene_state.object_count_delta, -1);
  assert.equal(result.manual_trigger, true);
  assert.equal(result.auto_execute, false);
  assert.ok(result.review_package?.proof_results.includes("MANUAL ROLLBACK EXECUTED"));
  assert.ok(result.delivery_package?.proof_results.includes("MANUAL ROLLBACK EXECUTED"));
});

test("manual Unity rollback from a reviewed chain plan blocks when rollback approval is missing", async () => {
  const sourceExecutionResult = await createPartialFailureChainExecutionResult();
  let callCount = 0;

  const result = await executePlannedUnityRollbackFromChain(
    createPlannedRollbackExecutionInput(sourceExecutionResult, {
      review_state: createRollbackExecutionReviewState({
        review_package_id: null,
        review_completed_at: null,
      }),
    }),
    {
      mutation_bridge: {
        async executeSceneObjectCreation() {
          callCount += 1;
          throw new Error("should not execute creation during blocked rollback");
        },
        async executeSceneObjectRemoval() {
          callCount += 1;
          throw new Error("should not execute rollback during blocked rollback");
        },
      },
    },
  );

  assert.equal(result.execution_kind, "planned_chain_rollback_blocked");
  assert.equal(result.execution_status, "failed");
  assert.equal(result.failure_classification, "gate_mismatch");
  assert.equal(result.failure_source, "gate");
  assert.equal(result.executed, false);
  assert.equal(callCount, 0);
  assert.match(result.blocked_reason ?? "", /separate completed rollback review approval/i);
});

test("manual Unity rollback from a reviewed chain plan blocks when the final rollback switch is missing", async () => {
  const sourceExecutionResult = await createPartialFailureChainExecutionResult();
  let callCount = 0;

  const result = await executePlannedUnityRollbackFromChain(
    createPlannedRollbackExecutionInput(sourceExecutionResult, {
      rollback_actions: [
        createPlannedRollbackActionInput({
          source_action_id: "create-probe",
          rollback_switch: null,
          execution_plan: buildUnitySceneObjectCreationRollbackPlan({
            adapter_request_id: "unity-chain-rollback-1:create-probe",
            requested_at: "2026-05-03T12:24:00.000Z",
            planning_packet: createSceneObjectCreationPacket(),
            requested_actions: [],
            review_state: createRollbackExecutionReviewState(),
            target_scene: "EnemyAIDemo",
            target_object_name: "AIE_ControlledMutationProbe",
            authorization: {
              final_rollback_authorization_id: "manual-rollback-auth-create-probe",
              authorized_by_operator: true,
              authorized_at: "2026-05-03T12:16:00.000Z",
              authorization_scope: "scene_object_removal",
              target_request_id: "unity-chain-rollback-1:create-probe",
              target_scene: "EnemyAIDemo",
              target_object_name: "AIE_ControlledMutationProbe",
              expires_at: "2026-05-03T13:00:00.000Z",
            },
            rollback_switch: null,
            live_validation_result: createLiveValidationResult({ object_count: 14 }),
            rollback_execution_mode_enabled: true,
          }),
        }),
      ],
    }),
    {
      mutation_bridge: {
        async executeSceneObjectCreation() {
          callCount += 1;
          throw new Error("should not execute creation during blocked rollback");
        },
        async executeSceneObjectRemoval() {
          callCount += 1;
          throw new Error("should not execute rollback without switch");
        },
      },
    },
  );

  assert.equal(result.execution_status, "failed");
  assert.equal(result.actions_executed_count, 0);
  assert.equal(result.actions_failed_count, 1);
  assert.equal(result.failure_classification, "gate_mismatch");
  assert.equal(callCount, 0);
  assert.equal(result.per_action_results[0]?.status, "failed");
  assert.match(result.per_action_results[0]?.failure_reason ?? "", /rollback switch/i);
});

test("manual Unity rollback from a reviewed chain plan blocks the wrong target object", async () => {
  const sourceExecutionResult = await createPartialFailureChainExecutionResult();
  let callCount = 0;

  const result = await executePlannedUnityRollbackFromChain(
    createPlannedRollbackExecutionInput(sourceExecutionResult, {
      rollback_actions: [
        createPlannedRollbackActionInput({
          source_action_id: "create-probe",
          target_object_name: "WrongProbe",
        }),
      ],
    }),
    {
      mutation_bridge: {
        async executeSceneObjectCreation() {
          callCount += 1;
          throw new Error("should not execute creation during blocked rollback");
        },
        async executeSceneObjectRemoval() {
          callCount += 1;
          throw new Error("should not execute rollback for wrong target");
        },
      },
    },
  );

  assert.equal(result.execution_status, "failed");
  assert.equal(result.actions_executed_count, 0);
  assert.equal(result.actions_failed_count, 1);
  assert.equal(result.failure_classification, "gate_mismatch");
  assert.equal(callCount, 0);
  assert.match(result.per_action_results[0]?.failure_reason ?? "", /AIE_ControlledMutationProbe/i);
});

test("manual Unity rollback from a reviewed chain plan stops on the first failure", async () => {
  const sourceExecutionResult = await createPartialFailureChainExecutionResult();
  const calls: string[] = [];

  const result = await executePlannedUnityRollbackFromChain(
    createPlannedRollbackExecutionInput(sourceExecutionResult, {
      rollback_plan: {
        rollback_plan_id: "unity-chain-rollback-plan-unity-controlled-chain-1",
        source_chain_id: sourceExecutionResult.chain_id,
        actions_to_rollback: ["create-probe", "create-probe-2"],
        rollback_order: ["create-probe", "create-probe-2"],
        rollback_targets: [
          {
            order: 1,
            source_action_id: "create-probe",
            rollback_action_type: "unity_scene_object_removal",
            target_scene: "EnemyAIDemo",
            target_object_name: PRIMARY_CHAIN_OBJECT_NAME,
          },
          {
            order: 2,
            source_action_id: "create-probe-2",
            rollback_action_type: "unity_scene_object_removal",
            target_scene: "EnemyAIDemo",
            target_object_name: PRIMARY_CHAIN_OBJECT_NAME,
          },
        ],
        rollback_target_count: 2,
        rollback_reason: "Controlled rollback is required after the reviewed chain stopped.",
        required_approvals: [
          "explicit rollback plan review approval",
          "explicit final rollback authorization",
          "explicit final rollback switch enablement",
        ],
        auto_execute: false,
        executed: false,
      },
      rollback_actions: [
        createPlannedRollbackActionInput({ source_action_id: "create-probe" }),
        createPlannedRollbackActionInput({
          source_action_id: "create-probe-2",
          rollback_request_id: "unity-chain-rollback-1:create-probe-2",
        }),
      ],
    }),
    {
      mutation_bridge: {
        async executeSceneObjectCreation() {
          throw new Error("should not execute creation during manual rollback");
        },
        async executeSceneObjectRemoval(input) {
          calls.push(`rollback:${input.request_id}`);
          if (input.request_id.endsWith("create-probe")) {
            return {
              bridge_status: "bridge_ready" as const,
              source: "command_probe" as const,
              rollback_status: "rollback_executed" as const,
              rollback_type: "scene_object_removal" as const,
              target_scene: input.target_scene,
              object_name: input.object_name,
              removed_object_name: input.object_name,
              scene_saved: true,
              target_missing_handling: "removed" as const,
              evidence_timestamp: "2026-05-03T12:25:00.000Z",
              raw_evidence_summary: "Controlled Unity rollback removed the probe object.",
              summary: "Controlled Unity rollback removed target AIE_ControlledMutationProbe in EnemyAIDemo with scene_saved true.",
              recommended_next_operator_action: "Review controlled rollback evidence.",
            };
          }

          return {
            bridge_status: "bridge_failure" as const,
            source: "command_probe" as const,
            reason: "Unity rollback bridge reported a controlled failure.",
            evidence_timestamp: "2026-05-03T12:26:00.000Z",
            raw_evidence_summary: "Controlled Unity rollback failed.",
            recommended_next_operator_action: "Investigate the rollback failure.",
          };
        },
      },
    },
  );

  assert.deepEqual(calls, [
    "rollback:unity-chain-rollback-1:create-probe",
    "rollback:unity-chain-rollback-1:create-probe-2",
  ]);
  assert.equal(result.execution_status, "partial_failure");
  assert.equal(result.execution_kind, "planned_chain_rollback_partial_failure");
  assert.equal(result.actions_executed_count, 1);
  assert.equal(result.actions_failed_count, 1);
  assert.equal(result.failure_classification, "rollback_failed");
  assert.equal(result.failure_source, "rollback");
  assert.equal(result.failure_is_recoverable, true);
  assert.equal(result.failure_requires_manual_review, true);
  assert.deepEqual(result.remaining_actions_not_executed, []);
  assert.equal(result.per_action_results[0]?.status, "executed");
  assert.equal(result.per_action_results[1]?.status, "failed");
});

test("manual Unity rollback from a reviewed chain plan persists rollback execution evidence", async () => {
  const sourceExecutionResult = await createPartialFailureChainExecutionResult();
  const result = await executePlannedUnityRollbackFromChain(
    createPlannedRollbackExecutionInput(sourceExecutionResult),
    {
      mutation_bridge: {
        async executeSceneObjectCreation() {
          throw new Error("should not execute creation during manual rollback");
        },
        async executeSceneObjectRemoval(input) {
          return {
            bridge_status: "bridge_ready" as const,
            source: "command_probe" as const,
            rollback_status: "rollback_executed" as const,
            rollback_type: "scene_object_removal" as const,
            target_scene: input.target_scene,
            object_name: input.object_name,
            removed_object_name: input.object_name,
            scene_saved: true,
            target_missing_handling: "removed" as const,
            evidence_timestamp: "2026-05-03T12:27:00.000Z",
            raw_evidence_summary: "Controlled Unity rollback removed the probe object.",
            summary: "Controlled Unity rollback removed target AIE_ControlledMutationProbe in EnemyAIDemo with scene_saved true.",
            recommended_next_operator_action: "Review controlled rollback evidence.",
          };
        },
      },
    },
  );

  assert.equal(result.evidence_timestamp, "2026-05-03T12:27:00.000Z");
  assert.match(result.review_package?.summary ?? "", /ROLLBACK EXECUTION/i);
  assert.ok(result.review_package?.proof_results.includes("Manual trigger: true"));
  assert.ok(result.delivery_package?.validation_results.includes("Evidence timestamp: 2026-05-03T12:27:00.000Z"));
});