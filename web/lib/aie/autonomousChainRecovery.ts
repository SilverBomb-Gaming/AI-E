import type {
  AutonomousTaskChain,
  AutonomousTaskChainBlocker,
  AutonomousTaskChainResult,
  AutonomousTaskStep,
  AutonomousTaskStepStatus,
} from "./autonomousTaskChain";

export type RecoveryStatus = "recoverable" | "not_recoverable" | "requires_restart" | "awaiting_reapproval";

export type RecoveryBlocker = {
  code:
    | "missing_chain"
    | "missing_checkpoint"
    | "invalid_checkpoint"
    | "unsafe_chain_state"
    | "failed_validation_snapshot"
    | "rollback_recommended"
    | "approval_missing"
    | "restart_required"
    | "step_out_of_range"
    | "checkpoint_ahead_of_chain"
    | "chain_already_completed";
  message: string;
  recommended_action: "resume" | "review" | "approve" | "restart";
};

export type ChainCheckpoint = {
  checkpoint_id: string;
  chain_id: string;
  last_completed_step_index: number;
  last_successful_state: AutonomousTaskChain["status"];
  validation_snapshot: {
    status: "validation_passed" | "validation_failed" | "validation_needs_review" | "validation_blocked";
    recommendation: "keep_changes" | "rollback" | "review_required";
  };
  approval_state: {
    chain_approval_granted: boolean;
    commit_approved: boolean;
    push_approved: boolean;
  };
  created_at: string;
};

export type RecoveryInput = {
  chain: AutonomousTaskChain | null;
  checkpoint: ChainCheckpoint | null;
};

export type RecoveryResult = {
  status: RecoveryStatus;
  blockers: RecoveryBlocker[];
  resumed_chain: AutonomousTaskChain | null;
  explanation: string;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function buildCheckpointId(chainId: string, createdAt: string): string {
  return `chain-checkpoint-${sanitizeTimestamp(createdAt)}-${chainId}`;
}

function cloneChain(chain: AutonomousTaskChain): AutonomousTaskChain {
  return {
    ...chain,
    steps: chain.steps.map((step) => ({ ...step })),
    blockers: chain.blockers.map((blocker) => ({ ...blocker })),
    completion_report: {
      ...chain.completion_report,
      completed_steps: [...chain.completion_report.completed_steps],
      pending_steps: [...chain.completion_report.pending_steps],
    },
  };
}

function buildReport(chain: AutonomousTaskChain, pausedReason?: string): AutonomousTaskChain["completion_report"] {
  const completedSteps = chain.steps.filter((step) => step.status === "completed").map((step) => step.title);
  const pendingSteps = chain.steps.filter((step) => step.status !== "completed").map((step) => step.title);
  return {
    report_id: chain.completion_report.report_id,
    created_at: chain.created_at,
    status: chain.status,
    completed_steps: completedSteps,
    pending_steps: pendingSteps,
    paused_reason: pausedReason,
    last_completed_step_id: chain.steps.filter((step) => step.status === "completed").at(-1)?.step_id,
    summary: `${chain.status}: ${completedSteps.length}/${chain.steps.length} steps completed`,
  };
}

function hasApprovalGap(chain: AutonomousTaskChain, checkpoint: ChainCheckpoint): boolean {
  const currentStep = chain.steps[checkpoint.last_completed_step_index + 1];
  if (!currentStep) {
    return false;
  }

  if (chain.approval_required && checkpoint.approval_state.chain_approval_granted !== true) {
    return true;
  }

  if (currentStep.commit_allowed && checkpoint.approval_state.commit_approved !== true) {
    return true;
  }

  if (currentStep.push_allowed && checkpoint.approval_state.push_approved !== true) {
    return true;
  }

  return false;
}

function mapChainBlockers(blockers: AutonomousTaskChainBlocker[]): RecoveryBlocker[] {
  return blockers.map((blocker) => ({
    code: blocker.code === "validation_failed"
      ? "failed_validation_snapshot"
      : blocker.code === "rollback_recommended"
        ? "rollback_recommended"
        : blocker.code === "commit_approval_missing" || blocker.code === "push_approval_missing" || blocker.code === "chain_approval_required"
          ? "approval_missing"
          : "unsafe_chain_state",
    message: blocker.message,
    recommended_action: blocker.recommended_action === "approve"
      ? "approve"
      : blocker.recommended_action === "revise"
        ? "restart"
        : "review",
  }));
}

export function createChainCheckpoint(chain: AutonomousTaskChain): ChainCheckpoint {
  const completedSteps = chain.steps
    .map((step, index) => ({ step, index }))
    .filter((entry) => entry.step.status === "completed");
  const lastCompleted = completedSteps.at(-1);
  const currentStep = chain.steps[Math.min(chain.current_step_index, Math.max(chain.steps.length - 1, 0))];

  return {
    checkpoint_id: buildCheckpointId(chain.chain_id, chain.created_at),
    chain_id: chain.chain_id,
    last_completed_step_index: lastCompleted?.index ?? -1,
    last_successful_state: chain.status,
    validation_snapshot: {
      status: chain.blockers.some((blocker) => blocker.code === "validation_failed") ? "validation_failed" : "validation_passed",
      recommendation: chain.blockers.some((blocker) => blocker.code === "rollback_recommended") ? "rollback" : "keep_changes",
    },
    approval_state: {
      chain_approval_granted: chain.chain_approval_granted,
      commit_approved: currentStep?.commit_allowed ? !chain.blockers.some((blocker) => blocker.code === "commit_approval_missing") : false,
      push_approved: currentStep?.push_allowed ? !chain.blockers.some((blocker) => blocker.code === "push_approval_missing") : false,
    },
    created_at: chain.created_at,
  };
}

export function validateCheckpoint(checkpoint: ChainCheckpoint | null): RecoveryResult {
  const blockers: RecoveryBlocker[] = [];

  if (!checkpoint) {
    blockers.push({
      code: "missing_checkpoint",
      message: "Autonomous chain recovery requires a checkpoint before resume can be evaluated.",
      recommended_action: "review",
    });
  } else {
    if (!normalizeText(checkpoint.chain_id) || !normalizeText(checkpoint.checkpoint_id)) {
      blockers.push({
        code: "invalid_checkpoint",
        message: "Autonomous chain recovery requires checkpoint identifiers and chain identifiers to be present.",
        recommended_action: "review",
      });
    }

    if (checkpoint.last_completed_step_index < -1) {
      blockers.push({
        code: "invalid_checkpoint",
        message: "Autonomous chain recovery requires a valid last completed step index in the checkpoint.",
        recommended_action: "review",
      });
    }

    if (checkpoint.validation_snapshot.status !== "validation_passed") {
      blockers.push({
        code: "failed_validation_snapshot",
        message: "Autonomous chain recovery requires the checkpoint to capture a successful validation snapshot.",
        recommended_action: "restart",
      });
    }

    if (checkpoint.validation_snapshot.recommendation === "rollback") {
      blockers.push({
        code: "rollback_recommended",
        message: "Autonomous chain recovery cannot resume from a checkpoint that recommended rollback.",
        recommended_action: "restart",
      });
    }
  }

  return {
    status: blockers.length === 0 ? "recoverable" : blockers.some((blocker) => blocker.recommended_action === "restart") ? "requires_restart" : "not_recoverable",
    blockers,
    resumed_chain: null,
    explanation: blockers.length === 0
      ? "Checkpoint validation succeeded for autonomous chain recovery."
      : blockers.map((blocker) => blocker.message).join(" "),
  };
}

export function evaluateRecoveryEligibility(chain: AutonomousTaskChain | null, checkpoint: ChainCheckpoint | null): RecoveryResult {
  const blockers: RecoveryBlocker[] = [];

  if (!chain) {
    blockers.push({
      code: "missing_chain",
      message: "Autonomous chain recovery requires a task chain to evaluate resume eligibility.",
      recommended_action: "review",
    });
  }

  const checkpointValidation = validateCheckpoint(checkpoint);
  blockers.push(...checkpointValidation.blockers);

  if (!chain || !checkpoint) {
    return {
      status: blockers.some((blocker) => blocker.recommended_action === "restart") ? "requires_restart" : "not_recoverable",
      blockers,
      resumed_chain: null,
      explanation: blockers.map((blocker) => blocker.message).join(" "),
    };
  }

  if (chain.status === "chain_completed") {
    blockers.push({
      code: "chain_already_completed",
      message: "Autonomous chain recovery is not needed because the chain has already completed.",
      recommended_action: "review",
    });
  }

  if (checkpoint.chain_id !== chain.chain_id) {
    blockers.push({
      code: "invalid_checkpoint",
      message: "Autonomous chain recovery requires the checkpoint to belong to the same task chain.",
      recommended_action: "review",
    });
  }

  if (checkpoint.last_completed_step_index >= chain.steps.length) {
    blockers.push({
      code: "step_out_of_range",
      message: "Autonomous chain recovery checkpoint points past the end of the task chain.",
      recommended_action: "restart",
    });
  }

  const completedCount = chain.steps.filter((step) => step.status === "completed").length;
  if (checkpoint.last_completed_step_index > completedCount) {
    blockers.push({
      code: "checkpoint_ahead_of_chain",
      message: "Autonomous chain recovery cannot resume because the checkpoint claims more completed work than the chain state records.",
      recommended_action: "restart",
    });
  }

  if (chain.risk_level === "high" || chain.risk_level === "blocked") {
    blockers.push({
      code: "unsafe_chain_state",
      message: `Autonomous chain recovery is blocked while chain risk level is ${chain.risk_level}.`,
      recommended_action: "review",
    });
  }

  const mappedChainBlockers = mapChainBlockers(chain.blockers);
  const approvalBlockers = mappedChainBlockers.filter((blocker) => blocker.code === "approval_missing");
  blockers.push(...mappedChainBlockers.filter((blocker) => blocker.code !== "approval_missing"));

  if (blockers.length > 0) {
    return {
      status: blockers.some((blocker) => blocker.recommended_action === "restart") ? "requires_restart" : "not_recoverable",
      blockers,
      resumed_chain: null,
      explanation: blockers.map((blocker) => blocker.message).join(" "),
    };
  }

  if (approvalBlockers.length > 0 || hasApprovalGap(chain, checkpoint)) {
    return {
      status: "awaiting_reapproval",
      blockers: approvalBlockers.length > 0
        ? approvalBlockers
        : [{
            code: "approval_missing",
            message: "Autonomous chain recovery requires fresh approval before the next step can continue.",
            recommended_action: "approve",
          }],
      resumed_chain: null,
      explanation: "Autonomous chain recovery found a valid checkpoint, but explicit approval must be renewed before resuming.",
    };
  }

  return {
    status: "recoverable",
    blockers: [],
    resumed_chain: null,
    explanation: "Autonomous chain recovery can safely resume from the last validated checkpoint.",
  };
}

function updateStepStatusesForResume(chain: AutonomousTaskChain, checkpoint: ChainCheckpoint): AutonomousTaskStep[] {
  return chain.steps.map((step, index) => {
    let status: AutonomousTaskStepStatus = step.status;
    if (index <= checkpoint.last_completed_step_index) {
      status = "completed";
    } else if (index === checkpoint.last_completed_step_index + 1) {
      status = "ready";
    } else if (status !== "completed") {
      status = "planned";
    }

    return {
      ...step,
      status,
    };
  });
}

export function resumeTaskChain(chain: AutonomousTaskChain, checkpoint: ChainCheckpoint): RecoveryResult {
  const eligibility = evaluateRecoveryEligibility(chain, checkpoint);
  if (eligibility.status !== "recoverable" && eligibility.status !== "awaiting_reapproval") {
    return eligibility;
  }

  const resumedChain = cloneChain(chain);
  resumedChain.current_step_index = checkpoint.last_completed_step_index + 1;
  resumedChain.steps = updateStepStatusesForResume(resumedChain, checkpoint);
  resumedChain.status = resumedChain.current_step_index >= resumedChain.steps.length ? "chain_completed" : "chain_running";
  resumedChain.blockers = eligibility.status === "awaiting_reapproval"
    ? [{
        code: "chain_approval_required",
        message: "Autonomous task chain resumed from the last safe checkpoint and is awaiting renewed approval before continuing.",
        recommended_action: "approve",
      }]
    : [];
  resumedChain.completion_report = buildReport(
    resumedChain,
    eligibility.status === "awaiting_reapproval"
      ? "Awaiting renewed approval before continuing from the recovered step."
      : undefined,
  );

  return {
    status: "recoverable",
    blockers: eligibility.status === "awaiting_reapproval" ? eligibility.blockers : [],
    resumed_chain: resumedChain,
    explanation: resumedChain.status === "chain_completed"
      ? "Autonomous chain recovery found that all steps were already completed at the last safe checkpoint."
      : eligibility.status === "awaiting_reapproval"
        ? `Autonomous chain recovery resumed at step ${resumedChain.current_step_index + 1} without re-running completed work, but renewed approval is still required before continuation.`
        : `Autonomous chain recovery resumed at step ${resumedChain.current_step_index + 1} without re-running completed work.`,
  };
}

export function summarizeRecovery(result: RecoveryResult): string {
  return [
    `Recovery status: ${result.status}`,
    `Resume available: ${String(Boolean(result.resumed_chain))}`,
    `Blockers: ${result.blockers.length}`,
    `Explanation: ${result.explanation}`,
  ].join("\n");
}