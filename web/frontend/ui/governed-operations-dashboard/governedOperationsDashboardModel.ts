import type {
  GovernedLaneState,
  GovernedOperationLane,
  GovernedOperationQueue,
  GovernedOperationQueueSnapshot,
  GovernedRuntimeType,
} from "@/lib/aie/governedOperationLane";
import {
  snapshotGovernedOperationQueue,
} from "@/lib/aie/governedOperationLane";

// ---- Lane state display labels and semantic classes ----

export type LaneStateDisplayVariant = "neutral" | "active" | "pending" | "success" | "blocked" | "denied";

export type LaneStateDisplay = {
  label: string;
  variant: LaneStateDisplayVariant;
  description: string;
};

const LANE_STATE_DISPLAY: Record<GovernedLaneState, LaneStateDisplay> = {
  planned:          { label: "Planned",          variant: "neutral",  description: "Operation is queued but governance validation has not started." },
  validating:       { label: "Validating",       variant: "active",   description: "Governance is actively validating commands and sandbox scope." },
  approval_pending: { label: "Approval Pending", variant: "pending",  description: "Validation complete. Awaiting human operator approval." },
  ready:            { label: "Ready",            variant: "success",  description: "Approved by operator. Execution boundary has not been crossed." },
  blocked:          { label: "Blocked",          variant: "blocked",  description: "Validation or policy check blocked this lane. Recovery may be possible." },
  denied:           { label: "Denied",           variant: "denied",   description: "Governance denied this operation. No further transitions are permitted." },
  verified:         { label: "Verified",         variant: "success",  description: "Operation outcomes verified against pre-execution snapshot." },
  completed:        { label: "Completed",        variant: "neutral",  description: "Governance lifecycle for this lane is complete." },
};

// ---- Runtime type display labels ----

export type RuntimeTypeDisplay = {
  label: string;
  shortLabel: string;
  domain: string;
};

const RUNTIME_TYPE_DISPLAY: Record<GovernedRuntimeType, RuntimeTypeDisplay> = {
  openclaw:    { label: "OpenClaw",    shortLabel: "OC",  domain: "Game Development" },
  claude_code: { label: "Claude Code", shortLabel: "CC",  domain: "Code Review / Refactor" },
  codex:       { label: "Codex",       shortLabel: "CX",  domain: "Testing / Implementation" },
  copilot:     { label: "Copilot",     shortLabel: "CP",  domain: "Completion / Suggestion" },
  human:       { label: "Human",       shortLabel: "HU",  domain: "Manual Review" },
  unknown:     { label: "Unknown",     shortLabel: "??",  domain: "Unassigned" },
};

// ---- Approval and verification display ----

export type ApprovalStateDisplay = {
  label: string;
  variant: "neutral" | "pending" | "success" | "rejected";
};

const APPROVAL_DISPLAY: Record<string, ApprovalStateDisplay> = {
  not_required: { label: "Not Required",  variant: "neutral" },
  pending:      { label: "Pending",       variant: "pending" },
  approved:     { label: "Approved",      variant: "success" },
  rejected:     { label: "Rejected",      variant: "rejected" },
};

export type VerificationStateDisplay = {
  label: string;
  variant: "neutral" | "pending" | "success" | "blocked" | "failed";
};

const VERIFICATION_DISPLAY: Record<string, VerificationStateDisplay> = {
  not_run: { label: "Not Run", variant: "neutral" },
  pending:  { label: "Pending", variant: "pending" },
  passed:   { label: "Passed",  variant: "success" },
  failed:   { label: "Failed",  variant: "failed" },
  blocked:  { label: "Blocked", variant: "blocked" },
  skipped:  { label: "Skipped", variant: "neutral" },
};

// ---- Lane card view model ----

export type GovernedLaneCardViewModel = {
  laneId: string;
  runtime: RuntimeTypeDisplay;
  laneState: LaneStateDisplay;
  approvalState: ApprovalStateDisplay;
  verificationState: VerificationStateDisplay;
  sandboxId: string;
  operationCount: number;
  dependencyCount: number;
  unresolvedDependencyCount: number;
  transitionCount: number;
  executionAllowed: false;
  dryRun: true;
  capabilities: string[];
  safetyBadges: string[];
  lastTransitionReason?: string;
  lastTransitionAt?: string;
};

// ---- Dashboard view model ----

export type GovernedOperationsDashboardViewModel = {
  queueId: string;
  totalLanes: number;
  lanes: GovernedLaneCardViewModel[];
  summary: GovernedOperationQueueSnapshot;
  allExecutionBlocked: true;
  allDryRun: true;
  governanceNote: string;
};

// ---- Sample / mock data for development and testing ----

export type SampleLaneScenario = "openclaw-validating" | "claude-code-ready" | "codex-blocked" | "human-verified";

// ---- Model helper functions ----

export function getLaneStateDisplay(state: GovernedLaneState): LaneStateDisplay {
  return LANE_STATE_DISPLAY[state];
}

export function getRuntimeTypeDisplay(runtimeType: GovernedRuntimeType): RuntimeTypeDisplay {
  return RUNTIME_TYPE_DISPLAY[runtimeType];
}

export function getApprovalStateDisplay(approvalState: string): ApprovalStateDisplay {
  return APPROVAL_DISPLAY[approvalState] ?? { label: approvalState, variant: "neutral" };
}

export function getVerificationStateDisplay(verificationState: string): VerificationStateDisplay {
  return VERIFICATION_DISPLAY[verificationState] ?? { label: verificationState, variant: "neutral" };
}

export function buildLaneCardViewModel(lane: GovernedOperationLane): GovernedLaneCardViewModel {
  const lastTransition = lane.stateHistory.at(-1);
  const unresolvedDeps = lane.dependencies.filter((d) => !d.resolved).length;

  const safetyBadges: string[] = [
    "execution-blocked",
    "dry-run-enforced",
    "lane-isolated",
    "human-authority",
  ];
  if (lane.runtimeAssignment.approvalRequired) {
    safetyBadges.push("approval-required");
  }
  if (lane.dependencies.length > 0) {
    safetyBadges.push("dependencies-tracked");
  }

  return {
    laneId: lane.laneId,
    runtime: getRuntimeTypeDisplay(lane.runtimeAssignment.runtimeType),
    laneState: getLaneStateDisplay(lane.laneState),
    approvalState: getApprovalStateDisplay(lane.approvalState),
    verificationState: getVerificationStateDisplay(lane.verificationState),
    sandboxId: lane.runtimeAssignment.sandboxId,
    operationCount: lane.operations.length,
    dependencyCount: lane.dependencies.length,
    unresolvedDependencyCount: unresolvedDeps,
    transitionCount: lane.stateHistory.length,
    executionAllowed: false,
    dryRun: true,
    capabilities: [...lane.runtimeAssignment.runtimeCapabilities],
    safetyBadges,
    lastTransitionReason: lastTransition?.reason,
    lastTransitionAt: lastTransition?.transitionAt,
  };
}

export function buildGovernedOperationsDashboardViewModel(
  queue: GovernedOperationQueue,
  input: { now?: () => string } = {},
): GovernedOperationsDashboardViewModel {
  const snapshot = snapshotGovernedOperationQueue(queue, input);

  return {
    queueId: queue.queueId,
    totalLanes: queue.lanes.length,
    lanes: queue.lanes.map(buildLaneCardViewModel),
    summary: snapshot,
    allExecutionBlocked: true,
    allDryRun: true,
    governanceNote:
      "AI-E is the governance and coordination layer. No runtime has been invoked. " +
      "All lanes remain in dry-run governance state pending explicit human operator approval.",
  };
}
