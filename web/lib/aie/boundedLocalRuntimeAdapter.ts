// AI-E BOUNDED LOCAL RUNTIME ADAPTER (EXEC-0052-B)
//
// First real governed runtime adapter implementation.
// Writes AI_E_RUNTIME_PROOF.txt to the sandbox workspace — ONE bounded file mutation.
//
// This adapter satisfies the GovernedRuntimeAdapter interface defined in EXEC-0052-A.
// It is the first real runtime-backed execution in AI-E.
//
// NO child_process. NO shell. NO spawn/exec/execFile. NO network. NO production mutation.
// Sandbox-scoped write only. Single file. Human authority final.

import { mkdir, writeFile } from "node:fs/promises";
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

export const BOUNDED_LOCAL_ADAPTER_ID = "openclaw-bounded-local-v1" as GovernedRuntimeAdapterId;
export const BOUNDED_LOCAL_ADAPTER_VERSION = "EXEC-0052-B";
export const RUNTIME_PROOF_FILE_NAME = "AI_E_RUNTIME_PROOF.txt";

const MAX_STDOUT_BYTES = 65_536;
const MAX_STDERR_BYTES = 8_192;
const DEFAULT_TIMEOUT_MS = 30_000;

// =====================================================================================
// INJECTABLE FILESYSTEM
// Allows in-memory substitution for tests. Default uses node:fs/promises.
// =====================================================================================

export type BoundedLocalAdapterFilesystem = {
  createDirectory: (absolutePath: string) => Promise<void>;
  writeFile: (absolutePath: string, content: string) => Promise<void>;
};

function resolveAdapterFilesystem(input?: BoundedLocalAdapterFilesystem): BoundedLocalAdapterFilesystem {
  return {
    createDirectory: input?.createDirectory ?? ((p) => mkdir(p, { recursive: true }).then(() => undefined)),
    writeFile: input?.writeFile ?? ((p, c) => writeFile(p, c, "utf8")),
  };
}

// =====================================================================================
// PATH SAFETY
// Validates that the target path stays inside the declared workspaceRoot.
// Mirrors the boundary enforcement in sandboxExecutionBoundary.ts.
// =====================================================================================

function isWithinWorkspace(workspaceRoot: string, targetAbsolutePath: string): boolean {
  const relative = path.relative(workspaceRoot, targetAbsolutePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

// =====================================================================================
// PROOF FILE CONTENT
// All required runtime metadata fields for the EXEC-0052-B proof file.
// =====================================================================================

export function buildRuntimeProofContent(params: {
  invocationId: string;
  dispatchId: string;
  sandboxId: string;
  operatorId: string;
  approvalReference: string;
  operationRequest: string;
  workspaceRoot: string;
  timestamp: string;
}): string {
  return [
    "AI-E RUNTIME PROOF",
    "==================",
    `Runtime ID:          ${BOUNDED_LOCAL_ADAPTER_ID}`,
    `Runtime Type:        openclaw`,
    `Adapter Version:     ${BOUNDED_LOCAL_ADAPTER_VERSION}`,
    `Invocation ID:       ${params.invocationId}`,
    `Dispatch ID:         ${params.dispatchId}`,
    `Sandbox ID:          ${params.sandboxId}`,
    `Operator ID:         ${params.operatorId}`,
    `Approval Reference:  ${params.approvalReference}`,
    `Operation Request:   ${params.operationRequest}`,
    `Workspace Root:      ${params.workspaceRoot}`,
    `Executed At:         ${params.timestamp}`,
    `Lifecycle Status:    completed`,
    "",
    "=================================================================",
    "AI-E EXEC-0052-B: FIRST REAL GOVERNED RUNTIME INVOCATION",
    "Runtime: openclaw (bounded local adapter)",
    "Mutation: single file, sandbox-scoped only.",
    "Shell: DISABLED. Network: DISABLED. Production mutation: DISABLED.",
    "Human authority: FINAL.",
    "=================================================================",
  ].join("\n");
}

// =====================================================================================
// ADAPTER CAPABILITY
// =====================================================================================

const BOUNDED_LOCAL_CAPABILITY: GovernedRuntimeAdapterCapability = {
  runtimeType: "openclaw",
  supportedCapabilities: ["file_inspection"],
  requiresSandbox: true,
  requiresApproval: true,
  shellExecutionEnabled: false,
  networkExecutionEnabled: false,
  productionMutationEnabled: false,
};

// =====================================================================================
// ADAPTER FACTORY
// Returns a GovernedRuntimeAdapter that writes AI_E_RUNTIME_PROOF.txt.
// invoke() advances lifecycle: queued → authorization_verified → dispatching → running → completed
// =====================================================================================

export function createBoundedLocalRuntimeAdapter(
  filesystem?: BoundedLocalAdapterFilesystem,
): GovernedRuntimeAdapter {
  const fs = resolveAdapterFilesystem(filesystem);

  return {
    adapterId: BOUNDED_LOCAL_ADAPTER_ID,
    runtimeType: "openclaw",
    adapterVersion: BOUNDED_LOCAL_ADAPTER_VERSION,
    capability: BOUNDED_LOCAL_CAPABILITY,
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    maxStdoutBytes: MAX_STDOUT_BYTES,
    maxStderrBytes: MAX_STDERR_BYTES,

    async invoke(invocation: GovernedRuntimeInvocation): Promise<RuntimeInvocationResult> {
      const startedAt = invocation.requestedAt;
      const invocationId = invocation.invocationId;
      let lifecycle = createRuntimeExecutionLifecycle(invocationId, startedAt);

      // Enforce IO contract: this adapter requires workspace write permission
      if (!invocation.ioContract.workspaceWriteAllowed) {
        const failedAt = new Date().toISOString();
        lifecycle = advanceLifecycleState(lifecycle, "rejected", failedAt,
          "IO contract forbids workspace write");
        return makeFailedInvocationResult({
          invocationId,
          dispatchId: invocation.dispatchId,
          sandboxId: invocation.sandboxId,
          runtimeType: "openclaw",
          adapterId: BOUNDED_LOCAL_ADAPTER_ID,
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
        "Invocation pre-authorized by dispatch orchestrator");
      lifecycle = advanceLifecycleState(lifecycle, "dispatching", t0,
        "Resolving proof file path within sandbox workspace...");

      // Resolve target path and enforce sandbox boundary
      const targetAbsolutePath = path.join(invocation.workspaceRoot, RUNTIME_PROOF_FILE_NAME);
      if (!isWithinWorkspace(invocation.workspaceRoot, targetAbsolutePath)) {
        const failedAt = new Date().toISOString();
        lifecycle = advanceLifecycleState(lifecycle, "failed", failedAt,
          "Sandbox boundary violation");
        return makeFailedInvocationResult({
          invocationId,
          dispatchId: invocation.dispatchId,
          sandboxId: invocation.sandboxId,
          runtimeType: "openclaw",
          adapterId: BOUNDED_LOCAL_ADAPTER_ID,
          failure: makeRuntimeFailure(
            "sandbox_boundary_violation",
            `Proof file path escapes workspace root: ${targetAbsolutePath}`,
            failedAt,
          ),
          lifecycle,
          now: failedAt,
        });
      }

      const t1 = new Date().toISOString();
      lifecycle = advanceLifecycleState(lifecycle, "running", t1,
        `Writing ${RUNTIME_PROOF_FILE_NAME} to sandbox workspace...`);

      try {
        const proofContent = buildRuntimeProofContent({
          invocationId,
          dispatchId: invocation.dispatchId,
          sandboxId: invocation.sandboxId,
          operatorId: invocation.operatorId,
          approvalReference: invocation.approvalReference,
          operationRequest: invocation.operationRequest,
          workspaceRoot: invocation.workspaceRoot,
          timestamp: t1,
        });

        await fs.createDirectory(invocation.workspaceRoot);
        await fs.writeFile(targetAbsolutePath, proofContent);

        const completedAt = new Date().toISOString();
        lifecycle = advanceLifecycleState(lifecycle, "completed", completedAt,
          `${RUNTIME_PROOF_FILE_NAME} written successfully.`);

        const outputCapture = makeOutputCapture({
          stdout: proofContent,
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
          adapterId: BOUNDED_LOCAL_ADAPTER_ID,
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
        lifecycle = advanceLifecycleState(lifecycle, "failed", failedAt, "File write failed");
        return makeFailedInvocationResult({
          invocationId,
          dispatchId: invocation.dispatchId,
          sandboxId: invocation.sandboxId,
          runtimeType: "openclaw",
          adapterId: BOUNDED_LOCAL_ADAPTER_ID,
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
