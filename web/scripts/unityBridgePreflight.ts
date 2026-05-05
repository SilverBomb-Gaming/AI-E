import { existsSync } from "node:fs";
import path from "node:path";

import { createConfiguredUnityReadOnlyRuntimeBridge } from "../lib/aie/unityReadOnlyRuntimeBridge";

type PreflightReport = {
  unity_editor_path: string | null;
  unity_editor_exists: boolean;
  unity_project_path: string | null;
  unity_project_exists: boolean;
  unity_scene_path: string | null;
  unity_scene_exists: boolean;
  bridge_endpoint_configured: boolean;
  bridge_mode: "command_probe" | "http_endpoint" | "unconfigured";
  bridge_probe_runnable: boolean;
  bridge_status: string | null;
  blocked_reason: string | null;
};

function normalizeText(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveScenePath(projectPath: string | null, scenePath: string | null): string | null {
  if (!projectPath || !scenePath) {
    return null;
  }

  return path.isAbsolute(scenePath)
    ? scenePath
    : path.join(projectPath, scenePath);
}

async function main() {
  const unityEditorPath = normalizeText(process.env.AIE_UNITY_EDITOR_PATH);
  const unityProjectPath = normalizeText(process.env.AIE_UNITY_PROJECT_PATH);
  const unityScenePath = normalizeText(process.env.AIE_UNITY_SCENE_PATH);
  const endpointUrl = normalizeText(process.env.AIE_UNITY_VALIDATION_ENDPOINT);

  const sceneAbsolutePath = resolveScenePath(unityProjectPath, unityScenePath);
  const bridgeMode = unityEditorPath && unityProjectPath
    ? "command_probe"
    : endpointUrl
      ? "http_endpoint"
      : "unconfigured";

  const bridge = createConfiguredUnityReadOnlyRuntimeBridge();
  const probe = await bridge.probeValidation({
    request_id: "unity-bridge-preflight",
    requested_at: new Date().toISOString(),
    scene_name_hint: unityScenePath ? path.basename(unityScenePath, path.extname(unityScenePath)) : null,
  });

  const report: PreflightReport = {
    unity_editor_path: unityEditorPath,
    unity_editor_exists: unityEditorPath ? existsSync(unityEditorPath) : false,
    unity_project_path: unityProjectPath,
    unity_project_exists: unityProjectPath ? existsSync(unityProjectPath) : false,
    unity_scene_path: unityScenePath,
    unity_scene_exists: sceneAbsolutePath ? existsSync(sceneAbsolutePath) : false,
    bridge_endpoint_configured: bridgeMode !== "unconfigured",
    bridge_mode: bridgeMode,
    bridge_probe_runnable: probe.bridge_status === "bridge_ready",
    bridge_status: probe.bridge_status,
    blocked_reason: probe.bridge_status === "bridge_unavailable" ? probe.reason : null,
  };

  console.log(JSON.stringify(report, null, 2));
}

void main();