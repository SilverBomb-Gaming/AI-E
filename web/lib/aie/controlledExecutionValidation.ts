import { readFile, stat } from "node:fs/promises";

import { assertAllowedExecutionPath, getDefaultAllowedExecutionRoots } from "./executionPathPolicy";
import type { ControlledExecutionDiff, ControlledExecutionResult } from "./controlledPatchExecutor";
import type { ReviewedPatchApplicationPacket } from "./reviewedPatchApplicationExecutor";

export type ControlledValidationStatus =
  | "validation_passed"
  | "validation_failed"
  | "validation_needs_review"
  | "validation_blocked";

export type ValidationRecommendation = "keep_changes" | "rollback" | "review_required";

export type ValidationCheck = {
  check_id: string;
  title: string;
  status: "passed" | "failed" | "review_required";
  details: string;
  file_path?: string;
};

export type ValidationFailure = {
  code:
    | "execution_not_applied"
    | "missing_application_packet"
    | "missing_preview_diff"
    | "unexpected_changed_file"
    | "missing_changed_file"
    | "forbidden_target"
    | "missing_file"
    | "content_mismatch"
    | "unexpected_existing_deleted_file";
  message: string;
  file_path?: string;
  expected?: string;
  actual?: string;
};

export type ControlledValidationInput = {
  executionResult: ControlledExecutionResult;
  applicationPacket: ReviewedPatchApplicationPacket | null;
  createdAt?: string;
  allowedRoots?: string[];
};

export type ControlledValidationReport = {
  validation_id: string;
  created_at: string;
  execution_status: ControlledExecutionResult["status"];
  validation_status: ControlledValidationStatus;
  recommendation: ValidationRecommendation;
  checked_files: string[];
  failed_files: string[];
  summary: string;
};

export type ControlledValidationResult = {
  validation_id: string;
  created_at: string;
  status: ControlledValidationStatus;
  recommendation: ValidationRecommendation;
  checks: ValidationCheck[];
  failures: ValidationFailure[];
  explanation: string;
  report: ControlledValidationReport;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function normalizePath(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/")
    .trim();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function buildValidationId(applicationPacketId: string | undefined, createdAt: string): string {
  return `controlled-validation-${createdAt.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000"}-${applicationPacketId ?? "no-packet"}`;
}

function buildCheckId(prefix: string, index: number): string {
  return `${prefix}-${index + 1}`;
}

function buildAllowedTargets(applicationPacket: ReviewedPatchApplicationPacket | null): string[] {
  if (!applicationPacket) {
    return [];
  }

  const targets = applicationPacket.affected_targets.length > 0
    ? applicationPacket.affected_targets
    : applicationPacket.git_commit_plan.stage_only;

  return unique(targets.map((target) => normalizePath(target)).filter(Boolean));
}

async function readCurrentSnapshot(targetPath: string, allowedRoots?: string[]): Promise<string | undefined> {
  const allowedPath = assertAllowedExecutionPath(targetPath, allowedRoots ?? getDefaultAllowedExecutionRoots());
  try {
    const fileStats = await stat(allowedPath.absolutePath);
    if (!fileStats.isFile()) {
      return undefined;
    }

    return (await readFile(allowedPath.absolutePath, "utf8")).replace(/\r\n/g, "\n");
  } catch {
    return undefined;
  }
}

function shouldRequireReviewForRequirement(title: string, details: string): boolean {
  const combined = `${normalizeText(title)} ${normalizeText(details)}`.toLowerCase();
  return combined.includes("manual-review")
    || combined.includes("manual review")
    || combined.includes("requires reviewer")
    || combined.includes("human review");
}

export async function validateChangedFiles(input: ControlledValidationInput): Promise<{ checks: ValidationCheck[]; failures: ValidationFailure[] }> {
  const checks: ValidationCheck[] = [];
  const failures: ValidationFailure[] = [];
  const execution = input.executionResult;
  const allowedTargets = new Set(buildAllowedTargets(input.applicationPacket));
  const previewPaths = unique(execution.preview_diff.map((diff) => normalizePath(diff.file_path)).filter(Boolean));
  const changedPaths = unique(execution.changed_files.map((filePath) => normalizePath(filePath)).filter(Boolean));

  previewPaths.forEach((filePath, index) => {
    checks.push({
      check_id: buildCheckId("preview-target", index),
      title: `Preview target registered for ${filePath}`,
      status: changedPaths.includes(filePath) ? "passed" : "failed",
      details: changedPaths.includes(filePath)
        ? "Execution result recorded this previewed file as changed."
        : "Execution result did not record this previewed file as changed.",
      file_path: filePath,
    });

    if (!changedPaths.includes(filePath)) {
      failures.push({
        code: "missing_changed_file",
        message: `Execution result did not record expected changed file ${filePath}.`,
        file_path: filePath,
      });
    }
  });

  changedPaths.forEach((filePath, index) => {
    if (!previewPaths.includes(filePath)) {
      checks.push({
        check_id: buildCheckId("unexpected-change", index),
        title: `Unexpected changed file ${filePath}`,
        status: "failed",
        details: "Execution result reported a changed file that was not present in the preview diff.",
        file_path: filePath,
      });
      failures.push({
        code: "unexpected_changed_file",
        message: `Execution result reported unexpected changed file ${filePath}.`,
        file_path: filePath,
      });
    }

    if (allowedTargets.size > 0 && !allowedTargets.has(filePath)) {
      checks.push({
        check_id: buildCheckId("forbidden-target", index),
        title: `Forbidden target ${filePath}`,
        status: "failed",
        details: "Changed file falls outside the reviewed application packet targets.",
        file_path: filePath,
      });
      failures.push({
        code: "forbidden_target",
        message: `Changed file ${filePath} falls outside the reviewed application packet targets.`,
        file_path: filePath,
      });
    }
  });

  for (const [index, diff] of execution.preview_diff.entries()) {
    const filePath = normalizePath(diff.file_path);
    const currentSnapshot = await readCurrentSnapshot(filePath, input.allowedRoots);

    if (diff.change_type === "delete") {
      const deleted = typeof currentSnapshot === "undefined";
      checks.push({
        check_id: buildCheckId("deleted-file", index),
        title: `Deleted file removed for ${filePath}`,
        status: deleted ? "passed" : "failed",
        details: deleted ? "File is absent as expected after deletion." : "File still exists after a reviewed delete change.",
        file_path: filePath,
      });

      if (!deleted) {
        failures.push({
          code: "unexpected_existing_deleted_file",
          message: `Deleted target ${filePath} still exists after controlled execution.`,
          file_path: filePath,
          actual: currentSnapshot,
        });
      }

      continue;
    }

    if (typeof currentSnapshot !== "string") {
      checks.push({
        check_id: buildCheckId("missing-file", index),
        title: `Changed file exists for ${filePath}`,
        status: "failed",
        details: "Changed file is missing after controlled execution.",
        file_path: filePath,
      });
      failures.push({
        code: "missing_file",
        message: `Changed file ${filePath} is missing after controlled execution.`,
        file_path: filePath,
      });
      continue;
    }

    checks.push({
      check_id: buildCheckId("file-exists", index),
      title: `Changed file exists for ${filePath}`,
      status: "passed",
      details: "Changed file exists after controlled execution.",
      file_path: filePath,
    });

    const expectedSnapshot = (diff.after_snapshot ?? "").replace(/\r\n/g, "\n");
    const matchesExpected = currentSnapshot === expectedSnapshot;
    checks.push({
      check_id: buildCheckId("content-match", index),
      title: `Changed file content matches preview for ${filePath}`,
      status: matchesExpected ? "passed" : "failed",
      details: matchesExpected
        ? "Actual file contents match the approved preview diff."
        : "Actual file contents differ from the approved preview diff.",
      file_path: filePath,
    });

    if (!matchesExpected) {
      failures.push({
        code: "content_mismatch",
        message: `Changed file ${filePath} does not match the approved preview diff.`,
        file_path: filePath,
        expected: expectedSnapshot,
        actual: currentSnapshot,
      });
    }
  }

  return { checks, failures };
}

export function evaluateValidationResult(params: {
  executionResult: ControlledExecutionResult;
  applicationPacket: ReviewedPatchApplicationPacket | null;
  checks: ValidationCheck[];
  failures: ValidationFailure[];
}): { status: ControlledValidationStatus; recommendation: ValidationRecommendation; explanation: string } {
  if (params.executionResult.status !== "applied") {
    return {
      status: "validation_blocked",
      recommendation: "review_required",
      explanation: `Controlled execution validation is blocked because execution status is ${params.executionResult.status}, not applied.`,
    };
  }

  if (!params.applicationPacket) {
    return {
      status: "validation_blocked",
      recommendation: "review_required",
      explanation: "Controlled execution validation is blocked because no reviewed application packet was provided.",
    };
  }

  if (params.failures.length > 0) {
    return {
      status: "validation_failed",
      recommendation: "rollback",
      explanation: `Controlled execution validation failed because ${params.failures.map((failure) => failure.message).join(" ")}`,
    };
  }

  const reviewRequired = params.checks.some((check) => check.status === "review_required");
  if (reviewRequired) {
    return {
      status: "validation_needs_review",
      recommendation: "review_required",
      explanation: "Controlled execution validation found no direct file mismatches, but manual or playtest review is still required.",
    };
  }

  return {
    status: "validation_passed",
    recommendation: "keep_changes",
    explanation: "Controlled execution validation confirmed the applied files match the approved preview and no forbidden changes were detected.",
  };
}

export function buildValidationReport(result: ControlledValidationResult): ControlledValidationReport {
  return {
    validation_id: result.validation_id,
    created_at: result.created_at,
    execution_status: "applied",
    validation_status: result.status,
    recommendation: result.recommendation,
    checked_files: unique(result.checks.map((check) => normalizePath(check.file_path)).filter(Boolean)),
    failed_files: unique(result.failures.map((failure) => normalizePath(failure.file_path)).filter(Boolean)),
    summary: `${result.status} -> ${result.recommendation}`,
  };
}

export async function runControlledValidation(input: ControlledValidationInput): Promise<ControlledValidationResult> {
  const createdAt = normalizeText(input.createdAt) || new Date().toISOString();
  const validationId = buildValidationId(input.applicationPacket?.application_packet_id, createdAt);

  if (input.executionResult.status !== "applied") {
    const blockedResult: ControlledValidationResult = {
      validation_id: validationId,
      created_at: createdAt,
      status: "validation_blocked",
      recommendation: "review_required",
      checks: [{
        check_id: buildCheckId("execution-state", 0),
        title: "Execution result is applied",
        status: "failed",
        details: `Execution status is ${input.executionResult.status}, so post-execution validation cannot proceed.`,
      }],
      failures: [{
        code: "execution_not_applied",
        message: `Controlled execution validation requires an applied execution result, but received ${input.executionResult.status}.`,
      }],
      explanation: `Controlled execution validation is blocked because execution status is ${input.executionResult.status}, not applied.`,
      report: {
        validation_id: validationId,
        created_at: createdAt,
        execution_status: input.executionResult.status,
        validation_status: "validation_blocked",
        recommendation: "review_required",
        checked_files: [],
        failed_files: [],
        summary: "validation_blocked -> review_required",
      },
    };

    return blockedResult;
  }

  if (!input.applicationPacket) {
    const blockedResult: ControlledValidationResult = {
      validation_id: validationId,
      created_at: createdAt,
      status: "validation_blocked",
      recommendation: "review_required",
      checks: [{
        check_id: buildCheckId("application-packet", 0),
        title: "Reviewed application packet is present",
        status: "failed",
        details: "No application packet was provided for controlled execution validation.",
      }],
      failures: [{
        code: "missing_application_packet",
        message: "Controlled execution validation requires a reviewed application packet.",
      }],
      explanation: "Controlled execution validation is blocked because no reviewed application packet was provided.",
      report: {
        validation_id: validationId,
        created_at: createdAt,
        execution_status: input.executionResult.status,
        validation_status: "validation_blocked",
        recommendation: "review_required",
        checked_files: [],
        failed_files: [],
        summary: "validation_blocked -> review_required",
      },
    };

    return blockedResult;
  }

  const { checks: fileChecks, failures } = await validateChangedFiles(input);
  const requirementChecks: ValidationCheck[] = input.applicationPacket.validation_requirements.map((requirement, index) => {
    const title = normalizeText((requirement as { title?: string }).title);
    const details = normalizeText((requirement as { details?: string }).details);
    const reviewRequired = shouldRequireReviewForRequirement(title, details);
    return {
      check_id: buildCheckId("validation-requirement", index),
      title: `Requirement recorded: ${title || `requirement ${index + 1}`}`,
      status: reviewRequired ? "review_required" : "passed",
      details: reviewRequired
        ? `Manual follow-up still required for: ${details || title}.`
        : `Structured validation requirement captured without shell execution: ${details || title}.`,
    };
  });

  const checks = [
    {
      check_id: buildCheckId("preview-diff", 0),
      title: "Execution preview diff exists",
      status: input.executionResult.preview_diff.length > 0 ? "passed" : "failed",
      details: input.executionResult.preview_diff.length > 0
        ? `Execution result includes ${input.executionResult.preview_diff.length} previewed file change(s).`
        : "Execution result did not include any preview diff entries.",
    },
    ...fileChecks,
    ...requirementChecks,
  ];

  if (input.executionResult.preview_diff.length === 0) {
    failures.push({
      code: "missing_preview_diff",
      message: "Controlled execution validation requires preview diff entries from the executor result.",
    });
  }

  const evaluation = evaluateValidationResult({
    executionResult: input.executionResult,
    applicationPacket: input.applicationPacket,
    checks,
    failures,
  });

  const result: ControlledValidationResult = {
    validation_id: validationId,
    created_at: createdAt,
    status: evaluation.status,
    recommendation: evaluation.recommendation,
    checks,
    failures,
    explanation: evaluation.explanation,
    report: {
      validation_id: validationId,
      created_at: createdAt,
      execution_status: input.executionResult.status,
      validation_status: evaluation.status,
      recommendation: evaluation.recommendation,
      checked_files: unique(checks.map((check) => normalizePath(check.file_path)).filter(Boolean)),
      failed_files: unique(failures.map((failure) => normalizePath(failure.file_path)).filter(Boolean)),
      summary: `${evaluation.status} -> ${evaluation.recommendation}`,
    },
  };

  return {
    ...result,
    report: buildValidationReport(result),
  };
}

export function summarizeValidation(result: ControlledValidationResult): string {
  return [
    `Controlled validation status: ${result.status}`,
    `Recommendation: ${result.recommendation}`,
    `Checks: ${result.checks.length}`,
    `Failures: ${result.failures.length}`,
    `Explanation: ${result.explanation}`,
  ].join("\n");
}