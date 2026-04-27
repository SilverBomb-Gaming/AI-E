import {
  createAutonomousTaskChain,
  type AutonomousTaskChain,
  type AutonomousTaskChainInput,
} from "./autonomousTaskChain";
import {
  createChainCheckpoint,
  evaluateRecoveryEligibility,
  type ChainCheckpoint,
} from "./autonomousChainRecovery";
import { type ApprovalState } from "./approvalFreshness";
import {
  createChainPersistenceRecord,
  type ChainPersistenceRecord,
} from "./chainPersistence";
import {
  decideAutonomousOrchestration,
  type OrchestrationDecision,
} from "./autonomousOrchestrator";
import { buildRecoveryReport, type RecoveryReport } from "./failureRecoveryIntelligence";
import {
  createOrchestrationMemory,
  evaluateGoalCompletion,
  summarizeGoalState,
  updateOrchestrationMemory,
  type GoalState,
  type OrchestrationMemory,
} from "./orchestrationMemory";

export type WorkSessionStatus =
  | "session_planned"
  | "awaiting_session_approval"
  | "session_running"
  | "session_paused"
  | "session_blocked"
  | "session_completed";

export type WorkSessionCycleStatus =
  | "cycle_planned"
  | "cycle_running"
  | "cycle_paused"
  | "cycle_blocked"
  | "cycle_completed";

export type WorkSessionCycle = {
  cycle_id: string;
  started_at: string;
  ended_at: string | null;
  status: WorkSessionCycleStatus;
  summary: string;
  resumed_from_checkpoint_id: string | null;
  proposed_step_titles: string[];
  completed_step_titles: string[];
  validation_status: ChainPersistenceRecord["validation_snapshot"]["status"] | null;
  validation_recommendation: ChainPersistenceRecord["validation_snapshot"]["recommendation"] | null;
  approvals_needed: boolean;
  rollback_recommended: boolean;
};

export type WorkSessionDecision = {
  status: WorkSessionStatus;
  can_advance: boolean;
  blockers: Array<{
    code:
      | "session_approval_required"
      | "session_reapproval_required"
      | "validation_failed"
      | "rollback_recommended"
      | "cycle_limit_reached"
      | "goal_completed"
      | "session_paused"
      | "session_blocked"
      | "resume_review_required"
      | "orchestration_blocked";
    message: string;
    recommended_action: "approve" | "review" | "pause" | "resume" | "complete";
  }>;
  orchestration_decision: OrchestrationDecision | null;
  explanation: string;
  recovery_report: RecoveryReport | null;
};

export type WorkSessionReport = {
  report_id: string;
  created_at: string;
  updated_at: string;
  status: WorkSessionStatus;
  cycle_count: number;
  completed_cycles: number;
  pause_reason: string | null;
  completion_reason: string | null;
  last_checkpoint_id: string | null;
  summary: string;
};

export type AutonomousWorkSession = {
  session_id: string;
  created_at: string;
  updated_at: string;
  operator_goal: string;
  goal_state: GoalState;
  orchestration_memory: OrchestrationMemory;
  active_chain: AutonomousTaskChain;
  checkpoints: ChainCheckpoint[];
  approval_state: {
    session_approval_granted: boolean;
    session_approved_at: string | null;
    session_approval_expires_at: string | null;
    requires_session_reapproval: boolean;
    chain_approvals: ApprovalState[];
  };
  current_cycle: WorkSessionCycle | null;
  latest_persistence_record: ChainPersistenceRecord;
  cycle_history: WorkSessionCycle[];
  max_cycles: number;
  session_report: WorkSessionReport;
  status: WorkSessionStatus;
};

export type CreateAutonomousWorkSessionInput = {
  operatorGoal: string;
  sessionId?: string;
  createdAt?: string;
  maxCycles?: number;
  maxChainSteps?: number;
  sessionApproval?: boolean;
  sessionApprovalGrantedAt?: string;
  sessionApprovalExpiresAt?: string | null;
  chainInput?: Partial<Omit<AutonomousTaskChainInput, "originalRequest" | "interpretedGoal" | "createdAt">>;
};

export type AdvanceWorkSessionCycleResult = {
  cycleId?: string;
  occurredAt?: string;
  summary?: string;
  activeChain?: AutonomousTaskChain;
  checkpoint?: ChainCheckpoint;
  validationStatus?: ChainPersistenceRecord["validation_snapshot"]["status"];
  validationRecommendation?: ChainPersistenceRecord["validation_snapshot"]["recommendation"];
  requiresApproval?: boolean;
  rollbackRecommended?: boolean;
  proposedSteps?: Array<{ title: string; rationale?: string | null; stepId?: string | null }>;
  completedSteps?: Array<{
    title: string;
    rationale?: string | null;
    stepId?: string | null;
    marksGoalComplete?: boolean;
  }>;
  approvalState?: ApprovalState[];
  marksGoalComplete?: boolean;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "autonomous-work-session";
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function buildSessionId(goal: string, createdAt: string): string {
  return `autonomous-work-session-${sanitizeTimestamp(createdAt)}-${slugify(goal)}`;
}

function buildReportId(sessionId: string, createdAt: string): string {
  return `autonomous-work-session-report-${sanitizeTimestamp(createdAt)}-${slugify(sessionId)}`;
}

function buildCycleId(sessionId: string, occurredAt: string, cycleIndex: number): string {
  return `${sessionId}-cycle-${cycleIndex}-${sanitizeTimestamp(occurredAt)}`;
}

function parseTimestamp(value: string | null | undefined): number | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function cloneCheckpoint(checkpoint: ChainCheckpoint): ChainCheckpoint {
  return {
    ...checkpoint,
    validation_snapshot: { ...checkpoint.validation_snapshot },
    approval_state: { ...checkpoint.approval_state },
  };
}

function cloneCycle(cycle: WorkSessionCycle): WorkSessionCycle {
  return {
    ...cycle,
    proposed_step_titles: [...cycle.proposed_step_titles],
    completed_step_titles: [...cycle.completed_step_titles],
  };
}

function cloneChainApprovals(values: ApprovalState[]): ApprovalState[] {
  return values.map((value) => ({ ...value }));
}

function clampMaxCycles(value: number | undefined): number {
  const numeric = Number(value ?? 6);
  if (!Number.isFinite(numeric)) {
    return 6;
  }

  return Math.max(1, Math.min(12, Math.floor(numeric)));
}

function hasFreshSessionApproval(session: AutonomousWorkSession, now: string): boolean {
  if (session.approval_state.session_approval_granted !== true) {
    return false;
  }

  if (session.approval_state.requires_session_reapproval) {
    return false;
  }

  const expiresAt = parseTimestamp(session.approval_state.session_approval_expires_at);
  const nowMs = parseTimestamp(now);
  if (expiresAt !== null && nowMs !== null && nowMs > expiresAt) {
    return false;
  }

  return true;
}

function buildSessionReport(
  session: Pick<
    AutonomousWorkSession,
    "session_id" | "created_at" | "updated_at" | "status" | "cycle_history" | "checkpoints" | "operator_goal" | "goal_state"
  >,
  pauseReason: string | null,
  completionReason: string | null,
): WorkSessionReport {
  const completedCycles = session.cycle_history.filter((cycle) => cycle.status === "cycle_completed").length;
  return {
    report_id: buildReportId(session.session_id, session.created_at),
    created_at: session.created_at,
    updated_at: session.updated_at,
    status: session.status,
    cycle_count: session.cycle_history.length,
    completed_cycles: completedCycles,
    pause_reason: pauseReason,
    completion_reason: completionReason,
    last_checkpoint_id: session.checkpoints.at(-1)?.checkpoint_id ?? null,
    summary: `${session.status}: ${completedCycles}/${session.cycle_history.length} cycles completed for ${session.operator_goal}`,
  };
}

function buildWorkSessionRecoveryReport(
  session: AutonomousWorkSession,
  status: WorkSessionStatus,
  blockers: WorkSessionDecision["blockers"],
  explanation: string,
): RecoveryReport | null {
  if (status === "session_running" || status === "session_completed") {
    return null;
  }

  return buildRecoveryReport({
    created_at: session.updated_at,
    source: "work_session",
    status,
    message: explanation,
    explanation,
    blockers: blockers.map((blocker) => ({
      code: blocker.code,
      message: blocker.message,
      recommended_action: blocker.recommended_action,
    })),
    validation_status: session.latest_persistence_record.validation_snapshot.status,
    validation_recommendation: session.latest_persistence_record.validation_snapshot.recommendation,
    rollback_recommended: session.latest_persistence_record.validation_snapshot.recommendation === "rollback",
  });
}

function withUpdatedGoalState(session: AutonomousWorkSession): AutonomousWorkSession {
  const goalState = evaluateGoalCompletion(session.orchestration_memory);
  const nextSession: AutonomousWorkSession = {
    ...session,
    goal_state: goalState,
  };
  return {
    ...nextSession,
    session_report: buildSessionReport(
      nextSession,
      nextSession.session_report.pause_reason,
      nextSession.session_report.completion_reason,
    ),
  };
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
    checkpoints: session.checkpoints.map(cloneCheckpoint),
    approval_state: {
      ...session.approval_state,
      chain_approvals: cloneChainApprovals(session.approval_state.chain_approvals),
    },
    current_cycle: session.current_cycle ? cloneCycle(session.current_cycle) : null,
    latest_persistence_record: {
      ...session.latest_persistence_record,
      checkpoint_snapshot: cloneCheckpoint(session.latest_persistence_record.checkpoint_snapshot),
      approval_state: cloneChainApprovals(session.latest_persistence_record.approval_state),
      validation_snapshot: { ...session.latest_persistence_record.validation_snapshot },
      context_snapshot: { ...session.latest_persistence_record.context_snapshot },
    },
    cycle_history: session.cycle_history.map(cloneCycle),
    session_report: { ...session.session_report },
  };
}

export function createAutonomousWorkSession(input: CreateAutonomousWorkSessionInput): AutonomousWorkSession {
  const createdAt = normalizeText(input.createdAt) || new Date().toISOString();
  const operatorGoal = normalizeText(input.operatorGoal) || "Untitled operator goal";
  const sessionId = normalizeText(input.sessionId) || buildSessionId(operatorGoal, createdAt);
  const sessionApprovalGranted = input.sessionApproval === true;
  const chainResult = createAutonomousTaskChain({
    originalRequest: operatorGoal,
    interpretedGoal: operatorGoal,
    maxSteps: Math.max(1, input.chainInput?.maxSteps ?? input.maxChainSteps ?? 3),
    riskLevel: input.chainInput?.riskLevel,
    approvalRequired: input.chainInput?.approvalRequired ?? true,
    chainApproval: input.chainInput?.chainApproval ?? sessionApprovalGranted,
    requestedSteps: input.chainInput?.requestedSteps,
    createdAt,
  });
  const checkpoint = createChainCheckpoint(chainResult.chain);
  const memory = createOrchestrationMemory(operatorGoal, createdAt);
  const chainApprovals = cloneChainApprovals(input.chainInput?.approvalRequired === false ? [] : [{
    approval_type: "chain",
    granted_at: chainResult.chain.chain_approval_granted ? createdAt : null,
    expires_at: null,
    requires_reapproval: chainResult.chain.chain_approval_granted !== true,
  }]);
  const persistenceRecord = createChainPersistenceRecord({
    chain: chainResult.chain,
    checkpoint,
    approvalState: chainApprovals,
    updatedAt: createdAt,
  });

  const session: AutonomousWorkSession = {
    session_id: sessionId,
    created_at: createdAt,
    updated_at: createdAt,
    operator_goal: operatorGoal,
    goal_state: memory.goal_state,
    orchestration_memory: memory,
    active_chain: chainResult.chain,
    checkpoints: [checkpoint],
    approval_state: {
      session_approval_granted: sessionApprovalGranted,
      session_approved_at: sessionApprovalGranted ? normalizeText(input.sessionApprovalGrantedAt) || createdAt : null,
      session_approval_expires_at: normalizeText(input.sessionApprovalExpiresAt) || null,
      requires_session_reapproval: !sessionApprovalGranted,
      chain_approvals: chainApprovals,
    },
    current_cycle: null,
    latest_persistence_record: persistenceRecord,
    cycle_history: [],
    max_cycles: clampMaxCycles(input.maxCycles),
    session_report: {
      report_id: buildReportId(sessionId, createdAt),
      created_at: createdAt,
      updated_at: createdAt,
      status: "session_planned",
      cycle_count: 0,
      completed_cycles: 0,
      pause_reason: null,
      completion_reason: null,
      last_checkpoint_id: checkpoint.checkpoint_id,
      summary: `session_planned: 0/0 cycles completed for ${operatorGoal}`,
    },
    status: "session_planned",
  };

  return withUpdatedGoalState(session);
}

export function evaluateWorkSessionReadiness(session: AutonomousWorkSession, now?: string): WorkSessionDecision {
  const currentSession = cloneSession(session);
  const currentTime = normalizeText(now) || new Date().toISOString();
  const goalState = evaluateGoalCompletion(currentSession.orchestration_memory);

  if (goalState.status === "completed") {
    return {
      status: "session_completed",
      can_advance: false,
      blockers: [{
        code: "goal_completed",
        message: goalState.completion_reason ?? "The work session goal is already complete.",
        recommended_action: "complete",
      }],
      orchestration_decision: null,
      explanation: goalState.completion_reason ?? "The work session goal is already complete.",
      recovery_report: null,
    };
  }

  if (currentSession.status === "session_blocked") {
    const blockers = [{
      code: "session_blocked" as const,
      message: currentSession.session_report.pause_reason ?? "This work session is blocked and needs review before continuing.",
      recommended_action: "review" as const,
    }];
    const explanation = currentSession.session_report.pause_reason ?? "This work session is blocked and needs review before continuing.";

    return {
      status: "session_blocked",
      can_advance: false,
      blockers,
      orchestration_decision: null,
      explanation,
      recovery_report: buildWorkSessionRecoveryReport(currentSession, "session_blocked", blockers, explanation),
    };
  }

  if (currentSession.status === "session_paused") {
    const blockers = [{
      code: "session_paused" as const,
      message: currentSession.session_report.pause_reason ?? "This work session is paused and must be resumed explicitly.",
      recommended_action: "resume" as const,
    }];
    const explanation = currentSession.session_report.pause_reason ?? "This work session is paused and must be resumed explicitly.";

    return {
      status: "session_paused",
      can_advance: false,
      blockers,
      orchestration_decision: null,
      explanation,
      recovery_report: buildWorkSessionRecoveryReport(currentSession, "session_paused", blockers, explanation),
    };
  }

  if (!hasFreshSessionApproval(currentSession, currentTime)) {
    const blockers = [{
      code: (currentSession.approval_state.session_approval_granted ? "session_reapproval_required" : "session_approval_required") as const,
      message: currentSession.approval_state.session_approval_granted
        ? "The work session approval is stale and must be renewed before supervised continuation."
        : "Explicit session approval is required before the work session can run.",
      recommended_action: "approve" as const,
    }];
    const explanation = currentSession.approval_state.session_approval_granted
      ? "The work session approval is stale and must be renewed before supervised continuation."
      : "Explicit session approval is required before the work session can run.";

    return {
      status: "awaiting_session_approval",
      can_advance: false,
      blockers,
      orchestration_decision: null,
      explanation,
      recovery_report: buildWorkSessionRecoveryReport(currentSession, "awaiting_session_approval", blockers, explanation),
    };
  }

  if (
    currentSession.latest_persistence_record.validation_snapshot.status === "validation_failed"
    || currentSession.latest_persistence_record.validation_snapshot.status === "validation_blocked"
  ) {
    const blockers = [{
      code: "validation_failed" as const,
      message: "The last persisted validation snapshot failed, so the work session must pause for review.",
      recommended_action: "pause" as const,
    }];
    const explanation = "The last persisted validation snapshot failed, so the work session must pause for review.";

    return {
      status: "session_paused",
      can_advance: false,
      blockers,
      orchestration_decision: null,
      explanation,
      recovery_report: buildWorkSessionRecoveryReport(currentSession, "session_paused", blockers, explanation),
    };
  }

  if (currentSession.latest_persistence_record.validation_snapshot.recommendation === "rollback") {
    const blockers = [{
      code: "rollback_recommended" as const,
      message: "The last persisted validation snapshot recommended rollback, so the work session must pause.",
      recommended_action: "pause" as const,
    }];
    const explanation = "The last persisted validation snapshot recommended rollback, so the work session must pause.";

    return {
      status: "session_paused",
      can_advance: false,
      blockers,
      orchestration_decision: null,
      explanation,
      recovery_report: buildWorkSessionRecoveryReport(currentSession, "session_paused", blockers, explanation),
    };
  }

  if (currentSession.cycle_history.length >= currentSession.max_cycles) {
    const blockers = [{
      code: "cycle_limit_reached" as const,
      message: `The supervised work session reached its bounded max cycle limit of ${currentSession.max_cycles}.`,
      recommended_action: "review" as const,
    }];
    const explanation = `The supervised work session reached its bounded max cycle limit of ${currentSession.max_cycles}.`;

    return {
      status: "session_blocked",
      can_advance: false,
      blockers,
      orchestration_decision: null,
      explanation,
      recovery_report: buildWorkSessionRecoveryReport(currentSession, "session_blocked", blockers, explanation),
    };
  }

  const orchestrationDecision = currentSession.active_chain.status === "chain_completed"
    ? decideAutonomousOrchestration({
      chain: currentSession.active_chain,
      persistenceRecord: currentSession.latest_persistence_record,
      memory: currentSession.orchestration_memory,
      supervisorApproval: true,
      now: currentTime,
    })
    : null;

  if (orchestrationDecision?.status === "orchestration_blocked") {
    const blockers = [{
      code: "orchestration_blocked" as const,
      message: orchestrationDecision.explanation,
      recommended_action: "review" as const,
    }];

    return {
      status: "session_blocked",
      can_advance: false,
      blockers,
      orchestration_decision: orchestrationDecision,
      explanation: orchestrationDecision.explanation,
      recovery_report: buildWorkSessionRecoveryReport(currentSession, "session_blocked", blockers, orchestrationDecision.explanation),
    };
  }

  return {
    status: "session_running",
    can_advance: true,
    blockers: [],
    orchestration_decision: orchestrationDecision,
    explanation: orchestrationDecision?.explanation ?? "The supervised work session is ready to advance one bounded cycle.",
    recovery_report: null,
  };
}

export function pauseWorkSession(session: AutonomousWorkSession, reason: string, occurredAt?: string): AutonomousWorkSession {
  const nextSession = cloneSession(session);
  const updatedAt = normalizeText(occurredAt) || new Date().toISOString();
  const currentCycle = nextSession.current_cycle
    ? {
      ...nextSession.current_cycle,
      ended_at: updatedAt,
      status: "cycle_paused" as const,
    }
    : null;
  const cycleHistory = currentCycle && nextSession.cycle_history.at(-1)?.cycle_id === currentCycle.cycle_id
    ? nextSession.cycle_history.slice(0, -1).concat(currentCycle)
    : nextSession.cycle_history;

  const paused: AutonomousWorkSession = {
    ...nextSession,
    updated_at: updatedAt,
    status: "session_paused",
    current_cycle: currentCycle,
    cycle_history: cycleHistory,
  };

  return {
    ...paused,
    session_report: buildSessionReport(paused, normalizeText(reason) || "Session paused.", paused.session_report.completion_reason),
  };
}

export function completeWorkSession(session: AutonomousWorkSession, occurredAt?: string): AutonomousWorkSession {
  const nextSession = cloneSession(session);
  const updatedAt = normalizeText(occurredAt) || new Date().toISOString();
  const currentCycle = nextSession.current_cycle
    ? {
      ...nextSession.current_cycle,
      ended_at: updatedAt,
      status: "cycle_completed" as const,
    }
    : null;
  const cycleHistory = currentCycle && nextSession.cycle_history.at(-1)?.cycle_id === currentCycle.cycle_id
    ? nextSession.cycle_history.slice(0, -1).concat(currentCycle)
    : nextSession.cycle_history;

  const completed: AutonomousWorkSession = {
    ...nextSession,
    updated_at: updatedAt,
    status: "session_completed",
    current_cycle: currentCycle,
    cycle_history: cycleHistory,
  };
  const completionReason = completed.goal_state.completion_reason ?? "The supervised work session reached a completed goal state.";

  return {
    ...completed,
    session_report: buildSessionReport(completed, null, completionReason),
  };
}

export function advanceWorkSession(
  session: AutonomousWorkSession,
  cycleResult: AdvanceWorkSessionCycleResult,
): AutonomousWorkSession {
  const readiness = evaluateWorkSessionReadiness(session, cycleResult.occurredAt);
  if (!readiness.can_advance) {
    if (readiness.status === "session_blocked") {
      const blocked: AutonomousWorkSession = {
        ...cloneSession(session),
        updated_at: normalizeText(cycleResult.occurredAt) || new Date().toISOString(),
        status: "session_blocked",
      };
      return {
        ...blocked,
        session_report: buildSessionReport(blocked, readiness.explanation, blocked.session_report.completion_reason),
      };
    }

    if (readiness.status === "awaiting_session_approval") {
      const awaitingApproval: AutonomousWorkSession = {
        ...cloneSession(session),
        updated_at: normalizeText(cycleResult.occurredAt) || new Date().toISOString(),
        status: "awaiting_session_approval",
        approval_state: {
          ...session.approval_state,
          requires_session_reapproval: true,
        },
      };
      return {
        ...awaitingApproval,
        session_report: buildSessionReport(awaitingApproval, readiness.explanation, awaitingApproval.session_report.completion_reason),
      };
    }

    return pauseWorkSession(session, readiness.explanation, cycleResult.occurredAt);
  }

  const nextSession = cloneSession(session);
  const updatedAt = normalizeText(cycleResult.occurredAt) || new Date().toISOString();
  const cycleId = normalizeText(cycleResult.cycleId)
    || buildCycleId(nextSession.session_id, updatedAt, nextSession.cycle_history.length + 1);
  const checkpoint = cycleResult.checkpoint ?? createChainCheckpoint(cycleResult.activeChain ?? nextSession.active_chain);
  const activeChain = cycleResult.activeChain ?? nextSession.active_chain;
  const validationStatus = cycleResult.validationStatus ?? nextSession.latest_persistence_record.validation_snapshot.status;
  const validationRecommendation = cycleResult.validationRecommendation ?? nextSession.latest_persistence_record.validation_snapshot.recommendation;
  const approvals = cloneChainApprovals(cycleResult.approvalState ?? nextSession.approval_state.chain_approvals);
  const proposedSteps = cycleResult.proposedSteps ?? readiness.orchestration_decision?.plan.proposed_steps.map((step) => ({
    title: step.title,
    rationale: step.rationale,
    stepId: step.step_id,
  })) ?? [];
  const completedSteps = cycleResult.completedSteps ?? [];

  let memory = nextSession.orchestration_memory;
  for (const proposedStep of proposedSteps) {
    memory = updateOrchestrationMemory(memory, {
      kind: "proposed",
      title: proposedStep.title,
      rationale: proposedStep.rationale ?? null,
      step_id: proposedStep.stepId ?? null,
      occurred_at: updatedAt,
      cycle_id: cycleId,
    });
  }
  for (const completedStep of completedSteps) {
    memory = updateOrchestrationMemory(memory, {
      kind: "completed",
      title: completedStep.title,
      rationale: completedStep.rationale ?? null,
      step_id: completedStep.stepId ?? null,
      occurred_at: updatedAt,
      cycle_id: cycleId,
      marks_goal_complete: completedStep.marksGoalComplete === true || cycleResult.marksGoalComplete === true,
    });
  }

  const cycle: WorkSessionCycle = {
    cycle_id: cycleId,
    started_at: updatedAt,
    ended_at: updatedAt,
    status: cycleResult.requiresApproval || validationStatus === "validation_failed" || validationRecommendation === "rollback"
      ? "cycle_paused"
      : "cycle_completed",
    summary: normalizeText(cycleResult.summary) || `Advanced supervised work session cycle ${nextSession.cycle_history.length + 1}.`,
    resumed_from_checkpoint_id: nextSession.current_cycle?.resumed_from_checkpoint_id ?? nextSession.checkpoints.at(-1)?.checkpoint_id ?? null,
    proposed_step_titles: proposedSteps.map((step) => step.title),
    completed_step_titles: completedSteps.map((step) => step.title),
    validation_status: validationStatus,
    validation_recommendation: validationRecommendation,
    approvals_needed: cycleResult.requiresApproval === true,
    rollback_recommended: cycleResult.rollbackRecommended === true || validationRecommendation === "rollback",
  };

  const persistenceRecord = createChainPersistenceRecord({
    chain: activeChain,
    checkpoint,
    approvalState: approvals,
    validationSnapshot: {
      status: validationStatus,
      recommendation: validationRecommendation,
      validated_at: updatedAt,
    },
    updatedAt,
  });

  const progressed: AutonomousWorkSession = withUpdatedGoalState({
    ...nextSession,
    updated_at: updatedAt,
    orchestration_memory: memory,
    active_chain: activeChain,
    checkpoints: [...nextSession.checkpoints, checkpoint],
    approval_state: {
      ...nextSession.approval_state,
      chain_approvals: approvals,
    },
    current_cycle: cycle,
    latest_persistence_record: persistenceRecord,
    cycle_history: [...nextSession.cycle_history, cycle],
    status: "session_running",
  });

  if (progressed.cycle_history.length > progressed.max_cycles) {
    const blocked: AutonomousWorkSession = {
      ...progressed,
      status: "session_blocked",
    };
    return {
      ...blocked,
      session_report: buildSessionReport(blocked, `Cycle limit ${progressed.max_cycles} reached.`, blocked.session_report.completion_reason),
    };
  }

  if (cycle.approvals_needed) {
    return pauseWorkSession(progressed, "Approval is required before the next supervised session cycle can continue.", updatedAt);
  }

  if (cycle.rollback_recommended || validationStatus === "validation_failed" || validationStatus === "validation_blocked") {
    return pauseWorkSession(progressed, "Validation failure or rollback recommendation paused the supervised work session.", updatedAt);
  }

  if (progressed.goal_state.status === "completed") {
    return completeWorkSession(progressed, updatedAt);
  }

  const running: AutonomousWorkSession = {
    ...progressed,
    status: "session_running",
  };
  return {
    ...running,
    session_report: buildSessionReport(running, null, running.session_report.completion_reason),
  };
}

export function resumeWorkSession(session: AutonomousWorkSession, resumedAt?: string): AutonomousWorkSession {
  const nextSession = cloneSession(session);
  const updatedAt = normalizeText(resumedAt) || new Date().toISOString();
  const latestCheckpoint = nextSession.checkpoints.at(-1) ?? null;
  const recovery = evaluateRecoveryEligibility(nextSession.active_chain, latestCheckpoint);

  if (recovery.status !== "recoverable") {
    const blocked: AutonomousWorkSession = {
      ...nextSession,
      updated_at: updatedAt,
      status: recovery.status === "awaiting_reapproval" ? "awaiting_session_approval" : "session_blocked",
    };
    return {
      ...blocked,
      session_report: buildSessionReport(blocked, recovery.explanation, blocked.session_report.completion_reason),
    };
  }

  if (!hasFreshSessionApproval(nextSession, updatedAt)) {
    const approvalPaused: AutonomousWorkSession = {
      ...nextSession,
      updated_at: updatedAt,
      status: "awaiting_session_approval",
      approval_state: {
        ...nextSession.approval_state,
        requires_session_reapproval: true,
      },
    };
    return {
      ...approvalPaused,
      session_report: buildSessionReport(
        approvalPaused,
        "Session approval must be renewed before a paused work session can resume.",
        approvalPaused.session_report.completion_reason,
      ),
    };
  }

  const resumedCycle: WorkSessionCycle = {
    cycle_id: buildCycleId(nextSession.session_id, updatedAt, nextSession.cycle_history.length + 1),
    started_at: updatedAt,
    ended_at: null,
    status: "cycle_running",
    summary: "Resumed from the latest supervised checkpoint.",
    resumed_from_checkpoint_id: latestCheckpoint?.checkpoint_id ?? null,
    proposed_step_titles: [],
    completed_step_titles: [],
    validation_status: nextSession.latest_persistence_record.validation_snapshot.status,
    validation_recommendation: nextSession.latest_persistence_record.validation_snapshot.recommendation,
    approvals_needed: false,
    rollback_recommended: false,
  };

  const resumed: AutonomousWorkSession = {
    ...nextSession,
    updated_at: updatedAt,
    status: "session_running",
    current_cycle: resumedCycle,
  };

  return {
    ...resumed,
    session_report: buildSessionReport(resumed, null, resumed.session_report.completion_reason),
  };
}

export function summarizeWorkSession(session: AutonomousWorkSession): string {
  const latestCheckpoint = session.checkpoints.at(-1);
  return [
    `Session: ${session.session_id}`,
    `Status: ${session.status}`,
    `Goal: ${session.operator_goal}`,
    `Goal summary: ${summarizeGoalState(session.orchestration_memory).replace(/\n/g, " | ")}`,
    `Cycles: ${session.cycle_history.length}/${session.max_cycles}`,
    `Active chain status: ${session.active_chain.status}`,
    `Session approval: ${session.approval_state.session_approval_granted ? "granted" : "pending"}`,
    `Latest checkpoint: ${latestCheckpoint?.checkpoint_id ?? "none"}`,
    `Report: ${session.session_report.summary}`,
  ].join("\n");
}