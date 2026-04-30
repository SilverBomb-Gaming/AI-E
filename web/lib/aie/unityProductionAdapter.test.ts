import assert from "node:assert/strict";
import test from "node:test";

import { buildUnityProductionPlanningPacket } from "./productionPipelineFoundation";
import {
  createUnityProductionAdapterOutput,
  evaluateUnityProductionAdapterReadiness,
} from "./unityProductionAdapter";

function createPlanningPacket() {
  const packet = buildUnityProductionPlanningPacket(
    "plan a Unity scene prefab validation pass for a HUD import",
    "review",
    ["assets", "unity-integration"],
  );

  if (!packet) {
    throw new Error("Expected Unity planning packet.");
  }

  return packet;
}

test("Unity adapter output remains reviewed-execution only", () => {
  const output = createUnityProductionAdapterOutput({
    adapter_request_id: "unity-adapter-1",
    requested_at: "2026-04-30T12:40:00.000Z",
    planning_packet: createPlanningPacket(),
    requested_actions: [],
    review_state: {
      review_package_id: null,
      review_completed_at: null,
      approved_by_operator: false,
      operator_approval_id: null,
      delivery_package_id: null,
    },
  });

  assert.equal(output.execution_mode, "reviewed_execution_only");
  assert.equal(output.next_step, "request_review");
  assert.ok(output.planned_adapter_actions.length >= 1);
});

test("missing review prevents Unity adapter execution", () => {
  const result = evaluateUnityProductionAdapterReadiness({
    adapter_request_id: "unity-adapter-2",
    requested_at: "2026-04-30T12:40:00.000Z",
    planning_packet: createPlanningPacket(),
    requested_actions: [],
    review_state: {
      review_package_id: null,
      review_completed_at: null,
      approved_by_operator: false,
      operator_approval_id: null,
      delivery_package_id: null,
    },
  });

  assert.equal(result.status, "blocked_missing_review");
  assert.equal(result.can_execute, false);
  assert.match(result.reason, /blocked until a review package is completed/i);
});

test("missing approval prevents Unity adapter execution after review", () => {
  const result = evaluateUnityProductionAdapterReadiness({
    adapter_request_id: "unity-adapter-3",
    requested_at: "2026-04-30T12:41:00.000Z",
    planning_packet: createPlanningPacket(),
    requested_actions: [],
    review_state: {
      review_package_id: "review-1",
      review_completed_at: "2026-04-30T12:42:00.000Z",
      approved_by_operator: false,
      operator_approval_id: null,
      delivery_package_id: null,
    },
  });

  assert.equal(result.status, "blocked_missing_approval");
  assert.equal(result.can_execute, false);
  assert.equal(result.output.next_step, "request_operator_approval");
});

test("review and approval metadata are both required before Unity adapter readiness", () => {
  const result = evaluateUnityProductionAdapterReadiness({
    adapter_request_id: "unity-adapter-4",
    requested_at: "2026-04-30T12:43:00.000Z",
    planning_packet: createPlanningPacket(),
    requested_actions: [],
    review_state: {
      review_package_id: "review-2",
      review_completed_at: "2026-04-30T12:44:00.000Z",
      approved_by_operator: true,
      operator_approval_id: "approval-2",
      delivery_package_id: "delivery-2",
    },
  });

  assert.equal(result.status, "ready_for_reviewed_execution");
  assert.equal(result.can_execute, true);
  assert.equal(result.output.next_step, "ready_for_reviewed_execution");
});