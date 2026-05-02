export type UnityReadOnlyBridgeProbeInput = {
  request_id: string;
  requested_at: string;
  scene_name_hint: string | null;
  tracked_object_names?: string[];
};

export type UnityReadOnlyBridgeProbeSource = "http_endpoint" | "command_probe" | "none";

export type UnityReadOnlyBridgeObservation = {
  bridge_status: "bridge_ready";
  source: Exclude<UnityReadOnlyBridgeProbeSource, "none">;
  scene_validation_status: "checked_clean" | "checked_with_findings" | "unknown";
  missing_script_count: number | null;
  console_error_count: number | null;
  object_count: number | null;
  checked_scene_name: string | null;
  tracked_objects: Array<{
    name: string;
    type?: string | null;
    exists: boolean;
  }>;
  evidence_timestamp: string;
  raw_evidence_summary: string | null;
  summary: string;
  recommended_next_operator_action: string;
};

export type UnityReadOnlyBridgeUnavailable = {
  bridge_status: "bridge_unavailable";
  source: UnityReadOnlyBridgeProbeSource;
  reason: string;
  evidence_timestamp: string;
  raw_evidence_summary: string | null;
  recommended_next_operator_action: string;
};

export type UnityReadOnlyBridgeResult = UnityReadOnlyBridgeObservation | UnityReadOnlyBridgeUnavailable;

export type UnityReadOnlyRuntimeBridge = {
  probeValidation(input: UnityReadOnlyBridgeProbeInput): Promise<UnityReadOnlyBridgeResult>;
};

export type UnityReadOnlyRuntimeBridgeConfig = {
  endpointUrl?: string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  commandProbe?: (input: UnityReadOnlyBridgeProbeInput) => Promise<unknown>;
  unityEditorPath?: string | null;
  unityProjectPath?: string | null;
  unityScenePath?: string | null;
  unityExecuteMethod?: string | null;
  commandRunner?: (input: {
    unityEditorPath: string;
    unityProjectPath: string;
    unityScenePath: string | null;
    unityExecuteMethod: string;
    timeoutMs: number;
    probeInput: UnityReadOnlyBridgeProbeInput;
  }) => Promise<unknown>;
};

type EndpointPayload = {
  sceneName?: unknown;
  missingScripts?: unknown;
  consoleErrors?: unknown;
  objectCount?: unknown;
  timestamp?: unknown;
  scene_validation_status?: unknown;
  checked_scene_name?: unknown;
  missing_script_count?: unknown;
  console_error_count?: unknown;
  object_count?: unknown;
  tracked_objects?: unknown;
  evidence_timestamp?: unknown;
  raw_evidence_summary?: unknown;
  recommended_next_operator_action?: unknown;
};

const DEFAULT_UNITY_EXECUTE_METHOD = "EnemyAIDemo.Editor.UnityValidationProbe.RunValidationProbeFromCommandLine";
const UNITY_VALIDATION_JSON_PREFIX = "[AIE_UNITY_VALIDATION_JSON]";
const DEFAULT_UNITY_TIMEOUT_MS = 60_000;
const MIN_UNITY_TIMEOUT_MS = 250;
const MAX_UNITY_TIMEOUT_MS = 60_000;

function normalizeText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function normalizeOptionalCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : null;
}

function normalizeSceneValidationStatus(value: unknown): UnityReadOnlyBridgeObservation["scene_validation_status"] | null {
  return value === "checked_clean" || value === "checked_with_findings" || value === "unknown"
    ? value
    : null;
}

function normalizeTrackedObjects(
  value: unknown,
  trackedObjectNames: string[] | undefined,
): UnityReadOnlyBridgeObservation["tracked_objects"] {
  const fallbackNames = [...new Set((trackedObjectNames ?? []).map((item) => item.trim()).filter(Boolean))];

  if (!Array.isArray(value)) {
    return fallbackNames.map((name) => ({
      name,
      type: null,
      exists: false,
    }));
  }

  const normalized = value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const candidate = item as {
      name?: unknown;
      type?: unknown;
      exists?: unknown;
    };
    const name = normalizeText(candidate.name);
    if (!name) {
      return [];
    }

    const exists = typeof candidate.exists === "boolean"
      ? candidate.exists
      : typeof candidate.exists === "string"
        ? /^true$/i.test(candidate.exists.trim())
        : false;

    return [{
      name,
      type: normalizeText(candidate.type),
      exists,
    }];
  });

  return normalized.length > 0
    ? normalized
    : fallbackNames.map((name) => ({
        name,
        type: null,
        exists: false,
      }));
}

function normalizeTimeoutMs(value: unknown, fallback: number = DEFAULT_UNITY_TIMEOUT_MS): number {
  const numericValue = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value.trim())
      : Number.NaN;

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(MAX_UNITY_TIMEOUT_MS, Math.max(MIN_UNITY_TIMEOUT_MS, Math.trunc(numericValue)));
}

function buildUnavailableResult(
  input: UnityReadOnlyBridgeProbeInput,
  source: UnityReadOnlyBridgeProbeSource,
  reason: string,
  rawEvidenceSummary: string | null = null,
): UnityReadOnlyBridgeUnavailable {
  return {
    bridge_status: "bridge_unavailable",
    source,
    reason,
    evidence_timestamp: input.requested_at,
    raw_evidence_summary: rawEvidenceSummary,
    recommended_next_operator_action: "Keep the request in reviewed adapter-preview mode or connect a verified read-only Unity bridge before retrying.",
  };
}

function buildSummary(payload: {
  checked_scene_name: string | null;
  scene_validation_status: UnityReadOnlyBridgeObservation["scene_validation_status"];
  missing_script_count: number | null;
  console_error_count: number | null;
  object_count: number | null;
}): string {
  const sceneLabel = payload.checked_scene_name ?? "the requested scene";
  return `Unity read-only validation probe completed for ${sceneLabel} with status ${payload.scene_validation_status}, missing scripts ${payload.missing_script_count ?? "unknown"}, console errors ${payload.console_error_count ?? "unknown"}, and object count ${payload.object_count ?? "unknown"}.`;
}

function normalizeObservation(
  input: UnityReadOnlyBridgeProbeInput,
  source: Exclude<UnityReadOnlyBridgeProbeSource, "none">,
  payload: unknown,
): UnityReadOnlyBridgeResult {
  if (!payload || typeof payload !== "object") {
    return buildUnavailableResult(input, source, "Unity read-only bridge returned a malformed response.");
  }

  const candidate = payload as EndpointPayload;
  const inferredSceneValidationStatus = (() => {
    const hasLiveCommandShape = [
      candidate.sceneName,
      candidate.missingScripts,
      candidate.consoleErrors,
      candidate.objectCount,
      candidate.timestamp,
    ].some((value) => value !== undefined);
    if (!hasLiveCommandShape) {
      return null;
    }

    const missingScripts = normalizeOptionalCount(candidate.missing_script_count ?? candidate.missingScripts);
    const consoleErrors = normalizeOptionalCount(candidate.console_error_count ?? candidate.consoleErrors);
    if (missingScripts === null && consoleErrors === null) {
      return "unknown";
    }

    return (missingScripts ?? 0) > 0 || (consoleErrors ?? 0) > 0
      ? "checked_with_findings"
      : "checked_clean";
  })();
  const sceneValidationStatus = normalizeSceneValidationStatus(candidate.scene_validation_status) ?? inferredSceneValidationStatus;
  if (!sceneValidationStatus) {
    return buildUnavailableResult(
      input,
      source,
      "Unity read-only bridge response did not include a supported scene validation status.",
      normalizeText(candidate.raw_evidence_summary),
    );
  }

  const checkedSceneName = normalizeText(candidate.checked_scene_name ?? candidate.sceneName) ?? input.scene_name_hint;
  const missingScriptCount = normalizeOptionalCount(candidate.missing_script_count ?? candidate.missingScripts);
  const consoleErrorCount = normalizeOptionalCount(candidate.console_error_count ?? candidate.consoleErrors);
  const objectCount = normalizeOptionalCount(candidate.object_count ?? candidate.objectCount);
  const trackedObjects = normalizeTrackedObjects(candidate.tracked_objects, input.tracked_object_names);
  const evidenceTimestamp = normalizeText(candidate.evidence_timestamp ?? candidate.timestamp) ?? input.requested_at;
  const rawEvidenceSummary = normalizeText(candidate.raw_evidence_summary);
  const recommendedNextOperatorAction = normalizeText(candidate.recommended_next_operator_action)
    ?? "Review the Unity validation evidence and decide whether to keep the request in review or continue delivery preparation.";

  return {
    bridge_status: "bridge_ready",
    source,
    scene_validation_status: sceneValidationStatus,
    missing_script_count: missingScriptCount,
    console_error_count: consoleErrorCount,
    object_count: objectCount,
    checked_scene_name: checkedSceneName,
    tracked_objects: trackedObjects,
    evidence_timestamp: evidenceTimestamp,
    raw_evidence_summary: rawEvidenceSummary,
    summary: buildSummary({
      checked_scene_name: checkedSceneName,
      scene_validation_status: sceneValidationStatus,
      missing_script_count: missingScriptCount,
      console_error_count: consoleErrorCount,
      object_count: objectCount,
    }),
    recommended_next_operator_action: recommendedNextOperatorAction,
  };
}

export function createUnavailableUnityReadOnlyRuntimeBridge(reason?: string): UnityReadOnlyRuntimeBridge {
  return {
    async probeValidation(input: UnityReadOnlyBridgeProbeInput): Promise<UnityReadOnlyBridgeResult> {
      return buildUnavailableResult(
        input,
        "none",
        reason ?? "No Unity read-only runtime endpoint is configured for validation probes.",
      );
    },
  };
}

export function createConfiguredUnityReadOnlyRuntimeBridge(
  config: UnityReadOnlyRuntimeBridgeConfig = {},
): UnityReadOnlyRuntimeBridge {
  const endpointUrl = config.endpointUrl ?? process.env.AIE_UNITY_VALIDATION_ENDPOINT ?? null;
  const unityEditorPath = config.unityEditorPath ?? process.env.AIE_UNITY_EDITOR_PATH ?? null;
  const unityProjectPath = config.unityProjectPath ?? process.env.AIE_UNITY_PROJECT_PATH ?? null;
  const unityScenePath = config.unityScenePath ?? process.env.AIE_UNITY_SCENE_PATH ?? null;
  const unityExecuteMethod = config.unityExecuteMethod ?? process.env.AIE_UNITY_EXECUTE_METHOD ?? DEFAULT_UNITY_EXECUTE_METHOD;
  const timeoutMs = normalizeTimeoutMs(config.timeoutMs ?? process.env.AIE_UNITY_TIMEOUT_MS);
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    async probeValidation(input: UnityReadOnlyBridgeProbeInput): Promise<UnityReadOnlyBridgeResult> {
      if (config.commandProbe) {
        try {
          const payload = await config.commandProbe(input);
          return normalizeObservation(input, "command_probe", payload);
        } catch (error) {
          return buildUnavailableResult(input, "command_probe", `Unity command probe failed: ${String(error)}`);
        }
      }

      if (unityEditorPath && unityProjectPath) {
        try {
          const payload = await (config.commandRunner ?? runUnityCommandProbe)({
            unityEditorPath,
            unityProjectPath,
            unityScenePath,
            unityExecuteMethod,
            timeoutMs,
            probeInput: input,
          });
          return normalizeObservation(input, "command_probe", payload);
        } catch (error) {
          return buildUnavailableResult(input, "command_probe", `Unity command probe failed: ${String(error)}`);
        }
      }

      if (!endpointUrl) {
        return buildUnavailableResult(input, "none", "No Unity read-only runtime endpoint is configured for validation probes.");
      }

      const abortController = new AbortController();
      const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs);

      try {
        const response = await fetchImpl(endpointUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "validation_probe",
            request_id: input.request_id,
            requested_at: input.requested_at,
            scene_name_hint: input.scene_name_hint,
            read_only: true,
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          return buildUnavailableResult(input, "http_endpoint", `Unity read-only runtime endpoint returned HTTP ${response.status}.`);
        }

        const payload = await response.json();
        return normalizeObservation(input, "http_endpoint", payload);
      } catch (error) {
        const reason = error instanceof Error && error.name === "AbortError"
          ? `Unity read-only runtime endpoint timed out after ${timeoutMs}ms.`
          : `Unity read-only runtime endpoint could not be reached: ${String(error)}`;
        return buildUnavailableResult(input, "http_endpoint", reason);
      } finally {
        clearTimeout(timeoutHandle);
      }
    },
  };
}

async function runUnityCommandProbe(input: {
  unityEditorPath: string;
  unityProjectPath: string;
  unityScenePath: string | null;
  unityExecuteMethod: string;
  timeoutMs: number;
  probeInput: UnityReadOnlyBridgeProbeInput;
}): Promise<unknown> {
  const { spawn } = await import("node:child_process");

  return await new Promise<unknown>((resolve, reject) => {
    const args = [
      "-batchmode",
      "-nographics",
      "-quit",
      "-projectPath",
      input.unityProjectPath,
      "-executeMethod",
      input.unityExecuteMethod,
    ];

    const child = spawn(input.unityEditorPath, args, {
      env: {
        ...process.env,
        AIE_UNITY_VALIDATION_REQUEST_ID: input.probeInput.request_id,
        AIE_UNITY_VALIDATION_REQUESTED_AT: input.probeInput.requested_at,
        AIE_UNITY_SCENE_NAME_HINT: input.probeInput.scene_name_hint ?? "",
        AIE_UNITY_TRACKED_OBJECT_NAMES: (input.probeInput.tracked_object_names ?? []).join("|"),
        ...(input.unityScenePath ? { AIE_UNITY_SCENE_PATH: input.unityScenePath } : {}),
      },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeoutHandle = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill();
      reject(new Error(`Unity command probe timed out after ${input.timeoutMs}ms.`));
    }, input.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutHandle);
      reject(error);
    });

    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutHandle);

      if (exitCode !== 0) {
        reject(new Error(`Unity exited with code ${exitCode}. ${stderr.trim() || stdout.trim()}`.trim()));
        return;
      }

      const payloadLine = stdout
        .split(/\r?\n/)
        .find((line) => line.startsWith(UNITY_VALIDATION_JSON_PREFIX));

      if (!payloadLine) {
        reject(new Error(`Unity command probe did not emit ${UNITY_VALIDATION_JSON_PREFIX}. ${stdout.trim()}`.trim()));
        return;
      }

      try {
        resolve(JSON.parse(payloadLine.slice(UNITY_VALIDATION_JSON_PREFIX.length)));
      } catch (error) {
        reject(new Error(`Unity command probe emitted malformed JSON: ${String(error)}`));
      }
    });
  });
}
