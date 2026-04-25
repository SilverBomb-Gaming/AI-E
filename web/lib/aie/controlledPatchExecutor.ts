import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertAllowedExecutionPath, getDefaultAllowedExecutionRoots } from "./executionPathPolicy";
import type { ReviewedPatchApplicationPacket } from "./reviewedPatchApplicationExecutor";

export type ControlledExecutionStatus =
  | "awaiting_approval"
  | "ready_to_apply"
  | "applied"
  | "blocked"
  | "rolled_back";

export type ControlledExecutionChangeType = "add" | "update" | "delete";

export type ControlledExecutionDiff = {
  file_path: string;
  change_type: ControlledExecutionChangeType;
  before_snapshot?: string;
  after_snapshot?: string;
  summary_of_change: string;
  expected_before_snapshot?: string;
};

export type ControlledExecutionRollbackEntry = {
  file_path: string;
  change_type: ControlledExecutionChangeType;
  existed_before: boolean;
  before_snapshot?: string;
  after_snapshot?: string;
};

export type ControlledExecutionRollbackPoint = {
  rollback_id: string;
  application_packet_id: string;
  created_at: string;
  entries: ControlledExecutionRollbackEntry[];
};

export type ControlledExecutionLog = {
  timestamp: string;
  step: "preview" | "validate" | "apply" | "rollback";
  level: "info" | "blocked";
  message: string;
  file_path?: string;
};

export type ControlledExecutionBlocker = {
  code:
    | "missing_application_packet"
    | "missing_materialized_changes"
    | "approval_required"
    | "invalid_packet"
    | "high_risk"
    | "disallowed_action"
    | "target_not_allowed"
    | "duplicate_target"
    | "missing_after_snapshot"
    | "unexpected_existing_file"
    | "missing_existing_file"
    | "before_snapshot_mismatch"
    | "rollback_missing"
    | "apply_failed";
  message: string;
  recommended_next_action: "review" | "approve" | "revise" | "rollback";
};

export type ControlledExecutionInput = {
  applicationPacket: ReviewedPatchApplicationPacket | null;
  approval: boolean;
  fileChanges: ControlledExecutionDiff[];
  createdAt?: string;
  allowedRoots?: string[];
};

export type ControlledExecutionResult = {
  status: ControlledExecutionStatus;
  preview_diff: ControlledExecutionDiff[];
  rollback_point: ControlledExecutionRollbackPoint | null;
  logs: ControlledExecutionLog[];
  blockers: ControlledExecutionBlocker[];
  changed_files: string[];
  explanation: string;
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

function buildRollbackId(applicationPacketId: string, createdAt: string): string {
  return `controlled-rollback-${createdAt.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000"}-${applicationPacketId}`;
}

function createLog(
  createdAt: string,
  step: ControlledExecutionLog["step"],
  level: ControlledExecutionLog["level"],
  message: string,
  filePath?: string,
): ControlledExecutionLog {
  return {
    timestamp: createdAt,
    step,
    level,
    message,
    file_path: filePath,
  };
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

function getAllowedTargets(applicationPacket: ReviewedPatchApplicationPacket): string[] {
  const targets = applicationPacket.affected_targets.length > 0
    ? applicationPacket.affected_targets
    : applicationPacket.git_commit_plan.stage_only;

  return unique(targets.map((target) => normalizePath(target)).filter(Boolean));
}

function validateApplicationPacket(applicationPacket: ReviewedPatchApplicationPacket | null): ControlledExecutionBlocker[] {
  if (!applicationPacket) {
    return [{
      code: "missing_application_packet",
      message: "Controlled patch execution requires a reviewed application packet.",
      recommended_next_action: "review",
    }];
  }

  const blockers: ControlledExecutionBlocker[] = [];

  if (applicationPacket.required_operator_review !== true || applicationPacket.human_approval_required !== true) {
    blockers.push({
      code: "invalid_packet",
      message: "Controlled patch execution requires an application packet with explicit operator review and human approval flags.",
      recommended_next_action: "review",
    });
  }

  if (applicationPacket.risk_level === "high" || applicationPacket.risk_level === "blocked") {
    blockers.push({
      code: "high_risk",
      message: `Controlled patch execution is blocked while packet risk level is ${applicationPacket.risk_level}.`,
      recommended_next_action: "review",
    });
  }

  if (!Array.isArray(applicationPacket.validation_requirements) || applicationPacket.validation_requirements.length === 0) {
    blockers.push({
      code: "invalid_packet",
      message: "Controlled patch execution requires validation requirements in the reviewed application packet.",
      recommended_next_action: "review",
    });
  }

  if (!Array.isArray(applicationPacket.affected_targets) || applicationPacket.affected_targets.length === 0) {
    blockers.push({
      code: "invalid_packet",
      message: "Controlled patch execution requires affected targets in the reviewed application packet.",
      recommended_next_action: "review",
    });
  }

  return blockers;
}

export async function generatePatchDiff(
  applicationPacket: ReviewedPatchApplicationPacket | null,
  fileChanges: ControlledExecutionDiff[],
  allowedRoots?: string[],
): Promise<ControlledExecutionDiff[]> {
  if (!applicationPacket || !Array.isArray(fileChanges)) {
    return [];
  }

  const preview: ControlledExecutionDiff[] = [];
  for (const change of fileChanges) {
    const filePath = normalizePath(change.file_path);
    const beforeSnapshot = await readCurrentSnapshot(filePath, allowedRoots);
    preview.push({
      file_path: filePath,
      change_type: change.change_type,
      before_snapshot: beforeSnapshot,
      after_snapshot: change.change_type === "delete" ? undefined : change.after_snapshot,
      summary_of_change: normalizeText(change.summary_of_change) || `Apply reviewed ${change.change_type} for ${filePath}.`,
      expected_before_snapshot: change.expected_before_snapshot,
    });
  }

  return preview;
}

export function validateExecutionSafety(
  applicationPacket: ReviewedPatchApplicationPacket | null,
  previewDiff: ControlledExecutionDiff[],
): ControlledExecutionBlocker[] {
  const blockers = validateApplicationPacket(applicationPacket);

  if (!applicationPacket) {
    return blockers;
  }

  if (!Array.isArray(previewDiff) || previewDiff.length === 0) {
    blockers.push({
      code: "missing_materialized_changes",
      message: "Controlled patch execution requires exact materialized file changes.",
      recommended_next_action: "revise",
    });
    return blockers;
  }

  const allowedTargets = new Set(getAllowedTargets(applicationPacket));
  const seenTargets = new Set<string>();
  const blockedActions = applicationPacket.disallowed_executor_actions.map((action) => normalizeText(action).toLowerCase());
  const genericMutationBlocked = blockedActions.some((action) => action === "write files" || action === "apply patches" || action === "delete files");

  if (genericMutationBlocked) {
    blockers.push({
      code: "disallowed_action",
      message: "The reviewed application packet explicitly disallows manual patch application for this execution step.",
      recommended_next_action: "review",
    });
  }

  previewDiff.forEach((change) => {
    const filePath = normalizePath(change.file_path);
    if (seenTargets.has(filePath)) {
      blockers.push({
        code: "duplicate_target",
        message: `Controlled patch execution received duplicate file changes for ${filePath}.`,
        recommended_next_action: "revise",
      });
      return;
    }
    seenTargets.add(filePath);

    if (!allowedTargets.has(filePath)) {
      blockers.push({
        code: "target_not_allowed",
        message: `Controlled patch execution cannot modify ${filePath} because it is outside the reviewed packet targets.`,
        recommended_next_action: "revise",
      });
    }

    if ((change.change_type === "add" || change.change_type === "update") && typeof change.after_snapshot !== "string") {
      blockers.push({
        code: "missing_after_snapshot",
        message: `Controlled patch execution requires after_snapshot content for ${filePath}.`,
        recommended_next_action: "revise",
      });
    }

    if (change.change_type === "add" && typeof change.before_snapshot === "string") {
      blockers.push({
        code: "unexpected_existing_file",
        message: `Controlled patch execution expected ${filePath} to be new, but it already exists.`,
        recommended_next_action: "review",
      });
    }

    if ((change.change_type === "update" || change.change_type === "delete") && typeof change.before_snapshot !== "string") {
      blockers.push({
        code: "missing_existing_file",
        message: `Controlled patch execution expected existing file contents for ${filePath}.`,
        recommended_next_action: "review",
      });
    }

    if (
      typeof change.expected_before_snapshot === "string"
      && typeof change.before_snapshot === "string"
      && change.expected_before_snapshot.replace(/\r\n/g, "\n") !== change.before_snapshot
    ) {
      blockers.push({
        code: "before_snapshot_mismatch",
        message: `Controlled patch execution detected unexpected current file contents for ${filePath}.`,
        recommended_next_action: "review",
      });
    }
  });

  return blockers;
}

export function createRollbackPoint(
  applicationPacket: ReviewedPatchApplicationPacket,
  previewDiff: ControlledExecutionDiff[],
  createdAt?: string,
): ControlledExecutionRollbackPoint {
  const timestamp = normalizeText(createdAt) || applicationPacket.created_at || new Date().toISOString();
  return {
    rollback_id: buildRollbackId(applicationPacket.application_packet_id, timestamp),
    application_packet_id: applicationPacket.application_packet_id,
    created_at: timestamp,
    entries: previewDiff.map((change) => ({
      file_path: change.file_path,
      change_type: change.change_type,
      existed_before: typeof change.before_snapshot === "string",
      before_snapshot: change.before_snapshot,
      after_snapshot: change.after_snapshot,
    })),
  };
}

export async function applyPatch(
  applicationPacket: ReviewedPatchApplicationPacket,
  previewDiff: ControlledExecutionDiff[],
  rollbackPoint: ControlledExecutionRollbackPoint,
  allowedRoots?: string[],
): Promise<ControlledExecutionResult> {
  const createdAt = rollbackPoint.created_at;
  const logs: ControlledExecutionLog[] = [
    createLog(createdAt, "apply", "info", `Applying reviewed patch packet ${applicationPacket.application_packet_id}.`),
  ];

  try {
    for (const change of previewDiff) {
      const allowedPath = assertAllowedExecutionPath(change.file_path, allowedRoots ?? getDefaultAllowedExecutionRoots());
      if (change.change_type === "delete") {
        await rm(allowedPath.absolutePath, { force: true });
      } else {
        await mkdir(path.dirname(allowedPath.absolutePath), { recursive: true });
        await writeFile(allowedPath.absolutePath, change.after_snapshot ?? "", "utf8");
      }

      logs.push(createLog(createdAt, "apply", "info", `Applied ${change.change_type} to ${change.file_path}.`, change.file_path));
    }

    return {
      status: "applied",
      preview_diff: previewDiff,
      rollback_point: rollbackPoint,
      logs,
      blockers: [],
      changed_files: previewDiff.map((change) => change.file_path),
      explanation: `Controlled patch execution applied ${previewDiff.length} reviewed file change(s) after explicit approval.`,
    };
  } catch (error) {
    return {
      status: "blocked",
      preview_diff: previewDiff,
      rollback_point: rollbackPoint,
      logs: [
        ...logs,
        createLog(createdAt, "apply", "blocked", error instanceof Error ? error.message : "Controlled patch execution failed during file mutation."),
      ],
      blockers: [{
        code: "apply_failed",
        message: error instanceof Error ? error.message : "Controlled patch execution failed during file mutation.",
        recommended_next_action: "review",
      }],
      changed_files: [],
      explanation: "Controlled patch execution was blocked because the reviewed file mutation step failed.",
    };
  }
}

export async function rollbackExecution(
  rollbackPoint: ControlledExecutionRollbackPoint | null,
  allowedRoots?: string[],
): Promise<ControlledExecutionResult> {
  const createdAt = rollbackPoint?.created_at || new Date().toISOString();
  if (!rollbackPoint) {
    return {
      status: "blocked",
      preview_diff: [],
      rollback_point: null,
      logs: [createLog(createdAt, "rollback", "blocked", "No rollback point was provided.")],
      blockers: [{
        code: "rollback_missing",
        message: "Controlled patch rollback requires a rollback point.",
        recommended_next_action: "review",
      }],
      changed_files: [],
      explanation: "Controlled patch rollback is blocked because no rollback point exists.",
    };
  }

  const logs: ControlledExecutionLog[] = [
    createLog(createdAt, "rollback", "info", `Rolling back reviewed patch packet ${rollbackPoint.application_packet_id}.`),
  ];

  for (const entry of rollbackPoint.entries) {
    const allowedPath = assertAllowedExecutionPath(entry.file_path, allowedRoots ?? getDefaultAllowedExecutionRoots());
    if (!entry.existed_before) {
      await rm(allowedPath.absolutePath, { force: true });
    } else {
      await mkdir(path.dirname(allowedPath.absolutePath), { recursive: true });
      await writeFile(allowedPath.absolutePath, entry.before_snapshot ?? "", "utf8");
    }

    logs.push(createLog(createdAt, "rollback", "info", `Restored ${entry.file_path}.`, entry.file_path));
  }

  return {
    status: "rolled_back",
    preview_diff: rollbackPoint.entries.map((entry) => ({
      file_path: entry.file_path,
      change_type: entry.change_type,
      before_snapshot: entry.after_snapshot,
      after_snapshot: entry.before_snapshot,
      summary_of_change: `Rollback restored ${entry.file_path}.`,
    })),
    rollback_point: rollbackPoint,
    logs,
    blockers: [],
    changed_files: rollbackPoint.entries.map((entry) => entry.file_path),
    explanation: `Controlled patch rollback restored ${rollbackPoint.entries.length} reviewed file change(s).`,
  };
}

export async function executeControlledPatch(
  input: ControlledExecutionInput,
): Promise<ControlledExecutionResult> {
  const createdAt = normalizeText(input.createdAt) || new Date().toISOString();
  const previewDiff = await generatePatchDiff(input.applicationPacket, input.fileChanges, input.allowedRoots);
  const blockers = validateExecutionSafety(input.applicationPacket, previewDiff);
  const logs: ControlledExecutionLog[] = [
    createLog(createdAt, "preview", "info", `Generated preview diff for ${previewDiff.length} reviewed file change(s).`),
    createLog(createdAt, "validate", blockers.length > 0 ? "blocked" : "info", blockers.length > 0
      ? `Controlled patch execution validation found ${blockers.length} blocker(s).`
      : "Controlled patch execution validation passed."),
  ];

  if (!input.approval) {
    return {
      status: blockers.length > 0 ? "blocked" : "awaiting_approval",
      preview_diff: previewDiff,
      rollback_point: null,
      logs: blockers.length > 0
        ? logs
        : [...logs, createLog(createdAt, "validate", "info", "Explicit approval is required before applying reviewed file changes.")],
      blockers: blockers.length > 0
        ? blockers
        : [{
          code: "approval_required",
          message: "Controlled patch execution generated the exact diff preview and is waiting for explicit approval.",
          recommended_next_action: "approve",
        }],
      changed_files: [],
      explanation: blockers.length > 0
        ? "Controlled patch execution is blocked before approval because safety validation failed."
        : "Controlled patch execution is awaiting explicit approval after generating the exact preview diff.",
    };
  }

  if (blockers.length > 0) {
    return {
      status: "blocked",
      preview_diff: previewDiff,
      rollback_point: null,
      logs,
      blockers,
      changed_files: [],
      explanation: "Controlled patch execution is blocked because the reviewed patch failed safety validation.",
    };
  }

  if (!input.applicationPacket) {
    return {
      status: "blocked",
      preview_diff: previewDiff,
      rollback_point: null,
      logs,
      blockers: [{
        code: "missing_application_packet",
        message: "Controlled patch execution requires a reviewed application packet.",
        recommended_next_action: "review",
      }],
      changed_files: [],
      explanation: "Controlled patch execution is blocked because no reviewed application packet was provided.",
    };
  }

  const rollbackPoint = createRollbackPoint(input.applicationPacket, previewDiff, createdAt);
  const applied = await applyPatch(input.applicationPacket, previewDiff, rollbackPoint, input.allowedRoots);

  return {
    ...applied,
    logs: [
      ...logs,
      createLog(createdAt, "apply", "info", `Rollback point ${rollbackPoint.rollback_id} captured before mutation.`),
      ...applied.logs,
    ],
  };
}

export function summarizeExecution(result: ControlledExecutionResult): string {
  return [
    `Controlled execution status: ${result.status}`,
    `Changed files: ${result.changed_files.join(", ") || "none"}`,
    `Preview count: ${result.preview_diff.length}`,
    result.rollback_point ? `Rollback point: ${result.rollback_point.rollback_id}` : "Rollback point: none.",
    result.blockers.length > 0 ? `Blockers: ${result.blockers.map((blocker) => blocker.message).join(" | ")}` : "Blockers: none.",
    `Explanation: ${result.explanation}`,
  ].join("\n");
}