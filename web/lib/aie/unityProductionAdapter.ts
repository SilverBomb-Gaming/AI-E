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

export type UnityMutationExecutionPreflightInput = UnitySceneObjectCreationPreviewInput & {
  authorization: UnityMutationExecutionAuthorization | null;
  evaluated_at?: string;
  known_target_scene_names?: string[];
  known_scene_object_names?: string[];
  supported_components?: string[];
};

export type UnityMutationExecutionPreflightResult = {
  request_id: string;
  domain: "Unity";
  request_type: "scene_object_creation_request";
  execution_mode: "mutation_execution_preflight_simulation";
  execution_kind: "preflight_simulation" | "preflight_blocked";
  review_approval_id: string | null;
  review_approval_status: "missing" | "approved";
  operator_approval_id: string | null;
  operator_approval_status: "missing" | "approved";
  target_scene: string;
  requested_object_name: string;
  intended_components: string[];
  intended_transform: UnitySceneObjectCreationPreviewTransform;
  authorization_evaluation: UnityMutationExecutionAuthorizationEvaluation;
  predicted_affected_objects: string[];
  predicted_created_objects: string[];
  detected_conflicts: string[];
  detected_risks: string[];
  recommended_operator_action: string;
  preflight_state: "blocked" | "simulation";
  dry_run: true;
  executed: false;
  artifact_label: "unity_mutation_execution_preflight";
  review_package: AutonomousReviewPackage | null;
  delivery_package: AutonomousDeliveryPackage | null;
  mutating: false;
};

export type UnityMutationExecutionPlanGate =
  | "review_approval"
  | "operator_approval"
  | "dry_run_preview"
  | "preflight_simulation"
  | "final_execution_authorization"
  | "live_read_only_validation"
  | "explicit_mutation_execution_mode";

export type UnityMutationExecutionPlanGateStatus = "approved" | "missing" | "invalid" | "disabled";

export type UnityMutationExecutionPlanGateEvaluation = {
  gate: UnityMutationExecutionPlanGate;
  status: UnityMutationExecutionPlanGateStatus;
  detail: string;
};

export type UnitySceneObjectCreationExecutionPlanInput = UnitySceneObjectCreationPreviewInput & {
  preview_result: UnitySceneObjectCreationPreviewResult | null;
  preflight_result: UnityMutationExecutionPreflightResult | null;
  authorization: UnityMutationExecutionAuthorization | null;
  live_validation_result: Pick<
    UnityValidationExecutionResult,
    | "request_id"
    | "execution_kind"
    | "bridge_status"
    | "scene_validation_status"
    | "checked_scene_name"
    | "missing_script_count"
    | "console_error_count"
    | "object_count"
    | "executed"
  > | null;
  mutation_execution_mode_enabled: boolean;
  evaluated_at?: string;
};

export type UnitySceneObjectCreationExecutionPlanResult = {
  request_id: string;
  domain: "Unity";
  request_type: "scene_object_creation_request";
  execution_mode: "disabled_plan_only";
  execution_kind: "execution_plan_only" | "execution_plan_blocked";
  review_approval_id: string | null;
  review_approval_status: "missing" | "approved";
  operator_approval_id: string | null;
  operator_approval_status: "missing" | "approved";
  target_scene: string;
  requested_object_name: string;
  intended_components: string[];
  intended_transform: UnitySceneObjectCreationPreviewTransform;
  required_gates: UnityMutationExecutionPlanGate[];
  gate_statuses: UnityMutationExecutionPlanGateEvaluation[];
  dry_run_preview_status: "valid" | "missing" | "invalid";
  preflight_status: "valid" | "missing" | "invalid";
  authorization_evaluation: UnityMutationExecutionAuthorizationEvaluation;
  live_validation_status: "valid" | "missing" | "invalid";
  live_validation_summary: string;
  explicit_mutation_execution_mode_status: "enabled" | "disabled";
  blocked_reason: string | null;
  recommended_next_operator_action: string;
  mutation_enabled: false;
  executed: false;
  artifact_label: "unity_mutation_execution_plan";
  review_package: AutonomousReviewPackage | null;
  delivery_package: AutonomousDeliveryPackage | null;
  mutating: false;
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

const DEFAULT_SUPPORTED_PREFLIGHT_COMPONENTS = [
  "Transform",
  "BoxCollider",
  "SphereCollider",
  "CapsuleCollider",
  "MeshRenderer",
  "SpriteRenderer",
  "Rigidbody",
  "AudioSource",
  "Light",
];

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

function toNormalizedNameSet(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function hasInvalidTransform(transform: UnitySceneObjectCreationPreviewTransform): boolean {
  const values = [
    transform.position.x,
    transform.position.y,
    transform.position.z,
    transform.rotation_euler.x,
    transform.rotation_euler.y,
    transform.rotation_euler.z,
    transform.scale.x,
    transform.scale.y,
    transform.scale.z,
  ];

  if (values.some((value) => !Number.isFinite(value))) {
    return true;
  }

  return transform.scale.x <= 0 || transform.scale.y <= 0 || transform.scale.z <= 0;
}

function formatAuthorizationEvaluationStatus(
  evaluation: UnityMutationExecutionAuthorizationEvaluation,
): string {
  return evaluation.authorized ? "FINAL EXECUTION AUTHORIZATION VALID" : "FINAL EXECUTION AUTHORIZATION INVALID";
}

function evaluateExecutionPlanDryRunPreviewStatus(
  previewResult: UnitySceneObjectCreationPreviewResult | null,
  requestId: string,
): {
  status: UnitySceneObjectCreationExecutionPlanResult["dry_run_preview_status"];
  detail: string;
} {
  if (!previewResult) {
    return {
      status: "missing",
      detail: "Dry-run preview gate is missing for this Unity mutation request.",
    };
  }

  if (
    previewResult.request_id !== requestId
    || previewResult.execution_kind !== "dry_run_preview"
    || previewResult.executed
    || !previewResult.dry_run
  ) {
    return {
      status: "invalid",
      detail: "Dry-run preview gate is invalid for this Unity mutation request.",
    };
  }

  return {
    status: "valid",
    detail: "Dry-run preview gate is present and matches the reviewed Unity mutation request.",
  };
}

function evaluateExecutionPlanPreflightStatus(
  preflightResult: UnityMutationExecutionPreflightResult | null,
  requestId: string,
): {
  status: UnitySceneObjectCreationExecutionPlanResult["preflight_status"];
  detail: string;
} {
  if (!preflightResult) {
    return {
      status: "missing",
      detail: "Preflight simulation gate is missing for this Unity mutation request.",
    };
  }

  if (
    preflightResult.request_id !== requestId
    || preflightResult.execution_kind !== "preflight_simulation"
    || preflightResult.preflight_state !== "simulation"
    || preflightResult.executed
  ) {
    return {
      status: "invalid",
      detail: "Preflight simulation gate is invalid for this Unity mutation request.",
    };
  }

  return {
    status: "valid",
    detail: "Preflight simulation gate is present and matches the reviewed Unity mutation request.",
  };
}

function evaluateExecutionPlanLiveValidationStatus(
  liveValidationResult: UnitySceneObjectCreationExecutionPlanInput["live_validation_result"],
  targetScene: string,
): {
  status: UnitySceneObjectCreationExecutionPlanResult["live_validation_status"];
  detail: string;
} {
  if (!liveValidationResult) {
    return {
      status: "missing",
      detail: "Live read-only Unity validation gate is missing for this mutation plan.",
    };
  }

  if (
    liveValidationResult.execution_kind !== "real_bridge_read_only"
    || liveValidationResult.bridge_status !== "bridge_ready"
    || !liveValidationResult.executed
    || (targetScene && liveValidationResult.checked_scene_name !== targetScene)
  ) {
    return {
      status: "invalid",
      detail: "Live read-only Unity validation gate is invalid for this mutation plan.",
    };
  }

  return {
    status: "valid",
    detail: `Live read-only Unity validation gate is present for ${liveValidationResult.checked_scene_name ?? "the reviewed scene"}.`,
  };
}

function buildUnityMutationExecutionPreflightResult(
  input: UnityMutationExecutionPreflightInput,
  authorizationEvaluation: UnityMutationExecutionAuthorizationEvaluation,
): UnityMutationExecutionPreflightResult {
  const intendedComponents = normalizePreviewComponents(input.intended_components);
  const detectedConflicts: string[] = [];
  const detectedRisks: string[] = [];
  const normalizedObjectName = input.requested_object_name.trim();
  const normalizedTargetScene = input.target_scene.trim();
  const knownTargetScenes = toNormalizedNameSet(input.known_target_scene_names);
  const knownSceneObjects = toNormalizedNameSet(input.known_scene_object_names);
  const supportedComponents = toNormalizedNameSet(input.supported_components ?? DEFAULT_SUPPORTED_PREFLIGHT_COMPONENTS);

  if (!normalizedTargetScene || (knownTargetScenes.size > 0 && !knownTargetScenes.has(normalizedTargetScene.toLowerCase()))) {
    const detail = normalizedTargetScene
      ? `Missing target scene risk: ${normalizedTargetScene} is not present in the reviewed scene list.`
      : "Missing target scene risk: no target scene was provided for the mutation request.";
    detectedConflicts.push(detail);
    detectedRisks.push(detail);
  }

  if (normalizedObjectName && knownSceneObjects.has(normalizedObjectName.toLowerCase())) {
    const detail = `Duplicate object name risk: ${normalizedObjectName} already exists in the reviewed scene inventory.`;
    detectedConflicts.push(detail);
    detectedRisks.push(detail);
  }

  const unsupportedComponents = intendedComponents.filter((component) => !supportedComponents.has(component.toLowerCase()));
  if (unsupportedComponents.length > 0) {
    const detail = `Unsupported component risk: ${unsupportedComponents.join(", ")} is not supported by the current preflight simulation allowlist.`;
    detectedConflicts.push(detail);
    detectedRisks.push(detail);
  }

  if (hasInvalidTransform(input.intended_transform)) {
    const detail = "Invalid transform risk: one or more transform values are non-finite or use a non-positive scale.";
    detectedConflicts.push(detail);
    detectedRisks.push(detail);
  }

  const predictedAffectedObjects = [
    ...(normalizedTargetScene ? [`Scene:${normalizedTargetScene}`] : []),
    ...(normalizedObjectName && knownSceneObjects.has(normalizedObjectName.toLowerCase()) ? [`SceneObject:${normalizedObjectName}`] : []),
    ...intendedComponents.map((component) => `Component:${component}`),
  ];
  const predictedCreatedObjects = normalizedObjectName ? [normalizedObjectName] : [];
  const reviewApproved = hasCompletedReview(input.review_state);
  const operatorApproved = hasApproval(input.review_state);

  const blockedReasons = [
    ...(reviewApproved ? [] : ["Unity mutation execution preflight is blocked until review approval is recorded."]),
    ...(operatorApproved ? [] : ["Unity mutation execution preflight is blocked until operator approval is recorded."]),
    ...(authorizationEvaluation.authorized ? [] : [authorizationEvaluation.blocked_reason ?? "Unity mutation execution preflight requires a valid final execution authorization."]),
  ];

  const recommendedOperatorAction = blockedReasons.length > 0
    ? blockedReasons[0]
    : detectedConflicts.length > 0
      ? "PREFLIGHT SIMULATION completed. Resolve the detected conflicts, keep the request dry-run only, and do not authorize live mutation execution."
      : "PREFLIGHT SIMULATION completed. Keep the request dry-run only and hold the live mutation lane disabled until a future reviewed executor exists.";

  return {
    request_id: input.adapter_request_id,
    domain: "Unity",
    request_type: "scene_object_creation_request",
    execution_mode: "mutation_execution_preflight_simulation",
    execution_kind: blockedReasons.length > 0 ? "preflight_blocked" : "preflight_simulation",
    review_approval_id: input.review_state.review_package_id,
    review_approval_status: reviewApproved ? "approved" : "missing",
    operator_approval_id: input.review_state.operator_approval_id,
    operator_approval_status: operatorApproved ? "approved" : "missing",
    target_scene: normalizedTargetScene,
    requested_object_name: normalizedObjectName,
    intended_components: intendedComponents,
    intended_transform: input.intended_transform,
    authorization_evaluation: authorizationEvaluation,
    predicted_affected_objects: predictedAffectedObjects,
    predicted_created_objects: predictedCreatedObjects,
    detected_conflicts: detectedConflicts,
    detected_risks: detectedRisks,
    recommended_operator_action: recommendedOperatorAction,
    preflight_state: blockedReasons.length > 0 ? "blocked" : "simulation",
    dry_run: true,
    executed: false,
    artifact_label: "unity_mutation_execution_preflight",
    review_package: null,
    delivery_package: null,
    mutating: false,
  };
}

function createUnityMutationExecutionPreflightPackages(
  input: UnityMutationExecutionPreflightInput,
  result: UnityMutationExecutionPreflightResult,
): {
  reviewPackage: AutonomousReviewPackage;
  deliveryPackage: AutonomousDeliveryPackage;
} {
  const packageSuffix = input.adapter_request_id;
  const summary = `PREFLIGHT SIMULATION: Unity scene object creation request for ${result.requested_object_name || "unnamed_object"} in ${result.target_scene || "unknown_scene"}. NO UNITY MUTATION PERFORMED.`;
  const proofResults = [
    `Execution kind: ${result.execution_kind}`,
    `Preflight state: ${result.preflight_state}`,
    `Requested object name: ${result.requested_object_name || "none"}`,
    `Target scene: ${result.target_scene || "none"}`,
    `Intended components: ${result.intended_components.length > 0 ? result.intended_components.join(", ") : "none"}`,
    `Intended transform position: ${formatVector3(result.intended_transform.position)}`,
    `Intended transform rotation: ${formatVector3(result.intended_transform.rotation_euler)}`,
    `Intended transform scale: ${formatVector3(result.intended_transform.scale)}`,
    `Authorization evaluation status: ${formatAuthorizationEvaluationStatus(result.authorization_evaluation)}`,
    `Final execution authorization id: ${result.authorization_evaluation.final_execution_authorization_id ?? "none"}`,
    `Authorization scope match: ${String(result.authorization_evaluation.scope_match)}`,
    `Authorization target request match: ${String(result.authorization_evaluation.target_request_match)}`,
    `Authorization expiration status: ${result.authorization_evaluation.expiration_status}`,
    `Dry run: ${String(result.dry_run)}`,
    `Executed: ${String(result.executed)}`,
    ...result.predicted_affected_objects.map((item) => `Predicted affected object: ${item}`),
    ...result.predicted_created_objects.map((item) => `Predicted created object: ${item}`),
    ...result.detected_conflicts.map((item) => `Detected conflict: ${item}`),
    ...result.detected_risks.map((item) => `Detected risk: ${item}`),
    `Recommended next operator action: ${result.recommended_operator_action}`,
    ...(result.authorization_evaluation.blocked_reason ? [`Blocked reason: ${result.authorization_evaluation.blocked_reason}`] : []),
  ];

  const reviewPackage = createAutonomousReviewPackage({
    package_id: `unity-mutation-preflight-review-${packageSuffix}`,
    work_item_id: `unity-mutation-preflight-${packageSuffix}`,
    chain_id: `unity-mutation-preflight-chain-${packageSuffix}`,
    status: result.preflight_state === "simulation" ? "approved" : "pending",
    summary,
    files_changed: [],
    tests_run: ["unity mutation execution preflight simulation"],
    proof_results: proofResults,
    risks: [
      "PREFLIGHT SIMULATION",
      "NO UNITY MUTATION PERFORMED",
      ...(result.detected_risks.length > 0 ? result.detected_risks : ["No additional preflight risks detected."]),
    ],
    recommended_decision: "approve",
    rollback_notes: "Simulation only; no Unity mutation occurred and no rollback is required.",
    operator_actions: ["approve", "archive"],
  });

  const deliveryPackage = createAutonomousDeliveryPackage({
    delivery_package_id: `unity-mutation-preflight-delivery-${packageSuffix}`,
    review_package_id: reviewPackage.package_id,
    work_item_id: reviewPackage.work_item_id,
    chain_id: reviewPackage.chain_id,
    branch_name: "",
    commit_plan: [
      "Keep this Unity mutation execution preflight attached to the reviewed delivery lane.",
      "PREFLIGHT SIMULATION only: do not write scenes, prefabs, assets, or GameObjects.",
      "Do not enable a live mutation executor from this package.",
    ],
    files_changed: [],
    validation_results: proofResults,
    proof_results: [result.execution_kind, "PREFLIGHT SIMULATION", "NO UNITY MUTATION PERFORMED"],
    risk_summary: result.detected_risks.length > 0
      ? result.detected_risks.join(" | ")
      : "PREFLIGHT SIMULATION only. No Unity mutation performed.",
    rollback_plan: "Discard the preflight simulation package if it is no longer needed.",
    release_notes: summary,
    recommended_pr_title: "",
    recommended_pr_body: `Unity mutation execution preflight handoff\n\nSummary: ${summary}\n\nNext operator action: ${result.recommended_operator_action}`,
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

function buildUnitySceneObjectCreationExecutionPlanResult(
  input: UnitySceneObjectCreationExecutionPlanInput,
  authorizationEvaluation: UnityMutationExecutionAuthorizationEvaluation,
): UnitySceneObjectCreationExecutionPlanResult {
  const reviewApproved = hasCompletedReview(input.review_state);
  const operatorApproved = hasApproval(input.review_state);
  const targetScene = input.target_scene.trim();
  const requestedObjectName = input.requested_object_name.trim();
  const intendedComponents = normalizePreviewComponents(input.intended_components);
  const dryRunPreviewStatus = evaluateExecutionPlanDryRunPreviewStatus(input.preview_result, input.adapter_request_id);
  const preflightStatus = evaluateExecutionPlanPreflightStatus(input.preflight_result, input.adapter_request_id);
  const liveValidationStatus = evaluateExecutionPlanLiveValidationStatus(input.live_validation_result, targetScene);
  const explicitMutationExecutionModeStatus = input.mutation_execution_mode_enabled ? "enabled" : "disabled";
  const liveValidationSummary = input.live_validation_result
    ? `Scene ${input.live_validation_result.checked_scene_name ?? "unknown"} reported ${input.live_validation_result.scene_validation_status} with missing scripts ${input.live_validation_result.missing_script_count ?? "unknown"}, console errors ${input.live_validation_result.console_error_count ?? "unknown"}, and object count ${input.live_validation_result.object_count ?? "unknown"}.`
    : "Live read-only validation has not been provided for this execution plan.";

  const gateStatuses: UnityMutationExecutionPlanGateEvaluation[] = [
    {
      gate: "review_approval",
      status: reviewApproved ? "approved" : "missing",
      detail: reviewApproved
        ? "Review approval gate is recorded for this Unity mutation request."
        : "Unity mutation execution plan is blocked until review approval is recorded.",
    },
    {
      gate: "operator_approval",
      status: operatorApproved ? "approved" : "missing",
      detail: operatorApproved
        ? "Operator approval gate is recorded for this Unity mutation request."
        : "Unity mutation execution plan is blocked until operator approval is recorded.",
    },
    {
      gate: "dry_run_preview",
      status: dryRunPreviewStatus.status === "valid" ? "approved" : dryRunPreviewStatus.status,
      detail: dryRunPreviewStatus.detail,
    },
    {
      gate: "preflight_simulation",
      status: preflightStatus.status === "valid" ? "approved" : preflightStatus.status,
      detail: preflightStatus.detail,
    },
    {
      gate: "final_execution_authorization",
      status: authorizationEvaluation.authorized ? "approved" : input.authorization ? "invalid" : "missing",
      detail: authorizationEvaluation.authorized
        ? "Final execution authorization gate is present and valid for this Unity mutation request."
        : authorizationEvaluation.blocked_reason ?? "Final execution authorization gate is missing for this Unity mutation request.",
    },
    {
      gate: "live_read_only_validation",
      status: liveValidationStatus.status === "valid" ? "approved" : liveValidationStatus.status,
      detail: liveValidationStatus.detail,
    },
    {
      gate: "explicit_mutation_execution_mode",
      status: input.mutation_execution_mode_enabled ? "approved" : "disabled",
      detail: input.mutation_execution_mode_enabled
        ? "Explicit mutation execution mode gate is marked enabled, but this layer still returns plan-only output."
        : "Explicit mutation execution mode gate remains disabled, so the plan cannot be used for live mutation execution.",
    },
  ];

  const blockedReasons = gateStatuses
    .filter((gate) => gate.status !== "approved")
    .map((gate) => gate.detail);

  return {
    request_id: input.adapter_request_id,
    domain: "Unity",
    request_type: "scene_object_creation_request",
    execution_mode: "disabled_plan_only",
    execution_kind: blockedReasons.length > 0 ? "execution_plan_blocked" : "execution_plan_only",
    review_approval_id: input.review_state.review_package_id,
    review_approval_status: reviewApproved ? "approved" : "missing",
    operator_approval_id: input.review_state.operator_approval_id,
    operator_approval_status: operatorApproved ? "approved" : "missing",
    target_scene: targetScene,
    requested_object_name: requestedObjectName,
    intended_components: intendedComponents,
    intended_transform: input.intended_transform,
    required_gates: [
      "review_approval",
      "operator_approval",
      "dry_run_preview",
      "preflight_simulation",
      "final_execution_authorization",
      "live_read_only_validation",
      "explicit_mutation_execution_mode",
    ],
    gate_statuses: gateStatuses,
    dry_run_preview_status: dryRunPreviewStatus.status,
    preflight_status: preflightStatus.status,
    authorization_evaluation: authorizationEvaluation,
    live_validation_status: liveValidationStatus.status,
    live_validation_summary: liveValidationSummary,
    explicit_mutation_execution_mode_status: explicitMutationExecutionModeStatus,
    blocked_reason: blockedReasons[0] ?? null,
    recommended_next_operator_action: blockedReasons.length > 0
      ? blockedReasons[0]
      : "EXECUTION PLAN ONLY. Keep mutation disabled and do not execute this plan until a later reviewed Unity mutation step explicitly enables execution.",
    mutation_enabled: false,
    executed: false,
    artifact_label: "unity_mutation_execution_plan",
    review_package: null,
    delivery_package: null,
    mutating: false,
  };
}

function createUnitySceneObjectCreationExecutionPlanPackages(
  input: UnitySceneObjectCreationExecutionPlanInput,
  result: UnitySceneObjectCreationExecutionPlanResult,
): {
  reviewPackage: AutonomousReviewPackage;
  deliveryPackage: AutonomousDeliveryPackage;
} {
  const packageSuffix = input.adapter_request_id;
  const summary = `EXECUTION PLAN ONLY: Controlled Unity scene object creation plan for ${result.requested_object_name || "unnamed_object"} in ${result.target_scene || "unknown_scene"}. MUTATION DISABLED. NOT EXECUTED.`;
  const proofResults = [
    `Execution kind: ${result.execution_kind}`,
    `Execution mode: ${result.execution_mode}`,
    `Requested object name: ${result.requested_object_name || "none"}`,
    `Target scene: ${result.target_scene || "none"}`,
    `Intended components: ${result.intended_components.length > 0 ? result.intended_components.join(", ") : "none"}`,
    `Intended transform position: ${formatVector3(result.intended_transform.position)}`,
    `Intended transform rotation: ${formatVector3(result.intended_transform.rotation_euler)}`,
    `Intended transform scale: ${formatVector3(result.intended_transform.scale)}`,
    `Dry-run preview status: ${result.dry_run_preview_status}`,
    `Preflight status: ${result.preflight_status}`,
    `Authorization evaluation status: ${formatAuthorizationEvaluationStatus(result.authorization_evaluation)}`,
    `Live validation status: ${result.live_validation_status}`,
    `Live validation summary: ${result.live_validation_summary}`,
    `Explicit mutation execution mode status: ${result.explicit_mutation_execution_mode_status}`,
    `Mutation enabled: ${String(result.mutation_enabled)}`,
    `Executed: ${String(result.executed)}`,
    ...result.required_gates.map((gate) => `Required gate: ${gate}`),
    ...result.gate_statuses.map((gate) => `Gate status: ${gate.gate}=${gate.status} (${gate.detail})`),
    `Recommended next operator action: ${result.recommended_next_operator_action}`,
    ...(result.blocked_reason ? [`Blocked reason: ${result.blocked_reason}`] : []),
  ];

  const reviewPackage = createAutonomousReviewPackage({
    package_id: `unity-mutation-execution-plan-review-${packageSuffix}`,
    work_item_id: `unity-mutation-execution-plan-${packageSuffix}`,
    chain_id: `unity-mutation-execution-plan-chain-${packageSuffix}`,
    status: result.execution_kind === "execution_plan_only" ? "approved" : "pending",
    summary,
    files_changed: [],
    tests_run: ["unity mutation execution plan gate stack"],
    proof_results: proofResults,
    risks: [
      "EXECUTION PLAN ONLY",
      "MUTATION DISABLED",
      "NOT EXECUTED",
      ...result.gate_statuses.filter((gate) => gate.status !== "approved").map((gate) => gate.detail),
      "No Unity mutation has been performed.",
    ],
    recommended_decision: "approve",
    rollback_notes: "Plan only; no Unity mutation occurred and no rollback is required.",
    operator_actions: ["approve", "archive"],
  });

  const deliveryPackage = createAutonomousDeliveryPackage({
    delivery_package_id: `unity-mutation-execution-plan-delivery-${packageSuffix}`,
    review_package_id: reviewPackage.package_id,
    work_item_id: reviewPackage.work_item_id,
    chain_id: reviewPackage.chain_id,
    branch_name: "",
    commit_plan: [
      "Keep this Unity mutation execution plan attached to the reviewed delivery lane.",
      "EXECUTION PLAN ONLY: do not write scenes, create GameObjects, spawn prefabs, or import assets from this package.",
      "Do not enable a live Unity mutation executor from this package.",
    ],
    files_changed: [],
    validation_results: proofResults,
    proof_results: [result.execution_kind, "EXECUTION PLAN ONLY", "MUTATION DISABLED", "NOT EXECUTED"],
    risk_summary: "Execution plan only. Mutation remains disabled and no Unity mutation has been performed.",
    rollback_plan: "Discard the execution plan package if it is no longer needed.",
    release_notes: summary,
    recommended_pr_title: "",
    recommended_pr_body: `Unity mutation execution plan handoff\n\nSummary: ${summary}\n\nNext operator action: ${result.recommended_next_operator_action}`,
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

export function simulateUnityMutationExecutionPreflight(
  input: UnityMutationExecutionPreflightInput,
): UnityMutationExecutionPreflightResult {
  const authorizationEvaluation = evaluateUnityMutationExecutionAuthorization({
    preview_result: {
      request_id: input.adapter_request_id,
      request_type: "scene_object_creation_request",
      final_execution_required: true,
      final_execution_authorized: false,
      executed: false,
    },
    authorization: input.authorization,
    evaluated_at: input.evaluated_at ?? input.requested_at,
  });

  const baseResult = buildUnityMutationExecutionPreflightResult(input, authorizationEvaluation);
  const preflightPackages = createUnityMutationExecutionPreflightPackages(input, baseResult);

  return {
    ...baseResult,
    review_package: preflightPackages.reviewPackage,
    delivery_package: preflightPackages.deliveryPackage,
  };
}

export function buildUnitySceneObjectCreationExecutionPlan(
  input: UnitySceneObjectCreationExecutionPlanInput,
): UnitySceneObjectCreationExecutionPlanResult {
  const authorizationEvaluation = evaluateUnityMutationExecutionAuthorization({
    preview_result: input.preview_result ?? {
      request_id: input.adapter_request_id,
      request_type: "scene_object_creation_request",
      final_execution_required: true,
      final_execution_authorized: false,
      executed: false,
    },
    authorization: input.authorization,
    evaluated_at: input.evaluated_at ?? input.requested_at,
  });

  const baseResult = buildUnitySceneObjectCreationExecutionPlanResult(input, authorizationEvaluation);
  const executionPlanPackages = createUnitySceneObjectCreationExecutionPlanPackages(input, baseResult);

  return {
    ...baseResult,
    review_package: executionPlanPackages.reviewPackage,
    delivery_package: executionPlanPackages.deliveryPackage,
  };
}