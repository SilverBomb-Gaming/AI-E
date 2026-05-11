import { evaluateSafeExecutionGuardrail, type SafeExecutionGuardrailDecision } from "./safeExecutionGuardrails";
import type { ProjectStateInspectionResult } from "./projectStateInspection";

export type CodebaseChangeRiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type ProposedCodebaseChange = {
  changeId: string;
  targetPath: string;
  summary: string;
  riskLevel: CodebaseChangeRiskLevel;
  validationCommands: string[];
  rollbackNote: string;
};

export type CodebaseChangePlanInput = {
  planId: string;
  objective: string;
  inspection: ProjectStateInspectionResult;
  proposedChanges: ProposedCodebaseChange[];
};

export type PlannedCodebaseChange = ProposedCodebaseChange & {
  targetVerified: boolean;
  planningStatus: "planned_requires_supervised_approval" | "blocked_unverified_target";
  guardrailDecision: SafeExecutionGuardrailDecision;
};

export type CodebaseChangePlan = {
  layerId: "CODEBASE_CHANGE_PLANNING_PHASE1";
  planId: string;
  objective: string;
  planStatus: "ready_for_review" | "blocked_unverified_targets" | "empty";
  plannedChanges: PlannedCodebaseChange[];
  verifiedTargetPaths: string[];
  unverifiedTargetPaths: string[];
  riskSummary: string[];
  validationCommands: string[];
  rollbackNotes: string[];
  executionTriggered: false;
  mutationPerformed: false;
  truthfulnessWarnings: string[];
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function planCodebaseChanges(input: CodebaseChangePlanInput): CodebaseChangePlan {
  const verifiedPaths = new Set(input.inspection.verifiedFacts.map((fact) => fact.path));
  const plannedChanges = input.proposedChanges.map((change): PlannedCodebaseChange => {
    const targetVerified = verifiedPaths.has(change.targetPath);
    const guardrailDecision = evaluateSafeExecutionGuardrail({
      operationKind: "repo_file_mutation",
      requestedAction: change.summary,
      targetPaths: [change.targetPath],
    });

    return {
      ...change,
      targetVerified,
      planningStatus: targetVerified ? "planned_requires_supervised_approval" : "blocked_unverified_target",
      guardrailDecision,
    };
  });
  const unverifiedTargetPaths = plannedChanges.filter((change) => !change.targetVerified).map((change) => change.targetPath);
  const verifiedTargetPaths = plannedChanges.filter((change) => change.targetVerified).map((change) => change.targetPath);
  const planStatus = plannedChanges.length === 0
    ? "empty"
    : unverifiedTargetPaths.length > 0
      ? "blocked_unverified_targets"
      : "ready_for_review";

  return {
    layerId: "CODEBASE_CHANGE_PLANNING_PHASE1",
    planId: input.planId,
    objective: input.objective,
    planStatus,
    plannedChanges,
    verifiedTargetPaths: unique(verifiedTargetPaths),
    unverifiedTargetPaths: unique(unverifiedTargetPaths),
    riskSummary: plannedChanges.map((change) => `${change.riskLevel}: ${change.targetPath} - ${change.summary}`),
    validationCommands: unique(plannedChanges.flatMap((change) => change.validationCommands)),
    rollbackNotes: plannedChanges.map((change) => `${change.targetPath}: ${change.rollbackNote}`),
    executionTriggered: false,
    mutationPerformed: false,
    truthfulnessWarnings: [
      "This is a codebase change plan only; it does not edit files or stage patches.",
      "Every planned repo mutation still requires a separate supervised execution path with operator approval and rollback readiness.",
      "Unverified target files must remain blocked until project inspection verifies them.",
    ],
  };
}