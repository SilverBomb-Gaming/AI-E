import assert from "node:assert/strict";
import test from "node:test";

import { buildUnityProductionPlanningPacket } from "./productionPipelineFoundation";
import {
  buildUnitySceneObjectCreationExecutionPlan,
  buildUnitySceneObjectCreationRollbackPlan,
  evaluateUnityMutationExecutionSwitch,
  evaluateUnityMutationExecutionAuthorization,
  executeUnitySceneObjectCreationRollback,
  executeUnitySceneObjectCreationMutation,
  previewUnitySceneObjectCreation,
  simulateUnityMutationExecutionPreflight,
} from "./unityProductionAdapter";

function createSceneObjectCreationPacket() {
  const packet = buildUnityProductionPlanningPacket(
    "prepare a Unity scene object creation preview for adding a checkpoint anchor object to the EnemyAIDemo scene",
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
    required_review_artifacts: ["scene object creation preview", "mutation rollback plan"],
    required_approval_gates: [
      "operator planning approval",
      "review package approval",
      "operator approval",
      "dry-run preview approval",
      "explicit final execute gate",
    ],
  };
}

function createPreviewInput(overrides: Partial<Parameters<typeof previewUnitySceneObjectCreation>[0]> = {}) {
  return {
    adapter_request_id: "unity-mutation-preview-1",
    requested_at: "2026-04-30T18:00:00.000Z",
    planning_packet: createSceneObjectCreationPacket(),
    requested_actions: [],
    review_state: {
      review_package_id: "review-preview-1",
      review_completed_at: "2026-04-30T18:00:10.000Z",
      approved_by_operator: true,
      operator_approval_id: "approval-preview-1",
      delivery_package_id: "delivery-preview-1",
    },
    dry_run: true,
    requested_object_name: "CheckpointAnchor",
    target_scene: "EnemyAIDemo",
    intended_components: ["Transform", "BoxCollider"],
    intended_transform: {
      position: { x: 4, y: 1, z: 0 },
      rotation_euler: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    ...overrides,
  };
}

function createLiveValidationResult(
  overrides: Partial<Parameters<typeof buildUnitySceneObjectCreationExecutionPlan>[0]["live_validation_result"] extends infer T ? NonNullable<T> : never> = {},
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

function createExecutionPlanInput(
  overrides: Partial<Parameters<typeof buildUnitySceneObjectCreationExecutionPlan>[0]> = {},
) {
  const preview_result = overrides.preview_result ?? previewUnitySceneObjectCreation(createPreviewInput());
  const authorization = overrides.authorization ?? {
    final_execution_authorization_id: "final-auth-plan-1",
    authorized_by_operator: true,
    authorized_at: "2026-04-30T18:05:00.000Z",
    authorization_scope: "scene_object_creation_request" as const,
    target_request_id: preview_result.request_id,
    expires_at: "2026-04-30T19:00:00.000Z",
  };
  const preflight_result = overrides.preflight_result ?? simulateUnityMutationExecutionPreflight({
    ...createPreviewInput(),
    authorization,
    known_target_scene_names: ["EnemyAIDemo"],
    known_scene_object_names: ["SpawnAnchor"],
  });

  return {
    ...createPreviewInput(),
    preview_result,
    preflight_result,
    authorization,
    mutation_switch: {
      mutation_switch_id: "mutation-switch-1",
      switch_enabled: true,
      enabled_by_operator: true,
      enabled_at: "2026-04-30T18:06:00.000Z",
      target_request_id: preview_result.request_id,
      allowed_mutation_type: "scene_object_creation_request",
      expires_at: "2026-04-30T19:00:00.000Z",
    },
    live_validation_result: createLiveValidationResult(),
    mutation_execution_mode_enabled: true,
    ...overrides,
  };
}

function createMutationExecutionInput(
  overrides: Partial<Parameters<typeof executeUnitySceneObjectCreationMutation>[0]> = {},
) {
  const planInput = createExecutionPlanInput(overrides);
  const execution_plan = overrides.execution_plan ?? buildUnitySceneObjectCreationExecutionPlan(planInput);

  return {
    ...planInput,
    execution_plan,
    idempotent_on_duplicate: true,
    ...overrides,
  };
}

function createRollbackPlanInput(
  overrides: Partial<Parameters<typeof buildUnitySceneObjectCreationRollbackPlan>[0]> = {},
) {
  return {
    adapter_request_id: "unity-rollback-1",
    requested_at: "2026-05-01T21:00:00.000Z",
    planning_packet: createSceneObjectCreationPacket(),
    requested_actions: [],
    review_state: {
      review_package_id: "rollback-review-1",
      review_completed_at: "2026-05-01T21:00:10.000Z",
      approved_by_operator: true,
      operator_approval_id: "rollback-approval-1",
      delivery_package_id: "rollback-delivery-1",
    },
    target_scene: "EnemyAIDemo",
    target_object_name: "AIE_ControlledMutationProbe",
    authorization: {
      final_rollback_authorization_id: "rollback-auth-1",
      authorized_by_operator: true,
      authorized_at: "2026-05-01T21:05:00.000Z",
      authorization_scope: "scene_object_removal" as const,
      target_request_id: "unity-rollback-1",
      target_scene: "EnemyAIDemo",
      target_object_name: "AIE_ControlledMutationProbe",
      expires_at: "2026-05-01T22:00:00.000Z",
    },
    rollback_switch: {
      rollback_switch_id: "rollback-switch-1",
      switch_enabled: true,
      enabled_by_operator: true,
      enabled_at: "2026-05-01T21:06:00.000Z",
      target_request_id: "unity-rollback-1",
      target_scene: "EnemyAIDemo",
      target_object_name: "AIE_ControlledMutationProbe",
      allowed_rollback_type: "scene_object_removal" as const,
      expires_at: "2026-05-01T22:00:00.000Z",
    },
    live_validation_result: createLiveValidationResult({ object_count: 14 }),
    rollback_execution_mode_enabled: true,
    ...overrides,
  };
}

function createRollbackExecutionInput(
  overrides: Partial<Parameters<typeof executeUnitySceneObjectCreationRollback>[0]> = {},
) {
  const planInput = createRollbackPlanInput(overrides);
  const execution_plan = overrides.execution_plan ?? buildUnitySceneObjectCreationRollbackPlan(planInput);

  return {
    ...planInput,
    execution_plan,
    idempotent_on_missing: true,
    ...overrides,
  };
}

test("scene object creation preview requires review approval", () => {
  const result = previewUnitySceneObjectCreation(createPreviewInput({
    review_state: {
      review_package_id: null,
      review_completed_at: null,
      approved_by_operator: true,
      operator_approval_id: "approval-preview-1",
      delivery_package_id: "delivery-preview-1",
    },
  }));

  assert.equal(result.executed, false);
  assert.equal(result.execution_kind, "preview_blocked");
  assert.equal(result.review_approval_status, "missing");
  assert.match(result.blocked_reason ?? "", /blocked until review approval is recorded/i);
});

test("scene object creation preview requires operator approval", () => {
  const result = previewUnitySceneObjectCreation(createPreviewInput({
    review_state: {
      review_package_id: "review-preview-1",
      review_completed_at: "2026-04-30T18:00:10.000Z",
      approved_by_operator: false,
      operator_approval_id: null,
      delivery_package_id: "delivery-preview-1",
    },
  }));

  assert.equal(result.executed, false);
  assert.equal(result.execution_kind, "preview_blocked");
  assert.equal(result.operator_approval_status, "missing");
  assert.match(result.blocked_reason ?? "", /blocked until operator approval is recorded/i);
});

test("scene object creation preview refuses non-dry-run requests", () => {
  const result = previewUnitySceneObjectCreation(createPreviewInput({ dry_run: false }));

  assert.equal(result.executed, false);
  assert.equal(result.dry_run, false);
  assert.equal(result.execution_kind, "preview_blocked");
  assert.match(result.blocked_reason ?? "", /requires dry_run=true/i);
});

test("scene object creation preview refuses non-mutation packets", () => {
  const validationPacket = buildUnityProductionPlanningPacket(
    "run a Unity validation playtest for the EnemyAIDemo scene",
    "review",
    ["unity-integration"],
  );

  if (!validationPacket) {
    throw new Error("Expected Unity validation packet.");
  }

  const result = previewUnitySceneObjectCreation(createPreviewInput({
    planning_packet: {
      ...validationPacket,
      request_types: ["validation_playtest_request"],
      requests: validationPacket.requests.filter((request) => request.request_type === "validation_playtest_request"),
    },
  }));

  assert.equal(result.executed, false);
  assert.equal(result.execution_kind, "preview_blocked");
  assert.match(result.blocked_reason ?? "", /Only scene_object_creation_request is supported/i);
});

test("scene object creation preview stays deterministic and non-mutating", () => {
  const first = previewUnitySceneObjectCreation(createPreviewInput());
  const second = previewUnitySceneObjectCreation(createPreviewInput());

  assert.deepEqual(first, second);
  assert.equal(first.executed, false);
  assert.equal(first.dry_run, true);
  assert.equal(first.execution_kind, "dry_run_preview");
  assert.equal(first.requested_object_name, "CheckpointAnchor");
  assert.equal(first.target_scene, "EnemyAIDemo");
  assert.deepEqual(first.intended_components, ["Transform", "BoxCollider"]);
  assert.deepEqual(first.intended_transform.position, { x: 4, y: 1, z: 0 });
  assert.equal(first.risk_level, "medium");
  assert.ok(first.required_approval_gates.includes("explicit final execute gate"));
  assert.equal(first.final_execution_required, true);
  assert.equal(first.final_execution_authorized, false);
  assert.equal(first.executed, false);
  assert.ok(first.review_package);
  assert.ok(first.delivery_package);
  assert.match(first.review_package?.summary ?? "", /DRY RUN ONLY/i);
  assert.match(first.delivery_package?.release_notes ?? "", /NOT EXECUTED/i);
  assert.match(first.delivery_package?.risk_summary ?? "", /Final execution not authorized/i);
  assert.equal(first.mutating, false);
});

test("missing final authorization blocks future Unity mutation execution", () => {
  const preview = previewUnitySceneObjectCreation(createPreviewInput());
  const result = evaluateUnityMutationExecutionAuthorization({
    preview_result: preview,
    authorization: null,
    evaluated_at: "2026-04-30T18:10:00.000Z",
  });

  assert.equal(result.authorized, false);
  assert.equal(result.request_id, preview.request_id);
  assert.equal(result.final_execution_authorization_id, null);
  assert.match(result.blocked_reason ?? "", /until a final execution authorization is recorded/i);
});

test("wrong target request id blocks final authorization", () => {
  const preview = previewUnitySceneObjectCreation(createPreviewInput());
  const result = evaluateUnityMutationExecutionAuthorization({
    preview_result: preview,
    authorization: {
      final_execution_authorization_id: "final-auth-1",
      authorized_by_operator: true,
      authorized_at: "2026-04-30T18:05:00.000Z",
      authorization_scope: "scene_object_creation_request",
      target_request_id: "another-request",
      expires_at: "2026-04-30T19:00:00.000Z",
    },
    evaluated_at: "2026-04-30T18:10:00.000Z",
  });

  assert.equal(result.authorized, false);
  assert.equal(result.target_request_match, false);
  assert.match(result.blocked_reason ?? "", /target request id does not match/i);
});

test("wrong authorization scope blocks final authorization", () => {
  const preview = previewUnitySceneObjectCreation(createPreviewInput());
  const result = evaluateUnityMutationExecutionAuthorization({
    preview_result: preview,
    authorization: {
      final_execution_authorization_id: "final-auth-2",
      authorized_by_operator: true,
      authorized_at: "2026-04-30T18:05:00.000Z",
      authorization_scope: "scene_request" as "scene_object_creation_request",
      target_request_id: preview.request_id,
      expires_at: "2026-04-30T19:00:00.000Z",
    },
    evaluated_at: "2026-04-30T18:10:00.000Z",
  });

  assert.equal(result.authorized, false);
  assert.equal(result.scope_match, false);
  assert.match(result.blocked_reason ?? "", /scope does not match/i);
});

test("expired final authorization blocks future Unity mutation execution", () => {
  const preview = previewUnitySceneObjectCreation(createPreviewInput());
  const result = evaluateUnityMutationExecutionAuthorization({
    preview_result: preview,
    authorization: {
      final_execution_authorization_id: "final-auth-3",
      authorized_by_operator: true,
      authorized_at: "2026-04-30T18:05:00.000Z",
      authorization_scope: "scene_object_creation_request",
      target_request_id: preview.request_id,
      expires_at: "2026-04-30T18:09:00.000Z",
    },
    evaluated_at: "2026-04-30T18:10:00.000Z",
  });

  assert.equal(result.authorized, false);
  assert.equal(result.expiration_status, "expired");
  assert.match(result.blocked_reason ?? "", /authorization has expired/i);
});

test("valid final authorization reports authorized without executing mutation", () => {
  const preview = previewUnitySceneObjectCreation(createPreviewInput());
  const result = evaluateUnityMutationExecutionAuthorization({
    preview_result: preview,
    authorization: {
      final_execution_authorization_id: "final-auth-4",
      authorized_by_operator: true,
      authorized_at: "2026-04-30T18:05:00.000Z",
      authorization_scope: "scene_object_creation_request",
      target_request_id: preview.request_id,
      expires_at: "2026-04-30T19:00:00.000Z",
    },
    evaluated_at: "2026-04-30T18:10:00.000Z",
  });

  assert.equal(result.authorized, true);
  assert.equal(result.scope_match, true);
  assert.equal(result.target_request_match, true);
  assert.equal(result.expiration_status, "valid");
  assert.equal(preview.executed, false);
  assert.equal(preview.final_execution_authorized, false);
});

test("missing mutation switch blocks future Unity mutation execution", () => {
  const result = evaluateUnityMutationExecutionSwitch({
    request_id: "unity-mutation-preview-1",
    request_type: "scene_object_creation_request",
    mutation_switch: null,
    evaluated_at: "2026-04-30T18:10:00.000Z",
  });

  assert.equal(result.enabled, false);
  assert.equal(result.mutation_switch_id, null);
  assert.match(result.blocked_reason ?? "", /until a final mutation switch is recorded/i);
});

test("wrong switch target request id blocks future Unity mutation execution", () => {
  const result = evaluateUnityMutationExecutionSwitch({
    request_id: "unity-mutation-preview-1",
    request_type: "scene_object_creation_request",
    mutation_switch: {
      mutation_switch_id: "mutation-switch-2",
      switch_enabled: true,
      enabled_by_operator: true,
      enabled_at: "2026-04-30T18:06:00.000Z",
      target_request_id: "another-request",
      allowed_mutation_type: "scene_object_creation_request",
      expires_at: "2026-04-30T19:00:00.000Z",
    },
    evaluated_at: "2026-04-30T18:10:00.000Z",
  });

  assert.equal(result.enabled, false);
  assert.equal(result.switch_target_request_match, false);
  assert.match(result.blocked_reason ?? "", /target request id does not match/i);
});

test("wrong switch mutation type blocks future Unity mutation execution", () => {
  const result = evaluateUnityMutationExecutionSwitch({
    request_id: "unity-mutation-preview-1",
    request_type: "scene_object_creation_request",
    mutation_switch: {
      mutation_switch_id: "mutation-switch-3",
      switch_enabled: true,
      enabled_by_operator: true,
      enabled_at: "2026-04-30T18:06:00.000Z",
      target_request_id: "unity-mutation-preview-1",
      allowed_mutation_type: "scene_request" as "scene_object_creation_request",
      expires_at: "2026-04-30T19:00:00.000Z",
    },
    evaluated_at: "2026-04-30T18:10:00.000Z",
  });

  assert.equal(result.enabled, false);
  assert.equal(result.allowed_mutation_type_match, false);
  assert.match(result.blocked_reason ?? "", /allowed mutation type does not match/i);
});

test("expired mutation switch blocks future Unity mutation execution", () => {
  const result = evaluateUnityMutationExecutionSwitch({
    request_id: "unity-mutation-preview-1",
    request_type: "scene_object_creation_request",
    mutation_switch: {
      mutation_switch_id: "mutation-switch-4",
      switch_enabled: true,
      enabled_by_operator: true,
      enabled_at: "2026-04-30T18:06:00.000Z",
      target_request_id: "unity-mutation-preview-1",
      allowed_mutation_type: "scene_object_creation_request",
      expires_at: "2026-04-30T18:09:00.000Z",
    },
    evaluated_at: "2026-04-30T18:10:00.000Z",
  });

  assert.equal(result.enabled, false);
  assert.equal(result.switch_expiration_status, "expired");
  assert.match(result.blocked_reason ?? "", /switch has expired/i);
});

test("disabled mutation switch blocks future Unity mutation execution", () => {
  const result = evaluateUnityMutationExecutionSwitch({
    request_id: "unity-mutation-preview-1",
    request_type: "scene_object_creation_request",
    mutation_switch: {
      mutation_switch_id: "mutation-switch-5",
      switch_enabled: false,
      enabled_by_operator: true,
      enabled_at: "2026-04-30T18:06:00.000Z",
      target_request_id: "unity-mutation-preview-1",
      allowed_mutation_type: "scene_object_creation_request",
      expires_at: "2026-04-30T19:00:00.000Z",
    },
    evaluated_at: "2026-04-30T18:10:00.000Z",
  });

  assert.equal(result.enabled, false);
  assert.match(result.blocked_reason ?? "", /remains disabled/i);
});

test("valid mutation switch reports enabled without executing mutation", () => {
  const result = evaluateUnityMutationExecutionSwitch({
    request_id: "unity-mutation-preview-1",
    request_type: "scene_object_creation_request",
    mutation_switch: {
      mutation_switch_id: "mutation-switch-6",
      switch_enabled: true,
      enabled_by_operator: true,
      enabled_at: "2026-04-30T18:06:00.000Z",
      target_request_id: "unity-mutation-preview-1",
      allowed_mutation_type: "scene_object_creation_request",
      expires_at: "2026-04-30T19:00:00.000Z",
    },
    evaluated_at: "2026-04-30T18:10:00.000Z",
  });

  assert.equal(result.enabled, true);
  assert.equal(result.switch_target_request_match, true);
  assert.equal(result.allowed_mutation_type_match, true);
  assert.equal(result.switch_expiration_status, "valid");
  assert.equal(result.mutation_switch_id, "mutation-switch-6");
});

test("missing review approval blocks Unity mutation execution preflight", () => {
  const result = simulateUnityMutationExecutionPreflight({
    ...createPreviewInput({
      review_state: {
        review_package_id: null,
        review_completed_at: null,
        approved_by_operator: true,
        operator_approval_id: "approval-preview-1",
        delivery_package_id: "delivery-preview-1",
      },
    }),
    authorization: {
      final_execution_authorization_id: "final-auth-preflight-1",
      authorized_by_operator: true,
      authorized_at: "2026-04-30T18:05:00.000Z",
      authorization_scope: "scene_object_creation_request",
      target_request_id: "unity-mutation-preview-1",
      expires_at: "2026-04-30T19:00:00.000Z",
    },
  });

  assert.equal(result.preflight_state, "blocked");
  assert.equal(result.review_approval_status, "missing");
  assert.equal(result.dry_run, true);
  assert.equal(result.executed, false);
  assert.match(result.recommended_operator_action, /blocked until review approval is recorded/i);
});

test("missing operator approval blocks Unity mutation execution preflight", () => {
  const result = simulateUnityMutationExecutionPreflight({
    ...createPreviewInput({
      review_state: {
        review_package_id: "review-preview-1",
        review_completed_at: "2026-04-30T18:00:10.000Z",
        approved_by_operator: false,
        operator_approval_id: null,
        delivery_package_id: "delivery-preview-1",
      },
    }),
    authorization: {
      final_execution_authorization_id: "final-auth-preflight-2",
      authorized_by_operator: true,
      authorized_at: "2026-04-30T18:05:00.000Z",
      authorization_scope: "scene_object_creation_request",
      target_request_id: "unity-mutation-preview-1",
      expires_at: "2026-04-30T19:00:00.000Z",
    },
  });

  assert.equal(result.preflight_state, "blocked");
  assert.equal(result.operator_approval_status, "missing");
  assert.equal(result.dry_run, true);
  assert.equal(result.executed, false);
  assert.match(result.recommended_operator_action, /blocked until operator approval is recorded/i);
});

test("missing final authorization blocks execution-readiness during Unity mutation preflight", () => {
  const result = simulateUnityMutationExecutionPreflight({
    ...createPreviewInput(),
    authorization: null,
  });

  assert.equal(result.preflight_state, "blocked");
  assert.equal(result.authorization_evaluation.authorized, false);
  assert.equal(result.dry_run, true);
  assert.equal(result.executed, false);
  assert.match(result.authorization_evaluation.blocked_reason ?? "", /until a final execution authorization is recorded/i);
});

test("valid final authorization produces Unity mutation preflight simulation", () => {
  const result = simulateUnityMutationExecutionPreflight({
    ...createPreviewInput(),
    authorization: {
      final_execution_authorization_id: "final-auth-preflight-3",
      authorized_by_operator: true,
      authorized_at: "2026-04-30T18:05:00.000Z",
      authorization_scope: "scene_object_creation_request",
      target_request_id: "unity-mutation-preview-1",
      expires_at: "2026-04-30T19:00:00.000Z",
    },
    known_target_scene_names: ["EnemyAIDemo"],
    known_scene_object_names: ["SpawnAnchor"],
  });

  assert.equal(result.preflight_state, "simulation");
  assert.equal(result.authorization_evaluation.authorized, true);
  assert.deepEqual(result.predicted_created_objects, ["CheckpointAnchor"]);
  assert.ok(result.predicted_affected_objects.includes("Scene:EnemyAIDemo"));
  assert.equal(result.dry_run, true);
  assert.equal(result.executed, false);
  assert.ok(result.review_package);
  assert.ok(result.delivery_package);
  assert.match(result.review_package?.summary ?? "", /PREFLIGHT SIMULATION/i);
  assert.match(result.delivery_package?.release_notes ?? "", /NO UNITY MUTATION PERFORMED/i);
});

test("Unity mutation execution preflight detects conflicts deterministically", () => {
  const result = simulateUnityMutationExecutionPreflight({
    ...createPreviewInput({
      requested_object_name: "CheckpointAnchor",
      target_scene: "MissingScene",
      intended_components: ["Transform", "UnsupportedMover"],
      intended_transform: {
        position: { x: Number.NaN, y: 1, z: 0 },
        rotation_euler: { x: 0, y: 0, z: 0 },
        scale: { x: 0, y: 1, z: 1 },
      },
    }),
    authorization: {
      final_execution_authorization_id: "final-auth-preflight-4",
      authorized_by_operator: true,
      authorized_at: "2026-04-30T18:05:00.000Z",
      authorization_scope: "scene_object_creation_request",
      target_request_id: "unity-mutation-preview-1",
      expires_at: "2026-04-30T19:00:00.000Z",
    },
    known_target_scene_names: ["EnemyAIDemo"],
    known_scene_object_names: ["CheckpointAnchor"],
  });

  assert.equal(result.preflight_state, "simulation");
  assert.ok(result.detected_conflicts.some((entry) => /Duplicate object name risk/i.test(entry)));
  assert.ok(result.detected_conflicts.some((entry) => /Missing target scene risk/i.test(entry)));
  assert.ok(result.detected_conflicts.some((entry) => /Unsupported component risk/i.test(entry)));
  assert.ok(result.detected_conflicts.some((entry) => /Invalid transform risk/i.test(entry)));
  assert.equal(result.dry_run, true);
  assert.equal(result.executed, false);
});

test("execution plan requires review approval", () => {
  const result = buildUnitySceneObjectCreationExecutionPlan(createExecutionPlanInput({
    review_state: {
      review_package_id: null,
      review_completed_at: null,
      approved_by_operator: true,
      operator_approval_id: "approval-preview-1",
      delivery_package_id: "delivery-preview-1",
    },
  }));

  assert.equal(result.execution_kind, "execution_plan_blocked");
  assert.equal(result.review_approval_status, "missing");
  assert.match(result.blocked_reason ?? "", /review approval is recorded/i);
  assert.equal(result.mutation_enabled, false);
  assert.equal(result.executed, false);
});

test("execution plan requires operator approval", () => {
  const result = buildUnitySceneObjectCreationExecutionPlan(createExecutionPlanInput({
    review_state: {
      review_package_id: "review-preview-1",
      review_completed_at: "2026-04-30T18:00:10.000Z",
      approved_by_operator: false,
      operator_approval_id: null,
      delivery_package_id: "delivery-preview-1",
    },
  }));

  assert.equal(result.execution_kind, "execution_plan_blocked");
  assert.equal(result.operator_approval_status, "missing");
  assert.match(result.blocked_reason ?? "", /operator approval is recorded/i);
});

test("execution plan requires dry-run preview", () => {
  const result = buildUnitySceneObjectCreationExecutionPlan(createExecutionPlanInput({
    preview_result: null,
  }));

  assert.equal(result.execution_kind, "execution_plan_blocked");
  assert.equal(result.dry_run_preview_status, "missing");
  assert.match(result.blocked_reason ?? "", /Dry-run preview gate is missing/i);
});

test("execution plan requires preflight simulation", () => {
  const result = buildUnitySceneObjectCreationExecutionPlan(createExecutionPlanInput({
    preflight_result: null,
  }));

  assert.equal(result.execution_kind, "execution_plan_blocked");
  assert.equal(result.preflight_status, "missing");
  assert.match(result.blocked_reason ?? "", /Preflight simulation gate is missing/i);
});

test("execution plan requires valid final authorization", () => {
  const result = buildUnitySceneObjectCreationExecutionPlan(createExecutionPlanInput({
    authorization: null,
  }));

  assert.equal(result.execution_kind, "execution_plan_blocked");
  assert.equal(result.authorization_evaluation.authorized, false);
  assert.match(result.blocked_reason ?? "", /final execution authorization is recorded/i);
});

test("execution plan requires live read-only validation", () => {
  const result = buildUnitySceneObjectCreationExecutionPlan(createExecutionPlanInput({
    live_validation_result: null,
  }));

  assert.equal(result.execution_kind, "execution_plan_blocked");
  assert.equal(result.live_validation_status, "missing");
  assert.match(result.blocked_reason ?? "", /Live read-only Unity validation gate is missing/i);
});

test("execution plan requires final mutation switch", () => {
  const result = buildUnitySceneObjectCreationExecutionPlan(createExecutionPlanInput({
    mutation_switch: null,
  }));

  assert.equal(result.execution_kind, "execution_plan_blocked");
  assert.equal(result.final_mutation_switch_required, true);
  assert.equal(result.final_mutation_switch_enabled, false);
  assert.equal(result.mutation_switch_evaluation.enabled, false);
  assert.match(result.blocked_reason ?? "", /until a final mutation switch is recorded/i);
});

test("execution plan requires explicit mutation execution mode to be enabled", () => {
  const result = buildUnitySceneObjectCreationExecutionPlan(createExecutionPlanInput({
    mutation_execution_mode_enabled: false,
  }));

  assert.equal(result.execution_kind, "execution_plan_blocked");
  assert.equal(result.explicit_mutation_execution_mode_status, "disabled");
  assert.match(result.blocked_reason ?? "", /execution mode gate remains disabled/i);
});

test("valid gate stack creates a disabled Unity mutation execution plan without mutation", () => {
  const result = buildUnitySceneObjectCreationExecutionPlan(createExecutionPlanInput());

  assert.equal(result.execution_kind, "execution_plan_only");
  assert.equal(result.execution_mode, "disabled_plan_only");
  assert.equal(result.final_mutation_switch_required, true);
  assert.equal(result.final_mutation_switch_enabled, false);
  assert.equal(result.mutation_switch_evaluation.enabled, true);
  assert.equal(result.mutation_enabled, false);
  assert.equal(result.executed, false);
  assert.equal(result.mutating, false);
  assert.equal(result.live_validation_status, "valid");
  assert.equal(result.dry_run_preview_status, "valid");
  assert.equal(result.preflight_status, "valid");
  assert.equal(result.authorization_evaluation.authorized, true);
  assert.equal(result.gate_statuses.length, 8);
  assert.ok(result.gate_statuses.every((gate) => gate.status === "approved"));
  assert.ok(result.review_package);
  assert.ok(result.delivery_package);
  assert.deepEqual(result.review_package?.files_changed, []);
  assert.deepEqual(result.delivery_package?.files_changed, []);
  assert.match(result.review_package?.summary ?? "", /EXECUTION PLAN ONLY/i);
  assert.match(result.review_package?.summary ?? "", /MUTATION DISABLED/i);
  assert.match(result.review_package?.summary ?? "", /MUTATION DISABLED/i);
  assert.match(result.delivery_package?.release_notes ?? "", /NOT EXECUTED/i);
  assert.ok(result.delivery_package?.validation_results.some((entry) => /Final mutation switch evaluation status: FINAL MUTATION SWITCH ENABLED/i.test(entry)));
});

test("controlled mutation blocks when the approved execution plan is missing", async () => {
  let callCount = 0;
  const result = await executeUnitySceneObjectCreationMutation(createMutationExecutionInput({
    execution_plan: null,
  }), {
    mutation_bridge: {
      async executeSceneObjectCreation() {
        callCount += 1;
        throw new Error("should not execute");
      },
      async executeSceneObjectRemoval() {
        throw new Error("should not execute rollback");
      },
    },
  });

  assert.equal(result.execution_kind, "controlled_mutation_blocked");
  assert.equal(result.executed, false);
  assert.equal(callCount, 0);
  assert.match(result.blocked_reason ?? "", /requires an approved execution plan artifact/i);
});

test("controlled mutation blocks when a required gate is missing", async () => {
  let callCount = 0;
  const result = await executeUnitySceneObjectCreationMutation(createMutationExecutionInput({
    live_validation_result: null,
  }), {
    mutation_bridge: {
      async executeSceneObjectCreation() {
        callCount += 1;
        throw new Error("should not execute");
      },
      async executeSceneObjectRemoval() {
        throw new Error("should not execute rollback");
      },
    },
  });

  assert.equal(result.execution_kind, "controlled_mutation_blocked");
  assert.equal(result.executed, false);
  assert.equal(callCount, 0);
  assert.match(result.blocked_reason ?? "", /Live read-only Unity validation gate is missing/i);
});

test("controlled mutation blocks when the final mutation switch is disabled", async () => {
  let callCount = 0;
  const result = await executeUnitySceneObjectCreationMutation(createMutationExecutionInput({
    mutation_switch: {
      mutation_switch_id: "mutation-switch-disabled",
      switch_enabled: false,
      enabled_by_operator: true,
      enabled_at: "2026-04-30T18:06:00.000Z",
      target_request_id: "unity-mutation-preview-1",
      allowed_mutation_type: "scene_object_creation_request",
      expires_at: "2026-04-30T19:00:00.000Z",
    },
  }), {
    mutation_bridge: {
      async executeSceneObjectCreation() {
        callCount += 1;
        throw new Error("should not execute");
      },
      async executeSceneObjectRemoval() {
        throw new Error("should not execute rollback");
      },
    },
  });

  assert.equal(result.execution_kind, "controlled_mutation_blocked");
  assert.equal(result.executed, false);
  assert.equal(callCount, 0);
  assert.match(result.blocked_reason ?? "", /remains disabled/i);
});

test("valid full gate stack executes the controlled mutation bridge and persists evidence", async () => {
  let callCount = 0;
  const result = await executeUnitySceneObjectCreationMutation(createMutationExecutionInput(), {
    mutation_bridge: {
      async executeSceneObjectCreation(input) {
        callCount += 1;
        assert.equal(input.object_name, "CheckpointAnchor");
        assert.equal(input.target_scene, "EnemyAIDemo");
        assert.equal(input.mutation_enabled, true);
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          mutation_status: "mutation_executed" as const,
          mutation_type: "scene_object_creation_request" as const,
          target_scene: "EnemyAIDemo",
          object_name: "CheckpointAnchor",
          created_object_name: "CheckpointAnchor",
          scene_saved: true,
          duplicate_handling: "created" as const,
          evidence_timestamp: "2026-04-30T18:11:00.000Z",
          raw_evidence_summary: "Controlled Unity mutation created CheckpointAnchor in EnemyAIDemo and saved the scene.",
          summary: "Controlled Unity mutation created object CheckpointAnchor in EnemyAIDemo with scene_saved true.",
          rollback_hint: "Rollback requires separate approval: remove CheckpointAnchor from EnemyAIDemo.",
          recommended_next_operator_action: "Review the controlled Unity mutation evidence and keep rollback as a separately approved follow-up action.",
        };
      },
      async executeSceneObjectRemoval() {
        throw new Error("should not execute rollback");
      },
    },
  });

  assert.equal(callCount, 1);
  assert.equal(result.execution_kind, "controlled_mutation_executed");
  assert.equal(result.executed, true);
  assert.equal(result.mutation_enabled, true);
  assert.equal(result.created_object_name, "CheckpointAnchor");
  assert.equal(result.scene_saved, true);
  assert.equal(result.final_mutation_switch_enabled, true);
  assert.equal(result.mutating, true);
  assert.ok(result.review_package);
  assert.ok(result.delivery_package);
  assert.match(result.review_package?.summary ?? "", /CONTROLLED UNITY MUTATION/i);
  assert.match(result.delivery_package?.release_notes ?? "", /ROLLBACK AVAILABLE/i);
  assert.ok(result.delivery_package?.validation_results.some((entry) => /Scene saved: true/i.test(entry)));
});

test("controlled mutation handles duplicate objects as idempotent success", async () => {
  const result = await executeUnitySceneObjectCreationMutation(createMutationExecutionInput(), {
    mutation_bridge: {
      async executeSceneObjectCreation() {
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          mutation_status: "mutation_idempotent" as const,
          mutation_type: "scene_object_creation_request" as const,
          target_scene: "EnemyAIDemo",
          object_name: "CheckpointAnchor",
          created_object_name: "CheckpointAnchor",
          scene_saved: false,
          duplicate_handling: "already_exists_idempotent" as const,
          evidence_timestamp: "2026-04-30T18:12:00.000Z",
          raw_evidence_summary: "Controlled Unity mutation confirmed the existing object CheckpointAnchor in EnemyAIDemo; no additional scene write was required.",
          summary: "Controlled Unity mutation confirmed existing object CheckpointAnchor in EnemyAIDemo with scene_saved false.",
          rollback_hint: "Rollback requires separate approval: remove CheckpointAnchor from EnemyAIDemo only if it was not expected.",
          recommended_next_operator_action: "Review the controlled Unity mutation evidence and keep rollback as a separately approved follow-up action.",
        };
      },
      async executeSceneObjectRemoval() {
        throw new Error("should not execute rollback");
      },
    },
  });

  assert.equal(result.execution_kind, "controlled_mutation_idempotent");
  assert.equal(result.executed, false);
  assert.equal(result.scene_saved, false);
  assert.equal(result.duplicate_handling, "already_exists_idempotent");
  assert.equal(result.created_object_name, "CheckpointAnchor");
});

test("controlled rollback blocks when rollback review approval is missing", async () => {
  let callCount = 0;
  const result = await executeUnitySceneObjectCreationRollback(createRollbackExecutionInput({
    review_state: {
      review_package_id: null,
      review_completed_at: null,
      approved_by_operator: true,
      operator_approval_id: "rollback-approval-1",
      delivery_package_id: "rollback-delivery-1",
    },
  }), {
    mutation_bridge: {
      async executeSceneObjectCreation() {
        throw new Error("should not execute mutation");
      },
      async executeSceneObjectRemoval() {
        callCount += 1;
        throw new Error("should not execute rollback");
      },
    },
  });

  assert.equal(result.execution_kind, "controlled_rollback_blocked");
  assert.equal(result.executed, false);
  assert.equal(callCount, 0);
  assert.match(result.blocked_reason ?? "", /rollback review approval is recorded/i);
});

test("controlled rollback blocks when rollback authorization is missing", async () => {
  let callCount = 0;
  const result = await executeUnitySceneObjectCreationRollback(createRollbackExecutionInput({
    authorization: null,
  }), {
    mutation_bridge: {
      async executeSceneObjectCreation() {
        throw new Error("should not execute mutation");
      },
      async executeSceneObjectRemoval() {
        callCount += 1;
        throw new Error("should not execute rollback");
      },
    },
  });

  assert.equal(result.execution_kind, "controlled_rollback_blocked");
  assert.equal(result.executed, false);
  assert.equal(callCount, 0);
  assert.match(result.blocked_reason ?? "", /until a final rollback authorization is recorded/i);
});

test("controlled rollback blocks when the final rollback switch is disabled", async () => {
  let callCount = 0;
  const result = await executeUnitySceneObjectCreationRollback(createRollbackExecutionInput({
    rollback_switch: {
      rollback_switch_id: "rollback-switch-disabled",
      switch_enabled: false,
      enabled_by_operator: true,
      enabled_at: "2026-05-01T21:06:00.000Z",
      target_request_id: "unity-rollback-1",
      target_scene: "EnemyAIDemo",
      target_object_name: "AIE_ControlledMutationProbe",
      allowed_rollback_type: "scene_object_removal",
      expires_at: "2026-05-01T22:00:00.000Z",
    },
  }), {
    mutation_bridge: {
      async executeSceneObjectCreation() {
        throw new Error("should not execute mutation");
      },
      async executeSceneObjectRemoval() {
        callCount += 1;
        throw new Error("should not execute rollback");
      },
    },
  });

  assert.equal(result.execution_kind, "controlled_rollback_blocked");
  assert.equal(result.executed, false);
  assert.equal(callCount, 0);
  assert.match(result.blocked_reason ?? "", /remains disabled/i);
});

test("controlled rollback blocks the wrong object target", async () => {
  let callCount = 0;
  const result = await executeUnitySceneObjectCreationRollback(createRollbackExecutionInput({
    target_object_name: "CheckpointAnchor",
  }), {
    mutation_bridge: {
      async executeSceneObjectCreation() {
        throw new Error("should not execute mutation");
      },
      async executeSceneObjectRemoval() {
        callCount += 1;
        throw new Error("should not execute rollback");
      },
    },
  });

  assert.equal(result.execution_kind, "controlled_rollback_blocked");
  assert.equal(result.executed, false);
  assert.equal(callCount, 0);
  assert.match(result.blocked_reason ?? "", /limited to AIE_ControlledMutationProbe/i);
});

test("successful controlled rollback bridge persists rollback evidence", async () => {
  let callCount = 0;
  const result = await executeUnitySceneObjectCreationRollback(createRollbackExecutionInput(), {
    mutation_bridge: {
      async executeSceneObjectCreation() {
        throw new Error("should not execute mutation");
      },
      async executeSceneObjectRemoval(input) {
        callCount += 1;
        assert.equal(input.object_name, "AIE_ControlledMutationProbe");
        assert.equal(input.target_scene, "EnemyAIDemo");
        assert.equal(input.rollback_enabled, true);
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          rollback_status: "rollback_executed" as const,
          rollback_type: "scene_object_removal" as const,
          target_scene: "EnemyAIDemo",
          object_name: "AIE_ControlledMutationProbe",
          removed_object_name: "AIE_ControlledMutationProbe",
          scene_saved: true,
          target_missing_handling: "removed" as const,
          evidence_timestamp: "2026-05-01T21:10:00.000Z",
          raw_evidence_summary: "Controlled Unity rollback removed AIE_ControlledMutationProbe from EnemyAIDemo and saved the scene.",
          summary: "Controlled Unity rollback removed target AIE_ControlledMutationProbe in EnemyAIDemo with scene_saved true.",
          recommended_next_operator_action: "Review the controlled Unity rollback evidence and rerun read-only validation before proceeding.",
        };
      },
    },
  });

  assert.equal(callCount, 1);
  assert.equal(result.execution_kind, "controlled_rollback_executed");
  assert.equal(result.executed, true);
  assert.equal(result.rollback_enabled, true);
  assert.equal(result.removed_object_name, "AIE_ControlledMutationProbe");
  assert.equal(result.scene_saved, true);
  assert.equal(result.final_rollback_switch_enabled, true);
  assert.equal(result.mutating, true);
  assert.ok(result.review_package);
  assert.ok(result.delivery_package);
  assert.match(result.review_package?.summary ?? "", /CONTROLLED UNITY ROLLBACK/i);
  assert.match(result.delivery_package?.release_notes ?? "", /TARGET REMOVED/i);
  assert.ok(result.delivery_package?.validation_results.some((entry) => /Removed object name: AIE_ControlledMutationProbe/i.test(entry)));
});

test("controlled rollback reports target-missing behavior safely and explicitly", async () => {
  const result = await executeUnitySceneObjectCreationRollback(createRollbackExecutionInput(), {
    mutation_bridge: {
      async executeSceneObjectCreation() {
        throw new Error("should not execute mutation");
      },
      async executeSceneObjectRemoval() {
        return {
          bridge_status: "bridge_ready" as const,
          source: "command_probe" as const,
          rollback_status: "rollback_idempotent" as const,
          rollback_type: "scene_object_removal" as const,
          target_scene: "EnemyAIDemo",
          object_name: "AIE_ControlledMutationProbe",
          removed_object_name: null,
          scene_saved: false,
          target_missing_handling: "already_missing_idempotent" as const,
          evidence_timestamp: "2026-05-01T21:11:00.000Z",
          raw_evidence_summary: "Controlled Unity rollback confirmed that AIE_ControlledMutationProbe is already absent from EnemyAIDemo; no scene write was required.",
          summary: "Controlled Unity rollback confirmed missing target AIE_ControlledMutationProbe in EnemyAIDemo with scene_saved false.",
          recommended_next_operator_action: "Review the controlled Unity rollback evidence and rerun read-only validation before proceeding.",
        };
      },
    },
  });

  assert.equal(result.execution_kind, "controlled_rollback_idempotent");
  assert.equal(result.executed, false);
  assert.equal(result.scene_saved, false);
  assert.equal(result.target_missing_handling, "already_missing_idempotent");
  assert.equal(result.removed_object_name, null);
  assert.match(result.delivery_package?.release_notes ?? "", /TARGET ALREADY MISSING/i);
});
