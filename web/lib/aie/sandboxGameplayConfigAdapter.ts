// AI-E SANDBOX GAMEPLAY CONFIG ADAPTER (EXEC-0052-D)
//
// First real gameplay-oriented governed sandbox mutation.
// Reads sandboxGameplayConfig.json, applies a deterministic tuning step, writes back.
// On first invocation: creates the file with default gameplay values.
//
// Each invocation applies:
//   version          += 1
//   movementSpeed    += 0.5
//   staminaCooldown  -= 0.1   (reduced for responsiveness)
//   enemyAggroRange  += 1.0
//   lastPatch        = operationRequest (truncated to 80 chars)
//
// Lifecycle: queued → authorization_verified → dispatching → running → completed
// stdout: BEFORE JSON + AFTER JSON + diff summary
//
// NO child_process. NO shell. NO network. NO production mutation.
// Sandbox-scoped read+write only. Single JSON file. Human authority final.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

import {
  advanceLifecycleState,
  createRuntimeExecutionLifecycle,
  makeFailedInvocationResult,
  makeOutputCapture,
  makeRuntimeAdapterSafetyBoundary,
  makeRuntimeFailure,
  type GovernedRuntimeAdapter,
  type GovernedRuntimeAdapterCapability,
  type GovernedRuntimeAdapterId,
  type GovernedRuntimeInvocation,
  type RuntimeInvocationResult,
} from "./governedRuntimeAdapterContract";

// =====================================================================================
// ADAPTER CONSTANTS
// =====================================================================================

export const SANDBOX_GAMEPLAY_CONFIG_ADAPTER_ID = "openclaw-sandbox-gameplay-config-v1" as GovernedRuntimeAdapterId;
export const SANDBOX_GAMEPLAY_CONFIG_ADAPTER_VERSION = "EXEC-0052-D";
export const SANDBOX_GAMEPLAY_CONFIG_FILE_NAME = "sandboxGameplayConfig.json";

const MAX_STDOUT_BYTES = 65_536;
const MAX_STDERR_BYTES = 8_192;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_PATCH_LABEL_LENGTH = 80;

// =====================================================================================
// GAMEPLAY CONFIG TYPE
// =====================================================================================

export type SandboxGameplayConfig = {
  version: number;
  movementSpeed: number;
  staminaCooldown: number;
  enemyAggroRange: number;
  lastPatch: string;
};

export const DEFAULT_GAMEPLAY_CONFIG: SandboxGameplayConfig = {
  version: 1,
  movementSpeed: 5.0,
  staminaCooldown: 1.5,
  enemyAggroRange: 15.0,
  lastPatch: "initial",
};

export const GAMEPLAY_CONFIG_TUNING_STEP = {
  movementSpeed: 0.5,
  staminaCooldown: -0.1,
  enemyAggroRange: 1.0,
} as const;

// =====================================================================================
// INJECTABLE FILESYSTEM
// =====================================================================================

export type SandboxGameplayConfigFilesystem = {
  createDirectory: (absolutePath: string) => Promise<void>;
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  readFile: (absolutePath: string) => Promise<string | null>;
};

function resolveAdapterFilesystem(input?: SandboxGameplayConfigFilesystem): SandboxGameplayConfigFilesystem {
  return {
    createDirectory: input?.createDirectory ?? ((p) => mkdir(p, { recursive: true }).then(() => undefined)),
    writeFile: input?.writeFile ?? ((p, c) => writeFile(p, c, "utf8")),
    readFile: input?.readFile ?? (async (p) => {
      try {
        return await readFile(p, "utf8");
      } catch (e: unknown) {
        if (
          typeof e === "object" && e !== null && "code" in e &&
          (e as { code: string }).code === "ENOENT"
        ) {
          return null;
        }
        throw e;
      }
    }),
  };
}

// =====================================================================================
// PATH SAFETY
// =====================================================================================

function isWithinWorkspace(workspaceRoot: string, targetAbsolutePath: string): boolean {
  const relative = path.relative(workspaceRoot, targetAbsolutePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

// =====================================================================================
// GAMEPLAY CONFIG HELPERS
// =====================================================================================

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parseGameplayConfig(content: string): SandboxGameplayConfig {
  const parsed = JSON.parse(content) as Record<string, unknown>;
  return {
    version: typeof parsed.version === "number" ? parsed.version : 1,
    movementSpeed: typeof parsed.movementSpeed === "number" ? parsed.movementSpeed : DEFAULT_GAMEPLAY_CONFIG.movementSpeed,
    staminaCooldown: typeof parsed.staminaCooldown === "number" ? parsed.staminaCooldown : DEFAULT_GAMEPLAY_CONFIG.staminaCooldown,
    enemyAggroRange: typeof parsed.enemyAggroRange === "number" ? parsed.enemyAggroRange : DEFAULT_GAMEPLAY_CONFIG.enemyAggroRange,
    lastPatch: typeof parsed.lastPatch === "string" ? parsed.lastPatch : "unknown",
  };
}

export function applyGameplayTuning(
  config: SandboxGameplayConfig,
  patchLabel: string,
): { next: SandboxGameplayConfig; diffLines: string[] } {
  const next: SandboxGameplayConfig = {
    version: config.version + 1,
    movementSpeed: round2(config.movementSpeed + GAMEPLAY_CONFIG_TUNING_STEP.movementSpeed),
    staminaCooldown: round2(config.staminaCooldown + GAMEPLAY_CONFIG_TUNING_STEP.staminaCooldown),
    enemyAggroRange: round2(config.enemyAggroRange + GAMEPLAY_CONFIG_TUNING_STEP.enemyAggroRange),
    lastPatch: patchLabel.slice(0, MAX_PATCH_LABEL_LENGTH),
  };
  const diffLines = [
    `  version:         ${config.version} → ${next.version}`,
    `  movementSpeed:   ${config.movementSpeed} → ${next.movementSpeed} (+${GAMEPLAY_CONFIG_TUNING_STEP.movementSpeed})`,
    `  staminaCooldown: ${config.staminaCooldown} → ${next.staminaCooldown} (${GAMEPLAY_CONFIG_TUNING_STEP.staminaCooldown})`,
    `  enemyAggroRange: ${config.enemyAggroRange} → ${next.enemyAggroRange} (+${GAMEPLAY_CONFIG_TUNING_STEP.enemyAggroRange})`,
    `  lastPatch:       "${patchLabel.slice(0, MAX_PATCH_LABEL_LENGTH)}"`,
  ];
  return { next, diffLines };
}

export function serializeGameplayConfig(config: SandboxGameplayConfig): string {
  return JSON.stringify(config, null, 2) + "\n";
}

// =====================================================================================
// ADAPTER CAPABILITY
// =====================================================================================

const SANDBOX_GAMEPLAY_CONFIG_CAPABILITY: GovernedRuntimeAdapterCapability = {
  runtimeType: "openclaw",
  supportedCapabilities: ["patch_preview"],
  requiresSandbox: true,
  requiresApproval: true,
  shellExecutionEnabled: false,
  networkExecutionEnabled: false,
  productionMutationEnabled: false,
};

// =====================================================================================
// ADAPTER FACTORY
// =====================================================================================

export function createSandboxGameplayConfigAdapter(
  filesystem?: SandboxGameplayConfigFilesystem,
): GovernedRuntimeAdapter {
  const fs = resolveAdapterFilesystem(filesystem);

  return {
    adapterId: SANDBOX_GAMEPLAY_CONFIG_ADAPTER_ID,
    runtimeType: "openclaw",
    adapterVersion: SANDBOX_GAMEPLAY_CONFIG_ADAPTER_VERSION,
    capability: SANDBOX_GAMEPLAY_CONFIG_CAPABILITY,
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    maxStdoutBytes: MAX_STDOUT_BYTES,
    maxStderrBytes: MAX_STDERR_BYTES,

    async invoke(invocation: GovernedRuntimeInvocation): Promise<RuntimeInvocationResult> {
      const startedAt = invocation.requestedAt;
      const invocationId = invocation.invocationId;
      let lifecycle = createRuntimeExecutionLifecycle(invocationId, startedAt);

      if (!invocation.ioContract.workspaceWriteAllowed) {
        const failedAt = new Date().toISOString();
        lifecycle = advanceLifecycleState(lifecycle, "rejected", failedAt,
          "IO contract forbids workspace write");
        return makeFailedInvocationResult({
          invocationId,
          dispatchId: invocation.dispatchId,
          sandboxId: invocation.sandboxId,
          runtimeType: "openclaw",
          adapterId: SANDBOX_GAMEPLAY_CONFIG_ADAPTER_ID,
          failure: makeRuntimeFailure(
            "operation_rejected_by_adapter",
            "IO contract does not permit workspace writes. Set workspaceWriteAllowed: true.",
            failedAt,
          ),
          lifecycle,
          now: failedAt,
        });
      }

      const t0 = new Date().toISOString();
      lifecycle = advanceLifecycleState(lifecycle, "authorization_verified", t0,
        "Pre-authorized by dispatch orchestrator");
      lifecycle = advanceLifecycleState(lifecycle, "dispatching", t0,
        `Resolving ${SANDBOX_GAMEPLAY_CONFIG_FILE_NAME} path within sandbox workspace...`);

      const targetAbsolutePath = path.join(invocation.workspaceRoot, SANDBOX_GAMEPLAY_CONFIG_FILE_NAME);
      if (!isWithinWorkspace(invocation.workspaceRoot, targetAbsolutePath)) {
        const failedAt = new Date().toISOString();
        lifecycle = advanceLifecycleState(lifecycle, "failed", failedAt, "Sandbox boundary violation");
        return makeFailedInvocationResult({
          invocationId,
          dispatchId: invocation.dispatchId,
          sandboxId: invocation.sandboxId,
          runtimeType: "openclaw",
          adapterId: SANDBOX_GAMEPLAY_CONFIG_ADAPTER_ID,
          failure: makeRuntimeFailure(
            "sandbox_boundary_violation",
            `Config file path escapes workspace root: ${targetAbsolutePath}`,
            failedAt,
          ),
          lifecycle,
          now: failedAt,
        });
      }

      const t1 = new Date().toISOString();
      lifecycle = advanceLifecycleState(lifecycle, "running", t1,
        `Reading ${SANDBOX_GAMEPLAY_CONFIG_FILE_NAME} and applying tuning step...`);

      try {
        await fs.createDirectory(invocation.workspaceRoot);

        const existingContent = await fs.readFile(targetAbsolutePath);
        const patchLabel = invocation.operationRequest.slice(0, MAX_PATCH_LABEL_LENGTH) || "tuning step";

        let beforeConfig: SandboxGameplayConfig;
        let beforeContent: string;
        let isFirstRun: boolean;

        if (existingContent === null) {
          beforeConfig = { ...DEFAULT_GAMEPLAY_CONFIG };
          beforeContent = "(file did not exist — creating with default gameplay values)";
          isFirstRun = true;
        } else {
          beforeConfig = parseGameplayConfig(existingContent);
          beforeContent = existingContent;
          isFirstRun = false;
        }

        const { next: nextConfig, diffLines } = applyGameplayTuning(beforeConfig, patchLabel);
        const afterContent = serializeGameplayConfig(nextConfig);

        await fs.writeFile(targetAbsolutePath, afterContent);

        const completedAt = new Date().toISOString();
        const mutationDescription = isFirstRun
          ? `Created ${SANDBOX_GAMEPLAY_CONFIG_FILE_NAME} with default values and applied first tuning step (v1 → v${nextConfig.version})`
          : `Applied tuning step to ${SANDBOX_GAMEPLAY_CONFIG_FILE_NAME} (v${beforeConfig.version} → v${nextConfig.version})`;

        lifecycle = advanceLifecycleState(lifecycle, "completed", completedAt, mutationDescription);

        const stdout = [
          `=== BEFORE ===`,
          beforeContent,
          `=== AFTER ===`,
          afterContent,
          `=== TUNING DIFF ===`,
          ...diffLines,
          `=== PATCH ===`,
          patchLabel,
        ].join("\n");

        return {
          invocationId,
          dispatchId: invocation.dispatchId,
          sandboxId: invocation.sandboxId,
          runtimeType: "openclaw",
          adapterId: SANDBOX_GAMEPLAY_CONFIG_ADAPTER_ID,
          outcome: "completed",
          lifecycle,
          outputCapture: makeOutputCapture({
            stdout,
            stderr: [],
            maxStdoutBytes: MAX_STDOUT_BYTES,
            maxStderrBytes: MAX_STDERR_BYTES,
            capturedAt: completedAt,
          }),
          startedAt,
          completedAt,
          durationMs: Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()),
          safetyBoundary: makeRuntimeAdapterSafetyBoundary(),
        };
      } catch (error) {
        const failedAt = new Date().toISOString();
        lifecycle = advanceLifecycleState(lifecycle, "failed", failedAt, "Gameplay config mutation failed");
        return makeFailedInvocationResult({
          invocationId,
          dispatchId: invocation.dispatchId,
          sandboxId: invocation.sandboxId,
          runtimeType: "openclaw",
          adapterId: SANDBOX_GAMEPLAY_CONFIG_ADAPTER_ID,
          failure: makeRuntimeFailure(
            "unknown_failure",
            error instanceof Error ? error.message : String(error),
            failedAt,
          ),
          lifecycle,
          now: failedAt,
        });
      }
    },
  };
}
