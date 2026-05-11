import assert from "node:assert/strict";
import test from "node:test";

import { runScopedSupervisedExecution } from "./scopedSupervisedExecutionAdapter";
import { buildCampaignExecutionResultState, evaluateScopedExecutionRequest, type ScopedExecutionRequest } from "./scopedSupervisedExecutionRuntime";

function baseRequest(overrides: Partial<ScopedExecutionRequest> = {}): ScopedExecutionRequest {
  return {
    executionRequestId: "exec-1",
    requestedBy: "operator",
    intent: "check current commit",
    command: "git rev-parse --short HEAD",
    workingDirectory: process.cwd(),
    allowedScope: {
      scopeId: "web-workspace",
      allowedWorkingDirectories: [process.cwd()],
      allowInspectionCommands: true,
      allowNpmBuild: true,
      allowNpmTests: true,
    },
    riskLevel: "LOW",
    requiresApproval: true,
    approvalStatus: "approved",
    timeoutMs: 10_000,
    expectedOutputs: ["short commit hash"],
    executionStatus: "prepared",
    ...overrides,
  };
}

test("approved safe command becomes executable", () => {
  const decision = evaluateScopedExecutionRequest(baseRequest());

  assert.equal(decision.executable, true);
  assert.equal(decision.commandCategory, "git_rev_parse_head");
  assert.equal(decision.blockedReason, undefined);
});

test("unapproved command is blocked", () => {
  const decision = evaluateScopedExecutionRequest(baseRequest({ approvalStatus: "pending" }));

  assert.equal(decision.executable, false);
  assert.match(decision.blockedReason ?? "", /requires explicit approval/);
});

test("destructive command is blocked", () => {
  const decision = evaluateScopedExecutionRequest(baseRequest({ command: "git reset --hard", intent: "reset repo" }));

  assert.equal(decision.executable, false);
  assert.match(decision.blockedReason ?? "", /blocked destructive/);
});

test("missing rollback plan blocks mutation-capable commands", () => {
  const decision = evaluateScopedExecutionRequest(baseRequest({
    command: "npm run build",
    intent: "build app",
    riskLevel: "MEDIUM",
    mutationPossible: true,
    rollbackPlan: undefined,
  }));

  assert.equal(decision.executable, false);
  assert.match(decision.blockedReason ?? "", /Rollback plan is required/);
});

test("timeout is required before execution", () => {
  const decision = evaluateScopedExecutionRequest(baseRequest({ timeoutMs: undefined }));

  assert.equal(decision.executable, false);
  assert.match(decision.blockedReason ?? "", /timeoutMs/);
});

test("adapter is disabled by default and does not fake execution", async () => {
  const log = await runScopedSupervisedExecution(baseRequest());

  assert.equal(log.executionStatus, "adapter_disabled");
  assert.equal(log.truthfulnessLabel, "adapter_disabled_no_execution");
  assert.equal(log.exitCode, undefined);
  assert.match(log.stderrSummary ?? "", /adapter is disabled/);
});

test("enabled adapter captures stdout stderr and exit code for safe command", async () => {
  const log = await runScopedSupervisedExecution(baseRequest(), {
    enableExecution: true,
    now: (() => {
      const times = ["2026-05-11T08:00:00.000Z", "2026-05-11T08:00:01.250Z"];
      return () => times.shift() ?? "2026-05-11T08:00:01.250Z";
    })(),
  });

  assert.equal(log.executionStatus, "completed");
  assert.equal(log.truthfulnessLabel, "real_execution_completed");
  assert.equal(log.exitCode, 0);
  assert.equal(log.elapsedMs, 1250);
  assert.match(log.stdoutSummary ?? "", /^[a-f0-9]+/i);
});

test("campaign state records completed and blocked execution results", async () => {
  const completed = await runScopedSupervisedExecution(baseRequest({ executionRequestId: "exec-completed" }), {
    enableExecution: true,
    now: (() => {
      const times = ["2026-05-11T08:00:00.000Z", "2026-05-11T08:00:00.500Z"];
      return () => times.shift() ?? "2026-05-11T08:00:00.500Z";
    })(),
  });
  const blocked = await runScopedSupervisedExecution(baseRequest({ executionRequestId: "exec-blocked", approvalStatus: "missing" }), { enableExecution: true });
  const state = buildCampaignExecutionResultState([completed, blocked]);

  assert.equal(state.layerId, "SCOPED_SUPERVISED_EXECUTION_RUNTIME_PHASE1");
  assert.equal(state.completedExecutionSteps.length, 1);
  assert.equal(state.blockedExecutableSteps.length, 1);
  assert.match(state.truthfulnessWarnings.join("\n"), /Prepared or blocked requests must not be described as executed/);
});