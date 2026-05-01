import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createAutonomousDeliveryPackage, createAutonomousReviewPackage } from "./autonomousWorkPlanning";
import { createOperatorDashboardDemoState } from "./operatorDashboardDemoState";
import {
  extractUnityValidationEvidenceFromDeliveryPackage,
  extractUnityValidationEvidenceFromReviewPackage,
  UnityValidationEvidencePanel,
} from "./unityValidationEvidenceView";

test("delivery package evidence renders read-only bridge validation details", () => {
  const deliveryPackage = createAutonomousDeliveryPackage({
    delivery_package_id: "unity-delivery-1",
    review_package_id: "unity-review-1",
    work_item_id: "unity-validation-1",
    chain_id: "unity-chain-1",
    branch_name: "",
    commit_plan: [],
    files_changed: [],
    validation_results: [
      "Execution kind: real_bridge_read_only",
      "Bridge status: bridge_ready",
      "Scene validation status: checked_with_findings",
      "Checked scene name: CastleHub",
      "Missing script count: 2",
      "Console error count: 1",
      "Object count: 487",
      "Evidence timestamp: 2026-05-01T12:00:00.000Z",
      "Recommended next operator action: review Unity findings before any broader endpoint rollout",
    ],
    proof_results: ["real_bridge_read_only"],
    risk_summary: "Read-only Unity validation evidence only. No mutation path enabled.",
    rollback_plan: "Discard the evidence handoff package if the validation request is rejected.",
    release_notes: "Unity read-only validation probe completed for CastleHub with status checked_with_findings, missing scripts 2, console errors 1, and object count 487.",
    recommended_pr_title: "",
    recommended_pr_body: "Unity validation evidence handoff",
    operator_decision: null,
    status: "awaiting_operator_approval",
    created_at: "2026-05-01T12:00:00.000Z",
    updated_at: "2026-05-01T12:00:00.000Z",
  });

  const evidence = extractUnityValidationEvidenceFromDeliveryPackage(deliveryPackage);

  assert.ok(evidence);
  assert.equal(evidence.kind, "real_bridge_read_only");
  assert.equal(evidence.bridgeStatus, "bridge_ready");
  assert.equal(evidence.checkedSceneName, "CastleHub");
  assert.equal(evidence.missingScriptCount, 2);
  assert.equal(evidence.consoleErrorCount, 1);
  assert.equal(evidence.objectCount, 487);

  const markup = renderToStaticMarkup(createElement(UnityValidationEvidencePanel, { evidence }));
  assert.match(markup, /Unity validation evidence/);
  assert.match(markup, /Read-Only Bridge/);
  assert.match(markup, /Bridge status: bridge_ready/);
  assert.doesNotMatch(markup, /Approve For Commit|Run Playtest|Execute/i);
});

test("delivery package evidence renders unavailable bridge details honestly", () => {
  const deliveryPackage = createAutonomousDeliveryPackage({
    delivery_package_id: "unity-delivery-2",
    review_package_id: "unity-review-2",
    work_item_id: "unity-validation-2",
    chain_id: "unity-chain-2",
    branch_name: "",
    commit_plan: [],
    files_changed: [],
    validation_results: [
      "Execution kind: real_bridge_unavailable",
      "Bridge status: bridge_unavailable",
      "Scene validation status: not_checked",
      "Checked scene name: none",
      "Missing script count: unknown",
      "Console error count: unknown",
      "Object count: unknown",
      "Evidence timestamp: 2026-05-01T12:30:00.000Z",
      "Recommended next operator action: start the Unity endpoint before requesting another validation run",
    ],
    proof_results: ["real_bridge_unavailable"],
    risk_summary: "Read-only Unity validation evidence only. No mutation path enabled.",
    rollback_plan: "Discard the evidence handoff package if the validation request is rejected.",
    release_notes: "A real Unity read-only validation bridge was requested but is currently unavailable. No adapter preview fallback was substituted silently, and no project mutation was performed.",
    recommended_pr_title: "",
    recommended_pr_body: "Unity validation evidence handoff",
    operator_decision: null,
    status: "awaiting_operator_approval",
    created_at: "2026-05-01T12:30:00.000Z",
    updated_at: "2026-05-01T12:30:00.000Z",
  });

  const evidence = extractUnityValidationEvidenceFromDeliveryPackage(deliveryPackage);

  assert.ok(evidence);
  assert.equal(evidence.kind, "real_bridge_unavailable");
  assert.equal(evidence.bridgeStatus, "bridge_unavailable");
  assert.equal(evidence.sceneValidationStatus, "not_checked");

  const markup = renderToStaticMarkup(createElement(UnityValidationEvidencePanel, { evidence }));
  assert.match(markup, /Bridge Unavailable/);
  assert.match(markup, /Bridge status: bridge_unavailable/);
});

test("review package evidence supports adapter preview and dashboard demo state stays loadable", () => {
  const reviewPackage = createAutonomousReviewPackage({
    package_id: "unity-review-preview",
    work_item_id: "unity-validation-demo-preview",
    chain_id: "unity-chain-preview",
    status: "approved",
    summary: "Demo preview: Unity validation preview was not executed. Adapter remains non-mutating and review-gated.",
    files_changed: [],
    tests_run: ["unity read-only validation probe"],
    proof_results: [
      "Execution kind: adapter_preview",
      "Scene validation status: not_checked",
      "Checked scene name: CastleHub",
      "Missing script count: unknown",
      "Console error count: unknown",
      "Object count: unknown",
      "Evidence timestamp: 2026-05-01T13:00:00.000Z",
      "Recommended next operator action: request operator approval before live Unity endpoint verification",
    ],
    risks: ["Demo preview only. No mutation path enabled."],
    recommended_decision: "approve",
    rollback_notes: "Demo preview evidence only; no rollback required.",
    operator_actions: ["approve", "archive"],
  });

  const evidence = extractUnityValidationEvidenceFromReviewPackage(reviewPackage);
  assert.ok(evidence);
  assert.equal(evidence.kind, "adapter_preview");
  assert.equal(evidence.demoPreview, true);

  const markup = renderToStaticMarkup(createElement(UnityValidationEvidencePanel, { evidence }));
  assert.match(markup, /Adapter Preview/);
  assert.match(markup, /Demo preview/);

  const state = createOperatorDashboardDemoState();
  assert.ok(state.review_packages.some((item) => extractUnityValidationEvidenceFromReviewPackage(item) !== null));
  assert.ok(state.delivery_packages.some((item) => extractUnityValidationEvidenceFromDeliveryPackage(item) !== null));
});

test("mutation preview evidence renders dry-run-only operator details without execution controls", () => {
  const reviewPackage = createAutonomousReviewPackage({
    package_id: "unity-mutation-review-1",
    work_item_id: "unity-mutation-preview-1",
    chain_id: "unity-mutation-preview-chain-1",
    status: "approved",
    summary: "DRY RUN ONLY: Unity scene object creation preview for CheckpointAnchor in EnemyAIDemo. NOT EXECUTED.",
    files_changed: [],
    tests_run: ["unity scene object creation dry-run preview"],
    proof_results: [
      "Execution kind: dry_run_preview",
      "Requested object name: CheckpointAnchor",
      "Target scene: EnemyAIDemo",
      "Intended components: Transform, BoxCollider",
      "Intended transform position: 4, 1, 0",
      "Intended transform rotation: 0, 0, 0",
      "Intended transform scale: 1, 1, 1",
      "Risk level: medium",
      "Dry run: true",
      "Executed: false",
      "Final execution required: true",
      "Final execution authorized: false",
      "Final execution authorization status: FINAL EXECUTION NOT AUTHORIZED",
      "Required approval gate: operator planning approval",
      "Required approval gate: review package approval",
      "Required approval gate: operator approval",
      "Required approval gate: dry-run preview approval",
      "Required approval gate: explicit final execute gate",
      "Recommended next operator action: Keep the final execute gate disabled until a future reviewed mutation path exists.",
    ],
    risks: ["DRY RUN ONLY", "NOT EXECUTED", "No Unity scene mutation path enabled."],
    recommended_decision: "approve",
    rollback_notes: "Dry-run mutation preview only; no rollback required.",
    operator_actions: ["approve", "archive"],
  });

  const evidence = extractUnityValidationEvidenceFromReviewPackage(reviewPackage);

  assert.ok(evidence);
  assert.equal(evidence.kind, "scene_object_creation_preview");
  assert.equal(evidence.requestedObjectName, "CheckpointAnchor");
  assert.equal(evidence.targetScene, "EnemyAIDemo");
  assert.deepEqual(evidence.intendedComponents, ["Transform", "BoxCollider"]);
  assert.equal(evidence.riskLevel, "medium");
  assert.equal(evidence.dryRun, true);
  assert.equal(evidence.executed, false);
  assert.equal(evidence.finalExecutionRequired, true);
  assert.equal(evidence.finalExecutionAuthorized, false);
  assert.equal(evidence.finalExecutionAuthorizationStatus, "FINAL EXECUTION NOT AUTHORIZED");
  assert.ok(evidence.requiredApprovalGates.includes("explicit final execute gate"));

  const markup = renderToStaticMarkup(createElement(UnityValidationEvidencePanel, { evidence }));
  assert.match(markup, /Scene Object Creation Preview/);
  assert.match(markup, /DRY RUN ONLY/);
  assert.match(markup, /NOT EXECUTED/);
  assert.match(markup, /FINAL EXECUTION NOT AUTHORIZED/);
  assert.match(markup, /Requested object name: CheckpointAnchor/);
  assert.match(markup, /Target scene: EnemyAIDemo/);
  assert.match(markup, /Intended components: Transform, BoxCollider/);
  assert.match(markup, /Dry run: true/);
  assert.match(markup, /Executed: false/);
  assert.match(markup, /Final execution required: true/);
  assert.match(markup, /Final execution authorized: false/);
  assert.doesNotMatch(markup, /<button/i);
  assert.doesNotMatch(markup, /disabled=/i);
});

test("chain plan evidence renders read-only multi-action ordering and rollback preview", () => {
  const reviewPackage = createAutonomousReviewPackage({
    package_id: "unity-chain-review-1",
    work_item_id: "unity-chain-plan-unity-controlled-chain-1",
    chain_id: "unity-chain-preview-1",
    status: "approved",
    summary: "CHAIN PLAN ONLY: Controlled Unity execution chain unity-controlled-chain-1 with 2 actions. NOT EXECUTED.",
    files_changed: [],
    tests_run: ["unity mutation execution chain plan"],
    proof_results: [
      "Execution kind: chain_plan_only",
      "Chain id: unity-controlled-chain-1",
      "Chain status: chain_planned",
      "Execution mode: multi_action_chain_plan_only",
      "Total actions: 2",
      "Executable actions: create-probe, rollback-probe",
      "Blocked actions: none",
      "Chain ready: false",
      "Dry run: true",
      "Executed: false",
      "Required approval gate: review package approval",
      "Required approval gate: explicit final execute gate",
      "Required approval gate: explicit final rollback authorization",
      "Dependency graph: create-probe <- none",
      "Dependency graph: rollback-probe <- create-probe",
      "Rollback graph: 1. rollback-probe => unity_scene_object_creation",
      "Rollback graph: 2. create-probe => unity_scene_object_rollback",
      "Recommended next operator action: Review the chain ordering, approvals, and rollback order. Chain execution remains refused in Layer 16 Step 1.",
    ],
    risks: ["CHAIN PLAN ONLY", "NOT EXECUTED", "ROLLBACK ORDER PREVIEW"],
    recommended_decision: "approve",
    rollback_notes: "ROLLBACK ORDER PREVIEW: 1. rollback-probe => unity_scene_object_creation | 2. create-probe => unity_scene_object_rollback",
    operator_actions: ["approve", "archive"],
  });

  const evidence = extractUnityValidationEvidenceFromReviewPackage(reviewPackage);

  assert.ok(evidence);
  assert.equal(evidence.kind, "mutation_execution_chain_plan");
  assert.equal(evidence.chainId, "unity-controlled-chain-1");
  assert.equal(evidence.chainStatus, "chain_planned");
  assert.equal(evidence.totalActions, 2);
  assert.equal(evidence.chainReady, false);
  assert.deepEqual(evidence.executableActions, ["create-probe", "rollback-probe"]);
  assert.deepEqual(evidence.blockedActions, []);
  assert.deepEqual(evidence.dependencyGraph, [
    "create-probe <- none",
    "rollback-probe <- create-probe",
  ]);
  assert.deepEqual(evidence.rollbackGraph, [
    "1. rollback-probe => unity_scene_object_creation",
    "2. create-probe => unity_scene_object_rollback",
  ]);

  const markup = renderToStaticMarkup(createElement(UnityValidationEvidencePanel, { evidence }));
  assert.match(markup, /Mutation Execution Chain Plan/);
  assert.match(markup, /CHAIN PLAN ONLY/);
  assert.match(markup, /ROLLBACK ORDER PREVIEW/);
  assert.match(markup, /Chain id: unity-controlled-chain-1/);
  assert.match(markup, /Chain status: chain_planned/);
  assert.match(markup, /Total actions: 2/);
  assert.match(markup, /Chain ready: false/);
  assert.match(markup, /Executable actions/);
  assert.match(markup, /Rollback graph/);
});

test("chain readiness evidence renders gate-scored non-executing readiness details", () => {
  const reviewPackage = createAutonomousReviewPackage({
    package_id: "unity-chain-readiness-review-1",
    work_item_id: "unity-chain-readiness-unity-controlled-chain-1",
    chain_id: "unity-chain-readiness-1",
    status: "approved",
    summary: "CHAIN READINESS ONLY: Controlled Unity execution chain unity-controlled-chain-1 evaluated as partially_ready. NO ACTIONS EXECUTED.",
    files_changed: [],
    tests_run: ["unity mutation execution chain readiness"],
    proof_results: [
      "Execution kind: chain_readiness_only",
      "Chain id: unity-controlled-chain-1",
      "Chain status: chain_planned",
      "Chain readiness: partially_ready",
      "Execution mode: multi_action_chain_readiness_only",
      "Total actions: 2",
      "Ready actions: create-probe",
      "Blocked actions: rollback-probe",
      "Dependency blocked actions: rollback-probe",
      "Executable actions: create-probe",
      "Missing gates: rollback-probe:execution_plan, rollback-probe:final_mutation_switch",
      "Chain ready: false",
      "Dry run: true",
      "Executed: false",
      "Required approval gate: review package approval",
      "Required approval gate: explicit final execute gate",
      "Dependency graph: create-probe <- none",
      "Dependency graph: rollback-probe <- create-probe",
      "Rollback graph: 1. rollback-probe => unity_scene_object_creation",
      "Rollback graph: 2. create-probe => unity_scene_object_rollback",
      "Gate status: create-probe => review_approval=approved, operator_approval=approved, dry_run_preview=approved",
      "Gate status: rollback-probe => execution_plan=dependency_blocked, final_mutation_switch=missing",
      "Recommended next operator action: Resolve the remaining blocked gates before any future explicit operator execution step is considered.",
    ],
    risks: ["CHAIN READINESS ONLY", "NO ACTIONS EXECUTED"],
    recommended_decision: "approve",
    rollback_notes: "ROLLBACK ORDER PREVIEW: 1. rollback-probe => unity_scene_object_creation | 2. create-probe => unity_scene_object_rollback",
    operator_actions: ["approve", "archive"],
  });

  const evidence = extractUnityValidationEvidenceFromReviewPackage(reviewPackage);

  assert.ok(evidence);
  assert.equal(evidence.kind, "mutation_execution_chain_readiness");
  assert.equal(evidence.chainId, "unity-controlled-chain-1");
  assert.equal(evidence.chainStatus, "chain_planned");
  assert.equal(evidence.chainReadinessStatus, "partially_ready");
  assert.equal(evidence.chainReady, false);
  assert.deepEqual(evidence.executableActions, ["create-probe"]);
  assert.deepEqual(evidence.blockedActions, ["rollback-probe"]);
  assert.deepEqual(evidence.dependencyBlockedActions, ["rollback-probe"]);
  assert.deepEqual(evidence.missingGates, ["rollback-probe:execution_plan", "rollback-probe:final_mutation_switch"]);
  assert.ok(evidence.gateStatuses.some((entry) => /dependency_blocked/i.test(entry)));

  const markup = renderToStaticMarkup(createElement(UnityValidationEvidencePanel, { evidence }));
  assert.match(markup, /Mutation Execution Chain Readiness/);
  assert.match(markup, /CHAIN READINESS ONLY/);
  assert.match(markup, /NO ACTIONS EXECUTED/);
  assert.match(markup, /Chain readiness: partially_ready/);
  assert.match(markup, /Dependency blocked actions/);
  assert.match(markup, /Missing gates/);
  assert.match(markup, /Gate statuses/);
});

test("chain execution evidence renders bounded controlled execution details", () => {
  const reviewPackage = createAutonomousReviewPackage({
    package_id: "unity-chain-execution-review-1",
    work_item_id: "unity-chain-execution-unity-controlled-chain-1",
    chain_id: "unity-chain-execution-chain-1",
    status: "approved",
    summary: "CONTROLLED UNITY CHAIN EXECUTION: unity-controlled-chain-1 completed with status success.",
    files_changed: [],
    tests_run: ["unity mutation execution chain controlled execution"],
    proof_results: [
      "Execution kind: chain_execution_executed",
      "Chain id: unity-controlled-chain-1",
      "Execution status: success",
      "Chain status: chain_planned",
      "Chain readiness: ready_for_operator_execution",
      "Execution mode: controlled_multi_action_chain_runtime_bridge",
      "Total actions: 2",
      "Actions executed count: 2",
      "Actions failed count: 0",
      "Chain ready: true",
      "Executed: true",
      "Final scene state: Scene EnemyAIDemo object count moved from 13 to 13.",
      "Dependency graph: create-probe <= none",
      "Dependency graph: rollback-probe <= create-probe",
      "Rollback graph: rollback-probe => unity_scene_object_creation AIE_ControlledMutationProbe",
      "Rollback graph: create-probe => unity_scene_object_rollback AIE_ControlledMutationProbe",
      "Action result: create-probe => executed",
      "Action result: rollback-probe => executed",
      "Recommended next operator action: Review the bounded chain execution evidence and rerun read-only validation before any follow-up mutation work.",
    ],
    risks: ["CONTROLLED UNITY CHAIN EXECUTION"],
    recommended_decision: "approve",
    rollback_notes: "ROLLBACK ORDER PREVIEW: rollback-probe -> create-probe",
    operator_actions: ["approve", "archive"],
  });

  const evidence = extractUnityValidationEvidenceFromReviewPackage(reviewPackage);

  assert.ok(evidence);
  assert.equal(evidence.kind, "mutation_execution_chain_result");
  assert.equal(evidence.chainId, "unity-controlled-chain-1");
  assert.equal(evidence.chainStatus, "chain_planned");
  assert.equal(evidence.chainReadinessStatus, "ready_for_operator_execution");
  assert.equal(evidence.totalActions, 2);
  assert.equal(evidence.chainReady, true);
  assert.equal(evidence.executed, true);
  assert.equal(evidence.executionMode, "controlled_multi_action_chain_runtime_bridge");

  const markup = renderToStaticMarkup(createElement(UnityValidationEvidencePanel, { evidence }));
  assert.match(markup, /Controlled Unity Chain Execution/);
  assert.match(markup, /Chain id: unity-controlled-chain-1/);
  assert.match(markup, /Executed: true/);
  assert.match(markup, /Execution mode: controlled_multi_action_chain_runtime_bridge/);
  assert.match(markup, /Dependency graph/);
});

test("chain execution evidence renders partial failure rollback planning details", () => {
  const reviewPackage = createAutonomousReviewPackage({
    package_id: "unity-chain-execution-review-2",
    work_item_id: "unity-chain-execution-unity-controlled-chain-2",
    chain_id: "unity-chain-execution-chain-2",
    status: "pending",
    summary: "CONTROLLED UNITY CHAIN EXECUTION: unity-controlled-chain-2 completed with status partial_failure.",
    files_changed: [],
    tests_run: ["unity mutation execution chain controlled execution"],
    proof_results: [
      "Execution kind: chain_execution_partial_failure",
      "Chain id: unity-controlled-chain-2",
      "Execution status: partial_failure",
      "Failure handling status: rollback_recommended",
      "Failure classification: runtime_unavailable",
      "Failed action id: rollback-probe",
      "Successful action ids: create-probe",
      "Rollback plan required: true",
      "Manual review required: true",
      "Chain status: chain_planned",
      "Chain readiness: ready_for_operator_execution",
      "Execution mode: controlled_multi_action_chain_runtime_bridge",
      "Total actions: 2",
      "Actions executed count: 1",
      "Actions failed count: 1",
      "Executed: true",
      "Final scene state: Scene EnemyAIDemo object count moved from 13 to 14.",
      "Rollback plan id: unity-chain-rollback-plan-unity-controlled-chain-2",
      "Rollback actions: create-probe",
      "Rollback order: create-probe",
      "Rollback auto execute: false",
      "Rollback executed: false",
      "Dependency graph: create-probe <= none",
      "Dependency graph: rollback-probe <= create-probe",
      "Rollback graph: rollback-probe => unity_scene_object_creation AIE_ControlledMutationProbe",
      "Action result: create-probe => executed",
      "Action result: rollback-probe => failed (Unity rollback bridge is unavailable.)",
      "Recommended next operator action: Review the failed chain action evidence, approve the rollback plan separately if appropriate, and do not auto-execute rollback.",
    ],
    risks: ["CHAIN EXECUTION STOPPED", "ROLLBACK PLAN REQUIRED", "ROLLBACK NOT AUTO-EXECUTED"],
    recommended_decision: "review_required",
    rollback_notes: "ROLLBACK ORDER PREVIEW: create-probe",
    operator_actions: ["approve", "archive"],
  });

  const evidence = extractUnityValidationEvidenceFromReviewPackage(reviewPackage);

  assert.ok(evidence);
  assert.equal(evidence.kind, "mutation_execution_chain_result");
  assert.equal(evidence.executionStatus, "partial_failure");
  assert.equal(evidence.failureHandlingStatus, "rollback_recommended");
  assert.equal(evidence.failureClassification, "runtime_unavailable");
  assert.equal(evidence.failedActionId, "rollback-probe");
  assert.deepEqual(evidence.successfulActionIds, ["create-probe"]);
  assert.equal(evidence.rollbackPlanRequired, true);
  assert.deepEqual(evidence.rollbackActions, ["create-probe"]);
  assert.equal(evidence.rollbackAutoExecute, false);

  const markup = renderToStaticMarkup(createElement(UnityValidationEvidencePanel, { evidence }));
  assert.match(markup, /PARTIAL FAILURE/);
  assert.match(markup, /ROLLBACK PLAN REQUIRED/);
  assert.match(markup, /ROLLBACK NOT AUTO-EXECUTED/);
  assert.match(markup, /failed_action=rollback-probe/);
  assert.match(markup, /actions=create-probe/);
  assert.match(markup, /auto_execute=false/);
});

test("rollback execution evidence renders manual trigger and remaining actions details", () => {
  const reviewPackage = createAutonomousReviewPackage({
    package_id: "unity-chain-rollback-review-1",
    work_item_id: "unity-chain-rollback-unity-chain-rollback-plan-1",
    chain_id: "unity-chain-rollback-chain-1",
    status: "pending",
    summary: "ROLLBACK EXECUTION: Controlled Unity chain rollback plan unity-chain-rollback-plan-1 completed with status partial_failure.",
    files_changed: [],
    tests_run: ["unity mutation execution chain manual rollback execution"],
    proof_results: [
      "Execution kind: planned_chain_rollback_partial_failure",
      "Chain id: unity-controlled-chain-1",
      "Rollback plan id: unity-chain-rollback-plan-1",
      "Execution status: partial_failure",
      "Manual trigger: true",
      "Executed: true",
      "Actions executed count: 1",
      "Actions failed count: 1",
      "Remaining actions not executed: create-probe-3",
      "Final scene state: Scene EnemyAIDemo object count moved from 14 to 13 during manual rollback execution.",
      "Evidence timestamp: 2026-05-03T12:27:00.000Z",
      "Action result: create-probe => executed",
      "Action result: create-probe-2 => failed (Unity rollback bridge reported a controlled failure.)",
      "Recommended next operator action: Review the failed rollback evidence and decide whether the remaining rollback actions need a separate follow-up execution step.",
    ],
    risks: ["ROLLBACK EXECUTION STOPPED", "MANUAL TRIGGER", "ROLLBACK NOT AUTO-EXECUTED"],
    recommended_decision: "review_required",
    rollback_notes: "ROLLBACK PLAN unity-chain-rollback-plan-1: create-probe-3",
    operator_actions: ["approve", "archive"],
  });

  const evidence = extractUnityValidationEvidenceFromReviewPackage(reviewPackage);

  assert.ok(evidence);
  assert.equal(evidence.kind, "planned_chain_rollback_result");
  assert.equal(evidence.rollbackPlanId, "unity-chain-rollback-plan-1");
  assert.equal(evidence.executionStatus, "partial_failure");
  assert.equal(evidence.manualTrigger, true);
  assert.equal(evidence.actionsExecutedCount, 1);
  assert.equal(evidence.actionsFailedCount, 1);
  assert.deepEqual(evidence.perActionResults, [
    "create-probe => executed",
    "create-probe-2 => failed (Unity rollback bridge reported a controlled failure.)",
  ]);
  assert.deepEqual(evidence.remainingActionsNotExecuted, ["create-probe-3"]);

  const markup = renderToStaticMarkup(createElement(UnityValidationEvidencePanel, { evidence }));
  assert.match(markup, /Rollback Execution/);
  assert.match(markup, /ROLLBACK EXECUTION/);
  assert.match(markup, /EXECUTED/);
  assert.match(markup, /MANUAL TRIGGER/);
  assert.match(markup, /PARTIAL FAILURE/);
  assert.match(markup, /REMAINING ACTIONS NOT EXECUTED/);
  assert.match(markup, /Per-action result/);
  assert.match(markup, /create-probe-3/);
});

test("mutation preflight evidence renders simulation-only operator details", () => {
  const reviewPackage = createAutonomousReviewPackage({
    package_id: "unity-mutation-preflight-review-1",
    work_item_id: "unity-mutation-preflight-1",
    chain_id: "unity-mutation-preflight-chain-1",
    status: "approved",
    summary: "PREFLIGHT SIMULATION: Unity scene object creation request for CheckpointAnchor in EnemyAIDemo. NO UNITY MUTATION PERFORMED.",
    files_changed: [],
    tests_run: ["unity mutation execution preflight simulation"],
    proof_results: [
      "Execution kind: preflight_simulation",
      "Preflight state: simulation",
      "Requested object name: CheckpointAnchor",
      "Target scene: EnemyAIDemo",
      "Intended components: Transform, BoxCollider",
      "Intended transform position: 4, 1, 0",
      "Intended transform rotation: 0, 0, 0",
      "Intended transform scale: 1, 1, 1",
      "Authorization evaluation status: FINAL EXECUTION AUTHORIZATION VALID",
      "Predicted affected object: Scene:EnemyAIDemo",
      "Predicted affected object: Component:Transform",
      "Predicted created object: CheckpointAnchor",
      "Detected risk: Duplicate object name risk: CheckpointAnchor already exists in the reviewed scene inventory.",
      "Recommended next operator action: PREFLIGHT SIMULATION completed. Resolve the detected conflicts, keep the request dry-run only, and do not authorize live mutation execution.",
      "Dry run: true",
      "Executed: false",
    ],
    risks: ["PREFLIGHT SIMULATION", "NO UNITY MUTATION PERFORMED"],
    recommended_decision: "approve",
    rollback_notes: "Simulation only; no Unity mutation occurred and no rollback is required.",
    operator_actions: ["approve", "archive"],
  });

  const evidence = extractUnityValidationEvidenceFromReviewPackage(reviewPackage);

  assert.ok(evidence);
  assert.equal(evidence.kind, "mutation_execution_preflight");
  assert.equal(evidence.preflightState, "simulation");
  assert.equal(evidence.authorizationEvaluationStatus, "FINAL EXECUTION AUTHORIZATION VALID");
  assert.deepEqual(evidence.predictedCreatedObjects, ["CheckpointAnchor"]);
  assert.ok(evidence.predictedAffectedObjects.includes("Scene:EnemyAIDemo"));
  assert.ok(evidence.detectedRisks.some((entry) => /Duplicate object name risk/i.test(entry)));

  const markup = renderToStaticMarkup(createElement(UnityValidationEvidencePanel, { evidence }));
  assert.match(markup, /Mutation Execution Preflight/);
  assert.match(markup, /PREFLIGHT SIMULATION/);
  assert.match(markup, /NO UNITY MUTATION PERFORMED/);
  assert.match(markup, /FINAL EXECUTION AUTHORIZATION VALID/);
  assert.match(markup, /Predicted affected objects/);
  assert.match(markup, /Predicted created objects/);
  assert.match(markup, /Detected risks/);
  assert.doesNotMatch(markup, /<button/i);
});

test("mutation execution plan evidence renders plan-only operator details", () => {
  const reviewPackage = createAutonomousReviewPackage({
    package_id: "unity-mutation-execution-plan-review-1",
    work_item_id: "unity-mutation-execution-plan-1",
    chain_id: "unity-mutation-execution-plan-chain-1",
    status: "approved",
    summary: "EXECUTION PLAN ONLY: Controlled Unity scene object creation plan for CheckpointAnchor in EnemyAIDemo. MUTATION DISABLED. NOT EXECUTED.",
    files_changed: [],
    tests_run: ["unity mutation execution plan gate stack"],
    proof_results: [
      "Execution kind: execution_plan_only",
      "Execution mode: disabled_plan_only",
      "Requested object name: CheckpointAnchor",
      "Target scene: EnemyAIDemo",
      "Intended components: Transform, BoxCollider",
      "Intended transform position: 4, 1, 0",
      "Intended transform rotation: 0, 0, 0",
      "Intended transform scale: 1, 1, 1",
      "Dry-run preview status: valid",
      "Preflight status: valid",
      "Authorization evaluation status: FINAL EXECUTION AUTHORIZATION VALID",
      "Final mutation switch required: true",
      "Final mutation switch enabled: false",
      "Final mutation switch evaluation status: FINAL MUTATION SWITCH ENABLED",
      "Final mutation switch id: mutation-switch-1",
      "Final mutation switch target request match: true",
      "Final mutation switch mutation type match: true",
      "Final mutation switch expiration status: valid",
      "Live validation status: valid",
      "Live validation summary: Scene EnemyAIDemo reported checked_clean with missing scripts 0, console errors 0, and object count 13.",
      "Explicit mutation execution mode status: enabled",
      "Mutation enabled: false",
      "Executed: false",
      "Required gate: review_approval",
      "Required gate: operator_approval",
      "Required gate: dry_run_preview",
      "Required gate: preflight_simulation",
      "Required gate: final_execution_authorization",
      "Required gate: live_read_only_validation",
      "Required gate: explicit_mutation_execution_mode",
      "Required gate: final_mutation_switch",
      "Gate status: review_approval=approved (Review approval gate is recorded for this Unity mutation request.)",
      "Gate status: operator_approval=approved (Operator approval gate is recorded for this Unity mutation request.)",
      "Gate status: dry_run_preview=approved (Dry-run preview gate is present and matches the reviewed Unity mutation request.)",
      "Gate status: preflight_simulation=approved (Preflight simulation gate is present and matches the reviewed Unity mutation request.)",
      "Gate status: final_execution_authorization=approved (Final execution authorization gate is present and valid for this Unity mutation request.)",
      "Gate status: live_read_only_validation=approved (Live read-only Unity validation gate is present for EnemyAIDemo.)",
      "Gate status: explicit_mutation_execution_mode=approved (Explicit mutation execution mode gate is marked enabled, but this layer still returns plan-only output.)",
      "Gate status: final_mutation_switch=approved (Final mutation switch gate is present and enabled for this Unity mutation request.)",
      "Recommended next operator action: EXECUTION PLAN ONLY. Keep mutation disabled and do not execute this plan until a later reviewed Unity mutation step explicitly enables execution.",
    ],
    risks: ["EXECUTION PLAN ONLY", "FINAL MUTATION SWITCH REQUIRED", "MUTATION DISABLED", "NOT EXECUTED"],
    recommended_decision: "approve",
    rollback_notes: "Plan only; no Unity mutation occurred and no rollback is required.",
    operator_actions: ["approve", "archive"],
  });

  const evidence = extractUnityValidationEvidenceFromReviewPackage(reviewPackage);

  assert.ok(evidence);
  assert.equal(evidence.kind, "mutation_execution_plan");
  assert.equal(evidence.executionMode, "disabled_plan_only");
  assert.equal(evidence.mutationEnabled, false);
  assert.equal(evidence.executed, false);
  assert.equal(evidence.finalMutationSwitchRequired, true);
  assert.equal(evidence.finalMutationSwitchEnabled, false);
  assert.equal(evidence.finalMutationSwitchEvaluationStatus, "FINAL MUTATION SWITCH ENABLED");
  assert.equal(evidence.finalMutationSwitchId, "mutation-switch-1");
  assert.equal(evidence.liveValidationStatus, "valid");
  assert.equal(evidence.dryRunPreviewStatus, "valid");
  assert.equal(evidence.preflightStatus, "valid");
  assert.equal(evidence.explicitMutationExecutionModeStatus, "enabled");
  assert.ok(evidence.gateStatuses.some((entry) => /review_approval=approved/i.test(entry)));
  assert.ok(evidence.requiredApprovalGates.includes("live_read_only_validation"));

  const markup = renderToStaticMarkup(createElement(UnityValidationEvidencePanel, { evidence }));
  assert.match(markup, /Mutation Execution Plan/);
  assert.match(markup, /EXECUTION PLAN ONLY/);
  assert.match(markup, /FINAL MUTATION SWITCH REQUIRED/);
  assert.match(markup, /MUTATION DISABLED/);
  assert.match(markup, /FINAL MUTATION SWITCH ENABLED/);
  assert.match(markup, /NOT EXECUTED/);
  assert.match(markup, /Execution mode: disabled_plan_only/);
  assert.match(markup, /Mutation enabled: false/);
  assert.match(markup, /Final mutation switch required: true/);
  assert.match(markup, /Final mutation switch enabled: false/);
  assert.match(markup, /Live validation status: valid/);
  assert.match(markup, /Final mutation switch/);
  assert.match(markup, /Gate statuses/);
  assert.doesNotMatch(markup, /<button/i);
});

test("controlled mutation evidence renders executed operator details", () => {
  const deliveryPackage = createAutonomousDeliveryPackage({
    delivery_package_id: "unity-controlled-mutation-delivery-1",
    review_package_id: "unity-controlled-mutation-review-1",
    work_item_id: "unity-controlled-mutation-1",
    chain_id: "unity-controlled-mutation-chain-1",
    branch_name: "",
    commit_plan: [],
    files_changed: [],
    validation_results: [
      "Execution kind: controlled_mutation_executed",
      "Mutation type: scene_object_creation_request",
      "Target scene: EnemyAIDemo",
      "Requested object name: AIE_ControlledMutationProbe",
      "Created object name: AIE_ControlledMutationProbe",
      "Mutation enabled: true",
      "Executed: true",
      "Scene saved: true",
      "Duplicate handling: created",
      "Evidence timestamp: 2026-05-01T20:00:00.000Z",
      "Rollback hint: Rollback requires separate approval: remove AIE_ControlledMutationProbe from EnemyAIDemo.",
      "Delivery summary: Controlled Unity mutation created object AIE_ControlledMutationProbe in EnemyAIDemo with scene_saved true.",
      "Recommended next operator action: Review the controlled Unity mutation evidence and keep rollback as a separately approved follow-up action.",
    ],
    proof_results: ["CONTROLLED UNITY MUTATION", "EXECUTED", "ROLLBACK AVAILABLE"],
    risk_summary: "Controlled Unity mutation executed for AIE_ControlledMutationProbe; rollback remains separately approved.",
    rollback_plan: "Rollback requires separate approval: remove AIE_ControlledMutationProbe from EnemyAIDemo.",
    release_notes: "CONTROLLED UNITY MUTATION: AIE_ControlledMutationProbe created in EnemyAIDemo. EXECUTED. ROLLBACK AVAILABLE.",
    recommended_pr_title: "",
    recommended_pr_body: "Controlled Unity mutation handoff",
    operator_decision: null,
    status: "awaiting_operator_approval",
    created_at: "2026-05-01T20:00:00.000Z",
    updated_at: "2026-05-01T20:00:00.000Z",
  });

  const evidence = extractUnityValidationEvidenceFromDeliveryPackage(deliveryPackage);

  assert.ok(evidence);
  assert.equal(evidence.kind, "controlled_mutation_result");
  assert.equal(evidence.mutationType, "scene_object_creation_request");
  assert.equal(evidence.createdObjectName, "AIE_ControlledMutationProbe");
  assert.equal(evidence.sceneSaved, true);
  assert.equal(evidence.rollbackHint, "Rollback requires separate approval: remove AIE_ControlledMutationProbe from EnemyAIDemo.");
  assert.equal(evidence.duplicateHandling, "created");

  const markup = renderToStaticMarkup(createElement(UnityValidationEvidencePanel, { evidence }));
  assert.match(markup, /Controlled Unity Mutation/);
  assert.match(markup, /CONTROLLED UNITY MUTATION/);
  assert.match(markup, /EXECUTED/);
  assert.match(markup, /ROLLBACK AVAILABLE/);
  assert.match(markup, /Created object name: AIE_ControlledMutationProbe/);
  assert.match(markup, /Scene saved: true/);
  assert.match(markup, /Rollback hint/);
  assert.doesNotMatch(markup, /<button/i);
});

test("controlled rollback evidence renders executed operator details", () => {
  const deliveryPackage = createAutonomousDeliveryPackage({
    delivery_package_id: "unity-controlled-rollback-delivery-1",
    review_package_id: "unity-controlled-rollback-review-1",
    work_item_id: "unity-controlled-rollback-1",
    chain_id: "unity-controlled-rollback-chain-1",
    branch_name: "",
    commit_plan: [],
    files_changed: [],
    validation_results: [
      "Execution kind: controlled_rollback_executed",
      "Rollback request id: unity-rollback-1",
      "Rollback type: scene_object_removal",
      "Target scene: EnemyAIDemo",
      "Target object name: AIE_ControlledMutationProbe",
      "Removed object name: AIE_ControlledMutationProbe",
      "Rollback enabled: true",
      "Executed: true",
      "Scene saved: true",
      "Target missing handling: removed",
      "Evidence timestamp: 2026-05-01T21:10:00.000Z",
      "Delivery summary: Controlled Unity rollback removed target AIE_ControlledMutationProbe in EnemyAIDemo with scene_saved true.",
      "Recommended next operator action: Review the controlled Unity rollback evidence and rerun read-only validation before proceeding.",
    ],
    proof_results: ["CONTROLLED UNITY ROLLBACK", "EXECUTED", "TARGET REMOVED"],
    risk_summary: "Controlled Unity rollback removed the target cleanly for AIE_ControlledMutationProbe.",
    rollback_plan: "Rollback completed by removing AIE_ControlledMutationProbe from EnemyAIDemo.",
    release_notes: "CONTROLLED UNITY ROLLBACK: AIE_ControlledMutationProbe removed from EnemyAIDemo. EXECUTED. TARGET REMOVED.",
    recommended_pr_title: "",
    recommended_pr_body: "Controlled Unity rollback handoff",
    operator_decision: null,
    status: "awaiting_operator_approval",
    created_at: "2026-05-01T21:10:00.000Z",
    updated_at: "2026-05-01T21:10:00.000Z",
  });

  const evidence = extractUnityValidationEvidenceFromDeliveryPackage(deliveryPackage);

  assert.ok(evidence);
  assert.equal(evidence.kind, "controlled_rollback_result");
  assert.equal(evidence.rollbackType, "scene_object_removal");
  assert.equal(evidence.requestedObjectName, "AIE_ControlledMutationProbe");
  assert.equal(evidence.removedObjectName, "AIE_ControlledMutationProbe");
  assert.equal(evidence.rollbackEnabled, true);
  assert.equal(evidence.targetMissingHandling, "removed");

  const markup = renderToStaticMarkup(createElement(UnityValidationEvidencePanel, { evidence }));
  assert.match(markup, /Controlled Unity Rollback/);
  assert.match(markup, /CONTROLLED UNITY ROLLBACK/);
  assert.match(markup, /EXECUTED/);
  assert.match(markup, /TARGET REMOVED/);
  assert.match(markup, /Target object name: AIE_ControlledMutationProbe/);
  assert.match(markup, /Removed object name: AIE_ControlledMutationProbe/);
  assert.match(markup, /Scene saved: true/);
  assert.doesNotMatch(markup, /<button/i);
});