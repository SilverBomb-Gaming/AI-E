import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createScopedExecutionLog, evaluateScopedExecutionRequest, summarizeOutput, type ScopedExecutionLog, type ScopedExecutionRequest } from "./scopedSupervisedExecutionRuntime";

const execFileAsync = promisify(execFile);

export type ScopedExecutionAdapterOptions = {
  enableExecution?: boolean;
  now?: () => string;
};

function splitCommand(command: string): { executable: string; args: string[] } {
  const parts = command.trim().split(/\s+/);
  return { executable: parts[0] ?? "", args: parts.slice(1) };
}

function isAdapterEnabled(options?: ScopedExecutionAdapterOptions): boolean {
  return options?.enableExecution === true || process.env.AIE_ENABLE_SCOPED_SUPERVISED_EXECUTION === "true";
}

export async function runScopedSupervisedExecution(request: ScopedExecutionRequest, options?: ScopedExecutionAdapterOptions): Promise<ScopedExecutionLog> {
  const now = options?.now ?? (() => new Date().toISOString());
  const decision = evaluateScopedExecutionRequest(request);
  if (!decision.executable) {
    return createScopedExecutionLog(request, decision, {
      executionStatus: "blocked",
      truthfulnessLabel: "blocked_no_execution",
      elapsedMs: 0,
    });
  }

  if (!isAdapterEnabled(options)) {
    return createScopedExecutionLog(request, decision, {
      executionStatus: "adapter_disabled",
      truthfulnessLabel: "adapter_disabled_no_execution",
      stderrSummary: "Scoped supervised execution adapter is disabled. Set AIE_ENABLE_SCOPED_SUPERVISED_EXECUTION=true or pass enableExecution=true in a trusted server/test runtime.",
      elapsedMs: 0,
    });
  }

  const { executable, args } = splitCommand(request.command);
  const startedAt = now();
  const startedMs = Date.parse(startedAt);
  try {
    const result = await execFileAsync(executable, args, {
      cwd: request.workingDirectory,
      timeout: request.timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    const completedAt = now();
    const elapsedMs = Math.max(0, Date.parse(completedAt) - startedMs);
    return createScopedExecutionLog(request, decision, {
      executionStatus: "completed",
      truthfulnessLabel: "real_execution_completed",
      stdoutSummary: summarizeOutput(result.stdout),
      stderrSummary: summarizeOutput(result.stderr),
      exitCode: 0,
      startedAt,
      completedAt,
      elapsedMs,
    });
  } catch (error) {
    const completedAt = now();
    const elapsedMs = Math.max(0, Date.parse(completedAt) - startedMs);
    const candidate = error as { stdout?: string; stderr?: string; code?: number | null; killed?: boolean };
    return createScopedExecutionLog(request, decision, {
      executionStatus: candidate.killed ? "timed_out" : "failed",
      truthfulnessLabel: "real_execution_failed",
      stdoutSummary: summarizeOutput(candidate.stdout ?? ""),
      stderrSummary: summarizeOutput(candidate.stderr ?? String(error)),
      exitCode: typeof candidate.code === "number" ? candidate.code : null,
      startedAt,
      completedAt,
      elapsedMs,
    });
  }
}