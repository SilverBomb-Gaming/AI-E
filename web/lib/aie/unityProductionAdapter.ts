import type {
  UnityProductionPlanningPacket,
  UnityProductionRequestType,
  UnityValidationExecutionResult,
} from "./productionPipelineFoundation";
import {
  createAutonomousDeliveryPackage,
  createAutonomousReviewPackage,
  type AutonomousDeliveryPackage,
  type AutonomousReviewPackage,
} from "./autonomousWorkPlanning";
import {
  createConfiguredUnityReadOnlyRuntimeBridge,
  type UnityReadOnlyRuntimeBridge,
} from "./unityReadOnlyRuntimeBridge";

export type UnityProductionAdapterAction =
  | "scene_plan_review"
  | "scene_object_creation_preview"
  | "prefab_plan_review"
  | "component_script_plan_review"
  | "validation_playtest_review"
  | "asset_import_review";

export type UnityProductionAdapterReviewState = {
  review_package_id: string | null;
  review_completed_at: string | null;
  approved_by_operator: boolean;
  operator_approval_id: string | null;
  delivery_package_id: string | null;
};

export type UnityProductionAdapterInput = {
  adapter_request_id: string;
  requested_at: string;
  planning_packet: UnityProductionPlanningPacket;
  requested_actions: UnityProductionAdapterAction[];
  review_state: UnityProductionAdapterReviewState;
};

export type UnityProductionAdapterOutput = {
  request_types: UnityProductionRequestType[];
  execution_mode: "reviewed_execution_only";
  review_artifacts: string[];
  approval_gates: string[];
  planned_adapter_actions: UnityProductionAdapterAction[];
  next_step: "request_review" | "request_operator_approval" | "ready_for_reviewed_execution";
};

export type UnityProductionAdapterReadinessStatus =
  | "blocked_missing_review"
  | "blocked_missing_approval"
  | "ready_for_reviewed_execution";

export type UnityProductionAdapterReadinessResult = {
  status: UnityProductionAdapterReadinessStatus;
  can_execute: false | true;
  reason: string;
  output: UnityProductionAdapterOutput;
};

export type UnityValidationExecutionInput = UnityProductionAdapterInput;

export type UnityValidationExecutionOptions = {
  runtime_bridge?: UnityReadOnlyRuntimeBridge;
};

export type UnitySceneObjectCreationPreviewTransform = {
  position: { x: number; y: number; z: number; };
  rotation_euler: { x: number; y: number; z: number; };
  scale: { x: number; y: number; z: number; };
};

export type UnitySceneObjectCreationPreviewInput = UnityProductionAdapterInput & {
  dry_run: boolean;
  requested_object_name: string;
  target_scene: string;
  intended_components: string[];
  intended_transform: UnitySceneObjectCreationPreviewTransform;
};

export type UnityMutationExecutionAuthorization = {
  final_execution_authorization_id: string;
  authorized_by_operator: boolean;
  authorized_at: string;
  authorization_scope: "scene_object_creation_request";
  target_request_id: string;
  expires_at: string | null;
};

export type UnityMutationExecutionAuthorizationEvaluation = {
  authorized: boolean;
  blocked_reason: string | null;
  request_id: string;
  scope_match: boolean;
  target_request_match: boolean;
  expiration_status: "valid" | "expired" | "not_provided";
  final_execution_authorization_id: string | null;
};

export type UnitySceneObjectCreationPreviewResult = {
  request_id: string;
  domain: "Unity";
  request_type: "scene_object_creation_request";
  execution_mode: "dry_run_mutation_preview";
  execution_kind: "dry_run_preview" | "preview_blocked";
  review_approval_id: string | null;
  review_approval_status: "missing" | "approved";
  operator_approval_id: string | null;
  operator_approval_status: "missing" | "approved";
  dry_run: boolean;
  executed: false;
  blocked_reason: string | null;
  requested_object_name: string;
  target_scene: string;
  intended_components: string[];
  intended_transform: UnitySceneObjectCreationPreviewTransform;
  risk_level: "low" | "medium" | "high";
  required_approval_gates: string[];
  recommended_next_operator_action: string;
  final_execution_required: true;
  final_execution_authorized: false;
  artifact_label: "unity_scene_object_creation_preview";
  review_package: AutonomousReviewPackage | null;
  delivery_package: AutonomousDeliveryPackage | null;
  mutating: false;
};

function hasCompletedReview(reviewState: UnityProductionAdapterReviewState): boolean {
  return Boolean(reviewState.review_package_id && reviewState.review_completed_at);
}

function hasApproval(reviewState: UnityProductionAdapterReviewState): boolean {
  return Boolean(reviewState.approved_by_operator && reviewState.operator_approval_id);
}

function isValidationOnlyPacket(planningPacket: UnityProductionPlanningPacket): boolean {
  return planningPacket.request_types.length === 1 && planningPacket.request_types[0] === "validation_playtest_request";
}

function isSceneObjectCreationOnlyPacket(planningPacket: UnityProductionPlanningPacket): boolean {
  return planningPacket.request_types.length === 1 && planningPacket.request_types[0] === "scene_object_creation_request";
}

function normalizePreviewComponents(components: string[]): string[] {
  return [...new Set(components.map((component) => component.trim()).filter(Boolean))];
}

function inferSceneObjectCreationRiskLevel(components: string[]): UnitySceneObjectCreationPreviewResult["risk_level"] {
  const normalized = components.map((component) => component.toLowerCase());
  if (normalized.some((component) => component.includes("script") || component.includes("behaviour") || component.includes("behavior") || component.includes("animator") || component.includes("audio"))) {
    return "high";
  }
  if (normalized.length > 1) {
    return "medium";
  }
  return "low";
}

function buildSceneObjectCreationPreviewResult(
  input: UnitySceneObjectCreationPreviewInput,
  blockedReason: string | null,
  recommendedNextOperatorAction: string,
): UnitySceneObjectCreationPreviewResult {
  const intendedComponents = normalizePreviewComponents(input.intended_components);

  return {
    request_id: input.adapter_request_id,
    domain: "Unity",
    request_type: "scene_object_creation_request",
    execution_mode: "dry_run_mutation_preview",
    execution_kind: blockedReason ? "preview_blocked" : "dry_run_preview",
    review_approval_id: input.review_state.review_package_id,
    review_approval_status: hasCompletedReview(input.review_state) ? "approved" : "missing",
    operator_approval_id: input.review_state.operator_approval_id,
    operator_approval_status: hasApproval(input.review_state) ? "approved" : "missing",
    dry_run: input.dry_run,
    executed: false,
    blocked_reason: blockedReason,
    requested_object_name: input.requested_object_name.trim(),
    target_scene: input.target_scene.trim(),
    intended_components: intendedComponents,
    intended_transform: input.intended_transform,
    risk_level: inferSceneObjectCreationRiskLevel(intendedComponents),
    required_approval_gates: [...input.planning_packet.required_approval_gates],
    recommended_next_operator_action: recommendedNextOperatorAction,
    final_execution_required: true,
    final_execution_authorized: false,
    artifact_label: "unity_scene_object_creation_preview",
    review_package: null,
    delivery_package: null,
    mutating: false,
  };
}

function formatVector3(vector: { x: number; y: number; z: number }): string {
  return `${vector.x}, ${vector.y}, ${vector.z}`;
}

function createUnitySceneObjectCreationPreviewPackages(
  input: UnitySceneObjectCreationPreviewInput,
  result: UnitySceneObjectCreationPreviewResult,
): {
  reviewPackage: AutonomousReviewPackage;
  deliveryPackage: AutonomousDeliveryPackage;
} {
  const packageSuffix = input.adapter_request_id;
  const intendedComponents = result.intended_components.length > 0 ? result.intended_components.join(", ") : "none";
  const summary = `DRY RUN ONLY: Unity scene object creation preview for ${result.requested_object_name} in ${result.target_scene}. NOT EXECUTED.`;
  const proofResults = [
    `Execution kind: ${result.execution_kind}`,
    `Requested object name: ${result.requested_object_name}`,
    `Target scene: ${result.target_scene}`,
    `Intended components: ${intendedComponents}`,
    `Intended transform position: ${formatVector3(result.intended_transform.position)}`,
    `Intended transform rotation: ${formatVector3(result.intended_transform.rotation_euler)}`,
    `Intended transform scale: ${formatVector3(result.intended_transform.scale)}`,
    `Risk level: ${result.risk_level}`,
    `Dry run: ${String(result.dry_run)}`,
    `Executed: ${String(result.executed)}`,
    `Final execution required: ${String(result.final_execution_required)}`,
    `Final execution authorized: ${String(result.final_execution_authorized)}`,
    "Final execution authorization status: FINAL EXECUTION NOT AUTHORIZED",
    ...result.required_approval_gates.map((gate) => `Required approval gate: ${gate}`),
    `Recommended next operator action: ${result.recommended_next_operator_action}`,
    ...(result.blocked_reason ? [`Blocked reason: ${result.blocked_reason}`] : []),
  ];

  const reviewPackage = createAutonomousReviewPackage({
    package_id: `unity-mutation-review-${packageSuffix}`,
    work_item_id: `unity-mutation-preview-${packageSuffix}`,
    chain_id: `unity-mutation-preview-chain-${packageSuffix}`,
    status: result.execution_kind === "dry_run_preview" ? "approved" : "pending",
    summary,
    files_changed: [],
    tests_run: ["unity scene object creation dry-run preview"],
    proof_results: proofResults,
    risks: [
      `Risk level: ${result.risk_level}`,
      "DRY RUN ONLY",
      "NOT EXECUTED",
      "FINAL EXECUTION NOT AUTHORIZED",
      "No Unity scene mutation path enabled.",
    ],
    recommended_decision: "approve",
    rollback_notes: "Dry-run mutation preview only; no rollback required.",
    operator_actions: ["approve", "archive"],
  });

  const deliveryPackage = createAutonomousDeliveryPackage({
    delivery_package_id: `unity-mutation-delivery-${packageSuffix}`,
    review_package_id: reviewPackage.package_id,
    work_item_id: reviewPackage.work_item_id,
    chain_id: reviewPackage.chain_id,
    branch_name: "",
    commit_plan: [
      "Keep this Unity mutation preview attached to the reviewed delivery lane.",
      "DRY RUN ONLY: do not create, spawn, or write any Unity scene object from this package.",
      "Require the explicit final execute gate before any future mutation adapter is allowed.",
    ],
    files_changed: [],
    validation_results: proofResults,
    proof_results: [result.execution_kind, "DRY RUN ONLY", "NOT EXECUTED"],
    validation_results: proofResults,
    risk_summary: `Dry-run Unity mutation preview only. Risk level ${result.risk_level}. Final execution not authorized. No mutation path enabled.`,
    rollback_plan: "Discard the dry-run mutation preview package if the operator rejects it.",
    release_notes: summary,
    recommended_pr_title: "",
    recommended_pr_body: `Unity mutation preview handoff\n\nSummary: ${summary}\n\nNext operator action: ${result.recommended_next_operator_action}`,
    operator_decision: null,
    status: "awaiting_operator_approval",
    created_at: input.requested_at,
    updated_at: input.requested_at,
  });

  return {
    reviewPackage,
    deliveryPackage,
  };
}

function buildValidationChecklist(planningPacket: UnityProductionPlanningPacket): string[] {
  return [
    "Confirm reviewed Unity validation scope remains read-only.",
    "Confirm no scene, prefab, asset, or script mutation is permitted.",
    ...planningPacket.required_review_artifacts.map((artifact) => `Review artifact present: ${artifact}.`),
    ...planningPacket.required_approval_gates.map((gate) => `Approval gate satisfied: ${gate}.`),
  ];
}

function buildBlockedValidationResult(
  input: UnityValidationExecutionInput,
  blockedReason: string,
  recommendedNextOperatorAction: string,
): UnityValidationExecutionResult {
  return {
    request_id: input.adapter_request_id,
    domain: "Unity",
    request_type: "validation_playtest_request",
    execution_mode: "read_only_validation_preview",
    execution_kind: "adapter_preview",
    review_approval_id: input.review_state.review_package_id,
    review_approval_status: hasCompletedReview(input.review_state) ? "approved" : "missing",
    operator_approval_id: input.review_state.operator_approval_id,
    operator_approval_status: hasApproval(input.review_state) ? "approved" : "missing",
    executed: false,
    blocked_reason: blockedReason,
    bridge_status: "bridge_unavailable",
    scene_validation_status: "not_checked",
    missing_script_count: null,
    console_error_count: null,
    object_count: null,
    checked_scene_name: null,
    evidence_timestamp: input.requested_at,
    raw_evidence_summary: null,
    validation_checklist: buildValidationChecklist(input.planning_packet),
    delivery_summary: "Unity validation preview was not executed. Adapter remains non-mutating and review-gated.",
    recommended_next_operator_action: recommendedNextOperatorAction,
    artifact_label: "adapter_level_validation_preview",
    review_package: null,
    delivery_package: null,
    mutating: false,
  };
}

function createUnityValidationEvidencePackages(
  input: UnityValidationExecutionInput,
  result: Pick<
    UnityValidationExecutionResult,
    | "execution_kind"
    | "bridge_status"
    | "scene_validation_status"
    | "checked_scene_name"
    | "missing_script_count"
    | "console_error_count"
    | "object_count"
    | "delivery_summary"
    | "recommended_next_operator_action"
    | "validation_checklist"
    | "raw_evidence_summary"
    | "evidence_timestamp"
  >,
): {
  reviewPackage: AutonomousReviewPackage;
  deliveryPackage: AutonomousDeliveryPackage;
} {
  const packageSuffix = input.adapter_request_id;
  const summary = result.raw_evidence_summary
    ? `${result.delivery_summary} Raw evidence: ${result.raw_evidence_summary}`
    : result.delivery_summary;

  const reviewPackage = createAutonomousReviewPackage({
    package_id: `unity-review-${packageSuffix}`,
    work_item_id: `unity-validation-${packageSuffix}`,
    chain_id: `unity-validation-chain-${packageSuffix}`,
    status: "approved",
    summary,
    files_changed: [],
    tests_run: ["unity read-only validation probe"],
    proof_results: [
      result.bridge_status === "bridge_ready" ? "unity read-only bridge -> evidence_captured" : "unity read-only bridge -> unavailable",
      `Execution kind: ${result.execution_kind}`,
      `Scene validation status: ${result.scene_validation_status}`,
      `Checked scene name: ${result.checked_scene_name ?? "none"}`,
      `Missing script count: ${result.missing_script_count ?? "unknown"}`,
      `Console error count: ${result.console_error_count ?? "unknown"}`,
      `Object count: ${result.object_count ?? "unknown"}`,
      `Evidence timestamp: ${result.evidence_timestamp}`,
      `Recommended next operator action: ${result.recommended_next_operator_action}`,
    ],
    risks: ["No Unity or project mutation path enabled."],
    recommended_decision: "approve",
    rollback_notes: "Read-only validation evidence only; no rollback required.",
    operator_actions: ["approve", "archive"],
  });

  const deliveryPackage = createAutonomousDeliveryPackage({
    delivery_package_id: `unity-delivery-${packageSuffix}`,
    review_package_id: reviewPackage.package_id,
    work_item_id: reviewPackage.work_item_id,
    chain_id: reviewPackage.chain_id,
    branch_name: "",
    commit_plan: [
      "Keep Unity validation evidence attached to the reviewed delivery lane.",
      "Do not mutate scenes, prefabs, assets, or scripts from this delivery artifact.",
    ],
    files_changed: [],
    validation_results: [
      `Execution kind: ${result.execution_kind}`,
      `Bridge status: ${result.bridge_status}`,
      `Scene validation status: ${result.scene_validation_status}`,
      `Checked scene name: ${result.checked_scene_name ?? "none"}`,
      `Missing script count: ${result.missing_script_count ?? "unknown"}`,
      `Console error count: ${result.console_error_count ?? "unknown"}`,
      `Object count: ${result.object_count ?? "unknown"}`,
      `Evidence timestamp: ${result.evidence_timestamp}`,
      `Recommended next operator action: ${result.recommended_next_operator_action}`,
      ...(result.raw_evidence_summary ? [`Raw evidence summary: ${result.raw_evidence_summary}`] : []),
      ...result.validation_checklist,
    ],
    proof_results: [result.execution_kind],
    risk_summary: "Read-only Unity validation evidence only. No mutation path enabled.",
    rollback_plan: "Discard the evidence handoff package if the validation request is rejected.",
    release_notes: result.delivery_summary,
    recommended_pr_title: "",
    recommended_pr_body: `Unity validation evidence handoff\n\nSummary: ${summary}\n\nNext operator action: ${result.recommended_next_operator_action}`,
    operator_decision: null,
    status: "awaiting_operator_approval",
    created_at: result.evidence_timestamp,
    updated_at: result.evidence_timestamp,
  });

  return {
    reviewPackage,
    deliveryPackage,
  };
}

function extractSceneNameHint(planningPacket: UnityProductionPlanningPacket): string | null {
  const sceneMatch = planningPacket.objective.match(/(?:for|on) the ([a-z0-9 _-]+?)(?: room| scene|$)/i);
  if (sceneMatch?.[1]) {
    return sceneMatch[1].trim();
  }
  const explicitSceneMatch = planningPacket.objective.match(/([a-z0-9 _-]+) scene/i);
  return explicitSceneMatch?.[1]?.trim() ?? null;
}

export function mapUnityRequestTypeToAdapterAction(requestType: UnityProductionRequestType): UnityProductionAdapterAction {
  switch (requestType) {
    case "scene_request":
      return "scene_plan_review";
    case "scene_object_creation_request":
      return "scene_object_creation_preview";
    case "prefab_request":
      return "prefab_plan_review";
    case "component_script_request":
      return "component_script_plan_review";
    case "validation_playtest_request":
      return "validation_playtest_review";
    case "asset_import_request":
      return "asset_import_review";
    default:
      return "scene_plan_review";
  }
}

export function createUnityProductionAdapterOutput(input: UnityProductionAdapterInput): UnityProductionAdapterOutput {
  const plannedActions = input.requested_actions.length > 0
    ? input.requested_actions
    : input.planning_packet.request_types.map(mapUnityRequestTypeToAdapterAction);

  const nextStep = !hasCompletedReview(input.review_state)
    ? "request_review"
    : !hasApproval(input.review_state)
      ? "request_operator_approval"
      : "ready_for_reviewed_execution";

  return {
    request_types: input.planning_packet.request_types,
    execution_mode: "reviewed_execution_only",
    review_artifacts: input.planning_packet.required_review_artifacts,
    approval_gates: input.planning_packet.required_approval_gates,
    planned_adapter_actions: plannedActions,
    next_step: nextStep,
  };
}

export function evaluateUnityProductionAdapterReadiness(
  input: UnityProductionAdapterInput,
): UnityProductionAdapterReadinessResult {
  const output = createUnityProductionAdapterOutput(input);

  if (!hasCompletedReview(input.review_state)) {
    return {
      status: "blocked_missing_review",
      can_execute: false,
      reason: "Unity adapter execution stays blocked until a review package is completed.",
      output,
    };
  }

  if (!hasApproval(input.review_state)) {
    return {
      status: "blocked_missing_approval",
      can_execute: false,
      reason: "Unity adapter execution stays blocked until operator approval is recorded.",
      output,
    };
  }

  return {
    status: "ready_for_reviewed_execution",
    can_execute: true,
    reason: "Unity adapter design has the required review and approval metadata for a future reviewed execution path.",
    output,
  };
}

export async function executeReviewedUnityValidation(
  input: UnityValidationExecutionInput,
  options?: UnityValidationExecutionOptions,
): Promise<UnityValidationExecutionResult> {
  if (!isValidationOnlyPacket(input.planning_packet)) {
    return buildBlockedValidationResult(
      input,
      "Only validation_playtest_request is executable through the first Unity reviewed execution path.",
      "Narrow the Unity packet to a validation/playtest-only request before invoking the execution adapter.",
    );
  }

  if (!hasCompletedReview(input.review_state)) {
    return buildBlockedValidationResult(
      input,
      "Unity validation execution is blocked until review approval is recorded.",
      "Complete the Unity review package before requesting validation execution.",
    );
  }

  if (!hasApproval(input.review_state)) {
    return buildBlockedValidationResult(
      input,
      "Unity validation execution is blocked until operator approval is recorded.",
      "Record explicit operator approval before invoking the Unity validation adapter.",
    );
  }

  const runtimeBridge = options?.runtime_bridge ?? createConfiguredUnityReadOnlyRuntimeBridge();
  const bridgeResult = await runtimeBridge.probeValidation({
    request_id: input.adapter_request_id,
    requested_at: input.requested_at,
    scene_name_hint: extractSceneNameHint(input.planning_packet),
  });

  if (bridgeResult.bridge_status === "bridge_unavailable") {
    const baseResult: UnityValidationExecutionResult = {
      request_id: input.adapter_request_id,
      domain: "Unity",
      request_type: "validation_playtest_request",
      execution_mode: "read_only_validation_preview",
      execution_kind: "real_bridge_unavailable",
      review_approval_id: input.review_state.review_package_id,
      review_approval_status: "approved",
      operator_approval_id: input.review_state.operator_approval_id,
      operator_approval_status: "approved",
      executed: false,
      blocked_reason: bridgeResult.reason,
      bridge_status: "bridge_unavailable",
      scene_validation_status: "not_checked",
      missing_script_count: null,
      console_error_count: null,
      object_count: null,
      checked_scene_name: null,
      evidence_timestamp: bridgeResult.evidence_timestamp,
      raw_evidence_summary: bridgeResult.raw_evidence_summary,
      validation_checklist: buildValidationChecklist(input.planning_packet),
      delivery_summary: "A real Unity read-only validation bridge was requested but is currently unavailable. No adapter preview fallback was substituted silently, and no project mutation was performed.",
      recommended_next_operator_action: bridgeResult.recommended_next_operator_action,
      artifact_label: "unity_bridge_unavailable_report",
      review_package: null,
      delivery_package: null,
      mutating: false,
    };

    const evidencePackages = createUnityValidationEvidencePackages(input, baseResult);

    return {
      ...baseResult,
      review_package: evidencePackages.reviewPackage,
      delivery_package: evidencePackages.deliveryPackage,
    };
  }

  const baseResult: UnityValidationExecutionResult = {
    request_id: input.adapter_request_id,
    domain: "Unity",
    request_type: "validation_playtest_request",
    execution_mode: "read_only_runtime_bridge",
    execution_kind: "real_bridge_read_only",
    review_approval_id: input.review_state.review_package_id,
    review_approval_status: "approved",
    operator_approval_id: input.review_state.operator_approval_id,
    operator_approval_status: "approved",
    executed: true,
    blocked_reason: null,
    bridge_status: bridgeResult.bridge_status,
    scene_validation_status: bridgeResult.scene_validation_status,
    missing_script_count: bridgeResult.missing_script_count,
    console_error_count: bridgeResult.console_error_count,
    object_count: bridgeResult.object_count,
    checked_scene_name: bridgeResult.checked_scene_name,
    evidence_timestamp: bridgeResult.evidence_timestamp,
    raw_evidence_summary: bridgeResult.raw_evidence_summary,
    validation_checklist: buildValidationChecklist(input.planning_packet),
    delivery_summary: bridgeResult.summary,
    recommended_next_operator_action: bridgeResult.recommended_next_operator_action,
    artifact_label: "unity_read_only_validation_report",
    review_package: null,
    delivery_package: null,
    mutating: false,
  };

  const evidencePackages = createUnityValidationEvidencePackages(input, baseResult);

  return {
    ...baseResult,
    review_package: evidencePackages.reviewPackage,
    delivery_package: evidencePackages.deliveryPackage,
  };
}

export function previewUnitySceneObjectCreation(
  input: UnitySceneObjectCreationPreviewInput,
): UnitySceneObjectCreationPreviewResult {
  const baseResult = (() => {
  if (!isSceneObjectCreationOnlyPacket(input.planning_packet)) {
    return buildSceneObjectCreationPreviewResult(
      input,
      "Only scene_object_creation_request is supported by the Layer 15 dry-run mutation preview path.",
      "Narrow the Unity packet to a scene object creation request before requesting a dry-run mutation preview.",
    );
  }

  if (!input.dry_run) {
    return buildSceneObjectCreationPreviewResult(
      input,
      "Unity scene object creation preview requires dry_run=true and does not permit live mutation execution.",
      "Reissue the request as a dry-run preview and keep the explicit final execute gate pending.",
    );
  }

  if (!hasCompletedReview(input.review_state)) {
    return buildSceneObjectCreationPreviewResult(
      input,
      "Unity scene object creation preview is blocked until review approval is recorded.",
      "Complete the review package before requesting the dry-run mutation preview.",
    );
  }

  if (!hasApproval(input.review_state)) {
    return buildSceneObjectCreationPreviewResult(
      input,
      "Unity scene object creation preview is blocked until operator approval is recorded.",
      "Record explicit operator approval before requesting the dry-run mutation preview.",
    );
  }

  return buildSceneObjectCreationPreviewResult(
    input,
    null,
    "Review the dry-run preview, then require an explicit final execute gate before any future Unity mutation path is allowed.",
  );
  })();

  const previewPackages = createUnitySceneObjectCreationPreviewPackages(input, baseResult);

  return {
    ...baseResult,
    review_package: previewPackages.reviewPackage,
    delivery_package: previewPackages.deliveryPackage,
  };
}

export function evaluateUnityMutationExecutionAuthorization(input: {
  preview_result: Pick<UnitySceneObjectCreationPreviewResult, "request_id" | "request_type" | "final_execution_required" | "final_execution_authorized" | "executed">;
  authorization: UnityMutationExecutionAuthorization | null;
  evaluated_at: string;
}): UnityMutationExecutionAuthorizationEvaluation {
  if (!input.authorization) {
    return {
      authorized: false,
      blocked_reason: "Unity mutation execution remains blocked until a final execution authorization is recorded.",
      request_id: input.preview_result.request_id,
      scope_match: false,
      target_request_match: false,
      expiration_status: "not_provided",
      final_execution_authorization_id: null,
    };
  }

  const targetRequestMatch = input.authorization.target_request_id === input.preview_result.request_id;
  if (!targetRequestMatch) {
    return {
      authorized: false,
      blocked_reason: "Unity mutation execution authorization target request id does not match the reviewed preview request.",
      request_id: input.preview_result.request_id,
      scope_match: input.authorization.authorization_scope === input.preview_result.request_type,
      target_request_match: false,
      expiration_status: input.authorization.expires_at ? (input.authorization.expires_at <= input.evaluated_at ? "expired" : "valid") : "not_provided",
      final_execution_authorization_id: input.authorization.final_execution_authorization_id,
    };
  }

  const scopeMatch = input.authorization.authorization_scope === input.preview_result.request_type;
  if (!scopeMatch) {
    return {
      authorized: false,
      blocked_reason: "Unity mutation execution authorization scope does not match the requested mutation lane.",
      request_id: input.preview_result.request_id,
      scope_match: false,
      target_request_match: true,
      expiration_status: input.authorization.expires_at ? (input.authorization.expires_at <= input.evaluated_at ? "expired" : "valid") : "not_provided",
      final_execution_authorization_id: input.authorization.final_execution_authorization_id,
    };
  }

  const expirationStatus = input.authorization.expires_at
    ? input.authorization.expires_at <= input.evaluated_at
      ? "expired"
      : "valid"
    : "not_provided";
  if (expirationStatus === "expired") {
    return {
      authorized: false,
      blocked_reason: "Unity mutation execution authorization has expired and must be renewed before any future mutation path is allowed.",
      request_id: input.preview_result.request_id,
      scope_match: true,
      target_request_match: true,
      expiration_status: "expired",
      final_execution_authorization_id: input.authorization.final_execution_authorization_id,
    };
  }

  if (!input.authorization.authorized_by_operator) {
    return {
      authorized: false,
      blocked_reason: "Unity mutation execution authorization is present but not operator-authorized.",
      request_id: input.preview_result.request_id,
      scope_match: true,
      target_request_match: true,
      expiration_status: expirationStatus,
      final_execution_authorization_id: input.authorization.final_execution_authorization_id,
    };
  }

  return {
    authorized: true,
    blocked_reason: null,
    request_id: input.preview_result.request_id,
    scope_match: true,
    target_request_match: true,
    expiration_status: expirationStatus,
    final_execution_authorization_id: input.authorization.final_execution_authorization_id,
  };
}