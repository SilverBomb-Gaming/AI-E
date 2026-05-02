import React from "react";

import type { AutonomousDeliveryPackage, AutonomousReviewPackage } from "./autonomousWorkPlanning";

export type UnityValidationEvidenceKind = "adapter_preview" | "real_bridge_unavailable" | "real_bridge_read_only" | "scene_object_creation_preview" | "mutation_execution_preflight" | "mutation_execution_plan" | "mutation_execution_chain_plan" | "mutation_execution_chain_readiness" | "mutation_execution_chain_result" | "planned_chain_rollback_result" | "controlled_mutation_result" | "controlled_rollback_result";

export type UnityValidationEvidence = {
  kind: UnityValidationEvidenceKind;
  bridgeStatus: string;
  executionStatus: string | null;
  sceneValidationStatus: string;
  checkedSceneName: string | null;
  missingScriptCount: number | null;
  consoleErrorCount: number | null;
  objectCount: number | null;
  evidenceTimestamp: string | null;
  recommendedNextOperatorAction: string | null;
  chainId: string | null;
  chainStatus: string | null;
  chainReadinessStatus: string | null;
  totalActions: number | null;
  chainReady: boolean | null;
  demoPreview: boolean;
  requestedObjectName: string | null;
  targetScene: string | null;
  createdObjectName: string | null;
  removedObjectName: string | null;
  mutationType: string | null;
  rollbackType: string | null;
  sceneSaved: boolean | null;
  rollbackHint: string | null;
  duplicateHandling: string | null;
  targetMissingHandling: string | null;
  intendedComponents: string[];
  intendedTransformPosition: string | null;
  intendedTransformRotation: string | null;
  intendedTransformScale: string | null;
  riskLevel: string | null;
  requiredApprovalGates: string[];
  dryRun: boolean | null;
  executed: boolean | null;
  finalExecutionRequired: boolean | null;
  finalExecutionAuthorized: boolean | null;
  finalExecutionAuthorizationStatus: string | null;
  executionMode: string | null;
  mutationEnabled: boolean | null;
  rollbackEnabled: boolean | null;
  finalMutationSwitchRequired: boolean | null;
  finalMutationSwitchEnabled: boolean | null;
  finalMutationSwitchEvaluationStatus: string | null;
  finalMutationSwitchId: string | null;
  finalMutationSwitchTargetRequestMatch: boolean | null;
  finalMutationSwitchMutationTypeMatch: boolean | null;
  finalMutationSwitchExpirationStatus: string | null;
  preflightState: string | null;
  dryRunPreviewStatus: string | null;
  preflightStatus: string | null;
  authorizationEvaluationStatus: string | null;
  liveValidationStatus: string | null;
  liveValidationSummary: string | null;
  explicitMutationExecutionModeStatus: string | null;
  predictedAffectedObjects: string[];
  predictedCreatedObjects: string[];
  detectedConflicts: string[];
  detectedRisks: string[];
  executableActions: string[];
  blockedActions: string[];
  dependencyBlockedActions: string[];
  missingGates: string[];
  dependencyGraph: string[];
  rollbackGraph: string[];
  gateStatuses: string[];
  failureHandlingStatus: string | null;
  failureClassification: string | null;
  failureSource: string | null;
  failureIsSimulated: boolean | null;
  failureIsRecoverable: boolean | null;
  failureRequiresManualReview: boolean | null;
  failureEvidenceSummary: string | null;
  failedActionId: string | null;
  successfulActionIds: string[];
  rollbackPlanRequired: boolean | null;
  rollbackActions: string[];
  rollbackAutoExecute: boolean | null;
  manualReviewRequired: boolean | null;
  failureSimulated: boolean | null;
  failureSimulationId: string | null;
  simulatedFailureKind: string | null;
  simulationTargetActionId: string | null;
  rollbackPlanId: string | null;
  actionsExecutedCount: number | null;
  actionsFailedCount: number | null;
  perActionResults: string[];
  remainingActionsNotExecuted: string[];
  finalSceneSummary: string | null;
  manualTrigger: boolean | null;
};

function parseLabeledValue(lines: string[], label: string): string | null {
  const prefix = `${label}:`;
  for (const line of lines) {
    if (line.startsWith(prefix)) {
      return line.slice(prefix.length).trim() || null;
    }
  }
  return null;
}

function parseCount(value: string | null): number | null {
  if (!value || /unknown|none/i.test(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value: string | null): boolean | null {
  if (!value) {
    return null;
  }

  if (/^true$/i.test(value)) {
    return true;
  }

  if (/^false$/i.test(value)) {
    return false;
  }

  return null;
}

function parseList(value: string | null): string[] {
  if (!value || /^(none|unknown)$/i.test(value.trim())) {
    return [];
  }

  return value.split(/,\s*/).map((item) => item.trim()).filter(Boolean);
}

function parseRepeatedLabeledValues(lines: string[], label: string): string[] {
  const prefix = `${label}:`;
  return lines
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim())
    .filter(Boolean);
}

function parseSummary(summary: string): Partial<UnityValidationEvidence> {
  const completedMatch = summary.match(
    /Unity read-only validation probe completed for (.+?) with status ([a-z_]+), missing scripts ([a-z0-9_-]+), console errors ([a-z0-9_-]+), and object count ([a-z0-9_-]+)/i,
  );
  if (completedMatch) {
    return {
      kind: "real_bridge_read_only",
      checkedSceneName: completedMatch[1]?.trim() ?? null,
      sceneValidationStatus: completedMatch[2]?.trim() ?? "unknown",
      missingScriptCount: parseCount(completedMatch[3] ?? null),
      consoleErrorCount: parseCount(completedMatch[4] ?? null),
      objectCount: parseCount(completedMatch[5] ?? null),
    };
  }

  if (/bridge was requested but is currently unavailable/i.test(summary)) {
    return {
      kind: "real_bridge_unavailable",
      bridgeStatus: "bridge_unavailable",
      sceneValidationStatus: "not_checked",
    };
  }

  if (/validation preview was not executed/i.test(summary)) {
    return {
      kind: "adapter_preview",
      bridgeStatus: "adapter_preview",
      sceneValidationStatus: "not_checked",
    };
  }

  const mutationPreviewMatch = summary.match(/DRY RUN ONLY: Unity scene object creation preview for (.+?) in (.+?)\. NOT EXECUTED\./i);
  if (mutationPreviewMatch) {
    return {
      kind: "scene_object_creation_preview",
      bridgeStatus: "dry_run_only",
      sceneValidationStatus: "not_checked",
      requestedObjectName: mutationPreviewMatch[1]?.trim() ?? null,
      targetScene: mutationPreviewMatch[2]?.trim() ?? null,
      dryRun: true,
      executed: false,
      finalExecutionRequired: true,
      finalExecutionAuthorized: false,
      finalExecutionAuthorizationStatus: "FINAL EXECUTION NOT AUTHORIZED",
    };
  }

  const preflightMatch = summary.match(/PREFLIGHT SIMULATION: Unity scene object creation request for (.+?) in (.+?)\. NO UNITY MUTATION PERFORMED\./i);
  if (preflightMatch) {
    return {
      kind: "mutation_execution_preflight",
      bridgeStatus: "preflight_simulation_only",
      sceneValidationStatus: "not_checked",
      requestedObjectName: preflightMatch[1]?.trim() ?? null,
      targetScene: preflightMatch[2]?.trim() ?? null,
      dryRun: true,
      executed: false,
    };
  }

  const executionPlanMatch = summary.match(/EXECUTION PLAN ONLY: Controlled Unity scene object creation plan for (.+?) in (.+?)\. MUTATION DISABLED\. NOT EXECUTED\./i);
  if (executionPlanMatch) {
    return {
      kind: "mutation_execution_plan",
      bridgeStatus: "execution_plan_only",
      sceneValidationStatus: "not_checked",
      requestedObjectName: executionPlanMatch[1]?.trim() ?? null,
      targetScene: executionPlanMatch[2]?.trim() ?? null,
      executionMode: "disabled_plan_only",
      mutationEnabled: false,
      finalMutationSwitchRequired: true,
      finalMutationSwitchEnabled: false,
      finalMutationSwitchEvaluationStatus: "FINAL MUTATION SWITCH DISABLED",
      executed: false,
    };
  }

  const chainPlanMatch = summary.match(/CHAIN PLAN ONLY: Controlled Unity execution chain (.+?) with ([0-9]+) actions\. NOT EXECUTED\./i);
  if (chainPlanMatch) {
    return {
      kind: "mutation_execution_chain_plan",
      bridgeStatus: "chain_plan_only",
      sceneValidationStatus: "not_checked",
      chainId: chainPlanMatch[1]?.trim() ?? null,
      totalActions: parseCount(chainPlanMatch[2] ?? null),
      chainReady: false,
      dryRun: true,
      executed: false,
      executionMode: "multi_action_chain_plan_only",
    };
  }

  const chainReadinessMatch = summary.match(/CHAIN READINESS ONLY: Controlled Unity execution chain (.+?) evaluated as ([a-z_]+)\. NO ACTIONS EXECUTED\./i);
  if (chainReadinessMatch) {
    return {
      kind: "mutation_execution_chain_readiness",
      bridgeStatus: "chain_readiness_only",
      sceneValidationStatus: "not_checked",
      chainId: chainReadinessMatch[1]?.trim() ?? null,
      chainReadinessStatus: chainReadinessMatch[2]?.trim() ?? null,
      chainReady: /^ready_for_operator_execution$/i.test(chainReadinessMatch[2] ?? ""),
      dryRun: true,
      executed: false,
      executionMode: "multi_action_chain_readiness_only",
    };
  }

  const chainExecutionMatch = summary.match(/CONTROLLED UNITY CHAIN EXECUTION: (.+?) completed with status ([a-z_]+)\./i);
  if (chainExecutionMatch) {
    return {
      kind: "mutation_execution_chain_result",
      bridgeStatus: "controlled_chain_execution",
      executionStatus: chainExecutionMatch[2]?.trim() ?? null,
      sceneValidationStatus: "not_checked",
      chainId: chainExecutionMatch[1]?.trim() ?? null,
      chainReadinessStatus: null,
      chainReady: true,
      dryRun: false,
      executed: true,
      executionMode: "controlled_multi_action_chain_runtime_bridge",
    };
  }

  const rollbackExecutionMatch = summary.match(/ROLLBACK EXECUTION: Controlled Unity chain rollback plan (.+?) completed with status ([a-z_]+)\./i);
  if (rollbackExecutionMatch) {
    return {
      kind: "planned_chain_rollback_result",
      bridgeStatus: "controlled_chain_rollback_execution",
      executionStatus: rollbackExecutionMatch[2]?.trim() ?? null,
      sceneValidationStatus: "not_checked",
      rollbackPlanId: rollbackExecutionMatch[1]?.trim() ?? null,
      rollbackEnabled: true,
      executed: true,
      executionMode: "controlled_planned_chain_rollback_runtime_bridge",
      manualTrigger: true,
    };
  }

  const controlledMutationMatch = summary.match(/CONTROLLED UNITY MUTATION: (.+?) (?:created|already existed) in (.+?)\. EXECUTED\. ROLLBACK AVAILABLE\./i);
  if (controlledMutationMatch) {
    return {
      kind: "controlled_mutation_result",
      bridgeStatus: "controlled_mutation",
      sceneValidationStatus: "not_checked",
      createdObjectName: controlledMutationMatch[1]?.trim() ?? null,
      targetScene: controlledMutationMatch[2]?.trim() ?? null,
      mutationType: "scene_object_creation_request",
      mutationEnabled: true,
      executed: true,
      sceneSaved: true,
    };
  }

  const controlledRollbackMatch = summary.match(/CONTROLLED UNITY ROLLBACK: (.+?) (?:removed from|already missing from) (.+?)\. EXECUTED\. (?:TARGET REMOVED|TARGET ALREADY MISSING)\./i);
  if (controlledRollbackMatch) {
    return {
      kind: "controlled_rollback_result",
      bridgeStatus: "controlled_rollback",
      sceneValidationStatus: "not_checked",
      removedObjectName: controlledRollbackMatch[1]?.trim() ?? null,
      targetScene: controlledRollbackMatch[2]?.trim() ?? null,
      rollbackType: "scene_object_removal",
      rollbackEnabled: true,
      executed: true,
      sceneSaved: true,
    };
  }

  return {};
}

function inferKind(lines: string[], summary: string): UnityValidationEvidenceKind | null {
  const executionKind = parseLabeledValue(lines, "Execution kind");
  if (executionKind === "adapter_preview" || executionKind === "real_bridge_unavailable" || executionKind === "real_bridge_read_only") {
    return executionKind;
  }

  if (executionKind === "dry_run_preview" || executionKind === "preview_blocked") {
    return "scene_object_creation_preview";
  }

  if (executionKind === "preflight_simulation" || executionKind === "preflight_blocked") {
    return "mutation_execution_preflight";
  }

  if (executionKind === "execution_plan_only" || executionKind === "execution_plan_blocked") {
    return "mutation_execution_plan";
  }

  if (executionKind === "chain_plan_only" || executionKind === "chain_plan_blocked") {
    return "mutation_execution_chain_plan";
  }

  if (executionKind === "chain_readiness_only" || executionKind === "chain_readiness_blocked") {
    return "mutation_execution_chain_readiness";
  }

  if (/chain_execution_(executed|partial_failure|failed|blocked)/i.test(executionKind ?? "")) {
    return "mutation_execution_chain_result";
  }

  if (/planned_chain_rollback_(executed|partial_failure|failed|blocked)/i.test(executionKind ?? "")) {
    return "planned_chain_rollback_result";
  }

  if (/controlled_mutation_(executed|idempotent|blocked|failed|unavailable)/i.test(executionKind ?? "")) {
    return "controlled_mutation_result";
  }

  if (/controlled_rollback_(executed|idempotent|blocked|failed|unavailable)/i.test(executionKind ?? "")) {
    return "controlled_rollback_result";
  }

  if (/unity read-only bridge -> unavailable/i.test(lines.join("\n"))) {
    return "real_bridge_unavailable";
  }

  if (/unity read-only bridge -> evidence_captured/i.test(lines.join("\n"))) {
    return "real_bridge_read_only";
  }

  return (parseSummary(summary).kind as UnityValidationEvidenceKind | undefined) ?? null;
}

function isUnityEvidencePackage(workItemId: string, lines: string[], summary: string): boolean {
  if (/unity-validation/i.test(workItemId)) {
    return true;
  }

  if (/unity-mutation-preview/i.test(workItemId)) {
    return true;
  }

  if (/unity-mutation-preflight/i.test(workItemId)) {
    return true;
  }

  const text = [summary, ...lines].join("\n");
  return /unity read-only validation probe|unity validation preview|unity scene object creation preview|preflight simulation|execution plan only|chain plan only|chain readiness only|controlled unity chain execution|rollback execution|controlled unity mutation|controlled unity rollback|mutation disabled|rollback disabled|no unity mutation performed|no actions executed|bridge status:|requested object name:|target object name:|chain id:|dry run:|rollback plan id:|manual trigger:/i.test(text);
}

function buildEvidence(workItemId: string, summary: string, lines: string[]): UnityValidationEvidence | null {
  if (!isUnityEvidencePackage(workItemId, lines, summary)) {
    return null;
  }

  const summaryValues = parseSummary(summary);
  const kind = inferKind(lines, summary);
  if (!kind) {
    return null;
  }

  const bridgeStatus = parseLabeledValue(lines, "Bridge status")
    ?? summaryValues.bridgeStatus
    ?? (kind === "real_bridge_read_only" ? "bridge_ready" : kind === "real_bridge_unavailable" ? "bridge_unavailable" : "adapter_preview");
  const sceneValidationStatus = parseLabeledValue(lines, "Scene validation status")
    ?? summaryValues.sceneValidationStatus
    ?? "not_checked";
  const executionStatus = parseLabeledValue(lines, "Execution status")
    ?? summaryValues.executionStatus
    ?? null;
  const checkedSceneName = parseLabeledValue(lines, "Checked scene name")
    ?? summaryValues.checkedSceneName
    ?? null;
  const evidenceTimestamp = parseLabeledValue(lines, "Evidence timestamp");
  const recommendedNextOperatorAction = parseLabeledValue(lines, "Recommended next operator action")
    ?? (summary.match(/Next operator action:\s*(.+)$/im)?.[1]?.trim() ?? null);
  const requestedObjectName = parseLabeledValue(lines, "Requested object name")
    ?? parseLabeledValue(lines, "Target object name")
    ?? summaryValues.requestedObjectName
    ?? null;
  const targetScene = parseLabeledValue(lines, "Target scene")
    ?? summaryValues.targetScene
    ?? null;
  const requiredApprovalGates = lines
    .filter((line) => line.startsWith("Required approval gate:") || line.startsWith("Required gate:"))
    .map((line) => line.includes("Required approval gate:")
      ? line.slice("Required approval gate:".length).trim()
      : line.slice("Required gate:".length).trim())
    .filter(Boolean);

  return {
    kind,
    bridgeStatus,
    executionStatus,
    sceneValidationStatus,
    checkedSceneName: checkedSceneName && checkedSceneName !== "none" ? checkedSceneName : null,
    missingScriptCount: parseCount(parseLabeledValue(lines, "Missing script count")) ?? summaryValues.missingScriptCount ?? null,
    consoleErrorCount: parseCount(parseLabeledValue(lines, "Console error count")) ?? summaryValues.consoleErrorCount ?? null,
    objectCount: parseCount(parseLabeledValue(lines, "Object count")) ?? summaryValues.objectCount ?? null,
    evidenceTimestamp,
    recommendedNextOperatorAction,
    chainId: parseLabeledValue(lines, "Chain id") ?? summaryValues.chainId ?? null,
    chainStatus: parseLabeledValue(lines, "Chain status") ?? summaryValues.chainStatus ?? null,
    chainReadinessStatus: parseLabeledValue(lines, "Chain readiness") ?? summaryValues.chainReadinessStatus ?? null,
    totalActions: parseCount(parseLabeledValue(lines, "Total actions")) ?? summaryValues.totalActions ?? null,
    chainReady: parseBoolean(parseLabeledValue(lines, "Chain ready")) ?? summaryValues.chainReady ?? null,
    demoPreview: /demo preview/i.test([summary, ...lines].join("\n")),
    requestedObjectName,
    targetScene,
    createdObjectName: parseLabeledValue(lines, "Created object name") ?? summaryValues.createdObjectName ?? null,
    removedObjectName: parseLabeledValue(lines, "Removed object name") ?? summaryValues.removedObjectName ?? null,
    mutationType: parseLabeledValue(lines, "Mutation type") ?? summaryValues.mutationType ?? null,
    rollbackType: parseLabeledValue(lines, "Rollback type") ?? summaryValues.rollbackType ?? null,
    sceneSaved: parseBoolean(parseLabeledValue(lines, "Scene saved")) ?? summaryValues.sceneSaved ?? null,
    rollbackHint: parseLabeledValue(lines, "Rollback hint") ?? summaryValues.rollbackHint ?? null,
    duplicateHandling: parseLabeledValue(lines, "Duplicate handling") ?? summaryValues.duplicateHandling ?? null,
    targetMissingHandling: parseLabeledValue(lines, "Target missing handling") ?? summaryValues.targetMissingHandling ?? null,
    intendedComponents: parseList(parseLabeledValue(lines, "Intended components")),
    intendedTransformPosition: parseLabeledValue(lines, "Intended transform position"),
    intendedTransformRotation: parseLabeledValue(lines, "Intended transform rotation"),
    intendedTransformScale: parseLabeledValue(lines, "Intended transform scale"),
    riskLevel: parseLabeledValue(lines, "Risk level"),
    requiredApprovalGates,
    dryRun: parseBoolean(parseLabeledValue(lines, "Dry run")) ?? summaryValues.dryRun ?? null,
    executed: parseBoolean(parseLabeledValue(lines, "Executed")) ?? summaryValues.executed ?? null,
    finalExecutionRequired: parseBoolean(parseLabeledValue(lines, "Final execution required")) ?? summaryValues.finalExecutionRequired ?? null,
    finalExecutionAuthorized: parseBoolean(parseLabeledValue(lines, "Final execution authorized")) ?? summaryValues.finalExecutionAuthorized ?? null,
    finalExecutionAuthorizationStatus: parseLabeledValue(lines, "Final execution authorization status") ?? summaryValues.finalExecutionAuthorizationStatus ?? null,
    executionMode: parseLabeledValue(lines, "Execution mode") ?? summaryValues.executionMode ?? null,
    mutationEnabled: parseBoolean(parseLabeledValue(lines, "Mutation enabled")) ?? summaryValues.mutationEnabled ?? null,
    rollbackEnabled: parseBoolean(parseLabeledValue(lines, "Rollback enabled")) ?? summaryValues.rollbackEnabled ?? null,
    finalMutationSwitchRequired: parseBoolean(parseLabeledValue(lines, "Final mutation switch required")) ?? summaryValues.finalMutationSwitchRequired ?? null,
    finalMutationSwitchEnabled: parseBoolean(parseLabeledValue(lines, "Final mutation switch enabled")) ?? summaryValues.finalMutationSwitchEnabled ?? null,
    finalMutationSwitchEvaluationStatus: parseLabeledValue(lines, "Final mutation switch evaluation status") ?? summaryValues.finalMutationSwitchEvaluationStatus ?? null,
    finalMutationSwitchId: parseLabeledValue(lines, "Final mutation switch id") ?? null,
    finalMutationSwitchTargetRequestMatch: parseBoolean(parseLabeledValue(lines, "Final mutation switch target request match")),
    finalMutationSwitchMutationTypeMatch: parseBoolean(parseLabeledValue(lines, "Final mutation switch mutation type match")),
    finalMutationSwitchExpirationStatus: parseLabeledValue(lines, "Final mutation switch expiration status"),
    preflightState: parseLabeledValue(lines, "Preflight state"),
    dryRunPreviewStatus: parseLabeledValue(lines, "Dry-run preview status"),
    preflightStatus: parseLabeledValue(lines, "Preflight status"),
    authorizationEvaluationStatus: parseLabeledValue(lines, "Authorization evaluation status"),
    liveValidationStatus: parseLabeledValue(lines, "Live validation status"),
    liveValidationSummary: parseLabeledValue(lines, "Live validation summary"),
    explicitMutationExecutionModeStatus: parseLabeledValue(lines, "Explicit mutation execution mode status"),
    predictedAffectedObjects: parseRepeatedLabeledValues(lines, "Predicted affected object"),
    predictedCreatedObjects: parseRepeatedLabeledValues(lines, "Predicted created object"),
    detectedConflicts: parseRepeatedLabeledValues(lines, "Detected conflict"),
    detectedRisks: parseRepeatedLabeledValues(lines, "Detected risk"),
    executableActions: parseList(parseLabeledValue(lines, "Executable actions")),
    blockedActions: parseList(parseLabeledValue(lines, "Blocked actions")),
    dependencyBlockedActions: parseList(parseLabeledValue(lines, "Dependency blocked actions")),
    missingGates: parseList(parseLabeledValue(lines, "Missing gates")),
    dependencyGraph: parseRepeatedLabeledValues(lines, "Dependency graph"),
    rollbackGraph: parseRepeatedLabeledValues(lines, "Rollback graph"),
    gateStatuses: parseRepeatedLabeledValues(lines, "Gate status"),
    failureHandlingStatus: parseLabeledValue(lines, "Failure handling status"),
    failureClassification: parseLabeledValue(lines, "Failure classification"),
    failureSource: parseLabeledValue(lines, "Failure source"),
    failureIsSimulated: parseBoolean(parseLabeledValue(lines, "Failure is simulated")),
    failureIsRecoverable: parseBoolean(parseLabeledValue(lines, "Failure is recoverable")),
    failureRequiresManualReview: parseBoolean(parseLabeledValue(lines, "Failure requires manual review")),
    failureEvidenceSummary: parseLabeledValue(lines, "Failure evidence summary"),
    failedActionId: parseLabeledValue(lines, "Failed action id"),
    successfulActionIds: parseList(parseLabeledValue(lines, "Successful action ids")),
    rollbackPlanRequired: parseBoolean(parseLabeledValue(lines, "Rollback plan required")),
    rollbackActions: parseList(parseLabeledValue(lines, "Rollback actions")),
    rollbackAutoExecute: parseBoolean(parseLabeledValue(lines, "Rollback auto execute")),
    manualReviewRequired: parseBoolean(parseLabeledValue(lines, "Manual review required"))
      ?? parseBoolean(parseLabeledValue(lines, "Failure requires manual review")),
    failureSimulated: parseBoolean(parseLabeledValue(lines, "Failure simulated")),
    failureSimulationId: parseLabeledValue(lines, "Failure simulation id"),
    simulatedFailureKind: parseLabeledValue(lines, "Simulated failure kind"),
    simulationTargetActionId: parseLabeledValue(lines, "Simulation target action id"),
    rollbackPlanId: parseLabeledValue(lines, "Rollback plan id") ?? summaryValues.rollbackPlanId ?? null,
    actionsExecutedCount: parseCount(parseLabeledValue(lines, "Actions executed count")),
    actionsFailedCount: parseCount(parseLabeledValue(lines, "Actions failed count")),
    perActionResults: parseRepeatedLabeledValues(lines, "Action result"),
    remainingActionsNotExecuted: parseList(parseLabeledValue(lines, "Remaining actions not executed")),
    finalSceneSummary: parseLabeledValue(lines, "Final scene state"),
    manualTrigger: parseBoolean(parseLabeledValue(lines, "Manual trigger")) ?? summaryValues.manualTrigger ?? null,
  };
}

export function extractUnityValidationEvidenceFromReviewPackage(item: AutonomousReviewPackage): UnityValidationEvidence | null {
  return buildEvidence(item.work_item_id, item.summary, [...item.tests_run, ...item.proof_results, ...item.risks, item.rollback_notes]);
}

export function extractUnityValidationEvidenceFromDeliveryPackage(item: AutonomousDeliveryPackage): UnityValidationEvidence | null {
  return buildEvidence(
    item.work_item_id,
    item.release_notes,
    [...item.validation_results, ...item.proof_results, item.risk_summary, item.recommended_pr_body, item.rollback_plan],
  );
}

function kindLabel(kind: UnityValidationEvidenceKind): string {
  switch (kind) {
    case "mutation_execution_preflight":
      return "Mutation Execution Preflight";
    case "mutation_execution_plan":
      return "Mutation Execution Plan";
    case "mutation_execution_chain_plan":
      return "Mutation Execution Chain Plan";
    case "mutation_execution_chain_readiness":
      return "Mutation Execution Chain Readiness";
    case "mutation_execution_chain_result":
      return "Controlled Unity Chain Execution";
    case "planned_chain_rollback_result":
      return "Rollback Execution";
    case "controlled_mutation_result":
      return "Controlled Unity Mutation";
    case "controlled_rollback_result":
      return "Controlled Unity Rollback";
    case "scene_object_creation_preview":
      return "Scene Object Creation Preview";
    case "adapter_preview":
      return "Adapter Preview";
    case "real_bridge_unavailable":
      return "Bridge Unavailable";
    case "real_bridge_read_only":
    default:
      return "Read-Only Bridge";
  }
}

function formatMetric(value: number | null): string {
  return value === null ? "unknown" : String(value);
}

function hasFailureEvidence(evidence: UnityValidationEvidence): boolean {
  return Boolean(
    evidence.failureClassification
      || evidence.failureSource
      || evidence.failureEvidenceSummary
      || evidence.failureRequiresManualReview !== null,
  );
}

export function UnityValidationEvidencePanel({ evidence }: { evidence: UnityValidationEvidence }) {
  return (
    <section className="mt-3 rounded-[1.25rem] border border-ocean/15 bg-ocean/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-slate">Unity validation evidence</p>
        <span className="inline-flex rounded-full border border-ocean/20 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ocean">
          {kindLabel(evidence.kind)}
        </span>
        {evidence.demoPreview ? (
          <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
            Demo preview
          </span>
        ) : null}
        {evidence.kind === "scene_object_creation_preview" ? (
          <>
            <span className="inline-flex rounded-full border border-coral/20 bg-coral/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ember">
              DRY RUN ONLY
            </span>
            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
              NOT EXECUTED
            </span>
            <span className="inline-flex rounded-full border border-ink/10 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/75">
              {evidence.finalExecutionAuthorizationStatus ?? "FINAL EXECUTION NOT AUTHORIZED"}
            </span>
          </>
        ) : null}
        {evidence.kind === "mutation_execution_preflight" ? (
          <>
            <span className="inline-flex rounded-full border border-coral/20 bg-coral/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ember">
              PREFLIGHT SIMULATION
            </span>
            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
              NO UNITY MUTATION PERFORMED
            </span>
            <span className="inline-flex rounded-full border border-ink/10 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/75">
              {evidence.authorizationEvaluationStatus ?? "FINAL EXECUTION AUTHORIZATION INVALID"}
            </span>
          </>
        ) : null}
        {evidence.kind === "mutation_execution_plan" ? (
          <>
            <span className="inline-flex rounded-full border border-coral/20 bg-coral/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ember">
              EXECUTION PLAN ONLY
            </span>
            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
              FINAL MUTATION SWITCH REQUIRED
            </span>
            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
              MUTATION DISABLED
            </span>
            <span className="inline-flex rounded-full border border-ink/10 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/75">
              {evidence.finalMutationSwitchEvaluationStatus ?? "MUTATION SWITCH DISABLED"}
            </span>
            <span className="inline-flex rounded-full border border-ink/10 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/75">
              NOT EXECUTED
            </span>
          </>
        ) : null}
        {evidence.kind === "mutation_execution_chain_plan" ? (
          <>
            <span className="inline-flex rounded-full border border-coral/20 bg-coral/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ember">
              CHAIN PLAN ONLY
            </span>
            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
              ROLLBACK ORDER PREVIEW
            </span>
            <span className="inline-flex rounded-full border border-ink/10 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/75">
              NOT EXECUTED
            </span>
          </>
        ) : null}
        {evidence.kind === "mutation_execution_chain_readiness" ? (
          <>
            <span className="inline-flex rounded-full border border-coral/20 bg-coral/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ember">
              CHAIN READINESS ONLY
            </span>
            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
              NO ACTIONS EXECUTED
            </span>
            <span className="inline-flex rounded-full border border-ink/10 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/75">
              {evidence.chainReadinessStatus ?? "not_ready"}
            </span>
          </>
        ) : null}
        {evidence.kind === "mutation_execution_chain_result" ? (
          <>
            <span className="inline-flex rounded-full border border-coral/20 bg-coral/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ember">
              CONTROLLED UNITY CHAIN EXECUTION
            </span>
            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
              EXECUTED
            </span>
            {evidence.failureSimulated ? (
              <>
                <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
                  CONTROLLED FAILURE SIMULATION
                </span>
                <span className="inline-flex rounded-full border border-ink/10 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/75">
                  SIMULATED FAILURE
                </span>
              </>
            ) : null}
            {evidence.executionStatus === "partial_failure" ? (
              <>
                <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
                  PARTIAL FAILURE
                </span>
                {evidence.rollbackPlanRequired ? (
                  <>
                    <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
                      ROLLBACK PLAN GENERATED
                    </span>
                    <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
                      ROLLBACK PLAN REQUIRED
                    </span>
                    <span className="inline-flex rounded-full border border-ink/10 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/75">
                      ROLLBACK NOT AUTO-EXECUTED
                    </span>
                  </>
                ) : null}
              </>
            ) : null}
            {evidence.failureSource ? (
              <span className="inline-flex rounded-full border border-ink/10 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/75">
                FAILURE SOURCE: {evidence.failureSource}
              </span>
            ) : null}
          </>
        ) : null}
        {evidence.kind === "planned_chain_rollback_result" ? (
          <>
            <span className="inline-flex rounded-full border border-coral/20 bg-coral/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ember">
              ROLLBACK EXECUTION
            </span>
            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
              EXECUTED
            </span>
            <span className="inline-flex rounded-full border border-ink/10 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/75">
              MANUAL TRIGGER
            </span>
            {evidence.executed && evidence.executionStatus === "success" ? (
              <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
                MANUAL ROLLBACK EXECUTED
              </span>
            ) : null}
            {evidence.executionStatus === "partial_failure" ? (
              <>
                <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
                  PARTIAL FAILURE
                </span>
                {evidence.remainingActionsNotExecuted.length > 0 ? (
                  <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
                    REMAINING ACTIONS NOT EXECUTED
                  </span>
                ) : null}
              </>
            ) : null}
            {evidence.failureSource ? (
              <span className="inline-flex rounded-full border border-ink/10 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/75">
                FAILURE SOURCE: {evidence.failureSource}
              </span>
            ) : null}
          </>
        ) : null}
        {evidence.kind === "controlled_mutation_result" ? (
          <>
            <span className="inline-flex rounded-full border border-coral/20 bg-coral/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ember">
              CONTROLLED UNITY MUTATION
            </span>
            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
              EXECUTED
            </span>
            <span className="inline-flex rounded-full border border-ink/10 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/75">
              ROLLBACK AVAILABLE
            </span>
          </>
        ) : null}
        {evidence.kind === "controlled_rollback_result" ? (
          <>
            <span className="inline-flex rounded-full border border-coral/20 bg-coral/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ember">
              CONTROLLED UNITY ROLLBACK
            </span>
            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
              EXECUTED
            </span>
            <span className="inline-flex rounded-full border border-ink/10 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/75">
              TARGET REMOVED
            </span>
          </>
        ) : null}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <p className="text-xs leading-6 text-slate">Bridge status: {evidence.bridgeStatus}</p>
        <p className="text-xs leading-6 text-slate">Scene validation status: {evidence.sceneValidationStatus}</p>
        <p className="text-xs leading-6 text-slate">Checked scene: {evidence.checkedSceneName ?? "none"}</p>
        <p className="text-xs leading-6 text-slate">Missing scripts: {formatMetric(evidence.missingScriptCount)}</p>
        <p className="text-xs leading-6 text-slate">Console errors: {formatMetric(evidence.consoleErrorCount)}</p>
        <p className="text-xs leading-6 text-slate">Object count: {formatMetric(evidence.objectCount)}</p>
      </div>
      {evidence.kind === "scene_object_creation_preview" ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <p className="text-xs leading-6 text-slate">Requested object name: {evidence.requestedObjectName ?? "none"}</p>
          <p className="text-xs leading-6 text-slate">Target scene: {evidence.targetScene ?? "none"}</p>
          <p className="text-xs leading-6 text-slate">Intended components: {evidence.intendedComponents.length > 0 ? evidence.intendedComponents.join(", ") : "none"}</p>
          <p className="text-xs leading-6 text-slate">Intended transform position: {evidence.intendedTransformPosition ?? "none"}</p>
          <p className="text-xs leading-6 text-slate">Intended transform rotation: {evidence.intendedTransformRotation ?? "none"}</p>
          <p className="text-xs leading-6 text-slate">Intended transform scale: {evidence.intendedTransformScale ?? "none"}</p>
          <p className="text-xs leading-6 text-slate">Risk level: {evidence.riskLevel ?? "unknown"}</p>
          <p className="text-xs leading-6 text-slate">Dry run: {String(evidence.dryRun ?? false)}</p>
          <p className="text-xs leading-6 text-slate">Executed: {String(evidence.executed ?? false)}</p>
          <p className="text-xs leading-6 text-slate">Final execution required: {String(evidence.finalExecutionRequired ?? true)}</p>
          <p className="text-xs leading-6 text-slate">Final execution authorized: {String(evidence.finalExecutionAuthorized ?? false)}</p>
        </div>
      ) : null}
      {evidence.kind === "mutation_execution_preflight" ? (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <p className="text-xs leading-6 text-slate">Requested object name: {evidence.requestedObjectName ?? "none"}</p>
            <p className="text-xs leading-6 text-slate">Target scene: {evidence.targetScene ?? "none"}</p>
            <p className="text-xs leading-6 text-slate">Intended components: {evidence.intendedComponents.length > 0 ? evidence.intendedComponents.join(", ") : "none"}</p>
            <p className="text-xs leading-6 text-slate">Intended transform position: {evidence.intendedTransformPosition ?? "none"}</p>
            <p className="text-xs leading-6 text-slate">Intended transform rotation: {evidence.intendedTransformRotation ?? "none"}</p>
            <p className="text-xs leading-6 text-slate">Intended transform scale: {evidence.intendedTransformScale ?? "none"}</p>
            <p className="text-xs leading-6 text-slate">Preflight state: {evidence.preflightState ?? "unknown"}</p>
            <p className="text-xs leading-6 text-slate">Dry run: {String(evidence.dryRun ?? true)}</p>
            <p className="text-xs leading-6 text-slate">Executed: {String(evidence.executed ?? false)}</p>
          </div>
          <div className="mt-2">
            <p className="text-xs uppercase tracking-[0.18em] text-slate">Predicted affected objects</p>
            <p className="mt-1 text-xs leading-6 text-slate">{evidence.predictedAffectedObjects.length > 0 ? evidence.predictedAffectedObjects.join(" | ") : "none"}</p>
          </div>
          <div className="mt-2">
            <p className="text-xs uppercase tracking-[0.18em] text-slate">Predicted created objects</p>
            <p className="mt-1 text-xs leading-6 text-slate">{evidence.predictedCreatedObjects.length > 0 ? evidence.predictedCreatedObjects.join(" | ") : "none"}</p>
          </div>
          <div className="mt-2">
            <p className="text-xs uppercase tracking-[0.18em] text-slate">Detected conflicts</p>
            <p className="mt-1 text-xs leading-6 text-slate">{evidence.detectedConflicts.length > 0 ? evidence.detectedConflicts.join(" | ") : "none"}</p>
          </div>
          <div className="mt-2">
            <p className="text-xs uppercase tracking-[0.18em] text-slate">Detected risks</p>
            <p className="mt-1 text-xs leading-6 text-slate">{evidence.detectedRisks.length > 0 ? evidence.detectedRisks.join(" | ") : "none"}</p>
          </div>
        </>
      ) : null}
      {evidence.kind === "scene_object_creation_preview" ? (
        <div className="mt-2">
          <p className="text-xs uppercase tracking-[0.18em] text-slate">Required approval gates</p>
          <p className="mt-1 text-xs leading-6 text-slate">{evidence.requiredApprovalGates.length > 0 ? evidence.requiredApprovalGates.join(" | ") : "none"}</p>
        </div>
      ) : null}
      {evidence.kind === "mutation_execution_plan" ? (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <p className="text-xs leading-6 text-slate">Requested object name: {evidence.requestedObjectName ?? "none"}</p>
            <p className="text-xs leading-6 text-slate">Target scene: {evidence.targetScene ?? "none"}</p>
            <p className="text-xs leading-6 text-slate">Intended components: {evidence.intendedComponents.length > 0 ? evidence.intendedComponents.join(", ") : "none"}</p>
            <p className="text-xs leading-6 text-slate">Intended transform position: {evidence.intendedTransformPosition ?? "none"}</p>
            <p className="text-xs leading-6 text-slate">Intended transform rotation: {evidence.intendedTransformRotation ?? "none"}</p>
            <p className="text-xs leading-6 text-slate">Intended transform scale: {evidence.intendedTransformScale ?? "none"}</p>
            <p className="text-xs leading-6 text-slate">Execution mode: {evidence.executionMode ?? "unknown"}</p>
            <p className="text-xs leading-6 text-slate">Mutation enabled: {String(evidence.mutationEnabled ?? false)}</p>
            <p className="text-xs leading-6 text-slate">Executed: {String(evidence.executed ?? false)}</p>
            <p className="text-xs leading-6 text-slate">Final mutation switch required: {String(evidence.finalMutationSwitchRequired ?? true)}</p>
            <p className="text-xs leading-6 text-slate">Final mutation switch enabled: {String(evidence.finalMutationSwitchEnabled ?? false)}</p>
            <p className="text-xs leading-6 text-slate">Dry-run preview status: {evidence.dryRunPreviewStatus ?? "unknown"}</p>
            <p className="text-xs leading-6 text-slate">Preflight status: {evidence.preflightStatus ?? "unknown"}</p>
            <p className="text-xs leading-6 text-slate">Live validation status: {evidence.liveValidationStatus ?? "unknown"}</p>
            <p className="text-xs leading-6 text-slate">Explicit mutation execution mode status: {evidence.explicitMutationExecutionModeStatus ?? "unknown"}</p>
            <p className="text-xs leading-6 text-slate">Authorization evaluation status: {evidence.authorizationEvaluationStatus ?? "unknown"}</p>
            <p className="text-xs leading-6 text-slate">Final mutation switch evaluation status: {evidence.finalMutationSwitchEvaluationStatus ?? "unknown"}</p>
          </div>
          <div className="mt-2">
            <p className="text-xs uppercase tracking-[0.18em] text-slate">Required gates</p>
            <p className="mt-1 text-xs leading-6 text-slate">{evidence.requiredApprovalGates.length > 0 ? evidence.requiredApprovalGates.join(" | ") : "none"}</p>
          </div>
          <div className="mt-2">
            <p className="text-xs uppercase tracking-[0.18em] text-slate">Gate statuses</p>
            <p className="mt-1 text-xs leading-6 text-slate">{evidence.gateStatuses.length > 0 ? evidence.gateStatuses.join(" | ") : "none"}</p>
          </div>
          <div className="mt-2">
            <p className="text-xs uppercase tracking-[0.18em] text-slate">Live validation summary</p>
            <p className="mt-1 text-xs leading-6 text-slate">{evidence.liveValidationSummary ?? "none"}</p>
          </div>
          <div className="mt-2">
            <p className="text-xs uppercase tracking-[0.18em] text-slate">Final mutation switch</p>
            <p className="mt-1 text-xs leading-6 text-slate">
              {[
                `id=${evidence.finalMutationSwitchId ?? "none"}`,
                `target_match=${String(evidence.finalMutationSwitchTargetRequestMatch ?? false)}`,
                `mutation_type_match=${String(evidence.finalMutationSwitchMutationTypeMatch ?? false)}`,
                `expiration=${evidence.finalMutationSwitchExpirationStatus ?? "unknown"}`,
              ].join(" | ")}
            </p>
          </div>
        </>
      ) : null}
      {evidence.kind === "planned_chain_rollback_result" ? (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <p className="text-xs leading-6 text-slate">Rollback plan id: {evidence.rollbackPlanId ?? "none"}</p>
            <p className="text-xs leading-6 text-slate">Execution status: {evidence.executionStatus ?? "unknown"}</p>
            <p className="text-xs leading-6 text-slate">Manual trigger: {String(evidence.manualTrigger ?? true)}</p>
            <p className="text-xs leading-6 text-slate">Actions executed count: {formatMetric(evidence.actionsExecutedCount)}</p>
            <p className="text-xs leading-6 text-slate">Actions failed count: {formatMetric(evidence.actionsFailedCount)}</p>
            <p className="text-xs leading-6 text-slate">Final scene state: {evidence.finalSceneSummary ?? "none"}</p>
          </div>
          {hasFailureEvidence(evidence) ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              <p className="text-xs leading-6 text-slate">FAILURE SOURCE: {evidence.failureSource ?? "none"}</p>
              <p className="text-xs leading-6 text-slate">SIMULATED FAILURE: {String(evidence.failureIsSimulated ?? false)}</p>
              <p className="text-xs leading-6 text-slate">RECOVERABLE: {String(evidence.failureIsRecoverable ?? false)}</p>
              <p className="text-xs leading-6 text-slate">MANUAL REVIEW REQUIRED: {String((evidence.failureRequiresManualReview ?? evidence.manualReviewRequired) ?? false)}</p>
              <p className="text-xs leading-6 text-slate">Failure classification: {evidence.failureClassification ?? "none"}</p>
            </div>
          ) : null}
          {evidence.failureEvidenceSummary ? (
            <div className="mt-2">
              <p className="text-xs uppercase tracking-[0.18em] text-slate">EVIDENCE SUMMARY</p>
              <p className="mt-1 text-xs leading-6 text-slate">{evidence.failureEvidenceSummary}</p>
            </div>
          ) : null}
          <div className="mt-2">
            <p className="text-xs uppercase tracking-[0.18em] text-slate">Per-action result</p>
            <p className="mt-1 text-xs leading-6 text-slate">{evidence.perActionResults.length > 0 ? evidence.perActionResults.join(" | ") : "none"}</p>
          </div>
          {evidence.remainingActionsNotExecuted.length > 0 ? (
            <div className="mt-2">
              <p className="text-xs uppercase tracking-[0.18em] text-slate">Remaining actions not executed</p>
              <p className="mt-1 text-xs leading-6 text-slate">{evidence.remainingActionsNotExecuted.join(" | ")}</p>
            </div>
          ) : null}
        </>
      ) : null}
      {evidence.kind === "mutation_execution_chain_plan" || evidence.kind === "mutation_execution_chain_readiness" || evidence.kind === "mutation_execution_chain_result" ? (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <p className="text-xs leading-6 text-slate">Chain id: {evidence.chainId ?? "none"}</p>
            <p className="text-xs leading-6 text-slate">Chain status: {evidence.chainStatus ?? "unknown"}</p>
            {evidence.kind === "mutation_execution_chain_readiness" || evidence.kind === "mutation_execution_chain_result" ? <p className="text-xs leading-6 text-slate">Chain readiness: {evidence.chainReadinessStatus ?? "unknown"}</p> : null}
            <p className="text-xs leading-6 text-slate">Total actions: {formatMetric(evidence.totalActions)}</p>
            <p className="text-xs leading-6 text-slate">Chain ready: {String(evidence.chainReady ?? false)}</p>
            <p className="text-xs leading-6 text-slate">Dry run: {String(evidence.dryRun ?? (evidence.kind === "mutation_execution_chain_result" ? false : true))}</p>
            <p className="text-xs leading-6 text-slate">Executed: {String(evidence.executed ?? (evidence.kind === "mutation_execution_chain_result"))}</p>
            <p className="text-xs leading-6 text-slate">Execution mode: {evidence.executionMode ?? "unknown"}</p>
          </div>
          <div className="mt-2">
            <p className="text-xs uppercase tracking-[0.18em] text-slate">Executable actions</p>
            <p className="mt-1 text-xs leading-6 text-slate">{evidence.executableActions.length > 0 ? evidence.executableActions.join(" | ") : "none"}</p>
          </div>
          <div className="mt-2">
            <p className="text-xs uppercase tracking-[0.18em] text-slate">Blocked actions</p>
            <p className="mt-1 text-xs leading-6 text-slate">{evidence.blockedActions.length > 0 ? evidence.blockedActions.join(" | ") : "none"}</p>
          </div>
          {evidence.kind === "mutation_execution_chain_readiness" ? (
            <>
              <div className="mt-2">
                <p className="text-xs uppercase tracking-[0.18em] text-slate">Dependency blocked actions</p>
                <p className="mt-1 text-xs leading-6 text-slate">{evidence.dependencyBlockedActions.length > 0 ? evidence.dependencyBlockedActions.join(" | ") : "none"}</p>
              </div>
              <div className="mt-2">
                <p className="text-xs uppercase tracking-[0.18em] text-slate">Missing gates</p>
                <p className="mt-1 text-xs leading-6 text-slate">{evidence.missingGates.length > 0 ? evidence.missingGates.join(" | ") : "none"}</p>
              </div>
              <div className="mt-2">
                <p className="text-xs uppercase tracking-[0.18em] text-slate">Gate statuses</p>
                <p className="mt-1 text-xs leading-6 text-slate">{evidence.gateStatuses.length > 0 ? evidence.gateStatuses.join(" | ") : "none"}</p>
              </div>
            </>
          ) : null}
          <div className="mt-2">
            <p className="text-xs uppercase tracking-[0.18em] text-slate">Dependency graph</p>
            <p className="mt-1 text-xs leading-6 text-slate">{evidence.dependencyGraph.length > 0 ? evidence.dependencyGraph.join(" | ") : "none"}</p>
          </div>
          <div className="mt-2">
            <p className="text-xs uppercase tracking-[0.18em] text-slate">Rollback graph</p>
            <p className="mt-1 text-xs leading-6 text-slate">{evidence.rollbackGraph.length > 0 ? evidence.rollbackGraph.join(" | ") : "none"}</p>
          </div>
          <div className="mt-2">
            <p className="text-xs uppercase tracking-[0.18em] text-slate">Required approval gates</p>
            <p className="mt-1 text-xs leading-6 text-slate">{evidence.requiredApprovalGates.length > 0 ? evidence.requiredApprovalGates.join(" | ") : "none"}</p>
          </div>
          {evidence.kind === "mutation_execution_chain_result" ? (
            <>
              <div className="mt-2">
                <p className="text-xs uppercase tracking-[0.18em] text-slate">Failure handling</p>
                <p className="mt-1 text-xs leading-6 text-slate">
                  {[
                    `status=${evidence.failureHandlingStatus ?? "none"}`,
                    `classification=${evidence.failureClassification ?? "none"}`,
                    `source=${evidence.failureSource ?? "none"}`,
                    `failed_action=${evidence.failedActionId ?? "none"}`,
                    `manual_review=${String((evidence.failureRequiresManualReview ?? evidence.manualReviewRequired) ?? false)}`,
                  ].join(" | ")}
                </p>
              </div>
              {hasFailureEvidence(evidence) ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  <p className="text-xs leading-6 text-slate">FAILURE SOURCE: {evidence.failureSource ?? "none"}</p>
                  <p className="text-xs leading-6 text-slate">SIMULATED FAILURE: {String(evidence.failureIsSimulated ?? evidence.failureSimulated ?? false)}</p>
                  <p className="text-xs leading-6 text-slate">RECOVERABLE: {String(evidence.failureIsRecoverable ?? false)}</p>
                  <p className="text-xs leading-6 text-slate">MANUAL REVIEW REQUIRED: {String((evidence.failureRequiresManualReview ?? evidence.manualReviewRequired) ?? false)}</p>
                </div>
              ) : null}
              {evidence.failureEvidenceSummary ? (
                <div className="mt-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate">EVIDENCE SUMMARY</p>
                  <p className="mt-1 text-xs leading-6 text-slate">{evidence.failureEvidenceSummary}</p>
                </div>
              ) : null}
              {evidence.failureSimulated ? (
                <div className="mt-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate">Failure simulation</p>
                  <p className="mt-1 text-xs leading-6 text-slate">
                    {[
                      `enabled=${String(evidence.failureSimulated)}`,
                      `simulation_id=${evidence.failureSimulationId ?? "none"}`,
                      `kind=${evidence.simulatedFailureKind ?? "none"}`,
                      `target_action=${evidence.simulationTargetActionId ?? "none"}`,
                    ].join(" | ")}
                  </p>
                </div>
              ) : null}
              <div className="mt-2">
                <p className="text-xs uppercase tracking-[0.18em] text-slate">Successful actions</p>
                <p className="mt-1 text-xs leading-6 text-slate">{evidence.successfulActionIds.length > 0 ? evidence.successfulActionIds.join(" | ") : "none"}</p>
              </div>
              <div className="mt-2">
                <p className="text-xs uppercase tracking-[0.18em] text-slate">Rollback planning</p>
                <p className="mt-1 text-xs leading-6 text-slate">
                  {[
                    `required=${String(evidence.rollbackPlanRequired ?? false)}`,
                    `actions=${evidence.rollbackActions.join(" | ") || "none"}`,
                    `auto_execute=${String(evidence.rollbackAutoExecute ?? false)}`,
                  ].join(" | ")}
                </p>
              </div>
            </>
          ) : null}
        </>
      ) : null}
      {evidence.kind === "controlled_mutation_result" ? (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <p className="text-xs leading-6 text-slate">Mutation type: {evidence.mutationType ?? "unknown"}</p>
            <p className="text-xs leading-6 text-slate">Target scene: {evidence.targetScene ?? "none"}</p>
            <p className="text-xs leading-6 text-slate">Requested object name: {evidence.requestedObjectName ?? "none"}</p>
            <p className="text-xs leading-6 text-slate">Created object name: {evidence.createdObjectName ?? "none"}</p>
            <p className="text-xs leading-6 text-slate">Mutation enabled: {String(evidence.mutationEnabled ?? false)}</p>
            <p className="text-xs leading-6 text-slate">Executed: {String(evidence.executed ?? false)}</p>
            <p className="text-xs leading-6 text-slate">Scene saved: {String(evidence.sceneSaved ?? false)}</p>
            <p className="text-xs leading-6 text-slate">Duplicate handling: {evidence.duplicateHandling ?? "none"}</p>
          </div>
          <div className="mt-2">
            <p className="text-xs uppercase tracking-[0.18em] text-slate">Rollback hint</p>
            <p className="mt-1 text-xs leading-6 text-slate">{evidence.rollbackHint ?? "none"}</p>
          </div>
        </>
      ) : null}
      {evidence.kind === "controlled_rollback_result" ? (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <p className="text-xs leading-6 text-slate">Rollback type: {evidence.rollbackType ?? "unknown"}</p>
            <p className="text-xs leading-6 text-slate">Target scene: {evidence.targetScene ?? "none"}</p>
            <p className="text-xs leading-6 text-slate">Target object name: {evidence.requestedObjectName ?? "none"}</p>
            <p className="text-xs leading-6 text-slate">Removed object name: {evidence.removedObjectName ?? "none"}</p>
            <p className="text-xs leading-6 text-slate">Rollback enabled: {String(evidence.rollbackEnabled ?? false)}</p>
            <p className="text-xs leading-6 text-slate">Executed: {String(evidence.executed ?? false)}</p>
            <p className="text-xs leading-6 text-slate">Scene saved: {String(evidence.sceneSaved ?? false)}</p>
            <p className="text-xs leading-6 text-slate">Target missing handling: {evidence.targetMissingHandling ?? "none"}</p>
          </div>
        </>
      ) : null}
      {evidence.evidenceTimestamp ? <p className="mt-2 text-xs leading-6 text-slate">Evidence timestamp: {evidence.evidenceTimestamp}</p> : null}
      {evidence.recommendedNextOperatorAction ? (
        <p className="mt-1 text-xs leading-6 text-slate">Recommended next operator action: {evidence.recommendedNextOperatorAction}</p>
      ) : null}
    </section>
  );
}