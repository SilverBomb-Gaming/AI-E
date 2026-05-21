import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { buildGovernedSandboxScaffold } from "./sandboxExecutionBoundary";
import {
  createGovernedRuntimeOperationId,
  GOVERNED_RUNTIME_VALIDATION_VERSION,
  validateGovernedRuntimeOperation,
} from "./governedRuntimeValidation";

const FIXED_TIME = "2026-05-20T20:00:00.000Z";
const REPO_ROOT = path.resolve("E:/test-ai-e");
const SANDBOX_ID = "sandbox-exec-0044";

function scaffoldInput() {
  return {
    repositoryRoot: REPO_ROOT,
    sandboxId: SANDBOX_ID,
    now: () => FIXED_TIME,
  };
}

// --- createGovernedRuntimeOperationId ---

test("createGovernedRuntimeOperationId produces a valid op-<timestamp>-<label> id", () => {
  const id = createGovernedRuntimeOperationId({ label: "build validation", now: () => FIXED_TIME });
  assert.match(id, /^op-20260520200000-build-validation$/);
});

test("createGovernedRuntimeOperationId uses 'validation' as default label", () => {
  const id = createGovernedRuntimeOperationId({ now: () => FIXED_TIME });
  assert.match(id, /^op-20260520200000-validation$/);
});

// --- validateGovernedRuntimeOperation: pipeline version and shape ---

test("validateGovernedRuntimeOperation returns correct pipeline version and top-level shape", async () => {
  const result = await validateGovernedRuntimeOperation({
    ...scaffoldInput(),
    proposedCommands: [{ command: "npm.cmd run build" }],
  });

  assert.equal(result.pipelineVersion, GOVERNED_RUNTIME_VALIDATION_VERSION);
  assert.equal(result.pipelineVersion, "EXEC-0044");
  assert.equal(result.sandboxId, SANDBOX_ID);
  assert.equal(result.dryRun, true);
  assert.equal(result.executionAllowed, false);
  assert.ok(typeof result.operationId === "string");
  assert.match(result.operationId, /^op-/);
});

// --- validateGovernedRuntimeOperation: allowed commands ---

test("allowed command produces commandPolicyResults[].allowed=true and no pipeline errors", async () => {
  const result = await validateGovernedRuntimeOperation({
    ...scaffoldInput(),
    proposedCommands: [{ command: "npm.cmd run build" }],
  });

  assert.equal(result.commandPolicyResults.length, 1);
  assert.equal(result.commandPolicyResults[0].allowed, true);
  assert.equal(result.commandPolicyResults[0].category, "build");
  assert.equal(result.commandPolicyResults[0].dryRun, true);
  assert.equal(result.commandPolicyResults[0].sandboxOnly, true);
  assert.equal(result.commandPolicyResults[0].safetyBoundary.commandExecutionEnabled, false);
  assert.equal(result.commandPolicyResults[0].safetyBoundary.processSpawnEnabled, false);
  assert.equal(result.allCommandsAllowed, true);
  assert.equal(result.errors.filter((e) => e.code.startsWith("command_denied:")).length, 0);
});

test("multiple allowed commands produce allCommandsAllowed=true", async () => {
  const result = await validateGovernedRuntimeOperation({
    ...scaffoldInput(),
    proposedCommands: [
      { command: "npm.cmd run build" },
      { command: "npm.cmd run lint" },
      { command: "npm.cmd exec -- tsx --test lib/aie/governedRuntimeValidation.test.ts" },
      { command: "git status --short" },
    ],
  });

  assert.equal(result.commandPolicyResults.length, 4);
  assert.ok(result.commandPolicyResults.every((r) => r.allowed));
  assert.equal(result.allCommandsAllowed, true);
  assert.equal(result.executionAllowed, false);
});

// --- validateGovernedRuntimeOperation: unsafe/denied commands ---

test("unsafe shell command is denied and produces pipeline errors", async () => {
  const result = await validateGovernedRuntimeOperation({
    ...scaffoldInput(),
    proposedCommands: [{ command: "rm -rf ." }],
  });

  assert.equal(result.commandPolicyResults.length, 1);
  assert.equal(result.commandPolicyResults[0].allowed, false);
  assert.equal(result.commandPolicyResults[0].safetyBoundary.commandExecutionEnabled, false);
  assert.equal(result.allCommandsAllowed, false);
  assert.ok(result.errors.some((e) => e.code.startsWith("command_denied:")));
  assert.equal(result.executionAllowed, false);
});

test("shell passthrough (bash) is denied", async () => {
  const result = await validateGovernedRuntimeOperation({
    ...scaffoldInput(),
    proposedCommands: [{ command: "bash -c 'echo hello'" }],
  });

  assert.equal(result.commandPolicyResults[0].allowed, false);
  assert.equal(result.commandPolicyResults[0].category, "unrestricted_shell_passthrough");
  assert.equal(result.allCommandsAllowed, false);
  assert.equal(result.executionAllowed, false);
});

test("network command is denied", async () => {
  const result = await validateGovernedRuntimeOperation({
    ...scaffoldInput(),
    proposedCommands: [{ command: "curl https://example.com" }],
  });

  assert.equal(result.commandPolicyResults[0].allowed, false);
  assert.equal(result.commandPolicyResults[0].category, "network_operation");
  assert.equal(result.executionAllowed, false);
});

test("git mutating command is denied", async () => {
  const result = await validateGovernedRuntimeOperation({
    ...scaffoldInput(),
    proposedCommands: [{ command: "git push origin main" }],
  });

  assert.equal(result.commandPolicyResults[0].allowed, false);
  assert.equal(result.commandPolicyResults[0].category, "production_workspace_mutation");
  assert.equal(result.executionAllowed, false);
});

test("shell control operator in command is denied", async () => {
  const result = await validateGovernedRuntimeOperation({
    ...scaffoldInput(),
    proposedCommands: [{ command: "npm run build && rm -rf ." }],
  });

  assert.equal(result.commandPolicyResults[0].allowed, false);
  assert.equal(result.commandPolicyResults[0].category, "unsafe_command_syntax");
  assert.equal(result.executionAllowed, false);
});

// --- validateGovernedRuntimeOperation: mixed commands ---

test("mixed allowed and denied commands produce allCommandsAllowed=false with errors", async () => {
  const result = await validateGovernedRuntimeOperation({
    ...scaffoldInput(),
    proposedCommands: [
      { command: "npm.cmd run build" },
      { command: "rm -rf ." },
      { command: "git status" },
    ],
  });

  assert.equal(result.commandPolicyResults.length, 3);
  assert.equal(result.commandPolicyResults[0].allowed, true);
  assert.equal(result.commandPolicyResults[1].allowed, false);
  assert.equal(result.commandPolicyResults[2].allowed, true);
  assert.equal(result.allCommandsAllowed, false);
  assert.ok(result.errors.length > 0);
  assert.equal(result.executionAllowed, false);
});

// --- validateGovernedRuntimeOperation: no commands ---

test("no proposed commands produces a no_commands_proposed warning", async () => {
  const result = await validateGovernedRuntimeOperation({
    ...scaffoldInput(),
    proposedCommands: [],
  });

  assert.equal(result.commandPolicyResults.length, 0);
  assert.equal(result.allCommandsAllowed, false);
  assert.ok(result.warnings.some((w) => w.code === "no_commands_proposed"));
  assert.equal(result.executionAllowed, false);
});

// --- validateGovernedRuntimeOperation: approval state ---

test("approvalState defaults to pending", async () => {
  const result = await validateGovernedRuntimeOperation({
    ...scaffoldInput(),
    proposedCommands: [{ command: "npm.cmd run build" }],
  });

  assert.equal(result.approvalState, "pending");
  assert.equal(result.plannedReceipt.approvalState, "pending");
});

test("approvalRequired: false sets approvalState to not_required", async () => {
  const result = await validateGovernedRuntimeOperation({
    ...scaffoldInput(),
    proposedCommands: [{ command: "npm.cmd run lint" }],
    approvalRequired: false,
  });

  assert.equal(result.approvalState, "not_required");
  assert.equal(result.plannedReceipt.approvalState, "not_required");
  assert.equal(result.executionAllowed, false);
});

// --- validateGovernedRuntimeOperation: verification state ---

test("verificationState is pending when no errors", async () => {
  const result = await validateGovernedRuntimeOperation({
    ...scaffoldInput(),
    proposedCommands: [{ command: "npm.cmd run build" }],
  });

  assert.equal(result.verificationState, "pending");
});

test("verificationState is blocked when pipeline errors are present", async () => {
  const result = await validateGovernedRuntimeOperation({
    ...scaffoldInput(),
    proposedCommands: [{ command: "rm -rf ." }],
  });

  assert.equal(result.verificationState, "blocked");
  assert.ok(result.errors.length > 0);
});

// --- validateGovernedRuntimeOperation: snapshot plan ---

test("snapshot plan is a structural plan with no filesystem I/O", async () => {
  const result = await validateGovernedRuntimeOperation({
    ...scaffoldInput(),
    proposedCommands: [{ command: "npm.cmd run build" }],
  });

  const { snapshotPlan } = result;
  assert.equal(snapshotPlan.status, "planned");
  assert.equal(snapshotPlan.sandboxId, SANDBOX_ID);
  assert.deepEqual(snapshotPlan.phases, ["before", "after"]);
  assert.equal(snapshotPlan.includeContentHashes, false);
  assert.ok(snapshotPlan.workspaceRoot.absolutePath.includes(SANDBOX_ID));
  assert.ok(snapshotPlan.beforeSnapshotRoot.absolutePath.includes("before"));
  assert.ok(snapshotPlan.afterSnapshotRoot.absolutePath.includes("after"));
  assert.ok(snapshotPlan.receiptRoot.absolutePath.includes("receipts"));
  assert.ok(typeof snapshotPlan.note === "string" && snapshotPlan.note.length > 0);
});

test("snapshot plan paths are bounded inside sandbox root", async () => {
  const result = await validateGovernedRuntimeOperation({
    ...scaffoldInput(),
    proposedCommands: [{ command: "npm.cmd run build" }],
  });

  const { snapshotPlan } = result;
  const sandboxSegment = path.join(".ai-e", "sandboxes", SANDBOX_ID);
  assert.ok(snapshotPlan.workspaceRoot.absolutePath.includes(sandboxSegment));
  assert.ok(snapshotPlan.beforeSnapshotRoot.absolutePath.includes(sandboxSegment));
  assert.ok(snapshotPlan.afterSnapshotRoot.absolutePath.includes(sandboxSegment));
});

test("includeContentHashes flows through to snapshot plan", async () => {
  const result = await validateGovernedRuntimeOperation({
    ...scaffoldInput(),
    proposedCommands: [{ command: "npm.cmd run build" }],
    includeContentHashes: true,
  });

  assert.equal(result.snapshotPlan.includeContentHashes, true);
});

// --- validateGovernedRuntimeOperation: planned receipt ---

test("planned receipt is always dryRun=true with no filesystem write", async () => {
  const result = await validateGovernedRuntimeOperation({
    ...scaffoldInput(),
    proposedCommands: [{ command: "npm.cmd run build" }],
  });

  assert.equal(result.plannedReceipt.manifestVersion, "EXEC-0043-C");
  assert.equal(result.plannedReceipt.dryRun, true);
  assert.equal(result.plannedReceipt.receipt.written, false);
  assert.equal(result.plannedReceipt.receipt.status, "dry_run_preview");
  assert.equal(result.plannedReceipt.operationPhase, "planned");
  assert.equal(result.plannedReceipt.safetyBoundary.shellExecutionEnabled, false);
  assert.equal(result.plannedReceipt.safetyBoundary.workspaceMutationEnabled, false);
  assert.equal(result.plannedReceipt.safetyBoundary.humanAuthorityRequired, true);
});

test("plannedReceiptPreview is a non-empty JSON string", async () => {
  const result = await validateGovernedRuntimeOperation({
    ...scaffoldInput(),
    proposedCommands: [{ command: "npm.cmd run build" }],
  });

  assert.ok(result.plannedReceiptPreview.length > 0);
  const parsed = JSON.parse(result.plannedReceiptPreview);
  assert.equal(parsed.manifestVersion, "EXEC-0043-C");
  assert.equal(parsed.dryRun, true);
});

test("planned receipt derives planned actions from command policy results", async () => {
  const result = await validateGovernedRuntimeOperation({
    ...scaffoldInput(),
    proposedCommands: [
      { command: "npm.cmd run build" },
      { command: "npm.cmd run lint" },
    ],
  });

  assert.equal(result.plannedReceipt.plannedActions.length, 2);
  assert.equal(result.plannedReceipt.plannedActions[0].actionId, "cmd-001");
  assert.equal(result.plannedReceipt.plannedActions[1].actionId, "cmd-002");
  assert.ok(result.plannedReceipt.plannedActions[0].title.includes("npm.cmd run build"));
  assert.ok(result.plannedReceipt.plannedActions[1].title.includes("npm.cmd run lint"));
  assert.equal(result.plannedReceipt.plannedActions[0].mutationExpected, false);
  assert.equal(result.plannedReceipt.plannedActions[0].category, "validate");
});

test("caller-supplied plannedActions override derived actions", async () => {
  const result = await validateGovernedRuntimeOperation({
    ...scaffoldInput(),
    proposedCommands: [{ command: "npm.cmd run build" }],
    plannedActions: [
      {
        actionId: "custom-action-001",
        title: "Custom Action",
        description: "Override action provided by caller",
        category: "inspect",
        requiresApproval: true,
        mutationExpected: false,
      },
    ],
  });

  assert.equal(result.plannedReceipt.plannedActions.length, 1);
  assert.equal(result.plannedReceipt.plannedActions[0].actionId, "custom-action-001");
});

// --- validateGovernedRuntimeOperation: safety boundary ---

test("safety boundary flags are all correct for governance-only pipeline", async () => {
  const result = await validateGovernedRuntimeOperation({
    ...scaffoldInput(),
    proposedCommands: [{ command: "npm.cmd run build" }],
  });

  const { safetyBoundary } = result;
  assert.equal(safetyBoundary.pipelineValidationOnly, true);
  assert.equal(safetyBoundary.dryRunEnforced, true);
  assert.equal(safetyBoundary.commandExecutionEnabled, false);
  assert.equal(safetyBoundary.processSpawnEnabled, false);
  assert.equal(safetyBoundary.shellPassthroughEnabled, false);
  assert.equal(safetyBoundary.networkExecutionEnabled, false);
  assert.equal(safetyBoundary.workspaceMutationEnabled, false);
  assert.equal(safetyBoundary.snapshotWriteEnabled, false);
  assert.equal(safetyBoundary.receiptWriteEnabled, false);
  assert.equal(safetyBoundary.rollbackExecutionEnabled, false);
  assert.equal(safetyBoundary.automaticRuntimeExecution, false);
  assert.equal(safetyBoundary.humanAuthorityRequired, true);
  assert.equal(safetyBoundary.approvalBoundaryPreserved, true);
});

// --- validateGovernedRuntimeOperation: invalid sandbox ID ---

test("invalid sandbox ID causes pipeline to throw before producing a result", async () => {
  await assert.rejects(
    () =>
      validateGovernedRuntimeOperation({
        repositoryRoot: REPO_ROOT,
        sandboxId: "INVALID_ID!!!",
        now: () => FIXED_TIME,
        proposedCommands: [{ command: "npm.cmd run build" }],
      }),
    /sandbox/i,
  );
});

// --- validateGovernedRuntimeOperation: pre-built scaffold ---

test("accepts a pre-built scaffold and uses it without rebuilding", async () => {
  const scaffold = buildGovernedSandboxScaffold({
    repositoryRoot: REPO_ROOT,
    sandboxId: SANDBOX_ID,
    now: () => FIXED_TIME,
  });

  const result = await validateGovernedRuntimeOperation({
    scaffold,
    now: () => FIXED_TIME,
    proposedCommands: [{ command: "git status" }],
  });

  assert.equal(result.sandboxId, SANDBOX_ID);
  assert.equal(result.commandPolicyResults[0].allowed, true);
});

// --- validateGovernedRuntimeOperation: custom operation id ---

test("caller-supplied operationId is preserved in the result", async () => {
  const result = await validateGovernedRuntimeOperation({
    ...scaffoldInput(),
    operationId: "op-20260520200000-custom-op",
    proposedCommands: [{ command: "npm.cmd run build" }],
  });

  assert.equal(result.operationId, "op-20260520200000-custom-op");
});
