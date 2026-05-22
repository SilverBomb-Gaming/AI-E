// AI-E SANDBOX PATCH RUNTIME ADAPTER (EXEC-0052-C)
//
// First USEFUL governed sandbox mutation.
// Reads sandboxPatch.ts from the workspace, increments patchVersion, writes back.
// On first invocation (file absent): creates sandboxPatch.ts with patchVersion = 1.
//
// Lifecycle: queued → authorization_verified → dispatching → running → completed
// stdout: BEFORE content + AFTER content + mutation description
//
// NO child_process. NO shell. NO spawn/exec/execFile. NO network. NO production mutation.
// Sandbox-scoped read+write only. Single file. Human authority final.

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

export const SANDBOX_PATCH_ADAPTER_ID = "openclaw-sandbox-patch-v1" as GovernedRuntimeAdapterId;
export const SANDBOX_PATCH_ADAPTER_VERSION = "EXEC-0052-C";
export const SANDBOX_PATCH_FILE_NAME = "sandboxPatch.ts";

const PATCH_VERSION_REGEX = /export const patchVersion = (\d+);/;
const MAX_STDOUT_BYTES = 65_536;
const MAX_STDERR_BYTES = 8_192;
const DEFAULT_TIMEOUT_MS = 30_000;

// =====================================================================================
// INJECTABLE FILESYSTEM
// readFile returns null when the file does not exist (ENOENT), throws otherwise.
// =====================================================================================

export type SandboxPatchAdapterFilesystem = {
  createDirectory: (absolutePath: string) => Promise<void>;
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  readFile: (absolutePath: string) => Promise<string | null>;
};

function resolveAdapterFilesystem(input?: SandboxPatchAdapterFilesystem): SandboxPatchAdapterFilesystem {
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
// PATCH FILE CONTENT BUILDERS
// =====================================================================================

export function buildInitialPatchFileContent(sandboxId: string): string {
  return [
    `// AI-E Sandbox Patch File`,
    `// Managed by EXEC-0052-C bounded mutation adapter`,
    `// Sandbox: ${sandboxId}`,
    ``,
    `export const patchVersion = 1;`,
    `export const sandboxId = "${sandboxId}";`,
    ``,
  ].join("\n");
}

export function applyPatchMutation(content: string): {
  next: string;
  prevVersion: number;
  nextVersion: number;
} {
  const match = PATCH_VERSION_REGEX.exec(content);
  if (!match) {
    throw new Error(`${SANDBOX_PATCH_FILE_NAME} does not contain a valid patchVersion constant.`);
  }
  const prevVersion = parseInt(match[1], 10);
  const nextVersion = prevVersion + 1;
  const next = content.replace(PATCH_VERSION_REGEX, `export const patchVersion = ${nextVersion};`);
  return { next, prevVersion, nextVersion };
}

// =====================================================================================
// ADAPTER CAPABILITY
// =====================================================================================

const SANDBOX_PATCH_CAPABILITY: GovernedRuntimeAdapterCapability = {
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
// Returns a GovernedRuntimeAdapter that reads sandboxPatch.ts, mutates patchVersion,
// and writes the result back.
// =====================================================================================

export function createSandboxPatchRuntimeAdapter(
  filesystem?: SandboxPatchAdapterFilesystem,
): GovernedRuntimeAdapter {
  const fs = resolveAdapterFilesystem(filesystem);

  return {
    adapterId: SANDBOX_PATCH_ADAPTER_ID,
    runtimeType: "openclaw",
    adapterVersion: SANDBOX_PATCH_ADAPTER_VERSION,
    capability: SANDBOX_PATCH_CAPABILITY,
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
          adapterId: SANDBOX_PATCH_ADAPTER_ID,
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
        `Resolving ${SANDBOX_PATCH_FILE_NAME} path within sandbox workspace...`);

      const targetAbsolutePath = path.join(invocation.workspaceRoot, SANDBOX_PATCH_FILE_NAME);
      if (!isWithinWorkspace(invocation.workspaceRoot, targetAbsolutePath)) {
        const failedAt = new Date().toISOString();
        lifecycle = advanceLifecycleState(lifecycle, "failed", failedAt,
          "Sandbox boundary violation");
        return makeFailedInvocationResult({
          invocationId,
          dispatchId: invocation.dispatchId,
          sandboxId: invocation.sandboxId,
          runtimeType: "openclaw",
          adapterId: SANDBOX_PATCH_ADAPTER_ID,
          failure: makeRuntimeFailure(
            "sandbox_boundary_violation",
            `Patch file path escapes workspace root: ${targetAbsolutePath}`,
            failedAt,
          ),
          lifecycle,
          now: failedAt,
        });
      }

      const t1 = new Date().toISOString();
      lifecycle = advanceLifecycleState(lifecycle, "running", t1,
        `Reading ${SANDBOX_PATCH_FILE_NAME} from sandbox workspace...`);

      try {
        await fs.createDirectory(invocation.workspaceRoot);

        const existing = await fs.readFile(targetAbsolutePath);
        let beforeContent: string;
        let afterContent: string;
        let mutationDescription: string;

        if (existing === null) {
          beforeContent = "(file did not exist — creating with patchVersion = 1)";
          afterContent = buildInitialPatchFileContent(invocation.sandboxId);
          mutationDescription = `Created ${SANDBOX_PATCH_FILE_NAME} with patchVersion = 1`;
        } else {
          beforeContent = existing;
          const { next, prevVersion, nextVersion } = applyPatchMutation(existing);
          afterContent = next;
          mutationDescription = `Incremented patchVersion: ${prevVersion} → ${nextVersion}`;
        }

        await fs.writeFile(targetAbsolutePath, afterContent);

        const completedAt = new Date().toISOString();
        lifecycle = advanceLifecycleState(lifecycle, "completed", completedAt,
          `${SANDBOX_PATCH_FILE_NAME} patched. ${mutationDescription}`);

        const stdout = [
          `=== BEFORE ===`,
          beforeContent,
          `=== AFTER ===`,
          afterContent,
          `=== MUTATION ===`,
          mutationDescription,
        ].join("\n");

        const outputCapture = makeOutputCapture({
          stdout,
          stderr: [],
          maxStdoutBytes: MAX_STDOUT_BYTES,
          maxStderrBytes: MAX_STDERR_BYTES,
          capturedAt: completedAt,
        });

        return {
          invocationId,
          dispatchId: invocation.dispatchId,
          sandboxId: invocation.sandboxId,
          runtimeType: "openclaw",
          adapterId: SANDBOX_PATCH_ADAPTER_ID,
          outcome: "completed",
          lifecycle,
          outputCapture,
          startedAt,
          completedAt,
          durationMs: Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()),
          safetyBoundary: makeRuntimeAdapterSafetyBoundary(),
        };
      } catch (error) {
        const failedAt = new Date().toISOString();
        lifecycle = advanceLifecycleState(lifecycle, "failed", failedAt, "Patch mutation failed");
        return makeFailedInvocationResult({
          invocationId,
          dispatchId: invocation.dispatchId,
          sandboxId: invocation.sandboxId,
          runtimeType: "openclaw",
          adapterId: SANDBOX_PATCH_ADAPTER_ID,
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
