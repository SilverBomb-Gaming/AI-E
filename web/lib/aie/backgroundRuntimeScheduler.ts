import {
  evaluateApprovalFreshness,
  evaluateContextStaleness,
  requireReapprovalIfNeeded,
  type ApprovalState,
} from "./approvalFreshness";
import {
  startRuntimeLoop,
  summarizeLoop,
  type RuntimeLoopState,
} from "./runtimeLoopController";
import type { AutonomousWorkSession } from "./autonomousWorkSession";

export type BackgroundRunStatus =
  | "scheduler_idle"
  | "run_eligible"
  | "run_started"
  | "run_paused"
  | "run_blocked"
  | "run_completed"
  | "run_skipped";

export type BackgroundRuntimeConfig = {
  max_cycles_per_run: number;
  allow_when_approvals_pending?: boolean;
  require_fresh_approvals?: boolean;
  require_fresh_context?: boolean;
  stop_on_validation_failure?: boolean;
  stop_on_rollback_recommendation?: boolean;
  operator_away_mode?: boolean;
};

export type BackgroundRuntimeScheduler = {
  scheduler_id: string;
  created_at: string;
  config: {
    max_cycles_per_run: number;
    allow_when_approvals_pending: boolean;
    require_fresh_approvals: boolean;
    require_fresh_context: boolean;
    stop_on_validation_failure: boolean;
    stop_on_rollback_recommendation: boolean;
    operator_away_mode: boolean;
  };
};

export type BackgroundRunRequest = {
  request_id: string;
  requested_at: string;
  session_id: string;
  operator_goal: string;
  operator_away_mode: boolean;
};

export type BackgroundRunBlocker = {
  code:
    | "session_approval_required"
    | "session_approval_stale"
    | "chain_approval_required"
    | "context_stale"
    | "validation_failed"
    | "rollback_recommended"
    | "session_completed"
    | "loop_cycle_cap_reached";
  message: string;
  severity: "pause" | "block" | "info";
  approvals_needed?: string[];
};

export type BackgroundRunReport = {
  report_id: string;
  created_at: string;
  session_id: string;
  operator_goal: string;
  run_status: BackgroundRunStatus;
  cycles_attempted: number;
  cycles_completed: number;
  stop_reason: string;
  blockers: BackgroundRunBlocker[];
  approvals_needed: string[];
  validation_summary: string;
  next_operator_action: string;
  safe_to_continue_later: boolean;
};

export type BackgroundRunResult = {
  status: BackgroundRunStatus;
  scheduler: BackgroundRuntimeScheduler;
  request: BackgroundRunRequest;
  session: AutonomousWorkSession;
  loop_state: RuntimeLoopState | null;
  blockers: BackgroundRunBlocker[];
  approvals_needed: string[];
  cycles_attempted: number;
  cycles_completed: number;
  stop_reason: string;
  safe_to_continue_later: boolean;
  next_operator_action: string;
  validation_summary: string;
  report: BackgroundRunReport;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function parseTimestamp(value: string | null | undefined): number | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function deriveNow(session: AutonomousWorkSession, offsetSeconds = 0): string {
  const base = parseTimestamp(session.updated_at) ?? parseTimestamp(session.created_at) ?? Date.UTC(2026, 0, 1);
  return new Date(base + (offsetSeconds * 1000)).toISOString();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => normalizeText(value).length > 0))];
}

function normalizeConfig(config: BackgroundRuntimeConfig) {
  return {
    max_cycles_per_run: Math.max(1, Math.floor(config.max_cycles_per_run)),
    allow_when_approvals_pending: config.allow_when_approvals_pending === true,
    require_fresh_approvals: config.require_fresh_approvals !== false,
    require_fresh_context: config.require_fresh_context !== false,
    stop_on_validation_failure: config.stop_on_validation_failure !== false,
    stop_on_rollback_recommendation: config.stop_on_rollback_recommendation !== false,
    operator_away_mode: config.operator_away_mode !== false,
  };
}

function buildSchedulerId(config: ReturnType<typeof normalizeConfig>): string {
  const flags = [
    config.max_cycles_per_run,
    config.allow_when_approvals_pending ? "allow-pending" : "block-pending",
    config.require_fresh_approvals ? "fresh-approvals" : "any-approvals",
    config.require_fresh_context ? "fresh-context" : "any-context",
    config.operator_away_mode ? "away" : "local",
  ].join("-");
  return `background-runtime-scheduler-${flags}`;
}

function buildRequest(session: AutonomousWorkSession, scheduler: BackgroundRuntimeScheduler): BackgroundRunRequest {
  const requestedAt = deriveNow(session, 1);
  return {
    request_id: `background-run-request-${sanitizeTimestamp(requestedAt)}-${session.session_id}`,
    requested_at: requestedAt,
    session_id: session.session_id,
    operator_goal: session.operator_goal,
    operator_away_mode: scheduler.config.operator_away_mode,
  };
}

function buildValidationSummary(session: AutonomousWorkSession): string {
  const validation = session.latest_persistence_record.validation_snapshot;
  return `Validation ${validation.status} with recommendation ${validation.recommendation}.`;
}

function buildResult(input: {
  status: BackgroundRunStatus;
  scheduler: BackgroundRuntimeScheduler;
  request: BackgroundRunRequest;
  session: AutonomousWorkSession;
  loopState?: RuntimeLoopState | null;
  blockers?: BackgroundRunBlocker[];
  approvalsNeeded?: string[];
  cyclesAttempted?: number;
  cyclesCompleted?: number;
  stopReason: string;
  safeToContinueLater: boolean;
  nextOperatorAction: string;
}): BackgroundRunResult {
  const blockers = input.blockers ?? [];
  const approvalsNeeded = unique(input.approvalsNeeded ?? blockers.flatMap((blocker) => blocker.approvals_needed ?? []));
  const report = buildBackgroundRunReport({
    status: input.status,
    scheduler: input.scheduler,
    request: input.request,
    session: input.session,
    loop_state: input.loopState ?? null,
    blockers,
    approvals_needed: approvalsNeeded,
    cycles_attempted: input.cyclesAttempted ?? 0,
    cycles_completed: input.cyclesCompleted ?? 0,
    stop_reason: input.stopReason,
    safe_to_continue_later: input.safeToContinueLater,
    next_operator_action: input.nextOperatorAction,
    validation_summary: buildValidationSummary(input.session),
  });

  return {
    status: input.status,
    scheduler: input.scheduler,
    request: input.request,
    session: input.session,
    loop_state: input.loopState ?? null,
    blockers,
    approvals_needed: approvalsNeeded,
    cycles_attempted: input.cyclesAttempted ?? 0,
    cycles_completed: input.cyclesCompleted ?? 0,
    stop_reason: input.stopReason,
    safe_to_continue_later: input.safeToContinueLater,
    next_operator_action: input.nextOperatorAction,
    validation_summary: buildValidationSummary(input.session),
    report,
  };
}

function buildApprovalBlocker(message: string, code: BackgroundRunBlocker["code"], approvalsNeeded: string[] = []): BackgroundRunBlocker {
  return {
    code,
    message,
    severity: code === "session_approval_required" ? "pause" : "block",
    approvals_needed: approvalsNeeded,
  };
}

function deriveChainApprovalStates(session: AutonomousWorkSession): ApprovalState[] {
  return session.approval_state.chain_approvals.length > 0
    ? session.approval_state.chain_approvals
    : session.latest_persistence_record.approval_state;
}

export function createBackgroundRuntimeScheduler(config: BackgroundRuntimeConfig): BackgroundRuntimeScheduler {
  const normalized = normalizeConfig(config);
  return {
    scheduler_id: buildSchedulerId(normalized),
    created_at: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    config: normalized,
  };
}

export function evaluateBackgroundRunEligibility(
  session: AutonomousWorkSession,
  scheduler: BackgroundRuntimeScheduler,
): BackgroundRunResult {
  const request = buildRequest(session, scheduler);
  const now = request.requested_at;

  if (session.status === "session_completed") {
    return buildResult({
      status: "run_completed",
      scheduler,
      request,
      session,
      blockers: [{
        code: "session_completed",
        message: "The supervised work session is already complete.",
        severity: "info",
      }],
      stopReason: session.session_report.completion_reason ?? "The supervised work session is already complete.",
      safeToContinueLater: false,
      nextOperatorAction: "Review the completion report and decide whether to start a new session.",
    });
  }

  if (scheduler.config.stop_on_validation_failure) {
    const validationStatus = session.latest_persistence_record.validation_snapshot.status;
    if (validationStatus === "validation_failed" || validationStatus === "validation_blocked") {
      return buildResult({
        status: "run_paused",
        scheduler,
        request,
        session,
        blockers: [{
          code: "validation_failed",
          message: "Background runtime paused because the persisted validation snapshot failed and needs review.",
          severity: "pause",
        }],
        stopReason: "Background runtime paused because the persisted validation snapshot failed and needs review.",
        safeToContinueLater: true,
        nextOperatorAction: "Review the failed validation result before resuming background operation.",
      });
    }
  }

  if (
    scheduler.config.stop_on_rollback_recommendation
    && session.latest_persistence_record.validation_snapshot.recommendation === "rollback"
  ) {
    return buildResult({
      status: "run_paused",
      scheduler,
      request,
      session,
      blockers: [{
        code: "rollback_recommended",
        message: "Background runtime paused because the latest validation recommends rollback.",
        severity: "pause",
      }],
      stopReason: "Background runtime paused because the latest validation recommends rollback.",
      safeToContinueLater: true,
      nextOperatorAction: "Review the rollback recommendation before resuming background operation.",
    });
  }

  if (scheduler.config.require_fresh_approvals) {
    if (!session.approval_state.session_approval_granted) {
      return buildResult({
        status: scheduler.config.allow_when_approvals_pending ? "run_skipped" : "run_paused",
        scheduler,
        request,
        session,
        blockers: [buildApprovalBlocker(
          "Background runtime requires explicit session approval before it can start.",
          "session_approval_required",
          ["session"],
        )],
        stopReason: "Background runtime requires explicit session approval before it can start.",
        safeToContinueLater: true,
        nextOperatorAction: "Grant session approval before the next background run.",
      });
    }

    const sessionApprovalFreshness = evaluateApprovalFreshness({
      approvalState: {
        approval_type: "chain",
        granted_at: session.approval_state.session_approved_at,
        expires_at: session.approval_state.session_approval_expires_at,
        requires_reapproval: session.approval_state.requires_session_reapproval,
      },
      now,
    });
    if (sessionApprovalFreshness.status !== "fresh") {
      return buildResult({
        status: "run_blocked",
        scheduler,
        request,
        session,
        blockers: [buildApprovalBlocker(
          "Background runtime is blocked because the session approval is stale.",
          "session_approval_stale",
          ["session"],
        )],
        stopReason: "Background runtime is blocked because the session approval is stale.",
        safeToContinueLater: false,
        nextOperatorAction: "Renew session approval before another background run.",
      });
    }

    const chainApprovalFreshness = requireReapprovalIfNeeded({
      chain: session.active_chain,
      approvalStates: deriveChainApprovalStates(session),
      now,
    });
    if (chainApprovalFreshness.status !== "fresh") {
      return buildResult({
        status: scheduler.config.allow_when_approvals_pending ? "run_skipped" : "run_paused",
        scheduler,
        request,
        session,
        blockers: [buildApprovalBlocker(
          chainApprovalFreshness.explanation,
          "chain_approval_required",
          chainApprovalFreshness.approvals_requiring_reapproval,
        )],
        stopReason: chainApprovalFreshness.explanation,
        safeToContinueLater: true,
        nextOperatorAction: "Renew the required chain approvals before the next background run.",
      });
    }
  }

  if (scheduler.config.require_fresh_context) {
    const contextFreshness = evaluateContextStaleness({
      chain: session.active_chain,
      contextSnapshot: session.latest_persistence_record.context_snapshot,
      now,
    });
    if (contextFreshness.status !== "fresh") {
      return buildResult({
        status: "run_blocked",
        scheduler,
        request,
        session,
        blockers: [{
          code: "context_stale",
          message: contextFreshness.explanation,
          severity: "block",
        }],
        stopReason: contextFreshness.explanation,
        safeToContinueLater: false,
        nextOperatorAction: "Refresh session context and validation state before another background run.",
      });
    }
  }

  return buildResult({
    status: "run_eligible",
    scheduler,
    request,
    session,
    stopReason: scheduler.config.operator_away_mode
      ? "The session is eligible for a bounded operator-away background run."
      : "The session is eligible for a bounded scheduled run.",
    safeToContinueLater: true,
    nextOperatorAction: scheduler.config.operator_away_mode
      ? "Review the background run report after the bounded away-mode cycle batch completes."
      : "Review the scheduled run result after execution.",
  });
}

export function runBackgroundRuntimeCycle(
  session: AutonomousWorkSession,
  scheduler: BackgroundRuntimeScheduler,
): BackgroundRunResult {
  const eligibility = evaluateBackgroundRunEligibility(session, scheduler);
  if (eligibility.status !== "run_eligible") {
    return eligibility;
  }

  const loopState = startRuntimeLoop(session, {
    max_cycles: scheduler.config.max_cycles_per_run,
    continuous_operation: true,
  });

  const blockers: BackgroundRunBlocker[] = [];
  if (loopState.status === "loop_paused") {
    blockers.push({
      code: loopState.reason.toLowerCase().includes("approval") ? "session_approval_required" : "validation_failed",
      message: loopState.reason,
      severity: "pause",
      approvals_needed: loopState.reason.toLowerCase().includes("approval") ? ["session"] : undefined,
    });
  }
  if (loopState.status === "loop_blocked") {
    blockers.push({
      code: loopState.reason.toLowerCase().includes("cycle limit") ? "loop_cycle_cap_reached" : "context_stale",
      message: loopState.reason,
      severity: "block",
    });
  }
  if (loopState.status === "loop_running" && loopState.executed_cycles >= scheduler.config.max_cycles_per_run) {
    blockers.push({
      code: "loop_cycle_cap_reached",
      message: loopState.reason,
      severity: "info",
    });
  }

  const runStatus: BackgroundRunStatus = loopState.status === "loop_completed"
    ? "run_completed"
    : loopState.status === "loop_paused"
      ? "run_paused"
      : loopState.status === "loop_blocked"
        ? "run_blocked"
        : "run_started";

  return buildResult({
    status: runStatus,
    scheduler,
    request: eligibility.request,
    session: loopState.session,
    loopState,
    blockers,
    cyclesAttempted: loopState.executed_cycles,
    cyclesCompleted: loopState.cycle_results.filter((cycle) => cycle.status === "runtime_running" || cycle.status === "runtime_completed").length,
    stopReason: loopState.reason,
    safeToContinueLater: runStatus === "run_started" || runStatus === "run_paused",
    nextOperatorAction: runStatus === "run_completed"
      ? "Review the completion report and archive or replace the session."
      : runStatus === "run_paused"
        ? "Review the pause reason before scheduling another background run."
        : runStatus === "run_blocked"
          ? "Resolve the blocking condition before another background run."
          : "Review the report and trigger the next bounded background run when appropriate.",
  });
}

export function buildBackgroundRunReport(input: {
  status: BackgroundRunStatus;
  scheduler: BackgroundRuntimeScheduler;
  request: BackgroundRunRequest;
  session: AutonomousWorkSession;
  loop_state: RuntimeLoopState | null;
  blockers: BackgroundRunBlocker[];
  approvals_needed: string[];
  cycles_attempted: number;
  cycles_completed: number;
  stop_reason: string;
  safe_to_continue_later: boolean;
  next_operator_action: string;
  validation_summary: string;
}): BackgroundRunReport {
  return {
    report_id: `background-run-report-${sanitizeTimestamp(input.request.requested_at)}-${input.session.session_id}`,
    created_at: input.request.requested_at,
    session_id: input.session.session_id,
    operator_goal: input.session.operator_goal,
    run_status: input.status,
    cycles_attempted: input.cycles_attempted,
    cycles_completed: input.cycles_completed,
    stop_reason: input.stop_reason,
    blockers: input.blockers,
    approvals_needed: unique(input.approvals_needed),
    validation_summary: input.validation_summary,
    next_operator_action: input.next_operator_action,
    safe_to_continue_later: input.safe_to_continue_later,
  };
}

export function summarizeBackgroundRun(result: BackgroundRunResult): string {
  return [
    `Background run status: ${result.status}`,
    `Session: ${result.session.session_id}`,
    `Cycles attempted: ${result.cycles_attempted}`,
    `Cycles completed: ${result.cycles_completed}`,
    `Stop reason: ${result.stop_reason}`,
    `Approvals needed: ${result.approvals_needed.join(", ") || "none"}`,
    `Validation summary: ${result.validation_summary}`,
    `Loop summary: ${result.loop_state ? summarizeLoop(result.loop_state).replace(/\n/g, " | ") : "none"}`,
  ].join("\n");
}