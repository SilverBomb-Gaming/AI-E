// AI-E SANDBOX UNITY SCRIPT ADAPTER (EXEC-0052-E)
//
// First governed Unity-style C# script mutation inside sandbox boundaries.
// Reads sandboxPlayerMovement.cs from the workspace, applies a deterministic
// mutation (increments movementSpeed by 0.5f and patch version), writes back.
// On first invocation: creates the file with safe sandbox defaults.
//
// Lifecycle: queued → authorization_verified → dispatching → running → completed
// stdout: BEFORE content + AFTER content + mutation summary
//
// NO child_process. NO shell. NO spawn/exec/execFile. NO network.
// NO production Unity mutation. Sandbox-scoped read+write only.
// Human authority final.

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

export const SANDBOX_UNITY_SCRIPT_ADAPTER_ID = "openclaw-sandbox-unity-script-v1" as GovernedRuntimeAdapterId;
export const SANDBOX_UNITY_SCRIPT_ADAPTER_VERSION = "EXEC-0052-E";
export const SANDBOX_UNITY_SCRIPT_FILE_NAME = "sandboxPlayerMovement.cs";

const MOVEMENT_SPEED_REGEX = /(\bpublic float movementSpeed = )(\d+(?:\.\d+)?)f;/;
const PATCH_VERSION_COMMENT_REGEX = /(\/\/ AI-E governed sandbox tuning — patch version: )(\d+)/;
const MOVEMENT_SPEED_DELTA = 0.5;
const MAX_STDOUT_BYTES = 65_536;
const MAX_STDERR_BYTES = 8_192;
const DEFAULT_TIMEOUT_MS = 30_000;

export const UNITY_SCRIPT_DEFAULTS = {
  movementSpeed: 5.0,
  jumpForce: 8.0,
  staminaCooldown: 1.5,
  patchVersion: 1,
} as const;

// =====================================================================================
// INJECTABLE FILESYSTEM
// =====================================================================================

export type SandboxUnityScriptFilesystem = {
  createDirectory: (absolutePath: string) => Promise<void>;
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  readFile: (absolutePath: string) => Promise<string | null>;
};

function resolveAdapterFilesystem(input?: SandboxUnityScriptFilesystem): SandboxUnityScriptFilesystem {
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
// UNITY SCRIPT CONTENT BUILDERS
// =====================================================================================

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function buildInitialUnityScriptContent(sandboxId: string): string {
  return [
    `// AI-E Sandbox Unity Script`,
    `// Managed by EXEC-0052-E bounded mutation adapter`,
    `// Sandbox: ${sandboxId}`,
    `// WARNING: SANDBOX ONLY — not for production use`,
    ``,
    `using UnityEngine;`,
    ``,
    `public class SandboxPlayerMovement : MonoBehaviour`,
    `{`,
    `    [SerializeField] public float movementSpeed = ${UNITY_SCRIPT_DEFAULTS.movementSpeed.toFixed(1)}f;`,
    `    [SerializeField] public float jumpForce = ${UNITY_SCRIPT_DEFAULTS.jumpForce.toFixed(1)}f;`,
    `    [SerializeField] public float staminaCooldown = ${UNITY_SCRIPT_DEFAULTS.staminaCooldown.toFixed(1)}f;`,
    ``,
    `    // AI-E governed sandbox tuning — patch version: ${UNITY_SCRIPT_DEFAULTS.patchVersion}`,
    `    private void Update() { }`,
    `}`,
    ``,
  ].join("\n");
}

export type UnityScriptMutationResult = {
  next: string;
  prevMovementSpeed: number;
  nextMovementSpeed: number;
  prevPatchVersion: number;
  nextPatchVersion: number;
};

export function applyUnityScriptMutation(content: string): UnityScriptMutationResult {
  const speedMatch = MOVEMENT_SPEED_REGEX.exec(content);
  if (!speedMatch) {
    throw new Error(
      `${SANDBOX_UNITY_SCRIPT_FILE_NAME} does not contain a valid 'public float movementSpeed = <value>f;' declaration.`,
    );
  }
  const prevMovementSpeed = parseFloat(speedMatch[2]);
  const nextMovementSpeed = round1(prevMovementSpeed + MOVEMENT_SPEED_DELTA);

  const versionMatch = PATCH_VERSION_COMMENT_REGEX.exec(content);
  const prevPatchVersion = versionMatch ? parseInt(versionMatch[2], 10) : 1;
  const nextPatchVersion = prevPatchVersion + 1;

  let next = content.replace(
    MOVEMENT_SPEED_REGEX,
    `$1${nextMovementSpeed.toFixed(1)}f;`,
  );
  if (versionMatch) {
    next = next.replace(
      PATCH_VERSION_COMMENT_REGEX,
      `$1${nextPatchVersion}`,
    );
  }

  return { next, prevMovementSpeed, nextMovementSpeed, prevPatchVersion, nextPatchVersion };
}

// =====================================================================================
// ADAPTER CAPABILITY
// =====================================================================================

const SANDBOX_UNITY_SCRIPT_CAPABILITY: GovernedRuntimeAdapterCapability = {
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

export function createSandboxUnityScriptAdapter(
  filesystem?: SandboxUnityScriptFilesystem,
): GovernedRuntimeAdapter {
  const fs = resolveAdapterFilesystem(filesystem);

  return {
    adapterId: SANDBOX_UNITY_SCRIPT_ADAPTER_ID,
    runtimeType: "openclaw",
    adapterVersion: SANDBOX_UNITY_SCRIPT_ADAPTER_VERSION,
    capability: SANDBOX_UNITY_SCRIPT_CAPABILITY,
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
          adapterId: SANDBOX_UNITY_SCRIPT_ADAPTER_ID,
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
        `Resolving ${SANDBOX_UNITY_SCRIPT_FILE_NAME} path within sandbox workspace...`);

      const targetAbsolutePath = path.join(invocation.workspaceRoot, SANDBOX_UNITY_SCRIPT_FILE_NAME);
      if (!isWithinWorkspace(invocation.workspaceRoot, targetAbsolutePath)) {
        const failedAt = new Date().toISOString();
        lifecycle = advanceLifecycleState(lifecycle, "failed", failedAt, "Sandbox boundary violation");
        return makeFailedInvocationResult({
          invocationId,
          dispatchId: invocation.dispatchId,
          sandboxId: invocation.sandboxId,
          runtimeType: "openclaw",
          adapterId: SANDBOX_UNITY_SCRIPT_ADAPTER_ID,
          failure: makeRuntimeFailure(
            "sandbox_boundary_violation",
            `Script file path escapes workspace root: ${targetAbsolutePath}`,
            failedAt,
          ),
          lifecycle,
          now: failedAt,
        });
      }

      const t1 = new Date().toISOString();
      lifecycle = advanceLifecycleState(lifecycle, "running", t1,
        `Reading ${SANDBOX_UNITY_SCRIPT_FILE_NAME} and applying movement speed mutation...`);

      try {
        await fs.createDirectory(invocation.workspaceRoot);

        const existing = await fs.readFile(targetAbsolutePath);
        let beforeContent: string;
        let afterContent: string;
        let mutationSummary: string;
        let isFirstRun: boolean;

        if (existing === null) {
          beforeContent = "(file did not exist — creating with sandbox defaults)";
          afterContent = buildInitialUnityScriptContent(invocation.sandboxId);
          mutationSummary = `Created ${SANDBOX_UNITY_SCRIPT_FILE_NAME} with movementSpeed = ${UNITY_SCRIPT_DEFAULTS.movementSpeed.toFixed(1)}f (patch version 1)`;
          isFirstRun = true;
        } else {
          beforeContent = existing;
          const mutation = applyUnityScriptMutation(existing);
          afterContent = mutation.next;
          mutationSummary = `movementSpeed: ${mutation.prevMovementSpeed.toFixed(1)}f → ${mutation.nextMovementSpeed.toFixed(1)}f (+${MOVEMENT_SPEED_DELTA}f) | patch version: ${mutation.prevPatchVersion} → ${mutation.nextPatchVersion}`;
          isFirstRun = false;
        }

        await fs.writeFile(targetAbsolutePath, afterContent);

        const completedAt = new Date().toISOString();
        const lifecycleMessage = isFirstRun
          ? `Created ${SANDBOX_UNITY_SCRIPT_FILE_NAME} with sandbox defaults (movementSpeed = ${UNITY_SCRIPT_DEFAULTS.movementSpeed.toFixed(1)}f)`
          : `Applied movement speed mutation to ${SANDBOX_UNITY_SCRIPT_FILE_NAME}`;
        lifecycle = advanceLifecycleState(lifecycle, "completed", completedAt, lifecycleMessage);

        const stdout = [
          `=== BEFORE ===`,
          beforeContent,
          `=== AFTER ===`,
          afterContent,
          `=== MUTATION ===`,
          mutationSummary,
          `=== OPERATION ===`,
          invocation.operationRequest,
        ].join("\n");

        return {
          invocationId,
          dispatchId: invocation.dispatchId,
          sandboxId: invocation.sandboxId,
          runtimeType: "openclaw",
          adapterId: SANDBOX_UNITY_SCRIPT_ADAPTER_ID,
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
        lifecycle = advanceLifecycleState(lifecycle, "failed", failedAt, "Unity script mutation failed");
        return makeFailedInvocationResult({
          invocationId,
          dispatchId: invocation.dispatchId,
          sandboxId: invocation.sandboxId,
          runtimeType: "openclaw",
          adapterId: SANDBOX_UNITY_SCRIPT_ADAPTER_ID,
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
