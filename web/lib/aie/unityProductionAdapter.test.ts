import assert from "node:assert/strict";
import test from "node:test";

import { buildUnityProductionPlanningPacket } from "./productionPipelineFoundation";
import {
  createUnityProductionAdapterOutput,
  evaluateUnityProductionAdapterReadiness,
  executeReviewedUnityValidation,
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

function createValidationOnlyPacket() {
  const packet = buildUnityProductionPlanningPacket(
    "run a Unity validation playtest for the castle hub room",
    "review",
    ["unity-integration"],
  );

  if (!packet) {
    throw new Error("Expected Unity validation planning packet.");
  }

  return {
    ...packet,
    request_types: ["validation_playtest_request"] as const,
    requests: packet.requests.filter((request) => request.request_type === "validation_playtest_request"),
    required_review_artifacts: ["playtest plan", "validation checklist"],
    required_approval_gates: ["review package approval", "playtest approval"],
  };
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

test("missing review approval blocks Unity validation execution", () => {
  const result = executeReviewedUnityValidation({
    adapter_request_id: "unity-validation-1",
    requested_at: "2026-04-30T13:00:00.000Z",
    planning_packet: createValidationOnlyPacket(),
    requested_actions: [],
    review_state: {
      review_package_id: null,
      review_completed_at: null,
      approved_by_operator: false,
      operator_approval_id: null,
      delivery_package_id: null,
    },
  });

  assert.equal(result.executed, false);
  assert.equal(result.review_approval_status, "missing");
  assert.match(result.blocked_reason ?? "", /blocked until review approval is recorded/i);
});

test("missing operator approval blocks Unity validation execution", () => {
  const result = executeReviewedUnityValidation({
    adapter_request_id: "unity-validation-2",
    requested_at: "2026-04-30T13:01:00.000Z",
    planning_packet: createValidationOnlyPacket(),
    requested_actions: [],
    review_state: {
      review_package_id: "review-7",
      review_completed_at: "2026-04-30T13:02:00.000Z",
      approved_by_operator: false,
      operator_approval_id: null,
      delivery_package_id: null,
    },
  });

  assert.equal(result.executed, false);
  assert.equal(result.operator_approval_status, "missing");
  assert.match(result.blocked_reason ?? "", /blocked until operator approval is recorded/i);
});

test("non-validation Unity request types are refused by the first execution path", () => {
  const result = executeReviewedUnityValidation({
    adapter_request_id: "unity-validation-3",
    requested_at: "2026-04-30T13:03:00.000Z",
    planning_packet: createPlanningPacket(),
    requested_actions: [],
    review_state: {
      review_package_id: "review-8",
      review_completed_at: "2026-04-30T13:04:00.000Z",
      approved_by_operator: true,
      operator_approval_id: "approval-8",
      delivery_package_id: "delivery-8",
    },
  });

  assert.equal(result.executed, false);
  assert.match(result.blocked_reason ?? "", /Only validation_playtest_request is executable/i);
});

test("validation request with both approvals returns a non-mutating executed preview artifact", () => {
  const result = executeReviewedUnityValidation({
    adapter_request_id: "unity-validation-4",
    requested_at: "2026-04-30T13:05:00.000Z",
    planning_packet: createValidationOnlyPacket(),
    requested_actions: [],
    review_state: {
      review_package_id: "review-9",
      review_completed_at: "2026-04-30T13:06:00.000Z",
      approved_by_operator: true,
      operator_approval_id: "approval-9",
      delivery_package_id: "delivery-9",
    },
  });

  assert.equal(result.executed, true);
  assert.equal(result.domain, "Unity");
  assert.equal(result.request_type, "validation_playtest_request");
  assert.equal(result.mutating, false);
  assert.equal(result.artifact_label, "adapter_level_validation_preview");
  assert.match(result.delivery_summary, /Adapter-level Unity validation preview completed/i);
  assert.ok(result.validation_checklist.length >= 2);
});