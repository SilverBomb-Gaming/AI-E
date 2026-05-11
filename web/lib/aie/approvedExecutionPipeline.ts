import path from "node:path";

import { runScopedSupervisedExecution } from "./scopedSupervisedExecutionAdapter";
import { createScopedExecutionLog, evaluateScopedExecutionRequest, type ScopedExecutionDecision, type ScopedExecutionLog, type ScopedExecutionRequest, type ScopedExecutionStatus } from "./scopedSupervisedExecutionRuntime";

export type ApprovedExecutionApprovalSource = "operator_chat" | "trusted_api" | "test" | "simulated_operator";
export type ApprovedExecutionApprovalStatus = "pending" | "approved" | "rejected";
export type ApprovedExecutionFinalState = "awaiting_approval" | "rejected" | "blocked" | "adapter_disabled" | "completed" | "failed" | "timed_out";

export type ApprovedExecutionApproval = {
  approvalStatus: ApprovedExecutionApprovalStatus;
  approvedBy?: string;
  approvalSource: ApprovedExecutionApprovalSource;
  approvedAt?: string;
  simulated?: boolean;
};

export type ApprovedExecutionPipelineOptions = {
  trustedWorkspaceRoot: string;
  trustedWebRoot: string;
  enableExecution?: boolean;
  now?: () => string;
  execute?: (request: ScopedExecutionRequest) => Promise<ScopedExecutionLog>;
};

export type ApprovedExecutionLifecycleEvent = {
  state: ScopedExecutionStatus;
  timestamp: string;
  summary: string;
};

export type ApprovedExecutionReport = {
  phaseId: "APPROVED_EXECUTION_PIPELINE_PHASE1";
  executionId: string;
  command: string;
  workingDirectory: string;
  approvalSource: ApprovedExecutionApprovalSource;
  approvalStatus: ApprovedExecutionApprovalStatus;
  approvalSourceLabel: "real_operator_approval" | "simulated_approval" | "not_approved";
  runtimeEnabled: boolean;
  commandTrulyExecuted: boolean;
  finalState: ApprovedExecutionFinalState;
  lifecycle: ApprovedExecutionLifecycleEvent[];
  decision: ScopedExecutionDecision;
  log: ScopedExecutionLog;
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  elapsedMs: number;
  truthfulnessLabels: string[];
  recommendedNextAction: string;
};

function trustedRequestFor(input: ScopedExecutionRequest, approval: ApprovedExecutionApproval, options: ApprovedExecutionPipelineOptions): ScopedExecutionRequest {
  const trustedWorkspaceRoot = path.resolve(options.trustedWorkspaceRoot);
  const trustedWebRoot = path.resolve(options.trustedWebRoot);
  const requestedWorkingDirectory = input.workingDirectory.replace(/\\/g, "/").replace(/\/+$/, "");
  const workingDirectory = requestedWorkingDirectory === "repo-root/web"
    ? trustedWebRoot
    : requestedWorkingDirectory === "repo-root"
      ? trustedWorkspaceRoot
      : path.resolve(input.workingDirectory);

  return {
    ...input,
    approvalStatus: approval.approvalStatus === "approved" ? "approved" : approval.approvalStatus === "rejected" ? "rejected" : "pending",
    workingDirectory,
    allowedScope: {
      ...input.allowedScope,
      allowedWorkingDirectories: [trustedWorkspaceRoot, trustedWebRoot],
    },
  };
}

function lifecycleEvent(state: ScopedExecutionStatus, timestamp: string, summary: string): ApprovedExecutionLifecycleEvent {
  return { state, timestamp, summary };
}

function finalStateFromLog(log: ScopedExecutionLog): ApprovedExecutionFinalState {
  if (log.executionStatus === "completed") {
    return "completed";
  }
  if (log.executionStatus === "failed") {
    return "failed";
  }
  if (log.executionStatus === "timed_out") {
    return "timed_out";
  }
  if (log.executionStatus === "adapter_disabled") {
    return "adapter_disabled";
  }
  if (log.executionStatus === "rejected") {
    return "rejected";
  }
  if (log.executionStatus === "awaiting_approval") {
    return "awaiting_approval";
  }
  return "blocked";
}

function recommendedNextAction(finalState: ApprovedExecutionFinalState): string {
  switch (finalState) {
    case "completed":
      return "Review the captured output before deciding on the next supervised step.";
    case "failed":
      return "Inspect stderr/stdout, adjust the bounded command or project state, then submit a supervised retry.";
    case "timed_out":
      return "Increase the timeout only if the command remains bounded, or choose a smaller validation command.";
    case "adapter_disabled":
      return "Enable the trusted server runtime with AIE_ENABLE_SCOPED_SUPERVISED_EXECUTION=true, then retry from an approved request.";
    case "rejected":
      return "No command ran; revise or discard the request.";
    case "awaiting_approval":
      return "Wait for explicit operator approval before execution.";
    case "blocked":
    default:
      return "Fix the approval, allowlist, scope, timeout, or rollback blocker before retrying.";
  }
}

function createReport(params: {
  request: ScopedExecutionRequest;
  approval: ApprovedExecutionApproval;
  runtimeEnabled: boolean;
  lifecycle: ApprovedExecutionLifecycleEvent[];
  decision: ScopedExecutionDecision;
  log: ScopedExecutionLog;
}): ApprovedExecutionReport {
  const finalState = finalStateFromLog(params.log);
  const commandTrulyExecuted = params.log.commandRun !== null && (params.log.truthfulnessLabel === "real_execution_completed" || params.log.truthfulnessLabel === "real_execution_failed");
  const approvalSourceLabel = params.approval.approvalStatus !== "approved"
    ? "not_approved"
    : params.approval.simulated
      ? "simulated_approval"
      : "real_operator_approval";
  const truthfulnessLabels = [
    params.log.truthfulnessLabel,
    approvalSourceLabel,
    commandTrulyExecuted ? "real_execution" : "execution_not_performed",
    params.runtimeEnabled ? "trusted_runtime_enabled" : "disabled_runtime",
  ];

  return {
    phaseId: "APPROVED_EXECUTION_PIPELINE_PHASE1",
    executionId: params.request.executionRequestId,
    command: params.request.command,
    workingDirectory: params.request.workingDirectory,
    approvalSource: params.approval.approvalSource,
    approvalStatus: params.approval.approvalStatus,
    approvalSourceLabel,
    runtimeEnabled: params.runtimeEnabled,
    commandTrulyExecuted,
    finalState,
    lifecycle: params.lifecycle,
    decision: params.decision,
    log: params.log,
    stdout: params.log.stdoutSummary ?? "",
    stderr: params.log.stderrSummary ?? "",
    exitCode: params.log.exitCode,
    elapsedMs: params.log.elapsedMs,
    truthfulnessLabels,
    recommendedNextAction: recommendedNextAction(finalState),
  };
}

export async function runApprovedExecutionPipeline(input: {
  request: ScopedExecutionRequest;
  approval: ApprovedExecutionApproval;
}, options: ApprovedExecutionPipelineOptions): Promise<ApprovedExecutionReport> {
  const now = options.now ?? (() => new Date().toISOString());
  const runtimeEnabled = options.enableExecution === true || process.env.AIE_ENABLE_SCOPED_SUPERVISED_EXECUTION === "true";
  const request = trustedRequestFor(input.request, input.approval, options);
  const lifecycle: ApprovedExecutionLifecycleEvent[] = [
    lifecycleEvent("prepared", now(), `Request ${request.executionRequestId} received for ${request.command}.`),
  ];

  if (input.approval.approvalStatus === "pending") {
    const decision = evaluateScopedExecutionRequest(request);
    const log = createScopedExecutionLog(request, decision, {
      executionStatus: "awaiting_approval",
      truthfulnessLabel: "prepared_no_execution",
    });
    lifecycle.push(lifecycleEvent("awaiting_approval", now(), "Execution paused until explicit operator approval is present."));
    return createReport({ request, approval: input.approval, runtimeEnabled, lifecycle, decision, log });
  }

  if (input.approval.approvalStatus === "rejected") {
    const decision = evaluateScopedExecutionRequest(request);
    const log = createScopedExecutionLog(request, decision, {
      executionStatus: "rejected",
      truthfulnessLabel: "rejected_no_execution",
    });
    lifecycle.push(lifecycleEvent("rejected", now(), "Operator rejected the execution request; no command was run."));
    return createReport({ request, approval: input.approval, runtimeEnabled, lifecycle, decision, log });
  }

  const decision = evaluateScopedExecutionRequest(request);
  if (!decision.executable) {
    const log = createScopedExecutionLog(request, decision, {
      executionStatus: "blocked",
      truthfulnessLabel: "blocked_no_execution",
    });
    lifecycle.push(lifecycleEvent("blocked", now(), decision.blockedReason ?? "Execution blocked by scoped execution gate."));
    return createReport({ request, approval: input.approval, runtimeEnabled, lifecycle, decision, log });
  }

  lifecycle.push(lifecycleEvent("approved", input.approval.approvedAt ?? now(), `Approved by ${input.approval.approvedBy ?? "operator"} through ${input.approval.approvalSource}.`));
  lifecycle.push(lifecycleEvent("executing", now(), "Trusted server runtime dispatched the allowlisted command to the execution adapter."));

  const log = options.execute
    ? await options.execute(request)
    : await runScopedSupervisedExecution(request, { enableExecution: runtimeEnabled, now });
  lifecycle.push(lifecycleEvent(log.executionStatus, log.completedAt ?? now(), `Execution ended with status ${log.executionStatus}.`));
  return createReport({ request, approval: input.approval, runtimeEnabled, lifecycle, decision, log });
}