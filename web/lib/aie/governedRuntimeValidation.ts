import {
  buildGovernedSandboxScaffold,
  resolveGovernedSandboxPath,
  type BuildGovernedSandboxScaffoldInput,
  type GovernedSandboxSafePath,
  type GovernedSandboxScaffold,
} from "./sandboxExecutionBoundary";
import {
  getDefaultSandboxCommandAllowlistPolicy,
  validateSandboxCommandRequest,
  type SandboxCommandAllowlistPolicy,
  type SandboxCommandValidationResult,
} from "./sandboxCommandPolicy";
import {
  createSandboxExecutionReceipt,
  type GovernedSandboxExecutionReceipt,
  type SandboxAffectedFileInput,
  type SandboxApprovalState,
  type SandboxPlannedAction,
  type SandboxReceiptError,
  type SandboxReceiptWarning,
  type SandboxSnapshotReceiptReference,
  type SandboxVerificationStatus,
} from "./sandboxExecutionReceipt";
import type { SandboxSnapshotPhase } from "./sandboxSnapshotLifecycle";

export const GOVERNED_RUNTIME_VALIDATION_VERSION = "EXEC-0044" as const;

const OPERATION_ID_PATTERN = /^op-[a-z0-9][a-z0-9_-]{0,79}$/;

function timestampId(now: () => string): string {
  return now().replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

export function createGovernedRuntimeOperationId(input: { label?: string; now?: () => string } = {}): string {
  const label = String(input.label ?? "validation")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "validation";

  const id = `op-${timestampId(input.now ?? (() => new Date().toISOString()))}-${label}`;
  if (!OPERATION_ID_PATTERN.test(id)) {
    throw new Error(`Generated operation id '${id}' does not match the required op-<id> format.`);
  }

  return id;
}

export type GovernedRuntimeProposedCommand = {
  command: string;
  args?: string[];
  workingDirectory?: string;
  requiresApproval?: boolean;
};

export type GovernedSnapshotPlanIntent = {
  sandboxId: string;
  phases: SandboxSnapshotPhase[];
  workspaceRoot: GovernedSandboxSafePath;
  beforeSnapshotRoot: GovernedSandboxSafePath;
  afterSnapshotRoot: GovernedSandboxSafePath;
  receiptRoot: GovernedSandboxSafePath;
  includeContentHashes: boolean;
  status: "planned";
  note: string;
};

export type GovernedRuntimeValidationResult = {
  pipelineVersion: typeof GOVERNED_RUNTIME_VALIDATION_VERSION;
  operationId: string;
  sandboxId: string;
  dryRun: true;
  commandPolicyResults: SandboxCommandValidationResult[];
  allCommandsAllowed: boolean;
  snapshotPlan: GovernedSnapshotPlanIntent;
  plannedReceipt: GovernedSandboxExecutionReceipt;
  plannedReceiptPreview: string;
  approvalState: SandboxApprovalState;
  verificationState: SandboxVerificationStatus;
  executionAllowed: false;
  warnings: SandboxReceiptWarning[];
  errors: SandboxReceiptError[];
  safetyBoundary: {
    pipelineValidationOnly: true;
    dryRunEnforced: true;
    commandExecutionEnabled: false;
    processSpawnEnabled: false;
    shellPassthroughEnabled: false;
    networkExecutionEnabled: false;
    workspaceMutationEnabled: false;
    snapshotWriteEnabled: false;
    receiptWriteEnabled: false;
    rollbackExecutionEnabled: false;
    automaticRuntimeExecution: false;
    humanAuthorityRequired: true;
    approvalBoundaryPreserved: true;
  };
};

export type GovernedRuntimeValidationInput = BuildGovernedSandboxScaffoldInput & {
  scaffold?: GovernedSandboxScaffold;
  operationId?: string;
  proposedCommands?: GovernedRuntimeProposedCommand[];
  proposedAffectedFiles?: SandboxAffectedFileInput[];
  plannedActions?: SandboxPlannedAction[];
  snapshotReferences?: SandboxSnapshotReceiptReference[];
  approvalRequired?: boolean;
  includeContentHashes?: boolean;
  policy?: SandboxCommandAllowlistPolicy;
};

function buildSnapshotPlanIntent(
  scaffold: GovernedSandboxScaffold,
  includeContentHashes: boolean,
): GovernedSnapshotPlanIntent {
  return {
    sandboxId: scaffold.sandboxId,
    phases: ["before", "after"],
    workspaceRoot: resolveGovernedSandboxPath(scaffold, ".", "workspace"),
    beforeSnapshotRoot: resolveGovernedSandboxPath(scaffold, ".", "snapshot-before"),
    afterSnapshotRoot: resolveGovernedSandboxPath(scaffold, ".", "snapshot-after"),
    receiptRoot: resolveGovernedSandboxPath(scaffold, ".", "receipts"),
    includeContentHashes,
    status: "planned",
    note: "Snapshot inventory will be taken at execution time; this is a structural plan only.",
  };
}

function deriveCommandPlannedActions(commandResults: SandboxCommandValidationResult[]): SandboxPlannedAction[] {
  return commandResults.map((result, index) => ({
    actionId: `cmd-${String(index + 1).padStart(3, "0")}`,
    title: `Validate: ${result.normalizedCommand}`,
    description: `Command '${result.normalizedCommand}' — policy category: ${result.category}, decision: ${result.allowed ? "allowed" : "denied"}`,
    category: "validate" as const,
    requiresApproval: result.requiresApproval,
    mutationExpected: false,
  }));
}

export async function validateGovernedRuntimeOperation(
  input: GovernedRuntimeValidationInput = {},
): Promise<GovernedRuntimeValidationResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const policy = input.policy ?? getDefaultSandboxCommandAllowlistPolicy();
  const approvalState: SandboxApprovalState = input.approvalRequired === false ? "not_required" : "pending";
  const includeContentHashes = input.includeContentHashes === true;

  // Step 1: Validate sandbox identity and workspace scope.
  // Intentionally throws for invalid sandbox IDs or out-of-bound repository roots.
  const scaffold = input.scaffold ?? buildGovernedSandboxScaffold({
    sandboxId: input.sandboxId,
    repositoryRoot: input.repositoryRoot,
    now,
  });

  const operationId = input.operationId ?? createGovernedRuntimeOperationId({ label: "validation", now });

  const pipelineWarnings: SandboxReceiptWarning[] = [];
  const pipelineErrors: SandboxReceiptError[] = [];

  // Step 2: Validate proposed commands using command policy.
  const proposedCommands = input.proposedCommands ?? [];
  const commandPolicyResults: SandboxCommandValidationResult[] = [];

  for (const proposed of proposedCommands) {
    const result = validateSandboxCommandRequest({
      scaffold,
      command: proposed.command,
      args: proposed.args,
      workingDirectory: proposed.workingDirectory,
      requiresApproval: proposed.requiresApproval,
      policy,
      now,
    });
    commandPolicyResults.push(result);

    for (const error of result.errors) {
      pipelineErrors.push({
        code: `command_denied:${error.code}`,
        message: error.message,
        path: error.token,
      });
    }
    for (const warning of result.warnings) {
      pipelineWarnings.push({
        code: warning.code,
        message: warning.message,
        path: warning.token,
      });
    }
  }

  if (proposedCommands.length === 0) {
    pipelineWarnings.push({
      code: "no_commands_proposed",
      message: "No proposed commands were provided for policy validation.",
    });
  }

  const allCommandsAllowed =
    commandPolicyResults.length > 0 && commandPolicyResults.every((result) => result.allowed);

  // Step 3: Build before/after snapshot intent metadata.
  // Pure structural plan — no filesystem I/O is performed here.
  const snapshotPlan = buildSnapshotPlanIntent(scaffold, includeContentHashes);

  // Step 4: Build planned execution receipt (dry-run, no write).
  const plannedActions = input.plannedActions ?? deriveCommandPlannedActions(commandPolicyResults);

  const receiptRecord = await createSandboxExecutionReceipt({
    scaffold,
    operationPhase: "planned",
    approvalState,
    plannedActions,
    affectedFiles: input.proposedAffectedFiles ?? [],
    snapshotReferences: input.snapshotReferences ?? [],
    warnings: pipelineWarnings,
    errors: pipelineErrors,
    dryRun: true,
    writeReceipt: false,
    now,
  });

  // Steps 5–6: Approval remains pending unless explicitly not required.
  // Verification is blocked when pipeline errors are present; otherwise pending.
  const verificationState: SandboxVerificationStatus =
    receiptRecord.receipt.errors.length > 0 ? "blocked" : "pending";

  // Step 7: Return dry-run governance result. executionAllowed is always false from this pipeline.
  return {
    pipelineVersion: GOVERNED_RUNTIME_VALIDATION_VERSION,
    operationId,
    sandboxId: scaffold.sandboxId,
    dryRun: true,
    commandPolicyResults,
    allCommandsAllowed,
    snapshotPlan,
    plannedReceipt: receiptRecord.receipt,
    plannedReceiptPreview: receiptRecord.receiptPreview,
    approvalState: receiptRecord.receipt.approvalState,
    verificationState,
    executionAllowed: false,
    warnings: receiptRecord.receipt.warnings,
    errors: receiptRecord.receipt.errors,
    safetyBoundary: {
      pipelineValidationOnly: true,
      dryRunEnforced: true,
      commandExecutionEnabled: false,
      processSpawnEnabled: false,
      shellPassthroughEnabled: false,
      networkExecutionEnabled: false,
      workspaceMutationEnabled: false,
      snapshotWriteEnabled: false,
      receiptWriteEnabled: false,
      rollbackExecutionEnabled: false,
      automaticRuntimeExecution: false,
      humanAuthorityRequired: true,
      approvalBoundaryPreserved: true,
    },
  };
}
