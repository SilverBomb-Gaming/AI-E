import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  acknowledgePlanInsights,
  attachInsightsToPlan,
  buildInsightAcknowledgementPrompt,
  exportNodeTaskDraftToPipeline,
  mergeNodePlanningHints,
  receiveNodeIntent,
  translatePlanToNodeTask,
  validateNodeDispatchDraft,
  validateNodeTaskDraft,
  validateNodeIntentEnvelope,
  type CoreNodePipelineDraftPlan,
  type NodeAdvisoryPlan,
  type CoreNodeTaskTranslationPlan,
  type NodeIntentEnvelope,
} from "./nodeBoundary";
import { generateExecutionInsights } from "./executionInsight";
import type { ExecutionOutcomeRecord } from "./executionOutcome";

function createEnvelope(overrides: Partial<NodeIntentEnvelope> = {}): NodeIntentEnvelope {
  return {
    source: "aie_node",
    node_id: "node-alpha",
    intent_id: "intent-001",
    requested_at: "2026-05-02T15:00:00.000Z",
    operator_visible_summary: "Node asks for a reviewed bounded Unity execution request.",
    intent_kind: "execution_request",
    payload: {
      objective: "Request reviewed execution of the bounded verified Unity lane after manual approval.",
      requested_execution_path: "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control",
      requested_stage: "strategy",
      planning_hint: [],
      validation_hint: [],
      dependency_hint: [],
    },
    permissions: {
      can_execute: false,
      can_approve: false,
      can_rollback: false,
    },
    ...overrides,
  };
}

function createSystemPlan(): NodeAdvisoryPlan {
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
    validation_gates: [
      "review approval",
      "operator approval",
      "final authorization",
    ],
    execution_authority: "system_only",
  };
}

function createNodeTaskTranslationPlan(overrides: Partial<CoreNodeTaskTranslationPlan> = {}): CoreNodeTaskTranslationPlan {
  return {
    ...createSystemPlan(),
    node_id: "core-planner",
    target_node_id: "node-worker-1",
    command: "validate bounded EnemyAIDemo planning packet and summarize review gates",
    risk_level: "low",
    ...overrides,
  };
}

function createExportableNodeTaskPlan(overrides: Partial<CoreNodePipelineDraftPlan> = {}): CoreNodePipelineDraftPlan {
  return {
    ...createNodeTaskTranslationPlan({
      command: "python validate_runtime.py",
      risk_level: "low",
    }),
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
    outcome_id: "OUT-0000001001",
    created_at: "2026-05-02T20:00:00.000Z",
    source_layer: "node",
    workflow_id: "workflow-layer21-step1",
    task_id: "node-task-layer21-step1",
    plan_id: "system-plan-001",
    node_id: "core-planner",
    target_node_id: "node-worker-1",
    command: "python validate_runtime.py",
    status: "completed",
    success: true,
    risk_level: "low",
    approval_path: ["operator_confirm_submit", "node_intake_review", "node_worker_execution"],
    execution_path: "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control",
    evidence_labels: [
      "NODE RESULT CAPTURED",
      "EXECUTION OUTCOME RECORDED",
      "LEARNING SUBSTRATE APPEND ONLY",
      "NO AUTONOMY TRIGGERED",
    ],
    result_summary: "[OK] bounded validation complete",
    rollback_required: false,
    rollback_executed: false,
    recovery_status: "not_required",
    ...overrides,
  };
}

test("valid Node execution request is accepted for review only", () => {
  const result = receiveNodeIntent(createEnvelope());

  assert.equal(result.status, "accepted_for_review");
  assert.equal(result.review_status, "pending_review");
  assert.equal(result.node_can_execute, false);
  assert.equal(result.mutating, false);
  assert.equal(result.unity_access, "blocked");
  assert.match(result.reason, /reviewable input only/i);
  assert.deepEqual(result.evidence_labels, [
    "NODE INTENT RECEIVED",
    "NODE BOUNDARY CHECK PASSED",
    "NODE INTENT ACCEPTED FOR REVIEW",
  ]);
});

test("valid Node validation request is accepted for review only", () => {
  const result = receiveNodeIntent(createEnvelope({
    intent_kind: "validation_request",
    operator_visible_summary: "Node asks for bounded validation feedback only.",
    payload: {
      objective: "Request validation feedback for the verified EnemyAIDemo lane.",
      requested_execution_path: "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control",
      requested_stage: "strategy",
    },
  }));

  assert.equal(result.status, "accepted_for_review");
  assert.equal(result.accepted_intent_kind, "validation_request");
  assert.equal(result.node_can_execute, false);
  assert.equal(result.rollback_triggered, false);
});

test("Node direct execution request is rejected", () => {
  const result = receiveNodeIntent(createEnvelope({
    payload: {
      objective: "Execute now.",
      action: "unity_scene_object_creation",
      target_scene: "EnemyAIDemo",
    },
  }));

  assert.equal(result.status, "rejected_boundary_violation");
  assert.equal(result.mutating, false);
  assert.equal(result.node_can_execute, false);
  assert.ok(result.evidence_labels.includes("NODE DIRECT EXECUTION BLOCKED"));
  assert.match(result.reason, /direct execution|unity mutation/i);
});

test("Node direct rollback request is rejected", () => {
  const result = receiveNodeIntent(createEnvelope({
    payload: {
      objective: "Run rollback immediately.",
      action: "manual_rollback",
      rollback_target: "AIE_ControlledMutationProbe",
    },
  }));

  assert.equal(result.status, "rejected_boundary_violation");
  assert.equal(result.rollback_triggered, false);
  assert.ok(result.evidence_labels.includes("NODE DIRECT ROLLBACK BLOCKED"));
  assert.match(result.reason, /direct rollback|manual-only/i);
});

test("Node approval attempt is rejected", () => {
  const validation = validateNodeIntentEnvelope(createEnvelope({
    permissions: {
      can_execute: false,
      can_approve: true as never,
      can_rollback: false,
    },
  }));

  assert.equal(validation.ok, false);
  assert.equal(validation.category, "boundary_violation");
  assert.match(validation.reason ?? "", /cannot execute, approve, or rollback/i);
});

test("Node intent cannot bypass Strategy Planning Review Delivery or Studio Control", () => {
  const result = receiveNodeIntent(createEnvelope({
    payload: {
      objective: "Request a non-standard shortened route.",
      requested_execution_path: "Strategy -> Planning -> Review",
      requested_stage: "execution",
    },
  }));

  assert.equal(result.status, "rejected_boundary_violation");
  assert.match(result.reason, /bypasses the required Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control path/i);
});

test("accepted Node intent does not mutate Unity", () => {
  const result = receiveNodeIntent(createEnvelope());

  assert.equal(result.status, "accepted_for_review");
  assert.equal(result.mutating, false);
  assert.equal(result.unity_access, "blocked");
});

test("accepted Node intent does not trigger rollback", () => {
  const result = receiveNodeIntent(createEnvelope({ intent_kind: "status_request" }));

  assert.equal(result.status, "accepted_for_review");
  assert.equal(result.rollback_triggered, false);
  assert.equal(result.node_can_rollback, false);
});

test("Node hints appear in planning stage", () => {
  const receipt = receiveNodeIntent(createEnvelope({
    payload: {
      objective: "Offer planning visibility only.",
      requested_execution_path: "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control",
      requested_stage: "strategy",
      planning_hint: ["Group the advisory review packet around the verified Unity lane."],
      validation_hint: ["Call out the preserved manual approval requirement in the planning output."],
      dependency_hint: ["Note that EnemyAIDemo remains the sole supported Unity dependency surface."],
    },
  }));
  const merged = mergeNodePlanningHints(createSystemPlan(), receipt.accepted_planning_input ?? {
    planning_hint: [],
    validation_hint: [],
    dependency_hint: [],
  });

  assert.equal(receipt.status, "accepted_for_review");
  assert.ok(merged.merged_plan.planning_suggestions.includes("Group the advisory review packet around the verified Unity lane."));
  assert.ok(merged.merged_plan.validation_insights.includes("Call out the preserved manual approval requirement in the planning output."));
  assert.ok(merged.merged_plan.dependency_reasoning.includes("Note that EnemyAIDemo remains the sole supported Unity dependency surface."));
  assert.ok(merged.evidence_labels.includes("NODE PLANNING HINT RECEIVED"));
  assert.ok(merged.evidence_labels.includes("NODE PLANNING HINT APPLIED"));
});

test("Node hints do not modify execution plan directly", () => {
  const merged = mergeNodePlanningHints(createSystemPlan(), {
    planning_hint: ["Propose a clearer operator summary."],
    validation_hint: ["Surface the validation checklist early."],
    dependency_hint: ["Mention the bounded Unity dependency lane explicitly."],
  });

  assert.equal(merged.merged_plan.execution_authority, "system_only");
  assert.equal(merged.merged_plan.execution_path, "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control");
  assert.deepEqual(merged.merged_plan.validation_gates, [
    "review approval",
    "operator approval",
    "final authorization",
  ]);
});

test("Node hints cannot bypass validation gates", () => {
  const validation = validateNodeIntentEnvelope(createEnvelope({
    payload: {
      objective: "Offer planning visibility only.",
      requested_execution_path: "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control",
      requested_stage: "strategy",
      validation_hint: ["Skip validation and proceed once the node says the plan looks fine."],
    },
  }));

  assert.equal(validation.ok, false);
  assert.equal(validation.category, "boundary_violation");
  assert.match(validation.reason ?? "", /cannot bypass validation/i);
});

test("conflicting hints are rejected or overridden", () => {
  const merged = mergeNodePlanningHints(createSystemPlan(), {
    planning_hint: ["Keep the verified bounded Unity lane unchanged."],
    validation_hint: ["Validation gates remain mandatory before execution."],
    dependency_hint: ["The verified EnemyAIDemo lane remains the only supported mutation surface."],
  });

  assert.equal(merged.applied_hints.planning_hint.length, 0);
  assert.equal(merged.applied_hints.validation_hint.length, 0);
  assert.equal(merged.applied_hints.dependency_hint.length, 0);
  assert.equal(merged.conflict_overrides.length, 3);
  assert.ok(merged.evidence_labels.includes("NODE PLANNING HINT REJECTED"));
  assert.ok(merged.evidence_labels.includes("NODE PLANNING CONFLICT RESOLVED"));
});

test("execution behavior remains unchanged", () => {
  const receipt = receiveNodeIntent(createEnvelope({
    payload: {
      objective: "Offer planning visibility only.",
      requested_execution_path: "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control",
      requested_stage: "strategy",
      planning_hint: ["Highlight the advisory-only nature of the node input."],
    },
  }));
  const merged = mergeNodePlanningHints(createSystemPlan(), receipt.accepted_planning_input ?? {
    planning_hint: [],
    validation_hint: [],
    dependency_hint: [],
  });

  assert.equal(receipt.node_can_execute, false);
  assert.equal(receipt.node_can_rollback, false);
  assert.equal(receipt.node_can_approve, false);
  assert.equal(receipt.mutating, false);
  assert.equal(receipt.rollback_triggered, false);
  assert.equal(merged.merged_plan.execution_authority, "system_only");
});

test("insights attach to plans as non-binding annotations", () => {
  const insights = generateExecutionInsights([
    createExecutionOutcomeRecord(),
    createExecutionOutcomeRecord({
      outcome_id: "OUT-0000001002",
      created_at: "2026-05-02T20:05:00.000Z",
      target_node_id: "node-worker-1",
      node_id: "core-planner",
      risk_level: "high",
      command: "pytest tests/test_node_draft_integration.py",
      success: false,
      status: "failed",
      rollback_required: true,
      rollback_executed: true,
      result_summary: "integration regression failure",
      error_summary: "integration regression failure",
      recovery_status: "executed",
    }),
  ]);

  const annotated = attachInsightsToPlan(createNodeTaskTranslationPlan({ risk_level: "high" }), insights);

  assert.ok(Array.isArray(annotated.annotations));
  assert.ok((annotated.annotations?.length ?? 0) >= 2);
  assert.ok(annotated.annotations?.some((annotation) => annotation.type === "risk_warning"));
  assert.ok(annotated.annotations?.some((annotation) => annotation.type === "reliability_note" || annotation.type === "pattern_note"));
  assert.ok(annotated.annotations?.some((annotation) => annotation.type === "plan_adjustment"));
  assert.ok(annotated.annotations?.every((annotation) => annotation.informational_only === true && annotation.confidence >= 0 && annotation.confidence <= 1));
  assert.ok(annotated.annotations?.every((annotation) => ["low", "medium", "high", "critical"].includes(annotation.severity)));
  assert.ok(annotated.annotations?.some((annotation) => annotation.suggestion));
  assert.ok(annotated.annotations?.filter((annotation) => annotation.type === "plan_adjustment").every((annotation) => (annotation.alternative_plan?.steps.length ?? 0) > 0));
  assert.deepEqual(annotated.operator_acknowledgement, { acknowledged: false });
});

test("operator acknowledgement is recorded without changing execution behavior", () => {
  const annotated = attachInsightsToPlan(createNodeTaskTranslationPlan({ risk_level: "high" }), generateExecutionInsights([
    createExecutionOutcomeRecord({
      outcome_id: "OUT-0000001005",
      created_at: "2026-05-02T21:00:00.000Z",
      risk_level: "high",
      rollback_required: true,
      rollback_executed: false,
      success: false,
      status: "blocked",
      result_summary: "operator blocked run",
      error_summary: "operator blocked run",
      recovery_status: "planned",
    }),
  ]));

  const acknowledged = acknowledgePlanInsights(annotated, "2026-05-02T21:05:00.000Z");
  const translated = translatePlanToNodeTask(acknowledged);

  assert.deepEqual(acknowledged.operator_acknowledgement, {
    acknowledged: true,
    acknowledged_at: "2026-05-02T21:05:00.000Z",
  });
  assert.equal(acknowledged.execution_path, annotated.execution_path);
  assert.deepEqual(acknowledged.validation_gates, annotated.validation_gates);
  assert.equal(translated.status, "draft_generated");
  assert.equal(translated.execution_triggered, false);
  assert.equal(translated.node_intake_triggered, false);
});

test("acknowledgement prompt is visible but non-blocking", () => {
  const annotated = attachInsightsToPlan(createNodeTaskTranslationPlan({ risk_level: "high" }), generateExecutionInsights([
    createExecutionOutcomeRecord({
      outcome_id: "OUT-0000001006",
      created_at: "2026-05-02T21:10:00.000Z",
      risk_level: "high",
      rollback_required: true,
      rollback_executed: true,
      success: false,
      status: "failed",
      result_summary: "integration regression failure",
      error_summary: "integration regression failure",
      recovery_status: "executed",
    }),
  ]));

  const prompt = buildInsightAcknowledgementPrompt(annotated);

  assert.ok(prompt);
  assert.match(prompt ?? "", /Original plan:/);
  assert.match(prompt ?? "", /Insights detected:/);
  assert.match(prompt ?? "", /\[(LOW|MEDIUM|HIGH|CRITICAL)\]/);
  assert.match(prompt ?? "", /Suggestion:/);
  assert.match(prompt ?? "", /Alternative plan:/);
  assert.match(prompt ?? "", /Acknowledge before proceeding\? \(yes\/no\)/);
});

test("plan adjustment alternatives remain separate from the original plan", () => {
  const source = createNodeTaskTranslationPlan({ risk_level: "high" });
  const annotated = attachInsightsToPlan(source, generateExecutionInsights([
    createExecutionOutcomeRecord({
      outcome_id: "OUT-0000001008",
      created_at: "2026-05-02T21:20:00.000Z",
      risk_level: "high",
      rollback_required: true,
      rollback_executed: true,
      success: false,
      status: "failed",
      result_summary: "integration regression failure",
      error_summary: "integration regression failure",
      recovery_status: "executed",
    }),
  ]));

  const adjustment = annotated.annotations?.find((annotation) => annotation.type === "plan_adjustment");

  assert.ok(adjustment);
  assert.ok(adjustment?.alternative_plan);
  assert.notDeepEqual(adjustment?.alternative_plan?.steps, [source.command]);
  assert.equal(source.command, "validate bounded EnemyAIDemo planning packet and summarize review gates");
  assert.deepEqual(source.validation_gates, [
    "review approval",
    "operator approval",
    "final authorization",
  ]);
});

test("acknowledgement helpers do not mutate the source plan", () => {
  const source = attachInsightsToPlan(createExportableNodeTaskPlan({ risk_level: "high" }), generateExecutionInsights([
    createExecutionOutcomeRecord({
      outcome_id: "OUT-0000001007",
      created_at: "2026-05-02T21:15:00.000Z",
      risk_level: "high",
      rollback_required: true,
      rollback_executed: false,
      success: false,
      status: "blocked",
      result_summary: "operator blocked run",
      error_summary: "operator blocked run",
      recovery_status: "planned",
    }),
  ]));
  const before = JSON.stringify(source);

  const acknowledged = acknowledgePlanInsights(source, "2026-05-02T21:16:00.000Z");

  assert.equal(JSON.stringify(source), before);
  assert.equal(source.operator_acknowledgement?.acknowledged, false);
  assert.equal(acknowledged.operator_acknowledgement.acknowledged, true);
  assert.equal(acknowledged.command, source.command);
});

test("insight annotations do not change execution path or validation gates", () => {
  const basePlan = createNodeTaskTranslationPlan({ risk_level: "high" });
  const annotated = attachInsightsToPlan(basePlan, generateExecutionInsights([
    createExecutionOutcomeRecord({
      outcome_id: "OUT-0000001003",
      created_at: "2026-05-02T20:10:00.000Z",
      risk_level: "high",
      rollback_required: true,
      rollback_executed: false,
      success: false,
      status: "blocked",
      result_summary: "operator blocked run",
      error_summary: "operator blocked run",
      recovery_status: "planned",
    }),
  ]));

  assert.equal(annotated.execution_path, basePlan.execution_path);
  assert.equal(annotated.execution_authority, "system_only");
  assert.deepEqual(annotated.validation_gates, basePlan.validation_gates);
  assert.equal(annotated.command, basePlan.command);
});

test("annotated plans translate without changing submission or execution behavior", () => {
  const basePlan = createExportableNodeTaskPlan({ risk_level: "high" });
  const annotated = attachInsightsToPlan(basePlan, generateExecutionInsights([
    createExecutionOutcomeRecord({
      outcome_id: "OUT-0000001004",
      created_at: "2026-05-02T20:15:00.000Z",
      risk_level: "high",
      rollback_required: true,
      rollback_executed: true,
      success: false,
      status: "failed",
      result_summary: "integration regression failure",
      error_summary: "integration regression failure",
      recovery_status: "executed",
    }),
  ]));

  const translated = translatePlanToNodeTask(annotated);

  assert.equal(translated.status, "draft_generated");
  assert.equal(translated.submitted_to_node, false);
  assert.equal(translated.node_intake_triggered, false);
  assert.equal(translated.execution_triggered, false);
  assert.equal(translated.draft?.target_node_id, basePlan.target_node_id);
  assert.equal(translated.draft?.command, basePlan.command);
});

test("valid plan translates into valid Node task JSON draft", () => {
  const result = translatePlanToNodeTask(createNodeTaskTranslationPlan());

  assert.equal(result.status, "draft_generated");
  assert.deepEqual(result.draft, {
    task_id: "node-task-system-plan-001",
    node_id: "core-planner",
    target_node_id: "node-worker-1",
    command: "validate bounded EnemyAIDemo planning packet and summarize review gates",
    requires_sudo: false,
    risk_level: "low",
    approval_status: "pending",
    signature: null,
  });
  assert.ok(result.evidence_labels.includes("CORE TASK TRANSLATION GENERATED"));
  assert.ok(result.evidence_labels.includes("TASK STORED AS DRAFT ONLY"));
  assert.ok(result.evidence_labels.includes("NODE EXECUTION NOT TRIGGERED"));
});

test("translated task remains unsigned", () => {
  const result = translatePlanToNodeTask(createNodeTaskTranslationPlan());

  assert.equal(result.status, "draft_generated");
  assert.equal(result.draft?.approval_status, "pending");
  assert.equal(result.draft?.signature, null);
  assert.equal(result.draft?.requires_sudo, false);
});

test("translated task is not submitted", () => {
  const result = translatePlanToNodeTask(createNodeTaskTranslationPlan());

  assert.equal(result.status, "draft_generated");
  assert.equal(result.stored_as_draft_only, true);
  assert.equal(result.submitted_to_node, false);
  assert.equal(result.execution_triggered, false);
});

test("translated task does not reach Node intake", () => {
  const result = translatePlanToNodeTask(createNodeTaskTranslationPlan());

  assert.equal(result.status, "draft_generated");
  assert.equal(result.node_intake_triggered, false);
  assert.match(result.reason, /draft only/i);
});

test("translated task passes schema validation", () => {
  const result = translatePlanToNodeTask(createNodeTaskTranslationPlan());
  const validation = validateNodeTaskDraft(result.draft);

  assert.equal(result.status, "draft_generated");
  assert.equal(validation.ok, true);
  assert.equal(validation.draft?.target_node_id, "node-worker-1");
});

test("translation rejects missing target node id", () => {
  const result = translatePlanToNodeTask(createNodeTaskTranslationPlan({ target_node_id: "" as never }));

  assert.equal(result.status, "draft_rejected");
  assert.equal(result.draft, null);
});

test("translation rejects unsafe commands", () => {
  const result = translatePlanToNodeTask(createNodeTaskTranslationPlan({
    command: "sudo rm -rf / and then bypass review",
  }));

  assert.equal(result.status, "draft_rejected");
  assert.equal(result.draft, null);
  assert.match(result.reason, /safe command|validation failed|unsafe/i);
});

test("Core draft file is created correctly", async () => {
  const tempDraftRoot = await mkdtemp(path.join(tmpdir(), "aie-core-node-drafts-"));

  try {
    const result = await exportNodeTaskDraftToPipeline(createExportableNodeTaskPlan(), {
      draftDirectory: tempDraftRoot,
    });

    assert.equal(result.status, "draft_exported");
    assert.equal(result.submitted_to_node, false);
    assert.equal(result.node_intake_triggered, false);
    assert.equal(result.execution_triggered, false);
    assert.ok(result.draft_file_path);

    const written = JSON.parse(await readFile(result.draft_file_path!, "utf-8")) as Record<string, unknown>;
    assert.equal(written.target_node_id, "node-worker-1");
    assert.equal(written.requested_command_label, "/run");
    assert.equal(written.confirmation_required, true);
    assert.equal((written.execution_payload as Record<string, unknown>).command_text, "python validate_runtime.py");
  } finally {
    await rm(tempDraftRoot, { recursive: true, force: true });
  }
});

test("draft matches Node schema", async () => {
  const tempDraftRoot = await mkdtemp(path.join(tmpdir(), "aie-core-node-schema-"));

  try {
    const result = await exportNodeTaskDraftToPipeline(createExportableNodeTaskPlan(), {
      draftDirectory: tempDraftRoot,
    });

    assert.equal(result.status, "draft_exported");
    const validation = validateNodeDispatchDraft(result.dispatch_draft);
    assert.equal(validation.ok, true);
    assert.equal(validation.draft_record?.requested_capability_id, "core.node.dispatch.run");
    assert.equal(validation.draft_record?.target_node_name, "Validator Node 01");
  } finally {
    await rm(tempDraftRoot, { recursive: true, force: true });
  }
});

test("draft export does not execute automatically", async () => {
  const tempDraftRoot = await mkdtemp(path.join(tmpdir(), "aie-core-node-noexec-"));

  try {
    const result = await exportNodeTaskDraftToPipeline(createExportableNodeTaskPlan(), {
      draftDirectory: tempDraftRoot,
    });

    assert.equal(result.status, "draft_exported");
    assert.equal(result.stored_as_draft_only, true);
    assert.equal(result.submitted_to_node, false);
    assert.equal(result.node_intake_triggered, false);
    assert.equal(result.execution_triggered, false);
  } finally {
    await rm(tempDraftRoot, { recursive: true, force: true });
  }
});

test("evidence clearly explains accept and reject reason", () => {
  const accepted = receiveNodeIntent(createEnvelope());
  const rejected = receiveNodeIntent(createEnvelope({
    payload: {
      objective: "Run rollback immediately.",
      action: "manual_rollback",
    },
  }));

  assert.match(accepted.reason, /reviewable input only/i);
  assert.deepEqual(accepted.evidence_labels, [
    "NODE INTENT RECEIVED",
    "NODE BOUNDARY CHECK PASSED",
    "NODE INTENT ACCEPTED FOR REVIEW",
  ]);
  assert.match(rejected.reason, /rollback/i);
  assert.ok(rejected.evidence_labels.includes("NODE BOUNDARY CHECK FAILED"));
  assert.ok(rejected.evidence_labels.includes("NODE DIRECT ROLLBACK BLOCKED"));
});