import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { runApprovedExecutionPipeline, type ApprovedExecutionApproval, type ApprovedExecutionPipelineOptions } from "./approvedExecutionPipeline";
import { createScopedExecutionLog, evaluateScopedExecutionRequest, type ScopedExecutionRequest } from "./scopedSupervisedExecutionRuntime";

const webRoot = process.cwd();
const workspaceRoot = path.resolve(webRoot, "..");

function approval(overrides: Partial<ApprovedExecutionApproval> = {}): ApprovedExecutionApproval {
  return {
    approvalStatus: "approved",
    approvalSource: "test",
    approvedBy: "pipeline-test",
    approvedAt: "2026-05-11T08:20:00.000Z",
    ...overrides,
  };
}

function baseRequest(overrides: Partial<ScopedExecutionRequest> = {}): ScopedExecutionRequest {
  return {
    executionRequestId: "approved-exec-1",
    requestedBy: "operator-chat",
    intent: "check current commit",
    command: "git rev-parse --short HEAD",
    workingDirectory: "repo-root",
    allowedScope: {
      scopeId: "ai-e-repo",
      allowedWorkingDirectories: ["repo-root", "repo-root/web"],
      allowNpmBuild: true,
      allowNpmTests: true,
      allowInspectionCommands: true,
    },
    riskLevel: "LOW",
    requiresApproval: true,
    approvalStatus: "pending",
    timeoutMs: 10_000,
    expectedOutputs: ["short commit hash"],
    executionStatus: "prepared",
    ...overrides,
  };
}

function options(overrides: Partial<ApprovedExecutionPipelineOptions> = {}): ApprovedExecutionPipelineOptions {
  return {
    trustedWorkspaceRoot: workspaceRoot,
    trustedWebRoot: webRoot,
    ...overrides,
  };
}

test("approved command executes through trusted runtime", async () => {
  const report = await runApprovedExecutionPipeline({ request: baseRequest(), approval: approval() }, options({ enableExecution: true }));

  assert.equal(report.phaseId, "APPROVED_EXECUTION_PIPELINE_PHASE1");
  assert.equal(report.finalState, "completed");
  assert.equal(report.commandTrulyExecuted, true);
  assert.equal(report.log.truthfulnessLabel, "real_execution_completed");
  assert.equal(report.exitCode, 0);
  assert.match(report.stdout, /^[a-f0-9]+/i);
  assert.deepEqual(report.lifecycle.map((event) => event.state), ["prepared", "approved", "executing", "completed"]);
});

test("rejected command does not execute", async () => {
  const report = await runApprovedExecutionPipeline({
    request: baseRequest(),
    approval: approval({ approvalStatus: "rejected" }),
  }, options({
    enableExecution: true,
    execute: async () => {
      throw new Error("execute must not be called for rejected approval");
    },
  }));

  assert.equal(report.finalState, "rejected");
  assert.equal(report.commandTrulyExecuted, false);
  assert.equal(report.log.truthfulnessLabel, "rejected_no_execution");
  assert.deepEqual(report.lifecycle.map((event) => event.state), ["prepared", "rejected"]);
});

test("pending approval stays awaiting approval", async () => {
  const report = await runApprovedExecutionPipeline({
    request: baseRequest(),
    approval: approval({ approvalStatus: "pending" }),
  }, options({ enableExecution: true }));

  assert.equal(report.finalState, "awaiting_approval");
  assert.equal(report.commandTrulyExecuted, false);
  assert.equal(report.log.executionStatus, "awaiting_approval");
  assert.match(report.recommendedNextAction, /explicit operator approval/);
});

test("blocked command is refused before adapter dispatch", async () => {
  const report = await runApprovedExecutionPipeline({
    request: baseRequest({ command: "git reset --hard", riskLevel: "HIGH", intent: "reset repository" }),
    approval: approval(),
  }, options({
    enableExecution: true,
    execute: async () => {
      throw new Error("execute must not be called for blocked commands");
    },
  }));

  assert.equal(report.finalState, "blocked");
  assert.equal(report.commandTrulyExecuted, false);
  assert.match(report.decision.blockedReason ?? "", /High-risk|blocked destructive/);
});

test("disabled runtime does not fake execution", async () => {
  const report = await runApprovedExecutionPipeline({ request: baseRequest(), approval: approval() }, options({ enableExecution: false }));

  assert.equal(report.finalState, "adapter_disabled");
  assert.equal(report.runtimeEnabled, false);
  assert.equal(report.commandTrulyExecuted, false);
  assert.equal(report.log.truthfulnessLabel, "adapter_disabled_no_execution");
  assert.match(report.truthfulnessLabels.join(" "), /disabled_runtime/);
});

test("timeout handling preserves logs and retry guidance", async () => {
  const request = baseRequest({ executionRequestId: "timed-out-request" });
  const report = await runApprovedExecutionPipeline({ request, approval: approval() }, options({
    enableExecution: true,
    execute: async (approvedRequest) => createScopedExecutionLog(approvedRequest, evaluateScopedExecutionRequest(approvedRequest), {
      executionStatus: "timed_out",
      truthfulnessLabel: "real_execution_failed",
      stdoutSummary: "started validation",
      stderrSummary: "command timed out",
      exitCode: null,
      startedAt: "2026-05-11T08:20:00.000Z",
      completedAt: "2026-05-11T08:20:02.000Z",
      elapsedMs: 2000,
    }),
  }));

  assert.equal(report.finalState, "timed_out");
  assert.equal(report.commandTrulyExecuted, true);
  assert.match(report.stderr, /timed out/);
  assert.match(report.recommendedNextAction, /timeout/);
});

test("execution failure captures stdout stderr and exit code", async () => {
  const request = baseRequest({ executionRequestId: "failed-request" });
  const report = await runApprovedExecutionPipeline({ request, approval: approval({ simulated: true, approvalSource: "simulated_operator" }) }, options({
    enableExecution: true,
    execute: async (approvedRequest) => createScopedExecutionLog(approvedRequest, evaluateScopedExecutionRequest(approvedRequest), {
      executionStatus: "failed",
      truthfulnessLabel: "real_execution_failed",
      stdoutSummary: "partial stdout",
      stderrSummary: "simulated stderr failure",
      exitCode: 1,
      startedAt: "2026-05-11T08:20:00.000Z",
      completedAt: "2026-05-11T08:20:01.000Z",
      elapsedMs: 1000,
    }),
  }));

  assert.equal(report.finalState, "failed");
  assert.equal(report.commandTrulyExecuted, true);
  assert.equal(report.stdout, "partial stdout");
  assert.equal(report.stderr, "simulated stderr failure");
  assert.equal(report.exitCode, 1);
  assert.equal(report.approvalSourceLabel, "simulated_approval");
});

test("client boundary does not import node adapter or pipeline", async () => {
  const clientSource = await readFile(path.join(webRoot, "app/operator/chat/GameDevChatClient.tsx"), "utf8");

  assert.doesNotMatch(clientSource, /node:child_process/);
  assert.doesNotMatch(clientSource, /scopedSupervisedExecutionAdapter/);
  assert.doesNotMatch(clientSource, /approvedExecutionPipeline/);
  assert.match(clientSource, /\/api\/operator\/approved-execution/);
});