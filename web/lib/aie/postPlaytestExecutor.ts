import type { ControlledExecutionDiff } from "./controlledPatchExecutor";
import {
  executeControlledPatch,
  rollbackExecution,
} from "./controlledPatchExecutor";
import {
  runControlledValidation,
} from "./controlledExecutionValidation";
import {
  isPathWithinAllowedRoot,
  normalizeExecutionPath,
} from "./executionPathPolicy";
import type { PostPlaytestExecutionPlanResult } from "./postPlaytestExecutionEngine";
import type { ReviewedPatchApplicationPacket } from "./reviewedPatchApplicationExecutor";

export type PostPlaytestExecutionResultStatus =
  | "executed"
  | "rolled_back"
  | "blocked"
  | "operator_approval_required"
  | "no_action_needed"
  | "retry_limit_reached";

export type PostPlaytestExecutionResult = {
  status: PostPlaytestExecutionResultStatus;
  reason: string;
  modified_files: string[];
  rollback_available: boolean;
  retry_count: number;
  max_retry_count: number;
  validation_rerun_requested: boolean;
  validation_rerun_completed: boolean;
  followup_learning_required: boolean;
  confidence: "low" | "medium" | "high";
  source_feature?: string;
  source_outcome_session_key?: string;
};

export type PostPlaytestExecutionCheckResult = {
  passed: boolean;
  reason: string;
};

export type PostPlaytestValidationRerunResult = {
  completed: boolean;
  succeeded: boolean;
  reason: string;
};

export type PostPlaytestExecutorInput = {
  execution_plan: PostPlaytestExecutionPlanResult;
  operator_approval: boolean;
  retry_count: number;
  file_changes: ControlledExecutionDiff[];
  created_at?: string;
  allowed_roots?: string[];
  post_execution_check?: () => Promise<PostPlaytestExecutionCheckResult>;
  rerun_validation?: () => Promise<PostPlaytestValidationRerunResult>;
};

const BROAD_OR_AMBIGUOUS_CHANGE_PATTERN = /\b(broad|rewrite|refactor|new system|new module|ambiguous|unclear|sweeping)\b/i;

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePaths(values: string[]): string[] {
  return unique(values.map((value) => normalizeExecutionPath(value)));
}

function buildApplicationPacket(
  executionPlan: PostPlaytestExecutionPlanResult,
  fileChanges: ControlledExecutionDiff[],
  createdAt: string,
): ReviewedPatchApplicationPacket {
  const targets = normalizePaths(fileChanges.map((change) => change.file_path));

  return {
    application_packet_id: `post-playtest-application-${createdAt.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000"}`,
    source_draft_id: `post-playtest-draft-${createdAt}`,
    source_decision_id: `post-playtest-decision-${createdAt}`,
    source_patch_plan_id: `post-playtest-plan-${createdAt}`,
    source_dry_run_id: `post-playtest-dry-run-${createdAt}`,
    source_handoff_id: `post-playtest-handoff-${createdAt}`,
    source_artifact_id: `post-playtest-artifact-${createdAt}`,
    created_at: createdAt,
    interpreted_goal: executionPlan.reason,
    risk_level: executionPlan.confidence === "low" ? "medium" : "low",
    application_instructions: executionPlan.proposed_actions.slice(),
    affected_targets: targets,
    validation_requirements: [{
      title: "Run reviewed Unity validation",
      details: "Run one reviewed Unity validation rerun after applying the guarded post-playtest fix.",
      required: true,
    }],
    git_commit_plan: {
      commit_message: "reviewed post-playtest guarded fix",
      stage_only: targets,
      github_procedure: ["Stage only the guarded post-playtest targets after review approval."],
    },
    playtest_required: true,
    required_operator_review: true,
    human_approval_required: true,
    allowed_executor_actions: [
      "inspect target files",
      "apply reviewed file changes",
      "rerun reviewed Unity validation",
    ],
    disallowed_executor_actions: [
      "apply patches automatically outside approval scope",
      "commit automatically",
      "push automatically",
      "deploy",
      "run destructive commands",
      "access secrets",
      "bypass validation",
    ],
    completion_report_requirements: [
      "List changed files",
      "Preserve rollback metadata",
      "Record the reviewed Unity validation rerun result",
    ],
    next_operator_action: "execution_ready_review",
  };
}

function createResult(
  executionPlan: PostPlaytestExecutionPlanResult,
  status: PostPlaytestExecutionResultStatus,
  reason: string,
  overrides: Partial<PostPlaytestExecutionResult> = {},
): PostPlaytestExecutionResult {
  return {
    status,
    reason,
    modified_files: [],
    rollback_available: false,
    retry_count: overrides.retry_count ?? 0,
    max_retry_count: executionPlan.max_retry_count,
    validation_rerun_requested: false,
    validation_rerun_completed: false,
    followup_learning_required: false,
    confidence: executionPlan.confidence,
    source_feature: executionPlan.source_feature,
    source_outcome_session_key: executionPlan.source_outcome_session_key,
    ...overrides,
  };
}

function validateExecutionIntent(
  input: PostPlaytestExecutorInput,
  allowedRoots: string[],
): string | null {
  if (input.execution_plan.status === "no_action_needed") {
    return null;
  }

  if (input.execution_plan.status === "execution_blocked") {
    return input.execution_plan.reason;
  }

  if (input.execution_plan.status === "operator_approval_required") {
    return input.execution_plan.reason;
  }

  if (input.execution_plan.status !== "execution_ready") {
    return "The post-playtest execution plan is not in an executable state.";
  }

  if (input.execution_plan.requires_operator_approval !== true) {
    return "The post-playtest execution plan is unsafe because explicit operator approval is not required.";
  }

  if (input.retry_count >= input.execution_plan.max_retry_count) {
    return null;
  }

  if (!Array.isArray(input.file_changes) || input.file_changes.length === 0) {
    return "The post-playtest executor requires exact file changes before applying a guarded fix.";
  }

  if (input.file_changes.length > input.execution_plan.max_changed_files) {
    return `The guarded fix exceeds the allowed file budget of ${input.execution_plan.max_changed_files}.`;
  }

  if (allowedRoots.length === 0) {
    return "The post-playtest execution plan does not define any approved file scopes.";
  }

  for (const change of input.file_changes) {
    if (change.change_type !== "update") {
      return "The guarded post-playtest executor only allows narrow updates to existing files.";
    }

    const normalizedPath = normalizeExecutionPath(change.file_path);
    const withinScope = allowedRoots.some((allowedRoot) => isPathWithinAllowedRoot(normalizedPath, allowedRoot));
    if (!withinScope) {
      return `The guarded fix target ${normalizedPath} falls outside the approved file scopes.`;
    }

    if (BROAD_OR_AMBIGUOUS_CHANGE_PATTERN.test(normalizeText(change.summary_of_change))) {
      return `The guarded fix summary for ${normalizedPath} is too broad or ambiguous for automatic execution.`;
    }
  }

  if (typeof input.rerun_validation !== "function") {
    return "The guarded post-playtest executor requires a reviewed Unity validation rerun before keeping changes.";
  }

  return null;
}

export async function executePostPlaytestFix(
  input: PostPlaytestExecutorInput,
): Promise<PostPlaytestExecutionResult> {
  const executionPlan = input.execution_plan;
  const createdAt = normalizeText(input.created_at) || new Date().toISOString();
  const allowedRoots = normalizePaths(input.allowed_roots?.length ? input.allowed_roots : executionPlan.allowed_file_scopes);

  if (executionPlan.status === "no_action_needed") {
    return createResult(executionPlan, "no_action_needed", executionPlan.reason, {
      retry_count: input.retry_count,
    });
  }

  if (executionPlan.status === "operator_approval_required") {
    return createResult(executionPlan, "operator_approval_required", executionPlan.reason, {
      retry_count: input.retry_count,
    });
  }

  if (executionPlan.status === "execution_blocked") {
    return createResult(executionPlan, "blocked", executionPlan.reason, {
      retry_count: input.retry_count,
    });
  }

  if (!input.operator_approval) {
    return createResult(executionPlan, "operator_approval_required", "The guarded post-playtest fix is ready, but explicit operator approval is still required before execution.", {
      retry_count: input.retry_count,
    });
  }

  if (input.retry_count >= executionPlan.max_retry_count) {
    return createResult(executionPlan, "retry_limit_reached", `The guarded post-playtest retry limit of ${executionPlan.max_retry_count} has already been reached.`, {
      retry_count: input.retry_count,
    });
  }

  const validationBlocker = validateExecutionIntent(input, allowedRoots);
  if (validationBlocker) {
    return createResult(executionPlan, "blocked", validationBlocker, {
      retry_count: input.retry_count,
    });
  }

  const applicationPacket = buildApplicationPacket(executionPlan, input.file_changes, createdAt);
  const applied = await executeControlledPatch({
    applicationPacket,
    approval: true,
    fileChanges: input.file_changes,
    createdAt,
    allowedRoots,
  });

  const attemptedRetryCount = input.retry_count + 1;
  if (applied.status !== "applied") {
    return createResult(executionPlan, "blocked", applied.explanation, {
      modified_files: applied.changed_files,
      rollback_available: Boolean(applied.rollback_point && applied.rollback_point.entries.length > 0),
      retry_count: attemptedRetryCount,
    });
  }

  if (typeof input.post_execution_check === "function") {
    try {
      const checkResult = await input.post_execution_check();
      if (!checkResult.passed) {
        await rollbackExecution(applied.rollback_point, allowedRoots);
        return createResult(executionPlan, "rolled_back", checkResult.reason, {
          modified_files: applied.changed_files,
          rollback_available: true,
          retry_count: attemptedRetryCount,
        });
      }
    } catch (error) {
      await rollbackExecution(applied.rollback_point, allowedRoots);
      return createResult(executionPlan, "rolled_back", error instanceof Error ? error.message : "The guarded post-playtest checks threw before validation reran.", {
        modified_files: applied.changed_files,
        rollback_available: true,
        retry_count: attemptedRetryCount,
      });
    }
  }

  const fileValidation = await runControlledValidation({
    executionResult: applied,
    applicationPacket,
    createdAt,
    allowedRoots,
  });

  if (fileValidation.recommendation === "rollback") {
    await rollbackExecution(applied.rollback_point, allowedRoots);
    return createResult(executionPlan, "rolled_back", fileValidation.explanation, {
      modified_files: applied.changed_files,
      rollback_available: true,
      retry_count: attemptedRetryCount,
    });
  }

  let rerunResult: PostPlaytestValidationRerunResult;
  try {
    rerunResult = await input.rerun_validation!();
  } catch (error) {
    await rollbackExecution(applied.rollback_point, allowedRoots);
    return createResult(executionPlan, "rolled_back", error instanceof Error ? error.message : "The reviewed Unity validation rerun threw after applying the guarded fix.", {
      modified_files: applied.changed_files,
      rollback_available: true,
      retry_count: attemptedRetryCount,
      validation_rerun_requested: true,
    });
  }

  if (!rerunResult.completed || !rerunResult.succeeded) {
    await rollbackExecution(applied.rollback_point, allowedRoots);
    return createResult(executionPlan, "rolled_back", rerunResult.reason, {
      modified_files: applied.changed_files,
      rollback_available: true,
      retry_count: attemptedRetryCount,
      validation_rerun_requested: true,
      validation_rerun_completed: rerunResult.completed,
      followup_learning_required: rerunResult.completed,
    });
  }

  return createResult(executionPlan, "executed", "The guarded post-playtest fix applied successfully, completed one reviewed Unity validation rerun, and is ready for follow-up learning.", {
    modified_files: applied.changed_files,
    rollback_available: true,
    retry_count: attemptedRetryCount,
    validation_rerun_requested: true,
    validation_rerun_completed: true,
    followup_learning_required: true,
  });
}