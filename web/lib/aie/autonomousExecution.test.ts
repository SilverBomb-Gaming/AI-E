import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { getAutonomyPolicy } from "./autonomyPolicy";
import { runAutonomousStep } from "./autonomousExecution";
import { enqueueLearningApplication, queryLearningApplicationQueue } from "./learningApplicationQueue";
import { resetLearningExecutionCooldown } from "./learningExecutionCooldown";
import { beginExecutionLock, resetExecutionLockForTests } from "./learningExecutionLock";
import { resetLearningQueueExecutionProposal } from "./learningQueueExecutionProposal";
import { resetLearningApplicationState } from "./learningApplicationState";
import { setLearningEnabled } from "./learningConfig";
import { recordLearningRecommendationDecision } from "./learningRecommendationDecision";
import type { LearningRecommendation } from "./learningRecommendationReview";

function createRecommendation(queueId: string, confidence: number): LearningRecommendation {
  return {
    recommendation_id: `recommendation-${queueId}`,
    created_at: "2026-05-04T12:00:00.000Z",
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

test("no execution when autonomy disabled", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-autonomous-disabled-"));

  try {
    await createQueuedItem(tempRoot, "queue-1", 0.2, "2026-05-04T12:01:00.000Z");
    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });

    const result = await runAutonomousStep(items, getAutonomyPolicy(), {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T12:02:00.000Z",
    });

    assert.equal(result.executed, false);
    assert.equal(result.reason, "autonomy disabled");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("execution occurs when enabled", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-autonomous-enabled-"));

  try {
    setLearningEnabled(true);
    const queued = await createQueuedItem(tempRoot, "queue-1", 0.2, "2026-05-04T12:03:00.000Z");
    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });

    const result = await runAutonomousStep(items, {
      ...getAutonomyPolicy(),
      autonomy_enabled: true,
      allowed_lane: "single_queued_learning_item",
      max_items_per_run: 1,
    }, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T12:04:00.000Z",
    });

    assert.equal(result.executed, true);
    assert.equal(result.queue_id, queued.record.queue_id);
    assert.equal(result.execution_result?.status, "applied");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("only one item executed", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-autonomous-one-item-"));

  try {
    setLearningEnabled(true);
    await createQueuedItem(tempRoot, "queue-1", 0.2, "2026-05-04T12:05:00.000Z");
    const secondQueued = await createQueuedItem(tempRoot, "queue-2", 0.3, "2026-05-04T12:06:00.000Z");
    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });

    await runAutonomousStep(items, {
      ...getAutonomyPolicy(),
      autonomy_enabled: true,
      allowed_lane: "single_queued_learning_item",
      max_items_per_run: 1,
    }, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T12:07:00.000Z",
    });

    const updatedItems = await queryLearningApplicationQueue({ outputDirectory: tempRoot });
    assert.equal(updatedItems.filter((item) => item.status === "applied").length, 1);
    assert.equal(updatedItems.some((item) => item.queue_id === secondQueued.record.queue_id && item.status === "queued"), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("blocked items are not executed", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-autonomous-blocked-"));

  try {
    const queued = await createQueuedItem(tempRoot, "queue-1", 0.2, "2026-05-04T12:08:00.000Z");
    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });

    const result = await runAutonomousStep(items, {
      ...getAutonomyPolicy(),
      autonomy_enabled: true,
      allowed_lane: "single_queued_learning_item",
      max_items_per_run: 1,
    }, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T12:09:00.000Z",
    });

    assert.equal(result.executed, false);
    assert.equal(result.queue_id, queued.record.queue_id);
    assert.equal(result.execution_result?.status, "blocked");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("execution respects cooldown", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-autonomous-cooldown-"));

  try {
    setLearningEnabled(true);
    await createQueuedItem(tempRoot, "queue-1", 0.2, "2026-05-04T12:10:00.000Z");
    const secondQueued = await createQueuedItem(tempRoot, "queue-2", 0.3, "2026-05-04T12:11:00.000Z");
    let items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });

    const first = await runAutonomousStep(items, {
      ...getAutonomyPolicy(),
      autonomy_enabled: true,
      allowed_lane: "single_queued_learning_item",
      max_items_per_run: 1,
    }, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T12:12:00.000Z",
      cooldownWindowMs: 60_000,
    });

    items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });
    const second = await runAutonomousStep(items, {
      ...getAutonomyPolicy(),
      autonomy_enabled: true,
      allowed_lane: "single_queued_learning_item",
      max_items_per_run: 1,
    }, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T12:12:30.000Z",
      cooldownWindowMs: 60_000,
    });

    assert.equal(first.executed, true);
    assert.equal(second.executed, false);
    assert.equal(second.queue_id, secondQueued.record.queue_id);
    assert.equal(second.execution_result?.reason, "execution cooldown active");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("execution respects conflict lock", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-autonomous-conflict-"));

  try {
    setLearningEnabled(true);
    const queued = await createQueuedItem(tempRoot, "queue-1", 0.2, "2026-05-04T12:13:00.000Z");
    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });

    beginExecutionLock();
    const result = await runAutonomousStep(items, {
      ...getAutonomyPolicy(),
      autonomy_enabled: true,
      allowed_lane: "single_queued_learning_item",
      max_items_per_run: 1,
    }, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T12:14:00.000Z",
    });

    assert.equal(result.executed, false);
    assert.equal(result.queue_id, queued.record.queue_id);
    assert.equal(result.execution_result?.reason, "execution already in progress");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("execution does not loop", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-autonomous-no-loop-"));

  try {
    setLearningEnabled(true);
    await createQueuedItem(tempRoot, "queue-1", 0.2, "2026-05-04T12:15:00.000Z");
    await createQueuedItem(tempRoot, "queue-2", 0.3, "2026-05-04T12:16:00.000Z");
    await createQueuedItem(tempRoot, "queue-3", 0.4, "2026-05-04T12:17:00.000Z");
    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });

    const result = await runAutonomousStep(items, {
      ...getAutonomyPolicy(),
      autonomy_enabled: true,
      allowed_lane: "single_queued_learning_item",
      max_items_per_run: 1,
    }, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T12:18:00.000Z",
    });

    const updatedItems = await queryLearningApplicationQueue({ outputDirectory: tempRoot });
    assert.equal(result.single_item_execution, true);
    assert.equal(updatedItems.filter((item) => item.status === "applied").length, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});