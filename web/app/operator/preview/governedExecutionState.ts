export type GovernedExecutionPhase =
  | "IDLE"
  | "REQUEST_ACCEPTED"
  | "VALIDATING"
  | "WAITING_FOR_APPROVAL"
  | "MICRO_SEQUENCE_RUNNING"
  | "PREVIEW_RENDER_RUNNING"
  | "GIF_PACKAGING"
  | "EXPORTING_OUTPUTS"
  | "RENDER_COMPLETE"
  | "RENDER_FAILED"
  | "RENDER_REJECTED"
  | "ROLLBACK_RESTORING";

export type GovernedExecutionAction = "micro-sequence" | "preview" | "anime-character-render" | "rollback";

export type GovernedExecutionTimelineStatus = "waiting" | "active" | "complete" | "failed" | "blocked";

export type GovernedExecutionTimelineItem = {
  id: string;
  label: string;
  status: GovernedExecutionTimelineStatus;
  detail: string;
};

export type GovernedExecutionState = {
  currentPhase: GovernedExecutionPhase;
  activeAction: GovernedExecutionAction | null;
  activeRequestId: string | null;
  executionStartedAt: number | null;
  executionFinishedAt: number | null;
  renderInProgress: boolean;
  microSequenceInProgress: boolean;
  previewInProgress: boolean;
  gifPackagingInProgress: boolean;
  exportInProgress: boolean;
  rollbackInProgress: boolean;
  renderCompleted: boolean;
  renderFailed: boolean;
  renderRejected: boolean;
  waitingForApproval: boolean;
  failureReason: string | null;
  exportedArtifactPaths: string[];
  sandboxPath: string | null;
  gifArtifactPath: string | null;
  diagnosticsGenerated: boolean;
  duplicateClickBlocked: boolean;
  statusMessage: string;
  nextActionRecommendation: string;
  phaseHistory: GovernedExecutionPhase[];
};

export type GovernedExecutionStartInput = {
  action: GovernedExecutionAction;
  requestId: string;
  startedAt: number;
  manualApprovalGranted: boolean;
  gifPackagingRequested?: boolean;
};

export type GovernedExecutionCompletionInput = {
  finishedAt: number;
  status: "complete" | "failed" | "rejected";
  failureReason?: string | null;
  exportedArtifactPaths?: string[];
  sandboxPath?: string | null;
  diagnosticsGenerated?: boolean;
  gifPackagingRequested?: boolean;
};

export type GovernedExecutionTimelineFacts = {
  outputReviewed: boolean;
  diagnosticsReviewed: boolean;
  truthChecksPassed: boolean;
  finalVerdictReady: boolean;
};

export const INITIAL_GOVERNED_EXECUTION_STATE: GovernedExecutionState = {
  currentPhase: "IDLE",
  activeAction: null,
  activeRequestId: null,
  executionStartedAt: null,
  executionFinishedAt: null,
  renderInProgress: false,
  microSequenceInProgress: false,
  previewInProgress: false,
  gifPackagingInProgress: false,
  exportInProgress: false,
  rollbackInProgress: false,
  renderCompleted: false,
  renderFailed: false,
  renderRejected: false,
  waitingForApproval: false,
  failureReason: null,
  exportedArtifactPaths: [],
  sandboxPath: null,
  gifArtifactPath: null,
  diagnosticsGenerated: false,
  duplicateClickBlocked: false,
  statusMessage: "Idle. No governed execution is running.",
  nextActionRecommendation: "Fill the request form, grant manual approval, then run the micro-sequence first.",
  phaseHistory: ["IDLE"],
};

const ACTIVE_PHASES: GovernedExecutionPhase[] = [
  "REQUEST_ACCEPTED",
  "VALIDATING",
  "WAITING_FOR_APPROVAL",
  "MICRO_SEQUENCE_RUNNING",
  "PREVIEW_RENDER_RUNNING",
  "GIF_PACKAGING",
  "EXPORTING_OUTPUTS",
  "ROLLBACK_RESTORING",
];

const PHASE_LABELS: Record<GovernedExecutionPhase, string> = {
  IDLE: "Idle",
  REQUEST_ACCEPTED: "Request accepted",
  VALIDATING: "Validating bounded preview request",
  WAITING_FOR_APPROVAL: "Waiting for manual approval",
  MICRO_SEQUENCE_RUNNING: "Running micro-sequence",
  PREVIEW_RENDER_RUNNING: "Rendering governed preview",
  GIF_PACKAGING: "Packaging governed GIF",
  EXPORTING_OUTPUTS: "Exporting outputs",
  RENDER_COMPLETE: "Render complete",
  RENDER_FAILED: "Render failed",
  RENDER_REJECTED: "Governance rejected request",
  ROLLBACK_RESTORING: "Rollback restoring sandbox",
};

export function isGovernedExecutionLocked(state: GovernedExecutionState): boolean {
  return state.renderInProgress || ACTIVE_PHASES.includes(state.currentPhase);
}

export function getGovernedExecutionPhaseLabel(phase: GovernedExecutionPhase): string {
  return PHASE_LABELS[phase];
}

export function getGovernedExecutionPhaseTone(phase: GovernedExecutionPhase): "ok" | "warn" | "blocked" | "default" {
  if (phase === "RENDER_COMPLETE") {
    return "ok";
  }
  if (phase === "RENDER_FAILED" || phase === "RENDER_REJECTED") {
    return "blocked";
  }
  if (phase === "IDLE") {
    return "default";
  }
  return "warn";
}

export function extractGifArtifactPath(paths: string[]): string | null {
  return paths.find((path) => path.toLowerCase().endsWith(".gif")) ?? null;
}

function addPhase(state: GovernedExecutionState, phase: GovernedExecutionPhase): GovernedExecutionPhase[] {
  return state.phaseHistory.at(-1) === phase ? state.phaseHistory : [...state.phaseHistory, phase];
}

function actionLabel(action: GovernedExecutionAction): string {
  return action === "micro-sequence"
    ? "micro-sequence"
    : action === "preview"
      ? "preview render"
      : action === "anime-character-render"
        ? "anime character render"
        : "rollback";
}

export function startGovernedExecution(state: GovernedExecutionState, input: GovernedExecutionStartInput): { state: GovernedExecutionState; started: boolean; reason: string } {
  if (isGovernedExecutionLocked(state)) {
    return {
      state: {
        ...state,
        duplicateClickBlocked: true,
        statusMessage: "Execution already in progress. Wait for the active governed run to complete before starting another.",
        nextActionRecommendation: "Do not click again; monitor the execution status timeline.",
      },
      started: false,
      reason: "Execution already in progress.",
    };
  }

  const currentPhase: GovernedExecutionPhase = input.manualApprovalGranted ? "REQUEST_ACCEPTED" : "WAITING_FOR_APPROVAL";
  const nextState: GovernedExecutionState = {
    ...INITIAL_GOVERNED_EXECUTION_STATE,
    currentPhase,
    activeAction: input.action,
    activeRequestId: input.requestId,
    executionStartedAt: input.startedAt,
    renderInProgress: true,
    microSequenceInProgress: input.action === "micro-sequence",
    previewInProgress: input.action === "preview" || input.action === "anime-character-render",
    rollbackInProgress: input.action === "rollback",
    waitingForApproval: !input.manualApprovalGranted,
    gifPackagingInProgress: false,
    exportInProgress: false,
    statusMessage: input.manualApprovalGranted
      ? `Accepted governed ${actionLabel(input.action)} request. Validation is starting.`
      : `Governed ${actionLabel(input.action)} is waiting on manual approval before rendering can proceed.`,
    nextActionRecommendation: input.manualApprovalGranted
      ? "Watch the active phase indicator; execution controls are locked until this run finishes."
      : "Grant manual approval, then rerun the bounded request.",
    phaseHistory: [currentPhase],
  };

  return { state: nextState, started: true, reason: nextState.statusMessage };
}

export function advanceGovernedExecutionPhase(state: GovernedExecutionState, phase: GovernedExecutionPhase): GovernedExecutionState {
  if (!isGovernedExecutionLocked(state) && phase !== "IDLE") {
    return state;
  }

  return {
    ...state,
    currentPhase: phase,
    waitingForApproval: phase === "WAITING_FOR_APPROVAL",
    gifPackagingInProgress: phase === "GIF_PACKAGING",
    exportInProgress: phase === "EXPORTING_OUTPUTS",
    rollbackInProgress: phase === "ROLLBACK_RESTORING",
    statusMessage: PHASE_LABELS[phase],
    nextActionRecommendation: phase === "EXPORTING_OUTPUTS"
      ? "Wait for exported artifact paths before visual review."
      : phase === "GIF_PACKAGING"
        ? "Wait for GIF packaging to finish before inspecting outputs."
        : "Execution controls remain locked while this phase is active.",
    phaseHistory: addPhase(state, phase),
  };
}

export function completeGovernedExecution(state: GovernedExecutionState, input: GovernedExecutionCompletionInput): GovernedExecutionState {
  const exportedArtifactPaths = input.exportedArtifactPaths ?? [];
  const gifArtifactPath = extractGifArtifactPath(exportedArtifactPaths);
  const currentPhase: GovernedExecutionPhase = input.status === "complete"
    ? "RENDER_COMPLETE"
    : input.status === "rejected"
      ? "RENDER_REJECTED"
      : "RENDER_FAILED";
  const failureReason = input.failureReason ?? null;

  return {
    ...state,
    currentPhase,
    executionFinishedAt: input.finishedAt,
    renderInProgress: false,
    microSequenceInProgress: false,
    previewInProgress: false,
    gifPackagingInProgress: false,
    exportInProgress: false,
    rollbackInProgress: false,
    renderCompleted: input.status === "complete",
    renderFailed: input.status === "failed",
    renderRejected: input.status === "rejected",
    waitingForApproval: false,
    failureReason,
    exportedArtifactPaths,
    sandboxPath: input.sandboxPath ?? state.sandboxPath,
    gifArtifactPath,
    diagnosticsGenerated: input.diagnosticsGenerated === true,
    statusMessage: input.status === "complete"
      ? "Export complete. Outputs are ready for visual review."
      : input.status === "rejected"
        ? `Governance rejected request${failureReason ? `: ${failureReason}` : "."}`
        : `Render failed${failureReason ? `: ${failureReason}` : "."}`,
    nextActionRecommendation: input.status === "complete"
      ? "Open the exported PNG/GIF artifacts, review diagnostics, then set the final operator verdict."
      : input.status === "rejected"
        ? "Resolve the governance blocker, confirm approval, then rerun the bounded request."
        : "Inspect the failure reason and rollback state before rerunning.",
    phaseHistory: addPhase(state, currentPhase),
  };
}

export function completeGovernedRollback(state: GovernedExecutionState, input: { finishedAt: number; deletedOutputTargets: string[]; sandboxPath: string | null }): GovernedExecutionState {
  return {
    ...state,
    currentPhase: "RENDER_COMPLETE",
    executionFinishedAt: input.finishedAt,
    renderInProgress: false,
    microSequenceInProgress: false,
    previewInProgress: false,
    gifPackagingInProgress: false,
    exportInProgress: false,
    rollbackInProgress: false,
    renderCompleted: true,
    renderFailed: false,
    renderRejected: false,
    exportedArtifactPaths: input.deletedOutputTargets,
    sandboxPath: input.sandboxPath,
    statusMessage: input.deletedOutputTargets.length
      ? "Rollback complete. Sandbox outputs were removed."
      : "Rollback complete. No governed preview outputs were present.",
    nextActionRecommendation: "Generate a new governed micro-sequence before starting another preview run.",
    phaseHistory: addPhase(state, "RENDER_COMPLETE"),
  };
}

export function failGovernedExecution(state: GovernedExecutionState, input: { finishedAt: number; failureReason: string }): GovernedExecutionState {
  return completeGovernedExecution(state, {
    finishedAt: input.finishedAt,
    status: "failed",
    failureReason: input.failureReason,
    exportedArtifactPaths: [],
    diagnosticsGenerated: false,
  });
}

export function buildGovernedExecutionTimeline(state: GovernedExecutionState, facts: GovernedExecutionTimelineFacts): GovernedExecutionTimelineItem[] {
  const requestAccepted = state.phaseHistory.includes("REQUEST_ACCEPTED") || state.renderCompleted;
  const validationStarted = state.phaseHistory.includes("VALIDATING") || state.renderCompleted || state.renderRejected || state.renderFailed;
  const renderStarted = state.phaseHistory.some((phase) => phase === "MICRO_SEQUENCE_RUNNING" || phase === "PREVIEW_RENDER_RUNNING");
  const gifRequested = state.phaseHistory.includes("GIF_PACKAGING") || Boolean(state.gifArtifactPath);
  const exportStarted = state.phaseHistory.includes("EXPORTING_OUTPUTS") || state.exportedArtifactPaths.length > 0;

  return [
    {
      id: "request-accepted",
      label: "Request accepted",
      status: state.renderRejected && !requestAccepted ? "blocked" : requestAccepted ? "complete" : state.currentPhase === "WAITING_FOR_APPROVAL" ? "blocked" : "waiting",
      detail: state.activeRequestId ?? "No active request yet.",
    },
    {
      id: "validation",
      label: "Validation passed",
      status: state.currentPhase === "VALIDATING" ? "active" : state.renderRejected ? "blocked" : validationStarted ? "complete" : "waiting",
      detail: state.renderRejected ? state.failureReason ?? "Governance blocked execution." : "Bounded request, approval, and prerequisites checked.",
    },
    {
      id: "render-started",
      label: state.activeAction === "micro-sequence" ? "Micro-sequence started" : "Preview render started",
      status: state.currentPhase === "MICRO_SEQUENCE_RUNNING" || state.currentPhase === "PREVIEW_RENDER_RUNNING" ? "active" : state.renderFailed ? "failed" : renderStarted || state.renderCompleted ? "complete" : "waiting",
      detail: state.activeAction ? `Active mode: ${actionLabel(state.activeAction)}.` : "No render has started.",
    },
    {
      id: "gif-packaging",
      label: "GIF packaging complete",
      status: state.currentPhase === "GIF_PACKAGING" ? "active" : state.gifArtifactPath ? "complete" : gifRequested ? "waiting" : "waiting",
      detail: state.gifArtifactPath ?? "No GIF artifact exported yet.",
    },
    {
      id: "export-complete",
      label: "Output export complete",
      status: state.currentPhase === "EXPORTING_OUTPUTS" ? "active" : state.exportedArtifactPaths.length > 0 ? "complete" : state.renderFailed ? "failed" : exportStarted ? "waiting" : "waiting",
      detail: state.exportedArtifactPaths.length ? `${state.exportedArtifactPaths.length} artifact(s) recorded.` : "Waiting for exported PNG/GIF paths.",
    },
    {
      id: "visual-review",
      label: "Awaiting visual review",
      status: facts.outputReviewed ? "complete" : state.renderCompleted ? "active" : "waiting",
      detail: facts.outputReviewed ? "Operator marked visual output reviewed." : "Inspect actual PNG/GIF output before final verdict.",
    },
    {
      id: "diagnostics-review",
      label: "Awaiting diagnostics review",
      status: facts.diagnosticsReviewed && facts.truthChecksPassed ? "complete" : state.renderCompleted ? "active" : "waiting",
      detail: facts.diagnosticsReviewed ? "Diagnostics were reviewed." : "Review truth checks, fallback dominance, diagnostics, and rollback state.",
    },
    {
      id: "final-verdict",
      label: "Awaiting final operator verdict",
      status: facts.finalVerdictReady ? "complete" : "waiting",
      detail: facts.finalVerdictReady ? "Final verdict gates are satisfied." : "PASS remains unavailable until visual and diagnostics review gates are satisfied.",
    },
  ];
}
