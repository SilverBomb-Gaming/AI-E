import type {
  UnityProductionPlanningPacket,
  UnityProductionRequestType,
  UnityValidationExecutionResult,
} from "./productionPipelineFoundation";
import {
  autoRecordOutcomeForFeature,
  type AutoRecordOutcomeResult,
} from "./autoOutcomeRecording";
import {
  decidePostPlaytestNextAction,
  type PostPlaytestDecisionResult,
} from "./postPlaytestDecisionEngine";
import {
  buildPostPlaytestExecutionPlan,
  type PostPlaytestExecutionPlanResult,
} from "./postPlaytestExecutionEngine";
import {
  executePostPlaytestFix,
  type PostPlaytestExecutionCheckResult,
  type PostPlaytestExecutionResult,
} from "./postPlaytestExecutor";
import {
  buildPostPlaytestFixPlan,
  type PostPlaytestFixPlanResult,
} from "./postPlaytestFixPlanner";
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
import type { ControlledExecutionDiff } from "./controlledPatchExecutor";

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
  post_playtest_learning?: {
    feature?: string | null;
    projectPath?: string | null;
    runtimeLogPath?: string | null;
  };
  post_playtest_executor?: {
    operator_approval?: boolean;
    retry_count?: number;
    file_changes?: ControlledExecutionDiff[];
    post_execution_check?: () => Promise<PostPlaytestExecutionCheckResult>;
    followup_learning?: {
      feature?: string | null;
      projectPath?: string | null;
      runtimeLogPath?: string | null;
    };
  };
};

export type UnitySceneObjectCreationMutationExecutionOptions = {
  mutation_bridge?: UnityMutationRuntimeBridge;
  runtime_bridge?: UnityReadOnlyRuntimeBridge;
};

export type UnitySceneObjectCreationRollbackExecutionOptions = {
  mutation_bridge?: UnityMutationRuntimeBridge;
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

export type UnityMutationExecutionChainExecutionStatus = "success" | "partial_failure" | "failed";

export type UnityMutationExecutionChainFailureHandlingStatus = "none_required" | "rollback_recommended" | "manual_review_required";

export type UnityMutationExecutionChainFailureClassification = "none" | "simulated_action_failure" | "simulated_runtime_unavailable" | "simulated_gate_mismatch" | "simulated_terminal_stop" | "gate_mismatch" | "state_gate_failed" | "state_verification_failed" | "dependency_failed" | "runtime_unavailable" | "action_failed" | "rollback_failed" | "unsupported_action" | "unknown_failure";

export type UnityMutationExecutionChainFailureSource = "simulation" | "gate" | "dependency" | "runtime" | "rollback" | "adapter" | "unknown";

export type UnityMutationExecutionChainFailureEvidence = {
  classification: UnityMutationExecutionChainFailureClassification;
  source: UnityMutationExecutionChainFailureSource;
  is_simulated: boolean;
  is_recoverable: boolean;
  requires_manual_review: boolean;
  summary: string;
};

export type UnityMutationExecutionChainFailureSimulationKind = "simulated_action_failure" | "simulated_runtime_unavailable" | "simulated_gate_mismatch" | "simulated_terminal_stop";

export type UnityMutationExecutionChainFailureSimulationControl = {
  failure_simulation_id: string;
  enabled: boolean;
  target_action_id: string;
  failure_kind: UnityMutationExecutionChainFailureSimulationKind;
  enabled_by_operator: boolean;
  enabled_at: string;
  expires_at: string | null;
};

export type UnityMutationExecutionChainRollbackPlan = {
  rollback_plan_id: string;
  source_chain_id: string;
  actions_to_rollback: string[];
  rollback_order: string[];
  rollback_targets: UnityMutationExecutionChainRollbackNode[];
  rollback_target_count: number;
  rollback_reason: string;
  required_approvals: string[];
  auto_execute: false;
  executed: false;
};

export type UnityMutationExecutionChainExecutionActionResult = {
  action_id: string;
  action_type: UnityMutationExecutionChainActionType;
  status: "executed" | "failed" | "blocked";
  executed: boolean;
  dependency_satisfied: boolean;
  result:
    | UnitySceneObjectCreationMutationExecutionResult
    | UnitySceneObjectCreationRollbackExecutionResult
    | null;
  failure_reason: string | null;
};

export type ChainStateSnapshot = {
  objectCount: number;
  objects: Array<{
    name: string;
    type?: string;
    exists: boolean;
  }>;
  missingScripts: number;
  consoleErrors: number;
  timestamp: string;
};

export type UnityMutationExecutionChainStateSnapshotRecord = {
  stage: "chain_start" | "before_action" | "after_action" | "failure" | "after_rollback";
  action_id: string | null;
  snapshot: ChainStateSnapshot;
  expected: string;
  observed: string;
  decision: "continue" | "stop" | "manual_review_required";
};

export type UnityMutationExecutionChainExecutionFinalSceneState = {
  target_scene: string | null;
  object_count_before: number | null;
  object_count_after: number | null;
  object_count_delta: number | null;
  summary: string;
};

export type UnityMutationExecutionChainExecutionInput = UnityProductionAdapterInput & {
  chain_id: string;
  readiness_result: UnityMutationExecutionChainReadinessResult | null;
  actions: UnityMutationExecutionChainReadinessActionInput[];
  failure_simulation?: UnityMutationExecutionChainFailureSimulationControl | null;
};

export type UnityMutationExecutionChainExecutionResult = {
  chain_id: string;
  domain: "Unity";
  request_type: "scene_object_creation_request";
  execution_mode: "controlled_multi_action_chain_runtime_bridge";
  execution_kind: "chain_execution_executed" | "chain_execution_partial_failure" | "chain_execution_failed" | "chain_execution_blocked";
  execution_status: UnityMutationExecutionChainExecutionStatus;
  chain_status: UnityMutationExecutionChainStatus;
  chain_readiness: UnityMutationExecutionChainReadiness;
  review_approval_id: string | null;
  review_approval_status: "missing" | "approved";
  operator_approval_id: string | null;
  operator_approval_status: "missing" | "approved";
  action_dependencies: UnityMutationExecutionChainDependencyNode[];
  rollback_preview_plan: UnityMutationExecutionChainRollbackNode[];
  rollback_order: string[];
  total_actions: number;
  actions_executed_count: number;
  actions_failed_count: number;
  failure_handling_status: UnityMutationExecutionChainFailureHandlingStatus;
  failure_classification: UnityMutationExecutionChainFailureClassification;
  failure_source: UnityMutationExecutionChainFailureSource;
  failure_is_simulated: boolean;
  failure_is_recoverable: boolean;
  failure_requires_manual_review: boolean;
  failure_evidence_summary: string;
  failed_action_id: string | null;
  successful_action_ids: string[];
  rollback_plan_required: boolean;
  rollback_plan: UnityMutationExecutionChainRollbackPlan | null;
  manual_review_required: boolean;
  failure_simulated: boolean;
  failure_simulation_id: string | null;
  simulated_failure_kind: UnityMutationExecutionChainFailureSimulationKind | null;
  simulation_target_action_id: string | null;
  per_action_results: UnityMutationExecutionChainExecutionActionResult[];
  state_snapshots: UnityMutationExecutionChainStateSnapshotRecord[];
  final_scene_state: UnityMutationExecutionChainExecutionFinalSceneState;
  blocked_reason: string | null;
  recommended_next_operator_action: string;
  dry_run: false;
  executed: boolean;
  artifact_label: "unity_mutation_execution_chain_result";
  review_package: AutonomousReviewPackage | null;
  delivery_package: AutonomousDeliveryPackage | null;
  mutating: boolean;
};

export type UnityPlannedChainRollbackExecutionActionInput = {
  source_action_id: string;
  rollback_request_id: string;
  rollback_action_type: "unity_scene_object_removal";
  target_scene: string;
  target_object_name: string;
  authorization: UnityRollbackExecutionAuthorization | null;
  live_validation_result?: UnitySceneObjectCreationRollbackExecutionPlanInput["live_validation_result"];
  execution_plan: UnitySceneObjectCreationRollbackExecutionPlanResult | null;
  rollback_switch: UnityRollbackExecutionSwitch | null;
  rollback_execution_mode_enabled?: boolean;
};

export type UnityPlannedChainRollbackExecutionInput = UnityProductionAdapterInput & {
  chain_id: string;
  rollback_plan: UnityMutationExecutionChainRollbackPlan | null;
  source_execution_result: UnityMutationExecutionChainExecutionResult | null;
  rollback_actions: UnityPlannedChainRollbackExecutionActionInput[];
};

export type UnityPlannedChainRollbackExecutionStatus = "success" | "partial_failure" | "failed";

export type UnityPlannedChainRollbackExecutionActionResult = {
  source_action_id: string;
  rollback_request_id: string;
  rollback_action_type: "unity_scene_object_removal";
  status: "executed" | "failed" | "blocked";
  executed: boolean;
  result: UnitySceneObjectCreationRollbackExecutionResult | null;
  failure_reason: string | null;
};

export type UnityPlannedChainRollbackExecutionResult = {
  rollback_plan_id: string | null;
  chain_id: string;
  domain: "Unity";
  request_type: "scene_object_creation_request";
  rollback_type: "scene_object_removal";
  execution_mode: "controlled_planned_chain_rollback_runtime_bridge";
  execution_kind:
    | "planned_chain_rollback_executed"
    | "planned_chain_rollback_partial_failure"
    | "planned_chain_rollback_failed"
    | "planned_chain_rollback_blocked";
  review_approval_id: string | null;
  review_approval_status: "missing" | "approved";
  operator_approval_id: string | null;
  operator_approval_status: "missing" | "approved";
  manual_trigger: true;
  auto_execute: false;
  executed: boolean;
  execution_status: UnityPlannedChainRollbackExecutionStatus;
  actions_executed_count: number;
  actions_failed_count: number;
  failure_classification: UnityMutationExecutionChainFailureClassification;
  failure_source: UnityMutationExecutionChainFailureSource;
  failure_is_simulated: boolean;
  failure_is_recoverable: boolean;
  failure_requires_manual_review: boolean;
  failure_evidence_summary: string;
  per_action_results: UnityPlannedChainRollbackExecutionActionResult[];
  remaining_actions_not_executed: string[];
  final_scene_state: UnityMutationExecutionChainExecutionFinalSceneState;
  evidence_timestamp: string;
  blocked_reason: string | null;
  recommended_next_operator_action: string;
  artifact_label: "unity_mutation_execution_chain_rollback_result";
  review_package: AutonomousReviewPackage | null;
  delivery_package: AutonomousDeliveryPackage | null;
  mutating: boolean;
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
const CONTROLLED_MUTATION_COMPANION_OBJECT_NAME = "AIE_ControlledMutationProbe_Companion";
const CONTROLLED_CHAIN_CREATION_TARGET_OBJECT_NAMES = new Set([
  CONTROLLED_MUTATION_TARGET_OBJECT_NAME,
  CONTROLLED_MUTATION_COMPANION_OBJECT_NAME,
]);
const CONTROLLED_ROLLBACK_TARGET_OBJECT_NAMES = new Set([
  CONTROLLED_MUTATION_TARGET_OBJECT_NAME,
  CONTROLLED_MUTATION_COMPANION_OBJECT_NAME,
]);

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

function formatControlledChainCreationTargets(): string {
  return [...CONTROLLED_CHAIN_CREATION_TARGET_OBJECT_NAMES].join(", ");
}

function formatControlledRollbackTargets(): string {
  return [...CONTROLLED_ROLLBACK_TARGET_OBJECT_NAMES].join(", ");
}

function evaluateControlledChainCreationTarget(
  targetScene: string,
  targetObjectName: string,
): { status: "approved" | "invalid"; detail: string; } {
  if (targetScene !== CONTROLLED_MUTATION_TARGET_SCENE) {
    return {
      status: "invalid",
      detail: `Controlled Unity chain creation is limited to ${CONTROLLED_MUTATION_TARGET_SCENE}, but received ${targetScene}.`,
    };
  }

  if (!CONTROLLED_CHAIN_CREATION_TARGET_OBJECT_NAMES.has(targetObjectName)) {
    return {
      status: "invalid",
      detail: `Controlled Unity chain creation is limited to ${formatControlledChainCreationTargets()}, but received ${targetObjectName}.`,
    };
  }

  return {
    status: "approved",
    detail: `Controlled Unity chain creation target is limited correctly to ${targetObjectName} in ${CONTROLLED_MUTATION_TARGET_SCENE}.`,
  };
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

  if (!CONTROLLED_ROLLBACK_TARGET_OBJECT_NAMES.has(targetObjectName)) {
    return {
      status: "invalid",
      detail: `Controlled Unity rollback is limited to ${formatControlledRollbackTargets()}, but received ${targetObjectName}.`,
    };
  }

  return {
    status: "approved",
    detail: `Controlled Unity rollback target is limited correctly to ${targetObjectName} in ${CONTROLLED_MUTATION_TARGET_SCENE}.`,
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

    if (action.action_type === "unity_scene_object_creation") {
      const controlledCreationTarget = evaluateControlledChainCreationTarget(action.target_scene, action.target_object_name);
      if (controlledCreationTarget.status !== "approved") {
        return {
          orderedActions: [],
          actionDependencies: [],
          rollbackPlan: [],
          requiredApprovals: [],
          dependencyGraph: [],
          rollbackGraph: [],
          executableActions: [],
          blockedActions: [],
          blockedReason: `Unity mutation execution chain action ${action.action_id} does not map to the verified bounded chain creation lane in ${CONTROLLED_MUTATION_TARGET_SCENE}. ${controlledCreationTarget.detail}`,
        };
      }
    } else {
      const controlledRollbackTarget = evaluateControlledRollbackTarget(action.target_scene, action.target_object_name);
      if (controlledRollbackTarget.status !== "approved") {
        return {
          orderedActions: [],
          actionDependencies: [],
          rollbackPlan: [],
          requiredApprovals: [],
          dependencyGraph: [],
          rollbackGraph: [],
          executableActions: [],
          blockedActions: [],
          blockedReason: `Unity mutation execution chain action ${action.action_id} does not map to the verified rollback lane in ${CONTROLLED_MUTATION_TARGET_SCENE}. ${controlledRollbackTarget.detail}`,
        };
      }
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

function createUnityMutationExecutionChainExecutionPackages(
  input: UnityMutationExecutionChainExecutionInput,
  result: UnityMutationExecutionChainExecutionResult,
): {
  reviewPackage: AutonomousReviewPackage;
  deliveryPackage: AutonomousDeliveryPackage;
} {
  const summary = `CONTROLLED UNITY CHAIN EXECUTION: ${result.chain_id} completed with status ${result.execution_status}.`;
  const proofResults = [
    `Execution kind: ${result.execution_kind}`,
    `Chain id: ${result.chain_id}`,
    `Execution status: ${result.execution_status}`,
    `Failure handling status: ${result.failure_handling_status}`,
    `Failure classification: ${result.failure_classification}`,
    `Failure source: ${result.failure_source}`,
    `Failure is simulated: ${String(result.failure_is_simulated)}`,
    `Failure is recoverable: ${String(result.failure_is_recoverable)}`,
    `Failure requires manual review: ${String(result.failure_requires_manual_review)}`,
    `Failure evidence summary: ${result.failure_evidence_summary}`,
    `Failed action id: ${result.failed_action_id ?? "none"}`,
    `Successful action ids: ${result.successful_action_ids.join(", ") || "none"}`,
    `Failure simulated: ${String(result.failure_simulated)}`,
    `Failure simulation id: ${result.failure_simulation_id ?? "none"}`,
    `Simulated failure kind: ${result.simulated_failure_kind ?? "none"}`,
    `Simulation target action id: ${result.simulation_target_action_id ?? "none"}`,
    `Rollback plan required: ${String(result.rollback_plan_required)}`,
    `Manual review required: ${String(result.manual_review_required)}`,
    `Chain status: ${result.chain_status}`,
    `Chain readiness: ${result.chain_readiness}`,
    `Execution mode: ${result.execution_mode}`,
    `Total actions: ${String(result.total_actions)}`,
    `Actions executed count: ${String(result.actions_executed_count)}`,
    `Actions failed count: ${String(result.actions_failed_count)}`,
    `Executed: ${String(result.executed)}`,
    `Final scene state: ${result.final_scene_state.summary}`,
    ...(result.rollback_plan
      ? [
          `Rollback plan id: ${result.rollback_plan.rollback_plan_id}`,
          `Rollback target count: ${String(result.rollback_plan.rollback_target_count)}`,
          `Rollback reason: ${result.rollback_plan.rollback_reason}`,
          `Rollback actions: ${result.rollback_plan.actions_to_rollback.join(", ") || "none"}`,
          `Rollback order: ${result.rollback_plan.rollback_order.join(", ") || "none"}`,
          ...result.rollback_plan.rollback_targets.map((target) => `Rollback target ${String(target.order)}: ${target.target_object_name} from ${target.source_action_id}`),
          `Rollback auto execute: ${String(result.rollback_plan.auto_execute)}`,
          `Rollback executed: ${String(result.rollback_plan.executed)}`,
          ...result.rollback_plan.required_approvals.map((approval) => `Rollback required approval: ${approval}`),
        ]
      : []),
    ...result.action_dependencies.map((entry) => `Dependency graph: ${entry.action_id} <= ${entry.depends_on.join(", ") || "none"}`),
    ...result.rollback_preview_plan.map((entry) => `Rollback graph: ${entry.source_action_id} => ${entry.rollback_action_type} ${entry.target_object_name}`),
    ...result.per_action_results.map((action) => `Action result: ${action.action_id} => ${action.status}${action.failure_reason ? ` (${action.failure_reason})` : ""}`),
    ...result.state_snapshots.map((entry) => `State snapshot: ${entry.stage}${entry.action_id ? `:${entry.action_id}` : ""} => ${describeChainSnapshot(entry.snapshot)}`),
    ...result.state_snapshots.map((entry) => `State expectation: ${entry.stage}${entry.action_id ? `:${entry.action_id}` : ""} => ${entry.expected}`),
    ...result.state_snapshots.map((entry) => `State observation: ${entry.stage}${entry.action_id ? `:${entry.action_id}` : ""} => ${entry.observed}`),
    ...result.state_snapshots.map((entry) => `State decision: ${entry.stage}${entry.action_id ? `:${entry.action_id}` : ""} => ${entry.decision}`),
    `Recommended next operator action: ${result.recommended_next_operator_action}`,
    ...(result.blocked_reason ? [`Blocked reason: ${result.blocked_reason}`] : []),
  ];

  const reviewPackage = createAutonomousReviewPackage({
    package_id: `unity-chain-execution-review-${result.chain_id}`,
    work_item_id: `unity-chain-execution-${result.chain_id}`,
    chain_id: `unity-chain-execution-chain-${result.chain_id}`,
    status: result.execution_status === "success" ? "approved" : "pending",
    summary,
    files_changed: [],
    tests_run: ["unity mutation execution chain controlled execution"],
    proof_results: proofResults,
    risks: result.execution_status !== "success"
      ? [
          "CHAIN EXECUTION STOPPED",
          ...(result.state_snapshots.length > 0 ? ["STATE SNAPSHOT CAPTURED"] : []),
          ...(result.failure_classification === "state_gate_failed" ? ["PRE-ACTION STATE GATE FAILED", "CHAIN STOPPED BEFORE MUTATION"] : []),
          ...(result.failure_classification === "state_verification_failed" ? ["STATE DRIFT DETECTED"] : []),
          ...(result.failure_simulated ? ["CONTROLLED FAILURE SIMULATION", "SIMULATED FAILURE"] : []),
          result.blocked_reason ?? "A controlled Unity chain action failed.",
          ...(result.rollback_plan_required ? ["ROLLBACK PLAN REQUIRED", "ROLLBACK PLAN GENERATED", "ROLLBACK NOT AUTO-EXECUTED"] : []),
        ]
      : [
          "CONTROLLED UNITY CHAIN EXECUTION",
          ...(result.state_snapshots.length > 0 ? ["STATE SNAPSHOT CAPTURED", "PRE-ACTION STATE GATE PASSED", "POST-ACTION STATE VERIFIED"] : []),
        ],
    recommended_decision: result.execution_status === "success" ? "approve" : "review_required",
    rollback_notes: result.rollback_order.length > 0
      ? `ROLLBACK ORDER PREVIEW: ${result.rollback_order.join(" -> ")}`
      : "No rollback order preview is available for this chain.",
    operator_actions: ["approve", "archive"],
  });

  const deliveryPackage = createAutonomousDeliveryPackage({
    delivery_package_id: `unity-chain-execution-delivery-${result.chain_id}`,
    review_package_id: reviewPackage.package_id,
    work_item_id: reviewPackage.work_item_id,
    chain_id: reviewPackage.chain_id,
    branch_name: "",
    commit_plan: [
      "Controlled Unity chain execution completed through the bounded Layer 15 lanes.",
      `Execution status: ${result.execution_status}`,
      `Final scene state: ${result.final_scene_state.summary}`,
      ...(result.rollback_plan_required
        ? [
            `Rollback plan required: ${result.rollback_plan?.rollback_order.join(", ") || "none"}`,
            "Rollback remains separately approved and was not auto-executed.",
          ]
        : []),
      ...(result.failure_simulated
        ? [
            `Controlled failure simulation: ${result.simulated_failure_kind ?? "unknown"}`,
            "Simulated failure is operator-enabled test evidence only and is not a real Unity runtime failure.",
          ]
        : []),
    ],
    files_changed: [],
    validation_results: proofResults,
    proof_results: [
      result.execution_status,
      result.final_scene_state.summary,
      ...(result.state_snapshots.length > 0 ? ["STATE SNAPSHOT CAPTURED"] : []),
      ...(result.state_snapshots.some((entry) => entry.stage === "before_action" && entry.decision === "continue") ? ["PRE-ACTION STATE GATE PASSED"] : []),
      ...(result.failure_classification === "state_gate_failed" ? ["PRE-ACTION STATE GATE FAILED", "CHAIN STOPPED BEFORE MUTATION"] : []),
      ...(result.state_snapshots.some((entry) => (entry.stage === "after_action" || entry.stage === "after_rollback") && entry.decision === "continue") ? ["POST-ACTION STATE VERIFIED"] : []),
      ...(result.failure_classification === "state_verification_failed" ? ["STATE DRIFT DETECTED"] : []),
      ...(result.failure_simulated ? ["CONTROLLED FAILURE SIMULATION", "SIMULATED FAILURE"] : []),
      ...(result.rollback_plan_required ? ["ROLLBACK PLAN REQUIRED", "ROLLBACK PLAN GENERATED", "ROLLBACK NOT AUTO-EXECUTED"] : []),
    ],
    risk_summary: result.blocked_reason ?? "Controlled Unity chain execution completed within the approved lane.",
    rollback_plan: result.rollback_order.join(" | ") || "No rollback order preview available.",
    release_notes: summary,
    recommended_pr_title: "",
    recommended_pr_body: `Unity chain execution handoff\n\nSummary: ${summary}\n\nNext operator action: ${result.recommended_next_operator_action}`,
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

function createUnityPlannedChainRollbackExecutionPackages(
  input: UnityPlannedChainRollbackExecutionInput,
  result: UnityPlannedChainRollbackExecutionResult,
): {
  reviewPackage: AutonomousReviewPackage;
  deliveryPackage: AutonomousDeliveryPackage;
} {
  const successfulRollbackResults = result.per_action_results
    .filter((action) => action.status === "executed" && action.result)
    .map((action) => action.result as UnitySceneObjectCreationRollbackExecutionResult);
  const removedObjectNames = [...new Set(successfulRollbackResults.map((action) => action.removed_object_name).filter(Boolean))];
  const targetMissingHandlingValues = [...new Set(successfulRollbackResults.map((action) => action.target_missing_handling).filter(Boolean))];
  const removedObjectNameSummary = removedObjectNames.join(", ") || "none";
  const targetMissingHandlingSummary = targetMissingHandlingValues.length === 1
    ? targetMissingHandlingValues[0]
    : targetMissingHandlingValues.length > 1
      ? "mixed"
      : "none";
  const rollbackTargetOutcome = targetMissingHandlingSummary === "already_missing_idempotent"
    ? "TARGET ALREADY MISSING"
    : targetMissingHandlingSummary === "removed"
      ? "TARGET REMOVED"
      : "TARGET NOT REMOVED";
  const summary = `ROLLBACK EXECUTION: Controlled Unity chain rollback plan ${result.rollback_plan_id ?? "unknown"} completed with status ${result.execution_status}.`;
  const proofResults = [
    `Execution kind: ${result.execution_kind}`,
    `Chain id: ${result.chain_id}`,
    `Rollback plan id: ${result.rollback_plan_id ?? "none"}`,
    `Execution status: ${result.execution_status}`,
    `Manual trigger: ${String(result.manual_trigger)}`,
    `Executed: ${String(result.executed)}`,
    ...(result.executed && result.execution_status === "success" ? ["MANUAL ROLLBACK EXECUTED"] : []),
    `Actions executed count: ${String(result.actions_executed_count)}`,
    `Actions failed count: ${String(result.actions_failed_count)}`,
    `Removed object name: ${removedObjectNameSummary}`,
    `Target missing handling: ${targetMissingHandlingSummary}`,
    `Failure classification: ${result.failure_classification}`,
    `Failure source: ${result.failure_source}`,
    `Failure is simulated: ${String(result.failure_is_simulated)}`,
    `Failure is recoverable: ${String(result.failure_is_recoverable)}`,
    `Failure requires manual review: ${String(result.failure_requires_manual_review)}`,
    `Manual review required: ${String(result.failure_requires_manual_review)}`,
    `Failure evidence summary: ${result.failure_evidence_summary}`,
    `Remaining actions not executed: ${result.remaining_actions_not_executed.join(", ") || "none"}`,
    `Final scene state: ${result.final_scene_state.summary}`,
    `Evidence timestamp: ${result.evidence_timestamp}`,
    ...result.per_action_results.map((action) => `Action result: ${action.source_action_id} => ${action.status}${action.failure_reason ? ` (${action.failure_reason})` : ""}`),
    `Recommended next operator action: ${result.recommended_next_operator_action}`,
    ...(result.blocked_reason ? [`Blocked reason: ${result.blocked_reason}`] : []),
  ];

  const reviewPackage = createAutonomousReviewPackage({
    package_id: `unity-chain-rollback-review-${result.rollback_plan_id ?? result.chain_id}`,
    work_item_id: `unity-chain-rollback-${result.rollback_plan_id ?? result.chain_id}`,
    chain_id: `unity-chain-rollback-chain-${result.chain_id}`,
    status: result.execution_status === "success" ? "approved" : "pending",
    summary,
    files_changed: [],
    tests_run: ["unity mutation execution chain manual rollback execution"],
    proof_results: proofResults,
    risks: result.execution_status === "success"
      ? ["ROLLBACK EXECUTION", "MANUAL TRIGGER", "MANUAL ROLLBACK EXECUTED", rollbackTargetOutcome, "ROLLBACK NOT AUTO-EXECUTED"]
      : ["ROLLBACK EXECUTION STOPPED", "MANUAL TRIGGER", "ROLLBACK NOT AUTO-EXECUTED"],
    recommended_decision: result.execution_status === "success" ? "approve" : "review_required",
    rollback_notes: `ROLLBACK PLAN ${result.rollback_plan_id ?? "unknown"}: ${result.remaining_actions_not_executed.join(" | ") || "fully executed"}`,
    operator_actions: ["approve", "archive"],
  });

  const deliveryPackage = createAutonomousDeliveryPackage({
    delivery_package_id: `unity-chain-rollback-delivery-${result.rollback_plan_id ?? result.chain_id}`,
    review_package_id: reviewPackage.package_id,
    work_item_id: reviewPackage.work_item_id,
    chain_id: reviewPackage.chain_id,
    branch_name: "",
    commit_plan: [
      "Controlled Unity chain rollback executed only through the reviewed Layer 15 rollback lane.",
      `Execution status: ${result.execution_status}`,
      `Manual trigger: ${String(result.manual_trigger)}`,
      `Final scene state: ${result.final_scene_state.summary}`,
    ],
    files_changed: [],
    validation_results: proofResults,
    proof_results: [
      "ROLLBACK EXECUTION",
      "MANUAL TRIGGER",
      ...(result.executed && result.execution_status === "success" ? ["MANUAL ROLLBACK EXECUTED"] : []),
      ...(result.execution_status === "success" ? [rollbackTargetOutcome] : []),
      result.execution_status,
      result.final_scene_state.summary,
    ],
    risk_summary: result.blocked_reason ?? "Manual rollback remained separately gated and was never auto-executed.",
    rollback_plan: `auto_execute=${String(result.auto_execute)} | remaining=${result.remaining_actions_not_executed.join(" | ") || "none"}`,
    release_notes: summary,
    recommended_pr_title: "",
    recommended_pr_body: `Unity chain rollback execution handoff\n\nSummary: ${summary}\n\nNext operator action: ${result.recommended_next_operator_action}`,
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

function extractActionObjectCount(action: UnityMutationExecutionChainReadinessActionInput): number | null {
  return action.live_validation_result?.object_count ?? null;
}

function getUniqueTrackedObjectNames(actions: Array<{ target_object_name: string; }>): string[] {
  return [...new Set(actions.map((action) => action.target_object_name.trim()).filter(Boolean))];
}

function buildChainStateSnapshot(
  observation: Awaited<ReturnType<UnityReadOnlyRuntimeBridge["probeValidation"]>> & { bridge_status: "bridge_ready"; },
  trackedObjectNames: string[],
): ChainStateSnapshot | null {
  if (
    observation.object_count === null
    || observation.missing_script_count === null
    || observation.console_error_count === null
  ) {
    return null;
  }

  return {
    objectCount: observation.object_count,
    objects: trackedObjectNames.map((name) => {
      const matched = observation.tracked_objects.find((item) => item.name === name);
      return {
        name,
        type: matched?.type ?? undefined,
        exists: matched?.exists ?? false,
      };
    }),
    missingScripts: observation.missing_script_count,
    consoleErrors: observation.console_error_count,
    timestamp: observation.evidence_timestamp,
  };
}

async function captureUnityChainStateSnapshot(input: {
  runtimeBridge: UnityReadOnlyRuntimeBridge;
  requestId: string;
  requestedAt: string;
  sceneNameHint: string | null;
  trackedObjectNames: string[];
}): Promise<{ snapshot: ChainStateSnapshot | null; blockedReason: string | null; }> {
  const observation = await input.runtimeBridge.probeValidation({
    request_id: input.requestId,
    requested_at: input.requestedAt,
    scene_name_hint: input.sceneNameHint,
    tracked_object_names: input.trackedObjectNames,
  });

  if (observation.bridge_status !== "bridge_ready") {
    return {
      snapshot: null,
      blockedReason: observation.reason,
    };
  }

  const snapshot = buildChainStateSnapshot(observation, input.trackedObjectNames);
  if (!snapshot) {
    return {
      snapshot: null,
      blockedReason: "Live Unity state snapshot did not include complete object count, missing script, and console error data.",
    };
  }

  return {
    snapshot,
    blockedReason: null,
  };
}

function describeChainSnapshot(snapshot: ChainStateSnapshot): string {
  const objectSummary = snapshot.objects.length > 0
    ? snapshot.objects.map((item) => `${item.name}=${String(item.exists)}`).join(", ")
    : "none";

  return `object_count=${String(snapshot.objectCount)}, missing_scripts=${String(snapshot.missingScripts)}, console_errors=${String(snapshot.consoleErrors)}, tracked_objects=${objectSummary}`;
}

function getTrackedObjectExists(snapshot: ChainStateSnapshot, objectName: string): boolean {
  return snapshot.objects.find((item) => item.name === objectName)?.exists ?? false;
}

function evaluatePreActionStateGate(input: {
  action: UnityMutationExecutionChainReadinessActionInput;
  snapshot: ChainStateSnapshot;
  dependencyActions: UnityMutationExecutionChainReadinessActionInput[];
  dependencyResults: UnityMutationExecutionChainExecutionActionResult[];
}): {
  passed: boolean;
  expected: string;
  observed: string;
  reason: string | null;
  failureClassification: UnityMutationExecutionChainFailureClassification | null;
} {
  const targetObjectName = input.action.target_object_name.trim();
  const targetObjectExists = getTrackedObjectExists(input.snapshot, targetObjectName);
  const expected = input.action.action_type === "unity_scene_object_creation"
    ? `Scene ${input.action.target_scene.trim()} must stay clean, dependencies must exist, and ${targetObjectName} must be absent before mutation.`
    : `Scene ${input.action.target_scene.trim()} must stay clean, dependencies must exist, and ${targetObjectName} must exist before rollback.`;
  const observed = describeChainSnapshot(input.snapshot);

  if (input.dependencyResults.some((dependency) => dependency.status !== "executed")) {
    return {
      passed: false,
      expected,
      observed,
      reason: `State gate blocked ${input.action.action_id} because required dependency outputs were not recorded before execution.`,
      failureClassification: "dependency_failed",
    };
  }

  for (const dependencyAction of input.dependencyActions) {
    const dependencyTargetObjectName = dependencyAction.target_object_name.trim();
    const dependencyTargetExists = getTrackedObjectExists(input.snapshot, dependencyTargetObjectName);
    const dependencyShouldExist = dependencyAction.action_type === "unity_scene_object_creation";
    if (dependencyTargetExists !== dependencyShouldExist) {
      return {
        passed: false,
        expected,
        observed,
        reason: dependencyShouldExist
          ? `Dependency gate blocked ${input.action.action_id} because ${dependencyTargetObjectName} was not present before execution.`
          : `Dependency gate blocked ${input.action.action_id} because ${dependencyTargetObjectName} still exists before execution.`,
        failureClassification: "dependency_failed",
      };
    }
  }

  if (input.snapshot.missingScripts > 0) {
    return {
      passed: false,
      expected,
      observed,
      reason: `State gate blocked ${input.action.action_id} because missing scripts were detected before execution.`,
      failureClassification: "state_gate_failed",
    };
  }

  if (input.snapshot.consoleErrors > 0) {
    return {
      passed: false,
      expected,
      observed,
      reason: `State gate blocked ${input.action.action_id} because console errors were detected before execution.`,
      failureClassification: "state_gate_failed",
    };
  }

  if (input.action.action_type === "unity_scene_object_creation" && targetObjectExists) {
    return {
      passed: false,
      expected,
      observed,
      reason: `State gate blocked ${input.action.action_id} because ${targetObjectName} already exists before mutation.`,
      failureClassification: "state_gate_failed",
    };
  }

  if (input.action.action_type === "unity_scene_object_rollback" && !targetObjectExists) {
    return {
      passed: false,
      expected,
      observed,
      reason: `State gate blocked ${input.action.action_id} because ${targetObjectName} is already absent before rollback.`,
      failureClassification: "state_gate_failed",
    };
  }

  return {
    passed: true,
    expected,
    observed,
    reason: null,
    failureClassification: null,
  };
}

function evaluatePostActionStateVerification(input: {
  action: UnityMutationExecutionChainReadinessActionInput;
  beforeSnapshot: ChainStateSnapshot;
  afterSnapshot: ChainStateSnapshot;
}): { passed: boolean; expected: string; observed: string; reason: string | null; } {
  const targetObjectName = input.action.target_object_name.trim();
  const targetObjectExistsAfter = getTrackedObjectExists(input.afterSnapshot, targetObjectName);
  const expectedDelta = input.action.action_type === "unity_scene_object_creation" ? 1 : -1;
  const actualDelta = input.afterSnapshot.objectCount - input.beforeSnapshot.objectCount;
  const expected = input.action.action_type === "unity_scene_object_creation"
    ? `Object count should increase by 1 and ${targetObjectName} should exist after mutation.`
    : `Object count should decrease by 1 and ${targetObjectName} should be absent after rollback.`;
  const observed = describeChainSnapshot(input.afterSnapshot);

  if (input.afterSnapshot.missingScripts > 0) {
    return {
      passed: false,
      expected,
      observed,
      reason: `State verification detected drift after ${input.action.action_id}: missing scripts increased above zero.`,
    };
  }

  if (input.afterSnapshot.consoleErrors > 0) {
    return {
      passed: false,
      expected,
      observed,
      reason: `State verification detected drift after ${input.action.action_id}: console errors increased above zero.`,
    };
  }

  if (actualDelta !== expectedDelta) {
    return {
      passed: false,
      expected,
      observed,
      reason: `State verification detected drift after ${input.action.action_id}: expected object count delta ${String(expectedDelta)} but observed ${String(actualDelta)}.`,
    };
  }

  if (input.action.action_type === "unity_scene_object_creation" && !targetObjectExistsAfter) {
    return {
      passed: false,
      expected,
      observed,
      reason: `State verification detected drift after ${input.action.action_id}: ${targetObjectName} was not present after mutation.`,
    };
  }

  if (input.action.action_type === "unity_scene_object_rollback" && targetObjectExistsAfter) {
    return {
      passed: false,
      expected,
      observed,
      reason: `State verification detected drift after ${input.action.action_id}: ${targetObjectName} still exists after rollback.`,
    };
  }

  return {
    passed: true,
    expected,
    observed,
    reason: null,
  };
}

function buildChainFinalSceneStateFromSnapshot(
  targetScene: string | null,
  baselineSnapshot: ChainStateSnapshot | null,
  finalSnapshot: ChainStateSnapshot | null,
  fallbackSummary: string,
): UnityMutationExecutionChainExecutionFinalSceneState {
  if (!baselineSnapshot || !finalSnapshot) {
    return {
      target_scene: targetScene,
      object_count_before: baselineSnapshot?.objectCount ?? null,
      object_count_after: finalSnapshot?.objectCount ?? null,
      object_count_delta: baselineSnapshot && finalSnapshot ? finalSnapshot.objectCount - baselineSnapshot.objectCount : null,
      summary: fallbackSummary,
    };
  }

  return {
    target_scene: targetScene,
    object_count_before: baselineSnapshot.objectCount,
    object_count_after: finalSnapshot.objectCount,
    object_count_delta: finalSnapshot.objectCount - baselineSnapshot.objectCount,
    summary: `Scene ${targetScene ?? "unknown"} object count moved from ${String(baselineSnapshot.objectCount)} to ${String(finalSnapshot.objectCount)}.`,
  };
}

function getChainActionCountDelta(
  actionResult: UnityMutationExecutionChainExecutionActionResult,
): number {
  if (!actionResult.result || actionResult.status !== "executed") {
    return 0;
  }

  if (actionResult.action_type === "unity_scene_object_creation") {
    return actionResult.result.execution_kind === "controlled_mutation_executed" ? 1 : 0;
  }

  return actionResult.result.execution_kind === "controlled_rollback_executed" ? -1 : 0;
}

function buildChainExecutionBlockedResult(
  input: UnityMutationExecutionChainExecutionInput,
  readinessResult: UnityMutationExecutionChainReadinessResult | null,
  blockedReason: string,
  failureClassification: UnityMutationExecutionChainFailureClassification = "gate_mismatch",
  failedActionId: string | null = null,
  stateSnapshots: UnityMutationExecutionChainStateSnapshotRecord[] = [],
  finalSceneState?: UnityMutationExecutionChainExecutionFinalSceneState,
): UnityMutationExecutionChainExecutionResult {
  const failureEvidence = classifyUnityChainFailureEvidence({
    context: "chain",
    blockedReason,
    failedActionResult: null,
    simulatedFailureKind: failureClassification.startsWith("simulated_")
      ? failureClassification as UnityMutationExecutionChainFailureSimulationKind
      : null,
  });

  const baseResult: UnityMutationExecutionChainExecutionResult = {
    chain_id: input.chain_id.trim(),
    domain: "Unity",
    request_type: "scene_object_creation_request",
    execution_mode: "controlled_multi_action_chain_runtime_bridge",
    execution_kind: "chain_execution_blocked",
    execution_status: "failed",
    chain_status: readinessResult?.chain_status ?? "chain_blocked",
    chain_readiness: readinessResult?.chain_readiness ?? "not_ready",
    review_approval_id: input.review_state.review_package_id,
    review_approval_status: hasCompletedReview(input.review_state) ? "approved" : "missing",
    operator_approval_id: input.review_state.operator_approval_id,
    operator_approval_status: hasApproval(input.review_state) ? "approved" : "missing",
    action_dependencies: readinessResult?.action_dependencies ?? [],
    rollback_preview_plan: readinessResult?.rollback_plan ?? [],
    rollback_order: readinessResult?.rollback_order ?? [],
    total_actions: readinessResult?.total_actions ?? input.actions.length,
    actions_executed_count: 0,
    actions_failed_count: 0,
    failure_handling_status: failureEvidence.requires_manual_review ? "manual_review_required" : "none_required",
    failure_classification: failureEvidence.classification,
    failure_source: failureEvidence.source,
    failure_is_simulated: failureEvidence.is_simulated,
    failure_is_recoverable: failureEvidence.is_recoverable,
    failure_requires_manual_review: failureEvidence.requires_manual_review,
    failure_evidence_summary: failureEvidence.summary,
    failed_action_id: failedActionId,
    successful_action_ids: [],
    rollback_plan_required: false,
    rollback_plan: null,
    manual_review_required: failureEvidence.requires_manual_review,
    failure_simulated: false,
    failure_simulation_id: null,
    simulated_failure_kind: null,
    simulation_target_action_id: null,
    per_action_results: [],
    state_snapshots: stateSnapshots,
    final_scene_state: finalSceneState ?? {
      target_scene: input.actions[0]?.target_scene?.trim() ?? null,
      object_count_before: input.actions[0] ? extractActionObjectCount(input.actions[0]) : null,
      object_count_after: input.actions.length > 0 ? extractActionObjectCount(input.actions[input.actions.length - 1]) : null,
      object_count_delta: null,
      summary: "Chain execution was blocked before any Unity action ran.",
    },
    blocked_reason: blockedReason,
    recommended_next_operator_action: "Resolve the blocked chain readiness or dependency issue before retrying controlled chain execution.",
    dry_run: false,
    executed: false,
    artifact_label: "unity_mutation_execution_chain_result",
    review_package: null,
    delivery_package: null,
    mutating: false,
  };

  const chainPackages = createUnityMutationExecutionChainExecutionPackages(input, baseResult);

  return {
    ...baseResult,
    review_package: chainPackages.reviewPackage,
    delivery_package: chainPackages.deliveryPackage,
  };
}

function evaluateUnityMutationExecutionChainFailureSimulation(input: {
  simulation: UnityMutationExecutionChainFailureSimulationControl | null | undefined;
  action_id: string;
  evaluated_at: string;
}): {
  applies: boolean;
  blocked_reason: string | null;
} {
  const simulation = input.simulation ?? null;
  if (!simulation) {
    return {
      applies: false,
      blocked_reason: null,
    };
  }

  if (!simulation.enabled || !simulation.enabled_by_operator) {
    return {
      applies: false,
      blocked_reason: null,
    };
  }

  if (simulation.expires_at && simulation.expires_at <= input.evaluated_at) {
    return {
      applies: false,
      blocked_reason: `Failure simulation control ${simulation.failure_simulation_id} expired before chain execution and cannot be used.`,
    };
  }

  if (simulation.target_action_id !== input.action_id) {
    return {
      applies: false,
      blocked_reason: null,
    };
  }

  return {
    applies: true,
    blocked_reason: null,
  };
}

function buildSimulatedChainActionFailureResult(input: {
  action_id: string;
  action_type: UnityMutationExecutionChainActionType;
  failure_kind: UnityMutationExecutionChainFailureSimulationKind;
  failure_simulation_id: string;
}): UnityMutationExecutionChainExecutionActionResult {
  const failureReason = input.failure_kind === "simulated_runtime_unavailable"
    ? `Simulated runtime unavailable triggered for chain action ${input.action_id} by failure simulation ${input.failure_simulation_id}.`
    : input.failure_kind === "simulated_gate_mismatch"
      ? `Simulated gate mismatch triggered for chain action ${input.action_id} by failure simulation ${input.failure_simulation_id}.`
      : `Simulated action failure triggered for chain action ${input.action_id} by failure simulation ${input.failure_simulation_id}.`;

  return {
    action_id: input.action_id,
    action_type: input.action_type,
    status: "failed",
    executed: false,
    dependency_satisfied: true,
    result: null,
    failure_reason: failureReason,
  };
}

function buildSimulatedChainTerminalStopReason(input: {
  action_id: string;
  failure_simulation_id: string;
}): string {
  return `Simulated terminal stop triggered after successful chain action ${input.action_id} by failure simulation ${input.failure_simulation_id}.`;
}

function buildPlannedChainRollbackBlockedResult(
  input: UnityPlannedChainRollbackExecutionInput,
  blockedReason: string,
): UnityPlannedChainRollbackExecutionResult {
  const objectCountBefore = input.rollback_actions[0]?.live_validation_result?.object_count ?? null;
  const failureEvidence = classifyUnityChainFailureEvidence({
    context: "rollback",
    blockedReason,
    failedActionResult: null,
    simulatedFailureKind: null,
  });

  return {
    rollback_plan_id: input.rollback_plan?.rollback_plan_id ?? null,
    chain_id: input.chain_id.trim(),
    domain: "Unity",
    request_type: "scene_object_creation_request",
    rollback_type: "scene_object_removal",
    execution_mode: "controlled_planned_chain_rollback_runtime_bridge",
    execution_kind: "planned_chain_rollback_blocked",
    review_approval_id: input.review_state.review_package_id,
    review_approval_status: hasCompletedReview(input.review_state) ? "approved" : "missing",
    operator_approval_id: input.review_state.operator_approval_id,
    operator_approval_status: hasApproval(input.review_state) ? "approved" : "missing",
    manual_trigger: true,
    auto_execute: false,
    executed: false,
    execution_status: "failed",
    actions_executed_count: 0,
    actions_failed_count: 0,
    failure_classification: failureEvidence.classification,
    failure_source: failureEvidence.source,
    failure_is_simulated: failureEvidence.is_simulated,
    failure_is_recoverable: failureEvidence.is_recoverable,
    failure_requires_manual_review: failureEvidence.requires_manual_review,
    failure_evidence_summary: failureEvidence.summary,
    per_action_results: [],
    remaining_actions_not_executed: input.rollback_plan?.rollback_order ?? input.rollback_actions.map((action) => action.source_action_id),
    final_scene_state: {
      target_scene: input.rollback_actions[0]?.target_scene?.trim() ?? null,
      object_count_before: objectCountBefore,
      object_count_after: objectCountBefore,
      object_count_delta: 0,
      summary: "Rollback execution was blocked before any Unity action ran.",
    },
    evidence_timestamp: input.requested_at,
    blocked_reason: blockedReason,
    recommended_next_operator_action: "Resolve the rollback approval or gate mismatch before retrying manual rollback execution.",
    artifact_label: "unity_mutation_execution_chain_rollback_result",
    review_package: null,
    delivery_package: null,
    mutating: false,
  };
}

function isSuccessfulChainMutationResult(result: UnitySceneObjectCreationMutationExecutionResult): boolean {
  return result.execution_kind === "controlled_mutation_executed" || result.execution_kind === "controlled_mutation_idempotent";
}

function isSuccessfulChainRollbackResult(result: UnitySceneObjectCreationRollbackExecutionResult): boolean {
  return result.execution_kind === "controlled_rollback_executed" || result.execution_kind === "controlled_rollback_idempotent";
}

function getPlannedChainRollbackActionCountDelta(
  actionResult: UnityPlannedChainRollbackExecutionActionResult,
): number {
  if (!actionResult.result || actionResult.status !== "executed") {
    return 0;
  }

  return actionResult.result.execution_kind === "controlled_rollback_executed" ? -1 : 0;
}

function hasSeparateRollbackApprovals(
  input: UnityPlannedChainRollbackExecutionInput,
): { approved: boolean; blockedReason: string | null; } {
  if (!hasCompletedReview(input.review_state)) {
    return {
      approved: false,
      blockedReason: "Manual rollback execution requires a separate completed rollback review approval.",
    };
  }

  if (!hasApproval(input.review_state)) {
    return {
      approved: false,
      blockedReason: "Manual rollback execution requires a separate operator rollback approval.",
    };
  }

  if (!input.source_execution_result) {
    return {
      approved: false,
      blockedReason: "Manual rollback execution requires the source chain execution evidence from Step 4.",
    };
  }

  if (input.review_state.review_package_id === input.source_execution_result.review_approval_id) {
    return {
      approved: false,
      blockedReason: "Manual rollback execution cannot reuse the original chain execution review approval.",
    };
  }

  if (input.review_state.operator_approval_id === input.source_execution_result.operator_approval_id) {
    return {
      approved: false,
      blockedReason: "Manual rollback execution cannot reuse the original chain execution operator approval.",
    };
  }

  return {
    approved: true,
    blockedReason: null,
  };
}

function createFailureEvidence(
  classification: UnityMutationExecutionChainFailureClassification,
  source: UnityMutationExecutionChainFailureSource,
  isSimulated: boolean,
  isRecoverable: boolean,
  requiresManualReview: boolean,
  summary: string,
): UnityMutationExecutionChainFailureEvidence {
  return {
    classification,
    source,
    is_simulated: isSimulated,
    is_recoverable: isRecoverable,
    requires_manual_review: requiresManualReview,
    summary,
  };
}

function summarizeFailureReason(reason: string | null): string {
  return reason?.trim() || "No specific failure evidence was recorded.";
}

function isDependencyFailureReason(reason: string): boolean {
  return /dependenc|depends on|cannot run until/i.test(reason);
}

function isGateFailureReason(reason: string): boolean {
  return /approval|switch|target match|scope|expired|not ready|authorization|requires a ready chain|requires separate rollback approvals|cannot reuse the original chain execution|gate mismatch|limited to|state gate/i.test(reason);
}

function isStateVerificationFailureReason(reason: string): boolean {
  return /state verification|state drift|object count delta/i.test(reason);
}

function isUnsupportedFailureReason(reason: string): boolean {
  return /does not support action type|does not support rollback action type|limited to one creation action followed by one rollback action|requires an exact create-then-rollback dependency pair|requires a bounded two-action dependency pair|limited to a bounded two-action dependency pair|requires distinct controlled object targets/i.test(reason);
}

export function classifyUnityChainFailureEvidence(input: {
  context: "chain" | "rollback";
  blockedReason: string | null;
  failedActionResult: UnityMutationExecutionChainExecutionActionResult | UnityPlannedChainRollbackExecutionActionResult | null;
  simulatedFailureKind?: UnityMutationExecutionChainFailureSimulationKind | null;
}): UnityMutationExecutionChainFailureEvidence {
  if (!input.failedActionResult && !input.blockedReason && !input.simulatedFailureKind) {
    return createFailureEvidence("none", "unknown", false, false, false, "No failure evidence recorded.");
  }

  if (input.simulatedFailureKind === "simulated_action_failure") {
    return createFailureEvidence(
      "simulated_action_failure",
      "simulation",
      true,
      true,
      true,
      "Simulated action failure evidence was recorded. Treat this as operator-enabled test evidence, not a real Unity runtime failure.",
    );
  }

  if (input.simulatedFailureKind === "simulated_runtime_unavailable") {
    return createFailureEvidence(
      "simulated_runtime_unavailable",
      "simulation",
      true,
      true,
      true,
      "Simulated runtime unavailable evidence was recorded. Treat this as operator-enabled test evidence, not a real Unity runtime failure.",
    );
  }

  if (input.simulatedFailureKind === "simulated_gate_mismatch") {
    return createFailureEvidence(
      "simulated_gate_mismatch",
      "simulation",
      true,
      true,
      true,
      "Simulated gate mismatch evidence was recorded. Treat this as operator-enabled test evidence, not a real approval or readiness failure.",
    );
  }

  if (input.simulatedFailureKind === "simulated_terminal_stop") {
    return createFailureEvidence(
      "simulated_terminal_stop",
      "simulation",
      true,
      true,
      true,
      "Simulated terminal stop evidence was recorded. Treat this as operator-enabled rollback-planning evidence, not a real Unity runtime failure.",
    );
  }

  const failureReason = summarizeFailureReason(input.failedActionResult?.failure_reason ?? input.blockedReason);
  const executionKind = input.failedActionResult?.result?.execution_kind ?? null;
  const actionType = input.failedActionResult && "action_type" in input.failedActionResult
    ? input.failedActionResult.action_type
    : input.failedActionResult?.rollback_action_type ?? null;

  if (isUnsupportedFailureReason(failureReason)) {
    return createFailureEvidence(
      "unsupported_action",
      "adapter",
      false,
      false,
      true,
      `Unsupported Unity action evidence was recorded. ${failureReason}`,
    );
  }

  if (isDependencyFailureReason(failureReason)) {
    return createFailureEvidence(
      "dependency_failed",
      "dependency",
      false,
      true,
      false,
      `Dependency failure evidence was recorded. ${failureReason}`,
    );
  }

  if (isGateFailureReason(failureReason)) {
    if (/state gate/i.test(failureReason)) {
      return createFailureEvidence(
        "state_gate_failed",
        "gate",
        false,
        true,
        false,
        `State gate failure evidence was recorded. ${failureReason}`,
      );
    }

    return createFailureEvidence(
      "gate_mismatch",
      "gate",
      false,
      true,
      false,
      `Gate mismatch evidence was recorded. ${failureReason}`,
    );
  }

  if (isStateVerificationFailureReason(failureReason)) {
    return createFailureEvidence(
      "state_verification_failed",
      "runtime",
      false,
      true,
      true,
      `State verification failure evidence was recorded. ${failureReason}`,
    );
  }

  if (input.context === "rollback" || actionType === "unity_scene_object_rollback" || actionType === "unity_scene_object_removal") {
    if (input.failedActionResult || executionKind === "controlled_rollback_failed" || executionKind === "controlled_rollback_unavailable") {
      return createFailureEvidence(
        "rollback_failed",
        "rollback",
        false,
        true,
        true,
        `Rollback failure evidence was recorded. ${failureReason}`,
      );
    }
  }

  if (executionKind === "controlled_mutation_unavailable") {
    return createFailureEvidence(
      "runtime_unavailable",
      "runtime",
      false,
      true,
      true,
      `Runtime unavailable evidence was recorded. ${failureReason}`,
    );
  }

  if (executionKind === "controlled_mutation_failed") {
    return createFailureEvidence(
      "action_failed",
      "runtime",
      false,
      false,
      true,
      `Runtime action failure evidence was recorded. ${failureReason}`,
    );
  }

  return createFailureEvidence(
    "unknown_failure",
    "unknown",
    false,
    false,
    true,
    `Ambiguous failure evidence was recorded and requires manual review. ${failureReason}`,
  );
}

export function buildRollbackPlanForExecutedChainActions(input: {
  chain_id: string;
  executed_actions: UnityMutationExecutionChainExecutionActionResult[];
  ordered_actions: UnityMutationExecutionChainReadinessActionInput[];
  rollback_reason: string;
}): UnityMutationExecutionChainRollbackPlan | null {
  const executedSuccesses = input.executed_actions.filter((action) => action.executed);
  if (executedSuccesses.length === 0) {
    return null;
  }

  const executedActionIds = new Set(executedSuccesses.map((action) => action.action_id));
  const rollbackNodes = [...input.ordered_actions]
    .filter((action) => executedActionIds.has(action.action_id))
    .reverse();
  if (rollbackNodes.length === 0) {
    return null;
  }

  const rollbackTargets = rollbackNodes.map((action, index) => ({
    order: index + 1,
    source_action_id: action.action_id,
    rollback_action_type: "unity_scene_object_removal" as const,
    target_scene: action.target_scene,
    target_object_name: action.target_object_name,
  }));
  const rollbackOrder = rollbackTargets.map((entry) => entry.source_action_id);

  return {
    rollback_plan_id: `unity-chain-rollback-plan-${input.chain_id}`,
    source_chain_id: input.chain_id,
    actions_to_rollback: rollbackOrder,
    rollback_order: rollbackOrder,
    rollback_targets: rollbackTargets,
    rollback_target_count: rollbackTargets.length,
    rollback_reason: input.rollback_reason,
    required_approvals: [
      "explicit rollback plan review approval",
      "explicit final rollback authorization",
      "explicit final rollback switch enablement",
    ],
    auto_execute: false,
    executed: false,
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
    post_playtest_learning: null,
    post_playtest_decision: null,
    post_playtest_fix_plan: null,
    post_playtest_execution_plan: null,
    post_playtest_execution_result: null,
    mutating: false,
  };
}

function buildPostPlaytestLearningSummary(result: AutoRecordOutcomeResult | null): string | null {
  if (!result) {
    return null;
  }

  switch (result.status) {
    case "blocked":
      return `Post-playtest learning blocked: ${result.reason}`;
    case "duplicate":
      return `Post-playtest learning skipped duplicate outcome recording for feature ${result.feature}.`;
    case "recorded":
      return `Post-playtest learning recorded a runtime-auto outcome for feature ${result.feature}.`;
    default:
      return null;
  }
}

function buildPostPlaytestLearningValidationLines(result: AutoRecordOutcomeResult | null): string[] {
  if (!result) {
    return [];
  }

  if (result.status === "blocked") {
    return [
      "Post-playtest learning status: blocked",
      `Post-playtest learning reason: ${result.reason}`,
    ];
  }

  return [
    `Post-playtest learning status: ${result.status}`,
    `Post-playtest learning feature: ${result.feature}`,
    `Post-playtest learning inferred result: ${result.evaluation.parsedResult.inferredResult}`,
    `Post-playtest learning session mode: ${result.evaluation.session.mode}`,
    `Post-playtest learning evaluated lines: ${result.evaluation.evaluatedLineCount}`,
  ];
}

function buildPostPlaytestDecisionSummary(result: PostPlaytestDecisionResult | null): string | null {
  if (!result) {
    return null;
  }

  return `Post-playtest decision status: ${result.status}. ${result.recommended_next_action}`;
}

function buildPostPlaytestDecisionValidationLines(result: PostPlaytestDecisionResult | null): string[] {
  if (!result) {
    return [];
  }

  return [
    `Post-playtest decision status: ${result.status}`,
    `Post-playtest decision reason: ${result.reason}`,
    `Post-playtest decision recommendation: ${result.recommended_next_action}`,
    `Post-playtest decision confidence: ${result.confidence}`,
    ...(result.source_feature ? [`Post-playtest decision feature: ${result.source_feature}`] : []),
    ...(result.source_outcome_session_key
      ? [`Post-playtest decision session key: ${result.source_outcome_session_key}`]
      : []),
  ];
}

function buildPostPlaytestFixPlanSummary(result: PostPlaytestFixPlanResult | null): string | null {
  if (!result) {
    return null;
  }

  const firstStep = result.recommended_fix_steps[0];
  return firstStep
    ? `Post-playtest fix plan status: ${result.status}. ${firstStep}`
    : `Post-playtest fix plan status: ${result.status}.`;
}

function buildPostPlaytestFixPlanValidationLines(result: PostPlaytestFixPlanResult | null): string[] {
  if (!result) {
    return [];
  }

  return [
    `Post-playtest fix plan status: ${result.status}`,
    `Post-playtest fix plan reason: ${result.reason}`,
    `Post-playtest fix plan confidence: ${result.confidence}`,
    ...(result.source_decision_status ? [`Post-playtest fix plan source decision: ${result.source_decision_status}`] : []),
    ...(result.source_feature ? [`Post-playtest fix plan feature: ${result.source_feature}`] : []),
    ...(result.source_outcome_session_key
      ? [`Post-playtest fix plan session key: ${result.source_outcome_session_key}`]
      : []),
    ...result.recommended_fix_steps.map((step) => `Post-playtest fix step: ${step}`),
    ...result.safety_constraints.map((constraint) => `Post-playtest fix safety constraint: ${constraint}`),
  ];
}

function buildPostPlaytestExecutionPlanSummary(result: PostPlaytestExecutionPlanResult | null): string | null {
  if (!result) {
    return null;
  }

  const firstAction = result.proposed_actions[0];
  return firstAction
    ? `Post-playtest execution plan status: ${result.status}. ${firstAction}`
    : `Post-playtest execution plan status: ${result.status}.`;
}

function buildPostPlaytestExecutionPlanValidationLines(result: PostPlaytestExecutionPlanResult | null): string[] {
  if (!result) {
    return [];
  }

  return [
    `Post-playtest execution plan status: ${result.status}`,
    `Post-playtest execution plan reason: ${result.reason}`,
    `Post-playtest execution plan confidence: ${result.confidence}`,
    `Post-playtest execution requires operator approval: ${result.requires_operator_approval ? "yes" : "no"}`,
    `Post-playtest execution max changed files: ${result.max_changed_files}`,
    `Post-playtest execution max retry count: ${result.max_retry_count}`,
    ...(result.source_fix_plan_status ? [`Post-playtest execution source fix plan: ${result.source_fix_plan_status}`] : []),
    ...(result.source_feature ? [`Post-playtest execution feature: ${result.source_feature}`] : []),
    ...(result.source_outcome_session_key
      ? [`Post-playtest execution session key: ${result.source_outcome_session_key}`]
      : []),
    ...result.allowed_file_scopes.map((scope) => `Post-playtest execution allowed scope: ${scope}`),
    ...result.proposed_actions.map((action) => `Post-playtest execution action: ${action}`),
  ];
}

function buildPostPlaytestExecutionResultSummary(result: PostPlaytestExecutionResult | null): string | null {
  if (!result) {
    return null;
  }

  return `Post-playtest execution result status: ${result.status}. ${result.reason}`;
}

function buildPostPlaytestExecutionResultValidationLines(result: PostPlaytestExecutionResult | null): string[] {
  if (!result) {
    return [];
  }

  return [
    `Post-playtest execution result status: ${result.status}`,
    `Post-playtest execution result reason: ${result.reason}`,
    `Post-playtest execution result confidence: ${result.confidence}`,
    `Post-playtest execution retry count: ${result.retry_count}`,
    `Post-playtest execution max retry count: ${result.max_retry_count}`,
    `Post-playtest execution rollback available: ${result.rollback_available ? "yes" : "no"}`,
    `Post-playtest execution validation rerun requested: ${result.validation_rerun_requested ? "yes" : "no"}`,
    `Post-playtest execution validation rerun completed: ${result.validation_rerun_completed ? "yes" : "no"}`,
    `Post-playtest execution follow-up learning required: ${result.followup_learning_required ? "yes" : "no"}`,
    ...(result.source_feature ? [`Post-playtest execution result feature: ${result.source_feature}`] : []),
    ...(result.source_outcome_session_key
      ? [`Post-playtest execution result session key: ${result.source_outcome_session_key}`]
      : []),
    ...result.modified_files.map((filePath) => `Post-playtest execution modified file: ${filePath}`),
  ];
}

type PostPlaytestFollowupLoopResult = {
  learning: AutoRecordOutcomeResult;
  decision: PostPlaytestDecisionResult;
  fixPlan: PostPlaytestFixPlanResult;
  executionPlan: PostPlaytestExecutionPlanResult;
};

function buildPostPlaytestFollowupSummary(result: PostPlaytestFollowupLoopResult | null): string | null {
  if (!result) {
    return null;
  }

  return [
    `Post-playtest follow-up learning status: ${result.learning.status}.`,
    `Post-playtest follow-up decision status: ${result.decision.status}.`,
    `Post-playtest follow-up fix plan status: ${result.fixPlan.status}.`,
    `Post-playtest follow-up execution plan status: ${result.executionPlan.status}.`,
  ].join(" ");
}

function buildPostPlaytestFollowupValidationLines(result: PostPlaytestFollowupLoopResult | null): string[] {
  if (!result) {
    return [];
  }

  return [
    `Post-playtest follow-up learning status: ${result.learning.status}`,
    `Post-playtest follow-up decision status: ${result.decision.status}`,
    `Post-playtest follow-up fix plan status: ${result.fixPlan.status}`,
    `Post-playtest follow-up execution plan status: ${result.executionPlan.status}`,
  ];
}

async function runOutcomeLearningConfig(
  config:
    | {
      feature?: string | null;
      projectPath?: string | null;
      runtimeLogPath?: string | null;
    }
    | undefined,
): Promise<AutoRecordOutcomeResult> {
  const projectPath = config?.projectPath?.trim()
    || process.env.AIE_UNITY_PROJECT_PATH?.trim()
    || "";

  return autoRecordOutcomeForFeature(
    projectPath,
    config?.feature ?? undefined,
    config?.runtimeLogPath ?? undefined,
  );
}

async function runPostPlaytestLearningHook(
  options: UnityValidationExecutionOptions | undefined,
): Promise<AutoRecordOutcomeResult> {
  return runOutcomeLearningConfig(options?.post_playtest_learning);
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
    | "post_playtest_learning"
    | "post_playtest_decision"
    | "post_playtest_fix_plan"
    | "post_playtest_execution_plan"
    | "post_playtest_execution_result"
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
      ...buildPostPlaytestLearningValidationLines(result.post_playtest_learning),
      ...buildPostPlaytestDecisionValidationLines(result.post_playtest_decision),
      ...buildPostPlaytestFixPlanValidationLines(result.post_playtest_fix_plan),
      ...buildPostPlaytestExecutionPlanValidationLines(result.post_playtest_execution_plan),
      ...buildPostPlaytestExecutionResultValidationLines(result.post_playtest_execution_result),
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
      ...buildPostPlaytestLearningValidationLines(result.post_playtest_learning),
      ...buildPostPlaytestDecisionValidationLines(result.post_playtest_decision),
      ...buildPostPlaytestFixPlanValidationLines(result.post_playtest_fix_plan),
      ...buildPostPlaytestExecutionPlanValidationLines(result.post_playtest_execution_plan),
      ...buildPostPlaytestExecutionResultValidationLines(result.post_playtest_execution_result),
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
      post_playtest_learning: null,
      post_playtest_decision: null,
      post_playtest_fix_plan: null,
      post_playtest_execution_plan: null,
      post_playtest_execution_result: null,
      post_playtest_execution_result: null,
      mutating: false,
    };

    const evidencePackages = createUnityValidationEvidencePackages(input, baseResult);

    return {
      ...baseResult,
      review_package: evidencePackages.reviewPackage,
      delivery_package: evidencePackages.deliveryPackage,
    };
  }

  const postPlaytestLearning = await runPostPlaytestLearningHook(options);
  const postPlaytestLearningSummary = buildPostPlaytestLearningSummary(postPlaytestLearning);
  const postPlaytestDecision = decidePostPlaytestNextAction(postPlaytestLearning);
  const postPlaytestDecisionSummary = buildPostPlaytestDecisionSummary(postPlaytestDecision);
  const postPlaytestFixPlan = buildPostPlaytestFixPlan(postPlaytestDecision);
  const postPlaytestFixPlanSummary = buildPostPlaytestFixPlanSummary(postPlaytestFixPlan);
  const postPlaytestExecutionPlan = buildPostPlaytestExecutionPlan(postPlaytestFixPlan);
  const postPlaytestExecutionPlanSummary = buildPostPlaytestExecutionPlanSummary(postPlaytestExecutionPlan);
  const postPlaytestExecutionResult = await executePostPlaytestFix({
    execution_plan: postPlaytestExecutionPlan,
    operator_approval: options?.post_playtest_executor?.operator_approval === true,
    retry_count: options?.post_playtest_executor?.retry_count ?? 0,
    file_changes: options?.post_playtest_executor?.file_changes ?? [],
    post_execution_check: options?.post_playtest_executor?.post_execution_check,
    rerun_validation: async () => {
      const rerunResult = await runtimeBridge.probeValidation({
        request_id: `${input.adapter_request_id}-post-playtest-rerun`,
        requested_at: new Date().toISOString(),
        scene_name_hint: extractSceneNameHint(input.planning_packet),
      });

      if (rerunResult.bridge_status === "bridge_unavailable") {
        return {
          completed: false,
          succeeded: false,
          reason: rerunResult.reason,
        };
      }

      const rerunPassed = rerunResult.scene_validation_status === "checked_clean"
        && (rerunResult.missing_script_count ?? 0) === 0
        && (rerunResult.console_error_count ?? 0) === 0;

      return {
        completed: true,
        succeeded: rerunPassed,
        reason: rerunPassed
          ? "The reviewed Unity validation rerun completed cleanly after the guarded fix."
          : rerunResult.summary,
      };
    },
  });
  const postPlaytestExecutionResultSummary = buildPostPlaytestExecutionResultSummary(postPlaytestExecutionResult);
  const postPlaytestFollowupLoop = postPlaytestExecutionResult.followup_learning_required
    ? (() => null as PostPlaytestFollowupLoopResult | null)()
    : null;
  let resolvedPostPlaytestFollowupLoop: PostPlaytestFollowupLoopResult | null = postPlaytestFollowupLoop;

  if (postPlaytestExecutionResult.followup_learning_required && options?.post_playtest_executor?.followup_learning) {
    const followupLearning = await runOutcomeLearningConfig(options.post_playtest_executor.followup_learning);
    const followupDecision = decidePostPlaytestNextAction(followupLearning);
    const followupFixPlan = buildPostPlaytestFixPlan(followupDecision);
    const followupExecutionPlan = buildPostPlaytestExecutionPlan(followupFixPlan);

    resolvedPostPlaytestFollowupLoop = {
      learning: followupLearning,
      decision: followupDecision,
      fixPlan: followupFixPlan,
      executionPlan: followupExecutionPlan,
    };
  }
  const postPlaytestFollowupSummary = buildPostPlaytestFollowupSummary(resolvedPostPlaytestFollowupLoop);

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
    delivery_summary: [
      bridgeResult.summary,
      postPlaytestLearningSummary,
      postPlaytestDecisionSummary,
      postPlaytestFixPlanSummary,
      postPlaytestExecutionPlanSummary,
      postPlaytestExecutionResultSummary,
      postPlaytestFollowupSummary,
    ].filter((value): value is string => Boolean(value)).join(" "),
    recommended_next_operator_action: bridgeResult.recommended_next_operator_action,
    artifact_label: "unity_read_only_validation_report",
    review_package: null,
    delivery_package: null,
    post_playtest_learning: postPlaytestLearning,
    post_playtest_decision: postPlaytestDecision,
    post_playtest_fix_plan: postPlaytestFixPlan,
    post_playtest_execution_plan: postPlaytestExecutionPlan,
    post_playtest_execution_result: postPlaytestExecutionResult,
    mutating: false,
  };

  const evidencePackages = createUnityValidationEvidencePackages(input, baseResult);

  if (resolvedPostPlaytestFollowupLoop) {
    evidencePackages.reviewPackage.proof_results.push(...buildPostPlaytestFollowupValidationLines(resolvedPostPlaytestFollowupLoop));
    evidencePackages.deliveryPackage.validation_results.push(...buildPostPlaytestFollowupValidationLines(resolvedPostPlaytestFollowupLoop));
  }

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

export async function executeUnityMutationExecutionChain(
  input: UnityMutationExecutionChainExecutionInput,
  options?: UnitySceneObjectCreationMutationExecutionOptions,
): Promise<UnityMutationExecutionChainExecutionResult> {
  if (!isSceneObjectCreationOnlyPacket(input.planning_packet)) {
    return buildChainExecutionBlockedResult(
      input,
      input.readiness_result,
      "Only scene_object_creation_request is executable through the first controlled Unity chain path.",
      "gate_mismatch",
    );
  }

  if (!input.readiness_result) {
    return buildChainExecutionBlockedResult(
      input,
      null,
      "Controlled Unity chain execution requires a Step 2 readiness artifact before execution can run.",
      "gate_mismatch",
    );
  }

  const readinessResult = input.readiness_result;
  if (readinessResult.chain_id !== input.chain_id.trim()) {
    return buildChainExecutionBlockedResult(
      input,
      readinessResult,
      "Controlled Unity chain execution readiness artifact does not match the reviewed chain id.",
      "gate_mismatch",
    );
  }

  if (readinessResult.chain_readiness !== "ready_for_operator_execution" || !readinessResult.chain_ready) {
    return buildChainExecutionBlockedResult(
      input,
      readinessResult,
      readinessResult.blocked_reason ?? "Controlled Unity chain execution requires every action to be ready_for_operator_execution.",
      "gate_mismatch",
    );
  }

  const orderedReadinessActions = readinessResult.ordered_actions;
  if (orderedReadinessActions.length !== 2) {
    return buildChainExecutionBlockedResult(
      input,
      readinessResult,
      "Controlled Unity chain execution is limited to a bounded two-action dependency pair.",
      "unsupported_action",
    );
  }

  const [firstAction, secondAction] = orderedReadinessActions;
  if (
    firstAction.action_type !== "unity_scene_object_creation"
    || (secondAction.action_type !== "unity_scene_object_creation" && secondAction.action_type !== "unity_scene_object_rollback")
    || secondAction.depends_on.length !== 1
    || secondAction.depends_on[0] !== firstAction.action_id
    || (secondAction.action_type === "unity_scene_object_creation" && secondAction.target_object_name.trim() === firstAction.target_object_name.trim())
  ) {
    return buildChainExecutionBlockedResult(
      input,
      readinessResult,
      "Controlled Unity chain execution requires a bounded two-action dependency pair with a leading creation action and distinct controlled object targets.",
      "unsupported_action",
    );
  }

  const actionInputsById = new Map(input.actions.map((action) => [action.action_id, action]));
  const actionResults: UnityMutationExecutionChainExecutionActionResult[] = [];
  const stateSnapshots: UnityMutationExecutionChainStateSnapshotRecord[] = [];
  let triggeredSimulation: UnityMutationExecutionChainFailureSimulationControl | null = null;
  const runtimeBridge = options?.runtime_bridge ?? createConfiguredUnityReadOnlyRuntimeBridge();
  const trackedObjectNames = getUniqueTrackedObjectNames(input.actions);
  const baselineSnapshotCapture = await captureUnityChainStateSnapshot({
    runtimeBridge,
    requestId: `${input.adapter_request_id}:chain_start`,
    requestedAt: input.requested_at,
    sceneNameHint: input.actions[0]?.target_scene?.trim() ?? null,
    trackedObjectNames,
  });

  if (!baselineSnapshotCapture.snapshot) {
    return buildChainExecutionBlockedResult(
      input,
      readinessResult,
      `State gate blocked chain execution before mutation because the initial state snapshot could not be captured. ${baselineSnapshotCapture.blockedReason ?? ""}`.trim(),
      "state_gate_failed",
    );
  }

  const baselineSnapshot = baselineSnapshotCapture.snapshot;
  let lastObservedSnapshot: ChainStateSnapshot | null = baselineSnapshot;
  stateSnapshots.push({
    stage: "chain_start",
    action_id: null,
    snapshot: baselineSnapshot,
    expected: `Capture baseline state for ${input.actions[0]?.target_scene?.trim() ?? "unknown"} before chain execution begins.`,
    observed: describeChainSnapshot(baselineSnapshot),
    decision: "continue",
  });

  for (const plannedAction of orderedReadinessActions) {
    const actionInput = actionInputsById.get(plannedAction.action_id);
    if (!actionInput) {
      return buildChainExecutionBlockedResult(
        input,
        readinessResult,
        `Controlled Unity chain execution is missing the reviewed action payload for ${plannedAction.action_id}.`,
        "gate_mismatch",
        plannedAction.action_id,
      );
    }

    if (!plannedAction.ready_for_operator_execution) {
      return buildChainExecutionBlockedResult(
        input,
        readinessResult,
        plannedAction.blocked_reason ?? `Controlled Unity chain action ${plannedAction.action_id} is not ready for operator execution.`,
        "gate_mismatch",
        plannedAction.action_id,
      );
    }

    const dependencyActions = plannedAction.depends_on.map((dependencyId) => actionInputsById.get(dependencyId)).filter(Boolean) as UnityMutationExecutionChainReadinessActionInput[];
    const dependencyResults = plannedAction.depends_on.map((dependencyId) => actionResults.find((entry) => entry.action_id === dependencyId)).filter(Boolean) as UnityMutationExecutionChainExecutionActionResult[];
    const unsatisfiedDependencies = plannedAction.depends_on.filter((dependencyId) => {
      const dependencyResult = actionResults.find((entry) => entry.action_id === dependencyId);
      return !dependencyResult || dependencyResult.status !== "executed";
    });
    if (unsatisfiedDependencies.length > 0) {
      return buildChainExecutionBlockedResult(
        input,
        readinessResult,
        `Controlled Unity chain action ${plannedAction.action_id} cannot run until dependencies succeed: ${unsatisfiedDependencies.join(", ")}.`,
        "dependency_failed",
        plannedAction.action_id,
      );
    }

    const simulationStatus = evaluateUnityMutationExecutionChainFailureSimulation({
      simulation: input.failure_simulation ?? null,
      action_id: plannedAction.action_id,
      evaluated_at: input.requested_at,
    });
    if (simulationStatus.blocked_reason) {
      return buildChainExecutionBlockedResult(
        input,
        readinessResult,
        simulationStatus.blocked_reason,
        "simulated_gate_mismatch",
        plannedAction.action_id,
      );
    }

    if (simulationStatus.applies && input.failure_simulation && input.failure_simulation.failure_kind !== "simulated_terminal_stop") {
      triggeredSimulation = input.failure_simulation;
      actionResults.push(buildSimulatedChainActionFailureResult({
        action_id: plannedAction.action_id,
        action_type: plannedAction.action_type,
        failure_kind: input.failure_simulation.failure_kind,
        failure_simulation_id: input.failure_simulation.failure_simulation_id,
      }));
      break;
    }

    const beforeSnapshotCapture = await captureUnityChainStateSnapshot({
      runtimeBridge,
      requestId: `${input.adapter_request_id}:${plannedAction.action_id}:before`,
      requestedAt: input.requested_at,
      sceneNameHint: plannedAction.target_scene.trim(),
      trackedObjectNames,
    });
    if (!beforeSnapshotCapture.snapshot) {
      const snapshotBlockedReason = `State gate blocked ${plannedAction.action_id} before mutation because the pre-action state snapshot could not be captured. ${beforeSnapshotCapture.blockedReason ?? ""}`.trim();
      if (actionResults.some((entry) => entry.executed)) {
        actionResults.push({
          action_id: plannedAction.action_id,
          action_type: plannedAction.action_type,
          status: "failed",
          executed: false,
          dependency_satisfied: unsatisfiedDependencies.length === 0,
          result: null,
          failure_reason: snapshotBlockedReason,
        });
        break;
      }

      return buildChainExecutionBlockedResult(
        input,
        readinessResult,
        snapshotBlockedReason,
        "state_gate_failed",
        plannedAction.action_id,
        stateSnapshots,
        buildChainFinalSceneStateFromSnapshot(
          plannedAction.target_scene.trim(),
          baselineSnapshot,
          lastObservedSnapshot,
          "Chain execution was blocked before any Unity mutation ran.",
        ),
      );
    }

    const beforeSnapshot = beforeSnapshotCapture.snapshot;
    const preActionGate = evaluatePreActionStateGate({
      action: actionInput,
      snapshot: beforeSnapshot,
      dependencyActions,
      dependencyResults,
    });
    stateSnapshots.push({
      stage: "before_action",
      action_id: plannedAction.action_id,
      snapshot: beforeSnapshot,
      expected: preActionGate.expected,
      observed: preActionGate.observed,
      decision: preActionGate.passed ? "continue" : "stop",
    });
    lastObservedSnapshot = beforeSnapshot;

    if (!preActionGate.passed) {
      const preActionBlockedReason = preActionGate.reason ?? `State gate blocked ${plannedAction.action_id}.`;
      if (actionResults.some((entry) => entry.executed)) {
        actionResults.push({
          action_id: plannedAction.action_id,
          action_type: plannedAction.action_type,
          status: "failed",
          executed: false,
          dependency_satisfied: unsatisfiedDependencies.length === 0,
          result: null,
          failure_reason: preActionBlockedReason,
        });
        stateSnapshots.push({
          stage: "failure",
          action_id: plannedAction.action_id,
          snapshot: beforeSnapshot,
          expected: preActionGate.expected,
          observed: preActionGate.observed,
          decision: "manual_review_required",
        });
        break;
      }

      return buildChainExecutionBlockedResult(
        input,
        readinessResult,
        preActionBlockedReason,
        preActionGate.failureClassification ?? "state_gate_failed",
        plannedAction.action_id,
        stateSnapshots,
        buildChainFinalSceneStateFromSnapshot(
          plannedAction.target_scene.trim(),
          baselineSnapshot,
          beforeSnapshot,
          "Chain execution was blocked before any Unity mutation ran.",
        ),
      );
    }

    if (actionInput.action_type === "unity_scene_object_creation") {
      const result = await executeUnitySceneObjectCreationMutation({
        ...input,
        adapter_request_id: actionInput.preview_result?.request_id ?? actionInput.execution_plan?.request_id ?? `${input.adapter_request_id}:${actionInput.action_id}`,
        dry_run: true,
        requested_object_name: actionInput.target_object_name,
        target_scene: actionInput.target_scene,
        intended_components: actionInput.preview_result?.intended_components ?? ["Transform", "BoxCollider"],
        intended_transform: actionInput.preview_result?.intended_transform ?? {
          position: { x: 0, y: 0, z: 0 },
          rotation_euler: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        preview_result: actionInput.preview_result ?? null,
        preflight_result: actionInput.preflight_result ?? null,
        authorization: actionInput.authorization ?? null,
        live_validation_result: actionInput.live_validation_result ?? null,
        execution_plan: actionInput.execution_plan ?? null,
        mutation_switch: actionInput.mutation_switch ?? null,
        mutation_execution_mode_enabled: actionInput.mutation_execution_mode_enabled ?? true,
        idempotent_on_duplicate: true,
      }, options);

      const successful = isSuccessfulChainMutationResult(result);
      actionResults.push({
        action_id: actionInput.action_id,
        action_type: actionInput.action_type,
        status: successful ? "executed" : "failed",
        executed: result.executed,
        dependency_satisfied: true,
        result,
        failure_reason: successful ? null : result.blocked_reason ?? result.delivery_summary,
      });

      if (!successful) {
        const failureSnapshotCapture = await captureUnityChainStateSnapshot({
          runtimeBridge,
          requestId: `${input.adapter_request_id}:${plannedAction.action_id}:failure`,
          requestedAt: input.requested_at,
          sceneNameHint: plannedAction.target_scene.trim(),
          trackedObjectNames,
        });
        if (failureSnapshotCapture.snapshot) {
          stateSnapshots.push({
            stage: "failure",
            action_id: plannedAction.action_id,
            snapshot: failureSnapshotCapture.snapshot,
            expected: `Capture failure state for ${plannedAction.action_id} after a blocked or failed action result.`,
            observed: describeChainSnapshot(failureSnapshotCapture.snapshot),
            decision: "manual_review_required",
          });
          lastObservedSnapshot = failureSnapshotCapture.snapshot;
        }
        break;
      }

      const afterSnapshotCapture = await captureUnityChainStateSnapshot({
        runtimeBridge,
        requestId: `${input.adapter_request_id}:${plannedAction.action_id}:after`,
        requestedAt: input.requested_at,
        sceneNameHint: plannedAction.target_scene.trim(),
        trackedObjectNames,
      });
      if (!afterSnapshotCapture.snapshot) {
        actionResults[actionResults.length - 1] = {
          ...actionResults[actionResults.length - 1]!,
          status: "failed",
          failure_reason: `State verification detected drift after ${plannedAction.action_id}: post-action state snapshot could not be captured.`,
        };
        break;
      }

      const afterSnapshot = afterSnapshotCapture.snapshot;
      const postActionVerification = evaluatePostActionStateVerification({
        action: actionInput,
        beforeSnapshot,
        afterSnapshot,
      });
      stateSnapshots.push({
        stage: "after_action",
        action_id: plannedAction.action_id,
        snapshot: afterSnapshot,
        expected: postActionVerification.expected,
        observed: postActionVerification.observed,
        decision: postActionVerification.passed ? "continue" : "manual_review_required",
      });
      lastObservedSnapshot = afterSnapshot;

      if (!postActionVerification.passed) {
        actionResults[actionResults.length - 1] = {
          ...actionResults[actionResults.length - 1]!,
          status: "failed",
          failure_reason: postActionVerification.reason,
        };
        stateSnapshots.push({
          stage: "failure",
          action_id: plannedAction.action_id,
          snapshot: afterSnapshot,
          expected: postActionVerification.expected,
          observed: postActionVerification.observed,
          decision: "manual_review_required",
        });
        break;
      }

      if (simulationStatus.applies && input.failure_simulation?.failure_kind === "simulated_terminal_stop") {
        triggeredSimulation = input.failure_simulation;
        const terminalStopReason = buildSimulatedChainTerminalStopReason({
          action_id: plannedAction.action_id,
          failure_simulation_id: input.failure_simulation.failure_simulation_id,
        });
        stateSnapshots.push({
          stage: "failure",
          action_id: plannedAction.action_id,
          snapshot: afterSnapshot,
          expected: "Manual stop remains available after a fully executed reviewed action.",
          observed: describeChainSnapshot(afterSnapshot),
          decision: "manual_review_required",
        });
        const actionsExecutedCount = actionResults.filter((action) => action.executed).length;
        const actionsFailedCount = actionResults.filter((action) => action.status === "failed").length;
        const successfulActionIds = actionResults.filter((action) => action.status === "executed").map((action) => action.action_id);
        const rollbackPlan = buildRollbackPlanForExecutedChainActions({
          chain_id: input.chain_id.trim(),
          executed_actions: actionResults,
          ordered_actions: input.actions,
          rollback_reason: terminalStopReason,
        });
        const finalSceneState = buildChainFinalSceneStateFromSnapshot(
          input.actions[0]?.target_scene?.trim() ?? null,
          baselineSnapshot,
          afterSnapshot,
          "Final scene object count summary is unavailable.",
        );
        const failureEvidence = classifyUnityChainFailureEvidence({
          context: "chain",
          blockedReason: terminalStopReason,
          failedActionResult: null,
          simulatedFailureKind: triggeredSimulation.failure_kind,
        });
        const baseResult: UnityMutationExecutionChainExecutionResult = {
          chain_id: input.chain_id.trim(),
          domain: "Unity",
          request_type: "scene_object_creation_request",
          execution_mode: "controlled_multi_action_chain_runtime_bridge",
          execution_kind: "chain_execution_partial_failure",
          execution_status: "partial_failure",
          chain_status: readinessResult.chain_status,
          chain_readiness: readinessResult.chain_readiness,
          review_approval_id: input.review_state.review_package_id,
          review_approval_status: hasCompletedReview(input.review_state) ? "approved" : "missing",
          operator_approval_id: input.review_state.operator_approval_id,
          operator_approval_status: hasApproval(input.review_state) ? "approved" : "missing",
          action_dependencies: readinessResult.action_dependencies,
          rollback_preview_plan: readinessResult.rollback_plan,
          rollback_order: readinessResult.rollback_order,
          total_actions: readinessResult.total_actions,
          actions_executed_count: actionsExecutedCount,
          actions_failed_count: actionsFailedCount,
          failure_handling_status: rollbackPlan ? "rollback_recommended" : "manual_review_required",
          failure_classification: failureEvidence.classification,
          failure_source: failureEvidence.source,
          failure_is_simulated: failureEvidence.is_simulated,
          failure_is_recoverable: failureEvidence.is_recoverable,
          failure_requires_manual_review: failureEvidence.requires_manual_review,
          failure_evidence_summary: failureEvidence.summary,
          failed_action_id: plannedAction.action_id,
          successful_action_ids: successfulActionIds,
          rollback_plan_required: rollbackPlan !== null,
          rollback_plan: rollbackPlan,
          manual_review_required: failureEvidence.requires_manual_review,
          failure_simulated: true,
          failure_simulation_id: triggeredSimulation.failure_simulation_id,
          simulated_failure_kind: triggeredSimulation.failure_kind,
          simulation_target_action_id: triggeredSimulation.target_action_id,
          per_action_results: actionResults,
          state_snapshots: stateSnapshots,
          final_scene_state: finalSceneState,
          blocked_reason: terminalStopReason,
          recommended_next_operator_action: rollbackPlan
            ? "Review the simulated terminal-stop evidence, approve rollback separately if needed, and keep rollback manual."
            : "Review the simulated terminal-stop evidence before retrying any controlled Unity chain execution.",
          dry_run: false,
          executed: actionResults.some((action) => action.executed),
          artifact_label: "unity_mutation_execution_chain_result",
          review_package: null,
          delivery_package: null,
          mutating: actionResults.some((action) => action.result?.mutating === true),
        };

        const chainPackages = createUnityMutationExecutionChainExecutionPackages(input, baseResult);
        return {
          ...baseResult,
          review_package: chainPackages.reviewPackage,
          delivery_package: chainPackages.deliveryPackage,
        };
      }
      continue;
    }

    if (actionInput.action_type === "unity_scene_object_rollback") {
      const result = await executeUnitySceneObjectCreationRollback({
        adapter_request_id: actionInput.execution_plan?.rollback_request_id ?? `${input.adapter_request_id}:${actionInput.action_id}`,
        requested_at: input.requested_at,
        planning_packet: input.planning_packet,
        requested_actions: input.requested_actions,
        review_state: input.review_state,
        target_scene: actionInput.target_scene,
        target_object_name: actionInput.target_object_name,
        authorization: actionInput.authorization ?? null,
        rollback_switch: actionInput.rollback_switch ?? null,
        live_validation_result: actionInput.live_validation_result ?? null,
        rollback_execution_mode_enabled: actionInput.rollback_execution_mode_enabled ?? true,
        execution_plan: actionInput.execution_plan ?? null,
        idempotent_on_missing: true,
      }, options);

      const successful = isSuccessfulChainRollbackResult(result);
      actionResults.push({
        action_id: actionInput.action_id,
        action_type: actionInput.action_type,
        status: successful ? "executed" : "failed",
        executed: result.executed,
        dependency_satisfied: true,
        result,
        failure_reason: successful ? null : result.blocked_reason ?? result.delivery_summary,
      });

      if (!successful) {
        const failureSnapshotCapture = await captureUnityChainStateSnapshot({
          runtimeBridge,
          requestId: `${input.adapter_request_id}:${plannedAction.action_id}:failure`,
          requestedAt: input.requested_at,
          sceneNameHint: plannedAction.target_scene.trim(),
          trackedObjectNames,
        });
        if (failureSnapshotCapture.snapshot) {
          stateSnapshots.push({
            stage: "failure",
            action_id: plannedAction.action_id,
            snapshot: failureSnapshotCapture.snapshot,
            expected: `Capture failure state for ${plannedAction.action_id} after a blocked or failed action result.`,
            observed: describeChainSnapshot(failureSnapshotCapture.snapshot),
            decision: "manual_review_required",
          });
          lastObservedSnapshot = failureSnapshotCapture.snapshot;
        }
        break;
      }

      const afterSnapshotCapture = await captureUnityChainStateSnapshot({
        runtimeBridge,
        requestId: `${input.adapter_request_id}:${plannedAction.action_id}:after`,
        requestedAt: input.requested_at,
        sceneNameHint: plannedAction.target_scene.trim(),
        trackedObjectNames,
      });
      if (!afterSnapshotCapture.snapshot) {
        actionResults[actionResults.length - 1] = {
          ...actionResults[actionResults.length - 1]!,
          status: "failed",
          failure_reason: `State verification detected drift after ${plannedAction.action_id}: post-action state snapshot could not be captured.`,
        };
        break;
      }

      const afterSnapshot = afterSnapshotCapture.snapshot;
      const postActionVerification = evaluatePostActionStateVerification({
        action: actionInput,
        beforeSnapshot,
        afterSnapshot,
      });
      stateSnapshots.push({
        stage: "after_rollback",
        action_id: plannedAction.action_id,
        snapshot: afterSnapshot,
        expected: postActionVerification.expected,
        observed: postActionVerification.observed,
        decision: postActionVerification.passed ? "continue" : "manual_review_required",
      });
      lastObservedSnapshot = afterSnapshot;

      if (!postActionVerification.passed) {
        actionResults[actionResults.length - 1] = {
          ...actionResults[actionResults.length - 1]!,
          status: "failed",
          failure_reason: postActionVerification.reason,
        };
        stateSnapshots.push({
          stage: "failure",
          action_id: plannedAction.action_id,
          snapshot: afterSnapshot,
          expected: postActionVerification.expected,
          observed: postActionVerification.observed,
          decision: "manual_review_required",
        });
        break;
      }
      continue;
    }

    return buildChainExecutionBlockedResult(
      input,
      readinessResult,
      `Controlled Unity chain execution does not support action type ${actionInput.action_type}.`,
      "unsupported_action",
      actionInput.action_id,
    );
  }

  const actionsExecutedCount = actionResults.filter((action) => action.executed).length;
  const actionsFailedCount = actionResults.filter((action) => action.status === "failed").length;
  const failedAction = actionResults.find((action) => action.status === "failed") ?? null;
  const successfulActionIds = actionResults.filter((action) => action.status === "executed").map((action) => action.action_id);
  const rollbackPlan = failedAction
    ? buildRollbackPlanForExecutedChainActions({
        chain_id: input.chain_id.trim(),
        executed_actions: actionResults,
        ordered_actions: input.actions,
        rollback_reason: failedAction?.failure_reason ?? "Controlled rollback is required after the reviewed chain stopped.",
      })
    : null;
  const executionStatus: UnityMutationExecutionChainExecutionStatus = actionsFailedCount > 0
    ? actionsExecutedCount > 0
      ? "partial_failure"
      : "failed"
    : "success";
  const failureEvidence = classifyUnityChainFailureEvidence({
    context: "chain",
    blockedReason: failedAction?.failure_reason ?? null,
    failedActionResult: failedAction,
    simulatedFailureKind: triggeredSimulation?.failure_kind ?? null,
  });
  const finalSceneState = buildChainFinalSceneStateFromSnapshot(
    input.actions[0]?.target_scene?.trim() ?? null,
    baselineSnapshot,
    lastObservedSnapshot,
    "Final scene object count summary is unavailable.",
  );
  const baseResult: UnityMutationExecutionChainExecutionResult = {
    chain_id: input.chain_id.trim(),
    domain: "Unity",
    request_type: "scene_object_creation_request",
    execution_mode: "controlled_multi_action_chain_runtime_bridge",
    execution_kind: executionStatus === "success"
      ? "chain_execution_executed"
      : executionStatus === "partial_failure"
        ? "chain_execution_partial_failure"
        : "chain_execution_failed",
    execution_status: executionStatus,
    chain_status: readinessResult.chain_status,
    chain_readiness: readinessResult.chain_readiness,
    review_approval_id: input.review_state.review_package_id,
    review_approval_status: hasCompletedReview(input.review_state) ? "approved" : "missing",
    operator_approval_id: input.review_state.operator_approval_id,
    operator_approval_status: hasApproval(input.review_state) ? "approved" : "missing",
    action_dependencies: readinessResult.action_dependencies,
    rollback_preview_plan: readinessResult.rollback_plan,
    rollback_order: readinessResult.rollback_order,
    total_actions: readinessResult.total_actions,
    actions_executed_count: actionsExecutedCount,
    actions_failed_count: actionsFailedCount,
    failure_handling_status: failedAction
      ? rollbackPlan
        ? "rollback_recommended"
        : "manual_review_required"
      : "none_required",
    failure_classification: failureEvidence.classification,
    failure_source: failureEvidence.source,
    failure_is_simulated: failureEvidence.is_simulated,
    failure_is_recoverable: failureEvidence.is_recoverable,
    failure_requires_manual_review: failureEvidence.requires_manual_review,
    failure_evidence_summary: failureEvidence.summary,
    failed_action_id: failedAction?.action_id ?? null,
    successful_action_ids: successfulActionIds,
    rollback_plan_required: rollbackPlan !== null,
    rollback_plan: rollbackPlan,
    manual_review_required: failureEvidence.requires_manual_review,
    failure_simulated: triggeredSimulation !== null,
    failure_simulation_id: triggeredSimulation?.failure_simulation_id ?? null,
    simulated_failure_kind: triggeredSimulation?.failure_kind ?? null,
    simulation_target_action_id: triggeredSimulation?.target_action_id ?? null,
    per_action_results: actionResults,
    state_snapshots: stateSnapshots,
    final_scene_state: finalSceneState,
    blocked_reason: failedAction?.failure_reason ?? null,
    recommended_next_operator_action: executionStatus === "success"
      ? "Review the bounded chain execution evidence and rerun read-only validation before any follow-up mutation work."
      : triggeredSimulation
        ? rollbackPlan
          ? "Review the simulated failure evidence, approve rollback separately if needed, and keep rollback manual."
          : "Review the simulated failure evidence before retrying any controlled Unity chain execution."
      : rollbackPlan
        ? "Review the failed chain action evidence, approve the rollback plan separately if appropriate, and do not auto-execute rollback."
        : "Review the failed chain action evidence before retrying any controlled Unity chain execution.",
    dry_run: false,
    executed: actionResults.some((action) => action.executed),
    artifact_label: "unity_mutation_execution_chain_result",
    review_package: null,
    delivery_package: null,
    mutating: actionResults.some((action) => action.result?.mutating === true),
  };

  const chainPackages = createUnityMutationExecutionChainExecutionPackages(input, baseResult);

  return {
    ...baseResult,
    review_package: chainPackages.reviewPackage,
    delivery_package: chainPackages.deliveryPackage,
  };
}

export async function executePlannedUnityRollbackFromChain(
  input: UnityPlannedChainRollbackExecutionInput,
  options?: UnitySceneObjectCreationRollbackExecutionOptions,
): Promise<UnityPlannedChainRollbackExecutionResult> {
  if (!isSceneObjectCreationOnlyPacket(input.planning_packet)) {
    return buildPlannedChainRollbackBlockedResult(
      input,
      "Only scene_object_creation_request is executable through the controlled Unity chain rollback lane.",
    );
  }

  if (!input.source_execution_result) {
    return buildPlannedChainRollbackBlockedResult(
      input,
      "Controlled rollback execution requires the reviewed Step 4 chain execution result.",
    );
  }

  if (!input.rollback_plan || !input.source_execution_result.rollback_plan_required || !input.source_execution_result.rollback_plan) {
    return buildPlannedChainRollbackBlockedResult(
      input,
      "Controlled rollback execution requires a reviewed rollback plan from the Step 4 partial failure path.",
    );
  }

  if (
    input.chain_id.trim() !== input.source_execution_result.chain_id
    || input.rollback_plan.source_chain_id !== input.chain_id.trim()
    || input.rollback_plan.rollback_plan_id !== input.source_execution_result.rollback_plan.rollback_plan_id
  ) {
    return buildPlannedChainRollbackBlockedResult(
      input,
      "Controlled rollback execution input does not match the reviewed chain rollback plan scope.",
    );
  }

  if (input.rollback_plan.auto_execute || input.rollback_plan.executed) {
    return buildPlannedChainRollbackBlockedResult(
      input,
      "Controlled rollback execution refuses any rollback plan marked for auto execution or already executed.",
    );
  }

  const separateApprovalStatus = hasSeparateRollbackApprovals(input);
  if (!separateApprovalStatus.approved) {
    return buildPlannedChainRollbackBlockedResult(
      input,
      separateApprovalStatus.blockedReason ?? "Controlled rollback execution requires separate rollback approvals.",
    );
  }

  const rollbackActionIds = input.rollback_plan.rollback_order;
  const rollbackTargetsByActionId = new Map(input.rollback_plan.rollback_targets.map((target) => [target.source_action_id, target]));
  if (rollbackActionIds.length === 0) {
    return buildPlannedChainRollbackBlockedResult(
      input,
      "Controlled rollback execution requires at least one rollback action from the reviewed rollback plan.",
    );
  }

  const rollbackActionMap = new Map<string, UnityPlannedChainRollbackExecutionActionInput>();
  for (const action of input.rollback_actions) {
    const sourceActionId = action.source_action_id.trim();
    if (!sourceActionId) {
      return buildPlannedChainRollbackBlockedResult(
        input,
        "Controlled rollback execution requires non-empty source_action_id values for every rollback action.",
      );
    }

    if (rollbackActionMap.has(sourceActionId)) {
      return buildPlannedChainRollbackBlockedResult(
        input,
        `Controlled rollback execution received duplicate rollback action input for ${sourceActionId}.`,
      );
    }

    rollbackActionMap.set(sourceActionId, action);
  }

  if (rollbackActionMap.size !== rollbackActionIds.length || rollbackActionIds.some((actionId) => !rollbackActionMap.has(actionId))) {
    return buildPlannedChainRollbackBlockedResult(
      input,
      "Controlled rollback execution requires one explicit rollback action payload for every reviewed rollback-plan action.",
    );
  }

  const extraRollbackAction = [...rollbackActionMap.keys()].find((actionId) => !rollbackActionIds.includes(actionId));
  if (extraRollbackAction) {
    return buildPlannedChainRollbackBlockedResult(
      input,
      `Controlled rollback execution received an unexpected rollback action payload for ${extraRollbackAction}.`,
    );
  }

  const perActionResults: UnityPlannedChainRollbackExecutionActionResult[] = [];

  for (const sourceActionId of rollbackActionIds) {
    const rollbackAction = rollbackActionMap.get(sourceActionId);
    if (!rollbackAction) {
      return buildPlannedChainRollbackBlockedResult(
        input,
        `Controlled rollback execution is missing rollback action payload for ${sourceActionId}.`,
      );
    }

    const rollbackTarget = rollbackTargetsByActionId.get(sourceActionId);
    if (!rollbackTarget) {
      return buildPlannedChainRollbackBlockedResult(
        input,
        `Controlled rollback execution is missing reviewed rollback target evidence for ${sourceActionId}.`,
      );
    }

    if (
      rollbackAction.rollback_action_type !== rollbackTarget.rollback_action_type
      || rollbackAction.target_scene.trim() !== rollbackTarget.target_scene.trim()
      || rollbackAction.target_object_name.trim() !== rollbackTarget.target_object_name.trim()
    ) {
      perActionResults.push({
        source_action_id: sourceActionId,
        rollback_request_id: rollbackAction.rollback_request_id,
        rollback_action_type: rollbackAction.rollback_action_type,
        status: "failed",
        executed: false,
        result: null,
        failure_reason: `Controlled rollback execution gate mismatch for ${sourceActionId}: payload does not match the reviewed rollback target evidence for ${rollbackTarget.target_object_name}.`,
      });
      break;
    }

    if (rollbackAction.rollback_action_type !== "unity_scene_object_removal") {
      perActionResults.push({
        source_action_id: sourceActionId,
        rollback_request_id: rollbackAction.rollback_request_id,
        rollback_action_type: "unity_scene_object_removal",
        status: "failed",
        executed: false,
        result: null,
        failure_reason: `Controlled rollback execution does not support rollback action type ${rollbackAction.rollback_action_type}.`,
      });
      break;
    }

    const controlledTargetStatus = evaluateControlledRollbackTarget(
      rollbackAction.target_scene.trim(),
      rollbackAction.target_object_name.trim(),
    );
    if (controlledTargetStatus.status !== "approved") {
      perActionResults.push({
        source_action_id: sourceActionId,
        rollback_request_id: rollbackAction.rollback_request_id,
        rollback_action_type: rollbackAction.rollback_action_type,
        status: "failed",
        executed: false,
        result: null,
        failure_reason: controlledTargetStatus.detail,
      });
      break;
    }

    const result = await executeUnitySceneObjectCreationRollback({
      adapter_request_id: rollbackAction.rollback_request_id,
      requested_at: input.requested_at,
      planning_packet: input.planning_packet,
      requested_actions: input.requested_actions,
      review_state: input.review_state,
      target_scene: rollbackAction.target_scene,
      target_object_name: rollbackAction.target_object_name,
      authorization: rollbackAction.authorization,
      rollback_switch: rollbackAction.rollback_switch,
      live_validation_result: rollbackAction.live_validation_result ?? null,
      rollback_execution_mode_enabled: rollbackAction.rollback_execution_mode_enabled ?? true,
      execution_plan: rollbackAction.execution_plan,
      idempotent_on_missing: true,
    }, options);

    const successful = isSuccessfulChainRollbackResult(result);
    perActionResults.push({
      source_action_id: sourceActionId,
      rollback_request_id: rollbackAction.rollback_request_id,
      rollback_action_type: rollbackAction.rollback_action_type,
      status: successful ? "executed" : "failed",
      executed: result.executed,
      result,
      failure_reason: successful ? null : result.blocked_reason ?? result.delivery_summary,
    });

    if (!successful) {
      break;
    }
  }

  const actionsExecutedCount = perActionResults.filter((action) => action.status === "executed").length;
  const actionsFailedCount = perActionResults.filter((action) => action.status === "failed").length;
  const remainingActionsNotExecuted = rollbackActionIds.filter((actionId) => !perActionResults.some((result) => result.source_action_id === actionId));
  const firstObjectCount = input.rollback_actions.find((action) => action.live_validation_result?.object_count !== undefined)?.live_validation_result?.object_count ?? null;
  const objectCountAfter = firstObjectCount !== null
    ? firstObjectCount + perActionResults.reduce((total, action) => total + getPlannedChainRollbackActionCountDelta(action), 0)
    : null;
  const executionStatus: UnityPlannedChainRollbackExecutionStatus = actionsFailedCount > 0
    ? actionsExecutedCount > 0
      ? "partial_failure"
      : "failed"
    : "success";
  const evidenceTimestamp = [...perActionResults]
    .reverse()
    .find((action) => action.result?.evidence_timestamp)?.result?.evidence_timestamp ?? input.requested_at;
  const failedRollbackAction = perActionResults.find((action) => action.status === "failed") ?? null;
  const failureEvidence = classifyUnityChainFailureEvidence({
    context: "rollback",
    blockedReason: failedRollbackAction?.failure_reason ?? null,
    failedActionResult: failedRollbackAction,
    simulatedFailureKind: null,
  });
  const baseResult: UnityPlannedChainRollbackExecutionResult = {
    rollback_plan_id: input.rollback_plan.rollback_plan_id,
    chain_id: input.chain_id.trim(),
    domain: "Unity",
    request_type: "scene_object_creation_request",
    rollback_type: "scene_object_removal",
    execution_mode: "controlled_planned_chain_rollback_runtime_bridge",
    execution_kind: executionStatus === "success"
      ? "planned_chain_rollback_executed"
      : executionStatus === "partial_failure"
        ? "planned_chain_rollback_partial_failure"
        : "planned_chain_rollback_failed",
    review_approval_id: input.review_state.review_package_id,
    review_approval_status: "approved",
    operator_approval_id: input.review_state.operator_approval_id,
    operator_approval_status: "approved",
    manual_trigger: true,
    auto_execute: false,
    executed: perActionResults.some((action) => action.executed),
    execution_status: executionStatus,
    actions_executed_count: actionsExecutedCount,
    actions_failed_count: actionsFailedCount,
    failure_classification: failureEvidence.classification,
    failure_source: failureEvidence.source,
    failure_is_simulated: failureEvidence.is_simulated,
    failure_is_recoverable: failureEvidence.is_recoverable,
    failure_requires_manual_review: failureEvidence.requires_manual_review,
    failure_evidence_summary: failureEvidence.summary,
    per_action_results: perActionResults,
    remaining_actions_not_executed: remainingActionsNotExecuted,
    final_scene_state: {
      target_scene: input.rollback_actions[0]?.target_scene?.trim() ?? null,
      object_count_before: firstObjectCount,
      object_count_after: objectCountAfter,
      object_count_delta: firstObjectCount !== null && objectCountAfter !== null ? objectCountAfter - firstObjectCount : null,
      summary: firstObjectCount !== null && objectCountAfter !== null
        ? `Scene ${input.rollback_actions[0]?.target_scene?.trim() ?? "unknown"} object count moved from ${String(firstObjectCount)} to ${String(objectCountAfter)} during manual rollback execution.`
        : "Final scene object count summary is unavailable for manual rollback execution.",
    },
    evidence_timestamp: evidenceTimestamp,
    blocked_reason: perActionResults.find((action) => action.status === "failed")?.failure_reason ?? null,
    recommended_next_operator_action: executionStatus === "success"
      ? "Review the rollback execution evidence and rerun read-only validation before any further Unity mutation work."
      : remainingActionsNotExecuted.length > 0
        ? "Review the failed rollback evidence and decide whether the remaining rollback actions need a separate follow-up execution step."
        : "Review the failed rollback evidence before attempting another manual rollback run.",
    artifact_label: "unity_mutation_execution_chain_rollback_result",
    review_package: null,
    delivery_package: null,
    mutating: perActionResults.some((action) => action.result?.mutating === true),
  };

  const rollbackPackages = createUnityPlannedChainRollbackExecutionPackages(input, baseResult);

  return {
    ...baseResult,
    review_package: rollbackPackages.reviewPackage,
    delivery_package: rollbackPackages.deliveryPackage,
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