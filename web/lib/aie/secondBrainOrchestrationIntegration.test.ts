import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { appendAutonomousStep, createAutonomousSession } from "./autonomousSession";
import { deriveRepoAwarePlanningHintsFromSession } from "./autonomousPlanning";
import { decideAutonomousOrchestration } from "./autonomousOrchestrator";
import { createChainCheckpoint } from "./autonomousChainRecovery";
import { createChainPersistenceRecord } from "./chainPersistence";
import { completeTaskChain, createAutonomousTaskChain } from "./autonomousTaskChain";
import { updateSecondBrainOutcomeLog } from "./secondBrainMemory";

function buildCompletedChain() {
  const planned = createAutonomousTaskChain({
    originalRequest: "Improve the OpenClaw orchestration loop safely",
    interpretedGoal: "Extend AI-E supervision beyond a single request",
    maxSteps: 2,
    chainApproval: true,
    requestedSteps: [
      { title: "Add persistence and freshness checks" },
      { title: "Validate safe continuation state" },
    ],
    createdAt: "2026-04-25T23:00:00.000Z",
  }).chain;
  planned.steps = planned.steps.map((step) => ({ ...step, status: "completed" }));
  planned.current_step_index = planned.steps.length - 1;
  return completeTaskChain(planned).chain;
}

test("planning startup loads BABYLON second-brain context", async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "aie-second-brain-plan-"));

  try {
    const session = appendAutonomousStep(createAutonomousSession({ goal: "Keep repo-aware scope narrow." }), {
      proposedAction: "Write web/lib/aie/repoContext.ts",
      actionFamily: "write",
      executionResult: {
        status: "success",
        output: "Repo context write completed.",
        changedPaths: ["web/lib/aie/repoContext.ts"],
      },
      diagnosis: "The repo context change completed.",
    });

    const hints = await deriveRepoAwarePlanningHintsFromSession(session, {
      repoRoot: path.resolve(process.cwd(), ".."),
      nextActionText: "Run the paired repo context test.",
    });

    assert.equal(hints.secondBrainProjectKey, "ai-e");
    assert.match(hints.repoContextSummary, /Known-good state:/i);
    assert.match(hints.hintSummary, /Avoid:/i);
    assert.match(hints.hintSummary, /Fallback mode:/i);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("orchestration startup loads next safe task and anti-pattern constraints", () => {
  const chain = buildCompletedChain();
  const checkpoint = createChainCheckpoint(chain);
  const record = createChainPersistenceRecord({
    chain,
    checkpoint,
    approvalState: [{
      approval_type: "chain",
      granted_at: "2026-04-25T23:05:00.000Z",
      expires_at: "2026-04-26T01:05:00.000Z",
      requires_reapproval: false,
    }],
    updatedAt: "2026-04-25T23:10:00.000Z",
  });

  const decision = decideAutonomousOrchestration({
    chain,
    persistenceRecord: record,
    confidence: 0.9,
    minimumConfidence: 0.7,
    supervisorApproval: true,
    repoRoot: path.resolve(process.cwd(), ".."),
    resourcePressure: {
      unavailableHardware: ["local gpu"],
      unavailableApis: ["premium model api"],
    },
    now: "2026-04-25T23:15:00.000Z",
  });

  assert.equal(decision.plan.second_brain_project_key, "ai-e");
  assert.match(decision.plan.context_summary, /Next safe task:/i);
  assert.ok(decision.plan.second_brain_anti_patterns?.some((entry) => /hidden repair loops|mixed-owner/i.test(entry)));
  assert.equal(decision.plan.second_brain_fallback_mode, "local_memory_only_mode");
});

test("task outcomes append to second-brain memory", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-second-brain-outcome-hook-"));

  try {
    const result = await updateSecondBrainOutcomeLog({
      root: tempRoot,
      entry: {
        outcome_id: "integration-outcome-1",
        recorded_at: "2026-05-07T00:00:00.000Z",
        project_key: "babylon-2026",
        task_source: "ai-e",
        task_title: "Autonomous bounded validation step",
        attempted: "Run the bounded validation step and capture the result.",
        status: "passed",
        validation_result: "validation_passed / keep_changes. Follow-up: continue with the next bounded supervised step.",
        should_never_repeat: false,
      },
    });

    const written = await readFile(result.output_path, "utf8");
    assert.match(written, /Autonomous bounded validation step/i);
    assert.match(written, /validation_passed/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
