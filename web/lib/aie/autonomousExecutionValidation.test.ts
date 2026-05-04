import assert from "node:assert/strict";
import { appendFile, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { getAutonomyPolicy } from "./autonomyPolicy";
import { runAutonomousStep } from "./autonomousExecution";
import {
  buildAutonomousExecutionAuditRecord,
  recordAutonomousExecutionAudit,
} from "./autonomousExecutionAudit";
import { enqueueLearningApplication, queryLearningApplicationQueue } from "./learningApplicationQueue";
import { getLearningExecutionCooldownStatus, resetLearningExecutionCooldown } from "./learningExecutionCooldown";
import { isExecutionInProgress, resetExecutionLockForTests } from "./learningExecutionLock";
import { resetLearningQueueExecutionProposal } from "./learningQueueExecutionProposal";
import { getLearningApplicationState, resetLearningApplicationState } from "./learningApplicationState";
import { setLearningEnabled } from "./learningConfig";
import { recordLearningRecommendationDecision } from "./learningRecommendationDecision";
import type { LearningRecommendation } from "./learningRecommendationReview";
import { getLearningStabilityGuardStatus } from "./learningStabilityGuard";

function createRecommendation(queueId: string, confidence: number): LearningRecommendation {
  return {
    recommendation_id: `recommendation-${queueId}`,
    created_at: "2026-05-04T13:00:00.000Z",
    source_audit_id: `audit-${queueId}`,
    recommendation_kind: "ranking_adjustment_candidate",
    summary: `Recommendation for ${queueId}`,
    rationale: `Rationale for ${queueId}`,
    confidence,
    proposed_change_preview: `Preview for ${queueId}`,
    applied: false,
    requires_operator_review: true,
  };
}

async function createQueuedItem(tempRoot: string, queueId: string, confidence: number, createdAt: string) {
  const recommendation = createRecommendation(queueId, confidence);
  const decision = await recordLearningRecommendationDecision(recommendation, {
    operator_decision: "approved_for_future_application",
    decided_at: createdAt,
  }, { outputDirectory: tempRoot });

  return enqueueLearningApplication(recommendation, decision.record, {
    outputDirectory: tempRoot,
    createdAt,
  });
}

function buildIsoTimestamp(base: string, offsetMs: number): string {
  return new Date(Date.parse(base) + offsetMs).toISOString();
}

test.afterEach(() => {
  setLearningEnabled(false);
  resetLearningApplicationState();
  resetLearningQueueExecutionProposal();
  resetLearningExecutionCooldown();
  resetExecutionLockForTests();
});

test("long-run validation stays stable across 120 autonomous attempts", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-autonomous-validation-long-run-"));
  const auditOutputDirectory = path.join(tempRoot, "audits");
  const policy = {
    ...getAutonomyPolicy(),
    autonomy_enabled: true,
    allowed_lane: "single_queued_learning_item" as const,
    max_items_per_run: 1,
  };
  const baseTimestamp = "2026-05-04T13:10:00.000Z";

  try {
    for (let iteration = 0; iteration < 120; iteration += 1) {
      const iterationDirectory = path.join(tempRoot, `iteration-${iteration}`);
      await mkdir(iterationDirectory, { recursive: true });
      setLearningEnabled(true);
      resetLearningApplicationState();
      resetLearningQueueExecutionProposal();
      resetLearningExecutionCooldown();
      resetExecutionLockForTests();

      const queueOneTime = buildIsoTimestamp(baseTimestamp, iteration * 120_000);
      const queueTwoTime = buildIsoTimestamp(baseTimestamp, iteration * 120_000 + 1_000);
      const firstAttemptTime = buildIsoTimestamp(baseTimestamp, iteration * 120_000 + 30_000);
      const secondAttemptTime = buildIsoTimestamp(baseTimestamp, iteration * 120_000 + 50_000);

      await createQueuedItem(iterationDirectory, `queue-${iteration}-a`, 0.2, queueOneTime);
      await createQueuedItem(iterationDirectory, `queue-${iteration}-b`, 0.3, queueTwoTime);

      let items = await queryLearningApplicationQueue({ outputDirectory: iterationDirectory });
      const first = await runAutonomousStep(items, policy, {
        outputDirectory: iterationDirectory,
        executedAt: firstAttemptTime,
        cooldownWindowMs: 60_000,
      });
      await recordAutonomousExecutionAudit(buildAutonomousExecutionAuditRecord(first, { createdAt: firstAttemptTime }), {
        outputDirectory: auditOutputDirectory,
      });

      items = await queryLearningApplicationQueue({ outputDirectory: iterationDirectory });
      const second = await runAutonomousStep(items, policy, {
        outputDirectory: iterationDirectory,
        executedAt: secondAttemptTime,
        cooldownWindowMs: 60_000,
      });
      await recordAutonomousExecutionAudit(buildAutonomousExecutionAuditRecord(second, { createdAt: secondAttemptTime }), {
        outputDirectory: auditOutputDirectory,
      });

      const updatedItems = await queryLearningApplicationQueue({ outputDirectory: iterationDirectory });
      assert.equal(first.executed, true);
      assert.equal(second.executed, false);
      assert.equal(second.execution_result?.reason, "execution cooldown active");
      assert.equal(updatedItems.filter((item) => item.status === "applied").length, 1);
      assert.equal(updatedItems.filter((item) => item.status === "queued").length, 1);
      assert.equal(isExecutionInProgress().execution_in_progress, false);
      assert.equal(getLearningExecutionCooldownStatus({ attemptedAt: secondAttemptTime, cooldownWindowMs: 60_000 }).blocked, true);
      assert.equal(getLearningStabilityGuardStatus().drift_detected, false);
      assert.equal(getLearningApplicationState().has_active_application, true);

      const resetState = resetLearningApplicationState();
      assert.equal(resetState.has_active_application, false);
      assert.equal(getLearningStabilityGuardStatus().cumulative_adjustment_magnitude, 0);
    }

    const payload = await readFile(path.join(auditOutputDirectory, "2026-05-04.jsonl"), "utf-8");
    assert.equal(payload.trim().split(/\r?\n/).length, 240);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("gate failure blocks safely and remains auditable", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-autonomous-validation-gate-failure-"));
  const policy = {
    ...getAutonomyPolicy(),
    autonomy_enabled: true,
    allowed_lane: "single_queued_learning_item" as const,
    max_items_per_run: 1,
  };

  try {
    await createQueuedItem(tempRoot, "queue-gate-failure", 0.2, "2026-05-04T14:00:00.000Z");
    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });
    const result = await runAutonomousStep(items, policy, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T14:01:00.000Z",
    });
    const record = buildAutonomousExecutionAuditRecord(result);

    assert.equal(result.executed, false);
    assert.equal(result.execution_result?.reason, "learning disabled globally");
    assert.equal(record.blocked_reason, "learning disabled globally");
    assert.deepEqual(record.policy_snapshot, policy);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("drift-threshold breach blocks safely and remains auditable", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-autonomous-validation-drift-failure-"));
  const policy = {
    ...getAutonomyPolicy(),
    autonomy_enabled: true,
    allowed_lane: "single_queued_learning_item" as const,
    max_items_per_run: 1,
  };

  try {
    setLearningEnabled(true);
    await createQueuedItem(tempRoot, "queue-drift-failure", 0.8, "2026-05-04T14:02:00.000Z");
    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });
    const result = await runAutonomousStep(items, policy, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T14:03:00.000Z",
    });
    const record = buildAutonomousExecutionAuditRecord(result);

    assert.equal(result.executed, false);
    assert.equal(result.execution_result?.reason, "learning drift detected");
    assert.equal(record.blocked_reason, "learning drift detected");
    assert.deepEqual(record.safety_stack_used, result.safety_stack_used);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("queue corruption is ignored safely and blocked attempt remains auditable", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-autonomous-validation-queue-corruption-"));
  const queueDirectory = path.join(tempRoot, "queue");
  const policy = {
    ...getAutonomyPolicy(),
    autonomy_enabled: true,
    allowed_lane: "single_queued_learning_item" as const,
    max_items_per_run: 1,
  };

  try {
    await mkdir(queueDirectory, { recursive: true });
    await appendFile(path.join(queueDirectory, "2026-05-04.jsonl"), "{not-valid-json}\n", "utf-8");

    const items = await queryLearningApplicationQueue({ outputDirectory: queueDirectory });
    const result = await runAutonomousStep(items, policy, {
      outputDirectory: queueDirectory,
      executedAt: "2026-05-04T14:04:00.000Z",
    });
    const record = buildAutonomousExecutionAuditRecord(result);

    assert.deepEqual(items, []);
    assert.equal(result.executed, false);
    assert.equal(result.reason, "no executable autonomous item");
    assert.equal(record.executed, false);
    assert.deepEqual(record.policy_snapshot, policy);
    assert.deepEqual(record.simulation_snapshot.execution_plan, []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("partial execution leaves remaining queue state unchanged and auditable", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-autonomous-validation-partial-"));
  const auditOutputDirectory = path.join(tempRoot, "audits");
  const policy = {
    ...getAutonomyPolicy(),
    autonomy_enabled: true,
    allowed_lane: "single_queued_learning_item" as const,
    max_items_per_run: 1,
  };

  try {
    setLearningEnabled(true);
    await createQueuedItem(tempRoot, "queue-partial-a", 0.2, "2026-05-04T14:05:00.000Z");
    await createQueuedItem(tempRoot, "queue-partial-b", 0.3, "2026-05-04T14:06:00.000Z");
    let items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });

    const first = await runAutonomousStep(items, policy, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T14:07:00.000Z",
      cooldownWindowMs: 60_000,
    });
    await recordAutonomousExecutionAudit(buildAutonomousExecutionAuditRecord(first), { outputDirectory: auditOutputDirectory });

    items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });
    const second = await runAutonomousStep(items, policy, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T14:07:30.000Z",
      cooldownWindowMs: 60_000,
    });
    const writeResult = await recordAutonomousExecutionAudit(buildAutonomousExecutionAuditRecord(second), {
      outputDirectory: auditOutputDirectory,
    });

    const updatedItems = await queryLearningApplicationQueue({ outputDirectory: tempRoot });
    const payload = await readFile(writeResult.output_path, "utf-8");

    assert.equal(first.executed, true);
    assert.equal(second.executed, false);
    assert.equal(second.execution_result?.reason, "execution cooldown active");
    assert.equal(updatedItems.filter((item) => item.status === "applied").length, 1);
    assert.equal(updatedItems.filter((item) => item.status === "queued").length, 1);
    assert.equal(payload.trim().split(/\r?\n/).length, 2);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});