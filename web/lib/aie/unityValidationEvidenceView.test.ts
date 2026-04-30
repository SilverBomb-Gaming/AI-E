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