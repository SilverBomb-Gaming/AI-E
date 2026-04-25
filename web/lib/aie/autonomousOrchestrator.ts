import type { AutonomousTaskChain, AutonomousTaskStepRequiredGate } from "./autonomousTaskChain";
import type { ChainPersistenceRecord } from "./chainPersistence";
import { evaluateContextStaleness, requireReapprovalIfNeeded } from "./approvalFreshness";
import {
  detectDuplicateStep,
  evaluateGoalCompletion,
  summarizeGoalState,
  type GoalStatus,
  type OrchestrationMemory,
} from "./orchestrationMemory";

export type OrchestrationStatus =
  | "orchestration_ready"
  | "awaiting_supervisor_approval"
  | "orchestration_blocked"
  | "orchestration_complete";

export type OrchestrationStep = {
  step_id: string;
  title: string;
  rationale: string;
  derived_from_step_id: string | null;
  required_gate: AutonomousTaskStepRequiredGate;
  requires_approval: boolean;
  confidence: number;
};

export type OrchestrationPlan = {
  plan_id: string;
  chain_id: string;
  created_at: string;
  prior_chain_status: AutonomousTaskChain["status"];
  goal_status: GoalStatus;
  requires_supervisor_approval: boolean;
  max_proposed_steps: number;
  context_summary: string;
  goal_summary: string;
  proposed_steps: OrchestrationStep[];
  status: OrchestrationStatus;
};

export type OrchestrationBlocker = {
  code:
    | "max_steps_invalid"
    | "chain_not_completed"
    | "high_risk_chain"
    | "low_confidence"
    | "stale_context"
    | "reapproval_required"
    | "supervisor_approval_required"
    | "no_novel_steps"
    | "goal_completed";
  message: string;
  recommended_action: "approve" | "review" | "revise" | "revalidate";
};

export type OrchestrationDecision = {
  status: OrchestrationStatus;
  plan: OrchestrationPlan;
  blockers: OrchestrationBlocker[];
  confidence: number;
  explanation: string;
};

export type AutonomousOrchestratorInput = {
  chain: AutonomousTaskChain;
  persistenceRecord?: ChainPersistenceRecord | null;
  memory?: OrchestrationMemory | null;
  maxProposedSteps?: number;
  confidence?: number;
  minimumConfidence?: number;
  supervisorApproval?: boolean;
  now?: string;
};

const MAX_BOUND_PROPOSED_STEPS = 3;

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
    .slice(0, 40) || "autonomous-orchestrator";
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function buildPlanId(chainId: string, createdAt: string): string {
  return `autonomous-orchestration-${sanitizeTimestamp(createdAt)}-${slugify(chainId)}`;
}

function buildStepId(planId: string, order: number, title: string): string {
  return `${planId}-proposal-${order}-${slugify(title)}`;
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function summarizeChainContext(
  chain: AutonomousTaskChain,
  persistenceRecord?: ChainPersistenceRecord | null,
  memory?: OrchestrationMemory | null,
): string {
  const completedCount = chain.steps.filter((step) => step.status === "completed").length;
  const lastCompletedStep = chain.steps.filter((step) => step.status === "completed").at(-1);
  const validationSummary = persistenceRecord
    ? `${persistenceRecord.validation_snapshot.status}/${persistenceRecord.validation_snapshot.recommendation}`
    : "no-persisted-validation";
  return [
    `Chain ${chain.chain_id} completed ${completedCount}/${chain.steps.length} steps.`,
    `Prior chain status: ${chain.status}.`,
    `Last completed step: ${lastCompletedStep?.title ?? "none"}.`,
    `Persisted validation: ${validationSummary}.`,
    memory ? summarizeGoalState(memory).replace(/\n/g, " ") : "No persistent goal memory recorded.",
  ].join(" ");
}

function deriveConfidence(input: AutonomousOrchestratorInput): number {
  if (typeof input.confidence === "number") {
    return clampConfidence(input.confidence);
  }

  let score = input.chain.status === "chain_completed" ? 0.72 : 0.45;
  if (input.persistenceRecord?.validation_snapshot.status === "validation_passed") {
    score += 0.12;
  }

  if (!input.persistenceRecord) {
    score -= 0.08;
  }

  if (input.chain.risk_level === "medium") {
    score -= 0.1;
  }

  if (input.chain.risk_level === "high" || input.chain.risk_level === "blocked") {
    score -= 0.45;
  }

  return clampConfidence(score);
}

function chooseLimit(value: number | undefined): number {
  if (value === undefined) {
    return 2;
  }

  return Math.min(value, MAX_BOUND_PROPOSED_STEPS);
}

function buildCandidateSteps(input: {
  chain: AutonomousTaskChain;
  memory?: OrchestrationMemory | null;
  planId: string;
  confidence: number;
  maxProposedSteps: number;
}): OrchestrationStep[] {
  const existingTitles = new Set(input.chain.steps.map((step) => normalizeText(step.title).toLowerCase()));
  const completedSteps = input.chain.steps.filter((step) => step.status === "completed");
  const lastCompletedStep = completedSteps.at(-1) ?? null;
  const focus = lastCompletedStep?.title || input.chain.interpreted_goal || input.chain.original_request || "the completed task chain";
  const goal = input.chain.interpreted_goal || focus;

  const candidates = [
    {
      title: `Review follow-up opportunities after ${focus}`,
      rationale: `The previous chain completed supervised work around ${focus}, so the next bounded step should inspect adjacent follow-up opportunities before extending scope.`,
      required_gate: "controlled_validation" as const,
    },
    {
      title: `Plan the next bounded improvement for ${goal}`,
      rationale: `The interpreted goal remains ${goal}, so the safest continuation is to propose one more bounded improvement instead of broadening execution.`,
      required_gate: "controlled_execution" as const,
    },
    {
      title: `Prepare an approval-ready continuation for ${goal}`,
      rationale: `Any continuation must stay supervised, so the next step should package the follow-up task for explicit approval rather than execute automatically.`,
      required_gate: "commit_approval" as const,
    },
  ];

  return candidates
    .filter((candidate) => !existingTitles.has(normalizeText(candidate.title).toLowerCase()))
    .filter((candidate) => !input.memory || !detectDuplicateStep(input.memory, { title: candidate.title }).is_duplicate)
    .slice(0, input.maxProposedSteps)
    .map((candidate, index) => ({
      step_id: buildStepId(input.planId, index + 1, candidate.title),
      title: candidate.title,
      rationale: candidate.rationale,
      derived_from_step_id: lastCompletedStep?.step_id ?? null,
      required_gate: candidate.required_gate,
      requires_approval: true,
      confidence: input.confidence,
    }));
}

export function decideAutonomousOrchestration(input: AutonomousOrchestratorInput): OrchestrationDecision {
  const now = normalizeText(input.now) || new Date().toISOString();
  const maxProposedSteps = chooseLimit(input.maxProposedSteps);
  const confidence = deriveConfidence(input);
  const minimumConfidence = clampConfidence(input.minimumConfidence ?? 0.65);
  const goalState = input.memory ? evaluateGoalCompletion(input.memory) : null;
  const blockers: OrchestrationBlocker[] = [];

  if (!Number.isInteger(maxProposedSteps) || maxProposedSteps <= 0) {
    blockers.push({
      code: "max_steps_invalid",
      message: "Supervised autonomous orchestration requires a positive bounded step limit.",
      recommended_action: "revise",
    });
  }

  if (input.chain.status !== "chain_completed") {
    blockers.push({
      code: "chain_not_completed",
      message: "Supervised autonomous orchestration only proposes follow-up work after the current chain has completed.",
      recommended_action: "review",
    });
  }

  if (input.chain.risk_level === "high" || input.chain.risk_level === "blocked") {
    blockers.push({
      code: "high_risk_chain",
      message: `Supervised autonomous orchestration is blocked while the chain risk level is ${input.chain.risk_level}.`,
      recommended_action: "review",
    });
  }

  if (confidence < minimumConfidence) {
    blockers.push({
      code: "low_confidence",
      message: `Supervised autonomous orchestration stopped because continuation confidence ${confidence.toFixed(2)} is below the required minimum ${minimumConfidence.toFixed(2)}.`,
      recommended_action: "review",
    });
  }

  if (goalState?.status === "completed") {
    blockers.push({
      code: "goal_completed",
      message: goalState.completion_reason ?? "Persistent orchestration memory already marks this goal as completed.",
      recommended_action: "review",
    });
  }

  if (input.persistenceRecord) {
    const contextStaleness = evaluateContextStaleness({
      chain: input.chain,
      contextSnapshot: input.persistenceRecord.context_snapshot,
      now,
    });
    if (contextStaleness.status === "requires_revalidation") {
      blockers.push({
        code: "stale_context",
        message: contextStaleness.explanation,
        recommended_action: "revalidate",
      });
    }

    const reapproval = requireReapprovalIfNeeded({
      chain: input.chain,
      approvalStates: input.persistenceRecord.approval_state,
      now,
    });
    if (reapproval.status === "requires_reapproval") {
      blockers.push({
        code: "reapproval_required",
        message: reapproval.explanation,
        recommended_action: "approve",
      });
    }
  }

  const planId = buildPlanId(input.chain.chain_id, now);
  const proposedSteps = blockers.some((blocker) => blocker.code === "max_steps_invalid" || blocker.code === "chain_not_completed" || blocker.code === "high_risk_chain" || blocker.code === "low_confidence" || blocker.code === "stale_context" || blocker.code === "goal_completed")
    ? []
    : buildCandidateSteps({
      chain: input.chain,
      memory: input.memory,
      planId,
      confidence,
      maxProposedSteps,
    });

  if (proposedSteps.length === 0 && blockers.length === 0) {
    blockers.push({
      code: "no_novel_steps",
      message: "Supervised autonomous orchestration found no bounded next step that was distinct from the completed chain.",
      recommended_action: "review",
    });
  }

  const approvalNeeded = blockers.some((blocker) => blocker.code === "reapproval_required") || input.supervisorApproval !== true;
  if (approvalNeeded && proposedSteps.length > 0) {
    blockers.push({
      code: "supervisor_approval_required",
      message: "Supervised autonomous orchestration requires explicit approval before any proposed continuation step can be executed.",
      recommended_action: "approve",
    });
  }

  const blockingCodes = new Set(blockers.map((blocker) => blocker.code));
  const status: OrchestrationStatus = blockingCodes.has("max_steps_invalid")
    || blockingCodes.has("chain_not_completed")
    || blockingCodes.has("high_risk_chain")
    || blockingCodes.has("low_confidence")
    || blockingCodes.has("stale_context")
    ? "orchestration_blocked"
    : proposedSteps.length === 0
      ? "orchestration_complete"
      : approvalNeeded
        ? "awaiting_supervisor_approval"
        : "orchestration_ready";

  const plan: OrchestrationPlan = {
    plan_id: planId,
    chain_id: input.chain.chain_id,
    created_at: now,
    prior_chain_status: input.chain.status,
    goal_status: goalState?.status ?? "active",
    requires_supervisor_approval: true,
    max_proposed_steps: maxProposedSteps,
    context_summary: summarizeChainContext(input.chain, input.persistenceRecord, input.memory),
    goal_summary: input.memory ? summarizeGoalState(input.memory) : `Goal status: ${goalState?.status ?? "active"}`,
    proposed_steps: proposedSteps,
    status,
  };

  const explanation = status === "orchestration_ready"
    ? `Supervised autonomous orchestration proposed ${proposedSteps.length} bounded next step(s) from the completed chain.`
    : status === "awaiting_supervisor_approval"
      ? `Supervised autonomous orchestration proposed ${proposedSteps.length} bounded next step(s) but is waiting for explicit approval before continuation.`
      : status === "orchestration_complete"
        ? "Supervised autonomous orchestration found no safe novel continuation to propose."
        : blockers.map((blocker) => blocker.message).join(" ");

  return {
    status,
    plan,
    blockers: unique(blockers),
    confidence,
    explanation,
  };
}

export function summarizeOrchestration(decision: OrchestrationDecision): string {
  return [
    `Status: ${decision.status}`,
    `Goal status: ${decision.plan.goal_status}`,
    `Confidence: ${decision.confidence.toFixed(2)}`,
    `Proposed steps: ${decision.plan.proposed_steps.length}`,
    `Context: ${decision.plan.context_summary}`,
  ].join("\n");
}