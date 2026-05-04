import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  attachInsightsToPlan,
  selectOperatorPlan,
  type CoreNodePipelineDraftPlan,
} from "./nodeBoundary";
import { buildDecisionRecord } from "./decisionTrace";
import type { ExecutionOutcomeRecord } from "./executionOutcome";
import { generateExecutionInsights } from "./executionInsight";
import { enqueueLearningApplication, queryLearningApplicationQueue } from "./learningApplicationQueue";
import {
  confirmAndExecute,
  proposeNextQueueExecution,
  resetLearningQueueExecutionProposal,
} from "./learningQueueExecutionProposal";
import { resetLearningExecutionCooldown } from "./learningExecutionCooldown";
import { beginExecutionLock, isExecutionInProgress, resetExecutionLockForTests } from "./learningExecutionLock";
import { resetLearningApplicationState } from "./learningApplicationState";
import { setLearningEnabled } from "./learningConfig";
import { recordLearningRecommendationDecision } from "./learningRecommendationDecision";
import { generateLearningRecommendations, type LearningRecommendation } from "./learningRecommendationReview";
import { buildPassiveLearningAudit } from "./passiveLearningAudit";
import { computeLearningSignals } from "./passiveLearningSignals";
import { simulateRankingAdjustments } from "./passiveLearningSimulation";

test.afterEach(() => {
  setLearningEnabled(false);
  resetLearningApplicationState();
  resetLearningQueueExecutionProposal();
  resetLearningExecutionCooldown();
  resetExecutionLockForTests();
});

function createNodeTaskPlan(overrides: Partial<CoreNodePipelineDraftPlan> = {}): CoreNodePipelineDraftPlan {
  return {
    plan_id: "system-plan-001",
    planning_stage: "planning",
    execution_path: "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control",
    planning_suggestions: [
      "Keep the verified bounded Unity lane unchanged.",
      "Prepare operator-visible review artifacts before any execution decision.",
    ],
    validation_insights: [
      "Validation gates remain mandatory before execution.",
      "Manual approval remains required before core execution.",
    ],
    dependency_reasoning: [
      "The verified EnemyAIDemo lane remains the only supported mutation surface.",
    ],
    validation_gates: ["review approval", "operator approval", "final authorization"],
    execution_authority: "system_only",
    node_id: "core-planner",
    target_node_id: "node-worker-1",
    command: "python validate_runtime.py",
    risk_level: "high",
    working_directory: "E:/AI projects 2025/AI-E",
    target_node_role: "validator",
    target_node_name: "Validator Node 01",
    requester_label: "AI-E Core",
    chat_id: "core-draft",
    request_source: "core-draft-export",
    routing_reason: "core draft routed to validator",
    ...overrides,
  };
}

function createExecutionOutcomeRecord(overrides: Partial<ExecutionOutcomeRecord> = {}): ExecutionOutcomeRecord {
  return {
    outcome_id: "OUT-0000004201",
    created_at: "2026-05-04T00:00:00.000Z",
    source_layer: "node",
    workflow_id: "workflow-layer29-step1",
    task_id: "node-task-layer29-step1",
    plan_id: "system-plan-001",
    node_id: "core-planner",
    target_node_id: "node-worker-1",
    command: "python validate_runtime.py",
    status: "failed",
    success: false,
    risk_level: "high",
    approval_path: ["operator_confirm_submit", "node_intake_review", "node_worker_execution"],
    execution_path: "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control",
    evidence_labels: [
      "NODE RESULT CAPTURED",
      "EXECUTION OUTCOME RECORDED",
      "LEARNING SUBSTRATE APPEND ONLY",
      "NO AUTONOMY TRIGGERED",
    ],
    result_summary: "integration regression failure",
    error_summary: "integration regression failure",
    rollback_required: true,
    rollback_executed: true,
    recovery_status: "executed",
    ...overrides,
  };
}

function createRecommendation(confidence: number): LearningRecommendation {
  const insights = generateExecutionInsights([createExecutionOutcomeRecord()]);
  const annotated = attachInsightsToPlan(createNodeTaskPlan(), insights);
  const alternative = annotated.annotations?.find((annotation) => annotation.type === "plan_adjustment")?.alternative_plan;

  assert.ok(alternative?.plan_id);

  const records = [
    buildDecisionRecord(selectOperatorPlan(annotated, annotated.plan_id), "2026-05-04T00:01:00.000Z"),
    buildDecisionRecord(selectOperatorPlan(annotated, alternative.plan_id), "2026-05-04T00:02:00.000Z"),
    buildDecisionRecord(selectOperatorPlan(annotated, annotated.plan_id), "2026-05-04T00:03:00.000Z"),
  ];
  const signals = computeLearningSignals(records, "2026-05-04T00:04:00.000Z");
  const audit = buildPassiveLearningAudit({
    signals,
    simulations: simulateRankingAdjustments(signals, annotated.plan_rankings ?? []),
    source_decision_record_count: records.length,
    createdAt: "2026-05-04T00:05:00.000Z",
  });
  const recommendation = {
    ...generateLearningRecommendations(audit)[0],
    confidence,
    recommendation_kind: "ranking_adjustment_candidate" as const,
  };

  assert.ok(recommendation);
  return recommendation;
}

test("proposal returns the correct next item", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-proposal-next-"));

  try {
    const firstRecommendation = createRecommendation(0.25);
    const secondRecommendation = createRecommendation(0.6);
    const firstDecision = await recordLearningRecommendationDecision(firstRecommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-04T00:06:00.000Z",
    }, { outputDirectory: tempRoot });
    const secondDecision = await recordLearningRecommendationDecision(secondRecommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-04T00:07:00.000Z",
    }, { outputDirectory: tempRoot });
    const firstQueued = await enqueueLearningApplication(firstRecommendation, firstDecision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-04T00:08:00.000Z",
    });
    await enqueueLearningApplication(secondRecommendation, secondDecision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-04T00:09:00.000Z",
    });

    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });
    const proposal = proposeNextQueueExecution(items);

    assert.equal(proposal.next_queue_id, firstQueued.record.queue_id);
    assert.equal(proposal.requires_confirmation, true);
    assert.match(proposal.reasoning, /Explicit operator confirmation is required/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("execution requires confirmation", async () => {
  const result = await confirmAndExecute("queue-001");

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "operator confirmation required");
  assert.equal(result.applied, false);
});

test("execution cannot run without proposal match", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-proposal-mismatch-"));

  try {
    const recommendation = createRecommendation(0.3);
    const decision = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-04T00:10:00.000Z",
    }, { outputDirectory: tempRoot });
    const queued = await enqueueLearningApplication(recommendation, decision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-04T00:11:00.000Z",
    });
    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });

    proposeNextQueueExecution(items);
    const result = await confirmAndExecute(`${queued.record.queue_id}-different`, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T00:12:00.000Z",
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "proposed queue item mismatch");
    assert.equal(result.applied, false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("execution succeeds if state is unchanged", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-proposal-unchanged-"));

  try {
    setLearningEnabled(true);
    const recommendation = createRecommendation(0.28);
    const decision = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-04T00:18:00.000Z",
    }, { outputDirectory: tempRoot });
    const queued = await enqueueLearningApplication(recommendation, decision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-04T00:19:00.000Z",
    });
    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });

    proposeNextQueueExecution(items);
    const result = await confirmAndExecute(queued.record.queue_id, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T00:20:00.000Z",
    });

    assert.equal(result.status, "applied");
    assert.equal(result.applied, true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("execution is blocked if queue state changed since proposal", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-proposal-state-changed-"));

  try {
    const recommendation = createRecommendation(0.32);
    const decision = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-04T00:21:00.000Z",
    }, { outputDirectory: tempRoot });
    const queued = await enqueueLearningApplication(recommendation, decision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-04T00:22:00.000Z",
    });
    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });

    proposeNextQueueExecution(items);
    await appendMutatedQueueRecord(tempRoot, {
      ...queued.record,
      created_at: "2026-05-04T00:23:00.000Z",
      status: "applied",
      applied: true,
    });

    const result = await confirmAndExecute(queued.record.queue_id, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T00:24:00.000Z",
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "state changed since proposal");
    assert.equal(result.applied, false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("execution is blocked if decision snapshot changed since proposal", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-proposal-decision-changed-"));

  try {
    const recommendation = createRecommendation(0.34);
    const decision = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-04T00:25:00.000Z",
    }, { outputDirectory: tempRoot });
    const queued = await enqueueLearningApplication(recommendation, decision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-04T00:26:00.000Z",
    });
    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });

    proposeNextQueueExecution(items);
    await appendMutatedQueueRecord(tempRoot, {
      ...queued.record,
      created_at: "2026-05-04T00:27:00.000Z",
      decision_snapshot: {
        ...queued.record.decision_snapshot,
        rationale: "changed after proposal",
      },
    });

    const result = await confirmAndExecute(queued.record.queue_id, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T00:28:00.000Z",
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "state changed since proposal");
    assert.equal(result.applied, false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function appendMutatedQueueRecord(outputDirectory: string, record: Awaited<ReturnType<typeof queryLearningApplicationQueue>>[number]) {
  const outputPath = path.join(outputDirectory, `${record.created_at.slice(0, 10)}.jsonl`);
  await appendFile(outputPath, `${JSON.stringify(record)}\n`, "utf-8");
}

test("execution is blocked if already applied before reconfirmation", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-proposal-applied-before-confirm-"));

  try {
    setLearningEnabled(true);
    const recommendation = createRecommendation(0.22);
    const decision = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-04T00:29:00.000Z",
    }, { outputDirectory: tempRoot });
    const queued = await enqueueLearningApplication(recommendation, decision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-04T00:30:00.000Z",
    });
    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });

    proposeNextQueueExecution(items);
    await confirmAndExecute(queued.record.queue_id, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T00:31:00.000Z",
    });
    proposeNextQueueExecution(await queryLearningApplicationQueue({ outputDirectory: tempRoot }));
    const secondAttempt = await confirmAndExecute(queued.record.queue_id, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T00:32:00.000Z",
    });

    assert.equal(secondAttempt.status, "blocked");
    assert.equal(secondAttempt.reason, "operator confirmation required");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("execution is blocked within the cooldown window", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-proposal-cooldown-blocked-"));

  try {
    setLearningEnabled(true);
    const firstRecommendation = createRecommendation(0.18);
    const secondRecommendation = createRecommendation(0.24);
    const firstDecision = await recordLearningRecommendationDecision(firstRecommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-04T01:00:00.000Z",
    }, { outputDirectory: tempRoot });
    const secondDecision = await recordLearningRecommendationDecision(secondRecommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-04T01:00:10.000Z",
    }, { outputDirectory: tempRoot });
    const firstQueued = await enqueueLearningApplication(firstRecommendation, firstDecision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-04T01:00:20.000Z",
    });
    const secondQueued = await enqueueLearningApplication(secondRecommendation, secondDecision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-04T01:00:30.000Z",
    });

    proposeNextQueueExecution(await queryLearningApplicationQueue({ outputDirectory: tempRoot }));
    const firstResult = await confirmAndExecute(firstQueued.record.queue_id, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T01:01:00.000Z",
      cooldownWindowMs: 60_000,
    });

    proposeNextQueueExecution(await queryLearningApplicationQueue({ outputDirectory: tempRoot }));
    const secondResult = await confirmAndExecute(secondQueued.record.queue_id, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T01:01:30.000Z",
      cooldownWindowMs: 60_000,
    });

    assert.equal(firstResult.status, "applied");
    assert.equal(secondResult.status, "blocked");
    assert.equal(secondResult.reason, "execution cooldown active");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("confirmAndExecute blocks when execution lock is active", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-proposal-conflict-active-"));

  try {
    const recommendation = createRecommendation(0.2);
    const decision = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-04T01:05:00.000Z",
    }, { outputDirectory: tempRoot });
    const queued = await enqueueLearningApplication(recommendation, decision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-04T01:05:10.000Z",
    });

    proposeNextQueueExecution(await queryLearningApplicationQueue({ outputDirectory: tempRoot }));
    beginExecutionLock();
    const result = await confirmAndExecute(queued.record.queue_id, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T01:05:20.000Z",
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "execution already in progress");
    assert.equal(result.applied, false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("blocked conflict does not execute queue item", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-proposal-conflict-no-execute-"));

  try {
    setLearningEnabled(true);
    const recommendation = createRecommendation(0.26);
    const decision = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-04T01:05:30.000Z",
    }, { outputDirectory: tempRoot });
    const queued = await enqueueLearningApplication(recommendation, decision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-04T01:05:40.000Z",
    });

    proposeNextQueueExecution(await queryLearningApplicationQueue({ outputDirectory: tempRoot }));
    beginExecutionLock();
    await confirmAndExecute(queued.record.queue_id, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T01:05:50.000Z",
    });
    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });
    const item = items.find((entry) => entry.queue_id === queued.record.queue_id);

    assert.equal(item?.status, "queued");
    assert.equal(item?.applied, false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("lock is released after successful execution", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-proposal-lock-release-success-"));

  try {
    setLearningEnabled(true);
    const recommendation = createRecommendation(0.2);
    const decision = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-04T01:06:00.000Z",
    }, { outputDirectory: tempRoot });
    const queued = await enqueueLearningApplication(recommendation, decision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-04T01:06:10.000Z",
    });

    proposeNextQueueExecution(await queryLearningApplicationQueue({ outputDirectory: tempRoot }));
    const result = await confirmAndExecute(queued.record.queue_id, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T01:06:20.000Z",
      cooldownWindowMs: 60_000,
    });

    assert.equal(result.status, "applied");
    assert.equal(isExecutionInProgress().execution_in_progress, false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("lock is released after blocked inner execution", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-proposal-lock-release-blocked-"));

  try {
    const recommendation = createRecommendation(0.2);
    const decision = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-04T01:06:30.000Z",
    }, { outputDirectory: tempRoot });
    const queued = await enqueueLearningApplication(recommendation, decision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-04T01:06:40.000Z",
    });

    proposeNextQueueExecution(await queryLearningApplicationQueue({ outputDirectory: tempRoot }));
    const result = await confirmAndExecute(queued.record.queue_id, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T01:06:50.000Z",
      cooldownWindowMs: 60_000,
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "learning disabled globally");
    assert.equal(isExecutionInProgress().execution_in_progress, false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("execution is allowed after the cooldown window elapses", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-proposal-cooldown-allowed-"));

  try {
    setLearningEnabled(true);
    const firstRecommendation = createRecommendation(0.18);
    const secondRecommendation = createRecommendation(0.24);
    const firstDecision = await recordLearningRecommendationDecision(firstRecommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-04T01:02:00.000Z",
    }, { outputDirectory: tempRoot });
    const secondDecision = await recordLearningRecommendationDecision(secondRecommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-04T01:02:10.000Z",
    }, { outputDirectory: tempRoot });
    const firstQueued = await enqueueLearningApplication(firstRecommendation, firstDecision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-04T01:02:20.000Z",
    });
    const secondQueued = await enqueueLearningApplication(secondRecommendation, secondDecision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-04T01:02:30.000Z",
    });

    proposeNextQueueExecution(await queryLearningApplicationQueue({ outputDirectory: tempRoot }));
    const firstResult = await confirmAndExecute(firstQueued.record.queue_id, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T01:03:00.000Z",
      cooldownWindowMs: 60_000,
    });

    proposeNextQueueExecution(await queryLearningApplicationQueue({ outputDirectory: tempRoot }));
    const secondResult = await confirmAndExecute(secondQueued.record.queue_id, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T01:04:10.000Z",
      cooldownWindowMs: 60_000,
    });

    assert.equal(firstResult.status, "applied");
    assert.equal(secondResult.status, "applied");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("no multi-item execution occurs", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-proposal-single-"));

  try {
    setLearningEnabled(true);
    const firstRecommendation = createRecommendation(0.2);
    const secondRecommendation = createRecommendation(0.55);
    const firstDecision = await recordLearningRecommendationDecision(firstRecommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-04T00:13:00.000Z",
    }, { outputDirectory: tempRoot });
    const secondDecision = await recordLearningRecommendationDecision(secondRecommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-04T00:14:00.000Z",
    }, { outputDirectory: tempRoot });
    const firstQueued = await enqueueLearningApplication(firstRecommendation, firstDecision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-04T00:15:00.000Z",
    });
    const secondQueued = await enqueueLearningApplication(secondRecommendation, secondDecision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-04T00:16:00.000Z",
    });
    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });

    proposeNextQueueExecution(items);
    const result = await confirmAndExecute(firstQueued.record.queue_id, {
      outputDirectory: tempRoot,
      executedAt: "2026-05-04T00:17:00.000Z",
    });
    const updatedItems = await queryLearningApplicationQueue({ outputDirectory: tempRoot });
    const secondItem = updatedItems.find((item) => item.queue_id === secondQueued.record.queue_id);

    assert.equal(result.status, "applied");
    assert.equal(result.single_item_execution, true);
    assert.equal(secondItem?.status, "queued");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});