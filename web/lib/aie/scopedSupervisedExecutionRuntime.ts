export type ScopedExecutionRiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type ScopedExecutionApprovalStatus = "missing" | "pending" | "approved" | "rejected";
export type ScopedExecutionStatus = "prepared" | "blocked" | "running" | "completed" | "failed" | "timed_out" | "adapter_disabled";
export type ScopedExecutionTruthfulnessLabel = "real_execution_completed" | "real_execution_failed" | "blocked_no_execution" | "prepared_no_execution" | "adapter_disabled_no_execution";

export type ScopedExecutionAllowedScope = {
  scopeId: string;
  allowedWorkingDirectories: string[];
  allowNpmBuild?: boolean;
  allowNpmTests?: boolean;
  allowInspectionCommands?: boolean;
  allowNetworkCommands?: boolean;
};

export type ScopedExecutionRequest = {
  executionRequestId: string;
  requestedBy: string;
  intent: string;
  command: string;
  workingDirectory: string;
  allowedScope: ScopedExecutionAllowedScope;
  riskLevel: ScopedExecutionRiskLevel;
  requiresApproval: boolean;
  approvalStatus: ScopedExecutionApprovalStatus;
  rollbackPlan?: string;
  mutationPossible?: boolean;
  timeoutMs?: number;
  expectedOutputs: string[];
  blockedReason?: string;
  executionStatus: ScopedExecutionStatus;
  stdoutSummary?: string;
  stderrSummary?: string;
  exitCode?: number | null;
  startedAt?: string;
  completedAt?: string;
};

export type ScopedExecutionDecision = {
  executionRequestId: string;
  approvedToRun: boolean;
  executable: boolean;
  blockedReason?: string;
  decisionSummary: string;
  commandCategory: "git_status" | "git_diff_name_only" | "git_rev_parse_head" | "npm_test" | "npm_build" | "inspection" | "blocked";
  truthfulnessLabel: ScopedExecutionTruthfulnessLabel;
};

export type ScopedExecutionLog = ScopedExecutionRequest & {
  decisionSummary: string;
  commandRun: string | null;
  elapsedMs: number;
  truthfulnessLabel: ScopedExecutionTruthfulnessLabel;
};

export type CampaignExecutionStepRecord = {
  executionRequestId: string;
  plannedStep: string;
  stepState: "planned" | "approved_executable" | "blocked_executable" | "completed_execution" | "failed_execution";
  executionStatus: ScopedExecutionStatus;
  exitCode?: number | null;
  truthfulnessLabel: ScopedExecutionTruthfulnessLabel;
};

export type CampaignExecutionResultState = {
  layerId: "SCOPED_SUPERVISED_EXECUTION_RUNTIME_PHASE1";
  plannedSteps: CampaignExecutionStepRecord[];
  approvedExecutableSteps: CampaignExecutionStepRecord[];
  blockedExecutableSteps: CampaignExecutionStepRecord[];
  completedExecutionSteps: CampaignExecutionStepRecord[];
  failedExecutionSteps: CampaignExecutionStepRecord[];
  truthfulnessWarnings: string[];
};

const destructivePatterns = [
  /\brm\b/i,
  /\bdel\b/i,
  /\brmdir\b/i,
  /\bremove-item\b/i,
  /git\s+reset\s+--hard/i,
  /git\s+clean\b/i,
  /git\s+push\b.*\s--force\b/i,
  /\bcredential\b/i,
  /\bpassword\b/i,
  /\btoken\b/i,
  /npm\s+(install|i|ci)\b/i,
  /\bunity\b/i,
];

function normalizePathForScope(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function isWorkingDirectoryAllowed(workingDirectory: string, allowedDirectories: string[]): boolean {
  const normalizedWorkingDirectory = normalizePathForScope(workingDirectory);
  return allowedDirectories.some((directory) => {
    const normalizedDirectory = normalizePathForScope(directory);
    return normalizedWorkingDirectory === normalizedDirectory || normalizedWorkingDirectory.startsWith(`${normalizedDirectory}/`);
  });
}

function commandCategoryFor(request: ScopedExecutionRequest): ScopedExecutionDecision["commandCategory"] {
  const command = request.command.trim();
  if (/^git\s+status(?:\s+--short)?$/i.test(command)) {
    return "git_status";
  }
  if (/^git\s+diff\s+--name-only$/i.test(command)) {
    return "git_diff_name_only";
  }
  if (/^git\s+rev-parse\s+--short\s+HEAD$/i.test(command)) {
    return "git_rev_parse_head";
  }
  if (request.allowedScope.allowNpmTests && /^npm\s+(test|run\s+test(?::[a-z0-9:-]+)?)(?:\s+--.*)?$/i.test(command)) {
    return "npm_test";
  }
  if (request.allowedScope.allowNpmBuild && /^npm\s+run\s+build$/i.test(command)) {
    return "npm_build";
  }
  if (request.allowedScope.allowInspectionCommands && /^(pwd|node\s+--version|npm\s+--version)$/i.test(command)) {
    return "inspection";
  }
  return "blocked";
}

export function evaluateScopedExecutionRequest(request: ScopedExecutionRequest): ScopedExecutionDecision {
  const command = request.command.trim();
  const commandCategory = commandCategoryFor(request);
  const blockedReason = request.blockedReason
    ?? (request.riskLevel === "HIGH" ? "High-risk commands are outside the Phase 1 supervised execution allowlist." : undefined)
    ?? (request.requiresApproval && request.approvalStatus !== "approved" ? "Execution requires explicit approval before running." : undefined)
    ?? (!request.timeoutMs || request.timeoutMs <= 0 ? "Execution timeoutMs must be set before running." : undefined)
    ?? (!isWorkingDirectoryAllowed(request.workingDirectory, request.allowedScope.allowedWorkingDirectories) ? "Working directory is outside the allowed scope." : undefined)
    ?? (destructivePatterns.some((pattern) => pattern.test(command)) ? "Command matches a blocked destructive, credential, install, force-push, or Unity execution pattern." : undefined)
    ?? (commandCategory === "blocked" ? "Command is not in the Phase 1 safe command allowlist." : undefined)
    ?? (request.mutationPossible && !request.rollbackPlan ? "Rollback plan is required when mutation is possible." : undefined);

  if (blockedReason) {
    return {
      executionRequestId: request.executionRequestId,
      approvedToRun: false,
      executable: false,
      blockedReason,
      decisionSummary: `Blocked '${command}' for ${request.intent}: ${blockedReason}`,
      commandCategory: commandCategory === "blocked" ? "blocked" : commandCategory,
      truthfulnessLabel: "blocked_no_execution",
    };
  }

  return {
    executionRequestId: request.executionRequestId,
    approvedToRun: true,
    executable: true,
    decisionSummary: `Approved scoped command '${command}' for ${request.intent}.`,
    commandCategory,
    truthfulnessLabel: "prepared_no_execution",
  };
}

export function createScopedExecutionLog(request: ScopedExecutionRequest, decision: ScopedExecutionDecision, output: Partial<Pick<ScopedExecutionLog, "stdoutSummary" | "stderrSummary" | "exitCode" | "startedAt" | "completedAt" | "elapsedMs" | "executionStatus" | "truthfulnessLabel">> = {}): ScopedExecutionLog {
  const executionStatus = output.executionStatus ?? (decision.executable ? "prepared" : "blocked");
  const commandWasAttempted = executionStatus === "running" || executionStatus === "completed" || executionStatus === "failed" || executionStatus === "timed_out";
  return {
    ...request,
    executionStatus,
    blockedReason: decision.blockedReason,
    stdoutSummary: output.stdoutSummary,
    stderrSummary: output.stderrSummary,
    exitCode: output.exitCode,
    startedAt: output.startedAt,
    completedAt: output.completedAt,
    decisionSummary: decision.decisionSummary,
    commandRun: decision.executable && commandWasAttempted ? request.command : null,
    elapsedMs: output.elapsedMs ?? 0,
    truthfulnessLabel: output.truthfulnessLabel ?? decision.truthfulnessLabel,
  };
}

export function recordCampaignExecutionResult(log: ScopedExecutionLog): CampaignExecutionStepRecord {
  const stepState: CampaignExecutionStepRecord["stepState"] = log.executionStatus === "completed"
    ? "completed_execution"
    : log.executionStatus === "failed" || log.executionStatus === "timed_out"
      ? "failed_execution"
      : log.executionStatus === "blocked" || log.executionStatus === "adapter_disabled"
        ? "blocked_executable"
        : log.approvalStatus === "approved"
          ? "approved_executable"
          : "planned";

  return {
    executionRequestId: log.executionRequestId,
    plannedStep: log.intent,
    stepState,
    executionStatus: log.executionStatus,
    exitCode: log.exitCode,
    truthfulnessLabel: log.truthfulnessLabel,
  };
}

export function buildCampaignExecutionResultState(logs: ScopedExecutionLog[]): CampaignExecutionResultState {
  const records = logs.map(recordCampaignExecutionResult);
  return {
    layerId: "SCOPED_SUPERVISED_EXECUTION_RUNTIME_PHASE1",
    plannedSteps: records.filter((record) => record.stepState === "planned"),
    approvedExecutableSteps: records.filter((record) => record.stepState === "approved_executable"),
    blockedExecutableSteps: records.filter((record) => record.stepState === "blocked_executable"),
    completedExecutionSteps: records.filter((record) => record.stepState === "completed_execution"),
    failedExecutionSteps: records.filter((record) => record.stepState === "failed_execution"),
    truthfulnessWarnings: [
      "Only records with truthfulnessLabel real_execution_completed or real_execution_failed represent real command execution attempts.",
      "Prepared or blocked requests must not be described as executed.",
      "This Phase 1 runtime only allows tightly scoped approved local commands.",
    ],
  };
}

export function summarizeOutput(output: string, maxLength = 800): string {
  const normalized = output.replace(/\r\n/g, "\n").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}