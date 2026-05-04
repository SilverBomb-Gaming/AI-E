import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { getAutonomyPolicy } from "./autonomyPolicy";
import { runAutonomousStep } from "./autonomousExecution";
import {
  buildAutonomousExecutionAuditRecord,
  recordAutonomousExecutionAudit,
  renderAutonomousExecutionAudit,
} from "./autonomousExecutionAudit";
import { enqueueLearningApplication, queryLearningApplicationQueue } from "./learningApplicationQueue";
import { resetLearningExecutionCooldown } from "./learningExecutionCooldown";
import { resetExecutionLockForTests } from "./learningExecutionLock";
import { resetLearningQueueExecutionProposal } from "./learningQueueExecutionProposal";
import { resetLearningApplicationState } from "./learningApplicationState";
import { setLearningEnabled } from "./learningConfig";
import { recordLearningRecommendationDecision } from "./learningRecommendationDecision";
import type { LearningRecommendation } from "./learningRecommendationReview";

function createRecommendation(queueId: string, confidence: number): LearningRecommendation {
  return {
    recommendation_id: `recommendation-${queueId}`,
    created_at: "2026-05-04T12:30:00.000Z",
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

test.afterEach(() => {
  setLearningEnabled(false);
  resetLearningApplicationState();
  resetLearningQueueExecutionProposal();
  resetLearningExecutionCooldown();
  resetExecutionLockForTests();
});

test("executed autonomous step creates audit record", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-autonomous-audit-executed-"));

  try {
    setLearningEnabled(true);
    await createQueuedItem(tempRoot, "queue-1", 0.2, "2026-05-04T12:31:00.000Z");
    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });
    const result = await runAutonomousStep(items, {
      ...getAutonomyPolicy(),
      autonomy_enabled: true,
      allowed_lane: "single_queued_learning_item",
      max_items_per_run: 1,
    }, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T12:32:00.000Z",
    });

    const record = buildAutonomousExecutionAuditRecord(result);
    assert.equal(record.executed, true);
    assert.equal(record.selected_queue_id, result.queue_id);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("blocked autonomous step creates audit record", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-autonomous-audit-blocked-"));

  try {
    await createQueuedItem(tempRoot, "queue-1", 0.2, "2026-05-04T12:33:00.000Z");
    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });
    const result = await runAutonomousStep(items, getAutonomyPolicy(), {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T12:34:00.000Z",
    });

    const record = buildAutonomousExecutionAuditRecord(result);
    assert.equal(record.executed, false);
    assert.equal(record.blocked_reason, "autonomy disabled");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("record includes policy snapshot", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-autonomous-audit-policy-"));

  try {
    const policy = {
      ...getAutonomyPolicy(),
      autonomy_enabled: true,
      allowed_lane: "single_queued_learning_item" as const,
      max_items_per_run: 1,
    };
    setLearningEnabled(true);
    await createQueuedItem(tempRoot, "queue-1", 0.2, "2026-05-04T12:35:00.000Z");
    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });
    const result = await runAutonomousStep(items, policy, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T12:36:00.000Z",
    });

    const record = buildAutonomousExecutionAuditRecord(result);
    assert.deepEqual(record.policy_snapshot, policy);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("record includes simulation snapshot", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-autonomous-audit-simulation-"));

  try {
    await createQueuedItem(tempRoot, "queue-1", 0.2, "2026-05-04T12:37:00.000Z");
    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });
    const result = await runAutonomousStep(items, getAutonomyPolicy(), {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T12:38:00.000Z",
    });

    const record = buildAutonomousExecutionAuditRecord(result);
    assert.deepEqual(record.simulation_snapshot, result.simulation);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("record includes safety stack used", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-autonomous-audit-safety-"));

  try {
    await createQueuedItem(tempRoot, "queue-1", 0.2, "2026-05-04T12:39:00.000Z");
    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });
    const result = await runAutonomousStep(items, getAutonomyPolicy(), {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T12:40:00.000Z",
    });

    const record = buildAutonomousExecutionAuditRecord(result);
    assert.deepEqual(record.safety_stack_used, [
      "policy",
      "simulation",
      "proposal",
      "snapshot",
      "cooldown",
      "conflict_lock",
      "gate",
      "drift_guard",
    ]);
    assert.match(renderAutonomousExecutionAudit(record), /Safety stack used:/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("record has single_item_execution true", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-autonomous-audit-single-item-"));

  try {
    await createQueuedItem(tempRoot, "queue-1", 0.2, "2026-05-04T12:41:00.000Z");
    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });
    const result = await runAutonomousStep(items, getAutonomyPolicy(), {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T12:42:00.000Z",
    });

    const record = buildAutonomousExecutionAuditRecord(result);
    assert.equal(record.single_item_execution, true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("input result is not mutated", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-autonomous-audit-immutable-"));

  try {
    await createQueuedItem(tempRoot, "queue-1", 0.2, "2026-05-04T12:43:00.000Z");
    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });
    const result = await runAutonomousStep(items, getAutonomyPolicy(), {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T12:44:00.000Z",
    });
    const before = JSON.stringify(result);

    const record = buildAutonomousExecutionAuditRecord(result);
    await recordAutonomousExecutionAudit(record, { outputDirectory: tempRoot });

    assert.equal(JSON.stringify(result), before);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("recording is append-only", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-autonomous-audit-append-only-"));
  const auditOutputDirectory = path.join(tempRoot, "audits");

  try {
    await createQueuedItem(tempRoot, "queue-1", 0.2, "2026-05-04T12:45:00.000Z");
    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });
    const result = await runAutonomousStep(items, getAutonomyPolicy(), {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T12:46:00.000Z",
    });

    const first = buildAutonomousExecutionAuditRecord(result, { createdAt: "2026-05-04T12:47:00.000Z" });
    const second = buildAutonomousExecutionAuditRecord(result, { createdAt: "2026-05-04T12:48:00.000Z" });
    const writeResult = await recordAutonomousExecutionAudit(first, { outputDirectory: auditOutputDirectory });
    await recordAutonomousExecutionAudit(second, { outputDirectory: auditOutputDirectory });
    const payload = await readFile(writeResult.output_path, "utf-8");

    assert.equal(payload.trim().split(/\r?\n/).length, 2);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});