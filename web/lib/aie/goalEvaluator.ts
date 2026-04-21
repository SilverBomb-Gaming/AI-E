import type { AutonomousActionFamily } from "./autonomousPlanning";
import type { ExecutionAdapterId } from "./executionAdapters";
import type { ExecutionRuntimeResult } from "./types";
import type { FailureClassification } from "./failureClassifier";
import type { AutonomousRecoveryStrategy } from "./strategySwitch";

export type GoalCompletionStatus = "incomplete" | "progressing" | "needs-verification" | "complete" | "blocked";

export type GoalEvaluation = {
  status: GoalCompletionStatus;
  isComplete: boolean;
  reason: string;
  confidence: "low" | "medium" | "high";
  safeEvidenceSufficient: boolean;
  followUpUnnecessary: boolean;
  outputDirectlyAnswersGoal: boolean;
};

type GoalEvaluationParams = {
  goal: string;
  latestDiagnosis?: string;
  latestExecutionResult?: ExecutionRuntimeResult;
  latestExpectedOutcome?: string;
  latestActionFamily?: AutonomousActionFamily;
  latestExecutionAdapterId?: ExecutionAdapterId;
  latestTargetPathSummary?: string;
  latestWasReadOnly?: boolean;
  latestOutputDirectlyAnswersGoal?: boolean;
  latestFailureClassification?: FailureClassification;
  latestRecoveryStrategy?: AutonomousRecoveryStrategy;
};

const GOAL_STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "bounded",
  "current",
  "goal",
  "issue",
  "latest",
  "resolve",
  "resolved",
  "should",
  "step",
  "that",
  "the",
  "this",
  "validate",
  "whether",
]);

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePath(value: string | null | undefined): string {
  return normalizeText(value).replace(/\\/g, "/").toLowerCase();
}

function getPathBasename(value: string | null | undefined): string {
  const normalizedPath = normalizePath(value);
  const segments = normalizedPath.split("/").filter(Boolean);
  return segments.at(-1) ?? "";
}

function collectTerms(value: string): Set<string> {
  return new Set(
    normalizeText(value)
      .toLowerCase()
      .match(/[a-z0-9][a-z0-9-]+/g)?.filter((term) => term.length >= 4 && !GOAL_STOP_WORDS.has(term)) ?? [],
  );
}

function calculateOverlap(left: string, right: string): number {
  const leftTerms = collectTerms(left);
  const rightTerms = collectTerms(right);
  if (!leftTerms.size || !rightTerms.size) {
    return 0;
  }

  let shared = 0;
  for (const term of leftTerms) {
    if (rightTerms.has(term)) {
      shared += 1;
    }
  }

  return shared / new Set([...leftTerms, ...rightTerms]).size;
}

function looksResolved(value: string): boolean {
  return /\b(?:resolved|complete(?:d)?|fixed|fixes|issue no longer reproduces|no longer present|works normally again|validated successfully|goal satisfied|done)\b/i.test(
    value,
  );
}

function looksUnresolved(value: string): boolean {
  return /\b(?:blocked|failed|still broken|still present|still unresolved|no effect|unchanged|ambiguous|inconclusive|cannot confirm)\b/i.test(
    value,
  );
}

function looksExplicitlyUnresolved(value: string): boolean {
  return /\b(?:not confirmed yet|not resolved|not complete|not healthy yet|still narrowing|not verified yet|not fixed)\b/i.test(value);
}

export function hasUnresolvedLanguage(value: string): boolean {
  return looksUnresolved(value) || looksExplicitlyUnresolved(value);
}

function looksProgress(value: string): boolean {
  return /\b(?:progress|improv(?:e|ed|ing)|narrow(?:ed|ing)?|partially|closer|advanced|reduced|moved forward|mitigated|healthy result is not confirmed yet|passes? but)\b/i.test(
    value,
  );
}

function looksVerificationSignal(value: string): boolean {
  return /\b(?:verify|verification|confirm|confirmed|inspection|inspect|check|validate|validated|needs verification|should be verified)\b/i.test(value);
}

function looksTestSuccess(value: string): boolean {
  return /\b(?:test(?:s)? passed|build passed|compiled successfully|validation passed|exit code 0|all checks passed|completed successfully|pass\s+\d+\b.*\bfail\s+0\b|tests?\s+\d+\b.*\bfail\s+0\b)\b/i.test(value);
}

function looksApprovalBoundary(value: string): boolean {
  return /\b(?:manual approval required|requires manual approval|approval|auto-execution boundary)\b/i.test(value);
}

function looksDirectOutcomeConfirmation(value: string): boolean {
  return /\b(?:healthy (?:result|status) confirmed|expected outcome validated successfully|issue resolved|goal satisfied|validation complete|inspection complete)\b/i.test(
    value,
  );
}

function looksWriteGoal(value: string): boolean {
  return /\b(?:write|file write|sandbox note|create(?:d)? file|update(?:d)? file|changed path|diff summary|record(?:ed)? the file change|file change)\b/i.test(
    value,
  );
}

export function isReadOnlyGoal(goal: string, expectedOutcome?: string): boolean {
  const combined = `${normalizeText(goal)} ${normalizeText(expectedOutcome)}`.toLowerCase();

  if (!combined) {
    return false;
  }

  if (/\b(?:write|create|update|patch|modify|edit|replace|save)\b/.test(combined)) {
    return false;
  }

  return /(?:\b(?:validate|verify|confirm|check)\b.*\b(?:exists?|contains?|presence|available|successful(?:ly)?|passed|before continuing)\b|\b(?:inspect|inspection|review|read|summari[sz]e|examine|find|locate)\b.*\b(?:file|files|path|paths|module|modules|shape|contents?|types?|interfaces?|exports?|read-only)\b|\b(?:npm test|test file|bounded test file|trace|build|spec)\b.*\b(?:confirm|verify|successful(?:ly)?|passed|completes?|runs?)\b|\b(?:locate|find|verify|confirm|run)\b.*\b(?:test|tests|spec|build|trace)\b)/i.test(
    combined,
  );
}

export function doesExecutionOutputDirectlyAnswerGoal(params: {
  goal: string;
  output?: string;
  expectedOutcome?: string;
  targetPathSummary?: string;
  actionFamily?: AutonomousActionFamily;
}): boolean {
  const goal = normalizeText(params.goal).toLowerCase();
  const expectedOutcome = normalizeText(params.expectedOutcome).toLowerCase();
  const output = normalizeText(params.output).toLowerCase();
  const targetPath = normalizePath(params.targetPathSummary);
  const targetBasename = getPathBasename(params.targetPathSummary);
  const outputHasTarget = Boolean(targetPath && (output.includes(targetPath) || (targetBasename && output.includes(targetBasename))));

  if (!output) {
    return false;
  }

  if (/(?:\bexists?\b|\bpresent\b|\bfound\b|\bavailable\b|\bconfirmed\b)/.test(output) && /\b(?:exists?|presence|available)\b/.test(goal)) {
    return outputHasTarget || !targetPath;
  }

  if (/(?:\bcontains?\b|\bincludes?\b|\bfound\b|\bdeclares?\b|\bexports?\b)/.test(output) && /\b(?:contains?|include|contract|type|interface)\b/.test(goal)) {
    return outputHasTarget || calculateOverlap(goal, output) >= 0.2;
  }

  if (
    /(?:\b(?:find|locate|summari[sz]e|list|identify|inspect|read)\b.*\b(?:type|types|interface|interfaces|export|exports)\b|\b(?:type|types|interface|interfaces|export|exports)\b.*\b(?:find|locate|summari[sz]e|list|identify|inspect|read)\b)/.test(goal) &&
    /\b(?:type|types|interface|interfaces|export|exports|summary)\b/.test(output)
  ) {
    return outputHasTarget || calculateOverlap(goal, output) >= 0.12;
  }

  if (/(?:\bsummary\b|\bsummarized\b|\bshape\b|\bmodule\b|\bfile\b|\bexports?\b|\binterfaces?\b|\btypes?\b)/.test(output) && /\b(?:summari[sz]e|shape|contents?|module|file)\b/.test(goal)) {
    return outputHasTarget || calculateOverlap(goal, output) >= 0.18;
  }

  if (
    params.actionFamily === "inspect" &&
    /\b(?:find|locate|summari[sz]e|inspect|read)\b/.test(goal) &&
    /\b(?:inspection completed|summary|filesystem findings|file previews)\b/.test(output)
  ) {
    return outputHasTarget || calculateOverlap(goal, output) >= 0.14;
  }

  if (params.actionFamily === "test" && looksTestSuccess(output)) {
    return /\b(?:test|build|trace|command)\b/.test(goal) || /\b(?:test|build|trace|command)\b/.test(expectedOutcome);
  }

  if (calculateOverlap(goal || expectedOutcome, output) >= 0.45 && (looksDirectOutcomeConfirmation(output) || looksVerificationSignal(output))) {
    return true;
  }

  return false;
}

export function isSafeClosureCandidate(params: {
  goal: string;
  expectedOutcome?: string;
  executionResult?: ExecutionRuntimeResult;
  actionFamily?: AutonomousActionFamily;
  executionAdapterId?: ExecutionAdapterId;
  wasReadOnly?: boolean;
}): boolean {
  if (params.executionResult?.status !== "success") {
    return false;
  }

  const readOnlyGoal = isReadOnlyGoal(params.goal, params.expectedOutcome);
  const readOnlyAction =
    params.wasReadOnly ??
    (params.actionFamily === "inspect" ||
      params.actionFamily === "validate" ||
      params.actionFamily === "test" ||
      params.executionAdapterId === "web-sandbox" ||
      params.executionAdapterId === "headless-local" ||
      params.executionAdapterId === "repo-tests");

  return readOnlyGoal && readOnlyAction;
}

function looksWriteOnlyEvidence(params: GoalEvaluationParams, combined: string, output: string): boolean {
  return Boolean(
    params.latestExecutionResult?.changedPaths?.length ||
      params.latestExecutionResult?.diffSummary ||
      /\b(?:wrote|written|created file|updated file|patched|modified file|changed path|diff summary)\b/i.test(combined) ||
      /\b(?:created new file|updated file|write completed)\b/i.test(output),
  );
}

function buildGoalEvaluation(
  status: GoalCompletionStatus,
  reason: string,
  confidence: GoalEvaluation["confidence"],
  options?: Partial<Pick<GoalEvaluation, "safeEvidenceSufficient" | "followUpUnnecessary" | "outputDirectlyAnswersGoal">>,
): GoalEvaluation {
  return {
    status,
    isComplete: status === "complete",
    reason,
    confidence,
    safeEvidenceSufficient: options?.safeEvidenceSufficient ?? false,
    followUpUnnecessary: options?.followUpUnnecessary ?? false,
    outputDirectlyAnswersGoal: options?.outputDirectlyAnswersGoal ?? false,
  };
}

export function evaluateGoalCompletion(params: GoalEvaluationParams): GoalEvaluation {
  const diagnosis = normalizeText(params.latestDiagnosis);
  const output = normalizeText(params.latestExecutionResult?.output);
  const error = normalizeText(params.latestExecutionResult?.error);
  const expectedOutcome = normalizeText(params.latestExpectedOutcome);
  const combined = [diagnosis, output, error].filter(Boolean).join(" ");
  const goalToEvidenceOverlap = Math.max(calculateOverlap(params.goal, combined), calculateOverlap(expectedOutcome, combined));
  const resolved = looksResolved(combined);
  const unresolved = hasUnresolvedLanguage(combined);
  const verificationSignal = looksVerificationSignal(combined);
  const writeOnlyEvidence = looksWriteOnlyEvidence(params, combined, output);
  const testSuccess = looksTestSuccess(combined);
  const directOutcomeConfirmation = looksDirectOutcomeConfirmation(output) || looksDirectOutcomeConfirmation(combined);
  const writeGoal = looksWriteGoal(params.goal) || looksWriteGoal(expectedOutcome);
  const readOnlyGoal = isReadOnlyGoal(params.goal, expectedOutcome);
  const outputDirectlyAnswersGoal =
    params.latestOutputDirectlyAnswersGoal ??
    doesExecutionOutputDirectlyAnswerGoal({
      goal: params.goal,
      output,
      expectedOutcome,
      targetPathSummary: params.latestTargetPathSummary,
      actionFamily: params.latestActionFamily,
    });
  const safeClosureCandidate = isSafeClosureCandidate({
    goal: params.goal,
    expectedOutcome,
    executionResult: params.latestExecutionResult,
    actionFamily: params.latestActionFamily,
    executionAdapterId: params.latestExecutionAdapterId,
    wasReadOnly: params.latestWasReadOnly,
  });

  if (params.latestExecutionResult?.status === "blocked") {
    return buildGoalEvaluation(
      "blocked",
      looksApprovalBoundary(`${error} ${output}`)
        ? "Execution blocked at the bounded auto-execution boundary because the next step still requires manual approval."
        : params.latestFailureClassification?.kind === "constraint"
          ? "Execution was blocked by a bounded safety or constraint boundary before the goal could be confirmed."
          : "Execution blocked before the goal could be confirmed.",
      params.latestFailureClassification?.kind === "constraint" ? "medium" : "low",
    );
  }

  if (params.latestExecutionResult?.status === "failed") {
    if (params.latestFailureClassification?.kind === "constraint") {
      return buildGoalEvaluation(
        "blocked",
        params.latestFailureClassification?.kind === "constraint"
          ? "Execution was blocked by a bounded safety or constraint boundary before the goal could be confirmed."
          : "Execution failed at a bounded constraint boundary before the goal could be confirmed.",
        "medium",
      );
    }

    return buildGoalEvaluation(
      "incomplete",
      params.latestRecoveryStrategy === "reroute-analysis"
        ? "Execution failed, so the goal remains unverified and should be rerouted through another bounded strategy."
        : "Execution failed, so the goal remains unverified.",
      "low",
    );
  }

  if (!combined) {
    return buildGoalEvaluation("incomplete", "No concrete diagnosis or execution output is available yet.", "low");
  }

  if (safeClosureCandidate && outputDirectlyAnswersGoal && !unresolved && !writeOnlyEvidence) {
    const closureLabel =
      params.latestActionFamily === "inspect"
        ? "inspection complete"
        : params.latestActionFamily === "validate"
          ? "verification complete"
          : "safe verification complete";
    return buildGoalEvaluation(
      "complete",
      `The latest bounded ${closureLabel} directly answered the small safe goal, so follow-up is unnecessary.`,
      "high",
      {
        safeEvidenceSufficient: true,
        followUpUnnecessary: true,
        outputDirectlyAnswersGoal: true,
      },
    );
  }

  if (
    safeClosureCandidate &&
    !unresolved &&
    !writeOnlyEvidence &&
    (outputDirectlyAnswersGoal || directOutcomeConfirmation || testSuccess)
  ) {
    return buildGoalEvaluation(
      "needs-verification",
      "The bounded read-only evidence is already strong enough to stop conservatively without a broader follow-up step.",
      "high",
      {
        safeEvidenceSufficient: true,
        followUpUnnecessary: true,
        outputDirectlyAnswersGoal,
      },
    );
  }

  if (looksExplicitlyUnresolved(combined) && looksProgress(combined)) {
    return buildGoalEvaluation(
      "progressing",
      "The latest step made bounded progress, but the goal is explicitly not confirmed yet.",
      "medium",
    );
  }

  if (unresolved && !resolved) {
    return buildGoalEvaluation(
      looksProgress(combined) ? "progressing" : "incomplete",
      looksProgress(combined)
        ? "The latest evidence shows bounded progress, but it still reads as unresolved."
        : "The latest evidence still reads as unresolved or ambiguous.",
      looksProgress(combined) ? "medium" : "low",
    );
  }

  if (writeOnlyEvidence && writeGoal && resolved && goalToEvidenceOverlap >= 0.2) {
    return buildGoalEvaluation(
      "complete",
      "The bounded write outcome strongly satisfies the requested file-change goal.",
      "high",
    );
  }

  if (resolved && directOutcomeConfirmation && !writeOnlyEvidence) {
    return buildGoalEvaluation("complete", "The latest bounded result strongly confirms the expected resolved outcome.", "high");
  }

  if (resolved && goalToEvidenceOverlap >= 0.35 && !writeOnlyEvidence) {
    return buildGoalEvaluation("complete", "The latest bounded result strongly matches the expected resolved outcome.", "high");
  }

  if (expectedOutcome && output && calculateOverlap(expectedOutcome, output) >= 0.45 && resolved && !writeOnlyEvidence) {
    return buildGoalEvaluation("complete", "The execution output strongly matches the expected outcome.", "high");
  }

  if (resolved && goalToEvidenceOverlap >= 0.2) {
    return buildGoalEvaluation(
      "needs-verification",
      "The latest step sounds resolved, but the evidence is still too indirect to conservatively mark the goal complete.",
      verificationSignal ? "medium" : "low",
    );
  }

  if ((verificationSignal || (testSuccess && goalToEvidenceOverlap >= 0.15)) && !resolved) {
    return buildGoalEvaluation(
      "needs-verification",
      readOnlyGoal
        ? "The latest safe read-only step looks promising, but the evidence is still too weak or indirect to close the goal yet."
        : "The latest step looks promising, but it still needs a direct bounded verification before the goal can be marked complete.",
      "medium",
    );
  }

  if (writeOnlyEvidence || looksProgress(combined) || (testSuccess && !resolved)) {
    return buildGoalEvaluation(
      "progressing",
      writeOnlyEvidence
        ? "The latest step made bounded changes, but a successful write alone does not prove the goal is complete."
        : testSuccess && !resolved
          ? "The latest bounded check succeeded, but that alone does not confirm the top-level goal is complete yet."
          : "The latest step appears to have made bounded progress, but the final outcome is not confirmed yet.",
      writeOnlyEvidence || testSuccess ? "medium" : "low",
    );
  }

  return buildGoalEvaluation(
    "needs-verification",
    "The latest bounded result is still too ambiguous to conservatively mark the goal complete.",
    "low",
  );
}