export type UnityMutationBridgeInput = {
  request_id: string;
  requested_at: string;
  target_scene: string;
  object_name: string;
  mutation_type: "scene_object_creation_request";
  mutation_enabled: boolean;
  idempotent_on_duplicate: boolean;
};

export type UnityRollbackBridgeInput = {
  request_id: string;
  requested_at: string;
  target_scene: string;
  object_name: string;
  rollback_type: "scene_object_removal";
  rollback_enabled: boolean;
  idempotent_on_missing: boolean;
};

export type UnityMutationBridgeSource = "command_probe" | "none";

export type UnityMutationBridgeSuccess = {
  bridge_status: "bridge_ready";
  source: "command_probe";
  mutation_status: "mutation_executed" | "mutation_idempotent";
  mutation_type: "scene_object_creation_request";
  target_scene: string;
  object_name: string;
  created_object_name: string;
  scene_saved: boolean;
  duplicate_handling: "created" | "already_exists_idempotent";
  evidence_timestamp: string;
  raw_evidence_summary: string | null;
  summary: string;
  rollback_hint: string;
  recommended_next_operator_action: string;
};

export type UnityRollbackBridgeSuccess = {
  bridge_status: "bridge_ready";
  source: "command_probe";
  rollback_status: "rollback_executed" | "rollback_idempotent";
  rollback_type: "scene_object_removal";
  target_scene: string;
  object_name: string;
  removed_object_name: string | null;
  scene_saved: boolean;
  target_missing_handling: "removed" | "already_missing_idempotent";
  evidence_timestamp: string;
  raw_evidence_summary: string | null;
  summary: string;
  recommended_next_operator_action: string;
};

export type UnityMutationBridgeFailure = {
  bridge_status: "bridge_failure";
  source: UnityMutationBridgeSource;
  reason: string;
  evidence_timestamp: string;
  raw_evidence_summary: string | null;
  recommended_next_operator_action: string;
};

export type UnityMutationBridgeUnavailable = {
  bridge_status: "bridge_unavailable";
  source: UnityMutationBridgeSource;
  reason: string;
  evidence_timestamp: string;
  raw_evidence_summary: string | null;
  recommended_next_operator_action: string;
};

export type UnityMutationBridgeResult = UnityMutationBridgeSuccess | UnityMutationBridgeFailure | UnityMutationBridgeUnavailable;
export type UnityRollbackBridgeResult = UnityRollbackBridgeSuccess | UnityMutationBridgeFailure | UnityMutationBridgeUnavailable;

export type UnityMutationRuntimeBridge = {
  executeSceneObjectCreation(input: UnityMutationBridgeInput): Promise<UnityMutationBridgeResult>;
  executeSceneObjectRemoval(input: UnityRollbackBridgeInput): Promise<UnityRollbackBridgeResult>;
};

export type UnityMutationRuntimeBridgeConfig = {
  timeoutMs?: number;
  unityEditorPath?: string | null;
  unityProjectPath?: string | null;
  unityScenePath?: string | null;
  unityExecuteMethod?: string | null;
  unityRollbackExecuteMethod?: string | null;
  commandRunner?: (input: {
    unityEditorPath: string;
    unityProjectPath: string;
    unityScenePath: string | null;
    unityExecuteMethod: string;
    timeoutMs: number;
    mutationInput: UnityMutationBridgeInput;
  }) => Promise<unknown>;
  rollbackCommandRunner?: (input: {
    unityEditorPath: string;
    unityProjectPath: string;
    unityScenePath: string | null;
    unityExecuteMethod: string;
    timeoutMs: number;
    rollbackInput: UnityRollbackBridgeInput;
  }) => Promise<unknown>;
};

type MutationPayload = {
  mutation_status?: unknown;
  mutation_type?: unknown;
  target_scene?: unknown;
  object_name?: unknown;
  created_object_name?: unknown;
  scene_saved?: unknown;
  duplicate_handling?: unknown;
  evidence_timestamp?: unknown;
  raw_evidence_summary?: unknown;
  rollback_hint?: unknown;
  recommended_next_operator_action?: unknown;
};

type RollbackPayload = {
  rollback_status?: unknown;
  rollback_type?: unknown;
  target_scene?: unknown;
  object_name?: unknown;
  removed_object_name?: unknown;
  scene_saved?: unknown;
  target_missing_handling?: unknown;
  evidence_timestamp?: unknown;
  raw_evidence_summary?: unknown;
  recommended_next_operator_action?: unknown;
};

const DEFAULT_UNITY_MUTATION_EXECUTE_METHOD = "EnemyAIDemo.Editor.UnityValidationProbe.RunSceneObjectCreationMutationFromCommandLine";
const DEFAULT_UNITY_ROLLBACK_EXECUTE_METHOD = "EnemyAIDemo.Editor.UnityValidationProbe.RunSceneObjectRemovalRollbackFromCommandLine";
const UNITY_MUTATION_JSON_PREFIX = "[AIE_UNITY_MUTATION_JSON]";
const UNITY_ROLLBACK_JSON_PREFIX = "[AIE_UNITY_ROLLBACK_JSON]";
const DEFAULT_UNITY_TIMEOUT_MS = 60_000;
const MIN_UNITY_TIMEOUT_MS = 250;
const MAX_UNITY_TIMEOUT_MS = 60_000;

function normalizeText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (/^true$/i.test(value.trim())) {
      return true;
    }
    if (/^false$/i.test(value.trim())) {
      return false;
    }
  }

  return null;
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
  input: UnityMutationBridgeInput | UnityRollbackBridgeInput,
  source: UnityMutationBridgeSource,
  reason: string,
  rawEvidenceSummary: string | null = null,
): UnityMutationBridgeUnavailable {
  return {
    bridge_status: "bridge_unavailable",
    source,
    reason,
    evidence_timestamp: input.requested_at,
    raw_evidence_summary: rawEvidenceSummary,
    recommended_next_operator_action: "Keep the request in reviewed plan-only mode until the verified Unity mutation bridge is available.",
  };
}

function buildFailureResult(
  input: UnityMutationBridgeInput | UnityRollbackBridgeInput,
  source: UnityMutationBridgeSource,
  reason: string,
  rawEvidenceSummary: string | null = null,
): UnityMutationBridgeFailure {
  return {
    bridge_status: "bridge_failure",
    source,
    reason,
    evidence_timestamp: input.requested_at,
    raw_evidence_summary: rawEvidenceSummary,
    recommended_next_operator_action: "Review the mutation failure evidence, keep the switch disabled, and do not retry until the blocker is understood.",
  };
}

function buildSummary(payload: {
  mutation_status: UnityMutationBridgeSuccess["mutation_status"];
  created_object_name: string;
  target_scene: string;
  scene_saved: boolean;
}): string {
  const action = payload.mutation_status === "mutation_idempotent" ? "confirmed existing object" : "created object";
  return `Controlled Unity mutation ${action} ${payload.created_object_name} in ${payload.target_scene} with scene_saved ${String(payload.scene_saved)}.`;
}

function buildRollbackSummary(payload: {
  rollback_status: UnityRollbackBridgeSuccess["rollback_status"];
  target_scene: string;
  object_name: string;
  scene_saved: boolean;
}): string {
  const action = payload.rollback_status === "rollback_idempotent" ? "confirmed missing target" : "removed target";
  return `Controlled Unity rollback ${action} ${payload.object_name} in ${payload.target_scene} with scene_saved ${String(payload.scene_saved)}.`;
}

function normalizeSuccess(
  input: UnityMutationBridgeInput,
  payload: unknown,
): UnityMutationBridgeResult {
  if (!payload || typeof payload !== "object") {
    return buildFailureResult(input, "command_probe", "Unity mutation bridge returned a malformed response.");
  }

  const candidate = payload as MutationPayload;
  const mutationStatus = candidate.mutation_status === "mutation_executed" || candidate.mutation_status === "mutation_idempotent"
    ? candidate.mutation_status
    : null;
  if (!mutationStatus) {
    return buildFailureResult(
      input,
      "command_probe",
      "Unity mutation bridge response did not include a supported mutation status.",
      normalizeText(candidate.raw_evidence_summary),
    );
  }

  const mutationType = candidate.mutation_type === "scene_object_creation_request"
    ? candidate.mutation_type
    : null;
  if (!mutationType) {
    return buildFailureResult(
      input,
      "command_probe",
      "Unity mutation bridge response did not include the supported mutation type.",
      normalizeText(candidate.raw_evidence_summary),
    );
  }

  const targetScene = normalizeText(candidate.target_scene) ?? input.target_scene;
  const createdObjectName = normalizeText(candidate.created_object_name) ?? normalizeText(candidate.object_name) ?? input.object_name;
  const sceneSaved = normalizeBoolean(candidate.scene_saved);
  const duplicateHandling = candidate.duplicate_handling === "created" || candidate.duplicate_handling === "already_exists_idempotent"
    ? candidate.duplicate_handling
    : mutationStatus === "mutation_idempotent"
      ? "already_exists_idempotent"
      : "created";
  const evidenceTimestamp = normalizeText(candidate.evidence_timestamp) ?? input.requested_at;
  const rawEvidenceSummary = normalizeText(candidate.raw_evidence_summary);
  const rollbackHint = normalizeText(candidate.rollback_hint)
    ?? `Rollback requires separate approval: remove ${createdObjectName} from ${targetScene}.`;
  const recommendedNextOperatorAction = normalizeText(candidate.recommended_next_operator_action)
    ?? "Review the controlled Unity mutation evidence and keep rollback as a separately approved follow-up action.";

  if (!createdObjectName || sceneSaved === null || !targetScene) {
    return buildFailureResult(
      input,
      "command_probe",
      "Unity mutation bridge response omitted one or more required mutation fields.",
      rawEvidenceSummary,
    );
  }

  return {
    bridge_status: "bridge_ready",
    source: "command_probe",
    mutation_status: mutationStatus,
    mutation_type: mutationType,
    target_scene: targetScene,
    object_name: normalizeText(candidate.object_name) ?? input.object_name,
    created_object_name: createdObjectName,
    scene_saved: sceneSaved,
    duplicate_handling: duplicateHandling,
    evidence_timestamp: evidenceTimestamp,
    raw_evidence_summary: rawEvidenceSummary,
    summary: buildSummary({
      mutation_status: mutationStatus,
      created_object_name: createdObjectName,
      target_scene: targetScene,
      scene_saved: sceneSaved,
    }),
    rollback_hint: rollbackHint,
    recommended_next_operator_action: recommendedNextOperatorAction,
  };
}

function normalizeRollbackSuccess(
  input: UnityRollbackBridgeInput,
  payload: unknown,
): UnityRollbackBridgeResult {
  if (!payload || typeof payload !== "object") {
    return buildFailureResult(input, "command_probe", "Unity rollback bridge returned a malformed response.");
  }

  const candidate = payload as RollbackPayload;
  const rollbackStatus = candidate.rollback_status === "rollback_executed" || candidate.rollback_status === "rollback_idempotent"
    ? candidate.rollback_status
    : null;
  if (!rollbackStatus) {
    return buildFailureResult(
      input,
      "command_probe",
      "Unity rollback bridge response did not include a supported rollback status.",
      normalizeText(candidate.raw_evidence_summary),
    );
  }

  const rollbackType = candidate.rollback_type === "scene_object_removal"
    ? candidate.rollback_type
    : null;
  if (!rollbackType) {
    return buildFailureResult(
      input,
      "command_probe",
      "Unity rollback bridge response did not include the supported rollback type.",
      normalizeText(candidate.raw_evidence_summary),
    );
  }

  const targetScene = normalizeText(candidate.target_scene) ?? input.target_scene;
  const objectName = normalizeText(candidate.object_name) ?? input.object_name;
  const removedObjectName = normalizeText(candidate.removed_object_name);
  const sceneSaved = normalizeBoolean(candidate.scene_saved);
  const targetMissingHandling = candidate.target_missing_handling === "removed" || candidate.target_missing_handling === "already_missing_idempotent"
    ? candidate.target_missing_handling
    : rollbackStatus === "rollback_idempotent"
      ? "already_missing_idempotent"
      : "removed";
  const evidenceTimestamp = normalizeText(candidate.evidence_timestamp) ?? input.requested_at;
  const rawEvidenceSummary = normalizeText(candidate.raw_evidence_summary);
  const recommendedNextOperatorAction = normalizeText(candidate.recommended_next_operator_action)
    ?? "Review the controlled Unity rollback evidence and keep broader mutation lanes disabled until repeatability is verified.";

  if (!objectName || !targetScene || sceneSaved === null) {
    return buildFailureResult(
      input,
      "command_probe",
      "Unity rollback bridge response omitted one or more required rollback fields.",
      rawEvidenceSummary,
    );
  }

  if (rollbackStatus === "rollback_executed" && !removedObjectName) {
    return buildFailureResult(
      input,
      "command_probe",
      "Unity rollback bridge response omitted the removed object name for an executed rollback.",
      rawEvidenceSummary,
    );
  }

  return {
    bridge_status: "bridge_ready",
    source: "command_probe",
    rollback_status: rollbackStatus,
    rollback_type: rollbackType,
    target_scene: targetScene,
    object_name: objectName,
    removed_object_name: removedObjectName,
    scene_saved: sceneSaved,
    target_missing_handling: targetMissingHandling,
    evidence_timestamp: evidenceTimestamp,
    raw_evidence_summary: rawEvidenceSummary,
    summary: buildRollbackSummary({
      rollback_status: rollbackStatus,
      target_scene: targetScene,
      object_name: objectName,
      scene_saved: sceneSaved,
    }),
    recommended_next_operator_action: recommendedNextOperatorAction,
  };
}

export function createUnavailableUnityMutationRuntimeBridge(reason?: string): UnityMutationRuntimeBridge {
  return {
    async executeSceneObjectCreation(input: UnityMutationBridgeInput): Promise<UnityMutationBridgeResult> {
      return buildUnavailableResult(
        input,
        "none",
        reason ?? "No Unity mutation runtime bridge is configured for controlled scene mutation.",
      );
    },
    async executeSceneObjectRemoval(input: UnityRollbackBridgeInput): Promise<UnityRollbackBridgeResult> {
      return buildUnavailableResult(
        input,
        "none",
        reason ?? "No Unity rollback runtime bridge is configured for controlled scene rollback.",
      );
    },
  };
}

export function createConfiguredUnityMutationRuntimeBridge(
  config: UnityMutationRuntimeBridgeConfig = {},
): UnityMutationRuntimeBridge {
  const unityEditorPath = config.unityEditorPath ?? process.env.AIE_UNITY_EDITOR_PATH ?? null;
  const unityProjectPath = config.unityProjectPath ?? process.env.AIE_UNITY_PROJECT_PATH ?? null;
  const unityScenePath = config.unityScenePath ?? process.env.AIE_UNITY_SCENE_PATH ?? null;
  const unityExecuteMethod = config.unityExecuteMethod ?? process.env.AIE_UNITY_MUTATION_EXECUTE_METHOD ?? DEFAULT_UNITY_MUTATION_EXECUTE_METHOD;
  const unityRollbackExecuteMethod = config.unityRollbackExecuteMethod ?? process.env.AIE_UNITY_ROLLBACK_EXECUTE_METHOD ?? DEFAULT_UNITY_ROLLBACK_EXECUTE_METHOD;
  const timeoutMs = normalizeTimeoutMs(config.timeoutMs ?? process.env.AIE_UNITY_TIMEOUT_MS);

  return {
    async executeSceneObjectCreation(input: UnityMutationBridgeInput): Promise<UnityMutationBridgeResult> {
      if (!unityEditorPath || !unityProjectPath) {
        return buildUnavailableResult(input, "none", "No Unity mutation bridge editor/project configuration is available.");
      }

      try {
        const payload = await (config.commandRunner ?? runUnityMutationCommandProbe)({
          unityEditorPath,
          unityProjectPath,
          unityScenePath,
          unityExecuteMethod,
          timeoutMs,
          mutationInput: input,
        });

        return normalizeSuccess(input, payload);
      } catch (error) {
        return buildFailureResult(input, "command_probe", `Unity mutation command probe failed: ${String(error)}`);
      }
    },
    async executeSceneObjectRemoval(input: UnityRollbackBridgeInput): Promise<UnityRollbackBridgeResult> {
      if (!unityEditorPath || !unityProjectPath) {
        return buildUnavailableResult(input, "none", "No Unity rollback bridge editor/project configuration is available.");
      }

      try {
        const payload = await (config.rollbackCommandRunner ?? runUnityRollbackCommandProbe)({
          unityEditorPath,
          unityProjectPath,
          unityScenePath,
          unityExecuteMethod: unityRollbackExecuteMethod,
          timeoutMs,
          rollbackInput: input,
        });

        return normalizeRollbackSuccess(input, payload);
      } catch (error) {
        return buildFailureResult(input, "command_probe", `Unity rollback command probe failed: ${String(error)}`);
      }
    },
  };
}

async function runUnityMutationCommandProbe(input: {
  unityEditorPath: string;
  unityProjectPath: string;
  unityScenePath: string | null;
  unityExecuteMethod: string;
  timeoutMs: number;
  mutationInput: UnityMutationBridgeInput;
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
        AIE_UNITY_SCENE_PATH: input.unityScenePath ?? input.mutationInput.target_scene,
        AIE_UNITY_MUTATION_REQUEST_ID: input.mutationInput.request_id,
        AIE_UNITY_MUTATION_REQUESTED_AT: input.mutationInput.requested_at,
        AIE_UNITY_MUTATION_OBJECT_NAME: input.mutationInput.object_name,
        AIE_UNITY_MUTATION_TYPE: input.mutationInput.mutation_type,
        AIE_UNITY_MUTATION_ENABLED: String(input.mutationInput.mutation_enabled),
        AIE_UNITY_MUTATION_IDEMPOTENT_ON_DUPLICATE: String(input.mutationInput.idempotent_on_duplicate),
      },
      stdio: ["ignore", "pipe", "pipe"],
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
      reject(new Error(`Unity mutation command probe timed out after ${input.timeoutMs}ms.`));
    }, input.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutHandle);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutHandle);

      const output = `${stdout}\n${stderr}`;
      const jsonLine = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.startsWith(UNITY_MUTATION_JSON_PREFIX));

      if (!jsonLine) {
        reject(new Error(code === 0
          ? "Unity mutation command probe did not emit a structured mutation payload."
          : `Unity mutation command probe exited with code ${code ?? -1}. ${output.trim()}`));
        return;
      }

      try {
        resolve(JSON.parse(jsonLine.slice(UNITY_MUTATION_JSON_PREFIX.length)));
      } catch (error) {
        reject(new Error(`Unity mutation command probe emitted invalid JSON: ${String(error)}`));
      }
    });
  });
}

async function runUnityRollbackCommandProbe(input: {
  unityEditorPath: string;
  unityProjectPath: string;
  unityScenePath: string | null;
  unityExecuteMethod: string;
  timeoutMs: number;
  rollbackInput: UnityRollbackBridgeInput;
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
        AIE_UNITY_SCENE_PATH: input.unityScenePath ?? input.rollbackInput.target_scene,
        AIE_UNITY_ROLLBACK_REQUEST_ID: input.rollbackInput.request_id,
        AIE_UNITY_ROLLBACK_REQUESTED_AT: input.rollbackInput.requested_at,
        AIE_UNITY_ROLLBACK_OBJECT_NAME: input.rollbackInput.object_name,
        AIE_UNITY_ROLLBACK_TYPE: input.rollbackInput.rollback_type,
        AIE_UNITY_ROLLBACK_ENABLED: String(input.rollbackInput.rollback_enabled),
        AIE_UNITY_ROLLBACK_IDEMPOTENT_ON_MISSING: String(input.rollbackInput.idempotent_on_missing),
      },
      stdio: ["ignore", "pipe", "pipe"],
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
      reject(new Error(`Unity rollback command probe timed out after ${input.timeoutMs}ms.`));
    }, input.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutHandle);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutHandle);

      const output = `${stdout}\n${stderr}`;
      const jsonLine = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.startsWith(UNITY_ROLLBACK_JSON_PREFIX));

      if (!jsonLine) {
        reject(new Error(code === 0
          ? "Unity rollback command probe did not emit a structured rollback payload."
          : `Unity rollback command probe exited with code ${code ?? -1}. ${output.trim()}`));
        return;
      }

      try {
        resolve(JSON.parse(jsonLine.slice(UNITY_ROLLBACK_JSON_PREFIX.length)));
      } catch (error) {
        reject(new Error(`Unity rollback command probe emitted invalid JSON: ${String(error)}`));
      }
    });
  });
}