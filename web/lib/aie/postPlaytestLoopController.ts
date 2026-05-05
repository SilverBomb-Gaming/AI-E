import type { AutoRecordOutcomeResult } from "./autoOutcomeRecording";
import type { ControlledExecutionDiff } from "./controlledPatchExecutor";
import {
  decidePostPlaytestNextAction,
  type PostPlaytestDecisionResult,
} from "./postPlaytestDecisionEngine";
import {
  buildPostPlaytestExecutionPlan,
  type PostPlaytestExecutionPlanResult,
} from "./postPlaytestExecutionEngine";
import {
  executePostPlaytestFix,
  type PostPlaytestExecutionCheckResult,
  type PostPlaytestExecutionResult,
  type PostPlaytestExecutorInput,
  type PostPlaytestValidationRerunResult,
} from "./postPlaytestExecutor";
import {
  buildPostPlaytestFixPlan,
  type PostPlaytestFixPlanResult,
} from "./postPlaytestFixPlanner";
import {
  selectPostPlaytestStrategy,
  type PostPlaytestStrategySelectorResult,
} from "./postPlaytestStrategySelector";

export type PostPlaytestLoopControllerStatus =
  | "loop_completed"
  | "loop_stopped_success"
  | "loop_stopped_failure"
  | "loop_blocked"
  | "retry_limit_reached";

export type PostPlaytestLoopControllerResult = {
  status: PostPlaytestLoopControllerStatus;
  iterations_completed: number;
  max_iterations: number;
  selected_strategies: string[];
  executed_actions: string[];
  validation_results: string[];
  learning_results: string[];
  stop_reason: string;
  rollback_events: string[];
  confidence: "low" | "medium" | "high";
};

export type PostPlaytestLoopIterationInput = {
  file_changes: ControlledExecutionDiff[];
  allowed_roots?: string[];
  post_execution_check?: () => Promise<PostPlaytestExecutionCheckResult>;
  rerun_validation: () => Promise<PostPlaytestValidationRerunResult>;
  followup_learning?: () => Promise<AutoRecordOutcomeResult | null>;
};

export type PostPlaytestLoopIterationContext = {
  iteration: number;
  max_iterations: number;
  learning: AutoRecordOutcomeResult | null;
  decision: PostPlaytestDecisionResult;
  strategy_selection: PostPlaytestStrategySelectorResult;
  fix_plan: PostPlaytestFixPlanResult;
  execution_plan: PostPlaytestExecutionPlanResult;
  selected_strategies: string[];
  executed_actions: string[];
  validation_results: string[];
  learning_results: string[];
  rollback_events: string[];
};

export type PostPlaytestLoopControllerInput = {
  operator_approval: boolean;
  max_iterations: number;
  initial_learning: AutoRecordOutcomeResult | null;
  create_iteration: (
    context: PostPlaytestLoopIterationContext,
  ) => Promise<PostPlaytestLoopIterationInput | null> | PostPlaytestLoopIterationInput | null;
  execute_fix?: (
    input: PostPlaytestExecutorInput,
  ) => Promise<PostPlaytestExecutionResult>;
};

const HARD_MAX_ITERATIONS = 2;
const LOOP_ALLOWED_FILE_SCOPES = [
  "orchestrator_lane/Tools/EnemyAIDemoStandalone/Assets/Scripts",
  "orchestrator_lane/Tools/EnemyAIDemoStandalone/ProjectSettings",
  "web/scripts",
];
const FORBIDDEN_PATH_SEGMENT_PATTERN = /(^|[\\/])(node_modules|Library|Temp|Logs|\.aie|\.aie-state)([\\/]|$)/i;
const GENERATED_FILE_PATTERN = /(\.aie-backup(?:-[^\\/]+)?$|\.bak$|\.tmp$|\.log$|\.jsonl$|\.tsbuildinfo$)/i;

function clampMaxIterations(value: number): number {
  if (!Number.isFinite(value)) {
    return HARD_MAX_ITERATIONS;
  }

  return Math.max(1, Math.min(HARD_MAX_ITERATIONS, Math.trunc(value)));
}

function createResult(
  status: PostPlaytestLoopControllerStatus,
  stopReason: string,
  overrides: Partial<PostPlaytestLoopControllerResult> = {},
): PostPlaytestLoopControllerResult {
  return {
    status,
    iterations_completed: overrides.iterations_completed ?? 0,
    max_iterations: overrides.max_iterations ?? HARD_MAX_ITERATIONS,
    selected_strategies: overrides.selected_strategies ?? [],
    executed_actions: overrides.executed_actions ?? [],
    validation_results: overrides.validation_results ?? [],
    learning_results: overrides.learning_results ?? [],
    stop_reason: stopReason,
    rollback_events: overrides.rollback_events ?? [],
    confidence: overrides.confidence ?? "medium",
  };
}

function summarizeLearningResult(
  label: string,
  learning: AutoRecordOutcomeResult | null,
): string {
  if (!learning) {
    return `${label}: no learning result was available.`;
  }

  if (learning.status === "blocked") {
    return `${label}: blocked - ${learning.reason}`;
  }

  const inferredResult = learning.evaluation.parsedResult.inferredResult;
  return `${label}: ${learning.status} ${inferredResult} for ${learning.feature}`;
}

function summarizeAction(iteration: number, executionResult: PostPlaytestExecutionResult): string {
  if (executionResult.modified_files.length > 0) {
    return `iteration ${iteration}: ${executionResult.status} ${executionResult.modified_files.join(", ")}`;
  }

  return `iteration ${iteration}: ${executionResult.status}`;
}

function summarizeValidation(iteration: number, executionResult: PostPlaytestExecutionResult): string {
  return `iteration ${iteration}: rerun requested=${executionResult.validation_rerun_requested ? "yes" : "no"}, completed=${executionResult.validation_rerun_completed ? "yes" : "no"} - ${executionResult.reason}`;
}

function summarizeStrategy(iteration: number, strategy: PostPlaytestStrategySelectorResult): string {
  if (!strategy.selected_strategy_id || !strategy.selected_strategy_label) {
    return `iteration ${iteration}: no strategy selected`;
  }

  return `iteration ${iteration}: ${strategy.selected_strategy_id} (${strategy.selected_strategy_label})`;
}

function normalizeLoopPath(value: string): string {
  return value.replace(/\\/g, "/").trim();
}

function validateLoopFileChange(change: ControlledExecutionDiff): string | null {
  const normalizedPath = normalizeLoopPath(change.file_path);

  if (!normalizedPath) {
    return "The bounded loop requires concrete file targets for every guarded iteration.";
  }

  if (FORBIDDEN_PATH_SEGMENT_PATTERN.test(normalizedPath)) {
    return `The bounded loop target ${normalizedPath} falls inside a forbidden generated or runtime directory.`;
  }

  if (GENERATED_FILE_PATTERN.test(normalizedPath)) {
    return `The bounded loop target ${normalizedPath} looks like a generated artifact, which is outside the approved scope.`;
  }

  return null;
}

function validateIterationInput(
  iterationInput: PostPlaytestLoopIterationInput,
  strategySelection: PostPlaytestStrategySelectorResult,
  executionPlan: PostPlaytestExecutionPlanResult,
): string | null {
  if (!Array.isArray(iterationInput.file_changes) || iterationInput.file_changes.length === 0) {
    return "The bounded loop requires explicit guarded file changes before each iteration can execute.";
  }

  if (iterationInput.file_changes.length > 2) {
    return "The bounded loop exceeded the hard limit of two file changes in a single iteration.";
  }

  for (const change of iterationInput.file_changes) {
    const blocker = validateLoopFileChange(change);
    if (blocker) {
      return blocker;
    }

    const normalizedPath = normalizeLoopPath(change.file_path);
    const strategyScopes = strategySelection.candidate_strategies
      .find((candidate) => candidate.strategy_id === strategySelection.selected_strategy_id)
      ?.allowed_file_scopes
      .map(normalizeLoopPath) ?? [];
    const executionScopes = executionPlan.allowed_file_scopes.map(normalizeLoopPath);

    if (strategyScopes.length > 0 && !strategyScopes.some((scope) => normalizedPath === scope || normalizedPath.startsWith(`${scope}/`))) {
      return `The bounded loop target ${normalizedPath} falls outside the selected strategy scope ${strategySelection.selected_strategy_id}.`;
    }

    if (executionScopes.length > 0 && !executionScopes.some((scope) => normalizedPath === scope || normalizedPath.startsWith(`${scope}/`))) {
      return `The bounded loop target ${normalizedPath} falls outside the controlled execution envelope for this iteration.`;
    }
  }

  if (typeof iterationInput.rerun_validation !== "function") {
    return "The bounded loop requires a reviewed Unity validation rerun for every guarded iteration.";
  }

  return null;
}

function mergeConfidence(
  current: "low" | "medium" | "high",
  next: "low" | "medium" | "high",
): "low" | "medium" | "high" {
  if (current === "low" || next === "low") {
    return "low";
  }

  if (current === "medium" || next === "medium") {
    return "medium";
  }

  return "high";
}

export async function runPostPlaytestLoop(
  input: PostPlaytestLoopControllerInput,
): Promise<PostPlaytestLoopControllerResult> {
  const maxIterations = clampMaxIterations(input.max_iterations);
  const executedActions: string[] = [];
  const selectedStrategies: string[] = [];
  const validationResults: string[] = [];
  const learningResults: string[] = [
    summarizeLearningResult("initial learning", input.initial_learning),
  ];
  const rollbackEvents: string[] = [];
  let confidence: "low" | "medium" | "high" = "high";
  let currentLearning = input.initial_learning;
  const failedStrategyIds = new Set<string>();
  const executeFix = input.execute_fix ?? executePostPlaytestFix;

  if (!input.operator_approval) {
    return createResult(
      "loop_blocked",
      "The bounded autonomous loop requires explicit operator approval before the first guarded iteration can begin.",
      {
        max_iterations: maxIterations,
        selected_strategies: selectedStrategies,
        learning_results: learningResults,
        confidence: "high",
      },
    );
  }

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const decision = decidePostPlaytestNextAction(currentLearning);
    const strategySelection = selectPostPlaytestStrategy({
      decision,
      allowed_file_scopes: LOOP_ALLOWED_FILE_SCOPES,
      failed_strategy_ids: Array.from(failedStrategyIds),
    });
    confidence = mergeConfidence(confidence, strategySelection.confidence);

    if (strategySelection.status === "operator_review_required") {
      return createResult(
        "loop_blocked",
        strategySelection.reason,
        {
          iterations_completed: iteration - 1,
          max_iterations: maxIterations,
          selected_strategies: selectedStrategies,
          executed_actions: executedActions,
          validation_results: validationResults,
          learning_results: learningResults,
          rollback_events: rollbackEvents,
          confidence,
        },
      );
    }

    if (strategySelection.status === "strategy_blocked") {
      return createResult(
        "loop_blocked",
        strategySelection.reason,
        {
          iterations_completed: iteration - 1,
          max_iterations: maxIterations,
          selected_strategies: selectedStrategies,
          executed_actions: executedActions,
          validation_results: validationResults,
          learning_results: learningResults,
          rollback_events: rollbackEvents,
          confidence,
        },
      );
    }

    const fixPlan = buildPostPlaytestFixPlan(decision, strategySelection);
    const executionPlan = buildPostPlaytestExecutionPlan(fixPlan);
    confidence = mergeConfidence(confidence, executionPlan.confidence);

    if (decision.status === "ready_for_next_feature") {
      return createResult(
        iteration === 1 ? "loop_stopped_success" : "loop_completed",
        iteration === 1
          ? "The bounded loop stopped safely because the latest learning result already marked the feature ready for the next target."
          : `The bounded loop completed after ${iteration - 1} guarded iteration(s) and the latest learning result marked the feature ready for the next target.`,
        {
          iterations_completed: iteration - 1,
          max_iterations: maxIterations,
          selected_strategies: selectedStrategies,
          executed_actions: executedActions,
          validation_results: validationResults,
          learning_results: learningResults,
          rollback_events: rollbackEvents,
          confidence,
        },
      );
    }

    if (decision.status !== "retry_recommended" || executionPlan.status !== "execution_ready") {
      return createResult(
        "loop_blocked",
        executionPlan.reason,
        {
          iterations_completed: iteration - 1,
          max_iterations: maxIterations,
          executed_actions: executedActions,
          validation_results: validationResults,
          learning_results: learningResults,
          rollback_events: rollbackEvents,
          confidence: mergeConfidence(confidence, decision.confidence),
        },
      );
    }

    const iterationInput = await input.create_iteration({
      iteration,
      max_iterations: maxIterations,
      learning: currentLearning,
      decision,
      strategy_selection: strategySelection,
      fix_plan: fixPlan,
      execution_plan: executionPlan,
      selected_strategies: selectedStrategies.slice(),
      executed_actions: executedActions.slice(),
      validation_results: validationResults.slice(),
      learning_results: learningResults.slice(),
      rollback_events: rollbackEvents.slice(),
    });

    if (!iterationInput) {
      return createResult(
        "loop_blocked",
        `The bounded loop could not materialize a guarded iteration package for iteration ${iteration}.`,
        {
          iterations_completed: iteration - 1,
          max_iterations: maxIterations,
          selected_strategies: selectedStrategies,
          executed_actions: executedActions,
          validation_results: validationResults,
          learning_results: learningResults,
          rollback_events: rollbackEvents,
          confidence,
        },
      );
    }

    const iterationBlocker = validateIterationInput(iterationInput, strategySelection, executionPlan);
    if (iterationBlocker) {
      return createResult(
        "loop_blocked",
        iterationBlocker,
        {
          iterations_completed: iteration - 1,
          max_iterations: maxIterations,
          selected_strategies: selectedStrategies,
          executed_actions: executedActions,
          validation_results: validationResults,
          learning_results: learningResults,
          rollback_events: rollbackEvents,
          confidence,
        },
      );
    }

    const executionResult = await executeFix({
      execution_plan: executionPlan,
      operator_approval: true,
      retry_count: 0,
      file_changes: iterationInput.file_changes,
      allowed_roots: iterationInput.allowed_roots,
      post_execution_check: iterationInput.post_execution_check,
      rerun_validation: iterationInput.rerun_validation,
    });

    selectedStrategies.push(summarizeStrategy(iteration, strategySelection));
    executedActions.push(summarizeAction(iteration, executionResult));
    validationResults.push(summarizeValidation(iteration, executionResult));
    confidence = mergeConfidence(confidence, executionResult.confidence);

    if (executionResult.status === "rolled_back") {
      rollbackEvents.push(`iteration ${iteration}: ${executionResult.reason}`);
      return createResult(
        "loop_stopped_failure",
        `The bounded loop stopped after a rollback event in iteration ${iteration}: ${executionResult.reason}`,
        {
          iterations_completed: iteration,
          max_iterations: maxIterations,
          selected_strategies: selectedStrategies,
          executed_actions: executedActions,
          validation_results: validationResults,
          learning_results: learningResults,
          rollback_events: rollbackEvents,
          confidence: "high",
        },
      );
    }

    if (executionResult.status === "retry_limit_reached") {
      return createResult(
        "retry_limit_reached",
        executionResult.reason,
        {
          iterations_completed: iteration - 1,
          max_iterations: maxIterations,
          selected_strategies: selectedStrategies,
          executed_actions: executedActions,
          validation_results: validationResults,
          learning_results: learningResults,
          rollback_events: rollbackEvents,
          confidence,
        },
      );
    }

    if (executionResult.status !== "executed") {
      return createResult(
        "loop_blocked",
        executionResult.reason,
        {
          iterations_completed: iteration - 1,
          max_iterations: maxIterations,
          selected_strategies: selectedStrategies,
          executed_actions: executedActions,
          validation_results: validationResults,
          learning_results: learningResults,
          rollback_events: rollbackEvents,
          confidence,
        },
      );
    }

    if (!executionResult.followup_learning_required) {
      return createResult(
        iteration === maxIterations ? "loop_completed" : "loop_stopped_success",
        `The bounded loop stopped after iteration ${iteration} because no follow-up learning was required.`,
        {
          iterations_completed: iteration,
          max_iterations: maxIterations,
          selected_strategies: selectedStrategies,
          executed_actions: executedActions,
          validation_results: validationResults,
          learning_results: learningResults,
          rollback_events: rollbackEvents,
          confidence,
        },
      );
    }

    if (typeof iterationInput.followup_learning !== "function") {
      return createResult(
        "loop_blocked",
        `The bounded loop completed iteration ${iteration}, but no follow-up learning callback was provided for the next decision step.`,
        {
          iterations_completed: iteration,
          max_iterations: maxIterations,
          selected_strategies: selectedStrategies,
          executed_actions: executedActions,
          validation_results: validationResults,
          learning_results: learningResults,
          rollback_events: rollbackEvents,
          confidence,
        },
      );
    }

    currentLearning = await iterationInput.followup_learning();
    learningResults.push(summarizeLearningResult(`iteration ${iteration} follow-up learning`, currentLearning));

    if (
      strategySelection.selected_strategy_id
      && currentLearning
      && currentLearning.status !== "blocked"
      && currentLearning.evaluation.parsedResult.inferredResult === "fail"
    ) {
      failedStrategyIds.add(strategySelection.selected_strategy_id);
    }

    const nextDecision = decidePostPlaytestNextAction(currentLearning);
    confidence = mergeConfidence(confidence, nextDecision.confidence);

    if (nextDecision.status === "ready_for_next_feature") {
      return createResult(
        iteration === maxIterations ? "loop_completed" : "loop_stopped_success",
        `The bounded loop stopped after iteration ${iteration} because the follow-up learning result marked the feature ready for the next target.`,
        {
          iterations_completed: iteration,
          max_iterations: maxIterations,
          selected_strategies: selectedStrategies,
          executed_actions: executedActions,
          validation_results: validationResults,
          learning_results: learningResults,
          rollback_events: rollbackEvents,
          confidence,
        },
      );
    }

    if (nextDecision.status === "retry_recommended") {
      if (iteration >= maxIterations) {
        return createResult(
          "retry_limit_reached",
          `The bounded loop reached its retry budget after ${iteration} iteration(s) and stopped on repeated failure evidence.`,
          {
            iterations_completed: iteration,
            max_iterations: maxIterations,
            selected_strategies: selectedStrategies,
            executed_actions: executedActions,
            validation_results: validationResults,
            learning_results: learningResults,
            rollback_events: rollbackEvents,
            confidence,
          },
        );
      }

      continue;
    }

    return createResult(
      "loop_blocked",
      nextDecision.reason,
      {
        iterations_completed: iteration,
        max_iterations: maxIterations,
        selected_strategies: selectedStrategies,
        executed_actions: executedActions,
        validation_results: validationResults,
        learning_results: learningResults,
        rollback_events: rollbackEvents,
        confidence,
      },
    );
  }

  return createResult(
    "retry_limit_reached",
    `The bounded loop reached its hard iteration limit of ${maxIterations}.`,
    {
      iterations_completed: maxIterations,
      max_iterations: maxIterations,
      selected_strategies: selectedStrategies,
      executed_actions: executedActions,
      validation_results: validationResults,
      learning_results: learningResults,
      rollback_events: rollbackEvents,
      confidence,
    },
  );
}