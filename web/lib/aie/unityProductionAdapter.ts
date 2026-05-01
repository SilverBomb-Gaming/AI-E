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
import {
  createConfiguredUnityMutationRuntimeBridge,
  type UnityMutationRuntimeBridge,
} from "./unityMutationRuntimeBridge";

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

export type UnitySceneObjectCreationMutationExecutionOptions = {
  mutation_bridge?: UnityMutationRuntimeBridge;
};

export type UnitySceneObjectCreationRollbackExecutionOptions = {
  mutation_bridge?: UnityMutationRuntimeBridge;
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

export type UnityRollbackExecutionAuthorization = {
  final_rollback_authorization_id: string;
  authorized_by_operator: boolean;
  authorized_at: string;
  authorization_scope: "scene_object_removal";
  target_request_id: string;
  target_scene: string;
  target_object_name: string;
  expires_at: string | null;
};

export type UnityMutationExecutionSwitch = {
  mutation_switch_id: string;
  switch_enabled: boolean;
  enabled_by_operator: boolean;
  enabled_at: string;
  target_request_id: string;
  allowed_mutation_type: "scene_object_creation_request";
  expires_at: string | null;
};

export type UnityRollbackExecutionSwitch = {
  rollback_switch_id: string;
  switch_enabled: boolean;
  enabled_by_operator: boolean;
  enabled_at: string;
  target_request_id: string;
  target_scene: string;
  target_object_name: string;
  allowed_rollback_type: "scene_object_removal";
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

export type UnityRollbackExecutionAuthorizationEvaluation = {
  authorized: boolean;
  blocked_reason: string | null;
  request_id: string;
  scope_match: boolean;
  target_request_match: boolean;
  target_scene_match: boolean;
  target_object_match: boolean;
  expiration_status: "valid" | "expired" | "not_provided";
  final_rollback_authorization_id: string | null;
};

export type UnityMutationExecutionSwitchEvaluation = {
  enabled: boolean;
  blocked_reason: string | null;
  request_id: string;
  switch_target_request_match: boolean;
  allowed_mutation_type_match: boolean;
  switch_expiration_status: "valid" | "expired" | "not_provided";
  mutation_switch_id: string | null;
};

export type UnityRollbackExecutionSwitchEvaluation = {
  enabled: boolean;
  blocked_reason: string | null;
  request_id: string;
  switch_target_request_match: boolean;
  target_scene_match: boolean;
  target_object_match: boolean;
  allowed_rollback_type_match: boolean;
  switch_expiration_status: "valid" | "expired" | "not_provided";
  rollback_switch_id: string | null;
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
  | "explicit_mutation_execution_mode"
  | "final_mutation_switch";

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
  mutation_switch: UnityMutationExecutionSwitch | null;
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
  final_mutation_switch_required: true;
  final_mutation_switch_enabled: false;
  mutation_switch_evaluation: UnityMutationExecutionSwitchEvaluation;
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

export type UnitySceneObjectCreationMutationExecutionInput = UnitySceneObjectCreationExecutionPlanInput & {
  execution_plan: UnitySceneObjectCreationExecutionPlanResult | null;
  idempotent_on_duplicate?: boolean;
};

export type UnitySceneObjectCreationMutationExecutionResult = {
  request_id: string;
  domain: "Unity";
  request_type: "scene_object_creation_request";
  mutation_type: "scene_object_creation_request";
  execution_mode: "controlled_mutation_runtime_bridge";
  execution_kind:
    | "controlled_mutation_executed"
    | "controlled_mutation_idempotent"
    | "controlled_mutation_blocked"
    | "controlled_mutation_failed"
    | "controlled_mutation_unavailable";
  review_approval_id: string | null;
  review_approval_status: "missing" | "approved";
  operator_approval_id: string | null;
  operator_approval_status: "missing" | "approved";
  target_scene: string;
  requested_object_name: string;
  created_object_name: string | null;
  duplicate_handling: "created" | "already_exists_idempotent" | null;
  mutation_enabled: boolean;
  executed: boolean;
  scene_saved: boolean;
  final_mutation_switch_required: true;
  final_mutation_switch_enabled: boolean;
  evidence_timestamp: string;
  rollback_hint: string;
  delivery_summary: string;
  blocked_reason: string | null;
  artifact_label: "unity_controlled_scene_mutation_result";
  review_package: AutonomousReviewPackage | null;
  delivery_package: AutonomousDeliveryPackage | null;
  mutating: boolean;
};

export type UnityRollbackExecutionPlanGate =
  | "review_approval"
  | "operator_approval"
  | "controlled_target"
  | "final_rollback_authorization"
  | "live_read_only_validation"
  | "explicit_rollback_execution_mode"
  | "final_rollback_switch";

export type UnityRollbackExecutionPlanGateStatus = "approved" | "missing" | "invalid" | "disabled";

export type UnityRollbackExecutionPlanGateEvaluation = {
  gate: UnityRollbackExecutionPlanGate;
  status: UnityRollbackExecutionPlanGateStatus;
  detail: string;
};

export type UnitySceneObjectCreationRollbackExecutionPlanInput = UnityProductionAdapterInput & {
  target_scene: string;
  target_object_name: string;
  authorization: UnityRollbackExecutionAuthorization | null;
  rollback_switch: UnityRollbackExecutionSwitch | null;
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
  rollback_execution_mode_enabled: boolean;
  evaluated_at?: string;
};

export type UnitySceneObjectCreationRollbackExecutionPlanResult = {
  rollback_request_id: string;
  domain: "Unity";
  request_type: "scene_object_creation_request";
  rollback_type: "scene_object_removal";
  execution_mode: "disabled_rollback_plan_only";
  execution_kind: "rollback_plan_only" | "rollback_plan_blocked";
  review_approval_id: string | null;
  review_approval_status: "missing" | "approved";
  operator_approval_id: string | null;
  operator_approval_status: "missing" | "approved";
  target_scene: string;
  target_object_name: string;
  required_gates: UnityRollbackExecutionPlanGate[];
  gate_statuses: UnityRollbackExecutionPlanGateEvaluation[];
  authorization_evaluation: UnityRollbackExecutionAuthorizationEvaluation;
  final_rollback_switch_required: true;
  final_rollback_switch_enabled: false;
  rollback_switch_evaluation: UnityRollbackExecutionSwitchEvaluation;
  live_validation_status: "valid" | "missing" | "invalid";
  live_validation_summary: string;
  explicit_rollback_execution_mode_status: "enabled" | "disabled";
  rollback_enabled: false;
  executed: false;
  removed_object_name: null;
  scene_saved: false;
  evidence_timestamp: string;
  blocked_reason: string | null;
  recommended_next_operator_action: string;
  artifact_label: "unity_controlled_scene_rollback_plan";
  review_package: AutonomousReviewPackage | null;
  delivery_package: AutonomousDeliveryPackage | null;
  mutating: false;
};

export type UnitySceneObjectCreationRollbackExecutionInput = UnitySceneObjectCreationRollbackExecutionPlanInput & {
  execution_plan: UnitySceneObjectCreationRollbackExecutionPlanResult | null;
  idempotent_on_missing?: boolean;
};

export type UnitySceneObjectCreationRollbackExecutionResult = {
  rollback_request_id: string;
  domain: "Unity";
  request_type: "scene_object_creation_request";
  rollback_type: "scene_object_removal";
  execution_mode: "controlled_rollback_runtime_bridge";
  execution_kind:
    | "controlled_rollback_executed"
    | "controlled_rollback_idempotent"
    | "controlled_rollback_blocked"
    | "controlled_rollback_failed"
    | "controlled_rollback_unavailable";
  review_approval_id: string | null;
  review_approval_status: "missing" | "approved";
  operator_approval_id: string | null;
  operator_approval_status: "missing" | "approved";
  target_scene: string;
  target_object_name: string;
  removed_object_name: string | null;
  rollback_enabled: boolean;
  executed: boolean;
  scene_saved: boolean;
  target_missing_handling: "removed" | "already_missing_idempotent" | null;
  final_rollback_switch_required: true;
  final_rollback_switch_enabled: boolean;
  evidence_timestamp: string;
  delivery_summary: string;
  blocked_reason: string | null;
  artifact_label: "unity_controlled_scene_rollback_result";
  review_package: AutonomousReviewPackage | null;
  delivery_package: AutonomousDeliveryPackage | null;
  mutating: boolean;
};

export type UnityMutationExecutionChainActionType = "unity_scene_object_creation" | "unity_scene_object_rollback";

export type UnityMutationExecutionChainStatus = "chain_planned" | "chain_blocked";

export type UnityMutationExecutionChainActionStatus = "planned" | "blocked";

export type UnityMutationExecutionChainReadiness = "not_ready" | "partially_ready" | "ready_for_operator_execution";

export type UnityMutationExecutionChainReadinessGate =
  | "review_approval"
  | "operator_approval"
  | "dry_run_preview"
  | "preflight_simulation"
  | "final_execution_authorization"
  | "live_read_only_validation"
  | "execution_plan"
  | "final_mutation_switch";

export type UnityMutationExecutionChainReadinessGateStatus = "approved" | "missing" | "invalid" | "disabled" | "dependency_blocked" | "not_applicable";

export type UnityMutationExecutionChainAction = {
  action_id: string;
  action_type: UnityMutationExecutionChainActionType;
  target_scene: string;
  target_object_name: string;
  depends_on: string[];
  required_approvals: string[];
};

export type UnityMutationExecutionChainReadinessGateEvaluation = {
  gate: UnityMutationExecutionChainReadinessGate;
  status: UnityMutationExecutionChainReadinessGateStatus;
  detail: string;
};

export type UnityMutationExecutionChainReadinessActionInput =
  | (UnityMutationExecutionChainAction & {
      action_type: "unity_scene_object_creation";
      preview_result?: UnitySceneObjectCreationPreviewResult | null;
      preflight_result?: UnityMutationExecutionPreflightResult | null;
      authorization?: UnityMutationExecutionAuthorization | null;
      live_validation_result?: UnitySceneObjectCreationExecutionPlanInput["live_validation_result"];
      execution_plan?: UnitySceneObjectCreationExecutionPlanResult | null;
      mutation_switch?: UnityMutationExecutionSwitch | null;
      mutation_execution_mode_enabled?: boolean;
    })
  | (UnityMutationExecutionChainAction & {
      action_type: "unity_scene_object_rollback";
      authorization?: UnityRollbackExecutionAuthorization | null;
      live_validation_result?: UnitySceneObjectCreationRollbackExecutionPlanInput["live_validation_result"];
      execution_plan?: UnitySceneObjectCreationRollbackExecutionPlanResult | null;
      rollback_switch?: UnityRollbackExecutionSwitch | null;
      rollback_execution_mode_enabled?: boolean;
    });

export type UnityMutationExecutionChainInput = UnityProductionAdapterInput & {
  chain_id: string;
  actions: UnityMutationExecutionChainAction[];
};

export type UnityMutationExecutionChainReadinessInput = UnityProductionAdapterInput & {
  chain_id: string;
  actions: UnityMutationExecutionChainReadinessActionInput[];
};

export type UnityMutationExecutionChainDependencyNode = {
  action_id: string;
  depends_on: string[];
};

export type UnityMutationExecutionChainRollbackNode = {
  order: number;
  source_action_id: string;
  rollback_action_type: UnityMutationExecutionChainActionType;
  target_scene: string;
  target_object_name: string;
};

export type UnityMutationExecutionChainPlannedAction = UnityMutationExecutionChainAction & {
  order: number;
  status: UnityMutationExecutionChainActionStatus;
  lane_scope: "layer15_single_object_lane";
  blocked_reason: string | null;
  dry_run: true;
  executed: false;
};

export type UnityMutationExecutionChainReadinessActionResult = UnityMutationExecutionChainPlannedAction & {
  gate_statuses: UnityMutationExecutionChainReadinessGateEvaluation[];
  missing_gates: UnityMutationExecutionChainReadinessGate[];
  ready_for_operator_execution: boolean;
  dependency_blockers: string[];
  readiness: UnityMutationExecutionChainReadiness;
};

export type UnityMutationExecutionChainPlanResult = {
  chain_id: string;
  chain_status: UnityMutationExecutionChainStatus;
  domain: "Unity";
  request_type: "scene_object_creation_request";
  execution_mode: "multi_action_chain_plan_only";
  execution_kind: "chain_plan_only" | "chain_plan_blocked";
  review_approval_id: string | null;
  review_approval_status: "missing" | "approved";
  operator_approval_id: string | null;
  operator_approval_status: "missing" | "approved";
  ordered_actions: UnityMutationExecutionChainPlannedAction[];
  action_dependencies: UnityMutationExecutionChainDependencyNode[];
  rollback_plan: UnityMutationExecutionChainRollbackNode[];
  rollback_order: string[];
  required_approvals: string[];
  total_actions: number;
  executable_actions: string[];
  blocked_actions: string[];
  dependency_graph: string[];
  rollback_graph: string[];
  chain_ready: false;
  dry_run: true;
  executed: false;
  blocked_reason: string | null;
  recommended_next_operator_action: string;
  artifact_label: "unity_mutation_execution_chain_plan";
  review_package: AutonomousReviewPackage | null;
  delivery_package: AutonomousDeliveryPackage | null;
  mutating: false;
};

export type UnityMutationExecutionChainReadinessResult = {
  chain_id: string;
  chain_status: UnityMutationExecutionChainStatus;
  chain_readiness: UnityMutationExecutionChainReadiness;
  domain: "Unity";
  request_type: "scene_object_creation_request";
  execution_mode: "multi_action_chain_readiness_only";
  execution_kind: "chain_readiness_only" | "chain_readiness_blocked";
  review_approval_id: string | null;
  review_approval_status: "missing" | "approved";
  operator_approval_id: string | null;
  operator_approval_status: "missing" | "approved";
  ordered_actions: UnityMutationExecutionChainReadinessActionResult[];
  action_dependencies: UnityMutationExecutionChainDependencyNode[];
  rollback_plan: UnityMutationExecutionChainRollbackNode[];
  rollback_order: string[];
  required_approvals: string[];
  total_actions: number;
  ready_actions: string[];
  blocked_actions: string[];
  dependency_blocked_actions: string[];
  executable_actions: string[];
  missing_gates: string[];
  dependency_graph: string[];
  rollback_graph: string[];
  chain_ready: boolean;
  dry_run: true;
  executed: false;
  blocked_reason: string | null;
  recommended_next_operator_action: string;
  artifact_label: "unity_mutation_execution_chain_readiness";
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

const CONTROLLED_MUTATION_TARGET_SCENE = "EnemyAIDemo";
const CONTROLLED_MUTATION_TARGET_OBJECT_NAME = "AIE_ControlledMutationProbe";

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

function formatMutationSwitchEvaluationStatus(
  evaluation: UnityMutationExecutionSwitchEvaluation,
): string {
  return evaluation.enabled ? "FINAL MUTATION SWITCH ENABLED" : "FINAL MUTATION SWITCH DISABLED";
}

function formatRollbackAuthorizationEvaluationStatus(
  evaluation: UnityRollbackExecutionAuthorizationEvaluation,
): string {
  return evaluation.authorized ? "FINAL ROLLBACK AUTHORIZATION VALID" : "FINAL ROLLBACK AUTHORIZATION INVALID";
}

function formatRollbackSwitchEvaluationStatus(
  evaluation: UnityRollbackExecutionSwitchEvaluation,
): string {
  return evaluation.enabled ? "FINAL ROLLBACK SWITCH ENABLED" : "FINAL ROLLBACK SWITCH DISABLED";
}

function hasAllRequiredMutationPlanGatesApproved(
  plan: UnitySceneObjectCreationExecutionPlanResult,
): boolean {
  const requiredGates: UnityMutationExecutionPlanGate[] = [
    "review_approval",
    "operator_approval",
    "dry_run_preview",
    "preflight_simulation",
    "final_execution_authorization",
    "live_read_only_validation",
    "explicit_mutation_execution_mode",
    "final_mutation_switch",
  ];

  return requiredGates.every((gate) => plan.gate_statuses.some((entry) => entry.gate === gate && entry.status === "approved"));
}

function hasAllRequiredRollbackPlanGatesApproved(
  plan: UnitySceneObjectCreationRollbackExecutionPlanResult,
): boolean {
  const requiredGates: UnityRollbackExecutionPlanGate[] = [
    "review_approval",
    "operator_approval",
    "controlled_target",
    "final_rollback_authorization",
    "live_read_only_validation",
    "explicit_rollback_execution_mode",
    "final_rollback_switch",
  ];

  return requiredGates.every((gate) => plan.gate_statuses.some((entry) => entry.gate === gate && entry.status === "approved"));
}

function evaluateControlledRollbackTarget(
  targetScene: string,
  targetObjectName: string,
): { status: "approved" | "invalid"; detail: string; } {
  if (targetScene !== CONTROLLED_MUTATION_TARGET_SCENE) {
    return {
      status: "invalid",
      detail: `Controlled Unity rollback is limited to ${CONTROLLED_MUTATION_TARGET_SCENE}, but received ${targetScene}.`,
    };
  }

  if (targetObjectName !== CONTROLLED_MUTATION_TARGET_OBJECT_NAME) {
    return {
      status: "invalid",
      detail: `Controlled Unity rollback is limited to ${CONTROLLED_MUTATION_TARGET_OBJECT_NAME}, but received ${targetObjectName}.`,
    };
  }

  return {
    status: "approved",
    detail: `Controlled Unity rollback target is limited correctly to ${CONTROLLED_MUTATION_TARGET_OBJECT_NAME} in ${CONTROLLED_MUTATION_TARGET_SCENE}.`,
  };
}

function getChainActionRequiredApprovals(actionType: UnityMutationExecutionChainActionType): string[] {
  return actionType === "unity_scene_object_creation"
    ? [
        "review package approval",
        "operator approval",
        "explicit final execute gate",
        "final mutation switch enablement",
      ]
    : [
        "separate rollback review approval",
        "separate rollback operator approval",
        "explicit final rollback authorization",
        "explicit rollback switch enablement",
      ];
}

function getChainRollbackActionType(actionType: UnityMutationExecutionChainActionType): UnityMutationExecutionChainActionType {
  return actionType === "unity_scene_object_creation"
    ? "unity_scene_object_rollback"
    : "unity_scene_object_creation";
}

function resolveUnityMutationExecutionChainPlan(
  input: UnityMutationExecutionChainInput,
): {
  orderedActions: UnityMutationExecutionChainPlannedAction[];
  actionDependencies: UnityMutationExecutionChainDependencyNode[];
  rollbackPlan: UnityMutationExecutionChainRollbackNode[];
  requiredApprovals: string[];
  dependencyGraph: string[];
  rollbackGraph: string[];
  executableActions: string[];
  blockedActions: string[];
  blockedReason: string | null;
} {
  const reviewApproved = hasCompletedReview(input.review_state);
  const operatorApproved = hasApproval(input.review_state);

  if (!isSceneObjectCreationOnlyPacket(input.planning_packet)) {
    return {
      orderedActions: [],
      actionDependencies: [],
      rollbackPlan: [],
      requiredApprovals: [],
      dependencyGraph: [],
      rollbackGraph: [],
      executableActions: [],
      blockedActions: [],
      blockedReason: "Only scene_object_creation_request planning packets can produce a Unity mutation execution chain plan.",
    };
  }

  if (!Array.isArray(input.actions) || input.actions.length === 0) {
    return {
      orderedActions: [],
      actionDependencies: [],
      rollbackPlan: [],
      requiredApprovals: [],
      dependencyGraph: [],
      rollbackGraph: [],
      executableActions: [],
      blockedActions: [],
      blockedReason: "Unity mutation execution chain planning requires at least one supported action.",
    };
  }

  const seenActionIds = new Set<string>();
  const actionMap = new Map<string, UnityMutationExecutionChainAction>();
  for (const action of input.actions) {
    const actionId = action.action_id.trim();
    if (!actionId) {
      return {
        orderedActions: [],
        actionDependencies: [],
        rollbackPlan: [],
        requiredApprovals: [],
        dependencyGraph: [],
        rollbackGraph: [],
        executableActions: [],
        blockedActions: [],
        blockedReason: "Unity mutation execution chain actions require a non-empty action_id.",
      };
    }

    if (seenActionIds.has(actionId)) {
      return {
        orderedActions: [],
        actionDependencies: [],
        rollbackPlan: [],
        requiredApprovals: [],
        dependencyGraph: [],
        rollbackGraph: [],
        executableActions: [],
        blockedActions: [],
        blockedReason: `Unity mutation execution chain action ids must be unique, but ${actionId} was repeated.`,
      };
    }

    seenActionIds.add(actionId);
    actionMap.set(actionId, {
      ...action,
      action_id: actionId,
      target_scene: action.target_scene.trim(),
      target_object_name: action.target_object_name.trim(),
      depends_on: [...new Set(action.depends_on.map((value) => value.trim()).filter(Boolean))],
      required_approvals: [...new Set(action.required_approvals.map((value) => value.trim()).filter(Boolean))],
    });
  }

  for (const action of actionMap.values()) {
    if (action.action_type !== "unity_scene_object_creation" && action.action_type !== "unity_scene_object_rollback") {
      return {
        orderedActions: [],
        actionDependencies: [],
        rollbackPlan: [],
        requiredApprovals: [],
        dependencyGraph: [],
        rollbackGraph: [],
        executableActions: [],
        blockedActions: [],
        blockedReason: `Unity mutation execution chain action ${action.action_id} uses unsupported action type ${action.action_type}.`,
      };
    }

    if (action.target_scene !== CONTROLLED_MUTATION_TARGET_SCENE || action.target_object_name !== CONTROLLED_MUTATION_TARGET_OBJECT_NAME) {
      return {
        orderedActions: [],
        actionDependencies: [],
        rollbackPlan: [],
        requiredApprovals: [],
        dependencyGraph: [],
        rollbackGraph: [],
        executableActions: [],
        blockedActions: [],
        blockedReason: `Unity mutation execution chain action ${action.action_id} does not map to the verified Layer 15 lane ${CONTROLLED_MUTATION_TARGET_OBJECT_NAME} in ${CONTROLLED_MUTATION_TARGET_SCENE}.`,
      };
    }

    for (const dependencyId of action.depends_on) {
      if (dependencyId === action.action_id) {
        return {
          orderedActions: [],
          actionDependencies: [],
          rollbackPlan: [],
          requiredApprovals: [],
          dependencyGraph: [],
          rollbackGraph: [],
          executableActions: [],
          blockedActions: [],
          blockedReason: `Unity mutation execution chain action ${action.action_id} cannot depend on itself.`,
        };
      }

      if (!actionMap.has(dependencyId)) {
        return {
          orderedActions: [],
          actionDependencies: [],
          rollbackPlan: [],
          requiredApprovals: [],
          dependencyGraph: [],
          rollbackGraph: [],
          executableActions: [],
          blockedActions: [],
          blockedReason: `Unity mutation execution chain action ${action.action_id} depends on missing action ${dependencyId}.`,
        };
      }
    }
  }

  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const action of actionMap.values()) {
    adjacency.set(action.action_id, []);
    indegree.set(action.action_id, 0);
  }
  for (const action of actionMap.values()) {
    for (const dependencyId of action.depends_on) {
      adjacency.get(dependencyId)?.push(action.action_id);
      indegree.set(action.action_id, (indegree.get(action.action_id) ?? 0) + 1);
    }
  }

  const sourceQueue = input.actions
    .map((action) => action.action_id.trim())
    .filter((actionId) => (indegree.get(actionId) ?? 0) === 0);
  const orderedActionIds: string[] = [];
  while (sourceQueue.length > 0) {
    const current = sourceQueue.shift();
    if (!current) {
      break;
    }

    orderedActionIds.push(current);
    for (const dependentId of adjacency.get(current) ?? []) {
      indegree.set(dependentId, (indegree.get(dependentId) ?? 1) - 1);
      if ((indegree.get(dependentId) ?? 0) === 0) {
        sourceQueue.push(dependentId);
      }
    }
  }

  if (orderedActionIds.length !== actionMap.size) {
    return {
      orderedActions: [],
      actionDependencies: [],
      rollbackPlan: [],
      requiredApprovals: [],
      dependencyGraph: [],
      rollbackGraph: [],
      executableActions: [],
      blockedActions: [],
      blockedReason: "Unity mutation execution chain planning refused a cyclic dependency graph.",
    };
  }

  const orderedActions = orderedActionIds.map((actionId, index) => {
    const action = actionMap.get(actionId)!;
    const requiredApprovals = [...new Set([...getChainActionRequiredApprovals(action.action_type), ...action.required_approvals])];
    const approvalBlocked = (!reviewApproved || !operatorApproved)
      ? "Unity mutation execution chain planning still requires review approval and operator approval before future execution review."
      : null;

    return {
      ...action,
      order: index + 1,
      required_approvals: requiredApprovals,
      status: approvalBlocked ? "blocked" : "planned",
      lane_scope: "layer15_single_object_lane" as const,
      blocked_reason: approvalBlocked,
      dry_run: true as const,
      executed: false as const,
    };
  });

  const actionDependencies = orderedActions.map((action) => ({
    action_id: action.action_id,
    depends_on: action.depends_on,
  }));
  const rollbackPlan = [...orderedActions]
    .reverse()
    .map((action, index) => ({
      order: index + 1,
      source_action_id: action.action_id,
      rollback_action_type: getChainRollbackActionType(action.action_type),
      target_scene: action.target_scene,
      target_object_name: action.target_object_name,
    }));

  const requiredApprovals = [...new Set(orderedActions.flatMap((action) => action.required_approvals))];
  const dependencyGraph = orderedActions.map((action) => `${action.action_id} <- ${action.depends_on.length > 0 ? action.depends_on.join(", ") : "none"}`);
  const rollbackGraph = rollbackPlan.map((entry) => `${entry.order}. ${entry.source_action_id} => ${entry.rollback_action_type}`);
  const executableActions = orderedActions.filter((action) => action.status === "planned").map((action) => action.action_id);
  const blockedActions = orderedActions.filter((action) => action.status === "blocked").map((action) => action.action_id);

  return {
    orderedActions,
    actionDependencies,
    rollbackPlan,
    requiredApprovals,
    dependencyGraph,
    rollbackGraph,
    executableActions,
    blockedActions,
    blockedReason: blockedActions.length > 0
      ? "Unity mutation execution chains remain plan-only in Layer 16 and cannot execute from this foundation."
      : null,
  };
}

function createUnityMutationExecutionChainPackages(
  input: UnityMutationExecutionChainInput,
  result: UnityMutationExecutionChainPlanResult,
): {
  reviewPackage: AutonomousReviewPackage;
  deliveryPackage: AutonomousDeliveryPackage;
} {
  const summary = `CHAIN PLAN ONLY: Controlled Unity execution chain ${result.chain_id} with ${result.total_actions} actions. NOT EXECUTED.`;
  const proofResults = [
    `Execution kind: ${result.execution_kind}`,
    `Chain id: ${result.chain_id}`,
    `Chain status: ${result.chain_status}`,
    `Execution mode: ${result.execution_mode}`,
    `Total actions: ${String(result.total_actions)}`,
    `Executable actions: ${result.executable_actions.join(", ") || "none"}`,
    `Blocked actions: ${result.blocked_actions.join(", ") || "none"}`,
    `Chain ready: ${String(result.chain_ready)}`,
    `Dry run: ${String(result.dry_run)}`,
    `Executed: ${String(result.executed)}`,
    ...result.required_approvals.map((approval) => `Required approval gate: ${approval}`),
    ...result.dependency_graph.map((entry) => `Dependency graph: ${entry}`),
    ...result.rollback_graph.map((entry) => `Rollback graph: ${entry}`),
    `Recommended next operator action: ${result.recommended_next_operator_action}`,
    ...(result.blocked_reason ? [`Blocked reason: ${result.blocked_reason}`] : []),
  ];

  const reviewPackage = createAutonomousReviewPackage({
    package_id: `unity-chain-plan-review-${result.chain_id}`,
    work_item_id: `unity-chain-plan-${result.chain_id}`,
    chain_id: `unity-chain-plan-chain-${result.chain_id}`,
    status: result.execution_kind === "chain_plan_only" ? "approved" : "pending",
    summary,
    files_changed: [],
    tests_run: ["unity mutation execution chain plan"],
    proof_results: proofResults,
    risks: [
      "CHAIN PLAN ONLY",
      "NOT EXECUTED",
      "ROLLBACK ORDER PREVIEW",
      ...(result.blocked_reason ? [result.blocked_reason] : []),
    ],
    recommended_decision: "approve",
    rollback_notes: result.rollback_graph.length > 0
      ? `ROLLBACK ORDER PREVIEW: ${result.rollback_graph.join(" | ")}`
      : "No rollback order preview is available for this chain.",
    operator_actions: ["approve", "archive"],
  });

  const deliveryPackage = createAutonomousDeliveryPackage({
    delivery_package_id: `unity-chain-plan-delivery-${result.chain_id}`,
    review_package_id: reviewPackage.package_id,
    work_item_id: reviewPackage.work_item_id,
    chain_id: reviewPackage.chain_id,
    branch_name: "",
    commit_plan: [
      "Keep this multi-action Unity chain as a planning-only artifact.",
      "Do not execute the chain from this package.",
      `ROLLBACK ORDER PREVIEW: ${result.rollback_graph.join(" | ") || "none"}`,
    ],
    files_changed: [],
    validation_results: proofResults,
    proof_results: ["CHAIN PLAN ONLY", "NOT EXECUTED", "ROLLBACK ORDER PREVIEW"],
    risk_summary: result.blocked_reason ?? "Chain planning only. No multi-action Unity execution has been enabled.",
    rollback_plan: result.rollback_graph.join(" | ") || "No rollback order preview available.",
    release_notes: summary,
    recommended_pr_title: "",
    recommended_pr_body: `Unity multi-action chain plan handoff\n\nSummary: ${summary}\n\nNext operator action: ${result.recommended_next_operator_action}`,
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

function evaluateChainReadinessExecutionPlanStatus(
  executionPlan: UnitySceneObjectCreationExecutionPlanResult | UnitySceneObjectCreationRollbackExecutionPlanResult | null | undefined,
  expectedRequestId: string,
  action: UnityMutationExecutionChainReadinessActionInput,
): {
  status: UnityMutationExecutionChainReadinessGateStatus;
  detail: string;
} {
  if (!executionPlan) {
    return {
      status: "missing",
      detail: `Execution plan gate is missing for chain action ${action.action_id}.`,
    };
  }

  if (action.action_type === "unity_scene_object_creation") {
    if (
      executionPlan.request_id !== expectedRequestId
      || executionPlan.target_scene !== action.target_scene.trim()
      || executionPlan.requested_object_name !== action.target_object_name.trim()
      || executionPlan.execution_kind !== "execution_plan_only"
    ) {
      return {
        status: "invalid",
        detail: `Execution plan gate is invalid for chain action ${action.action_id}.`,
      };
    }
  } else {
    if (
      executionPlan.rollback_request_id !== expectedRequestId
      || executionPlan.target_scene !== action.target_scene.trim()
      || executionPlan.target_object_name !== action.target_object_name.trim()
      || executionPlan.execution_kind !== "rollback_plan_only"
    ) {
      return {
        status: "invalid",
        detail: `Execution plan gate is invalid for chain action ${action.action_id}.`,
      };
    }
  }

  return {
    status: "approved",
    detail: `Execution plan gate is present for chain action ${action.action_id}.`,
  };
}

function evaluateUnityMutationExecutionChainActionReadiness(
  input: UnityMutationExecutionChainReadinessInput,
  action: UnityMutationExecutionChainReadinessActionInput,
): UnityMutationExecutionChainReadinessActionResult {
  const requestId = `${input.adapter_request_id}:${action.action_id}`;
  const reviewApproved = hasCompletedReview(input.review_state);
  const operatorApproved = hasApproval(input.review_state);

  const reviewGate: UnityMutationExecutionChainReadinessGateEvaluation = {
    gate: "review_approval",
    status: reviewApproved ? "approved" : "missing",
    detail: reviewApproved
      ? `Review approval gate is recorded for chain action ${action.action_id}.`
      : `Review approval gate is missing for chain action ${action.action_id}.`,
  };
  const operatorGate: UnityMutationExecutionChainReadinessGateEvaluation = {
    gate: "operator_approval",
    status: operatorApproved ? "approved" : "missing",
    detail: operatorApproved
      ? `Operator approval gate is recorded for chain action ${action.action_id}.`
      : `Operator approval gate is missing for chain action ${action.action_id}.`,
  };

  let dryRunGate: UnityMutationExecutionChainReadinessGateEvaluation;
  let preflightGate: UnityMutationExecutionChainReadinessGateEvaluation;
  let authorizationGate: UnityMutationExecutionChainReadinessGateEvaluation;
  let liveValidationGate: UnityMutationExecutionChainReadinessGateEvaluation;
  let executionPlanGate: UnityMutationExecutionChainReadinessGateEvaluation;
  let finalMutationSwitchGate: UnityMutationExecutionChainReadinessGateEvaluation;

  if (action.action_type === "unity_scene_object_creation") {
    const dryRunStatus = evaluateExecutionPlanDryRunPreviewStatus(action.preview_result ?? null, requestId);
    const preflightStatus = evaluateExecutionPlanPreflightStatus(action.preflight_result ?? null, requestId);
    const authorizationEvaluation = evaluateUnityMutationExecutionAuthorization({
      preview_result: action.preview_result ?? {
        request_id: requestId,
        request_type: "scene_object_creation_request",
        final_execution_required: true,
        final_execution_authorized: false,
        executed: false,
      },
      authorization: action.authorization ?? null,
      evaluated_at: input.requested_at,
    });
    const liveValidationStatus = evaluateExecutionPlanLiveValidationStatus(action.live_validation_result ?? null, action.target_scene.trim());
    const executionPlanStatus = evaluateChainReadinessExecutionPlanStatus(action.execution_plan ?? null, requestId, action);
    const mutationSwitchEvaluation = evaluateUnityMutationExecutionSwitch({
      request_id: requestId,
      request_type: "scene_object_creation_request",
      mutation_switch: action.mutation_switch ?? null,
      evaluated_at: input.requested_at,
    });

    dryRunGate = {
      gate: "dry_run_preview",
      status: dryRunStatus.status === "valid" ? "approved" : dryRunStatus.status,
      detail: dryRunStatus.detail,
    };
    preflightGate = {
      gate: "preflight_simulation",
      status: preflightStatus.status === "valid" ? "approved" : preflightStatus.status,
      detail: preflightStatus.detail,
    };
    authorizationGate = {
      gate: "final_execution_authorization",
      status: authorizationEvaluation.authorized ? "approved" : action.authorization ? "invalid" : "missing",
      detail: authorizationEvaluation.authorized
        ? `Final execution authorization gate is present for chain action ${action.action_id}.`
        : authorizationEvaluation.blocked_reason ?? `Final execution authorization gate is missing for chain action ${action.action_id}.`,
    };
    liveValidationGate = {
      gate: "live_read_only_validation",
      status: liveValidationStatus.status === "valid" ? "approved" : liveValidationStatus.status,
      detail: liveValidationStatus.detail,
    };
    executionPlanGate = {
      gate: "execution_plan",
      status: executionPlanStatus.status,
      detail: executionPlanStatus.detail,
    };
    finalMutationSwitchGate = {
      gate: "final_mutation_switch",
      status: mutationSwitchEvaluation.enabled ? "approved" : action.mutation_switch ? "invalid" : "missing",
      detail: mutationSwitchEvaluation.enabled
        ? `Final mutation switch gate is present for chain action ${action.action_id}.`
        : mutationSwitchEvaluation.blocked_reason ?? `Final mutation switch gate is missing for chain action ${action.action_id}.`,
    };
  } else {
    const authorizationEvaluation = evaluateUnityRollbackExecutionAuthorization({
      request_id: requestId,
      target_scene: action.target_scene.trim(),
      target_object_name: action.target_object_name.trim(),
      authorization: action.authorization ?? null,
      evaluated_at: input.requested_at,
    });
    const liveValidationStatus = evaluateExecutionPlanLiveValidationStatus(action.live_validation_result ?? null, action.target_scene.trim());
    const executionPlanStatus = evaluateChainReadinessExecutionPlanStatus(action.execution_plan ?? null, requestId, action);
    const rollbackSwitchEvaluation = evaluateUnityRollbackExecutionSwitch({
      request_id: requestId,
      target_scene: action.target_scene.trim(),
      target_object_name: action.target_object_name.trim(),
      rollback_switch: action.rollback_switch ?? null,
      evaluated_at: input.requested_at,
    });

    dryRunGate = {
      gate: "dry_run_preview",
      status: "not_applicable",
      detail: `Dry-run preview gate is not applicable to rollback chain action ${action.action_id}.`,
    };
    preflightGate = {
      gate: "preflight_simulation",
      status: "not_applicable",
      detail: `Preflight simulation gate is not applicable to rollback chain action ${action.action_id}.`,
    };
    authorizationGate = {
      gate: "final_execution_authorization",
      status: authorizationEvaluation.authorized ? "approved" : action.authorization ? "invalid" : "missing",
      detail: authorizationEvaluation.authorized
        ? `Final rollback authorization gate is present for chain action ${action.action_id}.`
        : authorizationEvaluation.blocked_reason ?? `Final rollback authorization gate is missing for chain action ${action.action_id}.`,
    };
    liveValidationGate = {
      gate: "live_read_only_validation",
      status: liveValidationStatus.status === "valid" ? "approved" : liveValidationStatus.status,
      detail: liveValidationStatus.detail,
    };
    executionPlanGate = {
      gate: "execution_plan",
      status: executionPlanStatus.status,
      detail: executionPlanStatus.detail,
    };
    finalMutationSwitchGate = {
      gate: "final_mutation_switch",
      status: rollbackSwitchEvaluation.enabled ? "approved" : action.rollback_switch ? "invalid" : "missing",
      detail: rollbackSwitchEvaluation.enabled
        ? `Final rollback switch gate is present for chain action ${action.action_id}.`
        : rollbackSwitchEvaluation.blocked_reason ?? `Final rollback switch gate is missing for chain action ${action.action_id}.`,
    };
  }

  const gateStatuses = [
    reviewGate,
    operatorGate,
    dryRunGate,
    preflightGate,
    authorizationGate,
    liveValidationGate,
    executionPlanGate,
    finalMutationSwitchGate,
  ];
  const missingGates = gateStatuses
    .filter((gate) => gate.status !== "approved" && gate.status !== "not_applicable")
    .map((gate) => gate.gate);
  const readyForOperatorExecution = missingGates.length === 0;

  return {
    action_id: action.action_id.trim(),
    action_type: action.action_type,
    target_scene: action.target_scene.trim(),
    target_object_name: action.target_object_name.trim(),
    depends_on: [...action.depends_on],
    required_approvals: [...new Set([...getChainActionRequiredApprovals(action.action_type), ...action.required_approvals])],
    order: -1,
    status: readyForOperatorExecution ? "planned" : "blocked",
    lane_scope: "layer15_single_object_lane",
    blocked_reason: readyForOperatorExecution ? null : gateStatuses.find((gate) => gate.status !== "approved" && gate.status !== "not_applicable")?.detail ?? null,
    dry_run: true,
    executed: false,
    gate_statuses: gateStatuses,
    missing_gates: missingGates,
    ready_for_operator_execution: readyForOperatorExecution,
    dependency_blockers: [],
    readiness: readyForOperatorExecution ? "ready_for_operator_execution" : "not_ready",
  };
}

function createUnityMutationExecutionChainReadinessPackages(
  input: UnityMutationExecutionChainReadinessInput,
  result: UnityMutationExecutionChainReadinessResult,
): {
  reviewPackage: AutonomousReviewPackage;
  deliveryPackage: AutonomousDeliveryPackage;
} {
  const summary = `CHAIN READINESS ONLY: Controlled Unity execution chain ${result.chain_id} evaluated as ${result.chain_readiness}. NO ACTIONS EXECUTED.`;
  const proofResults = [
    `Execution kind: ${result.execution_kind}`,
    `Chain id: ${result.chain_id}`,
    `Chain status: ${result.chain_status}`,
    `Chain readiness: ${result.chain_readiness}`,
    `Execution mode: ${result.execution_mode}`,
    `Total actions: ${String(result.total_actions)}`,
    `Ready actions: ${result.ready_actions.join(", ") || "none"}`,
    `Blocked actions: ${result.blocked_actions.join(", ") || "none"}`,
    `Dependency blocked actions: ${result.dependency_blocked_actions.join(", ") || "none"}`,
    `Executable actions: ${result.executable_actions.join(", ") || "none"}`,
    `Missing gates: ${result.missing_gates.join(", ") || "none"}`,
    `Chain ready: ${String(result.chain_ready)}`,
    `Dry run: ${String(result.dry_run)}`,
    `Executed: ${String(result.executed)}`,
    ...result.required_approvals.map((approval) => `Required approval gate: ${approval}`),
    ...result.dependency_graph.map((entry) => `Dependency graph: ${entry}`),
    ...result.rollback_graph.map((entry) => `Rollback graph: ${entry}`),
    ...result.ordered_actions.map((action) => `Gate status: ${action.action_id} => ${action.gate_statuses.map((gate) => `${gate.gate}=${gate.status}`).join(", ")}`),
    ...result.ordered_actions.filter((action) => action.dependency_blockers.length > 0).map((action) => `Dependency blocker: ${action.action_id} <= ${action.dependency_blockers.join(", ")}`),
    `Recommended next operator action: ${result.recommended_next_operator_action}`,
    ...(result.blocked_reason ? [`Blocked reason: ${result.blocked_reason}`] : []),
  ];

  const reviewPackage = createAutonomousReviewPackage({
    package_id: `unity-chain-readiness-review-${result.chain_id}`,
    work_item_id: `unity-chain-readiness-${result.chain_id}`,
    chain_id: `unity-chain-readiness-chain-${result.chain_id}`,
    status: result.execution_kind === "chain_readiness_only" ? "approved" : "pending",
    summary,
    files_changed: [],
    tests_run: ["unity mutation execution chain readiness"],
    proof_results: proofResults,
    risks: [
      "CHAIN READINESS ONLY",
      "NO ACTIONS EXECUTED",
      ...(result.blocked_reason ? [result.blocked_reason] : []),
    ],
    recommended_decision: "approve",
    rollback_notes: result.rollback_graph.length > 0
      ? `ROLLBACK ORDER PREVIEW: ${result.rollback_graph.join(" | ")}`
      : "No rollback order preview is available for this chain.",
    operator_actions: ["approve", "archive"],
  });

  const deliveryPackage = createAutonomousDeliveryPackage({
    delivery_package_id: `unity-chain-readiness-delivery-${result.chain_id}`,
    review_package_id: reviewPackage.package_id,
    work_item_id: reviewPackage.work_item_id,
    chain_id: reviewPackage.chain_id,
    branch_name: "",
    commit_plan: [
      "Keep this Unity chain readiness artifact attached to the reviewed delivery lane.",
      "CHAIN READINESS ONLY: do not execute, mutate, or roll back anything from this package.",
      `NO ACTIONS EXECUTED: ${result.ready_actions.join(", ") || "none ready"}`,
    ],
    files_changed: [],
    validation_results: proofResults,
    proof_results: ["CHAIN READINESS ONLY", "NO ACTIONS EXECUTED", result.chain_readiness],
    risk_summary: result.blocked_reason ?? "Chain readiness evaluated without executing any Unity actions.",
    rollback_plan: result.rollback_graph.join(" | ") || "No rollback order preview available.",
    release_notes: summary,
    recommended_pr_title: "",
    recommended_pr_body: `Unity chain readiness handoff\n\nSummary: ${summary}\n\nNext operator action: ${result.recommended_next_operator_action}`,
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

export function evaluateUnityMutationExecutionSwitch(input: {
  request_id: string;
  request_type: "scene_object_creation_request";
  mutation_switch: UnityMutationExecutionSwitch | null;
  evaluated_at: string;
}): UnityMutationExecutionSwitchEvaluation {
  if (!input.mutation_switch) {
    return {
      enabled: false,
      blocked_reason: "Unity mutation execution remains blocked until a final mutation switch is recorded.",
      request_id: input.request_id,
      switch_target_request_match: false,
      allowed_mutation_type_match: false,
      switch_expiration_status: "not_provided",
      mutation_switch_id: null,
    };
  }

  const switchTargetRequestMatch = input.mutation_switch.target_request_id === input.request_id;
  if (!switchTargetRequestMatch) {
    return {
      enabled: false,
      blocked_reason: "Unity mutation execution switch target request id does not match the reviewed mutation request.",
      request_id: input.request_id,
      switch_target_request_match: false,
      allowed_mutation_type_match: input.mutation_switch.allowed_mutation_type === input.request_type,
      switch_expiration_status: input.mutation_switch.expires_at ? (input.mutation_switch.expires_at <= input.evaluated_at ? "expired" : "valid") : "not_provided",
      mutation_switch_id: input.mutation_switch.mutation_switch_id,
    };
  }

  const allowedMutationTypeMatch = input.mutation_switch.allowed_mutation_type === input.request_type;
  if (!allowedMutationTypeMatch) {
    return {
      enabled: false,
      blocked_reason: "Unity mutation execution switch allowed mutation type does not match the requested mutation lane.",
      request_id: input.request_id,
      switch_target_request_match: true,
      allowed_mutation_type_match: false,
      switch_expiration_status: input.mutation_switch.expires_at ? (input.mutation_switch.expires_at <= input.evaluated_at ? "expired" : "valid") : "not_provided",
      mutation_switch_id: input.mutation_switch.mutation_switch_id,
    };
  }

  const switchExpirationStatus = input.mutation_switch.expires_at
    ? input.mutation_switch.expires_at <= input.evaluated_at
      ? "expired"
      : "valid"
    : "not_provided";
  if (switchExpirationStatus === "expired") {
    return {
      enabled: false,
      blocked_reason: "Unity mutation execution switch has expired and must be renewed before any future mutation path is allowed.",
      request_id: input.request_id,
      switch_target_request_match: true,
      allowed_mutation_type_match: true,
      switch_expiration_status: "expired",
      mutation_switch_id: input.mutation_switch.mutation_switch_id,
    };
  }

  if (!input.mutation_switch.enabled_by_operator) {
    return {
      enabled: false,
      blocked_reason: "Unity mutation execution switch is present but not operator-enabled.",
      request_id: input.request_id,
      switch_target_request_match: true,
      allowed_mutation_type_match: true,
      switch_expiration_status: switchExpirationStatus,
      mutation_switch_id: input.mutation_switch.mutation_switch_id,
    };
  }

  if (!input.mutation_switch.switch_enabled) {
    return {
      enabled: false,
      blocked_reason: "Unity mutation execution switch is recorded but remains disabled.",
      request_id: input.request_id,
      switch_target_request_match: true,
      allowed_mutation_type_match: true,
      switch_expiration_status: switchExpirationStatus,
      mutation_switch_id: input.mutation_switch.mutation_switch_id,
    };
  }

  return {
    enabled: true,
    blocked_reason: null,
    request_id: input.request_id,
    switch_target_request_match: true,
    allowed_mutation_type_match: true,
    switch_expiration_status: switchExpirationStatus,
    mutation_switch_id: input.mutation_switch.mutation_switch_id,
  };
}

export function evaluateUnityRollbackExecutionAuthorization(input: {
  request_id: string;
  target_scene: string;
  target_object_name: string;
  authorization: UnityRollbackExecutionAuthorization | null;
  evaluated_at: string;
}): UnityRollbackExecutionAuthorizationEvaluation {
  if (!input.authorization) {
    return {
      authorized: false,
      blocked_reason: "Unity rollback execution remains blocked until a final rollback authorization is recorded.",
      request_id: input.request_id,
      scope_match: false,
      target_request_match: false,
      target_scene_match: false,
      target_object_match: false,
      expiration_status: "not_provided",
      final_rollback_authorization_id: null,
    };
  }

  const scopeMatch = input.authorization.authorization_scope === "scene_object_removal";
  const targetRequestMatch = input.authorization.target_request_id === input.request_id;
  const targetSceneMatch = input.authorization.target_scene.trim() === input.target_scene;
  const targetObjectMatch = input.authorization.target_object_name.trim() === input.target_object_name;
  const expirationStatus = input.authorization.expires_at
    ? input.authorization.expires_at <= input.evaluated_at
      ? "expired"
      : "valid"
    : "not_provided";

  if (!scopeMatch) {
    return {
      authorized: false,
      blocked_reason: "Unity rollback execution authorization scope does not match the controlled rollback lane.",
      request_id: input.request_id,
      scope_match: false,
      target_request_match: targetRequestMatch,
      target_scene_match: targetSceneMatch,
      target_object_match: targetObjectMatch,
      expiration_status: expirationStatus,
      final_rollback_authorization_id: input.authorization.final_rollback_authorization_id,
    };
  }

  if (!targetRequestMatch) {
    return {
      authorized: false,
      blocked_reason: "Unity rollback execution authorization target request id does not match the reviewed rollback request.",
      request_id: input.request_id,
      scope_match: true,
      target_request_match: false,
      target_scene_match: targetSceneMatch,
      target_object_match: targetObjectMatch,
      expiration_status: expirationStatus,
      final_rollback_authorization_id: input.authorization.final_rollback_authorization_id,
    };
  }

  if (!targetSceneMatch) {
    return {
      authorized: false,
      blocked_reason: "Unity rollback execution authorization target scene does not match the reviewed rollback target.",
      request_id: input.request_id,
      scope_match: true,
      target_request_match: true,
      target_scene_match: false,
      target_object_match: targetObjectMatch,
      expiration_status: expirationStatus,
      final_rollback_authorization_id: input.authorization.final_rollback_authorization_id,
    };
  }

  if (!targetObjectMatch) {
    return {
      authorized: false,
      blocked_reason: "Unity rollback execution authorization target object does not match the reviewed rollback target.",
      request_id: input.request_id,
      scope_match: true,
      target_request_match: true,
      target_scene_match: true,
      target_object_match: false,
      expiration_status: expirationStatus,
      final_rollback_authorization_id: input.authorization.final_rollback_authorization_id,
    };
  }

  if (expirationStatus === "expired") {
    return {
      authorized: false,
      blocked_reason: "Unity rollback execution authorization has expired and must be renewed before rollback is allowed.",
      request_id: input.request_id,
      scope_match: true,
      target_request_match: true,
      target_scene_match: true,
      target_object_match: true,
      expiration_status: "expired",
      final_rollback_authorization_id: input.authorization.final_rollback_authorization_id,
    };
  }

  if (!input.authorization.authorized_by_operator) {
    return {
      authorized: false,
      blocked_reason: "Unity rollback execution authorization is present but not operator-authorized.",
      request_id: input.request_id,
      scope_match: true,
      target_request_match: true,
      target_scene_match: true,
      target_object_match: true,
      expiration_status: expirationStatus,
      final_rollback_authorization_id: input.authorization.final_rollback_authorization_id,
    };
  }

  return {
    authorized: true,
    blocked_reason: null,
    request_id: input.request_id,
    scope_match: true,
    target_request_match: true,
    target_scene_match: true,
    target_object_match: true,
    expiration_status: expirationStatus,
    final_rollback_authorization_id: input.authorization.final_rollback_authorization_id,
  };
}

export function evaluateUnityRollbackExecutionSwitch(input: {
  request_id: string;
  target_scene: string;
  target_object_name: string;
  rollback_switch: UnityRollbackExecutionSwitch | null;
  evaluated_at: string;
}): UnityRollbackExecutionSwitchEvaluation {
  if (!input.rollback_switch) {
    return {
      enabled: false,
      blocked_reason: "Unity rollback execution remains blocked until a final rollback switch is recorded.",
      request_id: input.request_id,
      switch_target_request_match: false,
      target_scene_match: false,
      target_object_match: false,
      allowed_rollback_type_match: false,
      switch_expiration_status: "not_provided",
      rollback_switch_id: null,
    };
  }

  const switchTargetRequestMatch = input.rollback_switch.target_request_id === input.request_id;
  const targetSceneMatch = input.rollback_switch.target_scene.trim() === input.target_scene;
  const targetObjectMatch = input.rollback_switch.target_object_name.trim() === input.target_object_name;
  const allowedRollbackTypeMatch = input.rollback_switch.allowed_rollback_type === "scene_object_removal";
  const switchExpirationStatus = input.rollback_switch.expires_at
    ? input.rollback_switch.expires_at <= input.evaluated_at
      ? "expired"
      : "valid"
    : "not_provided";

  if (!switchTargetRequestMatch) {
    return {
      enabled: false,
      blocked_reason: "Unity rollback execution switch target request id does not match the reviewed rollback request.",
      request_id: input.request_id,
      switch_target_request_match: false,
      target_scene_match: targetSceneMatch,
      target_object_match: targetObjectMatch,
      allowed_rollback_type_match: allowedRollbackTypeMatch,
      switch_expiration_status: switchExpirationStatus,
      rollback_switch_id: input.rollback_switch.rollback_switch_id,
    };
  }

  if (!targetSceneMatch) {
    return {
      enabled: false,
      blocked_reason: "Unity rollback execution switch target scene does not match the reviewed rollback target.",
      request_id: input.request_id,
      switch_target_request_match: true,
      target_scene_match: false,
      target_object_match: targetObjectMatch,
      allowed_rollback_type_match: allowedRollbackTypeMatch,
      switch_expiration_status: switchExpirationStatus,
      rollback_switch_id: input.rollback_switch.rollback_switch_id,
    };
  }

  if (!targetObjectMatch) {
    return {
      enabled: false,
      blocked_reason: "Unity rollback execution switch target object does not match the reviewed rollback target.",
      request_id: input.request_id,
      switch_target_request_match: true,
      target_scene_match: true,
      target_object_match: false,
      allowed_rollback_type_match: allowedRollbackTypeMatch,
      switch_expiration_status: switchExpirationStatus,
      rollback_switch_id: input.rollback_switch.rollback_switch_id,
    };
  }

  if (!allowedRollbackTypeMatch) {
    return {
      enabled: false,
      blocked_reason: "Unity rollback execution switch allowed rollback type does not match the controlled rollback lane.",
      request_id: input.request_id,
      switch_target_request_match: true,
      target_scene_match: true,
      target_object_match: true,
      allowed_rollback_type_match: false,
      switch_expiration_status: switchExpirationStatus,
      rollback_switch_id: input.rollback_switch.rollback_switch_id,
    };
  }

  if (switchExpirationStatus === "expired") {
    return {
      enabled: false,
      blocked_reason: "Unity rollback execution switch has expired and must be renewed before rollback is allowed.",
      request_id: input.request_id,
      switch_target_request_match: true,
      target_scene_match: true,
      target_object_match: true,
      allowed_rollback_type_match: true,
      switch_expiration_status: "expired",
      rollback_switch_id: input.rollback_switch.rollback_switch_id,
    };
  }

  if (!input.rollback_switch.enabled_by_operator) {
    return {
      enabled: false,
      blocked_reason: "Unity rollback execution switch is present but not operator-enabled.",
      request_id: input.request_id,
      switch_target_request_match: true,
      target_scene_match: true,
      target_object_match: true,
      allowed_rollback_type_match: true,
      switch_expiration_status: switchExpirationStatus,
      rollback_switch_id: input.rollback_switch.rollback_switch_id,
    };
  }

  if (!input.rollback_switch.switch_enabled) {
    return {
      enabled: false,
      blocked_reason: "Unity rollback execution switch is recorded but remains disabled.",
      request_id: input.request_id,
      switch_target_request_match: true,
      target_scene_match: true,
      target_object_match: true,
      allowed_rollback_type_match: true,
      switch_expiration_status: switchExpirationStatus,
      rollback_switch_id: input.rollback_switch.rollback_switch_id,
    };
  }

  return {
    enabled: true,
    blocked_reason: null,
    request_id: input.request_id,
    switch_target_request_match: true,
    target_scene_match: true,
    target_object_match: true,
    allowed_rollback_type_match: true,
    switch_expiration_status: switchExpirationStatus,
    rollback_switch_id: input.rollback_switch.rollback_switch_id,
  };
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
  const mutationSwitchEvaluation = evaluateUnityMutationExecutionSwitch({
    request_id: input.adapter_request_id,
    request_type: "scene_object_creation_request",
    mutation_switch: input.mutation_switch,
    evaluated_at: input.evaluated_at ?? input.requested_at,
  });
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
    {
      gate: "final_mutation_switch",
      status: mutationSwitchEvaluation.enabled ? "approved" : input.mutation_switch ? "invalid" : "missing",
      detail: mutationSwitchEvaluation.enabled
        ? "Final mutation switch gate is present and enabled for this Unity mutation request."
        : mutationSwitchEvaluation.blocked_reason ?? "Final mutation switch gate is missing for this Unity mutation request.",
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
      "final_mutation_switch",
    ],
    gate_statuses: gateStatuses,
    dry_run_preview_status: dryRunPreviewStatus.status,
    preflight_status: preflightStatus.status,
    authorization_evaluation: authorizationEvaluation,
    final_mutation_switch_required: true,
    final_mutation_switch_enabled: false,
    mutation_switch_evaluation: mutationSwitchEvaluation,
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
    `Final mutation switch required: ${String(result.final_mutation_switch_required)}`,
    `Final mutation switch enabled: ${String(result.final_mutation_switch_enabled)}`,
    `Final mutation switch evaluation status: ${formatMutationSwitchEvaluationStatus(result.mutation_switch_evaluation)}`,
    `Final mutation switch id: ${result.mutation_switch_evaluation.mutation_switch_id ?? "none"}`,
    `Final mutation switch target request match: ${String(result.mutation_switch_evaluation.switch_target_request_match)}`,
    `Final mutation switch mutation type match: ${String(result.mutation_switch_evaluation.allowed_mutation_type_match)}`,
    `Final mutation switch expiration status: ${result.mutation_switch_evaluation.switch_expiration_status}`,
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
      "FINAL MUTATION SWITCH REQUIRED",
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
    proof_results: [result.execution_kind, "EXECUTION PLAN ONLY", "FINAL MUTATION SWITCH REQUIRED", "MUTATION SWITCH DISABLED", "NOT EXECUTED"],
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

function buildBlockedUnitySceneObjectCreationMutationResult(
  input: UnitySceneObjectCreationMutationExecutionInput,
  blockedReason: string,
): UnitySceneObjectCreationMutationExecutionResult {
  return {
    request_id: input.adapter_request_id,
    domain: "Unity",
    request_type: "scene_object_creation_request",
    mutation_type: "scene_object_creation_request",
    execution_mode: "controlled_mutation_runtime_bridge",
    execution_kind: "controlled_mutation_blocked",
    review_approval_id: input.review_state.review_package_id,
    review_approval_status: hasCompletedReview(input.review_state) ? "approved" : "missing",
    operator_approval_id: input.review_state.operator_approval_id,
    operator_approval_status: hasApproval(input.review_state) ? "approved" : "missing",
    target_scene: input.target_scene.trim(),
    requested_object_name: input.requested_object_name.trim(),
    created_object_name: null,
    duplicate_handling: null,
    mutation_enabled: false,
    executed: false,
    scene_saved: false,
    final_mutation_switch_required: true,
    final_mutation_switch_enabled: false,
    evidence_timestamp: input.requested_at,
    rollback_hint: "Rollback is not available because the controlled Unity mutation did not execute.",
    delivery_summary: "Controlled Unity mutation did not execute because one or more required gates were not satisfied.",
    blocked_reason: blockedReason,
    artifact_label: "unity_controlled_scene_mutation_result",
    review_package: null,
    delivery_package: null,
    mutating: false,
  };
}

function createUnitySceneObjectCreationMutationPackages(
  input: UnitySceneObjectCreationMutationExecutionInput,
  result: UnitySceneObjectCreationMutationExecutionResult,
): {
  reviewPackage: AutonomousReviewPackage;
  deliveryPackage: AutonomousDeliveryPackage;
} {
  const packageSuffix = input.adapter_request_id;
  const summary = result.execution_kind === "controlled_mutation_executed"
    ? `CONTROLLED UNITY MUTATION: ${result.created_object_name ?? result.requested_object_name} created in ${result.target_scene}. EXECUTED. ROLLBACK AVAILABLE.`
    : result.execution_kind === "controlled_mutation_idempotent"
      ? `CONTROLLED UNITY MUTATION: ${result.created_object_name ?? result.requested_object_name} already existed in ${result.target_scene}. EXECUTED. ROLLBACK AVAILABLE.`
      : `CONTROLLED UNITY MUTATION: ${result.requested_object_name} in ${result.target_scene} DID NOT COMPLETE. NOT EXECUTED.`;

  const proofResults = [
    `Execution kind: ${result.execution_kind}`,
    `Mutation type: ${result.mutation_type}`,
    `Target scene: ${result.target_scene}`,
    `Requested object name: ${result.requested_object_name}`,
    `Created object name: ${result.created_object_name ?? "none"}`,
    `Mutation enabled: ${String(result.mutation_enabled)}`,
    `Executed: ${String(result.executed)}`,
    `Scene saved: ${String(result.scene_saved)}`,
    `Duplicate handling: ${result.duplicate_handling ?? "none"}`,
    `Final mutation switch required: ${String(result.final_mutation_switch_required)}`,
    `Final mutation switch enabled: ${String(result.final_mutation_switch_enabled)}`,
    `Evidence timestamp: ${result.evidence_timestamp}`,
    `Rollback hint: ${result.rollback_hint}`,
    `Delivery summary: ${result.delivery_summary}`,
    ...(result.blocked_reason ? [`Blocked reason: ${result.blocked_reason}`] : []),
  ];

  const reviewPackage = createAutonomousReviewPackage({
    package_id: `unity-controlled-mutation-review-${packageSuffix}`,
    work_item_id: `unity-controlled-mutation-${packageSuffix}`,
    chain_id: `unity-controlled-mutation-chain-${packageSuffix}`,
    status: result.execution_kind === "controlled_mutation_executed" || result.execution_kind === "controlled_mutation_idempotent" ? "approved" : "pending",
    summary,
    files_changed: [],
    tests_run: ["unity controlled scene object creation mutation"],
    proof_results: proofResults,
    risks: [
      "CONTROLLED UNITY MUTATION",
      result.executed ? "EXECUTED" : "NOT EXECUTED",
      "ROLLBACK AVAILABLE",
      ...(result.blocked_reason ? [result.blocked_reason] : []),
    ],
    recommended_decision: "approve",
    rollback_notes: result.rollback_hint,
    operator_actions: ["approve", "archive"],
  });

  const deliveryPackage = createAutonomousDeliveryPackage({
    delivery_package_id: `unity-controlled-mutation-delivery-${packageSuffix}`,
    review_package_id: reviewPackage.package_id,
    work_item_id: reviewPackage.work_item_id,
    chain_id: reviewPackage.chain_id,
    branch_name: "",
    commit_plan: [
      "Keep this controlled Unity mutation evidence attached to the reviewed delivery lane.",
      `Rollback requires separate future approval: remove ${result.created_object_name ?? result.requested_object_name} from ${result.target_scene}.`,
      "Do not broaden this mutation beyond the single reviewed scene object creation request.",
    ],
    files_changed: [],
    validation_results: proofResults,
    proof_results: ["CONTROLLED UNITY MUTATION", result.executed ? "EXECUTED" : "NOT EXECUTED", "ROLLBACK AVAILABLE"],
    risk_summary: result.executed
      ? `Controlled Unity mutation executed for ${result.created_object_name ?? result.requested_object_name}; rollback remains separately approved.`
      : `Controlled Unity mutation did not execute. ${result.blocked_reason ?? "Review the mutation evidence before retrying."}`,
    rollback_plan: result.rollback_hint,
    release_notes: summary,
    recommended_pr_title: "",
    recommended_pr_body: `Controlled Unity mutation handoff\n\nSummary: ${summary}\n\nNext operator action: ${result.executed ? "Review the mutation evidence and keep rollback as a separate approved follow-up action." : result.blocked_reason ?? "Hold the mutation lane until the blocker is resolved."}`,
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

function buildUnitySceneObjectCreationRollbackExecutionPlanResult(
  input: UnitySceneObjectCreationRollbackExecutionPlanInput,
  authorizationEvaluation: UnityRollbackExecutionAuthorizationEvaluation,
): UnitySceneObjectCreationRollbackExecutionPlanResult {
  const reviewApproved = hasCompletedReview(input.review_state);
  const operatorApproved = hasApproval(input.review_state);
  const targetScene = input.target_scene.trim();
  const targetObjectName = input.target_object_name.trim();
  const controlledTarget = evaluateControlledRollbackTarget(targetScene, targetObjectName);
  const rollbackSwitchEvaluation = evaluateUnityRollbackExecutionSwitch({
    request_id: input.adapter_request_id,
    target_scene: targetScene,
    target_object_name: targetObjectName,
    rollback_switch: input.rollback_switch,
    evaluated_at: input.evaluated_at ?? input.requested_at,
  });
  const liveValidationStatus = evaluateExecutionPlanLiveValidationStatus(input.live_validation_result, targetScene);
  const explicitRollbackExecutionModeStatus = input.rollback_execution_mode_enabled ? "enabled" : "disabled";
  const liveValidationSummary = input.live_validation_result
    ? `Scene ${input.live_validation_result.checked_scene_name ?? "unknown"} reported ${input.live_validation_result.scene_validation_status} with missing scripts ${input.live_validation_result.missing_script_count ?? "unknown"}, console errors ${input.live_validation_result.console_error_count ?? "unknown"}, and object count ${input.live_validation_result.object_count ?? "unknown"}.`
    : "Live read-only validation has not been provided for this rollback plan.";

  const gateStatuses: UnityRollbackExecutionPlanGateEvaluation[] = [
    {
      gate: "review_approval",
      status: reviewApproved ? "approved" : "missing",
      detail: reviewApproved
        ? "Rollback review approval gate is recorded for this Unity rollback request."
        : "Unity rollback execution plan is blocked until rollback review approval is recorded.",
    },
    {
      gate: "operator_approval",
      status: operatorApproved ? "approved" : "missing",
      detail: operatorApproved
        ? "Rollback operator approval gate is recorded for this Unity rollback request."
        : "Unity rollback execution plan is blocked until rollback operator approval is recorded.",
    },
    {
      gate: "controlled_target",
      status: controlledTarget.status,
      detail: controlledTarget.detail,
    },
    {
      gate: "final_rollback_authorization",
      status: authorizationEvaluation.authorized ? "approved" : input.authorization ? "invalid" : "missing",
      detail: authorizationEvaluation.authorized
        ? "Final rollback authorization gate is present and valid for this Unity rollback request."
        : authorizationEvaluation.blocked_reason ?? "Final rollback authorization gate is missing for this Unity rollback request.",
    },
    {
      gate: "live_read_only_validation",
      status: liveValidationStatus.status === "valid" ? "approved" : liveValidationStatus.status,
      detail: liveValidationStatus.detail,
    },
    {
      gate: "explicit_rollback_execution_mode",
      status: input.rollback_execution_mode_enabled ? "approved" : "disabled",
      detail: input.rollback_execution_mode_enabled
        ? "Explicit rollback execution mode gate is marked enabled, but this layer still returns plan-only output."
        : "Explicit rollback execution mode gate remains disabled, so the plan cannot be used for live rollback execution.",
    },
    {
      gate: "final_rollback_switch",
      status: rollbackSwitchEvaluation.enabled ? "approved" : input.rollback_switch ? "invalid" : "missing",
      detail: rollbackSwitchEvaluation.enabled
        ? "Final rollback switch gate is present and enabled for this Unity rollback request."
        : rollbackSwitchEvaluation.blocked_reason ?? "Final rollback switch gate is missing for this Unity rollback request.",
    },
  ];

  const blockedReasons = gateStatuses
    .filter((gate) => gate.status !== "approved")
    .map((gate) => gate.detail);

  return {
    rollback_request_id: input.adapter_request_id,
    domain: "Unity",
    request_type: "scene_object_creation_request",
    rollback_type: "scene_object_removal",
    execution_mode: "disabled_rollback_plan_only",
    execution_kind: blockedReasons.length > 0 ? "rollback_plan_blocked" : "rollback_plan_only",
    review_approval_id: input.review_state.review_package_id,
    review_approval_status: reviewApproved ? "approved" : "missing",
    operator_approval_id: input.review_state.operator_approval_id,
    operator_approval_status: operatorApproved ? "approved" : "missing",
    target_scene: targetScene,
    target_object_name: targetObjectName,
    required_gates: [
      "review_approval",
      "operator_approval",
      "controlled_target",
      "final_rollback_authorization",
      "live_read_only_validation",
      "explicit_rollback_execution_mode",
      "final_rollback_switch",
    ],
    gate_statuses: gateStatuses,
    authorization_evaluation: authorizationEvaluation,
    final_rollback_switch_required: true,
    final_rollback_switch_enabled: false,
    rollback_switch_evaluation: rollbackSwitchEvaluation,
    live_validation_status: liveValidationStatus.status,
    live_validation_summary: liveValidationSummary,
    explicit_rollback_execution_mode_status: explicitRollbackExecutionModeStatus,
    rollback_enabled: false,
    executed: false,
    removed_object_name: null,
    scene_saved: false,
    evidence_timestamp: input.requested_at,
    blocked_reason: blockedReasons[0] ?? null,
    recommended_next_operator_action: blockedReasons.length > 0
      ? blockedReasons[0]
      : "ROLLBACK PLAN ONLY. Keep rollback disabled and do not execute this plan until separate reviewed rollback approval is complete.",
    artifact_label: "unity_controlled_scene_rollback_plan",
    review_package: null,
    delivery_package: null,
    mutating: false,
  };
}

function createUnitySceneObjectCreationRollbackPlanPackages(
  input: UnitySceneObjectCreationRollbackExecutionPlanInput,
  result: UnitySceneObjectCreationRollbackExecutionPlanResult,
): {
  reviewPackage: AutonomousReviewPackage;
  deliveryPackage: AutonomousDeliveryPackage;
} {
  const packageSuffix = input.adapter_request_id;
  const summary = `ROLLBACK PLAN ONLY: Controlled Unity rollback plan for ${result.target_object_name} in ${result.target_scene}. ROLLBACK DISABLED. NOT EXECUTED.`;
  const proofResults = [
    `Execution kind: ${result.execution_kind}`,
    `Rollback request id: ${result.rollback_request_id}`,
    `Rollback type: ${result.rollback_type}`,
    `Target scene: ${result.target_scene}`,
    `Target object name: ${result.target_object_name}`,
    `Rollback enabled: ${String(result.rollback_enabled)}`,
    `Executed: ${String(result.executed)}`,
    `Scene saved: ${String(result.scene_saved)}`,
    `Removed object name: ${result.removed_object_name ?? "none"}`,
    `Evidence timestamp: ${result.evidence_timestamp}`,
    ...result.required_gates.map((gate) => `Required gate: ${gate}`),
    ...result.gate_statuses.map((gate) => `Gate status: ${gate.gate}=${gate.status} (${gate.detail})`),
    `Live validation status: ${result.live_validation_status}`,
    `Live validation summary: ${result.live_validation_summary}`,
    `Authorization evaluation status: ${formatRollbackAuthorizationEvaluationStatus(result.authorization_evaluation)}`,
    `Final rollback switch evaluation status: ${formatRollbackSwitchEvaluationStatus(result.rollback_switch_evaluation)}`,
    `Recommended next operator action: ${result.recommended_next_operator_action}`,
    ...(result.blocked_reason ? [`Blocked reason: ${result.blocked_reason}`] : []),
  ];

  const reviewPackage = createAutonomousReviewPackage({
    package_id: `unity-controlled-rollback-plan-review-${packageSuffix}`,
    work_item_id: `unity-controlled-rollback-plan-${packageSuffix}`,
    chain_id: `unity-controlled-rollback-plan-chain-${packageSuffix}`,
    status: result.execution_kind === "rollback_plan_only" ? "approved" : "pending",
    summary,
    files_changed: [],
    tests_run: ["unity controlled scene rollback execution plan"],
    proof_results: proofResults,
    risks: [
      "ROLLBACK PLAN ONLY",
      "FINAL ROLLBACK SWITCH REQUIRED",
      "ROLLBACK DISABLED",
      "NOT EXECUTED",
      ...(result.blocked_reason ? [result.blocked_reason] : []),
    ],
    recommended_decision: "approve",
    rollback_notes: "Discard the rollback plan package if it is no longer needed.",
    operator_actions: ["approve", "archive"],
  });

  const deliveryPackage = createAutonomousDeliveryPackage({
    delivery_package_id: `unity-controlled-rollback-plan-delivery-${packageSuffix}`,
    review_package_id: reviewPackage.package_id,
    work_item_id: reviewPackage.work_item_id,
    chain_id: reviewPackage.chain_id,
    branch_name: "",
    commit_plan: [
      "Keep this controlled Unity rollback execution plan attached to the reviewed delivery lane.",
      "ROLLBACK PLAN ONLY: do not execute or save scenes from this package.",
      `Do not broaden rollback beyond ${result.target_object_name} in ${result.target_scene}.`,
    ],
    files_changed: [],
    validation_results: proofResults,
    proof_results: [result.execution_kind, "ROLLBACK PLAN ONLY", "FINAL ROLLBACK SWITCH REQUIRED", "ROLLBACK DISABLED", "NOT EXECUTED"],
    risk_summary: "Rollback plan only. Rollback remains disabled and no Unity rollback has been performed.",
    rollback_plan: "Discard the rollback plan package if it is no longer needed.",
    release_notes: summary,
    recommended_pr_title: "",
    recommended_pr_body: `Controlled Unity rollback plan handoff\n\nSummary: ${summary}\n\nNext operator action: ${result.recommended_next_operator_action}`,
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

function buildBlockedUnitySceneObjectCreationRollbackResult(
  input: UnitySceneObjectCreationRollbackExecutionInput,
  blockedReason: string,
): UnitySceneObjectCreationRollbackExecutionResult {
  return {
    rollback_request_id: input.adapter_request_id,
    domain: "Unity",
    request_type: "scene_object_creation_request",
    rollback_type: "scene_object_removal",
    execution_mode: "controlled_rollback_runtime_bridge",
    execution_kind: "controlled_rollback_blocked",
    review_approval_id: input.review_state.review_package_id,
    review_approval_status: hasCompletedReview(input.review_state) ? "approved" : "missing",
    operator_approval_id: input.review_state.operator_approval_id,
    operator_approval_status: hasApproval(input.review_state) ? "approved" : "missing",
    target_scene: input.target_scene.trim(),
    target_object_name: input.target_object_name.trim(),
    removed_object_name: null,
    rollback_enabled: false,
    executed: false,
    scene_saved: false,
    target_missing_handling: null,
    final_rollback_switch_required: true,
    final_rollback_switch_enabled: false,
    evidence_timestamp: input.requested_at,
    delivery_summary: "Controlled Unity rollback did not execute because one or more required gates were not satisfied.",
    blocked_reason: blockedReason,
    artifact_label: "unity_controlled_scene_rollback_result",
    review_package: null,
    delivery_package: null,
    mutating: false,
  };
}

function createUnitySceneObjectCreationRollbackPackages(
  input: UnitySceneObjectCreationRollbackExecutionInput,
  result: UnitySceneObjectCreationRollbackExecutionResult,
): {
  reviewPackage: AutonomousReviewPackage;
  deliveryPackage: AutonomousDeliveryPackage;
} {
  const packageSuffix = input.adapter_request_id;
  const summary = result.execution_kind === "controlled_rollback_executed"
    ? `CONTROLLED UNITY ROLLBACK: ${result.removed_object_name ?? result.target_object_name} removed from ${result.target_scene}. EXECUTED. TARGET REMOVED.`
    : result.execution_kind === "controlled_rollback_idempotent"
      ? `CONTROLLED UNITY ROLLBACK: ${result.target_object_name} already missing from ${result.target_scene}. EXECUTED. TARGET ALREADY MISSING.`
      : `CONTROLLED UNITY ROLLBACK: ${result.target_object_name} in ${result.target_scene} DID NOT COMPLETE. NOT EXECUTED.`;

  const proofResults = [
    `Execution kind: ${result.execution_kind}`,
    `Rollback request id: ${result.rollback_request_id}`,
    `Rollback type: ${result.rollback_type}`,
    `Target scene: ${result.target_scene}`,
    `Target object name: ${result.target_object_name}`,
    `Removed object name: ${result.removed_object_name ?? "none"}`,
    `Rollback enabled: ${String(result.rollback_enabled)}`,
    `Executed: ${String(result.executed)}`,
    `Scene saved: ${String(result.scene_saved)}`,
    `Target missing handling: ${result.target_missing_handling ?? "none"}`,
    `Final rollback switch required: ${String(result.final_rollback_switch_required)}`,
    `Final rollback switch enabled: ${String(result.final_rollback_switch_enabled)}`,
    `Evidence timestamp: ${result.evidence_timestamp}`,
    `Delivery summary: ${result.delivery_summary}`,
    ...(result.blocked_reason ? [`Blocked reason: ${result.blocked_reason}`] : []),
  ];

  const reviewPackage = createAutonomousReviewPackage({
    package_id: `unity-controlled-rollback-review-${packageSuffix}`,
    work_item_id: `unity-controlled-rollback-${packageSuffix}`,
    chain_id: `unity-controlled-rollback-chain-${packageSuffix}`,
    status: result.execution_kind === "controlled_rollback_executed" || result.execution_kind === "controlled_rollback_idempotent" ? "approved" : "pending",
    summary,
    files_changed: [],
    tests_run: ["unity controlled scene object rollback"],
    proof_results: proofResults,
    risks: [
      "CONTROLLED UNITY ROLLBACK",
      result.executed ? "EXECUTED" : "NOT EXECUTED",
      result.execution_kind === "controlled_rollback_executed" ? "TARGET REMOVED" : result.execution_kind === "controlled_rollback_idempotent" ? "TARGET ALREADY MISSING" : "TARGET NOT REMOVED",
      ...(result.blocked_reason ? [result.blocked_reason] : []),
    ],
    recommended_decision: "approve",
    rollback_notes: result.execution_kind === "controlled_rollback_executed"
      ? `Rollback completed: ${result.removed_object_name ?? result.target_object_name} was removed from ${result.target_scene}.`
      : `No additional rollback action was taken for ${result.target_object_name} in ${result.target_scene}.`,
    operator_actions: ["approve", "archive"],
  });

  const deliveryPackage = createAutonomousDeliveryPackage({
    delivery_package_id: `unity-controlled-rollback-delivery-${packageSuffix}`,
    review_package_id: reviewPackage.package_id,
    work_item_id: reviewPackage.work_item_id,
    chain_id: reviewPackage.chain_id,
    branch_name: "",
    commit_plan: [
      "Keep this controlled Unity rollback evidence attached to the reviewed delivery lane.",
      `Do not broaden rollback beyond ${result.target_object_name} in ${result.target_scene}.`,
      "Do not execute any additional Unity mutation from this rollback result.",
    ],
    files_changed: [],
    validation_results: proofResults,
    proof_results: ["CONTROLLED UNITY ROLLBACK", result.executed ? "EXECUTED" : "NOT EXECUTED", result.execution_kind === "controlled_rollback_executed" ? "TARGET REMOVED" : result.execution_kind === "controlled_rollback_idempotent" ? "TARGET ALREADY MISSING" : "TARGET NOT REMOVED"],
    risk_summary: result.executed
      ? `Controlled Unity rollback ${result.execution_kind === "controlled_rollback_executed" ? "removed the target cleanly" : "confirmed the target was already missing"} for ${result.target_object_name}.`
      : `Controlled Unity rollback did not execute. ${result.blocked_reason ?? "Review the rollback evidence before retrying."}`,
    rollback_plan: result.execution_kind === "controlled_rollback_executed"
      ? `Rollback completed by removing ${result.removed_object_name ?? result.target_object_name} from ${result.target_scene}.`
      : `No scene change was made for ${result.target_object_name} in ${result.target_scene}.`,
    release_notes: summary,
    recommended_pr_title: "",
    recommended_pr_body: `Controlled Unity rollback handoff\n\nSummary: ${summary}\n\nNext operator action: ${result.executed ? "Review the rollback evidence and rerun read-only validation before proceeding." : result.blocked_reason ?? "Hold the rollback lane until the blocker is resolved."}`,
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

export function buildUnitySceneObjectCreationRollbackPlan(
  input: UnitySceneObjectCreationRollbackExecutionPlanInput,
): UnitySceneObjectCreationRollbackExecutionPlanResult {
  const authorizationEvaluation = evaluateUnityRollbackExecutionAuthorization({
    request_id: input.adapter_request_id,
    target_scene: input.target_scene.trim(),
    target_object_name: input.target_object_name.trim(),
    authorization: input.authorization,
    evaluated_at: input.evaluated_at ?? input.requested_at,
  });

  const baseResult = buildUnitySceneObjectCreationRollbackExecutionPlanResult(input, authorizationEvaluation);
  const rollbackPlanPackages = createUnitySceneObjectCreationRollbackPlanPackages(input, baseResult);

  return {
    ...baseResult,
    review_package: rollbackPlanPackages.reviewPackage,
    delivery_package: rollbackPlanPackages.deliveryPackage,
  };
}

export function buildUnityMutationExecutionChainPlan(
  input: UnityMutationExecutionChainInput,
): UnityMutationExecutionChainPlanResult {
  const reviewApproved = hasCompletedReview(input.review_state);
  const operatorApproved = hasApproval(input.review_state);
  const resolvedPlan = resolveUnityMutationExecutionChainPlan(input);
  const chainStatus = resolvedPlan.blockedReason ? "chain_blocked" : "chain_planned";

  const baseResult: UnityMutationExecutionChainPlanResult = {
    chain_id: input.chain_id.trim(),
    chain_status: chainStatus,
    domain: "Unity",
    request_type: "scene_object_creation_request",
    execution_mode: "multi_action_chain_plan_only",
    execution_kind: resolvedPlan.blockedReason ? "chain_plan_blocked" : "chain_plan_only",
    review_approval_id: input.review_state.review_package_id,
    review_approval_status: reviewApproved ? "approved" : "missing",
    operator_approval_id: input.review_state.operator_approval_id,
    operator_approval_status: operatorApproved ? "approved" : "missing",
    ordered_actions: resolvedPlan.orderedActions,
    action_dependencies: resolvedPlan.actionDependencies,
    rollback_plan: resolvedPlan.rollbackPlan,
    rollback_order: resolvedPlan.rollbackPlan.map((entry) => entry.source_action_id),
    required_approvals: resolvedPlan.requiredApprovals,
    total_actions: resolvedPlan.orderedActions.length,
    executable_actions: resolvedPlan.executableActions,
    blocked_actions: resolvedPlan.blockedActions,
    dependency_graph: resolvedPlan.dependencyGraph,
    rollback_graph: resolvedPlan.rollbackGraph,
    chain_ready: false,
    dry_run: true,
    executed: false,
    blocked_reason: resolvedPlan.blockedReason,
    recommended_next_operator_action: resolvedPlan.blockedReason
      ? "Revise the requested action graph or keep the chain as a read-only operator preview."
      : "Review the chain ordering, approvals, and rollback order. Chain execution remains refused in Layer 16 Step 1.",
    artifact_label: "unity_mutation_execution_chain_plan",
    review_package: null,
    delivery_package: null,
    mutating: false,
  };

  const chainPlanPackages = createUnityMutationExecutionChainPackages(input, baseResult);

  return {
    ...baseResult,
    review_package: chainPlanPackages.reviewPackage,
    delivery_package: chainPlanPackages.deliveryPackage,
  };
}

export function evaluateUnityMutationExecutionChainReadiness(
  input: UnityMutationExecutionChainReadinessInput,
): UnityMutationExecutionChainReadinessResult {
  const reviewApproved = hasCompletedReview(input.review_state);
  const operatorApproved = hasApproval(input.review_state);
  const resolvedPlan = resolveUnityMutationExecutionChainPlan(input);
  const readinessByActionId = new Map(
    input.actions.map((action) => [action.action_id.trim(), evaluateUnityMutationExecutionChainActionReadiness(input, action)]),
  );

  const orderedActions = resolvedPlan.orderedActions.map((plannedAction) => {
    const baseReadiness = readinessByActionId.get(plannedAction.action_id);
    if (!baseReadiness) {
      return {
        ...plannedAction,
        gate_statuses: [],
        missing_gates: [],
        ready_for_operator_execution: false,
        dependency_blockers: [],
        readiness: "not_ready" as UnityMutationExecutionChainReadiness,
      };
    }

    const dependencyBlockers = plannedAction.depends_on.filter((dependencyId) => {
      const dependencyReadiness = readinessByActionId.get(dependencyId);
      return !dependencyReadiness?.ready_for_operator_execution;
    });
    const gateStatuses = dependencyBlockers.length > 0
      ? [
          ...baseReadiness.gate_statuses,
          {
            gate: "execution_plan" as UnityMutationExecutionChainReadinessGate,
            status: "dependency_blocked" as UnityMutationExecutionChainReadinessGateStatus,
            detail: `Chain action ${plannedAction.action_id} is blocked by dependency gates on ${dependencyBlockers.join(", ")}.`,
          },
        ]
      : baseReadiness.gate_statuses;
    const missingGates = gateStatuses
      .filter((gate) => gate.status !== "approved" && gate.status !== "not_applicable")
      .map((gate) => gate.gate);
    const readyForOperatorExecution = missingGates.length === 0;

    return {
      ...plannedAction,
      gate_statuses: gateStatuses,
      missing_gates: missingGates,
      ready_for_operator_execution: readyForOperatorExecution,
      dependency_blockers: dependencyBlockers,
      readiness: readyForOperatorExecution
        ? "ready_for_operator_execution"
        : dependencyBlockers.length > 0 || baseReadiness.ready_for_operator_execution
          ? "partially_ready"
          : "not_ready",
      status: readyForOperatorExecution ? "planned" : "blocked",
      blocked_reason: readyForOperatorExecution
        ? null
        : gateStatuses.find((gate) => gate.status !== "approved" && gate.status !== "not_applicable")?.detail ?? plannedAction.blocked_reason,
      dry_run: true as const,
      executed: false as const,
    };
  });

  const executableActions = orderedActions.filter((action) => action.ready_for_operator_execution).map((action) => action.action_id);
  const blockedActions = orderedActions.filter((action) => !action.ready_for_operator_execution).map((action) => action.action_id);
  const dependencyBlockedActions = orderedActions.filter((action) => action.dependency_blockers.length > 0).map((action) => action.action_id);
  const missingGates = [...new Set(orderedActions.flatMap((action) => action.missing_gates.map((gate) => `${action.action_id}:${gate}`)))];
  const chainReadiness: UnityMutationExecutionChainReadiness = executableActions.length === orderedActions.length && orderedActions.length > 0
    ? "ready_for_operator_execution"
    : executableActions.length > 0
      ? "partially_ready"
      : "not_ready";
  const blockedReason = resolvedPlan.blockedReason
    ?? orderedActions.find((action) => action.blocked_reason)?.blocked_reason
    ?? null;

  const baseResult: UnityMutationExecutionChainReadinessResult = {
    chain_id: input.chain_id.trim(),
    chain_status: resolvedPlan.blockedReason ? "chain_blocked" : "chain_planned",
    chain_readiness: chainReadiness,
    domain: "Unity",
    request_type: "scene_object_creation_request",
    execution_mode: "multi_action_chain_readiness_only",
    execution_kind: blockedReason ? "chain_readiness_blocked" : "chain_readiness_only",
    review_approval_id: input.review_state.review_package_id,
    review_approval_status: reviewApproved ? "approved" : "missing",
    operator_approval_id: input.review_state.operator_approval_id,
    operator_approval_status: operatorApproved ? "approved" : "missing",
    ordered_actions: orderedActions,
    action_dependencies: resolvedPlan.actionDependencies,
    rollback_plan: resolvedPlan.rollbackPlan,
    rollback_order: resolvedPlan.rollbackPlan.map((entry) => entry.source_action_id),
    required_approvals: resolvedPlan.requiredApprovals,
    total_actions: orderedActions.length,
    ready_actions: executableActions,
    blocked_actions: blockedActions,
    dependency_blocked_actions: dependencyBlockedActions,
    executable_actions: executableActions,
    missing_gates: missingGates,
    dependency_graph: resolvedPlan.dependencyGraph,
    rollback_graph: resolvedPlan.rollbackGraph,
    chain_ready: chainReadiness === "ready_for_operator_execution",
    dry_run: true,
    executed: false,
    blocked_reason: blockedReason,
    recommended_next_operator_action: chainReadiness === "ready_for_operator_execution"
      ? "Chain readiness is satisfied for all actions. Hold execution until a future explicit operator execution step authorizes it."
      : chainReadiness === "partially_ready"
        ? "Resolve the remaining blocked gates before any future explicit operator execution step is considered."
        : "Resolve the blocked gates and dependency blockers before any future explicit operator execution step is considered.",
    artifact_label: "unity_mutation_execution_chain_readiness",
    review_package: null,
    delivery_package: null,
    mutating: false,
  };

  const readinessPackages = createUnityMutationExecutionChainReadinessPackages(input, baseResult);

  return {
    ...baseResult,
    review_package: readinessPackages.reviewPackage,
    delivery_package: readinessPackages.deliveryPackage,
  };
}

export async function executeUnitySceneObjectCreationMutation(
  input: UnitySceneObjectCreationMutationExecutionInput,
  options?: UnitySceneObjectCreationMutationExecutionOptions,
): Promise<UnitySceneObjectCreationMutationExecutionResult> {
  if (!isSceneObjectCreationOnlyPacket(input.planning_packet)) {
    return buildBlockedUnitySceneObjectCreationMutationResult(
      input,
      "Only scene_object_creation_request is executable through the first controlled Unity mutation path.",
    );
  }

  const expectedPlan = buildUnitySceneObjectCreationExecutionPlan(input);
  if (expectedPlan.execution_kind !== "execution_plan_only") {
    return buildBlockedUnitySceneObjectCreationMutationResult(
      input,
      expectedPlan.blocked_reason ?? "The controlled Unity mutation plan does not satisfy all required gates.",
    );
  }

  if (!input.execution_plan) {
    return buildBlockedUnitySceneObjectCreationMutationResult(
      input,
      "Controlled Unity mutation requires an approved execution plan artifact before mutation can run.",
    );
  }

  if (
    input.execution_plan.request_id !== input.adapter_request_id
    || input.execution_plan.target_scene !== input.target_scene.trim()
    || input.execution_plan.requested_object_name !== input.requested_object_name.trim()
  ) {
    return buildBlockedUnitySceneObjectCreationMutationResult(
      input,
      "Controlled Unity mutation execution plan does not match the reviewed request scope.",
    );
  }

  if (input.execution_plan.execution_kind !== "execution_plan_only" || !hasAllRequiredMutationPlanGatesApproved(input.execution_plan)) {
    return buildBlockedUnitySceneObjectCreationMutationResult(
      input,
      "Controlled Unity mutation execution plan is not fully approved across the required gate stack.",
    );
  }

  if (!expectedPlan.mutation_switch_evaluation.enabled) {
    return buildBlockedUnitySceneObjectCreationMutationResult(
      input,
      expectedPlan.mutation_switch_evaluation.blocked_reason ?? "Controlled Unity mutation requires a valid enabled final mutation switch.",
    );
  }

  const mutationBridge = options?.mutation_bridge ?? createConfiguredUnityMutationRuntimeBridge();
  const bridgeResult = await mutationBridge.executeSceneObjectCreation({
    request_id: input.adapter_request_id,
    requested_at: input.requested_at,
    target_scene: input.target_scene.trim(),
    object_name: input.requested_object_name.trim(),
    mutation_type: "scene_object_creation_request",
    mutation_enabled: true,
    idempotent_on_duplicate: input.idempotent_on_duplicate ?? true,
  });

  const baseResult: UnitySceneObjectCreationMutationExecutionResult = bridgeResult.bridge_status === "bridge_ready"
    ? {
        request_id: input.adapter_request_id,
        domain: "Unity",
        request_type: "scene_object_creation_request",
        mutation_type: "scene_object_creation_request",
        execution_mode: "controlled_mutation_runtime_bridge",
        execution_kind: bridgeResult.mutation_status === "mutation_idempotent" ? "controlled_mutation_idempotent" : "controlled_mutation_executed",
        review_approval_id: input.review_state.review_package_id,
        review_approval_status: "approved",
        operator_approval_id: input.review_state.operator_approval_id,
        operator_approval_status: "approved",
        target_scene: bridgeResult.target_scene,
        requested_object_name: input.requested_object_name.trim(),
        created_object_name: bridgeResult.created_object_name,
        duplicate_handling: bridgeResult.duplicate_handling,
        mutation_enabled: true,
        executed: bridgeResult.mutation_status === "mutation_executed",
        scene_saved: bridgeResult.scene_saved,
        final_mutation_switch_required: true,
        final_mutation_switch_enabled: true,
        evidence_timestamp: bridgeResult.evidence_timestamp,
        rollback_hint: bridgeResult.rollback_hint,
        delivery_summary: bridgeResult.summary,
        blocked_reason: null,
        artifact_label: "unity_controlled_scene_mutation_result",
        review_package: null,
        delivery_package: null,
        mutating: bridgeResult.mutation_status === "mutation_executed",
      }
    : {
        request_id: input.adapter_request_id,
        domain: "Unity",
        request_type: "scene_object_creation_request",
        mutation_type: "scene_object_creation_request",
        execution_mode: "controlled_mutation_runtime_bridge",
        execution_kind: bridgeResult.bridge_status === "bridge_unavailable" ? "controlled_mutation_unavailable" : "controlled_mutation_failed",
        review_approval_id: input.review_state.review_package_id,
        review_approval_status: "approved",
        operator_approval_id: input.review_state.operator_approval_id,
        operator_approval_status: "approved",
        target_scene: input.target_scene.trim(),
        requested_object_name: input.requested_object_name.trim(),
        created_object_name: null,
        duplicate_handling: null,
        mutation_enabled: true,
        executed: false,
        scene_saved: false,
        final_mutation_switch_required: true,
        final_mutation_switch_enabled: true,
        evidence_timestamp: bridgeResult.evidence_timestamp,
        rollback_hint: "Rollback is not available because the controlled Unity mutation did not complete.",
        delivery_summary: bridgeResult.reason,
        blocked_reason: bridgeResult.reason,
        artifact_label: "unity_controlled_scene_mutation_result",
        review_package: null,
        delivery_package: null,
        mutating: false,
      };

  const mutationPackages = createUnitySceneObjectCreationMutationPackages(input, baseResult);

  return {
    ...baseResult,
    review_package: mutationPackages.reviewPackage,
    delivery_package: mutationPackages.deliveryPackage,
  };
}

export async function executeUnitySceneObjectCreationRollback(
  input: UnitySceneObjectCreationRollbackExecutionInput,
  options?: UnitySceneObjectCreationRollbackExecutionOptions,
): Promise<UnitySceneObjectCreationRollbackExecutionResult> {
  if (!isSceneObjectCreationOnlyPacket(input.planning_packet)) {
    return buildBlockedUnitySceneObjectCreationRollbackResult(
      input,
      "Only scene_object_creation_request is executable through the first controlled Unity rollback path.",
    );
  }

  const expectedPlan = buildUnitySceneObjectCreationRollbackPlan(input);
  if (expectedPlan.execution_kind !== "rollback_plan_only") {
    return buildBlockedUnitySceneObjectCreationRollbackResult(
      input,
      expectedPlan.blocked_reason ?? "The controlled Unity rollback plan does not satisfy all required gates.",
    );
  }

  if (!input.execution_plan) {
    return buildBlockedUnitySceneObjectCreationRollbackResult(
      input,
      "Controlled Unity rollback requires an approved rollback plan artifact before rollback can run.",
    );
  }

  if (
    input.execution_plan.rollback_request_id !== input.adapter_request_id
    || input.execution_plan.target_scene !== input.target_scene.trim()
    || input.execution_plan.target_object_name !== input.target_object_name.trim()
  ) {
    return buildBlockedUnitySceneObjectCreationRollbackResult(
      input,
      "Controlled Unity rollback execution plan does not match the reviewed rollback request scope.",
    );
  }

  if (input.execution_plan.execution_kind !== "rollback_plan_only" || !hasAllRequiredRollbackPlanGatesApproved(input.execution_plan)) {
    return buildBlockedUnitySceneObjectCreationRollbackResult(
      input,
      "Controlled Unity rollback execution plan is not fully approved across the required rollback gate stack.",
    );
  }

  if (!expectedPlan.rollback_switch_evaluation.enabled) {
    return buildBlockedUnitySceneObjectCreationRollbackResult(
      input,
      expectedPlan.rollback_switch_evaluation.blocked_reason ?? "Controlled Unity rollback requires a valid enabled final rollback switch.",
    );
  }

  const mutationBridge = options?.mutation_bridge ?? createConfiguredUnityMutationRuntimeBridge();
  const bridgeResult = await mutationBridge.executeSceneObjectRemoval({
    request_id: input.adapter_request_id,
    requested_at: input.requested_at,
    target_scene: input.target_scene.trim(),
    object_name: input.target_object_name.trim(),
    rollback_type: "scene_object_removal",
    rollback_enabled: true,
    idempotent_on_missing: input.idempotent_on_missing ?? true,
  });

  const baseResult: UnitySceneObjectCreationRollbackExecutionResult = bridgeResult.bridge_status === "bridge_ready"
    ? {
        rollback_request_id: input.adapter_request_id,
        domain: "Unity",
        request_type: "scene_object_creation_request",
        rollback_type: "scene_object_removal",
        execution_mode: "controlled_rollback_runtime_bridge",
        execution_kind: bridgeResult.rollback_status === "rollback_idempotent" ? "controlled_rollback_idempotent" : "controlled_rollback_executed",
        review_approval_id: input.review_state.review_package_id,
        review_approval_status: "approved",
        operator_approval_id: input.review_state.operator_approval_id,
        operator_approval_status: "approved",
        target_scene: bridgeResult.target_scene,
        target_object_name: input.target_object_name.trim(),
        removed_object_name: bridgeResult.removed_object_name,
        rollback_enabled: true,
        executed: bridgeResult.rollback_status === "rollback_executed",
        scene_saved: bridgeResult.scene_saved,
        target_missing_handling: bridgeResult.target_missing_handling,
        final_rollback_switch_required: true,
        final_rollback_switch_enabled: true,
        evidence_timestamp: bridgeResult.evidence_timestamp,
        delivery_summary: bridgeResult.summary,
        blocked_reason: null,
        artifact_label: "unity_controlled_scene_rollback_result",
        review_package: null,
        delivery_package: null,
        mutating: bridgeResult.rollback_status === "rollback_executed",
      }
    : {
        rollback_request_id: input.adapter_request_id,
        domain: "Unity",
        request_type: "scene_object_creation_request",
        rollback_type: "scene_object_removal",
        execution_mode: "controlled_rollback_runtime_bridge",
        execution_kind: bridgeResult.bridge_status === "bridge_unavailable" ? "controlled_rollback_unavailable" : "controlled_rollback_failed",
        review_approval_id: input.review_state.review_package_id,
        review_approval_status: "approved",
        operator_approval_id: input.review_state.operator_approval_id,
        operator_approval_status: "approved",
        target_scene: input.target_scene.trim(),
        target_object_name: input.target_object_name.trim(),
        removed_object_name: null,
        rollback_enabled: true,
        executed: false,
        scene_saved: false,
        target_missing_handling: null,
        final_rollback_switch_required: true,
        final_rollback_switch_enabled: true,
        evidence_timestamp: bridgeResult.evidence_timestamp,
        delivery_summary: bridgeResult.reason,
        blocked_reason: bridgeResult.reason,
        artifact_label: "unity_controlled_scene_rollback_result",
        review_package: null,
        delivery_package: null,
        mutating: false,
      };

  const rollbackPackages = createUnitySceneObjectCreationRollbackPackages(input, baseResult);

  return {
    ...baseResult,
    review_package: rollbackPackages.reviewPackage,
    delivery_package: rollbackPackages.deliveryPackage,
  };
}