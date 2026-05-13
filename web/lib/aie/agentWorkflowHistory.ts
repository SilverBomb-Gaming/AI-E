import {
  buildEliteAgentBlockedWorkflowRecoveryGuidance,
  resumeEliteAgentWorkflow,
  summarizeEliteAgentWorkflow,
  type EliteAgentWorkflowApprovalState,
  type EliteAgentWorkflowSession,
  type EliteAgentWorkflowSessionStatus,
  type EliteAgentWorkflowStageType,
  type EliteAgentWorkflowSummary,
  type EliteAgentWorkflowValidationState,
} from "./eliteAgentWorkflowEngine";

export type AgentWorkflowOutcome = "completed" | "blocked" | "failed" | "paused" | "interrupted" | "resumable" | "running" | "pending" | "rollback_available";

export type AgentWorkflowHistoryEntry = {
  historyId: string;
  workflowSessionId: string;
  agentId: string;
  prompt: string;
  purpose: string;
  status: EliteAgentWorkflowSessionStatus;
  outcome: AgentWorkflowOutcome;
  createdAt: string;
  updatedAt: string;
  lastEventAt: string;
  stagesCompleted: number;
  totalStages: number;
  currentStage: EliteAgentWorkflowStageType | null;
  blockedStages: Array<{ stageId: string; stageType: EliteAgentWorkflowStageType; reason: string }>;
  validationResults: Array<{ stageId: string; stageType: EliteAgentWorkflowStageType; validationState: EliteAgentWorkflowValidationState }>;
  approvalCheckpoints: Array<{ stageId: string; stageType: EliteAgentWorkflowStageType; approvalState: EliteAgentWorkflowApprovalState }>;
  rollbackAvailable: boolean;
  rollbackPrepared: boolean;
  rollbackReason: string | null;
  resumeEligible: boolean;
  resumeFromStageId: string | null;
  resumeReason: string | null;
  remainingSteps: EliteAgentWorkflowStageType[];
  summary: AgentWorkflowOperationalSummary;
  session: EliteAgentWorkflowSession;
};

export type AgentWorkflowOperationalSummary = {
  workflowPurpose: string;
  stagesCompleted: string;
  blockedStages: string;
  validationResults: string;
  approvalsReceived: string;
  rollbackAvailability: string;
  remainingSteps: string;
  resumeGuidance: string;
  truthfulContinuityBoundary: string;
};

export type AgentWorkflowHistoryStore = {
  entries: AgentWorkflowHistoryEntry[];
};

export type AgentWorkflowResumeDecision = {
  workflowSessionId: string | null;
  allowed: boolean;
  reason: string;
  resumeFromStage: EliteAgentWorkflowStageType | null;
  resumedSession?: EliteAgentWorkflowSession;
  summary?: AgentWorkflowOperationalSummary;
};

const TRUTHFUL_CONTINUITY_BOUNDARY = "AI-E workflow history provides supervised operational continuity for recorded workflow sessions. It does not provide unrestricted memory, autonomous repo ownership, or unattended recursive execution.";

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function historyIdFor(session: EliteAgentWorkflowSession): string {
  return `history-${session.workflowSessionId}`;
}

function outcomeForStatus(status: EliteAgentWorkflowSessionStatus): AgentWorkflowOutcome {
  if (status === "COMPLETED") {
    return "completed";
  }
  if (status === "BLOCKED") {
    return "blocked";
  }
  if (status === "FAILED") {
    return "failed";
  }
  if (status === "PAUSED") {
    return "paused";
  }
  if (status === "INTERRUPTED") {
    return "interrupted";
  }
  if (status === "RESUMABLE") {
    return "resumable";
  }
  if (status === "ROLLBACK_AVAILABLE") {
    return "rollback_available";
  }
  if (status === "RUNNING" || status === "PARTIALLY_COMPLETED") {
    return "running";
  }
  return "pending";
}

function summarizeList(values: string[], empty: string): string {
  return values.length > 0 ? values.join("; ") : empty;
}

function buildOperationalSummary(session: EliteAgentWorkflowSession, summary: EliteAgentWorkflowSummary): AgentWorkflowOperationalSummary {
  const blockedStages = session.stages
    .filter((stage) => stage.blockedReason)
    .map((stage) => `${stage.type}: ${stage.blockedReason}`);
  const validationResults = summary.validationCheckpoints.map((checkpoint) => `${checkpoint.stageType}: ${checkpoint.validationState}`);
  const approvals = summary.approvalCheckpoints.map((checkpoint) => `${checkpoint.stageType}: ${checkpoint.approvalState}`);
  const recoveryGuidance = buildEliteAgentBlockedWorkflowRecoveryGuidance(session);
  const remainingSteps = session.stages
    .filter((stage) => stage.lifecycleState !== "COMPLETED")
    .map((stage) => stage.type);

  return {
    workflowPurpose: session.prompt,
    stagesCompleted: `${summary.completedStageCount} of ${session.stages.length} stages completed`,
    blockedStages: summarizeList(blockedStages, "No blocked stages recorded."),
    validationResults: summarizeList(validationResults, "No validation checkpoints recorded."),
    approvalsReceived: summarizeList(approvals, "No approval checkpoints recorded."),
    rollbackAvailability: summary.rollbackAvailable || summary.rollbackPrepared
      ? `Rollback preparation is ${summary.rollbackPrepared ? "prepared" : "available"}${summary.rollbackReason ? `: ${summary.rollbackReason}` : "."}`
      : "Rollback preparation is not available for the current workflow state.",
    remainingSteps: summarizeList(remainingSteps, "No remaining steps."),
    resumeGuidance: summary.resumeEligible && summary.resumeFromStage
      ? `This workflow can be resumed from the ${summary.resumeFromStage} stage.`
      : session.status === "BLOCKED"
        ? `This workflow remains blocked until the recorded blocker is resolved. Suggested recovery: ${recoveryGuidance?.suggestedRecovery ?? "Prepare a safe patch workflow or request approval."}`
        : session.status === "INTERRUPTED"
          ? "This workflow was interrupted and requires operator review before it can become resumable."
          : "This workflow is not currently resumable.",
    truthfulContinuityBoundary: TRUTHFUL_CONTINUITY_BOUNDARY,
  };
}

export function createAgentWorkflowHistoryStore(entries: AgentWorkflowHistoryEntry[] = []): AgentWorkflowHistoryStore {
  return { entries: [...entries] };
}

export function recordAgentWorkflowHistory(store: AgentWorkflowHistoryStore, session: EliteAgentWorkflowSession, params?: {
  now?: string;
  purpose?: string;
}): AgentWorkflowHistoryStore {
  const now = normalizeText(params?.now) || new Date().toISOString();
  const workflowSummary = summarizeEliteAgentWorkflow(session);
  const operationalSummary = buildOperationalSummary(session, workflowSummary);
  const existing = store.entries.find((entry) => entry.workflowSessionId === session.workflowSessionId);
  const currentStage = session.stages.find((stage) => stage.stageId === session.currentStageId) ?? null;
  const blockedStages = session.stages
    .filter((stage) => stage.blockedReason)
    .map((stage) => ({ stageId: stage.stageId, stageType: stage.type, reason: stage.blockedReason ?? "Blocked without a recorded reason." }));
  const remainingSteps = session.stages
    .filter((stage) => stage.lifecycleState !== "COMPLETED")
    .map((stage) => stage.type);

  const entry: AgentWorkflowHistoryEntry = {
    historyId: existing?.historyId ?? historyIdFor(session),
    workflowSessionId: session.workflowSessionId,
    agentId: session.agentId,
    prompt: session.prompt,
    purpose: normalizeText(params?.purpose) || session.prompt,
    status: session.status,
    outcome: outcomeForStatus(session.status),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastEventAt: session.logs[session.logs.length - 1]?.at ?? now,
    stagesCompleted: session.completedStageCount,
    totalStages: session.stages.length,
    currentStage: currentStage?.type ?? null,
    blockedStages,
    validationResults: workflowSummary.validationCheckpoints,
    approvalCheckpoints: workflowSummary.approvalCheckpoints,
    rollbackAvailable: session.rollbackAvailable,
    rollbackPrepared: session.rollbackPrepared,
    rollbackReason: session.rollbackReason,
    resumeEligible: session.resumeEligible,
    resumeFromStageId: session.resumeFromStageId,
    resumeReason: session.resumeReason,
    remainingSteps,
    summary: operationalSummary,
    session,
  };

  const nextEntries = existing
    ? store.entries.map((candidate) => candidate.workflowSessionId === session.workflowSessionId ? entry : candidate)
    : [entry, ...store.entries];
  return { entries: nextEntries };
}

export function summarizeAgentWorkflowHistory(entry: AgentWorkflowHistoryEntry): AgentWorkflowOperationalSummary {
  return entry.summary;
}

export function listRecentAgentWorkflows(store: AgentWorkflowHistoryStore, limit = 5): AgentWorkflowHistoryEntry[] {
  return [...store.entries]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, Math.max(1, limit));
}

export function listFailedAgentWorkflows(store: AgentWorkflowHistoryStore): AgentWorkflowHistoryEntry[] {
  return store.entries.filter((entry) => entry.outcome === "failed" || entry.outcome === "blocked" || entry.outcome === "rollback_available");
}

export function listResumableAgentWorkflows(store: AgentWorkflowHistoryStore): AgentWorkflowHistoryEntry[] {
  return store.entries.filter((entry) => entry.resumeEligible || entry.outcome === "paused" || entry.outcome === "resumable");
}

export function findAgentWorkflowForResume(store: AgentWorkflowHistoryStore, query: string): AgentWorkflowHistoryEntry | null {
  const normalizedQuery = normalizeText(query).toLowerCase();
  const candidates = listResumableAgentWorkflows(store);
  if (/last failed|failed workflow|blocked validation/.test(normalizedQuery)) {
    return listFailedAgentWorkflows(store)[0] ?? null;
  }
  const matchesQuery = (entry: AgentWorkflowHistoryEntry) => {
    const haystack = `${entry.prompt} ${entry.purpose} ${entry.workflowSessionId}`.toLowerCase();
    return normalizedQuery.split(/\s+/).filter(Boolean).some((token) => haystack.includes(token));
  };
  return candidates.find(matchesQuery) ?? candidates[0] ?? store.entries.find(matchesQuery) ?? null;
}

export function planAgentWorkflowResume(store: AgentWorkflowHistoryStore, query: string): AgentWorkflowResumeDecision {
  const entry = findAgentWorkflowForResume(store, query);
  if (!entry) {
    return {
      workflowSessionId: null,
      allowed: false,
      reason: "No matching workflow history entry is available for resume.",
      resumeFromStage: null,
    };
  }
  const stage = entry.session.stages.find((candidate) => candidate.stageId === entry.resumeFromStageId) ?? null;
  if (!entry.resumeEligible || !stage) {
    return {
      workflowSessionId: entry.workflowSessionId,
      allowed: false,
      reason: entry.blockedStages[0]?.reason ?? "Workflow history was found, but the workflow is not currently resumable.",
      resumeFromStage: stage?.type ?? null,
      summary: entry.summary,
    };
  }
  return {
    workflowSessionId: entry.workflowSessionId,
    allowed: true,
    reason: entry.resumeReason ?? `Workflow can resume from ${stage.type}.`,
    resumeFromStage: stage.type,
    summary: entry.summary,
  };
}

export function resumeAgentWorkflowFromHistory(store: AgentWorkflowHistoryStore, query: string, params?: { now?: string }): {
  store: AgentWorkflowHistoryStore;
  decision: AgentWorkflowResumeDecision;
} {
  const decision = planAgentWorkflowResume(store, query);
  if (!decision.allowed || !decision.workflowSessionId) {
    return { store, decision };
  }
  const entry = store.entries.find((candidate) => candidate.workflowSessionId === decision.workflowSessionId);
  if (!entry) {
    return {
      store,
      decision: {
        workflowSessionId: decision.workflowSessionId,
        allowed: false,
        reason: "Workflow history entry disappeared before resume could be planned.",
        resumeFromStage: null,
      },
    };
  }
  const resumedSession = resumeEliteAgentWorkflow(entry.session, {
    now: params?.now,
    reason: "Workflow resumed from execution history under supervised continuity rules.",
  });
  const nextStore = recordAgentWorkflowHistory(store, resumedSession, { now: params?.now, purpose: entry.purpose });
  return {
    store: nextStore,
    decision: {
      ...decision,
      resumedSession,
      summary: nextStore.entries.find((candidate) => candidate.workflowSessionId === resumedSession.workflowSessionId)?.summary,
    },
  };
}
