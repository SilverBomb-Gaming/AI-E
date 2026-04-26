import {
  advanceTaskChain,
  evaluateTaskChainReadiness,
  type AutonomousTaskChain,
  type AutonomousTaskStep,
} from "./autonomousTaskChain";
import {
  advanceWorkSession,
  completeWorkSession,
  evaluateWorkSessionReadiness,
  pauseWorkSession,
  resumeWorkSession,
  summarizeWorkSession,
  type AutonomousWorkSession,
  type WorkSessionStatus,
} from "./autonomousWorkSession";
import { buildRecoveryReport, type RecoveryReport } from "./failureRecoveryIntelligence";

export type RuntimeStatus =
  | "runtime_idle"
  | "runtime_ready"
  | "runtime_running"
  | "runtime_paused"
  | "runtime_blocked"
  | "runtime_completed";

export type SessionRuntimeState = {
  status: RuntimeStatus;
  can_run_cycle: boolean;
  reason: string;
  next_cycle_index: number;
};

export type RuntimeCycle = {
  cycle_id: string | null;
  status: RuntimeStatus;
  summary: string;
  advanced_step_title: string | null;
  session_status: WorkSessionStatus;
};

export type SessionRuntimeResult = {
  status: RuntimeStatus;
  session: AutonomousWorkSession;
  state: SessionRuntimeState;
  cycle: RuntimeCycle | null;
  explanation: string;
  recovery_report: RecoveryReport | null;
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

function deriveInvocationTime(session: AutonomousWorkSession): string {
  const base = parseTimestamp(session.updated_at) ?? parseTimestamp(session.created_at) ?? Date.UTC(2026, 0, 1);
  return new Date(base + ((session.cycle_history.length + 1) * 1000)).toISOString();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function calculateGoalOverlap(goal: string, value: string): number {
  const goalTokens = tokenize(goal);
  if (goalTokens.length === 0) {
    return 0;
  }

  const valueTokens = new Set(tokenize(value));
  const matches = goalTokens.filter((token) => valueTokens.has(token)).length;
  return matches / goalTokens.length;
}

function hasTerminalGoalSignal(session: AutonomousWorkSession, step: AutonomousTaskStep, chain: AutonomousTaskChain): boolean {
  if (chain.status !== "chain_completed") {
    return false;
  }

  const text = `${step.title} ${session.operator_goal}`.toLowerCase();
  const terminalKeyword = /(complete|completed|finish|finished|done|final|stabilized|verified|ready)/.test(text);
  return terminalKeyword && calculateGoalOverlap(session.operator_goal, text) >= 0.34;
}

function cloneSession(session: AutonomousWorkSession): AutonomousWorkSession {
  return {
    ...session,
    goal_state: { ...session.goal_state },
    orchestration_memory: {
      ...session.orchestration_memory,
      cycle_ids: [...session.orchestration_memory.cycle_ids],
      goal_state: { ...session.orchestration_memory.goal_state },
      completed_steps: session.orchestration_memory.completed_steps.map((step) => ({ ...step })),
      proposed_steps: session.orchestration_memory.proposed_steps.map((step) => ({ ...step })),
    },
    active_chain: {
      ...session.active_chain,
      steps: session.active_chain.steps.map((step) => ({ ...step })),
      blockers: session.active_chain.blockers.map((blocker) => ({ ...blocker })),
      completion_report: {
        ...session.active_chain.completion_report,
        completed_steps: [...session.active_chain.completion_report.completed_steps],
        pending_steps: [...session.active_chain.completion_report.pending_steps],
      },
    },
    checkpoints: session.checkpoints.map((checkpoint) => ({
      ...checkpoint,
      validation_snapshot: { ...checkpoint.validation_snapshot },
      approval_state: { ...checkpoint.approval_state },
    })),
    approval_state: {
      ...session.approval_state,
      chain_approvals: session.approval_state.chain_approvals.map((approval) => ({ ...approval })),
    },
    current_cycle: session.current_cycle
      ? {
        ...session.current_cycle,
        proposed_step_titles: [...session.current_cycle.proposed_step_titles],
        completed_step_titles: [...session.current_cycle.completed_step_titles],
      }
      : null,
    latest_persistence_record: {
      ...session.latest_persistence_record,
      checkpoint_snapshot: {
        ...session.latest_persistence_record.checkpoint_snapshot,
        validation_snapshot: { ...session.latest_persistence_record.checkpoint_snapshot.validation_snapshot },
        approval_state: { ...session.latest_persistence_record.checkpoint_snapshot.approval_state },
      },
      approval_state: session.latest_persistence_record.approval_state.map((approval) => ({ ...approval })),
      validation_snapshot: { ...session.latest_persistence_record.validation_snapshot },
      context_snapshot: { ...session.latest_persistence_record.context_snapshot },
    },
    cycle_history: session.cycle_history.map((cycle) => ({
      ...cycle,
      proposed_step_titles: [...cycle.proposed_step_titles],
      completed_step_titles: [...cycle.completed_step_titles],
    })),
    session_report: { ...session.session_report },
  };
}

function mapSessionStatusToRuntimeStatus(status: WorkSessionStatus): RuntimeStatus {
  switch (status) {
    case "session_planned":
      return "runtime_idle";
    case "awaiting_session_approval":
    case "session_paused":
      return "runtime_paused";
    case "session_running":
      return "runtime_running";
    case "session_blocked":
      return "runtime_blocked";
    case "session_completed":
      return "runtime_completed";
  }
}

function buildRuntimeRecoveryReport(session: AutonomousWorkSession, state: SessionRuntimeState, explanation: string): RecoveryReport | null {
  if (state.status !== "runtime_paused" && state.status !== "runtime_blocked") {
    return null;
  }

  const readiness = evaluateWorkSessionReadiness(session, deriveInvocationTime(session));
  return buildRecoveryReport({
    created_at: session.updated_at,
    source: "session_runtime",
    status: state.status,
    message: explanation,
    explanation,
    blockers: readiness.blockers.map((blocker) => ({
      code: blocker.code,
      message: blocker.message,
      recommended_action: blocker.recommended_action,
    })),
    validation_status: session.latest_persistence_record.validation_snapshot.status,
    validation_recommendation: session.latest_persistence_record.validation_snapshot.recommendation,
    rollback_recommended: session.latest_persistence_record.validation_snapshot.recommendation === "rollback",
  });
}

export function evaluateRuntimeState(session: AutonomousWorkSession): SessionRuntimeState {
  const now = deriveInvocationTime(session);

  if (session.status === "session_completed") {
    return {
      status: "runtime_completed",
      can_run_cycle: false,
      reason: session.session_report.completion_reason ?? "The supervised session is already complete.",
      next_cycle_index: session.cycle_history.length + 1,
    };
  }

  if (session.status === "session_blocked") {
    return {
      status: "runtime_blocked",
      can_run_cycle: false,
      reason: session.session_report.pause_reason ?? "The supervised session is blocked.",
      next_cycle_index: session.cycle_history.length + 1,
    };
  }

  if (session.status === "session_paused") {
    const pauseReason = normalizeText(session.session_report.pause_reason).toLowerCase();
    if (/(approval|validation|rollback)/.test(pauseReason)) {
      return {
        status: "runtime_paused",
        can_run_cycle: false,
        reason: session.session_report.pause_reason ?? "The supervised session is paused pending review.",
        next_cycle_index: session.cycle_history.length + 1,
      };
    }

    const resumed = resumeWorkSession(cloneSession(session), now);
    if (resumed.status === "session_running") {
      return {
        status: "runtime_ready",
        can_run_cycle: true,
        reason: "The paused supervised session can resume safely from its latest checkpoint.",
        next_cycle_index: session.cycle_history.length + 1,
      };
    }

    return {
      status: mapSessionStatusToRuntimeStatus(resumed.status),
      can_run_cycle: false,
      reason: resumed.session_report.pause_reason ?? resumed.session_report.completion_reason ?? "The paused supervised session cannot resume safely yet.",
      next_cycle_index: session.cycle_history.length + 1,
    };
  }

  const readiness = evaluateWorkSessionReadiness(session, now);
  if (readiness.can_advance) {
    return {
      status: "runtime_ready",
      can_run_cycle: true,
      reason: readiness.explanation,
      next_cycle_index: session.cycle_history.length + 1,
    };
  }

  return {
    status: readiness.status === "session_blocked"
      ? "runtime_blocked"
      : readiness.status === "session_completed"
        ? "runtime_completed"
        : readiness.status === "session_running"
          ? "runtime_running"
          : readiness.status === "session_planned"
            ? "runtime_idle"
            : "runtime_paused",
    can_run_cycle: false,
    reason: readiness.explanation,
    next_cycle_index: session.cycle_history.length + 1,
  };
}

export function buildRuntimeResult(session: AutonomousWorkSession): SessionRuntimeResult {
  const state = evaluateRuntimeState(session);
  const latestCycle = session.current_cycle ?? session.cycle_history.at(-1) ?? null;
  const explanation = state.reason;
  return {
    status: state.status === "runtime_ready" ? "runtime_running" : state.status,
    session,
    state,
    cycle: latestCycle
      ? {
        cycle_id: latestCycle.cycle_id,
        status: mapSessionStatusToRuntimeStatus(session.status),
        summary: latestCycle.summary,
        advanced_step_title: latestCycle.completed_step_titles.at(-1) ?? latestCycle.proposed_step_titles.at(-1) ?? null,
        session_status: session.status,
      }
      : null,
    explanation,
    recovery_report: buildRuntimeRecoveryReport(session, state, explanation),
  };
}

export function runSessionCycle(session: AutonomousWorkSession): SessionRuntimeResult {
  const now = deriveInvocationTime(session);
  const initialState = evaluateRuntimeState(session);
  if (!initialState.can_run_cycle) {
    return buildRuntimeResult(cloneSession(session));
  }

  let nextSession = cloneSession(session);
  if (nextSession.status === "session_paused") {
    nextSession = resumeWorkSession(nextSession, now);
    if (nextSession.status !== "session_running") {
      return buildRuntimeResult(nextSession);
    }
  }

  let chain = nextSession.active_chain;
  if (chain.status === "chain_planned" || chain.status === "awaiting_chain_approval") {
    const readiness = evaluateTaskChainReadiness(chain);
    chain = readiness.chain;
    if (readiness.status === "awaiting_chain_approval") {
      return buildRuntimeResult(pauseWorkSession({
        ...nextSession,
        active_chain: chain,
      }, readiness.explanation, now));
    }
    if (readiness.status === "chain_blocked") {
      return buildRuntimeResult({
        ...pauseWorkSession({
          ...nextSession,
          active_chain: chain,
        }, readiness.explanation, now),
        status: "session_blocked",
      });
    }
  }

  if (chain.status === "chain_ready" || chain.status === "chain_running") {
    const currentStep = chain.steps[chain.current_step_index] ?? null;
    if (!currentStep) {
      return buildRuntimeResult(completeWorkSession(nextSession, now));
    }

    if (
      currentStep.required_gate === "commit_gate"
      || currentStep.required_gate === "commit_approval"
      || currentStep.required_gate === "push_approval"
      || currentStep.commit_allowed
      || currentStep.push_allowed
    ) {
      return buildRuntimeResult(pauseWorkSession(nextSession, `Runtime paused because step ${currentStep.title} requires explicit approval before execution.`, now));
    }

    const advancedChainResult = advanceTaskChain(chain, {
      step_id: currentStep.step_id,
      risk_level: chain.risk_level === "blocked" ? "high" : chain.risk_level,
      validation_status: "validation_passed",
      validation_recommendation: "keep_changes",
      rollback_recommended: false,
      explanation: `Runtime completed one safe supervised cycle for step ${currentStep.title}.`,
    });

    const advancedSession = advanceWorkSession({
      ...nextSession,
      active_chain: advancedChainResult.chain,
    }, {
      occurredAt: now,
      summary: advancedChainResult.explanation,
      activeChain: advancedChainResult.chain,
      completedSteps: [{
        title: currentStep.title,
        rationale: `Runtime recorded bounded progress for step ${currentStep.title}.`,
        stepId: currentStep.step_id,
        marksGoalComplete: hasTerminalGoalSignal(nextSession, currentStep, advancedChainResult.chain),
      }],
      marksGoalComplete: hasTerminalGoalSignal(nextSession, currentStep, advancedChainResult.chain),
      validationStatus: advancedChainResult.blockers.some((blocker) => blocker.code === "validation_failed" || blocker.code === "high_risk_step")
        ? "validation_failed"
        : "validation_passed",
      validationRecommendation: advancedChainResult.blockers.some((blocker) => blocker.code === "rollback_recommended")
        ? "rollback"
        : "keep_changes",
      requiresApproval: false,
    });
    return buildRuntimeResult(advancedSession);
  }

  if (chain.status === "chain_completed") {
    const readiness = evaluateWorkSessionReadiness(nextSession, now);
    if (!readiness.can_advance) {
      return buildRuntimeResult(pauseWorkSession(nextSession, readiness.explanation, now));
    }

    const orchestrated = advanceWorkSession(nextSession, {
      occurredAt: now,
      summary: readiness.orchestration_decision?.explanation ?? "Runtime recorded one bounded orchestration cycle.",
      activeChain: chain,
      proposedSteps: readiness.orchestration_decision?.plan.proposed_steps.map((step) => ({
        title: step.title,
        rationale: step.rationale,
        stepId: step.step_id,
      })) ?? [],
      validationStatus: "validation_passed",
      validationRecommendation: "keep_changes",
      requiresApproval: false,
    });
    return buildRuntimeResult(orchestrated);
  }

  return buildRuntimeResult(pauseWorkSession(nextSession, "Runtime could not identify a safe bounded cycle to execute.", now));
}

export function summarizeRuntime(result: SessionRuntimeResult): string {
  return [
    `Runtime status: ${result.status}`,
    `Runtime state: ${result.state.status}`,
    `Can run cycle: ${result.state.can_run_cycle}`,
    `Reason: ${result.state.reason}`,
    `Cycle summary: ${result.cycle?.summary ?? "none"}`,
    `Recovery recommendation: ${result.recovery_report?.decision.recommendation ?? "none"}`,
    `Session summary: ${summarizeWorkSession(result.session).replace(/\n/g, " | ")}`,
  ].join("\n");
}