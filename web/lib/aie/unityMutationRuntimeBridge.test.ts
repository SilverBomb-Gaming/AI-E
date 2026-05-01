import assert from "node:assert/strict";
import test from "node:test";

import {
  createConfiguredUnityMutationRuntimeBridge,
  createUnavailableUnityMutationRuntimeBridge,
} from "./unityMutationRuntimeBridge";

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

test("default unavailable Unity mutation bridge reports structured unavailability", async () => {
  const bridge = createUnavailableUnityMutationRuntimeBridge();
  const result = await bridge.executeSceneObjectCreation({
    request_id: "unity-mutation-bridge-1",
    requested_at: "2026-05-01T20:10:00.000Z",
    target_scene: "EnemyAIDemo",
    object_name: "AIE_ControlledMutationProbe",
    mutation_type: "scene_object_creation_request",
    mutation_enabled: true,
    idempotent_on_duplicate: true,
  });

  assert.equal(result.bridge_status, "bridge_unavailable");
  assert.equal(result.source, "none");
  assert.match(result.reason, /No Unity mutation runtime bridge is configured/i);
});

test("default unavailable Unity rollback bridge reports structured unavailability", async () => {
  const bridge = createUnavailableUnityMutationRuntimeBridge();
  const result = await bridge.executeSceneObjectRemoval({
    request_id: "unity-rollback-bridge-1",
    requested_at: "2026-05-01T20:10:05.000Z",
    target_scene: "EnemyAIDemo",
    object_name: "AIE_ControlledMutationProbe",
    rollback_type: "scene_object_removal",
    rollback_enabled: true,
    idempotent_on_missing: true,
  });

  assert.equal(result.bridge_status, "bridge_unavailable");
  assert.equal(result.source, "none");
  assert.match(result.reason, /No Unity rollback runtime bridge is configured/i);
});

test("configured Unity mutation bridge normalizes successful mutation payloads", async () => {
  const bridge = createConfiguredUnityMutationRuntimeBridge({
    unityEditorPath: "C:/Program Files/Unity/Editor/Unity.exe",
    unityProjectPath: "E:/AI projects 2025/AI-E/orchestrator_lane/Tools/EnemyAIDemoStandalone",
    unityScenePath: "Assets/Scenes/EnemyAIDemo.unity",
    commandRunner: async (input) => {
      assert.equal(input.mutationInput.object_name, "AIE_ControlledMutationProbe");
      assert.equal(input.mutationInput.mutation_enabled, true);
      return {
        mutation_status: "mutation_executed",
        mutation_type: "scene_object_creation_request",
        target_scene: "EnemyAIDemo",
        object_name: "AIE_ControlledMutationProbe",
        created_object_name: "AIE_ControlledMutationProbe",
        scene_saved: true,
        duplicate_handling: "created",
        evidence_timestamp: "2026-05-01T20:11:00.000Z",
        raw_evidence_summary: "Controlled Unity mutation created AIE_ControlledMutationProbe in EnemyAIDemo and saved the scene.",
        rollback_hint: "Rollback requires separate approval: remove AIE_ControlledMutationProbe from EnemyAIDemo.",
      };
    },
  });

  const result = await bridge.executeSceneObjectCreation({
    request_id: "unity-mutation-bridge-2",
    requested_at: "2026-05-01T20:10:30.000Z",
    target_scene: "EnemyAIDemo",
    object_name: "AIE_ControlledMutationProbe",
    mutation_type: "scene_object_creation_request",
    mutation_enabled: true,
    idempotent_on_duplicate: true,
  });

  assert.equal(result.bridge_status, "bridge_ready");
  assert.equal(result.mutation_status, "mutation_executed");
  assert.equal(result.scene_saved, true);
  assert.equal(result.created_object_name, "AIE_ControlledMutationProbe");
});

test("configured Unity mutation bridge normalizes idempotent duplicate payloads", async () => {
  const bridge = createConfiguredUnityMutationRuntimeBridge({
    unityEditorPath: "C:/Program Files/Unity/Editor/Unity.exe",
    unityProjectPath: "E:/AI projects 2025/AI-E/orchestrator_lane/Tools/EnemyAIDemoStandalone",
    commandRunner: async () => ({
      mutation_status: "mutation_idempotent",
      mutation_type: "scene_object_creation_request",
      target_scene: "EnemyAIDemo",
      object_name: "AIE_ControlledMutationProbe",
      created_object_name: "AIE_ControlledMutationProbe",
      scene_saved: false,
      duplicate_handling: "already_exists_idempotent",
      evidence_timestamp: "2026-05-01T20:12:00.000Z",
      raw_evidence_summary: "Controlled Unity mutation confirmed the existing object AIE_ControlledMutationProbe in EnemyAIDemo; no additional scene write was required.",
      rollback_hint: "Rollback requires separate approval: remove AIE_ControlledMutationProbe from EnemyAIDemo only if it was not expected.",
    }),
  });

  const result = await bridge.executeSceneObjectCreation({
    request_id: "unity-mutation-bridge-3",
    requested_at: "2026-05-01T20:11:30.000Z",
    target_scene: "EnemyAIDemo",
    object_name: "AIE_ControlledMutationProbe",
    mutation_type: "scene_object_creation_request",
    mutation_enabled: true,
    idempotent_on_duplicate: true,
  });

  assert.equal(result.bridge_status, "bridge_ready");
  assert.equal(result.mutation_status, "mutation_idempotent");
  assert.equal(result.scene_saved, false);
  assert.equal(result.duplicate_handling, "already_exists_idempotent");
});

test("configured Unity mutation bridge returns structured failure payloads honestly", async () => {
  const bridge = createConfiguredUnityMutationRuntimeBridge({
    unityEditorPath: "C:/Program Files/Unity/Editor/Unity.exe",
    unityProjectPath: "E:/AI projects 2025/AI-E/orchestrator_lane/Tools/EnemyAIDemoStandalone",
    commandRunner: async () => ({
      mutation_status: "mutation_failed",
      mutation_type: "scene_object_creation_request",
      target_scene: "EnemyAIDemo",
      object_name: "AIE_ControlledMutationProbe",
      created_object_name: "",
      scene_saved: false,
      evidence_timestamp: "2026-05-01T20:13:00.000Z",
      raw_evidence_summary: "Controlled Unity mutation refused duplicate object creation because AIE_ControlledMutationProbe already exists in EnemyAIDemo.",
    }),
  });

  const result = await bridge.executeSceneObjectCreation({
    request_id: "unity-mutation-bridge-4",
    requested_at: "2026-05-01T20:12:30.000Z",
    target_scene: "EnemyAIDemo",
    object_name: "AIE_ControlledMutationProbe",
    mutation_type: "scene_object_creation_request",
    mutation_enabled: true,
    idempotent_on_duplicate: false,
  });

  assert.equal(result.bridge_status, "bridge_failure");
  assert.equal(result.source, "command_probe");
  assert.match(result.reason, /supported mutation status|duplicate object creation/i);
});

test("configured Unity mutation bridge respects env timeout override", async () => {
  await withUnityTimeoutEnv("18000", async () => {
    let timeoutMs: number | null = null;

    const bridge = createConfiguredUnityMutationRuntimeBridge({
      unityEditorPath: "C:/Program Files/Unity/Editor/Unity.exe",
      unityProjectPath: "E:/AI projects 2025/AI-E/orchestrator_lane/Tools/EnemyAIDemoStandalone",
      commandRunner: async (input) => {
        timeoutMs = input.timeoutMs;
        return {
          mutation_status: "mutation_executed",
          mutation_type: "scene_object_creation_request",
          target_scene: "EnemyAIDemo",
          object_name: "AIE_ControlledMutationProbe",
          created_object_name: "AIE_ControlledMutationProbe",
          scene_saved: true,
          duplicate_handling: "created",
          evidence_timestamp: "2026-05-01T20:14:00.000Z",
          rollback_hint: "Rollback requires separate approval: remove AIE_ControlledMutationProbe from EnemyAIDemo.",
        };
      },
    });

    const result = await bridge.executeSceneObjectCreation({
      request_id: "unity-mutation-bridge-5",
      requested_at: "2026-05-01T20:13:30.000Z",
      target_scene: "EnemyAIDemo",
      object_name: "AIE_ControlledMutationProbe",
      mutation_type: "scene_object_creation_request",
      mutation_enabled: true,
      idempotent_on_duplicate: true,
    });

    assert.equal(timeoutMs, 18_000);
    assert.equal(result.bridge_status, "bridge_ready");
  });
});

test("configured Unity rollback bridge normalizes successful rollback payloads", async () => {
  const bridge = createConfiguredUnityMutationRuntimeBridge({
    unityEditorPath: "C:/Program Files/Unity/Editor/Unity.exe",
    unityProjectPath: "E:/AI projects 2025/AI-E/orchestrator_lane/Tools/EnemyAIDemoStandalone",
    unityRollbackExecuteMethod: "EnemyAIDemo.Editor.UnityValidationProbe.RunSceneObjectRemovalRollbackFromCommandLine",
    rollbackCommandRunner: async (input) => {
      assert.equal(input.rollbackInput.object_name, "AIE_ControlledMutationProbe");
      assert.equal(input.rollbackInput.rollback_enabled, true);
      return {
        rollback_status: "rollback_executed",
        rollback_type: "scene_object_removal",
        target_scene: "EnemyAIDemo",
        object_name: "AIE_ControlledMutationProbe",
        removed_object_name: "AIE_ControlledMutationProbe",
        scene_saved: true,
        target_missing_handling: "removed",
        evidence_timestamp: "2026-05-01T20:15:00.000Z",
        raw_evidence_summary: "Controlled Unity rollback removed AIE_ControlledMutationProbe from EnemyAIDemo and saved the scene.",
      };
    },
  });

  const result = await bridge.executeSceneObjectRemoval({
    request_id: "unity-rollback-bridge-2",
    requested_at: "2026-05-01T20:14:30.000Z",
    target_scene: "EnemyAIDemo",
    object_name: "AIE_ControlledMutationProbe",
    rollback_type: "scene_object_removal",
    rollback_enabled: true,
    idempotent_on_missing: true,
  });

  assert.equal(result.bridge_status, "bridge_ready");
  assert.equal(result.rollback_status, "rollback_executed");
  assert.equal(result.scene_saved, true);
  assert.equal(result.removed_object_name, "AIE_ControlledMutationProbe");
});

test("configured Unity rollback bridge normalizes idempotent missing-target payloads", async () => {
  const bridge = createConfiguredUnityMutationRuntimeBridge({
    unityEditorPath: "C:/Program Files/Unity/Editor/Unity.exe",
    unityProjectPath: "E:/AI projects 2025/AI-E/orchestrator_lane/Tools/EnemyAIDemoStandalone",
    rollbackCommandRunner: async () => ({
      rollback_status: "rollback_idempotent",
      rollback_type: "scene_object_removal",
      target_scene: "EnemyAIDemo",
      object_name: "AIE_ControlledMutationProbe",
      removed_object_name: "",
      scene_saved: false,
      target_missing_handling: "already_missing_idempotent",
      evidence_timestamp: "2026-05-01T20:16:00.000Z",
      raw_evidence_summary: "Controlled Unity rollback confirmed that AIE_ControlledMutationProbe is already absent from EnemyAIDemo; no scene write was required.",
    }),
  });

  const result = await bridge.executeSceneObjectRemoval({
    request_id: "unity-rollback-bridge-3",
    requested_at: "2026-05-01T20:15:30.000Z",
    target_scene: "EnemyAIDemo",
    object_name: "AIE_ControlledMutationProbe",
    rollback_type: "scene_object_removal",
    rollback_enabled: true,
    idempotent_on_missing: true,
  });

  assert.equal(result.bridge_status, "bridge_ready");
  assert.equal(result.rollback_status, "rollback_idempotent");
  assert.equal(result.scene_saved, false);
  assert.equal(result.target_missing_handling, "already_missing_idempotent");
});