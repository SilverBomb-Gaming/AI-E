import assert from "node:assert/strict";
import test from "node:test";

import { buildUnityProductionPlanningPacket } from "./productionPipelineFoundation";
import { previewUnitySceneObjectCreation } from "./unityProductionAdapter";

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
  assert.equal(first.mutating, false);
});
