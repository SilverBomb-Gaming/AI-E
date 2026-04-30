import assert from "node:assert/strict";
import test from "node:test";

import {
  createConfiguredUnityReadOnlyRuntimeBridge,
  createUnavailableUnityReadOnlyRuntimeBridge,
} from "./unityReadOnlyRuntimeBridge";

test("default unavailable Unity bridge reports structured unavailability", async () => {
  const bridge = createUnavailableUnityReadOnlyRuntimeBridge();
  const result = await bridge.probeValidation({
    request_id: "unity-bridge-1",
    requested_at: "2026-04-30T13:30:00.000Z",
    scene_name_hint: "CastleHub",
  });

  assert.equal(result.bridge_status, "bridge_unavailable");
  assert.equal(result.source, "none");
  assert.match(result.reason, /No Unity read-only runtime endpoint is configured/i);
});

test("configured Unity endpoint client returns structured unavailable on malformed response", async () => {
  const bridge = createConfiguredUnityReadOnlyRuntimeBridge({
    endpointUrl: "http://127.0.0.1:32123/unity-validation",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ checked_scene_name: "CastleHub" }),
    } as Response),
  });

  const result = await bridge.probeValidation({
    request_id: "unity-bridge-2",
    requested_at: "2026-04-30T13:31:00.000Z",
    scene_name_hint: "CastleHub",
  });

  assert.equal(result.bridge_status, "bridge_unavailable");
  assert.equal(result.source, "http_endpoint");
  assert.match(result.reason, /did not include a supported scene validation status/i);
});

test("configured Unity endpoint client normalizes valid read-only payloads", async () => {
  const bridge = createConfiguredUnityReadOnlyRuntimeBridge({
    endpointUrl: "http://127.0.0.1:32123/unity-validation",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        scene_validation_status: "checked_with_findings",
        checked_scene_name: "CastleHub",
        missing_script_count: 1,
        console_error_count: 2,
        object_count: 480,
        evidence_timestamp: "2026-04-30T13:32:00.000Z",
        raw_evidence_summary: "One missing script and two console errors detected.",
        recommended_next_operator_action: "Review the findings before continuing delivery.",
      }),
    } as Response),
  });

  const result = await bridge.probeValidation({
    request_id: "unity-bridge-3",
    requested_at: "2026-04-30T13:31:30.000Z",
    scene_name_hint: "CastleHub",
  });

  assert.equal(result.bridge_status, "bridge_ready");
  assert.equal(result.source, "http_endpoint");
  assert.equal(result.scene_validation_status, "checked_with_findings");
  assert.equal(result.checked_scene_name, "CastleHub");
  assert.equal(result.missing_script_count, 1);
  assert.equal(result.console_error_count, 2);
  assert.equal(result.object_count, 480);
  assert.equal(result.raw_evidence_summary, "One missing script and two console errors detected.");
});