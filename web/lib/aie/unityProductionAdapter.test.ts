import assert from "node:assert/strict";
import test from "node:test";

import { buildUnityProductionPlanningPacket } from "./productionPipelineFoundation";
import {
  createUnityProductionAdapterOutput,
  evaluateUnityProductionAdapterReadiness,
  executeReviewedUnityValidation,
} from "./unityProductionAdapter";
import type { UnityReadOnlyRuntimeBridge } from "./unityReadOnlyRuntimeBridge";

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

function createCountingBridge(result: Awaited<ReturnType<UnityReadOnlyRuntimeBridge["probeValidation"]>>) {
  let callCount = 0;

  const bridge: UnityReadOnlyRuntimeBridge = {
    async probeValidation() {
      callCount += 1;
      return result;
    },
  };

  return {
    bridge,
    getCallCount: () => callCount,
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

test("missing review approval blocks Unity validation execution", async () => {
  const countingBridge = createCountingBridge({
    bridge_status: "bridge_ready",
    scene_validation_status: "checked_clean",
    missing_script_count: 0,
    console_error_count: 0,
    object_count: 120,
    checked_scene_name: "CastleHub",
    evidence_timestamp: "2026-04-30T13:00:30.000Z",
    summary: "Bridge ran.",
    recommended_next_operator_action: "Review.",
  });
  const result = await executeReviewedUnityValidation({
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
  }, { runtime_bridge: countingBridge.bridge });

  assert.equal(result.executed, false);
  assert.equal(result.review_approval_status, "missing");
  assert.match(result.blocked_reason ?? "", /blocked until review approval is recorded/i);
  assert.equal(countingBridge.getCallCount(), 0);
});

test("missing operator approval blocks Unity validation execution", async () => {
  const countingBridge = createCountingBridge({
    bridge_status: "bridge_ready",
    scene_validation_status: "checked_clean",
    missing_script_count: 0,
    console_error_count: 0,
    object_count: 120,
    checked_scene_name: "CastleHub",
    evidence_timestamp: "2026-04-30T13:01:30.000Z",
    summary: "Bridge ran.",
    recommended_next_operator_action: "Review.",
  });
  const result = await executeReviewedUnityValidation({
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
  }, { runtime_bridge: countingBridge.bridge });

  assert.equal(result.executed, false);
  assert.equal(result.operator_approval_status, "missing");
  assert.match(result.blocked_reason ?? "", /blocked until operator approval is recorded/i);
  assert.equal(countingBridge.getCallCount(), 0);
});

test("non-validation Unity request types are refused by the first execution path", async () => {
  const countingBridge = createCountingBridge({
    bridge_status: "bridge_ready",
    scene_validation_status: "checked_clean",
    missing_script_count: 0,
    console_error_count: 0,
    object_count: 120,
    checked_scene_name: "CastleHub",
    evidence_timestamp: "2026-04-30T13:03:30.000Z",
    summary: "Bridge ran.",
    recommended_next_operator_action: "Review.",
  });
  const result = await executeReviewedUnityValidation({
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
  }, { runtime_bridge: countingBridge.bridge });

  assert.equal(result.executed, false);
  assert.match(result.blocked_reason ?? "", /Only validation_playtest_request is executable/i);
  assert.equal(countingBridge.getCallCount(), 0);
});

test("unavailable bridge returns structured unavailable delivery artifact", async () => {
  const countingBridge = createCountingBridge({
    bridge_status: "bridge_unavailable",
    source: "http_endpoint",
    reason: "Unity editor endpoint is not running.",
    evidence_timestamp: "2026-04-30T13:05:30.000Z",
    raw_evidence_summary: null,
    recommended_next_operator_action: "Start the verified read-only Unity bridge before retrying.",
  });

  const result = await executeReviewedUnityValidation({
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
  }, { runtime_bridge: countingBridge.bridge });

  assert.equal(countingBridge.getCallCount(), 1);
  assert.equal(result.executed, false);
  assert.equal(result.execution_kind, "real_bridge_unavailable");
  assert.equal(result.bridge_status, "bridge_unavailable");
  assert.equal(result.artifact_label, "unity_bridge_unavailable_report");
  assert.match(result.blocked_reason ?? "", /endpoint is not running/i);
  assert.equal(result.review_package, null);
  assert.equal(result.delivery_package, null);
});

test("successful read-only bridge returns real bridge validation result", async () => {
  const countingBridge = createCountingBridge({
    bridge_status: "bridge_ready",
    source: "http_endpoint",
    scene_validation_status: "checked_with_findings",
    missing_script_count: 2,
    console_error_count: 3,
    object_count: 487,
    checked_scene_name: "CastleHub",
    evidence_timestamp: "2026-04-30T13:06:30.000Z",
    raw_evidence_summary: "Two missing scripts and three console errors were reported.",
    summary: "Unity read-only validation probe completed for CastleHub with findings recorded for operator review.",
    recommended_next_operator_action: "Review the read-only bridge findings and decide whether to hold the request in review or rerun after fixes.",
  });

  const result = await executeReviewedUnityValidation({
    adapter_request_id: "unity-validation-5",
    requested_at: "2026-04-30T13:06:00.000Z",
    planning_packet: createValidationOnlyPacket(),
    requested_actions: [],
    review_state: {
      review_package_id: "review-10",
      review_completed_at: "2026-04-30T13:06:10.000Z",
      approved_by_operator: true,
      operator_approval_id: "approval-10",
      delivery_package_id: "delivery-10",
    },
  }, { runtime_bridge: countingBridge.bridge });

  assert.equal(countingBridge.getCallCount(), 1);
  assert.equal(result.executed, true);
  assert.equal(result.domain, "Unity");
  assert.equal(result.request_type, "validation_playtest_request");
  assert.equal(result.execution_kind, "real_bridge_read_only");
  assert.equal(result.execution_mode, "read_only_runtime_bridge");
  assert.equal(result.bridge_status, "bridge_ready");
  assert.equal(result.scene_validation_status, "checked_with_findings");
  assert.equal(result.missing_script_count, 2);
  assert.equal(result.console_error_count, 3);
  assert.equal(result.object_count, 487);
  assert.equal(result.checked_scene_name, "CastleHub");
  assert.equal(result.mutating, false);
  assert.equal(result.artifact_label, "unity_read_only_validation_report");
  assert.match(result.delivery_summary, /read-only validation probe completed/i);
  assert.ok(result.validation_checklist.length >= 2);
  assert.ok(result.review_package);
  assert.ok(result.delivery_package);
  assert.match(result.delivery_package?.release_notes ?? "", /read-only validation probe completed/i);
  assert.ok(result.delivery_package?.validation_results.some((entry) => /Bridge status: bridge_ready/i.test(entry)));
});