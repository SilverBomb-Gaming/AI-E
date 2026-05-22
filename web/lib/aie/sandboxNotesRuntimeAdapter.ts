// AI-E SANDBOX NOTES RUNTIME ADAPTER (EXEC-0052-C)
//
// First useful governed markdown mutation.
// Appends one bullet note to sandboxNotes.md in the sandbox workspace.
// On first invocation (file absent): creates sandboxNotes.md with a header then appends.
//
// Lifecycle: queued → authorization_verified → dispatching → running → completed
// stdout: BEFORE content + AFTER content + note appended
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

export const SANDBOX_NOTES_ADAPTER_ID = "openclaw-sandbox-notes-v1" as GovernedRuntimeAdapterId;
export const SANDBOX_NOTES_ADAPTER_VERSION = "EXEC-0052-C";
export const SANDBOX_NOTES_FILE_NAME = "sandboxNotes.md";

const MAX_STDOUT_BYTES = 65_536;
const MAX_STDERR_BYTES = 8_192;
const DEFAULT_TIMEOUT_MS = 30_000;

// =====================================================================================
// INJECTABLE FILESYSTEM
// readFile returns null when the file does not exist (ENOENT), throws otherwise.
// =====================================================================================

export type SandboxNotesAdapterFilesystem = {
  createDirectory: (absolutePath: string) => Promise<void>;
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  readFile: (absolutePath: string) => Promise<string | null>;
};

function resolveAdapterFilesystem(input?: SandboxNotesAdapterFilesystem): SandboxNotesAdapterFilesystem {
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
// NOTES MUTATION HELPERS
// =====================================================================================

export function buildInitialNotesContent(): string {
  return "# Sandbox Notes\n\n";
}

export function applyNotesMutation(existing: string | null, note: string): {
  before: string;
  after: string;
} {
  const before = existing ?? "(file did not exist)";
  const base = existing === null ? buildInitialNotesContent() : existing;
  const trimmed = base.trimEnd();
  const after = `${trimmed}\n- ${note}\n`;
  return { before, after };
}

export function buildNoteText(operationRequest: string): string {
  return `OpenClaw: ${operationRequest.trim()}`;
}

// =====================================================================================
// ADAPTER CAPABILITY
// =====================================================================================

const SANDBOX_NOTES_CAPABILITY: GovernedRuntimeAdapterCapability = {
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
// Returns a GovernedRuntimeAdapter that appends one bullet note to sandboxNotes.md.
// =====================================================================================

export function createSandboxNotesRuntimeAdapter(
  filesystem?: SandboxNotesAdapterFilesystem,
): GovernedRuntimeAdapter {
  const fs = resolveAdapterFilesystem(filesystem);

  return {
    adapterId: SANDBOX_NOTES_ADAPTER_ID,
    runtimeType: "openclaw",
    adapterVersion: SANDBOX_NOTES_ADAPTER_VERSION,
    capability: SANDBOX_NOTES_CAPABILITY,
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
          adapterId: SANDBOX_NOTES_ADAPTER_ID,
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
        `Resolving ${SANDBOX_NOTES_FILE_NAME} path within sandbox workspace...`);

      const targetAbsolutePath = path.join(invocation.workspaceRoot, SANDBOX_NOTES_FILE_NAME);
      if (!isWithinWorkspace(invocation.workspaceRoot, targetAbsolutePath)) {
        const failedAt = new Date().toISOString();
        lifecycle = advanceLifecycleState(lifecycle, "failed", failedAt,
          "Sandbox boundary violation");
        return makeFailedInvocationResult({
          invocationId,
          dispatchId: invocation.dispatchId,
          sandboxId: invocation.sandboxId,
          runtimeType: "openclaw",
          adapterId: SANDBOX_NOTES_ADAPTER_ID,
          failure: makeRuntimeFailure(
            "sandbox_boundary_violation",
            `Notes file path escapes workspace root: ${targetAbsolutePath}`,
            failedAt,
          ),
          lifecycle,
          now: failedAt,
        });
      }

      const t1 = new Date().toISOString();
      lifecycle = advanceLifecycleState(lifecycle, "running", t1,
        `Reading ${SANDBOX_NOTES_FILE_NAME} and appending note...`);

      try {
        await fs.createDirectory(invocation.workspaceRoot);

        const existing = await fs.readFile(targetAbsolutePath);
        const note = buildNoteText(invocation.operationRequest);
        const { before, after } = applyNotesMutation(existing, note);

        await fs.writeFile(targetAbsolutePath, after);

        const completedAt = new Date().toISOString();
        const mutationDescription = existing === null
          ? `Created ${SANDBOX_NOTES_FILE_NAME} and appended: "${note}"`
          : `Appended to ${SANDBOX_NOTES_FILE_NAME}: "${note}"`;

        lifecycle = advanceLifecycleState(lifecycle, "completed", completedAt,
          mutationDescription);

        const stdout = [
          `=== BEFORE ===`,
          before,
          `=== AFTER ===`,
          after,
          `=== NOTE APPENDED ===`,
          `- ${note}`,
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
          adapterId: SANDBOX_NOTES_ADAPTER_ID,
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
        lifecycle = advanceLifecycleState(lifecycle, "failed", failedAt, "Notes mutation failed");
        return makeFailedInvocationResult({
          invocationId,
          dispatchId: invocation.dispatchId,
          sandboxId: invocation.sandboxId,
          runtimeType: "openclaw",
          adapterId: SANDBOX_NOTES_ADAPTER_ID,
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
