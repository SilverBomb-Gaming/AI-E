import type { AutonomousSession, AutonomousSessionStatus } from "./autonomousSession";
import { isReadOnlyGoal } from "./goalEvaluator";
import type { FailureClassification } from "./failureClassifier";
import type { GoalEvaluation } from "./goalEvaluator";
import type { AutonomousRecoveryStrategy } from "./strategySwitch";
import type { ExecutionActionPreview, ExecutionRuntimeResult } from "./types";

type AutonomousStopDecisionParams = {
  session: AutonomousSession;
  latestExecutionResult?: ExecutionRuntimeResult;
  goalEvaluation: GoalEvaluation;
  latestFailureClassification?: FailureClassification;
  latestRecoveryStrategy?: AutonomousRecoveryStrategy;
};

type AutonomousStopDecision = {
  shouldStop: boolean;
  status: AutonomousSessionStatus;
  reason: string;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferActionFamilyFromAction(action: ExecutionActionPreview | undefined): string {
  const combined = `${normalizeText(action?.description)} ${normalizeText(action?.expectedOutcome)}`.toLowerCase();
  if (/\b(?:write|create|update|patch|modify|edit|save|replace)\b/.test(combined)) {
    return "write";
  }
  if (/\b(?:test|build|trace|npm)\b/.test(combined)) {
    return "test";
  }
  if (/\b(?:validate|verify|confirm|check)\b/.test(combined)) {
    return "validate";
  }
  if (/\b(?:inspect|review|read|summari[sz]e|examine)\b/.test(combined)) {
    return "inspect";
  }

  return "other";
}

export function isGoalScopeAlreadySatisfied(params: {
  session: AutonomousSession;
  goalEvaluation?: GoalEvaluation;
}): boolean {
  if (params.goalEvaluation?.safeEvidenceSufficient && params.goalEvaluation.followUpUnnecessary) {
    return true;
  }

  const latestCompletion = params.session.latestCompletion;
  return Boolean(
    latestCompletion &&
      (latestCompletion.status === "complete" ||
        (latestCompletion.status === "needs-verification" && latestCompletion.confidence === "high")),
  );
}

export function isNextActionBroaderThanGoal(params: {
  goal: string;
  nextAction?: ExecutionActionPreview;
}): boolean {
  if (!params.nextAction) {
    return false;
  }

  const readOnlyGoal = isReadOnlyGoal(params.goal);
  const nextFamily = inferActionFamilyFromAction(params.nextAction);
  if (!readOnlyGoal) {
    return params.nextAction.scope !== "safe";
  }

  return params.nextAction.scope !== "safe" || nextFamily === "write";
}

export function shouldStopBeforeApprovalEscalation(params: {
  session: AutonomousSession;
  nextAction?: ExecutionActionPreview;
  goalEvaluation?: GoalEvaluation;
}): boolean {
  return (
    isGoalScopeAlreadySatisfied({ session: params.session, goalEvaluation: params.goalEvaluation }) &&
    isNextActionBroaderThanGoal({ goal: params.session.goal, nextAction: params.nextAction })
  );
}

export function getAutonomousStopDecision(params: AutonomousStopDecisionParams): AutonomousStopDecision {
  const latestStep = params.session.steps.at(-1);
  const latestOutput = normalizeText(params.latestExecutionResult?.output);
  const latestError = normalizeText(params.latestExecutionResult?.error);

  if (params.goalEvaluation.isComplete) {
    return {
      shouldStop: true,
      status: "completed",
      reason: params.goalEvaluation.reason,
    };
  }

  if (
    params.goalEvaluation.status === "needs-verification" &&
    params.goalEvaluation.confidence === "high" &&
    params.goalEvaluation.safeEvidenceSufficient &&
    params.goalEvaluation.followUpUnnecessary
  ) {
    return {
      shouldStop: true,
      status: "completed",
      reason: params.goalEvaluation.reason,
    };
  }

  if (params.goalEvaluation.status === "blocked") {
    const approvalBlocked = /approval/i.test(latestError) || /approval/i.test(latestOutput);
    return {
      shouldStop: true,
      status: approvalBlocked || params.session.pendingAction ? "awaiting-approval" : "blocked",
      reason: params.goalEvaluation.reason,
    };
  }

  if (params.session.steps.length >= params.session.maxSteps) {
    return {
      shouldStop: true,
      status: "max-step-limit",
      reason: `The autonomous run reached its bounded limit of ${params.session.maxSteps} steps.`,
    };
  }

  if (!latestStep?.proposedAction) {
    return {
      shouldStop: true,
      status: "blocked",
      reason: "The planner did not produce a bounded actionable next step.",
    };
  }

  if (latestStep.stallReason) {
    return {
      shouldStop: true,
      status: "failed",
      reason: latestStep.stallReason,
    };
  }

  if (params.latestRecoveryStrategy === "stop") {
    if (params.latestFailureClassification?.kind === "constraint") {
      const requiresApproval = /approval/i.test(latestError) || /approval/i.test(latestOutput);
      return {
        shouldStop: true,
        status: requiresApproval ? "awaiting-approval" : "blocked",
        reason:
          latestStep.failureClassification?.reason ||
          latestError ||
          latestOutput ||
          "Autonomous recovery stopped at a bounded constraint boundary.",
      };
    }

    if (params.latestExecutionResult?.status === "failed") {
      return {
        shouldStop: true,
        status: "failed",
        reason:
          latestStep.retryCount && latestStep.retryCount > 0
            ? `Autonomous recovery options were exhausted after ${latestStep.retryCount} bounded retry attempt(s).`
            : latestStep.failureClassification?.reason || "Autonomous recovery options were exhausted.",
      };
    }

    if (params.latestExecutionResult?.status === "blocked") {
      return {
        shouldStop: true,
        status: /approval/i.test(latestError) || /approval/i.test(latestOutput) ? "awaiting-approval" : "blocked",
        reason: latestError || latestOutput || "Autonomous recovery stopped after a blocked bounded step.",
      };
    }
  }

  if (params.latestExecutionResult?.status === "blocked") {
    if (/approval/i.test(latestError) || /approval/i.test(latestOutput)) {
      return {
        shouldStop: true,
        status: "awaiting-approval",
        reason: latestError || latestOutput || "The next step requires manual approval before autonomous continuation.",
      };
    }

    return {
      shouldStop: true,
      status: "blocked",
      reason:
        latestStep.failureClassification?.reason || latestError || latestOutput || "Execution was blocked inside the safe bounded runtime.",
    };
  }

  return {
    shouldStop: false,
    status: "active",
    reason: "The bounded autonomous loop can continue.",
  };
}