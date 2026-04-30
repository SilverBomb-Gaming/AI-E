import assert from "node:assert/strict";
import test from "node:test";

import {
  createConfiguredUnityReadOnlyRuntimeBridge,
  createUnavailableUnityReadOnlyRuntimeBridge,
} from "./unityReadOnlyRuntimeBridge";

function withUnityTimeoutEnv(value: string | undefined, callback: () => Promise<void>): Promise<void> {
  const previousValue = process.env.AIE_UNITY_TIMEOUT_MS;
  if (value === undefined) {
    delete process.env.AIE_UNITY_TIMEOUT_MS;
  } else {
    process.env.AIE_UNITY_TIMEOUT_MS = value;
  }

  return callback().finally(() => {
    if (previousValue === undefined) {
      delete process.env.AIE_UNITY_TIMEOUT_MS;
      return;
    }

    process.env.AIE_UNITY_TIMEOUT_MS = previousValue;
  });
}

function withoutUnityCommandProbeEnv(callback: () => Promise<void>): Promise<void> {
  const previousEditorPath = process.env.AIE_UNITY_EDITOR_PATH;
  const previousProjectPath = process.env.AIE_UNITY_PROJECT_PATH;
  const previousScenePath = process.env.AIE_UNITY_SCENE_PATH;
  const previousExecuteMethod = process.env.AIE_UNITY_EXECUTE_METHOD;

  delete process.env.AIE_UNITY_EDITOR_PATH;
  delete process.env.AIE_UNITY_PROJECT_PATH;
  delete process.env.AIE_UNITY_SCENE_PATH;
  delete process.env.AIE_UNITY_EXECUTE_METHOD;

  return callback().finally(() => {
    if (previousEditorPath === undefined) {
      delete process.env.AIE_UNITY_EDITOR_PATH;
    } else {
      process.env.AIE_UNITY_EDITOR_PATH = previousEditorPath;
    }

    if (previousProjectPath === undefined) {
      delete process.env.AIE_UNITY_PROJECT_PATH;
    } else {
      process.env.AIE_UNITY_PROJECT_PATH = previousProjectPath;
    }

    if (previousScenePath === undefined) {
      delete process.env.AIE_UNITY_SCENE_PATH;
    } else {
      process.env.AIE_UNITY_SCENE_PATH = previousScenePath;
    }

    if (previousExecuteMethod === undefined) {
      delete process.env.AIE_UNITY_EXECUTE_METHOD;
    } else {
      process.env.AIE_UNITY_EXECUTE_METHOD = previousExecuteMethod;
    }
  });
}

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
  await withoutUnityCommandProbeEnv(async () => {
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
});

test("configured Unity endpoint client normalizes valid read-only payloads", async () => {
  await withoutUnityCommandProbeEnv(async () => {
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
});

test("configured Unity command probe uses command runner and normalizes live-style payloads", async () => {
  let callCount = 0;
  let timeoutMs: number | null = null;

  const bridge = createConfiguredUnityReadOnlyRuntimeBridge({
    unityEditorPath: "C:/Program Files/Unity/Editor/Unity.exe",
    unityProjectPath: "E:/AI projects 2025/AI-E/orchestrator_lane/Tools/EnemyAIDemoStandalone",
    unityScenePath: "Assets/Scenes/EnemyAIDemo.unity",
    commandRunner: async (input) => {
      callCount += 1;
      timeoutMs = input.timeoutMs;
      assert.equal(input.unityScenePath, "Assets/Scenes/EnemyAIDemo.unity");
      assert.equal(input.probeInput.scene_name_hint, "EnemyAIDemo");

      return {
        sceneName: "EnemyAIDemo",
        missingScripts: 0,
        consoleErrors: 0,
        objectCount: 42,
        timestamp: "2026-04-30T15:05:00.000Z",
        recommended_next_operator_action: "Review the live Unity validation evidence.",
      };
    },
  });

  const result = await bridge.probeValidation({
    request_id: "unity-bridge-4",
    requested_at: "2026-04-30T15:04:00.000Z",
    scene_name_hint: "EnemyAIDemo",
  });

  assert.equal(callCount, 1);
  assert.equal(timeoutMs, 60_000);
  assert.equal(result.bridge_status, "bridge_ready");
  assert.equal(result.source, "command_probe");
  assert.equal(result.scene_validation_status, "checked_clean");
  assert.equal(result.checked_scene_name, "EnemyAIDemo");
  assert.equal(result.object_count, 42);
});

test("configured Unity command probe respects env timeout override", async () => {
  await withUnityTimeoutEnv("18000", async () => {
    let timeoutMs: number | null = null;

    const bridge = createConfiguredUnityReadOnlyRuntimeBridge({
      unityEditorPath: "C:/Program Files/Unity/Editor/Unity.exe",
      unityProjectPath: "E:/AI projects 2025/AI-E/orchestrator_lane/Tools/EnemyAIDemoStandalone",
      commandRunner: async (input) => {
        timeoutMs = input.timeoutMs;
        return {
          sceneName: "EnemyAIDemo",
          missingScripts: 0,
          consoleErrors: 0,
          objectCount: 42,
          timestamp: "2026-04-30T15:07:00.000Z",
        };
      },
    });

    const result = await bridge.probeValidation({
      request_id: "unity-bridge-6",
      requested_at: "2026-04-30T15:06:30.000Z",
      scene_name_hint: "EnemyAIDemo",
    });

    assert.equal(timeoutMs, 18_000);
    assert.equal(result.bridge_status, "bridge_ready");
  });
});

test("configured Unity command probe falls back to default timeout on invalid env value", async () => {
  await withUnityTimeoutEnv("not-a-number", async () => {
    let timeoutMs: number | null = null;

    const bridge = createConfiguredUnityReadOnlyRuntimeBridge({
      unityEditorPath: "C:/Program Files/Unity/Editor/Unity.exe",
      unityProjectPath: "E:/AI projects 2025/AI-E/orchestrator_lane/Tools/EnemyAIDemoStandalone",
      commandRunner: async (input) => {
        timeoutMs = input.timeoutMs;
        return {
          sceneName: "EnemyAIDemo",
          missingScripts: 0,
          consoleErrors: 0,
          objectCount: 42,
          timestamp: "2026-04-30T15:08:00.000Z",
        };
      },
    });

    const result = await bridge.probeValidation({
      request_id: "unity-bridge-7",
      requested_at: "2026-04-30T15:07:30.000Z",
      scene_name_hint: "EnemyAIDemo",
    });

    assert.equal(timeoutMs, 60_000);
    assert.equal(result.bridge_status, "bridge_ready");
  });
});

test("configured Unity command probe returns structured unavailable on runner failure", async () => {
  const bridge = createConfiguredUnityReadOnlyRuntimeBridge({
    unityEditorPath: "C:/Program Files/Unity/Editor/Unity.exe",
    unityProjectPath: "E:/AI projects 2025/AI-E/orchestrator_lane/Tools/EnemyAIDemoStandalone",
    commandRunner: async () => {
      throw new Error("Unity executable not found.");
    },
  });

  const result = await bridge.probeValidation({
    request_id: "unity-bridge-5",
    requested_at: "2026-04-30T15:06:00.000Z",
    scene_name_hint: "EnemyAIDemo",
  });

  assert.equal(result.bridge_status, "bridge_unavailable");
  assert.equal(result.source, "command_probe");
  assert.match(result.reason, /Unity executable not found/i);
});

test("configured Unity command probe preserves structured timeout failures", async () => {
  const bridge = createConfiguredUnityReadOnlyRuntimeBridge({
    unityEditorPath: "C:/Program Files/Unity/Editor/Unity.exe",
    unityProjectPath: "E:/AI projects 2025/AI-E/orchestrator_lane/Tools/EnemyAIDemoStandalone",
    commandRunner: async (input) => {
      throw new Error(`Unity command probe timed out after ${input.timeoutMs}ms.`);
    },
  });

  const result = await bridge.probeValidation({
    request_id: "unity-bridge-8",
    requested_at: "2026-04-30T15:09:00.000Z",
    scene_name_hint: "EnemyAIDemo",
  });

  assert.equal(result.bridge_status, "bridge_unavailable");
  assert.equal(result.source, "command_probe");
  assert.match(result.reason, /timed out after 60000ms/i);
});
