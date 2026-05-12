import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceEliteAgentWorkflow,
  buildEliteAgentWorkflowSession,
  resumeEliteAgentWorkflow,
} from "./eliteAgentWorkflowEngine";
import {
  createAgentWorkflowHistoryStore,
  listFailedAgentWorkflows,
  listRecentAgentWorkflows,
  listResumableAgentWorkflows,
  planAgentWorkflowResume,
  recordAgentWorkflowHistory,
  resumeAgentWorkflowFromHistory,
  summarizeAgentWorkflowHistory,
} from "./agentWorkflowHistory";

const baseInput = {
  agentId: "lite-elite-repo-maintainer-01",
  allowedPaths: ["runner_artifacts/lite_elite_agent"],
  now: "2026-05-12T12:00:00.000Z",
};

test("workflow history records summaries, validation checkpoints, approvals, and timestamps", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "verify the latest gameplay patch" });
  const verifyStage = session.stages[0]!;
  const validating = advanceEliteAgentWorkflow(
    advanceEliteAgentWorkflow(session, { stageId: verifyStage.stageId, action: "START_STAGE", now: "2026-05-12T12:01:00.000Z" }),
    { stageId: verifyStage.stageId, action: "BEGIN_VALIDATION", now: "2026-05-12T12:02:00.000Z" },
  );
  const store = recordAgentWorkflowHistory(createAgentWorkflowHistoryStore(), validating, { now: "2026-05-12T12:03:00.000Z" });
  const entry = store.entries[0]!;

  assert.equal(entry.workflowSessionId, session.workflowSessionId);
  assert.equal(entry.status, "RUNNING");
  assert.equal(entry.validationResults[0]?.stageType, "VERIFY_BUILD");
  assert.equal(entry.validationResults[0]?.validationState, "PENDING");
  assert.equal(entry.updatedAt, "2026-05-12T12:03:00.000Z");
  assert.match(entry.summary.stagesCompleted, /0 of 3/);
});

test("paused workflow history is listed as resumable with correct resume guidance", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "inspect the inventory system" });
  const readStage = session.stages[0]!;
  const paused = advanceEliteAgentWorkflow(
    advanceEliteAgentWorkflow(session, { stageId: readStage.stageId, action: "START_STAGE" }),
    { stageId: readStage.stageId, action: "PAUSE_WORKFLOW", reason: "Operator paused the inspection." },
  );
  const resumable = advanceEliteAgentWorkflow(paused, { stageId: readStage.stageId, action: "MARK_RESUMABLE" });
  const store = recordAgentWorkflowHistory(createAgentWorkflowHistoryStore(), resumable, { now: "2026-05-12T12:04:00.000Z" });
  const resumableEntries = listResumableAgentWorkflows(store);

  assert.equal(resumableEntries.length, 1);
  assert.equal(resumableEntries[0]?.resumeFromStageId, readStage.stageId);
  assert.match(resumableEntries[0]?.summary.resumeGuidance ?? "", /READ_REPO_CONTEXT/);
});

test("interrupted workflow history explains operator review before resume", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "inspect the inventory system" });
  const readStage = session.stages[0]!;
  const interrupted = advanceEliteAgentWorkflow(
    advanceEliteAgentWorkflow(session, { stageId: readStage.stageId, action: "START_STAGE" }),
    { stageId: readStage.stageId, action: "INTERRUPT_WORKFLOW", reason: "Runtime stopped during context read." },
  );
  const store = recordAgentWorkflowHistory(createAgentWorkflowHistoryStore(), interrupted, { now: "2026-05-12T12:05:00.000Z" });
  const decision = planAgentWorkflowResume(store, "resume inventory inspection");

  assert.equal(store.entries[0]?.outcome, "interrupted");
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /Runtime stopped|not currently resumable/i);
});

test("resume from history continues eligible workflow from recorded stage", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "inspect the inventory system" });
  const readStage = session.stages[0]!;
  const resumable = advanceEliteAgentWorkflow(
    advanceEliteAgentWorkflow(
      advanceEliteAgentWorkflow(session, { stageId: readStage.stageId, action: "START_STAGE" }),
      { stageId: readStage.stageId, action: "PAUSE_WORKFLOW" },
    ),
    { stageId: readStage.stageId, action: "MARK_RESUMABLE" },
  );
  const store = recordAgentWorkflowHistory(createAgentWorkflowHistoryStore(), resumable, { now: "2026-05-12T12:06:00.000Z" });
  const result = resumeAgentWorkflowFromHistory(store, "resume inventory inspection", { now: "2026-05-12T12:07:00.000Z" });

  assert.equal(result.decision.allowed, true);
  assert.equal(result.decision.resumeFromStage, "READ_REPO_CONTEXT");
  assert.equal(result.decision.resumedSession?.stages[0]?.lifecycleState, "RUNNING");
  assert.equal(result.store.entries[0]?.status, "RUNNING");
});

test("history resume preserves approval governance for mutation-capable stages", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "prepare a safe movement patch" });
  const readStage = session.stages[0]!;
  const patchStage = session.stages[1]!;
  const afterRead = advanceEliteAgentWorkflow(
    advanceEliteAgentWorkflow(session, { stageId: readStage.stageId, action: "START_STAGE" }),
    { stageId: readStage.stageId, action: "COMPLETE_STAGE" },
  );
  const resumablePatch = advanceEliteAgentWorkflow(
    advanceEliteAgentWorkflow(afterRead, { stageId: patchStage.stageId, action: "PAUSE_WORKFLOW" }),
    { stageId: patchStage.stageId, action: "MARK_RESUMABLE" },
  );
  const store = recordAgentWorkflowHistory(createAgentWorkflowHistoryStore(), resumablePatch, { now: "2026-05-12T12:08:00.000Z" });
  const result = resumeAgentWorkflowFromHistory(store, "resume movement patch", { now: "2026-05-12T12:09:00.000Z" });

  assert.equal(result.decision.allowed, true);
  assert.equal(result.decision.resumedSession?.status, "BLOCKED");
  assert.match(result.decision.resumedSession?.blockedStageReason ?? "", /approval/i);
  assert.equal(result.store.entries[0]?.outcome, "blocked");
});

test("failed and blocked workflow history can be queried", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "apply the patch automatically" });
  const store = recordAgentWorkflowHistory(createAgentWorkflowHistoryStore(), session, { now: "2026-05-12T12:10:00.000Z" });
  const failed = listFailedAgentWorkflows(store);

  assert.equal(failed.length, 1);
  assert.equal(failed[0]?.outcome, "blocked");
  assert.match(failed[0]?.blockedStages[0]?.reason ?? "", /approval|runtime route/i);
});

test("recent workflow history is ordered by update time", () => {
  const first = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "inspect the inventory system", now: "2026-05-12T12:00:00.000Z" });
  const second = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "verify the latest gameplay patch", now: "2026-05-12T12:01:00.000Z" });
  const store = recordAgentWorkflowHistory(
    recordAgentWorkflowHistory(createAgentWorkflowHistoryStore(), first, { now: "2026-05-12T12:11:00.000Z" }),
    second,
    { now: "2026-05-12T12:12:00.000Z" },
  );
  const recent = listRecentAgentWorkflows(store, 2);

  assert.equal(recent[0]?.workflowSessionId, second.workflowSessionId);
  assert.equal(recent[1]?.workflowSessionId, first.workflowSessionId);
});

test("operational summaries explain remaining work and truth boundaries", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "apply the patch automatically" });
  const store = recordAgentWorkflowHistory(createAgentWorkflowHistoryStore(), session, { now: "2026-05-12T12:13:00.000Z" });
  const summary = summarizeAgentWorkflowHistory(store.entries[0]!);

  assert.match(summary.blockedStages, /BLOCKED_EXTERNAL_DEPENDENCY/);
  assert.match(summary.remainingSteps, /BLOCKED_EXTERNAL_DEPENDENCY/);
  assert.match(summary.truthfulContinuityBoundary, /supervised operational continuity/i);
  assert.doesNotMatch(summary.truthfulContinuityBoundary, /fully autonomous|AGI|autonomous_real|unattended indefinitely/i);
});

test("direct engine resume rejects sessions with no resumable stage", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "inspect the inventory system" });

  assert.throws(() => resumeEliteAgentWorkflow(session), /No resumable workflow stage/i);
});
